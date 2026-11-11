import { describe, expect, it } from 'vitest';
import { getSurface, wallFrame } from './geometry';
import {
  GRID_STEP,
  WALL_GAP,
  childrenOf,
  clampMount,
  describeMount,
  isMountBroken,
  makeContext,
  rayToLocal,
  remount,
  resolvePose,
  snapMount,
  toLocal,
  toWorld,
} from './pose';
import type { Pose } from './pose';
import { testRoom } from './testRoom';
import type { Mount, RoomDef, SceneObject, Vec3 } from './types';

const H = testRoom.size.height;

function obj(id: string, mount: Mount, over: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    kind: 'primitive',
    type: 'box',
    origin: 'user',
    name: id,
    mount,
    rotationY: 0,
    size: [0.4, 0.5, 0.2],
    color: '#808080',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

const ctxOf = (objects: SceneObject[], room: RoomDef = testRoom) => makeContext(room, [...room.fixtures, ...objects]);

function expectVec(actual: Vec3, expected: Vec3) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
}

describe('makeContext', () => {
  it('находит объекты и поверхности по id', () => {
    const a = obj('a', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const ctx = ctxOf([a]);
    expect(ctx.room).toBe(testRoom);
    expect(ctx.get('a')).toBe(a);
    expect(ctx.get('venue-table')?.type).toBe('table');
    expect(ctx.get('nope')).toBeUndefined();
    expect(ctx.surface('far')?.id).toBe('far');
    expect(ctx.surface('col:s')?.id).toBe('col:s');
    expect(ctx.surface('col:x')).toBeUndefined();
  });
});

describe('resolvePose', () => {
  it('пол: [x, floorAt + lift, z]; на подиуме добавляется его высота', () => {
    const off = obj('off', { kind: 'floor', x: 3, z: 1, lift: 0 }, { rotationY: 0.7 });
    const on = obj('on', { kind: 'floor', x: -3, z: -2, lift: 0 });
    const lifted = obj('lifted', { kind: 'floor', x: -3, z: -2, lift: 0.5 });
    const ctx = ctxOf([off, on, lifted]);
    expect(resolvePose(off, ctx)).toEqual({ position: [3, 0, 1], rotationY: 0.7 });
    expectVec(resolvePose(on, ctx).position, [-3, 0.2, -2]);
    expectVec(resolvePose(lifted, ctx).position, [-3, 0.7, -2]);
  });

  it('потолок: y = H − drop − h', () => {
    const flush = obj('flush', { kind: 'ceiling', x: 1, z: -1, drop: 0 }, { rotationY: 1.1 });
    const dropped = obj('dropped', { kind: 'ceiling', x: 1, z: -1, drop: 0.4 });
    const ctx = ctxOf([flush, dropped]);
    expectVec(resolvePose(flush, ctx).position, [1, H - 0.5, -1]);
    expect(resolvePose(flush, ctx).rotationY).toBe(1.1);
    expectVec(resolvePose(dropped, ctx).position, [1, H - 0.4 - 0.5, -1]);
  });

  it('стена: спина в WALL_GAP от стены, лицо внутрь — для всех четырёх стен и грани колонны', () => {
    for (const surfaceId of ['far', 'right', 'near', 'left', 'col:n', 'col:e', 'col:s', 'col:w']) {
      const s = getSurface(testRoom, surfaceId)!;
      const f = wallFrame(s);
      const along = f.length / 2 - 0.1;
      // rotationY у настенного объекта игнорируется.
      const o = obj('poster', { kind: 'wall', surfaceId, along, bottom: 1.2 }, { rotationY: 2.2 });
      const ctx = ctxOf([o]);
      const pose = resolvePose(o, ctx);
      const d = o.size[2];

      expect(pose.position[1], surfaceId).toBe(1.2);
      expect(pose.rotationY, surfaceId).toBeCloseTo(f.rotationY);
      // Центр основания: на расстоянии along вдоль стены и WALL_GAP + d/2 от неё.
      const rel = [pose.position[0] - s.from[0], pose.position[2] - s.from[1]];
      expect(rel[0] * f.dir[0] + rel[1] * f.dir[1], surfaceId).toBeCloseTo(along);
      expect(rel[0] * f.normal[0] + rel[1] * f.normal[1], surfaceId).toBeCloseTo(WALL_GAP + d / 2);
      // Спина (локальный z = −d/2) — ровно в WALL_GAP от стены.
      const back = toWorld(pose, [0, 0, -d / 2]);
      expect((back[0] - s.from[0]) * f.normal[0] + (back[2] - s.from[1]) * f.normal[1], surfaceId).toBeCloseTo(WALL_GAP);
      // Лицо (локальный +Z) смотрит по нормали — в свободное пространство; локальный +X — от from к to.
      const face = toWorld(pose, [0, 0, 1]);
      expectVec([face[0] - pose.position[0], 0, face[2] - pose.position[2]], [f.normal[0], 0, f.normal[1]]);
      const right = toWorld(pose, [1, 0, 0]);
      expectVec([right[0] - pose.position[0], 0, right[2] - pose.position[2]], [f.dir[0], 0, f.dir[1]]);
    }
  });

  it('стена: конкретные координаты на дальней стене и на южной грани колонны', () => {
    const far = obj('far-poster', { kind: 'wall', surfaceId: 'far', along: 2, bottom: 1 });
    const col = obj('col-poster', { kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1.5 });
    const ctx = ctxOf([far, col]);
    expectVec(resolvePose(far, ctx).position, [-3, 1, -3 + WALL_GAP + 0.1]);
    expect(resolvePose(far, ctx).rotationY).toBeCloseTo(0);
    expectVec(resolvePose(col, ctx).position, [2, 1.5, 0.3 + WALL_GAP + 0.1]);
    expect(resolvePose(col, ctx).rotationY).toBeCloseTo(0);
  });

  it('surface: следует за повёрнутым хозяином, в том числе на подиуме', () => {
    // 'venue-table2' стоит на подиуме в (−2, −2), повёрнут на π/2, высота 0.75.
    const lamp = obj('lamp', { kind: 'surface', hostId: 'venue-table2', u: 0.3, v: 0.1 }, { rotationY: 0.25 });
    const ctx = ctxOf([lamp]);
    const pose = resolvePose(lamp, ctx);
    // Поворот π/2: локальный +X хозяина → мировой −Z, локальный +Z → мировой +X.
    expectVec(pose.position, [-2 + 0.1, 0.2 + 0.75, -2 - 0.3]);
    expect(pose.rotationY).toBeCloseTo(Math.PI / 2 + 0.25);

    // Хозяин переехал и повернулся — ребёнок едет вместе с ним, хотя его собственное крепление не менялось.
    const moved = ctx.objects.map((o) =>
      o.id === 'venue-table2' ? { ...o, mount: { kind: 'floor', x: 3, z: 1, lift: 0 } as Mount, rotationY: Math.PI } : o,
    );
    const pose2 = resolvePose(lamp, makeContext(testRoom, moved));
    expectVec(pose2.position, [3 - 0.3, 0.75, 1 - 0.1]);
    expect(pose2.rotationY).toBeCloseTo(Math.PI + 0.25);
  });

  it('изменение высоты помещения двигает только потолочные объекты', () => {
    const objects = [
      obj('floor', { kind: 'floor', x: 1, z: 1, lift: 0.1 }),
      obj('wall', { kind: 'wall', surfaceId: 'near', along: 3, bottom: 1.4 }),
      obj('table-top', { kind: 'surface', hostId: 'venue-table', u: 0.1, v: 0 }),
      obj('ceiling', { kind: 'ceiling', x: 1, z: 1, drop: 0.3 }),
    ];
    const taller: RoomDef = { ...testRoom, size: { ...testRoom.size, height: H + 1 } };
    const before = ctxOf(objects);
    const after = ctxOf(objects, taller);
    for (const o of objects) {
      const a = resolvePose(o, before);
      const b = resolvePose(o, after);
      if (o.mount.kind === 'ceiling') {
        expectVec(b.position, [a.position[0], a.position[1] + 1, a.position[2]]);
      } else {
        expect(b, o.id).toEqual(a);
      }
    }
  });

  it('битые ссылки не бросают: surface без хозяина → пол в (0, 0); wall без поверхности → [0, bottom, 0]', () => {
    const orphan = obj('orphan', { kind: 'surface', hostId: 'gone', u: 1, v: 1 }, { rotationY: 0.4 });
    const selfHost = obj('self', { kind: 'surface', hostId: 'self', u: 0, v: 0 });
    const ceilingHost = obj('ceil-host', { kind: 'ceiling', x: 1, z: 1, drop: 0 });
    const onCeilingHost = obj('on-ceil', { kind: 'surface', hostId: 'ceil-host', u: 0, v: 0 });
    const chained = obj('chained', { kind: 'surface', hostId: 'good', u: 0, v: 0 });
    const good = obj('good', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    const noWall = obj('no-wall', { kind: 'wall', surfaceId: 'col:x', along: 1, bottom: 1.7 }, { rotationY: 1 });
    const ctx = ctxOf([orphan, selfHost, ceilingHost, onCeilingHost, chained, good, noWall]);

    expect(resolvePose(orphan, ctx)).toEqual({ position: [0, 0, 0], rotationY: 0.4 });
    expect(resolvePose(selfHost, ctx).position).toEqual([0, 0, 0]);
    expect(resolvePose(onCeilingHost, ctx).position).toEqual([0, 0, 0]);
    expect(resolvePose(chained, ctx).position).toEqual([0, 0, 0]); // хозяин стоит не на полу
    expect(resolvePose(noWall, ctx)).toEqual({ position: [0, 1.7, 0], rotationY: 0 });

    expect(isMountBroken(orphan, ctx)).toBe(true);
    expect(isMountBroken(selfHost, ctx)).toBe(true);
    expect(isMountBroken(onCeilingHost, ctx)).toBe(true);
    expect(isMountBroken(chained, ctx)).toBe(true);
    expect(isMountBroken(noWall, ctx)).toBe(true);
    expect(isMountBroken(good, ctx)).toBe(false);
    expect(isMountBroken(ceilingHost, ctx)).toBe(false);
    expect(isMountBroken(obj('w', { kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1 }), ctx)).toBe(false);
    expect(isMountBroken(obj('f', { kind: 'floor', x: 99, z: 99, lift: 0 }), ctx)).toBe(false);
  });
});

describe('toWorld / toLocal / rayToLocal', () => {
  const pose: Pose = { position: [1.5, 0.3, -2], rotationY: 0.83 };

  it('поворот θ переводит локальный +Z в (sin θ, 0, cos θ)', () => {
    const origin = toWorld(pose, [0, 0, 0]);
    const z = toWorld(pose, [0, 0, 1]);
    expectVec(origin, pose.position);
    expectVec([z[0] - origin[0], z[1] - origin[1], z[2] - origin[2]], [Math.sin(0.83), 0, Math.cos(0.83)]);
  });

  it('toLocal(toWorld(p)) = p', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [0.4, 1.2, -0.7],
      [-3, 0, 2.5],
    ];
    for (const p of points) {
      expectVec(toLocal(pose, toWorld(pose, p)), p);
      expectVec(toWorld(pose, toLocal(pose, p)), p);
    }
  });

  it('rayToLocal переводит и начало, и направление; длина направления сохраняется', () => {
    const ray = { origin: [2, 3, 1] as Vec3, dir: [0.6, -0.8, 0] as Vec3 };
    const local = rayToLocal(pose, ray);
    expectVec(local.origin, toLocal(pose, ray.origin));
    expect(Math.hypot(...local.dir)).toBeCloseTo(1);
    // Точка на луче в локальных координатах совпадает с переведённой мировой точкой.
    const t = 2.5;
    const world: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
    expectVec(
      [local.origin[0] + local.dir[0] * t, local.origin[1] + local.dir[1] * t, local.origin[2] + local.dir[2] * t],
      toLocal(pose, world),
    );
  });
});

