// Загрузка пользовательского файла в библиотеку: проверка по содержимому, нормализация, сохранение, обновление стора.
import type { AssetMeta, AssetMime } from '../model/types';
import { repository } from '../persistence/index';
import { useEditor } from '../store/editorStore';
import { refreshAsset } from './assetCache';
import { GLTF_ERRORS, inspectGltf } from './gltf';
import { disposeModel, parseModel } from './modelLoader';
import { HEAVY_MODEL_TRIANGLES, MAX_UPLOAD_BYTES, UPLOAD_ERRORS, classifyUpload, fitImage, mimeHasAlpha } from './rules';

/** Качество JPEG для уменьшенных картинок без прозрачности. */
const JPEG_QUALITY = 0.85;

export const IMPORT_ERRORS = {
  unreadable: 'Не удалось прочитать файл',
  badImage: 'Не удалось прочитать картинку — файл повреждён или формат не поддерживается браузером',
  badModel: 'Не удалось разобрать модель',
  noBrowser: 'Картинки можно загружать только в браузере',
  quota: 'В хранилище браузера не хватает места — удалите ненужные файлы',
  unavailable: 'Хранилище браузера недоступно — файл не сохранён',
  save: 'Не удалось сохранить файл',
} as const;

interface NormalizedImage {
  blob: Blob;
  width: number;
  height: number;
}

function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const done = (ok: boolean) => {
      URL.revokeObjectURL(url);
      if (ok && image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
      else reject(new Error(IMPORT_ERRORS.badImage));
    };
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = url;
  });
}

/** Есть ли в canvas хоть один не полностью непрозрачный пиксель. */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(IMPORT_ERRORS.badImage))), type, quality);
  });
}

/**
 * Измеряет картинку; если сторона больше 2048 px — уменьшает (с альфой остаётся PNG, иначе JPEG 0.85).
 * Картинка в пределах сохраняется как есть, байт в байт.
 */
async function normalizeImage(buffer: ArrayBuffer, mime: AssetMime): Promise<NormalizedImage> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') throw new Error(IMPORT_ERRORS.noBrowser);
  const original = new Blob([buffer], { type: mime });
  const image = await decodeImage(original);
  const fit = fitImage(image.naturalWidth, image.naturalHeight);
  if (!fit.resized) return { blob: original, width: fit.width, height: fit.height };

  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(IMPORT_ERRORS.badImage);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, fit.width, fit.height);
  const alpha = mimeHasAlpha(mime) && hasTransparency(ctx, fit.width, fit.height);
  const blob = alpha ? await canvasBlob(canvas, 'image/png') : await canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  return { blob, width: fit.width, height: fit.height };
}

type AssetInfo = Parameters<typeof repository.putAsset>[1];

async function store(blob: Blob, info: AssetInfo): Promise<AssetMeta> {
  try {
    return await repository.putAsset(blob, info);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'quota') throw new Error(IMPORT_ERRORS.quota);
    if (code === 'unavailable') throw new Error(IMPORT_ERRORS.unavailable);
    throw new Error(IMPORT_ERRORS.save);
  }
}

/** Библиотека файлов в сторе = то, что лежит в хранилище (новые первыми); при сбое чтения — прежний список + новый файл. */
async function syncLibrary(meta: AssetMeta): Promise<void> {
  let assets: AssetMeta[];
  try {
    assets = await repository.listAssets();
  } catch {
    assets = [meta, ...useEditor.getState().assets.filter((asset) => asset.id !== meta.id)];
  }
  useEditor.getState().setAssets(assets);
  refreshAsset(meta.id);
}

/**
 * Проверяет, нормализует, сохраняет через repository.putAsset, обновляет store.assets. Бросает Error с русским текстом
 * для пользователя. Тип файла — только по содержимому (sniffMime), не по расширению и не по file.type.
 */
export async function importAsset(file: File): Promise<AssetMeta> {
  // Заведомо слишком большой файл не читается в память вовсе.
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(UPLOAD_ERRORS.fileTooBig);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(IMPORT_ERRORS.unreadable);
  }
  const { kind, mime } = classifyUpload(new Uint8Array(buffer));

  if (kind === 'image') {
    const image = await normalizeImage(buffer, mime);
    const meta = await store(image.blob, { kind, name: file.name, width: image.width, height: image.height });
    await syncLibrary(meta);
    return meta;
  }

  const info = inspectGltf(buffer);
  if (!info.ok) throw new Error(info.error ?? GLTF_ERRORS.notGltf);
  let parsed: Awaited<ReturnType<typeof parseModel>>;
  try {
    parsed = await parseModel(buffer);
  } catch (error) {
    // Свой текст («В модели нет геометрии») показываем как есть; текст загрузчика — английский, он идёт в консоль.
    const own = error instanceof Error && /[а-яё]/i.test(error.message) ? error.message : null;
    if (!own) console.warn('Модель не разобралась', error);
    throw new Error(own ?? IMPORT_ERRORS.badModel);
  }
  // Разобранная сцена нужна была только ради габаритов: объекты возьмут её из кэша assetCache.
  disposeModel(parsed.scene);

  const meta = await store(new Blob([buffer], { type: mime }), { kind, name: file.name, naturalSize: parsed.bounds.size });
  await syncLibrary(meta);
  if (parsed.triangles > HEAVY_MODEL_TRIANGLES) {
    const thousands = Math.round(parsed.triangles / 1000);
    useEditor.getState().notify('warn', `В модели ${thousands} тыс. треугольников — вид может подтормаживать`);
  }
  return meta;
}
