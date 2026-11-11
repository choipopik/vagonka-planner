/**
 * Гомография для выпрямления фотографий стен. Чистый модуль без импортов и без неудаляемого TS-синтаксиса:
 * его напрямую импортирует Node-скрипт scripts/bake-textures.mjs (Node снимает типы без сборки).
 */

export type Pt = [number, number];
/** Углы прямоугольника стены на фото: верх-лево, верх-право, низ-право, низ-лево (пиксели источника; могут лежать вне кадра). */
export type Quad = [Pt, Pt, Pt, Pt];
/** 3×3 по строкам. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Сдвиг и масштаб, приводящие четыре точки к центру в нуле и среднему расстоянию √2 (нормировка Хартли). */
interface Norm {
  cx: number;
  cy: number;
  scale: number;
}

function normOf(q: Quad): Norm {
  let cx = 0;
  let cy = 0;
  for (const p of q) {
    cx += p[0] / 4;
    cy += p[1] / 4;
  }
  let mean = 0;
  for (const p of q) mean += Math.hypot(p[0] - cx, p[1] - cy) / 4;
  return { cx, cy, scale: mean > 0 ? Math.SQRT2 / mean : 0 };
}

function assertQuad(q: Quad, n: Norm, what: string): void {
  for (const p of q) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`Гомография: ${what} содержит не число`);
  }
  if (!(n.scale > 0) || !Number.isFinite(n.scale)) throw new Error(`Гомография: ${what} вырожден (точки совпадают)`);
  // Любые три точки на одной прямой → отображение не определено. Площади — в нормированных координатах.
  for (let skip = 0; skip < 4; skip++) {
    const [a, b, c] = q.filter((_, i) => i !== skip);
    const area =
      ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * n.scale * n.scale;
    if (Math.abs(area) < 1e-9) throw new Error(`Гомография: ${what} вырожден (три точки на одной прямой)`);
  }
}

/** Решает A·x = b (n × n) методом Гаусса с выбором главного элемента по столбцу. Вырожденная система → Error. */
function gauss(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (!(Math.abs(a[pivot][col]) > 1e-12)) throw new Error('Гомография: вырожденная система (квад вырожден)');
    if (pivot !== col) {
      const rowTmp = a[col];
      a[col] = a[pivot];
      a[pivot] = rowTmp;
      const bTmp = b[col];
      b[col] = b[pivot];
      b[pivot] = bTmp;
    }
    for (let row = col + 1; row < n; row++) {
      const k = a[row][col] / a[col][col];
      if (k === 0) continue;
      for (let j = col; j < n; j++) a[row][j] -= k * a[col][j];
      b[row] -= k * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let j = row + 1; j < n; j++) sum -= a[row][j] * x[j];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** H: H·from[i] ~ to[i]. Система 8×8 (h33 = 1), Гаусс с выбором главного элемента. Вырожденный квад → Error. */
export function solveHomography(from: Quad, to: Quad): Mat3 {
  const nf = normOf(from);
  const nt = normOf(to);
  assertQuad(from, nf, 'исходный квад');
  assertQuad(to, nt, 'целевой квад');

  // Система решается в нормированных координатах: пиксельные квады (тысячи) дают плохо обусловленную матрицу.
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = (from[i][0] - nf.cx) * nf.scale;
    const y = (from[i][1] - nf.cy) * nf.scale;
    const u = (to[i][0] - nt.cx) * nt.scale;
    const v = (to[i][1] - nt.cy) * nt.scale;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = gauss(a, b);
  // Hn — в нормированных координатах (h33 = 1); H = Tt⁻¹ · Hn · Tf.
  const hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const sf = nf.scale;
  // M = Hn · Tf, где Tf = [[s, 0, −s·cx], [0, s, −s·cy], [0, 0, 1]].
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    const p = hn[r * 3];
    const q = hn[r * 3 + 1];
    const w = hn[r * 3 + 2];
    m.push(p * sf, q * sf, w - p * sf * nf.cx - q * sf * nf.cy);
  }
  // Tt⁻¹ = [[1/s, 0, cx], [0, 1/s, cy], [0, 0, 1]].
  const st = 1 / nt.scale;
  const out: number[] = [
    m[0] * st + nt.cx * m[6],
    m[1] * st + nt.cx * m[7],
    m[2] * st + nt.cx * m[8],
    m[3] * st + nt.cy * m[6],
    m[4] * st + nt.cy * m[7],
    m[5] * st + nt.cy * m[8],
    m[6],
    m[7],
    m[8],
  ];
  // Приводим к h33 = 1, когда это возможно (начало координат источника не уходит в бесконечность).
  const h33 = out[8];
  if (Math.abs(h33) > 1e-12) {
    for (let i = 0; i < 9; i++) out[i] /= h33;
    out[8] = 1;
  }
  for (const value of out) {
    if (!Number.isFinite(value)) throw new Error('Гомография: вырожденный квад');
  }
  return [out[0], out[1], out[2], out[3], out[4], out[5], out[6], out[7], out[8]];
}

