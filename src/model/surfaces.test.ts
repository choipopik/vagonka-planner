import { describe, expect, it } from 'vitest';
import { makeContext } from './pose';
import { hitFloor, hitTops, hitWalls, rayPlaneY } from './surfaces';
import { testRoom } from './testRoom';
import type { Ray, SceneObject, Vec3 } from './types';

function ray(origin: Vec3, toward: Vec3): Ray {
  const d: Vec3 = [toward[0] - origin[0], toward[1] - origin[1], toward[2] - origin[2]];
  const len = Math.hypot(...d);
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

/** В тестовом каталоге опора — видимый стол на полу. */
const isSupport = (o: SceneObject) => o.type === 'table' && o.visible && o.mount.kind === 'floor';
const ctx = makeContext(testRoom, testRoom.fixtures);

describe('rayPlaneY', () => {
  it('попадание', () => {
    const p = rayPlaneY(ray([0, 5, 0], [3, 1, 4]), 1);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(3);
    expect(p![1]).toBe(1);
    expect(p![2]).toBeCloseTo(4);
  });

  it('параллельный луч → null', () => {
    expect(rayPlaneY({ origin: [0, 2, 0], dir: [1, 0, 0] }, 1)).toBeNull();
    expect(rayPlaneY({ origin: [0, 1, 0], dir: [0, 0, -1] }, 1)).toBeNull();
  });

  it('плоскость позади → null', () => {
    expect(rayPlaneY({ origin: [0, 2, 0], dir: [0, 1, 0] }, 1)).toBeNull();
    expect(rayPlaneY(ray([0, 0.5, 0], [1, 0, 1]), 1)).toBeNull();
  });

  it('луч снизу вверх попадает в плоскость над собой', () => {
    const p = rayPlaneY({ origin: [1, 0, 2], dir: [0, 1, 0] }, 3);
    expect(p).toEqual([1, 3, 2]);
  });
});

describe('hitFloor', () => {
  it('пол вне подиума — плоскость y = 0', () => {
    const hit = hitFloor(ray([3, 5, 1], [3, 0, 1]), testRoom);
    expect(hit).toEqual({ kind: 'floor', point: [3, 0, 1], distance: 5 });
  });

  it('над подиумом — его верх, а не пол под ним', () => {
    const hit = hitFloor({ origin: [-2, 5, -2], dir: [0, -1, 0] }, testRoom)!;
    expect(hit.point).toEqual([-2, 0.2, -2]);
    expect(hit.distance).toBeCloseTo(4.8);
    // Наклонный луч: пересечение с плоскостью подиума внутри его прямоугольника.
    const slanted = hitFloor(ray([2, 4, 2], [-1, 0.2, -1.5]), testRoom)!;
    expect(slanted.point[1]).toBe(0.2);
    expect(slanted.point[0]).toBeCloseTo(-1);
    expect(slanted.point[2]).toBeCloseTo(-1.5);
  });

  it('рядом с подиумом луч, чья точка на высоте подиума лежит вне его прямоугольника, попадает в пол', () => {
    const hit = hitFloor(ray([3, 4, 2], [0.5, 0, -2]), testRoom)!;
    expect(hit.point[1]).toBe(0);
    expect(hit.point[0]).toBeCloseTo(0.5);
    expect(hit.point[2]).toBeCloseTo(-2);
  });

  it('только при dir.y < 0; размерами помещения не ограничено', () => {
    expect(hitFloor({ origin: [0, 1, 0], dir: [1, 0, 0] }, testRoom)).toBeNull();
    expect(hitFloor({ origin: [0, 1, 0], dir: [0, 1, 0] }, testRoom)).toBeNull();
    const outside = hitFloor(ray([0, 2, 0], [50, 0, 0]), testRoom)!;
    expect(outside.point[0]).toBeCloseTo(50);
  });
});

describe('hitWalls', () => {
  it('луч изнутри попадает только в стену, к которой обращён', () => {
    const hits = hitWalls(ray([0, 1.5, 1], [0, 1.5, -3]), testRoom);
    expect(hits.map((h) => h.surfaceId)).toEqual(['far']);
    expect(hits[0].along).toBeCloseTo(5);
    expect(hits[0].y).toBeCloseTo(1.5);
    expect(hits[0].distance).toBeCloseTo(4);
    expect(hits[0].point[2]).toBeCloseTo(-3);
  });

  it('снаружи (облёт) ближняя стена пропускается: она обращена к лучу изнанкой', () => {
    // Камера за стеной 'near', смотрит в сторону дальней.
    const hits = hitWalls(ray([-3, 2, 9], [-3, 1, -3]), testRoom);
    expect(hits.map((h) => h.surfaceId)).toEqual(['far']);
    expect(hits[0].along).toBeCloseTo(2);
  });

  it('грань колонны, обращённая к лучу, ближе стены за ней; отсортировано от ближней к дальней', () => {
    const hits = hitWalls(ray([2, 1, 2.5], [2, 1, -3]), testRoom);
    expect(hits.map((h) => h.surfaceId)).toEqual(['col:s', 'far']);
    expect(hits[0].along).toBeCloseTo(0.4);
    expect(hits[0].distance).toBeCloseTo(2.2);
    expect(hits[1].distance).toBeCloseTo(5.5);
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
  });

  it('за пределами отрезка и выше потолка — мимо', () => {
    // Мимо колонны по X.
    expect(hitWalls(ray([3, 1, 2.5], [3, 1, -3]), testRoom).map((h) => h.surfaceId)).toEqual(['far']);
    // Точка пересечения с плоскостью стены выше потолка.
    expect(hitWalls(ray([0, 1, 2], [0, 6, -3]), testRoom)).toEqual([]);
    // И ниже пола.
    expect(hitWalls(ray([0, 1, 2], [0, -6, -3]), testRoom)).toEqual([]);
  });

  it('вертикальный луч плана не попадает ни в одну', () => {
    expect(hitWalls({ origin: [1, 10, 1], dir: [0, -1, 0] }, testRoom)).toEqual([]);
    expect(hitWalls({ origin: [5, 10, 0], dir: [0, -1, 0] }, testRoom)).toEqual([]);
  });

  it('диагональный луч: ближайшей оказывается та стена, в которую он действительно упирается', () => {
    const hits = hitWalls(ray([0, 1, 0], [-5, 1, -2]), testRoom);
    expect(hits[0].surfaceId).toBe('left');
    expect(hits[0].along).toBeCloseTo(5); // from слева: (−5, +3) → (−5, −3), точка z = −2
    // Плоскость дальней стены луч пересекает уже за пределами её отрезка.
    expect(hits.map((h) => h.surfaceId)).toEqual(['left']);
  });
});

describe('hitTops', () => {
  it('верх стола под лучом; (u, v) — в локальных координатах стола', () => {
    const hits = hitTops({ origin: [-1.7, 5, 1.2], dir: [0, -1, 0] }, ctx, isSupport);
    expect(hits).toHaveLength(1);
    expect(hits[0].hostId).toBe('venue-table');
    expect(hits[0].u).toBeCloseTo(0.3);
    expect(hits[0].v).toBeCloseTo(0.2);
    expect(hits[0].point).toEqual([-1.7, 0.75, 1.2]);
    expect(hits[0].distance).toBeCloseTo(4.25);
  });

  it('повёрнутый стол на подиуме: (u, v) учитывают поворот и высоту подиума', () => {
    // 'venue-table2': (−2, −2), π/2, 1.0 × 0.75 × 0.6 → в мире занимает 0.6 по X и 1.0 по Z.
    const hits = hitTops({ origin: [-1.9, 5, -2.3], dir: [0, -1, 0] }, ctx, isSupport);
    expect(hits).toHaveLength(1);
    expect(hits[0].hostId).toBe('venue-table2');
    expect(hits[0].u).toBeCloseTo(0.3);
    expect(hits[0].v).toBeCloseTo(0.1);
    expect(hits[0].point[1]).toBeCloseTo(0.95);
    // Точка внутри неповёрнутого прямоугольника 1.0 × 0.6, но вне повёрнутого — мимо.
    expect(hitTops({ origin: [-1.55, 5, -2], dir: [0, -1, 0] }, ctx, isSupport)).toEqual([]);
    // А вдоль мировой Z стол длиннее.
    expect(hitTops({ origin: [-2, 5, -2.45], dir: [0, -1, 0] }, ctx, isSupport)).toHaveLength(1);
  });

  it('не-опоры пропускаются: диван вокруг стола не перехватывает луч', () => {
    // Над сиденьем кабинки, мимо стола.
    expect(hitTops({ origin: [-3.2, 5, 1.3], dir: [0, -1, 0] }, ctx, isSupport)).toEqual([]);
  });

  it('exclude пропускает перечисленные id', () => {
    const down: Ray = { origin: [-2, 5, 1], dir: [0, -1, 0] };
    expect(hitTops(down, ctx, isSupport).map((h) => h.hostId)).toEqual(['venue-table']);
    expect(hitTops(down, ctx, isSupport, new Set(['venue-table']))).toEqual([]);
    expect(hitTops(down, ctx, isSupport, new Set(['venue-table2'])).map((h) => h.hostId)).toEqual(['venue-table']);
  });

  it('только при dir.y < 0', () => {
    expect(hitTops({ origin: [-2, 0.1, 1], dir: [0, 1, 0] }, ctx, isSupport)).toEqual([]);
    expect(hitTops({ origin: [-5, 0.75, 1], dir: [1, 0, 0] }, ctx, isSupport)).toEqual([]);
  });

  it('два стола на одном луче — от ближнего к дальнему', () => {
    // Второй стол-опора висит над первым: вертикальный луч сначала встречает его столешницу.
    const high: SceneObject = {
      ...testRoom.fixtures[0],
      id: 'high',
      mount: { kind: 'floor', x: -2, z: 1, lift: 1 },
    };
    const both = makeContext(testRoom, [...testRoom.fixtures, high]);
    const hits = hitTops({ origin: [-2, 5, 1], dir: [0, -1, 0] }, both, isSupport);
    expect(hits.map((h) => h.hostId)).toEqual(['high', 'venue-table']);
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
  });
});
