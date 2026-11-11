import { describe, expect, it, vi } from 'vitest';
import { getItem } from '../catalog';
import { MAX_SIZE, MIN_SIZE } from '../model/ops';
import { GRID_STEP, ROTATION_STEP, makeContext, resolvePose } from '../model/pose';
import type { SceneContext } from '../model/pose';
import { testRoom } from '../model/testRoom';
import type { Mount, Ray, SceneObject, Vec3 } from '../model/types';
import type { DragEnv } from './drag';
import { closestOnAxis, handlesFor, pickHandle, resolveDrop, resolveResize, resolveRotate } from './handles';
import type { Handle, HandleKind } from './handles';

// В базовом каталоге нет записи «free + flatAxis» (картинки — uniform): для проверки «нет ручки по flatAxis»
// добавляются два тестовых типа; от W6/W7 тест не зависит.
vi.mock('../catalog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../catalog')>();
  const panel = original.getItem('panel');
  const extra: Record<string, ReturnType<typeof original.getItem>> = {
    // Лист: толщина — локальная Z.
    'test.sheet': { ...panel, id: 'test.sheet', flatAxis: 2, mounts: ['wall', 'floor', 'ceiling'] },
    // Плита: толщина — локальная Y.
    'test.slab': { ...panel, id: 'test.slab', size: [1.5, 0.03, 1.0], flatAxis: 1, mounts: ['floor', 'ceiling'] },
  };
  return {
    ...original,
    getItem: (type: string) => (Object.prototype.hasOwnProperty.call(extra, type) ? extra[type] : original.getItem(type)),
  };
});

function ray(origin: Vec3, toward: Vec3): Ray {
  const d: Vec3 = [toward[0] - origin[0], toward[1] - origin[1], toward[2] - origin[2]];
  const len = Math.hypot(...d);
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

/** Луч плана: строго вниз. */
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
const kinds = (handles: Handle[]): HandleKind[] => handles.map((h) => h.kind);
const at = (handles: Handle[], kind: HandleKind): Vec3 => {
  const handle = handles.find((h) => h.kind === kind);
  expect(handle).toBeDefined();
  return (handle as Handle).position;
};
function expectVec(actual: Vec3, expected: Vec3): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
}
function mustSize(size: Vec3 | null): Vec3 {
  expect(size).not.toBeNull();
  return size as Vec3;
}

const H = testRoom.size.height;

