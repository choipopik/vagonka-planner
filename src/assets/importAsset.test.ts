// Загрузка файлов и действия полки в Node: репозиторий — запасной MemoryRepository, браузерные части (Image, canvas)
// подменены ровно настолько, насколько их использует importAsset.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSET_LIMITS } from '../model/assets';
import { createLayout } from '../model/layout';
import type { AssetMeta } from '../model/types';
import { repository } from '../persistence/index';
import { getRoom } from '../rooms';
import { deleteObject } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { GLTF_ERRORS } from './gltf';
import { IMPORT_ERRORS, importAsset } from './importAsset';
import { UPLOAD_ERRORS } from './rules';
import { SHELF_ERRORS, SHELF_NOTES, addImageObject, addModelObject, removeAsset, uploadFiles } from './shelfActions';
import { TRIANGLES_SIZE, glb, gltfText, triangleGltf } from './testModels';

const state = () => useEditor.getState();

/** Модели с разным содержимым (разные id): в generator записывается отличительная строка. */
function modelBytes(tag: string, buffer: 'bin' | 'data' = 'bin'): ArrayBuffer {
  const { json, bin } = triangleGltf(buffer);
  json.asset = { version: '2.0', generator: tag };
  return buffer === 'bin' ? glb(json, bin) : gltfText(json);
}

function file(bytes: ArrayBuffer | Uint8Array, name: string, type = ''): File {
  return new File([bytes as BlobPart], name, { type });
}

async function bytesOf(id: string): Promise<Uint8Array> {
  const blob = await repository.getAsset(id);
  if (!blob) throw new Error(`в хранилище нет файла ${id}`);
  return new Uint8Array(await blob.arrayBuffer());
}

