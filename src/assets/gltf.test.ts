import { describe, expect, it } from 'vitest';
import { MAX_SIZE, MIN_SIZE } from '../model/ops';
import { GLTF_ERRORS, defaultModelSize, inspectGltf } from './gltf';
import { glb, gltfText, triangleGltf } from './testModels';

const DRACO = 'KHR_draco_mesh_compression';

describe('inspectGltf: принимает', () => {
  it('минимальный GLB, собранный вручную', () => {
    const info = inspectGltf(glb({ asset: { version: '2.0' } }));
    expect(info).toEqual({
      ok: true,
      container: 'glb',
      version: '2.0',
      extensionsUsed: [],
      extensionsRequired: [],
      externalUris: [],
    });
    expect(info.error).toBeUndefined();
  });

  it('GLB с геометрией в BIN-чанке (буфер без uri)', () => {
    const { json, bin } = triangleGltf('bin');
    const info = inspectGltf(glb(json, bin));
    expect(info.ok).toBe(true);
    expect(info.container).toBe('glb');
    expect(info.externalUris).toEqual([]);
  });

  it('текстовый .gltf с data:-буфером', () => {
    const { json } = triangleGltf('data');
    const info = inspectGltf(gltfText(json));
    expect(info.ok).toBe(true);
    expect(info.container).toBe('gltf');
    expect(info.version).toBe('2.0');
    expect(info.externalUris).toEqual([]);
  });

  it('текстовый .gltf с BOM и пробелами в начале', () => {
    const body = new TextEncoder().encode(`  \n${JSON.stringify({ asset: { version: '2.0' } })}`);
    const bytes = new Uint8Array(3 + body.length);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);
    expect(inspectGltf(bytes.buffer).ok).toBe(true);
  });

  it('картинки с data: URI и картинки из bufferView', () => {
    const info = inspectGltf(
      gltfText({
        asset: { version: '2.0' },
        images: [{ uri: 'data:image/png;base64,AAAA' }, { bufferView: 0, mimeType: 'image/png' }, { uri: 'DATA:image/png;base64,AAAA' }],
      }),
    );
    expect(info.ok).toBe(true);
    expect(info.externalUris).toEqual([]);
  });

  it('Meshopt — встроенным декодером, в extensionsUsed и в extensionsRequired', () => {
    const used = inspectGltf(glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] }));
    expect(used.ok).toBe(true);
    expect(used.extensionsUsed).toEqual(['EXT_meshopt_compression']);

    const required = inspectGltf(
      glb({
        asset: { version: '2.0' },
        extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
        extensionsRequired: ['EXT_meshopt_compression'],
      }),
    );
    expect(required.ok).toBe(true);
    expect(required.extensionsRequired).toEqual(['EXT_meshopt_compression']);
  });

  it('версии 2.x: «2.0», «2.1», «2»', () => {
    for (const version of ['2.0', '2.1', '2']) {
      expect(inspectGltf(glb({ asset: { version } })).ok).toBe(true);
    }
  });
});