describe('handlesFor: состав по креплению и режиму', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
  const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
  const shield = obj('shield', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });

  it('пол, free: поворот и три размера; на плане нет вертикальной ручки', () => {
    const ctx = ctxOf([crate]);
    expect(kinds(handlesFor(crate, ctx, 'orbit'))).toEqual(['rotate', 'resize-w', 'resize-d', 'resize-h']);
    expect(kinds(handlesFor(crate, ctx, 'top'))).toEqual(['rotate', 'resize-w', 'resize-d']);
  });

  it('стена: нет rotate и resize-d; на плане остаётся только ширина', () => {
    const ctx = ctxOf([shield]);
    expect(kinds(handlesFor(shield, ctx, 'orbit'))).toEqual(['resize-w', 'resize-h']);
    expect(kinds(handlesFor(shield, ctx, 'top'))).toEqual(['resize-w']);
  });

  it('потолок: добавляется drop; на плане нет ни drop, ни высоты', () => {
    const ctx = ctxOf([cloud]);
    expect(kinds(handlesFor(cloud, ctx, 'orbit'))).toEqual(['rotate', 'resize-w', 'resize-d', 'resize-h', 'drop']);
    expect(kinds(handlesFor(cloud, ctx, 'top'))).toEqual(['rotate', 'resize-w', 'resize-d']);
  });

  it('uniform: одна ручка размера (и на плане тоже); none: только поворот и опуск', () => {
    const ball = obj('ball', 'sphere', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const lamp = obj('lamp', 'light.point', { kind: 'ceiling', x: 3, z: 1, drop: 0.5 });
    const picture = obj('picture', 'image', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1 });
    const ctx = ctxOf([ball, lamp, picture]);
    expect(getItem('light.point').resize).toBe('none');
    expect(kinds(handlesFor(ball, ctx, 'orbit'))).toEqual(['rotate', 'resize-uniform']);
    expect(kinds(handlesFor(ball, ctx, 'top'))).toEqual(['rotate', 'resize-uniform']);
    expect(kinds(handlesFor(lamp, ctx, 'orbit'))).toEqual(['rotate', 'drop']);
    expect(kinds(handlesFor(lamp, ctx, 'top'))).toEqual(['rotate']);
    expect(kinds(handlesFor(picture, ctx, 'orbit'))).toEqual(['resize-uniform']);
  });

  it('нет ручки по оси flatAxis', () => {
    const sheet = obj('sheet', 'test.sheet', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const slab = obj('slab', 'test.slab', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const ctx = ctxOf([sheet, slab]);
    expect(kinds(handlesFor(sheet, ctx, 'orbit'))).toEqual(['rotate', 'resize-w', 'resize-h']);
    expect(kinds(handlesFor(slab, ctx, 'orbit'))).toEqual(['rotate', 'resize-w', 'resize-d']);
    // И сама математика по этой оси не работает.
    expect(resolveResize(sheet, 'resize-d', down(3, 1.4), env(ctx))).toBeNull();
    expect(resolveResize(slab, 'resize-h', ray([3, 1, 5], [3, 1, 1]), env(ctx))).toBeNull();
  });

  it('у заблокированного объекта ручек нет', () => {
    const locked = { ...crate, locked: true };
    expect(handlesFor(locked, ctxOf([locked]), 'orbit')).toEqual([]);
  });

  it('положения: локальные точки таблицы W2 в мировых координатах', () => {
    // Ящик 1 × 0.5 × 0.6 повёрнут на 90°: локальный +Z → мировой +X, локальный +X → мировой −Z.
    const turned = obj('turned', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 }, { size: [1, 0.5, 0.6], rotationY: Math.PI / 2 });
    const handles = handlesFor(turned, ctxOf([turned]), 'orbit');
    expectVec(at(handles, 'rotate'), [3 + 0.3 + 0.35, 0, 1]);
    expectVec(at(handles, 'resize-w'), [3, 0.25, 1 - 0.5]);
    expectVec(at(handles, 'resize-d'), [3 + 0.3, 0.25, 1]);
    expectVec(at(handles, 'resize-h'), [3, 0.5, 1]);
  });

  it('положения на подиуме и на столе учитывают высоту опоры', () => {
    const onPodium = obj('onPodium', 'box', { kind: 'floor', x: -4, z: -2, lift: 0 });
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table', u: 0.2, v: 0.1 });
    const ctx = ctxOf([onPodium, lantern]);
    expectVec(at(handlesFor(onPodium, ctx, 'orbit'), 'resize-h'), [-4, 0.2 + 0.5, -2]);
    // Стол в (−2, 1), высота 0.75; шар 0.4.
    expectVec(at(handlesFor(lantern, ctx, 'orbit'), 'resize-uniform'), [-1.8 + 0.2, 0.75 + 0.4, 1.1 + 0.2]);
    expectVec(at(handlesFor(lantern, ctx, 'orbit'), 'rotate'), [-1.8, 0.75, 1.1 + 0.2 + 0.35]);
  });

  it('потолочный объект: ручки высоты и uniform — на нижней грани, drop — на 0.15 м ниже', () => {
    const bottom = H - 0.2 - 0.5;
    const handles = handlesFor(cloud, ctxOf([cloud]), 'orbit');
    expectVec(at(handles, 'resize-h'), [3, bottom, 1]);
    expectVec(at(handles, 'drop'), [3, bottom - 0.15, 1]);
    const ball = obj('ball', 'sphere', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
    expectVec(at(handlesFor(ball, ctxOf([ball]), 'orbit'), 'resize-uniform'), [3.2, H - 0.2 - 0.4, 1.2]);
  });

  it('настенный объект: ручка ширины — вдоль стены', () => {
    // Правая стена x = 5 идёт вдоль +Z, нормаль −X; щит 1.5 × 1.0 × 0.03 по центру along = 3 → z = 0.
    const onRight = obj('onRight', 'panel', { kind: 'wall', surfaceId: 'right', along: 3, bottom: 1.2 });
    const handles = handlesFor(onRight, ctxOf([onRight]), 'orbit');
    const x = 5 - 0.03 - 0.015;
    expectVec(at(handles, 'resize-w'), [x, 1.7, 0.75]);
    expectVec(at(handles, 'resize-h'), [x, 2.2, 0]);
  });
});

