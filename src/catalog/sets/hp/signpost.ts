import { clamp } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { SERIF, argColor, argNumber, argText, glyphs, guarded, paramNumber } from './paper';

// 4.5 «Указатель»: плоская чёрная картонная вырезка — столб на холме и таблички-стрелки с надписями «от руки».
// Фигура (resize: 'uniform'): все размеры выводятся из size; k = h / 1.8.

const BOARDS = [
  'Хогвартс',
  'Косой переулок',
  'Хогсмид',
  'Гринготтс',
  'Азкабан',
  'Министерство магии',
  'Платформа 9¾',
  'Хижина Хагрида',
].join('\n');

export const MAX_BOARDS = 10;
/** Предел длины надписи в глифах: длиннее на табличке всё равно не прочитать. */
const MAX_GLYPHS = 40;
const MAX_ROLL = (6 * Math.PI) / 180;
const BOARD_PX: [number, number] = [512, 128];
const MOUND_PX: [number, number] = [256, 128];
const DEFAULT_BOARD = '#141414';
const DEFAULT_TEXT = '#f4f1ea';

/** Непустые строки параметра `boards` — по табличке на строку, не больше десяти. */
export function boardLines(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const text = glyphs(raw.trim().replace(/\s+/g, ' ')).slice(0, MAX_GLYPHS).join('').trim();
    if (text.length === 0) continue;
    lines.push(text);
    if (lines.length === MAX_BOARDS) break;
  }
  return lines;
}

