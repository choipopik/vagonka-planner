import { describe, expect, it } from 'vitest';
import { PREFS_KEY, defaultPrefs, parsePrefs, readPrefs, writePrefs } from './prefs';
import type { Prefs } from './prefs';
import { memoryStringStore } from './stores';

describe('prefs', () => {
  it('ключ записи — vagonka:prefs; значения по умолчанию совпадают с начальным состоянием стора', () => {
    expect(PREFS_KEY).toBe('vagonka:prefs');
    expect(defaultPrefs()).toEqual({ roomId: null, lastLayoutByRoom: {}, showLabels: true, gridSnap: true, ambience: 'work', layer: 'auto' });
  });

  it('запись → чтение', () => {
    const strings = memoryStringStore();
    const prefs: Prefs = {
      roomId: 'lounge',
      lastLayoutByRoom: { lounge: 'layout-abc', hall: 'layout-def' },
      showLabels: false,
      gridSnap: false,
      ambience: 'party',
      layer: 'ceiling',
    };
    expect(writePrefs(strings, prefs)).toBe(true);
    expect(strings.keys()).toEqual([PREFS_KEY]);
    expect(readPrefs(strings)).toEqual(prefs);
  });

  it('нет записи или битый JSON → значения по умолчанию', () => {
    const strings = memoryStringStore();
    expect(readPrefs(strings)).toEqual(defaultPrefs());
    strings.set(PREFS_KEY, '{"roomId": ');
    expect(readPrefs(strings)).toEqual(defaultPrefs());
    strings.set(PREFS_KEY, '"строка"');
    expect(readPrefs(strings)).toEqual(defaultPrefs());
  });

  it('каждое поле проверяется отдельно: негодное заменяется значением по умолчанию, годное остаётся', () => {
    const parsed = parsePrefs({
      roomId: 'room id with spaces',
      lastLayoutByRoom: { lounge: 'layout-ok', 'bad key': 'layout-x', hall: 42, attic: '../etc' },
      showLabels: 'да',
      gridSnap: false,
      ambience: 'disco',
      layer: 'floor',
      extra: '<script>',
    });
    expect(parsed).toEqual({
      roomId: null,
      lastLayoutByRoom: { lounge: 'layout-ok' },
      showLabels: true,
      gridSnap: false,
      ambience: 'work',
      layer: 'floor',
    });
    expect(parsePrefs(null)).toEqual(defaultPrefs());
    expect(parsePrefs([1, 2])).toEqual(defaultPrefs());
    expect(parsePrefs({ lastLayoutByRoom: ['layout-a'] }).lastLayoutByRoom).toEqual({});
  });

  it('недоступное или переполненное хранилище ошибку наружу не выпускает', () => {
    const full = memoryStringStore(5);
    expect(writePrefs(full, defaultPrefs())).toBe(false);
    expect(readPrefs(full)).toEqual(defaultPrefs());

    const broken = {
      get: (): string | null => {
        throw new Error('SecurityError');
      },
      set: (): void => {
        throw new Error('SecurityError');
      },
      remove: (): void => undefined,
      keys: (): string[] => [],
    };
    expect(readPrefs(broken)).toEqual(defaultPrefs());
    expect(writePrefs(broken, defaultPrefs())).toBe(false);
  });
});