describe('pickHandle', () => {
  const handles: Handle[] = [
    { kind: 'rotate', position: [0, 0, 0] },
    { kind: 'resize-w', position: [0.3, 0, 0] },
    { kind: 'resize-h', position: [0, 0, 10] },
  ];
  const toward = (x: number): Ray => ({ origin: [x, 5, 0], dir: [0, -1, 0] });

  it('луч проходит ближе радиуса → эта ручка; дальше → null', () => {
    expect(pickHandle(toward(0.05), handles, () => 0.1)?.kind).toBe('rotate');
    expect(pickHandle(toward(0.26), handles, () => 0.1)?.kind).toBe('resize-w');
    expect(pickHandle(toward(0.15), handles, () => 0.04)).toBeNull();
    expect(pickHandle(toward(2), handles, () => 0.1)).toBeNull();
    expect(pickHandle(toward(0), [], () => 0.1)).toBeNull();
  });

  it('из двух подходящих — ближайшая к лучу', () => {
    expect(pickHandle(toward(0.1), handles, () => 0.25)?.kind).toBe('rotate');
    expect(pickHandle(toward(0.2), handles, () => 0.25)?.kind).toBe('resize-w');
  });

  it('радиус спрашивается для положения ручки; ручка позади луча не выбирается', () => {
    const asked: Vec3[] = [];
    const radius = (p: Vec3) => {
      asked.push(p);
      return p[2] === 10 ? 1 : 0.01;
    };
    // Мимо первых двух (радиус 1 см), но в пределах метрового радиуса третьей.
    expect(pickHandle({ origin: [0.5, 5, 10], dir: [0, -1, 0] }, handles, radius)?.kind).toBe('resize-h');
    expect(asked).toHaveLength(3);
    expect(pickHandle({ origin: [0, 5, 0], dir: [0, 1, 0] }, handles, () => 0.1)).toBeNull();
  });
});

