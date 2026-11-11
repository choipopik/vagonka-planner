import { describe, expect, it } from 'vitest';
import { applyCommand, invertCommand } from './commands';
import type { Command } from './commands';
import { EMPTY_HISTORY, HISTORY_LIMIT, MERGE_WINDOW_MS, pushHistory, redoStep, undoStep } from './history';
import type { History, HistoryEntry } from './history';
import type { Layout, SceneObject } from './types';

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

const start: Layout = { schemaVersion: 2, id: 'l', name: 'Макет', roomId: 'test', objects: [obj('a'), obj('b')], updatedAt: 0 };

/** Мини-стор: применяет команду и пишет шаг в историю так же, как это делает dispatch. */
function run(
  state: { layout: Layout; history: History },
  cmd: Command,
  time: number,
  mergeKey?: string,
  label = 'Шаг',
): { layout: Layout; history: History } {
  const entry: HistoryEntry = { label, redo: cmd, undo: invertCommand(state.layout, cmd), mergeKey, time };
  return { layout: applyCommand(state.layout, cmd), history: pushHistory(state.history, entry) };
}

const setColor = (id: string, color: string): Command => ({ type: 'patch', patches: [{ id, set: { color } }] });
const setX = (id: string, x: number): Command => ({
  type: 'patch',
  patches: [{ id, set: { mount: { kind: 'floor', x, z: 0, lift: 0 } } }],
});

describe('pushHistory', () => {
  it('добавляет шаг и очищает future', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    s = run(s, setColor('a', '#111111'), 0);
    s = run(s, setColor('a', '#222222'), 5000);
    expect(s.history.past).toHaveLength(2);

    const undone = undoStep(s.history)!;
    expect(undone.history.future).toHaveLength(1);
    const pushed = pushHistory(undone.history, { label: 'Новый', redo: setColor('b', '#333333'), undo: setColor('b', '#808080'), time: 9000 });
    expect(pushed.future).toEqual([]);
    expect(pushed.past.map((e) => e.label)).toEqual(['Шаг', 'Новый']);
  });

  it('не мутирует вход; EMPTY_HISTORY остаётся пустой', () => {
    const h = pushHistory(EMPTY_HISTORY, { label: 'x', redo: setColor('a', '#111111'), undo: setColor('a', '#808080'), time: 0 });
    expect(EMPTY_HISTORY).toEqual({ past: [], future: [] });
    const frozen = structuredClone(h);
    pushHistory(h, { label: 'y', redo: setColor('a', '#222222'), undo: setColor('a', '#111111'), time: 1 });
    undoStep(h);
    redoStep(h);
    expect(h).toEqual(frozen);
  });

  it('склейка по mergeKey внутри окна: один шаг, подпись первого, время последнего', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    s = run(s, setX('a', 1), 1000, 'move:a', 'Перемещение');
    s = run(s, setX('a', 2), 1000 + MERGE_WINDOW_MS, 'move:a', 'Другое');
    s = run(s, setX('a', 3), 1000 + 2 * MERGE_WINDOW_MS, 'move:a', 'Третье'); // окно отсчитывается от последнего шага
    expect(s.history.past).toHaveLength(1);
    const top = s.history.past[0];
    expect(top.label).toBe('Перемещение');
    expect(top.mergeKey).toBe('move:a');
    expect(top.time).toBe(1000 + 2 * MERGE_WINDOW_MS);
    expect(top.redo.type).toBe('batch');
    expect(top.undo.type).toBe('batch');

    // undo склеенного шага возвращает исходное состояние, redo — конечное.
    const undone = undoStep(s.history)!;
    expect(undone.label).toBe('Перемещение');
    const back = applyCommand(s.layout, undone.command);
    expect(back).toEqual(start);
    const redone = redoStep(undone.history)!;
    expect(applyCommand(back, redone.command)).toEqual(s.layout);
    expect(s.layout.objects[0].mount).toEqual({ kind: 'floor', x: 3, z: 0, lift: 0 });
  });

  it('склейка корректна при разном составе патчей', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    s = run(s, setColor('a', '#111111'), 0, 'props:a');
    s = run(s, { type: 'patch', patches: [{ id: 'a', set: { rotationY: 1, size: [1, 1, 1] } }] }, 300, 'props:a');
    s = run(s, { type: 'patch', patches: [{ id: 'a', set: { color: '#222222', visible: false } }] }, 600, 'props:a');
    expect(s.history.past).toHaveLength(1);
    const undone = undoStep(s.history)!;
    expect(applyCommand(s.layout, undone.command)).toEqual(start);
    const redone = redoStep(undone.history)!;
    expect(applyCommand(start, redone.command)).toEqual(s.layout);
  });

  it('вне окна, с другим ключом или без ключа — отдельные шаги', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    s = run(s, setX('a', 1), 0, 'move:a');
    s = run(s, setX('a', 2), MERGE_WINDOW_MS + 1, 'move:a'); // позже окна
    expect(s.history.past).toHaveLength(2);
    s = run(s, setX('b', 1), MERGE_WINDOW_MS + 2, 'move:b'); // другой ключ
    expect(s.history.past).toHaveLength(3);
    s = run(s, setX('b', 2), MERGE_WINDOW_MS + 3); // без ключа
    s = run(s, setX('b', 3), MERGE_WINDOW_MS + 4);
    expect(s.history.past).toHaveLength(5);
    s = run(s, setX('b', 4), MERGE_WINDOW_MS + 5, 'move:b'); // верхний шаг без ключа — не клеится
    expect(s.history.past).toHaveLength(6);
  });

  it('после undo склейка не происходит со «старым» верхним шагом по ошибке — future очищается', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    s = run(s, setX('a', 1), 0, 'move:a');
    const undone = undoStep(s.history)!;
    const next = pushHistory(undone.history, { label: 'x', redo: setX('a', 5), undo: setX('a', 0), mergeKey: 'move:a', time: 10 });
    expect(next.past).toHaveLength(1);
    expect(next.future).toEqual([]);
    expect(next.past[0].redo).toEqual(setX('a', 5)); // не batch: клеить было не с чем
  });

  it('лимит: past обрезается до HISTORY_LIMIT, выпадают старейшие', () => {
    expect(HISTORY_LIMIT).toBe(200);
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
      h = pushHistory(h, { label: `шаг ${i}`, redo: setX('a', i + 1), undo: setX('a', i), time: i * 5000 });
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].label).toBe('шаг 25');
    expect(h.past[HISTORY_LIMIT - 1].label).toBe(`шаг ${HISTORY_LIMIT + 24}`);
  });
});

