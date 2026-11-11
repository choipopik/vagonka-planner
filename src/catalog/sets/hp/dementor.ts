import { clamp, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { DEG, eulerOfBasis, paramFlag, paramNumber } from './sortingHat';

// 4.2 «Дементор на стойке»: фанерный диск и шест, на которых висит чёрный плащ с капюшоном (см. decor_refs).
// Фигура (resize 'uniform'): все размеры выводятся из size; «сантиметровые» толщины масштабируются коэффициентом k.

const DEFAULT_SIZE: Vec3 = [0.9, 2.0, 0.7];
const WOOD = '#cdbf9c';

/** Уровни плаща снизу вверх: радиус в долях w и высота в долях h (нижний уровень — hover). */
const CLOAK_RADII = [0.46, 0.4, 0.33, 0.3, 0.12];
const CLOAK_HEIGHTS = [0, 0.25, 0.55, 0.76, 0.83];
/** taper = r_верх / r_низ, округлённый до 0.05; первые два кольца делят одну геометрию. */
const CLOAK_TAPERS = [0.85, 0.85, 0.9, 0.4];

function build({ size, color, params }: BuildInput): Part[] {
  const [w, h, d] = size;
  // Единый масштаб «сантиметровых» деталей; при пропорциональном размере все три отношения равны.
  const k = Math.min(w / DEFAULT_SIZE[0], h / DEFAULT_SIZE[1], d / DEFAULT_SIZE[2]);
  // Ширина для размеров и сдвигов вдоль Z: при пропорциональном размере равна w, у «сплющенного» объекта — меньше.
  const wz = Math.min(w, (d * DEFAULT_SIZE[0]) / DEFAULT_SIZE[2]);
  const arms = clamp(paramNumber(params, 'arms', 0.5), 0, 1);
  const tatter = clamp(paramNumber(params, 'tatter', 0.6), 0, 1);
  // Подол не поднимается выше 0.2h: при h = 2 это ровно предел параметра (0.4 м), у уменьшенной фигуры — меньше.
  const hover = clamp(paramNumber(params, 'hover', 0), 0, 0.2 * h);
  const showBase = paramFlag(params, 'showBase', true);
  const rng = createRng(paramNumber(params, 'seed', 1));
  const cloth = { color, roughness: 0.95 };
  const parts: Part[] = [];

  // ---------- Стойка: фанерный диск и шест ----------
  if (showBase) {
    const disc = 0.03 * k;
    parts.push({ shape: 'cylinder', position: [0, disc / 2, 0], size: [0.5 * w, disc, Math.min(0.5 * w, d)], color: WOOD });
    const poleTop = Math.max(0.78 * h, disc + 0.001 * k);
    parts.push({
      shape: 'cylinder',
      position: [0, (disc + poleTop) / 2, 0],
      size: [0.04 * k, poleTop - disc, 0.04 * k],
      color: WOOD,
    });
  }

  // ---------- Плащ: 4 усечённых цилиндра эллиптического сечения ----------
  const levelY = (index: number) => (index === 0 ? hover : CLOAK_HEIGHTS[index] * h);
  for (let index = 0; index < 4; index++) {
    const bottom = levelY(index);
    const top = levelY(index + 1);
    const radius = CLOAK_RADII[index];
    parts.push({
      shape: 'cylinder',
      position: [0, (bottom + top) / 2, 0],
      size: [2 * radius * w, top - bottom, 2 * radius * d],
      taper: CLOAK_TAPERS[index],
      ...cloth,
    });
  }

  // ---------- Лохмотья подола ----------
  // Узкие полосы по периметру подола; низ каждой — чуть снаружи подола, верх отклонён к плащу (полоса расходится
  // наружу книзу не более чем на 10°). Над полом подол висит — тогда полосы свисают ниже него, но не ниже пола.
  const strips = Math.round(8 + 10 * tatter);
  const thickness = 0.01 * k;
  for (let index = 0; index < strips; index++) {
    const angle = ((index + rng.range(-0.3, 0.3)) / strips) * Math.PI * 2;
    const length = rng.range(0.1, 0.25) * h;
    const flare = rng.range(2, 10) * DEG;
    const fraction = rng.range(0.455, 0.485);
    const hang = rng.range(0.15, 0.5);
    const tone = rng.range(0.75, 1.35);
    const bottomY = Math.max(0, hover - hang * length);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const bottom: Vec3 = [fraction * w * cos, bottomY, fraction * d * sin];
    // Наружная нормаль эллипса подола (горизонтальная).
    const normalLength = Math.hypot(d * cos, w * sin);
    const out: Vec3 = normalLength > 1e-9 ? [(d * cos) / normalLength, 0, (w * sin) / normalLength] : [cos, 0, sin];
    // Локальные оси полосы: Y — вдоль полосы вверх и к плащу, Z — наружу, X — по касательной.
    const up: Vec3 = [-Math.sin(flare) * out[0], Math.cos(flare), -Math.sin(flare) * out[2]];
    const face: Vec3 = [Math.cos(flare) * out[0], Math.sin(flare), Math.cos(flare) * out[2]];
    const tangent: Vec3 = [up[1] * face[2] - up[2] * face[1], up[2] * face[0] - up[0] * face[2], up[0] * face[1] - up[1] * face[0]];
    parts.push({
      shape: 'box',
      position: [bottom[0] + (up[0] * length) / 2, bottom[1] + (up[1] * length) / 2 + 0.5 * thickness, bottom[2] + (up[2] * length) / 2],
      size: [0.06 * w, length, thickness],
      rotation: eulerOfBasis(tangent, up, face),
      color: shade(color, tone),
      roughness: 0.95,
    });
  }

  // ---------- Плечи и рукава ----------
  const shoulderY = 0.76 * h;
  parts.push({
    shape: 'box',
    position: [0, shoulderY, 0],
    size: [0.5 * w, 0.05 * k, Math.min(0.08 * k, d)],
    ...cloth,
  });
  // Рукава висят вдоль тела и отводятся в стороны на φ = arms · φmax; нижний конец — не дальше x = ±0.45w при любом arms.
  const sleeve = 0.4 * h;
  const spreadMax = Math.asin(Math.min(1, (0.25 * w) / sleeve));
  const spread = arms * spreadMax;
  for (const sign of [-1, 1]) {
    parts.push({
      shape: 'cylinder',
      position: [sign * (0.2 * w + (sleeve / 2) * Math.sin(spread)), shoulderY - (sleeve / 2) * Math.cos(spread), 0],
      size: [0.22 * w, sleeve, Math.min(0.22 * w, 0.4 * d)],
      // Ось Y части смотрит от кисти к плечу: у плеча рукав у́же (taper 0.6).
      rotation: [0, 0, sign * spread],
      taper: 0.6,
      ...cloth,
    });
  }

  // ---------- Капюшон и провал лица ----------
  parts.push({ shape: 'sphere', position: [0, 0.88 * h, 0], size: [0.34 * w, 0.2 * h, 0.36 * wz], ...cloth });
  // Пик капюшона наклонён вперёд на 35°; его габарит (как его считает partBounds) не выше h.
  const peakHeight = 0.14 * h;
  // У «сплющенного» по глубине объекта наклон уменьшается, чтобы пик не вышел за габарит вперёд.
  const peakTilt = Math.min(35 * DEG, Math.asin(clamp((d - 0.28 * wz) / peakHeight, 0, 1)));
  const peakReach = (Math.cos(peakTilt) * peakHeight + Math.sin(peakTilt) * 0.2 * wz) / 2;
  parts.push({
    shape: 'cylinder',
    position: [0, Math.min(0.93 * h, h - peakReach), 0.04 * wz],
    size: [0.2 * w, peakHeight, 0.2 * wz],
    rotation: [peakTilt, 0, 0],
    taper: 0,
    ...cloth,
  });
  // Неосвещаемая чёрная дыра; вынесена на сантиметр вперёд от поверхности капюшона, чтобы грани не совпадали.
  parts.push({
    shape: 'sphere',
    position: [0, 0.87 * h, 0.16 * wz],
    size: [0.2 * w, 0.13 * h, 0.06 * wz],
    color: '#020203',
    look: 'glow',
  });
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.dementor',
  kind: 'preset',
  title: 'Дементор на стойке',
  category: 'Гарри Поттер',
  size: DEFAULT_SIZE,
  resize: 'uniform',
  color: '#0b0b0f',
  mounts: ['floor'],
  params: [
    { key: 'arms', label: 'Руки в стороны', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'tatter', label: 'Лохмотья', type: 'number', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'hover', label: 'Подол над полом, м', type: 'number', min: 0, max: 0.4, step: 0.05, default: 0 },
    { key: 'showBase', label: 'Стойка', type: 'boolean', default: true },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

// Плащ однотонный — текстуры предмету не нужны.
export const painters: Record<string, Painter> = {};
