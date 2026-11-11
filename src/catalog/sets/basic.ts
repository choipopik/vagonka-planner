import { clamp, shade } from '../../model/color';
import { LIGHT_LIMITS } from '../../model/lights';
import { createRng } from '../../model/rng';
import type { Vec3 } from '../../model/types';
import type { Builder, CatalogItem, CatalogSet, ParamDef, Part } from '../types';

/**
 * Набор «basic»: мебель площадки, простые фигуры, свет, пользовательские файлы и потолочные «жильцы» площадки.
 * id записей заморожены — на них ссылается rooms/lounge.ts.
 *
 * Части — в локальных координатах объекта: начало — центр основания, x ∈ [−w/2, w/2], y ∈ [0, h],
 * z ∈ [−d/2, d/2], «лицо» — в +Z. Для цилиндра size = [диаметр, высота, диаметр].
 */

const box = (position: Vec3, size: Vec3, color: string): Part => ({ shape: 'box', position, size, color });
const cyl = (position: Vec3, diameter: number, height: number, color: string): Part => ({
  shape: 'cylinder',
  position,
  size: [diameter, height, diameter],
  color,
});

// ---------- Мебель (перенос билдеров этапа 1) ----------

const BACK_T = 0.22;
const SEAT_RATIO = 0.53;
const DARK_METAL = '#2a2422';

const sofa: Builder = ({ size: [w, h, d], color }) => {
  const bt = Math.min(BACK_T, d * 0.35);
  const sh = h * SEAT_RATIO;
  return [
    box([0, h / 2, -d / 2 + bt / 2], [w, h, bt], shade(color, 0.9)),
    box([0, sh / 2, bt / 2], [w, sh, d - bt], color),
  ];
};

/** П-образная кабинка: спинка вдоль −Z, боковые сиденья с перегородками, открыта в +Z. */
const sofaU: Builder = ({ size: [w, h, d], color }) => {
  const bt = Math.min(BACK_T, d * 0.3);
  const at = Math.min(BACK_T, w * 0.15);
  const sd = Math.min(0.6, (w - 2 * at) / 3, d - bt);
  const sh = h * SEAT_RATIO;
  const sideLen = d - bt - sd;
  const parts: Part[] = [
    box([0, h / 2, -d / 2 + bt / 2], [w, h, bt], shade(color, 0.9)),
    box([0, sh / 2, -d / 2 + bt + sd / 2], [w - 2 * at, sh, sd], color),
  ];
  for (const side of [-1, 1]) {
    parts.push(box([side * (w / 2 - at / 2), h / 2, 0], [at, h, d], shade(color, 0.9)));
    if (sideLen > 0.05) {
      parts.push(box([side * (w / 2 - at - sd / 2), sh / 2, d / 2 - sideLen / 2], [sd, sh, sideLen], color));
    }
  }
  return parts;
};

const TOP_T = 0.06;

const table: Builder = ({ size: [w, h, d], color }) => {
  const top = Math.min(TOP_T, h / 2);
  const foot = Math.min(0.03, h / 4);
  return [
    box([0, h - top / 2, 0], [w, top, d], color),
    cyl([0, (h - top) / 2, 0], Math.min(0.1, w, d), h - top, DARK_METAL),
    cyl([0, foot / 2, 0], Math.min(0.5, d * 0.8, w), foot, DARK_METAL),
  ];
};

/** Высокая стойка: один конец (−X) примыкает к колонне, нога — у свободного конца. */
const highTable: Builder = ({ size: [w, h, d], color }) => {
  const top = Math.min(TOP_T, h / 2);
  const foot = Math.min(0.03, h / 4);
  const base = Math.min(0.5, d, w);
  // Нога у свободного конца, но основание не выходит за габарит.
  const legX = Math.max(0, Math.min(w / 2 - Math.min(0.3, w / 3), w / 2 - base / 2));
  return [
    box([0, h - top / 2, 0], [w, top, d], color),
    cyl([legX, (h - top) / 2, 0], Math.min(0.08, w, d), h - top, DARK_METAL),
    cyl([legX, foot / 2, 0], base, foot, DARK_METAL),
  ];
};

const phoneBooth: Builder = ({ size: [w, h, d], color }) => {
  const glass = shade(color, 0.3);
  const bodyH = h * 0.92;
  const winH = h * 0.6;
  const winY = h * 0.52;
  return [
    box([0, bodyH / 2, 0], [w, bodyH, d], color),
    box([0, bodyH + (h - bodyH) / 2, 0], [w * 1.06, h - bodyH, d * 1.06], shade(color, 0.85)),
    box([0, winY, d / 2], [w * 0.7, winH, 0.02], glass),
    box([w / 2, winY, 0], [0.02, winH, d * 0.7], glass),
    box([-w / 2, winY, 0], [0.02, winH, d * 0.7], glass),
  ];
};

