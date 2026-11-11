import { OrthographicCamera, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { rayPlaneY } from '../model/surfaces';
import { rayThroughNdc, unitsPerPixel, unitsPerPixelAt, viewDepth, viewRay } from './viewRay';

const RECT = { left: 100, top: 50, width: 800, height: 600 };

/** Камера плана, как в TopMode: строго сверху, дальняя стена (−Z) — вверху экрана; zoom — пикселей на метр. */
function topCamera(zoom = 50): OrthographicCamera {
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 200);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.zoom = zoom;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

/** Камера облёта: смотрит из (0, 6, 9) в точку (0, 1, 0). */
function orbitCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 200);
  camera.position.set(0, 6, 9);
  camera.lookAt(0, 1, 0);
  camera.updateProjectionMatrix();
  return camera;
}

describe('viewRay: план (ортографическая камера)', () => {
  it('луч идёт строго вниз из точки над курсором; экранный верх — мировой −Z', () => {
    const camera = topCamera(50);
    const center = viewRay(camera, RECT, 100 + 400, 50 + 300);
    expect(center).not.toBeNull();
    if (!center) return;
    expect(center.dir[0]).toBeCloseTo(0, 9);
    expect(center.dir[1]).toBeCloseTo(-1, 9);
    expect(center.dir[2]).toBeCloseTo(0, 9);
    expect(center.origin[0]).toBeCloseTo(0, 6);
    expect(center.origin[2]).toBeCloseTo(0, 6);
    expect(center.origin[1]).toBeGreaterThan(40);

    // 150 px вправо и 50 px вниз при 50 px/м → мировые (+3, +1).
    const r = viewRay(camera, RECT, 100 + 400 + 150, 50 + 300 + 50);
    expect(r?.origin[0]).toBeCloseTo(3, 6);
    expect(r?.origin[2]).toBeCloseTo(1, 6);
    expect(r?.dir[1]).toBeCloseTo(-1, 9);
  });

  it('учитывает сдвиг камеры (панорамирование плана) и масштаб', () => {
    const camera = topCamera(100);
    camera.position.set(2, 50, -1);
    const r = viewRay(camera, RECT, 100 + 400 + 100, 50 + 300 - 200);
    expect(r?.origin[0]).toBeCloseTo(3, 6);
    expect(r?.origin[2]).toBeCloseTo(-3, 6);
  });
});

describe('viewRay: облёт (перспективная камера)', () => {
  it('луч через центр вьюпорта выходит из камеры и проходит через цель', () => {
    const camera = orbitCamera();
    const r = viewRay(camera, RECT, 100 + 400, 50 + 300);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.origin).toEqual([0, 6, 9]);
    expect(Math.hypot(...r.dir)).toBeCloseTo(1, 9);
    // Направление на (0, 1, 0).
    const len = Math.hypot(0, -5, -9);
    expect(r.dir[0]).toBeCloseTo(0, 9);
    expect(r.dir[1]).toBeCloseTo(-5 / len, 9);
    expect(r.dir[2]).toBeCloseTo(-9 / len, 9);
    expect(rayThroughNdc(camera, 0, 0)).toEqual(r);
  });

  it('правее на экране — больше X на полу, ниже на экране — ближе к камере', () => {
    const camera = orbitCamera();
    const floor = (x: number, y: number) => {
      const r = viewRay(camera, RECT, x, y);
      const p = r ? rayPlaneY(r, 0) : null;
      expect(p).not.toBeNull();
      return p as [number, number, number];
    };
    const center = floor(500, 350);
    expect(floor(700, 350)[0]).toBeGreaterThan(center[0] + 0.5);
    expect(floor(300, 350)[0]).toBeLessThan(center[0] - 0.5);
    expect(floor(500, 550)[2]).toBeGreaterThan(center[2] + 0.5);
    expect(floor(500, 250)[2]).toBeLessThan(center[2] - 0.5);
  });

  it('вьюпорт нулевого размера → null', () => {
    expect(viewRay(orbitCamera(), { left: 0, top: 0, width: 0, height: 600 }, 10, 10)).toBeNull();
    expect(viewRay(orbitCamera(), { left: 0, top: 0, width: 800, height: 0 }, 10, 10)).toBeNull();
  });
});

describe('unitsPerPixel', () => {
  it('ортографическая камера: 1 / zoom, расстояние не влияет', () => {
    const camera = topCamera(50);
    expect(unitsPerPixel(camera, 600, 1)).toBeCloseTo(1 / 50, 12);
    expect(unitsPerPixel(camera, 600, 40)).toBeCloseTo(1 / 50, 12);
    expect(unitsPerPixelAt(camera, 600, [3, 0, 1])).toBeCloseTo(1 / 50, 12);
  });

  it('перспективная камера: 2·distance·tan(fov/2) / высота вьюпорта', () => {
    const camera = orbitCamera();
    const expected = (2 * 10 * Math.tan((50 * Math.PI) / 360)) / 600;
    expect(unitsPerPixel(camera, 600, 10)).toBeCloseTo(expected, 12);
    expect(unitsPerPixel(camera, 600, 20)).toBeCloseTo(2 * expected, 12);
    // Позади камеры и при нулевом вьюпорте масштаба нет.
    expect(unitsPerPixel(camera, 600, -3)).toBe(0);
    expect(unitsPerPixel(camera, 0, 10)).toBe(0);
  });

  it('в точке сцены масштаб считается по глубине вдоль взгляда', () => {
    const camera = orbitCamera();
    const depth = Math.hypot(5, 9);
    expect(viewDepth(camera, [0, 1, 0])).toBeCloseTo(depth, 9);
    expect(unitsPerPixelAt(camera, 600, [0, 1, 0])).toBeCloseTo(unitsPerPixel(camera, 600, depth), 12);
    // Точка в стороне на той же глубине даёт тот же масштаб (а евклидово расстояние до неё больше).
    expect(viewDepth(camera, [4, 1, 0])).toBeCloseTo(depth, 9);
    // 9 px ручки на этой глубине — несколько сантиметров.
    const radius = 9 * unitsPerPixelAt(camera, 600, [0, 1, 0]);
    expect(radius).toBeGreaterThan(0.05);
    expect(radius).toBeLessThan(0.3);
  });
});
