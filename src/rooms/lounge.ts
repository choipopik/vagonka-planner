import type { ObjectKind, Params, RoomDef, SceneObject, Vec2, Vec3 } from '../model/types';

/**
 * Лаунж. Размеры оценены на глаз по фото и нарисованному плану (погрешность 10–20%).
 * Когда появятся обмеры — правится только этот файл.
 *
 * Ориентация: дальняя длинная стена (мурал #VAGONKACLUB, подиум) — z = −W/2,
 * ближняя (вход, баннер, лестницы) — z = +W/2, Red Bar — x = −L/2, телефонная будка — x = +L/2.
 */
const L = 17;
const W = 8;
const H = 3.1;
const hx = L / 2;
const hz = W / 2;

const WALL_LOWER = '#7d2b26';
const WALL_UPPER = '#d9d5d0';
const SPLIT = 2.25;
const DARK = '#141111';
const CURTAIN = '#8e2a26';

const SOFA_GREY = '#8a8378';
const SOFA_DARK = '#6b6765';
const SOFA_RED = '#a11d22';
const WOOD = '#7b3a26';
const METAL = '#c9c9c9';
/**
 * Белёная стена под трафаретами (мурал, Мона Лиза). Фото 4 недоэкспонировано и желтит; gain в scripts/textures.json
 * приводит чистую стену на фото к этому цвету, чтобы фото не выделялось пятном на основе.
 */
const WHITEWASH = '#dcdbd8';
/** Тёмно-красный фон фотоколлажей на торцевых стенах. */
const COLLAGE = '#5a1512';
/** Чёрное железо под потолком: воздуховод, провода ламп, корпуса прожекторов. */
const IRON = '#161616';
const WASH_RED = '#ff1a1a';

/** Запечённые фототекстуры: scripts/textures.json → npm run bake → public/textures/lounge/<id>.jpg. */
const TEX = 'textures/lounge';

const PODIUM_H = 0.15;
const PODIUM_X0 = -5.1;
const PODIUM_X1 = 4.6;
const PODIUM_DEPTH = 2.0;
const BOOTH_W = (PODIUM_X1 - PODIUM_X0) / 3;
/** Высота диванов кабинок: мурал выпрямлен с фото от линии их спинок. */
const BOOTH_SOFA_H = 0.85;
const MURAL_BOTTOM = PODIUM_H + BOOTH_SOFA_H;
const MURAL_TOP = 3.0;
/**
 * Ширина полотна мурала. На фото 4 полотно от линии спинок до шапки маляра имеет пропорции ≈ 3 : 1 (истинные, после
 * снятия перспективы), а подиум в модели длиннее настоящего; 7 м — компромисс: надпись растянута на ~17 %, зато
 * маляр стоит над первой кабинкой, а надпись кончается у третьей, как на фото.
 */
const MURAL_W = 7.0;

const COLUMN_SIZE: Vec2 = [0.8, 0.8];
const COL_LEFT: Vec2 = [-2.25, 0];
const COL_RIGHT: Vec2 = [2.15, 0];
/** Грань колонн, обращённая к ближней стене (s). */
const COLUMN_SOUTH = COLUMN_SIZE[1] / 2;

/** Предмет мебели площадки на полу: at = [x, z]; высоту подиума под ним даёт floorAt(). */
function venue(
  id: string,
  type: string,
  name: string,
  at: Vec2,
  size: Vec3,
  color: string,
  rotationY = 0,
): SceneObject {
  return {
    id: `venue-${id}`,
    kind: 'primitive',
    type,
    origin: 'venue',
    name,
    mount: { kind: 'floor', x: at[0], z: at[1], lift: 0 },
    rotationY,
    size,
    color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
  };
}

/**
 * Потолочный «жилец» площадки (фото 3 и 4): at = [x, z], drop — от потолка до верха предмета.
 * Как и мебель, скрывается и возвращается кнопкой «Сбросить мебель».
 */