/**
 * Ограждение. Габарит — настоящий след на полу (опоры длиной d): перила и прутья — фиксированной толщины
 * по оси объекта, опоры [0.06, 0.03, d]. Вид тот же, что в этапе 1, где опоры выходили за габарит глубиной 0.06.
 */
const barrier: Builder = ({ size: [w, h, d], color }) => {
  const rail = 0.04;
  const thick = Math.min(0.06, d);
  const low = Math.min(0.2, h / 2);
  const parts: Part[] = [
    box([0, h - rail / 2, 0], [w, rail, thick], color),
    box([0, low, 0], [w, rail, thick], color),
    box([-w / 2 + rail / 2, h / 2, 0], [rail, h, thick], color),
    box([w / 2 - rail / 2, h / 2, 0], [rail, h, thick], color),
    box([-w / 2 + Math.min(0.15, w / 4), 0.015, 0], [0.06, 0.03, d], color),
    box([w / 2 - Math.min(0.15, w / 4), 0.015, 0], [0.06, 0.03, d], color),
  ];
  const bars = Math.max(1, Math.round(w / 0.16) - 1);
  for (let i = 1; i <= bars; i++) {
    const x = -w / 2 + (w * i) / (bars + 1);
    parts.push(box([x, (h + low) / 2, 0], [0.02, h - low, 0.02], color));
  }
  return parts;
};

const floorLamp: Builder = ({ size: [w, h], color }) => {
  const shadeH = h * 0.22;
  return [
    cyl([0, 0.015, 0], w * 0.7, 0.03, color),
    cyl([0, (h - shadeH) / 2, 0], 0.04, h - shadeH, color),
    cyl([0, h - shadeH / 2, 0], w, shadeH, color),
  ];
};

// ---------- Фигуры ----------

const solidBox: Builder = ({ size: [w, h, d], color }) => [box([0, h / 2, 0], [w, h, d], color)];
const solidCylinder: Builder = ({ size: [w, h, d], color }) => [
  { shape: 'cylinder', position: [0, h / 2, 0], size: [w, h, d], color },
];
const solidSphere: Builder = ({ size: [w, h, d], color }) => [
  { shape: 'sphere', position: [0, h / 2, 0], size: [w, h, d], color },
];
const solidCone: Builder = ({ size: [w, h, d], color }) => [
  { shape: 'cylinder', position: [0, h / 2, 0], size: [w, h, d], color, taper: 0 },
];

// ---------- Потолочные «жильцы» площадки ----------

/**
 * Чёрный воздуховод вдоль X: круглая труба под потолком, две тонкие трубы рядом и хомуты-подвесы.
 * Зазоры — доли высоты (не больше исходных 2 см), чтобы и при минимальном размере всё оставалось в габарите.
 */
const duct: Builder = ({ size: [w, h, d], color }) => {
  const main = Math.min(h * 0.8, d * 0.6);
  const pipe = Math.min(h * 0.22, d * 0.14);
  const gap = Math.min(0.02, h * 0.05);
  const alongX: Vec3 = [0, 0, Math.PI / 2];
  const mainZ = -d / 2 + main / 2;
  const parts: Part[] = [
    { shape: 'cylinder', position: [0, h - main / 2 - gap, mainZ], size: [main, w, main], rotation: alongX, color },
    {
      shape: 'cylinder',
      position: [0, h - pipe / 2 - gap * 1.5, d / 2 - pipe * 0.6],
      size: [pipe, w, pipe],
      rotation: alongX,
      color: shade(color, 1.8),
      metalness: 0.4,
      roughness: 0.6,
    },
    {
      shape: 'cylinder',
      position: [0, h - pipe * 1.8 - gap * 1.5, d / 2 - pipe * 1.9],
      size: [pipe, w, pipe],
      rotation: alongX,
      color: shade(color, 1.4),
      metalness: 0.4,
      roughness: 0.6,
    },
  ];
  const hangers = Math.max(2, Math.min(12, Math.round(w / 1.5)));
  const band = Math.min(0.04, w / hangers);
  for (let i = 0; i < hangers; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / hangers;
    parts.push(box([x, h - (main + gap) / 2, mainZ], [band, main + gap, main + gap], shade(color, 1.3)));
  }
  return parts;
};

const BULB_COLOR = '#ffd9a0';

