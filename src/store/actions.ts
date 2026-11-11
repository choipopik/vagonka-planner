// Высокоуровневые действия; панели и горячие клавиши вызывают ТОЛЬКО их. Каждое — один dispatch, один шаг undo.
// Все — no-op при !canEdit().
import { catalogLookup, isSupport } from '../catalog';
import type { CatalogItem } from '../catalog/types';
import { isNoop } from '../model/commands';
import type { ObjectPatch } from '../model/commands';
import { activeLightIds, reservedLights } from '../model/lights';
import { LAYOUT_LIMITS } from '../model/migrate';
import { MAX_SIZE, MIN_SIZE, cmdDuplicate, cmdPatch, cmdRemove, cmdResetVenue, cmdSetMount, createObject } from '../model/ops';
import type { ObjectInit } from '../model/ops';
import { placeNew } from '../model/place';
import { GRID_STEP } from '../model/pose';
import type { MountKind, Vec3 } from '../model/types';
import { getRoom } from '../rooms';
import { viewportBridge } from './bridge';
import { useEditor } from './editorStore';
import { canEdit, getContext, getObjects } from './selectors';

/** Макет, в котором объектов больше предела, parseLayout при следующей загрузке отверг бы целиком. */
function hasRoomFor(extra: number): boolean {
  const state = useEditor.getState();
  if (state.layout.objects.length + extra <= LAYOUT_LIMITS.objects) return true;
  state.notify('warn', `В макете не может быть больше ${LAYOUT_LIMITS.objects} объектов`);
  return false;
}

/** Размер нового объекта в пределах I4: сторона «не число» или ≤ 0 берётся из записи каталога, остальные зажимаются. */
function initialSize(item: CatalogItem, size: Vec3 | undefined): Vec3 {
  if (!size) return item.size;
  const side = (i: 0 | 1 | 2) => {
    const v = size[i];
    return Number.isFinite(v) && v > 0 ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : item.size[i];
  };
  return [side(0), side(1), side(2)];
}

/**
 * Создаёт объект: size = init.size ?? item.size; mount = placeNew(item, size, viewportBridge()?.centerRay() ?? null, …,
 * gridSnap ? GRID_STEP : null); dispatch add («Добавить: ‹title›»); select(новый id). Возвращает id.
 * Если это лампа и она оказалась за пределом activeLightIds — notify('warn', 'Активны только первые 12 источников света').
 * Сверх спецификации: init.size приводится к I4 (MIN_SIZE…MAX_SIZE, конечные числа) ДО размещения — очень вытянутая
 * картинка ([1, 1·h/w, 0.02] при h/w < 0.01) иначе нарушила бы I4, а при следующей загрузке объект пропал бы.
 */
export function addObject(item: CatalogItem, init?: ObjectInit): string | null {
  if (!canEdit() || !hasRoomFor(1)) return null;
  const size = initialSize(item, init?.size);
  const ray = viewportBridge()?.centerRay() ?? null;
  const grid = useEditor.getState().gridSnap ? GRID_STEP : null;
  const mount = placeNew(item, size, ray, getContext(), isSupport, grid);
  const object = createObject(item, mount, init?.size ? { ...init, size } : init);

  useEditor.getState().dispatch({ type: 'add', items: [{ object }] }, { label: `Добавить: ${item.title}` });
  const state = useEditor.getState();
  if (!state.layout.objects.some((o) => o.id === object.id)) return null;
  state.select(object.id);

  if (item.kind === 'light') {
    const reserved = reservedLights(getRoom(state.roomId), state.ambience, state.cameraMode);
    if (!activeLightIds(getObjects(), reserved).has(object.id)) {
      state.notify('warn', 'Активны только первые 12 источников света');
    }
  }
  return object.id;
}

/**
 * Патч одного объекта: dispatch(cmdPatch(layout, id, set, room, catalogLookup), { label, mergeKey }). Вся проверка —
 * в cmdPatch (2.10): clampSize для size, clampMount для крепления, заблокированный объект принимает только
 * { locked } и { visible }, скрытие хозяина сначала опускает его детей на пол. Пустая команда не отправляется.
 */
export function patchObject(id: string, set: ObjectPatch, label: string, mergeKey?: string): void {
  if (!canEdit()) return;
  const state = useEditor.getState();
  const cmd = cmdPatch(state.layout, id, set, getRoom(state.roomId), catalogLookup);
  if (isNoop(state.layout, cmd)) return;
  state.dispatch(cmd, { label, mergeKey });
}

/** dispatch(cmdSetMount(layout, id, to, room, catalogLookup)). */
export function setObjectMount(id: string, to: MountKind): void {
  if (!canEdit()) return;
  const state = useEditor.getState();
  const cmd = cmdSetMount(state.layout, id, to, getRoom(state.roomId), catalogLookup);
  if (isNoop(state.layout, cmd)) return;
  state.dispatch(cmd, { label: 'Крепление' });
}

export function deleteObject(id: string): void {
  if (!canEdit()) return;
  const state = useEditor.getState();
  const cmd = cmdRemove(state.layout, [id], getRoom(state.roomId));
  if (isNoop(state.layout, cmd)) return;
  state.dispatch(cmd, { label: 'Удалить' });
}

/** Выбирает копию; возвращает её id. */
export function duplicateObject(id: string): string | null {
  if (!canEdit() || !hasRoomFor(1)) return null;
  const state = useEditor.getState();
  const { command, newIds } = cmdDuplicate(state.layout, [id], getRoom(state.roomId));
  if (newIds.length === 0 || isNoop(state.layout, command)) return null;
  state.dispatch(command, { label: 'Дублировать' });
  const copyId = newIds[0];
  const after = useEditor.getState();
  if (!after.layout.objects.some((o) => o.id === copyId)) return null;
  after.select(copyId);
  return copyId;
}

export function resetFurniture(): void {
  if (!canEdit()) return;
  const state = useEditor.getState();
  const cmd = cmdResetVenue(state.layout, getRoom(state.roomId));
  if (isNoop(state.layout, cmd)) return;
  state.dispatch(cmd, { label: 'Сбросить мебель' });
}
