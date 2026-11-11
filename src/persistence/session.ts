// Сессия редактора: настройки, библиотека файлов, именованные макеты по помещениям, автосохранение, экспорт / импорт.
// Путь загрузки любого макета: repository.load → reconcileVenue → sanitizeLayout → openLayout. Нечитаемый макет
// пропускается и НИКОГДА не удаляется автоматически.
import { ASSET_LIMITS, assetIdsOf } from '../model/assets';
import { createLayout, newId } from '../model/layout';
import { LAYOUT_LIMITS, LayoutFormatError } from '../model/migrate';
import { reconcileVenue, sanitizeLayout } from '../model/ops';
import type { Layout, RoomDef } from '../model/types';
import { rooms } from '../rooms';
import { useEditor } from '../store/editorStore';
import { saveErrorText, saveNow, startAutosave } from './autosave';
import { MEMORY_STORAGE_TEXT, repository, settingsStore, storageMode } from './index';
import { buildLayoutFile, layoutFileName, readLayoutFile } from './layoutFile';
import { readPrefs, writePrefs } from './prefs';
import type { Prefs } from './prefs';
import { RepositoryError } from './repository';
import type { LayoutMeta } from './repository';

/** Сколько старт сессии ждёт библиотеку файлов, прежде чем открыть макет без неё (IndexedDB может «зависнуть»). */
const ASSETS_WAIT_MS = 3000;
/** Через сколько освобождается ссылка на скачанный файл. */
const REVOKE_DELAY_MS = 60_000;
const MEGABYTE = 1_048_576;

const UNSAVED_TEXT =
  'Текущий макет не удалось сохранить, поэтому он остаётся открытым. Экспортируйте его в файл или удалите лишние макеты';

// ---------- Внутреннее состояние ----------

let prefs: Prefs | null = null;
let session: Promise<void> | null = null;
let cleanups: (() => void)[] = [];
/** Операции сессии идут строго по очереди: быстрые щелчки в меню не переплетают загрузку и сохранение. */
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Ошибка операции меню не выходит наружу: пользователь видит тост, вызывающий — выполненный промис. */
async function guarded(failText: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(error);
    useEditor.getState().notify('error', failText);
  }
}

function getPrefs(): Prefs {
  prefs ??= readPrefs(settingsStore);
  return prefs;
}

function findRoom(id: string): RoomDef | undefined {
  return rooms.find((r) => r.id === id);
}

function currentRoom(): RoomDef {
  return findRoom(useEditor.getState().roomId) ?? rooms[0];
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, LAYOUT_LIMITS.name);
}

/** «Макет N» с наименьшим свободным N. */
function nextLayoutName(taken: readonly string[]): string {
  const names = new Set(taken);
  for (let n = 1; ; n++) {
    const name = `Макет ${n}`;
    if (!names.has(name)) return name;
  }
}

function freshLayoutId(taken: ReadonlySet<string>): string {
  let id = newId('layout');
  while (taken.has(id)) id = newId('layout');
  return id;
}

/** Запоминает вид, помещение и открытый в нём макет. Пишет только при отличии от записанного. */
function rememberView(): void {
  const state = useEditor.getState();
  const current = getPrefs();
  const same =
    current.roomId === state.roomId &&
    current.lastLayoutByRoom[state.roomId] === state.layout.id &&
    current.showLabels === state.showLabels &&
    current.gridSnap === state.gridSnap &&
    current.ambience === state.ambience &&
    current.layer === state.layer;
  if (same) return;
  prefs = {
    roomId: state.roomId,
    lastLayoutByRoom: { ...current.lastLayoutByRoom, [state.roomId]: state.layout.id },
    showLabels: state.showLabels,
    gridSnap: state.gridSnap,
    ambience: state.ambience,
    layer: state.layer,
  };
  writePrefs(settingsStore, prefs);
}

/** Удалённый макет больше не «последний» ни в одном помещении. */
function forgetLayout(id: string): void {
  const current = getPrefs();
  const kept = Object.entries(current.lastLayoutByRoom).filter(([, layoutId]) => layoutId !== id);
  if (kept.length === Object.keys(current.lastLayoutByRoom).length) return;
  prefs = { ...current, lastLayoutByRoom: Object.fromEntries(kept) };
  writePrefs(settingsStore, prefs);
}

