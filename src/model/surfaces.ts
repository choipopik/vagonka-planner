import { wallFrame, wallSurfaces } from './geometry';
import { resolvePose, toLocal } from './pose';
import type { SceneContext } from './pose';
import type { Ray, RoomDef, SceneObject, Vec3 } from './types';

/** Меньше этого |dir.y| луч считается параллельным горизонтальной плоскости. */
const PARALLEL = 1e-9;

/** Пересечение с горизонтальной плоскостью; null — луч параллелен или плоскость позади. */
export function rayPlaneY(ray: Ray, y: number): Vec3 | null {
  const dy = ray.dir[1];
  if (Math.abs(dy) < PARALLEL) return null;
  const t = (y - ray.origin[1]) / dy;
  if (!(t >= 0)) return null;
  return [ray.origin[0] + ray.dir[0] * t, y, ray.origin[2] + ray.dir[2] * t];
}

function distanceTo(ray: Ray, point: Vec3): number {
  return Math.hypot(point[0] - ray.origin[0], point[1] - ray.origin[1], point[2] - ray.origin[2]);
}

export interface FloorHit { kind: 'floor'; point: Vec3; distance: number }
export interface WallHit { kind: 'wall'; surfaceId: string; along: number; y: number; point: Vec3; distance: number }
export interface TopHit { kind: 'top'; hostId: string; u: number; v: number; point: Vec3; distance: number }

/**
 * Только при dir.y < 0. Ближайшее из: верх подиума (внутри его прямоугольника) и плоскость y = 0
 * (без ограничения размерами помещения — вызывающий зажимает clampToRoom).
 */
export function hitFloor(ray: Ray, room: RoomDef): FloorHit | null {
  if (!(ray.dir[1] < 0)) return null;
  let best: FloorHit | null = null;
  const consider = (point: Vec3 | null) => {
    if (!point) return;
    const distance = distanceTo(ray, point);
    if (!best || distance < best.distance) best = { kind: 'floor', point, distance };
  };
  for (const p of room.platforms) {
    const point = rayPlaneY(ray, p.height);
    if (point && point[0] >= p.min[0] && point[0] <= p.max[0] && point[2] >= p.min[1] && point[2] <= p.max[1]) {
      consider(point);
    }
  }
  consider(rayPlaneY(ray, 0));
  return best;
}

/**
 * Поверхности wallSurfaces(room), обращённые к лучу (dot(dir, normal) < 0), в пределах 0 ≤ along ≤ length, 0 ≤ y ≤ height.
 * Отсортированы от ближней к дальней. С орбитальной камеры это ровно те стены, которые видны (ближние отсечены);
 * вертикальный луч плана не попадает ни в одну.
 */
export function hitWalls(ray: Ray, room: RoomDef): WallHit[] {
  const hits: WallHit[] = [];
  for (const s of wallSurfaces(room)) {
    const f = wallFrame(s);
    const facing = ray.dir[0] * f.normal[0] + ray.dir[2] * f.normal[1];
    if (!(facing < -PARALLEL)) continue;
    const t = ((s.from[0] - ray.origin[0]) * f.normal[0] + (s.from[1] - ray.origin[2]) * f.normal[1]) / facing;
    if (!(t >= 0)) continue;
    const point: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
    const along = (point[0] - s.from[0]) * f.dir[0] + (point[2] - s.from[1]) * f.dir[1];
    if (along < 0 || along > f.length || point[1] < 0 || point[1] > s.height) continue;
    hits.push({ kind: 'wall', surfaceId: s.id, along, y: point[1], point, distance: distanceTo(ray, point) });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Верхние грани объектов-опор (isSupport), только при dir.y < 0; от ближней к дальней. exclude — id, которые пропускаются. */
export function hitTops(
  ray: Ray,
  ctx: SceneContext,
  isSupport: (o: SceneObject) => boolean,
  exclude?: ReadonlySet<string>,
): TopHit[] {
  if (!(ray.dir[1] < 0)) return [];
  const hits: TopHit[] = [];
  for (const o of ctx.objects) {
    if (exclude?.has(o.id) || !isSupport(o)) continue;
    const pose = resolvePose(o, ctx);
    const point = rayPlaneY(ray, pose.position[1] + o.size[1]);
    if (!point) continue;
    const local = toLocal(pose, point);
    if (Math.abs(local[0]) > o.size[0] / 2 || Math.abs(local[2]) > o.size[2] / 2) continue;
    hits.push({ kind: 'top', hostId: o.id, u: local[0], v: local[2], point, distance: distanceTo(ray, point) });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
