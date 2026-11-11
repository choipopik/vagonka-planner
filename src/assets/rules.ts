// Чистые правила загрузки файлов: тип по содержимому, пределы размера, размеры картинок. Без three, React и DOM.
import { ASSET_LIMITS, sniffMime } from '../model/assets';
import { MAX_SIZE, MIN_SIZE } from '../model/ops';
import type { AssetKind, AssetMime, Vec3 } from '../model/types';

/** Что принимает поле выбора файла. */
export const ACCEPTED_EXTENSIONS = '.glb,.gltf,.png,.jpg,.jpeg,.webp';
/** Число треугольников, после которого модель считается тяжёлой (предупреждение, не отказ). */
export const HEAVY_MODEL_TRIANGLES = 300_000;
/** Толщина листа картинки, м (как у записей каталога `image` и `image.flat`). */
export const IMAGE_THICKNESS = 0.02;

export const UPLOAD_ERRORS = {
  empty: 'Файл пуст',
  unknown: 'Этот формат не поддерживается — нужны PNG, JPEG, WebP, GLB или glTF одним файлом',
  imageTooBig: `Картинка больше ${megabytes(ASSET_LIMITS.imageBytes)} МБ`,
  modelTooBig: `Модель больше ${megabytes(ASSET_LIMITS.modelBytes)} МБ`,
  fileTooBig: `Файл больше ${megabytes(Math.max(ASSET_LIMITS.imageBytes, ASSET_LIMITS.modelBytes))} МБ`,
} as const;

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** Больше этого файл не подходит ни под один тип — его можно отвергнуть, не читая. */
export const MAX_UPLOAD_BYTES = Math.max(ASSET_LIMITS.imageBytes, ASSET_LIMITS.modelBytes);

export function kindOfMime(mime: AssetMime): AssetKind {
  return mime === 'model/gltf-binary' || mime === 'model/gltf+json' ? 'model' : 'image';
}

/** У PNG и WebP бывает альфа-канал: такие картинки рисуются вырезанным силуэтом без подложки. */
export function mimeHasAlpha(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/webp';
}

/**
 * Тип файла — только по содержимому (sniffMime), не по расширению и не по заявленному type; затем предел размера
 * для этого типа. Бросает Error с русским текстом для пользователя.
 */
export function classifyUpload(bytes: Uint8Array): { kind: AssetKind; mime: AssetMime } {
  if (bytes.byteLength === 0) throw new Error(UPLOAD_ERRORS.empty);
  const mime = sniffMime(bytes);
  if (mime === null) throw new Error(UPLOAD_ERRORS.unknown);
  const kind = kindOfMime(mime);
  if (kind === 'image' && bytes.byteLength > ASSET_LIMITS.imageBytes) throw new Error(UPLOAD_ERRORS.imageTooBig);
  if (kind === 'model' && bytes.byteLength > ASSET_LIMITS.modelBytes) throw new Error(UPLOAD_ERRORS.modelTooBig);
  return { kind, mime };
}

/**
 * Размер картинки после нормализации: наибольшая сторона не больше maxSide, пропорции сохраняются, стороны —
 * целые не меньше 1. resized === false — картинка сохраняется как есть, байт в байт.
 */
export function fitImage(
  width: number,
  height: number,
  maxSide: number = ASSET_LIMITS.imageMaxSide,
): { width: number; height: number; resized: boolean } {
  const largest = Math.max(width, height);
  if (!(largest > maxSide)) return { width, height, resized: false };
  const k = maxSide / largest;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    resized: true,
  };
}

/**
 * Размер нового объекта-картинки: ширина 1 м, вторая сторона — по пропорциям файла; толщина листа 2 см.
 * Стоячая `image` — [1, h/w, 0.02], лежачая `image.flat` — [1, 0.02, h/w]. Очень вытянутая картинка уменьшается или
 * увеличивается целиком, чтобы обе стороны остались в [MIN_SIZE, MAX_SIZE] (addObject зажимает стороны по отдельности
 * и пропорции не бережёт). Неизвестные размеры → квадрат.
 */
export function imageObjectSize(width: number | undefined, height: number | undefined, flat: boolean): Vec3 {
  let w = 1;
  let h = 1;
  if (width !== undefined && height !== undefined && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    h = height / width;
    if (h > MAX_SIZE) {
      w = Math.max(MIN_SIZE, MAX_SIZE / h);
      h = MAX_SIZE;
    } else if (h < MIN_SIZE) {
      w = Math.min(MAX_SIZE, MIN_SIZE / h);
      h = MIN_SIZE;
    }
  }
  return flat ? [w, IMAGE_THICKNESS, h] : [w, h, IMAGE_THICKNESS];
}

/** Имя объекта по имени файла: без расширения; пустое → запасное. */
export function objectNameOf(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return base.length > 0 ? base : fallback;
}

/** Размер файла для подписи миниатюры: «840 КБ», «3,2 МБ». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 КБ';
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))} КБ`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} МБ`;
}

/** Длина в метрах для подписи: до двух знаков, без хвостовых нулей, с запятой. */
function meters(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

/** Вторая строка подписи миниатюры: пиксели картинки или габариты модели и размер файла. */
export function assetCaption(asset: {
  kind: AssetKind;
  bytes: number;
  width?: number;
  height?: number;
  naturalSize?: Vec3;
}): string {
  const parts: string[] = [];
  if (asset.kind === 'image' && asset.width !== undefined && asset.height !== undefined) {
    parts.push(`${asset.width} × ${asset.height}`);
  }
  if (asset.kind === 'model' && asset.naturalSize) {
    parts.push(`${asset.naturalSize.map(meters).join(' × ')} м`);
  }
  parts.push(formatBytes(asset.bytes));
  return parts.join(' · ');
}

/** Сколько названий макетов перечисляется в отказе удалить файл. */
const USAGE_NAMES = 4;

/** Текст отказа удалить файл, который используется в макетах (names не пуст). */
export function usageMessage(names: readonly string[]): string {
  const shown = names.slice(0, USAGE_NAMES).map((name) => `«${name}»`);
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} и ещё ${rest}` : shown.join(', ');
  return `Файл используется в ${names.length === 1 ? 'макете' : 'макетах'}: ${list}. Сначала удалите его объекты`;
}

/** Один тост на всю пачку загруженных файлов: первая ошибка и число остальных. failures не пуст. */
export function uploadFailureMessage(failures: readonly { name: string; message: string }[]): string {
  const first = failures[0];
  const text = `«${first.name}»: ${first.message}`;
  return failures.length > 1 ? `${text} (и ещё не загружено: ${failures.length - 1})` : text;
}
