import { describe, expect, it } from 'vitest';
import { boxEdges, gridLines, isLightColor, plumbLine, rectEdges } from './overlayGeometry';

/** Отрезки [x1, y1, z1, x2, y2, z2] из плоского массива вершин. */
function segments(positions: Float32Array): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < positions.length; i += 6) result.push(Array.from(positions.subarray(i, i + 6)));
  return result;
}

describe('boxEdges', () => {
  it('12 рёбер в габарите [−w/2, w/2] × [0, h] × [−d/2, d/2]', () => {
    const { positions, distances } = boxEdges([2, 1, 4]);
    expect(positions).toHaveLength(12 * 6);
    expect(distances).toHaveLength(12 * 2);
    const lengths = { x: 0, y: 0, z: 0 };
    for (const [x1, y1, z1, x2, y2, z2] of segments(positions)) {
      for (const [x, y, z] of [[x1, y1, z1], [x2, y2, z2]]) {
        expect(Math.abs(x)).toBe(1);
        expect([0, 1]).toContain(y);
        expect(Math.abs(z)).toBe(2);
      }
      // Каждое ребро параллельно ровно одной оси.
      const delta = [Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(z2 - z1)];
      expect(delta.filter((v) => v > 0)).toHaveLength(1);
      if (delta[0] > 0) lengths.x++;
      if (delta[1] > 0) lengths.y++;
      if (delta[2] > 0) lengths.z++;
    }
    expect(lengths).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('расстояния для пунктира: 0 в начале ребра, длина ребра в конце', () => {
    const { positions, distances } = boxEdges([2, 1, 4]);
    segments(positions).forEach(([x1, y1, z1, x2, y2, z2], i) => {
      expect(distances[i * 2]).toBe(0);
      expect(distances[i * 2 + 1]).toBeCloseTo(Math.hypot(x2 - x1, y2 - y1, z2 - z1), 6);
    });
  });
});

describe('rectEdges и plumbLine', () => {
  it('замкнутый прямоугольник w × d в плоскости y = 0', () => {
    const { positions } = rectEdges(3, 1);
    const list = segments(positions);
    expect(list).toHaveLength(4);
    list.forEach((segment, i) => {
      const next = list[(i + 1) % 4];
      expect(segment.slice(3)).toEqual(next.slice(0, 3));
      expect(segment[1]).toBe(0);
      expect(Math.abs(segment[0])).toBe(1.5);
      expect(Math.abs(segment[2])).toBe(0.5);
    });
  });

  it('отвес — вертикальный отрезок от нуля; отрицательная длина → 0', () => {
    expect(Array.from(plumbLine(2.5).positions)).toEqual([0, 0, 0, 0, 2.5, 0]);
    expect(Array.from(plumbLine(2.5).distances)).toEqual([0, 2.5]);
    expect(Array.from(plumbLine(-1).positions)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('gridLines', () => {
  it('линии проходят через кратные шагу координаты — те же, к которым привязывается перетаскивание', () => {
    // Помещение 10 × 6: x от −5 до 5 (11 линий), z от −3 до 3 (7 линий).
    const list = segments(gridLines([-5, -3], [5, 3], 1, 0.005));
    expect(list).toHaveLength(11 + 7);
    const alongZ = list.filter((s) => s[0] === s[3]);
    const alongX = list.filter((s) => s[2] === s[5]);
    expect(alongZ.map((s) => s[0])).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(alongX.map((s) => s[2])).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    for (const s of alongZ) expect([s[2], s[5]]).toEqual([-3, 3]);
    for (const s of alongX) expect([s[0], s[3]]).toEqual([-5, 5]);
    for (const s of list) expect([s[1], s[4]]).toEqual([Math.fround(0.005), Math.fround(0.005)]);
  });

  it('прямоугольник не по сетке: только линии внутри него', () => {
    const list = segments(gridLines([-0.3, 0.2], [1.2, 0.9], 0.5, 0));
    // x: 0, 0.5, 1; z: 0.5.
    expect(list.filter((s) => s[0] === s[3]).map((s) => s[0])).toEqual([0, 0.5, 1]);
    expect(list.filter((s) => s[2] === s[5]).map((s) => s[2])).toEqual([0.5]);
  });

  it('skipEvery пропускает линии, которые рисует крупная сетка', () => {
    const fine = segments(gridLines([0, 0], [1, 1], 0.1, 0, 10));
    // По каждой оси 11 кратных 0.1, из них 0 и 1 — метровые.
    expect(fine).toHaveLength(9 + 9);
    for (const s of fine.filter((x) => x[0] === x[3])) expect(Math.abs(s[0] - Math.round(s[0]))).toBeGreaterThan(0.05);
  });

  it('граница, кратная шагу с двоичным хвостом, не теряется', () => {
    // 0.1 × 3 = 0.30000000000000004: линия на правой границе 0.3 должна остаться.
    const list = segments(gridLines([0, 0], [0.3, 0.1], 0.1, 0));
    expect(list.filter((s) => s[0] === s[3])).toHaveLength(4);
  });

  it('вырожденные входы → пусто', () => {
    expect(gridLines([0, 0], [1, 1], 0, 0)).toHaveLength(0);
    expect(gridLines([1, 0], [1, 1], 0.5, 0)).toHaveLength(0);
    expect(gridLines([0, 2], [1, 1], 0.5, 0)).toHaveLength(0);
  });
});

describe('isLightColor', () => {
  it('по яркости выбирается тон сетки', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#b3aa9b')).toBe(true);
    expect(isLightColor('#3a2a28')).toBe(false);
    expect(isLightColor('#000000')).toBe(false);
    // Не цвет — считаем поверхность светлой.
    expect(isLightColor('red')).toBe(true);
  });
});
