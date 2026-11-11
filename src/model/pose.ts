import { clampToRoom, floorAt, nearestSurface, snapTo, wallFrame, wallSurfaces } from './geometry';
import type { WallSurface } from './geometry';
import type { Mount, MountKind, Ray, RoomDef, SceneObject, Vec3 } from './types';

/**
 * Зазор между стеной и настенным декором: больше всего, что RoomShell рисует на стене, —
 * фотопанели второго слоя (PANEL_GAP × 2 = 0.024) и гребня складки шторы (PANEL_GAP + 0.015 = 0.027, см. W1).
 */
export const WALL_GAP = 0.03;
export const GRID_STEP = 0.1;
export const SIZE_STEP = 0.05;
export const ROTATION_STEP = Math.PI / 12;
/** Ниже этой высоты подвешенный декор задевает головы — панель свойств показывает предупреждение. */
export const HEAD_CLEARANCE = 2.0;

/** Мировая поза: position — центр основания, rotationY — вокруг +Y. */
export interface Pose {
  position: Vec3;
  rotationY: number;
}

export interface SceneContext {
  room: RoomDef;
  objects: readonly SceneObject[];
  get(id: string): SceneObject | undefined;
  surface(id: string): WallSurface | undefined;
}

export function makeContext(room: RoomDef, objects: readonly SceneObject[]): SceneContext {
  // Индексы строятся при первом обращении: контекст создаётся часто, а нужен не всегда.
  let byId: Map<string, SceneObject> | undefined;
  let surfaces: Map<string, WallSurface> | undefined;
  return {
    room,
    objects,
    get(id) {
      if (!byId) {
        byId = new Map();
        // При дубликатах id (битый макет до sanitizeLayout) побеждает первый.
        for (const o of objects) if (!byId.has(o.id)) byId.set(o.id, o);
      }
      return byId.get(id);
    },
    surface(id) {
      if (!surfaces) surfaces = new Map(wallSurfaces(room).map((s) => [s.id, s]));
      return surfaces.get(id);
    },
  };
}

/** Хозяин surface-крепления, если ссылка цела: существует, отличен от самого объекта и стоит на полу. */
function hostOf(o: SceneObject, ctx: SceneContext): SceneObject | undefined {
  if (o.mount.kind !== 'surface') return undefined;
  const host = ctx.get(o.mount.hostId);
  return host && host.id !== o.id && host.mount.kind === 'floor' ? host : undefined;
}

/**
 * Единственное место, где крепление превращается в мировую позу. Никогда не бросает.
 *   floor   — [x, floorAt(x, z) + lift, z], rotationY
 *   ceiling — [x, H − drop − h, z], rotationY
 *   wall    — from + dir·along + normal·(WALL_GAP + d/2), y = bottom; rotationY = wallFrame(surface).rotationY
 *   surface — toWorld(hostPose, [u, host.size[1], v]); rotationY = hostPose.rotationY + rotationY
 * Битая ссылка: surface без хозяина (или хозяин не floor) → как floor в (0, 0), lift 0;
 * wall без поверхности → [0, bottom, 0], rotationY 0. Это страховка от падения, а не поведение: построители ops.ts
 * (cmdPatch, cmdRemove, cmdSetMount, cmdResetVenue, reconcileVenue) не создают битых ссылок — прежде чем хозяин
 * исчезнет, перестанет стоять на полу или будет скрыт, его дети переводятся на пол в своих мировых X/Z.
 */
export function resolvePose(o: SceneObject, ctx: SceneContext): Pose {
  const m = o.mount;
  switch (m.kind) {
    case 'floor':
      return { position: [m.x, floorAt(ctx.room, m.x, m.z) + m.lift, m.z], rotationY: o.rotationY };
    case 'ceiling':
      return { position: [m.x, ctx.room.size.height - m.drop - o.size[1], m.z], rotationY: o.rotationY };
    case 'wall': {
      const s = ctx.surface(m.surfaceId);
      if (!s) return { position: [0, m.bottom, 0], rotationY: 0 };
      const f = wallFrame(s);
      const out = WALL_GAP + o.size[2] / 2;
      return {
        position: [
          s.from[0] + f.dir[0] * m.along + f.normal[0] * out,
          m.bottom,
          s.from[1] + f.dir[1] * m.along + f.normal[1] * out,
        ],
        rotationY: f.rotationY,
      };
    }
    case 'surface': {
      const host = hostOf(o, ctx);
      if (!host) return { position: [0, floorAt(ctx.room, 0, 0), 0], rotationY: o.rotationY };
      // Хозяин стоит на полу (глубина ровно 1), поэтому рекурсия заканчивается на следующем шаге.
      const hostPose = resolvePose(host, ctx);
      return {
        position: toWorld(hostPose, [m.u, host.size[1], m.v]),
        rotationY: hostPose.rotationY + o.rotationY,
      };
    }
  }
}

