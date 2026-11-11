import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayout } from '../model/layout';
import { testRoom } from '../model/testRoom';
import type { Layout } from '../model/types';
import { useEditor } from '../store/editorStore';
import type { SaveStatus } from '../store/editorStore';
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS, QUOTA_SAVE_TEXT, saveNow, startAutosave } from './autosave';
import type { AutosaveTimers } from './autosave';
import { MemoryRepository, RepositoryError } from './repository';
import type { LayoutRepository } from './repository';

/** Фальшивые таймеры с ручными часами: advance(ms) выполняет созревшие обработчики в порядке срока. */
function fakeTimers() {
  interface Entry {
    id: number;
    at: number;
    run: () => void;
  }
  let now = 0;
  let nextId = 1;
  let entries: Entry[] = [];
  const timers: AutosaveTimers = {
    set: ((handler: () => void, ms?: number) => {
      const id = nextId++;
      entries.push({ id, at: now + (ms ?? 0), run: handler });
      return id;
    }) as unknown as typeof setTimeout,
    clear: ((id?: number) => {
      entries = entries.filter((entry) => entry.id !== id);
    }) as unknown as typeof clearTimeout,
  };
  return {
    timers,
    pending: () => entries.length,
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const due = entries.filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        entries = entries.filter((entry) => entry !== due);
        now = due.at;
        due.run();
      }
      now = until;
    },
  };
}