/** Библиотека файлов → стор. Не бросает: без библиотеки макет всё равно открывается (объекты — заглушками). */
async function refreshAssets(): Promise<void> {
  try {
    useEditor.getState().setAssets(await repository.listAssets());
  } catch (error) {
    console.error(error);
    useEditor.getState().notify('warn', 'Не удалось прочитать библиотеку файлов: картинки и модели могут не отображаться');
  }
}

/** Ждёт task не дольше ms; сама задача продолжается и после этого. */
async function waitAtMost(task: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([task, timeout]);
  if (timer !== undefined) clearTimeout(timer);
}

/** repository.load → reconcileVenue → sanitizeLayout. null — макета нет, он не читается или его помещения больше нет. */
async function loadReady(id: string): Promise<Layout | null> {
  let stored: Layout | null;
  try {
    stored = await repository.load(id);
  } catch (error) {
    console.warn(`Макет ${id} не читается и пропущен (запись не удалена)`, error);
    return null;
  }
  if (!stored) return null;
  const room = findRoom(stored.roomId);
  if (!room) return null;
  return sanitizeLayout(reconcileVenue(stored, room), room);
}

/**
 * Сохраняет новый макет и делает его текущим. Если места нет — макет всё равно открывается (сессия продолжает
 * работать в памяти) со статусом 'error'; следующая правка повторит сохранение.
 */
async function adopt(layout: Layout): Promise<void> {
  let failure: unknown;
  let saved = true;
  try {
    await repository.save(layout);
  } catch (error) {
    saved = false;
    failure = error;
  }
  const state = useEditor.getState();
  state.openLayout(layout);
  if (!saved) {
    state.setSaveStatus('error');
    state.notify('error', saveErrorText(failure));
  }
}

/** Перед уходом с текущего макета: сохранить несохранённое. false — не вышло, макет остаётся открытым (правки целы). */
async function leaveCurrent(): Promise<boolean> {
  if (await saveNow(repository)) return true;
  useEditor.getState().notify('error', UNSAVED_TEXT);
  return false;
}

/** Последний макет помещения → иначе самый новый читаемый → иначе создать и сохранить «Макет N». */
async function openRoom(room: RoomDef): Promise<void> {
  const metas = await repository.list(room.id);
  const candidates: string[] = [];
  const last = getPrefs().lastLayoutByRoom[room.id];
  if (last !== undefined) candidates.push(last);
  for (const meta of metas) if (!candidates.includes(meta.id)) candidates.push(meta.id);

  for (const id of candidates) {
    const layout = await loadReady(id);
    if (layout && layout.roomId === room.id) {
      useEditor.getState().openLayout(layout);
      return;
    }
  }
  await adopt(createLayout(room, nextLayoutName(metas.map((m) => m.name))));
}

// ---------- Старт ----------

async function runSession(): Promise<void> {
  const store = useEditor.getState();
  store.setStorageMode(storageMode);
  // Тост исчезнет через 5 с; постоянный признак — метка «Не сохраняется» в LayoutsMenu (по полю storage).
  if (storageMode === 'memory') store.notify('warn', MEMORY_STORAGE_TEXT);

  // Настройки вида → стор.
  const saved = getPrefs();
  if (store.showLabels !== saved.showLabels) store.toggleLabels();
  store.setGridSnap(saved.gridSnap);
  store.setAmbience(saved.ambience);
  store.setLayer(saved.layer);

  await waitAtMost(refreshAssets(), ASSETS_WAIT_MS);

  const room = (saved.roomId !== null ? findRoom(saved.roomId) : undefined) ?? currentRoom();
  if (useEditor.getState().saveStatus !== 'saved') {
    // Первый рендер сессию не ждёт: если макет по умолчанию уже успели изменить, правки не выбрасываются —
    // он сохраняется как новый макет и остаётся открытым (сохранённые макеты доступны из меню).
    await saveNow(repository);
  } else {
    try {
      await openRoom(room);
    } catch (error) {
      // Остаётся макет по умолчанию; автосохранение всё равно включается, чтобы работа не пропала.
      console.error(error);
      useEditor.getState().notify('error', 'Не удалось открыть сохранённые макеты');
    }
  }

  cleanups.push(startAutosave(repository));

  rememberView();
  cleanups.push(useEditor.subscribe(rememberView));

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const onPageHide = () => {
      void flushSave();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushSave();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }
}

