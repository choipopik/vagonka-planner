import { clamp, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { DEG, aimY, guardPainter, paramFlag, paramNumber } from './sortingHat';

// 4.11 «Ёлка 150 см»: искусственная ель на стальной крестовине (см. decor_refs/елка_150_см.jpg).
// Фигура (resize 'uniform'): все размеры выводятся из size; «сантиметровые» детали масштабируются коэффициентом k.
// Модуль самодостаточен по смыслу: в набор «Новый год» переносится сменой одной строки импорта в index набора.

const DEFAULT_SIZE: Vec3 = [0.8, 1.5, 0.8];
const STAND = '#22302a';
const TRUNK = '#4a3524';
const STAR = '#ffd75a';
const LIGHT_COLORS = ['#fff3d6', '#ff5a4a', '#ffc64a'];
const ORNAMENT_COLORS = ['#c8262b', '#d9a520', '#e4e4ea', '#2b56b0'];

export const MAX_TIPS = 200;
export const MAX_LIGHTS = 60;
export const MAX_ORNAMENTS = 40;
const MIN_TIERS = 1;
const MAX_TIERS = 16;
/** Сужение яруса хвои: радиус верха / радиус низа. */
const TIER_TAPER = 0.1;

interface Tier {
  bottom: number;
  height: number;
  radius: number;
}

/** Радиус поверхности хвои на высоте y: самый широкий из ярусов, проходящих через эту высоту. */
function surfaceRadius(tiers: readonly Tier[], y: number): number {
  let radius = 0;
  for (const tier of tiers) {
    if (y < tier.bottom || y > tier.bottom + tier.height) continue;
    const t = tier.height > 0 ? (y - tier.bottom) / tier.height : 0;
    radius = Math.max(radius, tier.radius * (1 - (1 - TIER_TAPER) * t));
  }
  return radius;
}

function build({ size, color, params }: BuildInput): Part[] {
  const [w, h, d] = size;
  // Ёлка круглая: при непропорциональном размере вписывается в меньшую из сторон.
  const W = Math.min(w, d);
  const k = Math.min(W / DEFAULT_SIZE[0], h / DEFAULT_SIZE[1]);
  const tierCount = Math.round(clamp(paramNumber(params, 'tiers', 8), MIN_TIERS, MAX_TIERS));
  const lights = paramFlag(params, 'lights', true);
  const ornaments = Math.round(clamp(paramNumber(params, 'ornaments', 0), 0, MAX_ORNAMENTS));
  const star = paramFlag(params, 'star', false);
  const rng = createRng(paramNumber(params, 'seed', 1));
  const parts: Part[] = [];

  // Со звездой ёлка ниже на 10 см (в масштабе фигуры): звезда занимает макушку габарита.
  const starSize = Math.min(0.14 * k, 0.2 * h);
  const H = star ? h - (starSize * 0.1) / 0.14 : h;

  // ---------- Крестовина и ствол ----------
  const standHeight = Math.min(0.03 * k, 0.05 * h);
  for (const yaw of [0, Math.PI / 2]) {
    parts.push({
      shape: 'box',
      position: [0, standHeight / 2, 0],
      size: [0.5 * W, standHeight, Math.min(0.05 * k, 0.5 * W)],
      rotation: [0, yaw, 0],
      color: STAND,
      roughness: 0.5,
      metalness: 0.6,
    });
  }
  const trunkHeight = 0.2 * H;
  parts.push({
    shape: 'cylinder',
    position: [0, standHeight / 2 + trunkHeight / 2, 0],
    size: [0.05 * k, trunkHeight, 0.05 * k],
    color: TRUNK,
  });

  // ---------- Хвоя: перекрывающиеся ярусы ----------
  const step = (0.86 * H) / tierCount;
  const base = 0.14 * H;
  const tiers: Tier[] = [];
  for (let index = 0; index < tierCount; index++) {
    const bottom = base + index * step;
    tiers.push({
      bottom,
      // Верхний ярус не поднимается выше макушки.
      height: Math.min(1.6 * step, H - bottom),
      radius: 0.5 * W * Math.pow(1 - index / tierCount, 0.9),
    });
  }
  tiers.forEach((tier, index) => {
    parts.push({
      shape: 'cylinder',
      position: [0, tier.bottom + tier.height / 2, 0],
      size: [2 * tier.radius, tier.height, 2 * tier.radius],
      taper: TIER_TAPER,
      // Нижние ярусы чуть темнее — в глубине кроны.
      color: shade(color, 0.85 + (0.25 * index) / tierCount),
      roughness: 0.95,
      paint: { painter: 'hp.needles', px: [256, 256] },
    });
  });

  // ---------- Кончики веток по кромкам ярусов ----------
  const tipLength = 0.14 * k;
  const tipWidth = 0.05 * k;
  const wanted = tiers.map((tier) => Math.max(3, Math.round((2 * Math.PI * tier.radius) / (0.09 * k))));
  const total = wanted.reduce((sum, count) => sum + count, 0);
  const share = total > MAX_TIPS ? MAX_TIPS / total : 1;
  let tipsLeft = MAX_TIPS;
  tiers.forEach((tier, index) => {
    const count = Math.min(tipsLeft, Math.max(1, Math.floor(wanted[index] * share)));
    tipsLeft -= count;
    const turn = rng.range(0, Math.PI * 2);
    for (let tip = 0; tip < count; tip++) {
      const azimuth = turn + ((tip + rng.range(-0.3, 0.3)) / count) * Math.PI * 2;
      // Ось кончика отклонена от вертикали наружу на 60–75°: ветка торчит в сторону, остриём чуть вверх.
      const tilt = rng.range(60, 75) * DEG;
      const tone = rng.range(0.8, 1.3);
      const sin = Math.sin(azimuth);
      const cos = Math.cos(azimuth);
      // Полуразмеры наклонённого конуса по радиусу и по высоте — как их считает partBounds.
      const reachOut = (Math.sin(tilt) * tipLength + Math.cos(tilt) * tipWidth) / 2;
      const reachUp = (Math.cos(tilt) * tipLength + tipWidth) / 2;
      // Центр — на 0.9 радиуса яруса, но так, чтобы кончик не вышел за габарит ни вбок, ни вниз, ни вверх.
      const radius = Math.max(0, Math.min(0.9 * tier.radius, W / 2 - reachOut));
      const y = clamp(tier.bottom + 0.02 * k, reachUp, Math.max(reachUp, H - reachUp));
      parts.push({
        shape: 'cylinder',
        position: [radius * cos, y, radius * sin],
        size: [tipWidth, tipLength, tipWidth],
        rotation: aimY([Math.sin(tilt) * cos, Math.cos(tilt), Math.sin(tilt) * sin]),
        taper: 0,
        color: shade(color, tone),
        roughness: 0.95,
      });
    }
  });

  // ---------- Гирлянда: огоньки по спирали ----------
  if (lights) {
    const bulb = 0.024 * k;
    const turns = 5.5;
    for (let index = 0; index < MAX_LIGHTS; index++) {
      const t = (index + 0.5) / MAX_LIGHTS;
      const y = base + 0.03 * H + t * 0.8 * H + rng.range(-0.008, 0.008) * H;
      const azimuth = t * turns * Math.PI * 2 + rng.range(-0.12, 0.12);
      const radius = clamp(surfaceRadius(tiers, y) + 0.2 * bulb, 0, Math.max(0, W / 2 - bulb / 2));
      parts.push({
        shape: 'sphere',
        position: [radius * Math.cos(azimuth), y, radius * Math.sin(azimuth)],
        size: [bulb, bulb, bulb],
        color: LIGHT_COLORS[index % LIGHT_COLORS.length],
        look: 'glow',
      });
    }
  }

  // ---------- Шары ----------
  // Считаются последними: их число не сдвигает случайную последовательность веток и гирлянды.
  const ball = 0.06 * k;
  for (let index = 0; index < ornaments; index++) {
    const y = base + rng.range(0.02, 0.72) * H;
    const azimuth = rng.range(0, Math.PI * 2);
    const radius = clamp(surfaceRadius(tiers, y) + 0.15 * ball, 0, Math.max(0, W / 2 - ball / 2));
    parts.push({
      shape: 'sphere',
      position: [radius * Math.cos(azimuth), Math.max(y, ball / 2), radius * Math.sin(azimuth)],
      size: [ball, ball, ball],
      color: ORNAMENT_COLORS[index % ORNAMENT_COLORS.length],
      roughness: 0.3,
      metalness: 0.6,
    });
  }

  // ---------- Звезда на макушке ----------
  if (star) {
    parts.push({
      shape: 'plane',
      position: [0, h - starSize / 2, 0],
      size: [starSize, starSize, 0],
      color: STAR,
      look: 'glow',
      cutout: true,
      doubleSided: true,
      paint: { painter: 'hp.star', px: [128, 128] },
    });
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.xmasTree',
  kind: 'preset',
  title: 'Ёлка 150 см',
  category: 'Гарри Поттер',
  size: DEFAULT_SIZE,
  resize: 'uniform',
  color: '#2f5d34',
  mounts: ['floor'],
  params: [
    { key: 'tiers', label: 'Ярусы', type: 'number', min: 5, max: 12, step: 1, default: 8 },
    { key: 'lights', label: 'Гирлянда', type: 'boolean', default: true },
    { key: 'ornaments', label: 'Шары', type: 'number', min: 0, max: 40, step: 1, default: 0 },
    { key: 'star', label: 'Звезда', type: 'boolean', default: false },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

export const painters: Record<string, Painter> = {
  /**
   * Тайлящаяся хвоя. Цвет части умножается на текстуру, поэтому фон светлый, а иголки — тёмные и светлые штрихи.
   * Штрихи, пересекающие левый или правый край, дорисовываются с другой стороны: на шве цилиндра рисунок сходится.
   */
  'hp.needles': guardPainter('hp.needles', '#d0d0d0', (ctx, width, height) => {
    ctx.fillStyle = '#c4c4c4';
    ctx.fillRect(0, 0, width, height);
    // Сверху ярус уходит под следующий — там темнее; кромка внизу светлее.
    const depth = ctx.createLinearGradient(0, 0, 0, height);
    depth.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    depth.addColorStop(0.6, 'rgba(0, 0, 0, 0.1)');
    depth.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, width, height);

    const rng = createRng(150);
    ctx.lineCap = 'round';
    for (let index = 0; index < 520; index++) {
      const x = rng.range(0, width);
      const y = rng.range(0, height);
      const length = rng.range(0.05, 0.11) * height;
      const lean = rng.range(-0.35, 0.35) * length;
      const light = rng.next() < 0.45;
      const alpha = rng.range(0.25, 0.6);
      ctx.strokeStyle = light ? `rgba(255, 255, 255, ${alpha.toFixed(2)})` : `rgba(0, 0, 0, ${alpha.toFixed(2)})`;
      ctx.lineWidth = Math.max(1, width * rng.range(0.004, 0.009));
      // Иголки свисают вниз и чуть в сторону; копии слева и справа закрывают шов.
      for (const shift of [-width, 0, width]) {
        ctx.beginPath();
        ctx.moveTo(x + shift, y);
        ctx.lineTo(x + shift + lean, y + length);
        ctx.stroke();
      }
    }
  }),

  /** Пятиконечная звезда на прозрачном фоне (часть рисуется с cutout); цвет задаёт часть, текстура — белая. */
  'hp.star': guardPainter('hp.star', '#ffffff', (ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height * 0.53;
    const outer = Math.min(width, height) * 0.47;
    const inner = outer * 0.42;
    ctx.beginPath();
    for (let point = 0; point < 10; point++) {
      const radius = point % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (point * Math.PI) / 5;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // Чуть более тёплая середина — намёк на объём; непрозрачность везде 1, вырез остаётся чётким.
    const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
    warm.addColorStop(0, 'rgba(255, 255, 255, 0)');
    warm.addColorStop(1, 'rgba(230, 170, 60, 0.35)');
    ctx.save();
    ctx.clip();
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }),
};
