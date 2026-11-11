// Ручки выбранного объекта: состав и математика. Чистый модуль — без three, react и DOM.
import { getItem } from '../catalog';
import { snapTo } from '../model/geometry';
import { clampSize } from '../model/ops';
import { ROTATION_STEP, SIZE_STEP, resolvePose, toWorld } from '../model/pose';
import type { Pose, SceneContext } from '../model/pose';
import { rayPlaneY } from '../model/surfaces';
import type { Mount, Ray, SceneObject, Vec3 } from '../model/types';
import type { DragEnv } from './drag';

export type HandleKind = 'rotate' | 'resize-w' | 'resize-d' | 'resize-h' | 'resize-uniform' | 'drop';
export interface Handle {
  kind: HandleKind;
  position: Vec3;
}

/** Ручка поворота вынесена вперёд от лицевой грани, м. */
const ROTATE_OFFSET = 0.35;
/** Ручка опуска висит под объектом, м. */
const DROP_OFFSET = 0.15;
/** sin² угла между лучом и осью, ниже которого они считаются параллельными (≈ 2°). */
const PARALLEL_SIN2 = 1e-3;
/** Шаг округления размера и опуска, когда привязка к сетке выключена, м. */
const FINE_STEP = 0.01;
/** Ближе этого к центру объекта угол поворота не определён, м. */
const ROTATE_DEAD_ZONE = 1e-6;

const UP: Vec3 = [0, 1, 0];

/** Локальное положение ручки поворота / изменения размера / опуска (таблица раздела W2). */
function localPosition(kind: HandleKind, o: SceneObject): Vec3 {
  const [w, h, d] = o.size;
  const ceiling = o.mount.kind === 'ceiling';
  switch (kind) {
    case 'rotate':
      return [0, 0, d / 2 + ROTATE_OFFSET];
    case 'resize-w':
      return [w / 2, h / 2, 0];
    case 'resize-d':
      return [0, h / 2, d / 2];
    case 'resize-h':
      return ceiling ? [0, 0, 0] : [0, h, 0];
    case 'resize-uniform':
      return ceiling ? [w / 2, 0, d / 2] : [w / 2, h, d / 2];
    case 'drop':
      return [0, -DROP_OFFSET, 0];
  }
}

/** Набор ручек по записи каталога, креплению и режиму камеры. */
function kindsFor(o: SceneObject, mode: 'orbit' | 'top'): HandleKind[] {
  const item = getItem(o.type);
  const wall = o.mount.kind === 'wall';
  const plan = mode === 'top';
  const kinds: HandleKind[] = [];
  if (!wall) kinds.push('rotate');
  if (item.resize === 'free') {
    if (item.flatAxis !== 0) kinds.push('resize-w');
    if (!wall && item.flatAxis !== 2) kinds.push('resize-d');
    // Вертикальные ручки на плане вырождаются (луч параллелен оси) — их там нет.
    if (!plan && item.flatAxis !== 1) kinds.push('resize-h');
  } else if (item.resize === 'uniform') {
    kinds.push('resize-uniform');
  }
  if (o.mount.kind === 'ceiling' && !plan) kinds.push('drop');
  return kinds;
}

/** Ручки выбранного незаблокированного объекта в мировых координатах. Состав — таблица в разделе W2. */
export function handlesFor(o: SceneObject, ctx: SceneContext, mode: 'orbit' | 'top'): Handle[] {
  if (o.locked) return [];
  const pose = resolvePose(o, ctx);
  return kindsFor(o, mode).map((kind) => ({ kind, position: toWorld(pose, localPosition(kind, o)) }));
}

/** Ближайшая ручка, до которой луч проходит ближе radiusAt(position). */
export function pickHandle(ray: Ray, handles: Handle[], radiusAt: (p: Vec3) => number): Handle | null {
  let best: Handle | null = null;
  let bestScore = Infinity;
  for (const handle of handles) {
    const radius = radiusAt(handle.position);
    if (!(radius > 0)) continue;
    const dx = handle.position[0] - ray.origin[0];
    const dy = handle.position[1] - ray.origin[1];
    const dz = handle.position[2] - ray.origin[2];
    const t = dx * ray.dir[0] + dy * ray.dir[1] + dz * ray.dir[2];
    if (t < 0) continue; // ручка позади камеры
    const miss = Math.hypot(dx - ray.dir[0] * t, dy - ray.dir[1] * t, dz - ray.dir[2] * t);
    if (!(miss < radius)) continue;
    // Ручки рисуются поверх всего и одного экранного размера, поэтому «ближайшая» — ближайшая к курсору на экране.
    const score = miss / radius;
    if (score < bestScore) {
      best = handle;
      bestScore = score;
    }
  }
  return best;
}