function hung(
  id: string,
  kind: ObjectKind,
  type: string,
  name: string,
  at: Vec2,
  drop: number,
  size: Vec3,
  color: string,
  params: Params = {},
  rotationY = 0,
): SceneObject {
  return {
    id: `venue-${id}`,
    kind,
    type,
    origin: 'venue',
    name,
    mount: { kind: 'ceiling', x: at[0], z: at[1], drop },
    rotationY,
    size,
    color,
    assetId: null,
    locked: false,
    visible: true,
    params,
  };
}

/** Корпус PAR-прожектора: чёрный цилиндр под потолком в точке заливки (сам свет даёт washes в «Вечеринке»). */
const PAR_SIZE: Vec3 = [0.24, 0.22, 0.24];

const booths: SceneObject[] = [0, 1, 2].flatMap((i) => {
  const x = PODIUM_X0 + BOOTH_W * (i + 0.5);
  return [
    venue(`booth-${i + 1}`, 'sofaU', `Кабинка ${i + 1}`, [x, -hz + 0.95], [BOOTH_W, BOOTH_SOFA_H, 1.9], SOFA_GREY),
    venue(`booth-table-${i + 1}`, 'table', `Стол кабинки ${i + 1}`, [x, -hz + 1.25], [1.2, 0.75, 0.7], WOOD),
  ];
});

