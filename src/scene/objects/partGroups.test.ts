import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Part } from '../../catalog/types';
import { castsShadow, geometryKey, groupParts, materialKey, paintKey, partMatrix, taperOf, torusRatio } from './partGroups';

function part(over: Partial<Part> = {}): Part {
  return { shape: 'box', position: [0, 0, 0], size: [1, 1, 1], color: '#808080', ...over };
}

/** Применяет матрицу части к точке единичной геометрии. */
function apply(p: Part, point: [number, number, number]): number[] {
  const v = new Vector3(...point).applyMatrix4(new Matrix4().fromArray(partMatrix(p)));
  return [v.x, v.y, v.z];
}

function expectClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
}

describe('geometryKey', () => {
  it('box и plane — по одному ключу на форму', () => {
    expect(geometryKey(part({ shape: 'box', size: [1, 2, 3] }))).toBe('box');
    expect(geometryKey(part({ shape: 'box', size: [0.1, 0.1, 0.1] }))).toBe('box');
    expect(geometryKey(part({ shape: 'plane', size: [2, 1, 0] }))).toBe('plane');
  });

  it('cylinder — ключ с сужением; по умолчанию 1, 0 — конус', () => {
    expect(geometryKey(part({ shape: 'cylinder' }))).toBe('cylinder:1');
    expect(geometryKey(part({ shape: 'cylinder', taper: 1 }))).toBe('cylinder:1');
    expect(geometryKey(part({ shape: 'cylinder', taper: 0 }))).toBe('cylinder:0');
    expect(geometryKey(part({ shape: 'cylinder', taper: 0.35 }))).toBe('cylinder:0.35');
    // Шум плавающей точки не плодит геометрии.
    expect(geometryKey(part({ shape: 'cylinder', taper: 0.1 + 0.2 }))).toBe('cylinder:0.3');
    expect(taperOf(part({ shape: 'cylinder', taper: -2 }))).toBe(0);
    expect(taperOf(part({ shape: 'cylinder', taper: Number.NaN }))).toBe(1);
  });

  it('torus — ключ с отношением t / D в два знака', () => {
    expect(geometryKey(part({ shape: 'torus', size: [1, 1, 0.1] }))).toBe('torus:0.10');
    expect(geometryKey(part({ shape: 'torus', size: [0.4, 0.4, 0.05] }))).toBe('torus:0.13');
    // Кольца разного размера с одинаковыми пропорциями делят геометрию.
    expect(geometryKey(part({ shape: 'torus', size: [2, 2, 0.2] }))).toBe('torus:0.10');
    // Отношение зажато в [0.01, 0.5].
    expect(torusRatio(part({ shape: 'torus', size: [1, 1, 0.9] }))).toBe(0.5);
    expect(torusRatio(part({ shape: 'torus', size: [1, 1, 0] }))).toBe(0.01);
    expect(torusRatio(part({ shape: 'torus', size: [0, 0, 0.1] }))).toBe(0.01);
  });

  it('sphere: с paint — sphere:uv, без paint и с matcap — sphere', () => {
    const paint = { painter: 'hp.owl', px: [256, 128] as [number, number] };
    expect(geometryKey(part({ shape: 'sphere' }))).toBe('sphere');
    expect(geometryKey(part({ shape: 'sphere', paint }))).toBe('sphere:uv');
    expect(geometryKey(part({ shape: 'sphere', paint, look: 'glow' }))).toBe('sphere:uv');
    expect(geometryKey(part({ shape: 'sphere', paint, look: 'matcap' }))).toBe('sphere');
    expect(geometryKey(part({ shape: 'sphere', look: 'matcap' }))).toBe('sphere');
  });
});

