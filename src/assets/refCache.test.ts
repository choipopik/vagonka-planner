import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_DELAY_MS, RefCache } from './refCache';

interface Resource {
  id: string;
  serial: number;
}

/** Кэш с управляемой загрузкой: обещания разрешаются вручную. */
function setup(delayMs?: number) {
  const pending = new Map<string, { resolve(value: Resource | null): void; reject(error: unknown): void }[]>();
  const loads: string[] = [];
  const disposed: Resource[] = [];
  let serial = 0;
  const cache = new RefCache<Resource>({
    load(id) {
      loads.push(id);
      return new Promise<Resource | null>((resolve, reject) => {
        const list = pending.get(id) ?? [];
        list.push({ resolve, reject });
        pending.set(id, list);
      });
    },
    dispose: (value) => disposed.push(value),
    delayMs,
  });
  const next = (id: string) => {
    const waiter = pending.get(id)?.shift();
    if (!waiter) throw new Error(`нет ожидающей загрузки «${id}»`);
    return waiter;
  };
  return {
    cache,
    loads,
    disposed,
    /** Завершает самую раннюю незавершённую загрузку id. */
    async finish(id: string): Promise<Resource> {
      const resource = { id, serial: ++serial };
      next(id).resolve(resource);
      await Promise.resolve();
      await Promise.resolve();
      return resource;
    },
    async finishMissing(id: string): Promise<void> {
      next(id).resolve(null);
      await Promise.resolve();
      await Promise.resolve();
    },
    async fail(id: string): Promise<void> {
      next(id).reject(new Error('сбой'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RefCache: загрузка', () => {
  it('первая ссылка запускает загрузку, повторные — нет', async () => {
    const { cache, loads, finish } = setup();
    expect(cache.get('a')).toEqual({ status: 'loading', value: null });
    cache.acquire('a');
    cache.acquire('a');
    expect(loads).toEqual(['a']);
    expect(cache.get('a').status).toBe('loading');
    const resource = await finish('a');
    expect(cache.get('a')).toEqual({ status: 'ready', value: resource });
  });

  it('снимок не меняет ссылку, пока не изменилось состояние', async () => {
    const { cache, finish } = setup();
    cache.acquire('a');
    const loading = cache.get('a');
    expect(cache.get('a')).toBe(loading);
    // Записи нет и запись загружается — один и тот же объект.
    expect(cache.get('other')).toBe(loading);
    await finish('a');
    const ready = cache.get('a');
    expect(ready).not.toBe(loading);
    expect(cache.get('a')).toBe(ready);
  });

  it('нет файла → missing; ошибка загрузки → error', async () => {
    const { cache, finishMissing, fail } = setup();
    cache.acquire('gone');
    await finishMissing('gone');
    expect(cache.get('gone')).toEqual({ status: 'missing', value: null });
    cache.acquire('bad');
    await fail('bad');
    expect(cache.get('bad')).toEqual({ status: 'error', value: null });
    expect(cache.failedIds().sort()).toEqual(['bad', 'gone']);
  });

  it('синхронное исключение в load → error', async () => {
    const cache = new RefCache<Resource>({
      load() {
        throw new Error('сразу');
      },
      dispose: () => undefined,
    });
    cache.acquire('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.get('a').status).toBe('error');
  });

  it('подписчики узнают о смене состояния; отписка работает', async () => {
    const { cache, finish } = setup();
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    cache.acquire('a');
    expect(listener).not.toHaveBeenCalled();
    await finish('a');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    cache.acquire('b');
    await finish('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('RefCache: освобождение', () => {
  it('по умолчанию — через 5 с после последнего release', async () => {
    expect(RELEASE_DELAY_MS).toBe(5000);
    const { cache, disposed, finish } = setup();
    cache.acquire('a');
    const resource = await finish('a');
    cache.release('a');
    vi.advanceTimersByTime(4999);
    expect(disposed).toEqual([]);
    expect(cache.get('a').status).toBe('ready');
    vi.advanceTimersByTime(1);
    expect(disposed).toEqual([resource]);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a').status).toBe('loading');
  });

  it('пока есть хоть одна ссылка, ресурс живёт', async () => {
    const { cache, disposed, finish } = setup(100);
    cache.acquire('a');
    cache.acquire('a');
    await finish('a');
    cache.release('a');
    vi.advanceTimersByTime(1000);
    expect(disposed).toEqual([]);
    cache.release('a');
    vi.advanceTimersByTime(100);
    expect(disposed).toHaveLength(1);
  });

  it('повторный acquire в течение задержки отменяет освобождение и не перезагружает (undo/redo, StrictMode)', async () => {
    const { cache, loads, disposed, finish } = setup(100);
    cache.acquire('a');
    const resource = await finish('a');
    cache.release('a');
    vi.advanceTimersByTime(99);
    cache.acquire('a');
    vi.advanceTimersByTime(1000);
    expect(disposed).toEqual([]);
    expect(loads).toEqual(['a']);
    expect(cache.get('a').value).toBe(resource);
    // Следующее освобождение отсчитывает задержку заново.
    cache.release('a');
    vi.advanceTimersByTime(99);
    expect(disposed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(disposed).toEqual([resource]);
  });

  it('лишний release не уводит счётчик в минус и не освобождает чужую ссылку', async () => {
    const { cache, disposed, finish } = setup(100);
    cache.release('never');
    cache.acquire('a');
    await finish('a');
    cache.release('a');
    cache.release('a');
    cache.acquire('a');
    vi.advanceTimersByTime(1000);
    expect(disposed).toEqual([]);
  });

  it('загрузка, завершившаяся после освобождения записи, сразу освобождается', async () => {
    const { cache, disposed, finish } = setup(100);
    cache.acquire('a');
    cache.release('a');
    vi.advanceTimersByTime(100);
    expect(cache.has('a')).toBe(false);
    const late = await finish('a');
    expect(disposed).toEqual([late]);
    expect(cache.get('a').status).toBe('loading');
  });

  it('после освобождения новая ссылка загружает заново', async () => {
    const { cache, loads, finish } = setup(100);
    cache.acquire('a');
    await finish('a');
    cache.release('a');
    vi.advanceTimersByTime(100);
    cache.acquire('a');
    expect(loads).toEqual(['a', 'a']);
    const second = await finish('a');
    expect(cache.get('a').value).toBe(second);
  });
});

describe('RefCache: reload', () => {
  it('по умолчанию перечитывает только missing / error', async () => {
    const { cache, loads, disposed, finish, finishMissing } = setup();
    cache.acquire('ok');
    const ok = await finish('ok');
    cache.acquire('gone');
    await finishMissing('gone');

    cache.reload('ok');
    expect(cache.get('ok').value).toBe(ok);
    cache.reload('gone');
    expect(cache.get('gone').status).toBe('loading');
    expect(loads).toEqual(['ok', 'gone', 'gone']);
    const found = await finish('gone');
    expect(cache.get('gone')).toEqual({ status: 'ready', value: found });
    expect(cache.failedIds()).toEqual([]);
    expect(disposed).toEqual([]);
  });

  it('onlyFailed = false перечитывает и готовый ресурс, освобождая прежний', async () => {
    const { cache, disposed, finish } = setup();
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.acquire('a');
    const first = await finish('a');
    cache.reload('a', false);
    expect(disposed).toEqual([first]);
    expect(cache.get('a').status).toBe('loading');
    const second = await finish('a');
    expect(cache.get('a').value).toBe(second);
    // ready → loading → ready.
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('результат устаревшей загрузки выбрасывается', async () => {
    const { cache, disposed, finish, fail } = setup();
    cache.acquire('a');
    await fail('a');
    cache.acquire('b');
    // Первая загрузка «b» ещё идёт, когда её перезапускают.
    cache.reload('b', false);
    const stale = await finish('b');
    expect(disposed).toEqual([stale]);
    expect(cache.get('b').status).toBe('loading');
    const fresh = await finish('b');
    expect(cache.get('b').value).toBe(fresh);
  });

  it('записи нет → ничего не делает', () => {
    const { cache, loads } = setup();
    cache.reload('nobody');
    expect(loads).toEqual([]);
    expect(cache.has('nobody')).toBe(false);
  });
});
