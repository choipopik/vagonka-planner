import type { CatalogItem } from '../catalog/types';
import { clampToRoom, nearestSurface, wallFrame } from './geometry';
import type { WallSurface } from './geometry';
import { clampMount, resolvePose, snapMount } from './pose';
import type { SceneContext } from './pose';
import { hitFloor, hitTops, hitWalls } from './surfaces';
import type { Mount, Ray, SceneObject, Vec3 } from './types';

/** Два крепления «совпадают», если отличаются меньше чем на это, м. */
const SAME_PLACE = 0.05;
/** Сдвиг нового объекта, попавшего точно на существующий того же типа, м. */
const SHIFT = 0.3;
/** Сколько раз подряд сдвигаем: третий и следующие одинаковые объекты тоже не ложатся стопкой. */
const MAX_SHIFTS = 12;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_PLACE;
}

function sameMount(a: Mount, b: Mount): boolean {
  switch (a.kind) {
    case 'floor':
      return b.kind === 'floor' && near(a.x, b.x) && near(a.z, b.z) && near(a.lift, b.lift);
    case 'ceiling':
      return b.kind === 'ceiling' && near(a.x, b.x) && near(a.z, b.z) && near(a.drop, b.drop);
    case 'wall':
      return b.kind === 'wall' && a.surfaceId === b.surfaceId && near(a.along, b.along) && near(a.bottom, b.bottom);
    case 'surface':
      return b.kind === 'surface' && a.hostId === b.hostId && near(a.u, b.u) && near(a.v, b.v);
  }
}

/** Сдвиг вдоль «главной» координаты крепления: x | along | u. */
function shifted(m: Mount, by: number): Mount {
  switch (m.kind) {
    case 'floor':
      return { ...m, x: m.x + by };
    case 'ceiling':
      return { ...m, x: m.x + by };
    case 'wall':
      return { ...m, along: m.along + by };
    case 'surface':
      return { ...m, u: m.u + by };
  }
}

/**
 * Крепление для НОВОГО объекта. kind = item.mounts[0]. ray — луч через центр вида (null → центр помещения).
 * P = clampToRoom(hitFloor(ray)?.point ?? [0, 0, 0]).
 *   floor   — { x: P.x, z: P.z, lift: 0 }
 *   surface — ближайший hitTops(ray) → { hostId, u, v }; иначе, если item.mounts содержит 'floor' → floor в P;
 *             иначе ближайшая к P опора (u = v = 0); опор нет → floor в P
 *   wall    — ближайший hitWalls(ray), чья поверхность не у́же объекта (wallFrame(s).length ≥ size[0]; если таких
 *             попаданий нет — просто ближайший) → { surfaceId, along, bottom: hit.y − h/2 };
 *             попаданий нет вовсе → nearestSurface(P, prefer) → { along, bottom: item.defaultBottom ?? 1.2 }, где
 *             prefer(s) = wallFrame(s).length ≥ size[0] &&
 *                         (ray === null || |ray.dir.y| > 0.98 || dot(ray.dir.xz, wallFrame(s).normal) < 0):
 *             объект не вешается на грань колонны, которая у́же его самого, и на стену, повёрнутую к камере изнанкой
 *             (луч из центра обычного вида в облёте упирается в пол посреди зала, а ближе всего к этой точке — колонны)
 *   ceiling — { x: P.x, z: P.z, drop: item.defaultDrop ?? 0 }
 * Затем snapMount(grid), если grid !== null, и clampMount. Если в результате крепление совпадает (в пределах 5 см)
 * с креплением уже существующего объекта того же type — сдвиг на 0.3 м по x | along | u и повторный clampMount.
 */
export function placeNew(
  item: CatalogItem,
  size: Vec3,
  ray: Ray | null,
  ctx: SceneContext,
  isSupport: (o: SceneObject) => boolean,
  grid: number | null,
): Mount {
  const room = ctx.room;
  const floorPoint = ray ? hitFloor(ray, room)?.point : undefined;
  const [px, pz] = clampToRoom(room, floorPoint?.[0] ?? 0, floorPoint?.[2] ?? 0);
  const onFloor: Mount = { kind: 'floor', x: px, z: pz, lift: 0 };
  const fits = (s: WallSurface) => wallFrame(s).length >= size[0];

  let mount: Mount = onFloor;
  switch (item.mounts[0] ?? 'floor') {
    case 'floor':
      break;
    case 'ceiling':
      mount = { kind: 'ceiling', x: px, z: pz, drop: item.defaultDrop ?? 0 };
      break;
    case 'surface': {
      const top = ray ? hitTops(ray, ctx, isSupport)[0] : undefined;
      if (top) {
        mount = { kind: 'surface', hostId: top.hostId, u: top.u, v: top.v };
      } else if (!item.mounts.includes('floor')) {
        // Предмет умеет стоять только на опоре: берём ближайшую к точке P.
        let best: { id: string; distance: number } | undefined;
        for (const o of ctx.objects) {
          if (!isSupport(o)) continue;
          const p = resolvePose(o, ctx).position;
          const distance = Math.hypot(p[0] - px, p[2] - pz);
          if (!best || distance < best.distance) best = { id: o.id, distance };
        }
        if (best) mount = { kind: 'surface', hostId: best.id, u: 0, v: 0 };
      }
      break;
    }
    case 'wall': {
      const hits = ray ? hitWalls(ray, room) : [];
      const hit =
        hits.find((h) => {
          const s = ctx.surface(h.surfaceId);
          return s !== undefined && fits(s);
        }) ?? hits[0];
      if (hit) {
        mount = { kind: 'wall', surfaceId: hit.surfaceId, along: hit.along, bottom: hit.y - size[1] / 2 };
      } else {
        const prefer = (s: WallSurface): boolean => {
          if (!fits(s)) return false;
          if (ray === null || Math.abs(ray.dir[1]) > 0.98) return true;
          const n = wallFrame(s).normal;
          return ray.dir[0] * n[0] + ray.dir[2] * n[1] < 0;
        };
        const found = nearestSurface(room, px, pz, prefer);
        // В помещении без стен и колонн вешать не на что — объект остаётся на полу.
        if (ctx.surface(found.surface.id)) {
          mount = {
            kind: 'wall',
            surfaceId: found.surface.id,
            along: found.along,
            bottom: item.defaultBottom ?? 1.2,
          };
        }
      }
      break;
    }
  }

  if (grid !== null) mount = snapMount(mount, grid);
  mount = clampMount(mount, size, ctx);

  const sameType = ctx.objects.filter((o) => o.type === item.id);
  for (let i = 0; i < MAX_SHIFTS; i++) {
    const current = mount;
    if (!sameType.some((o) => sameMount(o.mount, current))) break;
    const next = clampMount(shifted(current, SHIFT), size, ctx);
    if (sameMount(next, current)) break; // упёрлись в край — дальше двигать некуда
    mount = next;
  }
  return mount;
}
