import { clamp, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { DEG, guardPainter, paramColor, paramFlag, paramNumber, rod } from './sortingHat';

// 4.10 «Сова в клетке»: кованая клетка с куполом и кольцом, внутри — белая полярная сова (см. decor_refs).
// Фигура (resize 'uniform'): все размеры выводятся из size; «сантиметровые» толщины масштабируются коэффициентом k.
// Без seed: клетка и сова всегда одинаковые.

const DEFAULT_SIZE: Vec3 = [0.32, 0.6, 0.32];
const DEFAULT_CAGE = '#3a2a20';
const FEATHER = '#f4f2ec';
const EYE = '#f2c400';
const PUPIL = '#141414';
const BEAK = '#2a2622';
/** Предел числа прутьев — на случай параметра, пришедшего мимо resolveParams. */
const MIN_BARS = 3;
const MAX_BARS = 48;

function build({ size, params }: BuildInput): Part[] {
  const [w, h, d] = size;
  // Клетка круглая: при непропорциональном размере вписывается в меньшую из сторон.
  const W = Math.min(w, d);
  const k = Math.min(W / DEFAULT_SIZE[0], h / DEFAULT_SIZE[1]);
  const bars = Math.round(clamp(paramNumber(params, 'bars', 20), MIN_BARS, MAX_BARS));
  const cageColor = paramColor(params, 'cageColor', DEFAULT_CAGE);
  const withOwl = paramFlag(params, 'withOwl', true);
  const iron = { color: cageColor, roughness: 0.6, metalness: 0.5 };
  const parts: Part[] = [];

  // ---------- Клетка ----------
  const floor = Math.min(0.03 * k, 0.1 * h);
  const tube = Math.min(0.012 * k, 0.5 * W);
  const wire = 0.006 * k;
  const R = Math.max(W / 2 - 0.005 * k, 0.25 * W);
  const wallTop = 0.62 * h;

  parts.push({ shape: 'cylinder', position: [0, floor / 2, 0], size: [W, floor, W], ...iron });
  // Обручи: лежат горизонтально; нижний опирается на дно, верхний держит купол.
  for (const y of [floor, 0.32 * h, wallTop]) {
    parts.push({ shape: 'torus', position: [0, y, 0], size: [W, W, tube], rotation: [Math.PI / 2, 0, 0], ...iron });
  }
  // Прутья по окружности; первый — сзади (−Z), чтобы спереди сова смотрела между двумя прутьями, когда их чётное число.
  const barBottom = floor / 2;
  for (let index = 0; index < bars; index++) {
    const angle = ((index + 0.5) / bars) * Math.PI * 2;
    parts.push({
      shape: 'cylinder',
      position: [R * Math.sin(angle), (barBottom + wallTop) / 2, -R * Math.cos(angle)],
      size: [wire, wallTop - barBottom, wire],
      ...iron,
    });
  }
  // Купол: вдвое меньше прутьев, сходятся от верхнего обруча к луковке.
  const ribs = Math.max(2, Math.round(bars / 2));
  for (let index = 0; index < ribs; index++) {
    const angle = ((index + 0.5) / ribs) * Math.PI * 2;
    const sin = Math.sin(angle);
    const cos = -Math.cos(angle);
    parts.push(rod([R * sin, wallTop, R * cos], [0.35 * R * sin, 0.84 * h, 0.35 * R * cos], wire, iron));
  }
  // Луковка и кольцо для подвеса (стоит вертикально; его верх — ровно на высоте h).
  parts.push({ shape: 'sphere', position: [0, 0.88 * h, 0], size: [0.3 * W, 0.1 * h, 0.3 * W], ...iron });
  const ring = Math.min(0.05 * k, 0.09 * h);
  parts.push({ shape: 'torus', position: [0, h - ring / 2, 0], size: [ring, ring, 0.16 * ring], ...iron });

  // ---------- Сова ----------
  if (withOwl) {
    // Одна текстура перьев на тело, голову и крылья → один вызов отрисовки.
    const feathers: Pick<Part, 'color' | 'roughness' | 'paint'> = {
      color: FEATHER,
      roughness: 0.95,
      paint: { painter: 'hp.owlFeathers', px: [256, 256] },
    };
    const bodyHeight = 0.42 * h;
    const bodyY = floor + bodyHeight / 2 - Math.min(0.01 * h, 0.5 * floor);
    parts.push({ shape: 'sphere', position: [0, bodyY, 0], size: [0.62 * W, bodyHeight, 0.56 * W], ...feathers });
    for (const sign of [-1, 1]) {
      // Сложенные крылья по бокам, верх чуть завален к телу.
      const roll = 8 * DEG;
      // Полуширина наклонённого крыла (как её считает partBounds): крыло не выходит за габарит и у «сплющенной» клетки.
      const reach = Math.hypot(Math.cos(roll) * 0.12 * W, Math.sin(roll) * 0.3 * h) / 2;
      parts.push({
        shape: 'sphere',
        position: [sign * Math.max(0, Math.min(0.27 * W, W / 2 - reach)), bodyY - Math.min(0.01 * h, 0.5 * floor), -0.02 * W],
        size: [0.12 * W, 0.3 * h, 0.4 * W],
        rotation: [0, 0, sign * roll],
        ...feathers,
      });
    }
    const headY = 0.47 * h;
    parts.push({ shape: 'sphere', position: [0, headY, 0], size: [0.5 * W, 0.2 * h, 0.46 * W], ...feathers });
    for (const sign of [-1, 1]) {
      // Жёлтые глаза с чёрными зрачками — на передней поверхности головы.
      parts.push({ shape: 'sphere', position: [sign * 0.1 * W, headY + 0.012 * h, 0.195 * W], size: [0.07 * W, 0.07 * W, 0.07 * W], color: EYE, roughness: 0.4 });
      parts.push({ shape: 'sphere', position: [sign * 0.1 * W, headY + 0.012 * h, 0.222 * W], size: [0.035 * W, 0.035 * W, 0.035 * W], color: PUPIL, roughness: 0.4 });
    }
    // Клюв: конус остриём вниз и немного вперёд.
    parts.push({
      shape: 'cylinder',
      position: [0, headY - 0.028 * h, 0.228 * W],
      size: [0.05 * W, 0.085 * W, 0.05 * W],
      rotation: [155 * DEG, 0, 0],
      taper: 0,
      color: BEAK,
      roughness: 0.5,
    });
    // Лапы выглядывают из-под перьев.
    for (const sign of [-1, 1]) {
      parts.push({
        shape: 'sphere',
        position: [sign * 0.08 * W, floor + 0.012 * h, 0.2 * W],
        size: [0.07 * W, 0.024 * h, 0.1 * W],
        color: shade(FEATHER, 0.92),
        roughness: 0.95,
      });
    }
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.owlCage',
  kind: 'preset',
  title: 'Сова в клетке',
  category: 'Гарри Поттер',
  size: DEFAULT_SIZE,
  resize: 'uniform',
  color: DEFAULT_CAGE,
  // Цвет клетки задаёт параметр «Цвет клетки»; общее поле цвета объекта ничего бы не меняло.
  colorable: false,
  mounts: ['surface', 'ceiling', 'floor'],
  defaultDrop: 0.6,
  hanger: true,
  params: [
    { key: 'bars', label: 'Прутья', type: 'number', min: 12, max: 32, step: 1, default: 20 },
    { key: 'cageColor', label: 'Цвет клетки', type: 'color', default: DEFAULT_CAGE },
    { key: 'withOwl', label: 'Сова', type: 'boolean', default: true },
  ],
  build,
};

export const painters: Record<string, Painter> = {
  /**
   * Белое оперение с редкими тёмными крапинами. Цвет части умножается на текстуру, поэтому фон — белый.
   * Крапины не подходят к левому и правому краю (шов сзади) и к полюсам сферы (верх и низ canvas), а в
   * горизонтальном центре — на груди и «лице» — их меньше.
   */
  'hp.owlFeathers': guardPainter('hp.owlFeathers', '#ffffff', (ctx, width, height) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Лёгкая тень книзу — объём пуха.
    const soft = ctx.createLinearGradient(0, 0, 0, height);
    soft.addColorStop(0, 'rgba(150, 150, 165, 0)');
    soft.addColorStop(1, 'rgba(150, 150, 165, 0.22)');
    ctx.fillStyle = soft;
    ctx.fillRect(0, 0, width, height);

    const rng = createRng(390);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let index = 0; index < 90; index++) {
      const u = rng.range(0.04, 0.96);
      const v = rng.range(0.2, 0.88);
      const tone = rng.range(0.35, 0.7);
      const span = rng.range(0.012, 0.024) * width;
      // В центре (грудь, лицо) крапины реже.
      if (Math.abs(u - 0.5) < 0.12 && rng.next() < 0.6) continue;
      const x = u * width;
      const y = v * height;
      // Крапина — маленькая «галочка» остриём вниз.
      ctx.strokeStyle = `rgba(40, 36, 34, ${tone.toFixed(2)})`;
      ctx.lineWidth = Math.max(1, span * 0.45);
      ctx.beginPath();
      ctx.moveTo(x - span, y - span * 0.5);
      ctx.lineTo(x, y + span * 0.5);
      ctx.lineTo(x + span, y - span * 0.5);
      ctx.stroke();
    }
  }),
};
