import { useEffect, useMemo } from 'react';
import { CanvasTexture, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';
import { mix, shade } from '../model/color';
import { createRng } from '../model/rng';
import type { Rng } from '../model/rng';

/**
 * Процедурные текстуры помещения: кирпич колонн, крошка пола, складки штор. От фотографий не зависят.
 * Каждая рисуется на canvas один раз (useRoomTextures) и освобождается при размонтировании RoomShell.
 * Все три тайлятся; метрический размер одного повтора — в константах *_TILE, развёртку под него делает tiledPlane().
 */

// ---------- Кирпич ----------

/** Кирпич 25 × 6.5 см, шов 1 см. */
const BRICK_L = 0.25;
const BRICK_H = 0.065;
const JOINT = 0.01;
const BRICK_PX = 512;
/** В одном повторе 4 кирпича по ширине и 16 рядов (чётное число — ложковая перевязка сходится на стыке повторов). */
const BRICK_COLS = 4;
const BRICK_ROWS = 16;
/** Размер одного повтора кладки, м: [ширина, высота]. */
export const BRICK_TILE: readonly [number, number] = [BRICK_COLS * (BRICK_L + JOINT), BRICK_ROWS * (BRICK_H + JOINT)];
const BRICK_COLOR = '#9a4a35';
const MORTAR_COLOR = '#8d8780';

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступен');
  return { canvas, ctx };
}

function tiling(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Мелкий шум: n точек случайной яркости в прямоугольнике (x, y, w, h). */
function speckle(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, w: number, h: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const dark = rng.next() < 0.6;
    ctx.fillStyle = dark ? `rgba(30, 14, 10, ${(alpha * rng.range(0.4, 1)).toFixed(3)})` : `rgba(255, 214, 180, ${(alpha * rng.range(0.3, 0.8)).toFixed(3)})`;
    const s = rng.range(0.8, 2.6);
    ctx.fillRect(x + rng.next() * (w - s), y + rng.next() * (h - s), s, s);
  }
}

/** Кладка в ложковую перевязку: разброс цвета вокруг #9a4a35, серый шов. 512², тайлится. */
export function createBrickTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(BRICK_PX, BRICK_PX);
  const rng = createRng(20250511);
  const cellW = BRICK_PX / BRICK_COLS;
  const cellH = BRICK_PX / BRICK_ROWS;
  const jointX = (JOINT / (BRICK_L + JOINT)) * cellW;
  const jointY = (JOINT / (BRICK_H + JOINT)) * cellH;

  ctx.fillStyle = MORTAR_COLOR;
  ctx.fillRect(0, 0, BRICK_PX, BRICK_PX);
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(-22, 18);
    ctx.fillStyle = v < 0 ? `rgba(0, 0, 0, ${(-v / 110).toFixed(3)})` : `rgba(255, 255, 255, ${(v / 110).toFixed(3)})`;
    ctx.fillRect(rng.next() * BRICK_PX, rng.next() * BRICK_PX, rng.range(1, 3), rng.range(1, 3));
  }

  for (let row = 0; row < BRICK_ROWS; row++) {
    const shift = row % 2 === 0 ? 0 : cellW / 2;
    const y = row * cellH + jointY / 2;
    const h = cellH - jointY;
    for (let col = 0; col < BRICK_COLS; col++) {
      // Цвет кирпича: темнее / светлее основы, изредка закопчённый или пережжённый (оранжевый).
      const roll = rng.next();
      let color = shade(BRICK_COLOR, rng.range(0.82, 1.16));
      if (roll < 0.14) color = mix(color, '#4b2a24', rng.range(0.35, 0.7));
      else if (roll < 0.32) color = mix(color, '#c0683f', rng.range(0.3, 0.65));
      else if (roll < 0.4) color = mix(color, '#b9897a', rng.range(0.2, 0.45));
      const x = col * cellW + shift + jointX / 2 + rng.range(-0.8, 0.8);
      const w = cellW - jointX + rng.range(-1.2, 0.6);
      const top = y + rng.range(-0.5, 0.5);
      // Кирпич, пересекающий правый край, дорисовывается слева — стык повторов не виден.
      for (const dx of x + w > BRICK_PX ? [0, -BRICK_PX] : [0]) {
        const bx = x + dx;
        ctx.fillStyle = color;
        ctx.fillRect(bx, top, w, h);
        // Объём: светлая кромка сверху, тень снизу и справа.
        ctx.fillStyle = 'rgba(255, 220, 190, 0.16)';
        ctx.fillRect(bx, top, w, 1.6);
        ctx.fillStyle = 'rgba(20, 8, 6, 0.3)';
        ctx.fillRect(bx, top + h - 1.8, w, 1.8);
        ctx.fillStyle = 'rgba(20, 8, 6, 0.18)';
        ctx.fillRect(bx + w - 1.6, top, 1.6, h);
      }
      // Шум одним и тем же генератором для обеих копий не нужен: копия за левым краем закрывает только свою часть.
      const sx = x + w > BRICK_PX ? x - BRICK_PX : x;
      speckle(ctx, rng, x, top, w, h, 34, 0.3);
      if (sx !== x) speckle(ctx, rng, sx, top, w, h, 34, 0.3);
    }
  }
  return tiling(canvas, 8);
}