function stubProgressEvent(): void {
  if (typeof ProgressEvent !== 'undefined') return;
  vi.stubGlobal(
    'ProgressEvent',
    class {
      readonly type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
}

beforeEach(async () => {
  for (const asset of await repository.listAssets()) await repository.removeAsset(asset.id);
  for (const layout of await repository.list()) await repository.remove(layout.id);
  state().openLayout(createLayout(getRoom(state().roomId), 'Тестовый макет'));
  state().setCameraMode('orbit');
  state().setAssets([]);
  state().dismissNotice();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  state().dismissNotice();
});

describe('importAsset: модели', () => {
  it('GLB: сохраняется как есть, габариты — в naturalSize, библиотека в сторе обновлена', async () => {
    const bytes = modelBytes('glb-ok');
    const meta = await importAsset(file(bytes, 'сова.glb'));
    expect(meta.kind).toBe('model');
    expect(meta.mime).toBe('model/gltf-binary');
    expect(meta.name).toBe('сова.glb');
    expect(meta.bytes).toBe(bytes.byteLength);
    expect(meta.id).toMatch(/^a_[0-9a-f]{32}$/);
    expect(meta.naturalSize).toBeDefined();
    (meta.naturalSize ?? []).forEach((side, i) => expect(side).toBeCloseTo(TRIANGLES_SIZE[i], 6));
    expect(meta.width).toBeUndefined();

    expect(state().assets.map((asset) => asset.id)).toEqual([meta.id]);
    expect(Array.from(await bytesOf(meta.id))).toEqual(Array.from(new Uint8Array(bytes)));
    expect(state().notice).toBeNull();
  });

  it('самодостаточный текстовый .gltf → model/gltf+json', async () => {
    stubProgressEvent();
    const meta = await importAsset(file(modelBytes('gltf-ok', 'data'), 'стол.gltf'));
    expect(meta.kind).toBe('model');
    expect(meta.mime).toBe('model/gltf+json');
    (meta.naturalSize ?? []).forEach((side, i) => expect(side).toBeCloseTo(TRIANGLES_SIZE[i], 6));
  });

  it('тип — только по содержимому: GLB с расширением .png и type image/png остаётся моделью', async () => {
    const meta = await importAsset(file(modelBytes('glb-as-png'), 'картинка.png', 'image/png'));
    expect(meta.kind).toBe('model');
    expect(meta.mime).toBe('model/gltf-binary');
  });

  it('повторная загрузка того же файла не плодит записи', async () => {
    const first = await importAsset(file(modelBytes('twice'), 'a.glb'));
    const second = await importAsset(file(modelBytes('twice'), 'b.glb'));
    expect(second.id).toBe(first.id);
    expect(state().assets).toHaveLength(1);
    expect(await repository.listAssets()).toHaveLength(1);
  });

  it('новые файлы — первыми', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
    const older = await importAsset(file(modelBytes('older'), 'older.glb'));
    const newer = await importAsset(file(modelBytes('newer'), 'newer.glb'));
    expect(state().assets.map((asset) => asset.id)).toEqual([newer.id, older.id]);
  });

  it('Draco в extensionsUsed или extensionsRequired — отказ, ничего не сохраняется', async () => {
    const draco = 'KHR_draco_mesh_compression';
    const used = glb({ asset: { version: '2.0' }, extensionsUsed: [draco] });
    const required = glb({ asset: { version: '2.0' }, extensionsUsed: [draco], extensionsRequired: [draco] });
    await expect(importAsset(file(used, 'used.glb'))).rejects.toThrow(GLTF_ERRORS.draco);
    await expect(importAsset(file(required, 'required.glb'))).rejects.toThrow(GLTF_ERRORS.draco);
    expect(state().assets).toEqual([]);
    expect(await repository.listAssets()).toEqual([]);
  });

  it('модель с соседними файлами — «сохраните её одним файлом .glb»', async () => {
    const external = gltfText({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 60 }] });
    await expect(importAsset(file(external, 'scene.gltf'))).rejects.toThrow(GLTF_ERRORS.external);
    const texture = glb({ asset: { version: '2.0' }, images: [{ uri: 'wood.png' }] });
    await expect(importAsset(file(texture, 'wood.glb'))).rejects.toThrow('сохраните её одним файлом .glb');
    expect(await repository.listAssets()).toEqual([]);
  });

  it('glTF версии 1 — «Это не файл glTF 2.0»', async () => {
    await expect(importAsset(file(glb({ asset: { version: '1.0' } }), 'old.glb'))).rejects.toThrow(GLTF_ERRORS.notGltf);
    await expect(importAsset(file(glb({ asset: { version: '2.0' } }, undefined, { containerVersion: 1 }), 'v1.glb'))).rejects.toThrow(
      GLTF_ERRORS.notGltf,
    );
  });

  it('модель без геометрии и модель, которая не разбирается, — русский текст, ничего не сохраняется', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const empty = glb({ asset: { version: '2.0', generator: 'empty' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
    await expect(importAsset(file(empty, 'empty.glb'))).rejects.toThrow('В модели нет геометрии');
    // Буфер заявлен, но BIN-чанка нет.
    const broken = glb(triangleGltf('bin').json);
    await expect(importAsset(file(broken, 'broken.glb'))).rejects.toThrow(IMPORT_ERRORS.badModel);
    expect(await repository.listAssets()).toEqual([]);
    expect(state().assets).toEqual([]);
  });

  it('больше 300 тыс. треугольников — предупреждение, файл сохраняется', async () => {
    const triangles = 300_001;
    const bin = new Uint8Array(36 + triangles * 3 * 4);
    const view = new DataView(bin.buffer);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, i) => view.setFloat32(i * 4, value, true));
    for (let i = 0; i < triangles; i++) {
      view.setUint32(36 + i * 12 + 4, 1, true);
      view.setUint32(36 + i * 12 + 8, 2, true);
    }
    const heavy = glb(
      {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: triangles * 12 },
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
          { bufferView: 1, componentType: 5125, count: triangles * 3, type: 'SCALAR' },
        ],
      },
      bin,
    );
    const meta = await importAsset(file(heavy, 'heavy.glb'));
    expect(meta.kind).toBe('model');
    expect(state().assets.map((asset) => asset.id)).toEqual([meta.id]);
    expect(state().notice?.level).toBe('warn');
    expect(state().notice?.text).toContain('300 тыс. треугольников');
  });

  it('модель больше modelBytes — отказ', async () => {
    const header = new Uint8Array(glb({ asset: { version: '2.0' } }));
    const big = new Uint8Array(ASSET_LIMITS.modelBytes + 1);
    big.set(header, 0);
    // Файл больше обоих пределов отвергается, не читаясь.
    await expect(importAsset(file(big, 'big.glb'))).rejects.toThrow(UPLOAD_ERRORS.fileTooBig);
  });
});

