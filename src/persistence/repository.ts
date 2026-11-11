import { hashAssetId, sniffMime } from '../model/assets';
import { parseLayout } from '../model/migrate';
import type { AssetKind, AssetMeta, Layout, Vec3 } from '../model/types';

export interface LayoutMeta {
  id: string;
  name: string;
  roomId: string;
  updatedAt: number;
}
export type RepositoryErrorCode = 'quota' | 'unavailable' | 'corrupt';
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  constructor(code: RepositoryErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

export interface LayoutRepository {
  /** Новые первыми. Без roomId — все помещения. */
  list(roomId?: string): Promise<LayoutMeta[]>;
  /** Уже прошёл parseLayout. null — нет такого. Нечитаемый → RepositoryError('corrupt'), запись не удаляется. */
  load(id: string): Promise<Layout | null>;
  /** Создаёт или перезаписывает. Нет места → RepositoryError('quota'), сохранённое не портится. */
  save(layout: Layout): Promise<void>;
  /** Файлы не трогает. */
  remove(id: string): Promise<void>;
  /** Идемпотентно: одинаковые байты → один id (hashAssetId). mime определяется sniffMime; неизвестный → RepositoryError('corrupt'). */
  putAsset(blob: Blob, info: { kind: AssetKind; name: string; width?: number; height?: number; naturalSize?: Vec3 }): Promise<AssetMeta>;
  getAsset(id: string): Promise<Blob | null>;
  listAssets(): Promise<AssetMeta[]>;
  removeAsset(id: string): Promise<void>;
}

/** Длина имени файла в AssetMeta (2.1: «Исходное имя файла, ≤ 120 символов»). */
const ASSET_NAME_LIMIT = 120;

/** В памяти: тесты, заглушка фундамента и запасной вариант, когда хранилища браузера недоступны. */
export class MemoryRepository implements LayoutRepository {
  /** Макеты хранятся как JSON-текст — так же, как в localStorage: наружу никогда не уходит общая ссылка. */
  private readonly layouts = new Map<string, string>();
  private readonly assets = new Map<string, { meta: AssetMeta; blob: Blob }>();

  async list(roomId?: string): Promise<LayoutMeta[]> {
    const metas: LayoutMeta[] = [];
    for (const [id, text] of this.layouts) {
      try {
        const layout = parseLayout(JSON.parse(text));
        if (roomId !== undefined && layout.roomId !== roomId) continue;
        metas.push({ id, name: layout.name, roomId: layout.roomId, updatedAt: layout.updatedAt });
      } catch {
        // Нечитаемая запись в список не попадает, но и не удаляется.
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Layout | null> {
    const text = this.layouts.get(id);
    if (text === undefined) return null;
    try {
      return parseLayout(JSON.parse(text));
    } catch (error) {
      throw new RepositoryError('corrupt', error instanceof Error ? error.message : 'Макет не читается');
    }
  }

  async save(layout: Layout): Promise<void> {
    this.layouts.set(layout.id, JSON.stringify(layout));
  }

  async remove(id: string): Promise<void> {
    this.layouts.delete(id);
  }

  async putAsset(
    blob: Blob,
    info: { kind: AssetKind; name: string; width?: number; height?: number; naturalSize?: Vec3 },
  ): Promise<AssetMeta> {
    const bytes = await blob.arrayBuffer();
    const mime = sniffMime(new Uint8Array(bytes));
    if (mime === null) throw new RepositoryError('corrupt', 'Неизвестный формат файла');
    const id = await hashAssetId(bytes);
    const existing = this.assets.get(id);
    if (existing) return { ...existing.meta };

    const meta: AssetMeta = {
      id,
      kind: info.kind,
      name: info.name.slice(0, ASSET_NAME_LIMIT),
      mime,
      bytes: bytes.byteLength,
      createdAt: Date.now(),
    };
    if (info.width !== undefined) meta.width = info.width;
    if (info.height !== undefined) meta.height = info.height;
    if (info.naturalSize !== undefined) meta.naturalSize = [info.naturalSize[0], info.naturalSize[1], info.naturalSize[2]];
    // Копия байтов с mime по сигнатуре, а не по заявленному типу исходного блоба.
    this.assets.set(id, { meta, blob: new Blob([bytes], { type: mime }) });
    return { ...meta };
  }

  async getAsset(id: string): Promise<Blob | null> {
    return this.assets.get(id)?.blob ?? null;
  }

  /** Новые первыми. */
  async listAssets(): Promise<AssetMeta[]> {
    return [...this.assets.values()].map((entry) => ({ ...entry.meta })).sort((a, b) => b.createdAt - a.createdAt);
  }

  async removeAsset(id: string): Promise<void> {
    this.assets.delete(id);
  }
}
