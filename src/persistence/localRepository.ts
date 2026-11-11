// LocalRepository: макеты — JSON в хранилище строк, по ключу на макет, без отдельного индекса; файлы — записи
// { meta, blob } в одном хранилище записей, ключ — id по содержимому. Автоматической сборки мусора нет.
import { hashAssetId, sniffMime } from '../model/assets';
import { LAYOUT_LIMITS, LAYOUT_PATTERNS, parseLayout } from '../model/migrate';
import { SCHEMA_VERSION } from '../model/types';
import type { AssetKind, AssetMeta, AssetMime, Layout, Vec3 } from '../model/types';
import { RepositoryError } from './repository';
import type { LayoutMeta, LayoutRepository } from './repository';
import { isQuotaError } from './stores';
import type { RecordStore, StringStore } from './stores';

export interface AssetRecord {
  meta: AssetMeta;
  blob: Blob;
}
export interface LocalRepositoryDeps {
  strings: StringStore;
  assets: RecordStore<AssetRecord>;
  now: () => number;
}

/** Ключ макета: `vagonka:layout:<id>`. Других ключей (vagonka:prefs и чужих) репозиторий не видит. */
export const LAYOUT_KEY_PREFIX = 'vagonka:layout:';
/** Длина имени файла в AssetMeta (2.1: «Исходное имя файла, ≤ 120 символов»), как в MemoryRepository. */
const ASSET_NAME_LIMIT = 120;
const MIMES: readonly AssetMime[] = ['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Шапка макета для списка: только { id, name, roomId, updatedAt } с проверкой типов, без разбора объектов.
 * null — запись не читается (в список не попадает, но остаётся на месте).
 */
function metaOf(id: string, text: string): LayoutMeta | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { schemaVersion, name, roomId, updatedAt } = raw;
  // Запись, лежащая под чужим ключом, открылась бы под другим id — такую считаем нечитаемой.
  if (raw.id !== id || !LAYOUT_PATTERNS.id.test(id)) return null;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) {
    return null;
  }
  if (typeof name !== 'string' || typeof roomId !== 'string' || !LAYOUT_PATTERNS.id.test(roomId)) return null;
  if (!Array.isArray(raw.objects)) return null;
  return {
    id,
    name: name.slice(0, LAYOUT_LIMITS.name),
    roomId,
    // Как в parseLayout: негодное время изменения не делает макет нечитаемым.
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
  };
}

/** Запись хранилища файлов могла быть повреждена или подменена: наружу уходит только проверенное. */
function validRecord(value: unknown): AssetRecord | null {
  if (!isRecord(value) || !isRecord(value.meta) || !(value.blob instanceof Blob)) return null;
  const meta = value.meta;
  if (typeof meta.id !== 'string' || !LAYOUT_PATTERNS.assetId.test(meta.id)) return null;
  if (meta.kind !== 'image' && meta.kind !== 'model') return null;
  if (typeof meta.name !== 'string' || typeof meta.mime !== 'string' || !(MIMES as readonly string[]).includes(meta.mime)) return null;
  if (typeof meta.bytes !== 'number' || typeof meta.createdAt !== 'number') return null;
  return value as unknown as AssetRecord;
}

