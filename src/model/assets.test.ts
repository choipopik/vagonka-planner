import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS, assetIdsOf, hashAssetId, sniffMime } from './assets';
import type { SceneObject } from './types';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const BOM = bytes(0xef, 0xbb, 0xbf);

/** Копия в отдельный ArrayBuffer (у Uint8Array из TextEncoder буфер может быть общим и длиннее). */
function bufferOf(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  return buffer;
}

const GLTF = '{"asset":{"version":"2.0","generator":"test"},"scenes":[{"nodes":[0]}],"nodes":[{"name":"Сова"}]}';

function obj(id: string, assetId: string | null): SceneObject {
  return {
    id,
    kind: assetId ? 'image' : 'primitive',
    type: assetId ? 'image' : 'box',
    origin: 'user',
    name: id,
    mount: { kind: 'floor', x: 0, z: 0, lift: 0 },
    rotationY: 0,
    size: [1, 1, 0.02],
    color: '#ffffff',
    assetId,
    locked: false,
    visible: true,
    params: {},
  };
}

describe('sniffMime', () => {
  it('PNG, JPEG, WebP, GLB — по сигнатуре байтов', () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe('image/png');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46))).toBe('image/jpeg');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe1, 0, 16))).toBe('image/jpeg');
    expect(sniffMime(concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WEBPVP8 ')))).toBe('image/webp');
    expect(sniffMime(concat(ascii('glTF'), bytes(2, 0, 0, 0, 100, 0, 0, 0)))).toBe('model/gltf-binary');
    // Достаточно самой сигнатуры.
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(sniffMime(ascii('glTF'))).toBe('model/gltf-binary');
  });

  it('текстовый .gltf — с BOM и без, с пробелами в начале', () => {
    expect(sniffMime(ascii(GLTF))).toBe('model/gltf+json');
    expect(sniffMime(concat(BOM, ascii(GLTF)))).toBe('model/gltf+json');
    expect(sniffMime(ascii(` \r\n\t${GLTF}\n`))).toBe('model/gltf+json');
    expect(sniffMime(concat(BOM, ascii(`\n  ${GLTF}`)))).toBe('model/gltf+json');
    expect(sniffMime(ascii(JSON.stringify(JSON.parse(GLTF), null, 2)))).toBe('model/gltf+json');
  });

  it('JSON без asset.version (строкой) — не модель', () => {
    expect(sniffMime(ascii('{"hello":"world"}'))).toBeNull();
    expect(sniffMime(ascii('{"asset":{}}'))).toBeNull();
    expect(sniffMime(ascii('{"asset":{"version":2}}'))).toBeNull();
    expect(sniffMime(ascii('{"asset":"2.0"}'))).toBeNull();
    expect(sniffMime(ascii('{"asset":null}'))).toBeNull();
    expect(sniffMime(ascii('{"format":"vagonka-layout","version":1,"layout":{}}'))).toBeNull();
    expect(sniffMime(concat(BOM, ascii('{"asset":{"generator":"x"}}')))).toBeNull();
    // Массив и скаляр — не объект glTF, даже если внутри есть asset.version.
    expect(sniffMime(ascii('[{"asset":{"version":"2.0"}}]'))).toBeNull();
    expect(sniffMime(ascii('"asset"'))).toBeNull();
  });

  it('мусор, SVG, HTML, оборванный JSON, чужие контейнеры → null и не бросает', () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull();
    expect(sniffMime(bytes(0))).toBeNull();
    expect(sniffMime(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull();
    expect(sniffMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffMime(ascii('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffMime(ascii('<!doctype html><html></html>'))).toBeNull();
    expect(sniffMime(ascii('GIF89a'))).toBeNull();
    expect(sniffMime(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffMime(ascii('просто текст'))).toBeNull();
    // Начинается с '{', но не разбирается.
    expect(sniffMime(ascii(GLTF.slice(0, -5)))).toBeNull();
    expect(sniffMime(ascii('{'))).toBeNull();
    expect(sniffMime(ascii(`${GLTF} хвост`))).toBeNull();
    expect(sniffMime(concat(ascii('{"asset":{"version":"'), bytes(0xff, 0xfe), ascii('"}}')))).toBeNull();
    // Только BOM и пробелы.
    expect(sniffMime(concat(BOM, ascii('   ')))).toBeNull();
    // RIFF, но не WebP (WAV); 'WEBP' не на своём месте.
    expect(sniffMime(concat(ascii('RIFF'), bytes(0x24, 0, 0, 0), ascii('WAVEfmt ')))).toBeNull();
    expect(sniffMime(concat(ascii('RIFF'), bytes(0x24, 0, 0, 0)))).toBeNull();
    expect(sniffMime(ascii('WEBPRIFF....'))).toBeNull();
    // Неполные сигнатуры.
    expect(sniffMime(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffMime(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffMime(ascii('glT'))).toBeNull();
  });

  it('смотрит только на содержимое и не меняет его', () => {
    const data = concat(BOM, ascii(GLTF));
    const copy = data.slice();
    sniffMime(data);
    expect(data).toEqual(copy);
    // Вид на середину большего буфера.
    const padded = concat(ascii('xxxx'), bytes(0x89, 0x50, 0x4e, 0x47, 1, 2, 3), ascii('yyyy'));
    expect(sniffMime(padded.subarray(4, 11))).toBe('image/png');
  });
});

describe('hashAssetId', () => {
  it("'a_' + первые 32 hex SHA-256 содержимого", async () => {
    // Контрольные значения SHA-256 (FIPS 180-4).
    expect(await hashAssetId(bufferOf(ascii('abc')))).toBe('a_ba7816bf8f01cfea414140de5dae2223');
    expect(await hashAssetId(new ArrayBuffer(0))).toBe('a_e3b0c44298fc1c149afbf4c8996fb924');
  });

  it('стабилен: одно содержимое → один id, разное → разный', async () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5);
    const first = await hashAssetId(bufferOf(png));
    const second = await hashAssetId(bufferOf(png.slice()));
    expect(first).toBe(second);
    expect(first).toMatch(/^a_[0-9a-f]{32}$/);
    const other = await hashAssetId(bufferOf(bytes(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 6)));
    expect(other).toMatch(/^a_[0-9a-f]{32}$/);
    expect(other).not.toBe(first);
  });

  it('не меняет переданный буфер', async () => {
    const data = bufferOf(ascii('содержимое файла'));
    const copy = new Uint8Array(data).slice();
    await hashAssetId(data);
    expect(new Uint8Array(data)).toEqual(copy);
  });
});

describe('assetIdsOf', () => {
  it('id файлов, на которые ссылаются объекты, без повторов и без null', () => {
    const a = 'a_0123456789abcdef0123456789abcdef';
    const b = 'a_ffffffffffffffffffffffffffffffff';
    const ids = assetIdsOf([obj('1', a), obj('2', null), obj('3', b), obj('4', a), obj('5', null)]);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual([a, b]);
    expect(assetIdsOf([]).size).toBe(0);
    expect(assetIdsOf([obj('1', null)]).size).toBe(0);
    // Скрытые и заблокированные объекты тоже держат файл.
    expect(assetIdsOf([{ ...obj('1', a), visible: false, locked: true }]).has(a)).toBe(true);
  });
});

describe('ASSET_LIMITS', () => {
  it('пределы — как в спецификации', () => {
    expect(ASSET_LIMITS).toEqual({ imageBytes: 15_728_640, modelBytes: 41_943_040, imageMaxSide: 2048, importFileBytes: 314_572_800 });
    expect(ASSET_LIMITS.imageBytes).toBe(15 * 1024 * 1024);
    expect(ASSET_LIMITS.modelBytes).toBe(40 * 1024 * 1024);
    expect(ASSET_LIMITS.importFileBytes).toBe(300 * 1024 * 1024);
  });
});
