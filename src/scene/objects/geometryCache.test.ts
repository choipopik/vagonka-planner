// Договор о развёртке Part.paint (2.14): как canvas painter’а ложится на единичные геометрии.
import type { BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { getGeometry } from './geometryCache';

interface Vertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  nx: number;
  ny: number;
  nz: number;
}

function vertices(geometry: BufferGeometry): Vertex[] {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  const list: Vertex[] = [];
  for (let i = 0; i < position.count; i++) {
    list.push({
      x: position.getX(i),
      y: position.getY(i),
      z: position.getZ(i),
      u: uv.getX(i),
      v: uv.getY(i),
      nx: normal.getX(i),
      ny: normal.getY(i),
      nz: normal.getZ(i),
    });
  }
  return list;
}

function extreme(list: Vertex[], score: (vertex: Vertex) => number): Vertex {
  return list.reduce((best, vertex) => (score(vertex) > score(best) ? vertex : best));
}

function triangles(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

function extent(geometry: BufferGeometry): { min: number[]; max: number[] } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('нет габарита');
  return { min: box.min.toArray(), max: box.max.toArray() };
}

/** Вершины боковой поверхности: нормаль горизонтальна (у крышек цилиндра она вертикальна). */
function side(list: Vertex[]): Vertex[] {
  return list.filter((vertex) => Math.abs(vertex.ny) < 0.5);
}

