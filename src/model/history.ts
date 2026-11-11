import type { Command } from './commands';

export interface HistoryEntry {
  label: string;
  redo: Command;
  undo: Command;
  mergeKey?: string;
  time: number;
}
export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}
export const EMPTY_HISTORY: History = { past: [], future: [] };
export const HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 1000;

/**
 * Добавляет шаг и очищает future. Если e.mergeKey задан, равен mergeKey верхнего шага и e.time − top.time ≤ MERGE_WINDOW_MS,
 * верхний шаг ЗАМЕНЯЕТСЯ склеенным: { label: top.label, mergeKey, time: e.time,
 *   redo: batch[top.redo, e.redo], undo: batch[e.undo, top.undo] }.
 * past обрезается до HISTORY_LIMIT (выпадают старейшие).
 */
export function pushHistory(h: History, e: HistoryEntry): History {
  const top = h.past[h.past.length - 1];
  let past: HistoryEntry[];
  if (top && e.mergeKey !== undefined && e.mergeKey === top.mergeKey && e.time - top.time <= MERGE_WINDOW_MS) {
    const merged: HistoryEntry = {
      label: top.label,
      mergeKey: e.mergeKey,
      time: e.time,
      redo: { type: 'batch', commands: [top.redo, e.redo] },
      undo: { type: 'batch', commands: [e.undo, top.undo] },
    };
    past = [...h.past.slice(0, -1), merged];
  } else {
    past = [...h.past, e];
  }
  if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

/** null — отменять нечего. command — то, что нужно применить (entry.undo). */
export function undoStep(h: History): { history: History; command: Command; label: string } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, entry] },
    command: entry.undo,
    label: entry.label,
  };
}

export function redoStep(h: History): { history: History; command: Command; label: string } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: { past: [...h.past, entry], future: h.future.slice(0, -1) },
    command: entry.redo,
    label: entry.label,
  };
}
