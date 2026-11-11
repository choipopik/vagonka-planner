import { describe, expect, it } from 'vitest';
import {
  formatMetres,
  formatPlain,
  normalizeDegrees,
  normalizeHexColor,
  parseNumber,
  rotationDegrees,
  snapToStep,
  snapshotFileName,
  stepDigits,
  textLimit,
  toDegrees,
  toRadians,
} from './format';

describe('parseNumber', () => {
  it('принимает запятую и точку как десятичный разделитель', () => {
    expect(parseNumber('1,25')).toBe(1.25);
    expect(parseNumber('1.25')).toBe(1.25);
    expect(parseNumber(',5')).toBe(0.5);
    expect(parseNumber('2.')).toBe(2);
    expect(parseNumber('7')).toBe(7);
  });

  it('игнорирует пробелы по краям и внутри', () => {
    expect(parseNumber(' 2.5 ')).toBe(2.5);
    expect(parseNumber('1 250,5')).toBe(1250.5);
    expect(parseNumber(' 3 000 ')).toBe(3000);
  });

  it('понимает знак, в том числе типографский минус', () => {
    expect(parseNumber('-0,3')).toBe(-0.3);
    expect(parseNumber('−1.5')).toBe(-1.5);
    expect(parseNumber('+4')).toBe(4);
  });

  it('мусор → null', () => {
    for (const text of ['', '   ', 'abc', '1,2,3', '1.2.3', '1e3', '12м', '--1', '.', ',', 'NaN', 'Infinity', '0x10']) {
      expect(parseNumber(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe('formatMetres', () => {
  it('округляет до двух знаков', () => {
    expect(formatMetres(1.234)).toBe('1.23');
    expect(formatMetres(1.236)).toBe('1.24');
    expect(formatMetres(2)).toBe('2.00');
    expect(formatMetres(0.1 + 0.2)).toBe('0.30');
    expect(formatMetres(-1.5)).toBe('-1.50');
  });

  it('не показывает отрицательный ноль', () => {
    expect(formatMetres(-0)).toBe('0.00');
    expect(formatMetres(-0.001)).toBe('0.00');
  });

  it('не число → прочерк, который не разбирается обратно', () => {
    expect(formatMetres(Number.NaN)).toBe('—');
    expect(formatMetres(Number.POSITIVE_INFINITY)).toBe('—');
    expect(parseNumber(formatMetres(Number.NaN))).toBeNull();
  });

  it('вывод разбирается обратно в то же округлённое число', () => {
    for (const value of [0, 0.01, 1.25, -3.4, 12.999]) {
      expect(parseNumber(formatMetres(value))).toBeCloseTo(value, 2);
    }
  });
});

describe('formatPlain', () => {
  it('убирает хвостовые нули', () => {
    expect(formatPlain(15, 1)).toBe('15');
    expect(formatPlain(14.999999, 1)).toBe('15');
    expect(formatPlain(0.5, 2)).toBe('0.5');
    expect(formatPlain(12.25, 2)).toBe('12.25');
    expect(formatPlain(100, 0)).toBe('100');
    expect(formatPlain(-0.04, 1)).toBe('0');
    expect(formatPlain(Number.NaN, 1)).toBe('—');
  });
});

describe('градусы ⇄ радианы', () => {
  it('переводит в обе стороны', () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180, 12);
    expect(toDegrees(Math.PI / 12)).toBeCloseTo(15, 12);
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(toRadians(-45)).toBeCloseTo(-Math.PI / 4, 12);
  });

  it('обратимы', () => {
    for (const deg of [-180, -37.5, 0, 15, 90, 271]) {
      expect(toDegrees(toRadians(deg))).toBeCloseTo(deg, 10);
    }
  });
});

describe('normalizeDegrees', () => {
  it('приводит к (−180, 180]', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(540)).toBe(180);
    expect(normalizeDegrees(-540)).toBe(180);
    expect(normalizeDegrees(725)).toBe(5);
    expect(normalizeDegrees(-725)).toBe(-5);
  });

  it('не возвращает −0 и не пропускает не-числа', () => {
    expect(Object.is(normalizeDegrees(-0), 0)).toBe(true);
    expect(Object.is(normalizeDegrees(-360), 0)).toBe(true);
    expect(normalizeDegrees(Number.NaN)).toBe(0);
    expect(normalizeDegrees(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('результат всегда в полуинтервале', () => {
    for (let deg = -1000; deg <= 1000; deg += 12.5) {
      const d = normalizeDegrees(deg);
      expect(d).toBeGreaterThan(-180);
      expect(d).toBeLessThanOrEqual(180);
      expect(Math.abs(((deg - d) / 360) % 1)).toBeCloseTo(0, 9);
    }
  });
});

describe('rotationDegrees', () => {
  it('шаг поворота показывается без шума float', () => {
    expect(rotationDegrees(Math.PI / 12)).toBe(15);
    expect(rotationDegrees(7 * (Math.PI / 12))).toBe(105);
    expect(rotationDegrees(-Math.PI / 2)).toBe(-90);
    expect(rotationDegrees(Math.PI)).toBe(180);
    expect(rotationDegrees(-Math.PI)).toBe(180);
    expect(rotationDegrees(3 * Math.PI)).toBe(180);
    expect(Object.is(rotationDegrees(-0), 0)).toBe(true);
  });
});

describe('stepDigits и snapToStep', () => {
  it('знаки шага', () => {
    expect(stepDigits(1)).toBe(0);
    expect(stepDigits(0.5)).toBe(1);
    expect(stepDigits(0.05)).toBe(2);
    expect(stepDigits(0)).toBe(2);
  });

  it('зажимает и приводит к сетке шага', () => {
    expect(snapToStep(12.4, 0, 200, 1)).toBe(12);
    expect(snapToStep(250, 0, 200, 1)).toBe(200);
    expect(snapToStep(-3, 0, 200, 1)).toBe(0);
    expect(snapToStep(0.33, 0, 1, 0.05)).toBe(0.35);
    expect(snapToStep(0.15 + 0.15, 0, 1, 0.05)).toBe(0.3);
    expect(snapToStep(7.3, 1, 15, 0.5)).toBe(7.5);
    expect(snapToStep(Number.NaN, 1, 15, 0.5)).toBe(1);
    expect(snapToStep(3.7, 0, 10, 0)).toBe(3.7);
  });
});

describe('normalizeHexColor', () => {
  it('приводит к #rrggbb', () => {
    expect(normalizeHexColor('#FFAA00')).toBe('#ffaa00');
    expect(normalizeHexColor('ffaa00')).toBe('#ffaa00');
    expect(normalizeHexColor(' #fa0 ')).toBe('#ffaa00');
    expect(normalizeHexColor('ABC')).toBe('#aabbcc');
  });

  it('остальное → null', () => {
    for (const text of ['', 'red', '#ffaa0', '#ffaa000', 'rgb(1,2,3)', '#ggg']) {
      expect(normalizeHexColor(text), text).toBeNull();
    }
  });
});

describe('textLimit', () => {
  it('не больше 4000 и не больше maxLength записи', () => {
    expect(textLimit(undefined)).toBe(4000);
    expect(textLimit(40)).toBe(40);
    expect(textLimit(100000)).toBe(4000);
    expect(textLimit(-5)).toBe(0);
  });
});

describe('snapshotFileName', () => {
  const date = new Date(2026, 10, 3, 12, 0, 0);

  it('собирает vagonka-<макет>-<yyyy-mm-dd>.png', () => {
    expect(snapshotFileName('Макет 1', date)).toBe('vagonka-Макет-1-2026-11-03.png');
  });

  it('убирает недопустимые в именах файлов символы', () => {
    expect(snapshotFileName(' ГП: зал / "ёлка"? ', date)).toBe('vagonka-ГП-зал-ёлка-2026-11-03.png');
    expect(snapshotFileName('..', date)).toBe('vagonka-макет-2026-11-03.png');
    expect(snapshotFileName('', date)).toBe('vagonka-макет-2026-11-03.png');
  });
});
