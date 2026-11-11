import { describe, expect, it } from 'vitest';
import type { CatalogItem, CatalogLookup } from '../catalog/types';
import { applyCommand, invertCommand, touchedIds } from './commands';
import type { Command, ObjectPatch } from './commands';
import {
  MAX_SIZE,
  MIN_SIZE,
  clampSize,
  cmdDuplicate,
  cmdPatch,
  cmdRemove,
  cmdResetVenue,
  cmdSetMount,
  createObject,
  reconcileVenue,
  sanitizeLayout,
  venueDirty,
} from './ops';
import { LAYOUT_LIMITS, parseLayout } from './migrate';
import { makeContext, resolvePose, toWorld } from './pose';
import type { Pose } from './pose';
import { createRng } from './rng';
import type { Rng } from './rng';
import { testRoom } from './testRoom';
import type { Layout, Mount, MountKind, RoomDef, SceneObject, Vec3 } from './types';

// ---------- самодельный каталог (Р22: модель не импортирует src/catalog/index) ----------

function item(id: string, mounts: MountKind[], size: Vec3, over: Partial<CatalogItem> = {}): CatalogItem {
  return { id, kind: 'primitive', title: id, category: 'Тест', size, resize: 'free', color: '#808080', mounts, params: [], ...over };
}

const ALL: MountKind[] = ['floor', 'wall', 'ceiling', 'surface'];

const ITEMS: Record<string, CatalogItem> = {
  table: item('table', ['floor'], [1.1, 0.75, 0.7], { title: 'Стол', support: true }),
  sofaU: item('sofaU', ['floor'], [2.8, 0.85, 1.8]),
  box: item('box', ['floor', 'surface', 'ceiling'], [0.5, 0.5, 0.5], { title: 'Ящик', color: '#b8b2a7', support: true }),
  lantern: item('lantern', ['surface', 'floor'], [0.36, 0.35, 0.36], { resize: 'uniform' }),
  image: item('image', ALL, [1, 1, 0.02], { kind: 'image', resize: 'uniform', flatAxis: 2 }),
  imageFlat: item('imageFlat', ['floor', 'ceiling', 'surface'], [1, 0.02, 1], { kind: 'image', resize: 'uniform', flatAxis: 1 }),
  panel: item('panel', ['wall', 'floor', 'ceiling'], [1.5, 1, 0.03]),
  poster: item('poster', ['wall', 'floor'], [0.5, 0.7, 0.02], { defaultBottom: 1.6 }),
  lamp: item('lamp', ['ceiling', 'wall', 'floor', 'surface'], [0.15, 0.15, 0.15], { kind: 'light', resize: 'none', defaultDrop: 0.4 }),
  barrier: item('barrier', ['floor'], [2.2, 1.1, 0.5], { minSize: [0.4, 0.4, 0.3] }),
  cloud: item('cloud', ['ceiling'], [4, 1.1, 3], { minSize: [1, 0.6, 1], maxSize: [12, 2, 8] }),
  tree: item('tree', ['floor'], [0.8, 1.5, 0.8], { resize: 'uniform', minSize: [0.4, 0.75, 0.4], maxSize: [1.6, 3, 1.6] }),
  pillar: item('pillar', ['floor'], [1, 2, 1], { resize: 'uniform' }),
};
const FALLBACK = item('unknown', ALL, [0.5, 0.5, 0.5]);

const catalog: CatalogLookup = {
  getItem: (type) => ITEMS[type] ?? FALLBACK,
  isSupport: (o) => (ITEMS[o.type] ?? FALLBACK).support === true && o.visible && o.mount.kind === 'floor',
};

// ---------- помощники ----------

const H = testRoom.size.height;
const PODIUM = testRoom.platforms[0].height;
const EMPTY: Command = { type: 'batch', commands: [] };

const floor = (x: number, z: number, lift = 0): Mount => ({ kind: 'floor', x, z, lift });
const ceiling = (x: number, z: number, drop = 0): Mount => ({ kind: 'ceiling', x, z, drop });
const wall = (surfaceId: string, along: number, bottom: number): Mount => ({ kind: 'wall', surfaceId, along, bottom });
const onTop = (hostId: string, u: number, v: number): Mount => ({ kind: 'surface', hostId, u, v });

function obj(id: string, type: string, mount: Mount, over: Partial<SceneObject> = {}): SceneObject {
  const of = catalog.getItem(type);
  return {
    id,
    kind: of.kind,
    type,
    origin: 'user',
    name: id,
    mount,
    rotationY: 0,
    size: [of.size[0], of.size[1], of.size[2]],
    color: of.color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

function layoutOf(extra: SceneObject[] = [], fixtures: SceneObject[] = testRoom.fixtures): Layout {
  return { schemaVersion: 2, id: 'layout-test', name: 'Тест', roomId: testRoom.id, objects: [...structuredClone(fixtures), ...extra], updatedAt: 0 };
}

function get(layout: Layout, id: string): SceneObject {
  const o = layout.objects.find((x) => x.id === id);
  if (!o) throw new Error(`в макете нет объекта ${id}`);
  return o;
}

function mountAs<K extends MountKind>(o: SceneObject, kind: K): Extract<Mount, { kind: K }> {
  if (o.mount.kind !== kind) throw new Error(`${o.id}: ожидалось крепление ${kind}, а не ${o.mount.kind}`);
  return o.mount as Extract<Mount, { kind: K }>;
}

function poseOf(layout: Layout, id: string, room: RoomDef = testRoom): Pose {
  return resolvePose(get(layout, id), makeContext(room, layout.objects));
}

function expectVec(actual: Vec3, expected: Vec3) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
}

/** Крепление совпадает с ожидаемым с точностью до ошибок округления (длина грани колонны — результат hypot). */
function expectMount(actual: Mount, expected: Mount) {
  expect(actual.kind).toBe(expected.kind);
  const a = actual as unknown as Record<string, unknown>;
  const e = expected as unknown as Record<string, unknown>;
  expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort());
  for (const key of Object.keys(e)) {
    const value = e[key];
    if (typeof value === 'number') expect(a[key] as number, key).toBeCloseTo(value, 9);
    else expect(a[key], key).toBe(value);
  }
}

/** Инварианты I1, I2, I4, I5 + «sanitizeLayout ничего не меняет». */
function expectInvariants(layout: Layout, note = '', room: RoomDef = testRoom) {
  const ids = layout.objects.map((o) => o.id);
  expect(new Set(ids).size, `${note}: I1 — id уникальны`).toBe(ids.length);
  for (const o of layout.objects) {
    for (const side of o.size) {
      expect(Number.isFinite(side) && side >= MIN_SIZE && side <= MAX_SIZE, `${note}: I4 — размер ${o.id} = ${o.size.join(' × ')}`).toBe(true);
    }
    expect(Number.isFinite(o.rotationY), `${note}: I4 — угол ${o.id}`).toBe(true);
    if (o.mount.kind === 'surface') {
      const hostId = o.mount.hostId;
      const host = layout.objects.find((x) => x.id === hostId);
      expect(host !== undefined && host.id !== o.id, `${note}: I2 — хозяин ${o.id} существует`).toBe(true);
      expect(host?.mount.kind, `${note}: I2 — хозяин ${o.id} стоит на полу`).toBe('floor');
      expect(host?.visible, `${note}: I5 — хозяин ${o.id} виден`).toBe(true);
    }
  }
  expect(sanitizeLayout(layout, room) === layout, `${note}: sanitizeLayout не меняет макет`).toBe(true);
  // Всё, что оставляют построители, переживает сохранение и загрузку: parseLayout не отбрасывает ни одного объекта.
  const drops: string[] = [];
  const saved: unknown = JSON.parse(JSON.stringify(layout));
  const reloaded = parseLayout(saved, (index, reason) => drops.push(`${index}: ${reason}`));
  expect(drops, `${note}: parseLayout ничего не отбрасывает`).toEqual([]);
  // Сравнение с тем, что записано (JSON превращает −0 в 0), — ни одно поле не потеряно и не изменено.
  expect(reloaded, `${note}: макет переживает JSON`).toEqual(saved);
}

/** Применяет команду и проверяет, что обратная команда возвращает макет deep-equal (один обратимый шаг). */
function applyReversible(before: Layout, cmd: Command): Layout {
  const frozen = structuredClone(before);
  const after = applyCommand(before, cmd);
  expect(before, 'вход не мутируется').toEqual(frozen);
  expect(applyCommand(after, invertCommand(before, cmd)), 'обратная команда восстанавливает макет').toEqual(before);
  return after;
}

const patch = (layout: Layout, id: string, set: ObjectPatch) => cmdPatch(layout, id, set, testRoom, catalog);

// ---------- createObject ----------

