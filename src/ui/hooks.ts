// Общие хуки панелей. Все селекторы возвращают стабильные ссылки (zustand v5 перерисовывает по Object.is).
import { venueDirty } from '../model/ops';
import type { SceneContext } from '../model/pose';
import type { RoomDef, SceneObject } from '../model/types';
import { getRoom } from '../rooms';
import { useEditor } from '../store/editorStore';
import type { EditorState } from '../store/editorStore';
import { getContext, getObjects } from '../store/selectors';
import { stableObjectList } from './lists';
import type { ObjectListModel } from './lists';

// Селекторы объявлены на уровне модуля: ссылка на функцию постоянна, подписка не пересоздаётся на каждый рендер.

/** getContext() мемоизирован в selectors.ts по (room, layout.objects, draft). */
function selectContext(): SceneContext {
  return getContext();
}

function selectObjectList(): ObjectListModel {
  return stableObjectList(getObjects());
}

let dirtyFor: { objects: readonly SceneObject[]; room: RoomDef; value: boolean } | undefined;

/** venueDirty зависит только от layout.objects и помещения — пересчитывается лишь при их смене. */
function selectVenueDirty(state: EditorState): boolean {
  const room = getRoom(state.roomId);
  const objects = state.layout.objects;
  if (dirtyFor && dirtyFor.objects === objects && dirtyFor.room === room) return dirtyFor.value;
  const value = venueDirty(state.layout, room);
  dirtyFor = { objects, room, value };
  return value;
}

/** Контекст сцены с учётом draft: позы хозяев, поверхности, помещение. Меняется при любой правке объектов. */
export function useSceneContext(): SceneContext {
  return useEditor(selectContext);
}

/** Строки списка объектов (с учётом draft); ссылки на группы стабильны, пока не изменилась структура. */
export function useObjectListModel(): ObjectListModel {
  return useEditor(selectObjectList);
}

/** Мебель площадки отличается от исходной расстановки (включает «Сбросить мебель»). */
export function useVenueDirty(): boolean {
  return useEditor(selectVenueDirty);
}
