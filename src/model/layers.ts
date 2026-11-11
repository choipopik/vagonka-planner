import { wallFrame } from './geometry';
import type { WallSurface } from './geometry';
import type { CameraMode, LayerMode, SceneObject, Vec3 } from './types';

/** Непрозрачность декора-призрака (потолочного при виде сверху, настенного при виде со спины). */
export const GHOST_OPACITY = 0.3;

/** Что сейчас «в фокусе». both — всё сплошное и выбирается. */
export type LayerView = 'both' | 'floor' | 'ceiling';

/** top → true; orbit → cameraY > roomHeight; walk → false. */
export function isViewFromAbove(mode: CameraMode, cameraY: number, roomHeight: number): boolean {
  if (mode === 'top') return true;
  if (mode === 'orbit') return cameraY > roomHeight;
  return false;
}

/**
 * walk → 'both' всегда.
 * layer 'floor' → 'floor'; layer 'ceiling' → 'ceiling';
 * layer 'auto' → viewFromAbove ? 'floor' : 'both'.
 */
export function layerView(layer: LayerMode, mode: CameraMode, viewFromAbove: boolean): LayerView {
  if (mode === 'walk') return 'both';
  if (layer === 'floor') return 'floor';
  if (layer === 'ceiling') return 'ceiling';
  return viewFromAbove ? 'floor' : 'both';
}

/**
 * id поверхностей wallSurfaces(room), на которые камера смотрит С ИЗНАНКИ (их плоскости отсечены, а декор на них
 * повёрнут к камере спиной): mode 'orbit' и dot([camera.x − from.x, camera.z − from.z], normal) < 0.
 * mode 'top' и 'walk' → []. Порядок — как в surfaces. С камерой внутри помещения это только дальние грани колонн.
 */
export function backSurfaces(mode: CameraMode, camera: Vec3, surfaces: readonly WallSurface[]): string[] {
  if (mode !== 'orbit') return [];
  const back: string[] = [];
  for (const s of surfaces) {
    const { normal } = wallFrame(s);
    if ((camera[0] - s.from[0]) * normal[0] + (camera[2] - s.from[1]) * normal[1] < 0) back.push(s.id);
  }
  return back;
}

/** Настенный объект, чья поверхность есть в back. */
export function isOnBackSurface(o: SceneObject, back: readonly string[]): boolean {
  return o.mount.kind === 'wall' && back.includes(o.mount.surfaceId);
}

/**
 * Рисовать призраком (кроме выбранного — он всегда сплошной):
 *   потолочный объект при view === 'floor'  ИЛИ  isOnBackSurface(o, back).
 */
export function isGhosted(o: SceneObject, view: LayerView, back: readonly string[], selectedId: string | null): boolean {
  if (o.id === selectedId) return false;
  return (o.mount.kind === 'ceiling' && view === 'floor') || isOnBackSurface(o, back);
}

/**
 * Можно выбрать мышью: o.visible && !o.locked && (
 *   o.id === selectedId ||
 *   (!isOnBackSurface(o, back) && (
 *     view === 'both' ||
 *     (view === 'floor' && o.mount.kind !== 'ceiling') || (view === 'ceiling' && o.mount.kind === 'ceiling'))))
 */
export function isPickable(o: SceneObject, view: LayerView, back: readonly string[], selectedId: string | null): boolean {
  return (
    o.visible &&
    !o.locked &&
    (o.id === selectedId ||
      (!isOnBackSurface(o, back) &&
        (view === 'both' ||
          (view === 'floor' && o.mount.kind !== 'ceiling') ||
          (view === 'ceiling' && o.mount.kind === 'ceiling'))))
  );
}