/** Лампы Эдисона на проводах разной длины: провод — тонкий цилиндр, лампа — светящаяся сфера с ореолом. */
const pendantBulbs: Builder = ({ size: [w, h, d], color, params }) => {
  const count = Math.max(1, Math.min(12, Math.round(Number(params.count) || 1)));
  const rng = createRng(Number(params.seed) || 0);
  const bulb = Math.min(0.09, w, d, h / 2);
  const socket = bulb * 0.45;
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const cell = w / count;
    // При узком габарите ячейка у́же лампы: центр зажимается так, чтобы лампа целиком осталась внутри.
    const reach = Math.max(0, (w - bulb * 0.8) / 2);
    const x = clamp(-w / 2 + cell * (i + 0.5) + rng.range(-0.3, 0.3) * Math.max(0, cell - bulb), -reach, reach);
    const z = rng.range(-0.5, 0.5) * Math.max(0, d - bulb);
    // Низ лампы — на высоте 0…0.5h от основания габарита: лампы висят на разной высоте.
    const bottom = rng.range(0, 0.5) * Math.max(0, h - bulb - socket);
    const top = bottom + bulb;
    parts.push(
      { shape: 'cylinder', position: [x, (h + top + socket) / 2, z], size: [0.006, h - top - socket, 0.006], color },
      { shape: 'cylinder', position: [x, top + socket / 2, z], size: [bulb * 0.4, socket, bulb * 0.4], color },
      { shape: 'sphere', position: [x, bottom + bulb / 2, z], size: [bulb * 0.8, bulb, bulb * 0.8], color: BULB_COLOR, look: 'glow' },
      {
        shape: 'sphere',
        position: [x, bottom + bulb / 2, z],
        size: [bulb * 3, bulb * 3, bulb * 3],
        color: BULB_COLOR,
        look: 'glow',
        additive: true,
        opacity: 0.25,
      },
    );
  }
  return parts;
};

/** Проектор: корпус, объектив в +Z и площадка крепления сверху. */
const projector: Builder = ({ size: [w, h, d], color }) => {
  const body = h * 0.72;
  const lens = Math.min(body * 0.7, w * 0.3);
  const lensLen = Math.min(0.08, d * 0.25);
  return [
    box([0, body / 2, -lensLen / 2], [w, body, d - lensLen], color),
    {
      shape: 'cylinder',
      position: [w * 0.22, body / 2, d / 2 - lensLen / 2],
      size: [lens, lensLen, lens],
      rotation: [Math.PI / 2, 0, 0],
      color: shade(color, 0.5),
      roughness: 0.3,
      metalness: 0.5,
    },
    box([0, body + (h - body) / 2, 0], [w * 0.35, h - body, d * 0.35], shade(color, 0.7)),
  ];
};

// ---------- Параметры ----------

/** Поле параметра лампы; пределы — из LIGHT_LIMITS (те же, которыми зажимает lightSettings). Единица — в подписи. */
function lightParam(
  key: keyof typeof LIGHT_LIMITS,
  label: string,
  step: number,
  value: number = LIGHT_LIMITS[key].default,
): ParamDef {
  const limit = LIGHT_LIMITS[key];
  return { key, label, type: 'number', min: limit.min, max: limit.max, step, default: value };
}

const GLOW: ParamDef = { key: 'glow', label: 'Светится', type: 'boolean', default: false };

// ---------- Записи ----------

const FURNITURE = 'Мебель';
const SHAPES = 'Фигуры';
const LIGHT = 'Свет';
const FILES = 'Мои файлы';
const VENUE = 'Площадка';

