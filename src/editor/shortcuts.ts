// Горячие клавиши редактора — ровно объём B. Клавиши определяются по KeyboardEvent.code (не зависят от раскладки).
// Сдвига стрелками и поворота клавишей нет: точные значения вводятся в панели свойств.
import { useEffect } from 'react';
import { deleteObject, duplicateObject } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { canEdit } from '../store/selectors';
import { cancelGesture } from './gesture';

/** Что делает нажатие; null — клавиша не наша. */
export type ShortcutAction = 'undo' | 'redo' | 'delete' | 'duplicate' | 'escape' | 'grid';

/** Поля события, от которых зависит решение (KeyboardEvent им удовлетворяет). */
export interface ShortcutKey {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

/**
 * Таблица клавиш раздела W2:
 *   Ctrl/Cmd+KeyZ — undo; Ctrl/Cmd+Shift+KeyZ и Ctrl+KeyY — redo; Delete / Backspace — удалить выбранный;
 *   Ctrl/Cmd+KeyD — дублировать; Escape — отменить перетаскивание, иначе снять выбор; KeyG — привязка к сетке.
 */
export function shortcutAction(e: ShortcutKey): ShortcutAction | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (e.code === 'KeyZ') return e.shiftKey ? 'redo' : 'undo';
    if (e.code === 'KeyY' && e.ctrlKey && !e.shiftKey) return 'redo';
    // Автоповтор зажатой клавиши не должен плодить копии.
    if (e.code === 'KeyD' && !e.shiftKey) return e.repeat ? null : 'duplicate';
    return null;
  }
  if (e.shiftKey) return null;
  switch (e.code) {
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'escape';
    case 'KeyG':
      return e.repeat ? null : 'grid';
    default:
      return null;
  }
}

/** Фокус в поле ввода: клавиши принадлежат полю, а не редактору. */
export function isTextTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** То, что обработчику нужно от события клавиатуры (KeyboardEvent этому удовлетворяет; в тестах — простой объект). */
export interface ShortcutEvent extends ShortcutKey {
  target: unknown;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  preventDefault(): void;
}

/** Обработчик keydown: все изменяющие действия в режиме прогулки не работают. */
export function handleShortcut(e: ShortcutEvent): void {
  if (e.defaultPrevented || e.isComposing || isTextTarget(e.target)) return;
  const action = shortcutAction(e);
  if (!action) return;
  const state = useEditor.getState();

  switch (action) {
    case 'undo':
      // Стор сам ничего не делает в прогулке и во время перетаскивания.
      e.preventDefault();
      state.undo();
      return;
    case 'redo':
      e.preventDefault();
      state.redo();
      return;
    case 'delete':
      if (!canEdit() || state.draft !== null || state.selectedId === null) return;
      e.preventDefault();
      deleteObject(state.selectedId);
      return;
    case 'duplicate':
      // preventDefault — всегда: иначе браузер откроет «Добавить закладку».
      e.preventDefault();
      if (!canEdit() || state.draft !== null || state.selectedId === null) return;
      duplicateObject(state.selectedId);
      return;
    case 'escape':
      // Сначала — текущее перетаскивание (его знает PointerController); если его нет — снимается выбор.
      if (cancelGesture()) return;
      if (state.draft !== null) state.setDraft(null);
      else state.select(null);
      return;
    case 'grid':
      if (!canEdit()) return;
      state.setGridSnap(!state.gridSnap);
      return;
  }
}

/** Вызывается один раз в App. Слушатель — в эффекте с симметричной очисткой (StrictMode). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handleShortcut(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
