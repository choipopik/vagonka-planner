import { describe, expect, it, vi } from 'vitest';
import { getItem } from '../catalog';
import type { LocalBox } from '../catalog/types';
import { wallSurfaces } from '../model/geometry';
import { backSurfaces, isPickable } from '../model/layers';
import type { LayerView } from '../model/layers';
import { makeContext } from '../model/pose';
import { testRoom } from '../model/testRoom';
import type { Mount, Ray, SceneObject, Vec3 } from '../model/types';
import { PICK_TIE } from './constants';
import { choosePick, columnDistance, pickObjects, rayBox } from './pick';
import type { ObjectHit } from './pick';

// Тестовый объект с заданными боксами выбора — рамка из четырёх полос с «дыркой» посередине (от W6 тест не зависит).
vi.mock('../catalog/bounds', async (importOriginal) => {
  const original = await importOriginal<typeof import('../catalog/bounds')>();
  const frame: LocalBox[] = [
    { center: [-0.55, 0.95, 0], size: [0.1, 1.9, 0.1] },
    { center: [0.55, 0.95, 0], size: [0.1, 1.9, 0.1] },
    { center: [0, 1.85, 0], size: [1.2, 0.1, 0.1] },
    { center: [0, 0.05, 0], size: [1.2, 0.1, 0.1] },
  ];
  return {
    ...original,
    pickBoxes: (o: SceneObject) => (o.type === 'test.frame' ? frame : original.pickBoxes(o)),
  };
});

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

/** Выбор так, как его делает контроллер указателя: предикат слоёв + заслонение колоннами. */
function pick(
  r: Ray,
  extra: SceneObject[],
  opts: { selectedId?: string | null; view?: LayerView; back?: readonly string[]; minThickness?: number } = {},
): string | null {
  const selectedId = opts.selectedId ?? null;
  const hits = pickObjects(r, ctxOf(extra), {
    pickable: (o) => isPickable(o, opts.view ?? 'both', opts.back ?? [], selectedId),
    minThickness: () => opts.minThickness ?? 0,
  });
  return choosePick(hits, selectedId, columnDistance(r, testRoom))?.id ?? null;
}

const unitBox: LocalBox = { center: [0, 0.5, 0], size: [1, 1, 1] };

describe('rayBox', () => {
  it('попадание снаружи: расстояние входа', () => {
    expect(rayBox({ origin: [0, 0.5, 5], dir: [0, 0, -1] }, unitBox)).toBeCloseTo(4.5);
    expect(rayBox({ origin: [0, 3, 0], dir: [0, -1, 0] }, unitBox)).toBeCloseTo(2);
  });

  it('начало луча внутри бокса → 0', () => {
    expect(rayBox({ origin: [0.1, 0.4, -0.2], dir: [0, 0, 1] }, unitBox)).toBe(0);
  });

  it('мимо и бокс позади луча → null', () => {
    expect(rayBox({ origin: [2, 0.5, 5], dir: [0, 0, -1] }, unitBox)).toBeNull();
    expect(rayBox({ origin: [0, 0.5, 5], dir: [0, 0, 1] }, unitBox)).toBeNull();
    expect(rayBox(ray([0, 5, 5], [3, 0, 0]), unitBox)).toBeNull();
  });

  it('касание грани и ребра считается попаданием', () => {
    // Луч скользит ровно по грани x = 0.5.
    expect(rayBox({ origin: [0.5, 0.5, 5], dir: [0, 0, -1] }, unitBox)).toBeCloseTo(4.5);
    // Луч проходит ровно через верхнее ребро (y = 1, z = 0.5).
    const edge = rayBox(ray([0, 2, 1.5], [0, 1, 0.5]), unitBox);
    expect(edge).not.toBeNull();
    expect(edge).toBeCloseTo(Math.SQRT2);
    // Чуть дальше грани — уже мимо.
    expect(rayBox({ origin: [0.5001, 0.5, 5], dir: [0, 0, -1] }, unitBox)).toBeNull();
  });

  it('тонкий бокс раздувается до minThickness по каждой стороне', () => {
    const thin: LocalBox = { center: [0, 0.5, 0], size: [1.5, 1, 0.02] };
    const beside: Ray = { origin: [0, 5, 0.04], dir: [0, -1, 0] };
    expect(rayBox(beside, thin)).toBeNull();
    expect(rayBox(beside, thin, 0.1)).toBeCloseTo(4);
    // Стороны, которые и так толще, не меняются.
    expect(rayBox({ origin: [0.76, 5, 0], dir: [0, -1, 0] }, thin, 0.1)).toBeNull();
    // Раздувание симметрично относительно центра: вход в лицевую грань сдвигается на (0.1 − 0.02) / 2.
    expect(rayBox({ origin: [0, 0.5, 3], dir: [0, 0, -1] }, thin, 0.1)).toBeCloseTo(3 - 0.05);
  });
});

