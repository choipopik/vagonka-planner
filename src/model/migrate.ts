import { SCHEMA_VERSION } from './types';
import type { Layout, Mount, ObjectKind, ParamValue, Params, SceneObject, Vec3 } from './types';

export type LayoutErrorCode = 'not-object' | 'newer-version' | 'bad-layout';

export class LayoutFormatError extends Error {
  readonly code: LayoutErrorCode;
  constructor(code: LayoutErrorCode, message: string) {
    super(message);
    this.name = 'LayoutFormatError';
    this.code = code;
  }
}

export const LAYOUT_LIMITS: {
  objects: 2000;
  name: 120;
  paramKeys: 64;
  paramString: 4000;
  coord: 500;
  sizeMin: 0.005;
  sizeMax: 60;
} = { objects: 2000, name: 120, paramKeys: 64, paramString: 4000, coord: 500, sizeMin: 0.005, sizeMax: 60 };

export const LAYOUT_PATTERNS: {
  id: RegExp;
  surfaceId: RegExp;
  type: RegExp;
  assetId: RegExp;
  color: RegExp;
  paramKey: RegExp;
} = {
  /** layout.id, layout.roomId, object.id, mount.hostId */
  id: /^[A-Za-z0-9_-]{1,64}$/,
  /** 'far', 'col-left:s' */
  surfaceId: /^[A-Za-z0-9_-]{1,64}(:[nesw])?$/,
  /** 'sofaU', 'light.spot', 'hp.dementor' */
  type: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/,
  assetId: /^a_[0-9a-f]{32}$/,
  color: /^#[0-9a-fA-F]{6}$/,
  paramKey: /^[A-Za-z][A-Za-z0-9_]{0,31}$/,
};

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Собственное свойство: унаследованное (в т. ч. подсунутое через __proto__) не читается. */
function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

/**
 * Миграции «сырых» данных: MIGRATIONS[n] переводит макет версии n в версию n + 1. Проверки здесь нет —
 * результат всё равно пересобирается по полям.
 */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: position [x, y, z] + rotationY → mount { kind: 'floor', x, z, lift: y }; assetId ?? null; params ?? {}.
  1: (raw) => {
    const list = own(raw, 'objects');
    const objects = Array.isArray(list)
      ? list.map((item: unknown) => {
          if (!isRecord(item)) return item;
          const position = own(item, 'position');
          const next: Raw = {};
          for (const key of Object.keys(item)) if (key !== 'position' && key !== '__proto__') next[key] = item[key];
          if (Array.isArray(position) && own(item, 'mount') === undefined) {
            next.mount = { kind: 'floor', x: position[0], z: position[2], lift: position[1] };
          }
          next.assetId = own(item, 'assetId') ?? null;
          next.params = own(item, 'params') ?? {};
          return next;
        })
      : list;
    return { id: own(raw, 'id'), name: own(raw, 'name'), roomId: own(raw, 'roomId'), updatedAt: own(raw, 'updatedAt'), objects, schemaVersion: 2 };
  },
};

const KINDS: readonly ObjectKind[] = ['primitive', 'image', 'model', 'light', 'preset'];

function coord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LAYOUT_LIMITS.coord ? value : null;
}

function text(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/** Крепление пересобирается по полям; null — плохое. */
function parseMount(raw: unknown): Mount | null {
  if (!isRecord(raw)) return null;
  switch (own(raw, 'kind')) {
    case 'floor': {
      const x = coord(own(raw, 'x'));
      const z = coord(own(raw, 'z'));
      const lift = coord(own(raw, 'lift'));
      return x === null || z === null || lift === null ? null : { kind: 'floor', x, z, lift };
    }
    case 'ceiling': {
      const x = coord(own(raw, 'x'));
      const z = coord(own(raw, 'z'));
      const drop = coord(own(raw, 'drop'));
      return x === null || z === null || drop === null ? null : { kind: 'ceiling', x, z, drop };
    }
    case 'wall': {
      const surfaceId = text(own(raw, 'surfaceId'), LAYOUT_PATTERNS.surfaceId);
      const along = coord(own(raw, 'along'));
      const bottom = coord(own(raw, 'bottom'));
      return surfaceId === null || along === null || bottom === null ? null : { kind: 'wall', surfaceId, along, bottom };
    }
    case 'surface': {
      const hostId = text(own(raw, 'hostId'), LAYOUT_PATTERNS.id);
      const u = coord(own(raw, 'u'));
      const v = coord(own(raw, 'v'));
      return hostId === null || u === null || v === null ? null : { kind: 'surface', hostId, u, v };
    }
    default:
      return null;
  }
}

function parseSize(raw: unknown): Vec3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const size: number[] = [];
  for (const side of raw as unknown[]) {
    if (typeof side !== 'number' || !Number.isFinite(side)) return null;
    if (side < LAYOUT_LIMITS.sizeMin || side > LAYOUT_LIMITS.sizeMax) return null;
    size.push(side);
  }
  return [size[0], size[1], size[2]];
}

/**
 * Параметры: переносятся только собственные ключи вида paramKey с конечным числом, строкой не длиннее
 * paramString или булевым значением; остальное (в т. ч. '__proto__', вложенные объекты) молча не переносится —
 * каталог подставит умолчание. null — параметры целиком негодны (не объект или слишком много ключей).
 */
function parseParams(raw: unknown): Params | null {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > LAYOUT_LIMITS.paramKeys) return null;
  const params: Params = {};
  for (const key of keys) {
    if (!LAYOUT_PATTERNS.paramKey.test(key)) continue;
    const value = raw[key];
    let ok: ParamValue | undefined;
    if (typeof value === 'number') ok = Number.isFinite(value) ? value : undefined;
    else if (typeof value === 'string') ok = value.length <= LAYOUT_LIMITS.paramString ? value : undefined;
    else if (typeof value === 'boolean') ok = value;
    if (ok !== undefined) params[key] = ok;
  }
  return params;
}