describe('createObject', () => {
  it('умолчания: id obj-…, origin user, имя и остальное — из записи каталога', () => {
    const o = createObject(ITEMS.box, floor(1, 2));
    expect(o.id).toMatch(/^obj-[a-z0-9]{8}$/);
    expect(o).toEqual({
      id: o.id,
      kind: 'primitive',
      type: 'box',
      origin: 'user',
      name: 'Ящик',
      mount: floor(1, 2),
      rotationY: 0,
      size: [0.5, 0.5, 0.5],
      color: '#b8b2a7',
      assetId: null,
      locked: false,
      visible: true,
      params: {},
    });
    // Размер — копия: правка объекта не портит запись каталога.
    expect(o.size).not.toBe(ITEMS.box.size);
    expect(createObject(ITEMS.lamp, ceiling(0, 0, 0.4)).kind).toBe('light');
  });

  it('у каждого объекта свой id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createObject(ITEMS.box, floor(0, 0)).id));
    expect(ids.size).toBe(50);
  });

  it('init перекрывает имя, размер, цвет, угол, файл и параметры', () => {
    const params = { glow: true };
    const o = createObject(ITEMS.image, wall('far', 2, 1), {
      name: 'Афиша',
      size: [1, 0.75, 0.02],
      color: '#112233',
      rotationY: 0.5,
      assetId: 'a_0123456789abcdef0123456789abcdef',
      params,
    });
    expect(o.name).toBe('Афиша');
    expect(o.kind).toBe('image');
    expect(o.size).toEqual([1, 0.75, 0.02]);
    expect(o.color).toBe('#112233');
    expect(o.rotationY).toBe(0.5);
    expect(o.assetId).toBe('a_0123456789abcdef0123456789abcdef');
    expect(o.params).toEqual({ glow: true });
    expect(o.params).not.toBe(params);
    expect(o.origin).toBe('user');
    expect(o.locked).toBe(false);
    expect(o.visible).toBe(true);
  });

  it('негодный init не даёт объект, который нарушит I4 или пропадёт при загрузке', () => {
    // Очень вытянутая картинка (1 × 30/8000), сторона NaN и сторона больше предела.
    const thin = createObject(ITEMS.image, wall('far', 2, 1), { size: [1, 30 / 8000, 0.02] });
    expect(thin.size).toEqual([1, MIN_SIZE, 0.02]);
    const odd = createObject(ITEMS.box, floor(1, 1), { size: [Number.NaN, 25, -1] });
    expect(odd.size).toEqual([0.5, MAX_SIZE, 0.5]);

    const bad = createObject(ITEMS.box, floor(1, 1), {
      color: 'red',
      assetId: 'photo.png',
      rotationY: Number.NaN,
      params: Object.fromEntries(Array.from({ length: LAYOUT_LIMITS.paramKeys + 1 }, (_, i) => [`k${i}`, i])),
    });
    expect(bad.color).toBe(ITEMS.box.color);
    expect(bad.assetId).toBeNull();
    expect(bad.rotationY).toBe(0);
    expect(bad.params).toEqual({});
    expect(createObject(ITEMS.box, floor(1, 1), { color: '#fff' }).color).toBe(ITEMS.box.color);

    expectInvariants(layoutOf([{ ...thin, id: 'thin' }, { ...odd, id: 'odd' }, { ...bad, id: 'bad' }]));
  });
});

// ---------- clampSize ----------

describe('clampSize', () => {
  it('uniform + flatAxis: картинка 1 × 0.75 × 0.02 с коэффициентом 0.5 → 0.5 × 0.375 × 0.02', () => {
    const prev: Vec3 = [1, 0.75, 0.02];
    const next = clampSize(ITEMS.image, prev, [0.5, 0.375, 0.01]);
    expect(next).toEqual([0.5, 0.375, 0.02]);
    // Пропорции точные, толщина листа не тронута.
    expect(next[0] / next[1]).toBe(prev[0] / prev[1]);
    expect(next[2]).toBe(prev[2]);
    // Достаточно изменить одну ось — вторая едет за ней; ось толщины в коэффициенте не участвует.
    expect(clampSize(ITEMS.image, prev, [0.5, 0.75, 0.02])).toEqual([0.5, 0.375, 0.02]);
    expect(clampSize(ITEMS.image, prev, [1, 0.75, 5])).toBe(prev);
    // Картинка плашмя: толщина — ось Y.
    expect(clampSize(ITEMS.imageFlat, [1, 0.02, 0.6], [2, 0.5, 1.2])).toEqual([2, 0.02, 1.2]);
  });

  it('uniform: один коэффициент по оси с наибольшим относительным изменением', () => {
    const prev: Vec3 = [1, 2, 1];
    expect(clampSize(ITEMS.pillar, prev, [1, 2, 1.5])).toEqual([1.5, 3, 1.5]);
    expect(clampSize(ITEMS.pillar, prev, [1.2, 1, 1])).toEqual([0.5, 1, 0.5]);
    expect(clampSize(ITEMS.pillar, prev, [1, 2, 1])).toBe(prev);
  });

  it('free меняет одну ось и не трогает остальные (толщина щита 0.03)', () => {
    const prev: Vec3 = [1.5, 1, 0.03];
    expect(clampSize(ITEMS.panel, prev, [2, 1, 0.03])).toEqual([2, 1, 0.03]);
    expect(clampSize(ITEMS.panel, prev, [1.5, 0.4, 0.03])).toEqual([1.5, 0.4, 0.03]);
    expect(clampSize(ITEMS.panel, prev, [1.5, 1, 0.03])).toBe(prev);
  });

  it('none → prev при любом входе', () => {
    const prev: Vec3 = [0.15, 0.15, 0.15];
    expect(clampSize(ITEMS.lamp, prev, [1, 2, 3])).toBe(prev);
    expect(clampSize(ITEMS.lamp, prev, [0, NaN, -1])).toBe(prev);
  });

  it('0, отрицательное, NaN, Infinity → прежнее значение оси', () => {
    const prev: Vec3 = [1.5, 1, 0.03];
    expect(clampSize(ITEMS.panel, prev, [0, -2, NaN])).toBe(prev);
    expect(clampSize(ITEMS.panel, prev, [Infinity, 1, 0.03])).toBe(prev);
    expect(clampSize(ITEMS.panel, prev, [0, 2, NaN])).toEqual([1.5, 2, 0.03]);
    const uniform: Vec3 = [0.36, 0.35, 0.36];
    expect(clampSize(ITEMS.lantern, uniform, [0, 0, 0])).toBe(uniform);
    expect(clampSize(ITEMS.lantern, uniform, [NaN, -1, Infinity])).toBe(uniform);
  });

  it('1000 и 0.000001 → в пределах [MIN_SIZE, MAX_SIZE] и minSize / maxSize', () => {
    expect(clampSize(ITEMS.panel, [1.5, 1, 0.03], [1000, 0.000001, 0.03])).toEqual([MAX_SIZE, MIN_SIZE, 0.03]);
    expect(clampSize(ITEMS.barrier, [2.2, 1.1, 0.5], [0.1, 0.1, 0.1])).toEqual([0.4, 0.4, 0.3]);
    expect(clampSize(ITEMS.barrier, [2.2, 1.1, 0.5], [1000, 1000, 1000])).toEqual([MAX_SIZE, MAX_SIZE, MAX_SIZE]);
    expect(clampSize(ITEMS.cloud, [4, 1.1, 3], [100, 100, 100])).toEqual([12, 2, 8]);
    expect(clampSize(ITEMS.cloud, [4, 1.1, 3], [0.1, 0.1, 0.1])).toEqual([1, 0.6, 1]);
  });

  it('uniform упирается в предел, не ломая пропорций', () => {
    const prev: Vec3 = [0.36, 0.35, 0.36];
    const big = clampSize(ITEMS.lantern, prev, [360, 350, 360]);
    expect(Math.max(...big)).toBeCloseTo(MAX_SIZE, 9);
    expect(big[1] / big[0]).toBeCloseTo(prev[1] / prev[0], 12);
    expect(big[2] / big[0]).toBeCloseTo(prev[2] / prev[0], 12);
    const small = clampSize(ITEMS.lantern, prev, [0.00036, 0.00035, 0.00036]);
    expect(Math.min(...small)).toBeCloseTo(MIN_SIZE, 9);
    expect(small[1] / small[0]).toBeCloseTo(prev[1] / prev[0], 12);
    // Пределы — строгие, без допуска на округление (I4).
    for (const side of [...big, ...small]) {
      expect(side).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(side).toBeLessThanOrEqual(MAX_SIZE);
    }
    // minSize / maxSize записи каталога.
    const tree: Vec3 = [0.8, 1.5, 0.8];
    const down = clampSize(ITEMS.tree, tree, [0.01, 1.5, 0.8]);
    expect(down[0]).toBeCloseTo(0.4, 12);
    expect(down[1]).toBeCloseTo(0.75, 12);
    expect(down[2]).toBeCloseTo(0.4, 12);
    const up = clampSize(ITEMS.tree, tree, [0.8, 1000, 0.8]);
    expect(up[0]).toBeCloseTo(1.6, 12);
    expect(up[1]).toBeCloseTo(3, 12);
    expect(up[2]).toBeCloseTo(1.6, 12);
  });

  it('свойство: результат всегда в пределах (строго), пропорции uniform сохраняются, результат — неподвижная точка', () => {
    // Регрессия: prev × (MAX_SIZE / prev) давало 20.000000000000004 — нарушение I4, которое «чинил» sanitizeLayout.
    const rng = createRng(239);
    const items = [ITEMS.lantern, ITEMS.pillar, ITEMS.tree, ITEMS.image, ITEMS.imageFlat, ITEMS.panel, ITEMS.barrier, ITEMS.cloud];
    for (let n = 0; n < 4000; n++) {
      const of = rng.pick(items);
      const lo = (i: number) => Math.max(MIN_SIZE, of.minSize?.[i] ?? 0);
      const hi = (i: number) => Math.min(MAX_SIZE, of.maxSize?.[i] ?? Infinity);
      const prev: Vec3 = [rng.range(lo(0), hi(0)), rng.range(lo(1), hi(1)), rng.range(lo(2), hi(2))];
      const wild = () => rng.pick([0, -1, NaN, Infinity, 1e-9, 1e9, rng.range(0.001, 30), rng.range(0.001, 30)]);
      const next = clampSize(of, prev, [wild(), wild(), wild()]);
      const note = `${of.id}: ${prev.join(' × ')} → ${next.join(' × ')}`;
      for (let i = 0; i < 3; i++) {
        if (i === of.flatAxis) {
          expect(next[i], note).toBe(prev[i]);
          continue;
        }
        expect(next[i], note).toBeGreaterThanOrEqual(lo(i));
        expect(next[i], note).toBeLessThanOrEqual(hi(i));
        if (of.resize === 'uniform') expect(next[i] / prev[i], note).toBeCloseTo(next[of.flatAxis === 0 ? 1 : 0] / prev[of.flatAxis === 0 ? 1 : 0], 9);
      }
      expect(clampSize(of, next, next), note).toBe(next);
    }
  });

  it('не мутирует вход', () => {
    const prev: Vec3 = [1.5, 1, 0.03];
    const next: Vec3 = [1000, 0, 0.03];
    clampSize(ITEMS.panel, prev, next);
    expect(prev).toEqual([1.5, 1, 0.03]);
    expect(next).toEqual([1000, 0, 0.03]);
  });
});

// ---------- cmdPatch ----------

