import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS } from '../model/assets';
import { MAX_SIZE, MIN_SIZE } from '../model/ops';
import {
  ACCEPTED_EXTENSIONS,
  HEAVY_MODEL_TRIANGLES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ERRORS,
  assetCaption,
  classifyUpload,
  fitImage,
  formatBytes,
  imageObjectSize,
  kindOfMime,
  mimeHasAlpha,
  objectNameOf,
  uploadFailureMessage,
  usageMessage,
} from './rules';
import { glb, gltfText } from './testModels';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function bytesOf(signature: number[], length = signature.length): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(signature, 0);
  return bytes;
}

describe('константы загрузки', () => {
  it('поле выбора принимает .glb, .gltf, .png, .jpg, .jpeg, .webp', () => {
    expect(ACCEPTED_EXTENSIONS.split(',').sort()).toEqual(['.glb', '.gltf', '.jpeg', '.jpg', '.png', '.webp']);
  });

  it('тяжёлая модель — больше 300 тыс. треугольников', () => {
    expect(HEAVY_MODEL_TRIANGLES).toBe(300_000);
  });

  it('файл больше обоих пределов отвергается, не читаясь', () => {
    expect(MAX_UPLOAD_BYTES).toBe(Math.max(ASSET_LIMITS.imageBytes, ASSET_LIMITS.modelBytes));
  });
});