describe('importAsset: отказы по содержимому', () => {
  it('пустой файл и неизвестный формат', async () => {
    await expect(importAsset(file(new Uint8Array(0), 'empty.png'))).rejects.toThrow(UPLOAD_ERRORS.empty);
    await expect(importAsset(file(new TextEncoder().encode('просто текст'), 'notes.glb'))).rejects.toThrow(UPLOAD_ERRORS.unknown);
    // SVG не принимается даже с «правильным» расширением и типом.
    await expect(importAsset(file(new TextEncoder().encode('<svg/>'), 'logo.png', 'image/png'))).rejects.toThrow(UPLOAD_ERRORS.unknown);
    expect(state().assets).toEqual([]);
  });

  it('файл, который не читается', async () => {
    const unreadable = file(new Uint8Array([1, 2, 3]), 'x.png');
    vi.spyOn(unreadable, 'arrayBuffer').mockRejectedValue(new Error('NotReadableError'));
    await expect(importAsset(unreadable)).rejects.toThrow(IMPORT_ERRORS.unreadable);
  });

  it('картинка больше imageBytes — отказ ещё до декодирования', async () => {
    const big = new Uint8Array(ASSET_LIMITS.imageBytes + 1);
    big.set([0x89, 0x50, 0x4e, 0x47], 0);
    await expect(importAsset(file(big, 'big.png'))).rejects.toThrow(UPLOAD_ERRORS.imageTooBig);
  });

  it('вне браузера картинку декодировать нечем — понятный отказ, а не падение', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // PNG с расширением .glb идёт по ветке картинок: тип — по содержимому.
    await expect(importAsset(file(png, 'model.glb', 'model/gltf-binary'))).rejects.toThrow(IMPORT_ERRORS.noBrowser);
  });
});

// ---------- Картинки: Image и canvas подменены ----------

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

interface FakeBrowser {
  /** Размеры, которые «декодер» сообщит для следующей картинки; null — картинка битая. */
  natural: { width: number; height: number } | null;
  /** Есть ли в нарисованной картинке прозрачные пиксели. */
  transparent: boolean;
  canvases: { width: number; height: number; drawn: unknown[][]; blobs: { type: string; quality: number | undefined }[] }[];
}

function stubBrowser(): FakeBrowser {
  const browser: FakeBrowser = { natural: { width: 1, height: 1 }, transparent: false, canvases: [] };

  class FakeImage {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
      queueMicrotask(() => {
        if (browser.natural) {
          this.naturalWidth = browser.natural.width;
          this.naturalHeight = browser.natural.height;
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
  }

  const createElement = (tag: string) => {
    if (tag !== 'canvas') throw new Error(`неожиданный элемент ${tag}`);
    const record: FakeBrowser['canvases'][number] = { width: 0, height: 0, drawn: [], blobs: [] };
    browser.canvases.push(record);
    return {
      get width() {
        return record.width;
      },
      set width(value: number) {
        record.width = value;
      },
      get height() {
        return record.height;
      },
      set height(value: number) {
        record.height = value;
      },
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (...args: unknown[]) => record.drawn.push(args),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          if (browser.transparent) data[data.length - 1] = 0;
          return { data };
        },
      }),
      toBlob: (callback: (blob: Blob | null) => void, type: string, quality?: number) => {
        record.blobs.push({ type, quality });
        const head = type === 'image/png' ? PNG_HEAD : JPEG_HEAD;
        // Содержимое зависит от размеров, чтобы разные картинки получали разные id.
        callback(new Blob([new Uint8Array([...head, record.width & 255, record.width >> 8, record.height & 255, record.height >> 8])], { type }));
      },
    };
  };

  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement });
  return browser;
}