export const lounge: RoomDef = {
  id: 'lounge',
  name: 'Лаунж',
  size: { length: L, width: W, height: H },
  floorColor: '#b3aa9b',
  ceilingColor: '#151313',
  floorSurface: 'terrazzo',

  walls: [
    { id: 'far', name: 'Дальняя стена', from: [-hx, -hz], to: [hx, -hz], lowerColor: WALL_LOWER, upperColor: WALL_UPPER, splitHeight: SPLIT },
    { id: 'right', name: 'Правая торцевая', from: [hx, -hz], to: [hx, hz], lowerColor: WALL_LOWER, upperColor: WALL_UPPER, splitHeight: SPLIT },
    { id: 'near', name: 'Ближняя стена', from: [hx, hz], to: [-hx, hz], lowerColor: WALL_LOWER, upperColor: WALL_UPPER, splitHeight: SPLIT },
    { id: 'left', name: 'Левая торцевая', from: [-hx, hz], to: [-hx, -hz], lowerColor: WALL_LOWER, upperColor: WALL_UPPER, splitHeight: SPLIT },
  ],

  // Панели с texture — выпрямленные фото (один квад scripts/textures.json = одна панель = один JPEG). Размер панели
  // правится здесь, после чего достаточно перезапустить `npm run bake`: скрипт берёт метры из этого файла.
  // Слой 1 рисуется поверх слоя 0 (не больше 1: второй слой — 2.4 см от стены, декор висит в 3 см).
  panels: [
    // Дальняя стена (offset = x + L/2)
    { id: 'curtain-left', wall: 'far', kind: 'curtain', offset: 0.3, width: 1.9, bottom: 0, height: 2.9, color: CURTAIN },
    // Белёная стена за кабинками целиком; фото мурала — от линии спинок диванов (ниже фото заслонено мебелью)
    // и до шапки маляра (выше на фото — пустая стена и рейка со светильниками).
    { id: 'mural-base', wall: 'far', kind: 'photo', offset: PODIUM_X0 + hx, width: PODIUM_X1 - PODIUM_X0, bottom: PODIUM_H, height: MURAL_TOP - PODIUM_H, color: WHITEWASH },
    { id: 'mural', wall: 'far', kind: 'photo', offset: PODIUM_X0 + hx + 0.1, width: MURAL_W, bottom: MURAL_BOTTOM, height: MURAL_TOP - MURAL_BOTTOM, color: WHITEWASH, texture: `${TEX}/mural.jpg`, layer: 1 },
    // Простенок с трафаретом Моны Лизы: белая полоса на всю высоту, фото — над окном гардероба.
    { id: 'mona-base', wall: 'far', kind: 'photo', offset: 13.2, width: 1.3, bottom: 0, height: 2.9, color: WHITEWASH },
    { id: 'mona', wall: 'far', kind: 'photo', offset: 13.2, width: 1.3, bottom: 1.7, height: 1.2, color: WHITEWASH, texture: `${TEX}/mona.jpg`, layer: 1 },
    { id: 'wardrobe', wall: 'far', kind: 'opening', offset: 13.3, width: 1.1, bottom: 0.9, height: 0.8, color: DARK, label: 'Гардероб', layer: 1 },
    { id: 'curtain-right', wall: 'far', kind: 'curtain', offset: 14.9, width: 1.9, bottom: 0, height: 2.9, color: CURTAIN },

    // Правая торцевая (offset = z + W/2). Коллажей два (фото 3): большой в дальнем углу над диваном у будки и
    // вертикальный (≈ 0.85 : 1, фото 5) над красным диваном. Дальний снят только издалека (фото 3, ~60 px/м), его верхний
    // правый угол закрыт воздуховодом, нижний левый — шкафом: фото лежит на свободной части, под ним основа во весь коллаж.
    { id: 'collage-right-far-base', wall: 'right', kind: 'photo', offset: 0.5, width: 1.9, bottom: 1.0, height: 2.0, color: COLLAGE },
    { id: 'collage-right-far', wall: 'right', kind: 'photo', offset: 0.75, width: 1.6, bottom: 1.0, height: 1.65, color: COLLAGE, texture: `${TEX}/collage-right-far.jpg`, layer: 1 },
    { id: 'collage-right', wall: 'right', kind: 'photo', offset: 4.55, width: 1.5, bottom: 1.0, height: 1.8, color: COLLAGE, texture: `${TEX}/collage-right.jpg` },

    // Ближняя стена (offset = L/2 − x)
    { id: 'wc-f', wall: 'near', kind: 'opening', offset: 1.1, width: 1.9, bottom: 0, height: 2.2, color: DARK, label: 'Туалет Ж ↓' },
    { id: 'stairs-right', wall: 'near', kind: 'opening', offset: 3.3, width: 2.1, bottom: 0, height: 2.2, color: DARK, label: 'Наверх · танцпол' },
    { id: 'smoke', wall: 'near', kind: 'opening', offset: 5.9, width: 1.0, bottom: 0, height: 2.1, color: '#3a1512', texture: `${TEX}/smoke-door.jpg`, label: 'Smoke room' },
    { id: 'banner', wall: 'near', kind: 'photo', offset: 7.4, width: 2.2, bottom: 1.5, height: 1.15, color: '#c9c5c0', texture: `${TEX}/banner.jpg` },
    { id: 'entrance', wall: 'near', kind: 'opening', offset: 10.0, width: 1.5, bottom: 0, height: 2.2, color: DARK, label: 'Вход' },
    { id: 'stairs-left', wall: 'near', kind: 'opening', offset: 12.0, width: 2.4, bottom: 0, height: 2.2, color: DARK, label: 'Наверх · танцпол' },
    { id: 'wc-m', wall: 'near', kind: 'opening', offset: 14.6, width: 2.1, bottom: 0, height: 2.2, color: DARK, label: 'Туалет М ↓' },

    // Левая торцевая (offset = W/2 − z). Коллаж такой же, как справа; на фото 6 его левую часть заслоняет простенок,
    // поэтому фото лежит только на видимой правой части (истинные пропорции ≈ 0.56 : 1), а под ним — одноцветная
    // основа во весь коллаж.
    { id: 'collage-left-base', wall: 'left', kind: 'photo', offset: 3.1, width: 1.5, bottom: 1.0, height: 1.8, color: COLLAGE },
    { id: 'collage-left', wall: 'left', kind: 'photo', offset: 3.6, width: 1.0, bottom: 1.0, height: 1.8, color: COLLAGE, texture: `${TEX}/collage-left.jpg`, layer: 1 },
    { id: 'red-bar', wall: 'left', kind: 'opening', offset: 5.7, width: 1.2, bottom: 0, height: 2.1, color: '#2a1513', label: 'Red Bar' },
    // Вывеска RED BAR и дверь одним фото поверх проёма: от пола до верха вывески (выше на фото — лампы на проводах).
    { id: 'red-bar-photo', wall: 'left', kind: 'photo', offset: 5.6, width: 1.4, bottom: 0, height: 2.7, color: WALL_LOWER, texture: `${TEX}/red-bar.jpg`, layer: 1 },
  ],

  // Колонны (фото 3, 5, 6): кирпич — на гранях, обращённых к торцам зала (w, e); грани к длинным стенам (n, s)
  // покрашены в красный. На южной грани левой колонны — надпись #VAGONKACLUB (фото 6).
  columns: [
    {
      id: 'col-left',
      name: 'Левая колонна',
      position: COL_LEFT,
      size: COLUMN_SIZE,
      color: WALL_LOWER,
      faces: { w: { brick: true }, e: { brick: true }, s: { texture: `${TEX}/column-sign.jpg` } },
    },
    {
      id: 'col-right',
      name: 'Правая колонна',
      position: COL_RIGHT,
      size: COLUMN_SIZE,
      color: WALL_LOWER,
      faces: { w: { brick: true }, e: { brick: true } },
    },
  ],

  platforms: [
    { id: 'podium', min: [PODIUM_X0, -hz], max: [PODIUM_X1, -hz + PODIUM_DEPTH], height: PODIUM_H, color: '#3a2a28' },
  ],

  fixtures: [
    ...booths,

    // Диван под баннером у ближней стены
    venue('banner-sofa', 'sofaU', 'Диван под баннером', [0, hz - 0.9], [2.8, 0.8, 1.8], SOFA_DARK, Math.PI),
    venue('banner-table', 'table', 'Стол у баннера', [0, hz - 1.15], [1.1, 0.75, 0.7], WOOD),

    // Правая торцевая
    venue('right-sofa', 'sofaU', 'Диван у будки', [hx - 0.7, -2.5], [1.9, 0.8, 1.4], SOFA_GREY, -Math.PI / 2),
    venue('right-table', 'table', 'Стол у будки', [hx - 1.05, -2.5], [0.9, 0.75, 0.6], WOOD, -Math.PI / 2),
    venue('phone-booth', 'phoneBooth', 'Телефонная будка', [hx - 0.55, -0.4], [0.9, 2.4, 0.9], '#b3161b', -Math.PI / 2),
    venue('red-sofa', 'sofa', 'Красный диван', [hx - 0.4, 1.3], [1.6, 0.8, 0.75], SOFA_RED, -Math.PI / 2),
    venue('lamp-right', 'floorLamp', 'Торшер справа', [hx - 0.4, -3.6], [0.45, 1.6, 0.45], '#1a1a1a'),

    // Левая торцевая
    venue('left-sofa', 'sofa', 'Диван у Red Bar', [-hx + 0.4, 0.15], [1.5, 0.8, 0.75], '#8b3a34', Math.PI / 2),
    venue('lamp-left', 'floorLamp', 'Торшер слева', [-hx + 0.4, -1.3], [0.45, 1.6, 0.45], '#1a1a1a'),

    // Ограждения перед шторами
    venue('barrier-left', 'barrier', 'Ограждение слева', [-7.25, -hz + 0.55], [2.2, 1.1, 0.5], METAL),
    venue('barrier-right', 'barrier', 'Ограждение справа', [7.35, -hz + 0.55], [2.2, 1.1, 0.5], METAL),

    // Высокие стойки у колонн
    venue('high-table-left', 'highTable', 'Стойка у левой колонны', [-1.15, 0], [1.4, 1.1, 0.5], WOOD),
    venue('high-table-right', 'highTable', 'Стойка у правой колонны', [1.05, 0], [1.4, 1.1, 0.5], WOOD, Math.PI),

    // ---- Потолок площадки (на глаз по фото 3 и 4) ----

    // Чёрный воздуховод с трубами вдоль линии колонн, со стороны кабинок.
    hung('duct', 'primitive', 'duct', 'Воздуховод', [0, -0.68], 0.05, [15, 0.45, 0.5], IRON),

    // Лампы Эдисона на проводах: между колоннами, перед муралом, у баннера и в углу у Red Bar.
    hung('bulbs-center', 'preset', 'pendantBulbs', 'Лампы между колоннами', [0, 0.45], 0, [3.2, 0.8, 0.7], '#1a1a1a', { count: 6, seed: 3 }),
    hung('bulbs-mural', 'preset', 'pendantBulbs', 'Лампы перед муралом', [0.6, -1.55], 0, [5.5, 0.7, 0.6], '#1a1a1a', { count: 6, seed: 7 }),
    hung('bulbs-banner', 'preset', 'pendantBulbs', 'Лампы у баннера', [0.2, 2.7], 0, [3.0, 0.9, 0.8], '#1a1a1a', { count: 3, seed: 11 }),
    hung('bulbs-red-bar', 'preset', 'pendantBulbs', 'Лампы у Red Bar', [-6.7, -1.7], 0, [1.6, 0.8, 0.9], '#1a1a1a', { count: 5, seed: 5 }),

    // Проектор на штанге перед муралом, объективом в зал.
    hung('projector', 'primitive', 'projector', 'Проектор', [2.3, -1.9], 0.35, [0.4, 0.18, 0.35], '#2b2b2b'),

    // Красные PAR-прожекторы: два на колоннах, по одному у торцевых стен. Стоят в точках заливок washes.
    hung('par-col-left', 'primitive', 'cylinder', 'PAR-прожектор на левой колонне', [COL_LEFT[0], COLUMN_SOUTH + 0.14], 0.08, PAR_SIZE, IRON),
    hung('par-col-right', 'primitive', 'cylinder', 'PAR-прожектор на правой колонне', [COL_RIGHT[0], COLUMN_SOUTH + 0.14], 0.08, PAR_SIZE, IRON),
    hung('par-left', 'primitive', 'cylinder', 'PAR-прожектор у Red Bar', [-hx + 0.2, 1.5], 0.4, PAR_SIZE, IRON),
    hung('par-right', 'primitive', 'cylinder', 'PAR-прожектор у будки', [hx - 0.4, -1.2], 0.3, PAR_SIZE, IRON),
  ],

  // Стационарные красные прожекторы площадки: включаются атмосферой «Вечеринка».
  washes: [
    { id: 'wash-col-left', position: [COL_LEFT[0], 2.9, COLUMN_SOUTH + 0.05], target: [-3.0, 0, 2.2], color: WASH_RED, intensity: 60, angle: 0.7 },
    { id: 'wash-col-right', position: [COL_RIGHT[0], 2.9, COLUMN_SOUTH + 0.05], target: [3.0, 0, 2.2], color: WASH_RED, intensity: 60, angle: 0.7 },
    { id: 'wash-left', position: [-hx + 0.2, 2.6, 1.5], target: [-6.5, 0, 0.5], color: WASH_RED, intensity: 60, angle: 0.7 },
    { id: 'wash-right', position: [hx - 0.6, 2.7, -1.2], target: [6.2, 0, 0.2], color: WASH_RED, intensity: 60, angle: 0.7 },
  ],

  // У входа, взгляд по диагонали в зал — мимо колонны.
  spawn: { position: [-2.25, 3.1], yaw: -0.55 },
};
