import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { placeNew } from './place';
import { GRID_STEP, makeContext } from './pose';
import { testRoom } from './testRoom';
import type { Mount, MountKind, Ray, RoomDef, SceneObject, Vec3 } from './types';

function item(id: string, mounts: MountKind[], size: Vec3, over: Partial<CatalogItem> = {}): CatalogItem {
  return { id, kind: 'primitive', title: id, category: 'Тест', size, resize: 'free', color: '#808080', mounts, params: [], ...over };
}

function ray(origin: Vec3, toward: Vec3): Ray {
  const d: Vec3 = [toward[0] - origin[0], toward[1] - origin[1], toward[2] - origin[2]];
  const len = Math.hypot(...d);
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

function placed(of: CatalogItem, mount: Mount, id = 'existing'): SceneObject {
  return {
    id,
    kind: of.kind,
    type: of.id,
    origin: 'user',
    name: id,
    mount,
    rotationY: 0,
    size: of.size,
    color: of.color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
  };
}

const isSupport = (o: SceneObject) => o.type === 'table' && o.visible && o.mount.kind === 'floor';
const ctxOf = (extra: SceneObject[] = [], room: RoomDef = testRoom) => makeContext(room, [...room.fixtures, ...extra]);

const box = item('box', ['floor', 'surface', 'ceiling'], [0.5, 0.5, 0.5]);
const cloud = item('cloud', ['ceiling'], [2, 1, 2]);
const lamp = item('lamp', ['ceiling', 'floor'], [0.15, 0.15, 0.15], { defaultDrop: 0.4 });
const lantern = item('lantern', ['surface', 'floor'], [0.36, 0.35, 0.36]);
const coaster = item('coaster', ['surface'], [0.1, 0.01, 0.1]);
const banner = item('banner', ['wall', 'floor'], [1.5, 1, 0.03]);
const poster = item('poster', ['wall'], [0.5, 0.7, 0.02], { defaultBottom: 1.6 });

/** Камера облёта снаружи за ближней стеной, смотрит на точку пола. */
const orbitTo = (x: number, z: number): Ray => ray([x, 6, 9], [x, 0, z]);
const planAt = (x: number, z: number): Ray => ({ origin: [x, 20, z], dir: [0, -1, 0] });

describe('placeNew · пол и потолок', () => {
  it('floor: точка пола под лучом, lift 0', () => {
    expect(placeNew(box, box.size, planAt(3, 1), ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    const m = placeNew(box, box.size, orbitTo(3, 1), ctxOf(), isSupport, null);
    expect(m.kind).toBe('floor');
    if (m.kind !== 'floor') return;
    expect(m.x).toBeCloseTo(3);
    expect(m.z).toBeCloseTo(1);
    expect(m.lift).toBe(0);
  });

  it('ray = null → центр помещения', () => {
    expect(placeNew(box, box.size, null, ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 0, z: 0, lift: 0 });
    expect(placeNew(cloud, cloud.size, null, ctxOf(), isSupport, null)).toEqual({ kind: 'ceiling', x: 0, z: 0, drop: 0 });
  });

  it('луч в небо или мимо пола → центр помещения', () => {
    const up: Ray = { origin: [3, 1, 1], dir: [0, 1, 0] };
    expect(placeNew(box, box.size, up, ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 0, z: 0, lift: 0 });
  });

  it('точка за пределами помещения зажимается', () => {
    expect(placeNew(box, box.size, planAt(40, -40), ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 5, z: -3, lift: 0 });
  });

  it('ceiling: над точкой пола, drop = defaultDrop ?? 0', () => {
    expect(placeNew(cloud, cloud.size, planAt(1, -1), ctxOf(), isSupport, null)).toEqual({ kind: 'ceiling', x: 1, z: -1, drop: 0 });
    expect(placeNew(lamp, lamp.size, planAt(1, -1), ctxOf(), isSupport, null)).toEqual({ kind: 'ceiling', x: 1, z: -1, drop: 0.4 });
  });

  it('привязка к сетке: grid округляет, null — нет', () => {
    const free = placeNew(box, box.size, planAt(3.14, 1.27), ctxOf(), isSupport, null);
    expect(free).toEqual({ kind: 'floor', x: 3.14, z: 1.27, lift: 0 });
    const snapped = placeNew(box, box.size, planAt(3.14, 1.27), ctxOf(), isSupport, GRID_STEP);
    expect(snapped).toEqual({ kind: 'floor', x: 3.1, z: 1.3, lift: 0 });
  });
});

describe('placeNew · на опоре', () => {
  it('настольный предмет попадает на стол под лучом', () => {
    // 'venue-table' в (−2, 1), 1.1 × 0.75 × 0.7.
    const m = placeNew(lantern, lantern.size, planAt(-1.7, 1.2), ctxOf(), isSupport, null);
    expect(m.kind).toBe('surface');
    if (m.kind !== 'surface') return;
    expect(m.hostId).toBe('venue-table');
    expect(m.u).toBeCloseTo(0.3);
    expect(m.v).toBeCloseTo(0.2);
  });

  it('на повёрнутый стол — в его локальных координатах', () => {
    const m = placeNew(lantern, lantern.size, planAt(-1.9, -2.3), ctxOf(), isSupport, null);
    expect(m.kind).toBe('surface');
    if (m.kind !== 'surface') return;
    expect(m.hostId).toBe('venue-table2');
    expect(m.u).toBeCloseTo(0.3);
    expect(m.v).toBeCloseTo(0.1);
  });

  it('луч мимо стола: предмет, умеющий стоять на полу, встаёт на пол', () => {
    expect(placeNew(lantern, lantern.size, planAt(3, 1), ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(placeNew(lantern, lantern.size, null, ctxOf(), isSupport, null)).toEqual({ kind: 'floor', x: 0, z: 0, lift: 0 });
  });

  it('предмет только для опор — на ближайшую к точке опору по центру; опор нет → пол', () => {
    expect(placeNew(coaster, coaster.size, planAt(3, 1), ctxOf(), isSupport, null)).toEqual({
      kind: 'surface',
      hostId: 'venue-table',
      u: 0,
      v: 0,
    });
    expect(placeNew(coaster, coaster.size, planAt(-3, -2.5), ctxOf(), isSupport, null)).toEqual({
      kind: 'surface',
      hostId: 'venue-table2',
      u: 0,
      v: 0,
    });
    const empty: RoomDef = { ...testRoom, fixtures: [] };
    expect(placeNew(coaster, coaster.size, planAt(3, 1), ctxOf([], empty), isSupport, null)).toEqual({
      kind: 'floor',
      x: 3,
      z: 1,
      lift: 0,
    });
  });
});

describe('placeNew · стена', () => {
  it('луч попал в стену → эта стена, центр объекта — в точке попадания', () => {
    const m = placeNew(banner, banner.size, ray([0, 1.5, 1], [-1, 1.7, -3]), ctxOf(), isSupport, null);
    expect(m.kind).toBe('wall');
    if (m.kind !== 'wall') return;
    expect(m.surfaceId).toBe('far');
    expect(m.along).toBeCloseTo(4);
    expect(m.bottom).toBeCloseTo(1.7 - 0.5);
  });

  it('луч в узкую грань колонны: широкий предмет уходит на следующую попавшую поверхность, узкий остаётся на грани', () => {
    const through = ray([2, 1.5, 2.5], [2, 1.5, -3]); // сначала col:s, затем far
    const wide = placeNew(banner, banner.size, through, ctxOf(), isSupport, null);
    expect(wide).toMatchObject({ kind: 'wall', surfaceId: 'far' });
    const narrow = placeNew(poster, poster.size, through, ctxOf(), isSupport, null);
    expect(narrow.kind).toBe('wall');
    if (narrow.kind !== 'wall') return;
    expect(narrow.surfaceId).toBe('col:s');
    expect(narrow.along).toBeCloseTo(0.4);
    expect(narrow.bottom).toBeCloseTo(1.5 - 0.35);
  });

  it('все попавшие поверхности у́же предмета → просто ближайшая (по центру)', () => {
    // Луч упирается в грань колонны и дальше уходит в пол, не достав до стены.
    const m = placeNew(banner, banner.size, ray([2, 2.9, 1.3], [2, 1.5, 0.3]), ctxOf(), isSupport, null);
    expect(m).toMatchObject({ kind: 'wall', surfaceId: 'col:s' });
    if (m.kind !== 'wall') return;
    expect(m.along).toBeCloseTo(0.4); // шире грани → по её середине
  });

  it('луч мимо стен → ближайшая поверхность к точке пола, bottom = defaultBottom ?? 1.2', () => {
    // План: вертикальный луч у дальней стены.
    const a = placeNew(banner, banner.size, planAt(-3, -2), ctxOf(), isSupport, null);
    expect(a).toEqual({ kind: 'wall', surfaceId: 'far', along: 2, bottom: 1.2 });
    const b = placeNew(poster, poster.size, planAt(4.5, 1), ctxOf(), isSupport, null);
    expect(b).toEqual({ kind: 'wall', surfaceId: 'right', along: 4, bottom: 1.6 });
  });

  it('настенный шириной 1.5 м при луче в пол рядом с колонной встаёт на стену, а не на грань колонны 0.8 м, и не на стену, обращённую к лучу изнанкой', () => {
    // Камера облёта за ближней стеной; центр вида — пол в (2, 1): до грани col:s 0.7 м, до ближней стены 2 м, до дальней 4 м.
    const m = placeNew(banner, banner.size, orbitTo(2, 1), ctxOf(), isSupport, null);
    expect(m.kind).toBe('wall');
    if (m.kind !== 'wall') return;
    expect(m.surfaceId).not.toMatch(/^col:/);
    expect(m.surfaceId).not.toBe('near'); // ближняя стена повёрнута к камере изнанкой
    expect(m.surfaceId).toBe('far');
    expect(m.along).toBeCloseTo(7);
    expect(m.bottom).toBe(1.2);
  });

  it('предмет у́же грани при том же луче — на колонну', () => {
    const m = placeNew(poster, poster.size, orbitTo(2, 1), ctxOf(), isSupport, null);
    expect(m.kind).toBe('wall');
    if (m.kind !== 'wall') return;
    expect(m.surfaceId).toBe('col:s');
    expect(m.along).toBeCloseTo(0.4);
    expect(m.bottom).toBe(1.6);
  });

  it('на плане (|dir.y| > 0.98) изнанки нет: широкий предмет встаёт на ближайшую достаточно широкую стену', () => {
    const m = placeNew(banner, banner.size, planAt(2, 1), ctxOf(), isSupport, null);
    expect(m).toEqual({ kind: 'wall', surfaceId: 'near', along: 3, bottom: 1.2 });
  });

  it('ray = null → ближайшая к центру помещения поверхность не у́же предмета', () => {
    const wide = placeNew(banner, banner.size, null, ctxOf(), isSupport, null);
    expect(wide).toEqual({ kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    // Узкому предмету ближе грань колонны.
    const narrow = placeNew(poster, poster.size, null, ctxOf(), isSupport, null);
    expect(narrow).toMatchObject({ kind: 'wall', surfaceId: 'col:w' });
  });

  it('результат проходит clampMount: объект не свисает за край стены и не уходит под пол', () => {
    const low = placeNew(banner, banner.size, ray([-4, 1, 0], [-4.9, 0.2, -3]), ctxOf(), isSupport, null);
    expect(low.kind).toBe('wall');
    if (low.kind !== 'wall') return;
    expect(low.surfaceId).toBe('far');
    expect(low.along).toBe(0.75);
    expect(low.bottom).toBe(0);
  });
});

describe('placeNew · сдвиг одинаковых объектов', () => {
  it('второй одинаковый объект сдвигается на 0.3 м по x', () => {
    const first = placeNew(box, box.size, planAt(3, 1), ctxOf(), isSupport, null);
    const second = placeNew(box, box.size, planAt(3, 1), ctxOf([placed(box, first)]), isSupport, null);
    expect(second).toEqual({ kind: 'floor', x: 3.3, z: 1, lift: 0 });
    // Третий — ещё на 0.3.
    const third = placeNew(
      box,
      box.size,
      planAt(3, 1),
      ctxOf([placed(box, first, 'a'), placed(box, second, 'b')]),
      isSupport,
      null,
    );
    expect(third.kind === 'floor' && third.x).toBeCloseTo(3.6);
  });

  it('объект другого типа на том же месте не мешает; совпадение — в пределах 5 см', () => {
    const at: Mount = { kind: 'floor', x: 3, z: 1, lift: 0 };
    expect(placeNew(box, box.size, planAt(3, 1), ctxOf([placed(lantern, at)]), isSupport, null)).toEqual(at);
    const close: Mount = { kind: 'floor', x: 3.04, z: 0.97, lift: 0 };
    expect(placeNew(box, box.size, planAt(3, 1), ctxOf([placed(box, close)]), isSupport, null)).toEqual({
      kind: 'floor',
      x: 3.3,
      z: 1,
      lift: 0,
    });
    const apart: Mount = { kind: 'floor', x: 3.06, z: 1, lift: 0 };
    expect(placeNew(box, box.size, planAt(3, 1), ctxOf([placed(box, apart)]), isSupport, null)).toEqual(at);
  });

  it('на стене сдвиг идёт по along, на столе — по u, под потолком — по x', () => {
    const wall = placeNew(banner, banner.size, planAt(-3, -2), ctxOf(), isSupport, null);
    const wall2 = placeNew(banner, banner.size, planAt(-3, -2), ctxOf([placed(banner, wall)]), isSupport, null);
    expect(wall2).toEqual({ kind: 'wall', surfaceId: 'far', along: 2.3, bottom: 1.2 });

    const top = placeNew(lantern, lantern.size, planAt(-2, 1), ctxOf(), isSupport, null);
    const top2 = placeNew(lantern, lantern.size, planAt(-2, 1), ctxOf([placed(lantern, top)]), isSupport, null);
    expect(top2).toMatchObject({ kind: 'surface', hostId: 'venue-table' });
    expect(top2.kind === 'surface' && top2.u).toBeCloseTo(0.3);

    const hung = placeNew(cloud, cloud.size, planAt(0, 0), ctxOf(), isSupport, null);
    const hung2 = placeNew(cloud, cloud.size, planAt(0, 0), ctxOf([placed(cloud, hung)]), isSupport, null);
    expect(hung2).toEqual({ kind: 'ceiling', x: 0.3, z: 0, drop: 0 });
  });

  it('у края помещения сдвиг снова проходит clampMount и не зацикливается', () => {
    const edge: Mount = { kind: 'floor', x: 5, z: 0, lift: 0 };
    const m = placeNew(box, box.size, planAt(5, 0), ctxOf([placed(box, edge)]), isSupport, null);
    expect(m).toEqual(edge); // двигать некуда — объект остаётся в пределах помещения
  });
});
