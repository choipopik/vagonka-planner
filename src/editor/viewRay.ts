// Мост «камера three.js → луч модели»: единственное место пакета, где экранные координаты превращаются в Ray.
import { Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, OrthographicCamera, PerspectiveCamera } from 'three';
import type { Ray, Vec3 } from '../model/types';

const raycaster = new Raycaster();
const ndc = new Vector2();
const forward = new Vector3();

/** Луч текущей камеры через точку в NDC (−1…1 по обеим осям). Raycaster.setFromCamera годится для обеих камер. */
export function rayThroughNdc(camera: Camera, x: number, y: number): Ray {
  // Матрицу камеры обновляет рендер; между кадрами (сразу после смены режима) она могла устареть.
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc.set(x, y), camera);
  const { origin, direction } = raycaster.ray;
  return { origin: [origin.x, origin.y, origin.z], dir: [direction.x, direction.y, direction.z] };
}

/** Прямоугольник вьюпорта в координатах клиента (getBoundingClientRect обёртки Canvas). */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Луч под указателем; null — вьюпорт нулевого размера. */
export function viewRay(camera: Camera, rect: ViewRect, clientX: number, clientY: number): Ray | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((clientY - rect.top) / rect.height) * 2;
  return rayThroughNdc(camera, x, y);
}

/**
 * Сколько метров сцены приходится на один CSS-пиксель на расстоянии distance от камеры:
 * ортографическая — (top − bottom) / zoom / высота (у drei это 1 / zoom); перспективная — 2·distance·tan(fov/2) / высота.
 */
export function unitsPerPixel(camera: Camera, viewportHeight: number, distance: number): number {
  if (!(viewportHeight > 0)) return 0;
  const ortho = camera as OrthographicCamera;
  if (ortho.isOrthographicCamera) return (ortho.top - ortho.bottom) / ortho.zoom / viewportHeight;
  const persp = camera as PerspectiveCamera;
  if (persp.isPerspectiveCamera) {
    const span = 2 * Math.max(0, distance) * Math.tan((persp.fov * Math.PI) / 360);
    return span / persp.zoom / viewportHeight;
  }
  return 0;
}

/** Глубина точки вдоль взгляда камеры (для перспективной камеры от неё зависит экранный масштаб). */
export function viewDepth(camera: Camera, point: Vec3): number {
  camera.getWorldDirection(forward);
  const p = camera.position;
  return (point[0] - p.x) * forward.x + (point[1] - p.y) * forward.y + (point[2] - p.z) * forward.z;
}

/** Метров на пиксель в точке сцены: по этому числу ручки и рисуются, и выбираются. */
export function unitsPerPixelAt(camera: Camera, viewportHeight: number, point: Vec3): number {
  return unitsPerPixel(camera, viewportHeight, viewDepth(camera, point));
}
