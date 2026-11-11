import { afterEach, describe, expect, it } from 'vitest';
import { getItem } from '../catalog';
import { wallSurfaces } from '../model/geometry';
import { backSurfaces } from '../model/layers';
import type { LayerView } from '../model/layers';
import { GRID_STEP, ROTATION_STEP, makeContext } from '../model/pose';
import type { SceneContext } from '../model/pose';
import { testRoom } from '../model/testRoom';
import type { Mount, Ray, SceneObject, Vec3 } from '../model/types';
import { HANDLE_PX } from './constants';
import { beginMove } from './drag';
import type { DragEnv } from './drag';
import { cancelGesture, editHandles, gestureLabel, handlePatch, movePatch, pickTarget, registerGestureCancel } from './gesture';
import type { PickView } from './gesture';
import { handlesFor } from './handles';

function ray(origin: Vec3, toward: Vec3): Ray {
  const d: Vec3 = [toward[0] - origin[0], toward[1] - origin[1], toward[2] - origin[2]];
  const len = Math.hypot(...d);
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

const down = (x: number, z: number): Ray => ({ origin: [x, 20, z], dir: [0, -1, 0] });

function obj(id: string, type: string, mount: Mount, over: Partial<SceneObject> = {}): SceneObject {
  const item = getItem(type);
  return {
    id,
    kind: item.kind,
    type,
    origin: 'user',
    name: id,
    mount,
    rotationY: 0,
    size: item.size,
    color: item.color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

const ctxOf = (extra: SceneObject[] = []) => makeContext(testRoom, [...testRoom.fixtures, ...extra]);
const env = (ctx: SceneContext, grid: number | null = null, mode: 'orbit' | 'top' = 'orbit'): DragEnv => ({ ctx, grid, mode });

/** Метров на пиксель в тестах: ручка — круг радиусом HANDLE_PX × 0.005 = 4.5 см. */
const PER_PIXEL = 0.005;

function view(
  ctx: SceneContext,
  over: { selectedId?: string | null; layerView?: LayerView; back?: readonly string[]; mode?: 'orbit' | 'top' } = {},
): PickView {
  return {
    ctx,
    selectedId: over.selectedId ?? null,
    layerView: over.layerView ?? 'both',
    back: over.back ?? [],
    mode: over.mode ?? 'top',
    perPixel: () => PER_PIXEL,
    perPixelAt: () => PER_PIXEL,
  };
}

describe('pickTarget', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });

  it('объект под лучом; пустое место → null', () => {
    const ctx = ctxOf([crate]);
    expect(pickTarget(down(3, 1), view(ctx))).toEqual({ kind: 'object', id: 'crate' });
    expect(pickTarget(down(4.2, 2.2), view(ctx))).toBeNull();
  });

  it('ручка выбранного объекта выигрывает у объектов под ней', () => {
    // Ручка поворота ящика — в (3, 0, 1.6); под ней на полу лежит другой ящик.
    const under = obj('under', 'box', { kind: 'floor', x: 3, z: 1.6, lift: 0 }, { size: [0.3, 0.1, 0.3] });
    const ctx = ctxOf([crate, under]);
    expect(pickTarget(down(3, 1.6), view(ctx))).toEqual({ kind: 'object', id: 'under' });
    expect(pickTarget(down(3, 1.6), view(ctx, { selectedId: 'crate' }))).toEqual({ kind: 'handle', id: 'crate', handle: 'rotate' });
    // Ручка ширины лежит на грани самого ящика: клик по ней — ручка, а не перемещение.
    expect(pickTarget(down(3.25, 1), view(ctx, { selectedId: 'crate' }))).toEqual({ kind: 'handle', id: 'crate', handle: 'resize-w' });
    // В стороне от ручек выбранный объект — обычная цель перемещения.
    expect(pickTarget(down(3.1, 1.1), view(ctx, { selectedId: 'crate' }))).toEqual({ kind: 'object', id: 'crate' });
  });

  it('радиус попадания в ручку — HANDLE_PX пикселей в точке ручки', () => {
    const ctx = ctxOf([crate]);
    const reach = HANDLE_PX * PER_PIXEL;
    const selected = view(ctx, { selectedId: 'crate' });
    expect(pickTarget(down(3 + reach * 0.9, 1.6), selected)).toEqual({ kind: 'handle', id: 'crate', handle: 'rotate' });
    expect(pickTarget(down(3 + reach * 1.1, 1.6), selected)).toBeNull();
    // Масштаб спрашивается именно для положения ручки.
    const asked: Vec3[] = [];
    pickTarget(down(3, 1.6), {
      ...selected,
      perPixelAt: (p) => {
        asked.push(p);
        return PER_PIXEL;
      },
    });
    expect(asked).toEqual(handlesFor(crate, ctx, 'top').map((h) => h.position));
  });

  it('состав ручек зависит от режима: вертикальная ручка есть только в облёте', () => {
    const ctx = ctxOf([crate]);
    // Луч в точку ручки высоты (3, 0.5, 1) сбоку, мимо самого ящика нельзя — он под ручкой; проверяем вид цели.
    const side = ray([3, 0.5, 6], [3, 0.5, 1]);
    expect(pickTarget(side, view(ctx, { selectedId: 'crate', mode: 'orbit' }))).toEqual({ kind: 'handle', id: 'crate', handle: 'resize-h' });
    expect(pickTarget(side, view(ctx, { selectedId: 'crate', mode: 'top' }))).toEqual({ kind: 'object', id: 'crate' });
  });

  it('у заблокированного и у скрытого выбранного объекта ручек нет', () => {
    const locked = { ...crate, locked: true };
    const hidden = { ...crate, visible: false };
    expect(pickTarget(down(3, 1.6), view(ctxOf([locked]), { selectedId: 'crate' }))).toBeNull();
    expect(pickTarget(down(3, 1.6), view(ctxOf([hidden]), { selectedId: 'crate' }))).toBeNull();
    expect(editHandles(hidden, ctxOf([hidden]), 'orbit')).toEqual([]);
    expect(editHandles(crate, ctxOf([crate]), 'orbit')).toEqual(handlesFor(crate, ctxOf([crate]), 'orbit'));
    // Сам заблокированный объект мышью тоже не берётся.
    expect(pickTarget(down(3, 1), view(ctxOf([locked]), { selectedId: 'crate' }))).toBeNull();
  });

  it('тонкий настенный щит на плане раздувается до PICK_MIN_PX', () => {
    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'far', along: 7, bottom: 1.2 });
    const ctx = ctxOf([banner]);
    // 10 px × 0.005 = 5 см: центр щита на z = −2.955, луч в 2 см от него — вне настоящих 3 см толщины (±1.5 см),
    // но внутри раздутых 5 см (±2.5 см).
    expect(pickTarget(down(2, -2.935), view(ctx))).toEqual({ kind: 'object', id: 'banner' });
    expect(pickTarget(down(2, -2.935), { ...view(ctx), perPixel: () => 0 })).toBeNull();
    expect(pickTarget(down(2, -2.92), view(ctx))).toBeNull();
  });

  it('призраки пропускают клик: потолочный при виде сверху, настенный на поверхности из back', () => {
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: -2, z: 1, drop: 0.2 }, { size: [3, 0.5, 3] });
    const ctx = ctxOf([cloud]);
    expect(pickTarget(down(-2, 1), view(ctx, { layerView: 'both' }))).toEqual({ kind: 'object', id: 'cloud' });
    expect(pickTarget(down(-2, 1), view(ctx, { layerView: 'floor' }))).toEqual({ kind: 'object', id: 'venue-table' });
    expect(pickTarget(down(-2, 1), view(ctx, { layerView: 'floor', selectedId: 'cloud' }))).toEqual({ kind: 'object', id: 'cloud' });

    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'near', along: 2, bottom: 0 });
    const behind = obj('behind', 'box', { kind: 'floor', x: 3, z: 1.5, lift: 0 }, { size: [0.5, 1, 0.5] });
    const camera: Vec3 = [3, 0.5, 9];
    const back = backSurfaces('orbit', camera, wallSurfaces(testRoom));
    const wallCtx = ctxOf([banner, behind]);
    const r = ray(camera, [3, 0.5, 0]);
    expect(pickTarget(r, view(wallCtx, { mode: 'orbit', back }))).toEqual({ kind: 'object', id: 'behind' });
    expect(pickTarget(r, view(wallCtx, { mode: 'orbit', back, selectedId: 'banner' }))).toEqual({ kind: 'object', id: 'banner' });
  });

  it('колонна заслоняет объект, но не ручку выбранного объекта', () => {
    // Ящик за колонной (2, 0), если смотреть со стороны +Z.
    const hidden = obj('hidden', 'box', { kind: 'floor', x: 2, z: -1.5, lift: 0 });
    const ctx = ctxOf([hidden]);
    const through: Ray = { origin: [2, 0.25, 5], dir: [0, 0, -1] };
    expect(pickTarget(through, view(ctx, { mode: 'orbit' }))).toBeNull();
    expect(pickTarget(through, view(ctx, { mode: 'orbit', selectedId: 'hidden' }))).toEqual({ kind: 'handle', id: 'hidden', handle: 'resize-d' });
  });
});

