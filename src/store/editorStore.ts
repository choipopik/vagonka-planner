import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { catalogLookup } from '../catalog';
import { applyCommand, invertCommand, isNoop } from '../model/commands';
import type { Command, ObjectPatch } from '../model/commands';
import { EMPTY_HISTORY, pushHistory, redoStep, undoStep } from '../model/history';
import type { History } from '../model/history';
import { createLayout } from '../model/layout';
import { cmdPatch } from '../model/ops';
import type { AmbienceId, AssetMeta, CameraMode, LayerMode, Layout } from '../model/types';
import { getRoom, rooms } from '../rooms';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
/** Куда пишет репозиторий: 'local' — хранилища браузера; 'memory' — они недоступны, макеты живут до закрытия вкладки. */
export type StorageMode = 'local' | 'memory';
export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}
export interface DispatchOptions {
  /** Подпись шага в истории («Перемещение», «Размер»…). */
  label?: string;
  mergeKey?: string;
  /** По умолчанию 'local'. 'remote' — применить, не записывая в историю. */
  origin?: 'local' | 'remote';
  /** По умолчанию origin === 'local'. */
  record?: boolean;
}
export interface CommandMeta {
  layoutId: string;
  /** 'history' — команда применена через undo/redo. */
  origin: 'local' | 'remote' | 'history';
  /** Монотонный счётчик команд в этой вкладке. */
  seq: number;
  time: number;
}

export interface EditorState {
  // ---- документ ----
  /** Всегда равен layout.roomId. */
  roomId: string;
  layout: Layout;
  history: History;

  // ---- временное ----
  /** Живые значения перетаскиваемого объекта; не входят ни в макет, ни в историю. */
  draft: Readonly<Record<string, ObjectPatch>> | null;
  selectedId: string | null;
  hoveredId: string | null;
  /** true на время снимка: оверлеи редактора и маркеры ламп скрыты. */
  capturing: boolean;
  /** Камера выше потолка либо план (пишет ViewProbe из W2). */
  viewFromAbove: boolean;
  /** backSurfaces(…): id стен и граней колонн, на которые камера смотрит с изнанки (пишет ViewProbe из W2). */
  backSurfaceIds: readonly string[];
  saveStatus: SaveStatus;
  /** Ставит W4 один раз при старте; при 'memory' LayoutsMenu показывает постоянную метку «Не сохраняется». */
  storage: StorageMode;
  notice: Notice | null;
  /** Библиотека пользовательских файлов (W4 заполняет при старте, W3 — после загрузки/удаления). */
  assets: AssetMeta[];

  // ---- вид (не часть макета, не в истории) ----
  cameraMode: CameraMode;
  layer: LayerMode;
  gridSnap: boolean;
  showLabels: boolean;
  ambience: AmbienceId;

  // ---- команды ----
  /**
   * ЕДИНСТВЕННЫЙ способ изменить layout.objects / layout.name.
   * 1. isNoop → выход. 2. inverse = invertCommand(layout, cmd); layout = { ...applyCommand(layout, cmd), updatedAt: Date.now() }.
   * 3. draft: origin 'local' (и undo/redo) → draft = null; origin 'remote' → из draft убираются только id объектов,
   *    которых после команды больше нет (чужая правка не обрывает локальное перетаскивание; пустой draft → null).
   *    selectedId / hoveredId сбрасываются, если объекта больше нет.
   * 4. origin 'local' и record !== false → pushHistory({ label, redo: cmd, undo: inverse, mergeKey, time }).
   * 5. saveStatus = 'dirty'. 6. Слушатели subscribeCommands.
   */
  dispatch(cmd: Command, opts?: DispatchOptions): void;
  /** Ничего не делают в режиме прогулки и пока draft !== null. Слушатели получают origin 'history'. */
  undo(): void;
  redo(): void;
  setDraft(draft: Record<string, ObjectPatch> | null): void;
  /**
   * draft → ОДИН dispatch с label: для каждого id — cmdPatch(layout, id, draft[id], room, catalogLookup) (несколько id →
   * batch), затем draft = null. Сырой patch мимо cmdPatch не отправляется: результат перетаскивания проходит те же
   * проверки размера, крепления и I2/I5, что и правка из панели. Пустой draft или пустая команда → только draft = null.
   */
  commitDraft(label: string): void;

