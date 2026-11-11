import { clamp, lerp } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { SERIF, drawLines, guarded, paintStar, paramNumber, rgba, thread } from './paper';

// 4.4 «Сова с письмами»: плоская печатная сова под потолком и письма на нитях вокруг неё.
// Площадной предмет: письмо держит свой размер (22 × 15 см), а помещается их столько, сколько позволяет площадь
// при расстоянии между нитями 18 см, но не больше параметра `letters` и не больше 60.

export const MAX_LETTERS = 60;
/** Письмо, м. */
export const LETTER_W = 0.22;
export const LETTER_H = 0.15;
/** Наименьшее расстояние между центрами писем в плане, м. */
export const LETTER_GAP = 0.18;
/** Отступ центра письма от края прямоугольника, м. */
const LETTER_MARGIN = 0.11;
const LETTER_PX: [number, number] = [256, 176];
const OWL_PX: [number, number] = [1024, 512];
/** Наклон совы к зрителю (лицом вниз), рад. */
const OWL_TILT = (15 * Math.PI) / 180;
const MAX_ROLL = (25 * Math.PI) / 180;
const MAX_PITCH = (15 * Math.PI) / 180;

/**
 * Где на листе совы (доли W, от центра плоскости; y — вверх) нарисованы тело и голова: по этим же числам painter
 * `hp.owlFlying` рисует, а билдер ставит сферы объёма позади листа.
 */
const BODY_Y = -0.05;
const HEAD_Y = 0.07;

export interface OwlFrame {
  w: number;
  h: number;
  d: number;
  /** Зажатый размах крыльев (ширина листа совы). */
  W: number;
  /** Зажатый опуск совы от потолка. */
  D: number;
  /** Центр листа совы по высоте. */
  centerY: number;
  /** Нижний край листа совы. */
  bottomY: number;
  /** Масштаб письма: 1 при любом допустимом размере; меньше — только у вырожденного габарита (у́же 0.3 м, ниже 0.5 м). */
  scale: number;
}

/** Зажимы под габарит (чистая; ею же пользуется тест). */
export function owlFrame({ size, params }: BuildInput): OwlFrame {
  const w = Math.max(size[0], 0.01);
  const h = Math.max(size[1], 0.01);
  const d = Math.max(size[2], 0.01);
  // W = min(wingspan, w); дополнительно — лист высотой 0.5·W обязан поместиться по высоте с запасом 5 см
  // (при h < 0.85 м и размахе больше 1.5 м), а тело совы — по глубине (W ≤ 2d выполняется при любом допустимом d).
  const W = Math.min(clamp(paramNumber(params, 'wingspan', 1.2), 0.8, 1.6), w, 2 * d, Math.max(2 * (h - 0.05), 0.5 * h));
  const D = Math.max(0, Math.min(clamp(paramNumber(params, 'owlDrop', 0.25), 0.1, 0.6), h - 0.5 * W - 0.05));
  const centerY = h - D - 0.25 * W;
  return {
    w,
    h,
    d,
    W,
    D,
    centerY,
    bottomY: centerY - 0.25 * W * Math.cos(OWL_TILT),
    scale: Math.min(1, w / 0.3, d / 0.3, h / 0.5),
  };
}

interface Letter {
  center: Vec3;
  pitch: number;
  yaw: number;
  roll: number;
}

/** Столбцы матрицы поворота Эйлера XYZ: образы локальных осей X, Y (верх письма) и Z (нормаль лицевой стороны). */
function axes(pitch: number, yaw: number, roll: number): { right: Vec3; up: Vec3; normal: Vec3 } {
  const a = Math.cos(pitch);
  const b = Math.sin(pitch);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const e = Math.cos(roll);
  const f = Math.sin(roll);
  return {
    right: [c * e, a * f + b * s * e, b * f - a * s * e],
    up: [-c * f, a * e - b * s * f, b * e + a * s * f],
    normal: [s, -b * c, a * c],
  };
}

