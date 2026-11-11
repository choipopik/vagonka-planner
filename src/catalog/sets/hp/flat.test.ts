import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng } from '../../../model/rng';
import type { Params, Vec3 } from '../../../model/types';
import { checkBuild } from '../../testing';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import * as cloudCeiling from './cloudCeiling';
import * as owlPost from './owlPost';
import { LETTER_GAP, LETTER_H, LETTER_W, owlFrame } from './owlPost';
import { glyphs, rgba, scatter, splitBalanced, thread } from './paper';
import * as prophetWall from './prophetWall';
import { LAYER_STEP, PROPHET_PAGES, prophetGrid } from './prophetWall';
import * as signpost from './signpost';
import { MAX_BOARDS, boardLines } from './signpost';
import * as wizardFrame from './wizardFrame';

// Тесты пакета W6: геометрия пяти плоских и потолочных пресетов «Гарри Поттер» и их painters.
// Painters в Node выполнить нельзя (нет canvas), поэтому они прогоняются на записывающем макете контекста:
// проверяется, что painter не бросает, передаёт canvas только конечные числа и допустимые цвета.

const modules = [cloudCeiling, prophetWall, owlPost, signpost, wizardFrame];
const allPainters: Record<string, Painter> = Object.assign({}, ...modules.map((m) => m.painters));

const EPS = 1e-9;
const DEG = Math.PI / 180;

/** Вход билдера: умолчания записи, поверх — overrides (как это делает buildInput для настоящего объекта). */
function inputOf(item: CatalogItem, overrides: Partial<BuildInput> = {}): BuildInput {
  const params: Params = {};
  for (const def of item.params) params[def.key] = def.default;
  return {
    size: overrides.size ?? item.size,
    color: overrides.color ?? item.color,
    params: { ...params, ...overrides.params },
    mount: overrides.mount ?? item.mounts[0],
  };
}

function build(item: CatalogItem, overrides: Partial<BuildInput> = {}): Part[] {
  if (!item.build) throw new Error(`${item.id}: нет build`);
  return item.build(inputOf(item, overrides));
}

const scaled = (size: Vec3, factor: number): Vec3 => [size[0] * factor, size[1] * factor, size[2] * factor];

/** Число групп «геометрия + материал» (вызовов отрисовки): всё, кроме position / rotation / size / color. */
function drawCalls(parts: readonly Part[]): number {
  const keys = new Set<string>();
  for (const part of parts) {
    const rest: Record<string, unknown> = { ...part };
    delete rest.position;
    delete rest.rotation;
    delete rest.size;
    delete rest.color;
    keys.add(JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]])));
  }
  return keys.size;
}

/** Числовые параметры записи с их крайними значениями. */
function numericExtremes(item: CatalogItem): { key: string; value: number }[] {
  const result: { key: string; value: number }[] = [];
  for (const def of item.params) {
    if (def.type === 'number') result.push({ key: def.key, value: def.min }, { key: def.key, value: def.max });
  }
  return result;
}

function allNumeric(item: CatalogItem, pick: 'min' | 'max'): Params {
  const params: Params = {};
  for (const def of item.params) if (def.type === 'number') params[def.key] = def[pick];
  return params;
}

