// Общие помощники плоского декора «Гарри Поттер» (W6): чтение аргументов painters, подгонка текста по ширине,
// пергамент, силуэты и «строки текста», а также две чистые функции билдеров (нить и расстановка точек).
// Модуль не трогает DOM при импорте: функции рисования вызываются только из painters, то есть в браузере.
import { clamp } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Rng } from '../../../model/rng';
import type { Params } from '../../../model/types';
import type { Painter, Part } from '../../types';

type Ctx = CanvasRenderingContext2D;

/** Системные стеки шрифтов: ничего не грузится из сети, метрики глифов не предполагаются. */
export const SERIF = 'Georgia, "Times New Roman", serif';
export const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Чернила газет и рамки. */
export const INK = '#2a2118';

const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- Чтение аргументов painter'а (args приходят из сохранённого макета — проверяем всё) ----------

export function argText(args: Params, key: string, fallback = '', maxLength = 80): string {
  const value = args[key];
  return (typeof value === 'string' ? value : fallback).slice(0, maxLength);
}

export function argNumber(args: Params, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Только '#rrggbb'; всё остальное → fallback. */
export function argColor(args: Params, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

/** '#rrggbb' + прозрачность → 'rgba(r, g, b, a)'; не '#rrggbb' → чёрный той же прозрачности. */
export function rgba(hex: string, alpha: number): string {
  const n = HEX.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  const a = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
}

// ---------- Текст ----------

/** Глифы строки (по кодовым точкам: «¾» и руны — один глиф). */
export function glyphs(text: string): string[] {
  return Array.from(text);
}

/**
 * Делит текст на не более чем maxLines строк примерно равной длины, не разрывая слов (чистая функция).
 * Пустой текст → []. Лишние пробелы схлопываются.
 */
export function splitBalanced(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(maxLines) || 1, words.length));
  const lines: string[] = [];
  let rest = words;
  for (let line = 0; line < limit; line++) {
    const linesLeft = limit - line;
    if (linesLeft === 1) {
      lines.push(rest.join(' '));
      break;
    }
    // Цель — поровну оставшихся символов на оставшиеся строки.
    const total = rest.reduce((sum, word) => sum + glyphs(word).length, 0) + rest.length - 1;
    const target = total / linesLeft;
    let take = 1;
    let length = glyphs(rest[0]).length;
    // Каждой следующей строке должно остаться хотя бы по слову.
    while (take < rest.length - (linesLeft - 1)) {
      const next = length + 1 + glyphs(rest[take]).length;
      // Берём слово, если с ним строка ближе к цели, чем без него.
      if (Math.abs(next - target) > Math.abs(length - target)) break;
      length = next;
      take++;
    }
    lines.push(rest.slice(0, take).join(' '));
    rest = rest.slice(take);
  }
  return lines;
}

/**
 * Подбирает кегль в [minPx, startPx], при котором text не шире maxWidth, и оставляет его в ctx.font (как в Label.tsx,
 * но одним измерением: ширина строки пропорциональна кеглю). Возвращает кегль.
 */
export function fitFont(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  startPx: number,
  minPx: number,
  font: (px: number) => string,
): number {
  let px = Math.max(1, startPx);
  ctx.font = font(px);
  const width = ctx.measureText(text).width;
  if (Number.isFinite(width) && width > maxWidth && width > 0) {
    px = Math.max(Math.min(minPx, px), Math.floor((px * maxWidth) / width));
    ctx.font = font(px);
  }
  return px;
}

/**
 * Рисует строку по центру (cx, cy), ужимая её по ширине: сначала кеглем (fitFont), а если упёрлись в minPx —
 * четвёртым аргументом fillText (браузер сжимает глифы). Возвращает кегль.
 */
export function drawFitted(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  startPx: number,
  font: (px: number) => string,
  minPx = 8,
): number {
  if (text.length === 0 || !(maxWidth > 0)) return startPx;
  const px = fitFont(ctx, text, maxWidth, startPx, minPx, font);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy, maxWidth);
  return px;
}

/**
 * Несколько строк одним кеглем (наименьшим из подобранных), по центру блока [x, x + w] × [y, y + h].
 * Возвращает кегль.
 */
