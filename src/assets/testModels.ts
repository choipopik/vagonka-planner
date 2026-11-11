// Помощник тестов пакета: минимальные модели glTF 2.0, собранные вручную (без three, файлов и Buffer из Node).

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

function padded(bytes: Uint8Array, fill: number): Uint8Array {
  const length = Math.ceil(bytes.length / 4) * 4;
  const out = new Uint8Array(length).fill(fill);
  out.set(bytes, 0);
  return out;
}

export interface GlbOptions {
  /** Версия контейнера в заголовке (по умолчанию 2). */
  containerVersion?: number;
  /** Тип первого чанка (по умолчанию 'JSON'). */
  firstChunkType?: number;
}

/** Собирает GLB: заголовок, JSON-чанк (объект или готовый текст) и необязательный BIN-чанк. */
export function glb(json: object | string, bin?: Uint8Array, options: GlbOptions = {}): ArrayBuffer {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  const jsonChunk = padded(new TextEncoder().encode(text), 0x20);
  const binChunk = bin ? padded(bin, 0) : null;
  const total = 12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, options.containerVersion ?? 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, options.firstChunkType ?? CHUNK_JSON, true);
  bytes.set(jsonChunk, 20);
  if (binChunk) {
    const at = 20 + jsonChunk.length;
    view.setUint32(at, binChunk.length, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    bytes.set(binChunk, at + 8);
  }
  return buffer;
}

/** Текстовый .gltf: JSON в UTF-8. */
export function gltfText(json: object): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Габариты и центр основания модели из triangleGltf. */
export const TRIANGLES_SIZE: [number, number, number] = [2, 1, 0.5];
export const TRIANGLES_BASE: [number, number, number] = [1, 0, 0.25];
export const TRIANGLES_COUNT = 2;

export interface TriangleOptions {
  /** Добавить в сцену точечный источник света (KHR_lights_punctual) и камеру. */
  extras?: boolean;
}

/**
 * Два треугольника на четырёх вершинах: (0,0,0), (2,0,0), (0,1,0), (0,0,0.5).
 * 'bin' — буфер без uri (для GLB с BIN-чанком), 'data' — буфер в data: URI (самодостаточный текстовый .gltf).
 */
export function triangleGltf(buffer: 'bin' | 'data', options: TriangleOptions = {}): { json: Record<string, unknown>; bin: Uint8Array } {
  const bin = new Uint8Array(60);
  const view = new DataView(bin.buffer);
  const positions = [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0.5];
  positions.forEach((value, i) => view.setFloat32(i * 4, value, true));
  [0, 1, 2, 0, 2, 3].forEach((value, i) => view.setUint16(48 + i * 2, value, true));

  const json: Record<string, unknown> = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: options.extras ? [0, 1, 2] : [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [
      buffer === 'data'
        ? { byteLength: bin.length, uri: `data:application/octet-stream;base64,${base64(bin)}` }
        : { byteLength: bin.length },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 12, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [2, 1, 0.5] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  };
  if (options.extras) {
    json.nodes = [
      { mesh: 0 },
      { translation: [5, 5, 5], extensions: { KHR_lights_punctual: { light: 0 } } },
      { translation: [-9, 3, 9], camera: 0 },
    ];
    json.cameras = [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.1 } }];
    json.extensionsUsed = ['KHR_lights_punctual'];
    json.extensions = { KHR_lights_punctual: { lights: [{ type: 'point', color: [1, 1, 1], intensity: 10 }] } };
  }
  return { json, bin };
}
