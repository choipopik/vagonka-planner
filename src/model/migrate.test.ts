import { describe, expect, it } from 'vitest';
import { createLayout } from './layout';
import { LAYOUT_LIMITS, LAYOUT_PATTERNS, LayoutFormatError, parseLayout } from './migrate';
import type { LayoutErrorCode } from './migrate';
import { sanitizeLayout } from './ops';
import { testRoom } from './testRoom';
import { SCHEMA_VERSION } from './types';
import type { Layout, Mount, SceneObject } from './types';

type Raw = Record<string, unknown>;

const ASSET = 'a_0123456789abcdef0123456789abcdef';

function obj(id: string, over: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    kind: 'primitive',
    type: 'box',
    origin: 'user',
    name: id,
    mount: { kind: 'floor', x: 1, z: 2, lift: 0 },
    rotationY: 0,
    size: [0.5, 0.5, 0.5],
    color: '#808080',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

function layoutOf(objects: unknown[], over: Raw = {}): Raw {
  return { schemaVersion: 2, id: 'layout-1', name: 'Макет', roomId: 'test', objects, updatedAt: 1234, ...over };
}

/** Как из localStorage или файла: через JSON. */
const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function parse(raw: unknown): { layout: Layout; drops: { index: number; reason: string }[] } {
  const drops: { index: number; reason: string }[] = [];
  const layout = parseLayout(raw, (index, reason) => drops.push({ index, reason }));
  return { layout, drops };
}

function errorCode(raw: unknown): LayoutErrorCode | 'no-error' | 'other-error' {
  try {
    parseLayout(raw);
    return 'no-error';
  } catch (error) {
    return error instanceof LayoutFormatError ? error.code : 'other-error';
  }
}

/** Один испорченный объект между двумя хорошими: плохой отброшен, соседи целы. */
function expectDropped(bad: unknown, note: string) {
  const { layout, drops } = parse(layoutOf([obj('before'), bad, obj('after')]));
  expect(layout.objects.map((o) => o.id), note).toEqual(['before', 'after']);
  expect(drops, note).toHaveLength(1);
  expect(drops[0].index, note).toBe(1);
  expect(drops[0].reason.length, note).toBeGreaterThan(0);
}

function expectKept(good: unknown, note: string): SceneObject {
  const { layout, drops } = parse(layoutOf([good]));
  expect(drops, note).toEqual([]);
  expect(layout.objects, note).toHaveLength(1);
  return layout.objects[0];
}

describe('parseLayout · текущая схема', () => {
  it('принимает результат createLayout без единого onDrop', () => {
    const created = createLayout(testRoom, 'Свадьба');
    const { layout, drops } = parse(viaJson(created));
    expect(drops).toEqual([]);
    expect(layout).toEqual(created);
    expect(layout.schemaVersion).toBe(SCHEMA_VERSION);
    // Разобранный макет — уже чистый: sanitizeLayout ничего не меняет.
    expect(sanitizeLayout(layout, testRoom)).toBe(layout);
  });

  it('объекты пересобираются по полям: лишние ключи не переносятся, вход не мутируется', () => {
    const raw = layoutOf([{ ...obj('a'), position: [1, 2, 3], evil: { deep: true }, constructor: 'x' }], { extra: 1, objectsBackup: [] });
    const frozen = structuredClone(raw);
    const { layout, drops } = parse(raw);
    expect(raw).toEqual(frozen);
    expect(drops).toEqual([]);
    expect(Object.keys(layout).sort()).toEqual(['id', 'name', 'objects', 'roomId', 'schemaVersion', 'updatedAt']);
    expect(Object.keys(layout.objects[0]).sort()).toEqual(Object.keys(obj('a')).sort());
    expect(layout.objects[0]).toEqual(obj('a'));
    // Результат не разделяет ссылок со входом.
    expect(layout.objects[0].size).not.toBe((raw.objects as SceneObject[])[0].size);
    expect(layout.objects[0].mount).not.toBe((raw.objects as SceneObject[])[0].mount);
    expect(layout.objects[0].params).not.toBe((raw.objects as SceneObject[])[0].params);
  });

  it('все четыре крепления переживают разбор; лишние ключи крепления не переносятся', () => {
    const mounts: Mount[] = [
      { kind: 'floor', x: -1.5, z: 2, lift: 0.3 },
      { kind: 'ceiling', x: 1, z: -2, drop: 0.4 },
      { kind: 'wall', surfaceId: 'far', along: 3.2, bottom: 1.2 },
      { kind: 'surface', hostId: 'venue-table', u: 0.1, v: -0.2 },
    ];
    for (const mount of mounts) {
      const kept = expectKept(viaJson(obj('a', { mount: { ...mount, junk: 1 } as unknown as Mount })), mount.kind);
      expect(kept.mount, mount.kind).toEqual(mount);
    }
  });

  it('настенное крепление на грани колонны, типы с точкой и assetId вида a_… — без единого onDrop', () => {
    const source: Layout = {
      schemaVersion: 2,
      id: 'layout-hp',
      name: 'Гарри Поттер',
      roomId: 'test',
      updatedAt: 42,
      objects: [
        obj('poster', { kind: 'image', type: 'image', mount: { kind: 'wall', surfaceId: 'col:s', along: 0.4, bottom: 1.2 }, assetId: ASSET, size: [0.6, 0.8, 0.02] }),
        obj('spot', { kind: 'light', type: 'light.spot', mount: { kind: 'ceiling', x: 1, z: 1, drop: 0.2 }, params: { intensity: 40, tilt: 15 } }),
        obj('flat', { kind: 'image', type: 'image.flat', assetId: ASSET, size: [1, 0.02, 0.7], params: { glow: true } }),
        obj('dementor', { kind: 'preset', type: 'hp.dementor', size: [0.9, 2, 0.7], params: { arms: 0.5, showBase: true, seed: 7 } }),
        obj('gltf', { kind: 'model', type: 'model', assetId: 'a_ffffffffffffffffffffffffffffffff' }),
        obj('col-n', { mount: { kind: 'wall', surfaceId: 'col-left:n', along: 0.2, bottom: 0 } }),
      ],
    };
    const { layout, drops } = parse(JSON.parse(JSON.stringify(source)));
    expect(drops).toEqual([]);
    expect(layout).toEqual(source);
  });

  it('неизвестный type сохраняется (рисуется заглушкой)', () => {
    const kept = expectKept(viaJson(obj('a', { type: 'future.thing-2', kind: 'preset' })), 'unknown type');
    expect(kept.type).toBe('future.thing-2');
    expect(kept.kind).toBe('preset');
  });

  it('surfaceId вида col:x и type с пробелом отбрасываются', () => {
    expectDropped(obj('a', { mount: { kind: 'wall', surfaceId: 'col:x', along: 1, bottom: 1 } }), 'col:x');
    expectDropped(obj('a', { mount: { kind: 'wall', surfaceId: 'col:s:n', along: 1, bottom: 1 } }), 'col:s:n');
    expectDropped(obj('a', { mount: { kind: 'wall', surfaceId: 'far wall', along: 1, bottom: 1 } }), 'far wall');
    expectDropped(obj('a', { type: 'hp dementor' }), 'type с пробелом');
    expectDropped(obj('a', { type: '.hidden' }), 'type с точки');
    expectDropped(obj('a', { type: '' }), 'пустой type');
    expectDropped(obj('a', { type: 'x'.repeat(65) }), 'длинный type');
  });

  it('NaN, Infinity и числа за пределами LAYOUT_LIMITS отбрасывают объект', () => {
    const floor = (x: number, z: number, lift: number): Mount => ({ kind: 'floor', x, z, lift });
    expectDropped(obj('a', { mount: floor(NaN, 0, 0) }), 'x NaN');
    expectDropped(obj('a', { mount: floor(0, Infinity, 0) }), 'z Infinity');
    expectDropped(obj('a', { mount: floor(0, 0, -Infinity) }), 'lift −Infinity');
    expectDropped(obj('a', { mount: floor(LAYOUT_LIMITS.coord + 1, 0, 0) }), 'x > coord');
    expectDropped(obj('a', { mount: { kind: 'ceiling', x: 0, z: 0, drop: NaN } }), 'drop NaN');
    expectDropped(obj('a', { mount: { kind: 'wall', surfaceId: 'far', along: Infinity, bottom: 0 } }), 'along Infinity');
    expectDropped(obj('a', { mount: { kind: 'surface', hostId: 'b', u: 0, v: NaN } }), 'v NaN');
    expectDropped(obj('a', { rotationY: NaN }), 'rotationY NaN');
    expectDropped(obj('a', { rotationY: Infinity }), 'rotationY Infinity');
    expectDropped(obj('a', { size: [NaN, 1, 1] }), 'size NaN');
    expectDropped(obj('a', { size: [1, Infinity, 1] }), 'size Infinity');
    expectDropped(obj('a', { size: [1, 1, 0] }), 'size 0');
    expectDropped(obj('a', { size: [1, -1, 1] }), 'size < 0');
    expectDropped(obj('a', { size: [LAYOUT_LIMITS.sizeMin / 2, 1, 1] }), 'size < sizeMin');
    expectDropped(obj('a', { size: [1, 1, LAYOUT_LIMITS.sizeMax + 1] }), 'size > sizeMax');
    // После JSON не-числа превращаются в null — тоже отбрасываются.
    expectDropped(viaJson(obj('a', { mount: floor(NaN, 0, 0) })), 'x null');
    expectDropped(viaJson(obj('a', { size: [1, Infinity, 1] })), 'size null');
    // Границы допустимы.
    expectKept(obj('a', { mount: floor(LAYOUT_LIMITS.coord, -LAYOUT_LIMITS.coord, 0), size: [LAYOUT_LIMITS.sizeMin, 1, LAYOUT_LIMITS.sizeMax] }), 'границы');
  });

  it('плохие цвета и id отбрасывают объект', () => {
    for (const color of ['red', '#fff', '#12345g', '#1234567', 'rgb(0,0,0)', '', ' #808080']) {
      expectDropped(obj('a', { color }), `цвет '${color}'`);
    }
    expect(expectKept(obj('a', { color: '#AbCdEf' }), 'верхний регистр').color).toBe('#AbCdEf');
    for (const id of ['', 'a b', 'a/b', 'a:b', 'ё', 'x'.repeat(65), '<script>']) {
      expectDropped(obj(id), `id '${id}'`);
    }
    expectDropped({ ...obj('a'), id: 7 }, 'id — число');
    expectDropped(obj('a', { mount: { kind: 'surface', hostId: 'no such id!', u: 0, v: 0 } }), 'hostId');
    expectDropped(obj('a', { assetId: 'a_123' }), 'короткий assetId');
    expectDropped(obj('a', { assetId: 'a_0123456789ABCDEF0123456789ABCDEF' }), 'assetId в верхнем регистре');
    expectDropped(obj('a', { assetId: '../../etc/passwd' }), 'assetId — путь');
    expect(expectKept(obj('a', { assetId: ASSET }), 'assetId').assetId).toBe(ASSET);
  });

  it('неизвестный kind, крепление, origin и испорченные поля отбрасывают объект', () => {
    expectDropped({ ...obj('a'), kind: 'hologram' }, 'kind');
    expectDropped({ ...obj('a'), kind: undefined }, 'нет kind');
    expectDropped({ ...obj('a'), mount: { kind: 'orbit', x: 0, z: 0 } }, 'mount.kind');
    expectDropped({ ...obj('a'), mount: null }, 'mount null');
    expectDropped({ ...obj('a'), mount: { kind: 'floor', x: 0, z: 0 } }, 'нет lift');
    expectDropped({ ...obj('a'), origin: 'admin' }, 'origin');
    expectDropped({ ...obj('a'), name: 5 }, 'name');
    expectDropped({ ...obj('a'), size: [1, 1] }, 'size из двух');
    expectDropped({ ...obj('a'), size: '1,1,1' }, 'size строкой');
    expectDropped({ ...obj('a'), size: ['1', 1, 1] }, 'size со строкой');
    expectDropped({ ...obj('a'), locked: 'yes' }, 'locked');
    expectDropped({ ...obj('a'), visible: 1 }, 'visible');
    expectDropped({ ...obj('a'), params: [1, 2] }, 'params массивом');
    expectDropped(null, 'null');
    expectDropped('строка', 'строка');
    expectDropped([obj('a')], 'массив');
    expectDropped(42, 'число');
  });

  it('дубликаты id: остаётся первый, остальные передаются в onDrop', () => {
    const { layout, drops } = parse(layoutOf([obj('a', { color: '#111111' }), obj('b'), obj('a', { color: '#222222' }), obj('a')]));
    expect(layout.objects.map((o) => o.id)).toEqual(['a', 'b']);
    expect(layout.objects[0].color).toBe('#111111');
    expect(drops.map((d) => d.index)).toEqual([2, 3]);
  });

  it('onDrop получает индекс в исходном списке и причину; без onDrop не бросает', () => {
    const raw = layoutOf([obj('a'), { ...obj('b'), color: 'red' }, obj('c'), { ...obj('d'), kind: 'x' }, obj('a')]);
    const { layout, drops } = parse(raw);
    expect(layout.objects.map((o) => o.id)).toEqual(['a', 'c']);
    expect(drops.map((d) => d.index)).toEqual([1, 3, 4]);
    for (const d of drops) expect(typeof d.reason).toBe('string');
    expect(new Set(drops.map((d) => d.reason)).size).toBe(3);
    expect(parseLayout(raw).objects.map((o) => o.id)).toEqual(['a', 'c']);
  });

  it('__proto__ в params и в объекте: у результата чистый прототип', () => {
    const text = JSON.stringify(layoutOf([obj('a')])).replace(
      '"params":{}',
      '"params":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"count":3,"label":"x","on":true},"__proto__":{"polluted":true}',
    );
    expect(text).toContain('__proto__');
    const { layout, drops } = parse(JSON.parse(text));
    expect(drops).toEqual([]);
    const o = layout.objects[0];
    expect(o.params).toEqual({ count: 3, label: 'x', on: true });
    expect(Object.keys(o.params).sort()).toEqual(['count', 'label', 'on']);
    expect(Object.getPrototypeOf(o.params)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(o.mount)).toBe(Object.prototype);
    expect((o.params as Raw).polluted).toBeUndefined();
    expect((o as unknown as Raw).polluted).toBeUndefined();
    expect(({} as Raw).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(o.params, '__proto__')).toBe(false);

    // __proto__ на уровне макета тоже не переносится.
    const top = JSON.parse(`{"__proto__":{"id":"evil","objects":[]},"schemaVersion":2,"id":"layout-1","name":"n","roomId":"test","objects":[],"updatedAt":0}`) as unknown;
    const parsed = parseLayout(top);
    expect(parsed.id).toBe('layout-1');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('унаследованные поля не читаются: объект должен нести свои собственные', () => {
    const inherited = Object.create(obj('a')) as Raw;
    expectDropped(inherited, 'всё унаследовано');
    const noLayoutId = Object.create({ id: 'layout-1' }) as Raw;
    Object.assign(noLayoutId, { schemaVersion: 2, name: 'n', roomId: 'test', objects: [], updatedAt: 0 });
    expect(errorCode(noLayoutId)).toBe('bad-layout');
  });

  it('params: переносятся только простые значения под допустимыми ключами', () => {
    const kept = expectKept(
      {
        ...obj('a'),
        params: {
          count: 5,
          text: 'строка',
          flag: false,
          bad: NaN,
          inf: Infinity,
          nested: { a: 1 },
          list: [1],
          nothing: null,
          '1starts': 1,
          'with-dash': 1,
          'with space': 1,
          _under: 1,
          ['x'.repeat(33)]: 1,
          long: 'я'.repeat(LAYOUT_LIMITS.paramString + 1),
          max: 'я'.repeat(LAYOUT_LIMITS.paramString),
          ok_Key9: 'да',
        },
      },
      'params',
    );
    expect(kept.params).toEqual({ count: 5, text: 'строка', flag: false, max: 'я'.repeat(LAYOUT_LIMITS.paramString), ok_Key9: 'да' });
    // params отсутствуют → {}.
    const bare: Raw = { ...obj('b') };
    delete bare.params;
    expect(expectKept(bare, 'нет params').params).toEqual({});
    // Слишком много ключей — объект негоден.
    const many: Raw = {};
    for (let i = 0; i <= LAYOUT_LIMITS.paramKeys; i++) many[`k${i}`] = i;
    expectDropped({ ...obj('c'), params: many }, 'слишком много ключей');
    const fits: Raw = {};
    for (let i = 0; i < LAYOUT_LIMITS.paramKeys; i++) fits[`k${i}`] = i;
    expect(Object.keys(expectKept({ ...obj('d'), params: fits }, 'ровно предел').params)).toHaveLength(LAYOUT_LIMITS.paramKeys);
  });

  it('assetId отсутствует → null; имена обрезаются до предела', () => {
    const bare: Raw = { ...obj('a', { name: 'я'.repeat(LAYOUT_LIMITS.name + 30) }) };
    delete bare.assetId;
    const kept = expectKept(bare, 'нет assetId');
    expect(kept.assetId).toBeNull();
    expect(kept.name).toBe('я'.repeat(LAYOUT_LIMITS.name));
    const { layout } = parse(layoutOf([], { name: 'м'.repeat(500) }));
    expect(layout.name).toHaveLength(LAYOUT_LIMITS.name);
  });

  it('updatedAt: конечное неотрицательное число, иначе 0', () => {
    expect(parse(layoutOf([], { updatedAt: 987 })).layout.updatedAt).toBe(987);
    for (const updatedAt of [NaN, -1, Infinity, '2026', null, undefined]) {
      expect(parse(layoutOf([], { updatedAt })).layout.updatedAt, String(updatedAt)).toBe(0);
    }
  });
});

describe('parseLayout · структурный мусор', () => {
  it('не объект → not-object', () => {
    for (const raw of [null, undefined, 42, 'layout', true, [], [layoutOf([])]]) {
      expect(errorCode(raw), JSON.stringify(raw)).toBe('not-object');
    }
  });

  it('более новая версия → newer-version', () => {
    expect(errorCode(layoutOf([], { schemaVersion: SCHEMA_VERSION + 1 }))).toBe('newer-version');
    expect(errorCode(layoutOf([], { schemaVersion: 99 }))).toBe('newer-version');
  });

  it('нет версии, плохие id / roomId / name / objects → bad-layout', () => {
    const cases: [string, Raw][] = [
      ['нет версии', { id: 'a', name: 'n', roomId: 'test', objects: [] }],
      ['версия строкой', layoutOf([], { schemaVersion: '2' })],
      ['версия 0', layoutOf([], { schemaVersion: 0 })],
      ['версия дробная', layoutOf([], { schemaVersion: 1.5 })],
      ['версия NaN', layoutOf([], { schemaVersion: NaN })],
      ['id с пробелом', layoutOf([], { id: 'bad id' })],
      ['id — число', layoutOf([], { id: 5 })],
      ['нет id', layoutOf([], { id: undefined })],
      ['roomId — путь', layoutOf([], { roomId: '../lounge' })],
      ['нет roomId', layoutOf([], { roomId: undefined })],
      ['name — число', layoutOf([], { name: 5 })],
      ['objects — объект', layoutOf([], { objects: { length: 0 } })],
      ['нет objects', layoutOf([], { objects: undefined })],
    ];
    for (const [note, raw] of cases) expect(errorCode(raw), note).toBe('bad-layout');
  });

  it('слишком много объектов → bad-layout; ровно предел проходит', () => {
    const many = Array.from({ length: LAYOUT_LIMITS.objects + 1 }, (_, i) => obj(`o${i}`));
    expect(errorCode(layoutOf(many))).toBe('bad-layout');
    const { layout, drops } = parse(layoutOf(many.slice(0, LAYOUT_LIMITS.objects)));
    expect(drops).toEqual([]);
    expect(layout.objects).toHaveLength(LAYOUT_LIMITS.objects);
  });

  it('LayoutFormatError — настоящая ошибка с кодом и сообщением', () => {
    const error = new LayoutFormatError('bad-layout', 'сообщение');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LayoutFormatError);
    expect(error.code).toBe('bad-layout');
    expect(error.message).toBe('сообщение');
    expect(error.name).toBe('LayoutFormatError');
    expect(() => parseLayout(null)).toThrow(LayoutFormatError);
  });
});

describe('parseLayout · миграция v1 → v2', () => {
  /** Объект этапа 1: мировая позиция вместо крепления, нет assetId и params. */
  function v1Object(id: string, position: unknown, over: Raw = {}): Raw {
    return {
      id,
      kind: 'primitive',
      type: 'sofaU',
      origin: 'venue',
      name: 'Кабинка',
      position,
      rotationY: 0.5,
      size: [2.8, 0.85, 1.8],
      color: '#8a8378',
      locked: false,
      visible: true,
      ...over,
    };
  }
  const v1 = (objects: unknown[]): Raw => ({ schemaVersion: 1, id: 'layout-old', name: 'Старый', roomId: 'lounge', objects, updatedAt: 77 });

  it('position [x, y, z] + rotationY → mount floor { x, z, lift: y }; assetId null; params {}', () => {
    const raw = v1([v1Object('venue-booth-1', [1, 0.15, -2]), v1Object('obj-1', [-3, 0, 2.5], { origin: 'user', type: 'box', rotationY: 0 })]);
    const frozen = structuredClone(raw);
    const { layout, drops } = parse(viaJson(raw));
    expect(raw).toEqual(frozen);
    expect(drops).toEqual([]);
    expect(layout.schemaVersion).toBe(2);
    expect(layout.id).toBe('layout-old');
    expect(layout.name).toBe('Старый');
    expect(layout.roomId).toBe('lounge');
    expect(layout.updatedAt).toBe(77);
    expect(layout.objects).toEqual([
      {
        id: 'venue-booth-1',
        kind: 'primitive',
        type: 'sofaU',
        origin: 'venue',
        name: 'Кабинка',
        mount: { kind: 'floor', x: 1, z: -2, lift: 0.15 },
        rotationY: 0.5,
        size: [2.8, 0.85, 1.8],
        color: '#8a8378',
        assetId: null,
        locked: false,
        visible: true,
        params: {},
      },
      {
        id: 'obj-1',
        kind: 'primitive',
        type: 'box',
        origin: 'user',
        name: 'Кабинка',
        mount: { kind: 'floor', x: -3, z: 2.5, lift: 0 },
        rotationY: 0,
        size: [2.8, 0.85, 1.8],
        color: '#8a8378',
        assetId: null,
        locked: false,
        visible: true,
        params: {},
      },
    ]);
    for (const o of layout.objects) expect('position' in o).toBe(false);
  });

  it('плохие объекты v1 отбрасываются так же, как v2', () => {
    const { layout, drops } = parse(
      v1([
        v1Object('ok', [0, 0, 0]),
        v1Object('nan', [NaN, 0, 0]),
        v1Object('short', [1, 2]),
        v1Object('none', undefined),
        v1Object('text', 'здесь'),
        v1Object('color', [0, 0, 0], { color: 'red' }),
        'мусор',
      ]),
    );
    expect(layout.objects.map((o) => o.id)).toEqual(['ok']);
    expect(drops.map((d) => d.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('структурный мусор в v1 → bad-layout', () => {
    expect(errorCode({ schemaVersion: 1, id: 'a', name: 'n', roomId: 'lounge', objects: 'нет' })).toBe('bad-layout');
    expect(errorCode({ schemaVersion: 1, name: 'n', roomId: 'lounge', objects: [] })).toBe('bad-layout');
  });
});

describe('LAYOUT_PATTERNS / LAYOUT_LIMITS', () => {
  it('каждое строковое поле — по своему правилу', () => {
    const accepts = (pattern: RegExp, good: string[], bad: string[]) => {
      for (const s of good) expect(pattern.test(s), `${pattern} должен принять '${s}'`).toBe(true);
      for (const s of bad) expect(pattern.test(s), `${pattern} должен отклонить '${s}'`).toBe(false);
    };
    accepts(LAYOUT_PATTERNS.id, ['obj-1a2b3c4d', 'venue-booth-1', 'layout_1', 'x'.repeat(64)], ['', 'a b', 'col:s', 'light.spot', 'x'.repeat(65)]);
    accepts(LAYOUT_PATTERNS.surfaceId, ['far', 'col-left:s', 'col:n', 'col:e', 'col:w'], ['col:x', 'col:', ':s', 'col:s:n', 'far wall', '']);
    accepts(LAYOUT_PATTERNS.type, ['sofaU', 'light.spot', 'image.flat', 'hp.dementor', 'a'], ['hp dementor', '.x', '1box', '', 'x'.repeat(65), 'a/b']);
    accepts(LAYOUT_PATTERNS.assetId, [ASSET], ['a_', 'a_xyz', `${ASSET}0`, ASSET.toUpperCase(), `b${ASSET.slice(1)}`]);
    accepts(LAYOUT_PATTERNS.color, ['#000000', '#ABCDEF', '#a1b2c3'], ['#fff', '000000', '#gggggg', '#0000000']);
    accepts(LAYOUT_PATTERNS.paramKey, ['seed', 'glowColor', 'a_1', 'x'.repeat(32)], ['__proto__', '1a', 'a-b', '', 'x'.repeat(33), 'a.b']);
    // Правила без флага g: test() не зависит от предыдущих вызовов.
    for (const pattern of Object.values(LAYOUT_PATTERNS)) expect(pattern.global).toBe(false);
  });

  it('пределы — как в спецификации', () => {
    expect(LAYOUT_LIMITS).toEqual({ objects: 2000, name: 120, paramKeys: 64, paramString: 4000, coord: 500, sizeMin: 0.005, sizeMax: 60 });
  });
});