  // ---- выбор и вид ----
  select(id: string | null): void;
  setHovered(id: string | null): void;
  /** Вход в 'walk' сбрасывает draft, selectedId, hoveredId. */
  setCameraMode(mode: CameraMode): void;
  setLayer(layer: LayerMode): void;
  setViewFromAbove(above: boolean): void;
  /** Не меняет состояние (и не будит подписчиков), если список поэлементно равен текущему. */
  setBackSurfaces(ids: readonly string[]): void;
  setGridSnap(on: boolean): void;
  toggleLabels(): void;
  setAmbience(id: AmbienceId): void;
  setCapturing(on: boolean): void;
  setSaveStatus(status: SaveStatus): void;
  setStorageMode(mode: StorageMode): void;
  /** Показывает тост на 5 с (заменяет предыдущий); id назначается автоматически. Постоянных тостов нет — для них есть поля состояния (storage, saveStatus). */
  notify(level: Notice['level'], text: string): void;
  dismissNotice(): void;
  setAssets(assets: AssetMeta[]): void;
  /** Заменяет документ: roomId = layout.roomId, история, draft, выбор сбрасываются, saveStatus = 'saved'. В историю не пишется. */
  openLayout(layout: Layout): void;
}

/** Сколько живёт тост, мс. */
const NOTICE_MS = 5000;
/** Подпись шага истории, когда вызывающий её не дал. */
const DEFAULT_LABEL = 'Изменение';

type CommandListener = (cmd: Command, meta: CommandMeta) => void;
/** Обёртка на каждую подписку: одна и та же функция, подписанная дважды, отписывается независимо. */
const listeners = new Set<{ listener: CommandListener }>();
let commandSeq = 0;
let noticeSeq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Шаг 6 dispatch: оповещает подписчиков. Ошибка одного слушателя не мешает остальным и не ломает команду. */
function emit(cmd: Command, layoutId: string, origin: CommandMeta['origin']): void {
  const meta: CommandMeta = { layoutId, origin, seq: ++commandSeq, time: Date.now() };
  for (const entry of [...listeners]) {
    try {
      entry.listener(cmd, meta);
    } catch (error) {
      console.error('Слушатель команд завершился с ошибкой', error);
    }
  }
}

interface Applied {
  /** Макет после команды (с новым updatedAt). */
  next: Layout;
  /** Обратная команда относительно макета ДО применения. */
  inverse: Command;
  draft: EditorState['draft'];
  selectedId: string | null;
  hoveredId: string | null;
}

/**
 * Шаги 1–3 dispatch — чистый расчёт без записи в стор (присваивают результат только dispatch, undo и redo).
 * null — команда ничего не меняет.
 */
