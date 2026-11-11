import { describe, expect, it } from 'vitest';
import { shade } from '../../../model/color';
import type { Params, Vec3 } from '../../../model/types';
import { partBounds } from '../../bounds';
import { checkBuild } from '../../testing';
import type { BuildInput, CatalogItem, Painter, Part } from '../../types';
import * as dementor from './dementor';
import dementorSource from './dementor.ts?raw';
import * as dobby from './dobby';
import dobbySource from './dobby.ts?raw';
import * as hatLantern from './hatLantern';
import hatLanternSource from './hatLantern.ts?raw';
import * as mandrakes from './mandrakes';
import mandrakesSource from './mandrakes.ts?raw';
import * as owlCage from './owlCage';
import owlCageSource from './owlCage.ts?raw';
import { DEG, aimY, axisY, eulerOfBasis, faceGlowColor, guardPainter, paramColor, paramFlag, paramNumber, rgba, rod, sortingHat } from './sortingHat';
import sortingHatSource from './sortingHat.ts?raw';
import * as xmasTree from './xmasTree';
import { MAX_LIGHTS, MAX_ORNAMENTS, MAX_TIPS } from './xmasTree';
import xmasTreeSource from './xmasTree.ts?raw';

// Тесты пакета W7: геометрия шести фигур и настольных пресетов «Гарри Поттер», общий билдер шляпы и painters.
// Painters в Node выполнить нельзя (нет canvas), поэтому они прогоняются на записывающем макете контекста:
// проверяется, что painter не бросает, передаёт canvas только конечные числа и допустимые цвета.

const modules = [dementor, hatLantern, mandrakes, dobby, owlCage, xmasTree];
const sources: Record<string, string> = {
  'dementor.ts': dementorSource,
  'dobby.ts': dobbySource,
  'hatLantern.ts': hatLanternSource,
  'mandrakes.ts': mandrakesSource,
  'owlCage.ts': owlCageSource,
  'sortingHat.ts': sortingHatSource,
  'xmasTree.ts': xmasTreeSource,
};
const allPainters: Record<string, Painter> = Object.assign({}, ...modules.map((m) => m.painters));

const EPS = 1e-9;

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

/** Ключ группы «геометрия + материал»: всё, кроме position / rotation / size / color. */
function drawKey(part: Part): string {
  const rest: Record<string, unknown> = { ...part };
  delete rest.position;
  delete rest.rotation;
  delete rest.size;
  delete rest.color;
  return JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]]));
}

const drawCalls = (parts: readonly Part[]) => new Set(parts.map(drawKey)).size;

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

/** Все сочетания булевых параметров записи. */
function booleanCombos(item: CatalogItem): Params[] {
  let combos: Params[] = [{}];
  for (const def of item.params) {
    if (def.type !== 'boolean') continue;
    combos = combos.flatMap((combo) => [
      { ...combo, [def.key]: true },
      { ...combo, [def.key]: false },
    ]);
  }
  return combos;
}