const items: CatalogItem[] = [
  { id: 'sofa', kind: 'primitive', title: 'Диван', category: FURNITURE, size: [1.6, 0.8, 0.75], resize: 'free', color: '#8a8378', mounts: ['floor'], params: [], build: sofa },
  { id: 'sofaU', kind: 'primitive', title: 'Диван-кабинка', category: FURNITURE, size: [2.8, 0.85, 1.8], resize: 'free', color: '#8a8378', mounts: ['floor'], params: [], build: sofaU },
  { id: 'table', kind: 'primitive', title: 'Стол', category: FURNITURE, size: [1.1, 0.75, 0.7], resize: 'free', color: '#7b3a26', mounts: ['floor'], params: [], support: true, build: table },
  { id: 'highTable', kind: 'primitive', title: 'Высокая стойка', category: FURNITURE, size: [1.4, 1.1, 0.5], resize: 'free', color: '#7b3a26', mounts: ['floor'], params: [], support: true, build: highTable },
  { id: 'phoneBooth', kind: 'primitive', title: 'Телефонная будка', category: FURNITURE, size: [0.9, 2.4, 0.9], resize: 'uniform', color: '#b3161b', mounts: ['floor'], params: [], build: phoneBooth },
  { id: 'barrier', kind: 'primitive', title: 'Ограждение', category: FURNITURE, size: [2.2, 1.1, 0.5], minSize: [0.4, 0.4, 0.3], resize: 'free', color: '#c9c9c9', mounts: ['floor'], params: [], build: barrier },
  { id: 'floorLamp', kind: 'primitive', title: 'Торшер', category: FURNITURE, size: [0.45, 1.6, 0.45], resize: 'uniform', color: '#1a1a1a', mounts: ['floor'], params: [], build: floorLamp },

  { id: 'box', kind: 'primitive', title: 'Ящик', category: SHAPES, size: [0.5, 0.5, 0.5], resize: 'free', color: '#b8b2a7', mounts: ['floor', 'surface', 'ceiling'], params: [], support: true, build: solidBox },
  { id: 'cylinder', kind: 'primitive', title: 'Цилиндр', category: SHAPES, size: [0.5, 0.5, 0.5], resize: 'free', color: '#b8b2a7', mounts: ['floor', 'surface', 'ceiling'], params: [], support: true, build: solidCylinder },
  { id: 'sphere', kind: 'primitive', title: 'Шар', category: SHAPES, size: [0.4, 0.4, 0.4], resize: 'uniform', color: '#b8b2a7', mounts: ['floor', 'surface', 'ceiling'], params: [], build: solidSphere },
  { id: 'cone', kind: 'primitive', title: 'Конус', category: SHAPES, size: [0.4, 0.6, 0.4], resize: 'free', color: '#b8b2a7', mounts: ['floor', 'surface', 'ceiling'], params: [], build: solidCone },
  { id: 'panel', kind: 'primitive', title: 'Щит / баннер', category: SHAPES, size: [1.5, 1.0, 0.03], resize: 'free', color: '#e8e2d5', mounts: ['wall', 'floor', 'ceiling'], params: [], build: solidBox },

  {
    id: 'light.point', kind: 'light', title: 'Лампа', category: LIGHT, size: [0.15, 0.15, 0.15], resize: 'none', color: '#ffd9a0',
    mounts: ['ceiling', 'wall', 'floor', 'surface'], defaultDrop: 0.4,
    params: [lightParam('intensity', 'Яркость, кд', 1), lightParam('distance', 'Дальность, м', 0.5)],
  },
  {
    id: 'light.spot', kind: 'light', title: 'Прожектор', category: LIGHT, size: [0.18, 0.22, 0.18], resize: 'none', color: '#ffffff',
    mounts: ['ceiling', 'wall', 'floor', 'surface'],
    params: [
      lightParam('intensity', 'Яркость, кд', 1, 40),
      lightParam('distance', 'Дальность, м', 0.5),
      lightParam('angle', 'Угол, °', 1),
      lightParam('penumbra', 'Мягкость', 0.05),
      lightParam('tilt', 'Наклон, °', 1),
    ],
  },

  {
    id: 'image', kind: 'image', title: 'Картинка', category: FILES, size: [1.0, 1.0, 0.02], resize: 'uniform', flatAxis: 2, color: '#ffffff',
    mounts: ['wall', 'floor', 'ceiling', 'surface'], listed: false, hanger: false, params: [GLOW],
  },
  {
    id: 'image.flat', kind: 'image', title: 'Картинка плашмя', category: FILES, size: [1.0, 0.02, 1.0], resize: 'uniform', flatAxis: 1, color: '#ffffff',
    mounts: ['floor', 'ceiling', 'surface'], listed: false, hanger: false, params: [GLOW],
  },
  {
    id: 'model', kind: 'model', title: '3D-модель', category: FILES, size: [1, 1, 1], resize: 'uniform', color: '#b8b2a7',
    mounts: ['floor', 'surface', 'ceiling', 'wall'], listed: false, params: [],
  },

  {
    id: 'duct', kind: 'primitive', title: 'Воздуховод', category: VENUE, size: [12, 0.45, 0.5], resize: 'free', color: '#161616',
    mounts: ['ceiling'], listed: false, hanger: false, params: [], build: duct,
  },
  {
    id: 'pendantBulbs', kind: 'preset', title: 'Лампы на проводах', category: VENUE, size: [2.0, 0.8, 0.6], resize: 'free', color: '#1a1a1a',
    mounts: ['ceiling'], listed: false, hanger: false,
    params: [
      { key: 'count', label: 'Лампы', type: 'number', min: 1, max: 12, step: 1, default: 5 },
      { key: 'seed', label: 'Перемешать', type: 'seed', default: 1 },
    ],
    build: pendantBulbs,
  },
  {
    id: 'projector', kind: 'primitive', title: 'Проектор', category: VENUE, size: [0.4, 0.18, 0.35], resize: 'uniform', color: '#2b2b2b',
    mounts: ['ceiling'], listed: false, defaultDrop: 0.35, params: [], build: projector,
  },
];

export const basicSet: CatalogSet = {
  id: 'basic',
  title: 'Базовый набор',
  order: 10,
  items,
};
