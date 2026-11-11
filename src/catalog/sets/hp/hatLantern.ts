import { clamp } from '../../../model/color';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { guardPainter, paramColor, paramNumber, rgba, sortingHat } from './sortingHat';

// 4.6 «Шляпа-фонарь»: Распределяющая шляпа со светящимися глазами и ртом и пятном света на столе под ней.
// Фигура (resize 'uniform'): все размеры выводятся из size. Настоящего света пресет не создаёт (Р14) —
// при желании рядом ставится объект «Лампа».

const DEFAULT_GLOW = '#ffab3d';

function build({ size, color, params }: BuildInput): Part[] {
  const h = size[1];
  // Шляпа круглая: при непропорциональном размере вписывается в меньшую из сторон.
  const w = Math.min(size[0], size[2]);
  const glowColor = paramColor(params, 'glowColor', DEFAULT_GLOW);
  const glow = clamp(paramNumber(params, 'glow', 1), 0, 2);
  const parts = sortingHat(w, h, { color, face: 'glow', glowColor, glow, seed: paramNumber(params, 'seed', 1) });

  // Пятно света на столе: аддитивная плоскость лицом вверх (вправе выходить за габарит). При нулевой яркости её нет.
  const opacity = Math.round(0.45 * glow * 1000) / 1000;
  if (opacity >= 0.01) {
    parts.push({
      shape: 'plane',
      position: [0, 0.002, 0],
      size: [1.6 * w, 1.6 * w, 0],
      rotation: [-Math.PI / 2, 0, 0],
      color: '#ffffff',
      look: 'glow',
      additive: true,
      opacity,
      paint: { painter: 'hp.glowDisc', args: { color: glowColor }, px: [128, 128] },
    });
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.hatLantern',
  kind: 'preset',
  title: 'Шляпа-фонарь',
  category: 'Гарри Поттер',
  size: [0.36, 0.35, 0.36],
  resize: 'uniform',
  color: '#4a3f33',
  mounts: ['surface', 'floor'],
  params: [
    { key: 'glowColor', label: 'Цвет свечения', type: 'color', default: DEFAULT_GLOW },
    { key: 'glow', label: 'Яркость', type: 'number', min: 0, max: 2, step: 0.1, default: 1 },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

export const painters: Record<string, Painter> = {
  /** Мягкое круглое пятно света: цвет в центре, к краю сходит в прозрачность (углы canvas — прозрачные). */
  'hp.glowDisc': guardPainter('hp.glowDisc', '#000000', (ctx, width, height, args) => {
    const color = paramColor(args, 'color', DEFAULT_GLOW);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, rgba(color, 1));
    gradient.addColorStop(0.3, rgba(color, 0.7));
    gradient.addColorStop(0.65, rgba(color, 0.22));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }),
};
