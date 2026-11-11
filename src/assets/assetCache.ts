// Текстуры картинок, разобранные модели и object URL миниатюр из репозитория. Кэши со счётчиком ссылок:
// ресурс освобождается через 5 с после последнего release (переживает undo/redo и перемонтирование).
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { SRGBColorSpace, TextureLoader } from 'three';
import type { Object3D, Texture } from 'three';
import { sniffMime } from '../model/assets';
import { repository } from '../persistence/index';
import { useEditor } from '../store/editorStore';
import { inspectGltf } from './gltf';
import { disposeModel, parseModel } from './modelLoader';
import type { ModelBounds } from './modelLoader';
import { RefCache } from './refCache';
import type { CacheSnapshot } from './refCache';
import { mimeHasAlpha } from './rules';

/** Сколько первых байт хватает sniffMime, чтобы узнать картинку. */
const SIGNATURE_BYTES = 16;

async function loadImageTexture(id: string): Promise<Texture | null> {
  const blob = await repository.getAsset(id);
  if (!blob) return null;
  const head = new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const url = URL.createObjectURL(blob);
  try {
    const texture = await new TextureLoader().loadAsync(url);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    // PNG и WebP рисуются вырезанным силуэтом (см. imageHasAlpha).
    texture.userData.hasAlpha = mimeHasAlpha(sniffMime(head) ?? blob.type);
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadModelScene(id: string): Promise<Object3D | null> {
  const blob = await repository.getAsset(id);
  if (!blob) return null;
  const buffer = await blob.arrayBuffer();
  const info = inspectGltf(buffer);
  if (!info.ok) throw new Error(info.error);
  const { scene, bounds } = await parseModel(buffer);
  scene.userData.modelBounds = bounds;
  return scene;
}

async function loadObjectUrl(id: string): Promise<string | null> {
  const blob = await repository.getAsset(id);
  return blob ? URL.createObjectURL(blob) : null;
}

const images = new RefCache<Texture>({ load: loadImageTexture, dispose: (texture) => texture.dispose() });
const models = new RefCache<Object3D>({ load: loadModelScene, dispose: disposeModel });
const urls = new RefCache<string>({ load: loadObjectUrl, dispose: (url) => URL.revokeObjectURL(url) });

const NONE: CacheSnapshot<never> = Object.freeze({ status: 'missing', value: null });

/** Держит ссылку на ресурс, пока компонент смонтирован, и возвращает его текущий снимок. */
function useCached<T>(cache: RefCache<T>, id: string | null): CacheSnapshot<T> {
  useEffect(() => {
    if (id === null) return undefined;
    cache.acquire(id);
    return () => cache.release(id);
  }, [cache, id]);
  const snapshot = () => (id === null ? NONE : cache.get(id));
  // Третий аргумент — снимок для рендера без DOM (тесты в Node): тот же, что и в браузере.
  return useSyncExternalStore(cache.subscribe, snapshot, snapshot);
}

/** Текстура картинки (sRGB, anisotropy 8). Файла нет или он не читается → 'missing'. */
export function useImageTexture(assetId: string | null): { texture: Texture | null; status: 'loading' | 'ready' | 'missing' } {
  const snapshot = useCached(images, assetId);
  return useMemo(() => {
    if (snapshot.status === 'ready') return { texture: snapshot.value, status: 'ready' };
    return { texture: null, status: snapshot.status === 'loading' ? 'loading' : 'missing' };
  }, [snapshot]);
}

/** true — у картинки может быть альфа-канал (PNG, WebP): рисуется вырезанным силуэтом без подложки. */
export function imageHasAlpha(texture: Texture): boolean {
  return texture.userData.hasAlpha === true;
}

/** Одна разобранная сцена на файл (общая для всех объектов — рисовать нужно её клон). */
export function useModelScene(assetId: string | null): {
  scene: Object3D | null;
  status: 'loading' | 'ready' | 'missing' | 'error';
} {
  const snapshot = useCached(models, assetId);
  return useMemo(() => ({ scene: snapshot.value, status: snapshot.status }), [snapshot]);
}

/** Габариты сцены из useModelScene (записаны при разборе). */
export function modelBoundsOf(scene: Object3D): ModelBounds | null {
  const bounds: unknown = scene.userData.modelBounds;
  return typeof bounds === 'object' && bounds !== null ? (bounds as ModelBounds) : null;
}

/** object URL для миниатюр; null — пока грузится или файла нет. */
export function useAssetUrl(assetId: string): string | null {
  return useCached(urls, assetId).value;
}

/** Файл появился в хранилище (загрузка, импорт): объекты, нарисованные заглушкой, перечитывают его. */
export function refreshAsset(assetId: string): void {
  images.reload(assetId);
  models.reload(assetId);
  urls.reload(assetId);
}

/**
 * Следит за библиотекой файлов в сторе: когда в ней появляется файл, которого кэш не нашёл, он загружается заново
 * (импорт макета, повторная загрузка удалённого файла). Возвращает отписку — вызывать из эффекта.
 */
export function watchAssetLibrary(): () => void {
  let previous = useEditor.getState().assets;
  return useEditor.subscribe((state) => {
    if (state.assets === previous) return;
    previous = state.assets;
    const known = new Set(state.assets.map((asset) => asset.id));
    for (const cache of [images, models, urls]) {
      for (const id of cache.failedIds()) if (known.has(id)) cache.reload(id);
    }
  });
}
