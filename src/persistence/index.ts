// Точка сборки хранилища. Другие пакеты берут отсюда только `repository`; остальное — для session.ts и LayoutsMenu.
// Будущая серверная база макетов — другая реализация LayoutRepository в этой же строке (см. 2.18).
import type { StorageMode } from '../store/editorStore';
import { createLocalRepository } from './localRepository';
import type { AssetRecord } from './localRepository';
import { MemoryRepository } from './repository';
import type { LayoutRepository } from './repository';
import { browserStringStore, idbRecordStore, isQuotaError, memoryStringStore } from './stores';
import type { StringStore } from './stores';

/** База и (единственное) хранилище IndexedDB с файлами. */
const ASSET_DB = 'vagonka-assets';
const ASSET_STORE = 'assets';
const PROBE_KEY = 'vagonka:probe';

/** Текст тоста при старте и подсказки постоянной метки «Не сохраняется» в LayoutsMenu. */
export const MEMORY_STORAGE_TEXT = 'Хранилище браузера недоступно: макеты не сохранятся после закрытия вкладки';

interface Backend {
  repository: LayoutRepository;
  storageMode: StorageMode;
  /** Хранилище строк для настроек (vagonka:prefs): localStorage либо память. */
  settings: StringStore;
}

function memoryBackend(): Backend {
  return { repository: new MemoryRepository(), storageMode: 'memory', settings: memoryStringStore() };
}

/**
 * Хранилища браузера проверяются пробной записью: любое исключение (нет localStorage / indexedDB, запрет политикой
 * безопасности, приватный режим с нулевой квотой) → запасной MemoryRepository и режим 'memory'.
 * Единственное исключение — «нет места» при НЕпустом хранилище: оно доступно, просто заполнено; макеты читаются,
 * а неудачные сохранения показывает saveStatus 'error'.
 */
function openBackend(): Backend {
  try {
    const scope = globalThis as { localStorage?: Storage; indexedDB?: IDBFactory };
    // В части окружений само обращение к свойству бросает SecurityError — оно тоже внутри try.
    // Сначала indexedDB: в Node его нет, и до localStorage (в Node 25+ это экспериментальный глобал) дело не доходит.
    const idb = scope.indexedDB;
    if (!idb || typeof idb.open !== 'function') return memoryBackend();
    const storage = scope.localStorage;
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') return memoryBackend();
    try {
      storage.setItem(PROBE_KEY, '1');
      if (storage.getItem(PROBE_KEY) !== '1') return memoryBackend();
      storage.removeItem(PROBE_KEY);
    } catch (error) {
      if (!isQuotaError(error) || storage.length === 0) return memoryBackend();
    }
    const strings = browserStringStore(storage);
    return {
      repository: createLocalRepository({
        strings,
        assets: idbRecordStore<AssetRecord>(ASSET_DB, ASSET_STORE),
        now: () => Date.now(),
      }),
      storageMode: 'local',
      settings: strings,
    };
  } catch {
    return memoryBackend();
  }
}

const backend = openBackend();

export const repository: LayoutRepository = backend.repository;
/** 'memory' — работает запасной MemoryRepository; session.ts передаёт значение в setStorageMode. */
export const storageMode: StorageMode = backend.storageMode;
/** Где лежат настройки вида (используется только prefs / session внутри пакета). */
export const settingsStore: StringStore = backend.settings;
