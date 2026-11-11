// Жест указателя без DOM: что под курсором, какой патч уходит в draft на каждом кадре и как жест отменяется клавишей.
// Чистый модуль (без three, react и DOM) — PointerController только соединяет его с событиями и камерой.
import type { ObjectPatch } from '../model/commands';
import { isPickable } from '../model/layers';
import type { LayerView } from '../model/layers';
import { clampMount } from '../model/pose';
import type { SceneContext } from '../model/pose';
import type { Ray, SceneObject, Vec3 } from '../model/types';
import { HANDLE_PX, PICK_MIN_PX } from './constants';
import { resolveMove } from './drag';
import type { DragEnv, MoveSession } from './drag';
import { handlesFor, pickHandle, resolveDrop, resolveResize, resolveRotate } from './handles';
import type { Handle, HandleKind } from './handles';
import { choosePick, columnDistance, pickObjects } from './pick';

// ---------- Что под курсором ----------

export type PickTarget = { kind: 'handle'; id: string; handle: HandleKind } | { kind: 'object'; id: string };

/** Снимок вида, в котором делается выбор. */
export interface PickView {
  ctx: SceneContext;
  selectedId: string | null;
  layerView: LayerView;
  /** id поверхностей, на которые камера смотрит с изнанки (стор: backSurfaceIds). */
  back: readonly string[];
  mode: 'orbit' | 'top';
  /** Метров на пиксель на расстоянии distance вдоль луча. */
  perPixel(distance: number): number;
  /** Метров на пиксель в точке сцены. */
  perPixelAt(point: Vec3): number;
}

/**
 * Ручки, которые рисуются и выбираются: у заблокированного объекта их нет (handlesFor), у скрытого — тоже
 * (самого объекта не видно, двигать «вслепую» нечего; его показывают в списке объектов).
 */
export function editHandles(o: SceneObject, ctx: SceneContext, mode: 'orbit' | 'top'): Handle[] {
  return o.visible ? handlesFor(o, ctx, mode) : [];
}

/**
 * Шаг 3 pointerdown: ручка выбранного объекта → иначе объект (pickObjects + choosePick, колонны заслоняют) → иначе null.
 * Ручки рисуются поверх всего, поэтому колонны их не заслоняют.
 */
export function pickTarget(ray: Ray, view: PickView): PickTarget | null {
  const selected = view.selectedId !== null ? view.ctx.get(view.selectedId) : undefined;
  if (selected) {
    const handle = pickHandle(ray, editHandles(selected, view.ctx, view.mode), (p) => HANDLE_PX * view.perPixelAt(p));
    if (handle) return { kind: 'handle', id: selected.id, handle: handle.kind };
  }
  const hits = pickObjects(ray, view.ctx, {
    pickable: (o) => isPickable(o, view.layerView, view.back, view.selectedId),
    minThickness: (distance) => PICK_MIN_PX * view.perPixel(distance),
  });
  const hit = choosePick(hits, view.selectedId, columnDistance(ray, view.ctx.room));
  return hit ? { kind: 'object', id: hit.id } : null;
}

// ---------- Патчи для draft ----------

/** Подпись шага истории по виду жеста. */
export function gestureLabel(kind: 'move' | HandleKind): string {
  switch (kind) {
    case 'move':
      return 'Перемещение';
    case 'rotate':
      return 'Поворот';
    case 'drop':
      return 'Опуск';
    default:
      return 'Размер';
  }
}

/** Кадр перемещения: новое крепление (и угол, если он меняется при переходе пол ⇄ стол); null — кадр пропускается. */
export function movePatch(session: MoveSession, ray: Ray, env: DragEnv): ObjectPatch | null {
  const result = resolveMove(session, ray, env);
  if (!result) return null;
  return result.rotationY === session.start.rotationY
    ? { mount: result.mount }
    : { mount: result.mount, rotationY: result.rotationY };
}

/**
 * Кадр ручки. start — объект на момент начала жеста (без draft). Размер меняется вместе с креплением, зажатым под
 * новый размер (то же самое при коммите сделает cmdPatch): предпросмотр не выходит за стены и потолок.
 */
export function handlePatch(start: SceneObject, kind: HandleKind, ray: Ray, env: DragEnv): ObjectPatch | null {
  switch (kind) {
    case 'rotate': {
      const rotationY = resolveRotate(start, ray, env);
      return rotationY === null ? null : { rotationY };
    }
    case 'drop': {
      const mount = resolveDrop(start, ray, env);
      return mount ? { mount } : null;
    }
    default: {
      const size = resolveResize(start, kind, ray, env);
      if (!size) return null;
      const mount = clampMount(start.mount, size, env.ctx);
      return mount === start.mount ? { size } : { size, mount };
    }
  }
}

// ---------- Отмена жеста клавишей Escape ----------

let canceller: (() => boolean) | null = null;

/**
 * PointerController регистрирует свою отмену (в эффекте, с симметричной очисткой). Функция возвращает true, если
 * жест был и отменён. Возвращается отписка; она снимает только свою регистрацию.
 */
export function registerGestureCancel(cancel: () => boolean): () => void {
  canceller = cancel;
  return () => {
    if (canceller === cancel) canceller = null;
  };
}

/** Escape: отменяет текущее перетаскивание (draft сбрасывается, камера разблокируется). false — отменять было нечего. */
export function cancelGesture(): boolean {
  return canceller ? canceller() : false;
}