describe('clampMount', () => {
  const ctx = ctxOf([]);
  const size: Vec3 = [1, 0.5, 0.2];

  it('возвращает тот же объект, если ничего не изменилось', () => {
    const mounts: Mount[] = [
      { kind: 'floor', x: 1, z: 1, lift: 0 },
      { kind: 'ceiling', x: 1, z: 1, drop: 0.5 },
      { kind: 'wall', surfaceId: 'far', along: 3, bottom: 1 },
      { kind: 'surface', hostId: 'venue-table', u: 0.2, v: -0.1 },
    ];
    for (const m of mounts) expect(clampMount(m, size, ctx)).toBe(m);
  });

  it('пол: (x, z) в помещение; lift ∈ [0, H − floorAt − h]', () => {
    expect(clampMount({ kind: 'floor', x: 9, z: -9, lift: 0 }, size, ctx)).toEqual({ kind: 'floor', x: 5, z: -3, lift: 0 });
    expect(clampMount({ kind: 'floor', x: 1, z: 1, lift: -1 }, size, ctx)).toEqual({ kind: 'floor', x: 1, z: 1, lift: 0 });
    expect(clampMount({ kind: 'floor', x: 1, z: 1, lift: 9 }, size, ctx)).toEqual({ kind: 'floor', x: 1, z: 1, lift: 2.5 });
    // На подиуме запас по высоте меньше на его высоту.
    const onPodium = clampMount({ kind: 'floor', x: -3, z: -2, lift: 9 }, size, ctx);
    expect(onPodium.kind === 'floor' && onPodium.lift).toBeCloseTo(H - 0.2 - 0.5);
    // Объект выше помещения: lift = 0, а не отрицательный.
    expect(clampMount({ kind: 'floor', x: 1, z: 1, lift: 1 }, [1, 5, 1], ctx)).toEqual({ kind: 'floor', x: 1, z: 1, lift: 0 });
  });

  it('потолок: (x, z) в помещение; drop ∈ [0, H − h]', () => {
    expect(clampMount({ kind: 'ceiling', x: -9, z: 9, drop: -1 }, size, ctx)).toEqual({ kind: 'ceiling', x: -5, z: 3, drop: 0 });
    expect(clampMount({ kind: 'ceiling', x: 0, z: 0, drop: 9 }, size, ctx)).toEqual({ kind: 'ceiling', x: 0, z: 0, drop: 2.5 });
    expect(clampMount({ kind: 'ceiling', x: 0, z: 0, drop: 1 }, [1, 5, 1], ctx)).toEqual({ kind: 'ceiling', x: 0, z: 0, drop: 0 });
  });

  it('стена: along ∈ [w/2, length − w/2]; шире поверхности → length/2; bottom ∈ [0, H − h]', () => {
    expect(clampMount({ kind: 'wall', surfaceId: 'far', along: 0.1, bottom: -1 }, size, ctx)).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 0.5,
      bottom: 0,
    });
    expect(clampMount({ kind: 'wall', surfaceId: 'far', along: 99, bottom: 99 }, size, ctx)).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 9.5,
      bottom: 2.5,
    });
    // Объект шириной 1 м на грани колонны 0.8 м встаёт по её середине.
    const onColumn = clampMount({ kind: 'wall', surfaceId: 'col:s', along: 0.1, bottom: 1 }, size, ctx);
    expect(onColumn.kind === 'wall' && onColumn.along).toBeCloseTo(0.4);
    // Неизвестная поверхность — как есть (чинит sanitizeLayout).
    const broken: Mount = { kind: 'wall', surfaceId: 'gone', along: -5, bottom: 99 };
    expect(clampMount(broken, size, ctx)).toBe(broken);
  });

  it('surface: центр основания остаётся на столешнице хозяина', () => {
    // 'venue-table': 1.1 × 0.75 × 0.7.
    expect(clampMount({ kind: 'surface', hostId: 'venue-table', u: 2, v: -2 }, size, ctx)).toEqual({
      kind: 'surface',
      hostId: 'venue-table',
      u: 0.55,
      v: -0.35,
    });
    expect(clampMount({ kind: 'surface', hostId: 'venue-table', u: -2, v: 2 }, size, ctx)).toEqual({
      kind: 'surface',
      hostId: 'venue-table',
      u: -0.55,
      v: 0.35,
    });
    const orphan: Mount = { kind: 'surface', hostId: 'gone', u: 9, v: 9 };
    expect(clampMount(orphan, size, ctx)).toBe(orphan);
  });

  it('не-числа не протекают в крепление', () => {
    expect(clampMount({ kind: 'floor', x: NaN, z: Infinity, lift: NaN }, size, ctx)).toEqual({ kind: 'floor', x: 0, z: 0, lift: 0 });
    expect(clampMount({ kind: 'ceiling', x: 1, z: 1, drop: NaN }, size, ctx)).toEqual({ kind: 'ceiling', x: 1, z: 1, drop: 0 });
    expect(clampMount({ kind: 'surface', hostId: 'venue-table', u: NaN, v: 0.1 }, size, ctx)).toEqual({
      kind: 'surface',
      hostId: 'venue-table',
      u: 0,
      v: 0.1,
    });
  });
});