export function isMountBroken(o: SceneObject, ctx: SceneContext): boolean {
  if (o.mount.kind === 'surface') return hostOf(o, ctx) === undefined;
  if (o.mount.kind === 'wall') return ctx.surface(o.mount.surfaceId) === undefined;
  return false;
}

/** Поворот на θ вокруг +Y: локальный +Z → (sin θ, 0, cos θ), локальный +X → (cos θ, 0, −sin θ). */
export function toWorld(pose: Pose, local: Vec3): Vec3 {
  const c = Math.cos(pose.rotationY);
  const s = Math.sin(pose.rotationY);
  return [
    pose.position[0] + local[0] * c + local[2] * s,
    pose.position[1] + local[1],
    pose.position[2] - local[0] * s + local[2] * c,
  ];
}

export function toLocal(pose: Pose, world: Vec3): Vec3 {
  const c = Math.cos(pose.rotationY);
  const s = Math.sin(pose.rotationY);
  const dx = world[0] - pose.position[0];
  const dz = world[2] - pose.position[2];
  return [dx * c - dz * s, world[1] - pose.position[1], dx * s + dz * c];
}

export function rayToLocal(pose: Pose, ray: Ray): Ray {
  const c = Math.cos(pose.rotationY);
  const s = Math.sin(pose.rotationY);
  const [dx, dy, dz] = ray.dir;
  return { origin: toLocal(pose, ray.origin), dir: [dx * c - dz * s, dy, dx * s + dz * c] };
}

/** Зажим с защитой от NaN/±Infinity: не число → нижняя граница. */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Удерживает объект в допустимых пределах (возвращает тот же объект, если ничего не изменилось):
 *   floor   — (x, z) = clampToRoom; lift ∈ [0, max(0, H − floorAt − h)]
 *   ceiling — (x, z) = clampToRoom; drop ∈ [0, max(0, H − h)]
 *   wall    — along ∈ [w/2, length − w/2] (если w > length → length/2); bottom ∈ [0, max(0, H − h)]
 *   surface — u ∈ [−W/2, W/2], v ∈ [−D/2, D/2], где W, D — ширина и глубина хозяина (центр основания остаётся на столешнице)
 * Крепление с неизвестной поверхностью или хозяином возвращается как есть (его чинит sanitizeLayout).
 */
export function clampMount(mount: Mount, size: Vec3, ctx: SceneContext): Mount {
  const H = ctx.room.size.height;
  switch (mount.kind) {
    case 'floor': {
      const [x, z] = clampToRoom(ctx.room, mount.x, mount.z);
      const lift = clampNumber(mount.lift, 0, Math.max(0, H - floorAt(ctx.room, x, z) - size[1]));
      return x === mount.x && z === mount.z && lift === mount.lift ? mount : { kind: 'floor', x, z, lift };
    }
    case 'ceiling': {
      const [x, z] = clampToRoom(ctx.room, mount.x, mount.z);
      const drop = clampNumber(mount.drop, 0, Math.max(0, H - size[1]));
      return x === mount.x && z === mount.z && drop === mount.drop ? mount : { kind: 'ceiling', x, z, drop };
    }
    case 'wall': {
      const s = ctx.surface(mount.surfaceId);
      if (!s) return mount;
      const length = wallFrame(s).length;
      const w = size[0];
      const along = w > length ? length / 2 : clampNumber(mount.along, w / 2, length - w / 2);
      const bottom = clampNumber(mount.bottom, 0, Math.max(0, s.height - size[1]));
      return along === mount.along && bottom === mount.bottom
        ? mount
        : { kind: 'wall', surfaceId: mount.surfaceId, along, bottom };
    }
    case 'surface': {
      const host = ctx.get(mount.hostId);
      if (!host) return mount;
      const hw = host.size[0] / 2;
      const hd = host.size[2] / 2;
      // Не число → центр столешницы (а не её край).
      const u = Number.isFinite(mount.u) ? clampNumber(mount.u, -hw, hw) : 0;
      const v = Number.isFinite(mount.v) ? clampNumber(mount.v, -hd, hd) : 0;
      return u === mount.u && v === mount.v ? mount : { kind: 'surface', hostId: mount.hostId, u, v };
    }
  }
}

