// Canvas-текстуры частей каталога: paint → CanvasTexture. Общий кэш на все объекты, LRU с dispose
// (текстовые параметры иначе плодили бы по текстуре на каждое нажатие клавиши).
import { CanvasTexture, DataTexture, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { getPainter } from '../../catalog';
import type { PaintRef } from '../../catalog/types';
import { LruCache } from './lru';
import { paintKey } from './partGroups';

/** Сколько текстур держит кэш. */
export const TEXTURE_CACHE_SIZE = 96;
/** Предел стороны canvas: больше не нужно ни одному предмету, а память видеокарты не бесконечна. */
const MAX_TEXTURE_SIDE = 4096;

// Вытесненная текстура, которая ещё на сцене, просто загрузится в видеокарту заново при следующем кадре.
const cache = new LruCache<Texture>(TEXTURE_CACHE_SIZE, (texture) => texture.dispose());
const warned = new Set<string>();

function warnOnce(key: string, message: string, detail?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (detail === undefined) console.warn(message);
  else console.warn(message, detail);
}

function side(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_TEXTURE_SIDE, Math.max(1, Math.round(value))) : 1;
}

/** Однотонная белая текстура: цвет части (instanceColor) остаётся виден как есть. */
function plainTexture(): Texture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function paintTexture(paint: PaintRef): Texture {
  const painter = getPainter(paint.painter);
  if (!painter) {
    warnOnce(`painter:${paint.painter}`, `Неизвестный painter «${paint.painter}» — рисуется однотонная текстура`);
    return plainTexture();
  }
  // Вне браузера (тесты в Node) рисовать не на чем.
  if (typeof document === 'undefined') return plainTexture();

  const canvas = document.createElement('canvas');
  canvas.width = side(paint.px[0]);
  canvas.height = side(paint.px[1]);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    warnOnce('canvas-2d', 'Не удалось получить 2D-контекст canvas — текстуры предметов будут однотонными');
    return plainTexture();
  }
  try {
    painter(ctx, canvas.width, canvas.height, paint.args ?? {});
  } catch (error) {
    warnOnce(`throw:${paint.painter}`, `Painter «${paint.painter}» завершился с ошибкой — рисуется однотонная текстура`, error);
    return plainTexture();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Текстура по ссылке paint; одинаковые painter + args + px дают один и тот же объект, пока он не вытеснен. */
export function getTexture(paint: PaintRef): Texture {
  const key = paintKey(paint);
  let texture = cache.get(key);
  if (!texture) {
    texture = paintTexture(paint);
    cache.set(key, texture);
  }
  return texture;
}
