import { describe, expect, it } from 'vitest';
import { createLayout } from '../model/layout';
import { LAYOUT_PATTERNS } from '../model/migrate';
import { MAX_SIZE, MIN_SIZE, clampSize, sanitizeLayout } from '../model/ops';
import { createRng } from '../model/rng';
import { testRoom } from '../model/testRoom';
import type { Layout, Mount, MountKind, ObjectKind, Params, RoomDef, SceneObject, Vec3 } from '../model/types';
import { lounge } from '../rooms/lounge';
import { objectBox, partBounds, pickBoxes } from './bounds';
import {
  FALLBACK_ITEM,
  buildInput,
  catalogLookup,
  catalogSets,
  galleryObjects,
  getItem,
  getPainter,
  hasItem,
  isSupport,
  listedItems,
  partsOf,
  resolveParams,
} from './index';
import { basicSet } from './sets/basic';
import { hpSet } from './sets/hp';
import { checkBuild } from './testing';
import type { CatalogItem, LocalBox, Painter, Part } from './types';

const allItems = catalogSets.flatMap((set) => set.items);
const allPainters: Record<string, Painter> = Object.assign({}, ...catalogSets.map((set) => set.painters ?? {}));
const MOUNTS: MountKind[] = ['floor', 'wall', 'ceiling', 'surface'];