describe('pickObjects', () => {
  it('возвращает попадания от ближнего к дальнему с точкой входа', () => {
    const a = obj('a', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const b = obj('b', 'box', { kind: 'floor', x: 3, z: -1, lift: 0 });
    const r: Ray = { origin: [3, 0.25, 2.5], dir: [0, 0, -1] };
    const hits = pickObjects(r, ctxOf([b, a]), { pickable: () => true, minThickness: () => 0 });
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
    expect(hits[0].distance).toBeCloseTo(1.25);
    expect(hits[0].point[2]).toBeCloseTo(1.25);
    expect(hits[1].distance).toBeCloseTo(3.25);
  });

  it('учитывает поворот объекта', () => {
    // Щит 1.5 × 1.0 × 0.03 на полу, повёрнут на 90°: его длинная сторона идёт вдоль Z.
    const banner = obj('banner', 'panel', { kind: 'floor', x: 3, z: 1, lift: 0 }, { rotationY: Math.PI / 2 });
    expect(pick(down(3, 1.6), [banner])).toBe('banner');
    expect(pick(down(3.6, 1), [banner])).toBeNull();
  });

  it('тонкий настенный щит на плане выбирается благодаря раздуванию', () => {
    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'far', along: 7, bottom: 1.2 });
    // Центр щита по Z: −3 + WALL_GAP + d/2 = −2.955; луч идёт в 5 см от него.
    const r = down(2, -2.905);
    expect(pick(r, [banner])).toBeNull();
    expect(pick(r, [banner], { minThickness: 0.12 })).toBe('banner');
  });

  it('спрашивает minThickness на расстоянии до бокса', () => {
    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'far', along: 7, bottom: 1.2 });
    const asked: number[] = [];
    pickObjects(down(2, -2.955), makeContext(testRoom, [banner]), {
      pickable: () => true,
      minThickness: (distance) => {
        asked.push(distance);
        return 0;
      },
    });
    // Центр щита на высоте 1.7, луч начинается на 20.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeCloseTo(18.3);
  });
});

describe('choosePick', () => {
  const hit = (id: string, distance: number): ObjectHit => ({ id, distance, point: [0, 0, 0] });

  it('побеждает ближайшее попадание', () => {
    expect(choosePick([hit('far', 7), hit('near', 3)], null, Infinity)?.id).toBe('near');
    expect(choosePick([], null, Infinity)).toBeNull();
  });

  it('выбранный побеждает только при разнице расстояний ≤ PICK_TIE', () => {
    expect(choosePick([hit('a', 5), hit('sel', 5 + PICK_TIE)], 'sel', Infinity)?.id).toBe('sel');
    expect(choosePick([hit('a', 5), hit('sel', 5 + PICK_TIE / 2)], 'sel', Infinity)?.id).toBe('sel');
    expect(choosePick([hit('a', 5), hit('sel', 5 + PICK_TIE + 0.001)], 'sel', Infinity)?.id).toBe('a');
    expect(choosePick([hit('a', 5), hit('sel', 6)], 'sel', Infinity)?.id).toBe('a');
    expect(choosePick([hit('sel', 4), hit('a', 5)], 'sel', Infinity)?.id).toBe('sel');
  });

  it('попадания дальше заслоняющей колонны отбрасываются', () => {
    expect(choosePick([hit('behind', 6)], null, 5)).toBeNull();
    expect(choosePick([hit('front', 4), hit('behind', 6)], 'behind', 5)?.id).toBe('front');
    expect(choosePick([hit('at', 5)], null, 5)?.id).toBe('at');
  });
});

