import type { AssetMime, SceneObject } from './types';

export const ASSET_LIMITS: {
  imageBytes: 15_728_640;
  modelBytes: 41_943_040;
  imageMaxSide: 2048;
  importFileBytes: 314_572_800;
} = { imageBytes: 15_728_640, modelBytes: 41_943_040, imageMaxSide: 2048, importFileBytes: 314_572_800 };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[offset + i] !== signature[i]) return false;
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const GLB = [0x67, 0x6c, 0x54, 0x46]; // 'glTF'
const BOM = [0xef, 0xbb, 0xbf];

/** Текстовый .gltf: JSON-объект с asset.version — строкой. */
function isGltfJson(bytes: Uint8Array): boolean {
  let i = startsWith(bytes, BOM) ? 3 : 0;
  // Пробел, табуляция, перевод строки, возврат каретки.
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] !== 0x7b) return false; // '{'
  try {
    const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(i)));
    if (typeof json !== 'object' || json === null) return false;
    const asset: unknown = (json as Record<string, unknown>).asset;
    return typeof asset === 'object' && asset !== null && typeof (asset as Record<string, unknown>).version === 'string';
  } catch {
    return false;
  }
}

/**
 * Только по содержимому. Сигнатуры: PNG 89 50 4E 47 · JPEG FF D8 FF · WebP 'RIFF'…'WEBP' · GLB 'glTF' →
 * 'model/gltf-binary'. Текстовый .gltf: первый значащий байт (после BOM и пробелов) — '{', весь файл разбирается
 * JSON.parse (в try/catch) и у результата asset.version — строка → 'model/gltf+json'. Иное (в т. ч. SVG) → null.
 */
export function sniffMime(bytes: Uint8Array): AssetMime | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  if (startsWith(bytes, GLB)) return 'model/gltf-binary';
  if (isGltfJson(bytes)) return 'model/gltf+json';
  return null;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 'a_' + первые 32 hex SHA-256 (crypto.subtle; если недоступен — 'a_' + 32 случайных hex, дедупликация теряется). */
export async function hashAssetId(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return `a_${hex(new Uint8Array(digest)).slice(0, 32)}`;
    } catch {
      // Небезопасный контекст (http) — падаем в случайный id ниже.
    }
  }
  const random = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(random);
  } else {
    // Последний запасной вариант; как и newId(), это разрешённое исключение из правила «без Math.random».
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
  }
  return `a_${hex(random)}`;
}

export function assetIdsOf(objects: readonly SceneObject[]): Set<string> {
  const ids = new Set<string>();
  for (const o of objects) if (o.assetId !== null && o.assetId !== undefined) ids.add(o.assetId);
  return ids;
}