export function drawLines(
  ctx: Ctx,
  lines: readonly string[],
  x: number,
  y: number,
  w: number,
  h: number,
  font: (px: number) => string,
  leading = 1.08,
): number {
  if (lines.length === 0 || !(w > 0) || !(h > 0)) return 0;
  let px = Math.max(6, Math.floor(h / (lines.length * leading)));
  for (const line of lines) px = Math.min(px, fitFont(ctx, line, w, px, 6, font));
  ctx.font = font(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = px * leading;
  const top = y + h / 2 - (step * (lines.length - 1)) / 2;
  lines.forEach((line, index) => ctx.fillText(line, x + w / 2, top + index * step, w));
  return px;
}

// ---------- Бумага ----------

/**
 * Лист пергамента на весь canvas: заливка color, тёмные и светлые пятна, мелкие крапины, затемнение к краям.
 * Рисунок детерминирован по seed (текстуры кэшируются по аргументам).
 */
export function paintParchment(ctx: Ctx, w: number, h: number, color: string, seed: number): void {
  const rng = createRng(seed);
  const span = Math.max(w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);

  // Крупные разводы: тёмные (чай, сырость) и немного светлых (выгоревшие места).
  for (let i = 0; i < 16; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(0.08, 0.3) * span;
    const dark = i % 4 !== 3;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, dark ? rgba('#5a3a14', rng.range(0.05, 0.16)) : rgba('#fff6dc', rng.range(0.06, 0.16)));
    gradient.addColorStop(1, dark ? rgba('#5a3a14', 0) : rgba('#fff6dc', 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  // Крапины.
  ctx.fillStyle = rgba('#3b2710', 0.22);
  const dots = Math.round(clamp((w * h) / 2500, 20, 160));
  for (let i = 0; i < dots; i++) {
    const size = rng.range(0.6, 2.2);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), size, size);
  }

  // Затемнение по краям — четыре полосы-градиента.
  const edge = 0.14 * Math.min(w, h);
  const edges: [number, number, number, number, number, number, number, number][] = [
    [0, 0, edge, 0, 0, 0, edge, h],
    [w, 0, w - edge, 0, w - edge, 0, edge, h],
    [0, 0, 0, edge, 0, 0, w, edge],
    [0, h, 0, h - edge, 0, h - edge, w, edge],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, rgba('#3b2408', 0.34));
    gradient.addColorStop(1, rgba('#3b2408', 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(rx, ry, rw, rh);
  }
}

/** «Загнутый» правый верхний уголок: тень под отгибом и светлая изнанка (объём — рисунком). */
export function paintFoldedCorner(ctx: Ctx, w: number, size: number): void {
  if (!(size > 0)) return;
  // Место, где листа уже «нет»: тёмный треугольник.
  ctx.fillStyle = rgba('#20150a', 0.55);
  ctx.beginPath();
  ctx.moveTo(w - size, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, size);
  ctx.closePath();
  ctx.fill();
  // Отогнутая изнанка.
  ctx.fillStyle = rgba('#fff4d8', 0.6);
  ctx.beginPath();
  ctx.moveTo(w - size, 0);
  ctx.lineTo(w, size);
  ctx.lineTo(w - size, size);
  ctx.closePath();
  ctx.fill();
  // Тень вдоль сгиба.
  ctx.strokeStyle = rgba('#20150a', 0.45);
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(w - size, 0);
  ctx.lineTo(w - size, size);
  ctx.lineTo(w, size);
  ctx.stroke();
}

/**
 * Тёмный «фотоблок» с обобщённым силуэтом головы и плеч — без черт лица и портретного сходства.
 * variant немного меняет ширину плеч и высоту головы, чтобы блоки не были одинаковыми.
 */
export function paintPhoto(ctx: Ctx, x: number, y: number, w: number, h: number, variant: number): void {
  if (!(w > 0) || !(h > 0)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const background = ctx.createLinearGradient(x, y, x, y + h);
  background.addColorStop(0, '#4a4338');
  background.addColorStop(1, '#231f1a');
  ctx.fillStyle = background;
  ctx.fillRect(x, y, w, h);

  const v = Math.abs(Math.floor(variant)) % 4;
  const cx = x + w * (0.5 + (v === 1 ? 0.04 : v === 2 ? -0.04 : 0));
  const head = Math.min(w, h) * (0.17 + 0.012 * v);
  const headY = y + h * 0.4;
  const shoulders = w * (0.36 + 0.03 * v);
  const neckY = headY + head * 1.05;

  ctx.fillStyle = '#0f0d0b';
  // Плечи: плавный холм до нижнего края блока.
  ctx.beginPath();
  ctx.moveTo(cx - shoulders, y + h);
  ctx.bezierCurveTo(cx - shoulders, neckY + head * 0.5, cx - head * 0.7, neckY + head * 0.3, cx - head * 0.42, neckY);
  ctx.lineTo(cx + head * 0.42, neckY);
  ctx.bezierCurveTo(cx + head * 0.7, neckY + head * 0.3, cx + shoulders, neckY + head * 0.5, cx + shoulders, y + h);
  ctx.closePath();
  ctx.fill();
  // Голова.
  ctx.beginPath();
  ctx.ellipse(cx, headY, head * 0.82, head, 0, 0, Math.PI * 2);
  ctx.fill();

  // Мягкий блик сверху и рамка.
  const shine = ctx.createLinearGradient(x, y, x, y + h * 0.5);
  shine.addColorStop(0, rgba('#ffffff', 0.12));
  shine.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = shine;
  ctx.fillRect(x, y, w, h * 0.5);
  ctx.restore();

  ctx.strokeStyle = rgba(INK, 0.9);
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.015);
  ctx.strokeRect(x, y, w, h);
}

/** Колонки «строк текста»: серые полоски, последняя в абзаце короче. */
export function paintTextColumns(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  columns: number,
  rng: Rng,
  lineStep = 7,
): void {
  if (!(w > 0) || !(h > 0)) return;
  const count = Math.max(1, Math.floor(columns));
  const gap = Math.min(10, w * 0.04);
  const columnWidth = (w - gap * (count - 1)) / count;
  if (!(columnWidth > 0)) return;
  const step = Math.max(3, lineStep);
  ctx.fillStyle = rgba(INK, 0.6);
  for (let column = 0; column < count; column++) {
    const left = x + column * (columnWidth + gap);
    let untilBreak = rng.int(3, 7);
    for (let lineY = y; lineY + step * 0.45 <= y + h; lineY += step) {
      untilBreak--;
      const short = untilBreak <= 0;
      if (short) untilBreak = rng.int(3, 7);
      ctx.fillRect(left, lineY, columnWidth * (short ? rng.range(0.35, 0.8) : 1), step * 0.45);
    }
  }
}

/** Пятиконечная звезда с центром (cx, cy) и внешним радиусом r (текущий fillStyle). */
export function paintStar(ctx: Ctx, cx: number, cy: number, r: number): void {
  if (!(r > 0)) return;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

const warned = new Set<string>();

/**
 * Оборачивает painter: состояние контекста сохраняется и восстанавливается, а исключение (незнакомый браузер, битые
 * аргументы) не роняет сцену — canvas заливается запасным цветом, в консоль уходит одно предупреждение на painter.
 */
export function guarded(name: string, fallback: string, paint: Painter): Painter {
  return (ctx, width, height, args) => {
    ctx.save();
    try {
      paint(ctx, width, height, args ?? {});
    } catch (error) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`painter ${name}: ${String(error)}`);
      }
      try {
        // Painter мог упасть внутри своих save() / clip(): разматываем стек состояний, иначе запасная заливка
        // легла бы только в оставшуюся область отсечения (restore на пустом стеке — пустая операция).
        for (let depth = 0; depth < 16; depth++) ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fallback;
        ctx.fillRect(0, 0, width, height);
      } catch {
        // Контекст непригоден совсем — оставляем canvas как есть.
      }
    } finally {
      ctx.restore();
    }
  };
}

