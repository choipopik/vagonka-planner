// Аналитический выбор мышью: луч против локальных боксов объектов. Чистый модуль — без three, react и DOM.
import { pickBoxes } from '../catalog/bounds';
import type { LocalBox } from '../catalog/types';
import { rayToLocal, resolvePose } from '../model/pose';
import type { SceneContext } from '../model/pose';
import type { Ray, RoomDef, SceneObject, Vec3 } from '../model/types';
import { PICK_TIE } from './constants';

/** Меньше этого компонент направления считается нулевым (луч параллелен паре граней). */
const PARALLEL = 1e-12;

/** Slab-тест луча (в локальных координатах бокса) против AABB; каждая сторона бокса раздувается минимум до minThickness. Расстояние входа или null. */
export function rayBox(ray: Ray, box: LocalBox, minThickness = 0): number | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const half = Math.max(box.size[axis], minThickness) / 2;
    const lo = box.center[axis] - half;
    const hi = box.center[axis] + half;
    const o = ray.origin[axis];
    const d = ray.dir[axis];
    if (Math.abs(d) < PARALLEL) {
      // Луч идёт вдоль пары граней: он либо целиком между ними (касание грани считается попаданием), либо мимо.
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    tNear = Math.max(tNear, Math.min(a, b));
    tFar = Math.min(tFar, Math.max(a, b));
    if (tNear > tFar) return null;
  }
  // Бокс целиком позади начала луча.
  if (tFar < 0) return null;
  // Начало луча внутри бокса → расстояние входа 0.
  return Math.max(0, tNear);
}

export interface ObjectHit {
  id: string;
  distance: number;
  point: Vec3;
}

/** Расстояние вдоль луча до проекции точки на него (не меньше 0) — оценка «на каком расстоянии находится бокс». */
function depthOf(ray: Ray, point: Vec3): number {
  const t =
    (point[0] - ray.origin[0]) * ray.dir[0] + (point[1] - ray.origin[1]) * ray.dir[1] + (point[2] - ray.origin[2]) * ray.dir[2];
  return Math.max(0, t);
}

/**
 * Для каждого объекта, прошедшего pickable: луч → локальные координаты (rayToLocal(resolvePose)) → ближайший из pickBoxes(o).
 * minThickness(distance) — мировая толщина, соответствующая PICK_MIN_PX на этом расстоянии. Результат — от ближнего к дальнему.
 */
export function pickObjects(
  ray: Ray,
  ctx: SceneContext,
  opts: { pickable(o: SceneObject): boolean; minThickness(distance: number): number },
): ObjectHit[] {
  const hits: ObjectHit[] = [];
  for (const o of ctx.objects) {
    if (!opts.pickable(o)) continue;
    // Поворот вокруг Y сохраняет длины: параметр локального луча равен мировому расстоянию.
    const local = rayToLocal(resolvePose(o, ctx), ray);
    let nearest: number | null = null;
    for (const box of pickBoxes(o)) {
      // Толщина раздувания зависит от расстояния до бокса; до теста оно оценивается по его центру.
      const inflate = opts.minThickness(depthOf(local, box.center));
      const t = rayBox(local, box, Number.isFinite(inflate) && inflate > 0 ? inflate : 0);
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
    if (nearest === null) continue;
    hits.push({
      id: o.id,
      distance: nearest,
      point: [
        ray.origin[0] + ray.dir[0] * nearest,
        ray.origin[1] + ray.dir[1] * nearest,
        ray.origin[2] + ray.dir[2] * nearest,
      ],
    });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Расстояние до ближайшей колонны на пути луча (AABB колонны на всю высоту); Infinity — колонн нет. */
export function columnDistance(ray: Ray, room: RoomDef): number {
  const height = room.size.height;
  let nearest = Infinity;
  for (const c of room.columns) {
    const t = rayBox(ray, {
      center: [c.position[0], height / 2, c.position[1]],
      size: [c.size[0], height, c.size[1]],
    });
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest;
}

/**
 * Отбрасывает попадания дальше occluder; побеждает БЛИЖАЙШЕЕ. Единственное исключение: если среди оставшихся есть
 * выбранный объект и его distance ≤ ближайшая + PICK_TIE — побеждает он (соприкасающиеся поверхности не «перехватывают»
 * перетаскивание). Фонарь на выбранном столе и стол внутри выбранной кабинки выбираются с первого клика.
 */
export function choosePick(hits: ObjectHit[], selectedId: string | null, occluder: number): ObjectHit | null {
  let nearest: ObjectHit | null = null;
  let selected: ObjectHit | null = null;
  for (const hit of hits) {
    if (hit.distance > occluder) continue;
    if (nearest === null || hit.distance < nearest.distance) nearest = hit;
    if (hit.id === selectedId && (selected === null || hit.distance < selected.distance)) selected = hit;
  }
  if (nearest === null) return null;
  if (selected !== null && selected.distance <= nearest.distance + PICK_TIE) return selected;
  return nearest;
}