describe('snapMount', () => {
  it('округляет x, z | along, bottom | drop | u, v | lift к шагу', () => {
    expect(snapMount({ kind: 'floor', x: 1.234, z: -0.777, lift: 0.26 }, GRID_STEP)).toEqual({ kind: 'floor', x: 1.2, z: -0.8, lift: 0.3 });
    expect(snapMount({ kind: 'ceiling', x: 1.234, z: -0.777, drop: 0.44 }, GRID_STEP)).toEqual({ kind: 'ceiling', x: 1.2, z: -0.8, drop: 0.4 });
    expect(snapMount({ kind: 'wall', surfaceId: 'far', along: 2.96, bottom: 1.04 }, GRID_STEP)).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 3,
      bottom: 1,
    });
    expect(snapMount({ kind: 'surface', hostId: 'h', u: 0.14, v: -0.26 }, GRID_STEP)).toEqual({ kind: 'surface', hostId: 'h', u: 0.1, v: -0.3 });
  });

  it('step ≤ 0 и уже округлённое крепление возвращают тот же объект', () => {
    const raw: Mount = { kind: 'floor', x: 1.234, z: -0.777, lift: 0.26 };
    expect(snapMount(raw, 0)).toBe(raw);
    const snapped: Mount = { kind: 'floor', x: 1.2, z: -0.8, lift: 0 };
    expect(snapMount(snapped, GRID_STEP)).toBe(snapped);
  });
});