/** Читает настройки, библиотеку файлов, открывает последний макет последнего помещения (или создаёт «Макет 1»), включает автосохранение. Идемпотентна (StrictMode). */
export function startSession(): Promise<void> {
  session ??= serial(runSession);
  return session;
}

/**
 * Обратное к startSession: снимает автосохранение, подписку на стор и слушатели окна. Сверх спецификации —
 * нужно тестам пакета (сессия — синглтон модуля); приложение её не вызывает.
 */
export function stopSession(): void {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  session = null;
  prefs = null;
}

// ---------- Макеты ----------

/** Сохраняет текущий макет и открывает последний макет помещения (или создаёт). */
export function switchRoom(roomId: string): Promise<void> {
  return serial(() =>
    guarded('Не удалось открыть помещение', async () => {
      const room = findRoom(roomId);
      if (!room) return;
      if (useEditor.getState().roomId === room.id) {
        await saveNow(repository);
        return;
      }
      if (!(await leaveCurrent())) return;
      await openRoom(room);
    }),
  );
}

/** Макеты текущего помещения, новые первыми. Текущий макет берётся из стора (его имя и время свежее записи). */
export async function listLayouts(): Promise<LayoutMeta[]> {
  const { layout, roomId } = useEditor.getState();
  let metas: LayoutMeta[] = [];
  try {
    metas = await repository.list(roomId);
  } catch (error) {
    console.error(error);
  }
  const current: LayoutMeta = { id: layout.id, name: layout.name, roomId: layout.roomId, updatedAt: layout.updatedAt };
  return [current, ...metas.filter((m) => m.id !== layout.id)].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function openLayoutById(id: string): Promise<void> {
  return serial(() =>
    guarded('Не удалось открыть макет', async () => {
      if (useEditor.getState().layout.id === id) return;
      const layout = await loadReady(id);
      if (!layout) {
        useEditor.getState().notify('error', 'Макет не читается и не открыт. Запись не удалена');
        return;
      }
      if (!(await leaveCurrent())) return;
      useEditor.getState().openLayout(layout);
    }),
  );
}

/** Пустое имя → «Макет N». */
export function createNamedLayout(name: string): Promise<void> {
  return serial(() =>
    guarded('Не удалось создать макет', async () => {
      if (!(await leaveCurrent())) return;
      const room = currentRoom();
      const metas = await repository.list(room.id);
      await adopt(createLayout(room, cleanName(name) || nextLayoutName(metas.map((m) => m.name))));
    }),
  );
}

/** «Сохранить как…»: копия становится текущей. */
export function duplicateCurrentLayout(name: string): Promise<void> {
  return serial(() =>
    guarded('Не удалось сохранить копию макета', async () => {
      if (!(await leaveCurrent())) return;
      const source = useEditor.getState().layout;
      const taken = new Set((await repository.list()).map((m) => m.id));
      taken.add(source.id);
      const copy: Layout = {
        ...structuredClone(source),
        id: freshLayoutId(taken),
        name: cleanName(name) || cleanName(`${source.name} — копия`),
        updatedAt: Date.now(),
      };
      await adopt(copy);
    }),
  );
}

/** dispatch({ type: 'rename', name }). Пустое имя игнорируется. */
export function renameCurrentLayout(name: string): void {
  const clean = cleanName(name);
  if (!clean) return;
  useEditor.getState().dispatch({ type: 'rename', name: clean }, { label: 'Переименовать макет' });
}

/** Удаляет; если это текущий — открывает следующий по новизне или создаёт новый. */
export function deleteLayout(id: string): Promise<void> {
  return serial(() =>
    guarded('Не удалось удалить макет', async () => {
      const state = useEditor.getState();
      const isCurrent = state.layout.id === id;
      const statusBefore = state.saveStatus;
      // Несохранённые правки удаляемого макета не нужны: иначе ожидающее автосохранение вернуло бы запись.
      if (isCurrent) state.setSaveStatus('saved');
      try {
        await repository.remove(id);
      } catch (error) {
        if (isCurrent && useEditor.getState().layout.id === id) useEditor.getState().setSaveStatus(statusBefore);
        throw error;
      }
      forgetLayout(id);
      if (isCurrent) await openRoom(currentRoom());
    }),
  );
}

// ---------- Экспорт и импорт ----------

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Сразу отзывать нельзя: часть браузеров начинает скачивание после возврата из обработчика.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Сохраняет, собирает файл и запускает скачивание `<room>-<имя>-<yyyy-mm-dd>.vagonka.json`. */
export function exportCurrentLayout(): Promise<void> {
  return guarded('Не удалось собрать файл макета', async () => {
    // Неудачное сохранение экспорту не мешает: файл — как раз способ унести работу, когда места нет.
    await flushSave();
    const layout = useEditor.getState().layout;
    const file = await buildLayoutFile(layout, repository);
    downloadBlob(
      new Blob([JSON.stringify(file)], { type: 'application/json' }),
      layoutFileName(layout.roomId, layout.name, new Date()),
    );
    const missing = assetIdsOf(layout.objects).size - file.assets.length;
    if (missing > 0) {
      useEditor.getState().notify('warn', `В файл не попали картинки или модели (${missing}): их нет в библиотеке файлов`);
    }
  });
}

function importErrorText(error: unknown): string {
  if (error instanceof LayoutFormatError) return `Импорт не выполнен: ${error.message}`;
  if (error instanceof RepositoryError) {
    return error.code === 'quota'
      ? 'Импорт не выполнен: в хранилище браузера мало места'
      : 'Импорт не выполнен: хранилище браузера недоступно';
  }
  return 'Импорт не выполнен: файл не удалось прочитать';
}

/** Не больше трёх замечаний в одном тосте. */
function warningsText(warnings: readonly string[]): string {
  const shown = warnings.slice(0, 3).join('; ');
  return warnings.length > 3 ? `${shown}; и ещё замечаний: ${warnings.length - 3}` : shown;
}

/** Импортирует как НОВЫЙ макет, обновляет библиотеку файлов, открывает его (переключая помещение). Ошибки — notify. */
export function importLayoutFile(file: File): Promise<void> {
  return serial(() =>
    guarded('Импорт не выполнен: файл не удалось прочитать', async () => {
      const notify = useEditor.getState().notify;
      // Слишком большой файл отклоняется до чтения.
      if (file.size > ASSET_LIMITS.importFileBytes) {
        notify('error', `Импорт не выполнен: файл больше ${Math.round(ASSET_LIMITS.importFileBytes / MEGABYTE)} МБ`);
        return;
      }
      const text = await file.text();
      let result;
      try {
        result = await readLayoutFile(
          text,
          repository,
          rooms.map((r) => r.id),
        );
      } catch (error) {
        console.error(error);
        // Часть вложенных файлов могла успеть попасть в библиотеку.
        await refreshAssets();
        notify('error', importErrorText(error));
        return;
      }
      await refreshAssets();

      const name = result.layout.name;
      if (!(await saveNow(repository))) {
        notify('warn', `Макет «${name}» импортирован и есть в списке, но текущий макет не сохранён и остаётся открытым`);
        return;
      }
      useEditor.getState().openLayout(result.layout);
      if (result.warnings.length > 0) notify('warn', `Макет «${name}» импортирован с замечаниями: ${warningsText(result.warnings)}`);
      else notify('info', `Макет «${name}» импортирован`);
    }),
  );
}

// ---------- Файлы и сохранение ----------

/** Названия сохранённых макетов (и текущего), в которых используется файл. */
export async function assetUsage(assetId: string): Promise<string[]> {
  const current = useEditor.getState().layout;
  const names: string[] = [];
  if (assetIdsOf(current.objects).has(assetId)) names.push(current.name);
  // Все помещения: файл общий для всей библиотеки.
  for (const meta of await repository.list()) {
    // Текущий макет уже учтён по состоянию стора — оно свежее записи.
    if (meta.id === current.id) continue;
    try {
      const layout = await repository.load(meta.id);
      if (layout && assetIdsOf(layout.objects).has(assetId)) names.push(layout.name);
    } catch {
      // Нечитаемый макет открыть нельзя — файлом он не пользуется.
    }
  }
  return names;
}

/** Немедленно сохранить, если есть несохранённое. Запись идёт синхронно, до возврата из вызова (pagehide). */
export function flushSave(): Promise<void> {
  return saveNow(repository).then(() => undefined);
}