/** Объект пересобирается по полям; строка — причина, по которой он отброшен. */
function parseObject(raw: unknown): SceneObject | string {
  if (!isRecord(raw)) return 'объект не является записью';
  const id = text(own(raw, 'id'), LAYOUT_PATTERNS.id);
  if (id === null) return 'плохой id';
  const kind = own(raw, 'kind');
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return 'неизвестный kind';
  const type = text(own(raw, 'type'), LAYOUT_PATTERNS.type);
  if (type === null) return 'плохой type';
  const origin = own(raw, 'origin');
  if (origin !== 'venue' && origin !== 'user') return 'плохой origin';
  const name = own(raw, 'name');
  if (typeof name !== 'string') return 'плохое имя';
  const mount = parseMount(own(raw, 'mount'));
  if (mount === null) return 'плохое крепление';
  const rotationY = coord(own(raw, 'rotationY'));
  if (rotationY === null) return 'плохой угол';
  const size = parseSize(own(raw, 'size'));
  if (size === null) return 'плохой размер';
  const color = text(own(raw, 'color'), LAYOUT_PATTERNS.color);
  if (color === null) return 'плохой цвет';
  const rawAsset = own(raw, 'assetId');
  const assetId = rawAsset === null || rawAsset === undefined ? null : text(rawAsset, LAYOUT_PATTERNS.assetId);
  if (assetId === null && rawAsset !== null && rawAsset !== undefined) return 'плохой assetId';
  const locked = own(raw, 'locked');
  const visible = own(raw, 'visible');
  if (typeof locked !== 'boolean' || typeof visible !== 'boolean') return 'плохие флаги locked / visible';
  const params = parseParams(own(raw, 'params'));
  if (params === null) return 'плохие параметры';
  return {
    id,
    kind: kind as ObjectKind,
    type,
    origin,
    name: name.slice(0, LAYOUT_LIMITS.name),
    mount,
    rotationY,
    size,
    color,
    assetId,
    locked,
    visible,
    params,
  };
}

/**
 * Недоверенный JSON (localStorage, импорт) → Layout текущей схемы. Миграции: MIGRATIONS[1] = v1 → v2
 * (position [x, y, z] + rotationY → mount { kind: 'floor', x, z, lift: y }; assetId ?? null; params ?? {}).
 * Проверка: объекты пересобираются ПО ПОЛЯМ (лишние ключи, __proto__ и т. п. не переносятся); числа конечны и в пределах
 * LAYOUT_LIMITS; kind и mount.kind — из закрытых множеств. Строковые поля — КАЖДОЕ по своему правилу (LAYOUT_PATTERNS):
 *   layout.id, object.id, mount.hostId   /^[A-Za-z0-9_-]{1,64}$/
 *   mount.surfaceId                       /^[A-Za-z0-9_-]{1,64}(:[nesw])?$/        ('far', 'col-left:s')
 *   object.type                           /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/         ('sofaU', 'light.spot', 'hp.dementor')
 *   object.assetId                        null либо /^a_[0-9a-f]{32}$/
 *   object.color                          /^#[0-9a-fA-F]{6}$/
 *   ключи params                          /^[A-Za-z][A-Za-z0-9_]{0,31}$/
 *   layout.roomId                         /^[A-Za-z0-9_-]{1,64}$/
 * Плохой объект отбрасывается и передаётся в onDrop; неизвестный type СОХРАНЯЕТСЯ (рисуется заглушкой).
 * Структурный мусор → LayoutFormatError.
 */
export function parseLayout(raw: unknown, onDrop?: (index: number, reason: string) => void): Layout {
  if (!isRecord(raw)) throw new LayoutFormatError('not-object', 'Макет должен быть объектом JSON');

  const version = own(raw, 'schemaVersion');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new LayoutFormatError('bad-layout', 'У макета нет номера версии');
  }
  if (version > SCHEMA_VERSION) {
    throw new LayoutFormatError('newer-version', 'Макет сохранён более новой версией приложения');
  }
  let data: Raw = raw;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new LayoutFormatError('bad-layout', `Нет миграции с версии ${v}`);
    data = migrate(data);
  }

  const id = text(own(data, 'id'), LAYOUT_PATTERNS.id);
  const roomId = text(own(data, 'roomId'), LAYOUT_PATTERNS.id);
  const name = own(data, 'name');
  const list = own(data, 'objects');
  if (id === null) throw new LayoutFormatError('bad-layout', 'У макета плохой id');
  if (roomId === null) throw new LayoutFormatError('bad-layout', 'У макета плохой id помещения');
  if (typeof name !== 'string') throw new LayoutFormatError('bad-layout', 'У макета нет названия');
  if (!Array.isArray(list)) throw new LayoutFormatError('bad-layout', 'У макета нет списка объектов');
  if (list.length > LAYOUT_LIMITS.objects) {
    throw new LayoutFormatError('bad-layout', `В макете больше ${LAYOUT_LIMITS.objects} объектов`);
  }

  const objects: SceneObject[] = [];
  const seen = new Set<string>();
  (list as unknown[]).forEach((item, index) => {
    const parsed = parseObject(item);
    if (typeof parsed === 'string') {
      onDrop?.(index, parsed);
    } else if (seen.has(parsed.id)) {
      onDrop?.(index, 'повтор id');
    } else {
      seen.add(parsed.id);
      objects.push(parsed);
    }
  });

  const updatedAt = own(data, 'updatedAt');
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: name.slice(0, LAYOUT_LIMITS.name),
    roomId,
    objects,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
  };
}