describe('getGeometry: синглтоны', () => {
  it('один ключ — один объект', () => {
    for (const key of ['box', 'plane', 'cylinder:1', 'cylinder:0.5', 'cylinder:0', 'sphere', 'sphere:uv', 'torus:0.10']) {
      expect(getGeometry(key)).toBe(getGeometry(key));
    }
    expect(getGeometry('cylinder:1')).not.toBe(getGeometry('cylinder:0.5'));
    expect(getGeometry('sphere')).not.toBe(getGeometry('sphere:uv'));
  });

  it('у каждой геометрии посчитаны габаритная сфера и бокс', () => {
    for (const key of ['box', 'plane', 'cylinder:1', 'sphere', 'sphere:uv', 'torus:0.10']) {
      const geometry = getGeometry(key);
      expect(geometry.boundingSphere).not.toBeNull();
      expect(geometry.boundingBox).not.toBeNull();
    }
  });

  it('неизвестный ключ → бокс и одно предупреждение', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const geometry = getGeometry('prism');
      expect(getGeometry('prism')).toBe(geometry);
      expect(extent(geometry)).toEqual({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getGeometry: единичные размеры', () => {
  it('box — куб 1³ с центром в нуле', () => {
    expect(extent(getGeometry('box'))).toEqual({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
  });

  it('plane — 1 × 1 в плоскости XY лицом в +Z', () => {
    const geometry = getGeometry('plane');
    expect(extent(geometry)).toEqual({ min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] });
    for (const vertex of vertices(geometry)) expect([vertex.nx, vertex.ny, vertex.nz]).toEqual([0, 0, 1]);
  });

  it('cylinder — радиус 0.5, высота 1, 20 сегментов; верх = 0.5 · taper', () => {
    const full = extent(getGeometry('cylinder:1'));
    for (let axis = 0; axis < 3; axis++) {
      expect(full.min[axis]).toBeCloseTo(-0.5, 6);
      expect(full.max[axis]).toBeCloseTo(0.5, 6);
    }
    const radiusAt = (key: string, y: number) =>
      Math.max(...vertices(getGeometry(key)).filter((v) => Math.abs(v.y - y) < 1e-6).map((v) => Math.hypot(v.x, v.z)));
    expect(radiusAt('cylinder:1', 0.5)).toBeCloseTo(0.5, 6);
    expect(radiusAt('cylinder:0.5', 0.5)).toBeCloseTo(0.25, 6);
    expect(radiusAt('cylinder:0.5', -0.5)).toBeCloseTo(0.5, 6);
    expect(radiusAt('cylinder:0', 0.5)).toBeCloseTo(0, 6);
    // 20 сегментов: 21 вершина на каждом из двух колец боковой поверхности.
    expect(side(vertices(getGeometry('cylinder:1')))).toHaveLength(42);
  });

  it('sphere — икосфера радиуса 0.5, 320 треугольников; sphere:uv — 20 × 12 сегментов', () => {
    const ico = getGeometry('sphere');
    expect(triangles(ico)).toBe(320);
    for (const vertex of vertices(ico)) expect(Math.hypot(vertex.x, vertex.y, vertex.z)).toBeCloseTo(0.5, 6);

    const uv = getGeometry('sphere:uv');
    expect(vertices(uv)).toHaveLength(21 * 13);
    for (const vertex of vertices(uv)) expect(Math.hypot(vertex.x, vertex.y, vertex.z)).toBeCloseTo(0.5, 6);
  });

  it('torus — внешний диаметр 1, кольцо в плоскости XY, трубка t / D', () => {
    const thin = extent(getGeometry('torus:0.10'));
    expect(thin.max[0]).toBeCloseTo(0.5, 6);
    expect(thin.min[0]).toBeCloseTo(-0.5, 6);
    expect(thin.max[1]).toBeCloseTo(0.5, 2);
    // Сечение трубки — многоугольник: его вершины не обязаны попадать точно на ±t / 2.
    expect(thin.max[2]).toBeCloseTo(0.05, 2);
    expect(thin.min[2]).toBeCloseTo(-0.05, 2);

    const thick = extent(getGeometry('torus:0.40'));
    expect(thick.max[0]).toBeCloseTo(0.5, 6);
    expect(thick.max[2]).toBeCloseTo(0.2, 1);
  });
});

describe('getGeometry: договор о развёртке', () => {
  for (const key of ['cylinder:1', 'sphere:uv']) {
    it(`${key}: центр canvas (u = 0.5) смотрит в +Z, u растёт от −X к +X`, () => {
      const list = side(vertices(getGeometry(key)));
      expect(extreme(list, (v) => v.z).u).toBeCloseTo(0.5, 6);
      expect(extreme(list, (v) => -v.x).u).toBeCloseTo(0.25, 6);
      expect(extreme(list, (v) => v.x).u).toBeCloseTo(0.75, 6);
    });

    it(`${key}: шов (u = 0 и u = 1) — сзади, на −Z`, () => {
      const list = side(vertices(getGeometry(key)));
      const back = extreme(list, (v) => -v.z);
      expect(Math.min(back.u, 1 - back.u)).toBeCloseTo(0, 6);
      for (const vertex of list.filter((v) => v.u < 1e-6 || v.u > 1 - 1e-6)) {
        expect(vertex.x).toBeCloseTo(0, 6);
        expect(vertex.z).toBeLessThanOrEqual(1e-6);
      }
    });

    it(`${key}: верх canvas (v = 1) — локальный +Y`, () => {
      // Все вершины: у сферы верх и низ canvas — полюса, их нормали вертикальны.
      const list = vertices(getGeometry(key)).filter((v) => key === 'sphere:uv' || Math.abs(v.ny) < 0.5);
      expect(extreme(list, (v) => v.y).v).toBeCloseTo(1, 6);
      expect(extreme(list, (v) => -v.y).v).toBeCloseTo(0, 6);
    });

    it(`${key}: нормали после поворота смотрят наружу`, () => {
      for (const vertex of side(vertices(getGeometry(key)))) {
        expect(vertex.nx * vertex.x + vertex.nz * vertex.z).toBeGreaterThanOrEqual(-1e-6);
      }
    });
  }

  it('сужающийся цилиндр (cylinder:0.5) развёрнут так же', () => {
    const list = side(vertices(getGeometry('cylinder:0.5')));
    expect(extreme(list, (v) => v.z).u).toBeCloseTo(0.5, 6);
    expect(extreme(list, (v) => -v.x).u).toBeCloseTo(0.25, 6);
    expect(extreme(list, (v) => v.x).u).toBeCloseTo(0.75, 6);
  });

  it('plane: левый край (x = −0.5) — u = 0, правый — u = 1, верх — v = 1', () => {
    const list = vertices(getGeometry('plane'));
    for (const vertex of list) {
      expect(vertex.u).toBeCloseTo(vertex.x + 0.5, 9);
      expect(vertex.v).toBeCloseTo(vertex.y + 0.5, 9);
    }
    expect(list.filter((v) => v.x === -0.5).every((v) => v.u === 0)).toBe(true);
    expect(list.filter((v) => v.x === -0.5).length).toBeGreaterThan(0);
  });

  it('box: на грани +Z canvas лежит как на plane', () => {
    const front = vertices(getGeometry('box')).filter((v) => v.nz > 0.5);
    expect(front).toHaveLength(4);
    for (const vertex of front) {
      expect(vertex.u).toBeCloseTo(vertex.x + 0.5, 9);
      expect(vertex.v).toBeCloseTo(vertex.y + 0.5, 9);
    }
  });

  it('box: каждая из шести граней получает весь canvas', () => {
    const list = vertices(getGeometry('box'));
    const normals: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [nx, ny, nz] of normals) {
      const face = list.filter((v) => v.nx === nx && v.ny === ny && v.nz === nz);
      expect(face).toHaveLength(4);
      expect(new Set(face.map((v) => `${v.u},${v.v}`))).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    }
  });
});
