import { clamp, shade } from '../../../model/color';
import { createRng } from '../../../model/rng';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import { DEG, guardPainter, paramFlag, paramNumber, sortingHat } from './sortingHat';

// 4.8 «Мандрагоры и шляпа»: горшочки с хмурыми корешками и Распределяющая шляпа позади них (см. decor_refs).
// Площадной предмет (resize 'free'): горшки держат реальный размер, бо́льшая площадка вмещает их больше —
// но не больше параметра «Горшки» (предел 12).

/** Минимальное расстояние между центрами горшков и отступ центра от края площадки, м. */
const POT_SPACING = 0.11;
const POT_EDGE = 0.06;
const SOIL = '#4b3226';
const ROOT = '#c98d55';
const STEM = '#3f7a2e';
const LEAF = '#4f9a3a';
const HAT = '#7a4a22';
const HAT_MAX = 0.25;

function build({ size, color, params }: BuildInput): Part[] {
  const [w, h, d] = size;
  const wanted = Math.round(clamp(paramNumber(params, 'pots', 6), 1, 12));
  const withHat = paramFlag(params, 'withHat', true);
  const rng = createRng(paramNumber(params, 'seed', 1));
  // Масштаб элементов: 1 при любом допустимом размере (≥ minSize); меньше — только у вырожденной площадки,
  // на которой не помещается даже один горшок с ботвой (0.13 × 0.2 × 0.13 м).
  const e = Math.min(1, w / 0.13, d / 0.13, h / 0.2);
  const parts: Part[] = [];

  // ---------- Шляпа: прижата к заднему краю изнутри ----------
  const hatWidth = Math.min(HAT_MAX, 0.8 * d, 0.8 * w);
  const hatZ = -d / 2 + hatWidth / 2;

  // ---------- Где стоят горшки ----------
  // Со шляпой — передние 60 % площадки; без неё занята вся площадка.
  const halfX = Math.max(0, w / 2 - POT_EDGE * e);
  const zMax = Math.max(0, d / 2 - POT_EDGE * e);
  const zMin = Math.min(zMax, withHat ? -0.1 * d + POT_EDGE * e : -d / 2 + POT_EDGE * e);
  const spacing = POT_SPACING * e;
  const hatClearance = hatWidth / 2 + 0.047 * e;
  const spots: [number, number][] = [];
  const scatter = (avoidHat: boolean): void => {
    for (let attempt = 0; attempt < 400 && spots.length < wanted; attempt++) {
      const x = rng.range(-halfX, halfX);
      const z = rng.range(zMin, zMax);
      if (spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < spacing)) continue;
      if (avoidHat && Math.hypot(x, z - hatZ) < hatClearance) continue;
      spots.push([x, z]);
    }
  };
  scatter(withHat);
  // На тесной площадке шляпа занимает почти всё: тогда горшкам разрешено встать на её поля.
  if (withHat && spots.length < Math.min(wanted, 3)) scatter(false);

  // ---------- Горшки ----------
  for (const [x, z] of spots) {
    const rootScale = rng.range(0.85, 1.15);
    const rootYaw = rng.range(-25, 25) * DEG;
    const leaves = rng.int(2, 3);
    const leafStart = rng.range(0, Math.PI * 2);

    parts.push({ shape: 'cylinder', position: [x, 0.025 * e, z], size: [0.07 * e, 0.05 * e, 0.07 * e], taper: 1.3, color });
    parts.push({ shape: 'sphere', position: [x, 0.05 * e, z], size: [0.085 * e, 0.03 * e, 0.085 * e], color: SOIL });
    // Корень: хмурая рожица нарисована в горизонтальном центре canvas и смотрит в локальный +Z (к зрителю).
    const rootHeight = 0.05 * rootScale * e;
    const rootBottom = 0.045 * e;
    parts.push({
      shape: 'cylinder',
      position: [x, rootBottom + rootHeight / 2, z],
      size: [0.04 * rootScale * e, rootHeight, 0.04 * rootScale * e],
      rotation: [0, rootYaw, 0],
      taper: 0.7,
      color: ROOT,
      paint: { painter: 'hp.mandrakeFace', px: [128, 128] },
    });
    const stemBottom = rootBottom + rootHeight;
    const stemTop = stemBottom + 0.03 * e;
    parts.push({ shape: 'cylinder', position: [x, (stemBottom + stemTop) / 2, z], size: [0.004 * e, 0.03 * e, 0.004 * e], color: STEM });
    // Листья: плоские эллипсоиды, растут от верхушки стебля вверх и наружу (30–50° от вертикали).
    for (let leaf = 0; leaf < leaves; leaf++) {
      const azimuth = leafStart + ((leaf + rng.range(-0.15, 0.15)) / leaves) * Math.PI * 2;
      const elevation = (90 - rng.range(30, 50)) * DEG;
      const scale = rng.range(1, 1.25);
      const length = 0.06 * scale * e;
      // Длинная ось листа — локальная X: поворот [0, azimuth, elevation] поднимает её и разворачивает вокруг стебля.
      const reach = (length / 2) * Math.cos(elevation);
      parts.push({
        shape: 'sphere',
        position: [x + reach * Math.cos(azimuth), stemTop + (length / 2) * Math.sin(elevation), z - reach * Math.sin(azimuth)],
        size: [length, 0.004 * e, 0.035 * scale * e],
        rotation: [0, azimuth, elevation],
        color: shade(LEAF, rng.range(0.85, 1.15)),
      });
    }
  }

  if (withHat) {
    parts.push(
      ...sortingHat(hatWidth, Math.min(HAT_MAX, h), {
        color: HAT,
        face: 'dark',
        origin: [0, 0, hatZ],
        seed: rng.int(0, 0x7fffffff),
      }),
    );
  }
  return parts;
}

