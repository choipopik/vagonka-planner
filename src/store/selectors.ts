// Рендереры и панели читают объекты ТОЛЬКО отсюда (значения уже слиты с draft).
import { applyPatch } from '../model/commands';
import type { ObjectPatch } from '../model/commands';
import { isGhosted, layerView } from '../model/layers';
import type { LayerView } from '../model/layers';
import { activeLightIds, reservedLights } from '../model/lights';
import { makeContext, resolvePose } from '../model/pose';
import type { Pose, SceneContext } from '../model/pose';
import type { RoomDef, SceneObject } from '../model/types';
import { getRoom } from '../rooms';
import { useEditor } from './editorStore';
import type { EditorState } from './editorStore';

type Draft = EditorState['draft'];

// ---------- Слияние с draft (всё мемоизировано по ссылкам: селекторы обязаны быть стабильными для zustand v5) ----------

function patchFor(draft: Draft, id: string): ObjectPatch | undefined {
  return draft !== null && Object.prototype.hasOwnProperty.call(draft, id) ? draft[id] : undefined;
}

const mergeCache = new WeakMap<SceneObject, { patch: ObjectPatch; result: SceneObject }>();

/** Объект с применённым патчем; результат кэшируется по паре ссылок (object, patch). */
function withDraft(o: SceneObject, patch: ObjectPatch | undefined): SceneObject {
  if (!patch) return o;
  const hit = mergeCache.get(o);
  if (hit && hit.patch === patch) return hit.result;
  const result = applyPatch(o, patch);
  mergeCache.set(o, { patch, result });
  return result;
}

let mergedFor: { objects: readonly SceneObject[]; draft: Draft; result: readonly SceneObject[] } | undefined;

/** Все объекты макета с применённым draft; без draft — сам массив макета. */
function mergedObjects(objects: readonly SceneObject[], draft: Draft): readonly SceneObject[] {
  if (draft === null) return objects;
  if (mergedFor && mergedFor.objects === objects && mergedFor.draft === draft) return mergedFor.result;
  let changed = false;
  const merged = objects.map((o) => {
    const m = withDraft(o, patchFor(draft, o.id));
    if (m !== o) changed = true;
    return m;
  });
  const result = changed ? merged : objects;
  mergedFor = { objects, draft, result };
  return result;
}

let contextFor: { room: RoomDef; objects: readonly SceneObject[]; ctx: SceneContext } | undefined;

/** makeContext(room, объекты с draft); мемоизация по (room, layout.objects, draft). */
function contextOf(state: EditorState): SceneContext {
  const room = getRoom(state.roomId);
  const objects = mergedObjects(state.layout.objects, state.draft);
  if (contextFor && contextFor.room === room && contextFor.objects === objects) return contextFor.ctx;
  const ctx = makeContext(room, objects);
  contextFor = { room, objects, ctx };
  return ctx;
}

// ---------- Стабильные производные значения ----------

let idsFor: readonly SceneObject[] | undefined;
let idsList: string[] = [];

function idsOf(objects: readonly SceneObject[]): string[] {
  if (objects === idsFor) return idsList;
  idsFor = objects;
  let same = objects.length === idsList.length;
  for (let i = 0; same && i < objects.length; i++) same = objects[i].id === idsList[i];
  if (!same) idsList = objects.map((o) => o.id);
  return idsList;
}

/** Равенство чисел, при котором NaN равен NaN (иначе битая поза давала бы новую ссылку на каждый вызов селектора). */
function sameNumber(a: number, b: number): boolean {
  return a === b || (a !== a && b !== b);
}

const POSE_CACHE_LIMIT = 4096;
const poseCache = new Map<string, Pose>();

/** Мировая поза объекта (с draft); ссылка не меняется, пока числа равны. */
function poseOf(state: EditorState, id: string): Pose | undefined {
  const ctx = contextOf(state);
  const o = ctx.get(id);
  if (!o) return undefined;
  const pose = resolvePose(o, ctx);
  const prev = poseCache.get(id);
  if (
    prev &&
    sameNumber(prev.rotationY, pose.rotationY) &&
    sameNumber(prev.position[0], pose.position[0]) &&
    sameNumber(prev.position[1], pose.position[1]) &&
    sameNumber(prev.position[2], pose.position[2])
  ) {
    return prev;
  }
  // Записи удалённых объектов не чистятся по одной; кэш просто сбрасывается, если разросся.
  if (poseCache.size >= POSE_CACHE_LIMIT) poseCache.clear();
  poseCache.set(id, pose);
  return pose;
}

