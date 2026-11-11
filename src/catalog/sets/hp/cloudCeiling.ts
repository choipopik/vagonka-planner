import { clamp, lerp, mix, shade } from '../../../model/color';
import { createRng, valueNoise2 } from '../../../model/rng';
import type { Vec3 } from '../../../model/types';
import type { BuildInput, CatalogItem, LocalBox, Painter, Part } from '../../types';
import { argColor, argNumber, guarded, paramNumber, scatter, thread } from './paper';

// 4.1 «Облачный потолок со свечами»: вата-облака (сферы с matcap), парящие свечи на нитях и шляпы ведьм.
// Площадной предмет: элементы держат реальный размер, площадь заполняется их числом (с жёсткими пределами).

const MAX_CLOUDS = 400;
const MAX_CANDLES = 120;

/** Шляпа ведьмы: поля Ø 0.42 × 0.012, тулья-конус Ø 0.22 × 0.40. */
const HAT_BRIM = 0.42;
const HAT_BRIM_T = 0.012;
const HAT_CROWN = 0.4;
const HAT_CROWN_D = 0.22;
const HAT_H = HAT_BRIM_T + HAT_CROWN;
const HAT_COLOR = '#15131a';
/** Центр шляпы — не ближе этого расстояния к краю прямоугольника. */
const HAT_EDGE = 0.25;
const HAT_MAX_TILT = (12 * Math.PI) / 180;

const DEFAULT_GLOW = '#3fe0a8';

interface Frame {
  w: number;
  h: number;
  d: number;
  /** Зажатая толщина облаков. */
  T: number;
  /** Высота свободного места под облаками: h − T. */
  under: number;
  seeds: { clouds: number; candles: number; hats: number };
}

interface Hat {
  /** Центр низа полей. */
  x: number;
  y: number;
  z: number;
  rx: number;
  rz: number;
}

function frameOf({ size, params }: BuildInput): Frame {
  const w = Math.max(size[0], 0.01);
  const h = Math.max(size[1], 0.01);
  const d = Math.max(size[2], 0.01);
  // T = min(thickness, h − 0.3): под облаками всегда ≥ 0.3 м. Для вырожденной высоты (< 0.6 м, вне minSize) —
  // не больше половины высоты, чтобы толщина оставалась положительной.
  const T = Math.min(paramNumber(params, 'thickness', 0.35), Math.max(h - 0.3, 0.5 * h));
  // Три независимых потока из одного seed: смена числа шляп или свечей не перемешивает облака.
  const root = createRng(paramNumber(params, 'seed', 1));
  const seeds = { clouds: root.int(0, 0x7fffffff), candles: root.int(0, 0x7fffffff), hats: root.int(0, 0x7fffffff) };
  return { w, h, d, T, under: h - T, seeds };
}

function hatsOf(f: Frame, input: BuildInput): Hat[] {
  const count = Math.round(clamp(paramNumber(input.params, 'hats', 2), 0, 8));
  // Шляпа 0.42 м не помещается в прямоугольник у́же полуметра и в высоту меньше полуметра (такое бывает только вне minSize).
  if (count <= 0 || Math.min(f.w, f.d) < 2 * HAT_EDGE || f.h < HAT_H + 0.09) return [];
  const rng = createRng(f.seeds.hats);
  const points = scatter(rng, count, f.w / 2 - HAT_EDGE, f.d / 2 - HAT_EDGE);
  return points.map(([x, z]) => {
    const tilt = rng.range(0, HAT_MAX_TILT);
    const direction = rng.range(0, Math.PI * 2);
    // Низ шляпы — на (0.3…0.6)·(h − T) ниже облаков, но поля (с учётом наклона) не ниже y = 0.02, а макушка — не выше потолка.
    const wanted = f.under * (1 - rng.range(0.3, 0.6));
    const lowest = 0.02 + (HAT_BRIM / 2) * Math.sin(tilt);
    const highest = Math.max(lowest, f.h - HAT_H - 0.02);
    return { x, y: clamp(wanted, lowest, highest), z, rx: tilt * Math.cos(direction), rz: tilt * Math.sin(direction) };
  });
}

/** Локальная ось Y шляпы после наклона (Эйлер XYZ с нулевым рысканием). */
function hatUp(hat: Hat): Vec3 {
  return [-Math.sin(hat.rz), Math.cos(hat.rx) * Math.cos(hat.rz), Math.sin(hat.rx) * Math.cos(hat.rz)];
}

