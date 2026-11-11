// Может импортировать src/model/* значениями (createObject, placeNew, makeContext — для galleryObjects);
// обратного импорта нет: src/model знает только типы из ./types (Р22).
import { wallFrame, wallSurfaces } from '../model/geometry';
import { createObject } from '../model/ops';
import { placeNew } from '../model/place';
import { clampMount, makeContext } from '../model/pose';
import type { Mount, Params, Ray, RoomDef, SceneObject } from '../model/types';
import { basicSet } from './sets/basic';
import { hpSet } from './sets/hp';
import type { BuildInput, CatalogItem, CatalogLookup, CatalogSet, Painter, Part } from './types';

/** [basicSet, hpSet], отсортированы по order. Новая тема = папка в src/catalog/sets/ + одна строка здесь. */
export const catalogSets: readonly CatalogSet[] = [basicSet, hpSet].sort((a, b) => a.order - b.order);

/** Серый ящик 0.5³, kind 'primitive', все крепления — для неизвестных type. */
export const FALLBACK_ITEM: CatalogItem = {
  id: 'unknown',
  kind: 'primitive',
  title: 'Неизвестный предмет',
  category: 'Прочее',
  size: [0.5, 0.5, 0.5],
  resize: 'free',
  color: '#8a8a8a',
  mounts: ['floor', 'wall', 'ceiling', 'surface'],
  params: [],
  listed: false,
  build: ({ size: [w, h, d], color }) => [{ shape: 'box', position: [0, h / 2, 0], size: [w, h, d], color }],
};

const itemsById = new Map<string, CatalogItem>();
const paintersByName = new Map<string, Painter>();
for (const set of catalogSets) {
  for (const item of set.items) if (!itemsById.has(item.id)) itemsById.set(item.id, item);
  for (const [name, painter] of Object.entries(set.painters ?? {})) paintersByName.set(name, painter);
}

/** Никогда не бросает: неизвестный type → FALLBACK_ITEM. */
export function getItem(type: string): CatalogItem {
  return itemsById.get(type) ?? FALLBACK_ITEM;
}

export function hasItem(type: string): boolean {
  return itemsById.has(type);
}

/** Записи с listed !== false в порядке наборов. */
export function listedItems(): CatalogItem[] {
  return catalogSets.flatMap((set) => set.items.filter((item) => item.listed !== false));
}

export function getPainter(name: string): Painter | undefined {
  return paintersByName.get(name);
}

/** Умолчания ParamDef, поверх — сохранённые значения; числа зажаты в [min, max]; неизвестные ключи сохраняются. */
export function resolveParams(item: CatalogItem, params: Params): Params {
  // Сначала неизвестные ключи (как есть), затем — каждое описанное поле: значение подходящего типа либо умолчание.
  const known = new Set(item.params.map((def) => def.key));
  const result: Params = {};
  for (const key of Object.keys(params)) if (!known.has(key)) result[key] = params[key];
  for (const def of item.params) {
    const saved = Object.prototype.hasOwnProperty.call(params, def.key) ? params[def.key] : undefined;
    switch (def.type) {
      case 'number':
        result[def.key] =
          typeof saved === 'number' && Number.isFinite(saved) ? Math.min(def.max, Math.max(def.min, saved)) : def.default;
        break;
      case 'seed':
        result[def.key] = typeof saved === 'number' && Number.isFinite(saved) ? Math.trunc(saved) : def.default;
        break;
      case 'boolean':
        result[def.key] = typeof saved === 'boolean' ? saved : def.default;
        break;
      case 'select':
        result[def.key] =
          typeof saved === 'string' && def.options.some((option) => option.value === saved) ? saved : def.default;
        break;
      case 'text':
        result[def.key] =
          typeof saved === 'string' ? (def.maxLength !== undefined ? saved.slice(0, def.maxLength) : saved) : def.default;
        break;
      case 'color':
        result[def.key] = typeof saved === 'string' ? saved : def.default;
        break;
    }
  }
  return result;
}

export function buildInput(o: SceneObject): BuildInput {
  return { size: o.size, color: o.color, params: resolveParams(getItem(o.type), o.params), mount: o.mount.kind };
}

/**
 * Ключ мемоизации partsOf и pickBoxes: type | size | color | JSON(params) | mount.kind
 * (помощник для bounds.ts; в спецификации не описан).
 */
export function buildKey(o: SceneObject): string {
  return `${o.type}|${o.size.join(',')}|${o.color}|${JSON.stringify(o.params)}|${o.mount.kind}`;
}

/** Сколько записей держат кэши partsOf и pickBoxes. */
export const BUILD_CACHE_SIZE = 256;

const EMPTY_PARTS: readonly Part[] = Object.freeze([]);
const partsCache = new Map<string, readonly Part[]>();

/**
 * Части объекта: item.build(buildInput(o)); нет build → []. Мемоизация по ключу type | size | color | JSON(params) | mount.kind
 * (LRU на 256 записей), поэтому вызывать можно на каждое движение мыши.
 */
