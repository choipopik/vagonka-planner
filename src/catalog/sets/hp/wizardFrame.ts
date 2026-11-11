import { clamp } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Params } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import {
  INK,
  SERIF,
  argColor,
  argText,
  drawFitted,
  drawLines,
  glyphs,
  guarded,
  paintParchment,
  paintStar,
  paramNumber,
  rgba,
  splitBalanced,
} from './paper';

// 4.7 «Фоторамка „Have you seen this wizard?“»: пергаментный щит с настоящей дырой на двух ножках с подкосами.
// Фигура (resize: 'uniform'): все размеры выводятся из size; k = h / 1.9. Параметр `legs` задан в метрах для
// размера по умолчанию и масштабируется вместе с фигурой.

const DEFAULT_COLOR = '#cdb58a';
const TIMBER = '#c9a36b';
const STRUT_ANGLE = (20 * Math.PI) / 180;
const TITLE_MAX = 60;
const PLATE_MAX = 30;
const NUMBER_MAX = 8;

/** Текстовый параметр, обрезанный по глифам (в аргументы painter'а не должен попасть текст на 4000 знаков). */
function textParam(params: Params, key: string, fallback: string, max: number): string {
  const value = params[key];
  return glyphs((typeof value === 'string' ? value : fallback).replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function build(input: BuildInput): Part[] {
  const w = Math.max(input.size[0], 0.01);
  const h = Math.max(input.size[1], 0.01);
  const d = Math.max(input.size[2], 0.01);
  const k = h / 1.9;
  const { params } = input;
  const color = argColor({ color: input.color }, 'color', DEFAULT_COLOR);
  const legs = clamp(paramNumber(params, 'legs', 0.3), 0, 0.6) * k;
  /** Высота щита. */
  const B = h - legs;
  const t = 0.02 * k;
  // Щит стоит у переднего края габарита (табличка выступает перед ним ещё на 2 см), подкосы уходят назад.
  const z0 = Math.max(0, d / 2 - 0.03 * k);
  const white = '#ffffff';
  const parts: Part[] = [];

  // ---------- Щит: четыре бокса вокруг настоящей дыры ----------
  const bottomH = 0.21 * B;
  const sideH = 0.52 * B;
  const topH = B - bottomH - sideH;
  parts.push({
    shape: 'box',
    position: [0, h - topH / 2, z0],
    size: [w, topH, t],
    color: white,
    roughness: 0.9,
    paint: { painter: 'hp.frameTop', args: { title: textParam(params, 'title', '', TITLE_MAX), color }, px: [768, 256] },
  });
  parts.push({
    shape: 'box',
    position: [0, legs + bottomH / 2, z0],
    size: [w, bottomH, t],
    color: white,
    roughness: 0.9,
    paint: { painter: 'hp.frameBottom', args: { color }, px: [768, 200] },
  });
  for (const side of [-1, 1]) {
    parts.push({
      shape: 'box',
      position: [side * 0.44 * w, legs + bottomH + sideH / 2, z0],
      size: [0.12 * w, sideH, t],
      color: white,
      roughness: 0.9,
      paint: { painter: 'hp.parchment', args: { color }, px: [128, 512] },
    });
  }

  // ---------- Табличка с номером: свисает в низ дыры, чуть перекрывая нижнюю планку ----------
  const plateH = 0.13 * B;
  parts.push({
    shape: 'box',
    position: [0, legs + bottomH + plateH / 2 - 0.02 * B, z0 + 0.012 * k],
    size: [0.42 * w, plateH, 0.015 * k],
    color: white,
    roughness: 0.8,
    paint: {
      painter: 'hp.framePlate',
      args: { plate: textParam(params, 'plate', '', PLATE_MAX), number: textParam(params, 'number', '', NUMBER_MAX) },
      px: [512, 160],
    },
  });

  // ---------- Ножки и задние подкосы (брус) ----------
  const legH = legs + 0.3 * k;
  const legZ = z0 - t;
  // Подкос — от задней стороны щита до пола у заднего края габарита, под 20° к вертикали (круче, если габарит мелкий).
  const run = Math.max(0.001 * k, legZ - t / 2 + d / 2 - 0.02 * k);
  // Ось подкоса начинается на полтолщины бруса выше пола: наклонённый брус не уходит под пол.
  const foot = t / 2;
  const rise = Math.max(0.001 * k, Math.min(run / Math.tan(STRUT_ANGLE), legs + 0.6 * B) - foot);
  const angle = Math.atan2(run, rise);
  const strutLength = Math.hypot(run, rise);
  for (const side of [-1, 1]) {
    const x = side * 0.4 * w;
    parts.push({ shape: 'box', position: [x, legH / 2, legZ], size: [0.07 * k, legH, t], color: TIMBER, roughness: 0.8 });
    parts.push({
      shape: 'box',
      position: [x, foot + rise / 2, legZ - t / 2 - run / 2],
      size: [0.05 * k, strutLength, t],
      rotation: [angle, 0, 0],
      color: TIMBER,
      roughness: 0.8,
    });
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.wizardFrame',
  kind: 'preset',
  title: 'Фоторамка „Have you seen this wizard?“',
  category: 'Гарри Поттер',
  size: [1.2, 1.9, 0.4],
  resize: 'uniform',
  color: DEFAULT_COLOR,
  mounts: ['floor'],
  params: [
    { key: 'legs', label: 'Ножки, м', type: 'number', min: 0, max: 0.6, step: 0.05, default: 0.3 },
    { key: 'title', label: 'Заголовок', type: 'text', default: 'HAVE YOU SEEN THIS WIZARD?' },
    { key: 'plate', label: 'Табличка', type: 'text', default: 'AZKABAN PRISON' },
    { key: 'number', label: 'Номер', type: 'text', default: 'ᛈᚹ390' },
  ],
  build,
};

// ---------- Painters ----------

const bold = (px: number) => `700 ${px}px ${SERIF}`;
const plain = (px: number) => `${px}px ${SERIF}`;
const TITLE_INK = '#3a2a1a';

const paintTop: Painter = (ctx, w, h, args) => {
  paintParchment(ctx, w, h, argColor(args, 'color', DEFAULT_COLOR), 11);
  const title = argText(args, 'title', '', 2 * TITLE_MAX).toUpperCase();
  const length = glyphs(title).length;
  // Как на референсе: длинный заголовок — в три строки крупными буквами.
  const lines = splitBalanced(title, length > 20 ? 3 : length > 10 ? 2 : 1);
  ctx.fillStyle = TITLE_INK;
  drawLines(ctx, lines, w * 0.06, h * 0.07, w * 0.88, h * 0.86, bold, 1.02);
};

const paintBottom: Painter = (ctx, w, h, args) => {
  paintParchment(ctx, w, h, argColor(args, 'color', DEFAULT_COLOR), 12);
  // Чёрная полоса-предупреждение со звёздами по краям.
  const x = w * 0.18;
  const y = h * 0.1;
  const stripW = w * 0.64;
  const stripH = h * 0.36;
  ctx.fillStyle = '#1d1813';
  ctx.fillRect(x, y, stripW, stripH);
  ctx.fillStyle = '#eadcbc';
  paintStar(ctx, x + stripH * 0.5, y + stripH * 0.5, stripH * 0.24);
  paintStar(ctx, x + stripW - stripH * 0.5, y + stripH * 0.5, stripH * 0.24);
  drawLines(
    ctx,
    ['APPROACH WITH EXTREME CAUTION', 'DO NOT USE MAGIC AGAINST THIS WIZARD!'],
    x + stripH,
    y + stripH * 0.08,
    stripW - 2 * stripH,
    stripH * 0.84,
    bold,
    1.25,
  );
  // Мелкий текст под полосой.
  ctx.fillStyle = INK;
  drawLines(
    ctx,
    ['Any information leading to the arrest of this wizard', 'will be duly rewarded', 'Notify the Ministry of Magic by owl at once'],
    w * 0.2,
    h * 0.52,
    w * 0.6,
    h * 0.38,
    plain,
    1.25,
  );
};

const paintPlate: Painter = (ctx, w, h, args) => {
  // Тёмная тюремная табличка: светлая кайма, название, номер по клеткам.
  ctx.fillStyle = '#463a2d';
  ctx.fillRect(0, 0, w, h);
  const rng = createRng(13);
  for (let index = 0; index < 60; index++) {
    ctx.fillStyle = rgba(index % 2 === 0 ? '#000000' : '#c9b48a', rng.range(0.04, 0.12));
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(4, 40), rng.range(1, 3));
  }
  ctx.strokeStyle = '#d9c79c';
  ctx.lineWidth = Math.max(1, h * 0.02);
  const inset = h * 0.05;
  ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);

  ctx.fillStyle = '#eadcbc';
  drawFitted(ctx, argText(args, 'plate', '', 2 * PLATE_MAX).toUpperCase(), w / 2, h * 0.21, w * 0.84, h * 0.2, bold);

  const cells = glyphs(argText(args, 'number', '', 4 * NUMBER_MAX)).slice(0, NUMBER_MAX);
  if (cells.length > 0) {
    const cellH = h * 0.42;
    const cellW = Math.min(cellH * 0.95, (w * 0.86) / cells.length);
    const left = w / 2 - (cellW * cells.length) / 2;
    const top = h * 0.36;
    cells.forEach((glyph, index) => {
      const cx = left + index * cellW;
      ctx.fillStyle = '#d9c79c';
      ctx.fillRect(cx + cellW * 0.04, top, cellW * 0.92, cellH);
      ctx.strokeStyle = '#2a2118';
      ctx.lineWidth = Math.max(1, h * 0.012);
      ctx.strokeRect(cx + cellW * 0.04, top, cellW * 0.92, cellH);
      ctx.fillStyle = '#2a2118';
      drawFitted(ctx, glyph, cx + cellW / 2, top + cellH * 0.54, cellW * 0.7, cellH * 0.78, bold);
    });
  }
  // Строка мелких «знаков» под номером.
  ctx.fillStyle = rgba('#eadcbc', 0.75);
  for (let x = w * 0.1; x < w * 0.9; x += rng.range(8, 16)) {
    ctx.fillRect(x, h * 0.84 + rng.range(-1, 1), rng.range(2, 7), Math.max(1, h * 0.025));
  }
};

const paintPlain: Painter = (ctx, w, h, args) => {
  paintParchment(ctx, w, h, argColor(args, 'color', DEFAULT_COLOR), 14);
};

export const painters: Record<string, Painter> = {
  /** Верхняя планка рамки: пергамент и заголовок; args: title, color. */
  'hp.frameTop': guarded('hp.frameTop', DEFAULT_COLOR, paintTop),
  /** Нижняя планка: чёрная полоса-предупреждение и мелкий текст; args: color. */
  'hp.frameBottom': guarded('hp.frameBottom', DEFAULT_COLOR, paintBottom),
  /** Табличка с номером; args: plate, number. */
  'hp.framePlate': guarded('hp.framePlate', '#463a2d', paintPlate),
  /** Чистый пергамент (боковины рамки); args: color. */
  'hp.parchment': guarded('hp.parchment', DEFAULT_COLOR, paintPlain),
};
