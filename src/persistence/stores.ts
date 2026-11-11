// Низкоуровневые хранилища LocalRepository. Они внедряются, чтобы репозиторий, настройки и формат файла
// проверялись в Node: в браузере — localStorage и IndexedDB (idb-keyval), в тестах — память.
// Вместе с index.ts это единственное место пакета, которое трогает хранилища браузера напрямую.
import { createStore, del, get, keys, set, values } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';

/** Синхронное хранилище строк (localStorage). set бросает исходную ошибку хранилища, в т. ч. ошибку квоты. */
export interface StringStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** Асинхронное хранилище записей по строковому ключу (одно хранилище IndexedDB). */
export interface RecordStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  values(): Promise<T[]>;
}

/**
 * Ошибка «нет места»: DOMException с name 'QuotaExceededError' / 'NS_ERROR_DOM_QUOTA_REACHED' либо code 22 / 1014.
 * Проверка по полям, а не instanceof: в старых браузерах и в тестах это может быть не настоящий DOMException.
 */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export function browserStringStore(storage: Storage): StringStore {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => {
      storage.setItem(key, value);
    },
    remove: (key) => {
      storage.removeItem(key);
    },
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    },
  };
}

/** База и хранилище открываются при первом обращении (idb-keyval сам откладывает indexedDB.open до первой операции). */
export function idbRecordStore<T>(dbName: string, storeName: string): RecordStore<T> {
  let store: UseStore | undefined;
  const use = (): UseStore => (store ??= createStore(dbName, storeName));
  return {
    get: (key) => get<T>(key, use()),
    set: (key, value) => set(key, value, use()),
    del: (key) => del(key, use()),
    keys: async () => (await keys<IDBValidKey>(use())).filter((key): key is string => typeof key === 'string'),
    values: () => values<T>(use()),
  };
}

/** quotaChars: при превышении set бросает DOMException с name 'QuotaExceededError'; прежнее значение ключа остаётся. */
export function memoryStringStore(quotaChars?: number): StringStore {
  const data = new Map<string, string>();
  let used = 0;
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      const previous = data.get(key);
      const next = used - (previous === undefined ? 0 : key.length + previous.length) + key.length + value.length;
      if (quotaChars !== undefined && next > quotaChars) {
        throw new DOMException('Хранилище переполнено', 'QuotaExceededError');
      }
      data.set(key, value);
      used = next;
    },
    remove: (key) => {
      const previous = data.get(key);
      if (previous === undefined) return;
      used -= key.length + previous.length;
      data.delete(key);
    },
    keys: () => [...data.keys()],
  };
}

export function memoryRecordStore<T>(): RecordStore<T> {
  const data = new Map<string, T>();
  return {
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    del: async (key) => {
      data.delete(key);
    },
    keys: async () => [...data.keys()],
    values: async () => [...data.values()],
  };
}
