import type { ColumnFace, PlatformDef, RoomDef, Vec2, Vec3, WallDef, WallPanel } from './types';

export interface WallFrame {
  length: number;
  /** Единичный вектор вдоль стены (from → to) в плоскости XZ. */
  dir: Vec2;
  /** Единичная нормаль внутрь помещения (у грани колонны — от колонны в свободное пространство). */
  normal: Vec2;
  /** Поворот вокруг Y, при котором плоскость смотрит внутрь помещения. */
  rotationY: number;
  mid: Vec2;
}

export function wallFrame(wall: { from: Vec2; to: Vec2 }): WallFrame {
  const dx = wall.to[0] - wall.from[0];
  const dz = wall.to[1] - wall.from[1];
  const length = Math.hypot(dx, dz);
  const dir: Vec2 = [dx / length, dz / length];
  const normal: Vec2 = [-dir[1], dir[0]];
  return {
    length,
    dir,
    normal,
    rotationY: Math.atan2(normal[0], normal[1]),
    mid: [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2],
  };
}

/** Зазор между стеной и панелью, чтобы поверхности не мерцали. */
const PANEL_GAP = 0.012;

export function panelTransform(wall: WallDef, panel: WallPanel): { position: Vec3; rotationY: number } {
  const f = wallFrame(wall);
  const along = panel.offset + panel.width / 2;
  const out = PANEL_GAP * ((panel.layer ?? 0) + 1);
  return {
    position: [
      wall.from[0] + f.dir[0] * along + f.normal[0] * out,
      panel.bottom + panel.height / 2,
      wall.from[1] + f.dir[1] * along + f.normal[1] * out,
    ],
    rotationY: f.rotationY,
  };
}

export function platformAt(platforms: PlatformDef[], x: number, z: number): PlatformDef | undefined {
  return platforms.find((p) => x >= p.min[0] && x <= p.max[0] && z >= p.min[1] && z <= p.max[1]);
}

/**
 * Ограничивает точку прогулки: не даёт выйти за стены и войти в колонны.
 * `radius` — «толщина» человека.
 */
export function constrainWalk(room: RoomDef, x: number, z: number, radius: number): Vec2 {
  const hx = room.size.length / 2 - radius;
  const hz = room.size.width / 2 - radius;
  let nx = Math.min(hx, Math.max(-hx, x));
  let nz = Math.min(hz, Math.max(-hz, z));

  for (const c of room.columns) {
    const ex = c.size[0] / 2 + radius;
    const ez = c.size[1] / 2 + radius;
    const dx = nx - c.position[0];
    const dz = nz - c.position[1];
    if (Math.abs(dx) < ex && Math.abs(dz) < ez) {
      // Выталкиваем по оси с наименьшим проникновением.
      if (ex - Math.abs(dx) < ez - Math.abs(dz)) {
        nx = c.position[0] + Math.sign(dx || 1) * ex;
      } else {
        nz = c.position[1] + Math.sign(dz || 1) * ez;
      }
    }
  }
  return [nx, nz];
}

// ---------- Поверхности для настенного декора ----------

/** Вертикальный прямоугольник, на который можно вешать декор: стена помещения или грань колонны. */
export interface WallSurface {
  /** Стена: wall.id. Грань колонны: `${column.id}:${face}`, например 'col-left:s'. */
  id: string;
  from: Vec2;
  to: Vec2;
  /** Высота поверхности = высота помещения. */
  height: number;
  /** Для панели свойств: wall.name ?? wall.id; «‹column.name ?? column.id› · ‹север|восток|юг|запад›». */
  name: string;
}

const FACES: readonly ColumnFace[] = ['n', 'e', 's', 'w'];
const FACE_NAMES: Record<ColumnFace, string> = { n: 'север', e: 'восток', s: 'юг', w: 'запад' };

/**
 * Стены помещения в порядке room.walls, затем по 4 грани каждой колонны в порядке n, e, s, w.
 * У каждой поверхности wallFrame().normal смотрит в свободное пространство, `from` — слева для зрителя.
 * Грань колонны (cx, cz), размер (sx, sz):
 *   n: from (cx + sx/2, cz − sz/2) → to (cx − sx/2, cz − sz/2)
 *   e: from (cx + sx/2, cz + sz/2) → to (cx + sx/2, cz − sz/2)
 *   s: from (cx − sx/2, cz + sz/2) → to (cx + sx/2, cz + sz/2)
 *   w: from (cx − sx/2, cz − sz/2) → to (cx − sx/2, cz + sz/2)
 */