function applyTo(state: EditorState, cmd: Command, origin: CommandMeta['origin']): Applied | null {
  if (isNoop(state.layout, cmd)) return null;
  const inverse = invertCommand(state.layout, cmd);
  const next: Layout = { ...applyCommand(state.layout, cmd), updatedAt: Date.now() };
  const alive = new Set(next.objects.map((o) => o.id));

  let draft = state.draft;
  if (origin !== 'remote') {
    draft = null;
  } else if (draft !== null) {
    // Чужая правка не обрывает локальное перетаскивание: из draft уходят только исчезнувшие объекты.
    const kept = Object.keys(draft).filter((id) => alive.has(id));
    if (kept.length === 0) {
      draft = null;
    } else if (kept.length !== Object.keys(draft).length) {
      const source = draft;
      draft = Object.fromEntries(kept.map((id) => [id, source[id]]));
    }
  }

  return {
    next,
    inverse,
    draft,
    selectedId: state.selectedId !== null && alive.has(state.selectedId) ? state.selectedId : null,
    hoveredId: state.hoveredId !== null && alive.has(state.hoveredId) ? state.hoveredId : null,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function clearNoticeTimer(): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  noticeTimer = undefined;
}

const initialLayout = createLayout(rooms[0]);

export const useEditor: UseBoundStore<StoreApi<EditorState>> = create<EditorState>()((set, get) => ({
  roomId: initialLayout.roomId,
  layout: initialLayout,
  history: EMPTY_HISTORY,

  draft: null,
  selectedId: null,
  hoveredId: null,
  capturing: false,
  viewFromAbove: true,
  backSurfaceIds: [],
  saveStatus: 'saved',
  storage: 'local',
  notice: null,
  assets: [],

  cameraMode: 'orbit',
  layer: 'auto',
  gridSnap: true,
  showLabels: true,
  ambience: 'work',

  dispatch(cmd, opts) {
    const state = get();
    const origin = opts?.origin ?? 'local';
    const applied = applyTo(state, cmd, origin);
    if (!applied) return;
    const record = origin === 'local' && opts?.record !== false;
    set({
      layout: applied.next,
      history: record
        ? pushHistory(state.history, {
            label: opts?.label ?? DEFAULT_LABEL,
            redo: cmd,
            undo: applied.inverse,
            mergeKey: opts?.mergeKey,
            time: Date.now(),
          })
        : state.history,
      draft: applied.draft,
      selectedId: applied.selectedId,
      hoveredId: applied.hoveredId,
      saveStatus: 'dirty',
    });
    emit(cmd, applied.next.id, origin);
  },

  undo() {
    const state = get();
    if (state.cameraMode === 'walk' || state.draft !== null) return;
    const step = undoStep(state.history);
    if (!step) return;
    const applied = applyTo(state, step.command, 'history');
    if (!applied) {
      // Шаг уже ничего не меняет (например, объект удалён чужой правкой): он просто переходит в future.
      set({ history: step.history });
      return;
    }
    set({
      layout: applied.next,
      history: step.history,
      draft: applied.draft,
      selectedId: applied.selectedId,
      hoveredId: applied.hoveredId,
      saveStatus: 'dirty',
    });
    emit(step.command, applied.next.id, 'history');
  },

  redo() {
    const state = get();
    if (state.cameraMode === 'walk' || state.draft !== null) return;
    const step = redoStep(state.history);
    if (!step) return;
    const applied = applyTo(state, step.command, 'history');
    if (!applied) {
      set({ history: step.history });
      return;
    }
    set({
      layout: applied.next,
      history: step.history,
      draft: applied.draft,
      selectedId: applied.selectedId,
      hoveredId: applied.hoveredId,
      saveStatus: 'dirty',
    });
    emit(step.command, applied.next.id, 'history');
  },

  setDraft(draft) {
    if (draft === get().draft) return;
    set({ draft });
  },

  commitDraft(label) {
    const state = get();
    const draft = state.draft;
    if (draft === null) return;
    const room = getRoom(state.roomId);
    // Каждый следующий патч строится относительно макета ПОСЛЕ предыдущих — так же, как batch будет применён.
    const commands: Command[] = [];
    let current = state.layout;
    for (const id of Object.keys(draft)) {
      const cmd = cmdPatch(current, id, draft[id], room, catalogLookup);
      const after = applyCommand(current, cmd);
      if (after === current) continue;
      commands.push(cmd);
      current = after;
    }
    if (commands.length === 0) {
      set({ draft: null });
      return;
    }
    // dispatch с origin 'local' сам сбрасывает draft.
    state.dispatch(commands.length === 1 ? commands[0] : { type: 'batch', commands }, { label });
  },

  select(id) {
    if (id === get().selectedId) return;
    set({ selectedId: id });
  },

  setHovered(id) {
    if (id === get().hoveredId) return;
    set({ hoveredId: id });
  },

  setCameraMode(mode) {
    if (mode === get().cameraMode) return;
    set(mode === 'walk' ? { cameraMode: mode, draft: null, selectedId: null, hoveredId: null } : { cameraMode: mode });
  },

  setLayer(layer) {
    if (layer === get().layer) return;
    set({ layer });
  },

  setViewFromAbove(above) {
    if (above === get().viewFromAbove) return;
    set({ viewFromAbove: above });
  },

  setBackSurfaces(ids) {
    if (sameList(ids, get().backSurfaceIds)) return;
    set({ backSurfaceIds: [...ids] });
  },

  setGridSnap(on) {
    if (on === get().gridSnap) return;
    set({ gridSnap: on });
  },

  toggleLabels() {
    set((s) => ({ showLabels: !s.showLabels }));
  },

  setAmbience(id) {
    if (id === get().ambience) return;
    set({ ambience: id });
  },

  setCapturing(on) {
    if (on === get().capturing) return;
    set({ capturing: on });
  },

  setSaveStatus(status) {
    if (status === get().saveStatus) return;
    set({ saveStatus: status });
  },

  setStorageMode(mode) {
    if (mode === get().storage) return;
    set({ storage: mode });
  },

  notify(level, text) {
    const id = ++noticeSeq;
    clearNoticeTimer();
    set({ notice: { id, level, text } });
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      if (get().notice?.id === id) set({ notice: null });
    }, NOTICE_MS);
    // В Node (vitest) таймер не должен удерживать процесс; в браузере setTimeout возвращает число.
    const timer: unknown = noticeTimer;
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) (timer as { unref(): void }).unref();
  },

  dismissNotice() {
    clearNoticeTimer();
    if (get().notice !== null) set({ notice: null });
  },

  setAssets(assets) {
    set({ assets });
  },

  openLayout(layout) {
    set({
      roomId: layout.roomId,
      layout,
      history: EMPTY_HISTORY,
      draft: null,
      selectedId: null,
      hoveredId: null,
      saveStatus: 'saved',
    });
  },
}));

/** Шов автосохранения и realtime: вызывается после каждой применённой команды (local, remote, history). Возвращает отписку. */
export function subscribeCommands(listener: (cmd: Command, meta: CommandMeta) => void): () => void {
  const entry = { listener };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