function copyMeta(meta: AssetMeta): AssetMeta {
  const copy: AssetMeta = { ...meta };
  if (meta.naturalSize) copy.naturalSize = [meta.naturalSize[0], meta.naturalSize[1], meta.naturalSize[2]];
  return copy;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Ошибка хранилища → RepositoryError: квота либо «недоступно». */
function storageError(error: unknown, fallback: string): RepositoryError {
  if (error instanceof RepositoryError) return error;
  return isQuotaError(error)
    ? new RepositoryError('quota', 'В хранилище браузера не осталось места')
    : new RepositoryError('unavailable', messageOf(error, fallback));
}

export function createLocalRepository(deps: LocalRepositoryDeps): LayoutRepository {
  const { strings, assets, now } = deps;
  const keyOf = (id: string) => `${LAYOUT_KEY_PREFIX}${id}`;

  /** Чтение из хранилища файлов; сбой IndexedDB → RepositoryError('unavailable'). */
  async function readAssets<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw storageError(error, 'Хранилище файлов недоступно');
    }
  }

  return {
    async list(roomId?: string): Promise<LayoutMeta[]> {
      const metas: LayoutMeta[] = [];
      for (const key of strings.keys()) {
        if (!key.startsWith(LAYOUT_KEY_PREFIX)) continue;
        const text = strings.get(key);
        if (text === null) continue;
        const meta = metaOf(key.slice(LAYOUT_KEY_PREFIX.length), text);
        // Нечитаемая запись в список не попадает, но и не удаляется.
        if (meta === null) continue;
        if (roomId !== undefined && meta.roomId !== roomId) continue;
        metas.push(meta);
      }
      return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async load(id: string): Promise<Layout | null> {
      const text = strings.get(keyOf(id));
      if (text === null) return null;
      let layout: Layout;
      try {
        layout = parseLayout(JSON.parse(text));
      } catch (error) {
        throw new RepositoryError('corrupt', messageOf(error, 'Макет не читается'));
      }
      if (layout.id !== id) throw new RepositoryError('corrupt', 'Запись макета лежит под чужим ключом');
      return layout;
    },

    // ВАЖНО: до записи в strings здесь нет ни одного await — сохранение из pagehide / visibilitychange должно
    // успеть до выгрузки страницы. Неудачная запись (квота) прежнее значение ключа не трогает.
    async save(layout: Layout): Promise<void> {
      const text = JSON.stringify(layout);
      try {
        strings.set(keyOf(layout.id), text);
      } catch (error) {
        throw storageError(error, 'Хранилище браузера недоступно');
      }
    },

    async remove(id: string): Promise<void> {
      strings.remove(keyOf(id));
    },

    async putAsset(
      blob: Blob,
      info: { kind: AssetKind; name: string; width?: number; height?: number; naturalSize?: Vec3 },
    ): Promise<AssetMeta> {
      const bytes = await blob.arrayBuffer();
      const mime = sniffMime(new Uint8Array(bytes));
      if (mime === null) throw new RepositoryError('corrupt', 'Неизвестный формат файла');
      const id = await hashAssetId(bytes);
      const existing = validRecord(await readAssets(() => assets.get(id)));
      if (existing) return copyMeta(existing.meta);

      const meta: AssetMeta = {
        id,
        kind: info.kind,
        name: info.name.slice(0, ASSET_NAME_LIMIT),
        mime,
        bytes: bytes.byteLength,
        createdAt: now(),
      };
      if (info.width !== undefined) meta.width = info.width;
      if (info.height !== undefined) meta.height = info.height;
      if (info.naturalSize !== undefined) meta.naturalSize = [info.naturalSize[0], info.naturalSize[1], info.naturalSize[2]];
      try {
        // Одна запись на файл: метаданные и блоб пишутся одной операцией. Блоб — копия байтов с mime по сигнатуре.
        await assets.set(id, { meta, blob: new Blob([bytes], { type: mime }) });
      } catch (error) {
        throw storageError(error, 'Не удалось сохранить файл');
      }
      return copyMeta(meta);
    },

    async getAsset(id: string): Promise<Blob | null> {
      return validRecord(await readAssets(() => assets.get(id)))?.blob ?? null;
    },

    /** Новые первыми. */
    async listAssets(): Promise<AssetMeta[]> {
      const metas: AssetMeta[] = [];
      for (const value of await readAssets(() => assets.values())) {
        const record = validRecord(value);
        if (record) metas.push(copyMeta(record.meta));
      }
      return metas.sort((a, b) => b.createdAt - a.createdAt);
    },

    async removeAsset(id: string): Promise<void> {
      try {
        await assets.del(id);
      } catch (error) {
        throw storageError(error, 'Не удалось удалить файл');
      }
    },
  };
}