function imageFile(head: number[], tag: number, name: string): File {
  return file(new Uint8Array([...head, tag, 1, 2, 3]), name);
}

describe('importAsset: картинки', () => {
  it('картинка в пределах 2048 px сохраняется байт в байт, размеры измерены', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 1920, height: 1080 };
    const source = imageFile(PNG_HEAD, 1, 'плакат.png');
    const meta = await importAsset(source);
    expect(meta).toMatchObject({ kind: 'image', mime: 'image/png', name: 'плакат.png', width: 1920, height: 1080 });
    expect(meta.naturalSize).toBeUndefined();
    expect(Array.from(await bytesOf(meta.id))).toEqual(Array.from(new Uint8Array(await source.arrayBuffer())));
    expect(browser.canvases).toHaveLength(0);
    expect(state().assets.map((asset) => asset.id)).toEqual([meta.id]);
  });

  it('ровно 2048 px — без уменьшения', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 2048, height: 2048 };
    const meta = await importAsset(imageFile(JPEG_HEAD, 2, 'ровно.jpg'));
    expect(meta).toMatchObject({ mime: 'image/jpeg', width: 2048, height: 2048 });
    expect(browser.canvases).toHaveLength(0);
  });

  it('JPEG больше 2048 px уменьшается и сохраняется как JPEG 0.85', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 4096, height: 2048 };
    const meta = await importAsset(imageFile(JPEG_HEAD, 3, 'баннер.jpg'));
    expect(meta).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 2048, height: 1024 });
    expect(browser.canvases).toHaveLength(1);
    const canvas = browser.canvases[0];
    expect([canvas.width, canvas.height]).toEqual([2048, 1024]);
    expect(canvas.drawn).toHaveLength(1);
    expect(canvas.drawn[0].slice(1)).toEqual([0, 0, 2048, 1024]);
    expect(canvas.blobs).toEqual([{ type: 'image/jpeg', quality: 0.85 }]);
  });

  it('большой PNG с прозрачностью остаётся PNG', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 3000, height: 6000 };
    browser.transparent = true;
    const meta = await importAsset(imageFile(PNG_HEAD, 4, 'сова.png'));
    expect(meta).toMatchObject({ mime: 'image/png', width: 1024, height: 2048 });
    expect(browser.canvases[0].blobs).toEqual([{ type: 'image/png', quality: undefined }]);
  });

  it('большой WebP с прозрачностью тоже становится PNG', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 2500, height: 2500 };
    browser.transparent = true;
    const meta = await importAsset(imageFile(WEBP_HEAD, 5, 'знак.webp'));
    expect(meta).toMatchObject({ mime: 'image/png', width: 2048, height: 2048 });
  });

  it('большой PNG без прозрачных пикселей — JPEG 0.85', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 5000, height: 2500 };
    browser.transparent = false;
    const meta = await importAsset(imageFile(PNG_HEAD, 6, 'фото.png'));
    expect(meta).toMatchObject({ mime: 'image/jpeg', width: 2048, height: 1024 });
    expect(browser.canvases[0].blobs).toEqual([{ type: 'image/jpeg', quality: 0.85 }]);
  });

  it('большой JPEG на прозрачность не проверяется', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 2049, height: 100 };
    browser.transparent = true;
    const meta = await importAsset(imageFile(JPEG_HEAD, 7, 'полоса.jpg'));
    expect(meta.mime).toBe('image/jpeg');
    expect(meta).toMatchObject({ width: 2048, height: 100 });
  });

  it('битая картинка — отказ, ничего не сохраняется', async () => {
    const browser = stubBrowser();
    browser.natural = null;
    await expect(importAsset(imageFile(PNG_HEAD, 8, 'битая.png'))).rejects.toThrow(IMPORT_ERRORS.badImage);
    expect(await repository.listAssets()).toEqual([]);
    expect(state().assets).toEqual([]);
  });

  it('хранилище переполнено или недоступно — понятный текст', async () => {
    const browser = stubBrowser();
    browser.natural = { width: 10, height: 10 };
    const put = vi.spyOn(repository, 'putAsset');
    put.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'quota' }));
    await expect(importAsset(imageFile(PNG_HEAD, 9, 'a.png'))).rejects.toThrow(IMPORT_ERRORS.quota);
    put.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(importAsset(imageFile(PNG_HEAD, 9, 'a.png'))).rejects.toThrow(IMPORT_ERRORS.unavailable);
    put.mockRejectedValueOnce(new Error('что-то ещё'));
    await expect(importAsset(imageFile(PNG_HEAD, 9, 'a.png'))).rejects.toThrow(IMPORT_ERRORS.save);
    expect(state().assets).toEqual([]);
  });
});