export function wallSurfaces(room: RoomDef): WallSurface[] {
  const height = room.size.height;
  const result: WallSurface[] = room.walls.map((w) => ({
    id: w.id,
    from: [w.from[0], w.from[1]],
    to: [w.to[0], w.to[1]],
    height,
    name: w.name ?? w.id,
  }));
  for (const c of room.columns) {
    const [cx, cz] = c.position;
    const hx = c.size[0] / 2;
    const hz = c.size[1] / 2;
    const ends: Record<ColumnFace, [Vec2, Vec2]> = {
      n: [[cx + hx, cz - hz], [cx - hx, cz - hz]],
      e: [[cx + hx, cz + hz], [cx + hx, cz - hz]],
      s: [[cx - hx, cz + hz], [cx + hx, cz + hz]],
      w: [[cx - hx, cz - hz], [cx - hx, cz + hz]],
    };
    for (const face of FACES) {
      result.push({
        id: `${c.id}:${face}`,
        from: ends[face][0],
        to: ends[face][1],
        height,
        name: `${c.name ?? c.id} · ${FACE_NAMES[face]}`,
      });
    }
  }
  return result;
}

export function getSurface(room: RoomDef, id: string): WallSurface | undefined {
  return wallSurfaces(room).find((s) => s.id === id);
}

/** Высота пола под точкой: высота подиума или 0. */
export function floorAt(room: RoomDef, x: number, z: number): number {
  return platformAt(room.platforms, x, z)?.height ?? 0;
}

/** Зажимает точку в прямоугольник ±length/2 × ±width/2 с отступом margin (по умолчанию 0). */
export function clampToRoom(room: RoomDef, x: number, z: number, margin = 0): Vec2 {
  const hx = Math.max(0, room.size.length / 2 - margin);
  const hz = Math.max(0, room.size.width / 2 - margin);
  // Не число (NaN, ±Infinity) → центр помещения: функция никогда не возвращает мусор.
  const fx = Number.isFinite(x) ? x : 0;
  const fz = Number.isFinite(z) ? z : 0;
  return [Math.min(hx, Math.max(-hx, fx)), Math.min(hz, Math.max(-hz, fz))];
}

/**
 * Ближайшая поверхность к точке пола: along зажат в [0, length], distance — расстояние до ближайшей точки отрезка (≥ 0).
 * prefer — необязательный фильтр: если ему удовлетворяет хотя бы одна поверхность, выбирается ближайшая из таких;
 * если ни одна — ближайшая из всех (функция всегда возвращает результат).
 */
export function nearestSurface(
  room: RoomDef,
  x: number,
  z: number,
  prefer?: (surface: WallSurface) => boolean,
): { surface: WallSurface; along: number; distance: number } {
  type Found = { surface: WallSurface; along: number; distance: number };
  let best: Found | undefined;
  let bestPreferred: Found | undefined;
  for (const surface of wallSurfaces(room)) {
    const f = wallFrame(surface);
    const raw = (x - surface.from[0]) * f.dir[0] + (z - surface.from[1]) * f.dir[1];
    const along = Math.min(f.length, Math.max(0, raw));
    const px = surface.from[0] + f.dir[0] * along;
    const pz = surface.from[1] + f.dir[1] * along;
    const found: Found = { surface, along, distance: Math.hypot(x - px, z - pz) };
    if (!best || found.distance < best.distance) best = found;
    if (prefer?.(surface) && (!bestPreferred || found.distance < bestPreferred.distance)) bestPreferred = found;
  }
  const result = bestPreferred ?? best;
  if (result) return result;
  // Помещение без стен и колонн: вырожденная поверхность в начале координат, чтобы не бросать.
  return {
    surface: { id: '', from: [0, 0], to: [1, 0], height: room.size.height, name: '' },
    along: 0,
    distance: Math.hypot(x, z),
  };
}

/** Округление к шагу; step ≤ 0 → value. */
export function snapTo(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const snapped = Math.round(value / step) * step;
  // Десятичная «уборка» снимает только двоичный хвост (0.1 × 3 = 0.30000000000000004 → 0.3): она применяется, когда
  // отличается от результата не больше чем на ошибку округления. Для шага вроде ROTATION_STEP = π / 12 результат
  // остаётся ТОЧНЫМ кратным шага (6 × π / 12 === π / 2), а не числом с девятью знаками. + 0 превращает −0 в 0.
  const tidy = Math.round(snapped * 1e9) / 1e9;
  return (Math.abs(tidy - snapped) <= 4 * Number.EPSILON * Math.abs(snapped) ? tidy : snapped) + 0;
}
