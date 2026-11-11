// Кэш загружаемых ресурсов со счётчиком ссылок: ресурс освобождается через delayMs после последнего release —
// поэтому переживает undo/redo, перемонтирование и двойной монтаж StrictMode. Чистый модуль (без three, React и DOM).

export type CacheStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface CacheSnapshot<T> {
  status: CacheStatus;
  value: T | null;
}

export interface RefCacheOptions<T> {
  /** Ресурс; null — такого файла нет ('missing'); исключение — файл есть, но не читается ('error'). */
  load(id: string): Promise<T | null>;
  dispose(value: T): void;
  /** Задержка освобождения после последнего release, мс. По умолчанию 5000. */
  delayMs?: number;
}

interface Entry<T> {
  refs: number;
  snapshot: CacheSnapshot<T>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Номер текущей загрузки: результат устаревшей загрузки выбрасывается. */
  token: number;
}

/** Задержка освобождения по умолчанию, мс. */
export const RELEASE_DELAY_MS = 5000;

// Один объект на всех: снимок записи до и во время загрузки не меняет ссылку (важно для useSyncExternalStore).
const LOADING: CacheSnapshot<never> = Object.freeze({ status: 'loading', value: null });

export class RefCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly listeners = new Set<() => void>();
  private readonly options: RefCacheOptions<T>;
  private readonly delayMs: number;
  private tokens = 0;

  constructor(options: RefCacheOptions<T>) {
    this.options = options;
    this.delayMs = options.delayMs ?? RELEASE_DELAY_MS;
  }

  /** Подписка на любые изменения снимков; возвращает отписку. Метод — стрелка: годится для useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Снимок записи; ссылка меняется только при смене состояния. Записи нет → «загружается». */
  get(id: string): CacheSnapshot<T> {
    return this.entries.get(id)?.snapshot ?? LOADING;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** +1 ссылка; первая — запускает загрузку, повторная — отменяет запланированное освобождение. */
  acquire(id: string): void {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { refs: 0, snapshot: LOADING, timer: undefined, token: 0 };
      this.entries.set(id, entry);
      this.start(id, entry);
    }
    entry.refs += 1;
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  /** −1 ссылка; после последней запись живёт ещё delayMs и затем освобождается. */
  release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.refs === 0) return;
    entry.refs -= 1;
    if (entry.refs > 0 || entry.timer !== undefined) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (entry.refs === 0 && this.entries.get(id) === entry) this.drop(id, entry);
    }, this.delayMs);
  }

  /**
   * Загрузить заново. onlyFailed (по умолчанию) — только запись в состоянии 'missing' / 'error': файл появился в
   * хранилище после того, как объект уже нарисован заглушкой. Записи нет → ничего не делает.
   */
  reload(id: string, onlyFailed = true): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const { status, value } = entry.snapshot;
    if (onlyFailed && status !== 'missing' && status !== 'error') return;
    if (value !== null) this.options.dispose(value);
    entry.snapshot = LOADING;
    this.start(id, entry);
    this.notify();
  }

  /** id записей в состоянии 'missing' / 'error'. */
  failedIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.snapshot.status === 'missing' || entry.snapshot.status === 'error') ids.push(id);
    }
    return ids;
  }

  private start(id: string, entry: Entry<T>): void {
    const token = ++this.tokens;
    entry.token = token;
    const settle = (snapshot: CacheSnapshot<T>) => {
      // Запись уже освобождена или перезапущена: результат никому не нужен.
      if (this.entries.get(id) !== entry || entry.token !== token) {
        if (snapshot.value !== null) this.options.dispose(snapshot.value);
        return;
      }
      entry.snapshot = snapshot;
      this.notify();
    };
    let pending: Promise<T | null>;
    try {
      pending = this.options.load(id);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (value) => settle(value === null ? { status: 'missing', value: null } : { status: 'ready', value }),
      () => settle({ status: 'error', value: null }),
    );
  }

  private drop(id: string, entry: Entry<T>): void {
    this.entries.delete(id);
    const { value } = entry.snapshot;
    if (value !== null) this.options.dispose(value);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
