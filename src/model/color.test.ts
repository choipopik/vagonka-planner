import { describe, expect, it } from 'vitest';
import { clamp, lerp, mix, shade } from './color';

/** Реализация этапа 1 (scene/objects/parts.ts) — эталон для сравнения. */
function shadeStage1(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

describe('shade', () => {
  it('совпадает с этапом 1', () => {
    // Три примера, посчитанные вручную: каждый канал × factor, округление, зажим.
    expect(shade('#8a8378', 0.9)).toBe('#7c766c'); // спинка дивана
    expect(shade('#b3161b', 0.3)).toBe('#360708'); // стёкла будки
    expect(shade('#b3161b', 0.85)).toBe('#981317'); // крыша будки
    for (const [hex, factor] of [
      ['#8a8378', 0.9],
      ['#b3161b', 0.3],
      ['#b3161b', 0.85],
      ['#7b3a26', 1.25],
      ['#000000', 3],
      ['#ffffff', 0.5],
    ] as const) {
      expect(shade(hex, factor)).toBe(shadeStage1(hex, factor));
    }
  });

  it('осветление зажимается на 255, множитель 1 ничего не меняет', () => {
    expect(shade('#808080', 2.5)).toBe('#ffffff');
    expect(shade('#102030', 2)).toBe('#204060');
    expect(shade('#a1b2c3', 1)).toBe('#a1b2c3');
    expect(shade('#A1B2C3', 1)).toBe('#a1b2c3'); // результат — в нижнем регистре
    expect(shade('#123456', 0)).toBe('#000000');
  });

  it('не-hex вход возвращается как есть и не бросает', () => {
    for (const bad of ['red', '#fff', '#12345', '#1234567', 'rgb(1,2,3)', '', '#gggggg']) {
      expect(shade(bad, 0.5)).toBe(bad);
    }
    expect(shade('#808080', NaN)).toBe('#808080');
  });
});

describe('mix', () => {
  it('концы и середина', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#305070', 0.5)).toBe('#203850');
    expect(mix('#12443a', '#ffffff', 0.25)).toBe('#4d736b');
  });

  it('t зажимается в [0, 1]', () => {
    expect(mix('#102030', '#305070', -3)).toBe('#102030');
    expect(mix('#102030', '#305070', 7)).toBe('#305070');
  });

  it('результат — в нижнем регистре; не-hex вход возвращается как есть', () => {
    expect(mix('#AABBCC', '#AABBCC', 0.3)).toBe('#aabbcc');
    expect(mix('red', '#ffffff', 0.5)).toBe('red');
    expect(mix('#ffffff', 'blue', 0.5)).toBe('#ffffff');
  });
});

describe('clamp / lerp', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('lerp не зажимает t', () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(lerp(2, 4, 2)).toBe(6);
    expect(lerp(2, 4, -1)).toBe(0);
  });
});
