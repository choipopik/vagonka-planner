import type { SceneObject, Vec3 } from '../model/types';
import { BUILD_CACHE_SIZE, buildInput, buildKey, getItem, partsOf } from './index';
import type { LocalBox, Part } from './types';

/** Габаритный бокс объекта: center [0, h/2, 0], size. */
export function objectBox(o: Pick<SceneObject, 'size'>): LocalBox {
  return { center: [0, o.size[1] / 2, 0], size: [o.size[0], o.size[1], o.size[2]] };
}

/** Строки матрицы поворота Эйлера XYZ (как THREE.Euler по умолчанию): world = R · local. */
function rotationRows(rotation: Vec3 | undefined): [Vec3, Vec3, Vec3] {
  if (!rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  const a = Math.cos(rotation[0]);
  const b = Math.sin(rotation[0]);
  const c = Math.cos(rotation[1]);
  const d = Math.sin(rotation[1]);
  const e = Math.cos(rotation[2]);
  const f = Math.sin(rotation[2]);
  return [
    [c * e, -c * f, d],
    [a * f + b * d * e, a * e - b * d * f, -b * c],
    [b * f - a * d * e, b * e + a * d * f, a * c],
  ];
}

/** AABB части с учётом её поворота (у цилиндра с taper > 1 поперечник = диаметр × taper). */
export function partBounds(part: Part): LocalBox {
  const rows = rotationRows(part.rotation);
  const [sx, sy, sz] = part.size;
  const half = (row: Vec3): number => {
    switch (part.shape) {
      case 'box':
      case 'plane':
        return (Math.abs(row[0]) * sx + Math.abs(row[1]) * sy + Math.abs(row[2]) * sz) / 2;
      case 'sphere':
        // Эллипсоид с полуосями size / 2.
        return Math.hypot(row[0] * sx, row[1] * sy, row[2] * sz) / 2;
      case 'cylinder': {
        // Ось — локальный Y; сечение — эллипс. Усечённый конус лежит внутри цилиндра по большему из радиусов.
        const k = Math.max(1, part.taper ?? 1);
        return (Math.abs(row[1]) * sy + Math.hypot(row[0] * sx * k, row[2] * sz * k)) / 2;
      }
      case 'torus': {
        // Кольцо в плоскости XY: окружность радиуса (D − t) / 2, «обутая» в трубку диаметра t.
        const tube = sz;
        const ring = Math.max(0, sx - tube);
        return (Math.hypot(row[0], row[1]) * ring + tube) / 2;
      }
    }
  };
  return {
    center: [part.position[0], part.position[1], part.position[2]],
    size: [2 * half(rows[0]), 2 * half(rows[1]), 2 * half(rows[2])],
  };
}

const boxesCache = new Map<string, readonly LocalBox[]>();

/**
 * Боксы для выбора мышью (мемоизация тем же ключом, что partsOf):
 *   item.pickBoxes?.(input) → иначе partBounds каждой не-additive части, если частей 1…200 → иначе [objectBox(o)].
 */
export function pickBoxes(o: SceneObject): readonly LocalBox[] {
  const key = buildKey(o);
  const cached = boxesCache.get(key);
  if (cached) {
    boxesCache.delete(key);
    boxesCache.set(key, cached);
    return cached;
  }
  let boxes: readonly LocalBox[] | undefined = getItem(o.type).pickBoxes?.(buildInput(o));
  if (!boxes || boxes.length === 0) {
    const solid = partsOf(o).filter((part) => !part.additive);
    boxes = solid.length >= 1 && solid.length <= 200 ? solid.map(partBounds) : [objectBox(o)];
  }
  boxesCache.set(key, boxes);
  if (boxesCache.size > BUILD_CACHE_SIZE) {
    const oldest = boxesCache.keys().next();
    if (!oldest.done) boxesCache.delete(oldest.value);
  }
  return boxes;
}
