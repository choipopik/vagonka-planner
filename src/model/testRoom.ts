import type { RoomDef, SceneObject, Vec2, Vec3 } from './types';

const WALL = { lowerColor: '#7d2b26', upperColor: '#d9d5d0', splitHeight: 2.2 };

function venue(id: string, type: string, name: string, at: Vec2, size: Vec3, rotationY = 0): SceneObject {
  return {
    id: `venue-${id}`,
    kind: 'primitive',
    type,
    origin: 'venue',
    name,
    mount: { kind: 'floor', x: at[0], z: at[1], lift: 0 },
    rotationY,
    size,
    color: '#8a8378',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
  };
}

/**
 * 10 × 6 × 3 м. Стены 'far' (z = −3), 'right' (x = +5), 'near' (z = +3), 'left' (x = −5) — `from` слева при взгляде
 * изнутри, как в lounge. Колонна 'col' в (2, 0), размер 0.8 × 0.6. Подиум 'podium': min (−5, −3), max (0, −1), высота 0.2.
 * Панелей и заливок нет. Мебель (origin 'venue', крепление floor, lift 0, rotationY 0, если не сказано иное):
 *   'venue-table'  type 'table'  в (−2, 1),   размер 1.1 × 0.75 × 0.7
 *   'venue-table2' type 'table'  в (−2, −2),  размер 1.0 × 0.75 × 0.6, rotationY π/2   (стоит на подиуме)
 *   'venue-sofa'   type 'sofaU'  в (−2, 1.3), размер 2.8 × 0.85 × 1.8, rotationY π    (кабинка вокруг 'venue-table')
 * spawn: (3, 2), yaw 0.
 */
export const testRoom: RoomDef = {
  id: 'test',
  name: 'Тестовое помещение',
  size: { length: 10, width: 6, height: 3 },
  floorColor: '#b3aa9b',
  ceilingColor: '#151313',
  walls: [
    { id: 'far', from: [-5, -3], to: [5, -3], ...WALL },
    { id: 'right', from: [5, -3], to: [5, 3], ...WALL },
    { id: 'near', from: [5, 3], to: [-5, 3], ...WALL },
    { id: 'left', from: [-5, 3], to: [-5, -3], ...WALL },
  ],
  panels: [],
  columns: [{ id: 'col', position: [2, 0], size: [0.8, 0.6], color: '#9a4a35' }],
  platforms: [{ id: 'podium', min: [-5, -3], max: [0, -1], height: 0.2, color: '#3a2a28' }],
  fixtures: [
    venue('table', 'table', 'Стол', [-2, 1], [1.1, 0.75, 0.7]),
    venue('table2', 'table', 'Стол на подиуме', [-2, -2], [1.0, 0.75, 0.6], Math.PI / 2),
    venue('sofa', 'sofaU', 'Кабинка', [-2, 1.3], [2.8, 0.85, 1.8], Math.PI),
  ],
  spawn: { position: [3, 2], yaw: 0 },
};