describe('movePatch', () => {
  it('перемещение по полу: в патче только крепление', () => {
    const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 }, { rotationY: 0.4 });
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, down(3, 1), ctx);
    expect(movePatch(s, down(3.5, 1.2), env(ctx, null, 'top'))).toEqual({ mount: { kind: 'floor', x: 3.5, z: 1.2, lift: 0 } });
  });

  it('въезд на повёрнутый стол: вместе с креплением меняется относительный угол', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'floor', x: 0, z: 1.5, lift: 0 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(0, 1.5), ctx);
    const patch = movePatch(s, down(-2, -2), env(ctx, null, 'top'));
    expect(patch?.mount).toEqual({ kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 });
    expect(patch?.rotationY).toBeCloseTo(-Math.PI / 2);
  });

  it('луч мимо своей поверхности → null (кадр пропускается)', () => {
    const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, ray([3, 1.5, 6], [3, 0, 1]), ctx);
    expect(movePatch(s, ray([3, 1.5, 6], [3, 2.5, 1]), env(ctx))).toBeNull();
  });
});

describe('handlePatch', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });

  it('поворот → rotationY; опуск → mount; размер → size', () => {
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
    const ctx = ctxOf([crate, cloud]);
    expect(handlePatch(crate, 'rotate', down(4, 1), env(ctx, GRID_STEP, 'top'))).toEqual({ rotationY: 6 * ROTATION_STEP });
    expect(handlePatch(cloud, 'drop', { origin: [3, 1.85, 6], dir: [0, 0, -1] }, env(ctx))).toEqual({
      mount: { kind: 'ceiling', x: 3, z: 1, drop: 0.5 },
    });
    expect(handlePatch(crate, 'resize-w', down(3.4, 1), env(ctx, null, 'top'))).toEqual({ size: [0.8, 0.5, 0.5] });
  });

  it('размер, с которым объект перестаёт помещаться, приходит вместе с зажатым креплением', () => {
    // Потолочный ящик с опуском 1 м растёт вниз до пола: H − h становится меньше прежнего опуска.
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 1 });
    const ctx = ctxOf([cloud]);
    const patch = handlePatch(cloud, 'resize-h', { origin: [3, -0.5, 6], dir: [0, 0, -1] }, env(ctx));
    expect(patch?.size?.[1]).toBeCloseTo(2.5, 9);
    expect(patch?.mount).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0.5 });

    // Щит у края стены расширяется: центр отодвигается от угла.
    const shield = obj('shield', 'panel', { kind: 'wall', surfaceId: 'far', along: 0.75, bottom: 1.2 });
    const wallCtx = ctxOf([shield]);
    const wide = handlePatch(shield, 'resize-w', down(-5 + 0.75 + 1.25, -2.9), env(wallCtx, null, 'top'));
    expect(wide).toEqual({ size: [2.5, 1, 0.03], mount: { kind: 'wall', surfaceId: 'far', along: 1.25, bottom: 1.2 } });
  });

  it('вырожденный луч и чужая ручка → null', () => {
    const ctx = ctxOf([crate]);
    expect(handlePatch(crate, 'resize-h', down(3.1, 1), env(ctx, null, 'top'))).toBeNull();
    expect(handlePatch(crate, 'drop', down(3.1, 1), env(ctx))).toBeNull();
    expect(handlePatch(crate, 'rotate', down(3, 1), env(ctx))).toBeNull();
  });
});

