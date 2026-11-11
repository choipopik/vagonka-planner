import { SCHEMA_VERSION, type Layout, type RoomDef, type SceneObject } from './types';

/** Единственное место в src/model, где разрешён Math.random(): id назначает тот, кто создаёт объект. */
export function newId(prefix = 'obj'): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${prefix}-${random}`;
}

/** Копия мебели площадки в исходной расстановке. */
export function venueObjects(room: RoomDef): SceneObject[] {
  return room.fixtures.map((o) => structuredClone(o));
}

export function createLayout(room: RoomDef, name = 'Новый макет'): Layout {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('layout'),
    name,
    roomId: room.id,
    objects: venueObjects(room),
    // Как в этапе 1: момент создания нужен списку макетов («новые первыми»); дальше updatedAt ведёт стор.
    updatedAt: Date.now(),
  };
}