// ---------- Пол: мозаичная крошка ----------

const TERRAZZO_PX = 1024;
/** Сторона одного повтора пола, м. */
export const TERRAZZO_TILE = 2;

/** Неправильный многоугольник-крошка; у края дорисовывается с противоположной стороны (тайлится). */
function chip(ctx: CanvasRenderingContext2D, rng: Rng, size: number, color: string): void {
  const cx = rng.next() * TERRAZZO_PX;
  const cy = rng.next() * TERRAZZO_PX;
  const n = rng.int(4, 6);
  const start = rng.next() * Math.PI * 2;
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = size * rng.range(0.45, 1);
    points.push([Math.cos(a) * r, Math.sin(a) * r * rng.range(0.6, 1)]);
  }
  const xs = cx < size ? [0, TERRAZZO_PX] : cx > TERRAZZO_PX - size ? [0, -TERRAZZO_PX] : [0];
  const ys = cy < size ? [0, TERRAZZO_PX] : cy > TERRAZZO_PX - size ? [0, -TERRAZZO_PX] : [0];
  ctx.fillStyle = color;
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.beginPath();
      points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(cx + dx + px, cy + dy + py) : ctx.lineTo(cx + dx + px, cy + dy + py)));
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Бежевая основа floorColor, тёмная и светлая крошка. 1024², повтор каждые 2 м. */
export function createTerrazzoTexture(floorColor: string): CanvasTexture {
  const { canvas, ctx } = canvas2d(TERRAZZO_PX, TERRAZZO_PX);
  const rng = createRng(7741);
  ctx.fillStyle = floorColor;
  ctx.fillRect(0, 0, TERRAZZO_PX, TERRAZZO_PX);

  // Крупные мягкие пятна — затёртости бетона; у краёв повторяются с другой стороны.
  for (let i = 0; i < 46; i++) {
    const r = rng.range(60, 190);
    const cx = rng.next() * TERRAZZO_PX;
    const cy = rng.next() * TERRAZZO_PX;
    const dark = rng.next() < 0.55;
    const alpha = rng.range(0.03, 0.08);
    for (const dx of [-TERRAZZO_PX, 0, TERRAZZO_PX]) {
      for (const dy of [-TERRAZZO_PX, 0, TERRAZZO_PX]) {
        const x = cx + dx;
        const y = cy + dy;
        if (x + r < 0 || x - r > TERRAZZO_PX || y + r < 0 || y - r > TERRAZZO_PX) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? `rgba(40, 32, 26, ${alpha.toFixed(3)})` : `rgba(255, 250, 240, ${alpha.toFixed(3)})`);
        g.addColorStop(1, dark ? 'rgba(40, 32, 26, 0)' : 'rgba(255, 250, 240, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }

  const dark = [shade(floorColor, 0.36), shade(floorColor, 0.5), shade(floorColor, 0.62), '#3a3430'];
  const light = [mix(floorColor, '#ffffff', 0.55), mix(floorColor, '#fff6e0', 0.75), mix(floorColor, '#ffffff', 0.35)];
  const warm = [mix(floorColor, '#8a5a3c', 0.6), mix(floorColor, '#a2543d', 0.5)];
  // Мелкая «соль и перец», затем крошка покрупнее (1 px ≈ 2 мм).
  for (let i = 0; i < 9000; i++) chip(ctx, rng, rng.range(0.8, 1.8), rng.next() < 0.6 ? rng.pick(dark) : rng.pick(light));
  for (let i = 0; i < 2600; i++) chip(ctx, rng, rng.range(1.8, 4.2), rng.pick(dark));
  for (let i = 0; i < 2100; i++) chip(ctx, rng, rng.range(1.8, 4.8), rng.pick(light));
  for (let i = 0; i < 700; i++) chip(ctx, rng, rng.range(1.6, 4), rng.pick(warm));
  return tiling(canvas, 8);
}

// ---------- Шторы ----------

/** Шаг складки шторы, м. */
export const CURTAIN_FOLD = 0.18;
/** Наибольшее смещение складки от плоскости панели в комнату, м (гребень: PANEL_GAP + 0.015 < WALL_GAP). */
export const CURTAIN_DEPTH = 0.015;
const CURTAIN_FOLDS = 8;
/** Ширина одного повтора текстуры шторы, м: целое число складок. */
export const CURTAIN_TILE = CURTAIN_FOLD * CURTAIN_FOLDS;
const CURTAIN_PX = 512;

/** Смещение складки в точке x (м от левого края шторы): 0…CURTAIN_DEPTH, только от стены в комнату. */
export function curtainOffset(x: number): number {
  return (CURTAIN_DEPTH / 2) * (1 + Math.sin((x / CURTAIN_FOLD) * Math.PI * 2));
}

/**
 * Вертикальные светло-тёмные полосы, совпадающие по фазе со складками curtainOffset(): гребень светлый, впадина
 * тёмная. Серая: умножается на цвет панели (map × color). 512 × 16, тайлится по ширине.
 */
export function createCurtainTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(CURTAIN_PX, 16);
  const rng = createRng(4099);
  // У каждой складки своя глубина тени — ткань висит неровно.
  const depth = Array.from({ length: CURTAIN_FOLDS }, () => rng.range(0.34, 0.52));
  for (let x = 0; x < CURTAIN_PX; x++) {
    const t = ((x + 0.5) / CURTAIN_PX) * CURTAIN_FOLDS;
    const fold = Math.floor(t) % CURTAIN_FOLDS;
    const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    // Свет падает чуть сбоку: склон складки, обращённый к свету, ярче.
    const side = 0.06 * Math.cos(t * Math.PI * 2);
    const v = Math.max(0, Math.min(1, 1 - depth[fold] * (1 - wave) ** 1.4 + side));
    const level = Math.round(v * 255);
    ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
    ctx.fillRect(x, 0, 1, 16);
  }
  return tiling(canvas, 4);
}

// ---------- Геометрия под тайлящиеся текстуры ----------

/**
 * Плоскость width × height в плоскости XY (нормаль +Z) с развёрткой в метрах: один повтор текстуры на
 * tileW × tileH. Одна текстура обслуживает грани любого размера — без клонов с разным repeat.
 */
export function tiledPlane(width: number, height: number, tileW: number, tileH: number, segments = 1): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height, segments, 1);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / tileW, (uv.getY(i) * height) / tileH);
  uv.needsUpdate = true;
  return geometry;
}