describe('inspectGltf: не glTF 2.0', () => {
  const notGltf = (buffer: ArrayBuffer) => {
    const info = inspectGltf(buffer);
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.notGltf);
    return info;
  };

  it('текст сообщения — по спецификации', () => {
    expect(GLTF_ERRORS.notGltf).toBe('Это не файл glTF 2.0');
    expect(GLTF_ERRORS.draco).toBe('Модель сжата Draco — пересохраните без сжатия');
    expect(GLTF_ERRORS.external).toBe('Модель ссылается на соседние файлы — сохраните её одним файлом .glb');
  });

  it('неверная сигнатура', () => {
    const bytes = new Uint8Array(glb({ asset: { version: '2.0' } }));
    bytes[0] = 0x58; // 'XlTF'
    expect(notGltf(bytes.buffer).container).toBe('gltf');
    // PNG и произвольные байты.
    notGltf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer);
    notGltf(new Uint8Array([0xff, 0xfe, 0x00, 0x01]).buffer);
  });

  it('пустой файл и не-JSON', () => {
    notGltf(new ArrayBuffer(0));
    notGltf(new TextEncoder().encode('это не модель').buffer as ArrayBuffer);
    notGltf(new TextEncoder().encode('[1, 2, 3]').buffer as ArrayBuffer);
    notGltf(new TextEncoder().encode('null').buffer as ArrayBuffer);
  });

  it('контейнер GLB версии 1', () => {
    expect(notGltf(glb({ asset: { version: '2.0' } }, undefined, { containerVersion: 1 })).container).toBe('glb');
  });

  it('asset.version 1.0 — в GLB и в тексте', () => {
    const binary = notGltf(glb({ asset: { version: '1.0' } }));
    expect(binary.version).toBe('1.0');
    const text = notGltf(gltfText({ asset: { version: '1.0' } }));
    expect(text.version).toBe('1.0');
    notGltf(gltfText({ asset: { version: '3.0' } }));
    notGltf(gltfText({ asset: { version: '20' } }));
  });

  it('нет asset или версия — не строка', () => {
    notGltf(gltfText({ scenes: [] }));
    notGltf(gltfText({ asset: {} }));
    notGltf(gltfText({ asset: { version: 2 } }));
    notGltf(gltfText({ asset: 'glTF' }));
  });

  it('обрезанный GLB: только заголовок, JSON-чанк длиннее файла', () => {
    const full = new Uint8Array(glb({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] }));
    notGltf(full.slice(0, 12).buffer);
    notGltf(full.slice(0, full.length - 4).buffer);
  });

  it('первый чанк GLB — не JSON', () => {
    notGltf(glb({ asset: { version: '2.0' } }, undefined, { firstChunkType: 0x004e4942 }));
  });

  it('битый JSON внутри GLB', () => {
    notGltf(glb('{"asset": {"version": "2.0"'));
  });
});

