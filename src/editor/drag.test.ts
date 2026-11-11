import { describe, expect, it } from 'vitest';
import { getItem } from '../catalog';
import { GRID_STEP, makeContext, resolvePose } from '../model/pose';
import type { SceneContext } from '../model/pose';
import { hitWalls, rayPlaneY } from '../model/surfaces';
import { testRoom } from '../model/testRoom';
import type { Mount, Ray, SceneObject, Vec3 } from '../model/types';
import { beginMove, resolveMove } from './drag';
import type { DragEnv, MoveResult } from './drag';

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

/** Объект с применённым результатом перемещения — чтобы проверить мировую позу. */
function moved(o: SceneObject, result: MoveResult): SceneObject {
  return { ...o, mount: result.mount, rotationY: result.rotationY };
}

function must(result: MoveResult | null): MoveResult {
  expect(result).not.toBeNull();
  return result as MoveResult;
}

describe('перемещение по полу', () => {
  const crate = obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });

  it('нет скачка в первый кадр: тот же луч оставляет объект на месте', () => {
    const ctx = ctxOf([crate]);
    // Камера облёта, луч входит в верхнее переднее ребро ящика — точка пола под лучом лежит далеко за ящиком.
    const grab = ray([3, 4, 8], [3.2, 0.5, 1.25]);
    const s = beginMove(crate, grab, ctx);
    expect(s.id).toBe('crate');
    expect(s.start).toBe(crate);
    expect(s.baseY).toBe(0);
    expect(s.wallVia).toBeUndefined();
    const floorPoint = rayPlaneY(grab, 0);
    expect(floorPoint).not.toBeNull();
    expect(Math.hypot(s.offset[0], s.offset[1])).toBeGreaterThan(0.2);
    const first = must(resolveMove(s, grab, env(ctx)));
    expect(first.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(first.rotationY).toBe(0);
  });

  it('смещение захвата сохраняется при движении', () => {
    const ctx = ctxOf([crate]);
    const camera: Vec3 = [3, 4, 8];
    const s = beginMove(crate, ray(camera, [3.2, 0, 1.1]), ctx);
    // Курсор сдвинулся по полу на (−1.5, +0.4) — объект сдвигается на столько же.
    const r = must(resolveMove(s, ray(camera, [1.7, 0, 1.5]), env(ctx)));
    expect(r.mount.kind).toBe('floor');
    if (r.mount.kind !== 'floor') return;
    expect(r.mount.x).toBeCloseTo(1.5, 9);
    expect(r.mount.z).toBeCloseTo(1.4, 9);
    expect(r.mount.lift).toBe(0);
  });

  it('въезд на подиум поднимает позу на его высоту', () => {
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, down(3, 1), ctx);
    const r = must(resolveMove(s, down(-4, -2), env(ctx, null, 'top')));
    expect(r.mount).toEqual({ kind: 'floor', x: -4, z: -2, lift: 0 });
    expect(resolvePose(moved(crate, r), ctx).position).toEqual([-4, 0.2, -2]);
    // И обратно — на пол помещения.
    const back = must(resolveMove(s, down(3, -2), env(ctx, null, 'top')));
    expect(resolvePose(moved(crate, back), ctx).position[1]).toBe(0);
  });

  it('объект на подиуме перетаскивается по плоскости своей высоты; зазор lift сохраняется и не округляется', () => {
    const lifted = obj('lifted', 'box', { kind: 'floor', x: -4, z: -2, lift: 0.33 });
    const ctx = ctxOf([lifted]);
    const camera: Vec3 = [-4, 5, 6];
    const s = beginMove(lifted, ray(camera, [-4, 0.53, -2]), ctx);
    expect(s.baseY).toBeCloseTo(0.53);
    const r = must(resolveMove(s, ray(camera, [-3, 0.53, -2.5]), env(ctx, GRID_STEP)));
    expect(r.mount).toEqual({ kind: 'floor', x: -3, z: -2.5, lift: 0.33 });
  });

  it('сетка вкл/выкл', () => {
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, down(3, 1), ctx);
    const target = down(3.44, 1.27);
    expect(must(resolveMove(s, target, env(ctx, null, 'top'))).mount).toEqual({ kind: 'floor', x: 3.44, z: 1.27, lift: 0 });
    expect(must(resolveMove(s, target, env(ctx, GRID_STEP, 'top'))).mount).toEqual({ kind: 'floor', x: 3.4, z: 1.3, lift: 0 });
    // Без сетки значения округляются до сантиметра.
    expect(must(resolveMove(s, down(3.4449, 1.2712), env(ctx, null, 'top'))).mount).toEqual({ kind: 'floor', x: 3.44, z: 1.27, lift: 0 });
  });

  it('зажим в помещении', () => {
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, down(3, 1), ctx);
    expect(must(resolveMove(s, down(30, -40), env(ctx, null, 'top'))).mount).toEqual({ kind: 'floor', x: 5, z: -3, lift: 0 });
  });

  it('луч выше горизонта не двигает объект', () => {
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, ray([3, 1.5, 6], [3, 0, 1]), ctx);
    expect(resolveMove(s, ray([3, 1.5, 6], [3, 2.5, 1]), env(ctx))).toBeNull();
  });
});