function build(input: BuildInput): Part[] {
  const f = frameOf(input);
  const { w, h, d, T, under } = f;
  const { params } = input;
  const glowColor = argColor(params, 'glowColor', DEFAULT_GLOW);
  const glow = clamp(paramNumber(params, 'glow', 1), 0, 2);
  const noiseSeed = paramNumber(params, 'seed', 1);
  const parts: Part[] = [];

  // ---------- Облака: сферы на сетке с дрожанием ±0.45 ячейки ----------
  const cloudCount = Math.min(MAX_CLOUDS, Math.max(1, Math.round(paramNumber(params, 'density', 12) * w * d)));
  const cols = Math.max(1, Math.ceil(Math.sqrt((cloudCount * w) / d)));
  const rows = Math.max(1, Math.ceil(cloudCount / cols));
  const cloudRng = createRng(f.seeds.clouds);
  // Ячеек может быть больше, чем облаков: пустые места выбираются случайно, а не остаются полосой у края.
  const cells = cloudRng.shuffle(Array.from({ length: cols * rows }, (_, index) => index)).slice(0, cloudCount);
  const thicknessScale = Math.sqrt(T / 0.35);
  const maxRadius = Math.min(0.4 * Math.min(w, d), (h - 0.02) / 1.4);
  for (const cell of cells) {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const u = cloudRng.next();
    const u2 = cloudRng.next();
    let x = -w / 2 + ((col + 0.5 + cloudRng.range(-0.45, 0.45)) * w) / cols;
    let z = -d / 2 + ((row + 0.5 + cloudRng.range(-0.45, 0.45)) * d) / rows;
    let r = Math.min(lerp(0.2, 0.38, u * u) * thicknessScale, maxRadius);
    // Рваная кромка: в 0.3 м от края облака мельче.
    if (w / 2 - Math.abs(x) < 0.3 || d / 2 - Math.abs(z) < 0.3) r *= 0.75;
    r = Math.max(r, 0.004);
    // Сфера целиком внутри прямоугольника и между полом габарита и потолком.
    const limitX = Math.max(0, w / 2 - 1.25 * r);
    const limitZ = Math.max(0, d / 2 - 1.25 * r);
    x = clamp(x, -limitX, limitX);
    z = clamp(z, -limitZ, limitZ);
    const y = Math.max(h - 0.7 * r - 0.02 - 0.3 * T * u2, 0.7 * r);
    parts.push({
      shape: 'sphere',
      position: [x, y, z],
      size: [2.5 * r, 1.4 * r, 2.5 * r],
      // Неровные «лужи света», как на референсе: от тёмно-зелёной тени до цвета объекта.
      color: mix('#12443a', input.color, 0.55 + 0.45 * valueNoise2(0.9 * x, 0.9 * z, noiseSeed)),
      look: 'matcap',
      paint: { painter: 'hp.cloudMatcap', args: { color: glowColor, glow }, px: [128, 128] },
    });
  }

  const hats = hatsOf(f, input);

  // ---------- Свечи: тело, пламя, ореол, нить ----------
  const candleCount = Math.min(MAX_CANDLES, Math.max(0, Math.round(paramNumber(params, 'candles', 2.5) * w * d)));
  if (candleCount > 0 && under >= 0.14) {
    const candleRng = createRng(f.seeds.candles);
    // Свеча не висит внутри шляпы.
    const clearOfHats = (x: number, z: number) => hats.every((hat) => Math.hypot(hat.x - x, hat.z - z) > HAT_BRIM / 2 + 0.05);
    const points = scatter(candleRng, candleCount, w / 2 - 0.06, d / 2 - 0.06, 12, clearOfHats);
    const bodies: Part[] = [];
    const flames: Part[] = [];
    const halos: Part[] = [];
    const threads: Part[] = [];
    for (const [x, z] of points) {
      // Длина 0.18 ± 0.04, но не длиннее свободного места; каждая свеча — на своей высоте, низ не ниже y = 0.02.
      const length = Math.max(0.05, Math.min(0.18 + candleRng.range(-0.04, 0.04), under - 0.07));
      const top = under - candleRng.range(0.05, Math.max(0.05, under - length - 0.02));
      bodies.push({
        shape: 'cylinder',
        position: [x, top - length / 2, z],
        size: [0.022, length, 0.022],
        color: '#f3ead2',
        emissive: '#ffcf8a',
        emissiveIntensity: 0.25,
      });
      flames.push({
        shape: 'cylinder',
        position: [x, top + 0.0175, z],
        size: [0.016, 0.035, 0.016],
        color: '#ffc15a',
        taper: 0,
        look: 'glow',
      });
      halos.push({
        shape: 'sphere',
        position: [x, top + 0.0175, z],
        size: [0.07, 0.07, 0.07],
        color: '#ff9a2e',
        look: 'glow',
        additive: true,
        opacity: 0.35,
      });
      const line = thread(x, top + 0.035, h - T / 2, z);
      if (line) threads.push(line);
    }
    parts.push(...bodies, ...flames, ...halos, ...threads);
  }

  // ---------- Шляпы ведьм: поля, тулья, нить до облаков ----------
  for (const hat of hats) {
    const up = hatUp(hat);
    const at = (along: number): Vec3 => [hat.x + up[0] * along, hat.y + up[1] * along, hat.z + up[2] * along];
    const rotation: Vec3 = [hat.rx, 0, hat.rz];
    parts.push({
      shape: 'cylinder',
      position: at(HAT_BRIM_T / 2),
      size: [HAT_BRIM, HAT_BRIM_T, HAT_BRIM],
      rotation,
      color: HAT_COLOR,
      roughness: 0.9,
    });
    parts.push({
      shape: 'cylinder',
      position: at(HAT_BRIM_T + HAT_CROWN / 2),
      size: [HAT_CROWN_D, HAT_CROWN, HAT_CROWN_D],
      rotation,
      color: HAT_COLOR,
      taper: 0,
      roughness: 0.9,
    });
    const apex = at(HAT_H);
    // Нить — до середины слоя облаков; у низкого потолка макушка сама уходит в облака — тогда нить короткая, но есть.
    const line = thread(apex[0], apex[1], Math.min(h, Math.max(h - T / 2, apex[1] + 0.01)), apex[2]);
    if (line) parts.push(line);
  }

  return parts;
}