function objectOf(type: string, over: Partial<SceneObject> = {}): SceneObject {
  const item = getItem(type);
  return {
    id: `test-${type}`,
    kind: item.kind,
    type,
    origin: 'user',
    name: item.title,
    mount: { kind: 'floor', x: 0, z: 0, lift: 0 },
    rotationY: 0,
    size: [item.size[0], item.size[1], item.size[2]],
    color: item.color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

function mountOf(kind: MountKind): Mount {
  switch (kind) {
    case 'floor':
      return { kind, x: 0, z: 0, lift: 0 };
    case 'ceiling':
      return { kind, x: 0, z: 0, drop: 0 };
    case 'wall':
      return { kind, surfaceId: 'far', along: 2, bottom: 0 };
    case 'surface':
      return { kind, hostId: 'host', u: 0, v: 0 };
  }
}

function contains(box: LocalBox, p: Vec3): boolean {
  return [0, 1, 2].every((i) => Math.abs(p[i] - box.center[i]) <= box.size[i] / 2 + 1e-9);
}

function expectBox(actual: LocalBox, center: Vec3, size: Vec3) {
  for (let i = 0; i < 3; i++) {
    expect(actual.center[i], `center[${i}]`).toBeCloseTo(center[i], 9);
    expect(actual.size[i], `size[${i}]`).toBeCloseTo(size[i], 9);
  }
}

// ---------- состав каталога ----------

describe('каталог · состав', () => {
  it('наборы отсортированы по order: basic (10), harry-potter (50)', () => {
    expect(catalogSets.map((set) => set.id)).toEqual(['basic', 'harry-potter']);
    expect(catalogSets.map((set) => set.order)).toEqual([10, 50]);
    expect(catalogSets[0]).toBe(basicSet);
    expect(catalogSets[1]).toBe(hpSet);
    expect(hpSet.title).toBe('Гарри Поттер');
  });

  it('id уникальны по всем наборам и годятся как SceneObject.type', () => {
    const ids = allItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(LAYOUT_PATTERNS.type.test(id), id).toBe(true);
    expect(ids).not.toContain(FALLBACK_ITEM.id);
  });

  it('у каждой записи ≥ 1 крепление (без повторов) и размер в пределах min / max', () => {
    for (const item of [...allItems, FALLBACK_ITEM]) {
      expect(item.mounts.length, item.id).toBeGreaterThanOrEqual(1);
      expect(new Set(item.mounts).size, item.id).toBe(item.mounts.length);
      for (const mount of item.mounts) expect(MOUNTS, item.id).toContain(mount);
      for (let i = 0; i < 3; i++) {
        const lo = Math.max(MIN_SIZE, item.minSize?.[i] ?? 0);
        const hi = Math.min(MAX_SIZE, item.maxSize?.[i] ?? Infinity);
        expect(lo, `${item.id}: min ≤ max по оси ${i}`).toBeLessThanOrEqual(hi);
        expect(item.size[i], `${item.id}: ось ${i}`).toBeGreaterThanOrEqual(lo);
        expect(item.size[i], `${item.id}: ось ${i}`).toBeLessThanOrEqual(hi);
      }
      // Размер по умолчанию — неподвижная точка clampSize.
      expect(clampSize(item, item.size, item.size), item.id).toBe(item.size);
      expect(item.color, item.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(item.title.length, item.id).toBeGreaterThan(0);
      expect(item.category.length, item.id).toBeGreaterThan(0);
    }
  });

  it('build есть ровно у записей primitive / preset; параметры описаны корректно', () => {
    for (const item of allItems) {
      const buildable = item.kind === 'primitive' || item.kind === 'preset';
      expect(typeof item.build === 'function', item.id).toBe(buildable);
      const keys = item.params.map((def) => def.key);
      expect(new Set(keys).size, item.id).toBe(keys.length);
      for (const def of item.params) {
        expect(LAYOUT_PATTERNS.paramKey.test(def.key), `${item.id}.${def.key}`).toBe(true);
        expect(def.label.length, `${item.id}.${def.key}`).toBeGreaterThan(0);
        if (def.type === 'number') {
          expect(def.min, `${item.id}.${def.key}`).toBeLessThan(def.max);
          expect(def.default, `${item.id}.${def.key}`).toBeGreaterThanOrEqual(def.min);
          expect(def.default, `${item.id}.${def.key}`).toBeLessThanOrEqual(def.max);
          expect(def.step, `${item.id}.${def.key}`).toBeGreaterThan(0);
        }
        if (def.type === 'select') expect(def.options.map((o) => o.value), `${item.id}.${def.key}`).toContain(def.default);
        if (def.type === 'color') expect(def.default, `${item.id}.${def.key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        if (def.type === 'seed') expect(Number.isInteger(def.default), `${item.id}.${def.key}`).toBe(true);
      }
      if (item.flatAxis !== undefined) expect(item.size[item.flatAxis], item.id).toBeLessThan(0.1);
    }
  });

  it('набор basic — по таблице спецификации', () => {
    type Row = [id: string, kind: ObjectKind, title: string, category: string, size: Vec3, resize: CatalogItem['resize'], mounts: MountKind[]];
    const rows: Row[] = [
      ['sofa', 'primitive', 'Диван', 'Мебель', [1.6, 0.8, 0.75], 'free', ['floor']],
      ['sofaU', 'primitive', 'Диван-кабинка', 'Мебель', [2.8, 0.85, 1.8], 'free', ['floor']],
      ['table', 'primitive', 'Стол', 'Мебель', [1.1, 0.75, 0.7], 'free', ['floor']],
      ['highTable', 'primitive', 'Высокая стойка', 'Мебель', [1.4, 1.1, 0.5], 'free', ['floor']],
      ['phoneBooth', 'primitive', 'Телефонная будка', 'Мебель', [0.9, 2.4, 0.9], 'uniform', ['floor']],
      ['barrier', 'primitive', 'Ограждение', 'Мебель', [2.2, 1.1, 0.5], 'free', ['floor']],
      ['floorLamp', 'primitive', 'Торшер', 'Мебель', [0.45, 1.6, 0.45], 'uniform', ['floor']],
      ['box', 'primitive', 'Ящик', 'Фигуры', [0.5, 0.5, 0.5], 'free', ['floor', 'surface', 'ceiling']],
      ['cylinder', 'primitive', 'Цилиндр', 'Фигуры', [0.5, 0.5, 0.5], 'free', ['floor', 'surface', 'ceiling']],
      ['sphere', 'primitive', 'Шар', 'Фигуры', [0.4, 0.4, 0.4], 'uniform', ['floor', 'surface', 'ceiling']],
      ['cone', 'primitive', 'Конус', 'Фигуры', [0.4, 0.6, 0.4], 'free', ['floor', 'surface', 'ceiling']],
      ['panel', 'primitive', 'Щит / баннер', 'Фигуры', [1.5, 1.0, 0.03], 'free', ['wall', 'floor', 'ceiling']],
      ['light.point', 'light', 'Лампа', 'Свет', [0.15, 0.15, 0.15], 'none', ['ceiling', 'wall', 'floor', 'surface']],
      ['light.spot', 'light', 'Прожектор', 'Свет', [0.18, 0.22, 0.18], 'none', ['ceiling', 'wall', 'floor', 'surface']],
      ['image', 'image', 'Картинка', 'Мои файлы', [1.0, 1.0, 0.02], 'uniform', ['wall', 'floor', 'ceiling', 'surface']],
      ['image.flat', 'image', 'Картинка плашмя', 'Мои файлы', [1.0, 0.02, 1.0], 'uniform', ['floor', 'ceiling', 'surface']],
      ['model', 'model', '3D-модель', 'Мои файлы', [1, 1, 1], 'uniform', ['floor', 'surface', 'ceiling', 'wall']],
      ['duct', 'primitive', 'Воздуховод', 'Площадка', [12, 0.45, 0.5], 'free', ['ceiling']],
      ['pendantBulbs', 'preset', 'Лампы на проводах', 'Площадка', [2.0, 0.8, 0.6], 'free', ['ceiling']],
      ['projector', 'primitive', 'Проектор', 'Площадка', [0.4, 0.18, 0.35], 'uniform', ['ceiling']],
    ];
    expect(basicSet.items.map((item) => item.id)).toEqual(rows.map((row) => row[0]));
    for (const [id, kind, title, category, size, resize, mounts] of rows) {
      const item = getItem(id);
      expect({ id: item.id, kind: item.kind, title: item.title, category: item.category, size: item.size, resize: item.resize, mounts: item.mounts }, id).toEqual({
        id,
        kind,
        title,
        category,
        size,
        resize,
        mounts,
      });
    }
    // Столбец «Прочее».
    expect(basicSet.items.filter((item) => item.support).map((item) => item.id)).toEqual(['table', 'highTable', 'box', 'cylinder']);
    expect(basicSet.items.filter((item) => item.listed === false).map((item) => item.id)).toEqual([
      'image',
      'image.flat',
      'model',
      'duct',
      'pendantBulbs',
      'projector',
    ]);
    expect(basicSet.items.filter((item) => item.hanger === false).map((item) => item.id)).toEqual(['image', 'image.flat', 'duct', 'pendantBulbs']);
    expect(getItem('barrier').minSize).toEqual([0.4, 0.4, 0.3]);
    expect(getItem('image').flatAxis).toBe(2);
    expect(getItem('image.flat').flatAxis).toBe(1);
    expect(getItem('light.point').defaultDrop).toBe(0.4);
    expect(getItem('projector').defaultDrop).toBe(0.35);
    expect(resolveParams(getItem('light.point'), {})).toEqual({ intensity: 15, distance: 8 });
    expect(resolveParams(getItem('light.spot'), {})).toEqual({ intensity: 40, distance: 8, angle: 30, penumbra: 0.5, tilt: 0 });
    expect(resolveParams(getItem('image'), {})).toEqual({ glow: false });
    expect(resolveParams(getItem('image.flat'), {})).toEqual({ glow: false });
    expect(resolveParams(getItem('pendantBulbs'), {}).count).toBe(5);
    expect(getItem('pendantBulbs').params.map((def) => [def.key, def.type])).toEqual([
      ['count', 'number'],
      ['seed', 'seed'],
    ]);
    const limits = (id: string) => getItem(id).params.map((def) => (def.type === 'number' ? [def.key, def.min, def.max] : [def.key]));
    expect(limits('light.point')).toEqual([
      ['intensity', 0, 200],
      ['distance', 1, 15],
    ]);
    expect(limits('light.spot')).toEqual([
      ['intensity', 0, 200],
      ['distance', 1, 15],
      ['angle', 10, 60],
      ['penumbra', 0, 1],
      ['tilt', 0, 90],
    ]);
    expect(limits('pendantBulbs')[0]).toEqual(['count', 1, 12]);
  });

  it('набор «Гарри Поттер» — 11 записей в порядке раздела 4, финальные метаданные', () => {
    type Row = [id: string, title: string, size: Vec3, resize: CatalogItem['resize'], mounts: MountKind[], params: string[]];
    const rows: Row[] = [
      ['hp.cloudCeiling', 'Облачный потолок со свечами', [4.0, 1.1, 3.0], 'free', ['ceiling'], ['thickness', 'density', 'glowColor', 'glow', 'candles', 'hats', 'seed']],
      ['hp.dementor', 'Дементор на стойке', [0.9, 2.0, 0.7], 'uniform', ['floor'], ['arms', 'tatter', 'hover', 'showBase', 'seed']],
      ['hp.prophetWall', 'Стена газет „Ежедневный пророк“', [1.5, 2.5, 0.06], 'free', ['wall'], ['density', 'sheetScale', 'tilt', 'lang', 'seed']],
      ['hp.owlPost', 'Сова с письмами', [1.6, 1.5, 1.6], 'free', ['ceiling'], ['letters', 'wingspan', 'owlDrop', 'seed']],
      ['hp.signpost', 'Указатель', [1.0, 1.8, 0.12], 'uniform', ['floor', 'wall'], ['boards', 'boardColor', 'textColor', 'seed']],
      ['hp.hatLantern', 'Шляпа-фонарь', [0.36, 0.35, 0.36], 'uniform', ['surface', 'floor'], ['glowColor', 'glow', 'seed']],
      ['hp.wizardFrame', 'Фоторамка „Have you seen this wizard?“', [1.2, 1.9, 0.4], 'uniform', ['floor'], ['legs', 'title', 'plate', 'number']],
      ['hp.mandrakes', 'Мандрагоры и шляпа', [0.6, 0.4, 0.45], 'free', ['surface', 'floor'], ['pots', 'withHat', 'seed']],
      ['hp.dobby', 'Добби', [0.45, 1.0, 0.3], 'uniform', ['floor'], []],
      ['hp.owlCage', 'Сова в клетке', [0.32, 0.6, 0.32], 'uniform', ['surface', 'ceiling', 'floor'], ['bars', 'cageColor', 'withOwl']],
      ['hp.xmasTree', 'Ёлка 150 см', [0.8, 1.5, 0.8], 'uniform', ['floor'], ['tiers', 'lights', 'ornaments', 'star', 'seed']],
    ];
    expect(hpSet.items.map((item) => item.id)).toEqual(rows.map((row) => row[0]));
    for (const [id, title, size, resize, mounts, params] of rows) {
      const item = getItem(id);
      expect(item.kind, id).toBe('preset');
      expect(item.category, id).toBe('Гарри Поттер');
      expect({ title: item.title, size: item.size, resize: item.resize, mounts: item.mounts, params: item.params.map((def) => def.key) }, id).toEqual({
        title,
        size,
        resize,
        mounts,
        params,
      });
      expect(item.listed, id).not.toBe(false);
    }
    // Пределы размеров, опуск, нить, цвета — раздел 4.
    expect(getItem('hp.cloudCeiling').minSize).toEqual([1, 0.6, 1]);
    expect(getItem('hp.cloudCeiling').maxSize).toEqual([12, 2, 8]);
    expect(getItem('hp.cloudCeiling').hanger).toBe(false);
    expect(getItem('hp.cloudCeiling').defaultDrop ?? 0).toBe(0);
    expect(getItem('hp.prophetWall').maxSize).toEqual([6, 3, 0.06]);
    expect(getItem('hp.owlPost').minSize).toEqual([0.8, 0.8, 0.8]);
    expect(getItem('hp.owlPost').hanger).toBe(false);
    expect(getItem('hp.mandrakes').minSize).toEqual([0.3, 0.3, 0.25]);
    expect(getItem('hp.owlCage').defaultDrop).toBe(0.6);
    expect(getItem('hp.owlCage').hanger).toBe(true);
    expect(getItem('hp.dementor').color).toBe('#0b0b0f');
    expect(getItem('hp.wizardFrame').color).toBe('#cdb58a');
    expect(getItem('hp.dobby').color).toBe('#d9a98c');
    expect(getItem('hp.dobby').colorable).toBe(false);
    expect(getItem('hp.xmasTree').color).toBe('#2f5d34');
    // Умолчания параметров.
    expect(resolveParams(getItem('hp.cloudCeiling'), {})).toMatchObject({ thickness: 0.35, density: 12, glowColor: '#3fe0a8', glow: 1, candles: 2.5, hats: 2 });
    expect(resolveParams(getItem('hp.dementor'), {})).toMatchObject({ arms: 0.5, tatter: 0.6, hover: 0, showBase: true });
    expect(resolveParams(getItem('hp.prophetWall'), {})).toMatchObject({ density: 16, sheetScale: 1, tilt: 18, lang: 'ru' });
    expect(resolveParams(getItem('hp.owlPost'), {})).toMatchObject({ letters: 25, wingspan: 1.2, owlDrop: 0.25 });
    expect(resolveParams(getItem('hp.signpost'), {})).toMatchObject({
      boards: ['Хогвартс', 'Косой переулок', 'Хогсмид', 'Гринготтс', 'Азкабан', 'Министерство магии', 'Платформа 9¾', 'Хижина Хагрида'].join('\n'),
      boardColor: '#141414',
      textColor: '#f4f1ea',
    });
    expect(resolveParams(getItem('hp.hatLantern'), {})).toMatchObject({ glowColor: '#ffab3d', glow: 1 });
    expect(resolveParams(getItem('hp.wizardFrame'), {})).toEqual({ legs: 0.3, title: 'HAVE YOU SEEN THIS WIZARD?', plate: 'AZKABAN PRISON', number: 'ᛈᚹ390' });
    expect(resolveParams(getItem('hp.mandrakes'), {})).toMatchObject({ pots: 6, withHat: true });
    expect(resolveParams(getItem('hp.owlCage'), {})).toEqual({ bars: 20, cageColor: '#3a2a20', withOwl: true });
    expect(resolveParams(getItem('hp.xmasTree'), {})).toMatchObject({ tiers: 8, lights: true, ornaments: 0, star: false });
    const range = (id: string, key: string) => {
      const def = getItem(id).params.find((d) => d.key === key);
      return def?.type === 'number' ? [def.min, def.max] : undefined;
    };
    expect(range('hp.cloudCeiling', 'thickness')).toEqual([0.2, 0.6]);
    expect(range('hp.cloudCeiling', 'density')).toEqual([6, 20]);
    expect(range('hp.cloudCeiling', 'candles')).toEqual([0, 6]);
    expect(range('hp.cloudCeiling', 'hats')).toEqual([0, 8]);
    expect(range('hp.dementor', 'hover')).toEqual([0, 0.4]);
    expect(range('hp.prophetWall', 'density')).toEqual([6, 30]);
    expect(range('hp.prophetWall', 'sheetScale')).toEqual([0.7, 1.4]);
    expect(range('hp.prophetWall', 'tilt')).toEqual([0, 35]);
    expect(range('hp.owlPost', 'letters')).toEqual([5, 60]);
    expect(range('hp.owlPost', 'wingspan')).toEqual([0.8, 1.6]);
    expect(range('hp.owlPost', 'owlDrop')).toEqual([0.1, 0.6]);
    expect(range('hp.wizardFrame', 'legs')).toEqual([0, 0.6]);
    expect(range('hp.mandrakes', 'pots')).toEqual([3, 12]);
    expect(range('hp.owlCage', 'bars')).toEqual([12, 32]);
    expect(range('hp.xmasTree', 'tiers')).toEqual([5, 12]);
    expect(range('hp.xmasTree', 'ornaments')).toEqual([0, 40]);
    const lang = getItem('hp.prophetWall').params.find((d) => d.key === 'lang');
    expect(lang?.type === 'select' ? lang.options.map((o) => o.value) : []).toEqual(['ru', 'en']);
    const boards = getItem('hp.signpost').params.find((d) => d.key === 'boards');
    expect(boards?.type === 'text' && boards.multiline).toBe(true);
  });

  it('painters: имена с префиксом набора, каждое доступно через getPainter', () => {
    for (const set of catalogSets) {
      for (const name of Object.keys(set.painters ?? {})) {
        expect(name.includes('.'), name).toBe(true);
        expect(getPainter(name), name).toBe(set.painters?.[name]);
      }
    }
    expect(getPainter('no.such.painter')).toBeUndefined();
  });
});

// ---------- поиск записей ----------

describe('getItem / hasItem / listedItems / isSupport', () => {
  it('getItem никогда не бросает: неизвестный type → FALLBACK_ITEM', () => {
    for (const item of allItems) {
      expect(getItem(item.id)).toBe(item);
      expect(hasItem(item.id)).toBe(true);
    }
    for (const type of ['', 'no-such-type', 'hp.unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(getItem(type), type).toBe(FALLBACK_ITEM);
      expect(hasItem(type), type).toBe(false);
    }
    expect(getItem(FALLBACK_ITEM.id)).toBe(FALLBACK_ITEM);
  });

  it('FALLBACK_ITEM — серый ящик 0.5³, kind primitive, все крепления', () => {
    expect(FALLBACK_ITEM.kind).toBe('primitive');
    expect(FALLBACK_ITEM.size).toEqual([0.5, 0.5, 0.5]);
    expect([...FALLBACK_ITEM.mounts].sort()).toEqual([...MOUNTS].sort());
    expect(FALLBACK_ITEM.params).toEqual([]);
    expect(checkBuild(FALLBACK_ITEM, {})).toEqual([]);
    // Объект неизвестного типа рисуется ящиком своего размера и цвета.
    const parts = partsOf(objectOf('hp.unknown', { size: [1, 2, 3], color: '#123456' }));
    expect(parts).toEqual([{ shape: 'box', position: [0, 1, 0], size: [1, 2, 3], color: '#123456' }]);
  });

  it('listedItems — записи с listed !== false в порядке наборов', () => {
    const listed = listedItems();
    expect(listed).toEqual(allItems.filter((item) => item.listed !== false));
    const ids = listed.map((item) => item.id);
    for (const hidden of ['image', 'image.flat', 'model', 'duct', 'pendantBulbs', 'projector']) expect(ids).not.toContain(hidden);
    for (const shown of ['sofa', 'table', 'box', 'panel', 'light.point', 'light.spot', 'hp.dementor', 'hp.xmasTree']) expect(ids).toContain(shown);
    // Сначала весь basic, затем Гарри Поттер.
    expect(ids.indexOf('light.spot')).toBeLessThan(ids.indexOf('hp.cloudCeiling'));
    expect(ids.filter((id) => id.startsWith('hp.'))).toEqual(hpSet.items.map((item) => item.id));
  });

  it('isSupport: запись-опора, объект виден и стоит на полу', () => {
    expect(isSupport(objectOf('table'))).toBe(true);
    expect(isSupport(objectOf('highTable'))).toBe(true);
    expect(isSupport(objectOf('box'))).toBe(true);
    expect(isSupport(objectOf('cylinder'))).toBe(true);
    expect(isSupport(objectOf('sofaU'))).toBe(false);
    expect(isSupport(objectOf('sphere'))).toBe(false);
    expect(isSupport(objectOf('hp.unknown'))).toBe(false);
    expect(isSupport(objectOf('table', { visible: false }))).toBe(false);
    expect(isSupport(objectOf('box', { mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } }))).toBe(false);
    expect(isSupport(objectOf('box', { mount: { kind: 'surface', hostId: 'x', u: 0, v: 0 } }))).toBe(false);
    expect(isSupport(objectOf('box', { mount: { kind: 'wall', surfaceId: 'far', along: 1, bottom: 0 } }))).toBe(false);
    // Заблокированный стол остаётся опорой.
    expect(isSupport(objectOf('table', { locked: true }))).toBe(true);
  });

  it('catalogLookup — те же getItem и isSupport', () => {
    expect(catalogLookup.getItem).toBe(getItem);
    expect(catalogLookup.isSupport).toBe(isSupport);
    expect(catalogLookup.getItem('nope')).toBe(FALLBACK_ITEM);
  });
});

// ---------- параметры ----------

describe('resolveParams / buildInput', () => {
  const spot = getItem('light.spot');

  it('умолчания ParamDef, поверх — сохранённые значения', () => {
    expect(resolveParams(spot, {})).toEqual({ intensity: 40, distance: 8, angle: 30, penumbra: 0.5, tilt: 0 });
    expect(resolveParams(spot, { intensity: 70, tilt: 45 })).toEqual({ intensity: 70, distance: 8, angle: 30, penumbra: 0.5, tilt: 45 });
    expect(resolveParams(getItem('box'), {})).toEqual({});
  });

  it('числа зажаты в [min, max]', () => {
    expect(resolveParams(spot, { intensity: 1e6, distance: -3, angle: 5, penumbra: 7, tilt: 400 })).toEqual({
      intensity: 200,
      distance: 1,
      angle: 10,
      penumbra: 1,
      tilt: 90,
    });
    expect(resolveParams(getItem('pendantBulbs'), { count: 100 }).count).toBe(12);
    expect(resolveParams(getItem('pendantBulbs'), { count: 0 }).count).toBe(1);
  });

  it('неизвестные ключи сохраняются', () => {
    expect(resolveParams(spot, { custom: 'x', other: 3, flag: true })).toEqual({
      intensity: 40,
      distance: 8,
      angle: 30,
      penumbra: 0.5,
      tilt: 0,
      custom: 'x',
      other: 3,
      flag: true,
    });
    expect(resolveParams(getItem('box'), { anything: 1 })).toEqual({ anything: 1 });
  });

  it('значение не того типа → умолчание', () => {
    expect(resolveParams(spot, { intensity: 'много', distance: NaN, angle: Infinity, penumbra: true })).toEqual(resolveParams(spot, {}));
    const wall = getItem('hp.prophetWall');
    expect(resolveParams(wall, { lang: 'en' }).lang).toBe('en');
    expect(resolveParams(wall, { lang: 'de' }).lang).toBe('ru');
    expect(resolveParams(wall, { lang: 5 }).lang).toBe('ru');
    expect(resolveParams(getItem('image'), { glow: true }).glow).toBe(true);
    expect(resolveParams(getItem('image'), { glow: 'yes' }).glow).toBe(false);
    expect(resolveParams(getItem('hp.signpost'), { boards: 'А\nБ' }).boards).toBe('А\nБ');
    expect(resolveParams(getItem('hp.signpost'), { boards: 7 }).boards).toBe(resolveParams(getItem('hp.signpost'), {}).boards);
    expect(resolveParams(getItem('hp.hatLantern'), { glowColor: '#00ff00' }).glowColor).toBe('#00ff00');
    expect(resolveParams(getItem('hp.hatLantern'), { glowColor: 5 }).glowColor).toBe('#ffab3d');
    expect(resolveParams(getItem('pendantBulbs'), { seed: 7.9 }).seed).toBe(7);
    expect(resolveParams(getItem('pendantBulbs'), { seed: 'семь' }).seed).toBe(resolveParams(getItem('pendantBulbs'), {}).seed);
  });

  it('не мутирует вход и не протекает через прототип', () => {
    const saved = { intensity: 500 };
    resolveParams(spot, saved);
    expect(saved).toEqual({ intensity: 500 });
    const inherited = Object.create({ intensity: 100 }) as Record<string, number>;
    expect(resolveParams(spot, inherited).intensity).toBe(40);
  });

  it('buildInput: размер, цвет, слитые параметры и тип крепления объекта', () => {
    const o = objectOf('pendantBulbs', { size: [3, 1, 0.8], color: '#222222', params: { count: 50 }, mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } });
    expect(buildInput(o)).toEqual({ size: [3, 1, 0.8], color: '#222222', params: resolveParams(getItem('pendantBulbs'), { count: 50 }), mount: 'ceiling' });
    expect(buildInput(o).params.count).toBe(12);
  });
});

// ---------- билдеры ----------

describe('checkBuild', () => {
  it('пуст для КАЖДОЙ записи с build при умолчаниях (включая barrier — исключений нет)', () => {
    const built = allItems.filter((item) => item.build);
    expect(built.map((item) => item.id)).toContain('barrier');
    expect(built.length).toBeGreaterThanOrEqual(15 + 11);
    for (const item of built) expect(checkBuild(item, allPainters), item.id).toEqual([]);
    // Записи без build (свет, картинки, модель) — тоже без нарушений.
    for (const item of allItems.filter((i) => !i.build)) expect(checkBuild(item, allPainters), item.id).toEqual([]);
  });

  it('пуст на каждом допустимом креплении записи', () => {
    for (const item of allItems.filter((i) => i.build)) {
      for (const mount of item.mounts) expect(checkBuild(item, allPainters, { mount }), `${item.id} @ ${mount}`).toEqual([]);
    }
  });

  it('набор basic: пуст и при крайних размерах, которые пропускает clampSize, и при крайних параметрах', () => {
    for (const item of basicSet.items.filter((i) => i.build)) {
      const tiny = clampSize(item, item.size, [1e-6, 1e-6, 1e-6]);
      const huge = clampSize(item, item.size, [1e6, 1e6, 1e6]);
      const sizes: Vec3[] = [tiny, huge];
      if (item.resize === 'free') {
        sizes.push([huge[0], tiny[1], tiny[2]], [tiny[0], huge[1], tiny[2]], [tiny[0], tiny[1], huge[2]], [tiny[0], huge[1], huge[2]]);
      }
      for (const size of sizes) expect(checkBuild(item, allPainters, { size }), `${item.id} @ ${size.join(' × ')}`).toEqual([]);
    }
    const bulbs = getItem('pendantBulbs');
    for (const count of [1, 12]) {
      for (const seed of [0, 1, 2, 12345, -7]) {
        expect(checkBuild(bulbs, allPainters, { params: { count, seed } }), `count ${count}, seed ${seed}`).toEqual([]);
        expect(checkBuild(bulbs, allPainters, { params: { count, seed }, size: bulbs.minSize ?? [0.3, 0.2, 0.1] }), `мелкий, count ${count}, seed ${seed}`).toEqual([]);
      }
    }
  });

  it('набор basic: свойство — пуст при случайных допустимых размерах и параметрах', () => {
    const rng = createRng(2024);
    for (const item of basicSet.items.filter((i) => i.build)) {
      for (let n = 0; n < 300; n++) {
        // Логарифмически равномерно по всему диапазону [MIN_SIZE, MAX_SIZE] и за его краями; clampSize приводит к допустимому.
        const side = () => Math.exp(rng.range(Math.log(MIN_SIZE / 2), Math.log(MAX_SIZE * 1.25)));
        const size = clampSize(item, item.size, [side(), side(), side()]);
        const params: Params = item.id === 'pendantBulbs' ? { count: rng.int(1, 12), seed: rng.int(0, 99999) } : {};
        expect(checkBuild(item, allPainters, { size, params }), `${item.id} @ ${size.join(' × ')} ${JSON.stringify(params)}`).toEqual([]);
      }
    }
    // Регрессия: 12 ламп в габарите у́же одной лампы — ни одна не выходит за габарит даже без допуска.
    const bulbs = getItem('pendantBulbs');
    const narrow: Vec3 = [0.1, 3.7, 0.14];
    const parts = bulbs.build?.({ size: narrow, color: bulbs.color, params: resolveParams(bulbs, { count: 12 }), mount: 'ceiling' }) ?? [];
    for (const part of parts.filter((p) => !p.additive)) {
      const b = partBounds(part);
      expect(Math.abs(b.center[0]) + b.size[0] / 2).toBeLessThanOrEqual(narrow[0] / 2 + 1e-9);
      expect(Math.abs(b.center[2]) + b.size[2] / 2).toBeLessThanOrEqual(narrow[2] / 2 + 1e-9);
    }
  });

  it('билдеры детерминированы и не зависят от порядка вызовов; seed меняет раскладку', () => {
    const bulbs = getItem('pendantBulbs');
    const input = (seed: number) => ({ size: bulbs.size, color: bulbs.color, params: resolveParams(bulbs, { seed }), mount: 'ceiling' as const });
    const first = bulbs.build?.(input(1));
    bulbs.build?.(input(2));
    expect(bulbs.build?.(input(1))).toEqual(first);
    expect(bulbs.build?.(input(2))).not.toEqual(first);
    // count ламп = count сфер без ореола.
    const glowing = (first ?? []).filter((p) => p.shape === 'sphere' && !p.additive);
    expect(glowing).toHaveLength(5);
    for (const p of glowing) {
      expect(p.look).toBe('glow');
      expect(p.color).toBe('#ffd9a0');
    }
    expect((first ?? []).filter((p) => p.additive)).toHaveLength(5);
  });

  it('ограждение: габарит — настоящий след на полу, опоры длиной d', () => {
    const barrier = getItem('barrier');
    const [w, h, d] = barrier.size;
    const parts = barrier.build?.({ size: barrier.size, color: barrier.color, params: {}, mount: 'floor' }) ?? [];
    // Ни одна часть не выходит за габарит даже без допуска.
    for (const part of parts) {
      const b = partBounds(part);
      expect(Math.abs(b.center[0]) + b.size[0] / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(b.center[2]) + b.size[2] / 2).toBeLessThanOrEqual(d / 2 + 1e-9);
      expect(b.center[1] - b.size[1] / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(b.center[1] + b.size[1] / 2).toBeLessThanOrEqual(h + 1e-9);
    }
    // Опоры [0.06, 0.03, d]; перила — толщиной min(0.06, d); прутья — 0.02.
    expect(parts.filter((p) => p.size[0] === 0.06 && p.size[1] === 0.03 && p.size[2] === d)).toHaveLength(2);
    expect(parts.filter((p) => p.size[0] === w && p.size[2] === 0.06)).toHaveLength(2);
    expect(parts.filter((p) => p.size[0] === 0.02 && p.size[2] === 0.02).length).toBeGreaterThan(3);
  });

  it('находит нарушения: NaN, size ≤ 0, выход за габарит, недетерминизм, painter, число частей, исключение', () => {
    const base: CatalogItem = { ...getItem('box'), id: 'probe' };
    const withParts = (make: () => Part[]): CatalogItem => ({ ...base, build: make });
    const part = (over: Partial<Part>): Part => ({ shape: 'box', position: [0, 0.25, 0], size: [0.5, 0.5, 0.5], color: '#808080', ...over });

    expect(checkBuild(withParts(() => [part({})]), {})).toEqual([]);
    expect(checkBuild(withParts(() => [part({ position: [NaN, 0.25, 0] })]), {}).join('\n')).toMatch(/NaN/);
    expect(checkBuild(withParts(() => [part({ size: [0.5, Infinity, 0.5] })]), {}).length).toBeGreaterThan(0);
    expect(checkBuild(withParts(() => [part({ opacity: NaN })]), {}).length).toBeGreaterThan(0);
    expect(checkBuild(withParts(() => [part({ size: [0.5, 0, 0.5] })]), {}).join('\n')).toMatch(/size/);
    expect(checkBuild(withParts(() => [part({ size: [-0.1, 0.5, 0.5] })]), {}).length).toBeGreaterThan(0);
    // Плоскость: третья компонента 0 — норма; нулевая ширина — нарушение.
    expect(checkBuild(withParts(() => [part({ shape: 'plane', size: [0.4, 0.4, 0] })]), {})).toEqual([]);
    expect(checkBuild(withParts(() => [part({ shape: 'plane', size: [0, 0.4, 0] })]), {}).length).toBeGreaterThan(0);

    // Габарит: допуск 10 % размера + 2 см по каждой оси (для ящика 0.5 — 7 см).
    expect(checkBuild(withParts(() => [part({ position: [0.069, 0.25, 0] })]), {})).toEqual([]);
    expect(checkBuild(withParts(() => [part({ position: [0.071, 0.25, 0] })]), {}).join('\n')).toMatch(/габарит/);
    expect(checkBuild(withParts(() => [part({ position: [0, 0.25 - 0.071, 0] })]), {}).length).toBe(1);
    expect(checkBuild(withParts(() => [part({ position: [0, 0.25, -0.071] })]), {}).length).toBe(1);
    // Поворот учитывается: тот же ящик, повёрнутый на 45° вокруг Y, шире габарита.
    expect(checkBuild(withParts(() => [part({ rotation: [0, Math.PI / 4, 0] })]), {}).length).toBeGreaterThan(0);
    // Аддитивные части (ореолы) в проверке габарита не участвуют.
    expect(checkBuild(withParts(() => [part({ shape: 'sphere', size: [3, 3, 3], additive: true })]), {})).toEqual([]);

    // Повторная сборка должна быть deep-равна первой.
    let calls = 0;
    expect(checkBuild(withParts(() => [part({ position: [0.001 * calls++, 0.25, 0] })]), {}).join('\n')).toMatch(/повторн/);

    // paint.painter должен быть в painters.
    const painted = withParts(() => [part({ paint: { painter: 'probe.missing', px: [64, 64] } })]);
    expect(checkBuild(painted, {}).join('\n')).toMatch(/probe\.missing/);
    expect(checkBuild(painted, { 'probe.missing': () => undefined })).toEqual([]);
    // Имя, унаследованное от Object.prototype, painter'ом не считается.
    expect(checkBuild(withParts(() => [part({ paint: { painter: 'toString', px: [64, 64] } })]), {}).length).toBe(1);

    // Число частей: по умолчанию 900, либо maxParts.
    const many = (n: number) => withParts(() => Array.from({ length: n }, () => part({})));
    expect(checkBuild(many(900), {})).toEqual([]);
    expect(checkBuild(many(901), {}).length).toBe(1);
    expect(checkBuild(many(11), {}, undefined, 10).length).toBe(1);
    expect(checkBuild(many(950), {}, undefined, 950)).toEqual([]);

    // Исключение в build — нарушение, а не падение теста.
    expect(
      checkBuild(
        withParts(() => {
          throw new Error('сломано');
        }),
        {},
      ).join('\n'),
    ).toMatch(/сломано/);
    // Запись primitive / preset без build — нарушение.
    expect(checkBuild({ ...base, build: undefined }, {}).length).toBe(1);
  });

  it('overrides: размер, цвет, крепление и параметры (сливаются с умолчаниями и зажимаются)', () => {
    const seen: unknown[] = [];
    const probe: CatalogItem = {
      ...getItem('pendantBulbs'),
      id: 'probe',
      build: (input) => {
        seen.push(structuredClone(input));
        return [{ shape: 'box', position: [0, input.size[1] / 2, 0], size: input.size, color: input.color }];
      },
    };
    expect(checkBuild(probe, {})).toEqual([]);
    expect(seen[0]).toEqual({ size: probe.size, color: probe.color, params: resolveParams(probe, {}), mount: 'ceiling' });
    seen.length = 0;
    expect(checkBuild(probe, {}, { size: [1, 2, 3], color: '#abcdef', mount: 'floor', params: { count: 99 } })).toEqual([]);
    expect(seen[0]).toEqual({ size: [1, 2, 3], color: '#abcdef', params: { ...resolveParams(probe, {}), count: 12 }, mount: 'floor' });
  });
});

// ---------- части и боксы ----------

describe('partsOf', () => {
  it('части объекта = item.build(buildInput(o)); нет build → []', () => {
    const table = objectOf('table');
    expect(partsOf(table)).toEqual(getItem('table').build?.(buildInput(table)));
    expect(partsOf(table).length).toBeGreaterThan(0);
    expect(partsOf(objectOf('light.point'))).toEqual([]);
    expect(partsOf(objectOf('image'))).toEqual([]);
    expect(partsOf(objectOf('model'))).toEqual([]);
  });

  it('мемоизация: тот же ключ → тот же массив; ключ — type | size | color | params | mount.kind', () => {
    const a = objectOf('sofaU');
    const first = partsOf(a);
    // Другой объект с теми же данными (другие id, имя, место, угол) — тот же результат по ссылке.
    const twin = objectOf('sofaU', { id: 'other', name: 'Другое имя', rotationY: 1, mount: { kind: 'floor', x: 3, z: 2, lift: 0.1 }, locked: true });
    expect(partsOf(twin)).toBe(first);
    expect(partsOf({ ...a, size: [3, 0.85, 1.8] })).not.toBe(first);
    expect(partsOf({ ...a, color: '#111111' })).not.toBe(first);
    expect(partsOf(a)).toBe(first);

    const bulbs = objectOf('pendantBulbs', { mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } });
    const bulbParts = partsOf(bulbs);
    expect(partsOf({ ...bulbs, params: { seed: 5 } })).not.toBe(bulbParts);
    expect(partsOf({ ...bulbs, params: { seed: 5 } })).toBe(partsOf({ ...bulbs, params: { seed: 5 } }));
    // Смена типа крепления — другой ключ (билдер получает mount).
    const box = objectOf('box');
    expect(partsOf({ ...box, mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } })).not.toBe(partsOf(box));
  });

  it('LRU на 256 записей: вытесняется самая давняя, свежие остаются', () => {
    const box = objectOf('box');
    const sized = (i: number): SceneObject => ({ ...box, size: [1 + i / 1000, 0.5, 0.5] });
    const first = partsOf(sized(0));
    for (let i = 1; i <= 255; i++) partsOf(sized(i));
    // Запись 0 «освежается» обращением и переживает следующую вставку…
    expect(partsOf(sized(0))).toBe(first);
    const second = partsOf(sized(1));
    partsOf(sized(1000));
    partsOf(sized(1001));
    partsOf(sized(1002));
    expect(partsOf(sized(0))).toBe(first);
    expect(partsOf(sized(1))).toBe(second);
    // …а давно не тронутая запись вытеснена и строится заново (deep-равная, но другая по ссылке).
    const third = partsOf(sized(2));
    for (let i = 2000; i < 2300; i++) partsOf(sized(i));
    const rebuilt = partsOf(sized(2));
    expect(rebuilt).not.toBe(third);
    expect(rebuilt).toEqual(third);
  });
});

describe('objectBox / partBounds', () => {
  it('objectBox: center [0, h/2, 0], size', () => {
    expect(objectBox({ size: [2, 1, 0.5] })).toEqual({ center: [0, 0.5, 0], size: [2, 1, 0.5] });
  });

  it('без поворота: бокс, плоскость, цилиндр, сфера, тор', () => {
    const at: Vec3 = [1, 2, 3];
    expectBox(partBounds({ shape: 'box', position: at, size: [1, 2, 3], color: '#000000' }), at, [1, 2, 3]);
    expectBox(partBounds({ shape: 'plane', position: at, size: [1, 2, 0], color: '#000000' }), at, [1, 2, 0]);
    expectBox(partBounds({ shape: 'cylinder', position: at, size: [1, 2, 3], color: '#000000' }), at, [1, 2, 3]);
    expectBox(partBounds({ shape: 'sphere', position: at, size: [1, 2, 3], color: '#000000' }), at, [1, 2, 3]);
    // Тор [D, D, t]: кольцо в плоскости XY, по оси Z — толщина трубки.
    expectBox(partBounds({ shape: 'torus', position: at, size: [1, 1, 0.1], color: '#000000' }), at, [1, 1, 0.1]);
  });

  it('цилиндр: taper < 1 не выходит за нижний диаметр, taper > 1 — поперечник = диаметр × taper', () => {
    const cyl = (taper: number): Part => ({ shape: 'cylinder', position: [0, 0, 0], size: [0.2, 0.5, 0.4], color: '#000000', taper });
    expectBox(partBounds(cyl(0)), [0, 0, 0], [0.2, 0.5, 0.4]);
    expectBox(partBounds(cyl(0.6)), [0, 0, 0], [0.2, 0.5, 0.4]);
    expectBox(partBounds(cyl(1.3)), [0, 0, 0], [0.26, 0.5, 0.52]);
  });

  it('поворот учитывается (Эйлер XYZ)', () => {
    const q = Math.PI / 2;
    // Бокс 1 × 2 × 3, повёрнутый на 90° вокруг каждой оси.
    const box = (rotation: Vec3): Part => ({ shape: 'box', position: [0, 0, 0], size: [1, 2, 3], color: '#000000', rotation });
    expectBox(partBounds(box([q, 0, 0])), [0, 0, 0], [1, 3, 2]);
    expectBox(partBounds(box([0, q, 0])), [0, 0, 0], [3, 2, 1]);
    expectBox(partBounds(box([0, 0, q])), [0, 0, 0], [2, 1, 3]);
    // 45° вокруг Y: проекции складываются.
    expectBox(partBounds(box([0, Math.PI / 4, 0])), [0, 0, 0], [4 * Math.SQRT1_2, 2, 4 * Math.SQRT1_2]);
    // Цилиндр, положенный вдоль X (как воздуховод) и вдоль Z (как объектив проектора).
    const cyl = (rotation: Vec3): Part => ({ shape: 'cylinder', position: [0, 0, 0], size: [0.4, 5, 0.4], color: '#000000', rotation });
    expectBox(partBounds(cyl([0, 0, q])), [0, 0, 0], [5, 0.4, 0.4]);
    expectBox(partBounds(cyl([q, 0, 0])), [0, 0, 0], [0.4, 0.4, 5]);
    // Сфера-шар от поворота не зависит, эллипсоид — поворачивается.
    expectBox(partBounds({ shape: 'sphere', position: [0, 0, 0], size: [1, 1, 1], color: '#000000', rotation: [0.3, 0.7, 1.1] }), [0, 0, 0], [1, 1, 1]);
    expectBox(partBounds({ shape: 'sphere', position: [0, 0, 0], size: [1, 2, 3], color: '#000000', rotation: [0, 0, q] }), [0, 0, 0], [2, 1, 3]);
    // Тор, положенный горизонтально (поворот на 90° вокруг X): кольцо в плоскости XZ.
    expectBox(partBounds({ shape: 'torus', position: [0, 0, 0], size: [1, 1, 0.1], color: '#000000', rotation: [q, 0, 0] }), [0, 0, 0], [1, 0.1, 1]);
    // Плоскость, положенная на пол.
    expectBox(partBounds({ shape: 'plane', position: [0, 0, 0], size: [1, 2, 0], color: '#000000', rotation: [-q, 0, 0] }), [0, 0, 0], [1, 0, 2]);
  });

  it('порядок Эйлера — XYZ (как у three.js): сначала вокруг Z, затем Y, затем X в мировых осях', () => {
    const q = Math.PI / 2;
    // R = Rx(90°) · Ry(90°): локальный X → мировой Y, локальный Y → мировой −Z... проверяем по габариту вытянутого бокса.
    const b = partBounds({ shape: 'box', position: [0, 0, 0], size: [1, 2, 3], color: '#000000', rotation: [q, q, 0] });
    // Локальные оси (X = 1, Y = 2, Z = 3): Ry переводит Z → X, X → −Z; затем Rx переводит Y → Z, Z → −Y.
    // Итог: локальный Z (3) — вдоль мирового X; локальный X (1) — вдоль мирового Y; локальный Y (2) — вдоль мирового Z.
    expectBox(b, [0, 0, 0], [3, 1, 2]);
  });
});

describe('pickBoxes', () => {
  it('П-образный диван: середина пуста, сиденья и спинка — нет', () => {
    const sofa = objectOf('sofaU');
    const [w, h, d] = sofa.size;
    const boxes = pickBoxes(sofa);
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes).toEqual(partsOf(sofa).map(partBounds));
    const hit = (p: Vec3) => boxes.some((box) => contains(box, p));
    // Там, где внутри кабинки стоит стол, боксов нет — клик проходит к столу.
    expect(hit([0, 0.3, 0.3])).toBe(false);
    expect(hit([0, 0.05, d / 2 - 0.05])).toBe(false);
    expect(hit([0.3, h - 0.05, 0.5])).toBe(false);
    expect(hit([-0.3, 0.4, 0.1])).toBe(false);
    // Спинка, заднее сиденье, боковины и боковые сиденья — попадание.
    expect(hit([0, h - 0.05, -d / 2 + 0.05])).toBe(true);
    expect(hit([0, 0.2, -d / 2 + 0.4])).toBe(true);
    expect(hit([w / 2 - 0.05, h - 0.05, 0])).toBe(true);
    expect(hit([-w / 2 + 0.05, h - 0.05, 0])).toBe(true);
    expect(hit([w / 2 - 0.5, 0.2, d / 2 - 0.3])).toBe(true);
    expect(hit([-w / 2 + 0.5, 0.2, d / 2 - 0.3])).toBe(true);
    // Габаритный бокс середину «съел» бы.
    expect(contains(objectBox(sofa), [0, 0.3, 0.3])).toBe(true);
  });

  it('аддитивные части (ореолы) в выбор не попадают', () => {
    const bulbs = objectOf('pendantBulbs', { mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } });
    const solid = partsOf(bulbs).filter((part) => !part.additive);
    expect(solid.length).toBeLessThan(partsOf(bulbs).length);
    expect(pickBoxes(bulbs)).toEqual(solid.map(partBounds));
  });

  it('нет частей → габаритный бокс; мемоизация тем же ключом, что partsOf', () => {
    const lamp = objectOf('light.point');
    expect(pickBoxes(lamp)).toEqual([objectBox(lamp)]);
    const picture = objectOf('image', { size: [1.2, 0.8, 0.02] });
    expect(pickBoxes(picture)).toEqual([{ center: [0, 0.4, 0], size: [1.2, 0.8, 0.02] }]);
    expect(pickBoxes(lamp)).toBe(pickBoxes({ ...lamp, id: 'other', rotationY: 2 }));
    expect(pickBoxes(picture)).not.toBe(pickBoxes({ ...picture, size: [1, 1, 0.02] }));
  });

  it('набор ГП: у каждой записи на её креплении по умолчанию есть хотя бы один конечный бокс', () => {
    for (const item of hpSet.items) {
      const o = objectOf(item.id, { mount: mountOf(item.mounts[0]) });
      const boxes = pickBoxes(o);
      expect(boxes.length, item.id).toBeGreaterThanOrEqual(1);
      for (const box of boxes) {
        for (const value of [...box.center, ...box.size]) expect(Number.isFinite(value), item.id).toBe(true);
      }
    }
  });
});

// ---------- галерея ----------

describe('galleryObjects', () => {
  function galleryLayout(room: RoomDef): Layout {
    return { ...createLayout(room), objects: galleryObjects(room) };
  }

  it('по одному объекту каждой записи каталога на её креплении по умолчанию', () => {
    const objects = galleryObjects(testRoom);
    expect(objects).toHaveLength(allItems.length);
    expect(objects.map((o) => o.type).sort()).toEqual(allItems.map((item) => item.id).sort());
    expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    for (const o of objects) {
      const item = getItem(o.type);
      expect(o.id, o.type).toMatch(LAYOUT_PATTERNS.id);
      expect(o.kind, o.type).toBe(item.kind);
      expect(o.origin, o.type).toBe('user');
      expect(o.size, o.type).toEqual(item.size);
      expect(o.color, o.type).toBe(item.color);
      expect(o.name, o.type).toBe(item.title);
      expect(o.mount.kind, o.type).toBe(item.mounts[0]);
      if (o.mount.kind === 'ceiling') expect(o.mount.drop, o.type).toBe(item.defaultDrop ?? 0);
    }
  });

  it('детерминированы и не разделяют данных с каталогом', () => {
    const first = galleryObjects(testRoom);
    expect(galleryObjects(testRoom)).toEqual(first);
    for (const o of first) expect(o.size, o.type).not.toBe(getItem(o.type).size);
  });

  it('проходят sanitizeLayout без изменений', () => {
    const layout = galleryLayout(testRoom);
    expect(sanitizeLayout(layout, testRoom)).toBe(layout);
  });

  it('настольные предметы стоят на опорах из самой галереи, по одному на опору', () => {
    const objects = galleryObjects(testRoom);
    const hosts: string[] = [];
    for (const o of objects) {
      if (o.mount.kind !== 'surface') continue;
      const hostId = o.mount.hostId;
      const host = objects.find((x) => x.id === hostId);
      expect(host && isSupport(host), o.type).toBe(true);
      hosts.push(hostId);
    }
    expect(hosts.length).toBe(allItems.filter((item) => item.mounts[0] === 'surface').length);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('в любом помещении — без стен и колонн, тесном, огромном — остаются чистыми', () => {
    const rooms: RoomDef[] = [
      { ...testRoom, walls: [], columns: [], platforms: [], fixtures: [] },
      { ...testRoom, size: { length: 1, width: 1, height: 0.3 }, fixtures: [] },
      { ...testRoom, size: { length: 3, width: 2, height: 2 }, walls: testRoom.walls.slice(0, 1), fixtures: [] },
      { ...testRoom, size: { length: 60, width: 40, height: 9 } },
    ];
    for (const room of rooms) {
      const note = `${room.size.length} × ${room.size.width} × ${room.size.height}`;
      const layout = galleryLayout(room);
      expect(layout.objects, note).toHaveLength(allItems.length);
      expect(sanitizeLayout(layout, room) === layout, note).toBe(true);
    }
  });

  it('то же для lounge — только утверждения, выведенные из его данных', () => {
    const layout = galleryLayout(lounge);
    expect(layout.objects).toHaveLength(allItems.length);
    expect(sanitizeLayout(layout, lounge)).toBe(layout);
    for (const o of layout.objects) {
      if (o.mount.kind === 'floor' || o.mount.kind === 'ceiling') {
        expect(Math.abs(o.mount.x), o.type).toBeLessThanOrEqual(lounge.size.length / 2);
        expect(Math.abs(o.mount.z), o.type).toBeLessThanOrEqual(lounge.size.width / 2);
      }
    }
  });
});
