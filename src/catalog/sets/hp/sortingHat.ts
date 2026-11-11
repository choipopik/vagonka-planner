// Общий модуль пакета W7 (фигуры и настольный декор «Гарри Поттер»):
//   1) sortingHat — билдер Распределяющей шляпы (шляпа-фонарь 4.6 и шляпа среди мандрагор 4.8);
//   2) маленькие чистые помощники билдеров W7: чтение параметров, поворот «ось Y вдоль направления», стержень между
//      двумя точками, обёртка painter'а.
// Ни three.js, ни DOM при импорте: painters вызываются только в браузере.
import { clamp, lerp, mix, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { Params, Vec3 } from '../../../model/types';
import type { Painter, Part } from '../../types';

export const DEG = Math.PI / 180;

const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- Чтение параметров (значения приходят из сохранённого макета — проверяем всё) ----------

export function paramNumber(params: Params, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Только '#rrggbb'; всё остальное → fallback. */
export function paramColor(params: Params, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

export function paramFlag(params: Params, key: string, fallback: boolean): boolean {
  const value = params[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** '#rrggbb' + прозрачность → 'rgba(r, g, b, a)'; не '#rrggbb' → чёрный той же прозрачности. */
export function rgba(hex: string, alpha: number): string {
  const n = HEX.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  const a = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
}

// ---------- Повороты (Эйлер XYZ, как у Part.rotation: world = Rx · Ry · Rz · local) ----------

function normalize(v: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-9 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : fallback;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Без «минус нуля» и шума в 16-м знаке: одинаковый вход даёт одинаковый ключ матрицы в рендере. */
function tidy(angle: number): number {
  const rounded = Math.round(angle * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
}

/** Углы Эйлера XYZ по ортонормированному правому базису: x, y, z — образы локальных осей части. */
export function eulerOfBasis(x: Vec3, y: Vec3, z: Vec3): Vec3 {
  // Матрица по столбцам [x y z]; разбор — как THREE.Euler.setFromRotationMatrix для порядка 'XYZ'.
  const m13 = clamp(z[0], -1, 1);
  const ry = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) {
    return [tidy(Math.atan2(-z[1], z[2])), tidy(ry), tidy(Math.atan2(-y[0], x[0]))];
  }
  return [tidy(Math.atan2(y[2], y[1])), tidy(ry), 0];
}

/** Поворот, переводящий локальную ось +Y в направление dir (для цилиндров и конусов; крен вокруг оси не важен). */
export function aimY(dir: Vec3): Vec3 {
  const y = normalize(dir, [0, 1, 0]);
  // Опорная ось — та, что дальше от направления: базис не вырождается.
  // (При оси вдоль Z берётся Y, а не X: с X локальная ось Z легла бы вдоль мирового X — вырожденный случай Эйлера XYZ.)
  const reference: Vec3 = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const x = normalize(cross(y, reference), [1, 0, 0]);
  const z = cross(x, y);
  return eulerOfBasis(x, y, z);
}

/** Куда смотрит локальная ось +Y части после поворота rotation. */
export function axisY(rotation: Vec3): Vec3 {
  const a = Math.cos(rotation[0]);
  const b = Math.sin(rotation[0]);
  const c = Math.cos(rotation[1]);
  const d = Math.sin(rotation[1]);
  const e = Math.cos(rotation[2]);
  const f = Math.sin(rotation[2]);
  return [-c * f, a * e - b * d * f, b * e + a * d * f];
}

/**
 * Цилиндр круглого сечения от точки from до точки to (taper относится к концу to). Длина меньше 1e-6 → from = to
 * считается вертикальным стержнем минимальной длины, чтобы размер оставался положительным.
 */
export function rod(from: Vec3, to: Vec3, diameter: number, rest: Omit<Part, 'shape' | 'position' | 'size' | 'rotation'>): Part {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.max(Math.hypot(delta[0], delta[1], delta[2]), 1e-6);
  return {
    shape: 'cylinder',
    position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    size: [diameter, length, diameter],
    rotation: aimY(delta),
    ...rest,
  };
}

// ---------- Painters ----------

const warned = new Set<string>();

/**
 * Оборачивает painter: состояние контекста сохраняется и восстанавливается, а исключение (незнакомый браузер, битые
 * аргументы) не роняет сцену — canvas заливается запасным цветом, в консоль уходит одно предупреждение на painter.
 */
export function guardPainter(name: string, fallback: string, paint: Painter): Painter {
  return (ctx, width, height, args) => {
    ctx.save();
    try {
      paint(ctx, width, height, args ?? {});
    } catch (error) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`painter ${name}: ${String(error)}`);
      }
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fallback;
        ctx.fillRect(0, 0, width, height);
      } catch {
        // Контекст непригоден совсем — оставляем canvas как есть.
      }
    } finally {
      ctx.restore();
    }
  };
}

// ---------- Распределяющая шляпа ----------

export interface SortingHatOptions {
  /** Кожа шляпы. */
  color: string;
  /** 'glow' — светящиеся глаза и рот (фонарь), 'dark' — тёмные прорези, 'none' — без лица. */
  face: 'glow' | 'dark' | 'none';
  glowColor?: string;
  /** Яркость свечения лица 0…2. По умолчанию 1. */
  glow?: number;
  /** Центр низа шляпы в локальных координатах объекта. По умолчанию [0, 0, 0]. */
  origin?: Vec3;
  /** Если задан — макушка заваливается и лицо хмурится немного по-разному (кнопка «Перемешать»). */
  seed?: number;
}

/** Цвет светящегося лица: glow = 0 — тлеет, 1 — цвет как есть, 2 — выбелен. */
export function faceGlowColor(glowColor: string, glow: number): string {
  const level = clamp(Number.isFinite(glow) ? glow : 1, 0, 2);
  return level <= 1 ? shade(glowColor, lerp(0.2, 1, level)) : mix(glowColor, '#ffffff', 0.4 * (level - 1));
}

/** Радиус тульи (в долях w) и сдвиг её оси по Z на высоте y (в долях h) — для нижних двух колец тульи. */
function crownAt(yh: number): { radius: number; shift: number } {
  if (yh <= 0.3) return { radius: lerp(0.31, 0.279, clamp((yh - 0.03) / 0.27, 0, 1)), shift: 0 };
  return { radius: lerp(0.28, 0.196, clamp((yh - 0.3) / 0.25, 0, 1)), shift: -0.02 };
}

/**
 * Остроконечная шляпа с «заваленной» макушкой шириной w (диаметр полей) и высотой h, низом в origin.
 * Все части лежат внутри цилиндра полей (|x|, |z| ≤ w/2 от origin) и не выше h — в том числе по partBounds.
 */
export function sortingHat(w: number, h: number, opts: SortingHatOptions): Part[] {
  const [ox, oy, oz] = opts.origin ?? [0, 0, 0];
  const at = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];
  const rng = opts.seed === undefined ? null : createRng(opts.seed);
  const vary = (a: number, b: number, neutral: number) => (rng ? rng.range(a, b) : neutral);
  // Порядок вызовов фиксирован: один seed — одна шляпа.
  const side = vary(-1, 1, 0);
  const lean3Factor = vary(0.7, 1.3, 1);
  const lean4Factor = vary(0.75, 1.2, 1);
  // У очень широкой и низкой шляпы прищур и изгиб рта уменьшаются, чтобы наклонённые прорези не ушли ниже полей.
  const eyeRoll = Math.min(25 * DEG * vary(0.8, 1.2, 1), Math.asin(Math.min(1, (0.5 * h) / (0.12 * w))));
  const frown = Math.min(8 * DEG * vary(0.4, 1.6, 1), Math.asin(Math.min(1, (0.1 * h) / ((0.34 / 3) * w))));

  // Завал макушки не должен вывести её ни за цилиндр полей (высокая узкая шляпа), ни выше h (низкая широкая).
  const maxLean = Math.min(Math.atan2(w, h), Math.asin(Math.min(1, (0.8 * h) / w)));
  const lean3 = Math.min(10 * DEG * lean3Factor, maxLean);
  const lean4 = Math.min(25 * DEG * lean4Factor, maxLean);

  const leather = { color: opts.color, roughness: 0.85 };
  const parts: Part[] = [];

  // Поля.
  parts.push({ shape: 'cylinder', position: at(0, 0.015 * h, 0), size: [w, 0.03 * h, w], ...leather });
  // Тулья: два прямых кольца…
  parts.push({ shape: 'cylinder', position: at(0, 0.165 * h, 0), size: [0.62 * w, 0.27 * h, 0.62 * w], taper: 0.9, ...leather });
  parts.push({ shape: 'cylinder', position: at(0, 0.425 * h, -0.02 * w), size: [0.56 * w, 0.25 * h, 0.56 * w], taper: 0.7, ...leather });
  // …третье наклонено назад (и чуть вбок) и утоплено в нижнее, чтобы спереди на стыке не было щели…
  const height3 = 0.31 * h;
  const rotation3: Vec3 = [tidy(-lean3), 0, tidy(-side * 0.4 * lean3)];
  const center3: Vec3 = [side * 0.02 * w, 0.645 * h, -0.06 * w];
  parts.push({
    shape: 'cylinder',
    position: at(center3[0], center3[1], center3[2]),
    size: [0.4 * w, height3, 0.4 * w],
    rotation: rotation3,
    taper: 0.55,
    ...leather,
  });
  // …и конус макушки, посаженный на верх третьего кольца.
  const axis3 = axisY(rotation3);
  const top3: Vec3 = [
    center3[0] + (axis3[0] * height3) / 2,
    center3[1] + (axis3[1] * height3) / 2,
    center3[2] + (axis3[2] * height3) / 2,
  ];
  const height4 = 0.21 * h;
  const rotation4: Vec3 = [tidy(-lean4), 0, tidy(-side * 0.4 * lean4)];
  const axis4 = axisY(rotation4);
  const sink = height4 / 2 - 0.04 * h;
  const center4: Vec3 = [top3[0] + axis4[0] * sink, top3[1] + axis4[1] * sink, top3[2] + axis4[2] * sink];
  // Габарит наклонённого конуса по высоте (как его считает partBounds) не выше h.
  const reach4 = (Math.abs(axis4[1]) * height4 + Math.hypot(axis4[0], axis4[2]) * 0.22 * w) / 2;
  center4[1] = Math.min(center4[1], h - reach4);
  parts.push({
    shape: 'cylinder',
    position: at(center4[0], center4[1], center4[2]),
    size: [0.22 * w, height4, 0.22 * w],
    rotation: rotation4,
    taper: 0,
    ...leather,
  });

  // Складки на стыках: кольца одной пропорции (трубка = 6 % диаметра → одна геометрия), лежат горизонтально.
  const folds: [number, number, number][] = [
    [0.3 * h, -0.01 * w, 0.6 * w],
    [0.55 * h, -0.03 * w, 0.44 * w],
  ];
  for (const [y, z, diameter] of folds) {
    parts.push({
      shape: 'torus',
      position: at(0, y, z),
      size: [diameter, diameter, 0.06 * diameter],
      rotation: [Math.PI / 2, 0, 0],
      color: shade(opts.color, 0.85),
      roughness: 0.85,
    });
  }

  if (opts.face !== 'none') {
    const look: Partial<Part> =
      opts.face === 'glow'
        ? { color: faceGlowColor(opts.glowColor ?? '#ffab3d', opts.glow ?? 1), look: 'glow' }
        : { color: shade(opts.color, 0.3), roughness: 0.85 };
    const feature = (x: number, y: number, z: number, size: Vec3, rotation: Vec3): Part => ({
      shape: 'box',
      position: at(x, y, z),
      size,
      rotation: [tidy(rotation[0]), tidy(rotation[1]), tidy(rotation[2])],
      color: opts.color,
      ...look,
    });
    const depth = 0.02 * w;

    // Глаза: прорези лежат по касательной к тулье, наружные концы задраны (злой прищур).
    const eyeY = 0.42;
    const eye = crownAt(eyeY);
    const eyeYaw = Math.asin(clamp(0.11 / eye.radius, -1, 1));
    const eyeRadius = (eye.radius + 0.004) * w;
    for (const sign of [-1, 1]) {
      parts.push(
        feature(
          sign * eyeRadius * Math.sin(eyeYaw),
          eyeY * h,
          eye.shift * w + eyeRadius * Math.cos(eyeYaw),
          [0.12 * w, 0.05 * h, depth],
          [0, sign * eyeYaw, sign * eyeRoll],
        ),
      );
    }

    // Рот: три отрезка по дуге тульи общей шириной 0.34w, уголки опущены.
    const mouthY = 0.2;
    const mouth = crownAt(mouthY);
    const segment = (0.34 / 3) * w;
    const halfAngle = Math.asin(clamp(segment / 2 / (mouth.radius * w), -1, 1));
    const mouthRadius = mouth.radius * w * Math.cos(halfAngle) + 0.006 * w;
    for (const index of [-1, 0, 1]) {
      const yaw = index * 2 * halfAngle;
      parts.push(
        feature(
          mouthRadius * Math.sin(yaw),
          mouthY * h - Math.abs(index) * (segment / 2) * Math.sin(frown),
          mouth.shift * w + mouthRadius * Math.cos(yaw),
          [segment, 0.045 * h, depth],
          [0, yaw, -index * frown],
        ),
      );
    }
  }
  return parts;
}