/** Округляет x, z | along, bottom | drop | u, v | lift к шагу. */
export function snapMount(mount: Mount, step: number): Mount {
  if (!(step > 0)) return mount;
  switch (mount.kind) {
    case 'floor': {
      const x = snapTo(mount.x, step);
      const z = snapTo(mount.z, step);
      const lift = snapTo(mount.lift, step);
      return x === mount.x && z === mount.z && lift === mount.lift ? mount : { kind: 'floor', x, z, lift };
    }
    case 'ceiling': {
      const x = snapTo(mount.x, step);
      const z = snapTo(mount.z, step);
      const drop = snapTo(mount.drop, step);
      return x === mount.x && z === mount.z && drop === mount.drop ? mount : { kind: 'ceiling', x, z, drop };
    }
    case 'wall': {
      const along = snapTo(mount.along, step);
      const bottom = snapTo(mount.bottom, step);
      return along === mount.along && bottom === mount.bottom
        ? mount
        : { kind: 'wall', surfaceId: mount.surfaceId, along, bottom };
    }
    case 'surface': {
      const u = snapTo(mount.u, step);
      const v = snapTo(mount.v, step);
      return u === mount.u && v === mount.v ? mount : { kind: 'surface', hostId: mount.hostId, u, v };
    }
  }
}

/**
 * Переводит объект на другой тип крепления, сохраняя мировые X/Z (кнопки «Крепление» в панели свойств):
 *   → floor   { x, z, lift: 0 }
 *   → ceiling { x, z, drop: opts.drop ?? 0 }
 *   → wall    opts.surfaceId либо nearestSurface(x, z); along — проекция; bottom = opts.bottom ?? текущая высота основания
 *   → surface только с opts.hostId: (u, v) = toLocal(hostPose, position); без hostId → как floor
 * Результат проходит clampMount.
 */
export function remount(
  o: SceneObject,
  to: MountKind,
  ctx: SceneContext,
  opts?: { surfaceId?: string; hostId?: string; drop?: number; bottom?: number },
): Mount {
  const pose = resolvePose(o, ctx);
  const [x, y, z] = pose.position;
  const floor: Mount = { kind: 'floor', x, z, lift: 0 };
  let mount: Mount = floor;
  switch (to) {
    case 'floor':
      break;
    case 'ceiling':
      mount = { kind: 'ceiling', x, z, drop: opts?.drop ?? 0 };
      break;
    case 'wall': {
      const asked = opts?.surfaceId !== undefined ? ctx.surface(opts.surfaceId) : undefined;
      // Неизвестный surfaceId — берём ближайшую поверхность, а не создаём битую ссылку.
      const surface = asked ?? nearestSurface(ctx.room, x, z).surface;
      if (!ctx.surface(surface.id)) break; // помещение без стен и колонн → как floor
      const f = wallFrame(surface);
      const along = (x - surface.from[0]) * f.dir[0] + (z - surface.from[1]) * f.dir[1];
      mount = { kind: 'wall', surfaceId: surface.id, along, bottom: opts?.bottom ?? y };
      break;
    }
    case 'surface': {
      const host = opts?.hostId !== undefined ? ctx.get(opts.hostId) : undefined;
      if (!host || host.id === o.id || host.mount.kind !== 'floor') break; // без хозяина → как floor
      const local = toLocal(resolvePose(host, ctx), pose.position);
      mount = { kind: 'surface', hostId: host.id, u: local[0], v: local[2] };
      break;
    }
  }
  return clampMount(mount, o.size, ctx);
}

/** Объекты, стоящие на hostId. */
export function childrenOf(objects: readonly SceneObject[], hostId: string): SceneObject[] {
  return objects.filter((o) => o.mount.kind === 'surface' && o.mount.hostId === hostId && o.id !== hostId);
}

/** Числа для панели свойств. */
export interface MountReadout {
  /** Высота основания над полом помещения (y = 0). */
  baseY: number;
  topY: number;
  /** От низа объекта до пола/подиума под ним (запас по высоте для подвешенного декора). */
  clearance: number;
  /** wall: название поверхности и расстояние от её левого края до левого края объекта. */
  surfaceName?: string;
  leftEdge?: number;
  /** surface: имя хозяина. */
  hostName?: string;
}

export function describeMount(o: SceneObject, ctx: SceneContext): MountReadout {
  const pose = resolvePose(o, ctx);
  const [x, baseY, z] = pose.position;
  const readout: MountReadout = {
    baseY,
    topY: baseY + o.size[1],
    clearance: baseY - floorAt(ctx.room, x, z),
  };
  if (o.mount.kind === 'wall') {
    const s = ctx.surface(o.mount.surfaceId);
    if (s) {
      readout.surfaceName = s.name;
      readout.leftEdge = o.mount.along - o.size[0] / 2;
    }
  } else if (o.mount.kind === 'surface') {
    const host = ctx.get(o.mount.hostId);
    if (host) readout.hostName = host.name;
  }
  return readout;
}