describe('closestOnAxis', () => {
  it('параметр ближайшей к лучу точки оси', () => {
    // Луч вдоль −Z в x = 0.3; ось X через (0, 1, 0).
    expect(closestOnAxis({ origin: [0.3, 1, 5], dir: [0, 0, -1] }, [0, 1, 0], [1, 0, 0])).toBeCloseTo(0.3, 12);
    expect(closestOnAxis({ origin: [-0.7, 4, 5], dir: [0, 0, -1] }, [0, 1, 0], [1, 0, 0])).toBeCloseTo(-0.7, 12);
    // Скрещивающиеся прямые: вертикаль через (2, 0, 2) и наклонный луч.
    const t = closestOnAxis(ray([0, 1.5, 0], [4, 1.5, 4.2]), [2, 0, 2], [0, 1, 0]);
    expect(t).toBeCloseTo(1.5, 12);
  });

  it('ненормированная ось: t в долях её длины', () => {
    expect(closestOnAxis({ origin: [0.3, 1, 5], dir: [0, 0, -1] }, [0, 1, 0], [0.6, 0, 0])).toBeCloseTo(0.5, 12);
  });

  it('почти параллельны → null', () => {
    expect(closestOnAxis({ origin: [0, 1, 5], dir: [1, 0, 0] }, [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(closestOnAxis({ origin: [0, 1, 5], dir: [-1, 0, 0] }, [0, 0, 0], [3, 0, 0])).toBeNull();
    expect(closestOnAxis(ray([0, 1, 5], [10, 1.1, 5]), [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(closestOnAxis({ origin: [0, 1, 5], dir: [0, 0, -1] }, [0, 0, 0], [0, 0, 0])).toBeNull();
  });
});

describe('resolveRotate', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });

  it('угол — направление от центра к точке под курсором; локальный +Z смотрит на курсор', () => {
    const ctx = ctxOf([crate]);
    expect(resolveRotate(crate, down(3, 2), env(ctx))).toBeCloseTo(0, 12);
    expect(resolveRotate(crate, down(4, 1), env(ctx))).toBeCloseTo(Math.PI / 2, 12);
    expect(resolveRotate(crate, down(2, 1), env(ctx))).toBeCloseTo(-Math.PI / 2, 12);
    expect(resolveRotate(crate, down(4, 2), env(ctx))).toBeCloseTo(Math.PI / 4, 12);
  });

  it('привязка 15° при включённой сетке, без неё — точный угол', () => {
    const ctx = ctxOf([crate]);
    const deg = Math.PI / 180;
    const target = down(3 + Math.sin(50 * deg), 1 + Math.cos(50 * deg));
    expect(resolveRotate(crate, target, env(ctx))).toBeCloseTo(50 * deg, 12);
    expect(resolveRotate(crate, target, env(ctx, GRID_STEP))).toBe(3 * ROTATION_STEP);
    const other = down(3 + Math.sin(-100 * deg), 1 + Math.cos(-100 * deg));
    expect(resolveRotate(crate, other, env(ctx, GRID_STEP))).toBe(-7 * ROTATION_STEP);
  });

  it('в облёте берётся точка плоскости основания, а не пола', () => {
    const lifted = obj('lifted', 'box', { kind: 'floor', x: 3, z: 1, lift: 1 });
    const ctx = ctxOf([lifted]);
    // Луч проходит через точку (4, 1, 1) плоскости основания y = 1 и уходит дальше к полу.
    expect(resolveRotate(lifted, ray([8, 5, 1], [4, 1, 1]), env(ctx))).toBeCloseTo(Math.PI / 2, 12);
  });

  it('surface: угол относительно хозяина', () => {
    // 'venue-table2' повёрнут на π/2; курсор — в мировом направлении π/2 + π/6 от центра фонаря.
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 });
    const ctx = ctxOf([lantern]);
    const world = Math.PI / 2 + Math.PI / 6;
    const target = down(-2 + Math.sin(world), -2 + Math.cos(world));
    expect(resolveRotate(lantern, target, env(ctx))).toBeCloseTo(Math.PI / 6, 12);
    expect(resolveRotate(lantern, target, env(ctx, GRID_STEP))).toBe(2 * ROTATION_STEP);
    // Мировой угол получается обратно сложением с углом хозяина.
    const rotated = { ...lantern, rotationY: resolveRotate(lantern, target, env(ctx)) as number };
    expect(resolvePose(rotated, ctxOf([rotated])).rotationY).toBeCloseTo(world, 12);
  });

  it('потолочный объект поворачивается на плане', () => {
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
    expect(resolveRotate(cloud, down(3, 0), env(ctxOf([cloud]), GRID_STEP, 'top'))).toBe(12 * ROTATION_STEP);
  });

  it('стена, горизонтальный луч и центр объекта → null', () => {
    const shield = obj('shield', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    const ctx = ctxOf([crate, shield]);
    expect(resolveRotate(shield, down(1, -2), env(ctx))).toBeNull();
    expect(resolveRotate(crate, { origin: [3, 1, 6], dir: [0, 0, -1] }, env(ctx))).toBeNull();
    expect(resolveRotate(crate, ray([3, 1, 6], [3, 2, 1]), env(ctx))).toBeNull();
    expect(resolveRotate(crate, down(3, 1), env(ctx))).toBeNull();
  });
});

describe('resolveResize: свободные оси', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });

  it('ширина симметрична относительно центра', () => {
    const ctx = ctxOf([crate]);
    expect(mustSize(resolveResize(crate, 'resize-w', down(3.4, 1), env(ctx)))).toEqual([0.8, 0.5, 0.5]);
    expect(mustSize(resolveResize(crate, 'resize-w', down(2.6, 1.3), env(ctx)))).toEqual([0.8, 0.5, 0.5]);
    // В облёте — ближайшая к лучу точка локальной оси X на высоте h/2.
    expect(mustSize(resolveResize(crate, 'resize-w', ray([3.4, 4, 6], [3.4, 0.25, 1]), env(ctx)))).toEqual([0.8, 0.5, 0.5]);
  });

  it('глубина и ширина меряются в осях повёрнутого объекта', () => {
    const turned = { ...crate, rotationY: Math.PI / 2 };
    const ctx = ctxOf([turned]);
    // Локальная X смотрит в мировой −Z, локальная Z — в мировой +X.
    const w = mustSize(resolveResize(turned, 'resize-w', down(3, 0.6), env(ctx)));
    expect(w[0]).toBeCloseTo(0.8, 9);
    expect(w[2]).toBe(0.5);
    const d = mustSize(resolveResize(turned, 'resize-d', down(3.35, 1), env(ctx)));
    expect(d[2]).toBeCloseTo(0.7, 9);
    expect(d[0]).toBe(0.5);
  });

  it('высота растёт от основания: пол, подиум, стена, стол', () => {
    const onPodium = obj('onPodium', 'box', { kind: 'floor', x: -4, z: -2, lift: 0 });
    const shield = obj('shield', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    const onTable = obj('onTable', 'box', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    const ctx = ctxOf([crate, onPodium, shield, onTable]);
    expect(mustSize(resolveResize(crate, 'resize-h', { origin: [3, 0.8, 6], dir: [0, 0, -1] }, env(ctx)))[1]).toBeCloseTo(0.8, 9);
    expect(mustSize(resolveResize(onPodium, 'resize-h', { origin: [-4, 1, 6], dir: [0, 0, -1] }, env(ctx)))[1]).toBeCloseTo(0.8, 9);
    const wall = mustSize(resolveResize(shield, 'resize-h', { origin: [0, 2, 2], dir: [0, 0, -1] }, env(ctx)));
    expect(wall[0]).toBe(1.5);
    expect(wall[1]).toBeCloseTo(0.8, 9);
    expect(wall[2]).toBe(0.03);
    expect(mustSize(resolveResize(onTable, 'resize-h', { origin: [-2, 1.05, -2], dir: [0, 0, 1] }, env(ctx)))[1]).toBeCloseTo(0.3, 9);
  });

  it('высота потолочного объекта держит верх: растёт вниз, drop не меняется', () => {
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
    const ctx = ctxOf([cloud]);
    const top = H - 0.2;
    const size = mustSize(resolveResize(cloud, 'resize-h', { origin: [3, 2.0, 6], dir: [0, 0, -1] }, env(ctx)));
    expect(size[1]).toBeCloseTo(top - 2.0, 9);
    expect(size[0]).toBe(0.5);
    expect(size[2]).toBe(0.5);
    // Крепление то же → верх на месте, низ — под курсором.
    const pose = resolvePose({ ...cloud, size }, ctx);
    expect(pose.position[1]).toBeCloseTo(2.0, 9);
    expect(pose.position[1] + size[1]).toBeCloseTo(top, 9);
  });

  it('ручка ширины щита 1.5 × 1.0 × 0.03 не меняет d (в том числе с сеткой)', () => {
    const shield = obj('shield', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    expect(shield.size).toEqual([1.5, 1.0, 0.03]);
    const ctx = ctxOf([shield]);
    const target = ray([0, 1.6, 2.5], [0.6, 1.7, -2.955]);
    for (const grid of [null, GRID_STEP]) {
      const size = mustSize(resolveResize(shield, 'resize-w', target, env(ctx, grid)));
      expect(size[0]).toBeCloseTo(1.2, 9);
      expect(size[1]).toBe(1.0);
      expect(size[2]).toBe(0.03);
    }
    // На плане — тоже.
    expect(mustSize(resolveResize(shield, 'resize-w', down(-0.5, -2.9), env(ctx, GRID_STEP, 'top')))).toEqual([1, 1.0, 0.03]);
  });

  it('округляется только перетаскиваемая ось: с сеткой — к SIZE_STEP, без сетки — к сантиметру', () => {
    const odd = { ...crate, size: [0.52, 0.47, 0.33] as Vec3 };
    const ctx = ctxOf([odd]);
    expect(mustSize(resolveResize(odd, 'resize-w', down(3.43, 1), env(ctx, GRID_STEP)))).toEqual([0.85, 0.47, 0.33]);
    expect(mustSize(resolveResize(odd, 'resize-d', down(3, 1.21), env(ctx, GRID_STEP)))).toEqual([0.52, 0.47, 0.4]);
    expect(mustSize(resolveResize(odd, 'resize-w', down(3.43, 1), env(ctx)))).toEqual([0.86, 0.47, 0.33]);
    expect(mustSize(resolveResize(odd, 'resize-w', down(3.4337, 1), env(ctx)))).toEqual([0.87, 0.47, 0.33]);
  });

  it('пределы — через clampSize: MIN_SIZE / MAX_SIZE и minSize записи каталога', () => {
    const ctx = ctxOf([crate]);
    // Курсор в центре: с сеткой — не ниже SIZE_STEP, без сетки — MIN_SIZE.
    expect(mustSize(resolveResize(crate, 'resize-w', down(3, 1), env(ctx, GRID_STEP)))).toEqual([0.05, 0.5, 0.5]);
    expect(mustSize(resolveResize(crate, 'resize-w', down(3, 1), env(ctx)))).toEqual([MIN_SIZE, 0.5, 0.5]);
    expect(mustSize(resolveResize(crate, 'resize-w', down(40, 1), env(ctx)))).toEqual([MAX_SIZE, 0.5, 0.5]);
    // Высота ниже основания не «отскакивает» к прежней, а упирается в минимум.
    expect(mustSize(resolveResize(crate, 'resize-h', { origin: [3, -1, 6], dir: [0, 0, -1] }, env(ctx)))).toEqual([0.5, MIN_SIZE, 0.5]);

    const fence = obj('fence', 'barrier', { kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(getItem('barrier').minSize).toEqual([0.4, 0.4, 0.3]);
    const fenceCtx = ctxOf([fence]);
    expect(mustSize(resolveResize(fence, 'resize-w', down(3.05, 1), env(fenceCtx, GRID_STEP)))).toEqual([0.4, 1.1, 0.5]);
    expect(mustSize(resolveResize(fence, 'resize-d', down(3, 1.01), env(fenceCtx)))).toEqual([2.2, 1.1, 0.3]);
  });

  it('тот же размер → та же ссылка (пустой патч)', () => {
    const ctx = ctxOf([crate]);
    expect(resolveResize(crate, 'resize-w', down(3.25, 1), env(ctx, GRID_STEP))).toBe(crate.size);
  });

  it('параллельный луч и чужая ручка → null', () => {
    const ctx = ctxOf([crate]);
    // Вертикальная ручка на плане.
    expect(resolveResize(crate, 'resize-h', down(3.1, 1), env(ctx, null, 'top'))).toBeNull();
    // Луч вдоль локальной X и вдоль локальной Z.
    expect(resolveResize(crate, 'resize-w', { origin: [8, 0.3, 1.1], dir: [-1, 0, 0] }, env(ctx))).toBeNull();
    expect(resolveResize(crate, 'resize-d', { origin: [3.1, 0.3, 8], dir: [0, 0, -1] }, env(ctx))).toBeNull();
    // Ручки не этого типа изменения размера.
    expect(resolveResize(crate, 'resize-uniform', down(3.4, 1.4), env(ctx))).toBeNull();
    expect(resolveResize(crate, 'rotate', down(3.4, 1.4), env(ctx))).toBeNull();
    expect(resolveResize(crate, 'drop', down(3.4, 1.4), env(ctx))).toBeNull();
    const lamp = obj('lamp', 'light.point', { kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(resolveResize(lamp, 'resize-w', down(3.4, 1), env(ctxOf([lamp])))).toBeNull();
  });
});

describe('resolveResize: uniform', () => {
  // Картинка 1 × 0.75 × 0.02 на дальней стене: центр основания в (0, 1, −2.96), лицо — в +Z.
  const picture = obj('picture', 'image', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1 }, { size: [1, 0.75, 0.02] });
  const faceZ = -3 + 0.03 + 0.02;
  const camera: Vec3 = [0.25, 1.375, 2];
  /** Луч в точку прямой «якорь → ручка» на доле k её длины (якорь — центр низа, ручка — правый верхний угол). */
  const along = (k: number): Ray => ray(camera, [0.5 * k, 1 + 0.75 * k, faceZ]);

  it('картинка 1 × 0.75 × 0.02, уменьшенная вдвое при включённой сетке → 0.5 × 0.375 × 0.02', () => {
    const ctx = ctxOf([picture]);
    expect(getItem('image').flatAxis).toBe(2);
    expect(mustSize(resolveResize(picture, 'resize-uniform', along(0.5), env(ctx, GRID_STEP)))).toEqual([0.5, 0.375, 0.02]);
    // Чуть мимо половины: округляется наибольшая сторона (1 → 0.5), остальные выводятся из коэффициента.
    expect(mustSize(resolveResize(picture, 'resize-uniform', along(0.52), env(ctx, GRID_STEP)))).toEqual([0.5, 0.375, 0.02]);
  });

  it('без сетки наибольшая сторона округляется к сантиметру; толщина по flatAxis не меняется', () => {
    const ctx = ctxOf([picture]);
    const size = mustSize(resolveResize(picture, 'resize-uniform', along(0.52), env(ctx)));
    expect(size[0]).toBeCloseTo(0.52, 9);
    expect(size[1]).toBeCloseTo(0.39, 9);
    expect(size[2]).toBe(0.02);
    const bigger = mustSize(resolveResize(picture, 'resize-uniform', along(1.6), env(ctx, GRID_STEP)));
    expect(bigger[0]).toBeCloseTo(1.6, 9);
    expect(bigger[1]).toBeCloseTo(1.2, 9);
    expect(bigger[2]).toBe(0.02);
  });

  it('округляется только наибольшая сторона, пропорции сохраняются', () => {
    const ball = obj('ball', 'sphere', { kind: 'floor', x: 3, z: 1, lift: 0 }, { size: [0.4, 0.6, 0.3] });
    const ctx = ctxOf([ball]);
    // На плане: ось «центр основания → [w/2, h, d/2]», вертикальный луч даёт k по горизонтальной проекции.
    const k = 1.37;
    const size = mustSize(resolveResize(ball, 'resize-uniform', down(3 + 0.2 * k, 1 + 0.15 * k), env(ctx, GRID_STEP, 'top')));
    // Наибольшая сторона — высота: 0.6 × 1.37 = 0.822 → 0.8.
    expect(size[1]).toBeCloseTo(0.8, 9);
    expect(size[0] / size[1]).toBeCloseTo(0.4 / 0.6, 9);
    expect(size[2] / size[1]).toBeCloseTo(0.3 / 0.6, 9);
    const free = mustSize(resolveResize(ball, 'resize-uniform', down(3 + 0.2 * k, 1 + 0.15 * k), env(ctx, null, 'top')));
    // Без сетки наибольшая сторона округляется к сантиметру.
    expect(free[1]).toBeCloseTo(0.82, 9);
    expect(free[0] / free[1]).toBeCloseTo(0.4 / 0.6, 9);
  });

  it('потолочный объект: якорь — центр верха', () => {
    const ball = obj('ball', 'sphere', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
    const ctx = ctxOf([ball]);
    // Ручка — [w/2, 0, d/2] от якоря [0, h, 0]: точка на удвоенной длине лежит на 0.8 ниже потолочного верха.
    const top = H - 0.2;
    const target: Vec3 = [3 + 0.4, top - 0.8, 1 + 0.4];
    const size = mustSize(resolveResize(ball, 'resize-uniform', ray([3 + 0.4, top - 0.8, 6], target), env(ctx)));
    expect(size[0]).toBeCloseTo(0.8, 9);
    expect(size[1]).toBeCloseTo(0.8, 9);
    expect(size[2]).toBeCloseTo(0.8, 9);
    expect(resolvePose({ ...ball, size }, ctx).position[1] + size[1]).toBeCloseTo(top, 9);
  });

  it('пределы — через clampSize: коэффициент зажимается целиком', () => {
    const ball = obj('ball', 'sphere', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const ctx = ctxOf([ball]);
    const tiny = mustSize(resolveResize(ball, 'resize-uniform', down(3, 1), env(ctx, null, 'top')));
    expect(tiny).toEqual([MIN_SIZE, MIN_SIZE, MIN_SIZE]);
    // Курсор «за» якорем (отрицательный коэффициент) — тоже минимум, а не отскок к прежнему размеру.
    const behind = mustSize(resolveResize(ball, 'resize-uniform', down(2.5, 0.5), env(ctx, null, 'top')));
    expect(behind).toEqual([MIN_SIZE, MIN_SIZE, MIN_SIZE]);
    const huge = mustSize(resolveResize(ball, 'resize-uniform', down(3 + 30, 1 + 30), env(ctx, null, 'top')));
    expect(huge[0]).toBeCloseTo(MAX_SIZE, 9);
    expect(huge[1]).toBeCloseTo(MAX_SIZE, 9);
    expect(huge[2]).toBeCloseTo(MAX_SIZE, 9);
    for (const side of huge) expect(side).toBeLessThanOrEqual(MAX_SIZE);
  });

  it('луч вдоль прямой «якорь → ручка» и свободная ручка у uniform-объекта → null', () => {
    const ball = obj('ball', 'sphere', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const ctx = ctxOf([ball]);
    expect(resolveResize(ball, 'resize-uniform', ray([3 - 1, -2, 1 - 1], [3 + 0.2, 0.4, 1 + 0.2]), env(ctx))).toBeNull();
    expect(resolveResize(ball, 'resize-w', down(3.4, 1), env(ctx))).toBeNull();
  });
});

describe('resolveDrop', () => {
  // Ящик 0.5 под потолком 3 м: drop ∈ [0, 2.5].
  const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.2 });
  const level = (y: number): Ray => ({ origin: [3, y, 6], dir: [0, 0, -1] });

  it('drop = H − (y + 0.15) − h; x и z не меняются', () => {
    const ctx = ctxOf([cloud]);
    const mount = resolveDrop(cloud, level(1.85), env(ctx));
    expect(mount).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0.5 });
    // Ручка висит на 0.15 ниже объекта: после опуска она оказывается под курсором.
    const pose = resolvePose({ ...cloud, mount: mount as Mount }, ctx);
    expect(pose.position[1] - 0.15).toBeCloseTo(1.85, 9);
  });

  it('зажат в [0, H − h]', () => {
    const ctx = ctxOf([cloud]);
    expect(resolveDrop(cloud, level(2.9), env(ctx))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0 });
    expect(resolveDrop(cloud, level(5), env(ctx))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0 });
    expect(resolveDrop(cloud, level(-1), env(ctx))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: H - 0.5 });
    // Объект выше помещения: единственное допустимое значение — 0.
    const tall = { ...cloud, size: [0.5, 4, 0.5] as Vec3 };
    expect(resolveDrop(tall, level(1), env(ctxOf([tall])))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0 });
  });

  it('сетка округляет опуск к шагу, без сетки — к сантиметру; зажим идёт после округления', () => {
    const ctx = ctxOf([cloud]);
    expect(resolveDrop(cloud, level(1.83), env(ctx, GRID_STEP))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0.5 });
    expect(resolveDrop(cloud, level(1.826), env(ctx))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0.52 });
    // H − h = 2.55 не кратно шагу 0.1: округление вверх не выводит за предел.
    const odd = { ...cloud, size: [0.5, 0.45, 0.5] as Vec3 };
    expect(resolveDrop(odd, level(-0.2), env(ctxOf([odd]), GRID_STEP))).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: H - 0.45 });
  });

  it('не потолочный объект и вертикальный луч → null', () => {
    const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const ctx = ctxOf([cloud, crate]);
    expect(resolveDrop(crate, level(1), env(ctx))).toBeNull();
    expect(resolveDrop(cloud, down(3.1, 1), env(ctx, null, 'top'))).toBeNull();
  });
});