function build(input: BuildInput): Part[] {
  const w = Math.max(input.size[0], 0.01);
  const h = Math.max(input.size[1], 0.01);
  const d = Math.max(input.size[2], 0.01);
  const k = h / 1.8;
  const { params } = input;
  const boardColor = argColor(params, 'boardColor', DEFAULT_BOARD);
  const textColor = argColor(params, 'textColor', DEFAULT_TEXT);
  const rng = createRng(paramNumber(params, 'seed', 1));
  const parts: Part[] = [];

  // Столб: брусок на всю высоту, толщиной в четверть глубины габарита (3 см при размере по умолчанию).
  parts.push({
    shape: 'box',
    position: [0, h / 2, 0],
    size: [Math.min(0.09 * k, w), h, 0.25 * d],
    color: input.color,
    roughness: 0.9,
  });
  // Холм у пола — вырезка в плоскости столба (painter рисует его белым, тон даёт цвет объекта).
  parts.push({
    shape: 'plane',
    position: [0, 0.08 * h, 0],
    size: [0.55 * w, 0.16 * h, 0],
    color: input.color,
    roughness: 0.9,
    doubleSided: true,
    cutout: true,
    paint: { painter: 'hp.signMound', px: MOUND_PX },
  });

  const lines = boardLines(params.boards);
  const fronts: Part[] = [];
  const backs: Part[] = [];
  let dir = rng.next() < 0.5 ? 1 : -1;
  lines.forEach((text, index) => {
    // Первая строка — верхняя табличка; нижняя — крупнее остальных.
    const last = index === lines.length - 1;
    const heightUnits = last ? 0.2 : 0.15;
    const widthUnits = clamp(0.25 + 0.045 * glyphs(text).length, 0.4, Math.max(0.4, (w / k) * 1));
    const bh = heightUnits * k;
    // Крен ±6°; наклонённая табличка не шире габарита.
    const roll = rng.range(-MAX_ROLL, MAX_ROLL);
    const sin = Math.abs(Math.sin(roll));
    const cos = Math.cos(roll);
    const bw = Math.max(0.01 * k, Math.min(widthUnits * k, w, (w - bh * sin) / cos));
    const halfX = (bw * cos + bh * sin) / 2;
    const halfY = (bw * sin + bh * cos) / 2;
    // Направление стрелки чередуется; изредка две соседние смотрят в одну сторону (как на референсе).
    if (index > 0 && rng.next() < 0.8) dir = -dir;
    const shift = rng.range(0.02, 0.1) * w;
    const x = dir * Math.min(shift, Math.max(0, w / 2 - halfX));
    // y равномерно от 0.95h (первая строка) до 0.30h (последняя); верх наклонённой таблички — не выше габарита.
    const t = lines.length > 1 ? index / (lines.length - 1) : 0;
    const y = Math.max(halfY, Math.min(0.95 * h - 0.65 * h * t, h - halfY));
    // Соседние таблички могут перекрыться по высоте — разносим их по трём слоям глубины.
    const z = d / 6 + (index % 3) * 0.0125 * d;
    // Пропорции таблички нужны painter'у, чтобы буквы не растягивались; считаются до умножения на k —
    // при пропорциональном масштабировании фигуры текстура остаётся той же.
    const aspect = Math.round((20 * bw) / k / heightUnits) / 20;
    const seed = rng.int(0, 999999);
    fronts.push({
      shape: 'plane',
      position: [x, y, z],
      size: [bw, bh, 0],
      rotation: [0, 0, roll],
      color: '#ffffff',
      roughness: 0.9,
      cutout: true,
      paint: { painter: 'hp.signBoard', args: { text, dir, boardColor, textColor, seed, aspect }, px: BOARD_PX },
    });
    // Изнанка без текста: та же табличка, развёрнутая на 180° вокруг Y (силуэт зеркалится — отсюда −dir).
    // Силуэт не зависит от seed и пропорций, поэтому у всех изнанок одного направления — одна текстура.
    backs.push({
      shape: 'plane',
      position: [x, y, -z],
      size: [bw, bh, 0],
      rotation: [0, Math.PI, -roll],
      color: '#ffffff',
      roughness: 0.9,
      cutout: true,
      paint: { painter: 'hp.signBoard', args: { text: '', dir: -dir, boardColor, textColor, seed: 0, aspect: 4 }, px: BOARD_PX },
    });
  });
  parts.push(...fronts, ...backs);
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.signpost',
  kind: 'preset',
  title: 'Указатель',
  category: 'Гарри Поттер',
  size: [1.0, 1.8, 0.12],
  resize: 'uniform',
  color: '#141414',
  mounts: ['floor', 'wall'],
  params: [
    { key: 'boards', label: 'Таблички (по строке на каждую)', type: 'text', default: BOARDS, multiline: true },
    { key: 'boardColor', label: 'Цвет табличек', type: 'color', default: DEFAULT_BOARD },
    { key: 'textColor', label: 'Цвет текста', type: 'color', default: DEFAULT_TEXT },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

// ---------- Painters ----------

const bold = (px: number) => `900 ${px}px ${SERIF}`;

/**
 * Силуэт таблички остриём вправо в долях canvas: острый конец и зазубренный хвост. Зависит только от размера canvas
 * (не от текста и seed) — лицевая сторона и изнанка совпадают по контуру.
 */
const BOARD_OUTLINE: readonly (readonly [number, number])[] = [
  [0.02, 0.1],
  [0.3, 0.07],
  [0.62, 0.11],
  [0.86, 0.06],
  [0.985, 0.5],
  [0.87, 0.93],
  [0.55, 0.9],
  [0.25, 0.94],
  [0.03, 0.9],
  [0.075, 0.72],
  [0.015, 0.55],
  [0.07, 0.38],
];

const paintBoard: Painter = (ctx, w, h, args) => {
  const dir = argNumber(args, 'dir', 1) < 0 ? -1 : 1;
  const text = argText(args, 'text', '', 4 * MAX_GLYPHS).toUpperCase();

  // Доска на прозрачном фоне; для стрелки влево — зеркально.
  ctx.save();
  if (dir < 0) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = argColor(args, 'boardColor', DEFAULT_BOARD);
  ctx.beginPath();
  BOARD_OUTLINE.forEach(([u, v], index) => {
    if (index === 0) ctx.moveTo(u * w, v * h);
    else ctx.lineTo(u * w, v * h);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const letters = glyphs(text).slice(0, MAX_GLYPHS);
  if (letters.length === 0) return;

  // Надпись «от руки»: жирные засечные заглавные, у каждого глифа — свой размер ±12 %, поворот ±6° и сдвиг базовой линии.
  // Рисуем в «настоящих» пропорциях таблички (ширина = высота × aspect), чтобы буквы не растягивались.
  const aspect = clamp(argNumber(args, 'aspect', w / h), 1, 12);
  const virtualWidth = h * aspect;
  const rng = createRng(argNumber(args, 'seed', 0));
  const base = h * 0.58;
  const spacing = base * 0.03;
  const shapes = letters.map((glyph) => {
    const scale = 1 + rng.range(-0.12, 0.12);
    const angle = rng.range(-MAX_ROLL, MAX_ROLL);
    const lift = rng.range(-0.05, 0.05) * h;
    ctx.font = bold(base * scale);
    const measured = ctx.measureText(glyph).width;
    const width = Number.isFinite(measured) && measured > 0 ? measured : base * scale * (glyph === ' ' ? 0.3 : 0.6);
    return { glyph, scale, angle, lift, width };
  });
  const total = shapes.reduce((sum, shape) => sum + shape.width, 0) + spacing * (shapes.length - 1);
  // Текст — между хвостом и остриём; ужимается по ширине.
  const from = (dir > 0 ? 0.1 : 0.14) * virtualWidth;
  const to = (dir > 0 ? 0.86 : 0.9) * virtualWidth;
  const fit = total > 0 ? Math.min(1, (to - from) / total) : 1;

  ctx.save();
  ctx.scale(w / virtualWidth, 1);
  ctx.fillStyle = argColor(args, 'textColor', DEFAULT_TEXT);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let x = (from + to) / 2 - (total * fit) / 2;
  for (const shape of shapes) {
    const width = shape.width * fit;
    ctx.save();
    ctx.translate(x + width / 2, h * 0.53 + shape.lift * fit);
    ctx.rotate(shape.angle);
    ctx.font = bold(Math.max(4, base * shape.scale * fit));
    ctx.fillText(shape.glyph, 0, 0);
    ctx.restore();
    x += width + spacing * fit;
  }
  ctx.restore();
};

const paintMound: Painter = (ctx, w, h) => {
  // Полуэллипс с неровной макушкой; белый — тон даёт цвет части.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0.02 * w, h);
  ctx.bezierCurveTo(0.03 * w, 0.42 * h, 0.2 * w, 0.1 * h, 0.4 * w, 0.08 * h);
  ctx.lineTo(0.47 * w, 0.03 * h);
  ctx.lineTo(0.56 * w, 0.07 * h);
  ctx.bezierCurveTo(0.8 * w, 0.1 * h, 0.97 * w, 0.42 * h, 0.98 * w, h);
  ctx.closePath();
  ctx.fill();
};

export const painters: Record<string, Painter> = {
  /** Табличка-стрелка: силуэт доски на прозрачном фоне и надпись; args: text, dir (±1), boardColor, textColor, seed, aspect. */
  'hp.signBoard': guarded('hp.signBoard', DEFAULT_BOARD, paintBoard),
  /** Холм под столбом: полуэллипс на прозрачном фоне. */
  'hp.signMound': guarded('hp.signMound', '#ffffff', paintMound),
};