describe('inspectGltf: Draco', () => {
  it('Draco в extensionsRequired', () => {
    const info = inspectGltf(glb({ asset: { version: '2.0' }, extensionsUsed: [DRACO], extensionsRequired: [DRACO] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.draco);
    expect(info.extensionsRequired).toEqual([DRACO]);
  });

  it('Draco только в extensionsUsed — тоже отказ с сообщением про Draco', () => {
    const info = inspectGltf(glb({ asset: { version: '2.0' }, extensionsUsed: [DRACO] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.draco);
    expect(info.error).toMatch(/Draco/);
    expect(info.extensionsUsed).toEqual([DRACO]);
    expect(info.extensionsRequired).toEqual([]);
  });

  it('Draco только в extensionsRequired (некорректный, но встречающийся файл)', () => {
    const info = inspectGltf(gltfText({ asset: { version: '2.0' }, extensionsRequired: [DRACO] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.draco);
  });

  it('Draco в текстовом .gltf рядом с другими расширениями', () => {
    const info = inspectGltf(gltfText({ asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_emissive_strength', DRACO] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.draco);
  });

  it('сообщение про Draco важнее сообщения про соседние файлы', () => {
    const info = inspectGltf(gltfText({ asset: { version: '2.0' }, extensionsUsed: [DRACO], buffers: [{ uri: 'model.bin', byteLength: 4 }] }));
    expect(info.error).toBe(GLTF_ERRORS.draco);
    expect(info.externalUris).toEqual(['model.bin']);
  });
});

describe('inspectGltf: внешние файлы', () => {
  it('внешний URI в buffers', () => {
    const info = inspectGltf(gltfText({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 36 }] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.external);
    expect(info.externalUris).toEqual(['scene.bin']);
  });

  it('внешний URI в images', () => {
    const info = inspectGltf(glb({ asset: { version: '2.0' }, images: [{ uri: 'textures/wood.png' }] }));
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.external);
    expect(info.externalUris).toEqual(['textures/wood.png']);
  });

  it('сетевые адреса — тоже внешние; data: рядом с ними не считается', () => {
    const info = inspectGltf(
      gltfText({
        asset: { version: '2.0' },
        buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }, { uri: 'https://example.com/a.bin' }],
        images: [{ uri: '//example.com/b.png' }, { uri: 'data:image/png;base64,AAAA' }, { uri: 'blob:abc' }],
      }),
    );
    expect(info.ok).toBe(false);
    expect(info.error).toBe(GLTF_ERRORS.external);
    expect(info.externalUris).toEqual(['https://example.com/a.bin', '//example.com/b.png', 'blob:abc']);
  });

  it('мусор в списках расширений, буферов и картинок не роняет разбор', () => {
    const info = inspectGltf(
      gltfText({
        asset: { version: '2.0' },
        extensionsUsed: ['KHR_texture_transform', 7, null],
        extensionsRequired: 'KHR_texture_transform',
        buffers: [null, 5, { uri: 42 }, {}],
        images: { uri: 'a.png' },
      }),
    );
    expect(info.ok).toBe(true);
    expect(info.extensionsUsed).toEqual(['KHR_texture_transform']);
    expect(info.extensionsRequired).toEqual([]);
    expect(info.externalUris).toEqual([]);
  });
});

describe('defaultModelSize', () => {
  it('родной размер, если все стороны в [0.05, 6] м', () => {
    expect(defaultModelSize([1.2, 0.8, 0.5])).toEqual({ size: [1.2, 0.8, 0.5], rescaled: false });
    expect(defaultModelSize([0.05, 6, 0.05])).toEqual({ size: [0.05, 6, 0.05], rescaled: false });
  });

  it('слишком большая модель (сантиметры вместо метров) → 1 м по наибольшей стороне', () => {
    const { size, rescaled } = defaultModelSize([180, 90, 45]);
    expect(rescaled).toBe(true);
    expect(size[0]).toBeCloseTo(1, 9);
    expect(size[1]).toBeCloseTo(0.5, 9);
    expect(size[2]).toBeCloseTo(0.25, 9);
  });

  it('слишком маленькая модель → 1 м по наибольшей стороне', () => {
    const { size, rescaled } = defaultModelSize([0.002, 0.004, 0.001]);
    expect(rescaled).toBe(true);
    expect(size[0]).toBeCloseTo(0.5, 9);
    expect(size[1]).toBeCloseTo(1, 9);
    expect(size[2]).toBeCloseTo(0.25, 9);
  });

  it('одна сторона вне пределов — масштабируется вся модель с сохранением пропорций', () => {
    const { size, rescaled } = defaultModelSize([8, 2, 1]);
    expect(rescaled).toBe(true);
    expect(size).toEqual([1, 0.25, 0.125]);
    const thin = defaultModelSize([2, 0.04, 1]);
    expect(thin.rescaled).toBe(true);
    expect(thin.size).toEqual([1, 0.02, 0.5]);
  });

  it('результат всегда в пределах размера объекта', () => {
    const flat = defaultModelSize([2, 0, 1]);
    expect(flat.rescaled).toBe(true);
    expect(flat.size).toEqual([1, MIN_SIZE, 0.5]);
    for (const natural of [[1000, 0.001, 1], [0.0001, 0.0001, 0.0001], [7, 7, 7]] as [number, number, number][]) {
      for (const side of defaultModelSize(natural).size) {
        expect(side).toBeGreaterThanOrEqual(MIN_SIZE);
        expect(side).toBeLessThanOrEqual(MAX_SIZE);
      }
    }
  });

  it('габариты «не число», отрицательные или нулевые → куб 1 м', () => {
    const fallback = { size: [1, 1, 1], rescaled: true };
    expect(defaultModelSize([Number.NaN, 1, 1])).toEqual(fallback);
    expect(defaultModelSize([Number.POSITIVE_INFINITY, 1, 1])).toEqual(fallback);
    expect(defaultModelSize([-1, 1, 1])).toEqual(fallback);
    expect(defaultModelSize([0, 0, 0])).toEqual(fallback);
  });

  it('не меняет входной массив', () => {
    const natural: [number, number, number] = [100, 50, 25];
    defaultModelSize(natural);
    expect(natural).toEqual([100, 50, 25]);
  });
});
