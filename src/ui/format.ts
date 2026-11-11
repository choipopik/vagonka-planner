// Чистые помощники панелей: разбор и вывод чисел, градусы, цвет, имя файла снимка. Без React и DOM.
import { LAYOUT_LIMITS } from '../model/migrate';
import type { MountKind } from '../model/types';

/** Целая и дробная части через точку; экспонента и прочее — мусор. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Число из текста поля: запятая или точка как десятичный разделитель, пробелы (в т. ч. неразрывные) игнорируются,
 * типографский минус принимается. Пустая строка, мусор и бесконечность → null.
 */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(/[−–]/g, '-').replace(',', '.');
  if (!NUMBER.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Метры с двумя знаками после точки; «−0.00» не показывается. Не число → «—». */
export function formatMetres(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
}

/** Число не более чем с maxDigits знаками после точки, без хвостовых нулей («15», «0.5», «12.25»). Не число → «—». */
export function formatPlain(value: number, maxDigits: number): string {
  if (!Number.isFinite(value)) return '—';
  const digits = Math.min(10, Math.max(0, Math.trunc(maxDigits)));
  let text = value.toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Приводит угол к полуинтервалу (−180, 180]. Не число → 0. */
export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = deg % 360;
  const d = r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
  return d === 0 ? 0 : d;
}

/** Угол объекта для поля «Поворот, °»: градусы в (−180, 180], округлены до 0.1 (шаг поворота 15° хранится с шумом float). */
export function rotationDegrees(rad: number): number {
  return normalizeDegrees(Math.round(toDegrees(rad) * 10) / 10);
}

/** Сколько знаков после точки у шага ползунка (1 → 0, 0.5 → 1, 0.05 → 2). */
export function stepDigits(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const text = step.toFixed(6).replace(/0+$/, '');
  return text.length - text.indexOf('.') - 1;
}

/**
 * Значение числового параметра каталога: зажато в [min, max] и приведено к сетке min + k·step без шума float.
 * Не число → min.
 */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const digits = Math.max(stepDigits(step), stepDigits(Math.abs(min) || 1));
  const cleaned = Number(Math.min(max, Math.max(min, snapped)).toFixed(digits));
  return cleaned === 0 ? 0 : cleaned;
}

/** '#rrggbb' в нижнем регистре из '#rgb', 'rgb', '#rrggbb', 'rrggbb'; иначе null. Другие виды цвета cmdPatch отбрасывает. */
export function normalizeHexColor(text: string): string | null {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text.trim());
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return `#${hex}`;
}

/** Предел длины текстового параметра: maxLength записи каталога, но не больше того, что переживает parseLayout (4000). */
export function textLimit(maxLength: number | undefined): number {
  const limit = LAYOUT_LIMITS.paramString;
  if (maxLength === undefined || !Number.isFinite(maxLength)) return limit;
  return Math.min(limit, Math.max(0, Math.trunc(maxLength)));
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Имя файла снимка: `vagonka-<макет>-<yyyy-mm-dd>.png` (дата местная; символы, недопустимые в именах файлов, убраны). */
export function snapshotFileName(layoutName: string, date: Date): string {
  const slug = layoutName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `vagonka-${slug || 'макет'}-${isoDate(date)}.png`;
}

/** Названия креплений в панелях. */
export const MOUNT_LABELS: Record<MountKind, string> = {
  floor: 'Пол',
  wall: 'Стена',
  ceiling: 'Потолок',
  surface: 'Стол',
};

/** Что означает крепление — для подсказок значков. */
export const MOUNT_HINTS: Record<MountKind, string> = {
  floor: 'Стоит на полу',
  wall: 'Висит на стене или колонне',
  ceiling: 'Висит под потолком',
  surface: 'Стоит на столе или другой опоре',
};
