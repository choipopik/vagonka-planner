import { clamp, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import {
  INK,
  SERIF,
  argNumber,
  argText,
  drawFitted,
  drawLines,
  guarded,
  paintFoldedCorner,
  paintParchment,
  paintPhoto,
  paintStar,
  paintTextColumns,
  paramNumber,
  rgba,
  splitBalanced,
} from './paper';

// 4.3 «Стена газет „Ежедневный пророк“»: листы A3 внахлёст с креном, как на референсе.
// Площадной предмет: лист держит свой размер, стена заполняется числом листов (не больше 160).

const MAX_SHEETS = 160;
/** Базовый лист (A3), м. */
const SHEET_W = 0.3;
const SHEET_H = 0.42;
/** Шаг сетки в долях листа (≈ 38 % перекрытия). */
const CELL = 0.62;
/** Дрожание центра листа в долях шага сетки. */
const JITTER = 0.3;
/** Период узора наслоения по столбцам и строкам; слоёв LAYER_PERIOD². */
const LAYER_PERIOD = 5;
/** Шаг слоёв по глубине и отступ первого слоя от стены, м. */
export const LAYER_STEP = 0.001;
const LAYER_BASE = 0.004;
const VARIANTS = 8;
const PAGE_PX: [number, number] = [384, 544];

export interface ProphetGrid {
  /** Размер листа, м. */
  sheetW: number;
  sheetH: number;
  cols: number;
  rows: number;
  /** Шаг сетки, м (при одном столбце / строке — 0). */
  pitchX: number;
  pitchY: number;
  /** Число листов. */
  count: number;
  /** Наибольший крен, рад. */
  tilt: number;
}

/**
 * Раскладка стены (чистая; ею же пользуется тест). Центры листов стоят в узлах сетки cols × rows, натянутой на
 * прямоугольник допустимых центров; шаг сетки по умолчанию — 0.62 листа, для высокой плотности сетка уплотняется,
 * но не сильнее, чем позволяет правило наслоения: два листа одного слоя отстоят на LAYER_PERIOD узлов, и после
 * дрожания ±0.3 шага между их центрами остаётся ≥ 4.4 шага — больше габарита наклонённого листа.
 */
export function prophetGrid(input: BuildInput): ProphetGrid {
  const w = Math.max(input.size[0], 0.01);
  const h = Math.max(input.size[1], 0.01);
  const { params } = input;
  // Лист не больше самой стены (узкая стена — листы мельче, пропорции A3 сохраняются).
  const scale = Math.min(clamp(paramNumber(params, 'sheetScale', 1), 0.7, 1.4), w / SHEET_W, h / SHEET_H);
  const sheetW = SHEET_W * scale;
  const sheetH = SHEET_H * scale;
  const tilt = (clamp(paramNumber(params, 'tilt', 18), 0, 35) * Math.PI) / 180;
  const wanted = Math.min(MAX_SHEETS, Math.max(1, Math.round(paramNumber(params, 'density', 16) * w * h)));

  // Прямой лист выступает за край стены не больше чем на 10 % своего размера.
  const spanX = w - 0.8 * sheetW;
  const spanY = h - 0.8 * sheetH;
  // Габарит листа с наибольшим креном — наименьшее безопасное расстояние между листами одного слоя.
  const reachX = sheetW * Math.cos(tilt) + sheetH * Math.sin(tilt);
  const reachY = sheetW * Math.sin(tilt) + sheetH * Math.cos(tilt);
  const safe = LAYER_PERIOD - 2 * JITTER;
  const minPitchX = (reachX * 1.03) / safe;
  const minPitchY = (reachY * 1.03) / safe;

  const baseCols = Math.max(1, Math.round(spanX / (CELL * sheetW)) + 1);
  const baseRows = Math.max(1, Math.round(spanY / (CELL * sheetH)) + 1);
  const maxCols = Math.max(baseCols, Math.floor(spanX / minPitchX) + 1);
  const maxRows = Math.max(baseRows, Math.floor(spanY / minPitchY) + 1);

  let cols = baseCols;
  let rows = baseRows;
  if (cols * rows < wanted) {
    const grow = Math.sqrt(wanted / (cols * rows));
    cols = Math.min(maxCols, Math.ceil(baseCols * grow));
    rows = Math.min(maxRows, Math.ceil(wanted / cols));
    if (cols * rows < wanted) cols = Math.min(maxCols, Math.ceil(wanted / rows));
  }
  return {
    sheetW,
    sheetH,
    cols,
    rows,
    pitchX: cols > 1 ? spanX / (cols - 1) : 0,
    pitchY: rows > 1 ? spanY / (rows - 1) : 0,
    count: Math.min(wanted, cols * rows),
    tilt,
  };
}

function build(input: BuildInput): Part[] {
  const w = Math.max(input.size[0], 0.01);
  const h = Math.max(input.size[1], 0.01);
  const d = Math.max(input.size[2], 0.01);
  const grid = prophetGrid(input);
  const { sheetW, sheetH, cols, rows, pitchX, pitchY } = grid;
  const lang = input.params.lang === 'en' ? 'en' : 'ru';
  const rng = createRng(paramNumber(input.params, 'seed', 1));

  // Наслоение — по узлу сетки: одинаковый слой повторяется только через LAYER_PERIOD столбцов или строк.
  const layers = rng.shuffle(Array.from({ length: LAYER_PERIOD * LAYER_PERIOD }, (_, index) => index));
  // Варианты — перемешанным round-robin: у восьми соседей узла вариант всегда другой.
  const variants = rng.shuffle(Array.from({ length: VARIANTS }, (_, index) => index));
  // Узлов может быть больше, чем листов: пустые выбираются случайно.
  const cells = rng.shuffle(Array.from({ length: cols * rows }, (_, index) => index)).slice(0, grid.count);

  const halfSpanX = (w - 0.8 * sheetW) / 2;
  const halfSpanY = (h - 0.8 * sheetH) / 2;
  // Наклонённый лист может выступать за стену не больше чем на 10 % её размера.
  const limitX = w / 2 + 0.1 * w;
  const limitY = h / 2 + 0.1 * h;

  const parts: Part[] = [];
  for (const cell of cells) {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const x = clamp(
      (cols > 1 ? -halfSpanX + col * pitchX : 0) + rng.range(-JITTER, JITTER) * pitchX,
      -halfSpanX,
      halfSpanX,
    );
    const yOffset = clamp(
      (rows > 1 ? -halfSpanY + row * pitchY : 0) + rng.range(-JITTER, JITTER) * pitchY,
      -halfSpanY,
      halfSpanY,
    );
    // Только крен: тангаж и рыскание прорезали бы соседние листы.
    let roll = rng.range(-grid.tilt, grid.tilt);
    for (let attempt = 0; attempt < 8; attempt++) {
      const halfX = (sheetW * Math.cos(roll) + sheetH * Math.abs(Math.sin(roll))) / 2;
      const halfY = (sheetW * Math.abs(Math.sin(roll)) + sheetH * Math.cos(roll)) / 2;
      if (Math.abs(x) + halfX <= limitX && Math.abs(yOffset) + halfY <= limitY) break;
      // У самого края лист выпрямляется, пока не уложится в допуск.
      roll = attempt === 7 ? 0 : roll * 0.6;
    }
    const layer = layers[(col % LAYER_PERIOD) + LAYER_PERIOD * (row % LAYER_PERIOD)];
    const variant = variants[(col + 3 * row) % VARIANTS];
    parts.push({
      shape: 'plane',
      position: [x, h / 2 + yOffset, -d / 2 + LAYER_BASE + layer * LAYER_STEP],
      size: [sheetW, sheetH, 0],
      rotation: [0, 0, roll],
      // Бумага нарисована светлой; тон пергамента даёт цвет объекта (с небольшим разбросом по листам).
      color: shade(input.color, rng.range(0.88, 1)),
      roughness: 0.9,
      paint: { painter: 'hp.prophetPage', args: { variant, lang }, px: PAGE_PX },
    });
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.prophetWall',
  kind: 'preset',
  title: 'Стена газет „Ежедневный пророк“',
  category: 'Гарри Поттер',
  size: [1.5, 2.5, 0.06],
  maxSize: [6, 3, 0.06],
  resize: 'free',
  color: '#d9b77a',
  mounts: ['wall'],
  params: [
    { key: 'density', label: 'Листов на м²', type: 'number', min: 6, max: 30, step: 1, default: 16 },
    { key: 'sheetScale', label: 'Размер листа', type: 'number', min: 0.7, max: 1.4, step: 0.05, default: 1 },
    { key: 'tilt', label: 'Разброс наклона, °', type: 'number', min: 0, max: 35, step: 1, default: 18 },
    { key: 'lang', label: 'Язык', type: 'select', options: [{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }], default: 'ru' },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

// ---------- Painter ----------

type PageKind = 'wanted' | 'news' | 'decree';

interface Page {
  kind: PageKind;
  ru: string;
  en: string;
  /** Подзаголовок (мелкая строка под заголовком). */
  subRu: string;
  subEn: string;
}

/** Восемь вариантов листа; порядок — как в разделе 4.3 спецификации. */
export const PROPHET_PAGES: readonly Page[] = [
  { kind: 'wanted', ru: 'РАЗЫСКИВАЕТСЯ', en: 'WANTED', subRu: 'Министерство магии', subEn: 'Ministry of Magic' },
  { kind: 'wanted', ru: 'НЕЖЕЛАТЕЛЬНОЕ ЛИЦО № 1', en: 'UNDESIRABLE № 1', subRu: 'Награда 10 000 галлеонов', subEn: 'Reward 10,000 galleons' },
  { kind: 'news', ru: 'МАССОВЫЙ ПОБЕГ ИЗ АЗКАБАНА', en: 'MASS BREAKOUT FROM AZKABAN', subRu: 'Экстренный выпуск', subEn: 'Special edition' },
  { kind: 'news', ru: 'ТЁМНАЯ МЕТКА СЕЕТ ПАНИКУ', en: 'DARK MARK SPARKS PANIC', subRu: 'Вечерний выпуск', subEn: 'Evening edition' },
  { kind: 'wanted', ru: 'ВЫ ВИДЕЛИ ЭТОГО ВОЛШЕБНИКА?', en: 'HAVE YOU SEEN THIS WIZARD?', subRu: 'Сообщите в Министерство магии', subEn: 'Notify the Ministry of Magic' },
  { kind: 'news', ru: 'МАЛЬЧИК, КОТОРЫЙ ВЫЖИЛ', en: 'THE BOY WHO LIVED', subRu: 'Утренний выпуск', subEn: 'Morning edition' },
  { kind: 'news', ru: 'ТОТ-КОГО-НЕЛЬЗЯ-НАЗЫВАТЬ ВЕРНУЛСЯ', en: 'HE WHO MUST NOT BE NAMED RETURNS', subRu: 'Экстренный выпуск', subEn: 'Special edition' },
  { kind: 'decree', ru: 'ПРОКЛАМАЦИЯ', en: 'PROCLAMATION', subRu: 'Декрет № 24', subEn: 'Decree № 24' },
];

const bold = (px: number) => `700 ${px}px ${SERIF}`;
const italic = (px: number) => `italic 700 ${px}px ${SERIF}`;
const plain = (px: number) => `${px}px ${SERIF}`;

const paintPage: Painter = (ctx, w, h, args) => {
  const variant = ((Math.floor(argNumber(args, 'variant', 0)) % VARIANTS) + VARIANTS) % VARIANTS;
  const en = argText(args, 'lang', 'ru') === 'en';
  const page = PROPHET_PAGES[variant];
  const rng = createRng(1000 + variant);
  const headline = en ? page.en : page.ru;
  const sub = en ? page.subEn : page.subRu;
  const m = w * 0.07;
  const inner = w - 2 * m;

  // Бумага светлая: тон пергамента добавляет цвет части (см. build).
  paintParchment(ctx, w, h, '#fbf6ea', 40 + variant);

  // Рамка в две линии.
  ctx.strokeStyle = rgba(INK, 0.85);
  ctx.lineWidth = Math.max(1, w * 0.008);
  ctx.strokeRect(m * 0.45, m * 0.45, w - m * 0.9, h - m * 0.9);
  ctx.lineWidth = Math.max(1, w * 0.003);
  ctx.strokeRect(m * 0.7, m * 0.7, w - m * 1.4, h - m * 1.4);

  ctx.fillStyle = INK;
  let y = m;

  if (page.kind === 'news') {
    // Шапка газеты между двумя линейками.
    drawFitted(ctx, en ? 'The Daily Prophet' : 'Ежедневный Пророк', w / 2, y + h * 0.045, inner * 0.92, h * 0.07, italic);
    y += h * 0.09;
    ctx.fillRect(m, y, inner, Math.max(1, h * 0.006));
    ctx.fillRect(m, y + h * 0.012, inner, Math.max(1, h * 0.002));
    drawFitted(ctx, sub, w / 2, y + h * 0.034, inner * 0.6, h * 0.024, plain);
    y += h * 0.055;
    // Заголовок в две–три строки.
    const lines = splitBalanced(headline, headline.length > 24 ? 3 : 2);
    drawLines(ctx, lines, m, y, inner, h * 0.24, bold);
    y += h * 0.25;
    ctx.fillRect(m, y, inner, Math.max(1, h * 0.004));
    y += h * 0.02;
    // Фото слева или справа, рядом и ниже — колонки строк.
    const photoW = inner * 0.52;
    const photoH = h * 0.26;
    const left = variant % 2 === 0;
    paintPhoto(ctx, left ? m : m + inner - photoW, y, photoW, photoH, variant);
    paintTextColumns(ctx, left ? m + photoW + m * 0.4 : m, y, inner - photoW - m * 0.4, photoH, 1, rng, h * 0.013);
    y += photoH + h * 0.02;
    paintTextColumns(ctx, m, y, inner, h - m - y, 3, rng, h * 0.013);
  } else if (page.kind === 'wanted') {
    // Плакат: заголовок, крупное фото, подпись и несколько строк.
    const lines = splitBalanced(headline, headline.length > 14 ? 2 : 1);
    drawLines(ctx, lines, m, y + h * 0.01, inner, h * (lines.length > 1 ? 0.21 : 0.14), bold);
    y += h * (lines.length > 1 ? 0.235 : 0.165);
    const photoH = h * 0.47;
    paintPhoto(ctx, m + inner * 0.08, y, inner * 0.84, photoH, variant);
    y += photoH + h * 0.02;
    // Чёрная плашка с подписью.
    ctx.fillStyle = INK;
    ctx.fillRect(m, y, inner, h * 0.07);
    ctx.fillStyle = '#f3e7c8';
    paintStar(ctx, m + h * 0.035, y + h * 0.035, h * 0.02);
    paintStar(ctx, m + inner - h * 0.035, y + h * 0.035, h * 0.02);
    drawFitted(ctx, sub, w / 2, y + h * 0.037, inner - h * 0.14, h * 0.038, bold);
    y += h * 0.09;
    paintTextColumns(ctx, m + inner * 0.1, y, inner * 0.8, h - m - y, 1, rng, h * 0.014);
  } else {
    // Прокламация: заголовок, номер декрета, строки по центру и печать.
    drawFitted(ctx, headline, w / 2, y + h * 0.07, inner * 0.94, h * 0.1, bold);
    y += h * 0.14;
    ctx.fillRect(m + inner * 0.2, y, inner * 0.6, Math.max(1, h * 0.004));
    y += h * 0.02;
    drawFitted(ctx, sub, w / 2, y + h * 0.05, inner * 0.8, h * 0.075, bold);
    y += h * 0.12;
    paintTextColumns(ctx, m + inner * 0.12, y, inner * 0.76, h * 0.34, 1, rng, h * 0.022);
    y += h * 0.37;
    // Печать: кольцо со звездой.
    const sealR = Math.min(inner * 0.16, (h - m - y) * 0.42);
    if (sealR > 2) {
      const sealY = y + sealR + h * 0.01;
      ctx.strokeStyle = rgba('#7a1f1a', 0.9);
      ctx.lineWidth = Math.max(1, sealR * 0.12);
      ctx.beginPath();
      ctx.arc(w / 2, sealY, sealR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba('#7a1f1a', 0.9);
      paintStar(ctx, w / 2, sealY, sealR * 0.6);
    }
  }

  paintFoldedCorner(ctx, w, w * (0.06 + 0.012 * (variant % 3)));
};

export const painters: Record<string, Painter> = {
  'hp.prophetPage': guarded('hp.prophetPage', '#fbf6ea', paintPage),
};