let lightsFor: { objects: readonly SceneObject[]; reserved: number } | undefined;
let lightsSet: ReadonlySet<string> = new Set<string>();

function activeLightsOf(state: EditorState): ReadonlySet<string> {
  const objects = mergedObjects(state.layout.objects, state.draft);
  const reserved = reservedLights(getRoom(state.roomId), state.ambience, state.cameraMode);
  if (lightsFor && lightsFor.objects === objects && lightsFor.reserved === reserved) return lightsSet;
  lightsFor = { objects, reserved };
  const next = activeLightIds(objects, reserved);
  // Тот же состав → прежняя ссылка: перетаскивание любого объекта не перерисовывает все лампы.
  let same = next.size === lightsSet.size;
  if (same) for (const id of next) if (!lightsSet.has(id)) same = false;
  if (!same) lightsSet = next;
  return lightsSet;
}

function layerViewOf(state: EditorState): LayerView {
  return layerView(state.layer, state.cameraMode, state.viewFromAbove);
}

// ---------- Хуки ----------

/** Объект с применённым draft. Результат кэшируется по паре ссылок (object, patch) — селектор стабилен для zustand v5. */
export function useObject(id: string): SceneObject | undefined {
  return useEditor((s) => contextOf(s).get(id));
}

/** Стабильный массив id (меняется только при add / remove / перестановке). */
export function useObjectIds(): string[] {
  return useEditor((s) => idsOf(s.layout.objects));
}

/** Мировая поза с учётом draft объекта и его хозяина; ссылка стабильна, пока числа равны. */
export function usePose(id: string): Pose | undefined {
  return useEditor((s) => poseOf(s, id));
}

export function useSelected(): SceneObject | undefined {
  return useEditor((s) => (s.selectedId === null ? undefined : contextOf(s).get(s.selectedId)));
}

/** cameraMode !== 'walk'. */
export function useCanEdit(): boolean {
  return useEditor((s) => s.cameraMode !== 'walk');
}

/** layerView(layer, cameraMode, viewFromAbove). */
export function useLayerView(): LayerView {
  return useEditor(layerViewOf);
}

/** state.backSurfaceIds (ссылка стабильна между изменениями). */
export function useBackSurfaces(): readonly string[] {
  return useEditor((s) => s.backSurfaceIds);
}

/** isGhosted(o, layerView, backSurfaceIds, selectedId) для объекта с draft; false, если объекта нет. */
export function useIsGhosted(id: string): boolean {
  return useEditor((s) => {
    const o = contextOf(s).get(id);
    return o !== undefined && isGhosted(o, layerViewOf(s), s.backSurfaceIds, s.selectedId);
  });
}

export function useRoom(): RoomDef {
  return useEditor((s) => getRoom(s.roomId));
}

/** activeLightIds(objects, reservedLights(room, ambience, cameraMode)); мемоизация по ссылкам. */
export function useActiveLightIds(): ReadonlySet<string> {
  return useEditor(activeLightsOf);
}

// ---------- Снимки для обработчиков событий (вне React) ----------

export function getObject(id: string): SceneObject | undefined {
  return contextOf(useEditor.getState()).get(id);
}

export function getObjects(): readonly SceneObject[] {
  const state = useEditor.getState();
  return mergedObjects(state.layout.objects, state.draft);
}

/** makeContext(room, getObjects()); мемоизация по (room, layout.objects, draft). */
export function getContext(): SceneContext {
  return contextOf(useEditor.getState());
}

export function getLayerView(): LayerView {
  return layerViewOf(useEditor.getState());
}

export function getBackSurfaces(): readonly string[] {
  return useEditor.getState().backSurfaceIds;
}

export function canEdit(): boolean {
  return useEditor.getState().cameraMode !== 'walk';
}