describe('remount', () => {
  it('floor ⇄ ceiling сохраняет мировые X/Z', () => {
    const o = obj('o', { kind: 'floor', x: 1.3, z: -0.4, lift: 0.2 });
    const ctx = ctxOf([o]);
    expect(remount(o, 'ceiling', ctx)).toEqual({ kind: 'ceiling', x: 1.3, z: -0.4, drop: 0 });
    expect(remount(o, 'ceiling', ctx, { drop: 0.6 })).toEqual({ kind: 'ceiling', x: 1.3, z: -0.4, drop: 0.6 });

    const hung = obj('hung', { kind: 'ceiling', x: -3.1, z: 2.2, drop: 0.5 });
    expect(remount(hung, 'floor', ctxOf([hung]))).toEqual({ kind: 'floor', x: -3.1, z: 2.2, lift: 0 });
  });

  it('→ wall: ближайшая поверхность, along — проекция, bottom — текущая высота основания', () => {
    const o = obj('o', { kind: 'floor', x: -1.5, z: -2.6, lift: 0.4 }); // на подиуме: основание на 0.6
    const ctx = ctxOf([o]);
    const m = remount(o, 'wall', ctx);
    expect(m.kind).toBe('wall');
    if (m.kind !== 'wall') return;
    expect(m.surfaceId).toBe('far');
    expect(m.along).toBeCloseTo(3.5);
    expect(m.bottom).toBeCloseTo(0.6);
    // Мировая координата вдоль стены сохранилась.
    const pose = resolvePose({ ...o, mount: m }, ctx);
    expect(pose.position[0]).toBeCloseTo(-1.5);

    // Явная поверхность и высота; along зажимается на узкой грани колонны.
    const onColumn = remount(o, 'wall', ctx, { surfaceId: 'col:w', bottom: 1.5 });
    expect(onColumn).toEqual({ kind: 'wall', surfaceId: 'col:w', along: 0.2, bottom: 1.5 });
    // Неизвестный surfaceId не создаёт битой ссылки.
    const fallback = remount(o, 'wall', ctx, { surfaceId: 'gone' });
    expect(fallback.kind === 'wall' && fallback.surfaceId).toBe('far');
  });

  it('wall → floor / ceiling: X/Z берутся из мировой позы у стены; туда и обратно — то же место', () => {
    const poster = obj('poster', { kind: 'wall', surfaceId: 'right', along: 2, bottom: 1.3 });
    const ctx = ctxOf([poster]);
    const pose = resolvePose(poster, ctx);
    const floor = remount(poster, 'floor', ctx);
    expect(floor.kind).toBe('floor');
    if (floor.kind !== 'floor') return;
    expect(floor.x).toBeCloseTo(pose.position[0]);
    expect(floor.z).toBeCloseTo(pose.position[2]);
    expect(floor.lift).toBe(0);
    const ceiling = remount(poster, 'ceiling', ctx);
    expect(ceiling.kind === 'ceiling' && [ceiling.x, ceiling.z]).toEqual([floor.x, floor.z]);

    // Обратно на стену: та же поверхность и то же along.
    const back = remount({ ...poster, mount: floor }, 'wall', ctx, { bottom: 1.3 });
    expect(back.kind).toBe('wall');
    if (back.kind !== 'wall') return;
    expect(back.surfaceId).toBe('right');
    expect(back.along).toBeCloseTo(2);
    expect(back.bottom).toBeCloseTo(1.3);
  });

  it('→ surface: только с hostId; (u, v) — в локальных координатах повёрнутого хозяина', () => {
    const o = obj('o', { kind: 'floor', x: -1.9, z: -2.3, lift: 0 });
    const ctx = ctxOf([o]);
    const m = remount(o, 'surface', ctx, { hostId: 'venue-table2' });
    expect(m.kind).toBe('surface');
    if (m.kind !== 'surface') return;
    expect(m.hostId).toBe('venue-table2');
    expect(m.u).toBeCloseTo(0.3);
    expect(m.v).toBeCloseTo(0.1);
    // Мировые X/Z не изменились.
    const pose = resolvePose({ ...o, mount: m }, ctx);
    expect(pose.position[0]).toBeCloseTo(-1.9);
    expect(pose.position[2]).toBeCloseTo(-2.3);

    // Без hostId, с неизвестным хозяином и с самим собой — как floor.
    expect(remount(o, 'surface', ctx)).toEqual({ kind: 'floor', x: -1.9, z: -2.3, lift: 0 });
    expect(remount(o, 'surface', ctx, { hostId: 'gone' }).kind).toBe('floor');
    expect(remount(o, 'surface', ctx, { hostId: 'o' }).kind).toBe('floor');
  });

  it('результат проходит clampMount', () => {
    const tall = obj('tall', { kind: 'floor', x: 1, z: 1, lift: 0 }, { size: [0.4, 2.8, 0.4] });
    const ctx = ctxOf([tall]);
    // drop не может быть больше H − h = 0.2.
    const hung = remount(tall, 'ceiling', ctx, { drop: 1 });
    expect(hung.kind === 'ceiling' && hung.drop).toBeCloseTo(0.2);
    // Далеко от стола — центр основания зажимается на край столешницы.
    const far = remount(tall, 'surface', ctx, { hostId: 'venue-table' });
    expect(far).toEqual({ kind: 'surface', hostId: 'venue-table', u: 0.55, v: 0 });
  });
});