/** Размеры, на которых проверяется каждая запись: умолчание, minSize / maxSize (или масштаб фигуры) и смешанные. */
const SIZES: Record<string, Vec3[]> = {
  'hp.cloudCeiling': [
    [4, 1.1, 3],
    [1, 0.6, 1],
    [12, 2, 8],
    [1, 2, 8],
    [12, 0.6, 1],
    [1, 0.6, 8],
  ],
  'hp.prophetWall': [
    [1.5, 2.5, 0.06],
    [6, 3, 0.06],
    [0.3, 0.42, 0.06],
    [6, 0.5, 0.06],
    [0.5, 3, 0.06],
    [0.01, 0.01, 0.01],
  ],
  'hp.owlPost': [
    [1.6, 1.5, 1.6],
    [0.8, 0.8, 0.8],
    [1.6, 0.8, 0.8],
    [0.8, 3, 0.8],
    [6, 3, 6],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
  'hp.signpost': [signpost.item.size, scaled(signpost.item.size, 0.25), scaled(signpost.item.size, 3), scaled(signpost.item.size, 0.01)],
  'hp.wizardFrame': [
    wizardFrame.item.size,
    scaled(wizardFrame.item.size, 0.25),
    scaled(wizardFrame.item.size, 3),
    scaled(wizardFrame.item.size, 0.01),
  ],
};

const MAX_PARTS: Record<string, number> = { 'hp.cloudCeiling': 950 };

describe('W6: общие требования к пяти пресетам', () => {
  it('метаданные заглушек сохранены', () => {
    expect(modules.map((m) => m.item.id)).toEqual(['hp.cloudCeiling', 'hp.prophetWall', 'hp.owlPost', 'hp.signpost', 'hp.wizardFrame']);
    for (const { item } of modules) {
      expect(item.kind).toBe('preset');
      expect(item.category).toBe('Гарри Поттер');
      expect(typeof item.build).toBe('function');
    }
    expect(cloudCeiling.item).toMatchObject({ size: [4.0, 1.1, 3.0], minSize: [1, 0.6, 1], maxSize: [12, 2, 8], resize: 'free', mounts: ['ceiling'], hanger: false });
    expect(prophetWall.item).toMatchObject({ size: [1.5, 2.5, 0.06], maxSize: [6, 3, 0.06], resize: 'free', mounts: ['wall'] });
    expect(owlPost.item).toMatchObject({ size: [1.6, 1.5, 1.6], minSize: [0.8, 0.8, 0.8], resize: 'free', mounts: ['ceiling'], hanger: false });
    expect(signpost.item).toMatchObject({ size: [1.0, 1.8, 0.12], resize: 'uniform', mounts: ['floor', 'wall'] });
    expect(wizardFrame.item).toMatchObject({ size: [1.2, 1.9, 0.4], resize: 'uniform', mounts: ['floor'], color: '#cdb58a' });
  });

  it('painters набора W6 (раздел 4.12) на месте, имена — с префиксом hp.', () => {
    expect(Object.keys(allPainters).sort()).toEqual(
      [
        'hp.cloudMatcap',
        'hp.frameBottom',
        'hp.framePlate',
        'hp.frameTop',
        'hp.letterBack',
        'hp.letterFront',
        'hp.owlFlying',
        'hp.parchment',
        'hp.prophetPage',
        'hp.signBoard',
        'hp.signMound',
      ].sort(),
    );
    // Имена не пересекаются между модулями.
    expect(modules.reduce((sum, m) => sum + Object.keys(m.painters).length, 0)).toBe(Object.keys(allPainters).length);
  });

  for (const { item, painters } of modules) {
    const maxParts = MAX_PARTS[item.id];
    describe(item.id, () => {
      it('checkBuild пуст при умолчаниях и на каждом своём креплении', () => {
        expect(checkBuild(item, painters, undefined, maxParts)).toEqual([]);
        for (const mount of item.mounts) expect(checkBuild(item, painters, { mount }, maxParts)).toEqual([]);
      });

      it('checkBuild пуст при minSize / maxSize и крайних значениях каждого числового параметра', () => {
        for (const size of SIZES[item.id]) {
          expect(checkBuild(item, painters, { size }, maxParts)).toEqual([]);
          for (const { key, value } of numericExtremes(item)) {
            expect(checkBuild(item, painters, { size, params: { [key]: value } }, maxParts)).toEqual([]);
          }
          expect(checkBuild(item, painters, { size, params: allNumeric(item, 'min') }, maxParts)).toEqual([]);
          expect(checkBuild(item, painters, { size, params: allNumeric(item, 'max') }, maxParts)).toEqual([]);
        }
      });

      it('детерминизм: равный вход → deep-равный выход; вход не изменяется', () => {
        const input = inputOf(item);
        const snapshot = JSON.stringify(input);
        expect(item.build!(input)).toEqual(item.build!(inputOf(item)));
        expect(JSON.stringify(input)).toBe(snapshot);
      });

      if (item.params.some((def) => def.type === 'seed')) {
        it('другой seed → другой результат; разные seed проходят checkBuild', () => {
          expect(build(item, { params: { seed: 2 } })).not.toEqual(build(item, { params: { seed: 1 } }));
          for (const seed of [0, 2, 3, 17, 123456, -5]) {
            expect(checkBuild(item, painters, { params: { seed } }, maxParts)).toEqual([]);
          }
        });
      }

      it('не падает на чужих параметрах (нечисла, мусор, пустой объект)', () => {
        const junk = { seed: 'x', density: 'много', thickness: null, letters: {}, boards: 42, legs: [], title: 7, lang: 3 } as unknown as Params;
        expect(() => item.build!({ size: item.size, color: 'red', params: junk, mount: item.mounts[0] })).not.toThrow();
        expect(() => item.build!({ size: item.size, color: item.color, params: {}, mount: item.mounts[0] })).not.toThrow();
        expect(checkBuild(item, painters, { params: junk }, maxParts)).toEqual([]);
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------

describe('hp.cloudCeiling', () => {
  const { item } = cloudCeiling;
  const clouds = (parts: Part[]) => parts.filter((p) => p.shape === 'sphere' && p.look === 'matcap');
  const candles = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder' && p.size[0] === 0.022);
  const flames = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder' && p.taper === 0 && p.look === 'glow');
  const halos = (parts: Part[]) => parts.filter((p) => p.additive === true);
  const brims = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder' && p.size[0] === 0.42);
  const crowns = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder' && p.taper === 0 && p.look !== 'glow');
  const threads = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder' && p.size[0] === 0.002);
  /** Зажатая толщина по рецепту. */
  const thicknessOf = (h: number, thickness: number) => Math.min(thickness, h - 0.3);

  it('умолчания: 144 облака, 30 свечей, 2 шляпы; ≈ 7 вызовов отрисовки', () => {
    const parts = build(item);
    expect(clouds(parts)).toHaveLength(144);
    expect(candles(parts)).toHaveLength(30);
    expect(flames(parts)).toHaveLength(30);
    expect(halos(parts)).toHaveLength(30);
    expect(brims(parts)).toHaveLength(2);
    expect(crowns(parts)).toHaveLength(2);
    expect(threads(parts)).toHaveLength(32);
    expect(parts).toHaveLength(144 + 30 * 4 + 2 * 3);
    expect(drawCalls(parts)).toBeLessThanOrEqual(7);
  });

  it('параметры-счётчики меняют число частей: плотность, свечи, шляпы', () => {
    expect(clouds(build(item, { params: { density: 6 } }))).toHaveLength(72);
    expect(clouds(build(item, { params: { density: 20 } }))).toHaveLength(240);
    expect(candles(build(item, { params: { candles: 0 } }))).toHaveLength(0);
    expect(halos(build(item, { params: { candles: 0 } }))).toHaveLength(0);
    expect(candles(build(item, { params: { candles: 6 } }))).toHaveLength(72);
    for (const hats of [0, 1, 5, 8]) {
      expect(brims(build(item, { params: { hats } }))).toHaveLength(hats);
      expect(crowns(build(item, { params: { hats } }))).toHaveLength(hats);
    }
  });

  it('площадной предмет: элементы держат размер, число растёт с площадью', () => {
    const small = build(item, { size: [2, 1.1, 1.5] });
    const large = build(item, { size: [8, 1.1, 6] });
    expect(candles(small)).toHaveLength(8);
    expect(candles(large)).toHaveLength(120);
    expect(clouds(small)).toHaveLength(36);
    expect(clouds(large)).toHaveLength(400);
    for (const parts of [small, large]) {
      for (const candle of candles(parts)) {
        expect(candle.size[0]).toBe(0.022);
        expect(candle.size[2]).toBe(0.022);
        expect(candle.size[1]).toBeGreaterThanOrEqual(0.14 - EPS);
        expect(candle.size[1]).toBeLessThanOrEqual(0.22 + EPS);
      }
      for (const flame of flames(parts)) expect(flame.size).toEqual([0.016, 0.035, 0.016]);
      for (const halo of halos(parts)) expect(halo.size).toEqual([0.07, 0.07, 0.07]);
      for (const brim of brims(parts)) expect(brim.size).toEqual([0.42, 0.012, 0.42]);
      for (const crown of crowns(parts)) expect(crown.size).toEqual([0.22, 0.4, 0.22]);
    }
  });

  it('пределы при максимальных параметрах и размере: облаков ≤ 400, свечей ≤ 120, частей ≤ 950', () => {
    const parts = build(item, { size: [12, 2, 8], params: { density: 20, candles: 6, hats: 8, thickness: 0.6 } });
    expect(clouds(parts)).toHaveLength(400);
    expect(candles(parts)).toHaveLength(120);
    expect(brims(parts)).toHaveLength(8);
    expect(parts.length).toBeLessThanOrEqual(950);
    expect(checkBuild(item, cloudCeiling.painters, { size: [12, 2, 8], params: { density: 20, candles: 6, hats: 8 } }, 950)).toEqual([]);
  });

  it('ни одна свеча не ниже y = 0 — в том числе при h = 0.6 и thickness = 0.6', () => {
    const cases: { size: Vec3; thickness: number }[] = [
      { size: [4, 1.1, 3], thickness: 0.35 },
      { size: [4, 0.6, 3], thickness: 0.6 },
      { size: [1, 0.6, 1], thickness: 0.6 },
      { size: [12, 0.6, 8], thickness: 0.6 },
      { size: [4, 0.6, 3], thickness: 0.2 },
      { size: [4, 2, 3], thickness: 0.6 },
    ];
    for (const { size, thickness } of cases) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const parts = build(item, { size, params: { thickness, candles: 6, seed } });
        const bodies = candles(parts);
        expect(bodies.length).toBeGreaterThan(0);
        const under = size[1] - thicknessOf(size[1], thickness);
        for (const body of bodies) {
          // Низ свечи — не ниже 2 см от низа габарита, верх — под облаками.
          expect(body.position[1] - body.size[1] / 2).toBeGreaterThanOrEqual(0.02 - EPS);
          expect(body.position[1] + body.size[1] / 2).toBeLessThanOrEqual(under - 0.05 + EPS);
          expect(body.size[1]).toBeGreaterThanOrEqual(0.05 - EPS);
        }
        // И вообще ни одна часть (кроме аддитивных ореолов) не опускается ниже y = 0.
        for (const part of parts) {
          if (part.additive) continue;
          expect(part.position[1] - part.size[1] / 2).toBeGreaterThanOrEqual(-EPS);
        }
      }
    }
  });

  it('при h = 0.6 и thickness = 0.6 толщина зажата до 0.3: под облаками остаётся 0.3 м', () => {
    const boxes = item.pickBoxes!(inputOf(item, { size: [4, 0.6, 3], params: { thickness: 0.6 } }));
    expect(boxes[0].size[1]).toBeCloseTo(0.3, 9);
    expect(boxes[0].center[1]).toBeCloseTo(0.45, 9);
  });

  it('пламя стоит на свече, ореол — на пламени, нить идёт от пламени до середины облаков', () => {
    const size: Vec3 = [4, 1.1, 3];
    const parts = build(item);
    const bodies = candles(parts);
    const fires = flames(parts);
    const glows = halos(parts);
    const lines = threads(parts);
    const middle = size[1] - 0.35 / 2;
    bodies.forEach((body, index) => {
      const top = body.position[1] + body.size[1] / 2;
      expect(fires[index].position[0]).toBe(body.position[0]);
      expect(fires[index].position[2]).toBe(body.position[2]);
      expect(fires[index].position[1] - 0.0175).toBeCloseTo(top, 9);
      expect(glows[index].position).toEqual(fires[index].position);
      expect(lines[index].position[0]).toBe(body.position[0]);
      expect(lines[index].position[1] - lines[index].size[1] / 2).toBeCloseTo(top + 0.035, 9);
      expect(lines[index].position[1] + lines[index].size[1] / 2).toBeCloseTo(middle, 9);
    });
    // Свечи — каждая на своей высоте.
    expect(new Set(bodies.map((body) => body.position[1].toFixed(4))).size).toBeGreaterThan(bodies.length / 2);
  });

  it('облака: сфера целиком внутри прямоугольника и ниже потолка, matcap с цветом свечения', () => {
    for (const size of SIZES['hp.cloudCeiling']) {
      for (const thickness of [0.2, 0.35, 0.6]) {
        const [w, h, d] = size;
        for (const cloud of clouds(build(item, { size, params: { thickness, glowColor: '#ff0000', glow: 2 } }))) {
          expect(Math.abs(cloud.position[0]) + cloud.size[0] / 2).toBeLessThanOrEqual(w / 2 + EPS);
          expect(Math.abs(cloud.position[2]) + cloud.size[2] / 2).toBeLessThanOrEqual(d / 2 + EPS);
          expect(cloud.position[1] + cloud.size[1] / 2).toBeLessThanOrEqual(h + EPS);
          expect(cloud.position[1] - cloud.size[1] / 2).toBeGreaterThanOrEqual(-EPS);
          expect(cloud.size[0]).toBeCloseTo(cloud.size[2], 12);
          expect(cloud.size[1] / cloud.size[0]).toBeCloseTo(1.4 / 2.5, 9);
          expect(cloud.paint).toEqual({ painter: 'hp.cloudMatcap', args: { color: '#ff0000', glow: 2 }, px: [128, 128] });
          expect(cloud.color).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('облака окрашены неровно («лужи света»)', () => {
    const colors = new Set(clouds(build(item)).map((cloud) => cloud.color));
    expect(colors.size).toBeGreaterThan(10);
  });

  it('шляпы: центр не ближе 0.25 м к краю, наклон ≤ 12°, низ не ниже 0.02, нить до облаков', () => {
    for (const size of [[4, 1.1, 3], [1, 0.6, 1], [12, 2, 8], [1, 2, 1]] as Vec3[]) {
      for (const seed of [1, 2, 3]) {
        const [w, h, d] = size;
        const parts = build(item, { size, params: { hats: 8, seed } });
        const fields = brims(parts);
        expect(fields).toHaveLength(8);
        for (const brim of fields) {
          const [rx, ry, rz] = brim.rotation ?? [0, 0, 0];
          expect(ry).toBe(0);
          const tilt = Math.acos(Math.cos(rx) * Math.cos(rz));
          expect(tilt).toBeLessThanOrEqual(12 * DEG + 1e-6);
          expect(Math.abs(brim.position[0])).toBeLessThanOrEqual(w / 2 - 0.25 + 0.01);
          expect(Math.abs(brim.position[2])).toBeLessThanOrEqual(d / 2 - 0.25 + 0.01);
          // Низшая точка наклонённых полей.
          expect(brim.position[1] - 0.21 * Math.sin(tilt) - 0.006).toBeGreaterThanOrEqual(0.02 - 1e-6);
          expect(brim.position[1]).toBeLessThan(h);
        }
        // Нитей — по одной на свечу и на шляпу.
        expect(threads(parts)).toHaveLength(candles(parts).length + 8);
      }
    }
  });

  it('pickBoxes = плита облаков + по боксу 0.42³ на шляпу', () => {
    for (const hats of [0, 2, 8]) {
      for (const size of [[4, 1.1, 3], [1, 0.6, 1], [12, 2, 8]] as Vec3[]) {
        const input = inputOf(item, { size, params: { hats, thickness: 0.6 } });
        const boxes = item.pickBoxes!(input);
        const T = thicknessOf(size[1], 0.6);
        expect(boxes).toHaveLength(1 + hats);
        expect(boxes[0].center[0]).toBe(0);
        expect(boxes[0].center[2]).toBe(0);
        expect(boxes[0].center[1]).toBeCloseTo(size[1] - T / 2, 9);
        expect(boxes[0].size[0]).toBe(size[0]);
        expect(boxes[0].size[1]).toBeCloseTo(T, 9);
        expect(boxes[0].size[2]).toBe(size[2]);
        const fields = brims(item.build!(input));
        expect(fields).toHaveLength(hats);
        boxes.slice(1).forEach((box, index) => {
          expect(box.size).toEqual([0.42, 0.42, 0.42]);
          // Бокс стоит на шляпе: её поля — внутри бокса.
          for (let axis = 0; axis < 3; axis++) {
            expect(Math.abs(fields[index].position[axis] - box.center[axis])).toBeLessThanOrEqual(0.21 + 1e-6);
          }
        });
      }
    }
    // Плита и шляпы детерминированы.
    expect(item.pickBoxes!(inputOf(item))).toEqual(item.pickBoxes!(inputOf(item)));
  });

  it('смена числа шляп или свечей не перемешивает облака', () => {
    const base = clouds(build(item));
    expect(clouds(build(item, { params: { hats: 7 } }))).toEqual(base);
    expect(clouds(build(item, { params: { candles: 5 } }))).toEqual(base);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('hp.prophetWall', () => {
  const { item } = prophetWall;

  /** Полуразмеры листа с креном. */
  function halfExtents(sheet: Part): [number, number] {
    const roll = sheet.rotation?.[2] ?? 0;
    const cos = Math.abs(Math.cos(roll));
    const sin = Math.abs(Math.sin(roll));
    return [(sheet.size[0] * cos + sheet.size[1] * sin) / 2, (sheet.size[0] * sin + sheet.size[1] * cos) / 2];
  }

  const CASES: Partial<BuildInput>[] = [
    {},
    { params: { density: 30 } },
    { params: { density: 6 } },
    { params: { tilt: 35 } },
    { params: { tilt: 0 } },
    { params: { sheetScale: 0.7 } },
    { params: { sheetScale: 1.4 } },
    { params: { density: 30, tilt: 35, sheetScale: 0.7 } },
    { params: { density: 30, tilt: 35, sheetScale: 1.4 } },
    { size: [6, 3, 0.06] },
    { size: [6, 3, 0.06], params: { density: 30, tilt: 35, sheetScale: 0.7 } },
    { size: [6, 3, 0.06], params: { density: 30, tilt: 35, sheetScale: 1.4 } },
    { size: [0.5, 3, 0.06], params: { density: 30, tilt: 35 } },
    { size: [6, 0.5, 0.06], params: { density: 30, tilt: 35 } },
    { size: [0.3, 0.42, 0.06] },
  ];

  it('умолчания: 60 листов A3, 8 вариантов → 8 вызовов отрисовки', () => {
    const parts = build(item);
    expect(parts).toHaveLength(60);
    for (const sheet of parts) {
      expect(sheet.shape).toBe('plane');
      expect(sheet.size[0]).toBeCloseTo(0.3, 12);
      expect(sheet.size[1]).toBeCloseTo(0.42, 12);
      expect(sheet.size[2]).toBe(0);
      expect(sheet.roughness).toBe(0.9);
      expect(sheet.paint?.painter).toBe('hp.prophetPage');
      expect(sheet.paint?.px).toEqual([384, 544]);
      expect(sheet.paint?.args?.lang).toBe('ru');
    }
    const variants = new Set(parts.map((sheet) => sheet.paint?.args?.variant));
    expect([...variants].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(drawCalls(parts)).toBe(8);
    expect(PROPHET_PAGES).toHaveLength(8);
  });

  it('число листов = min(160, round(density · w · h)); размер листа от площади не зависит', () => {
    expect(build(item, { params: { density: 6 } })).toHaveLength(23);
    expect(build(item, { params: { density: 30 } })).toHaveLength(113);
    const large = build(item, { size: [3, 2.5, 0.06] });
    expect(large).toHaveLength(120);
    for (const sheet of large) {
      expect(sheet.size[0]).toBeCloseTo(0.3, 12);
      expect(sheet.size[1]).toBeCloseTo(0.42, 12);
    }
    expect(build(item, { size: [6, 3, 0.06] })).toHaveLength(160);
    expect(build(item, { size: [6, 3, 0.06], params: { density: 30 } })).toHaveLength(160);
    // sheetScale меняет размер листа.
    for (const sheet of build(item, { params: { sheetScale: 1.4 } })) {
      expect(sheet.size[0]).toBeCloseTo(0.42, 12);
      expect(sheet.size[1]).toBeCloseTo(0.588, 12);
    }
  });

  it('листы: только крен (нет поворотов вокруг X и Y), крен не больше tilt', () => {
    for (const overrides of CASES) {
      const tilt = Number(inputOf(item, overrides).params.tilt) * DEG;
      for (const sheet of build(item, overrides)) {
        const [rx, ry, rz] = sheet.rotation ?? [0, 0, 0];
        expect(rx).toBe(0);
        expect(ry).toBe(0);
        expect(Math.abs(rz)).toBeLessThanOrEqual(tilt + EPS);
      }
    }
    for (const sheet of build(item, { params: { tilt: 0 } })) expect(Math.abs(sheet.rotation?.[2] ?? 0)).toBe(0);
    // При умолчаниях крен действительно разный.
    expect(new Set(build(item).map((sheet) => sheet.rotation?.[2])).size).toBeGreaterThan(30);
  });

  it('z принимает не более 25 значений с шагом 1 мм; стопка помещается в глубину 0.06', () => {
    for (const overrides of CASES) {
      const input = inputOf(item, overrides);
      const parts = item.build!(input);
      const d = input.size[2];
      const levels = new Set<number>();
      for (const sheet of parts) {
        const layer = (sheet.position[2] - (-d / 2 + 0.004)) / LAYER_STEP;
        expect(Math.abs(layer - Math.round(layer))).toBeLessThan(1e-6);
        expect(Math.round(layer)).toBeGreaterThanOrEqual(0);
        expect(Math.round(layer)).toBeLessThanOrEqual(24);
        levels.add(Math.round(layer));
        expect(sheet.position[2]).toBeLessThanOrEqual(d / 2);
      }
      expect(levels.size).toBeLessThanOrEqual(25);
    }
    // На большой стене заняты все 25 слоёв.
    const layers = new Set(build(item, { size: [6, 3, 0.06] }).map((sheet) => Math.round((sheet.position[2] + 0.026) / LAYER_STEP)));
    expect(layers.size).toBe(25);
  });

  it('любые два листа с одинаковым z разнесены не меньше чем на 4 ячейки сетки и не перекрываются', () => {
    for (const overrides of CASES) {
      for (const seed of [1, 2, 3, 4]) {
        const input = inputOf(item, { ...overrides, params: { ...overrides.params, seed } });
        const grid = prophetGrid(input);
        const parts = item.build!(input);
        expect(parts).toHaveLength(grid.count);
        const byLayer = new Map<number, Part[]>();
        for (const sheet of parts) {
          const key = Math.round(sheet.position[2] / LAYER_STEP);
          byLayer.set(key, [...(byLayer.get(key) ?? []), sheet]);
        }
        for (const sheets of byLayer.values()) {
          for (let i = 0; i < sheets.length; i++) {
            for (let j = i + 1; j < sheets.length; j++) {
              const dx = Math.abs(sheets[i].position[0] - sheets[j].position[0]);
              const dy = Math.abs(sheets[i].position[1] - sheets[j].position[1]);
              const cellsX = grid.pitchX > 0 ? dx / grid.pitchX : 0;
              const cellsY = grid.pitchY > 0 ? dy / grid.pitchY : 0;
              expect(Math.max(cellsX, cellsY)).toBeGreaterThanOrEqual(4);
              // Габариты наклонённых листов одного слоя не пересекаются: z-файтинга нет.
              const a = halfExtents(sheets[i]);
              const b = halfExtents(sheets[j]);
              expect(dx >= a[0] + b[0] || dy >= a[1] + b[1]).toBe(true);
            }
          }
        }
      }
    }
  });

  it('листы выступают за прямоугольник не более чем на 10 %', () => {
    for (const overrides of CASES) {
      const input = inputOf(item, overrides);
      const [w, h] = input.size;
      for (const sheet of item.build!(input)) {
        const [halfX, halfY] = halfExtents(sheet);
        expect(Math.abs(sheet.position[0]) + halfX).toBeLessThanOrEqual(w / 2 + 0.1 * w + EPS);
        expect(Math.abs(sheet.position[1] - h / 2) + halfY).toBeLessThanOrEqual(h / 2 + 0.1 * h + EPS);
      }
    }
  });

  it('язык попадает в аргументы painter’а; неизвестный → ru', () => {
    expect(new Set(build(item, { params: { lang: 'en' } }).map((sheet) => sheet.paint?.args?.lang))).toEqual(new Set(['en']));
    expect(new Set(build(item, { params: { lang: 'de' } }).map((sheet) => sheet.paint?.args?.lang))).toEqual(new Set(['ru']));
  });

  it('prophetGrid: соседи по сетке получают разные варианты (round-robin со сдвигом)', () => {
    // variant = perm[(col + 3·row) mod 8]: у восьми соседей узла индекс всегда другой.
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        expect((((dc + 3 * dr) % 8) + 8) % 8).not.toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('hp.owlPost', () => {
  const { item } = owlPost;
  const fronts = (parts: Part[]) => parts.filter((p) => p.paint?.painter === 'hp.letterFront');
  const backs = (parts: Part[]) => parts.filter((p) => p.paint?.painter === 'hp.letterBack');
  const threads = (parts: Part[]) => parts.filter((p) => p.shape === 'cylinder');
  const owl = (parts: Part[]) => parts.filter((p) => p.paint?.painter === 'hp.owlFlying');
  /** Нормаль плоскости (образ локальной оси Z) для Эйлера XYZ. */
  const normal = (rotation: Vec3): Vec3 => [
    Math.sin(rotation[1]),
    -Math.sin(rotation[0]) * Math.cos(rotation[1]),
    Math.cos(rotation[0]) * Math.cos(rotation[1]),
  ];
  /** Образ локальной оси Y. */
  const up = (rotation: Vec3): Vec3 => {
    const [x, y, z] = rotation;
    return [
      -Math.cos(y) * Math.sin(z),
      Math.cos(x) * Math.cos(z) - Math.sin(x) * Math.sin(y) * Math.sin(z),
      Math.sin(x) * Math.cos(z) + Math.cos(x) * Math.sin(y) * Math.sin(z),
    ];
  };

  it('умолчания: сова-вырезка, две сферы объёма, 25 писем по две плоскости, 27 нитей; ≤ 6 вызовов отрисовки', () => {
    const parts = build(item);
    expect(owl(parts)).toHaveLength(1);
    expect(owl(parts)[0]).toMatchObject({ shape: 'plane', doubleSided: true, cutout: true, paint: { painter: 'hp.owlFlying', px: [1024, 512] } });
    expect(parts.filter((p) => p.shape === 'sphere')).toHaveLength(2);
    expect(fronts(parts)).toHaveLength(25);
    expect(backs(parts)).toHaveLength(25);
    expect(threads(parts)).toHaveLength(27);
    expect(parts).toHaveLength(3 + 25 * 3 + 2);
    expect(drawCalls(parts)).toBeLessThanOrEqual(6);
  });

  it('параметр «Письма» меняет число частей', () => {
    for (const letters of [5, 12, 25]) {
      const parts = build(item, { params: { letters } });
      expect(fronts(parts)).toHaveLength(letters);
      expect(backs(parts)).toHaveLength(letters);
      expect(threads(parts)).toHaveLength(letters + 2);
    }
    // Больше, чем помещается при расстоянии 18 см: площадь заполняется, сколько войдёт (но больше, чем при 25).
    const crowded = build(item, { params: { letters: 40 } });
    expect(fronts(crowded).length).toBeGreaterThan(25);
    expect(fronts(crowded).length).toBeLessThanOrEqual(40);
    expect(backs(crowded)).toHaveLength(fronts(crowded).length);
    expect(threads(crowded)).toHaveLength(fronts(crowded).length + 2);
  });

  it('площадной предмет: письмо держит размер 22 × 15 см, число писем растёт с площадью (не больше 60)', () => {
    const small = build(item, { size: [0.8, 0.8, 0.8], params: { letters: 60 } });
    const normal60 = build(item, { params: { letters: 60 } });
    const large = build(item, { size: [4, 2, 4], params: { letters: 60 } });
    expect(fronts(small).length).toBeGreaterThan(0);
    expect(fronts(small).length).toBeLessThan(fronts(normal60).length);
    expect(fronts(normal60).length).toBeLessThanOrEqual(60);
    expect(fronts(large)).toHaveLength(60);
    for (const parts of [small, normal60, large]) {
      for (const letter of [...fronts(parts), ...backs(parts)]) {
        expect(letter.size).toEqual([LETTER_W, LETTER_H, 0]);
        expect(letter.paint?.px).toEqual([256, 176]);
      }
      // Выбор мышью — по частям: их не больше 200.
      expect(parts.filter((p) => !p.additive).length).toBeLessThanOrEqual(200);
    }
  });

  it('письма: мин. расстояние 0.18 м, центр в [0.1, h − 0.25], крен ±25°, тангаж ±15°, край не ниже пола габарита', () => {
    const cases: Partial<BuildInput>[] = [{}, { params: { letters: 60 } }, { size: [0.8, 0.8, 0.8], params: { letters: 60 } }, { size: [6, 3, 6], params: { letters: 60, seed: 5 } }];
    for (const overrides of cases) {
      const input = inputOf(item, overrides);
      const [w, h, d] = input.size;
      const letters = fronts(item.build!(input));
      for (let i = 0; i < letters.length; i++) {
        const [x, y, z] = letters[i].position;
        const [pitch, , roll] = letters[i].rotation ?? [0, 0, 0];
        expect(Math.abs(x)).toBeLessThanOrEqual(w / 2 - 0.11 + 1e-3);
        expect(Math.abs(z)).toBeLessThanOrEqual(d / 2 - 0.11 + 1e-3);
        expect(y).toBeGreaterThanOrEqual(0.1 - 1e-3);
        expect(y).toBeLessThanOrEqual(h - 0.25 + 1e-3);
        expect(Math.abs(roll)).toBeLessThanOrEqual(25 * DEG + EPS);
        expect(Math.abs(pitch)).toBeLessThanOrEqual(15 * DEG + EPS);
        // Низ наклонённого письма — не ниже y = 0.
        const u = up(letters[i].rotation ?? [0, 0, 0]);
        const [rx, ry, rz] = letters[i].rotation ?? [0, 0, 0];
        const rightY = Math.cos(rx) * Math.sin(rz) + Math.sin(rx) * Math.sin(ry) * Math.cos(rz);
        expect(y - (Math.abs(rightY) * LETTER_W + Math.abs(u[1]) * LETTER_H) / 2).toBeGreaterThanOrEqual(0);
        for (let j = i + 1; j < letters.length; j++) {
          const distance = Math.hypot(x - letters[j].position[0], z - letters[j].position[2]);
          expect(distance).toBeGreaterThanOrEqual(LETTER_GAP - 2e-3);
        }
      }
      // Рыскание — любое.
      if (letters.length >= 20) {
        const yaws = letters.map((letter) => letter.rotation?.[1] ?? 0);
        expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(Math.PI);
      }
    }
  });

  it('оборот письма — та же плоскость спиной к лицевой; нить — от середины верхнего края до потолка', () => {
    const input = inputOf(item);
    const h = input.size[1];
    const parts = item.build!(input);
    const faces = fronts(parts);
    const reverse = backs(parts);
    const lines = threads(parts);
    faces.forEach((face, index) => {
      const back = reverse[index];
      const n = normal(face.rotation ?? [0, 0, 0]);
      const m = normal(back.rotation ?? [0, 0, 0]);
      expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeCloseTo(-1, 9);
      // Верх у обеих сторон один.
      const u = up(face.rotation ?? [0, 0, 0]);
      const v = up(back.rotation ?? [0, 0, 0]);
      for (let axis = 0; axis < 3; axis++) {
        expect(v[axis]).toBeCloseTo(u[axis], 9);
        // Стороны разнесены на миллиметр вдоль нормали, центр — общий.
        expect(face.position[axis] - back.position[axis]).toBeCloseTo(0.001 * n[axis], 9);
      }
      const centre = face.position.map((value, axis) => (value + back.position[axis]) / 2);
      const line = lines[index];
      expect(line.size[0]).toBe(0.002);
      expect(line.position[0]).toBeCloseTo(centre[0] + (u[0] * LETTER_H) / 2, 9);
      expect(line.position[2]).toBeCloseTo(centre[2] + (u[2] * LETTER_H) / 2, 9);
      expect(line.position[1] - line.size[1] / 2).toBeCloseTo(centre[1] + (u[1] * LETTER_H) / 2, 9);
      expect(line.position[1] + line.size[1] / 2).toBeCloseTo(h, 9);
    });
  });

  it('сова: W = min(wingspan, w), D зажат под габарит, лист целиком ниже потолка; две нити к крыльям', () => {
    const cases: { size: Vec3; wingspan: number; owlDrop: number; W: number; D: number }[] = [
      { size: [1.6, 1.5, 1.6], wingspan: 1.2, owlDrop: 0.25, W: 1.2, D: 0.25 },
      { size: [0.8, 0.8, 0.8], wingspan: 1.2, owlDrop: 0.25, W: 0.8, D: 0.25 },
      { size: [0.8, 0.8, 0.8], wingspan: 1.6, owlDrop: 0.6, W: 0.8, D: 0.35 },
      { size: [1.6, 1.5, 1.6], wingspan: 1.6, owlDrop: 0.6, W: 1.6, D: 0.6 },
      { size: [1.6, 1.5, 1.6], wingspan: 0.8, owlDrop: 0.1, W: 0.8, D: 0.1 },
      // Низкий широкий габарит: лист 0.5·W обязан поместиться по высоте с запасом 5 см.
      { size: [1.6, 0.8, 0.8], wingspan: 1.6, owlDrop: 0.6, W: 1.5, D: 0 },
    ];
    for (const { size, wingspan, owlDrop, W, D } of cases) {
      const input = inputOf(item, { size, params: { wingspan, owlDrop } });
      const frame = owlFrame(input);
      expect(frame.W).toBeCloseTo(W, 9);
      expect(frame.D).toBeCloseTo(D, 9);
      const parts = item.build!(input);
      const sheet = owl(parts)[0];
      expect(sheet.size[0]).toBeCloseTo(W, 9);
      expect(sheet.size[1]).toBeCloseTo(0.5 * W, 9);
      expect(sheet.rotation).toEqual([15 * DEG, 0, 0]);
      expect(sheet.position[1]).toBeCloseTo(size[1] - D - 0.25 * W, 9);
      const half = 0.25 * W * Math.cos(15 * DEG);
      expect(sheet.position[1] + half).toBeLessThanOrEqual(size[1] + EPS);
      expect(sheet.position[1] - half).toBeGreaterThanOrEqual(0.05 - EPS);
      // Сферы объёма — позади листа и внутри его высоты.
      for (const sphere of parts.filter((p) => p.shape === 'sphere')) {
        expect(sphere.position[2]).toBeLessThan(0);
        expect(sphere.position[1] + sphere.size[1] / 2).toBeLessThanOrEqual(size[1] + EPS);
        expect(Math.abs(sphere.position[1] - sheet.position[1])).toBeLessThan(half);
      }
      const letters = fronts(parts).length;
      const owlThreads = threads(parts).slice(letters);
      // При нулевом опуске нити к сове короче 5 мм и не создаются.
      expect(owlThreads.length === 2 || (D < 0.02 && owlThreads.length === 0)).toBe(true);
      for (const line of owlThreads) {
        expect(Math.abs(line.position[0])).toBeCloseTo(0.27 * W, 9);
        expect(line.position[1] + line.size[1] / 2).toBeCloseTo(size[1], 9);
      }
    }
  });

  it('нить письма не проходит сквозь сову; письмо рядом с совой висит ниже неё', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const input = inputOf(item, { params: { letters: 60, seed } });
      const frame = owlFrame(input);
      const halfZ = 0.25 * frame.W * Math.sin(15 * DEG);
      for (const letter of fronts(item.build!(input))) {
        const [x, y, z] = letter.position;
        const overWings = Math.abs(x) <= frame.W / 2 && Math.abs(z) <= halfZ + 0.014;
        expect(overWings).toBe(false);
        if (Math.abs(x) <= frame.W / 2 + 0.1 && Math.abs(z) <= halfZ + 0.1) expect(y).toBeLessThan(frame.bottomY);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('hp.signpost', () => {
  const { item } = signpost;
  const boards = (parts: Part[]) => parts.filter((p) => p.paint?.painter === 'hp.signBoard');
  const fronts = (parts: Part[]) => boards(parts).filter((p) => p.paint?.args?.text !== '');
  const backs = (parts: Part[]) => boards(parts).filter((p) => p.paint?.args?.text === '');
  const DEFAULT_LINES = ['Хогвартс', 'Косой переулок', 'Хогсмид', 'Гринготтс', 'Азкабан', 'Министерство магии', 'Платформа 9¾', 'Хижина Хагрида'];

  it('boardLines: непустые строки, без лишних пробелов, не больше десяти, не длиннее 40 глифов', () => {
    expect(boardLines('Хогвартс\n\n  Косой   переулок \r\n\t\nХогсмид')).toEqual(['Хогвартс', 'Косой переулок', 'Хогсмид']);
    expect(boardLines('')).toEqual([]);
    expect(boardLines(' \n \n')).toEqual([]);
    expect(boardLines(42)).toEqual([]);
    expect(boardLines(undefined)).toEqual([]);
    expect(boardLines(Array.from({ length: 30 }, (_, index) => `Строка ${index}`).join('\n'))).toHaveLength(MAX_BOARDS);
    expect(glyphs(boardLines('я'.repeat(500))[0])).toHaveLength(40);
    expect(boardLines(String(item.params.find((def) => def.key === 'boards')?.default))).toEqual(DEFAULT_LINES);
  });

  it('по доске на строку текста: умолчание — 8 табличек с изнанками, столб и холм', () => {
    const parts = build(item);
    expect(parts).toHaveLength(2 + 8 * 2);
    expect(parts[0]).toMatchObject({ shape: 'box', color: '#141414' });
    expect(parts[1]).toMatchObject({ shape: 'plane', cutout: true, doubleSided: true, paint: { painter: 'hp.signMound' } });
    expect(fronts(parts).map((board) => board.paint?.args?.text)).toEqual(DEFAULT_LINES);
    expect(backs(parts)).toHaveLength(8);
    // 8 лицевых текстур + 2 изнанки (по направлению) + столб + холм.
    expect(drawCalls(parts)).toBeLessThanOrEqual(12);
  });

  it('число табличек = число непустых строк (не больше 10)', () => {
    const cases: [string, number][] = [
      ['', 0],
      ['Хогвартс', 1],
      ['Хогвартс\nХогсмид', 2],
      ['Хогвартс\n\n\nХогсмид\n   \nАзкабан\n', 3],
      [Array.from({ length: 10 }, (_, index) => `Табличка ${index}`).join('\n'), 10],
      [Array.from({ length: 25 }, (_, index) => `Табличка ${index}`).join('\n'), 10],
    ];
    for (const [text, count] of cases) {
      const parts = build(item, { params: { boards: text } });
      expect(fronts(parts)).toHaveLength(count);
      expect(backs(parts)).toHaveLength(count);
      expect(parts).toHaveLength(2 + 2 * count);
      expect(checkBuild(item, signpost.painters, { params: { boards: text } })).toEqual([]);
      expect(checkBuild(item, signpost.painters, { params: { boards: text }, mount: 'wall' })).toEqual([]);
    }
  });

  it('таблички: сверху вниз по порядку строк, от 0.95h до 0.30h, нижняя крупнее, крен ±6°, в габарите', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const [w, h] = item.size;
      const k = h / 1.8;
      const list = fronts(build(item, { params: { seed } }));
      list.forEach((board, index) => {
        const [rx, ry, rz] = board.rotation ?? [0, 0, 0];
        expect(rx).toBe(0);
        expect(ry).toBe(0);
        expect(Math.abs(rz)).toBeLessThanOrEqual(6 * DEG + EPS);
        expect(board.size[1]).toBeCloseTo(index === list.length - 1 ? 0.2 * k : 0.15 * k, 9);
        expect(board.size[0]).toBeGreaterThanOrEqual(0.4 * k - EPS);
        expect(board.size[0]).toBeLessThanOrEqual(w + EPS);
        if (index > 0) expect(board.position[1]).toBeLessThan(list[index - 1].position[1]);
        const halfX = (board.size[0] * Math.cos(rz) + board.size[1] * Math.abs(Math.sin(rz))) / 2;
        const halfY = (board.size[0] * Math.abs(Math.sin(rz)) + board.size[1] * Math.cos(rz)) / 2;
        expect(Math.abs(board.position[0]) + halfX).toBeLessThanOrEqual(w / 2 + EPS);
        expect(board.position[1] + halfY).toBeLessThanOrEqual(h + EPS);
        expect(board.position[1] - halfY).toBeGreaterThanOrEqual(0);
        expect(board.cutout).toBe(true);
        expect(board.paint?.px).toEqual([512, 128]);
      });
      expect(list[list.length - 1].position[1]).toBeCloseTo(0.3 * h, 9);
      expect(list[0].position[1]).toBeGreaterThan(0.85 * h);
      // Длинная надпись — табличка шире.
      expect(list[5].size[0]).toBeGreaterThan(list[4].size[0]);
      // Стрелки смотрят в обе стороны.
      expect(new Set(list.map((board) => board.paint?.args?.dir))).toEqual(new Set([1, -1]));
    }
  });

  it('изнанка: та же табличка, развёрнутая вокруг Y, без текста, с зеркальным силуэтом, по другую сторону столба', () => {
    const parts = build(item);
    const list = fronts(parts);
    const reverse = backs(parts);
    const post = parts[0];
    list.forEach((board, index) => {
      const back = reverse[index];
      expect(back.size).toEqual(board.size);
      expect(back.position[0]).toBe(board.position[0]);
      expect(back.position[1]).toBe(board.position[1]);
      expect(back.position[2]).toBe(-board.position[2]);
      expect(back.rotation).toEqual([0, Math.PI, -(board.rotation?.[2] ?? 0)]);
      expect(back.paint?.args?.dir).toBe(-Number(board.paint?.args?.dir));
      expect(back.paint?.args?.boardColor).toBe(board.paint?.args?.boardColor);
      // Таблички — перед столбом и за ним, не в его толще.
      expect(board.position[2]).toBeGreaterThan(post.size[2] / 2);
      // Соседние таблички — на разных слоях глубины.
      if (index > 0) expect(board.position[2]).not.toBe(list[index - 1].position[2]);
    });
  });

  it('цвета табличек и текста попадают в аргументы painter’а; цвет объекта красит столб и холм', () => {
    const parts = build(item, { color: '#223344', params: { boardColor: '#101820', textColor: '#ffee88' } });
    expect(parts[0].color).toBe('#223344');
    expect(parts[1].color).toBe('#223344');
    for (const board of boards(parts)) {
      expect(board.color).toBe('#ffffff');
      expect(board.paint?.args?.boardColor).toBe('#101820');
      expect(board.paint?.args?.textColor).toBe('#ffee88');
    }
    // Цвет не вида #rrggbb → умолчание.
    for (const board of boards(build(item, { params: { boardColor: 'red', textColor: '#fff' } }))) {
      expect(board.paint?.args?.boardColor).toBe('#141414');
      expect(board.paint?.args?.textColor).toBe('#f4f1ea');
    }
  });

  it('фигура масштабируется пропорционально, текстуры при этом те же', () => {
    const base = build(item);
    for (const factor of [0.5, 2, 3.3]) {
      const other = build(item, { size: scaled(item.size, factor) });
      expect(other).toHaveLength(base.length);
      other.forEach((part, index) => {
        for (let axis = 0; axis < 3; axis++) {
          expect(part.position[axis]).toBeCloseTo(base[index].position[axis] * factor, 9);
          expect(part.size[axis]).toBeCloseTo(base[index].size[axis] * factor, 9);
        }
        expect(part.rotation).toEqual(base[index].rotation);
        expect(part.paint).toEqual(base[index].paint);
      });
    }
  });

  it('очень длинная строка обрезается, табличка не шире габарита', () => {
    const parts = build(item, { params: { boards: 'Ж'.repeat(4000) } });
    const [board] = fronts(parts);
    expect(glyphs(String(board.paint?.args?.text))).toHaveLength(40);
    expect(board.size[0]).toBeLessThanOrEqual(item.size[0] + EPS);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('hp.wizardFrame', () => {
  const { item } = wizardFrame;
  const painted = (parts: Part[], painter: string) => parts.filter((p) => p.paint?.painter === painter);

  it('умолчания: 4 бокса вокруг дыры, табличка, 2 ножки и 2 подкоса; ≈ 5 вызовов отрисовки', () => {
    const parts = build(item);
    expect(parts).toHaveLength(9);
    expect(parts.every((part) => part.shape === 'box')).toBe(true);
    expect(painted(parts, 'hp.frameTop')).toHaveLength(1);
    expect(painted(parts, 'hp.frameBottom')).toHaveLength(1);
    expect(painted(parts, 'hp.parchment')).toHaveLength(2);
    expect(painted(parts, 'hp.framePlate')).toHaveLength(1);
    expect(parts.filter((part) => !part.paint)).toHaveLength(4);
    expect(drawCalls(parts)).toBe(5);

    const [w, h] = item.size;
    const B = h - 0.3;
    const [top] = painted(parts, 'hp.frameTop');
    const [bottom] = painted(parts, 'hp.frameBottom');
    const sides = painted(parts, 'hp.parchment');
    const [plate] = painted(parts, 'hp.framePlate');
    expect(top.size[0]).toBeCloseTo(w, 9);
    expect(top.size[1]).toBeCloseTo(0.27 * B, 9);
    expect(top.size[2]).toBeCloseTo(0.02, 9);
    expect(top.position[1] + top.size[1] / 2).toBeCloseTo(h, 9);
    expect(top.paint).toEqual({ painter: 'hp.frameTop', args: { title: 'HAVE YOU SEEN THIS WIZARD?', color: '#cdb58a' }, px: [768, 256] });
    expect(bottom.size[0]).toBeCloseTo(w, 9);
    expect(bottom.size[1]).toBeCloseTo(0.21 * B, 9);
    expect(bottom.position[1] - bottom.size[1] / 2).toBeCloseTo(0.3, 9);
    expect(bottom.paint).toEqual({ painter: 'hp.frameBottom', args: { color: '#cdb58a' }, px: [768, 200] });
    for (const side of sides) {
      expect(side.size[0]).toBeCloseTo(0.12 * w, 9);
      expect(side.size[1]).toBeCloseTo(0.52 * B, 9);
      expect(Math.abs(side.position[0]) + side.size[0] / 2).toBeCloseTo(w / 2, 9);
      // Бока стыкуются с верхней и нижней планкой.
      expect(side.position[1] - side.size[1] / 2).toBeCloseTo(bottom.position[1] + bottom.size[1] / 2, 9);
      expect(side.position[1] + side.size[1] / 2).toBeCloseTo(top.position[1] - top.size[1] / 2, 9);
    }
    expect(sides[0].position[0]).toBeCloseTo(-sides[1].position[0], 9);
    expect(plate.size[0]).toBeCloseTo(0.42 * w, 9);
    expect(plate.size[1]).toBeCloseTo(0.13 * B, 9);
    expect(plate.size[2]).toBeCloseTo(0.015, 9);
    expect(plate.position[2] - top.position[2]).toBeCloseTo(0.012, 9);
    expect(plate.paint).toEqual({ painter: 'hp.framePlate', args: { plate: 'AZKABAN PRISON', number: 'ᛈᚹ390' }, px: [512, 160] });
  });

  it('дыра настоящая: в её середине нет ни одной части (сквозь рамку можно кликать)', () => {
    for (const legs of [0, 0.3, 0.6]) {
      const [w, h] = item.size;
      const B = h - legs;
      const parts = build(item, { params: { legs } });
      // Сетка точек по дыре выше таблички.
      for (let ix = -4; ix <= 4; ix++) {
        for (let iy = 0; iy <= 4; iy++) {
          const x = (ix / 4) * 0.36 * w;
          const y = legs + (0.36 + 0.09 * iy) * B;
          for (const part of parts) {
            if (part.rotation) continue;
            const inside = Math.abs(part.position[0] - x) < part.size[0] / 2 && Math.abs(part.position[1] - y) < part.size[1] / 2;
            expect(inside).toBe(false);
          }
        }
      }
      // Подкосы стоят за боковинами, а не в проёме.
      for (const strut of parts.filter((part) => part.rotation)) {
        expect(Math.abs(strut.position[0])).toBeGreaterThan(0.38 * w - strut.size[0] / 2 - EPS);
      }
    }
  });

  it('параметр «Ножки» поднимает щит: низ щита на высоте legs, верх — всегда h', () => {
    for (const legs of [0, 0.15, 0.3, 0.6]) {
      const parts = build(item, { params: { legs } });
      const [bottom] = painted(parts, 'hp.frameBottom');
      const [top] = painted(parts, 'hp.frameTop');
      expect(bottom.position[1] - bottom.size[1] / 2).toBeCloseTo(legs, 9);
      expect(top.position[1] + top.size[1] / 2).toBeCloseTo(item.size[1], 9);
      const timber = parts.filter((part) => !part.paint);
      expect(timber).toHaveLength(4);
      const uprights = timber.filter((part) => !part.rotation);
      for (const leg of uprights) {
        expect(leg.size[1]).toBeCloseTo(legs + 0.3, 9);
        expect(leg.position[1] - leg.size[1] / 2).toBeCloseTo(0, 9);
        expect(leg.color).toBe('#c9a36b');
      }
    }
  });

  it('подкосы: под 20° к вертикали, от щита назад до заднего края габарита, не ниже пола', () => {
    const [, , d] = item.size;
    const parts = build(item);
    const struts = parts.filter((part) => part.rotation);
    const [top] = painted(parts, 'hp.frameTop');
    expect(struts).toHaveLength(2);
    for (const strut of struts) {
      const [angle, ry, rz] = strut.rotation ?? [0, 0, 0];
      expect(ry).toBe(0);
      expect(rz).toBe(0);
      expect(angle).toBeGreaterThan(19 * DEG);
      expect(angle).toBeLessThan(21 * DEG);
      const halfY = (strut.size[1] * Math.cos(angle) + strut.size[2] * Math.sin(angle)) / 2;
      const halfZ = (strut.size[1] * Math.sin(angle) + strut.size[2] * Math.cos(angle)) / 2;
      expect(strut.position[1] - halfY).toBeGreaterThanOrEqual(-EPS);
      expect(strut.position[2] - halfZ).toBeGreaterThanOrEqual(-d / 2 - EPS);
      expect(strut.position[2] - halfZ).toBeLessThan(-d / 2 + 0.03);
      expect(strut.position[2] + halfZ).toBeLessThanOrEqual(top.position[2]);
    }
  });

  it('тексты попадают в аргументы painter’а и обрезаются', () => {
    const parts = build(item, { params: { title: '  ВЫ  ВИДЕЛИ ЭТОГО ВОЛШЕБНИКА? ', plate: 'АЗКАБАН', number: '12345678901234' } });
    expect(painted(parts, 'hp.frameTop')[0].paint?.args?.title).toBe('ВЫ ВИДЕЛИ ЭТОГО ВОЛШЕБНИКА?');
    expect(painted(parts, 'hp.framePlate')[0].paint?.args).toEqual({ plate: 'АЗКАБАН', number: '12345678' });
    const long = build(item, { params: { title: 'Щ'.repeat(4000), plate: 'Щ'.repeat(4000) } });
    expect(glyphs(String(long[0].paint?.args?.title))).toHaveLength(60);
    expect(glyphs(String(painted(long, 'hp.framePlate')[0].paint?.args?.plate))).toHaveLength(30);
  });

  it('цвет объекта — тон пергамента в аргументах painters; брус не перекрашивается', () => {
    const parts = build(item, { color: '#aabbcc' });
    for (const name of ['hp.frameTop', 'hp.frameBottom', 'hp.parchment']) {
      for (const part of painted(parts, name)) {
        expect(part.paint?.args?.color).toBe('#aabbcc');
        expect(part.color).toBe('#ffffff');
      }
    }
    for (const part of parts.filter((p) => !p.paint)) expect(part.color).toBe('#c9a36b');
  });

  it('фигура масштабируется пропорционально (ножки — вместе с ней), текстуры те же', () => {
    for (const legs of [0, 0.3, 0.6]) {
      const base = build(item, { params: { legs } });
      for (const factor of [0.5, 2, 3.3]) {
        const other = build(item, { size: scaled(item.size, factor), params: { legs } });
        expect(other).toHaveLength(base.length);
        other.forEach((part, index) => {
          for (let axis = 0; axis < 3; axis++) {
            expect(part.position[axis]).toBeCloseTo(base[index].position[axis] * factor, 9);
            expect(part.size[axis]).toBeCloseTo(base[index].size[axis] * factor, 9);
            expect(part.rotation?.[axis] ?? 0).toBeCloseTo(base[index].rotation?.[axis] ?? 0, 9);
          }
          expect(part.paint).toEqual(base[index].paint);
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('paper.ts: чистые помощники', () => {
  it('splitBalanced делит текст на строки примерно равной длины, не разрывая слов', () => {
    expect(splitBalanced('HAVE YOU SEEN THIS WIZARD?', 3)).toEqual(['HAVE YOU', 'SEEN THIS', 'WIZARD?']);
    expect(splitBalanced('HAVE YOU SEEN THIS WIZARD?', 1)).toEqual(['HAVE YOU SEEN THIS WIZARD?']);
    expect(splitBalanced('МАССОВЫЙ ПОБЕГ ИЗ АЗКАБАНА', 2)).toEqual(['МАССОВЫЙ ПОБЕГ', 'ИЗ АЗКАБАНА']);
    expect(splitBalanced('ОДНО', 3)).toEqual(['ОДНО']);
    expect(splitBalanced('  a   b  ', 5)).toEqual(['a', 'b']);
    expect(splitBalanced('', 3)).toEqual([]);
    expect(splitBalanced('   ', 3)).toEqual([]);
    expect(splitBalanced('a b c', 0)).toEqual(['a b c']);
    for (const page of PROPHET_PAGES) {
      for (const text of [page.ru, page.en]) {
        for (const lines of [1, 2, 3]) expect(splitBalanced(text, lines).join(' ')).toBe(text);
      }
    }
  });

  it('glyphs считает кодовые точки; rgba переводит цвет', () => {
    expect(glyphs('9¾')).toEqual(['9', '¾']);
    expect(glyphs('ᛈᚹ390')).toHaveLength(5);
    expect(rgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(rgba('red', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(rgba('#000000', Number.NaN)).toBe('rgba(0, 0, 0, 1)');
  });

  it('thread: вертикальная нить Ø 2 мм; слишком короткая → null', () => {
    expect(thread(1, 0.5, 1.5, -2)).toEqual({ shape: 'cylinder', position: [1, 1, -2], size: [0.002, 1, 0.002], color: '#d8d8d8', opacity: 0.35 });
    expect(thread(0, 1, 1.004, 0)).toBeNull();
    expect(thread(0, 1, 0.5, 0)).toBeNull();
    expect(thread(0, Number.NaN, 1, 0)).toBeNull();
  });

  it('scatter: ровно count точек внутри прямоугольника, детерминированно, с учётом запретных зон', () => {
    const points = scatter(createRng(5), 40, 2, 1);
    expect(points).toHaveLength(40);
    for (const [x, z] of points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(2);
      expect(Math.abs(z)).toBeLessThanOrEqual(1);
    }
    expect(scatter(createRng(5), 40, 2, 1)).toEqual(points);
    expect(scatter(createRng(6), 40, 2, 1)).not.toEqual(points);
    const right = scatter(createRng(5), 30, 2, 1, 24, (x) => x > 0);
    expect(right.every(([x]) => x > 0)).toBe(true);
    // Вырожденная область: все точки в центре, без NaN.
    expect(scatter(createRng(1), 3, -1, 0)).toEqual([[0, 0], [0, 0], [0, 0]]);
    // Точки расходятся: ближайшие соседи не слипаются.
    let nearest = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        nearest = Math.min(nearest, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
      }
    }
    expect(nearest).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

interface Call {
  name: string;
  args: unknown[];
}

const COLOR = /^(#[0-9a-fA-F]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/;

/**
 * Записывающий макет CanvasRenderingContext2D: любые методы принимаются и запоминаются, measureText возвращает
 * ширину, пропорциональную кеглю, градиенты — объект с addColorStop.
 */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1 };
  const gradient = {
    addColorStop: (offset: number, color: string) => {
      calls.push({ name: 'addColorStop', args: [offset, color] });
    },
  };
  const proxy = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'measureText') {
        return (text: string) => {
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10);
          return { width: Array.from(String(text)).length * px * 0.6 };
        };
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...args: unknown[]) => {
          calls.push({ name: prop, args });
          return gradient;
        };
      }
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
      };
    },
    set(target, prop, value) {
      if (typeof prop === 'string') {
        target[prop] = value;
        calls.push({ name: `set ${prop}`, args: [value] });
      }
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}

/** Нарушения в записи вызовов: то, на чём настоящий canvas бросил бы исключение или нарисовал бы мусор. */
function canvasProblems(calls: Call[]): string[] {
  const problems: string[] = [];
  let depth = 0;
  for (const { name, args } of calls) {
    for (const arg of args) {
      if (typeof arg === 'number' && !Number.isFinite(arg)) problems.push(`${name}: не число (${String(arg)})`);
    }
    const numbers = args.map((arg) => (typeof arg === 'number' ? arg : Number.NaN));
    switch (name) {
      case 'save':
        depth++;
        break;
      case 'restore':
        depth--;
        if (depth < 0) problems.push('restore без save');
        break;
      case 'addColorStop':
        if (!(numbers[0] >= 0 && numbers[0] <= 1)) problems.push(`addColorStop: смещение ${String(args[0])}`);
        if (typeof args[1] !== 'string' || !COLOR.test(args[1])) problems.push(`addColorStop: цвет ${String(args[1])}`);
        break;
      case 'createRadialGradient':
        if (!(numbers[2] >= 0 && numbers[5] >= 0)) problems.push('createRadialGradient: отрицательный радиус');
        break;
      case 'arc':
        if (!(numbers[2] >= 0)) problems.push(`arc: радиус ${String(args[2])}`);
        break;
      case 'ellipse':
        if (!(numbers[2] >= 0 && numbers[3] >= 0)) problems.push(`ellipse: радиусы ${String(args[2])}, ${String(args[3])}`);
        break;
      case 'fillText':
        if (typeof args[0] !== 'string') problems.push('fillText: не строка');
        if (args.length > 3 && !(numbers[3] > 0)) problems.push(`fillText: maxWidth ${String(args[3])}`);
        break;
      case 'set fillStyle':
      case 'set strokeStyle':
        if (typeof args[0] === 'string' && !COLOR.test(args[0])) problems.push(`${name}: ${args[0]}`);
        if (args[0] === undefined || args[0] === null) problems.push(`${name}: пусто`);
        break;
      case 'set font': {
        const px = Number(/(\d+(?:\.\d+)?)px /.exec(String(args[0]))?.[1]);
        if (!(px > 0)) problems.push(`set font: ${String(args[0])}`);
        if (!/(Georgia, "Times New Roman", serif|system-ui)/.test(String(args[0]))) problems.push(`set font: не системный стек (${String(args[0])})`);
        break;
      }
      case 'set lineWidth':
        if (!(numbers[0] > 0)) problems.push(`set lineWidth: ${String(args[0])}`);
        break;
      default:
        break;
    }
  }
  if (depth !== 0) problems.push(`save/restore не сбалансированы (${depth})`);
  return problems;
}

function run(name: string, px: [number, number], args: Params): Call[] {
  const painter = allPainters[name];
  expect(typeof painter).toBe('function');
  const { ctx, calls } = fakeContext();
  painter(ctx, px[0], px[1], args);
  return calls;
}

const texts = (calls: Call[]) => calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));

describe('painters W6 на макете canvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('каждый paint, который создают билдеры, рисуется без исключений и с допустимыми аргументами canvas', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = new Set<string>();
    let painted = 0;
    for (const { item } of modules) {
      const variants: Partial<BuildInput>[] = [{}, { params: allNumeric(item, 'min') }, { params: allNumeric(item, 'max') }, { params: { lang: 'en' } }];
      for (const overrides of variants) {
        for (const part of build(item, overrides)) {
          if (!part.paint) continue;
          const key = JSON.stringify(part.paint);
          if (seen.has(key)) continue;
          seen.add(key);
          // ≤ 1024² на текстуру.
          expect(part.paint.px[0]).toBeLessThanOrEqual(1024);
          expect(part.paint.px[1]).toBeLessThanOrEqual(1024);
          const calls = run(part.paint.painter, part.paint.px, part.paint.args ?? {});
          expect(canvasProblems(calls), key).toEqual([]);
          expect(calls.length).toBeGreaterThan(3);
          painted++;
        }
      }
    }
    expect(painted).toBeGreaterThan(30);
    expect(warn).not.toHaveBeenCalled();
  });

  it('painters переживают пустые и мусорные аргументы и любые размеры canvas', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hostile = [
      {},
      { color: 'red', glow: 'x', variant: -3, lang: 5, text: 42, dir: 'left', boardColor: null, textColor: 7, seed: Number.NaN, aspect: 0, title: {}, plate: [], number: null },
      { color: '#abc', glow: 1e9, variant: 1e9, text: 'Ы'.repeat(5000), dir: 0, seed: -1, aspect: 1e9, title: 'W '.repeat(3000), plate: 'P'.repeat(5000), number: '9'.repeat(5000) },
      { variant: 7.9, lang: 'en', text: '   ', title: '', plate: '', number: '' },
    ] as unknown as Params[];
    for (const name of Object.keys(allPainters)) {
      for (const args of hostile) {
        for (const px of [[512, 128], [1, 1], [64, 1024], [1024, 16]] as [number, number][]) {
          const calls = run(name, px, args);
          expect(canvasProblems(calls), `${name} ${JSON.stringify(px)}`).toEqual([]);
        }
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('исключение внутри painter’а не выходит наружу: canvas заливается запасным цветом', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: Call[] = [];
    const broken = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'createRadialGradient' || prop === 'createLinearGradient' || prop === 'beginPath' || prop === 'strokeRect') {
            return () => {
              throw new Error('нет такого метода');
            };
          }
          return (...args: unknown[]) => {
            calls.push({ name: String(prop), args });
          };
        },
        set(_target, prop, value) {
          calls.push({ name: `set ${String(prop)}`, args: [value] });
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    for (const name of Object.keys(allPainters)) {
      calls.length = 0;
      expect(() => allPainters[name](broken, 64, 64, {})).not.toThrow();
      // Последняя заливка — на весь canvas, save и restore сбалансированы.
      const fills = calls.filter((call) => call.name === 'fillRect');
      expect(fills[fills.length - 1].args).toEqual([0, 0, 64, 64]);
      // Стек состояний размотан полностью: restore не меньше, чем save.
      expect(calls.filter((call) => call.name === 'restore').length).toBeGreaterThanOrEqual(calls.filter((call) => call.name === 'save').length);
    }
    expect(warn).toHaveBeenCalled();
  });

  it('hp.prophetPage: заголовок варианта на выбранном языке и шапка газеты; текст ужат по ширине', () => {
    PROPHET_PAGES.forEach((page, variant) => {
      for (const lang of ['ru', 'en']) {
        const calls = run('hp.prophetPage', [384, 544], { variant, lang });
        const drawn = texts(calls).join(' ');
        const headline = lang === 'en' ? page.en : page.ru;
        for (const word of headline.split(' ')) expect(drawn).toContain(word);
        expect(drawn).toContain(lang === 'en' ? page.subEn : page.subRu);
        if (page.kind === 'news') expect(drawn).toContain(lang === 'en' ? 'The Daily Prophet' : 'Ежедневный Пророк');
        // Каждая строка текста получает maxWidth не шире листа.
        for (const call of calls.filter((c) => c.name === 'fillText')) {
          expect(Number(call.args[3])).toBeLessThanOrEqual(384);
        }
      }
    });
    // Заголовки — по разделу 4.3.
    expect(PROPHET_PAGES.map((page) => page.ru)).toEqual([
      'РАЗЫСКИВАЕТСЯ',
      'НЕЖЕЛАТЕЛЬНОЕ ЛИЦО № 1',
      'МАССОВЫЙ ПОБЕГ ИЗ АЗКАБАНА',
      'ТЁМНАЯ МЕТКА СЕЕТ ПАНИКУ',
      'ВЫ ВИДЕЛИ ЭТОГО ВОЛШЕБНИКА?',
      'МАЛЬЧИК, КОТОРЫЙ ВЫЖИЛ',
      'ТОТ-КОГО-НЕЛЬЗЯ-НАЗЫВАТЬ ВЕРНУЛСЯ',
      'ПРОКЛАМАЦИЯ',
    ]);
  });

  it('hp.signBoard: заглавные глифы строки по одному, ужаты по ширине; изнанка — без текста; силуэт зеркалится', () => {
    const args = { text: 'Платформа 9¾', dir: 1, boardColor: '#141414', textColor: '#f4f1ea', seed: 5, aspect: 5 };
    const calls = run('hp.signBoard', [512, 128], args);
    expect(texts(calls).join('')).toBe('ПЛАТФОРМА 9¾');
    expect(calls.some((call) => call.name === 'set fillStyle' && call.args[0] === '#141414')).toBe(true);
    expect(calls.some((call) => call.name === 'set fillStyle' && call.args[0] === '#f4f1ea')).toBe(true);
    // Глифы идут слева направо и не выходят за canvas (в «настоящих» пропорциях: ширина = 128 · aspect).
    const xs: number[] = [];
    let pending: number | null = null;
    for (const call of calls) {
      if (call.name === 'translate') pending = Number(call.args[0]);
      if (call.name === 'fillText' && pending !== null) xs.push(pending);
    }
    expect(xs).toHaveLength(12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[0]).toBeGreaterThan(0.08 * 640);
    expect(xs[xs.length - 1]).toBeLessThan(0.9 * 640);
    // Поворот глифа — не больше 6°.
    for (const call of calls.filter((c) => c.name === 'rotate')) expect(Math.abs(Number(call.args[0]))).toBeLessThanOrEqual(6 * DEG + EPS);

    // Длинная строка ужимается: кегль меньше.
    const sizeOf = (list: Call[]) => Math.max(...list.filter((c) => c.name === 'set font').map((c) => Number(/(\d+(?:\.\d+)?)px/.exec(String(c.args[0]))?.[1])));
    const long = run('hp.signBoard', [512, 128], { ...args, text: 'Министерство магии и волшебства' });
    expect(texts(long)).toHaveLength(31);
    expect(sizeOf(long.slice(long.findIndex((c) => c.name === 'scale')))).toBeLessThan(60);

    const back = run('hp.signBoard', [512, 128], { ...args, text: '', dir: -1 });
    expect(texts(back)).toHaveLength(0);
    // Стрелка влево — зеркальное преобразование; вправо — без него.
    expect(back.some((call) => call.name === 'scale' && call.args[0] === -1)).toBe(true);
    expect(calls.some((call) => call.name === 'scale' && call.args[0] === -1)).toBe(false);
    // Один и тот же seed → одна и та же картинка.
    expect(run('hp.signBoard', [512, 128], args)).toEqual(calls);
    expect(run('hp.signBoard', [512, 128], { ...args, seed: 6 })).not.toEqual(calls);
  });

  it('hp.frameTop / hp.framePlate: тексты параметров рисуются, заголовок — в три строки', () => {
    const top = run('hp.frameTop', [768, 256], { title: 'Have you seen this wizard?', color: '#cdb58a' });
    expect(texts(top)).toEqual(['HAVE YOU', 'SEEN THIS', 'WIZARD?']);
    expect(texts(run('hp.frameTop', [768, 256], { title: 'Wanted', color: '#cdb58a' }))).toEqual(['WANTED']);
    expect(texts(run('hp.frameTop', [768, 256], { title: '', color: '#cdb58a' }))).toEqual([]);
    const plate = run('hp.framePlate', [512, 160], { plate: 'Azkaban prison', number: 'ᛈᚹ390' });
    expect(texts(plate)).toEqual(['AZKABAN PRISON', 'ᛈ', 'ᚹ', '3', '9', '0']);
    expect(texts(run('hp.framePlate', [512, 160], { plate: '', number: '' }))).toEqual([]);
    expect(texts(run('hp.frameBottom', [768, 200], { color: '#cdb58a' })).length).toBeGreaterThanOrEqual(4);
  });

  it('hp.cloudMatcap: glow = 0 — нейтральная вата, glow > 0 — цвет свечения в градиенте', () => {
    const stops = (glow: number) =>
      run('hp.cloudMatcap', [128, 128], { color: '#3fe0a8', glow })
        .filter((call) => call.name === 'addColorStop')
        .map((call) => String(call.args[1]));
    const neutral = stops(0);
    expect(neutral).toHaveLength(3);
    expect(neutral[0]).toBe('#ffffff');
    // Серо-белая вата: каналы середины равны с точностью до оттенка.
    const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const [r, g, b] = channels(neutral[1]);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    expect(stops(1)[1]).toBe('#3fe0a8');
    expect(stops(2)[0]).not.toBe('#ffffff');
  });

  it('вырезки (сова, холм, табличка) не заливают canvas целиком — фон остаётся прозрачным', () => {
    for (const [name, px, args] of [
      ['hp.owlFlying', [1024, 512], {}],
      ['hp.signMound', [256, 128], {}],
      ['hp.signBoard', [512, 128], { text: 'Хогвартс', dir: 1, aspect: 4 }],
    ] as [string, [number, number], Params][]) {
      const calls = run(name, px, args);
      const full = calls.filter((call) => call.name === 'fillRect' && call.args[0] === 0 && call.args[1] === 0 && call.args[2] === px[0] && call.args[3] === px[1]);
      expect(full).toHaveLength(0);
      expect(calls.some((call) => call.name === 'fill')).toBe(true);
    }
  });
});