export function applyHomography(h: Mat3, x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Пиксель результата (0…w, 0…h) → пиксель источника. */
export function rectToQuad(w: number, h: number, quad: Quad): Mat3 {
  return solveHomography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    quad,
  );
}

/** Длинная сторона = min(maxSide, ceil(oversample × самая длинная сторона квада)); вторая — из метрических пропорций. По умолчанию 2048 и 1.25. */
export function outputSize(quad: Quad, metres: [number, number], maxSide = 2048, oversample = 1.25): [number, number] {
  const [mw, mh] = metres;
  if (!(mw > 0) || !(mh > 0) || !Number.isFinite(mw) || !Number.isFinite(mh)) {
    throw new Error('outputSize: размеры в метрах должны быть положительными числами');
  }
  let longest = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    longest = Math.max(longest, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const limit = Math.max(1, Math.floor(maxSide));
  const long = Math.max(1, Math.min(limit, Math.ceil(oversample * longest)));
  if (mw >= mh) return [long, Math.max(1, Math.round((long * mh) / mw))];
  return [Math.max(1, Math.round((long * mw) / mh)), long];
}

export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4;
}

function toByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/** Обратное отображение в центрах пикселей, билинейная выборка, на выходе RGB. Вне источника → fill. gain умножает каналы (коррекция красной засветки). */
export function rectify(
  src: RawImage,
  quad: Quad,
  outW: number,
  outH: number,
  opts?: { fill?: [number, number, number]; gain?: [number, number, number] },
): RawImage {
  const w = Math.max(1, Math.floor(outW));
  const h = Math.max(1, Math.floor(outH));
  const fill = opts?.fill ?? [0, 0, 0];
  const gain = opts?.gain ?? [1, 1, 1];
  const m = rectToQuad(w, h, quad);
  const sw = src.width;
  const sh = src.height;
  const ch = src.channels;
  const data = src.data;
  const out = new Uint8Array(w * h * 3);
  const fillBytes = [toByte(fill[0]), toByte(fill[1]), toByte(fill[2])];
  // Допуск на границе кадра: центр пикселя результата, попавший ровно на край источника, считается внутри.
  const eps = 1e-9;

  for (let j = 0; j < h; j++) {
    const py = j + 0.5;
    for (let i = 0; i < w; i++) {
      const px = i + 0.5;
      const d = m[6] * px + m[7] * py + m[8];
      const sx = (m[0] * px + m[1] * py + m[2]) / d;
      const sy = (m[3] * px + m[4] * py + m[5]) / d;
      const o = (j * w + i) * 3;
      if (!(sx >= -eps && sx <= sw + eps && sy >= -eps && sy <= sh + eps)) {
        out[o] = fillBytes[0];
        out[o + 1] = fillBytes[1];
        out[o + 2] = fillBytes[2];
        continue;
      }
      // Центры пикселей источника — в (k + 0.5): переходим к индексам и зажимаем у краёв.
      const fx = Math.min(sw - 1, Math.max(0, sx - 0.5));
      const fy = Math.min(sh - 1, Math.max(0, sy - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const i00 = (y0 * sw + x0) * ch;
      const i10 = (y0 * sw + x1) * ch;
      const i01 = (y1 * sw + x0) * ch;
      const i11 = (y1 * sw + x1) * ch;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * tx;
        const bottom = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * tx;
        out[o + c] = toByte((top + (bottom - top) * ty) * gain[c]);
      }
    }
  }
  return { data: out, width: w, height: h, channels: 3 };
}