/** Репозиторий, который записывает вызовы save; исход каждого вызова задаёт сценарий. */
function recordingRepo() {
  const inner = new MemoryRepository();
  const saved: Layout[] = [];
  const failures: unknown[] = [];
  let gate: Promise<void> | null = null;
  const repo: LayoutRepository = {
    list: (roomId) => inner.list(roomId),
    load: (id) => inner.load(id),
    remove: (id) => inner.remove(id),
    putAsset: (blob, info) => inner.putAsset(blob, info),
    getAsset: (id) => inner.getAsset(id),
    listAssets: () => inner.listAssets(),
    removeAsset: (id) => inner.removeAsset(id),
    async save(layout) {
      saved.push(layout);
      if (gate) await gate;
      if (failures.length > 0) throw failures.shift();
      await inner.save(layout);
    },
  };
  return {
    repo,
    inner,
    saved,
    /** Следующий вызов save завершится этой ошибкой. */
    failNext: (error: unknown) => failures.push(error),
    /** Задерживает завершение save до вызова возвращённой функции. */
    hold(): () => void {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

/** Дать завершиться промисам сохранения. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let renameSeq = 0;
/** Любая настоящая команда: dispatch ставит saveStatus 'dirty' и будит subscribeCommands. */
function edit(): void {
  useEditor.getState().dispatch({ type: 'rename', name: `Правка ${++renameSeq}` });
}

function statusLog(): { log: SaveStatus[]; stop: () => void } {
  const log: SaveStatus[] = [];
  const stop = useEditor.subscribe((state, previous) => {
    if (state.saveStatus !== previous.saveStatus) log.push(state.saveStatus);
  });
  return { log, stop };
}

const cleanups: (() => void)[] = [];

beforeEach(() => {
  useEditor.getState().openLayout(createLayout(testRoom, 'Тест автосохранения'));
  useEditor.getState().dismissNotice();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  useEditor.getState().dismissNotice();
});

function start(repo: LayoutRepository, timers: AutosaveTimers): () => void {
  const stop = startAutosave(repo, timers);
  cleanups.push(stop);
  return stop;
}

describe('startAutosave', () => {
  it('константы контракта', () => {
    expect(AUTOSAVE_DELAY_MS).toBe(800);
    expect(AUTOSAVE_MAX_WAIT_MS).toBe(5000);
  });

  it('задержка: сохранение через 800 мс после правки, не раньше', async () => {
    const clock = fakeTimers();
    const { repo, saved, inner } = recordingRepo();
    start(repo, clock.timers);

    edit();
    expect(useEditor.getState().saveStatus).toBe('dirty');
    clock.advance(AUTOSAVE_DELAY_MS - 1);
    expect(saved).toHaveLength(0);

    clock.advance(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(useEditor.getState().layout);
    await settle();
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect((await inner.load(saved[0].id))?.name).toBe(useEditor.getState().layout.name);

    // Таймеров не осталось, без новых правок повторной записи нет.
    expect(clock.pending()).toBe(0);
    clock.advance(60_000);
    expect(saved).toHaveLength(1);
  });

  it('каждая правка перезапускает задержку: серия правок — одна запись', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    start(repo, clock.timers);

    edit(); // t = 0
    clock.advance(500);
    edit(); // t = 500
    clock.advance(500);
    edit(); // t = 1000
    clock.advance(AUTOSAVE_DELAY_MS - 1); // t = 1799
    expect(saved).toHaveLength(0);
    clock.advance(1); // t = 1800
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe(useEditor.getState().layout.name);
    await settle();
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('максимум ожидания: при непрерывных правках запись принудительно через 5 с', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    start(repo, clock.timers);

    // Правка каждые 400 мс: задержка 800 мс сама никогда не истекает.
    for (let t = 0; t < AUTOSAVE_MAX_WAIT_MS; t += 400) {
      edit();
      clock.advance(400);
      if (t + 400 < AUTOSAVE_MAX_WAIT_MS) expect(saved).toHaveLength(0);
    }
    expect(saved).toHaveLength(1);
    await settle();
    expect(useEditor.getState().saveStatus).toBe('saved');

    // Следующая серия начинает отсчёт заново.
    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    expect(saved).toHaveLength(2);
  });

  it('статусы: dirty → saving → saved', async () => {
    const clock = fakeTimers();
    const { repo } = recordingRepo();
    start(repo, clock.timers);
    const { log, stop } = statusLog();
    cleanups.push(stop);

    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(log).toEqual(['dirty', 'saving', 'saved']);
  });

  it('ошибка квоты: статус error и совет экспортировать; следующая правка повторяет попытку', async () => {
    const clock = fakeTimers();
    const { repo, saved, failNext, inner } = recordingRepo();
    start(repo, clock.timers);
    const { log, stop } = statusLog();
    cleanups.push(stop);

    failNext(new RepositoryError('quota'));
    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(useEditor.getState().saveStatus).toBe('error');
    expect(useEditor.getState().notice).toMatchObject({ level: 'error', text: QUOTA_SAVE_TEXT });
    expect(QUOTA_SAVE_TEXT).toBe('Не удалось сохранить: мало места. Экспортируйте макет в файл');
    expect(await inner.list()).toEqual([]);

    // Без новой правки автосохранение само не повторяет попытку; сессия продолжает работать в памяти.
    clock.advance(60_000);
    expect(saved).toHaveLength(1);
    expect(useEditor.getState().saveStatus).toBe('error');

    edit();
    expect(useEditor.getState().saveStatus).toBe('dirty');
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saved).toHaveLength(2);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(log).toEqual(['dirty', 'saving', 'error', 'dirty', 'saving', 'saved']);
    expect((await inner.list()).map((m) => m.name)).toEqual([useEditor.getState().layout.name]);
  });

  it('любая другая ошибка сохранения тоже даёт статус error', async () => {
    const clock = fakeTimers();
    const { repo, failNext } = recordingRepo();
    start(repo, clock.timers);

    failNext(new Error('диск отвалился'));
    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(useEditor.getState().saveStatus).toBe('error');
    expect(useEditor.getState().notice?.level).toBe('error');
    expect(useEditor.getState().notice?.text).not.toBe(QUOTA_SAVE_TEXT);
  });

  it('правка во время записи: статус остаётся dirty, следом идёт вторая запись', async () => {
    const clock = fakeTimers();
    const { repo, saved, hold } = recordingRepo();
    start(repo, clock.timers);

    const release = hold();
    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    expect(useEditor.getState().saveStatus).toBe('saving');

    edit();
    release();
    await settle();
    // Первая запись завершилась, но макет уже другой — «сохранено» было бы неправдой.
    expect(useEditor.getState().saveStatus).toBe('dirty');

    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saved).toHaveLength(2);
    expect(saved[1]).toBe(useEditor.getState().layout);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('undo и чужие правки тоже сохраняются', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    start(repo, clock.timers);

    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    useEditor.getState().undo();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saved).toHaveLength(2);

    useEditor.getState().dispatch({ type: 'rename', name: 'Чужая правка' }, { origin: 'remote' });
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saved).toHaveLength(3);
    expect(saved[2].name).toBe('Чужая правка');
  });

  it('макет сменился до срабатывания таймера: ничего не пишется', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    start(repo, clock.timers);

    edit();
    // openLayout ставит saveStatus 'saved' — отложенная запись прежнего макета уже не нужна.
    useEditor.getState().openLayout(createLayout(testRoom, 'Другой макет'));
    clock.advance(AUTOSAVE_MAX_WAIT_MS);
    await settle();
    expect(saved).toHaveLength(0);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('stop() отписывается и отменяет ожидающие таймеры', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    const stop = start(repo, clock.timers);

    edit();
    expect(clock.pending()).toBe(2);
    stop();
    expect(clock.pending()).toBe(0);
    clock.advance(AUTOSAVE_MAX_WAIT_MS);
    expect(saved).toHaveLength(0);

    edit();
    expect(clock.pending()).toBe(0);
    clock.advance(AUTOSAVE_MAX_WAIT_MS);
    await settle();
    expect(saved).toHaveLength(0);
    // Повторный stop безвреден (StrictMode).
    stop();
  });

  it('два запуска и одна остановка: второй продолжает работать', async () => {
    const clock = fakeTimers();
    const { repo, saved } = recordingRepo();
    const stopFirst = start(repo, clock.timers);
    start(repo, clock.timers);
    stopFirst();

    edit();
    clock.advance(AUTOSAVE_DELAY_MS);
    await settle();
    expect(saved).toHaveLength(1);
  });
});

describe('saveNow', () => {
  it('ничего не делает, если несохранённого нет', async () => {
    const { repo, saved } = recordingRepo();
    expect(await saveNow(repo)).toBe(true);
    expect(saved).toHaveLength(0);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('вызывает repo.save синхронно — до первого await (сброс на pagehide)', async () => {
    const { repo, saved } = recordingRepo();
    edit();
    const pending = saveNow(repo);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(useEditor.getState().layout);
    expect(useEditor.getState().saveStatus).toBe('saving');
    expect(await pending).toBe(true);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('ошибка: false, статус error; повторный вызов сохраняет', async () => {
    const { repo, saved, failNext } = recordingRepo();
    edit();
    failNext(new RepositoryError('quota'));
    expect(await saveNow(repo)).toBe(false);
    expect(useEditor.getState().saveStatus).toBe('error');

    expect(await saveNow(repo)).toBe(true);
    expect(saved).toHaveLength(2);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('ошибка записи прежнего макета не портит статус уже открытого другого', async () => {
    const { repo, failNext, hold } = recordingRepo();
    edit();
    const release = hold();
    failNext(new RepositoryError('quota'));
    const pending = saveNow(repo);

    useEditor.getState().openLayout(createLayout(testRoom, 'Уже другой'));
    release();
    expect(await pending).toBe(false);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(useEditor.getState().notice).toBeNull();
  });
});