describe('пол ⇄ столешница', () => {
  it('фонарь над столом → surface с верными u, v', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'floor', x: 0, z: 1.5, lift: 0 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(0, 1.5), ctx);
    const r = must(resolveMove(s, down(-1.8, 1.1), env(ctx, null, 'top')));
    expect(r.mount.kind).toBe('surface');
    if (r.mount.kind !== 'surface') return;
    expect(r.mount.hostId).toBe('venue-table');
    expect(r.mount.u).toBeCloseTo(0.2, 9);
    expect(r.mount.v).toBeCloseTo(0.1, 9);
    expect(r.rotationY).toBe(0);
    const pose = resolvePose(moved(lantern, r), ctx);
    expect(pose.position[0]).toBeCloseTo(-1.8);
    expect(pose.position[1]).toBeCloseTo(0.75);
    expect(pose.position[2]).toBeCloseTo(1.1);
  });

  it('повёрнутый стол на подиуме: (u, v) в осях стола, угол — относительно хозяина', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'floor', x: 0, z: 1.5, lift: 0 }, { rotationY: Math.PI / 6 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(0, 1.5), ctx);
    const r = must(resolveMove(s, down(-1.9, -1.7), env(ctx, null, 'top')));
    expect(r.mount.kind).toBe('surface');
    if (r.mount.kind !== 'surface') return;
    expect(r.mount.hostId).toBe('venue-table2');
    expect(r.mount.u).toBeCloseTo(-0.3, 9);
    expect(r.mount.v).toBeCloseTo(0.1, 9);
    expect(r.rotationY).toBeCloseTo(Math.PI / 6 - Math.PI / 2);
    const pose = resolvePose(moved(lantern, r), ctx);
    expect(pose.position[0]).toBeCloseTo(-1.9);
    expect(pose.position[1]).toBeCloseTo(0.95);
    expect(pose.position[2]).toBeCloseTo(-1.7);
    // Мировой угол не изменился.
    expect(pose.rotationY).toBeCloseTo(Math.PI / 6);
  });

  it('в облёте столешница находится по своей плоскости, а не по точке пола под лучом', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'floor', x: 0, z: 2.5, lift: 0 });
    const ctx = ctxOf([lantern]);
    const camera: Vec3 = [-2, 5, -4];
    const s = beginMove(lantern, ray(camera, [0, 0, 2.5]), ctx);
    // Луч в центр столешницы: точка пола под ним уже за столом.
    const r = must(resolveMove(s, ray(camera, [-2, 0.75, 1]), env(ctx)));
    expect(r.mount.kind).toBe('surface');
    if (r.mount.kind !== 'surface') return;
    expect(r.mount.hostId).toBe('venue-table');
    expect(r.mount.u).toBeCloseTo(0, 9);
    expect(r.mount.v).toBeCloseTo(0, 9);
  });

  it('со стола → на пол, мировой угол сохраняется', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 }, { rotationY: 0.2 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(-2, -2), ctx);
    expect(s.baseY).toBeCloseTo(0.95);
    const r = must(resolveMove(s, down(1, 1.5), env(ctx, null, 'top')));
    expect(r.mount).toEqual({ kind: 'floor', x: 1, z: 1.5, lift: 0 });
    expect(r.rotationY).toBeCloseTo(Math.PI / 2 + 0.2);
  });

  it('по тому же столу: относительный угол не меняется, (u, v) зажаты столешницей', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 }, { rotationY: 0.7 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(-2, 1), ctx);
    const r = must(resolveMove(s, down(-1.6, 0.8), env(ctx, null, 'top')));
    expect(r.mount).toEqual({ kind: 'surface', hostId: 'venue-table', u: 0.4, v: -0.2 });
    expect(r.rotationY).toBe(0.7);
    // С сеткой (u, v) округляются в осях стола.
    const snapped = must(resolveMove(s, down(-1.63, 0.84), env(ctx, GRID_STEP, 'top')));
    expect(snapped.mount).toEqual({ kind: 'surface', hostId: 'venue-table', u: 0.4, v: -0.2 });
  });

  it('со стола на другой стол', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, down(-2, 1), ctx);
    const r = must(resolveMove(s, down(-2, -2), env(ctx, null, 'top')));
    expect(r.mount).toEqual({ kind: 'surface', hostId: 'venue-table2', u: 0, v: 0 });
    expect(r.rotationY).toBeCloseTo(-Math.PI / 2);
  });

  it('предмет без surface в mounts игнорирует столы', () => {
    const sofa = obj('sofa', 'sofa', { kind: 'floor', x: 1, z: 1.5, lift: 0 });
    expect(getItem('sofa').mounts).not.toContain('surface');
    const ctx = ctxOf([sofa]);
    const s = beginMove(sofa, down(1, 1.5), ctx);
    expect(must(resolveMove(s, down(-2, 1), env(ctx, null, 'top'))).mount).toEqual({ kind: 'floor', x: -2, z: 1, lift: 0 });
  });

  it('ящик, на котором стоит фонарь, игнорирует столешницы и остаётся на полу; без детей — встаёт на стол', () => {
    const crate = obj('crate', 'box', { kind: 'floor', x: 1, z: 1.5, lift: 0 });
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'crate', u: 0, v: 0 });

    const withChild = ctxOf([crate, lantern]);
    const s = beginMove(crate, down(1, 1.5), withChild);
    expect(must(resolveMove(s, down(-2, 1), env(withChild, null, 'top'))).mount).toEqual({ kind: 'floor', x: -2, z: 1, lift: 0 });

    const alone = ctxOf([crate]);
    const s2 = beginMove(crate, down(1, 1.5), alone);
    expect(must(resolveMove(s2, down(-2, 1), env(alone, null, 'top'))).mount).toEqual({
      kind: 'surface',
      hostId: 'venue-table',
      u: 0,
      v: 0,
    });
  });

  it('объект не встаёт сам на себя и на скрытый стол', () => {
    const crate = obj('crate', 'box', { kind: 'floor', x: 1, z: 1.5, lift: 0 });
    const ctx = ctxOf([crate]);
    const s = beginMove(crate, down(1, 1.5), ctx);
    expect(must(resolveMove(s, down(1.1, 1.6), env(ctx, null, 'top'))).mount.kind).toBe('floor');

    const hidden = makeContext(testRoom, [
      ...testRoom.fixtures.map((o) => (o.id === 'venue-table' ? { ...o, visible: false } : o)),
      crate,
    ]);
    const s2 = beginMove(crate, down(1, 1.5), hidden);
    expect(must(resolveMove(s2, down(-2, 1), env(hidden, null, 'top'))).mount.kind).toBe('floor');
  });

  it('только настольный предмет вне опор → null', () => {
    // Запись каталога без 'floor' в mounts эмулируется типом, которого нет: FALLBACK умеет всё, поэтому берём
    // настоящий сценарий — луч выше горизонта для предмета на столе (ни столешницы, ни пола под курсором).
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    const ctx = ctxOf([lantern]);
    const s = beginMove(lantern, ray([-2, 2, -3], [-2, 0.75, 1]), ctx);
    expect(resolveMove(s, ray([-2, 2, -3], [-2, 3, 1]), env(ctx))).toBeNull();
  });
});