function lettersOf(f: OwlFrame, input: BuildInput): Letter[] {
  const wanted = Math.round(clamp(paramNumber(input.params, 'letters', 25), 0, MAX_LETTERS));
  const rng = createRng(paramNumber(input.params, 'seed', 1));
  const lw = LETTER_W * f.scale;
  const lh = LETTER_H * f.scale;
  const gap = LETTER_GAP * f.scale;
  const margin = LETTER_MARGIN * f.scale;
  // Зона совы в плане: нить письма не должна проходить сквозь лист и тело, а само письмо — висеть на их высоте.
  const owlHalfZ = 0.25 * f.W * Math.sin(OWL_TILT);
  const letters: Letter[] = [];

  for (let index = 0; index < wanted; index++) {
    // Любой угол рыскания, крен ±25°, тангаж ±15°.
    const yaw = rng.range(-Math.PI, Math.PI);
    const roll = rng.range(-MAX_ROLL, MAX_ROLL);
    const pitch = rng.range(-MAX_PITCH, MAX_PITCH);
    const heightAt = rng.next();
    const { right, up } = axes(pitch, yaw, roll);
    // Полуразмеры наклонённого письма по осям объекта.
    const extX = (Math.abs(right[0]) * lw + Math.abs(up[0]) * lh) / 2;
    const extY = (Math.abs(right[1]) * lw + Math.abs(up[1]) * lh) / 2;
    const extZ = (Math.abs(right[2]) * lw + Math.abs(up[2]) * lh) / 2;
    const halfX = Math.max(0, f.w / 2 - Math.max(margin, extX + 0.005 * f.scale));
    const halfZ = Math.max(0, f.d / 2 - Math.max(margin, extZ + 0.005 * f.scale));
    // Центр письма — на y ∈ [0.1, h − 0.25]; низ наклонённого письма при этом не опускается ниже y = 0.
    const yLow = Math.max(0.1 * f.scale, extY + 0.01 * f.scale);
    const yHigh = Math.max(yLow, f.h - 0.25 * f.scale);

    let best: Vec3 | null = null;
    let bestScore = -1;
    let found = 0;
    // Лучший из первых шести подходящих кандидатов (письма расходятся равномерно); в тесноте — первый подходящий.
    for (let attempt = 0; attempt < 60 && found < 6; attempt++) {
      const x = rng.range(-halfX, halfX);
      const z = rng.range(-halfZ, halfZ);
      let top = yHigh;
      const nearWings = Math.abs(x) <= f.W / 2 + margin && Math.abs(z) <= owlHalfZ + margin + 0.01;
      const nearBody = Math.abs(x) <= 0.1 * f.W + margin && z <= 0 && z >= -0.16 * f.W - margin;
      if (nearWings || nearBody) {
        // Нить сквозь сову не проходит; рядом с ней письмо висит только ниже совы.
        if (Math.abs(x) <= f.W / 2 && Math.abs(z) <= owlHalfZ + 0.015) continue;
        if (Math.abs(x) <= 0.1 * f.W && z <= 0 && z >= -0.16 * f.W) continue;
        top = Math.min(top, f.bottomY - extY - 0.03);
        if (top < yLow) continue;
      }
      let nearest = Infinity;
      for (const other of letters) {
        nearest = Math.min(nearest, Math.hypot(other.center[0] - x, other.center[2] - z));
      }
      if (nearest < gap) continue;
      found++;
      if (nearest > bestScore) {
        bestScore = nearest;
        best = [x, lerp(yLow, top, heightAt), z];
      }
    }
    // Больше не помещается: площадь заполнена.
    if (!best) break;
    letters.push({ center: best, pitch, yaw, roll });
  }
  return letters;
}

