import { describe, expect, it } from 'vitest';
import { wallSurfaces } from './geometry';
import {
  GHOST_OPACITY,
  backSurfaces,
  isGhosted,
  isOnBackSurface,
  isPickable,
  isViewFromAbove,
  layerView,
} from './layers';
import type { LayerView } from './layers';
import { testRoom } from './testRoom';
import type { CameraMode, LayerMode, Mount, SceneObject } from './types';

function obj(id: string, mount: Mount, over: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    kind: 'primitive',
    type: 'box',
    origin: 'user',
    name: id,
    mount,
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

const onFloor = obj('floor', { kind: 'floor', x: 0, z: 0, lift: 0 });
const onTable = obj('table-top', { kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });
const onCeiling = obj('ceiling', { kind: 'ceiling', x: 0, z: 0, drop: 0 });
const onNearWall = obj('near-poster', { kind: 'wall', surfaceId: 'near', along: 3, bottom: 1 });
const onFarWall = obj('far-poster', { kind: 'wall', surfaceId: 'far', along: 3, bottom: 1 });
const all = [onFloor, onTable, onCeiling, onNearWall, onFarWall];

const surfaces = wallSurfaces(testRoom);

describe('isViewFromAbove', () => {
  it('top → true; orbit → камера выше потолка; walk → false', () => {
    const H = testRoom.size.height;
    expect(isViewFromAbove('top', 0, H)).toBe(true);
    expect(isViewFromAbove('orbit', H + 0.01, H)).toBe(true);
    expect(isViewFromAbove('orbit', H, H)).toBe(false);
    expect(isViewFromAbove('orbit', 1.6, H)).toBe(false);
    expect(isViewFromAbove('walk', 100, H)).toBe(false);
  });
});

describe('layerView', () => {
  it('таблица истинности', () => {
    const table: [LayerMode, CameraMode, boolean, LayerView][] = [
      // прогулка — всегда both
      ['auto', 'walk', false, 'both'],
      ['auto', 'walk', true, 'both'],
      ['floor', 'walk', false, 'both'],
      ['ceiling', 'walk', true, 'both'],
      // облёт
      ['auto', 'orbit', false, 'both'],
      ['auto', 'orbit', true, 'floor'],
      ['floor', 'orbit', false, 'floor'],
      ['floor', 'orbit', true, 'floor'],
      ['ceiling', 'orbit', false, 'ceiling'],
      ['ceiling', 'orbit', true, 'ceiling'],
      // план
      ['auto', 'top', true, 'floor'],
      ['floor', 'top', true, 'floor'],
      ['ceiling', 'top', true, 'ceiling'],
    ];
    for (const [layer, mode, above, expected] of table) {
      expect(layerView(layer, mode, above), `${layer} / ${mode} / ${above}`).toBe(expected);
    }
  });
});

describe('backSurfaces', () => {
  it('камера облёта снаружи за ближней стеной → её id и дальние грани колонны', () => {
    // Камера за стеной 'near' (z = +3), чуть правее колонны (2, 0): ей не видны северная и западная грани.
    const back = backSurfaces('orbit', [3, 4, 9], surfaces);
    expect(back).toEqual(['near', 'col:n', 'col:w']);
    // Ровно по оси колонны обе боковые грани видны «с ребра» — камера за плоскостью каждой из них.
    expect(backSurfaces('orbit', [2, 4, 9], surfaces)).toEqual(['near', 'col:n', 'col:e', 'col:w']);
  });

  it('камера снаружи по диагонали → обе ближние стены и две дальние грани колонны', () => {
    const back = backSurfaces('orbit', [12, 6, 10], surfaces);
    expect(back).toEqual(['right', 'near', 'col:n', 'col:w']);
  });

  it('камера внутри помещения → только дальние грани колонны', () => {
    // Севернее и западнее колонны: её южная и восточная грани повёрнуты к камере спиной.
    expect(backSurfaces('orbit', [0, 1.6, -2], surfaces)).toEqual(['col:e', 'col:s']);
    // Южнее и восточнее — наоборот, северная и западная.
    expect(backSurfaces('orbit', [4, 1.6, 2], surfaces)).toEqual(['col:n', 'col:w']);
    // Ни одна стена помещения изнутри не попадает в список.
    for (const camera of [[0, 1.6, -2], [4, 1.6, 2], [-4.9, 0.5, 2.9]] as const) {
      const back = backSurfaces('orbit', [camera[0], camera[1], camera[2]], surfaces);
      expect(back.every((id) => id.startsWith('col:'))).toBe(true);
    }
  });

  it('top и walk → пусто', () => {
    expect(backSurfaces('top', [2, 20, 9], surfaces)).toEqual([]);
    expect(backSurfaces('walk', [2, 1.6, 9], surfaces)).toEqual([]);
  });

  it('порядок — как в surfaces', () => {
    const reversed = surfaces.slice().reverse();
    const back = backSurfaces('orbit', [12, 6, 10], reversed);
    expect(back).toEqual(['col:w', 'col:n', 'near', 'right']);
  });
});

describe('isOnBackSurface / isGhosted', () => {
  const back = ['near', 'col:n'];

  it('isOnBackSurface — только настенный объект на такой поверхности', () => {
    expect(isOnBackSurface(onNearWall, back)).toBe(true);
    expect(isOnBackSurface(onFarWall, back)).toBe(false);
    expect(isOnBackSurface(onFloor, back)).toBe(false);
    expect(isOnBackSurface(onCeiling, back)).toBe(false);
    expect(isOnBackSurface(onTable, back)).toBe(false);
    expect(isOnBackSurface(onNearWall, [])).toBe(false);
  });

  it('потолочный — призрак при view floor; напольный и настольный — никогда', () => {
    const views: LayerView[] = ['both', 'floor', 'ceiling'];
    for (const view of views) {
      expect(isGhosted(onCeiling, view, [], null), view).toBe(view === 'floor');
      expect(isGhosted(onFloor, view, [], null), view).toBe(false);
      expect(isGhosted(onTable, view, [], null), view).toBe(false);
      expect(isGhosted(onFarWall, view, [], null), view).toBe(false);
    }
  });

  it('настенный на поверхности «со спины» — призрак при любом слое; потолочный и напольный от back не зависят', () => {
    const views: LayerView[] = ['both', 'floor', 'ceiling'];
    for (const view of views) {
      expect(isGhosted(onNearWall, view, back, null), view).toBe(true);
      expect(isGhosted(onFarWall, view, back, null), view).toBe(false);
      expect(isGhosted(onFloor, view, back, null), view).toBe(isGhosted(onFloor, view, [], null));
      expect(isGhosted(onCeiling, view, back, null), view).toBe(isGhosted(onCeiling, view, [], null));
    }
  });

  it('выбранный объект никогда не призрак', () => {
    expect(isGhosted(onCeiling, 'floor', back, 'ceiling')).toBe(false);
    expect(isGhosted(onNearWall, 'both', back, 'near-poster')).toBe(false);
    // Выбран другой объект — правило прежнее.
    expect(isGhosted(onCeiling, 'floor', back, 'floor')).toBe(true);
  });

  it('GHOST_OPACITY — одна константа', () => {
    expect(GHOST_OPACITY).toBe(0.3);
  });
});

describe('isPickable', () => {
  it('таблица по слоям (ничего не выбрано, back пуст)', () => {
    const expected: Record<LayerView, string[]> = {
      both: ['floor', 'table-top', 'ceiling', 'near-poster', 'far-poster'],
      floor: ['floor', 'table-top', 'near-poster', 'far-poster'],
      ceiling: ['ceiling'],
    };
    for (const view of ['both', 'floor', 'ceiling'] as const) {
      expect(all.filter((o) => isPickable(o, view, [], null)).map((o) => o.id), view).toEqual(expected[view]);
    }
  });

  it('настенный на поверхности «со спины» не выбирается, пока не выбран', () => {
    const back = ['near'];
    expect(isPickable(onNearWall, 'both', back, null)).toBe(false);
    expect(isPickable(onNearWall, 'floor', back, null)).toBe(false);
    expect(isPickable(onNearWall, 'both', back, 'near-poster')).toBe(true);
    expect(isPickable(onFarWall, 'both', back, null)).toBe(true);
    // Потолочный и напольный от back не зависят.
    expect(isPickable(onFloor, 'both', back, null)).toBe(true);
    expect(isPickable(onCeiling, 'both', back, null)).toBe(true);
    expect(isPickable(onCeiling, 'floor', back, null)).toBe(false);
  });

  it('выбранный доступен в любом слое', () => {
    expect(isPickable(onCeiling, 'floor', [], 'ceiling')).toBe(true);
    expect(isPickable(onFloor, 'ceiling', [], 'floor')).toBe(true);
  });

  it('заблокированный и скрытый не выбираются даже будучи выбранными', () => {
    const locked = { ...onFloor, locked: true };
    const hidden = { ...onFloor, visible: false };
    for (const view of ['both', 'floor', 'ceiling'] as const) {
      expect(isPickable(locked, view, [], null)).toBe(false);
      expect(isPickable(locked, view, [], locked.id)).toBe(false);
      expect(isPickable(hidden, view, [], null)).toBe(false);
      expect(isPickable(hidden, view, [], hidden.id)).toBe(false);
    }
  });
});