/** Нарушения СТРОГОГО габарита (без допуска 10 % + 2 см): не-additive части вне [−w/2, w/2] × [0, h] × [−d/2, d/2]. */
function strictProblems(parts: readonly Part[], size: Vec3, slack = 1e-6): string[] {
  const min = [-size[0] / 2, 0, -size[2] / 2];
  const max = [size[0] / 2, size[1], size[2] / 2];
  const problems: string[] = [];
  parts.forEach((part, index) => {
    if (part.additive) return;
    const bounds = partBounds(part);
    for (let axis = 0; axis < 3; axis++) {
      const lo = bounds.center[axis] - bounds.size[axis] / 2;
      const hi = bounds.center[axis] + bounds.size[axis] / 2;
      if (lo < min[axis] - slack || hi > max[axis] + slack) {
        problems.push(`часть ${index} (${part.shape}) по оси ${axis}: [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
      }
    }
  });
  return problems;
}

/** Размеры, на которых проверяется каждая запись: умолчание, minSize / масштаб фигуры, непропорциональные и вырожденные. */
const SIZES: Record<string, Vec3[]> = {
  'hp.dementor': [
    dementor.item.size,
    scaled(dementor.item.size, 0.25),
    scaled(dementor.item.size, 3),
    scaled(dementor.item.size, 10),
    scaled(dementor.item.size, 0.01),
    [0.9, 0.5, 0.7],
    [0.3, 2, 0.7],
    [0.9, 2, 0.1],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
  'hp.hatLantern': [
    hatLantern.item.size,
    scaled(hatLantern.item.size, 0.2),
    scaled(hatLantern.item.size, 5),
    scaled(hatLantern.item.size, 50),
    [0.36, 0.05, 0.36],
    [0.1, 0.35, 0.36],
    [0.36, 2, 0.1],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
  'hp.mandrakes': [
    mandrakes.item.size,
    [0.3, 0.3, 0.25],
    [0.3, 0.4, 0.45],
    [0.6, 0.3, 0.25],
    [2, 0.4, 0.25],
    [0.3, 2, 2],
    [3, 1, 2],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
    [0.1, 0.02, 0.1],
  ],
  'hp.dobby': [
    dobby.item.size,
    scaled(dobby.item.size, 0.2),
    scaled(dobby.item.size, 4),
    scaled(dobby.item.size, 20),
    [0.45, 0.3, 0.3],
    [0.1, 1, 0.3],
    [0.45, 1, 0.05],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
  'hp.owlCage': [
    owlCage.item.size,
    scaled(owlCage.item.size, 0.2),
    scaled(owlCage.item.size, 4),
    scaled(owlCage.item.size, 30),
    [0.32, 0.1, 0.32],
    [0.05, 0.6, 0.32],
    [0.32, 3, 0.1],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
  'hp.xmasTree': [
    xmasTree.item.size,
    scaled(xmasTree.item.size, 0.2),
    scaled(xmasTree.item.size, 2),
    scaled(xmasTree.item.size, 13),
    [0.8, 0.2, 0.8],
    [0.1, 1.5, 0.8],
    [0.8, 6, 0.2],
    [20, 20, 20],
    [0.01, 0.01, 0.01],
  ],
};

describe('W7: общие требования к шести пресетам', () => {
  it('метаданные заглушек сохранены', () => {
    expect(modules.map((m) => m.item.id)).toEqual(['hp.dementor', 'hp.hatLantern', 'hp.mandrakes', 'hp.dobby', 'hp.owlCage', 'hp.xmasTree']);
    for (const { item } of modules) {
      expect(item.kind).toBe('preset');
      expect(item.category).toBe('Гарри Поттер');
      expect(typeof item.build).toBe('function');
    }
    expect(dementor.item).toMatchObject({ title: 'Дементор на стойке', size: [0.9, 2.0, 0.7], resize: 'uniform', mounts: ['floor'], color: '#0b0b0f' });
    expect(hatLantern.item).toMatchObject({ title: 'Шляпа-фонарь', size: [0.36, 0.35, 0.36], resize: 'uniform', mounts: ['surface', 'floor'] });
    expect(mandrakes.item).toMatchObject({ title: 'Мандрагоры и шляпа', size: [0.6, 0.4, 0.45], minSize: [0.3, 0.3, 0.25], resize: 'free', mounts: ['surface', 'floor'] });
    expect(dobby.item).toMatchObject({ title: 'Добби', size: [0.45, 1.0, 0.3], resize: 'uniform', mounts: ['floor'], color: '#d9a98c', colorable: false, params: [] });
    expect(owlCage.item).toMatchObject({ title: 'Сова в клетке', size: [0.32, 0.6, 0.32], resize: 'uniform', mounts: ['surface', 'ceiling', 'floor'], defaultDrop: 0.6, hanger: true });
    expect(xmasTree.item).toMatchObject({ title: 'Ёлка 150 см', size: [0.8, 1.5, 0.8], resize: 'uniform', mounts: ['floor'], color: '#2f5d34' });
    expect(dementor.item.params.map((def) => def.key)).toEqual(['arms', 'tatter', 'hover', 'showBase', 'seed']);
    expect(hatLantern.item.params.map((def) => def.key)).toEqual(['glowColor', 'glow', 'seed']);
    expect(mandrakes.item.params.map((def) => def.key)).toEqual(['pots', 'withHat', 'seed']);
    expect(owlCage.item.params.map((def) => def.key)).toEqual(['bars', 'cageColor', 'withOwl']);
    expect(xmasTree.item.params.map((def) => def.key)).toEqual(['tiers', 'lights', 'ornaments', 'star', 'seed']);
  });

  it('painters набора W7 (раздел 4.12) на месте, имена — с префиксом hp.', () => {
    expect(Object.keys(allPainters).sort()).toEqual(['hp.glowDisc', 'hp.mandrakeFace', 'hp.needles', 'hp.owlFeathers', 'hp.star']);
    // Имена не пересекаются между модулями.
    expect(modules.reduce((sum, m) => sum + Object.keys(m.painters).length, 0)).toBe(Object.keys(allPainters).length);
  });

  it('в пакете нет собственных shade / mix / clamp / lerp и чужих импортов', () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/(function|const|let)\s+(shade|mix|clamp|lerp)\b/);
      expect(source, name).not.toMatch(/Math\.random|from 'three'|document\.|window\./);
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const path of imports) {
        expect(
          ['../../../model/color', '../../../model/rng', '../../../model/types', '../../types', '../../testing', './sortingHat'],
          `${name}: ${path}`,
        ).toContain(path);
      }
    }
  });

  for (const { item, painters } of modules) {
    describe(item.id, () => {
      it('checkBuild пуст при умолчаниях и на каждом своём креплении', () => {
        expect(checkBuild(item, painters)).toEqual([]);
        for (const mount of item.mounts) expect(checkBuild(item, painters, { mount })).toEqual([]);
      });

      it('checkBuild пуст при minSize / maxSize и крайних значениях каждого числового параметра', () => {
        for (const size of SIZES[item.id]) {
          for (const flags of booleanCombos(item)) {
            expect(checkBuild(item, painters, { size, params: flags })).toEqual([]);
            for (const { key, value } of numericExtremes(item)) {
              expect(checkBuild(item, painters, { size, params: { ...flags, [key]: value } })).toEqual([]);
            }
            expect(checkBuild(item, painters, { size, params: { ...flags, ...allNumeric(item, 'min') } })).toEqual([]);
            expect(checkBuild(item, painters, { size, params: { ...flags, ...allNumeric(item, 'max') } })).toEqual([]);
          }
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
            for (const size of SIZES[item.id].slice(0, 3)) {
              expect(checkBuild(item, painters, { size, params: { seed, ...allNumeric(item, 'max') } })).toEqual([]);
            }
          }
        });
      }

      it('не падает на чужих параметрах (нечисла, мусор, пустой объект)', () => {
        const junk = {
          seed: 'x',
          arms: 'широко',
          tatter: null,
          hover: {},
          showBase: 1,
          glowColor: 'red',
          glow: [],
          pots: 'много',
          withHat: 'да',
          bars: Number.NaN,
          cageColor: 7,
          withOwl: null,
          tiers: Number.POSITIVE_INFINITY,
          lights: 0,
          ornaments: '40',
          star: 'yes',
        } as unknown as Params;
        expect(() => item.build!({ size: item.size, color: 'red', params: junk, mount: item.mounts[0] })).not.toThrow();
        expect(() => item.build!({ size: item.size, color: item.color, params: {}, mount: item.mounts[0] })).not.toThrow();
        expect(checkBuild(item, painters, { params: junk })).toEqual([]);
        // Мимо resolveParams (значения вне пределов ParamDef) билдер тоже остаётся в габарите.
        const wild: Params = { arms: 50, tatter: -3, hover: 99, glow: 1e9, pots: 1e6, bars: 1e6, tiers: 1e6, ornaments: 1e6, seed: 1e12 };
        const parts = item.build!({ size: item.size, color: item.color, params: wild, mount: item.mounts[0] });
        expect(parts.length).toBeLessThanOrEqual(900);
        for (const part of parts) {
          for (const value of [...part.position, ...part.size, ...(part.rotation ?? [])]) expect(Number.isFinite(value)).toBe(true);
        }
      });

      it('цвета частей — #rrggbb, taper кратен 0.05, одинаковых элементов — немного групп отрисовки', () => {
        for (const flags of booleanCombos(item)) {
          const parts = build(item, { params: { ...flags, ...allNumeric(item, 'max') } });
          for (const part of parts) {
            expect(part.color).toMatch(/^#[0-9a-f]{6}$/i);
            if (part.taper !== undefined) expect(Math.abs(part.taper * 20 - Math.round(part.taper * 20))).toBeLessThan(1e-9);
            if (part.paint) {
              expect(part.paint.px[0]).toBeLessThanOrEqual(1024);
              expect(part.paint.px[1]).toBeLessThanOrEqual(1024);
            }
          }
          expect(drawCalls(parts)).toBeLessThanOrEqual(14);
        }
      });
    });
  }

  it('фигуры масштабируются пропорционально: size × f → положения и размеры всех частей × f', () => {
    for (const { item } of [dementor, hatLantern, dobby, owlCage, xmasTree]) {
      expect(item.resize).toBe('uniform');
      for (const params of [allNumeric(item, 'max'), {}]) {
        // hover дементора задаётся в метрах — пропорциональность проверяется при подоле на полу.
        const overrides = { params: { ...params, hover: 0, star: true, ornaments: 12 } };
        const base = build(item, overrides);
        for (const factor of [0.5, 2, 3.7]) {
          const big = build(item, { ...overrides, size: scaled(item.size, factor) });
          expect(big.length).toBe(base.length);
          big.forEach((part, index) => {
            const original = base[index];
            // Пятно света фонаря лежит на 2 мм над столом при любом размере (защита от z-fighting) — оно не в счёт.
            if (part.additive) return;
            expect(part.shape).toBe(original.shape);
            expect(part.color).toBe(original.color);
            expect(drawKey(part)).toBe(drawKey(original));
            for (let axis = 0; axis < 3; axis++) {
              expect(part.position[axis]).toBeCloseTo(original.position[axis] * factor, 6);
              expect(part.size[axis]).toBeCloseTo(original.size[axis] * factor, 6);
              expect(part.rotation?.[axis] ?? 0).toBeCloseTo(original.rotation?.[axis] ?? 0, 6);
            }
          });
        }
      }
    }
  });

  it('строгий габарит (без допуска) у шляпы, Добби, клетки и ёлки при любых параметрах и размерах', () => {
    for (const { item } of [hatLantern, dobby, owlCage, xmasTree]) {
      for (const size of SIZES[item.id]) {
        for (const flags of booleanCombos(item)) {
          for (const numbers of [{}, allNumeric(item, 'min'), allNumeric(item, 'max')]) {
            for (const seed of [1, 7]) {
              const parts = build(item, { size, params: { ...flags, ...numbers, seed } });
              expect(strictProblems(parts, size), `${item.id} ${JSON.stringify({ size, flags, numbers, seed })}`).toEqual([]);
            }
          }
        }
      }
    }
  });
});

describe('sortingHat.ts: общий билдер шляпы', () => {
  const hatSizes: [number, number][] = [
    [0.36, 0.35],
    [0.25, 0.25],
    [0.2, 0.25],
    [0.1, 1],
    [1, 0.1],
    [0.008, 0.01],
    [20, 20],
  ];

  it('все части лежат внутри цилиндра полей и не выше h — при любых пропорциях, лице и seed', () => {
    for (const [w, h] of hatSizes) {
      for (const face of ['glow', 'dark', 'none'] as const) {
        for (const seed of [undefined, 0, 1, 2, 99, 12345]) {
          const origin: Vec3 = [0.3, 0.05, -0.2];
          const parts = sortingHat(w, h, { color: '#4a3f33', face, glowColor: '#ffab3d', glow: 1, origin, seed });
          for (const part of parts) {
            const bounds = partBounds(part);
            const slack = 1e-6 * Math.max(w, h);
            expect(bounds.center[0] - bounds.size[0] / 2).toBeGreaterThanOrEqual(origin[0] - w / 2 - slack);
            expect(bounds.center[0] + bounds.size[0] / 2).toBeLessThanOrEqual(origin[0] + w / 2 + slack);
            expect(bounds.center[2] - bounds.size[2] / 2).toBeGreaterThanOrEqual(origin[2] - w / 2 - slack);
            expect(bounds.center[2] + bounds.size[2] / 2).toBeLessThanOrEqual(origin[2] + w / 2 + slack);
            expect(bounds.center[1] - bounds.size[1] / 2).toBeGreaterThanOrEqual(origin[1] - slack);
            expect(bounds.center[1] + bounds.size[1] / 2).toBeLessThanOrEqual(origin[1] + h + slack);
            for (const value of [...part.position, ...part.size, ...(part.rotation ?? [])]) expect(Number.isFinite(value)).toBe(true);
            expect(part.size.every((side) => side > 0)).toBe(true);
          }
        }
      }
    }
  });

  it('состав: поля, 4 кольца тульи с сужением, 2 складки-тора; лицо добавляет 2 глаза и рот', () => {
    const bare = sortingHat(0.36, 0.35, { color: '#4a3f33', face: 'none' });
    expect(bare.filter((part) => part.shape === 'cylinder')).toHaveLength(5);
    expect(bare.filter((part) => part.shape === 'torus')).toHaveLength(2);
    expect(bare.filter((part) => part.shape === 'box')).toHaveLength(0);
    // Поля — во всю ширину; макушка — конус; диаметры тульи убывают снизу вверх.
    expect(bare[0]).toMatchObject({ shape: 'cylinder', size: [0.36, 0.03 * 0.35, 0.36] });
    const crown = bare.filter((part) => part.shape === 'cylinder').slice(1);
    expect(crown[3].taper).toBe(0);
    for (let index = 1; index < crown.length; index++) {
      expect(crown[index].size[0]).toBeLessThan(crown[index - 1].size[0]);
      expect(crown[index].position[1]).toBeGreaterThan(crown[index - 1].position[1]);
      // Макушка заваливается назад (−Z).
      expect(crown[index].position[2]).toBeLessThanOrEqual(crown[index - 1].position[2] + EPS);
    }
    // Складки лежат горизонтально.
    for (const fold of bare.filter((part) => part.shape === 'torus')) expect(fold.rotation?.[0]).toBeCloseTo(Math.PI / 2, 9);
    for (const part of bare) expect(part.roughness).toBe(0.85);

    const glow = sortingHat(0.36, 0.35, { color: '#4a3f33', face: 'glow', glowColor: '#ffab3d', glow: 1 });
    const features = glow.filter((part) => part.shape === 'box');
    expect(glow.length).toBeGreaterThanOrEqual(bare.length + 3);
    expect(features.length).toBeGreaterThanOrEqual(3);
    for (const feature of features) {
      expect(feature.look).toBe('glow');
      expect(feature.color).toBe('#ffab3d');
      // Лицо смотрит вперёд (+Z).
      expect(feature.position[2]).toBeGreaterThan(0);
    }
    // Глаза — на 0.42h, симметричны, с противоположным креном (злой прищур); рот — ниже.
    const eyes = features.filter((part) => Math.abs(part.position[1] - 0.42 * 0.35) < 1e-9);
    expect(eyes).toHaveLength(2);
    expect(eyes[0].position[0]).toBeCloseTo(-eyes[1].position[0], 9);
    expect(eyes[0].rotation![2]).toBeCloseTo(-eyes[1].rotation![2], 9);
    expect(Math.abs(eyes[0].rotation![2])).toBeGreaterThan(15 * DEG);
    const mouth = features.filter((part) => !eyes.includes(part));
    for (const part of mouth) expect(part.position[1]).toBeLessThan(0.25 * 0.35);

    const dark = sortingHat(0.36, 0.35, { color: '#7a4a22', face: 'dark' });
    for (const feature of dark.filter((part) => part.shape === 'box')) {
      expect(feature.look).toBeUndefined();
      expect(feature.color).toBe(shade('#7a4a22', 0.3));
    }
  });

  it('origin сдвигает шляпу целиком; seed меняет макушку, но не поля', () => {
    const at0 = sortingHat(0.25, 0.25, { color: '#7a4a22', face: 'dark' });
    const moved = sortingHat(0.25, 0.25, { color: '#7a4a22', face: 'dark', origin: [1, 2, 3] });
    expect(moved.length).toBe(at0.length);
    moved.forEach((part, index) => {
      expect(part.position[0]).toBeCloseTo(at0[index].position[0] + 1, 9);
      expect(part.position[1]).toBeCloseTo(at0[index].position[1] + 2, 9);
      expect(part.position[2]).toBeCloseTo(at0[index].position[2] + 3, 9);
      expect(part.size).toEqual(at0[index].size);
    });
    const a = sortingHat(0.25, 0.25, { color: '#7a4a22', face: 'dark', seed: 1 });
    const b = sortingHat(0.25, 0.25, { color: '#7a4a22', face: 'dark', seed: 2 });
    expect(a).toEqual(sortingHat(0.25, 0.25, { color: '#7a4a22', face: 'dark', seed: 1 }));
    expect(a).not.toEqual(b);
    expect(a[0]).toEqual(b[0]);
  });

  it('faceGlowColor: 0 — тлеет, 1 — как есть, 2 — выбелен; мусор не ломает', () => {
    expect(faceGlowColor('#ffab3d', 1)).toBe('#ffab3d');
    expect(faceGlowColor('#ffab3d', 0)).toBe(shade('#ffab3d', 0.2));
    expect(faceGlowColor('#ffab3d', 2)).not.toBe('#ffab3d');
    expect(faceGlowColor('#ffab3d', 99)).toBe(faceGlowColor('#ffab3d', 2));
    expect(faceGlowColor('#ffab3d', Number.NaN)).toBe('#ffab3d');
  });

  it('помощники чтения параметров и rgba', () => {
    const params = { n: 3, bad: Number.NaN, text: 'x', flag: false, color: '#A1b2C3', short: '#fff' } as Params;
    expect(paramNumber(params, 'n', 1)).toBe(3);
    expect(paramNumber(params, 'bad', 1)).toBe(1);
    expect(paramNumber(params, 'text', 1)).toBe(1);
    expect(paramNumber(params, 'missing', 1)).toBe(1);
    expect(paramFlag(params, 'flag', true)).toBe(false);
    expect(paramFlag(params, 'n', true)).toBe(true);
    expect(paramColor(params, 'color', '#000000')).toBe('#A1b2C3');
    expect(paramColor(params, 'short', '#000000')).toBe('#000000');
    expect(paramColor(params, 'n', '#000000')).toBe('#000000');
    expect(rgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(rgba('red', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(rgba('#ffffff', Number.NaN)).toBe('rgba(255, 255, 255, 1)');
  });

  it('aimY / axisY / eulerOfBasis / rod: ось Y части смотрит вдоль заданного направления', () => {
    const directions: Vec3[] = [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 2, 3],
      [-0.3, -0.9, 0.2],
      [0.001, 0.0001, -5],
    ];
    for (const direction of directions) {
      const length = Math.hypot(...direction);
      const axis = axisY(aimY(direction));
      for (let index = 0; index < 3; index++) expect(axis[index]).toBeCloseTo(direction[index] / length, 6);
    }
    // Вырожденное направление → вертикаль.
    expect(axisY(aimY([0, 0, 0]))[1]).toBeCloseTo(1, 9);
    expect(eulerOfBasis([1, 0, 0], [0, 1, 0], [0, 0, 1])).toEqual([0, 0, 0]);

    const part = rod([0, 0, 0], [0.3, 0.4, 0], 0.02, { color: '#ffffff' });
    expect(part).toMatchObject({ shape: 'cylinder', color: '#ffffff' });
    expect(part.size[1]).toBeCloseTo(0.5, 9);
    expect(part.position).toEqual([0.15, 0.2, 0]);
    const axis = axisY(part.rotation!);
    expect(axis[0]).toBeCloseTo(0.6, 6);
    expect(axis[1]).toBeCloseTo(0.8, 6);
    // Нулевая длина не даёт нулевого размера.
    expect(rod([1, 1, 1], [1, 1, 1], 0.02, { color: '#ffffff' }).size[1]).toBeGreaterThan(0);
  });
});

describe('hp.dementor', () => {
  const { item, painters } = dementor;
  const [w, h] = item.size;
  const sleeves = (parts: Part[]) => parts.filter((part) => part.shape === 'cylinder' && part.taper === 0.6);

  it('при arms = 1 (и 0) проходит checkBuild на всех размерах', () => {
    for (const size of SIZES[item.id]) {
      for (const arms of [0, 0.5, 1]) {
        for (const hover of [0, 0.4]) {
          expect(checkBuild(item, painters, { size, params: { arms, hover, tatter: 1 } })).toEqual([]);
        }
      }
    }
  });

  it('рукава: 2 шт., подвешены за плечи, развод ограничен — нижний конец не дальше 0.45w', () => {
    for (const arms of [0, 0.5, 1]) {
      const pair = sleeves(build(item, { params: { arms } }));
      expect(pair).toHaveLength(2);
      const length = 0.4 * h;
      const spreadMax = Math.asin(Math.min(1, (0.25 * w) / length));
      pair.forEach((sleeve, index) => {
        const sign = index === 0 ? -1 : 1;
        const spread = arms * spreadMax;
        expect(sleeve.size[1]).toBeCloseTo(length, 9);
        expect(sleeve.rotation![2]).toBeCloseTo(sign * spread, 9);
        // Верхний конец — в точке подвеса (±0.2w, 0.76h).
        const axis = axisY(sleeve.rotation!);
        expect(sleeve.position[0] + (axis[0] * length) / 2).toBeCloseTo(sign * 0.2 * w, 9);
        expect(sleeve.position[1] + (axis[1] * length) / 2).toBeCloseTo(0.76 * h, 9);
        // Нижний конец — не дальше 0.45w от оси.
        expect(Math.abs(sleeve.position[0] - (axis[0] * length) / 2)).toBeLessThanOrEqual(0.45 * w + EPS);
      });
    }
    // arms раздвигает рукава.
    const closed = sleeves(build(item, { params: { arms: 0 } }));
    const open = sleeves(build(item, { params: { arms: 1 } }));
    expect(Math.abs(open[1].position[0])).toBeGreaterThan(Math.abs(closed[1].position[0]));
  });

  it('лохмотья: round(8 + 10·tatter) полос; стойка включается и выключается', () => {
    const strips = (tatter: number) => build(item, { params: { tatter, showBase: false } }).filter((part) => part.shape === 'box').length - 1;
    expect(strips(0)).toBe(8);
    expect(strips(0.6)).toBe(14);
    expect(strips(1)).toBe(18);
    const withBase = build(item);
    const noBase = build(item, { params: { showBase: false } });
    expect(withBase.length).toBe(noBase.length + 2);
    expect(withBase.filter((part) => part.color === '#cdbf9c')).toHaveLength(2);
    expect(noBase.filter((part) => part.color === '#cdbf9c')).toHaveLength(0);
  });

  it('подол поднимается на hover, ни одна часть не уходит под пол; провал лица — glow, смотрит вперёд', () => {
    for (const hover of [0, 0.2, 0.4]) {
      const parts = build(item, { params: { hover, showBase: false } });
      for (const part of parts) {
        const bounds = partBounds(part);
        expect(bounds.center[1] - bounds.size[1] / 2).toBeGreaterThanOrEqual(-1e-6);
      }
      // Нижнее кольцо плаща начинается на hover.
      const cloak = parts[0];
      expect(cloak.position[1] - cloak.size[1] / 2).toBeCloseTo(hover, 9);
    }
    const face = build(item).filter((part) => part.look === 'glow');
    expect(face).toHaveLength(1);
    expect(face[0]).toMatchObject({ shape: 'sphere', color: '#020203' });
    expect(face[0].position[2]).toBeGreaterThan(0);
  });

  it('ткань — цвет объекта', () => {
    const parts = build(item, { color: '#223344', params: { showBase: false } });
    expect(parts.filter((part) => part.color === '#223344').length).toBeGreaterThanOrEqual(8);
    expect(drawCalls(build(item))).toBeLessThanOrEqual(9);
  });
});

describe('hp.hatLantern', () => {
  const { item } = hatLantern;

  it('шляпа со светящимся лицом + аддитивное пятно света на столе', () => {
    const parts = build(item);
    const disc = parts.filter((part) => part.additive);
    expect(disc).toHaveLength(1);
    expect(disc[0]).toMatchObject({
      shape: 'plane',
      look: 'glow',
      opacity: 0.45,
      paint: { painter: 'hp.glowDisc', args: { color: '#ffab3d' }, px: [128, 128] },
    });
    expect(disc[0].size[0]).toBeCloseTo(1.6 * 0.36, 9);
    expect(disc[0].position[1]).toBeCloseTo(0.002, 9);
    // Плоскость лежит горизонтально.
    expect(Math.abs(disc[0].rotation![0])).toBeCloseTo(Math.PI / 2, 9);
    expect(parts.filter((part) => part.look === 'glow' && !part.additive).length).toBeGreaterThanOrEqual(3);
    expect(drawCalls(parts)).toBeLessThanOrEqual(8);
  });

  it('яркость и цвет свечения: opacity = 0.45·glow, при glow = 0 пятна нет; цвет попадает в лицо и painter', () => {
    expect(build(item, { params: { glow: 2 } }).find((part) => part.additive)?.opacity).toBeCloseTo(0.9, 9);
    expect(build(item, { params: { glow: 0 } }).some((part) => part.additive)).toBe(false);
    const blue = build(item, { params: { glowColor: '#3366ff' } });
    expect(blue.find((part) => part.additive)?.paint?.args).toEqual({ color: '#3366ff' });
    expect(blue.filter((part) => part.look === 'glow' && !part.additive).every((part) => part.color === '#3366ff')).toBe(true);
    // Кожа — цвет объекта.
    expect(build(item, { color: '#101010' })[0].color).toBe('#101010');
  });
});

describe('hp.mandrakes', () => {
  const { item, painters } = mandrakes;
  const pots = (parts: Part[]) => parts.filter((part) => part.shape === 'cylinder' && part.taper === 1.3);
  const roots = (parts: Part[]) => parts.filter((part) => part.paint?.painter === 'hp.mandrakeFace');

  it('при minSize проходит checkBuild — со шляпой и без, при любом числе горшков и seed', () => {
    for (const size of [item.minSize!, [0.3, 0.4, 0.45] as Vec3, [0.6, 0.3, 0.25] as Vec3]) {
      for (const withHat of [true, false]) {
        for (const count of [3, 6, 12]) {
          for (const seed of [1, 2, 3, 50]) {
            expect(checkBuild(item, painters, { size, params: { withHat, pots: count, seed } })).toEqual([]);
          }
        }
      }
    }
  });

  it('параметр «Горшки» меняет число горшков; их не больше заданного', () => {
    const big: Vec3 = [1.5, 0.4, 1.2];
    for (const count of [3, 6, 12]) {
      const parts = build(item, { size: big, params: { pots: count } });
      expect(pots(parts)).toHaveLength(count);
      expect(roots(parts)).toHaveLength(count);
    }
    for (const seed of [1, 2, 3]) {
      expect(pots(build(item, { params: { pots: 12, seed } })).length).toBeLessThanOrEqual(12);
      expect(pots(build(item, { params: { pots: 3, seed } }))).toHaveLength(3);
    }
  });

  it('площадной предмет: горшки держат размер, бо́льшая площадка вмещает их больше', () => {
    const small = build(item, { size: [0.3, 0.3, 0.25], params: { pots: 12 } });
    const normal = build(item, { params: { pots: 12 } });
    const large = build(item, { size: [1.5, 0.4, 1.2], params: { pots: 12 } });
    expect(pots(small).length).toBeGreaterThanOrEqual(1);
    expect(pots(small).length).toBeLessThan(pots(large).length);
    expect(pots(normal).length).toBeLessThanOrEqual(pots(large).length);
    for (const parts of [small, normal, large]) {
      for (const pot of pots(parts)) expect(pot.size).toEqual([0.07, 0.05, 0.07]);
    }
  });

  it('горшки: не ближе 0.11 м друг к другу, не ближе 0.06 м к краям, со шляпой — в передних 60 %', () => {
    for (const size of [item.size, [1.5, 0.4, 1.2] as Vec3, [0.3, 0.3, 0.25] as Vec3]) {
      for (const seed of [1, 2, 3, 4]) {
        const [w, , d] = size;
        const centers = pots(build(item, { size, params: { pots: 12, seed } })).map((pot) => pot.position);
        centers.forEach((a, index) => {
          expect(Math.abs(a[0])).toBeLessThanOrEqual(w / 2 - 0.06 + EPS);
          expect(a[2]).toBeLessThanOrEqual(d / 2 - 0.06 + EPS);
          expect(a[2]).toBeGreaterThanOrEqual(Math.min(d / 2 - 0.06, -0.1 * d + 0.06) - EPS);
          for (const b of centers.slice(index + 1)) expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(0.11 - EPS);
        });
      }
    }
  });

  it('шляпа: шириной min(0.25, 0.8d, 0.8w), прижата к заднему краю изнутри; без withHat её нет', () => {
    const hatBrim = (parts: Part[]) => parts.find((part) => part.shape === 'cylinder' && part.color === '#7a4a22');
    const normal = hatBrim(build(item))!;
    expect(normal.size[0]).toBeCloseTo(0.25, 9);
    expect(normal.position[2]).toBeCloseTo(-0.1, 9);
    const tiny = hatBrim(build(item, { size: [0.3, 0.3, 0.25] }))!;
    expect(tiny.size[0]).toBeCloseTo(0.2, 9);
    expect(tiny.position[2] - tiny.size[2] / 2).toBeCloseTo(-0.125, 9);
    expect(hatBrim(build(item, { params: { withHat: false } }))).toBeUndefined();
    expect(build(item, { params: { withHat: false } }).some((part) => part.shape === 'torus')).toBe(false);
    // Лицо шляпы — тёмное, без свечения.
    expect(build(item).some((part) => part.look === 'glow')).toBe(false);
  });

  it('рожица корня повёрнута к зрителю не более чем на 25°; листьев 2–3 на горшок; цвет объекта — горшки', () => {
    const parts = build(item, { color: '#334455' });
    for (const root of roots(parts)) {
      expect(root.rotation?.[0] ?? 0).toBe(0);
      expect(Math.abs(root.rotation?.[1] ?? 0)).toBeLessThanOrEqual(25 * DEG + EPS);
      expect(root.paint?.px).toEqual([128, 128]);
    }
    const potCount = pots(parts).length;
    const leaves = parts.filter((part) => part.shape === 'sphere' && part.size[1] === 0.004).length;
    expect(leaves).toBeGreaterThanOrEqual(2 * potCount);
    expect(leaves).toBeLessThanOrEqual(3 * potCount);
    for (const pot of pots(parts)) expect(pot.color).toBe('#334455');
    expect(drawCalls(parts)).toBeLessThanOrEqual(12);
  });
});

describe('hp.dobby', () => {
  const { item } = dobby;

  it('без параметров; симметричен относительно плоскости x = 0', () => {
    expect(item.params).toEqual([]);
    const parts = build(item);
    const key = (part: Part, mirror: boolean) =>
      [part.shape, ((mirror ? -1 : 1) * part.position[0]).toFixed(6), part.position[1].toFixed(6), part.position[2].toFixed(6), part.size.map((side) => side.toFixed(6)).join(',')]
        .join('|')
        .replace(/-0\.000000/g, '0.000000');
    const plain = parts.map((part) => key(part, false)).sort();
    const mirrored = parts.map((part) => key(part, true)).sort();
    expect(mirrored).toEqual(plain);
  });

  it('голова на 0.84h, кисти сложены перед грудью, нос смотрит вперёд, наволочка чёрная', () => {
    const h = item.size[1];
    const parts = build(item);
    const head = parts.find((part) => part.shape === 'sphere' && Math.abs(part.size[0] - 0.19 * h) < 1e-9)!;
    expect(head.position[1]).toBeCloseTo(0.84 * h, 9);
    expect(head.color).toBe('#d9a98c');
    const hands = parts.filter((part) => part.shape === 'sphere' && Math.abs(part.size[0] - 0.05 * h) < 1e-9);
    expect(hands).toHaveLength(2);
    for (const hand of hands) {
      expect(Math.abs(hand.position[0])).toBeCloseTo(0.02 * h, 9);
      expect(hand.position[1]).toBeCloseTo(0.45 * h, 9);
      expect(hand.position[2]).toBeCloseTo(0.12 * h, 9);
    }
    const nose = parts.find((part) => part.taper === 0)!;
    expect(axisY(nose.rotation!)[2]).toBeGreaterThan(0.9);
    expect(nose.position[2]).toBeGreaterThan(head.position[2]);
    expect(parts.filter((part) => part.color === '#141414').length).toBe(3);
    expect(parts.filter((part) => part.color === '#cfe3c0')).toHaveLength(2);
    expect(parts.filter((part) => part.color === '#1a1a1a')).toHaveLength(2);
    expect(drawCalls(parts)).toBeLessThanOrEqual(8);
  });
});

describe('hp.owlCage', () => {
  const { item } = owlCage;
  const [w, h] = item.size;
  const isBar = (part: Part) => part.shape === 'cylinder' && !part.rotation && Math.abs(part.size[0] - 0.006) < 1e-9;
  const isRib = (part: Part) => part.shape === 'cylinder' && part.rotation !== undefined && part.taper === undefined;

  it('параметр «Прутья» меняет число прутьев и рёбер купола (вдвое меньше)', () => {
    for (const bars of [12, 20, 27, 32]) {
      const parts = build(item, { params: { bars, withOwl: false } });
      expect(parts.filter(isBar)).toHaveLength(bars);
      expect(parts.filter(isRib)).toHaveLength(Math.round(bars / 2));
      // дно + 3 обруча + прутья + купол + луковка + кольцо
      expect(parts).toHaveLength(1 + 3 + bars + Math.round(bars / 2) + 1 + 1);
    }
  });

  it('клетка: дно, 3 горизонтальных обруча Ø w, прутья по окружности R, вертикальное кольцо у самого верха', () => {
    const parts = build(item, { params: { withOwl: false } });
    const R = w / 2 - 0.005;
    expect(parts[0]).toMatchObject({ shape: 'cylinder', size: [w, 0.03, w] });
    const tori = parts.filter((part) => part.shape === 'torus');
    expect(tori).toHaveLength(4);
    const hoops = tori.filter((part) => part.rotation !== undefined);
    expect(hoops).toHaveLength(3);
    expect(hoops.map((hoop) => hoop.position[1])).toEqual([0.03, 0.32 * h, 0.62 * h]);
    for (const hoop of hoops) {
      expect(hoop.size).toEqual([w, w, 0.012]);
      expect(hoop.rotation![0]).toBeCloseTo(Math.PI / 2, 9);
    }
    const ring = tori.find((part) => part.rotation === undefined)!;
    expect(ring.size[0]).toBeCloseTo(0.05, 9);
    expect(ring.position[1] + ring.size[0] / 2).toBeCloseTo(h, 9);
    for (const bar of parts.filter(isBar)) {
      expect(Math.hypot(bar.position[0], bar.position[2])).toBeCloseTo(R, 9);
      expect(bar.position[1] + bar.size[1] / 2).toBeCloseTo(0.62 * h, 9);
    }
    // Рёбра купола идут от (R, 0.62h) к (0.35R, 0.84h).
    for (const rib of parts.filter(isRib)) {
      const axis = axisY(rib.rotation!);
      const top = rib.position.map((value, index) => value + (axis[index] * rib.size[1]) / 2);
      const bottom = rib.position.map((value, index) => value - (axis[index] * rib.size[1]) / 2);
      expect(top[1]).toBeCloseTo(0.84 * h, 6);
      expect(bottom[1]).toBeCloseTo(0.62 * h, 6);
      expect(Math.hypot(top[0], top[2])).toBeCloseTo(0.35 * R, 6);
      expect(Math.hypot(bottom[0], bottom[2])).toBeCloseTo(R, 6);
    }
    // Спереди (+Z) прута нет: сова смотрит между прутьями.
    expect(parts.filter(isBar).some((bar) => Math.abs(bar.position[0]) < 1e-6 && bar.position[2] > 0)).toBe(false);
  });

  it('цвет клетки — параметр cageColor; сова включается и выключается', () => {
    const red = build(item, { params: { cageColor: '#aa0000', withOwl: false } });
    expect(red.every((part) => part.color === '#aa0000')).toBe(true);
    const withOwl = build(item);
    const noOwl = build(item, { params: { withOwl: false } });
    expect(withOwl.length).toBeGreaterThan(noOwl.length);
    expect(noOwl.some((part) => part.paint)).toBe(false);
  });

  it('сова: тело, голова и крылья с перьями, жёлтые глаза со зрачками спереди, клюв; вся внутри прутьев', () => {
    const parts = build(item);
    const owl = parts.slice(build(item, { params: { withOwl: false } }).length);
    const feathered = owl.filter((part) => part.paint?.painter === 'hp.owlFeathers');
    expect(feathered).toHaveLength(4);
    for (const part of feathered) expect(part.paint?.px).toEqual([256, 256]);
    expect(feathered[0].size[0]).toBeCloseTo(0.62 * w, 9);
    expect(feathered[0].size[1]).toBeCloseTo(0.42 * h, 9);
    const head = feathered.find((part) => Math.abs(part.size[1] - 0.2 * h) < 1e-9)!;
    expect(head.position[1]).toBeCloseTo(0.47 * h, 9);
    const eyes = owl.filter((part) => part.color === '#f2c400');
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      expect(eye.size[0]).toBeCloseTo(0.07 * w, 9);
      expect(eye.position[2]).toBeGreaterThan(0);
    }
    const pupils = owl.filter((part) => part.shape === 'sphere' && Math.abs(part.size[0] - 0.035 * w) < 1e-9);
    expect(pupils).toHaveLength(2);
    for (const pupil of pupils) expect(pupil.position[2]).toBeGreaterThan(eyes[0].position[2]);
    const beak = owl.find((part) => part.taper === 0)!;
    expect(axisY(beak.rotation!)[1]).toBeLessThan(0);
    // Сова не протыкает клетку: каждая её часть — внутри окружности прутьев и ниже верхнего обруча.
    const R = w / 2 - 0.005;
    for (const part of owl) {
      const bounds = partBounds(part);
      expect(Math.abs(bounds.center[0]) + bounds.size[0] / 2).toBeLessThanOrEqual(R);
      expect(Math.abs(bounds.center[2]) + bounds.size[2] / 2).toBeLessThanOrEqual(R);
      expect(bounds.center[1] + bounds.size[1] / 2).toBeLessThanOrEqual(0.62 * h);
      expect(bounds.center[1] - bounds.size[1] / 2).toBeGreaterThanOrEqual(0.03 - 0.011 * h);
    }
    expect(drawCalls(parts)).toBeLessThanOrEqual(9);
  });
});

describe('hp.xmasTree', () => {
  const { item, painters } = xmasTree;
  const [w, h] = item.size;
  const tiersOf = (parts: Part[]) => parts.filter((part) => part.paint?.painter === 'hp.needles');
  const tipsOf = (parts: Part[]) => parts.filter((part) => part.shape === 'cylinder' && part.taper === 0);
  const lightsOf = (parts: Part[]) => parts.filter((part) => part.shape === 'sphere' && part.look === 'glow');
  const ballsOf = (parts: Part[]) => parts.filter((part) => part.shape === 'sphere' && part.metalness === 0.6);

  it('параметр «Ярусы» меняет число ярусов и частей; ярусы сужаются кверху и не выше макушки', () => {
    let previous = 0;
    for (const tiers of [5, 8, 12]) {
      const parts = build(item, { params: { tiers } });
      const cones = tiersOf(parts);
      expect(cones).toHaveLength(tiers);
      expect(parts.length).toBeGreaterThan(previous);
      previous = parts.length;
      const step = (0.86 * h) / tiers;
      cones.forEach((cone, index) => {
        expect(cone.taper).toBe(0.1);
        expect(cone.paint?.px).toEqual([256, 256]);
        expect(cone.size[0]).toBeCloseTo(w * Math.pow(1 - index / tiers, 0.9), 9);
        expect(cone.position[1] - cone.size[1] / 2).toBeCloseTo(0.14 * h + index * step, 9);
        expect(cone.size[1]).toBeLessThanOrEqual(1.6 * step + EPS);
        expect(cone.position[1] + cone.size[1] / 2).toBeLessThanOrEqual(h + EPS);
        // Соседние ярусы перекрываются.
        if (index > 0) {
          const below = cones[index - 1];
          expect(below.position[1] + below.size[1] / 2).toBeGreaterThan(cone.position[1] - cone.size[1] / 2);
        }
      });
      expect(cones[tiers - 1].position[1] + cones[tiers - 1].size[1] / 2).toBeCloseTo(h, 9);
    }
  });

  it('пределы: кончиков ≤ 200, огоньков ≤ 60, шаров ≤ 40 — при максимальных параметрах; checkBuild пуст', () => {
    const params = { tiers: 12, ornaments: 40, lights: true, star: true };
    const parts = build(item, { params });
    expect(tipsOf(parts).length).toBeLessThanOrEqual(MAX_TIPS);
    expect(tipsOf(parts).length).toBeGreaterThan(60);
    expect(lightsOf(parts).filter((part) => !part.paint)).toHaveLength(MAX_LIGHTS);
    expect(ballsOf(parts)).toHaveLength(MAX_ORNAMENTS);
    expect(MAX_TIPS).toBe(200);
    expect(MAX_LIGHTS).toBe(60);
    expect(MAX_ORNAMENTS).toBe(40);
    expect(parts.length).toBeLessThanOrEqual(2 + 1 + 12 + 200 + 60 + 40 + 1);
    expect(checkBuild(item, painters, { params })).toEqual([]);
    expect(drawCalls(parts)).toBeLessThanOrEqual(8);
  });

  it('кончики веток: размер 5 × 14 см, наклон наружу на 60–75° от вертикали, центр не дальше 0.9 радиуса яруса', () => {
    const parts = build(item);
    const tips = tipsOf(parts);
    expect(tips.length).toBeGreaterThan(40);
    for (const tip of tips) {
      expect(tip.size[0]).toBeCloseTo(0.05, 9);
      expect(tip.size[1]).toBeCloseTo(0.14, 9);
      const axis = axisY(tip.rotation!);
      const tilt = Math.acos(axis[1]) / DEG;
      expect(tilt).toBeGreaterThanOrEqual(60 - 1e-6);
      expect(tilt).toBeLessThanOrEqual(75 + 1e-6);
      // Ось направлена от ствола.
      const radius = Math.hypot(tip.position[0], tip.position[2]);
      expect(axis[0] * tip.position[0] + axis[2] * tip.position[2]).toBeGreaterThan(0);
      expect(radius).toBeLessThanOrEqual(0.9 * (w / 2) + EPS);
    }
    // Разброс цвета.
    expect(new Set(tips.map((tip) => tip.color)).size).toBeGreaterThan(5);
  });

  it('гирлянда, шары и звезда включаются параметрами; шары не меняют остальное', () => {
    const plain = build(item, { params: { lights: false } });
    expect(lightsOf(plain)).toHaveLength(0);
    expect(ballsOf(plain)).toHaveLength(0);
    const lit = build(item);
    expect(lightsOf(lit)).toHaveLength(MAX_LIGHTS);
    for (const bulb of lightsOf(lit)) {
      expect(bulb.size).toEqual([0.024, 0.024, 0.024]);
      expect(['#fff3d6', '#ff5a4a', '#ffc64a']).toContain(bulb.color);
    }
    for (const count of [0, 1, 17, 40]) {
      const parts = build(item, { params: { ornaments: count } });
      expect(ballsOf(parts)).toHaveLength(count);
      expect(parts.slice(0, lit.length)).toEqual(lit);
      for (const ball of ballsOf(parts)) {
        expect(ball.size[0]).toBeCloseTo(0.06, 9);
        expect(ball.roughness).toBe(0.3);
      }
    }
  });

  it('звезда: вырезанная светящаяся плоскость 14 см на макушке; ёлка под ней ниже на 10 см', () => {
    const parts = build(item, { params: { star: true } });
    const star = parts.filter((part) => part.paint?.painter === 'hp.star');
    expect(star).toHaveLength(1);
    expect(star[0]).toMatchObject({ shape: 'plane', cutout: true, doubleSided: true, look: 'glow', paint: { px: [128, 128] } });
    expect(star[0].size[0]).toBeCloseTo(0.14, 9);
    expect(star[0].size[1]).toBeCloseTo(0.14, 9);
    expect(star[0].position[1] + 0.07).toBeCloseTo(h, 9);
    const cones = tiersOf(parts);
    expect(cones[cones.length - 1].position[1] + cones[cones.length - 1].size[1] / 2).toBeCloseTo(h - 0.1, 9);
    expect(build(item).some((part) => part.paint?.painter === 'hp.star')).toBe(false);
  });

  it('крестовина — 2 бокса крест-накрест, ствол; хвоя — цвет объекта с оттенками', () => {
    const parts = build(item, { color: '#336644' });
    expect(parts[0]).toMatchObject({ shape: 'box', color: '#22302a', size: [0.4, 0.03, 0.05] });
    expect(parts[1]).toMatchObject({ shape: 'box', color: '#22302a' });
    expect(parts[1].rotation![1]).toBeCloseTo(Math.PI / 2, 9);
    expect(parts[2]).toMatchObject({ shape: 'cylinder', color: '#4a3524' });
    expect(parts[2].size[1]).toBeCloseTo(0.2 * h, 9);
    const colors = new Set(tiersOf(parts).map((cone) => cone.color));
    expect(colors.size).toBeGreaterThan(1);
    expect(tiersOf(build(item, { color: '#888888' }))[0].color).not.toBe(tiersOf(parts)[0].color);
  });
});

// ---------- Painters на макете canvas ----------

interface Call {
  name: string;
  args: unknown[];
}

const COLOR = /^(#[0-9a-fA-F]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/;

/** Записывающий макет CanvasRenderingContext2D: любые методы принимаются и запоминаются, градиенты — объект с addColorStop. */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1 };
  const gradient = {
    addColorStop: (offset: number, color: string) => {
      calls.push({ name: 'addColorStop', args: [offset, color] });
    },
  };
  const proxy = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
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
      case 'set fillStyle':
      case 'set strokeStyle':
        if (typeof args[0] === 'string' && !COLOR.test(args[0])) problems.push(`${name}: ${args[0]}`);
        if (args[0] === undefined || args[0] === null) problems.push(`${name}: пусто`);
        break;
      case 'set lineWidth':
        if (!(numbers[0] > 0)) problems.push(`set lineWidth: ${String(args[0])}`);
        break;
      case 'set font':
      case 'fillText':
      case 'strokeText':
        problems.push(`${name}: painters W7 не рисуют текст`);
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

describe('painters W7 на макете canvas', () => {
  const sizes: [number, number][] = [
    [128, 128],
    [256, 256],
    [1024, 1024],
    [64, 200],
    [1, 1],
  ];

  it('каждый painter рисует без исключений и без мусора в аргументах — при разных размерах и аргументах', () => {
    const argSets: Params[] = [{}, { color: '#3fe0a8' }, { color: 'red' }, { color: 42 } as unknown as Params];
    for (const name of Object.keys(allPainters)) {
      for (const px of sizes) {
        for (const args of argSets) {
          const calls = run(name, px, args);
          expect(calls.length, name).toBeGreaterThan(3);
          expect(canvasProblems(calls), `${name} ${px.join('×')} ${JSON.stringify(args)}`).toEqual([]);
        }
      }
    }
  });

  it('painter без аргументов (undefined) не бросает; исключение canvas не выходит наружу, контекст восстанавливается', () => {
    for (const name of Object.keys(allPainters)) {
      const { ctx, calls } = fakeContext();
      expect(() => allPainters[name](ctx, 128, 128, undefined as unknown as Params)).not.toThrow();
      expect(canvasProblems(calls)).toEqual([]);

      const log: string[] = [];
      const broken = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'save' || prop === 'restore' || prop === 'setTransform' || prop === 'fillRect') {
              return () => {
                log.push(String(prop));
              };
            }
            return () => {
              throw new Error('canvas сломан');
            };
          },
          set() {
            return true;
          },
        },
      ) as unknown as CanvasRenderingContext2D;
      expect(() => allPainters[name](broken, 128, 128, {})).not.toThrow();
      expect(log[0]).toBe('save');
      expect(log[log.length - 1]).toBe('restore');
    }
  });

  it('hp.glowDisc: радиальный градиент от цвета к прозрачности из центра canvas', () => {
    const calls = run('hp.glowDisc', [128, 128], { color: '#3366ff' });
    const radial = calls.find((call) => call.name === 'createRadialGradient')!;
    expect(radial.args).toEqual([64, 64, 0, 64, 64, 64]);
    const stops = calls.filter((call) => call.name === 'addColorStop');
    expect(stops[0].args).toEqual([0, 'rgba(51, 102, 255, 1)']);
    expect(stops[stops.length - 1].args).toEqual([1, 'rgba(51, 102, 255, 0)']);
    // Мусорный цвет → цвет по умолчанию.
    const fallback = run('hp.glowDisc', [128, 128], { color: 'red' }).filter((call) => call.name === 'addColorStop');
    expect(fallback[0].args[1]).toBe('rgba(255, 171, 61, 1)');
  });

  it('hp.mandrakeFace: рожица — в горизонтальном центре canvas и симметрична', () => {
    const width = 128;
    const calls = run('hp.mandrakeFace', [width, 128], {});
    // Глаза — два эллипса, симметричные относительно центра.
    const eyes = calls.filter((call) => call.name === 'ellipse').map((call) => call.args[0] as number);
    expect(eyes).toHaveLength(2);
    expect(eyes[0] + eyes[1]).toBeCloseTo(width, 6);
    for (const x of eyes) expect(Math.abs(x - width / 2)).toBeLessThan(width * 0.2);
    // Рот — кривая с вершиной в центре, уголки ниже середины (хмурится).
    const mouth = calls.find((call) => call.name === 'quadraticCurveTo')!;
    expect(mouth.args[0]).toBeCloseTo(width / 2, 6);
    expect(mouth.args[1] as number).toBeLessThan(mouth.args[3] as number);
  });

  it('hp.owlFeathers: белый фон, крапины не подходят к шву и полюсам', () => {
    const calls = run('hp.owlFeathers', [256, 256], {});
    expect(calls.find((call) => call.name === 'set fillStyle')?.args[0]).toBe('#ffffff');
    const starts = calls.filter((call) => call.name === 'moveTo');
    expect(starts.length).toBeGreaterThan(30);
    for (const { args } of starts) {
      expect(args[0] as number).toBeGreaterThan(0);
      expect(args[0] as number).toBeLessThan(256);
      expect(args[1] as number).toBeGreaterThan(256 * 0.15);
      expect(args[1] as number).toBeLessThan(256 * 0.92);
    }
    // Рисунок детерминирован.
    expect(JSON.stringify(run('hp.owlFeathers', [256, 256], {}))).toBe(JSON.stringify(calls));
  });

  it('hp.needles: штрихи дублируются на ±ширину (шов сходится), рисунок детерминирован', () => {
    const calls = run('hp.needles', [256, 256], {});
    const starts = calls.filter((call) => call.name === 'moveTo').map((call) => call.args as number[]);
    expect(starts.length % 3).toBe(0);
    for (let index = 0; index < starts.length; index += 3) {
      expect(starts[index + 1][0] - starts[index][0]).toBeCloseTo(256, 6);
      expect(starts[index + 2][0] - starts[index + 1][0]).toBeCloseTo(256, 6);
      expect(starts[index + 1][1]).toBe(starts[index][1]);
    }
    expect(JSON.stringify(run('hp.needles', [256, 256], {}))).toBe(JSON.stringify(calls));
  });

  it('hp.star: прозрачный фон и замкнутый десятиугольник звезды внутри canvas', () => {
    const calls = run('hp.star', [128, 128], {});
    expect(calls[1]).toEqual({ name: 'clearRect', args: [0, 0, 128, 128] });
    const points = calls.filter((call) => call.name === 'moveTo' || call.name === 'lineTo').map((call) => call.args as number[]);
    expect(points).toHaveLength(10);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(128);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(128);
    }
    // Верхний луч — по центру.
    expect(points[0][0]).toBeCloseTo(64, 6);
    expect(calls.some((call) => call.name === 'closePath')).toBe(true);
    expect(calls.some((call) => call.name === 'fill')).toBe(true);
  });

  it('guardPainter: исключение painter’а → заливка запасным цветом, без повторного исключения', () => {
    const guarded = guardPainter('hp.test', '#123456', () => {
      throw new Error('бум');
    });
    const { ctx, calls } = fakeContext();
    expect(() => guarded(ctx, 10, 20, {})).not.toThrow();
    expect(calls.some((call) => call.name === 'set fillStyle' && call.args[0] === '#123456')).toBe(true);
    expect(calls.some((call) => call.name === 'fillRect' && String(call.args) === '0,0,10,20')).toBe(true);
    expect(calls[0].name).toBe('save');
    expect(calls[calls.length - 1].name).toBe('restore');
  });
});
