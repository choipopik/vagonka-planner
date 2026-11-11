/** Общие помощники билдеров (basic, W6, W7): одна реализация, одно округление. */

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((ch(r) << 16) | (ch(g) << 8) | ch(b)).toString(16).padStart(6, '0')}`;
}

/** Затемняет (factor < 1) или осветляет (factor > 1): каждый канал × factor, округление, зажим 0…255. '#rrggbb' → '#rrggbb'. */
export function shade(hex: string, factor: number): string {
  // Вход не '#rrggbb' (или не число вместо множителя) возвращается как есть: функция никогда не бросает.
  if (!HEX.test(hex) || !Number.isFinite(factor)) return hex;
  const [r, g, b] = channels(hex);
  return toHex(r * factor, g * factor, b * factor);
}

/** Линейная смесь по каналам: t = 0 → a, t = 1 → b; t зажимается в [0, 1]. '#rrggbb' → '#rrggbb' (нижний регистр). */
export function mix(a: string, b: string, t: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const k = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  const ca = channels(a);
  const cb = channels(b);
  return toHex(lerp(ca[0], cb[0], k), lerp(ca[1], cb[1], k), lerp(ca[2], cb[2], k));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** a + (b − a)·t, без зажима t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