/** Параметр t ближайшей к лучу точки прямой point + t·axis; null — почти параллельны. */
export function closestOnAxis(ray: Ray, point: Vec3, axis: Vec3): number | null {
  const a = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
  const c = ray.dir[0] * ray.dir[0] + ray.dir[1] * ray.dir[1] + ray.dir[2] * ray.dir[2];
  if (!(a > 0) || !(c > 0)) return null;
  const b = axis[0] * ray.dir[0] + axis[1] * ray.dir[1] + axis[2] * ray.dir[2];
  const denom = a * c - b * b;
  if (!(denom > PARALLEL_SIN2 * a * c)) return null;
  const wx = point[0] - ray.origin[0];
  const wy = point[1] - ray.origin[1];
  const wz = point[2] - ray.origin[2];
  const d = axis[0] * wx + axis[1] * wy + axis[2] * wz;
  const e = ray.dir[0] * wx + ray.dir[1] * wy + ray.dir[2] * wz;
  const t = (b * e - c * d) / denom;
  return Number.isFinite(t) ? t : null;
}

/** Мировой угол хозяина для surface-крепления (0, если хозяина нет). */
function hostAngle(o: SceneObject, ctx: SceneContext): number {
  if (o.mount.kind !== 'surface') return 0;
  const host = ctx.get(o.mount.hostId);
  return host && host.id !== o.id ? resolvePose(host, ctx).rotationY : 0;
}

/** Приводит угол к (−π, π]. */
function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.round(angle / turn);
  return wrapped <= -Math.PI ? wrapped + turn : wrapped;
}

/** Новый SceneObject.rotationY (для surface — относительно хозяина); привязка ROTATION_STEP при env.grid !== null. */
export function resolveRotate(o: SceneObject, ray: Ray, env: DragEnv): number | null {
  if (o.mount.kind === 'wall') return null;
  const pose = resolvePose(o, env.ctx);
  const center = pose.position;
  // Ручка лежит в горизонтальной плоскости основания: угол — направление от центра к точке этой плоскости под курсором.
  const p = rayPlaneY(ray, center[1]);
  if (!p) return null;
  const dx = p[0] - center[0];
  const dz = p[2] - center[2];
  if (Math.hypot(dx, dz) < ROTATE_DEAD_ZONE) return null;
  const world = Math.atan2(dx, dz);
  const own = wrapAngle(world - hostAngle(o, env.ctx));
  return env.grid !== null ? snapTo(own, ROTATION_STEP) : own;
}

/** Ось габарита, наибольшая среди не «плоских»: к ней применяется коэффициент uniform-ручки. */
function largestAxis(size: Vec3, flatAxis: 0 | 1 | 2 | undefined): 0 | 1 | 2 {
  let best: 0 | 1 | 2 | undefined;
  for (const i of [0, 1, 2] as const) {
    if (i === flatAxis) continue;
    if (best === undefined || size[i] > size[best]) best = i;
  }
  return best ?? 0;
}

