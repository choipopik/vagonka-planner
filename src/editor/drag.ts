// Перемещение объекта по своей поверхности. Чистый модуль — без three, react и DOM.
// Данные каталога (getItem, isSupport) модули src/editor импортируют прямо из '../catalog': правило Р22 о внедрении
// касается только src/model.
import { getItem, isSupport } from '../catalog';
import { objectBox } from '../catalog/bounds';
import { nearestSurface, snapTo, wallFrame } from '../model/geometry';
import type { WallSurface } from '../model/geometry';
import { childrenOf, clampMount, rayToLocal, resolvePose, snapMount, toLocal } from '../model/pose';
import type { SceneContext } from '../model/pose';
import { hitFloor, hitWalls, rayPlaneY } from '../model/surfaces';
import type { Mount, Ray, SceneObject, Vec2, Vec3 } from '../model/types';
import { rayBox } from './pick';

export interface DragEnv {
  ctx: SceneContext;
  /** null — привязка выключена (тогда значения округляются до 1 см). */
  grid: number | null;
  mode: 'orbit' | 'top';
}

export interface MoveSession {
  id: string;
  /** Объект на момент начала (без draft). */
  start: SceneObject;
  /** Высота основания в начале. */
  baseY: number;
  /**
   * Только wall. 'hit' — в начале луч попал в поверхность самого объекта (hitWalls нашёл её лицевой стороной, и она
   * ближайшая на луче): дальше объект следует за попаданиями в стены. 'floor' — не попал (план; объект на отсечённой
   * стене, взятый «со спины»; скользящий луч): дальше объект следует за точкой горизонтальной плоскости под курсором
   * к ближайшей поверхности.
   */
  wallVia?: 'hit' | 'floor';
  /**
   * Только wall, wallVia 'floor': высота горизонтальной плоскости, по которой ведётся точка под курсором, — высота,
   * на которой луч в начале вошёл в габарит объекта. На плане (вертикальный луч) высота роли не играет.
   */
  planeY?: number;
  /**
   * floor/ceiling/surface: мировые (x, z) центра основания минус точка луча на плоскости y = baseY.
   * wall, wallVia 'hit':   (along, bottom) объекта минус (along, y) попадания в его поверхность.
   * wall, wallVia 'floor': мировые (x, z) точки крепления на поверхности (from + dir·along) минус точка луча на
   *                        плоскости y = planeY; точки нет → [0, 0]. В начале жеста «точка под курсором + offset»
   *                        лежит ровно на поверхности объекта, поэтому первый кадр не переносит его на стену, которая
   *                        оказалась ближе к точке пола под лучом.
   */
  offset: [number, number];
}

export interface MoveResult {
  mount: Mount;
  rotationY: number;
}

/** Шаг округления, когда привязка к сетке выключена, м. */
const FINE_STEP = 0.01;
/** При равных расстояниях (угол помещения) объект остаётся на исходной поверхности. */
const SURFACE_TIE = 1e-6;

/** Точка поверхности на расстоянии along от её левого края. */
function pointOnSurface(surface: WallSurface, along: number): Vec2 {
  const f = wallFrame(surface);
  return [surface.from[0] + f.dir[0] * along, surface.from[1] + f.dir[1] * along];
}

/** Высота, на которой луч входит в габаритный бокс объекта; мимо бокса — высота ближайшей к центру точки луча, зажатая в габарит. */
function grabHeight(o: SceneObject, ray: Ray, ctx: SceneContext): number {
  const pose = resolvePose(o, ctx);
  const bottom = pose.position[1];
  const t = rayBox(rayToLocal(pose, ray), objectBox(o));
  if (t !== null) return Math.min(bottom + o.size[1], Math.max(bottom, ray.origin[1] + ray.dir[1] * t));
  const center: Vec3 = [pose.position[0], bottom + o.size[1] / 2, pose.position[2]];
  const along =
    (center[0] - ray.origin[0]) * ray.dir[0] + (center[1] - ray.origin[1]) * ray.dir[1] + (center[2] - ray.origin[2]) * ray.dir[2];
  return Math.min(bottom + o.size[1], Math.max(bottom, ray.origin[1] + ray.dir[1] * Math.max(0, along)));
}

export function beginMove(o: SceneObject, ray: Ray, ctx: SceneContext): MoveSession {
  const pose = resolvePose(o, ctx);
  const baseY = pose.position[1];

  if (o.mount.kind === 'wall') {
    const surface = ctx.surface(o.mount.surfaceId);
    const nearest = hitWalls(ray, ctx.room)[0];
    if (surface && nearest && nearest.surfaceId === surface.id) {
      return {
        id: o.id,
        start: o,
        baseY,
        wallVia: 'hit',
        offset: [o.mount.along - nearest.along, o.mount.bottom - nearest.y],
      };
    }
    const planeY = grabHeight(o, ray, ctx);
    const p = rayPlaneY(ray, planeY);
    const anchor: Vec2 = surface ? pointOnSurface(surface, o.mount.along) : [pose.position[0], pose.position[2]];
    return {
      id: o.id,
      start: o,
      baseY,
      wallVia: 'floor',
      planeY,
      offset: p ? [anchor[0] - p[0], anchor[1] - p[2]] : [0, 0],
    };
  }

  const p = rayPlaneY(ray, baseY);
  return {
    id: o.id,
    start: o,
    baseY,
    offset: p ? [pose.position[0] - p[0], pose.position[2] - p[2]] : [0, 0],
  };
}

