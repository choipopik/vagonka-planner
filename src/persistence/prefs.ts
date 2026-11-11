// Настройки вида и «последний макет помещения»: одна запись `vagonka:prefs` в хранилище строк. Не часть макета.
import { LAYOUT_PATTERNS } from '../model/migrate';
import type { AmbienceId, LayerMode } from '../model/types';
import type { StringStore } from './stores';

export const PREFS_KEY = 'vagonka:prefs';
/** Больше помещений в записи не хранится (защита от раздутой или подменённой записи). */
const ROOMS_LIMIT = 64;

export interface Prefs {
  /** Последнее открытое помещение; null — ещё не выбиралось. */
  roomId: string | null;
  /** id помещения → id макета, открытого в нём последним. */
  lastLayoutByRoom: Record<string, string>;
  showLabels: boolean;
  gridSnap: boolean;
  ambience: AmbienceId;
  layer: LayerMode;
}

/** Совпадает с начальным состоянием стора. */
export function defaultPrefs(): Prefs {
  return { roomId: null, lastLayoutByRoom: {}, showLabels: true, gridSnap: true, ambience: 'work', layer: 'auto' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && LAYOUT_PATTERNS.id.test(value);
}

/** Недоверенная запись → настройки: каждое поле проверяется отдельно, негодное заменяется значением по умолчанию. */
export function parsePrefs(raw: unknown): Prefs {
  const prefs = defaultPrefs();
  if (!isRecord(raw)) return prefs;
  if (isId(raw.roomId)) prefs.roomId = raw.roomId;
  if (isRecord(raw.lastLayoutByRoom)) {
    for (const key of Object.keys(raw.lastLayoutByRoom).slice(0, ROOMS_LIMIT)) {
      const value = raw.lastLayoutByRoom[key];
      if (isId(key) && isId(value)) prefs.lastLayoutByRoom[key] = value;
    }
  }
  if (typeof raw.showLabels === 'boolean') prefs.showLabels = raw.showLabels;
  if (typeof raw.gridSnap === 'boolean') prefs.gridSnap = raw.gridSnap;
  if (raw.ambience === 'work' || raw.ambience === 'party') prefs.ambience = raw.ambience;
  if (raw.layer === 'auto' || raw.layer === 'floor' || raw.layer === 'ceiling') prefs.layer = raw.layer;
  return prefs;
}

/** Нет записи, битый JSON или недоступное хранилище → значения по умолчанию. */
export function readPrefs(strings: StringStore): Prefs {
  try {
    const text = strings.get(PREFS_KEY);
    return text === null ? defaultPrefs() : parsePrefs(JSON.parse(text));
  } catch {
    return defaultPrefs();
  }
}

/** false — записать не удалось (нет места и т. п.); настройки не критичны, ошибка наружу не выходит. */
export function writePrefs(strings: StringStore, prefs: Prefs): boolean {
  try {
    strings.set(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