function build(input: BuildInput): Part[] {
  const f = owlFrame(input);
  const { h, W } = f;
  const parts: Part[] = [];

  // ---------- Сова: печатная вырезка + сферы объёма позади листа ----------
  const cos = Math.cos(OWL_TILT);
  const sin = Math.sin(OWL_TILT);
  /** Точка листа совы (локальные yl, zl в долях W) в координатах объекта. */
  const onOwl = (x: number, yl: number, zl: number): Vec3 => [x * W, f.centerY + (yl * cos - zl * sin) * W, (yl * sin + zl * cos) * W];
  parts.push({
    shape: 'plane',
    position: [0, f.centerY, 0],
    size: [W, 0.5 * W, 0],
    rotation: [OWL_TILT, 0, 0],
    color: input.color,
    roughness: 0.9,
    doubleSided: true,
    cutout: true,
    paint: { painter: 'hp.owlFlying', px: OWL_PX },
  });
  parts.push({
    shape: 'sphere',
    position: onOwl(0, BODY_Y, -0.074),
    size: [0.16 * W, 0.2 * W, 0.14 * W],
    rotation: [OWL_TILT, 0, 0],
    color: input.color,
    roughness: 0.9,
  });
  parts.push({
    shape: 'sphere',
    position: onOwl(0, HEAD_Y, -0.058),
    size: [0.12 * W, 0.11 * W, 0.11 * W],
    rotation: [OWL_TILT, 0, 0],
    color: input.color,
    roughness: 0.9,
  });

  // ---------- Письма: две плоскости спина к спине ----------
  const letters = lettersOf(f, input);
  const size: Vec3 = [LETTER_W * f.scale, LETTER_H * f.scale, 0];
  const fronts: Part[] = [];
  const backs: Part[] = [];
  const threads: Part[] = [];
  for (const letter of letters) {
    const { up, normal } = axes(letter.pitch, letter.yaw, letter.roll);
    const [x, y, z] = letter.center;
    // Полмиллиметра от общей плоскости: у полупрозрачных «призраков» обе стороны видны одновременно.
    const off = 0.0005 * f.scale;
    fronts.push({
      shape: 'plane',
      position: [x + normal[0] * off, y + normal[1] * off, z + normal[2] * off],
      size,
      rotation: [letter.pitch, letter.yaw, letter.roll],
      color: input.color,
      roughness: 0.9,
      paint: { painter: 'hp.letterFront', px: LETTER_PX },
    });
    // Оборот — та же плоскость, развёрнутая на 180° вокруг своей вертикали: R · Ry(π) = Rx(p) · Ry(yaw + π) · Rz(−roll).
    backs.push({
      shape: 'plane',
      position: [x - normal[0] * off, y - normal[1] * off, z - normal[2] * off],
      size,
      rotation: [letter.pitch, letter.yaw > 0 ? letter.yaw - Math.PI : letter.yaw + Math.PI, -letter.roll],
      color: input.color,
      roughness: 0.9,
      paint: { painter: 'hp.letterBack', px: LETTER_PX },
    });
    // Нить — от середины верхнего края письма до потолка.
    const half = size[1] / 2;
    const line = thread(x + up[0] * half, y + up[1] * half, h, z + up[2] * half);
    if (line) threads.push(line);
  }
  parts.push(...fronts, ...backs, ...threads);

  // Две нити к сове — от крыльев.
  for (const side of [-1, 1]) {
    const [x, y, z] = onOwl(side * 0.27, 0.11, 0);
    const line = thread(x, y, h, z);
    if (line) parts.push(line);
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.owlPost',
  kind: 'preset',
  title: 'Сова с письмами',
  category: 'Гарри Поттер',
  size: [1.6, 1.5, 1.6],
  minSize: [0.8, 0.8, 0.8],
  resize: 'free',
  color: '#f4f1ea',
  mounts: ['ceiling'],
  defaultDrop: 0,
  hanger: false,
  params: [
    { key: 'letters', label: 'Письма', type: 'number', min: 5, max: 60, step: 1, default: 25 },
    { key: 'wingspan', label: 'Размах крыльев, м', type: 'number', min: 0.8, max: 1.6, step: 0.05, default: 1.2 },
    { key: 'owlDrop', label: 'Сова ниже потолка, м', type: 'number', min: 0.1, max: 0.6, step: 0.05, default: 0.25 },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

// ---------- Painters ----------

type Ctx = CanvasRenderingContext2D;

const OUTLINE = '#8b9298';
const MARK = '#2f3338';

/** Перо: вытянутый эллипс от основания (bx, by) под углом angle, с двумя тёмными поперечными полосками у конца. */
function feather(ctx: Ctx, bx: number, by: number, angle: number, length: number, width: number): void {
  if (!(length > 0) || !(width > 0)) return;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, width * 0.12);
  ctx.beginPath();
  ctx.ellipse(bx + (dx * length) / 2, by + (dy * length) / 2, length / 2, width / 2, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, width * 0.3);
  for (const at of [0.62, 0.82]) {
    const px = bx + dx * length * at;
    const py = by + dy * length * at;
    const reach = width * 0.32;
    ctx.beginPath();
    ctx.moveTo(px - dy * reach, py + dx * reach);
    ctx.lineTo(px + dy * reach, py - dx * reach);
    ctx.stroke();
  }
}

/** Правое крыло в координатах «от оси тела»: x — наружу, единица s — высота canvas. Левое — зеркалом. */
function wing(ctx: Ctx, s: number): void {
  // Маховые перья: у тела смотрят вниз, к концу крыла — наружу и чуть вверх.
  const count = 12;
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    feather(ctx, lerp(0.1, 0.56, t) * s, lerp(0.5, 0.2, t) * s, lerp(1.35, -0.25, t), lerp(0.3, 0.42, t) * s, 0.085 * s);
  }
  // Кроющие перья («рука» крыла) поверх оснований маховых.
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, s * 0.008);
  ctx.beginPath();
  ctx.moveTo(0.03 * s, 0.4 * s);
  ctx.quadraticCurveTo(0.3 * s, 0.16 * s, 0.6 * s, 0.13 * s);
  ctx.lineTo(0.66 * s, 0.24 * s);
  ctx.quadraticCurveTo(0.36 * s, 0.4 * s, 0.08 * s, 0.64 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Крапины по руке крыла.
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, s * 0.012);
  for (let index = 0; index < 9; index++) {
    const t = (index + 0.5) / 9;
    const x = lerp(0.14, 0.6, t) * s;
    const y = lerp(0.44, 0.2, t) * s;
    ctx.beginPath();
    ctx.moveTo(x - 0.012 * s, y + 0.03 * s);
    ctx.lineTo(x + 0.012 * s, y + 0.055 * s);
    ctx.stroke();
  }
}

