export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [a, b) */
  range(a: number, b: number): number;
  /** Целое в [a, b]. */
  int(a: number, b: number): number;
  pick<T>(items: readonly T[]): T;
  /** Фишер–Йетс на копии. */
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32: один seed → одна последовательность на любой машине. */
export function createRng(seed: number): Rng {
  // Любое число (дробное, отрицательное, NaN) сводится к 32-битному беззнаковому состоянию.
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a: number, b: number): number => {
    const lo = Math.ceil(Math.min(a, b));
    const hi = Math.floor(Math.max(a, b));
    return lo + Math.floor(next() * (hi - lo + 1));
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },
  };
}

/** Стабильный 32-битный хэш строки (FNV-1a) — для сидов из текста. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Псевдослучайное значение [0, 1) в узле целочисленной решётки. */
function lattice(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Гладкий 2D value-noise в [0, 1], детерминированный для (x, z, seed). */
export function valueNoise2(x: number, z: number, seed: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0.5;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // smoothstep — без изломов на границах ячеек.
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const s = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const a = lattice(ix, iz, s);
  const b = lattice(ix + 1, iz, s);
  const c = lattice(ix, iz + 1, s);
  const d = lattice(ix + 1, iz + 1, s);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return Math.min(1, Math.max(0, top + (bottom - top) * sz));
}