describe('classifyUpload', () => {
  it('тип — по сигнатуре содержимого', () => {
    expect(classifyUpload(bytesOf(PNG))).toEqual({ kind: 'image', mime: 'image/png' });
    expect(classifyUpload(bytesOf(JPEG))).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(classifyUpload(bytesOf(WEBP))).toEqual({ kind: 'image', mime: 'image/webp' });
    expect(classifyUpload(new Uint8Array(glb({ asset: { version: '2.0' } })))).toEqual({ kind: 'model', mime: 'model/gltf-binary' });
    expect(classifyUpload(new Uint8Array(gltfText({ asset: { version: '2.0' } })))).toEqual({ kind: 'model', mime: 'model/gltf+json' });
  });

  it('пустой файл и неизвестный формат (в том числе SVG) — отказ', () => {
    expect(() => classifyUpload(new Uint8Array(0))).toThrow(UPLOAD_ERRORS.empty);
    expect(() => classifyUpload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toThrow(UPLOAD_ERRORS.unknown);
    expect(() => classifyUpload(new TextEncoder().encode('{"не": "glTF"}'))).toThrow(UPLOAD_ERRORS.unknown);
    expect(() => classifyUpload(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toThrow(UPLOAD_ERRORS.unknown); // GIF
  });

  it('картинка больше imageBytes — отказ; ровно предел — принимается', () => {
    expect(classifyUpload(bytesOf(PNG, ASSET_LIMITS.imageBytes)).kind).toBe('image');
    expect(() => classifyUpload(bytesOf(PNG, ASSET_LIMITS.imageBytes + 1))).toThrow(UPLOAD_ERRORS.imageTooBig);
    expect(() => classifyUpload(bytesOf(JPEG, ASSET_LIMITS.imageBytes + 1))).toThrow(UPLOAD_ERRORS.imageTooBig);
  });

  it('модель больше modelBytes — отказ; модель больше предела картинок — принимается', () => {
    const header = Array.from(new Uint8Array(glb({ asset: { version: '2.0' } })));
    expect(classifyUpload(bytesOf(header, ASSET_LIMITS.imageBytes + 1)).kind).toBe('model');
    expect(classifyUpload(bytesOf(header, ASSET_LIMITS.modelBytes)).kind).toBe('model');
    expect(() => classifyUpload(bytesOf(header, ASSET_LIMITS.modelBytes + 1))).toThrow(UPLOAD_ERRORS.modelTooBig);
  });

  it('тексты отказов называют предел в мегабайтах', () => {
    expect(UPLOAD_ERRORS.imageTooBig).toBe('Картинка больше 15 МБ');
    expect(UPLOAD_ERRORS.modelTooBig).toBe('Модель больше 40 МБ');
    expect(UPLOAD_ERRORS.fileTooBig).toBe('Файл больше 40 МБ');
  });
});

describe('kindOfMime / mimeHasAlpha', () => {
  it('вид файла по mime', () => {
    expect(kindOfMime('image/png')).toBe('image');
    expect(kindOfMime('image/jpeg')).toBe('image');
    expect(kindOfMime('image/webp')).toBe('image');
    expect(kindOfMime('model/gltf-binary')).toBe('model');
    expect(kindOfMime('model/gltf+json')).toBe('model');
  });

  it('альфа-канал бывает у PNG и WebP', () => {
    expect(mimeHasAlpha('image/png')).toBe(true);
    expect(mimeHasAlpha('image/webp')).toBe(true);
    expect(mimeHasAlpha('image/jpeg')).toBe(false);
    expect(mimeHasAlpha('')).toBe(false);
  });
});

describe('fitImage', () => {
  it('картинка в пределах 2048 px не меняется', () => {
    expect(fitImage(2048, 1024)).toEqual({ width: 2048, height: 1024, resized: false });
    expect(fitImage(100, 2048)).toEqual({ width: 100, height: 2048, resized: false });
    expect(fitImage(1, 1)).toEqual({ width: 1, height: 1, resized: false });
  });

  it('большая картинка уменьшается до 2048 по наибольшей стороне с сохранением пропорций', () => {
    expect(fitImage(4096, 2048)).toEqual({ width: 2048, height: 1024, resized: true });
    expect(fitImage(3000, 6000)).toEqual({ width: 1024, height: 2048, resized: true });
    expect(fitImage(2049, 2049)).toEqual({ width: 2048, height: 2048, resized: true });
    const odd = fitImage(5000, 3333);
    expect(odd.width).toBe(2048);
    expect(odd.height).toBe(Math.round((3333 * 2048) / 5000));
  });

  it('очень вытянутая картинка не теряет сторону до нуля', () => {
    expect(fitImage(100_000, 10)).toEqual({ width: 2048, height: 1, resized: true });
  });

  it('предел задаётся параметром', () => {
    expect(fitImage(800, 400, 200)).toEqual({ width: 200, height: 100, resized: true });
  });
});

describe('imageObjectSize', () => {
  it('стоячая: [1, h/w, 0.02]; лежачая: [1, 0.02, h/w]', () => {
    expect(imageObjectSize(2000, 1000, false)).toEqual([1, 0.5, 0.02]);
    expect(imageObjectSize(2000, 1000, true)).toEqual([1, 0.02, 0.5]);
    expect(imageObjectSize(1000, 1500, false)).toEqual([1, 1.5, 0.02]);
    expect(imageObjectSize(512, 512, true)).toEqual([1, 0.02, 1]);
  });

  it('размеры неизвестны или не числа → квадрат 1 × 1', () => {
    expect(imageObjectSize(undefined, undefined, false)).toEqual([1, 1, 0.02]);
    expect(imageObjectSize(100, undefined, true)).toEqual([1, 0.02, 1]);
    expect(imageObjectSize(0, 100, false)).toEqual([1, 1, 0.02]);
    expect(imageObjectSize(Number.NaN, 100, false)).toEqual([1, 1, 0.02]);
  });

  it('очень вытянутая картинка сохраняет пропорции и остаётся в пределах размера объекта', () => {
    // 1 × 50: высота ограничена MAX_SIZE, ширина уменьшается пропорционально.
    const tall = imageObjectSize(100, 5000, false);
    expect(tall[1]).toBe(MAX_SIZE);
    expect(tall[1] / tall[0]).toBeCloseTo(50, 9);
    // 1000 × 1: высота поднята до MAX_SIZE-совместимого минимума, ширина растёт пропорционально.
    const wide = imageObjectSize(2000, 4, true);
    expect(wide[2]).toBe(MIN_SIZE);
    expect(wide[2] / wide[0]).toBeCloseTo(4 / 2000, 9);
    for (const size of [tall, wide, imageObjectSize(1, 1_000_000, false), imageObjectSize(1_000_000, 1, false)]) {
      for (const side of size) {
        expect(side).toBeGreaterThanOrEqual(MIN_SIZE);
        expect(side).toBeLessThanOrEqual(MAX_SIZE);
      }
    }
  });
});

describe('objectNameOf', () => {
  it('имя файла без расширения', () => {
    expect(objectNameOf('Плакат розыска.png', 'Картинка')).toBe('Плакат розыска');
    expect(objectNameOf('owl.final.glb', '3D-модель')).toBe('owl.final');
    expect(objectNameOf('без расширения', 'Картинка')).toBe('без расширения');
  });

  it('пустое имя → запасное', () => {
    expect(objectNameOf('.png', 'Картинка')).toBe('Картинка');
    expect(objectNameOf('   ', '3D-модель')).toBe('3D-модель');
    expect(objectNameOf('', 'Картинка')).toBe('Картинка');
  });
});

describe('подписи и сообщения полки', () => {
  it('formatBytes: килобайты и мегабайты с запятой', () => {
    expect(formatBytes(0)).toBe('0 КБ');
    expect(formatBytes(10)).toBe('1 КБ');
    expect(formatBytes(860_160)).toBe('840 КБ');
    expect(formatBytes(3_355_443)).toBe('3,2 МБ');
    expect(formatBytes(ASSET_LIMITS.modelBytes)).toBe('40,0 МБ');
    expect(formatBytes(Number.NaN)).toBe('0 КБ');
  });

  it('assetCaption: пиксели картинки или габариты модели и размер файла', () => {
    expect(assetCaption({ kind: 'image', bytes: 860_160, width: 1920, height: 1080 })).toBe('1920 × 1080 · 840 КБ');
    expect(assetCaption({ kind: 'model', bytes: 3_355_443, naturalSize: [1.2, 0.85, 0.5] })).toBe('1,2 × 0,85 × 0,5 м · 3,2 МБ');
    expect(assetCaption({ kind: 'image', bytes: 2048 })).toBe('2 КБ');
    expect(assetCaption({ kind: 'model', bytes: 2048 })).toBe('2 КБ');
  });

  it('usageMessage перечисляет макеты, длинный список сокращает', () => {
    expect(usageMessage(['Хэллоуин'])).toBe('Файл используется в макете: «Хэллоуин». Сначала удалите его объекты');
    expect(usageMessage(['А', 'Б'])).toBe('Файл используется в макетах: «А», «Б». Сначала удалите его объекты');
    expect(usageMessage(['1', '2', '3', '4', '5', '6'])).toBe(
      'Файл используется в макетах: «1», «2», «3», «4» и ещё 2. Сначала удалите его объекты',
    );
  });

  it('uploadFailureMessage: первая ошибка и число остальных', () => {
    expect(uploadFailureMessage([{ name: 'a.glb', message: 'Это не файл glTF 2.0' }])).toBe('«a.glb»: Это не файл glTF 2.0');
    expect(
      uploadFailureMessage([
        { name: 'a.glb', message: 'Это не файл glTF 2.0' },
        { name: 'b.png', message: 'Картинка больше 15 МБ' },
        { name: 'c.txt', message: 'x' },
      ]),
    ).toBe('«a.glb»: Это не файл glTF 2.0 (и ещё не загружено: 2)');
  });
});