describe('выбор в сцене', () => {
  it('ближайший объект побеждает', () => {
    const front = obj('front', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const back = obj('back', 'box', { kind: 'floor', x: 3, z: -1, lift: 0 });
    expect(pick({ origin: [3, 0.25, 2.5], dir: [0, 0, -1] }, [back, front])).toBe('front');
    expect(pick({ origin: [3, 0.25, -2.5], dir: [0, 0, 1] }, [back, front])).toBe('back');
  });

  it('фонарь на выбранном столе выбирается, а не стол', () => {
    const lantern = obj('lantern', 'sphere', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
    // Сверху и под углом из прохода кабинки.
    expect(pick(down(-2, 1), [lantern], { selectedId: 'venue-table' })).toBe('lantern');
    expect(pick(ray([-2, 2.5, -3], [-2, 0.95, 1]), [lantern], { selectedId: 'venue-table' })).toBe('lantern');
    // Рядом с фонарём по-прежнему выбирается стол.
    expect(pick(down(-1.6, 1.2), [lantern], { selectedId: 'venue-table' })).toBe('venue-table');
  });

  it('стол внутри выбранной кабинки выбирается', () => {
    // Кабинка открыта в сторону −Z: луч входит через проход и попадает в столешницу раньше, чем в сиденья.
    expect(pick(ray([-2, 2.5, -4], [-2, 0.75, 1]), [], { selectedId: 'venue-sofa' })).toBe('venue-table');
    expect(pick(ray([-2, 2.5, -4], [-2, 0.75, 1]), [])).toBe('venue-table');
  });

  it('стол внутри кабинки выбирается сверху, а сиденья вокруг него — как кабинка', () => {
    expect(pick(down(-2, 1), [])).toBe('venue-table');
    expect(pick(down(-2, 1), [], { selectedId: 'venue-sofa' })).toBe('venue-table');
    // Спинка кабинки (мировой z ≈ 2.1) и боковая перегородка (x ≈ −3.3).
    expect(pick(down(-2, 2.1), [])).toBe('venue-sofa');
    expect(pick(down(-3.3, 1.3), [])).toBe('venue-sofa');
  });

  it('соприкасающийся выбранный объект не уступает перетаскивание соседу', () => {
    // Два ящика вплотную: луч входит в оба на одном расстоянии.
    const a = obj('a', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const flat = obj('flat', 'box', { kind: 'floor', x: 3, z: 1.26, lift: 0 }, { size: [0.5, 0.5, 0.02] });
    const r: Ray = { origin: [3, 0.25, 3], dir: [0, 0, -1] };
    // Тонкая пластина стоит на 1 см перед ящиком: без выбора побеждает она, выбранный ящик — в пределах PICK_TIE.
    expect(pick(r, [a, flat])).toBe('flat');
    expect(pick(r, [a, flat], { selectedId: 'a' })).toBe('a');
  });

  it('заблокированные и скрытые объекты пропускаются', () => {
    const front = obj('front', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 });
    const back = obj('back', 'box', { kind: 'floor', x: 3, z: -1, lift: 0 });
    const r: Ray = { origin: [3, 0.25, 2.5], dir: [0, 0, -1] };
    expect(pick(r, [{ ...front, locked: true }, back])).toBe('back');
    expect(pick(r, [{ ...front, visible: false }, back])).toBe('back');
    // Заблокированный не выбирается мышью, даже если выбран в списке.
    expect(pick(r, [{ ...front, locked: true }, back], { selectedId: 'front' })).toBe('back');
    expect(pick(r, [{ ...front, locked: true }])).toBeNull();
  });

  it('потолочный призрак пропускает клики к тому, что под ним', () => {
    const cloud = obj('cloud', 'box', { kind: 'ceiling', x: -2, z: 1, drop: 0.2 }, { size: [3, 0.5, 3] });
    // Слой «Авто» изнутри: потолочный объект сплошной и перехватывает клик.
    expect(pick(down(-2, 1), [cloud], { view: 'both' })).toBe('cloud');
    // Вид сверху («пол»): призрак, клик проходит к столу.
    expect(pick(down(-2, 1), [cloud], { view: 'floor' })).toBe('venue-table');
    // Выбранный — не призрак.
    expect(pick(down(-2, 1), [cloud], { view: 'floor', selectedId: 'cloud' })).toBe('cloud');
    // Слой «Потолок»: напольные пропускают клики.
    expect(pick(down(-2, 1), [cloud], { view: 'ceiling' })).toBe('cloud');
    expect(pick(down(-2, 1), [], { view: 'ceiling' })).toBeNull();
  });

  it('настенный объект на поверхности из back не выбирается и не заслоняет то, что за ним, а выбранный — выбирается', () => {
    // Щит на ближней стене (z = +3), камера облёта снаружи за ней: стена отсечена, щит — призрак.
    const banner = obj('banner', 'panel', { kind: 'wall', surfaceId: 'near', along: 2, bottom: 0 });
    const behind = obj('behind', 'box', { kind: 'floor', x: 3, z: 1.5, lift: 0 }, { size: [0.5, 1, 0.5] });
    const camera: Vec3 = [3, 0.5, 9];
    const back = backSurfaces('orbit', camera, wallSurfaces(testRoom));
    expect(back).toContain('near');
    const r = ray(camera, [3, 0.5, 0]);
    // Луч действительно проходит сквозь щит.
    expect(pick(r, [banner, behind], { back: [] })).toBe('banner');
    expect(pick(r, [banner, behind], { back })).toBe('behind');
    expect(pick(r, [banner], { back })).toBeNull();
    expect(pick(r, [banner, behind], { back, selectedId: 'banner' })).toBe('banner');
  });

  it('колонна заслоняет объекты за собой', () => {
    // Колонна 'col' в (2, 0), 0.8 × 0.6; ящик — за ней, если смотреть со стороны +Z.
    const hidden = obj('hidden', 'box', { kind: 'floor', x: 2, z: -1.5, lift: 0 });
    const r: Ray = { origin: [2, 0.25, 5], dir: [0, 0, -1] };
    expect(columnDistance(r, testRoom)).toBeCloseTo(4.7);
    expect(pick(r, [hidden])).toBeNull();
    // С другой стороны колонна уже не мешает.
    expect(pick({ origin: [2, 0.25, -2.9], dir: [0, 0, 1] }, [hidden])).toBe('hidden');
    // Объект перед колонной выбирается; выбранный за колонной — всё равно нет.
    const front = obj('front', 'box', { kind: 'floor', x: 2, z: 1.5, lift: 0 });
    expect(pick(r, [hidden, front])).toBe('front');
    expect(pick(r, [hidden], { selectedId: 'hidden' })).toBeNull();
  });

  it('плакат на грани колонны выбирается: он ближе колонны', () => {
    const poster = obj('poster', 'panel', { kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1 }, { size: [0.6, 0.8, 0.03] });
    expect(pick({ origin: [2, 1.4, 5], dir: [0, 0, -1] }, [poster])).toBe('poster');
  });

  it('columnDistance: мимо колонн → Infinity', () => {
    expect(columnDistance({ origin: [-3, 1, 5], dir: [0, 0, -1] }, testRoom)).toBe(Infinity);
    expect(columnDistance(down(2, 0), { ...testRoom, columns: [] })).toBe(Infinity);
    // Сверху колонна «начинается» на высоте потолка.
    expect(columnDistance(down(2, 0), testRoom)).toBeCloseTo(20 - testRoom.size.height);
  });

  it('сквозь «дырку» рамки из четырёх полос выбирается то, что за ней', () => {
    const frame = obj('frame', 'test.frame', { kind: 'floor', x: 3.5, z: 1.5, lift: 0 }, { size: [1.2, 1.9, 0.1] });
    const behind = obj('behind', 'box', { kind: 'floor', x: 3.5, z: 0, lift: 0 }, { size: [0.5, 1.5, 0.5] });
    // Через центр проёма.
    expect(pick({ origin: [3.5, 1, 4], dir: [0, 0, -1] }, [frame, behind])).toBe('behind');
    expect(pick({ origin: [3.5, 1, 4], dir: [0, 0, -1] }, [frame])).toBeNull();
    // Через боковую и верхнюю полосы — сама рамка.
    expect(pick({ origin: [2.95, 1, 4], dir: [0, 0, -1] }, [frame, behind])).toBe('frame');
    expect(pick({ origin: [3.5, 1.85, 4], dir: [0, 0, -1] }, [frame, behind])).toBe('frame');
    // Выбранная рамка не «перехватывает» клик в проём.
    expect(pick({ origin: [3.5, 1, 4], dir: [0, 0, -1] }, [frame, behind], { selectedId: 'frame' })).toBe('behind');
  });
});
