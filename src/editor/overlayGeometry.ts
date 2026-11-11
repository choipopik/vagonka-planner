// Вершины линий для оверлеев редактора (каркасы, проекции, сетки). Чистые функции: массивы чисел, без three.
import type { Vec2, Vec3 } from '../model/types';

/** Отрезки для <lineSegments>: пары вершин; distances — расстояние вдоль своего отрезка (нужно пунктирному материалу). */
export interface LineData {
  positions: Float32Array;
  distances: Float32Array;
}

function build(segments: readonly [Vec3, Vec3][]): LineData {
  const positions = new Float32Array(segments.length * 6);
  const distances = new Float32Array(segments.length * 2);
  segments.forEach(([a, b], i) => {
    positions.set(a, i * 6);
    positions.set(b, i * 6 + 3);
    distances[i * 2 + 1] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  });
  return { positions, distances };
}

/** 12 рёбер габаритного бокса в локальных координатах объекта: [−w/2, w/2] × [0, h] × [−d/2, d/2]. */
export function boxEdges(size: Vec3): LineData {
  const x = size[0] / 2;
  const h = size[1];
  const z = size[2] / 2;
  const segments: [Vec3, Vec3][] = [];
  for (const y of [0, h]) {
    for (const s of [-1, 1]) {
      segments.push([[-x, y, s * z], [x, y, s * z]]);
      segments.push([[s * x, y, -z], [s * x, y, z]]);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) segments.push([[sx * x, 0, sz * z], [sx * x, h, sz * z]]);
  return build(segments);
}

/** Прямоугольник w × d в плоскости y = 0 с центром в начале координат (проекция объекта на пол). */
export function rectEdges(w: number, d: number): LineData {
  const x = w / 2;
  const z = d / 2;
  return build([
    [[-x, 0, -z], [x, 0, -z]],
    [[x, 0, -z], [x, 0, z]],
    [[x, 0, z], [-x, 0, z]],
    [[-x, 0, z], [-x, 0, -z]],
  ]);
}

/** Вертикальный отрезок от (0, 0, 0) вверх на length (отвес). */
export function plumbLine(length: number): LineData {
  return build([[[0, 0, 0], [0, Math.max(0, length), 0]]]);
}

/** Допуск на двоичный хвост при делении координаты на шаг. */
const EPS = 1e-9;

/**
 * Линии сетки на высоте y внутри прямоугольника min…max (мировые X/Z). Линии проходят через кратные step координаты —
 * те же, к которым привязывает snapMount. skipEvery: пропустить каждую n-ю линию (их рисует более крупная сетка).
 */
export function gridLines(min: Vec2, max: Vec2, step: number, y: number, skipEvery?: number): Float32Array {
  if (!(step > 0) || !(max[0] > min[0]) || !(max[1] > min[1])) return new Float32Array(0);
  const values: number[] = [];
  const skipped = (k: number) => skipEvery !== undefined && skipEvery > 0 && k % skipEvery === 0;
  for (let k = Math.ceil(min[0] / step - EPS); k <= Math.floor(max[0] / step + EPS); k++) {
    if (skipped(k)) continue;
    const x = k * step + 0; // + 0 превращает −0 в 0
    values.push(x, y, min[1], x, y, max[1]);
  }
  for (let k = Math.ceil(min[1] / step - EPS); k <= Math.floor(max[1] / step + EPS); k++) {
    if (skipped(k)) continue;
    const z = k * step + 0;
    values.push(min[0], y, z, max[0], y, z);
  }
  return new Float32Array(values);
}

/** Светлая ли поверхность цвета '#rrggbb' (по ней выбирается тёмная или светлая сетка). Не цвет → true. */
export function isLightColor(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return true;
  const n = parseInt(hex.slice(1), 16);
  const luminance = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance > 110;
}