describe('подписи шагов истории', () => {
  it('«Перемещение», «Поворот», «Размер», «Опуск»', () => {
    expect(gestureLabel('move')).toBe('Перемещение');
    expect(gestureLabel('rotate')).toBe('Поворот');
    expect(gestureLabel('drop')).toBe('Опуск');
    for (const kind of ['resize-w', 'resize-d', 'resize-h', 'resize-uniform'] as const) expect(gestureLabel(kind)).toBe('Размер');
  });
});

describe('отмена жеста (Escape)', () => {
  let unregister: (() => void) | undefined;
  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it('без контроллера отменять нечего', () => {
    expect(cancelGesture()).toBe(false);
  });

  it('вызывает зарегистрированную отмену и возвращает её ответ', () => {
    let calls = 0;
    let active = true;
    unregister = registerGestureCancel(() => {
      calls++;
      return active;
    });
    expect(cancelGesture()).toBe(true);
    active = false;
    expect(cancelGesture()).toBe(false);
    expect(calls).toBe(2);
  });

  it('отписка снимает только свою регистрацию (StrictMode: эффект → очистка → эффект)', () => {
    const first = registerGestureCancel(() => false);
    unregister = registerGestureCancel(() => true);
    // Запоздалая очистка первого эффекта не должна снять регистрацию второго.
    first();
    expect(cancelGesture()).toBe(true);
    unregister();
    unregister = undefined;
    expect(cancelGesture()).toBe(false);
  });
});
