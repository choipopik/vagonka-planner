import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { DEG, rod } from './sortingHat';

// 4.9 «Добби»: домовик в чёрной наволочке, руки сложены перед грудью (см. decor_refs).
// Фигура (resize 'uniform'): все размеры — доли единицы u (= h при пропорциональном размере).

const DEFAULT_SIZE: Vec3 = [0.45, 1.0, 0.3];
const PILLOWCASE = '#141414';
const EYE = '#cfe3c0';
const PUPIL = '#1a1a1a';

function build({ size, color }: BuildInput): Part[] {
  const [w, h, d] = size;
  // Фигура сохраняет пропорции и вписывается в габарит: при пропорциональном размере u = h.
  const u = Math.min(h / DEFAULT_SIZE[1], w / DEFAULT_SIZE[0], d / DEFAULT_SIZE[2]);
  /** Точка или размер в долях u. */
  const p = (x: number, y: number, z: number): Vec3 => [x * u, y * u, z * u];
  const s = p;
  const skin = { color };
  const parts: Part[] = [];

  for (const sign of [-1, 1]) {
    // Ноги и ступни (ступни вынесены вперёд).
    parts.push({ shape: 'cylinder', position: p(sign * 0.07, 0.16, 0), size: s(0.055, 0.3, 0.055), taper: 0.8, ...skin });
    parts.push({ shape: 'sphere', position: p(sign * 0.07, 0.015, 0.035), size: s(0.06, 0.03, 0.13), ...skin });
  }

  // Наволочка с узлами на плечах.
  parts.push({ shape: 'cylinder', position: p(0, 0.475, 0), size: s(0.26, 0.41, 0.22), taper: 0.7, color: PILLOWCASE, roughness: 0.95 });
  for (const sign of [-1, 1]) {
    parts.push({
      shape: 'box',
      position: p(sign * 0.08, 0.69, 0),
      size: s(0.03, 0.03, 0.03),
      rotation: [0, 0, sign * 45 * DEG],
      color: PILLOWCASE,
      roughness: 0.95,
    });
  }

  for (const sign of [-1, 1]) {
    // Плечо — вниз и чуть в сторону от плеча, предплечье — вперёд к сложенным кистям.
    const shoulder = p(sign * 0.1, 0.66, 0);
    const elbow = p(sign * 0.17, 0.47, 0);
    const wrist = p(sign * 0.03, 0.45, 0.115);
    parts.push(rod(shoulder, elbow, 0.04 * u, skin));
    parts.push(rod(elbow, wrist, 0.035 * u, skin));
    // Локоть и кисть.
    parts.push({ shape: 'sphere', position: elbow, size: s(0.042, 0.042, 0.042), ...skin });
    parts.push({ shape: 'sphere', position: p(sign * 0.02, 0.45, 0.12), size: s(0.05, 0.05, 0.05), ...skin });
  }

  // Шея и голова.
  parts.push({ shape: 'cylinder', position: p(0, 0.72, 0), size: s(0.05, 0.12, 0.05), ...skin });
  parts.push({ shape: 'sphere', position: p(0, 0.84, 0), size: s(0.19, 0.17, 0.19), ...skin });
  for (const sign of [-1, 1]) {
    // Уши летучей мыши: плоские, отведены назад на 20° и чуть задраны.
    parts.push({
      shape: 'sphere',
      position: p(sign * 0.14, 0.85, -0.01),
      size: s(0.13, 0.08, 0.012),
      rotation: [0, sign * 20 * DEG, sign * 15 * DEG],
      ...skin,
    });
    // Большие глаза навыкате и зрачки.
    parts.push({ shape: 'sphere', position: p(sign * 0.045, 0.86, 0.07), size: s(0.044, 0.044, 0.044), color: EYE });
    parts.push({ shape: 'sphere', position: p(sign * 0.045, 0.86, 0.088), size: s(0.02, 0.02, 0.02), color: PUPIL });
  }
  // Длинный нос: конус остриём вперёд (+Z) и чуть вниз.
  parts.push({
    shape: 'cylinder',
    position: p(0, 0.825, 0.112),
    size: s(0.018, 0.07, 0.018),
    rotation: [100 * DEG, 0, 0],
    taper: 0,
    ...skin,
  });
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.dobby',
  kind: 'preset',
  title: 'Добби',
  category: 'Гарри Поттер',
  size: DEFAULT_SIZE,
  resize: 'uniform',
  color: '#d9a98c',
  colorable: false,
  mounts: ['floor'],
  params: [],
  build,
};

// Фигура однотонная — текстуры предмету не нужны.
export const painters: Record<string, Painter> = {};