export const item: CatalogItem = {
  id: 'hp.mandrakes',
  kind: 'preset',
  title: 'Мандрагоры и шляпа',
  category: 'Гарри Поттер',
  size: [0.6, 0.4, 0.45],
  minSize: [0.3, 0.3, 0.25],
  resize: 'free',
  color: '#1c1512',
  mounts: ['surface', 'floor'],
  params: [
    { key: 'pots', label: 'Горшки', type: 'number', min: 3, max: 12, step: 1, default: 6 },
    { key: 'withHat', label: 'Распределяющая шляпа', type: 'boolean', default: true },
    { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
  ],
  build,
};

export const painters: Record<string, Painter> = {
  /**
   * Кожица корня с хмурой рожицей. Цвет части умножается на текстуру, поэтому фон — почти белый.
   * Рожица — в горизонтальном центре canvas (на цилиндре он смотрит в локальный +Z); шов — по краям.
   */
  'hp.mandrakeFace': guardPainter('hp.mandrakeFace', '#ffffff', (ctx, width, height) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Книзу корень темнее.
    const shadeDown = ctx.createLinearGradient(0, 0, 0, height);
    shadeDown.addColorStop(0, 'rgba(120, 70, 30, 0)');
    shadeDown.addColorStop(1, 'rgba(120, 70, 30, 0.3)');
    ctx.fillStyle = shadeDown;
    ctx.fillRect(0, 0, width, height);

    // Поперечные морщины: целое число волн на ширину — рисунок сходится на шве.
    ctx.strokeStyle = 'rgba(110, 60, 25, 0.35)';
    ctx.lineWidth = Math.max(1, height * 0.018);
    ctx.lineCap = 'round';
    const rows = 6;
    for (let row = 0; row < rows; row++) {
      const y = ((row + 0.5) / rows) * height;
      ctx.beginPath();
      for (let step = 0; step <= 32; step++) {
        const x = (step / 32) * width;
        const wave = Math.sin((step / 32) * Math.PI * 2 * 3 + row * 1.7) * height * 0.012;
        if (step === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }

    // Рожица: сведённые брови, глаза-щёлки, рот уголками вниз.
    const cx = width / 2;
    const ink = '#3b2413';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const sign of [-1, 1]) {
      // Бровь: наружный конец выше внутреннего.
      ctx.lineWidth = Math.max(1, width * 0.035);
      ctx.beginPath();
      ctx.moveTo(cx + sign * width * 0.17, height * 0.27);
      ctx.lineTo(cx + sign * width * 0.045, height * 0.36);
      ctx.stroke();
      // Глаз: короткая тёмная щёлка под бровью.
      ctx.beginPath();
      ctx.ellipse(cx + sign * width * 0.1, height * 0.43, width * 0.04, height * 0.028, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = Math.max(1, width * 0.04);
    ctx.beginPath();
    ctx.moveTo(cx - width * 0.12, height * 0.74);
    ctx.quadraticCurveTo(cx, height * 0.58, cx + width * 0.12, height * 0.74);
    ctx.stroke();
  }),
};