describe('cmdPatch', () => {
  it('объекта нет или патч ничего не меняет → пустой batch', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1))]);
    expect(patch(layout, 'ghost', { color: '#111111' })).toEqual(EMPTY);
    expect(patch(layout, 'box', {})).toEqual(EMPTY);
    expect(patch(layout, 'box', { color: '#b8b2a7', mount: floor(1, 1), size: [0.5, 0.5, 0.5], visible: true })).toEqual(EMPTY);
  });

  it('обычный патч — одна команда patch только с изменившимися ключами', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1))]);
    const cmd = patch(layout, 'box', { color: '#111111', name: 'box', rotationY: 1 });
    expect(cmd).toEqual({ type: 'patch', patches: [{ id: 'box', set: { color: '#111111', rotationY: 1 } }] });
    const after = applyReversible(layout, cmd);
    expect(get(after, 'box').color).toBe('#111111');
    expectInvariants(after);
  });

  it('цвет не вида #rrggbb, негодный assetId и негодные params отбрасываются (иначе объект пропал бы при загрузке)', () => {
    const layout = layoutOf([obj('pic', 'image', wall('far', 2, 1))]);
    for (const color of ['#fff', 'red', '', '#12345g', '#1234567']) {
      expect(patch(layout, 'pic', { color }), color).toEqual(EMPTY);
    }
    for (const assetId of ['photo.png', '', 'a_123', `a_${'G'.repeat(32)}`]) {
      expect(patch(layout, 'pic', { assetId }), assetId).toEqual(EMPTY);
    }
    const tooMany = Object.fromEntries(Array.from({ length: LAYOUT_LIMITS.paramKeys + 1 }, (_, i) => [`k${i}`, i]));
    expect(patch(layout, 'pic', { params: tooMany })).toEqual(EMPTY);

    // Негодный ключ не мешает остальным ключам того же патча.
    expect(patch(layout, 'pic', { color: 'red', name: 'Фото' })).toEqual({ type: 'patch', patches: [{ id: 'pic', set: { name: 'Фото' } }] });

    // Годные значения проходят; assetId можно снять (null).
    const assetId = `a_${'0123456789abcdef'.repeat(2)}`;
    const cmd = patch(layout, 'pic', { color: '#A1b2C3', assetId, params: { glow: true } });
    expect(cmd).toEqual({ type: 'patch', patches: [{ id: 'pic', set: { color: '#A1b2C3', assetId, params: { glow: true } } }] });
    const after = applyReversible(layout, cmd);
    expectInvariants(after);
    const cleared = applyReversible(after, patch(after, 'pic', { assetId: null }));
    expect(get(cleared, 'pic').assetId).toBeNull();
    expectInvariants(cleared);
  });

  it('заблокированный принимает только locked / visible', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1), { locked: true })]);
    expect(patch(layout, 'box', { color: '#111111', mount: floor(2, 2), size: [1, 1, 1], name: 'x', rotationY: 1, params: { a: 1 } })).toEqual(EMPTY);
    expect(patch(layout, 'box', { visible: false, color: '#111111' })).toEqual({
      type: 'patch',
      patches: [{ id: 'box', set: { visible: false } }],
    });
    // Разблокировка и правка одним патчем: правка отбрасывается, замок снимается.
    expect(patch(layout, 'box', { locked: false, color: '#111111' })).toEqual({
      type: 'patch',
      patches: [{ id: 'box', set: { locked: false } }],
    });
    const unlocked = applyCommand(layout, patch(layout, 'box', { locked: false }));
    expect(get(applyCommand(unlocked, patch(unlocked, 'box', { color: '#111111' })), 'box').color).toBe('#111111');
  });

  it('размер проходит clampSize', () => {
    const layout = layoutOf([
      obj('box', 'box', floor(1, 1)),
      obj('lamp', 'lamp', ceiling(1, 1, 0.4)),
      obj('pic', 'image', wall('far', 3, 1), { size: [1, 0.75, 0.02] }),
    ]);
    let after = applyReversible(layout, patch(layout, 'box', { size: [1000, 0, NaN] }));
    expect(get(after, 'box').size).toEqual([MAX_SIZE, 0.5, 0.5]);
    expectInvariants(after);
    // resize 'none' — размер не меняется вовсе.
    expect(patch(layout, 'lamp', { size: [1, 1, 1] })).toEqual(EMPTY);
    // uniform + flatAxis.
    after = applyReversible(layout, patch(layout, 'pic', { size: [0.5, 0.75, 0.5] }));
    expect(get(after, 'pic').size).toEqual([0.5, 0.375, 0.02]);
    // Размер 0 ничего не меняет, макет остаётся чистым.
    expect(patch(layout, 'box', { size: [0, 0, 0] })).toEqual(EMPTY);
    expectInvariants(applyCommand(layout, patch(layout, 'box', { size: [0, 0, 0] })));
  });

  it('крепление проходит clampMount', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1)), obj('pic', 'poster', wall('far', 3, 1))]);
    let after = applyReversible(layout, patch(layout, 'box', { mount: floor(100, -100, 50) }));
    expect(get(after, 'box').mount).toEqual(floor(5, -3, H - 0.5));
    after = applyReversible(layout, patch(layout, 'box', { mount: ceiling(-100, 100, 50) }));
    expect(get(after, 'box').mount).toEqual(ceiling(-5, 3, H - 0.5));
    after = applyReversible(layout, patch(layout, 'pic', { mount: wall('col:s', 5, 50) }));
    expectMount(get(after, 'pic').mount, wall('col:s', 0.8 - 0.25, H - 0.7));
    after = applyReversible(layout, patch(layout, 'box', { mount: onTop('venue-table', 5, -5) }));
    expect(get(after, 'box').mount).toEqual(onTop('venue-table', 0.55, -0.35));
    expectInvariants(after);
    // Не-числа не протекают в макет.
    after = applyCommand(layout, patch(layout, 'box', { mount: floor(NaN, Infinity, NaN), rotationY: NaN }));
    expect(get(after, 'box').mount).toEqual(floor(0, 0, 0));
    expect(get(after, 'box').rotationY).toBe(0);
    expectInvariants(after);
  });

  it('угол: обычные значения не трогаются, запредельные приводятся по модулю 2π (иначе объект не пережил бы загрузку)', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1), { rotationY: 0.5 })]);
    for (const angle of [7, -7, 3 * Math.PI, -400, LAYOUT_LIMITS.coord]) {
      expect(get(applyCommand(layout, patch(layout, 'box', { rotationY: angle })), 'box').rotationY, String(angle)).toBe(angle);
    }
    for (const angle of [LAYOUT_LIMITS.coord + 1, -30000, 123456.789]) {
      const after = applyReversible(layout, patch(layout, 'box', { rotationY: angle }));
      const stored = get(after, 'box').rotationY;
      expect(Math.abs(stored), String(angle)).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.sin(stored), String(angle)).toBeCloseTo(Math.sin(angle), 6);
      expect(Math.cos(stored), String(angle)).toBeCloseTo(Math.cos(angle), 6);
      expectInvariants(after, String(angle));
    }
    // Не число — ключ отбрасывается, угол остаётся прежним.
    for (const angle of [NaN, Infinity, -Infinity]) expect(patch(layout, 'box', { rotationY: angle }), String(angle)).toEqual(EMPTY);
    expectInvariants(applyCommand(layout, patch(layout, 'box', { rotationY: 1e300 })));
  });

  it('изменение размера заново зажимает текущее крепление и включает его в патч', () => {
    const layout = layoutOf([obj('box', 'box', ceiling(1, 1, 2.4)), obj('pic', 'panel', wall('col:s', 0.4, 2))]);
    const cmd = patch(layout, 'box', { size: [0.5, 2, 0.5] });
    expect(cmd).toEqual({ type: 'patch', patches: [{ id: 'box', set: { size: [0.5, 2, 0.5], mount: ceiling(1, 1, 1) } }] });
    // Щит стал выше — низ опускается, чтобы верх остался под потолком.
    const after = applyReversible(layout, patch(layout, 'pic', { size: [1.5, 2.5, 0.03] }));
    expectMount(get(after, 'pic').mount, wall('col:s', 0.4, 0.5));
    expectInvariants(after);
  });

  it('скрытие стола с фонарём: фонарь на полу в тех же мировых X/Z, затем стол невидим — один обратимый шаг', () => {
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table2', 0.2, 0.1), { rotationY: 0.3 })]);
    // Стол повёрнут на π/2 и стоит на подиуме.
    const world = poseOf(before, 'lantern');
    expectVec(world.position, [-1.9, PODIUM + 0.75, -2.2]);

    const cmd = patch(before, 'venue-table2', { visible: false });
    if (cmd.type !== 'batch') throw new Error('ожидался batch[patch детей, patch хозяина]');
    expect(cmd.commands).toHaveLength(2);
    expect(touchedIds(cmd.commands[0])).toEqual(['lantern']);
    expect(touchedIds(cmd.commands[1])).toEqual(['venue-table2']);

    const after = applyReversible(before, cmd);
    expect(get(after, 'venue-table2').visible).toBe(false);
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(m.lift).toBe(0);
    const landed = poseOf(after, 'lantern');
    expectVec(landed.position, [world.position[0], PODIUM, world.position[2]]);
    expect(landed.rotationY).toBeCloseTo(world.rotationY, 9);
    expect(landed.rotationY).toBeCloseTo(Math.PI / 2 + 0.3, 9);
    expectInvariants(after);

    // Повторный показ хозяина детей обратно не поднимает.
    const shown = applyCommand(after, patch(after, 'venue-table2', { visible: true }));
    expect(get(shown, 'venue-table2').visible).toBe(true);
    expect(get(shown, 'lantern').mount).toEqual(get(after, 'lantern').mount);
  });

  it('мировой угол ребёнка (угол хозяина + свой) за пределом сохранения приводится по модулю 2π', () => {
    const before = layoutOf([
      obj('desk', 'table', floor(3, 2), { rotationY: 400 }),
      obj('lantern', 'lantern', onTop('desk', 0.1, 0), { rotationY: 300 }),
    ]);
    expectInvariants(before);
    const world = poseOf(before, 'lantern');
    const after = applyReversible(before, patch(before, 'desk', { visible: false }));
    const stored = get(after, 'lantern').rotationY;
    expect(Math.abs(stored)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(Math.sin(stored)).toBeCloseTo(Math.sin(world.rotationY), 9);
    expect(Math.cos(stored)).toBeCloseTo(Math.cos(world.rotationY), 9);
    expectInvariants(after);
    // То же при загрузке битого макета.
    const broken = applyCommand(before, { type: 'patch', patches: [{ id: 'desk', set: { visible: false } }] });
    const fixed = sanitizeLayout(broken, testRoom);
    expect(get(fixed, 'lantern').rotationY).toBeCloseTo(stored, 9);
    expectInvariants(fixed);
  });

  it('хозяин остаётся на полу и виден — дети не трогаются и едут вместе с ним', () => {
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table', 0.2, 0.1))]);
    const cmd = patch(before, 'venue-table', { mount: floor(3, 2), rotationY: Math.PI / 2, color: '#222222' });
    expect(touchedIds(cmd)).toEqual(['venue-table']);
    const after = applyReversible(before, cmd);
    expect(get(after, 'lantern')).toBe(get(before, 'lantern'));
    expectVec(poseOf(after, 'lantern').position, [3.1, 0.75, 1.8]);
    expectInvariants(after);
  });

  it('surface на несуществующего, скрытого или не стоящего на полу хозяина отбрасывается вместе с rotationY', () => {
    const layout = layoutOf([
      obj('lantern', 'lantern', floor(1, 1)),
      obj('hidden', 'table', floor(3, 2), { visible: false }),
      obj('hanging', 'box', ceiling(3, -2, 0)),
      obj('stacked', 'box', onTop('venue-table', 0, 0)),
    ]);
    for (const hostId of ['ghost', 'hidden', 'hanging', 'stacked', 'lantern']) {
      expect(patch(layout, 'lantern', { mount: onTop(hostId, 0, 0), rotationY: 1 }), hostId).toEqual(EMPTY);
      // Остальные ключи того же патча применяются.
      expect(patch(layout, 'lantern', { mount: onTop(hostId, 0, 0), rotationY: 1, color: '#111111' }), hostId).toEqual({
        type: 'patch',
        patches: [{ id: 'lantern', set: { color: '#111111' } }],
      });
    }
    // Допустимый хозяин: существует, не сам объект, стоит на полу и виден.
    const ok = applyReversible(layout, patch(layout, 'lantern', { mount: onTop('venue-table', 0.1, 0.1), rotationY: 1 }));
    expect(get(ok, 'lantern').mount).toEqual(onTop('venue-table', 0.1, 0.1));
    expect(get(ok, 'lantern').rotationY).toBe(1);
    expectInvariants(ok);
  });

  it('wall с неизвестным surfaceId отбрасывается', () => {
    const layout = layoutOf([obj('pic', 'poster', wall('far', 3, 1))]);
    expect(patch(layout, 'pic', { mount: wall('nope', 1, 1) })).toEqual(EMPTY);
    expect(patch(layout, 'pic', { mount: wall('col:x', 1, 1), color: '#111111' })).toEqual({
      type: 'patch',
      patches: [{ id: 'pic', set: { color: '#111111' } }],
    });
    const after = applyReversible(layout, patch(layout, 'pic', { mount: wall('col:e', 0.3, 1) }));
    expect(get(after, 'pic').mount).toEqual(wall('col:e', 0.3, 1));
    expectInvariants(after);
  });

  it('патч, ставящий ящик с фонарём на стол, сначала опускает фонарь на пол (I2 цел)', () => {
    const before = layoutOf([
      obj('box', 'box', floor(1, 1), { rotationY: Math.PI / 2 }),
      obj('lantern', 'lantern', onTop('box', 0.1, 0), { rotationY: 0.2 }),
    ]);
    const world = poseOf(before, 'lantern');
    expectVec(world.position, [1, 0.5, 0.9]);

    const cmd = patch(before, 'box', { mount: onTop('venue-table', 0, 0), rotationY: 0 });
    if (cmd.type !== 'batch') throw new Error('ожидался batch[patch детей, patch хозяина]');
    expect(touchedIds(cmd.commands[0])).toEqual(['lantern']);
    expect(touchedIds(cmd.commands[1])).toEqual(['box']);

    const after = applyReversible(before, cmd);
    expect(get(after, 'box').mount).toEqual(onTop('venue-table', 0, 0));
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(m.lift).toBe(0);
    expect(get(after, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    // После команды sanitizeLayout ничего не меняет.
    expect(sanitizeLayout(after, testRoom)).toBe(after);
    expectInvariants(after);
  });

  it('перевод хозяина на потолок или стену тоже сначала опускает детей', () => {
    const before = layoutOf([obj('box', 'box', floor(1, 1)), obj('lantern', 'lantern', onTop('box', 0.1, -0.1))]);
    for (const mount of [ceiling(1, 1, 0.2), wall('near', 4, 1)]) {
      const after = applyReversible(before, patch(before, 'box', { mount }));
      expect(get(after, 'box').mount.kind, mount.kind).toBe(mount.kind);
      expect(get(after, 'lantern').mount, mount.kind).toEqual(floor(1.1, 0.9));
      expectInvariants(after, mount.kind);
    }
  });

  it('хозяин уменьшился — предметы на нём остаются в пределах столешницы', () => {
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table', 0.5, 0.3))]);
    const after = applyReversible(before, patch(before, 'venue-table', { size: [0.6, 0.75, 0.4] }));
    expect(get(after, 'lantern').mount).toEqual(onTop('venue-table', 0.3, 0.2));
    expectInvariants(after);
  });

  it('скрытие через патч заблокированного хозяина тоже опускает детей', () => {
    const before = layoutOf([
      obj('desk', 'table', floor(3, 2), { locked: true }),
      obj('lantern', 'lantern', onTop('desk', 0.2, 0.1)),
    ]);
    const after = applyReversible(before, patch(before, 'desk', { visible: false, color: '#111111' }));
    expect(get(after, 'desk').visible).toBe(false);
    expect(get(after, 'desk').color).toBe(get(before, 'desk').color);
    expect(get(after, 'lantern').mount).toEqual(floor(3.2, 2.1));
    expectInvariants(after);
  });
});

// ---------- cmdRemove ----------

describe('cmdRemove', () => {
  it('удаление стола роняет детей на пол в тех же X/Z; undo возвращает стол и детей на столешницу', () => {
    const before = layoutOf([
      obj('desk', 'table', floor(3, 2), { rotationY: Math.PI / 2 }),
      obj('lantern', 'lantern', onTop('desk', 0.2, -0.1), { rotationY: 0.4 }),
      obj('other', 'box', floor(0, 2)),
    ]);
    const world = poseOf(before, 'lantern');
    expectVec(world.position, [2.9, 0.75, 1.8]);

    const cmd = cmdRemove(before, ['desk'], testRoom);
    const after = applyReversible(before, cmd);
    expect(after.objects.map((o) => o.id)).not.toContain('desk');
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(m.lift).toBe(0);
    expect(get(after, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    expect(get(after, 'other')).toBe(get(before, 'other'));
    expectInvariants(after);
  });

  it('удаление мебели площадки = скрытие, и её дети тоже на полу', () => {
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table', 0.3, -0.1))]);
    const world = poseOf(before, 'lantern');
    expectVec(world.position, [-1.7, 0.75, 0.9]);

    const cmd = cmdRemove(before, ['venue-table'], testRoom);
    const after = applyReversible(before, cmd);
    expect(after.objects).toHaveLength(before.objects.length);
    expect(get(after, 'venue-table').visible).toBe(false);
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expectInvariants(after);

    // Одно правило скрытия для всех путей: «Удалить» на мебели площадки и «Скрыть» дают один и тот же макет.
    expect(after).toEqual(applyCommand(before, patch(before, 'venue-table', { visible: false })));
    // Уже скрытая мебель — пустая команда.
    expect(cmdRemove(after, ['venue-table'], testRoom)).toEqual(EMPTY);
  });

  it('заблокированные пропускаются', () => {
    const before = layoutOf([
      obj('locked', 'box', floor(1, 1), { locked: true }),
      obj('free', 'box', floor(2, 2)),
    ]);
    expect(cmdRemove(before, ['locked'], testRoom)).toEqual(EMPTY);
    const after = applyReversible(before, cmdRemove(before, ['locked', 'free'], testRoom));
    expect(after.objects.map((o) => o.id)).toContain('locked');
    expect(after.objects.map((o) => o.id)).not.toContain('free');

    const venueLocked = applyCommand(before, patch(before, 'venue-table', { locked: true }));
    expect(cmdRemove(venueLocked, ['venue-table'], testRoom)).toEqual(EMPTY);
  });

  it('заблокированный ребёнок удаляемого хозяина всё равно опускается на пол (I2)', () => {
    const before = layoutOf([
      obj('desk', 'table', floor(3, 2)),
      obj('lantern', 'lantern', onTop('desk', 0.2, 0.1), { locked: true }),
    ]);
    const after = applyReversible(before, cmdRemove(before, ['desk'], testRoom));
    expect(get(after, 'lantern').mount).toEqual(floor(3.2, 2.1));
    expectInvariants(after);
  });

  it('хозяин и ребёнок удаляются вместе одной командой remove', () => {
    const before = layoutOf([obj('desk', 'table', floor(3, 2)), obj('lantern', 'lantern', onTop('desk', 0.2, 0.1))]);
    const cmd = cmdRemove(before, ['desk', 'lantern'], testRoom);
    expect(cmd.type).toBe('remove');
    const after = applyReversible(before, cmd);
    expect(after.objects.map((o) => o.id)).toEqual(testRoom.fixtures.map((o) => o.id));
    expectInvariants(after);
  });

  it('неизвестные id и пустой список → пустой batch', () => {
    const before = layoutOf();
    expect(cmdRemove(before, [], testRoom)).toEqual(EMPTY);
    expect(cmdRemove(before, ['ghost'], testRoom)).toEqual(EMPTY);
  });
});

// ---------- cmdDuplicate ----------

describe('cmdDuplicate', () => {
  it('копия: новый id, имя, сдвиг 0.3 м, origin user; встаёт сразу после оригинала', () => {
    const before = layoutOf([
      obj('a', 'box', floor(1, 1), { name: 'Ящик', color: '#123456', rotationY: 0.5, params: { n: 1 } }),
      obj('b', 'box', floor(2, 2)),
    ]);
    const { command, newIds } = cmdDuplicate(before, ['a'], testRoom);
    expect(newIds).toHaveLength(1);
    const after = applyReversible(before, command);
    const index = after.objects.findIndex((o) => o.id === 'a');
    const copy = after.objects[index + 1];
    expect(copy.id).toBe(newIds[0]);
    expect(copy.id).not.toBe('a');
    expect(copy.id).toMatch(/^obj-/);
    expect(after.objects[index + 2].id).toBe('b');
    expect(copy).toEqual({ ...get(before, 'a'), id: copy.id, name: 'Ящик (копия)', mount: floor(1.3, 1) });
    // Копия независима от оригинала.
    expect(copy.size).not.toBe(get(before, 'a').size);
    expect(copy.params).not.toBe(get(before, 'a').params);
    expectInvariants(after);
  });

  it('копия мебели площадки — пользовательский объект без замка; стоящее на оригинале не копируется', () => {
    const base = layoutOf([obj('lantern', 'lantern', onTop('venue-table', 0.1, 0.1))]);
    const before = applyCommand(base, patch(base, 'venue-table', { locked: true }));
    const { command, newIds } = cmdDuplicate(before, ['venue-table'], testRoom);
    const after = applyReversible(before, command);
    expect(after.objects).toHaveLength(before.objects.length + 1);
    const copy = get(after, newIds[0]);
    expect(copy.origin).toBe('user');
    expect(copy.locked).toBe(false);
    expect(copy.type).toBe('table');
    expect(copy.mount).toEqual(floor(-1.7, 1));
    expect(after.objects.indexOf(copy)).toBe(after.objects.findIndex((o) => o.id === 'venue-table') + 1);
    expect(after.objects.filter((o) => o.mount.kind === 'surface' && o.mount.hostId === copy.id)).toEqual([]);
    expect(get(after, 'lantern')).toBe(get(before, 'lantern'));
    expectInvariants(after);
  });

  it('сдвиг по x | along | u и clampMount', () => {
    const before = layoutOf([
      obj('edge', 'box', floor(4.9, 0)),
      obj('hang', 'box', ceiling(1, 1, 0.2)),
      obj('pic', 'poster', wall('far', 3, 1)),
      obj('narrow', 'poster', wall('col:s', 0.5, 1)),
      obj('lantern', 'lantern', onTop('venue-table', 0.4, 0.1)),
    ]);
    const { command, newIds } = cmdDuplicate(before, ['edge', 'hang', 'pic', 'narrow', 'lantern'], testRoom);
    expect(newIds).toHaveLength(5);
    const after = applyReversible(before, command);
    expect(get(after, newIds[0]).mount).toEqual(floor(5, 0));
    expect(get(after, newIds[1]).mount).toEqual(ceiling(1.3, 1, 0.2));
    expect(get(after, newIds[2]).mount).toEqual(wall('far', 3.3, 1));
    expectMount(get(after, newIds[3]).mount, wall('col:s', 0.8 - 0.25, 1));
    expect(get(after, newIds[4]).mount).toEqual(onTop('venue-table', 0.55, 0.1));
    expectInvariants(after);
  });

  it('несколько объектов: каждая копия — сразу после своего оригинала', () => {
    const before = layoutOf([obj('a', 'box', floor(1, 1)), obj('b', 'box', floor(2, 2)), obj('c', 'box', floor(3, 2))], []);
    const { command, newIds } = cmdDuplicate(before, ['c', 'a', 'ghost', 'a'], testRoom);
    expect(newIds).toHaveLength(2);
    const after = applyReversible(before, command);
    // newIds — в порядке запроса: сначала копия 'c', затем копия 'a'.
    expect(after.objects.map((o) => o.id)).toEqual(['a', newIds[1], 'b', 'c', newIds[0]]);
    expect(get(after, newIds[0]).mount).toEqual(floor(3.3, 2));
    expect(get(after, newIds[1]).mount).toEqual(floor(1.3, 1));
  });

  it('неизвестные id → пустой batch и пустой список', () => {
    expect(cmdDuplicate(layoutOf(), ['ghost'], testRoom)).toEqual({ command: EMPTY, newIds: [] });
    expect(cmdDuplicate(layoutOf(), [], testRoom)).toEqual({ command: EMPTY, newIds: [] });
  });
});

// ---------- cmdSetMount ----------

describe('cmdSetMount', () => {
  const setMount = (layout: Layout, id: string, to: MountKind) => cmdSetMount(layout, id, to, testRoom, catalog);

  it('floor ⇄ ceiling: мировые X/Z и угол сохраняются; drop — defaultDrop записи', () => {
    const before = layoutOf([
      obj('lamp', 'lamp', floor(1, 2), { rotationY: 0.7 }),
      obj('box', 'box', floor(-3, -2), { rotationY: 0.2 }),
    ]);
    let after = applyReversible(before, setMount(before, 'lamp', 'ceiling'));
    expect(get(after, 'lamp').mount).toEqual(ceiling(1, 2, 0.4));
    expect(get(after, 'lamp').rotationY).toBe(0.7);
    after = applyReversible(after, setMount(after, 'box', 'ceiling'));
    expect(get(after, 'box').mount).toEqual(ceiling(-3, -2, 0));
    expectInvariants(after);

    const back = applyReversible(after, setMount(after, 'lamp', 'floor'));
    expect(get(back, 'lamp').mount).toEqual(floor(1, 2));
    expect(get(back, 'lamp').rotationY).toBe(0.7);
    expectInvariants(back);
  });

  it('floor → wall: ближайшая поверхность, угол 0; bottom — defaultBottom записи либо текущая высота основания', () => {
    const before = layoutOf([
      obj('pic', 'poster', floor(4.5, 0), { rotationY: 1 }),
      obj('box', 'box', floor(-4.8, -2), { rotationY: 1 }),
    ]);
    let after = applyReversible(before, setMount(before, 'pic', 'wall'));
    expect(get(after, 'pic').mount).toEqual(wall('right', 3, 1.6));
    expect(get(after, 'pic').rotationY).toBe(0);
    // У ящика defaultBottom нет: основание остаётся на высоте подиума, на котором он стоял.
    after = applyReversible(after, setMount(after, 'box', 'wall'));
    const m = mountAs(get(after, 'box'), 'wall');
    expect(m.surfaceId).toBe('left');
    expect(m.along).toBeCloseTo(5, 9);
    expect(m.bottom).toBeCloseTo(PODIUM, 9);
    expectInvariants(after);
  });

  it('wall → floor / ceiling: X/Z — из позы у стены, угол — угол стены', () => {
    const before = layoutOf([obj('pic', 'poster', wall('right', 2, 1))]);
    const world = poseOf(before, 'pic');
    expectVec(world.position, [5 - 0.03 - 0.01, 1, -1]);
    expect(world.rotationY).toBeCloseTo(-Math.PI / 2, 9);

    const down = applyReversible(before, setMount(before, 'pic', 'floor'));
    const m = mountAs(get(down, 'pic'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(m.lift).toBe(0);
    expect(get(down, 'pic').rotationY).toBeCloseTo(world.rotationY, 9);
    expectInvariants(down);

    const up = applyReversible(before, setMount(before, 'pic', 'ceiling'));
    const c = mountAs(get(up, 'pic'), 'ceiling');
    expect(c.x).toBeCloseTo(world.position[0], 9);
    expect(c.z).toBeCloseTo(world.position[2], 9);
    expect(c.drop).toBe(0);
    expect(get(up, 'pic').rotationY).toBeCloseTo(world.rotationY, 9);
    expectInvariants(up);
  });

  it('→ surface: опора, чья столешница содержит X/Z объекта; мировой угол сохраняется', () => {
    const before = layoutOf([
      obj('a', 'lantern', floor(-2.2, 1.1), { rotationY: 0.3 }),
      obj('b', 'lantern', floor(-2.1, -1.9), { rotationY: 0.3 }),
    ]);
    let after = applyReversible(before, setMount(before, 'a', 'surface'));
    const a = mountAs(get(after, 'a'), 'surface');
    expect(a.hostId).toBe('venue-table');
    expect(a.u).toBeCloseTo(-0.2, 9);
    expect(a.v).toBeCloseTo(0.1, 9);
    expect(poseOf(after, 'a').rotationY).toBeCloseTo(0.3, 9);
    expectVec(poseOf(after, 'a').position, [-2.2, 0.75, 1.1]);

    // Стол на подиуме повёрнут на π/2: (u, v) — в его локальных координатах, угол — относительно него.
    after = applyReversible(after, setMount(after, 'b', 'surface'));
    const b = mountAs(get(after, 'b'), 'surface');
    expect(b.hostId).toBe('venue-table2');
    expect(b.u).toBeCloseTo(-0.1, 9);
    expect(b.v).toBeCloseTo(-0.1, 9);
    expect(get(after, 'b').rotationY).toBeCloseTo(0.3 - Math.PI / 2, 9);
    expect(poseOf(after, 'b').rotationY).toBeCloseTo(0.3, 9);
    expectVec(poseOf(after, 'b').position, [-2.1, PODIUM + 0.75, -1.9]);
    expectInvariants(after);
  });

  it('→ surface: над столешницами никого — ближайшая по центру опора; сам объект, скрытые и не-опоры не годятся', () => {
    const before = layoutOf([obj('box', 'box', floor(3, 2))]);
    const after = applyReversible(before, setMount(before, 'box', 'surface'));
    // Ближайший по центру — 'venue-table' в (−2, 1); (u, v) зажаты в его столешницу.
    expect(get(after, 'box').mount).toEqual(onTop('venue-table', 0.55, 0.35));
    expectInvariants(after);

    // Ближайшая опора скрыта → следующая.
    const hidden = applyCommand(before, patch(before, 'venue-table', { visible: false }));
    const next = applyReversible(hidden, setMount(hidden, 'box', 'surface'));
    expect(mountAs(get(next, 'box'), 'surface').hostId).toBe('venue-table2');
    expectInvariants(next);

    // Опор нет вовсе (сам ящик — опора, но на себя встать нельзя) → пустой batch.
    const alone = layoutOf([obj('box', 'box', floor(3, 2)), obj('sofa', 'sofaU', floor(0, 0))], []);
    expect(setMount(alone, 'box', 'surface')).toEqual(EMPTY);
  });

  it('surface → floor / ceiling / wall: мировые X/Z и угол сохраняются', () => {
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table2', 0.2, 0.1), { rotationY: 0.3 })]);
    const world = poseOf(before, 'lantern');

    const down = applyReversible(before, setMount(before, 'lantern', 'floor'));
    const f = mountAs(get(down, 'lantern'), 'floor');
    expect(f.x).toBeCloseTo(world.position[0], 9);
    expect(f.z).toBeCloseTo(world.position[2], 9);
    expect(f.lift).toBe(0);
    expect(get(down, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    expectInvariants(down);

    const up = applyReversible(before, setMount(before, 'lantern', 'ceiling'));
    const c = mountAs(get(up, 'lantern'), 'ceiling');
    expect(c.x).toBeCloseTo(world.position[0], 9);
    expect(c.z).toBeCloseTo(world.position[2], 9);
    expect(get(up, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    expectInvariants(up);

    const side = applyReversible(before, setMount(before, 'lantern', 'wall'));
    const w = mountAs(get(side, 'lantern'), 'wall');
    expect(w.surfaceId).toBe('far');
    expect(w.along).toBeCloseTo(world.position[0] + 5, 9);
    expect(w.bottom).toBeCloseTo(world.position[1], 9);
    expect(get(side, 'lantern').rotationY).toBe(0);
    expectInvariants(side);
  });

  it('с детьми: перед уходом хозяина с пола дети опускаются на пол (I2)', () => {
    const before = layoutOf([obj('box', 'box', floor(1, 1)), obj('lantern', 'lantern', onTop('box', 0.1, -0.1), { rotationY: 0.2 })]);
    for (const to of ['ceiling', 'wall', 'surface'] as const) {
      const cmd = setMount(before, 'box', to);
      if (cmd.type !== 'batch') throw new Error(`${to}: ожидался batch[patch детей, patch хозяина]`);
      expect(touchedIds(cmd.commands[0]), to).toEqual(['lantern']);
      const after = applyReversible(before, cmd);
      expect(get(after, 'box').mount.kind, to).toBe(to);
      expect(get(after, 'lantern').mount, to).toEqual(floor(1.1, 0.9));
      expect(get(after, 'lantern').rotationY, to).toBeCloseTo(0.2, 9);
      expectInvariants(after, to);
    }
  });

  it('то же крепление, неизвестный id, заблокированный объект → пустой batch', () => {
    const before = layoutOf([obj('box', 'box', floor(1, 1)), obj('locked', 'box', floor(2, 2), { locked: true })]);
    expect(setMount(before, 'box', 'floor')).toEqual(EMPTY);
    expect(setMount(before, 'ghost', 'ceiling')).toEqual(EMPTY);
    expect(setMount(before, 'locked', 'ceiling')).toEqual(EMPTY);
  });
});

// ---------- cmdResetVenue / venueDirty ----------

describe('cmdResetVenue', () => {
  const fixture = (id: string) => testRoom.fixtures.find((f) => f.id === id)!;

  /** Сдвинутый и повёрнутый стол с фонарём, скрытый и заблокированный стол, нет дивана, устаревший стол с фонарём, декор. */
  function messy(): Layout {
    const fixtures = structuredClone(testRoom.fixtures).filter((f) => f.id !== 'venue-sofa');
    const table = fixtures.find((f) => f.id === 'venue-table')!;
    table.mount = floor(1, 2);
    table.rotationY = Math.PI / 2;
    table.color = '#123456';
    const table2 = fixtures.find((f) => f.id === 'venue-table2')!;
    table2.visible = false;
    table2.locked = true;
    return layoutOf(
      [
        obj('on-table', 'lantern', onTop('venue-table', 0.2, 0.1), { rotationY: 0.3 }),
        obj('venue-old', 'table', floor(3, -2), { origin: 'venue', rotationY: Math.PI / 2 }),
        obj('on-old', 'lantern', onTop('venue-old', 0.1, 0.2), { rotationY: 0.1 }),
        obj('decor', 'box', floor(4, 2), { color: '#abcdef' }),
        obj('banner', 'panel', wall('near', 5, 1)),
      ],
      fixtures,
    );
  }

  it('нетронутая мебель → пустая команда, venueDirty false', () => {
    const layout = layoutOf([obj('decor', 'box', floor(4, 2)), obj('lantern', 'lantern', onTop('venue-table', 0.1, 0.1))]);
    expect(cmdResetVenue(layout, testRoom)).toEqual(EMPTY);
    expect(venueDirty(layout, testRoom)).toBe(false);
  });

  it('сдвинутая, скрытая, отсутствующая и устаревшая мебель; декор не тронут; предмет на столе остался на столе', () => {
    const before = messy();
    expectInvariants(before);
    expect(venueDirty(before, testRoom)).toBe(true);
    const oldWorld = poseOf(before, 'on-old');
    expectVec(oldWorld.position, [3.2, 0.75, -2.1]);

    const cmd = cmdResetVenue(before, testRoom);
    const after = applyReversible(before, cmd); // один обратимый шаг
    expectInvariants(after);

    // Вся мебель площадки — как в room.fixtures.
    for (const f of testRoom.fixtures) expect(get(after, f.id), f.id).toEqual(f);
    // Добавленная копия независима от описания помещения.
    expect(get(after, 'venue-sofa')).not.toBe(fixture('venue-sofa'));
    expect(get(after, 'venue-sofa').size).not.toBe(fixture('venue-sofa').size);
    // Устаревшая мебель удалена, её ребёнок — на полу в своих мировых X/Z.
    expect(after.objects.map((o) => o.id)).not.toContain('venue-old');
    const dropped = mountAs(get(after, 'on-old'), 'floor');
    expect(dropped.x).toBeCloseTo(oldWorld.position[0], 9);
    expect(dropped.z).toBeCloseTo(oldWorld.position[2], 9);
    expect(get(after, 'on-old').rotationY).toBeCloseTo(oldWorld.rotationY, 9);
    // Пользовательский декор не тронут.
    expect(get(after, 'decor')).toBe(get(before, 'decor'));
    expect(get(after, 'banner')).toBe(get(before, 'banner'));
    // Предмет на столе остался на столе и уехал вместе с ним.
    expect(get(after, 'on-table')).toBe(get(before, 'on-table'));
    expectVec(poseOf(after, 'on-table').position, [-1.8, 0.75, 1.1]);

    expect(venueDirty(after, testRoom)).toBe(false);
    expect(cmdResetVenue(after, testRoom)).toEqual(EMPTY);
  });

  it('venueDirty: любое отличие мебели от исходной, но не пользовательский декор', () => {
    const clean = layoutOf([obj('decor', 'box', floor(4, 2))]);
    expect(venueDirty(clean, testRoom)).toBe(false);
    expect(venueDirty(applyCommand(clean, patch(clean, 'decor', { color: '#111111', mount: floor(0, 0) })), testRoom)).toBe(false);
    for (const set of [{ color: '#111111' }, { visible: false }, { locked: true }, { mount: floor(0, 0) }, { name: 'x' }, { size: [1, 1, 1] }] as ObjectPatch[]) {
      const changed = applyCommand(clean, patch(clean, 'venue-table', set));
      expect(venueDirty(changed, testRoom), JSON.stringify(set)).toBe(true);
      const reset = applyReversible(changed, cmdResetVenue(changed, testRoom));
      expect(reset, JSON.stringify(set)).toEqual(clean);
    }
    expect(venueDirty(layoutOf([], testRoom.fixtures.slice(1)), testRoom)).toBe(true);
    expect(venueDirty(layoutOf([obj('venue-old', 'table', floor(3, -2), { origin: 'venue' })]), testRoom)).toBe(true);
  });

  it('стол после сброса меньше — предмет остаётся на нём, но в пределах столешницы', () => {
    const base = layoutOf();
    const grown = applyCommand(base, patch(base, 'venue-table', { size: [3, 0.75, 2] }));
    const before = applyCommand(grown, { type: 'add', items: [{ object: obj('lantern', 'lantern', onTop('venue-table', 1.4, -0.9)) }] });
    expectInvariants(before);
    const after = applyReversible(before, cmdResetVenue(before, testRoom));
    expect(get(after, 'lantern').mount).toEqual(onTop('venue-table', 0.55, -0.35));
    expectInvariants(after);
  });

  it('мебель, стоявшая на устаревшем столе площадки, полностью возвращается за ОДИН сброс (угол тоже)', () => {
    // «Дети на пол» записывает столу мировой угол (π/2 + 0.5), хотя до сброса его угол совпадал с исходным.
    const fixtures = structuredClone(testRoom.fixtures);
    fixtures.find((f) => f.id === 'venue-table2')!.mount = onTop('venue-old', 0, 0);
    const before = layoutOf([obj('venue-old', 'table', floor(3, 2), { origin: 'venue', rotationY: 0.5 })], fixtures);
    expect(sanitizeLayout(before, testRoom)).toBe(before);
    expect(get(before, 'venue-table2').rotationY).toBe(fixture('venue-table2').rotationY);

    const after = applyReversible(before, cmdResetVenue(before, testRoom));
    for (const f of testRoom.fixtures) expect(get(after, f.id), f.id).toEqual(f);
    expect(after.objects.map((o) => o.id)).not.toContain('venue-old');
    expect(venueDirty(after, testRoom)).toBe(false);
    expect(cmdResetVenue(after, testRoom)).toEqual(EMPTY);
    expectInvariants(after);
  });

  it('мебель, стоящая на мебели, чьё исходное крепление — не пол, полностью возвращается за ОДИН сброс', () => {
    // Исходно лампа висит на потолке; в макете она стоит на полу, а на ней — стол площадки с фонарём.
    const lamp = obj('venue-lamp', 'lamp', ceiling(3, 2, 0.4), { origin: 'venue' });
    const room: RoomDef = { ...testRoom, fixtures: [...testRoom.fixtures, lamp] };
    const fixtures = structuredClone(room.fixtures);
    const movedLamp = fixtures.find((f) => f.id === 'venue-lamp')!;
    movedLamp.mount = floor(3, 2);
    movedLamp.rotationY = 0.5;
    fixtures.find((f) => f.id === 'venue-table2')!.mount = onTop('venue-lamp', 0, 0);
    const before = layoutOf([obj('lantern', 'lantern', onTop('venue-table', 0.1, 0.1))], fixtures);
    expect(sanitizeLayout(before, room)).toBe(before);

    const cmd = cmdResetVenue(before, room);
    const after = applyCommand(before, cmd);
    expect(applyCommand(after, invertCommand(before, cmd))).toEqual(before);
    for (const f of room.fixtures) expect(get(after, f.id), f.id).toEqual(f);
    expect(get(after, 'lantern')).toBe(get(before, 'lantern'));
    expect(venueDirty(after, room)).toBe(false);
    expectInvariants(after, 'после сброса', room);
  });

  it('мебель, которую унесли с пола, возвращается на пол', () => {
    const base = layoutOf([obj('box', 'box', floor(3, 2))]);
    const before = applyCommand(base, cmdSetMount(base, 'venue-table2', 'surface', testRoom, catalog));
    expect(get(before, 'venue-table2').mount.kind).toBe('surface');
    const after = applyReversible(before, cmdResetVenue(before, testRoom));
    expect(after).toEqual(base);
    expectInvariants(after);
  });
});

// ---------- reconcileVenue ----------

describe('reconcileVenue', () => {
  it('макет с актуальной мебелью возвращается тем же объектом', () => {
    const layout = layoutOf([obj('decor', 'box', floor(4, 2))]);
    expect(reconcileVenue(layout, testRoom)).toBe(layout);
  });

  it('добавляет недостающие fixtures и не трогает изменённые пользователем', () => {
    const fixtures = structuredClone(testRoom.fixtures).filter((f) => f.id !== 'venue-sofa');
    fixtures[0].visible = false;
    fixtures[0].color = '#123456';
    const before = layoutOf([obj('decor', 'box', floor(4, 2))], fixtures);
    const after = reconcileVenue(before, testRoom);
    expect(get(after, 'venue-sofa')).toEqual(testRoom.fixtures.find((f) => f.id === 'venue-sofa'));
    expect(get(after, 'venue-sofa')).not.toBe(testRoom.fixtures.find((f) => f.id === 'venue-sofa'));
    expect(get(after, fixtures[0].id)).toBe(get(before, fixtures[0].id));
    expect(get(after, 'decor')).toBe(get(before, 'decor'));
    expect(after.objects).toHaveLength(before.objects.length + 1);
    expectInvariants(after);
    expect(reconcileVenue(after, testRoom)).toBe(after);
  });

  it('предмет на устаревшем столе площадки оказывается на полу в своих мировых X/Z, а не в (0, 0)', () => {
    const before = layoutOf([
      obj('venue-old', 'table', floor(3, -2), { origin: 'venue', rotationY: Math.PI / 2 }),
      obj('lantern', 'lantern', onTop('venue-old', 0.1, 0.2), { rotationY: 0.1 }),
      obj('venue-old-child', 'box', onTop('venue-old', -0.2, 0), { origin: 'venue' }),
    ]);
    const frozen = structuredClone(before);
    const world = poseOf(before, 'lantern');
    expectVec(world.position, [3.2, 0.75, -2.1]);

    const after = reconcileVenue(before, testRoom);
    expect(before).toEqual(frozen);
    const ids = after.objects.map((o) => o.id);
    expect(ids).not.toContain('venue-old');
    // Устаревший ребёнок устаревшего стола удаляется вместе с ним.
    expect(ids).not.toContain('venue-old-child');
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(Math.hypot(m.x, m.z)).toBeGreaterThan(1);
    expect(m.lift).toBe(0);
    expect(get(after, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    expectInvariants(after);
    // Без «детей на пол» sanitizeLayout смог бы поставить осиротевший фонарь только в (0, 0).
    const naive = sanitizeLayout({ ...before, objects: before.objects.filter((o) => !o.id.startsWith('venue-old')) }, testRoom);
    expect(get(naive, 'lantern').mount).toEqual(floor(0, 0));
  });
});

// ---------- sanitizeLayout ----------

describe('sanitizeLayout', () => {
  function messy(): Layout {
    return layoutOf([
      obj('dup', 'box', floor(1, 1)),
      obj('dup', 'box', floor(2, 2), { color: '#ff0000' }),
      obj('huge', 'box', floor(0, 0), { size: [1000, 0, NaN] }),
      obj('out', 'box', floor(100, -100, 50)),
      obj('deep', 'box', ceiling(0, 0, 50)),
      obj('badwall', 'poster', wall('nope', 1, 1), { rotationY: 0.4 }),
      obj('wide', 'panel', wall('col:s', 5, 10)),
      obj('orphan', 'lantern', onTop('ghost', 0.1, 0.1)),
      obj('self', 'lantern', onTop('self', 0.1, 0.1)),
      obj('hidden-host', 'table', floor(3, 2), { visible: false, rotationY: 0.5 }),
      obj('on-hidden', 'lantern', onTop('hidden-host', 0.2, 0.1), { rotationY: 0.1 }),
      obj('ceil-host', 'box', ceiling(1, -1, 0.2), { rotationY: Math.PI / 2 }),
      obj('on-ceil', 'lantern', onTop('ceil-host', 0.1, 0)),
      obj('stack-1', 'box', onTop('venue-table', 0, 0)),
      obj('stack-2', 'lantern', onTop('stack-1', 0.1, 0.1)),
      obj('nan-rot', 'box', floor(0, 1), { rotationY: NaN }),
      obj('far-u', 'lantern', onTop('venue-table', 5, -5)),
      obj('nan-mount', 'box', floor(NaN, Infinity, NaN)),
      obj('fine', 'box', floor(4, 2)),
    ]);
  }

  it('чистый макет возвращается тем же объектом', () => {
    const layout = layoutOf([obj('box', 'box', floor(1, 1)), obj('lantern', 'lantern', onTop('venue-table', 0.1, 0.1))]);
    expect(sanitizeLayout(layout, testRoom)).toBe(layout);
  });

  it('восстанавливает I1–I5', () => {
    const before = messy();
    const frozen = structuredClone(before);
    const after = sanitizeLayout(before, testRoom);
    expect(before).toEqual(frozen); // вход не мутируется

    // I1: из дубликатов остаётся первый.
    expect(after.objects.filter((o) => o.id === 'dup')).toHaveLength(1);
    expect(get(after, 'dup').color).toBe(get(before, 'dup').color);
    // I4: размеры и числа.
    expect(get(after, 'huge').size).toEqual([MAX_SIZE, MIN_SIZE, 0.5]);
    expect(get(after, 'out').mount).toEqual(floor(5, -3, H - 0.5));
    expect(get(after, 'deep').mount).toEqual(ceiling(0, 0, H - 0.5));
    expect(get(after, 'nan-rot').rotationY).toBe(0);
    expect(get(after, 'nan-mount').mount).toEqual(floor(0, 0, 0));
    expectMount(get(after, 'wide').mount, wall('col:s', 0.4, H - 1));
    // Битые ссылки → пол в (0, 0).
    expect(get(after, 'badwall').mount).toEqual(floor(0, 0));
    expect(get(after, 'orphan').mount).toEqual(floor(0, 0));
    expect(get(after, 'self').mount).toEqual(floor(0, 0));
    // Хозяин есть, но скрыт или не на полу → пол под той же точкой.
    const hiddenHost = poseOf(before, 'hidden-host');
    const under = toWorld(hiddenHost, [0.2, 0, 0.1]);
    const onHidden = mountAs(get(after, 'on-hidden'), 'floor');
    expect(onHidden.x).toBeCloseTo(under[0], 9);
    expect(onHidden.z).toBeCloseTo(under[2], 9);
    expect(onHidden.lift).toBe(0);
    expect(get(after, 'on-hidden').rotationY).toBeCloseTo(0.6, 9);
    const onCeil = mountAs(get(after, 'on-ceil'), 'floor');
    expect(onCeil.x).toBeCloseTo(1, 9);
    expect(onCeil.z).toBeCloseTo(-1.1, 9);
    // Глубина ровно 1: предмет на предмете, стоящем на столе, — на пол под собой.
    expect(get(after, 'stack-1').mount).toEqual(onTop('venue-table', 0, 0));
    const stacked = mountAs(get(after, 'stack-2'), 'floor');
    expect(stacked.x).toBeCloseTo(-1.9, 9);
    expect(stacked.z).toBeCloseTo(1.1, 9);
    // Каждое крепление проходит clampMount.
    expect(get(after, 'far-u').mount).toEqual(onTop('venue-table', 0.55, -0.35));
    // Нетронутые объекты сохраняют ссылку.
    expect(get(after, 'fine')).toBe(get(before, 'fine'));
    expect(get(after, 'venue-table')).toBe(get(before, 'venue-table'));
    // I3: неизменяемые поля не меняются.
    for (const o of after.objects) {
      const source = get(before, o.id);
      expect([o.id, o.kind, o.type, o.origin], o.id).toEqual([source.id, source.kind, source.type, source.origin]);
    }
    expectInvariants(after);
  });

  it('идемпотентна', () => {
    const once = sanitizeLayout(messy(), testRoom);
    expect(sanitizeLayout(once, testRoom)).toBe(once);
    expect(sanitizeLayout(sanitizeLayout(once, testRoom), testRoom)).toBe(once);
  });

  it('ребёнка скрытого хозяина ставит на пол под ним (в том числе на подиум)', () => {
    const base = layoutOf([obj('lantern', 'lantern', onTop('venue-table2', 0.2, 0.1), { rotationY: 0.3 })]);
    const world = poseOf(base, 'lantern');
    // Сырой patch мимо построителей: стол скрыт, фонарь остался «висеть» на нём.
    const broken = applyCommand(base, { type: 'patch', patches: [{ id: 'venue-table2', set: { visible: false } }] });
    const after = sanitizeLayout(broken, testRoom);
    const m = mountAs(get(after, 'lantern'), 'floor');
    expect(m.x).toBeCloseTo(world.position[0], 9);
    expect(m.z).toBeCloseTo(world.position[2], 9);
    expect(m.lift).toBe(0);
    expectVec(poseOf(after, 'lantern').position, [world.position[0], PODIUM, world.position[2]]);
    expect(poseOf(after, 'lantern').rotationY).toBeCloseTo(world.rotationY, 9);
    expect(get(after, 'venue-table2').visible).toBe(false);
    expectInvariants(after);
    // Тот же результат, что у построителя.
    expect(after).toEqual(applyCommand(base, patch(base, 'venue-table2', { visible: false })));
  });

  it('свойство: на любом мусоре идемпотентна, не мутирует вход и оставляет макет, переживающий сохранение', () => {
    const SURFACES = ['far', 'right', 'near', 'left', 'col:n', 'col:e', 'col:s', 'col:w', 'nope'];
    const bare: RoomDef = { ...testRoom, walls: [], columns: [], platforms: [] };
    const closet: RoomDef = { ...testRoom, size: { length: 0.5, width: 0.5, height: 0.2 }, fixtures: [] };
    for (let seed = 0; seed < 300; seed++) {
      const rng = createRng(seed);
      const num = (lo: number, hi: number) => {
        const roll = rng.next();
        if (roll < 0.04) return NaN;
        if (roll < 0.07) return Infinity;
        if (roll < 0.1) return -Infinity;
        if (roll < 0.13) return 1e12;
        return rng.range(lo, hi);
      };
      const count = rng.int(0, 14);
      // Иногда id повторяются.
      const ids = Array.from({ length: count }, (_, i) => (rng.next() < 0.15 ? `o${rng.int(0, count)}` : `o${i}`));
      const anyId = () => (rng.next() < 0.1 || ids.length === 0 ? 'ghost' : rng.pick(ids));
      const mount = (): Mount => {
        switch (rng.int(0, 3)) {
          case 0:
            return floor(num(-8, 8), num(-5, 5), num(-1, 4));
          case 1:
            return ceiling(num(-8, 8), num(-5, 5), num(-1, 4));
          case 2:
            return wall(rng.pick(SURFACES), num(-2, 12), num(-1, 4));
          default:
            return onTop(anyId(), num(-2, 2), num(-2, 2));
        }
      };
      const objects = ids.map((id) =>
        obj(id, rng.pick(['table', 'box', 'lantern', 'poster']), mount(), {
          origin: rng.next() < 0.3 ? 'venue' : 'user',
          rotationY: rng.next() < 0.1 ? num(-7, 7) : rng.range(-400, 400),
          size: [num(-1, 30), num(-1, 30), num(0.001, 3)],
          locked: rng.next() < 0.2,
          visible: rng.next() < 0.8,
        }),
      );
      for (const room of [testRoom, bare, closet]) {
        const note = `seed ${seed}, помещение ${room.size.length} × ${room.size.width}`;
        const layout = layoutOf(objects, rng.next() < 0.5 ? room.fixtures : []);
        const frozen = structuredClone(layout);
        const once = sanitizeLayout(layout, room);
        expect(layout, note).toEqual(frozen);
        expectInvariants(once, note, room);
        for (const o of once.objects) {
          for (const value of Object.values(o.mount)) {
            if (typeof value === 'number') expect(Number.isFinite(value), `${note}: ${JSON.stringify(o.mount)}`).toBe(true);
          }
        }
        // Загрузка: недостающая мебель добавляется, устаревшая удаляется — макет остаётся чистым; сброс обратим.
        const reconciled = reconcileVenue(once, room);
        expectInvariants(reconciled, `${note}: reconcileVenue`, room);
        expect(reconcileVenue(reconciled, room), note).toBe(reconciled);
        const reset = cmdResetVenue(reconciled, room);
        const after = applyReversible(reconciled, reset);
        expectInvariants(after, `${note}: cmdResetVenue`, room);
        expect(venueDirty(after, room), note).toBe(false);
      }
    }
  });

  it('помещение другого размера: крепления зажимаются в него', () => {
    const small: RoomDef = { ...testRoom, size: { length: 4, width: 4, height: 2 }, columns: [], platforms: [] };
    const layout = layoutOf([obj('box', 'box', floor(4, 2)), obj('hang', 'box', ceiling(-4, -2, 1.9))], []);
    const after = sanitizeLayout(layout, small);
    expect(get(after, 'box').mount).toEqual(floor(2, 2));
    expect(get(after, 'hang').mount).toEqual(ceiling(-2, -2, 1.5));
    expectInvariants(after, 'small', small);
  });
});

// ---------- свойство: построители сохраняют инварианты ----------

describe('свойство: любые построители оставляют макет, который sanitizeLayout не меняет, и обратимы', () => {
  const SURFACES = ['far', 'right', 'near', 'left', 'col:n', 'col:e', 'col:s', 'col:w', 'nope'];
  const TYPES = Object.keys(ITEMS);

  function randomNumber(rng: Rng, lo: number, hi: number): number {
    const roll = rng.next();
    if (roll < 0.03) return NaN;
    if (roll < 0.05) return Infinity;
    if (roll < 0.07) return -1e9;
    return rng.range(lo, hi);
  }

  function randomMount(rng: Rng, anyId: () => string): Mount {
    switch (rng.int(0, 3)) {
      case 0:
        return floor(randomNumber(rng, -8, 8), randomNumber(rng, -5, 5), rng.next() < 0.7 ? 0 : randomNumber(rng, -1, 4));
      case 1:
        return ceiling(randomNumber(rng, -8, 8), randomNumber(rng, -5, 5), rng.next() < 0.5 ? 0 : randomNumber(rng, -1, 4));
      case 2:
        return wall(rng.pick(SURFACES), randomNumber(rng, -2, 12), randomNumber(rng, -1, 4));
      default:
        return onTop(anyId(), randomNumber(rng, -2, 2), randomNumber(rng, -2, 2));
    }
  }

  function randomSize(rng: Rng): Vec3 {
    const side = () => (rng.next() < 0.15 ? rng.pick([0, -1, NaN, Infinity, 1000, 1e-6]) : rng.range(0.05, 3));
    return [side(), side(), side()];
  }

  function randomPatch(rng: Rng, anyId: () => string): ObjectPatch {
    const set: ObjectPatch = {};
    if (rng.next() < 0.6) set.mount = randomMount(rng, anyId);
    if (rng.next() < 0.3) set.size = randomSize(rng);
    if (rng.next() < 0.3) set.rotationY = randomNumber(rng, -7, 7);
    if (rng.next() < 0.25) set.visible = rng.next() < 0.5;
    if (rng.next() < 0.1) set.locked = rng.next() < 0.5;
    if (rng.next() < 0.1) set.name = `имя ${rng.int(0, 9)}`;
    if (rng.next() < 0.1) set.color = rng.pick(['#111111', '#abcdef']);
    return set;
  }

  it('случайные последовательности команд', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rng = createRng(seed);
      let layout = layoutOf([
        obj('box-1', 'box', floor(1, 1)),
        obj('box-2', 'box', floor(3, -2)),
        obj('desk', 'table', floor(3, 2), { rotationY: 0.5 }),
        obj('lantern-1', 'lantern', onTop('venue-table', 0.1, 0.1)),
        obj('lantern-2', 'lantern', onTop('desk', -0.2, 0.1)),
        obj('lantern-3', 'lantern', onTop('box-1', 0, 0)),
        obj('pic', 'poster', wall('far', 3, 1)),
        obj('cloud', 'cloud', ceiling(0, 0, 0)),
        obj('venue-old', 'table', floor(-4, 2), { origin: 'venue' }),
        obj('lantern-4', 'lantern', onTop('venue-old', 0.1, 0)),
      ]);
      expectInvariants(layout, `seed ${seed}, начало`);

      for (let step = 0; step < 150; step++) {
        const ids = layout.objects.map((o) => o.id);
        const anyId = () => (rng.next() < 0.05 ? 'ghost' : rng.pick(ids));
        let cmd: Command;
        switch (rng.int(0, 9)) {
          case 0:
            cmd = cmdRemove(layout, [anyId(), anyId()], testRoom);
            break;
          case 1:
            cmd = layout.objects.length < 40 ? cmdDuplicate(layout, [anyId()], testRoom).command : EMPTY;
            break;
          case 2:
            cmd = cmdSetMount(layout, anyId(), rng.pick(ALL), testRoom, catalog);
            break;
          case 3:
            cmd = rng.next() < 0.3 ? cmdResetVenue(layout, testRoom) : EMPTY;
            break;
          case 4:
            cmd =
              layout.objects.length < 40
                ? { type: 'add', items: [{ object: createObject(catalog.getItem(rng.pick(TYPES)), floor(rng.range(-4, 4), rng.range(-2, 2))) }] }
                : EMPTY;
            break;
          default:
            cmd = patch(layout, anyId(), randomPatch(rng, anyId));
        }
        const note = `seed ${seed}, шаг ${step}, ${JSON.stringify(cmd)}`;
        const after = applyCommand(layout, cmd);
        expectInvariants(after, note);
        expect(applyCommand(after, invertCommand(layout, cmd)), note).toEqual(layout);
        // I3: неизменяемые поля существующих объектов не меняются.
        for (const o of after.objects) {
          const source = layout.objects.find((x) => x.id === o.id);
          if (source) expect([o.kind, o.type, o.origin], note).toEqual([source.kind, source.type, source.origin]);
        }
        layout = after;
      }
    }
  });
});