/** Ближайшая к точке поверхность; при равенстве расстояний — исходная поверхность объекта. */
function surfaceNear(ctx: SceneContext, x: number, z: number, startId: string) {
  const found = nearestSurface(ctx.room, x, z);
  if (found.surface.id === startId) return found;
  const own = nearestSurface(ctx.room, x, z, (surface) => surface.id === startId);
  return own.surface.id === startId && own.distance <= found.distance + SURFACE_TIE ? own : found;
}

function moveWall(s: MoveSession, ray: Ray, env: DragEnv, step: number): Mount | null {
  const start = s.start.mount;
  if (start.kind !== 'wall') return null;

  if (s.wallVia === 'hit') {
    // Ближайшая поверхность, обращённая к лучу: стена или грань колонны (объект может перейти на неё).
    const hit = hitWalls(ray, env.ctx.room)[0];
    if (!hit) return null;
    return snapMount(
      { kind: 'wall', surfaceId: hit.surfaceId, along: hit.along + s.offset[0], bottom: hit.y + s.offset[1] },
      step,
    );
  }

  // 'floor': точка горизонтальной плоскости под курсором (со смещением захвата) → ближайшая к ней поверхность.
  // Противоположная стена «по лучу» здесь не выбирается никогда: луч в стены вообще не пускается.
  const p = rayPlaneY(ray, s.planeY ?? 0);
  if (!p) return null;
  const found = surfaceNear(env.ctx, p[0] + s.offset[0], p[2] + s.offset[1], start.surfaceId);
  if (!env.ctx.surface(found.surface.id)) return null; // помещение без стен и колонн
  // Высота основания прежняя и не округляется: объект ведут только вдоль поверхности.
  return { kind: 'wall', surfaceId: found.surface.id, along: snapTo(found.along, step), bottom: start.bottom };
}

function moveCeiling(s: MoveSession, ray: Ray, step: number): Mount | null {
  const start = s.start.mount;
  if (start.kind !== 'ceiling') return null;
  const p = rayPlaneY(ray, s.baseY);
  if (!p) return null;
  // Опуск прежний и не округляется.
  return { kind: 'ceiling', x: snapTo(p[0] + s.offset[0], step), z: snapTo(p[2] + s.offset[1], step), drop: start.drop };
}

function moveFloorOrTop(s: MoveSession, ray: Ray, env: DragEnv, step: number): MoveResult | null {
  const { ctx } = env;
  const start = s.start;
  const mounts = getItem(start.type).mounts;
  const startPose = resolvePose(start, ctx);

  // 1. Столешница под курсором. Хозяин, на котором кто-то стоит, на стол не заезжает (иначе нарушился бы I2).
  if (mounts.includes('surface') && ray.dir[1] < 0 && childrenOf(ctx.objects, s.id).length === 0) {
    let best: { host: SceneObject; u: number; v: number; rotationY: number; distance: number } | undefined;
    for (const host of ctx.objects) {
      if (host.id === s.id || !isSupport(host)) continue;
      const hostPose = resolvePose(host, ctx);
      const top = hostPose.position[1] + host.size[1];
      const q = rayPlaneY(ray, top);
      if (!q) continue;
      const local = toLocal(hostPose, [q[0] + s.offset[0], top, q[2] + s.offset[1]]);
      if (Math.abs(local[0]) > host.size[0] / 2 || Math.abs(local[2]) > host.size[2] / 2) continue;
      const distance = Math.hypot(q[0] - ray.origin[0], q[1] - ray.origin[1], q[2] - ray.origin[2]);
      if (!best || distance < best.distance) {
        best = { host, u: local[0], v: local[2], rotationY: hostPose.rotationY, distance };
      }
    }
    if (best) {
      const sameHost = start.mount.kind === 'surface' && start.mount.hostId === best.host.id;
      return {
        mount: snapMount({ kind: 'surface', hostId: best.host.id, u: best.u, v: best.v }, step),
        // На прежнем хозяине относительный угол не пересчитывается (без шума округления).
        rotationY: sameHost ? start.rotationY : startPose.rotationY - best.rotationY,
      };
    }
  }

  // 2. Пол или подиум.
  if (mounts.includes('floor')) {
    const onFloor = start.mount.kind === 'floor';
    // Стоял на полу — плоскость на высоте захвата (нет скачка от параллакса); съезжает со стола — точка пола под лучом.
    const q = onFloor ? rayPlaneY(ray, s.baseY) : (hitFloor(ray, ctx.room)?.point ?? null);
    if (!q) return null;
    return {
      mount: {
        kind: 'floor',
        x: snapTo(q[0] + s.offset[0], step),
        z: snapTo(q[2] + s.offset[1], step),
        lift: start.mount.kind === 'floor' ? start.mount.lift : 0,
      },
      rotationY: onFloor ? start.rotationY : startPose.rotationY,
    };
  }

  // 3. Только настольный предмет вне опор.
  return null;
}

/** Новое крепление для луча под курсором; null — луч не попал в свою поверхность (вызывающий оставляет прежнее). Правила — в разделе W2. */
export function resolveMove(s: MoveSession, ray: Ray, env: DragEnv): MoveResult | null {
  const step = env.grid ?? FINE_STEP;
  const start = s.start;
  let result: MoveResult | null;
  switch (start.mount.kind) {
    case 'wall': {
      const mount = moveWall(s, ray, env, step);
      result = mount ? { mount, rotationY: start.rotationY } : null;
      break;
    }
    case 'ceiling': {
      const mount = moveCeiling(s, ray, step);
      result = mount ? { mount, rotationY: start.rotationY } : null;
      break;
    }
    case 'floor':
    case 'surface':
      result = moveFloorOrTop(s, ray, env, step);
      break;
  }
  if (!result) return null;
  return { mount: clampMount(result.mount, start.size, env.ctx), rotationY: result.rotationY };
}