export function partsOf(o: SceneObject): readonly Part[] {
  const build = getItem(o.type).build;
  if (!build) return EMPTY_PARTS;
  const key = buildKey(o);
  const cached = partsCache.get(key);
  if (cached) {
    // Map хранит порядок вставки: перевставка делает запись самой «свежей».
    partsCache.delete(key);
    partsCache.set(key, cached);
    return cached;
  }
  const parts = build(buildInput(o));
  partsCache.set(key, parts);
  if (partsCache.size > BUILD_CACHE_SIZE) {
    const oldest = partsCache.keys().next();
    if (!oldest.done) partsCache.delete(oldest.value);
  }
  return parts;
}

/** getItem(o.type).support === true && o.visible && o.mount.kind === 'floor'. */
export function isSupport(o: SceneObject): boolean {
  return getItem(o.type).support === true && o.visible && o.mount.kind === 'floor';
}

/** { getItem, isSupport } — то, что стор, действия и W2 передают в функции src/model с параметром `catalog`. */
export const catalogLookup: CatalogLookup = { getItem, isSupport };

/** Зазор между предметами галереи и отступ от стен, м. */
const GALLERY_GAP = 0.5;

/**
 * Для отладки (`#gallery` в адресе): по одному объекту каждой записи каталога на её креплении по умолчанию, разложены по помещению.
 * Напольные и потолочные предметы стоят рядами вдоль X (каждый тип крепления — своими рядами), настенные — вдоль стен
 * по порядку room.walls, настольные — на первой свободной опоре из самой галереи (стол, стойка, ящик…). id объектов
 * детерминированы ('gallery-0', 'gallery-1', …), все крепления прошли clampMount.
 */
export function galleryObjects(room: RoomDef): SceneObject[] {
  const items = catalogSets.flatMap((set) => set.items);
  const objects: SceneObject[] = [];
  const halfL = room.size.length / 2;
  const halfW = room.size.width / 2;
  const down = (x: number, z: number): Ray => ({ origin: [x, room.size.height + 1, z], dir: [0, -1, 0] });

  const add = (item: CatalogItem, mount: Mount) => {
    const ctx = makeContext(room, objects);
    const object = createObject(item, clampMount(mount, item.size, ctx));
    objects.push({ ...object, id: `gallery-${objects.length}` });
  };

  // Ряды вдоль X от дальней стены к ближней; свой счётчик рядов у пола и у потолка.
  const rows = () => {
    let x = -halfL + GALLERY_GAP;
    let z = -halfW + GALLERY_GAP;
    let rowDepth = 0;
    return (item: CatalogItem): [number, number] => {
      const [w, , d] = item.size;
      if (x + w > halfL - GALLERY_GAP && rowDepth > 0) {
        x = -halfL + GALLERY_GAP;
        z += rowDepth + GALLERY_GAP;
        rowDepth = 0;
      }
      const at: [number, number] = [x + w / 2, z + d / 2];
      x += w + GALLERY_GAP;
      rowDepth = Math.max(rowDepth, d);
      return at;
    };
  };
  const nextFloor = rows();
  const nextCeiling = rows();

  // Настенные: вдоль стен помещения (грани колонн не используются), слева направо.
  const walls = wallSurfaces(room).slice(0, room.walls.length);
  let wallIndex = 0;
  let along = GALLERY_GAP;
  const nextWall = (item: CatalogItem): Mount | null => {
    const w = item.size[0];
    for (; wallIndex < walls.length; wallIndex++, along = GALLERY_GAP) {
      const length = wallFrame(walls[wallIndex]).length;
      if (along + w <= length - GALLERY_GAP || (along === GALLERY_GAP && w <= length)) {
        const mount: Mount = {
          kind: 'wall',
          surfaceId: walls[wallIndex].id,
          along: along + w / 2,
          bottom: item.defaultBottom ?? 1.2,
        };
        along += w + GALLERY_GAP;
        return mount;
      }
    }
    return null;
  };

  const tabletop: CatalogItem[] = [];
  for (const item of items) {
    const kind = item.mounts[0] ?? 'floor';
    if (kind === 'surface') {
      tabletop.push(item); // после того как расставлены все опоры
    } else if (kind === 'ceiling') {
      const [x, z] = nextCeiling(item);
      add(item, { kind: 'ceiling', x, z, drop: item.defaultDrop ?? 0 });
    } else if (kind === 'wall') {
      const mount = nextWall(item);
      if (mount) {
        add(item, mount);
      } else {
        const [x, z] = nextFloor(item);
        add(item, placeNew(item, item.size, down(x, z), makeContext(room, objects), isSupport, null));
      }
    } else {
      const [x, z] = nextFloor(item);
      add(item, { kind: 'floor', x, z, lift: 0 });
    }
  }

  for (const item of tabletop) {
    const ctx = makeContext(room, objects);
    const host = objects.find(
      (o) =>
        isSupport(o) &&
        o.size[0] >= item.size[0] &&
        o.size[2] >= item.size[2] &&
        !objects.some((child) => child.mount.kind === 'surface' && child.mount.hostId === o.id),
    );
    if (host) {
      add(item, { kind: 'surface', hostId: host.id, u: 0, v: 0 });
    } else {
      // Свободной опоры нет: placeNew ставит предмет на пол (или на ближайшую опору, если пол ему не подходит).
      const [x, z] = nextFloor(item);
      add(item, placeNew(item, item.size, down(x, z), ctx, isSupport, null));
    }
  }
  return objects;
}