describe('настенный объект', () => {
  const poster = obj('poster', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 }, { size: [0.4, 0.6, 0.03] });
  const camera: Vec3 = [1, 1.6, 2.5];

  it("лицом к камере: wallVia 'hit', скольжение по стене со смещением захвата", () => {
    const ctx = ctxOf([poster]);
    // Попадание в стену в точке along 5.1, y 1.4.
    const grab = ray(camera, [0.1, 1.4, -3]);
    const s = beginMove(poster, grab, ctx);
    expect(s.wallVia).toBe('hit');
    expect(s.offset[0]).toBeCloseTo(-0.1);
    expect(s.offset[1]).toBeCloseTo(-0.2);
    // Первый кадр — без скачка.
    expect(must(resolveMove(s, grab, env(ctx))).mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    const r = must(resolveMove(s, ray(camera, [1.6, 1.9, -3]), env(ctx)));
    expect(r.mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 6.5, bottom: 1.7 });
    expect(r.rotationY).toBe(0);
  });

  it('сетка округляет along и bottom, зажим не выпускает за край стены и потолок', () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, ray(camera, [0, 1.2, -3]), ctx);
    expect(must(resolveMove(s, ray(camera, [1.63, 1.87, -3]), env(ctx, GRID_STEP))).mount).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 6.6,
      bottom: 1.9,
    });
    // Правый верхний угол стены: along ≤ длина − w/2, bottom ≤ H − h.
    const corner = must(resolveMove(s, ray(camera, [4.99, 2.99, -3]), env(ctx)));
    expect(corner.mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 9.8, bottom: 2.4 });
  });

  it('переход на соседнюю стену', () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, ray(camera, [0, 1.2, -3]), ctx);
    // Правая стена x = 5: along отсчитывается от (5, −3) вдоль +Z.
    const r = must(resolveMove(s, ray(camera, [5, 1.5, 1]), env(ctx)));
    expect(r.mount).toEqual({ kind: 'wall', surfaceId: 'right', along: 4, bottom: 1.5 });
  });

  it('переход на грань колонны', () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, ray(camera, [0, 1.2, -3]), ctx);
    // Грань 's' колонны: z = 0.3, x от 1.6 до 2.4.
    const r = must(resolveMove(s, ray(camera, [2.1, 1.3, 0.3]), env(ctx)));
    expect(r.mount).toEqual({ kind: 'wall', surfaceId: 'col:s', along: 0.5, bottom: 1.3 });
    // Объект шире грани встаёт по её центру.
    const wide = { ...poster, size: [1.5, 1, 0.03] as Vec3 };
    const wideCtx = ctxOf([wide]);
    const s2 = beginMove(wide, ray(camera, [0, 1.2, -3]), wideCtx);
    const onColumn = must(resolveMove(s2, ray(camera, [2.1, 1.3, 0.3]), env(wideCtx)));
    expect(onColumn.mount.kind).toBe('wall');
    if (onColumn.mount.kind !== 'wall') return;
    expect(onColumn.mount.surfaceId).toBe('col:s');
    // Длина грани считается через hypot и равна 0.8 с точностью до ошибки округления.
    expect(onColumn.mount.along).toBeCloseTo(0.4, 9);
    expect(onColumn.mount.bottom).toBe(1.3);
  });

  it("'hit': луч мимо всех стен → null", () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, ray(camera, [0, 1.2, -3]), ctx);
    // В пол посреди зала: ни одна стена не задета в пределах её высоты.
    const toFloor = ray([1, 2.9, 2.5], [1, 0, 2.4]);
    expect(hitWalls(toFloor, testRoom)).toHaveLength(0);
    expect(resolveMove(s, toFloor, env(ctx))).toBeNull();
  });

  it("на плане: wallVia 'floor', ближайшая поверхность, без скачка в первый кадр", () => {
    const ctx = ctxOf([poster]);
    // Центр плаката на плане: x = 0, z = −3 + WALL_GAP + d/2 = −2.955; курсор — чуть в стороне.
    const grab = down(0.05, -2.95);
    const s = beginMove(poster, grab, ctx);
    expect(s.wallVia).toBe('floor');
    expect(must(resolveMove(s, grab, env(ctx, null, 'top'))).mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 });
    // Вдоль стены.
    expect(must(resolveMove(s, down(1.55, -2.95), env(ctx, null, 'top'))).mount).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 6.5,
      bottom: 1.2,
    });
    // Высота основания не меняется и не округляется сеткой.
    const odd = { ...poster, mount: { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.23 } as Mount };
    const oddCtx = ctxOf([odd]);
    const s2 = beginMove(odd, grab, oddCtx);
    expect(must(resolveMove(s2, down(1.55, -2.95), env(oddCtx, GRID_STEP, 'top'))).mount).toEqual({
      kind: 'wall',
      surfaceId: 'far',
      along: 6.5,
      bottom: 1.23,
    });
  });

  it('на плане: переходит на соседнюю стену и на грань колонны, со стен не уходит', () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, down(0, -3), ctx);
    const at = (x: number, z: number) => must(resolveMove(s, down(x, z), env(ctx, null, 'top'))).mount;

    // Курсор посреди зала — объект всё равно на какой-то поверхности.
    for (const [x, z] of [[0, 0], [-3, 0.2], [4, 2], [-4.5, -2.5], [2, 0], [30, 30], [-30, 0]] as const) {
      const mount = at(x, z);
      expect(mount.kind).toBe('wall');
      if (mount.kind !== 'wall') continue;
      expect(ctx.surface(mount.surfaceId)).toBeDefined();
      expect(mount.bottom).toBe(1.2);
    }
    // У правой стены (x = 5): along = z + 3.
    expect(at(4.9, 1)).toEqual({ kind: 'wall', surfaceId: 'right', along: 4, bottom: 1.2 });
    // У левой стены (x = −5): along = 3 − z.
    expect(at(-4.8, 0.5)).toEqual({ kind: 'wall', surfaceId: 'left', along: 2.5, bottom: 1.2 });
    // У ближней стены (z = 3): along = 5 − x.
    expect(at(1, 2.9)).toEqual({ kind: 'wall', surfaceId: 'near', along: 4, bottom: 1.2 });
    // Рядом с западной гранью колонны (x = 1.6, z от −0.3 до 0.3): along = z + 0.3, зажат по ширине плаката.
    expect(at(1.5, 0)).toEqual({ kind: 'wall', surfaceId: 'col:w', along: 0.3, bottom: 1.2 });
    expect(at(2, 0.5)).toEqual({ kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1.2 });
  });

  it('на плане за углом помещения объект остаётся на своей стене', () => {
    const ctx = ctxOf([poster]);
    const s = beginMove(poster, down(0, -3), ctx);
    // Точка снаружи за углом far/right: до обеих стен одинаково далеко (ближайшая точка — угол).
    const mount = must(resolveMove(s, down(5.5, -3.5), env(ctx, null, 'top'))).mount;
    expect(mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 9.8, bottom: 1.2 });
  });

  describe('на ближней стене, взятый лучом снаружи (со спины)', () => {
    // Щит 1.5 × 1.0 на ближней стене (z = +3, along = 5 − x), камера облёта снаружи за этой стеной.
    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'near', along: 5, bottom: 1.2 });
    const centerZ = 3 - 0.03 - 0.015;

    for (const [label, eye] of [
      ['высокая камера (луч упирается в пол посреди зала)', [0.3, 5, 10]],
      ['низкая камера (луч упирается в дальнюю стену)', [0.3, 2.5, 10]],
    ] as const) {
      it(`${label}: wallVia 'floor', первый кадр оставляет объект на той же стене`, () => {
        const ctx = ctxOf([banner]);
        const origin: Vec3 = [eye[0], eye[1], eye[2]];
        const grab = ray(origin, [0.3, 1.7, centerZ]);
        // Стена объекта повёрнута к лучу изнанкой: hitWalls её не видит.
        expect(hitWalls(grab, testRoom).some((h) => h.surfaceId === 'near')).toBe(false);
        const s = beginMove(banner, grab, ctx);
        expect(s.wallVia).toBe('floor');

        const first = must(resolveMove(s, grab, env(ctx)));
        expect(first.mount.kind).toBe('wall');
        if (first.mount.kind !== 'wall') return;
        expect(first.mount.surfaceId).toBe('near');
        expect(Math.abs(first.mount.along - 5)).toBeLessThan(0.01);
        expect(first.mount.bottom).toBe(1.2);

        // С сеткой — тоже без скачка (исходное положение кратно шагу).
        expect(must(resolveMove(s, grab, env(ctx, GRID_STEP))).mount).toEqual({ kind: 'wall', surfaceId: 'near', along: 5, bottom: 1.2 });
      });

      it(`${label}: объект едет вдоль своей стены за курсором и не перескакивает на противоположную`, () => {
        const ctx = ctxOf([banner]);
        const origin: Vec3 = [eye[0], eye[1], eye[2]];
        const s = beginMove(banner, ray(origin, [0.3, 1.7, centerZ]), ctx);
        for (const dx of [-3, -1.5, -0.4, 0.2, 1, 2.5, 3.9]) {
          // Курсор ведут вдоль стены на высоте захвата: захваченная точка остаётся под курсором. Луч входит в габарит
          // через заднюю грань (на 1.5 см раньше плоскости центра), отсюда параллакс в несколько миллиметров + округление до 1 см.
          const r = must(resolveMove(s, ray(origin, [0.3 + dx, 1.7, centerZ]), env(ctx)));
          expect(r.mount.kind).toBe('wall');
          if (r.mount.kind !== 'wall') continue;
          expect(r.mount.surfaceId).toBe('near');
          expect(Math.abs(r.mount.along - (5 - dx))).toBeLessThan(0.02);
          expect(r.mount.bottom).toBe(1.2);
        }
      });
    }

    it('точка пола под лучом ближе к другим поверхностям — правило «ближайшая к точке пола» дало бы скачок', () => {
      // Контроль самого сценария: буквальное правило спецификации здесь перенесло бы щит на колонну или дальнюю стену.
      const grab = ray([0.3, 5, 10], [0.3, 1.7, centerZ]);
      const floorPoint = rayPlaneY(grab, 0);
      expect(floorPoint).not.toBeNull();
      if (!floorPoint) return;
      expect(3 - floorPoint[2]).toBeGreaterThan(floorPoint[2] + 3);
    });

    it('у края стены переходит на соседнюю, а не на противоположную', () => {
      const ctx = ctxOf([banner]);
      const origin: Vec3 = [0.3, 5, 10];
      const s = beginMove(banner, ray(origin, [0.3, 1.7, centerZ]), ctx);
      // Курсор увели за левый (от камеры) край ближней стены и вглубь зала вдоль левой стены x = −5.
      const r = must(resolveMove(s, ray(origin, [-5.2, 1.7, 1]), env(ctx)));
      expect(r.mount.kind).toBe('wall');
      if (r.mount.kind !== 'wall') return;
      expect(r.mount.surfaceId).toBe('left');
      expect(r.mount.bottom).toBe(1.2);
    });
  });
});

