// Проверка модели ДО разбора загрузчиком и размер нового объекта-модели. Чистый модуль: без three, React и DOM.
import { MAX_SIZE, MIN_SIZE } from '../model/ops';
import type { Vec3 } from '../model/types';

export interface GltfInfo {
  ok: boolean;
  /** Русский текст для пользователя, когда ok === false. */
  error?: string;
  container: 'glb' | 'gltf';
  /** asset.version из JSON ('2.0'). */
  version?: string;
  extensionsUsed: string[];
  extensionsRequired: string[];
  /** buffers[].uri и images[].uri, не начинающиеся с 'data:'. */
  externalUris: string[];
}

export const GLTF_ERRORS = {
  notGltf: 'Это не файл glTF 2.0',
  draco: 'Модель сжата Draco — пересохраните без сжатия',
  external: 'Модель ссылается на соседние файлы — сохраните её одним файлом .glb',
} as const;

const DRACO = 'KHR_draco_mesh_compression';
/** 'glTF' и 'JSON' как uint32 little-endian. */
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;

/** JSON-чанк GLB как текст; null — не GLB версии 2 или файл обрезан. */
function glbJsonText(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(4, true) !== 2) return null;
  const chunkLength = view.getUint32(GLB_HEADER_BYTES, true);
  const chunkType = view.getUint32(GLB_HEADER_BYTES + 4, true);
  const start = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  // Первый чанк обязан быть JSON и целиком лежать в файле.
  if (chunkType !== GLB_JSON_CHUNK || start + chunkLength > buffer.byteLength) return null;
  return decode(new Uint8Array(buffer, start, chunkLength));
}

function decode(bytes: Uint8Array): string | null {
  try {
    // ignoreBOM: false (по умолчанию) — BOM в начале текстового .gltf отбрасывается.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** uri записей массива (buffers / images), которые не являются data: URI. */
function externalUrisOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const uris: string[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const uri = entry.uri;
    if (typeof uri === 'string' && !/^data:/i.test(uri.trim())) uris.push(uri);
  }
  return uris;
}

/**
 * GLB: читает заголовок (сигнатура 'glTF', версия контейнера 2) и JSON-чанк. Текстовый .gltf: JSON.parse всего файла.
 * ok === false, если: не разбирается / asset.version не '2.x' → «Это не файл glTF 2.0»;
 * 'KHR_draco_mesh_compression' есть в extensionsUsed ИЛИ в extensionsRequired → «Модель сжата Draco — пересохраните
 * без сжатия» (GLTFLoader создаёт расширение уже по extensionsUsed и падает без DRACOLoader);
 * externalUris не пуст → «Модель ссылается на соседние файлы — сохраните её одним файлом .glb».
 */
export function inspectGltf(buffer: ArrayBuffer): GltfInfo {
  const isGlb = buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === GLB_MAGIC;
  const info: GltfInfo = {
    ok: false,
    container: isGlb ? 'glb' : 'gltf',
    extensionsUsed: [],
    extensionsRequired: [],
    externalUris: [],
  };
  const fail = (error: string): GltfInfo => ({ ...info, ok: false, error });

  const text = isGlb ? glbJsonText(buffer) : decode(new Uint8Array(buffer));
  if (text === null) return fail(GLTF_ERRORS.notGltf);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(GLTF_ERRORS.notGltf);
  }
  if (!isRecord(json) || !isRecord(json.asset)) return fail(GLTF_ERRORS.notGltf);

  const version = json.asset.version;
  if (typeof version === 'string') info.version = version;
  if (typeof version !== 'string' || !/^2(\.\d+)?$/.test(version.trim())) return fail(GLTF_ERRORS.notGltf);

  info.extensionsUsed = strings(json.extensionsUsed);
  info.extensionsRequired = strings(json.extensionsRequired);
  info.externalUris = [...externalUrisOf(json.buffers), ...externalUrisOf(json.images)];

  if (info.extensionsUsed.includes(DRACO) || info.extensionsRequired.includes(DRACO)) return fail(GLTF_ERRORS.draco);
  if (info.externalUris.length > 0) return fail(GLTF_ERRORS.external);
  return { ...info, ok: true };
}

/** Пределы «родного» размера модели, м: вне их модель, скорее всего, сохранена не в метрах. */
const NATURAL_MIN = 0.05;
const NATURAL_MAX = 6;

/**
 * Размер нового объекта по габаритам модели: родной, если все стороны в [0.05, 6] м, иначе масштаб до 1 м по
 * наибольшей стороне. Стороны результата всегда лежат в пределах размера объекта [MIN_SIZE, MAX_SIZE]
 * (плоская модель с нулевой толщиной получает MIN_SIZE); габариты «не число» → 1 × 1 × 1.
 */
export function defaultModelSize(naturalSize: Vec3): { size: Vec3; rescaled: boolean } {
  const sides = [naturalSize[0], naturalSize[1], naturalSize[2]];
  const largest = Math.max(...sides);
  if (!sides.every((side) => Number.isFinite(side) && side >= 0) || !(largest > 0)) {
    return { size: [1, 1, 1], rescaled: true };
  }
  if (sides.every((side) => side >= NATURAL_MIN && side <= NATURAL_MAX)) {
    return { size: [sides[0], sides[1], sides[2]], rescaled: false };
  }
  const k = 1 / largest;
  const fit = (side: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, side * k));
  const size: Vec3 = [fit(sides[0]), fit(sides[1]), fit(sides[2])];
  return { size, rescaled: size[0] !== sides[0] || size[1] !== sides[1] || size[2] !== sides[2] };
}