describe('childrenOf', () => {
  it('возвращает объекты, стоящие на хозяине', () => {
    const a = obj('a', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    const b = obj('b', { kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 });
    const c = obj('c', { kind: 'floor', x: -2, z: 1, lift: 0.75 });
    const all = [...testRoom.fixtures, a, b, c];
    expect(childrenOf(all, 'venue-table')).toEqual([a]);
    expect(childrenOf(all, 'venue-table2')).toEqual([b]);
    expect(childrenOf(all, 'venue-sofa')).toEqual([]);
  });
});

describe('describeMount', () => {
  it('высоты и запас над подиумом', () => {
    const hung = obj('hung', { kind: 'ceiling', x: -3, z: -2, drop: 0.3 }, { size: [1, 0.5, 1] });
    const r = describeMount(hung, ctxOf([hung]));
    expect(r.topY).toBeCloseTo(H - 0.3);
    expect(r.baseY).toBeCloseTo(H - 0.3 - 0.5);
    // Под объектом подиум высотой 0.2 — запас меньше.
    expect(r.clearance).toBeCloseTo(H - 0.3 - 0.5 - 0.2);
    expect(r.surfaceName).toBeUndefined();
    expect(r.hostName).toBeUndefined();

    const offPodium = { ...hung, mount: { kind: 'ceiling', x: 3, z: 1, drop: 0.3 } as Mount };
    expect(describeMount(offPodium, ctxOf([offPodium])).clearance).toBeCloseTo(H - 0.3 - 0.5);
  });

  it('стена: название поверхности и расстояние от её левого края до левого края объекта', () => {
    const poster = obj('poster', { kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1.5 }, { size: [0.6, 0.8, 0.02] });
    const r = describeMount(poster, ctxOf([poster]));
    expect(r.surfaceName).toBe('col · юг');
    expect(r.leftEdge).toBeCloseTo(0.1);
    expect(r.baseY).toBe(1.5);
    expect(r.topY).toBeCloseTo(2.3);
    expect(r.clearance).toBeCloseTo(1.5);
  });

  it('surface: имя хозяина, основание — на столешнице', () => {
    const lamp = obj('lamp', { kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 });
    const r = describeMount(lamp, ctxOf([lamp]));
    expect(r.hostName).toBe('Стол на подиуме');
    expect(r.baseY).toBeCloseTo(0.2 + 0.75);
    expect(r.clearance).toBeCloseTo(0.75);
  });
});