const paintOwl: Painter = (ctx, w, h) => {
  // Единица — высота canvas; лист совы — 2 : 1, тело и голова — в горизонтальном центре.
  const s = h;
  const cx = w / 2;
  const stretch = w / (2 * s);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(side * stretch, 1);
    wing(ctx, s);
    ctx.restore();
  }

  // Хвост веером.
  for (let index = -2; index <= 2; index++) {
    feather(ctx, cx + index * 0.03 * s, 0.7 * s, Math.PI / 2 - index * 0.2, 0.25 * s, 0.07 * s);
  }

  // Тело и голова (центры — BODY_Y и HEAD_Y в долях ширины листа, см. build).
  const bodyY = (0.5 - BODY_Y * 2) * s;
  const headY = (0.5 - HEAD_Y * 2) * s;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, s * 0.008);
  ctx.beginPath();
  ctx.ellipse(cx, bodyY, 0.165 * s, 0.21 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Крапины на груди — короткие тёмные «галочки» рядами.
  const rng = createRng(7);
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, s * 0.01);
  for (let row = 0; row < 5; row++) {
    const y = bodyY + (-0.06 + row * 0.05) * s;
    const reach = 0.13 - Math.abs(row - 1.5) * 0.018;
    for (let col = -3; col <= 3; col++) {
      const x = cx + ((col + (row % 2) * 0.5) / 3.5) * reach * s + rng.range(-0.006, 0.006) * s;
      ctx.beginPath();
      ctx.moveTo(x - 0.012 * s, y);
      ctx.lineTo(x, y + 0.016 * s);
      ctx.lineTo(x + 0.012 * s, y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, s * 0.008);
  ctx.beginPath();
  ctx.ellipse(cx, headY, 0.125 * s, 0.115 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Глаза и клюв.
  for (const side of [-1, 1]) {
    const ex = cx + side * 0.05 * s;
    const ey = headY - 0.005 * s;
    ctx.fillStyle = '#f2c400';
    ctx.strokeStyle = MARK;
    ctx.lineWidth = Math.max(1, s * 0.008);
    ctx.beginPath();
    ctx.arc(ex, ey, 0.027 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(ex, ey, 0.012 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3b3b3b';
  ctx.beginPath();
  ctx.moveTo(cx - 0.016 * s, headY + 0.022 * s);
  ctx.lineTo(cx + 0.016 * s, headY + 0.022 * s);
  ctx.lineTo(cx, headY + 0.065 * s);
  ctx.closePath();
  ctx.fill();

  // Письмо в лапах: конверт с сургучной печатью.
  const lw = 0.2 * s;
  const lh = 0.075 * s;
  const ly = 0.835 * s;
  ctx.fillStyle = '#fbf3de';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, s * 0.006);
  ctx.fillRect(cx - lw / 2, ly, lw, lh);
  ctx.strokeRect(cx - lw / 2, ly, lw, lh);
  ctx.beginPath();
  ctx.moveTo(cx - lw / 2, ly);
  ctx.lineTo(cx, ly + lh * 0.6);
  ctx.lineTo(cx + lw / 2, ly);
  ctx.stroke();
  ctx.fillStyle = '#a3161a';
  ctx.beginPath();
  ctx.arc(cx, ly + lh * 0.6, 0.016 * s, 0, Math.PI * 2);
  ctx.fill();
};

const PAPER = '#fffdf6';
const italic = (px: number) => `italic ${px}px ${SERIF}`;

/** Бумага письма: светлая (тон даёт цвет части), чуть темнее к краям, с тонкой кромкой. */
function paintLetterPaper(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  const shadow = ctx.createLinearGradient(0, 0, 0, h);
  shadow.addColorStop(0, rgba('#6b5a3a', 0));
  shadow.addColorStop(1, rgba('#6b5a3a', 0.12));
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba('#6b5a3a', 0.35);
  ctx.lineWidth = Math.max(1, w * 0.008);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
}

const ADDRESS = ['Mr H. Potter', 'The Cupboard under the Stairs', '4 Privet Drive', 'Little Whinging', 'Surrey'];

const paintLetterFront: Painter = (ctx, w, h) => {
  paintLetterPaper(ctx, w, h);
  // Зелёные рукописные строки адреса.
  ctx.fillStyle = '#2f6b3a';
  drawLines(ctx, ADDRESS, w * 0.1, h * 0.16, w * 0.8, h * 0.68, italic, 1.2);
};

const paintLetterBack: Painter = (ctx, w, h) => {
  paintLetterPaper(ctx, w, h);
  // Клапан конверта и боковые сгибы.
  ctx.strokeStyle = rgba('#6b5a3a', 0.55);
  ctx.lineWidth = Math.max(1, w * 0.008);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w / 2, h * 0.56);
  ctx.lineTo(w, 0);
  ctx.moveTo(0, h);
  ctx.lineTo(w * 0.38, h * 0.46);
  ctx.moveTo(w, h);
  ctx.lineTo(w * 0.62, h * 0.46);
  ctx.stroke();
  // Красная сургучная печать.
  const r = h * 0.15;
  const sx = w / 2;
  const sy = h * 0.56;
  ctx.fillStyle = '#a3161a';
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7c0f12';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath();
  ctx.arc(sx, sy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7c0f12';
  paintStar(ctx, sx, sy, r * 0.42);
  ctx.fillStyle = rgba('#ffffff', 0.25);
  ctx.beginPath();
  ctx.arc(sx - r * 0.35, sy - r * 0.38, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
};

export const painters: Record<string, Painter> = {
  /** Летящая белая сова на прозрачном фоне (вырезка): крылья раскинуты, тело и голова — в центре листа. */
  'hp.owlFlying': guarded('hp.owlFlying', '#f4f1ea', paintOwl),
  /** Лицевая сторона письма: кремовая бумага, зелёные строки адреса. */
  'hp.letterFront': guarded('hp.letterFront', PAPER, paintLetterFront),
  /** Оборот письма: клапан и красная сургучная печать. */
  'hp.letterBack': guarded('hp.letterBack', PAPER, paintLetterBack),
};
