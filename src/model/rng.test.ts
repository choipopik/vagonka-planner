import { describe, expect, it } from 'vitest';
import { createRng, hashString, valueNoise2 } from './rng';

describe('createRng', () => {
  it('детерминизм: один seed → одна последовательность', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    // Эталон mulberry32(42): последовательность одинакова на любой машине.
    const fresh = createRng(42);
    expect(fresh.next()).toBeCloseTo(0.6011037519201636, 15);
    expect(fresh.next()).toBeCloseTo(0.44829055899754167, 15);
  });

  it('разные seed → разные последовательности', () => {
    const a = Array.from({ length: 10 }, createRng(1).next);
    const b = Array.from({ length: 10 }, createRng(2).next);
    expect(a).not.toEqual(b);
  });

  it('границы: next ∈ [0, 1), range ∈ [a, b), int — целое в [a, b]', () => {
    const rng = createRng(7);
    const ints = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const r = rng.range(-2, 3.5);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(3.5);
      const k = rng.int(3, 6);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(6);
      ints.add(k);
    }
    // Обе границы int достижимы.
    expect([...ints].sort()).toEqual([3, 4, 5, 6]);
    expect(createRng(1).int(5, 5)).toBe(5);
  });

  it('pick возвращает элемент списка', () => {
    const rng = createRng(3);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('shuffle — перестановка на копии', () => {
    const rng = createRng(11);
    const items = Array.from({ length: 25 }, (_, i) => i);
    const frozen = items.slice();
    const shuffled = rng.shuffle(items);
    expect(items).toEqual(frozen); // вход не тронут
    expect(shuffled).not.toBe(items);
    expect(shuffled).toHaveLength(items.length);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items); // 25! вариантов — совпадение невозможно
    expect(createRng(11).shuffle(items)).toEqual(shuffled); // и детерминирована
    expect(rng.shuffle([])).toEqual([]);
  });

  it('seed не обязан быть целым или положительным', () => {
    for (const seed of [-1, 0.5, 1e12, NaN]) {
      const n = createRng(seed).next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('hashString', () => {
  it('стабильный 32-битный FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
    expect(hashString('Хогвартс')).toBe(hashString('Хогвартс'));
    expect(hashString('Хогвартс')).not.toBe(hashString('Хогсмид'));
    const h = hashString('любой текст');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('valueNoise2', () => {
  it('∈ [0, 1] и детерминирован для (x, z, seed)', () => {
    const rng = createRng(5);
    for (let i = 0; i < 2000; i++) {
      const x = rng.range(-50, 50);
      const z = rng.range(-50, 50);
      const seed = rng.int(0, 1000);
      const n = valueNoise2(x, z, seed);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(valueNoise2(x, z, seed)).toBe(n);
    }
  });

  it('гладкий: близкие точки дают близкие значения, а разные seed — разный рисунок', () => {
    for (const [x, z] of [[0.3, 0.7], [1.999, -3.2], [-7.5, 4.001]]) {
      expect(Math.abs(valueNoise2(x, z, 9) - valueNoise2(x + 1e-4, z + 1e-4, 9))).toBeLessThan(1e-3);
    }
    // Непрерывность на границе ячейки решётки.
    expect(Math.abs(valueNoise2(2 - 1e-9, 0.5, 9) - valueNoise2(2 + 1e-9, 0.5, 9))).toBeLessThan(1e-6);
    const a = Array.from({ length: 20 }, (_, i) => valueNoise2(i * 0.73, i * 0.41, 1));
    const b = Array.from({ length: 20 }, (_, i) => valueNoise2(i * 0.73, i * 0.41, 2));
    expect(a).not.toEqual(b);
    // И не константа.
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.2);
  });
});
