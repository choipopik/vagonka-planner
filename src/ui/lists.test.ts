import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import type { Mount, SceneObject } from '../model/types';
import { buildObjectList, groupLibrary, stableObjectList } from './lists';

const FLOOR: Mount = { kind: 'floor', x: 0, z: 0, lift: 0 };

function object(id: string, origin: 'user' | 'venue', mount: Mount = FLOOR): SceneObject {
  return {
    id,
    kind: 'primitive',
    type: 'box',
    origin,
    name: id,
    mount,
    rotationY: 0,
    size: [0.5, 0.5, 0.5],
    color: '#b8b2a7',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
  };
}

function on(hostId: string): Mount {
  return { kind: 'surface', hostId, u: 0, v: 0 };
}

describe('buildObjectList', () => {
  it('делит объекты на декор и мебель площадки в порядке макета', () => {
    const model = buildObjectList([object('sofa', 'venue'), object('box', 'user'), object('table', 'venue'), object('lamp', 'user')]);
    expect(model.decor.map((r) => r.id)).toEqual(['box', 'lamp']);
    expect(model.venue.map((r) => r.id)).toEqual(['sofa', 'table']);
    expect([...model.decor, ...model.venue].every((r) => r.depth === 0 && r.hostId === null)).toBe(true);
  });

  it('стоящий на хозяине из своей группы идёт сразу под ним с отступом', () => {
    const model = buildObjectList([
      object('lantern', 'user', on('crate')),
      object('other', 'user'),
      object('crate', 'user'),
      object('candle', 'user', on('crate')),
    ]);
    expect(model.decor).toEqual([
      { id: 'other', depth: 0, hostId: null },
      { id: 'crate', depth: 0, hostId: null },
      { id: 'lantern', depth: 1, hostId: null },
      { id: 'candle', depth: 1, hostId: null },
    ]);
  });

  it('декор на столе площадки остаётся в «Декоре» с ссылкой на хозяина', () => {
    const model = buildObjectList([object('table', 'venue'), object('lantern', 'user', on('table'))]);
    expect(model.decor).toEqual([{ id: 'lantern', depth: 0, hostId: 'table' }]);
    expect(model.venue).toEqual([{ id: 'table', depth: 0, hostId: null }]);
  });

  it('битые ссылки не прячут объект', () => {
    const model = buildObjectList([
      object('orphan', 'user', on('missing')),
      object('self', 'user', on('self')),
      object('a', 'user', on('b')),
      object('b', 'user', on('a')),
    ]);
    expect(model.decor.map((r) => r.id).sort()).toEqual(['a', 'b', 'orphan', 'self']);
    expect(model.decor.every((r) => r.depth === 0 && r.hostId === null)).toBe(true);
  });

  it('каждый объект встречается ровно один раз, дубликат id — один раз', () => {
    const objects = [
      object('t1', 'venue'),
      object('x', 'user', on('t1')),
      object('c', 'user'),
      object('y', 'user', on('c')),
      object('c', 'user'),
      object('v', 'venue', on('t1')),
    ];
    const model = buildObjectList(objects);
    const ids = [...model.decor, ...model.venue].map((r) => r.id).sort();
    expect(ids).toEqual(['c', 't1', 'v', 'x', 'y']);
    expect(model.venue).toEqual([
      { id: 't1', depth: 0, hostId: null },
      { id: 'v', depth: 1, hostId: null },
    ]);
  });
});

describe('stableObjectList', () => {
  it('тот же массив → тот же результат', () => {
    const objects = [object('a', 'user'), object('t', 'venue')];
    expect(stableObjectList(objects)).toBe(stableObjectList(objects));
  });

  it('новый массив с той же структурой сохраняет ссылки', () => {
    const first = stableObjectList([object('a', 'user'), object('t', 'venue')]);
    const moved = stableObjectList([object('a', 'user', { kind: 'floor', x: 2, z: 1, lift: 0 }), object('t', 'venue')]);
    expect(moved).toBe(first);
  });

  it('изменилась одна группа — вторая сохраняет ссылку', () => {
    const first = stableObjectList([object('a', 'user'), object('t', 'venue')]);
    const added = stableObjectList([object('a', 'user'), object('t', 'venue'), object('b', 'user')]);
    expect(added).not.toBe(first);
    expect(added.venue).toBe(first.venue);
    expect(added.decor.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('смена хозяина меняет структуру', () => {
    const first = stableObjectList([object('t', 'user'), object('a', 'user')]);
    const placed = stableObjectList([object('t', 'user'), object('a', 'user', on('t'))]);
    expect(placed.decor).not.toBe(first.decor);
    expect(placed.decor[1]).toEqual({ id: 'a', depth: 1, hostId: null });
  });
});

function item(id: string, title: string, category: string, hint?: string): CatalogItem {
  return { id, kind: 'primitive', title, category, hint, size: [1, 1, 1], resize: 'free', color: '#ffffff', mounts: ['floor'], params: [] };
}

describe('groupLibrary', () => {
  const items = [
    item('sofa', 'Диван', 'Мебель'),
    item('box', 'Ящик', 'Фигуры'),
    item('table', 'Стол', 'Мебель', 'на него ставят декор'),
    item('hp.tree', 'Ёлка', 'Гарри Поттер', 'с гирляндой'),
  ];

  it('без запроса — все записи, группы в порядке первого появления', () => {
    const groups = groupLibrary(items, '  ');
    expect(groups.map((g) => g.category)).toEqual(['Мебель', 'Фигуры', 'Гарри Поттер']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['sofa', 'table']);
  });

  it('ищет без учёта регистра по названию, подсказке и категории', () => {
    expect(groupLibrary(items, 'ДИВ').flatMap((g) => g.items.map((i) => i.id))).toEqual(['sofa']);
    expect(groupLibrary(items, 'декор').flatMap((g) => g.items.map((i) => i.id))).toEqual(['table']);
    expect(groupLibrary(items, 'мебель').flatMap((g) => g.items.map((i) => i.id))).toEqual(['sofa', 'table']);
  });

  it('«ё» и «е» равны, все слова запроса обязательны', () => {
    expect(groupLibrary(items, 'елка').flatMap((g) => g.items.map((i) => i.id))).toEqual(['hp.tree']);
    expect(groupLibrary(items, 'поттер гирлянд').flatMap((g) => g.items.map((i) => i.id))).toEqual(['hp.tree']);
    expect(groupLibrary(items, 'поттер диван')).toEqual([]);
  });

  it('пустые группы не возвращаются', () => {
    expect(groupLibrary(items, 'ящик').map((g) => g.category)).toEqual(['Фигуры']);
    expect(groupLibrary(items, 'нет такого')).toEqual([]);
  });
});