// ---------- Действия полки ----------

async function putImage(width: number, height: number, tag: number, name = 'плакат.png'): Promise<AssetMeta> {
  const meta = await repository.putAsset(new Blob([new Uint8Array([...PNG_HEAD, tag])]), { kind: 'image', name, width, height });
  state().setAssets(await repository.listAssets());
  return meta;
}

async function putModel(tag: string, name = 'сова.glb'): Promise<AssetMeta> {
  return importAsset(file(modelBytes(tag), name));
}

function objectById(id: string | null) {
  const object = state().layout.objects.find((o) => o.id === id);
  if (!object) throw new Error('объект не создан');
  return object;
}

describe('shelfActions: добавление объектов', () => {
  it('«На стену»: image шириной 1 м с высотой по пропорциям файла', async () => {
    const asset = await putImage(2000, 1000, 20);
    const id = addImageObject(asset, false);
    const object = objectById(id);
    expect(object.type).toBe('image');
    expect(object.kind).toBe('image');
    expect(object.assetId).toBe(asset.id);
    expect(object.size).toEqual([1, 0.5, 0.02]);
    expect(object.name).toBe('плакат');
    expect(state().selectedId).toBe(id);
  });

  it('«Плашмя»: image.flat с глубиной по пропорциям файла', async () => {
    const asset = await putImage(1000, 1500, 21);
    const object = objectById(addImageObject(asset, true));
    expect(object.type).toBe('image.flat');
    expect(object.assetId).toBe(asset.id);
    expect(object.size).toEqual([1, 0.02, 1.5]);
    expect(object.mount.kind).not.toBe('wall');
  });

  it('«Добавить»: model с размером defaultModelSize(naturalSize)', async () => {
    const asset = await putModel('shelf-model');
    const object = objectById(addModelObject(asset));
    expect(object.type).toBe('model');
    expect(object.kind).toBe('model');
    expect(object.assetId).toBe(asset.id);
    object.size.forEach((side, i) => expect(side).toBeCloseTo(TRIANGLES_SIZE[i], 6));
    expect(object.name).toBe('сова');
  });

  it('модель не в метрах вписывается в 1 м, об этом сообщает тост', async () => {
    const asset = await putModel('centimetres');
    const object = objectById(addModelObject({ ...asset, naturalSize: [200, 100, 50] }));
    expect(object.size).toEqual([1, 0.5, 0.25]);
    expect(state().notice).toMatchObject({ level: 'info', text: SHELF_NOTES.rescaled });
  });

  it('модель в метрах добавляется без тоста', async () => {
    const asset = await putModel('metres');
    addModelObject(asset);
    expect(state().notice).toBeNull();
  });

  it('модель без габаритов в метаданных → куб 1 м', async () => {
    const asset = await putModel('no-size');
    const object = objectById(addModelObject({ ...asset, naturalSize: undefined }));
    expect(object.size).toEqual([1, 1, 1]);
  });

  it('файл не того вида — отказ', async () => {
    const image = await putImage(10, 10, 22);
    const model = await putModel('wrong-kind');
    const before = state().layout.objects.length;
    expect(addModelObject(image)).toBeNull();
    expect(state().notice).toMatchObject({ level: 'error', text: SHELF_ERRORS.notModel });
    expect(addImageObject(model, false)).toBeNull();
    expect(state().notice).toMatchObject({ level: 'error', text: SHELF_ERRORS.notImage });
    expect(state().layout.objects).toHaveLength(before);
  });

  it('в прогулке ничего не добавляется', async () => {
    const asset = await putImage(10, 10, 23);
    state().setCameraMode('walk');
    const before = state().layout.objects.length;
    expect(addImageObject(asset, false)).toBeNull();
    expect(state().layout.objects).toHaveLength(before);
  });
});

