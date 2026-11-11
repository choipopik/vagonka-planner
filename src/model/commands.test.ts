import { describe, expect, it } from 'vitest';
import { applyCommand, applyPatch, deepEqual, invertCommand, isNoop, touchedIds } from './commands';
import type { Command, ObjectPatch } from './commands';
import { createRng } from './rng';
import type { Rng } from './rng';
import type { Layout, Mount, SceneObject } from './types';

function obj(id: string, over: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    kind: 'primitive',
    type: 'box',
    origin: 'user',
    name: id,
    mount: { kind: 'floor', x: 0, z: 0, lift: 0 },
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

function layoutOf(objects: SceneObject[], name = 'Макет'): Layout {
  return { schemaVersion: 2, id: 'layout-1', name, roomId: 'test', objects, updatedAt: 123 };
}

const ids = (l: Layout) => l.objects.map((o) => o.id);
const base = () => layoutOf([obj('a'), obj('b'), obj('c'), obj('d')]);

/** Применяет команду и её обратную; проверяет, что макет восстановился deep-equal, а вход не мутирован. */
function roundTrip(layout: Layout, cmd: Command): Layout {
  const frozenLayout = structuredClone(layout);
  const frozenCmd = structuredClone(cmd);
  const inverse = invertCommand(layout, cmd);
  const after = applyCommand(layout, cmd);
  const back = applyCommand(after, inverse);
  expect(back).toEqual(frozenLayout);
  expect(layout).toEqual(frozenLayout);
  expect(cmd).toEqual(frozenCmd);
  return after;
}

describe('add', () => {
  it('добавляет в конец по умолчанию и по индексу', () => {
    const l = base();
    const after = roundTrip(l, {
      type: 'add',
      items: [{ object: obj('x') }, { object: obj('y'), index: 0 }, { object: obj('z'), index: 2 }],
    });
    // Индекс — позиция на момент вставки этого элемента.
    expect(ids(after)).toEqual(['y', 'a', 'z', 'b', 'c', 'd', 'x']);
  });

  it('index зажимается в [0, length]', () => {
    const after = applyCommand(base(), {
      type: 'add',
      items: [{ object: obj('lo'), index: -5 }, { object: obj('hi'), index: 99 }, { object: obj('nan'), index: NaN }],
    });
    expect(ids(after)).toEqual(['lo', 'a', 'b', 'c', 'd', 'hi', 'nan']);
  });

  it('повторный add игнорируется (в том числе внутри одной команды)', () => {
    const l = base();
    const dup: Command = { type: 'add', items: [{ object: obj('a', { name: 'другой' }) }] };
    expect(applyCommand(l, dup)).toBe(l);
    expect(isNoop(l, dup)).toBe(true);
    expect(invertCommand(l, dup)).toEqual({ type: 'remove', ids: [] });

    const twice: Command = { type: 'add', items: [{ object: obj('x') }, { object: obj('x', { name: 'второй' }) }, { object: obj('b') }] };
    const after = roundTrip(l, twice);
    expect(ids(after)).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect(after.objects[4].name).toBe('x');
    // Обратная команда удаляет только то, что реально добавится.
    expect(invertCommand(l, twice)).toEqual({ type: 'remove', ids: ['x'] });
  });
});

describe('remove', () => {
  it('удаляет; неизвестные id пропускаются', () => {
    const l = base();
    const after = roundTrip(l, { type: 'remove', ids: ['b', 'nope', 'd'] });
    expect(ids(after)).toEqual(['a', 'c']);
    expect(applyCommand(l, { type: 'remove', ids: ['nope'] })).toBe(l);
  });

  it('обратная команда — add с прежними индексами по возрастанию', () => {
    const l = base();
    const inverse = invertCommand(l, { type: 'remove', ids: ['d', 'a', 'nope'] });
    expect(inverse).toEqual({
      type: 'add',
      items: [
        { object: l.objects[0], index: 0 },
        { object: l.objects[3], index: 3 },
      ],
    });
  });
});

describe('patch', () => {
  it('заменяет свойства целиком; неизвестные id пропускаются', () => {
    const l = layoutOf([obj('a', { params: { count: 3, seed: 7 } }), obj('b')]);
    const mount: Mount = { kind: 'ceiling', x: 1, z: 2, drop: 0.3 };
    const after = roundTrip(l, {
      type: 'patch',
      patches: [
        { id: 'a', set: { mount, params: { count: 5 }, name: 'Новое имя' } },
        { id: 'nope', set: { name: 'x' } },
      ],
    });
    expect(after.objects[0].mount).toEqual(mount);
    // Слияния по ключам нет: seed пропал.
    expect(after.objects[0].params).toEqual({ count: 5 });
    expect(after.objects[0].name).toBe('Новое имя');
    expect(after.objects[1]).toBe(l.objects[1]);
  });

  it('читаются только ключи ObjectPatch: id / kind / type / origin патчить нельзя', () => {
    const l = base();
    const evil = { id: 'hacked', kind: 'light', type: 'evil', origin: 'venue', extra: 1, name: 'ok' } as unknown as ObjectPatch;
    const after = applyCommand(l, { type: 'patch', patches: [{ id: 'a', set: evil }] });
    expect(after.objects[0]).toEqual({ ...l.objects[0], name: 'ok' });
    expect('extra' in after.objects[0]).toBe(false);
    // Только запрещённые ключи → ничего не изменилось.
    const onlyEvil = { id: 'hacked', origin: 'venue' } as unknown as ObjectPatch;
    expect(applyCommand(l, { type: 'patch', patches: [{ id: 'a', set: onlyEvil }] })).toBe(l);
  });

  it('значение, deep-равное текущему, не создаёт новый объект', () => {
    const l = base();
    const same: Command = {
      type: 'patch',
      patches: [{ id: 'a', set: { mount: { kind: 'floor', x: 0, z: 0, lift: 0 }, size: [0.5, 0.5, 0.5], params: {}, visible: true } }],
    };
    expect(applyCommand(l, same)).toBe(l);
    expect(isNoop(l, same)).toBe(true);
    expect(applyPatch(l.objects[0], { color: '#808080', assetId: null })).toBe(l.objects[0]);
  });

  it('один id дважды в одной команде: обратная команда возвращает исходные значения', () => {
    const l = base();
    const cmd: Command = {
      type: 'patch',
      patches: [
        { id: 'a', set: { name: 'первое', color: '#111111' } },
        { id: 'a', set: { name: 'второе' } },
      ],
    };
    const after = roundTrip(l, cmd);
    expect(after.objects[0].name).toBe('второе');
    expect(after.objects[0].color).toBe('#111111');
  });

  it('обратная команда содержит прежние значения тех же ключей и только для существующих id', () => {
    const l = layoutOf([obj('a', { rotationY: 1 }), obj('b')]);
    const inverse = invertCommand(l, {
      type: 'patch',
      patches: [
        { id: 'a', set: { rotationY: 2, visible: false } },
        { id: 'nope', set: { rotationY: 3 } },
      ],
    });
    expect(inverse).toEqual({ type: 'patch', patches: [{ id: 'a', set: { rotationY: 1, visible: true } }] });
  });
});

describe('rename', () => {
  it('заменяет имя макета; то же имя — no-op', () => {
    const l = base();
    const after = roundTrip(l, { type: 'rename', name: 'Свадьба' });
    expect(after.name).toBe('Свадьба');
    expect(after.objects).toBe(l.objects);
    expect(applyCommand(l, { type: 'rename', name: l.name })).toBe(l);
    expect(invertCommand(l, { type: 'rename', name: 'x' })).toEqual({ type: 'rename', name: 'Макет' });
  });
});

describe('batch', () => {
  it('выполняется последовательно, вложенные batch разрешены', () => {
    const l = base();
    const cmd: Command = {
      type: 'batch',
      commands: [
        { type: 'add', items: [{ object: obj('x'), index: 1 }] },
        {
          type: 'batch',
          commands: [
            { type: 'patch', patches: [{ id: 'x', set: { name: 'добавлен и переименован' } }] },
            { type: 'remove', ids: ['a'] },
          ],
        },
        { type: 'rename', name: 'После' },
      ],
    };
    const after = roundTrip(l, cmd);
    expect(ids(after)).toEqual(['x', 'b', 'c', 'd']);
    expect(after.objects[0].name).toBe('добавлен и переименован');
    expect(after.name).toBe('После');
  });

  it('обратная команда — обратные в обратном порядке, каждая относительно промежуточного состояния', () => {
    const l = base();
    const cmd: Command = {
      type: 'batch',
      commands: [
        { type: 'patch', patches: [{ id: 'a', set: { name: '1' } }] },
        { type: 'patch', patches: [{ id: 'a', set: { name: '2' } }] },
        { type: 'remove', ids: ['a'] },
      ],
    };
    const inverse = invertCommand(l, cmd);
    expect(inverse.type).toBe('batch');
    if (inverse.type !== 'batch') return;
    expect(inverse.commands.map((c) => c.type)).toEqual(['add', 'patch', 'patch']);
    expect(inverse.commands[1]).toEqual({ type: 'patch', patches: [{ id: 'a', set: { name: '1' } }] });
    expect(inverse.commands[2]).toEqual({ type: 'patch', patches: [{ id: 'a', set: { name: 'a' } }] });
    roundTrip(l, cmd);
  });

  it('пустой batch и batch из пустых команд — no-op', () => {
    const l = base();
    expect(applyCommand(l, { type: 'batch', commands: [] })).toBe(l);
    expect(
      isNoop(l, { type: 'batch', commands: [{ type: 'remove', ids: [] }, { type: 'patch', patches: [] }, { type: 'add', items: [] }] }),
    ).toBe(true);
  });
});

describe('чистота и ссылки', () => {
  it('вход не мутируется, updatedAt не трогается', () => {
    const l = base();
    const frozen = structuredClone(l);
    const after = applyCommand(l, {
      type: 'batch',
      commands: [
        { type: 'add', items: [{ object: obj('x'), index: 0 }] },
        { type: 'remove', ids: ['b'] },
        { type: 'patch', patches: [{ id: 'c', set: { size: [1, 2, 3] } }] },
        { type: 'rename', name: 'Другой' },
      ],
    });
    expect(l).toEqual(frozen);
    expect(after).not.toBe(l);
    expect(after.updatedAt).toBe(l.updatedAt);
    expect(after.id).toBe(l.id);
    expect(after.schemaVersion).toBe(2);
  });

  it('ссылки нетронутых объектов сохраняются', () => {
    const l = base();
    const after = applyCommand(l, { type: 'patch', patches: [{ id: 'b', set: { color: '#ff0000' } }] });
    expect(after.objects).not.toBe(l.objects);
    expect(after.objects[0]).toBe(l.objects[0]);
    expect(after.objects[1]).not.toBe(l.objects[1]);
    expect(after.objects[2]).toBe(l.objects[2]);
    expect(after.objects[3]).toBe(l.objects[3]);
    const added = applyCommand(l, { type: 'add', items: [{ object: obj('x'), index: 2 }] });
    for (const o of l.objects) expect(added.objects).toContain(o);
  });

  it('isNoop — ровно applyCommand(layout, cmd) === layout', () => {
    const l = base();
    expect(isNoop(l, { type: 'remove', ids: ['a'] })).toBe(false);
    expect(isNoop(l, { type: 'remove', ids: ['zzz'] })).toBe(true);
    expect(isNoop(l, { type: 'rename', name: 'Иначе' })).toBe(false);
    expect(isNoop(l, { type: 'patch', patches: [{ id: 'a', set: {} }] })).toBe(true);
    // Команда, которая что-то делает и тут же отменяет, даёт равный, но новый макет — это не no-op по ссылке.
    const there: Command = {
      type: 'batch',
      commands: [
        { type: 'patch', patches: [{ id: 'a', set: { name: 'x' } }] },
        { type: 'patch', patches: [{ id: 'a', set: { name: 'a' } }] },
      ],
    };
    expect(applyCommand(l, there)).toEqual(l);
  });
});

describe('touchedIds', () => {
  it('id, которые команда добавляет, удаляет или патчит, без повторов', () => {
    expect(touchedIds({ type: 'add', items: [{ object: obj('x') }, { object: obj('y') }] })).toEqual(['x', 'y']);
    expect(touchedIds({ type: 'remove', ids: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
    expect(touchedIds({ type: 'patch', patches: [{ id: 'a', set: {} }, { id: 'a', set: {} }] })).toEqual(['a']);
    expect(touchedIds({ type: 'rename', name: 'x' })).toEqual([]);
    expect(
      touchedIds({
        type: 'batch',
        commands: [
          { type: 'patch', patches: [{ id: 'a', set: {} }] },
          { type: 'batch', commands: [{ type: 'remove', ids: ['b', 'a'] }, { type: 'add', items: [{ object: obj('c') }] }] },
          { type: 'rename', name: 'x' },
        ],
      }),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('deepEqual', () => {
  it('сравнивает JSON-значения по структуре', () => {
    expect(deepEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual('1', 1)).toBe(false);
  });
});

// ---------- Свойство: apply(invert) восстанавливает макет на случайных последовательностях ----------

const COLORS = ['#111111', '#222222', '#808080', '#abcdef'];

function randomMount(rng: Rng, known: string[]): Mount {
  switch (rng.int(0, 3)) {
    case 0:
      return { kind: 'floor', x: rng.int(-5, 5), z: rng.int(-3, 3), lift: rng.int(0, 1) };
    case 1:
      return { kind: 'ceiling', x: rng.int(-5, 5), z: rng.int(-3, 3), drop: rng.int(0, 1) };
    case 2:
      return { kind: 'wall', surfaceId: rng.pick(['far', 'near', 'col:s']), along: rng.int(0, 9), bottom: rng.int(0, 2) };
    default:
      return { kind: 'surface', hostId: rng.pick(known.length > 0 ? known : ['none']), u: rng.int(-1, 1), v: 0 };
  }
}

function randomPatch(rng: Rng, known: string[]): ObjectPatch {
  const set: ObjectPatch = {};
  const count = rng.int(0, 3);
  for (let i = 0; i < count; i++) {
    switch (rng.int(0, 8)) {
      case 0:
        set.name = `имя-${rng.int(0, 3)}`;
        break;
      case 1:
        set.mount = randomMount(rng, known);
        break;
      case 2:
        set.rotationY = rng.int(0, 3);
        break;
      case 3:
        set.size = [rng.int(1, 3), rng.int(1, 3), rng.int(1, 3)];
        break;
      case 4:
        set.color = rng.pick(COLORS);
        break;
      case 5:
        set.assetId = rng.next() < 0.5 ? null : 'a_0123456789abcdef0123456789abcdef';
        break;
      case 6:
        set.locked = rng.next() < 0.5;
        break;
      case 7:
        set.visible = rng.next() < 0.5;
        break;
      default:
        set.params = rng.next() < 0.5 ? {} : { seed: rng.int(0, 3), on: rng.next() < 0.5 };
    }
  }
  return set;
}

/** Пул id заведомо мал, чтобы встречались и повторные add, и неизвестные id. */
const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function randomCommand(rng: Rng, depth = 0): Command {
  const kind = rng.int(0, depth < 2 ? 4 : 3);
  switch (kind) {
    case 0:
      return {
        type: 'add',
        items: Array.from({ length: rng.int(0, 3) }, () => {
          const object = obj(rng.pick(POOL), { name: `n${rng.int(0, 99)}`, mount: randomMount(rng, POOL) });
          return rng.next() < 0.5 ? { object } : { object, index: rng.int(-2, 10) };
        }),
      };
    case 1:
      return { type: 'remove', ids: Array.from({ length: rng.int(0, 3) }, () => rng.pick(POOL)) };
    case 2:
      return {
        type: 'patch',
        patches: Array.from({ length: rng.int(0, 3) }, () => ({ id: rng.pick(POOL), set: randomPatch(rng, POOL) })),
      };
    case 3:
      return { type: 'rename', name: `Макет ${rng.int(0, 3)}` };
    default:
      return { type: 'batch', commands: Array.from({ length: rng.int(0, 4) }, () => randomCommand(rng, depth + 1)) };
  }
}

describe('свойство: apply(invert) восстанавливает макет', () => {
  it('для каждой отдельной команды — deep-equal, включая порядок объектов', () => {
    const rng = createRng(20261110);
    let layout = layoutOf([obj('a'), obj('b'), obj('c')]);
    let changed = 0;
    for (let i = 0; i < 600; i++) {
      const cmd = randomCommand(rng);
      const before = structuredClone(layout);
      const inverse = invertCommand(layout, cmd);
      const after = applyCommand(layout, cmd);
      expect(layout).toEqual(before); // вход не мутирован
      expect(applyCommand(after, inverse)).toEqual(before);
      expect(isNoop(layout, cmd)).toBe(after === layout);
      // id остаются уникальными при любых командах.
      expect(new Set(ids(after)).size).toBe(after.objects.length);
      if (after !== layout) changed++;
      layout = after;
    }
    expect(changed).toBeGreaterThan(200); // генератор действительно что-то меняет
  });

  it('для цепочки команд: обратные в обратном порядке возвращают исходный макет', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = createRng(seed);
      const start = layoutOf([obj('a'), obj('b'), obj('c'), obj('d')]);
      const frozen = structuredClone(start);
      let layout = start;
      const inverses: Command[] = [];
      for (let i = 0; i < 80; i++) {
        const cmd = randomCommand(rng);
        inverses.push(invertCommand(layout, cmd));
        layout = applyCommand(layout, cmd);
      }
      for (const inverse of inverses.reverse()) layout = applyCommand(layout, inverse);
      expect(layout).toEqual(frozen);
      expect(start).toEqual(frozen);
    }
  });

  it('обратная к обратной снова даёт результат команды (redo после undo)', () => {
    const rng = createRng(77);
    let layout = layoutOf([obj('a'), obj('b'), obj('c')]);
    for (let i = 0; i < 200; i++) {
      const cmd = randomCommand(rng);
      const after = applyCommand(layout, cmd);
      const undo = invertCommand(layout, cmd);
      const undone = applyCommand(after, undo);
      // redo = исходная команда, применённая к восстановленному макету.
      expect(applyCommand(undone, cmd)).toEqual(after);
      layout = after;
    }
  });
});