/** Шаг 1 resolveResize: новое значение одной оси (free) либо коэффициент k (uniform); null — кадр пропускается. */
function measure(o: SceneObject, kind: HandleKind, ray: Ray, pose: Pose, flatAxis: 0 | 1 | 2 | undefined): number | null {
  const h = o.size[1];
  const ceiling = o.mount.kind === 'ceiling';
  switch (kind) {
    case 'resize-w': {
      const t = closestOnAxis(ray, toWorld(pose, [0, h / 2, 0]), [Math.cos(pose.rotationY), 0, -Math.sin(pose.rotationY)]);
      return t === null ? null : 2 * Math.abs(t);
    }
    case 'resize-d': {
      const t = closestOnAxis(ray, toWorld(pose, [0, h / 2, 0]), [Math.sin(pose.rotationY), 0, Math.cos(pose.rotationY)]);
      return t === null ? null : 2 * Math.abs(t);
    }
    case 'resize-h': {
      // Вертикаль через центр основания: t — высота над основанием.
      const t = closestOnAxis(ray, pose.position, UP);
      if (t === null) return null;
      // Пол, стена, стол — растёт от основания; потолок — вниз от верха (drop не меняется).
      return ceiling ? h - t : t;
    }
    case 'resize-uniform': {
      // Якорь — центр основания (потолок — центр верха); «плоская» ось в направлении якорь → ручка не участвует.
      const anchor: Vec3 = ceiling ? [0, h, 0] : [0, 0, 0];
      const handle = localPosition(kind, o);
      if (flatAxis !== undefined) anchor[flatAxis] = handle[flatAxis];
      const from = toWorld(pose, anchor);
      const to = toWorld(pose, handle);
      // Ось не нормирована: t = проекция / исходная длина, то есть сразу коэффициент k.
      return closestOnAxis(ray, from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
    }
    default:
      return null;
  }
}

/**
 * Новый size. o — объект на момент начала жеста (без draft). Порядок:
 *   1. из луча — новое значение ОДНОЙ оси: resize-w / -d / -h → эта ось; resize-uniform → коэффициент k, применяется
 *      к наибольшей стороне o.size (кроме item.flatAxis);
 *   2. при env.grid !== null это одно значение округляется к SIZE_STEP (но не ниже SIZE_STEP); остальные оси НЕ округляются
 *      (при env.grid === null то же значение округляется к 1 см — см. DragEnv.grid);
 *   3. free → next = o.size с заменённой осью; uniform → next = o.size × (округлённое / исходное наибольшей стороны);
 *   4. return clampSize(getItem(o.type), o.size, next) — пределы и сохранение пропорций там (2.10).
 * Картинка 1 × 0.75 × 0.02, уменьшенная вдвое, даёт 0.5 × 0.375 × 0.02; у щита 1.5 × 1.0 × 0.03 ручка ширины не трогает d.
 */
export function resolveResize(o: SceneObject, kind: HandleKind, ray: Ray, env: DragEnv): Vec3 | null {
  const item = getItem(o.type);
  const free = kind === 'resize-w' || kind === 'resize-d' || kind === 'resize-h';
  if (free ? item.resize !== 'free' : kind !== 'resize-uniform' || item.resize !== 'uniform') return null;
  const axis: 0 | 1 | 2 =
    kind === 'resize-w' ? 0 : kind === 'resize-h' ? 1 : kind === 'resize-d' ? 2 : largestAxis(o.size, item.flatAxis);
  if (free && axis === item.flatAxis) return null;

  const measured = measure(o, kind, ray, resolvePose(o, env.ctx), item.flatAxis);
  if (measured === null) return null;

  // Значение одной оси: у uniform — наибольшая сторона, умноженная на k. Сетка включена — шаг SIZE_STEP; выключена —
  // сантиметр, как у остальных значений перетаскивания (DragEnv.grid). Ниже шага значение не опускается: курсор «за»
  // якорем дал бы ноль или минус, clampSize счёл бы это «не числом» и вернул прежний размер — ручка отскакивала бы
  // назад. Сами пределы размера — только в clampSize.
  const step = env.grid !== null ? SIZE_STEP : FINE_STEP;
  const value = Math.max(step, snapTo(free ? measured : o.size[axis] * measured, step));

  let next: Vec3;
  if (free) {
    next = [o.size[0], o.size[1], o.size[2]];
    next[axis] = value;
  } else {
    const k = value / o.size[axis];
    next = [o.size[0] * k, o.size[1] * k, o.size[2] * k];
    // Перетаскиваемая ось получает ровно округлённое значение, без ошибки умножения.
    next[axis] = value;
  }
  return clampSize(item, o.size, next);
}

/** Новое крепление ceiling с drop ∈ [0, H − h]. */
export function resolveDrop(o: SceneObject, ray: Ray, env: DragEnv): Mount | null {
  if (o.mount.kind !== 'ceiling') return null;
  const height = env.ctx.room.size.height;
  // Вертикаль через центр объекта: t — высота ручки над полом.
  const y = closestOnAxis(ray, [o.mount.x, 0, o.mount.z], UP);
  if (y === null) return null;
  const raw = height - (y + DROP_OFFSET) - o.size[1];
  const max = Math.max(0, height - o.size[1]);
  // Округление может вывести за предел (H − h не кратно шагу) — зажим идёт последним.
  const drop = Math.min(max, Math.max(0, snapTo(raw, env.grid ?? FINE_STEP)));
  return { kind: 'ceiling', x: o.mount.x, z: o.mount.z, drop };
}
