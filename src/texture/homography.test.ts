import { describe, expect, it } from 'vitest';
import { applyHomography, outputSize, rectify, rectToQuad, solveHomography } from './homography';
import type { Mat3, Pt, Quad, RawImage } from './homography';
// Исходный текст модуля (Vite ?raw): проверяем, что Node-скрипт запекания сможет импортировать его без сборки.
import source from './homography.ts?raw';

const UNIT: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function rectQuad(x0: number, y0: number, x1: number, y1: number): Quad {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function expectPt(actual: Pt, expected: Pt, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

/** Картинка w × h, цвет пикселя задаёт функция (x, y) → [r, g, b]. */
function image(w: number, h: number, at: (x: number, y: number) => [number, number, number], channels: 3 | 4 = 3): RawImage {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const o = (y * w + x) * channels;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      if (channels === 4) data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h, channels };
}

function pixel(img: RawImage, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * img.channels;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

describe('solveHomography', () => {
  it('тождественный квад даёт тождественное отображение', () => {
    const quad: Quad = [
      [120, 40],
      [900, 55],
      [880, 610],
      [130, 590],
    ];
    const h = solveHomography(quad, quad);
    expectPt(applyHomography(h, 500, 300), [500, 300], 8);
    expectPt(applyHomography(h, -40, 1000), [-40, 1000], 6);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) expect(h[i]).toBeCloseTo(identity[i], 9);
  });

  it('четыре угла отображаются точно', () => {
    const from: Quad = [
      [152, 30],
      [1050, 112],
      [1047, 432],
      [152, 452],
    ];
    const to: Quad = rectQuad(0, 0, 1128, 221);
    const h = solveHomography(from, to);
    for (let i = 0; i < 4; i++) expectPt(applyHomography(h, from[i][0], from[i][1]), to[i], 8);
    // И обратно: решение для переставленных аргументов — обратное отображение.
    const back = solveHomography(to, from);
    for (let i = 0; i < 4; i++) expectPt(applyHomography(back, to[i][0], to[i][1]), from[i], 8);
  });

  it('известная проективная деформация восстанавливается с точностью 1e-6', () => {
    const known: Mat3 = [1.2, 0.15, 30, -0.1, 0.9, 12, 0.0004, -0.0002, 1];
    const from: Quad = [
      [10, 20],
      [640, 35],
      [610, 470],
      [25, 440],
    ];
    const to = from.map(([x, y]) => applyHomography(known, x, y)) as Quad;
    const h = solveHomography(from, to);
    for (let i = 0; i < 9; i++) expect(Math.abs(h[i] - known[i])).toBeLessThan(1e-6);
    // Точки, не участвовавшие в решении, отображаются так же, как исходной матрицей.
    for (const [x, y] of [
      [0, 0],
      [333, 222],
      [700, -50],
    ]) {
      expectPt(applyHomography(h, x, y), applyHomography(known, x, y), 6);
    }
  });

  it('h33 нормирован к единице', () => {
    const h = solveHomography(UNIT, [
      [3, 1],
      [9, 2],
      [8, 7],
      [2, 6],
    ]);
    expect(h[8]).toBe(1);
  });

  it('вырожденный квад бросает', () => {
    const line: Quad = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    const threeOnLine: Quad = [
      [0, 0],
      [5, 0],
      [10, 0],
      [0, 10],
    ];
    const samePoint: Quad = [
      [7, 7],
      [7, 7],
      [7, 7],
      [7, 7],
    ];
    const twoEqual: Quad = [
      [0, 0],
      [0, 0],
      [10, 10],
      [0, 10],
    ];
    const nan: Quad = [
      [0, 0],
      [Number.NaN, 0],
      [10, 10],
      [0, 10],
    ];
    for (const bad of [line, threeOnLine, samePoint, twoEqual, nan]) {
      expect(() => solveHomography(bad, UNIT)).toThrow();
      expect(() => solveHomography(UNIT, bad)).toThrow();
    }
  });
});

describe('rectToQuad', () => {
  it('углы результата попадают в углы квада в порядке TL, TR, BR, BL', () => {
    const quad: Quad = [
      [488, 265],
      [921, 297],
      [920, 522],
      [488, 538],
    ];
    const m = rectToQuad(543, 284, quad);
    expectPt(applyHomography(m, 0, 0), quad[0], 8);
    expectPt(applyHomography(m, 543, 0), quad[1], 8);
    expectPt(applyHomography(m, 543, 284), quad[2], 8);
    expectPt(applyHomography(m, 0, 284), quad[3], 8);
  });

  it('точки квада могут лежать вне кадра', () => {
    const quad: Quad = [
      [-200, -50],
      [1500, 10],
      [1400, 1100],
      [-100, 900],
    ];
    const m = rectToQuad(100, 60, quad);
    expectPt(applyHomography(m, 0, 0), quad[0], 7);
    expectPt(applyHomography(m, 100, 60), quad[2], 7);
  });
});

describe('outputSize', () => {
  const quad: Quad = [
    [100, 100],
    [500, 110],
    [500, 300],
    [100, 310],
  ];

  it('длинная сторона — oversample × самая длинная сторона квада, вторая — из метрических пропорций', () => {
    const longest = Math.hypot(400, 10);
    const [w, h] = outputSize(quad, [4, 2]);
    expect(w).toBe(Math.ceil(1.25 * longest));
    expect(h).toBe(Math.round(w / 2));
    // Пропорции берутся из метров, а не из квада.
    const [w2, h2] = outputSize(quad, [1, 3]);
    expect(h2).toBe(Math.ceil(1.25 * longest));
    expect(w2).toBe(Math.round(h2 / 3));
    const [w3, h3] = outputSize(quad, [2, 2]);
    expect(w3).toBe(h3);
  });

  it('длинная сторона ограничена maxSide', () => {
    const big: Quad = rectQuad(0, 0, 4000, 1000);
    expect(outputSize(big, [8, 2])).toEqual([2048, 512]);
    expect(outputSize(big, [8, 2], 1024)).toEqual([1024, 256]);
    expect(outputSize(big, [2, 8], 1024)).toEqual([256, 1024]);
    // Свой oversample.
    expect(outputSize(rectQuad(0, 0, 100, 50), [2, 1], 2048, 2)).toEqual([200, 100]);
    expect(outputSize(rectQuad(0, 0, 100, 50), [2, 1], 2048, 1)).toEqual([100, 50]);
  });

  it('результат не меньше 1 × 1, а неположительные метры — ошибка', () => {
    const [w, h] = outputSize(rectQuad(0, 0, 10, 10), [100, 0.001]);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBe(1);
    expect(() => outputSize(quad, [0, 1])).toThrow();
    expect(() => outputSize(quad, [1, -2])).toThrow();
    expect(() => outputSize(quad, [Number.NaN, 1])).toThrow();
  });
});

describe('rectify', () => {
  /** Шахматная доска: клетка cell × cell, уровни 30 и 220. */
  const board = (cell: number) => (x: number, y: number): [number, number, number] => {
    const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 220 : 30;
    return [v, v, v];
  };

  it('осевой квад — обычная обрезка', () => {
    const src = image(40, 30, (x, y) => [x * 6, y * 8, (x + y) * 3]);
    const out = rectify(src, rectQuad(8, 5, 28, 20), 20, 15);
    expect(out.width).toBe(20);
    expect(out.height).toBe(15);
    expect(out.channels).toBe(3);
    expect(out.data.length).toBe(20 * 15 * 3);
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 20; x++) expect(pixel(out, x, y)).toEqual(pixel(src, x + 8, y + 5));
    }
  });

  it('квад во весь кадр воспроизводит картинку; альфа-канал источника отбрасывается', () => {
    const src = image(16, 12, (x, y) => [x * 15, y * 20, 100], 4);
    const out = rectify(src, rectQuad(0, 0, 16, 12), 16, 12);
    expect(out.channels).toBe(3);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) expect(pixel(out, x, y)).toEqual(pixel(src, x, y));
    }
  });

  it('выпрямление перспективно искажённой шахматной доски воспроизводит доску (≤ 2 уровней)', () => {
    // Доска 8 × 6 клеток по 16 px «на стене»; «фото» — она же под известной гомографией.
    const cell = 16;
    const bw = 8 * cell;
    const bh = 6 * cell;
    const quad: Quad = [
      [60, 40],
      [520, 85],
      [500, 400],
      [75, 430],
    ];
    const toBoard = solveHomography(quad, rectQuad(0, 0, bw, bh));
    const paint = board(cell);
    // «Фото» рисуется аналитически: цвет пикселя — цвет точки доски под его центром; вне доски — серый.
    const photo = image(600, 480, (x, y) => {
      const [u, v] = applyHomography(toBoard, x + 0.5, y + 0.5);
      return u >= 0 && u < bw && v >= 0 && v < bh ? paint(u, v) : [128, 128, 128];
    });
    const out = rectify(photo, quad, bw, bh);
    let checked = 0;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        // Пиксели у границ клеток смешивают два цвета при любой выборке — сравниваем внутренность клеток.
        const fx = x % cell;
        const fy = y % cell;
        if (fx < 3 || fx > cell - 4 || fy < 3 || fy > cell - 4) continue;
        const expected = paint(x, y)[0];
        const got = pixel(out, x, y);
        expect(Math.abs(got[0] - expected)).toBeLessThanOrEqual(2);
        expect(Math.abs(got[1] - expected)).toBeLessThanOrEqual(2);
        expect(Math.abs(got[2] - expected)).toBeLessThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('плавный градиент под перспективой восстанавливается билинейной выборкой (≤ 2 уровней)', () => {
    const quad: Quad = [
      [30, 20],
      [270, 45],
      [255, 210],
      [40, 225],
    ];
    const w = 120;
    const h = 90;
    const toRect = solveHomography(quad, rectQuad(0, 0, w, h));
    const ramp = (u: number, v: number): [number, number, number] => [40 + (u / w) * 160, 30 + (v / h) * 180, 100];
    const photo = image(300, 240, (x, y) => {
      const [u, v] = applyHomography(toRect, x + 0.5, y + 0.5);
      const [r, g, b] = ramp(u, v);
      return [Math.round(Math.min(255, Math.max(0, r))), Math.round(Math.min(255, Math.max(0, g))), b];
    });
    const out = rectify(photo, quad, w, h);
    for (let y = 2; y < h - 2; y += 3) {
      for (let x = 2; x < w - 2; x += 3) {
        const [r, g] = ramp(x + 0.5, y + 0.5);
        const got = pixel(out, x, y);
        expect(Math.abs(got[0] - r)).toBeLessThanOrEqual(2);
        expect(Math.abs(got[1] - g)).toBeLessThanOrEqual(2);
        expect(got[2]).toBe(100);
      }
    }
  });

  it('вне кадра источника — fill (по умолчанию чёрный)', () => {
    const src = image(10, 10, () => [200, 150, 100]);
    // Квад шире кадра вдвое: левая и правая четверти результата лежат вне источника.
    const quad = rectQuad(-10, 0, 20, 10);
    const filled = rectify(src, quad, 30, 10, { fill: [10, 20, 30] });
    expect(pixel(filled, 0, 5)).toEqual([10, 20, 30]);
    expect(pixel(filled, 9, 0)).toEqual([10, 20, 30]);
    expect(pixel(filled, 10, 5)).toEqual([200, 150, 100]);
    expect(pixel(filled, 19, 9)).toEqual([200, 150, 100]);
    expect(pixel(filled, 20, 5)).toEqual([10, 20, 30]);
    expect(pixel(filled, 29, 9)).toEqual([10, 20, 30]);
    const black = rectify(src, quad, 30, 10);
    expect(pixel(black, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(black, 15, 5)).toEqual([200, 150, 100]);
  });

  it('gain умножает каналы и насыщается на 255; на fill не действует', () => {
    const src = image(8, 8, () => [100, 100, 200]);
    const out = rectify(src, rectQuad(0, 0, 8, 8), 8, 8, { gain: [0.5, 1.2, 1.5] });
    expect(pixel(out, 3, 3)).toEqual([50, 120, 255]);
    const outside = rectify(src, rectQuad(-8, 0, 8, 8), 16, 8, { gain: [0.5, 1.2, 1.5], fill: [40, 40, 40] });
    expect(pixel(outside, 2, 2)).toEqual([40, 40, 40]);
    expect(pixel(outside, 12, 2)).toEqual([50, 120, 255]);
    // Без gain картинка не меняется.
    expect(pixel(rectify(src, rectQuad(0, 0, 8, 8), 8, 8), 0, 0)).toEqual([100, 100, 200]);
  });

  it('вырожденный квад бросает и здесь', () => {
    const src = image(4, 4, () => [1, 2, 3]);
    expect(() =>
      rectify(
        src,
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
        ],
        4,
        4,
      ),
    ).toThrow();
  });
});

describe('homography.ts как модуль для Node-скрипта', () => {
  it('не содержит импортов и неудаляемого TS-синтаксиса', () => {
    expect(source.length).toBeGreaterThan(1000);
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s/m);
    expect(source).not.toMatch(/^\s*(export\s+)?namespace\s/m);
    expect(source).not.toMatch(/constructor\s*\(\s*(public|private|protected|readonly)\s/);
  });
});
