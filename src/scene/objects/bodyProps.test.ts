import { describe, expect, it } from 'vitest';
import type { SceneObject } from '../../model/types';
import { dropOf, sameBody } from './bodyProps';

function obj(over: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'o1',
    kind: 'primitive',
    type: 'box',
    origin: 'user',
    name: 'Ящик',
    mount: { kind: 'floor', x: 0, z: 0, lift: 0 },
    rotationY: 0,
    size: [0.5, 0.5, 0.5],
    color: '#808080',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

describe('sameBody: тело не пересобирается, пока объект только перемещается', () => {
  const params = { text: 'Разыскивается' };
  const base = obj({ params });

  it('та же ссылка на объект → без пересборки', () => {
    expect(sameBody({ object: base, ghost: false }, { object: base, ghost: false })).toBe(true);
  });

  it('перемещение, поворот, имя, блокировка тело не меняют', () => {
    const moved = obj({ params, mount: { kind: 'floor', x: 3, z: -2, lift: 0.4 } });
    const turned = obj({ params, rotationY: 1.2 });
    const renamed = obj({ params, name: 'Другое имя', locked: true });
    for (const next of [moved, turned, renamed]) {
      expect(sameBody({ object: base, ghost: false }, { object: next, ghost: false })).toBe(true);
    }
  });

  it('размер сравнивается по значениям, а не по ссылке на массив', () => {
    expect(sameBody({ object: base, ghost: false }, { object: obj({ params, size: [0.5, 0.5, 0.5] }), ghost: false })).toBe(true);
    expect(sameBody({ object: base, ghost: false }, { object: obj({ params, size: [0.5, 0.6, 0.5] }), ghost: false })).toBe(false);
  });

  it('type, color, assetId, params, вид крепления и призрак — пересборка', () => {
    const changes: Partial<SceneObject>[] = [
      { type: 'cylinder' },
      { color: '#ff0000' },
      { assetId: 'a_00000000000000000000000000000000' },
      { params: { text: 'Другое' } },
      { mount: { kind: 'ceiling', x: 0, z: 0, drop: 0 } },
      { id: 'o2' },
    ];
    for (const change of changes) {
      expect(sameBody({ object: base, ghost: false }, { object: obj({ params, ...change }), ghost: false })).toBe(false);
    }
    expect(sameBody({ object: base, ghost: false }, { object: base, ghost: true })).toBe(false);
  });

  it('опуск от потолка меняет длину нитей → пересборка; сдвиг под потолком — нет', () => {
    const hung = obj({ mount: { kind: 'ceiling', x: 0, z: 0, drop: 0.4 }, params });
    const lower = obj({ mount: { kind: 'ceiling', x: 0, z: 0, drop: 0.8 }, params });
    const aside = obj({ mount: { kind: 'ceiling', x: 2, z: 1, drop: 0.4 }, params });
    expect(sameBody({ object: hung, ghost: false }, { object: lower, ghost: false })).toBe(false);
    expect(sameBody({ object: hung, ghost: false }, { object: aside, ghost: false })).toBe(true);
  });
});

describe('dropOf', () => {
  it('опуск есть только у потолочного крепления', () => {
    expect(dropOf(obj({ mount: { kind: 'ceiling', x: 0, z: 0, drop: 0.35 } }))).toBe(0.35);
    expect(dropOf(obj())).toBe(0);
    expect(dropOf(obj({ mount: { kind: 'wall', surfaceId: 'w', along: 1, bottom: 1 } }))).toBe(0);
    expect(dropOf(obj({ mount: { kind: 'surface', hostId: 'h', u: 0, v: 0 } }))).toBe(0);
  });
});
