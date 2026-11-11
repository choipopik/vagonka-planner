// Автосохранение: после каждой применённой команды — отложенная запись текущего макета.
// saveStatus: dirty (ставит dispatch) → saving → saved | error.
import { subscribeCommands, useEditor } from '../store/editorStore';
import { RepositoryError } from './repository';
import type { LayoutRepository } from './repository';

/** Пауза после последней правки. */
export const AUTOSAVE_DELAY_MS = 800;
/** Принудительное сохранение при непрерывных правках. */
export const AUTOSAVE_MAX_WAIT_MS = 5000;

export const QUOTA_SAVE_TEXT = 'Не удалось сохранить: мало места. Экспортируйте макет в файл';
const FAILED_SAVE_TEXT = 'Не удалось сохранить макет. Экспортируйте его в файл';

export interface AutosaveTimers {
  set: typeof setTimeout;
  clear: typeof clearTimeout;
}

// Обёртки, а не сами функции: вызов window.setTimeout как метода чужого объекта в браузере даёт «Illegal invocation».
const defaultTimers: AutosaveTimers = {
  set: ((handler: () => void, ms?: number) => setTimeout(handler, ms)) as typeof setTimeout,
  clear: ((id?: ReturnType<typeof setTimeout>) => clearTimeout(id)) as typeof clearTimeout,
};

export function saveErrorText(error: unknown): string {
  return error instanceof RepositoryError && error.code === 'quota' ? QUOTA_SAVE_TEXT : FAILED_SAVE_TEXT;
}

/** Номер последней попытки: итог более ранней (если сохранения наложились) статус уже не меняет. */
let attempt = 0;

/**
 * Сохраняет текущий макет, если есть несохранённое (saveStatus !== 'saved'). repo.save вызывается СИНХРОННО, до
 * первого await, — на этом держится сохранение из pagehide. Ошибка → saveStatus 'error' и тост; следующая правка
 * (или следующий вызов) повторит попытку. Возвращает true, если несохранённого не осталось.
 */
export async function saveNow(repo: LayoutRepository): Promise<boolean> {
  const state = useEditor.getState();
  if (state.saveStatus === 'saved') return true;
  const layout = state.layout;
  const mine = ++attempt;
  state.setSaveStatus('saving');
  try {
    await repo.save(layout);
  } catch (error) {
    const after = useEditor.getState();
    // Пока шла запись, мог открыться другой макет — его статус чужая ошибка не трогает.
    if (mine === attempt && after.layout.id === layout.id) {
      after.setSaveStatus('error');
      after.notify('error', saveErrorText(error));
    }
    return false;
  }
  const after = useEditor.getState();
  // Правка во время записи вернула статус 'dirty' и уже завела новый таймер — «сохранено» было бы неправдой.
  if (mine === attempt && after.layout === layout && after.saveStatus === 'saving') after.setSaveStatus('saved');
  return true;
}

/**
 * Подписывается на subscribeCommands (local, remote, history); возвращает stop(). Каждая команда перезапускает таймер
 * AUTOSAVE_DELAY_MS; первый таймер серии дополнительно заводит AUTOSAVE_MAX_WAIT_MS. timers внедряются для тестов.
 * stop() отменяет ожидающие таймеры, ничего не сохраняя (тот, кому это важно, сначала вызывает saveNow).
 */
export function startAutosave(repo: LayoutRepository, timers: AutosaveTimers = defaultTimers): () => void {
  const { set, clear } = timers;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let maxWait: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (delay !== undefined) clear(delay);
    if (maxWait !== undefined) clear(maxWait);
    delay = undefined;
    maxWait = undefined;
  };
  const fire = () => {
    cancel();
    // saveNow сам ничего не делает, если макет уже сохранён (например, сменой макета или flushSave).
    void saveNow(repo);
  };

  const unsubscribe = subscribeCommands(() => {
    if (delay !== undefined) clear(delay);
    delay = set(fire, AUTOSAVE_DELAY_MS);
    if (maxWait === undefined) maxWait = set(fire, AUTOSAVE_MAX_WAIT_MS);
  });

  return () => {
    unsubscribe();
    cancel();
  };
}