describe('потолочный объект', () => {
  // Опуск 0.35 не кратен шагу сетки: перетаскивание не должно его округлять.
  const cloud = obj('cloud', 'box', { kind: 'ceiling', x: 3, z: 1, drop: 0.35 }, { rotationY: 0.4 });
  const bottom = 3 - 0.35 - 0.5;

  it('остаётся потолочным, drop сохраняется (в том числе с сеткой)', () => {
    const ctx = ctxOf([cloud]);
    // Камера внутри зала, смотрит на низ объекта снизу вверх.
    const camera: Vec3 = [0, 1, 2.5];
    const grab = ray(camera, [3.1, bottom, 1.1]);
    const s = beginMove(cloud, grab, ctx);
    expect(s.baseY).toBeCloseTo(bottom);
    expect(s.wallVia).toBeUndefined();
    expect(must(resolveMove(s, grab, env(ctx))).mount).toEqual({ kind: 'ceiling', x: 3, z: 1, drop: 0.35 });
    const r = must(resolveMove(s, ray(camera, [1.63, bottom, -0.38]), env(ctx, GRID_STEP)));
    expect(r.mount).toEqual({ kind: 'ceiling', x: 1.5, z: -0.5, drop: 0.35 });
    expect(r.rotationY).toBe(0.4);
  });

  it('игнорирует столы: над столешницей остаётся под потолком', () => {
    const ctx = ctxOf([cloud]);
    expect(getItem('box').mounts).toContain('surface');
    const s = beginMove(cloud, down(3, 1), ctx);
    const r = must(resolveMove(s, down(-2, 1), env(ctx, null, 'top')));
    expect(r.mount).toEqual({ kind: 'ceiling', x: -2, z: 1, drop: 0.35 });
    // И над подиумом высота не меняется.
    const overPodium = must(resolveMove(s, down(-4, -2), env(ctx, null, 'top')));
    expect(resolvePose({ ...cloud, mount: overPodium.mount }, ctx).position[1]).toBeCloseTo(bottom);
  });

  it('зажим в помещении и округление без сетки', () => {
    const ctx = ctxOf([cloud]);
    const s = beginMove(cloud, down(3, 1), ctx);
    expect(must(resolveMove(s, down(-40, 40), env(ctx, null, 'top'))).mount).toEqual({ kind: 'ceiling', x: -5, z: 3, drop: 0.35 });
    expect(must(resolveMove(s, down(1.234, -0.777), env(ctx, null, 'top'))).mount).toEqual({ kind: 'ceiling', x: 1.23, z: -0.78, drop: 0.35 });
  });
});