// ---------- Чистые помощники билдеров ----------

/** Число из params (они уже слиты с умолчаниями, но билдер не должен падать и на чужом входе). */
export function paramNumber(params: Params, key: string, fallback: number): number {
  return argNumber(params, key, fallback);
}

/** Цвет нити (леска на референсах), общий для облаков и совы — один материал, один вызов отрисовки. */
const THREAD_COLOR = '#d8d8d8';

/** Вертикальная нить Ø 2 мм от yFrom до yTo в точке (x, z); слишком короткая (< 5 мм) → null. */
export function thread(x: number, yFrom: number, yTo: number, z: number): Part | null {
  const length = yTo - yFrom;
  if (!(length >= 0.005)) return null;
  return {
    shape: 'cylinder',
    position: [x, yFrom + length / 2, z],
    size: [0.002, length, 0.002],
    color: THREAD_COLOR,
    opacity: 0.35,
  };
}

/**
 * count точек в прямоугольнике |x| ≤ halfX, |z| ≤ halfZ, разбросанных равномерно: каждая следующая — лучший из `tries`
 * случайных кандидатов (самый далёкий от уже поставленных). Число точек всегда равно count: в тесной области
 * расстояние между соседями просто становится меньше. allow отсекает запретные зоны (если подходящих кандидатов нет,
 * запрет игнорируется).
 */
export function scatter(
  rng: Rng,
  count: number,
  halfX: number,
  halfZ: number,
  tries = 24,
  allow?: (x: number, z: number) => boolean,
): [number, number][] {
  const hx = Math.max(0, halfX);
  const hz = Math.max(0, halfZ);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    let best: [number, number] | null = null;
    let bestScore = -1;
    let spare: [number, number] = [0, 0];
    for (let attempt = 0; attempt < tries; attempt++) {
      const x = rng.range(-hx, hx);
      const z = rng.range(-hz, hz);
      if (attempt === 0) spare = [x, z];
      if (allow && !allow(x, z)) continue;
      let nearest = Infinity;
      for (const [px, pz] of points) nearest = Math.min(nearest, (px - x) * (px - x) + (pz - z) * (pz - z));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = [x, z];
      }
    }
    points.push(best ?? spare);
  }
  return points;
}