describe('materialKey', () => {
  it('цвет, положение и размер в ключ не входят', () => {
    const a = part({ color: '#ff0000', position: [1, 2, 3], size: [1, 2, 3] });
    const b = part({ color: '#00ff00', position: [0, 0, 0], size: [3, 2, 1], rotation: [0, 1, 0] });
    expect(materialKey(a, false)).toBe(materialKey(b, false));
  });

  it('умолчания подставлены: явные roughness 0.85 / metalness 0 / opacity 1 / look lit дают тот же ключ', () => {
    const explicit = part({ look: 'lit', roughness: 0.85, metalness: 0, opacity: 1, additive: false, doubleSided: false, cutout: false });
    expect(materialKey(explicit, false)).toBe(materialKey(part(), false));
  });

  it('каждое поле материала меняет ключ', () => {
    const base = materialKey(part(), false);
    const variants: Partial<Part>[] = [
      { look: 'glow' },
      { look: 'matcap' },
      { emissive: '#ff8800' },
      { emissive: '#ff8800', emissiveIntensity: 2 },
      { roughness: 0.3 },
      { metalness: 0.8 },
      { opacity: 0.5 },
      { additive: true },
      { doubleSided: true },
      { cutout: true },
      { paint: { painter: 'hp.prophetPage', px: [512, 512] } },
    ];
    const keys = variants.map((over) => materialKey(part(over), false));
    for (const key of keys) expect(key).not.toBe(base);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('призрак меняет ключ', () => {
    expect(materialKey(part(), true)).not.toBe(materialKey(part(), false));
    expect(materialKey(part({ look: 'glow' }), true)).not.toBe(materialKey(part({ look: 'glow' }), false));
  });

  it('paint различается по painter, args и px; порядок вызова не важен', () => {
    const a = part({ paint: { painter: 'p', args: { text: 'A' }, px: [256, 256] } });
    const b = part({ paint: { painter: 'p', args: { text: 'B' }, px: [256, 256] } });
    const c = part({ paint: { painter: 'p', args: { text: 'A' }, px: [512, 256] } });
    const d = part({ paint: { painter: 'q', args: { text: 'A' }, px: [256, 256] } });
    const keys = [a, b, c, d].map((p) => materialKey(p, false));
    expect(new Set(keys).size).toBe(4);
    expect(materialKey(part({ paint: { painter: 'p', args: { text: 'A' }, px: [256, 256] } }), false)).toBe(keys[0]);
    // Отсутствующие args и пустые args — один и тот же рисунок.
    expect(paintKey({ painter: 'p', px: [8, 8] })).toBe(paintKey({ painter: 'p', args: {}, px: [8, 8] }));
  });

  it('поля, не действующие на данный look, ключ не дробят', () => {
    // roughness и emissive есть только у lit.
    expect(materialKey(part({ look: 'glow', roughness: 0.2, emissive: '#ffffff' }), false)).toBe(materialKey(part({ look: 'glow' }), false));
    // emissiveIntensity без emissive ни на что не влияет.
    expect(materialKey(part({ emissiveIntensity: 3 }), false)).toBe(materialKey(part(), false));
    // Регистр цвета свечения не важен.
    expect(materialKey(part({ emissive: '#FFAA00' }), false)).toBe(materialKey(part({ emissive: '#ffaa00' }), false));
  });
});

describe('castsShadow', () => {
  it('тень отбрасывает только непрозрачная lit-часть без additive', () => {
    expect(castsShadow(part())).toBe(true);
    expect(castsShadow(part({ look: 'lit', opacity: 1 }))).toBe(true);
    expect(castsShadow(part({ look: 'glow' }))).toBe(false);
    expect(castsShadow(part({ look: 'matcap' }))).toBe(false);
    expect(castsShadow(part({ additive: true }))).toBe(false);
    expect(castsShadow(part({ opacity: 0.5 }))).toBe(false);
  });
});

describe('groupParts', () => {
  it('группирует по геометрии и материалу, порядок групп — по первому появлению', () => {
    const parts: Part[] = [
      part({ shape: 'box' }),
      part({ shape: 'cylinder' }),
      part({ shape: 'box', position: [1, 0, 0] }),
      part({ shape: 'box', look: 'glow' }),
      part({ shape: 'cylinder', taper: 0.5 }),
      part({ shape: 'cylinder', position: [0, 1, 0] }),
    ];
    const groups = groupParts(parts, false);
    expect(groups.map((g) => g.geometryKey)).toEqual(['box', 'cylinder:1', 'box', 'cylinder:0.5']);
    expect(groups.map((g) => g.parts.length)).toEqual([2, 2, 1, 1]);
    expect(groups[0].parts).toEqual([parts[0], parts[2]]);
    expect(groups[1].parts).toEqual([parts[1], parts[5]]);
    // Каждая часть попала ровно в одну группу.
    expect(groups.reduce((n, g) => n + g.parts.length, 0)).toBe(parts.length);
    expect(groups[0].materialKey).toBe(materialKey(parts[0], false));
  });

  it('цвет не дробит группы', () => {
    const parts = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'].map((color, i) => part({ color, position: [i, 0, 0] }));
    const groups = groupParts(parts, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].parts.map((p) => p.color)).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
  });

  it('призрак меняет ключ материала групп, но не состав', () => {
    const parts = [part(), part({ shape: 'sphere' }), part({ look: 'glow' })];
    const solid = groupParts(parts, false);
    const ghost = groupParts(parts, true);
    expect(ghost).toHaveLength(solid.length);
    ghost.forEach((group, i) => {
      expect(group.geometryKey).toBe(solid[i].geometryKey);
      expect(group.materialKey).not.toBe(solid[i].materialKey);
      expect(group.parts).toEqual(solid[i].parts);
    });
  });

  it('сфера с paint и сфера без него — разные группы (sphere:uv и sphere)', () => {
    const paint = { painter: 'hp.mandrake', px: [256, 128] as [number, number] };
    const groups = groupParts([part({ shape: 'sphere' }), part({ shape: 'sphere', paint })], false);
    expect(groups.map((g) => g.geometryKey)).toEqual(['sphere', 'sphere:uv']);
  });

  it('пустой список → нет групп; вход не меняется', () => {
    expect(groupParts([], false)).toEqual([]);
    const parts = Object.freeze([Object.freeze(part())]) as readonly Part[];
    expect(() => groupParts(parts, true)).not.toThrow();
  });
});

describe('partMatrix', () => {
  it('возвращает 16 чисел по столбцам: перенос — в элементах 12–14', () => {
    const m = partMatrix(part({ position: [1, 2, 3], size: [1, 1, 1] }));
    expect(m).toHaveLength(16);
    expectClose(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
  });

  it('box: единичный куб растягивается в size', () => {
    const p = part({ shape: 'box', position: [1, 0.5, -2], size: [2, 1, 0.5] });
    expectClose(apply(p, [0.5, 0.5, 0.5]), [2, 1, -1.75]);
    expectClose(apply(p, [-0.5, -0.5, -0.5]), [0, 0, -2.25]);
  });

  it('cylinder: диаметры по X и Z, высота по Y', () => {
    const p = part({ shape: 'cylinder', position: [0, 1, 0], size: [0.4, 2, 0.6] });
    expectClose(apply(p, [0.5, 0.5, 0]), [0.2, 2, 0]);
    expectClose(apply(p, [0, -0.5, 0.5]), [0, 0, 0.3]);
  });

  it('sphere: эллипсоид — три диаметра', () => {
    const p = part({ shape: 'sphere', position: [0, 0, 0], size: [2, 1, 0.5] });
    expectClose(apply(p, [0.5, 0, 0]), [1, 0, 0]);
    expectClose(apply(p, [0, 0.5, 0]), [0, 0.5, 0]);
    expectClose(apply(p, [0, 0, 0.5]), [0, 0, 0.25]);
  });

  it('plane: масштаб w × h, нулевая третья компонента size не вырождает матрицу', () => {
    const p = part({ shape: 'plane', position: [0, 1, 0.1], size: [2, 3, 0] });
    const m = partMatrix(p);
    expectClose([m[0], m[5], m[10]], [2, 3, 1]);
    expect(new Matrix4().fromArray(m).determinant()).not.toBe(0);
    expectClose(apply(p, [0.5, 0.5, 0]), [1, 2.5, 0.1]);
    expectClose(apply(p, [-0.5, -0.5, 0]), [-1, -0.5, 0.1]);
  });

  it('torus: равномерный масштаб по внешнему диаметру (сечение трубки остаётся круглым)', () => {
    const p = part({ shape: 'torus', position: [0, 0, 0], size: [0.8, 0.8, 0.1] });
    const m = partMatrix(p);
    expectClose([m[0], m[5], m[10]], [0.8, 0.8, 0.8]);
    // Внешний край единичного тора (радиус 0.5) оказывается на D / 2.
    expectClose(apply(p, [0.5, 0, 0]), [0.4, 0, 0]);
  });

  it('поворот: Эйлер XYZ, применяется после масштаба и до переноса', () => {
    // Плоскость лицом в +Z, повёрнутая на −90° вокруг X, ложится лицом вверх: локальный +Y уходит в −Z.
    const flat = part({ shape: 'plane', position: [0, 0.5, 0], size: [2, 4, 0], rotation: [-Math.PI / 2, 0, 0] });
    expectClose(apply(flat, [0, 0.5, 0]), [0, 0.5, -2]);
    expectClose(apply(flat, [0.5, 0, 0]), [1, 0.5, 0]);
    // Поворот вокруг Y на 90°: локальный +X уходит в −Z.
    const turned = part({ shape: 'box', position: [1, 0, 0], size: [2, 1, 1], rotation: [0, Math.PI / 2, 0] });
    expectClose(apply(turned, [0.5, 0, 0]), [1, 0, -1]);
  });

  it('совпадает с эталоном three: position · rotation(XYZ) · scale', () => {
    const p = part({ shape: 'box', position: [0.3, 1.2, -0.7], size: [0.5, 1.5, 0.25], rotation: [0.4, -1.1, 2.3] });
    const expected = new Matrix4()
      .makeTranslation(0.3, 1.2, -0.7)
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(0.4, -1.1, 2.3, 'XYZ')))
      .multiply(new Matrix4().makeScale(0.5, 1.5, 0.25));
    expectClose(partMatrix(p), expected.toArray());
  });

  it('не делит состояние между вызовами', () => {
    const a = partMatrix(part({ position: [1, 0, 0] }));
    const b = partMatrix(part({ position: [2, 0, 0] }));
    expect(a[12]).toBe(1);
    expect(b[12]).toBe(2);
    expect(a).not.toBe(b);
  });
});