/** Число сегментов шторы по ширине. */
export const CURTAIN_SEGMENTS = 48;

/** Штора: плоскость с 48 сегментами по ширине, складки смещены только в +Z (от стены в комнату) на 0…1.5 см. */
export function curtainGeometry(width: number, height: number): PlaneGeometry {
  const geometry = tiledPlane(width, height, CURTAIN_TILE, height, CURTAIN_SEGMENTS);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) position.setZ(i, curtainOffset(position.getX(i) + width / 2));
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// ---------- Жизненный цикл ----------

export interface RoomTextures {
  brick: CanvasTexture;
  curtain: CanvasTexture;
  /** null — пол одноцветный (floorSurface не 'terrazzo'). */
  terrazzo: CanvasTexture | null;
}

/** Создаёт процедурные текстуры один раз на помещение и освобождает их при размонтировании (или смене пола). */
export function useRoomTextures(floorSurface: 'plain' | 'terrazzo', floorColor: string): RoomTextures {
  const textures = useMemo<RoomTextures>(
    () => ({
      brick: createBrickTexture(),
      curtain: createCurtainTexture(),
      terrazzo: floorSurface === 'terrazzo' ? createTerrazzoTexture(floorColor) : null,
    }),
    [floorSurface, floorColor],
  );
  useEffect(
    () => () => {
      textures.brick.dispose();
      textures.curtain.dispose();
      textures.terrazzo?.dispose();
    },
    [textures],
  );
  return textures;
}