describe('shelfActions: удаление файла', () => {
  it('файл используется в текущем макете — отказ с его названием; после удаления объекта файл удаляется', async () => {
    const asset = await putImage(100, 100, 30);
    const id = addImageObject(asset, false);
    expect(id).not.toBeNull();

    expect(await removeAsset(asset.id)).toBe(false);
    expect(state().notice?.level).toBe('error');
    expect(state().notice?.text).toContain('«Тестовый макет»');
    expect(await repository.getAsset(asset.id)).not.toBeNull();
    expect(state().assets.map((a) => a.id)).toContain(asset.id);

    deleteObject(id as string);
    state().dismissNotice();
    expect(await removeAsset(asset.id)).toBe(true);
    expect(state().notice).toBeNull();
    expect(await repository.getAsset(asset.id)).toBeNull();
    expect(state().assets.map((a) => a.id)).not.toContain(asset.id);
    expect((await repository.listAssets()).map((a) => a.id)).not.toContain(asset.id);
  });

  it('файл используется в сохранённом макете — отказ с перечислением макетов', async () => {
    const asset = await putImage(100, 100, 31);
    addImageObject(asset, true);
    await repository.save({ ...state().layout, id: 'layout-saved-1', name: 'Хэллоуин' });
    await repository.save({ ...state().layout, id: 'layout-saved-2', name: 'Выпускной' });
    // Текущий макет файлом больше не пользуется.
    state().openLayout(createLayout(getRoom(state().roomId), 'Пустой'));

    expect(await removeAsset(asset.id)).toBe(false);
    const text = state().notice?.text ?? '';
    expect(text).toContain('«Хэллоуин»');
    expect(text).toContain('«Выпускной»');
    expect(text).not.toContain('«Пустой»');
    expect(await repository.getAsset(asset.id)).not.toBeNull();
  });

  it('остальные файлы библиотеки остаются', async () => {
    const keep = await putImage(10, 10, 32, 'keep.png');
    const drop = await putImage(10, 10, 33, 'drop.png');
    expect(await removeAsset(drop.id)).toBe(true);
    expect(state().assets.map((a) => a.id)).toEqual([keep.id]);
  });

  it('сбой хранилища — тост, библиотека не меняется', async () => {
    const asset = await putImage(10, 10, 34);
    vi.spyOn(repository, 'removeAsset').mockRejectedValueOnce(new Error('сбой'));
    expect(await removeAsset(asset.id)).toBe(false);
    expect(state().notice).toMatchObject({ level: 'error', text: SHELF_ERRORS.remove });
    expect(state().assets.map((a) => a.id)).toContain(asset.id);
  });
});

describe('shelfActions: загрузка пачки файлов', () => {
  it('годные файлы загружаются, отказы — одним тостом', async () => {
    const loaded = await uploadFiles([
      file(modelBytes('batch-1'), 'one.glb'),
      file(new TextEncoder().encode('мусор'), 'bad.txt'),
      file(modelBytes('batch-2'), 'two.glb'),
      file(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] }), 'draco.glb'),
    ]);
    expect(loaded.map((asset) => asset.name)).toEqual(['one.glb', 'two.glb']);
    expect(state().assets).toHaveLength(2);
    expect(state().notice?.level).toBe('error');
    expect(state().notice?.text).toBe(`«bad.txt»: ${UPLOAD_ERRORS.unknown} (и ещё не загружено: 1)`);
  });

  it('без отказов тоста нет', async () => {
    const loaded = await uploadFiles([file(modelBytes('batch-3'), 'three.glb')]);
    expect(loaded).toHaveLength(1);
    expect(state().notice).toBeNull();
    expect(await uploadFiles([])).toEqual([]);
  });
});