describe('undoStep / redoStep', () => {
  it('null, когда отменять или повторять нечего', () => {
    expect(undoStep(EMPTY_HISTORY)).toBeNull();
    expect(redoStep(EMPTY_HISTORY)).toBeNull();
    const one = pushHistory(EMPTY_HISTORY, { label: 'x', redo: setX('a', 1), undo: setX('a', 0), time: 0 });
    expect(redoStep(one)).toBeNull();
  });

  it('command — то, что нужно применить: undo → entry.undo, redo → entry.redo', () => {
    const entry: HistoryEntry = { label: 'Цвет', redo: setColor('a', '#111111'), undo: setColor('a', '#808080'), time: 0 };
    const h = pushHistory(EMPTY_HISTORY, entry);
    const u = undoStep(h)!;
    expect(u.command).toBe(entry.undo);
    expect(u.label).toBe('Цвет');
    const r = redoStep(u.history)!;
    expect(r.command).toBe(entry.redo);
    expect(r.label).toBe('Цвет');
  });

  it('симметрия: N undo, затем N redo возвращают и макет, и историю', () => {
    let s = { layout: start, history: EMPTY_HISTORY };
    const snapshots: Layout[] = [start];
    const commands: Command[] = [
      setColor('a', '#111111'),
      { type: 'add', items: [{ object: obj('c'), index: 1 }] },
      setX('c', 2),
      { type: 'remove', ids: ['a'] },
      { type: 'rename', name: 'Иначе' },
    ];
    commands.forEach((cmd, i) => {
      s = run(s, cmd, i * 5000);
      snapshots.push(s.layout);
    });
    const full = s.history;

    let layout = s.layout;
    let history = s.history;
    for (let i = commands.length - 1; i >= 0; i--) {
      const step = undoStep(history)!;
      layout = applyCommand(layout, step.command);
      history = step.history;
      expect(layout).toEqual(snapshots[i]);
      expect(history.past).toHaveLength(i);
      expect(history.future).toHaveLength(commands.length - i);
    }
    expect(undoStep(history)).toBeNull();

    for (let i = 1; i <= commands.length; i++) {
      const step = redoStep(history)!;
      layout = applyCommand(layout, step.command);
      history = step.history;
      expect(layout).toEqual(snapshots[i]);
    }
    expect(redoStep(history)).toBeNull();
    expect(history).toEqual(full);
  });
});