/** Плита облаков + по боксу 0.42³ на шляпу: свечи и нити мышью не выбираются, сквозь них кликается зал. */
function pickBoxes(input: BuildInput): LocalBox[] {
  const f = frameOf(input);
  const boxes: LocalBox[] = [{ center: [0, f.h - f.T / 2, 0], size: [f.w, f.T, f.d] }];
  for (const hat of hatsOf(f, input)) {
    boxes.push({ center: [hat.x, hat.y + HAT_BRIM / 2, hat.z], size: [HAT_BRIM, HAT_BRIM, HAT_BRIM] });
  }
  return boxes;
}

export const item: CatalogItem = {
  id: 'hp.cloudCeiling',
  kind: 'preset',
  title: 'Облачный потолок со свечами',
  category: 'Гарри Поттер',
  size: [4.0, 1.1, 3.0],
  minSize: [1, 0.6, 1],
  maxSize: [12, 2, 8],
  resize: 'free',
  color: '#e9f3ef',
  mounts: ['ceiling'],
  defaultDrop: 0,
  hanger: false,
  params: [
    { key: 'thickness', label: 'Толщина облаков, м', type: 'number', min: 0.2, max: 0.6, step: 0.05, default: 0.35 },
    { key: 'density', label: 'Плотность, шт/м²', type: 'number', min: 6, max: 20, step: 1, default: 12 },
    { key: 'glowColor', label: 'Цвет свечения', type: 'color', default: DEFAULT_GLOW },
    { key: 'glow', label: 'Свечение', type: 'number', min: 0, max: 2, step: 0.1, default: 1 },
    { key: 'candles', label: 'Свечи, шт/м²', type: 'number', min: 0, max: 6, step: 0.5, default: 2.5 },
    { key: 'hats', label: 'Шляпы', type: 'number', min: 0, max: 8, step: 1, default: 2 },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
  pickBoxes,
};

export const painters: Record<string, Painter> = {
  /**
   * Matcap облака: светлая середина (поверхность, обращённая к зрителю), цвет свечения на 0.55 радиуса, тёмный край —
   * стыки соседних сфер получаются тёмными «складками». При glow = 0 — нейтральная серо-белая вата.
   */
  'hp.cloudMatcap': guarded('hp.cloudMatcap', '#9aa3a0', (ctx, width, height, args) => {
    const color = argColor(args, 'color', DEFAULT_GLOW);
    const glow = clamp(argNumber(args, 'glow', 1), 0, 2);
    const tint = Math.min(1, glow);
    const middle = mix('#c4cac8', color, tint);
    const centre = mix('#ffffff', color, 0.25 * glow);
    const rim = shade(middle, lerp(0.4, 0.15, tint));
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) / 2);
    gradient.addColorStop(0, centre);
    gradient.addColorStop(0.55, middle);
    gradient.addColorStop(1, rim);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }),
};
