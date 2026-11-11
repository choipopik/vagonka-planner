// Шов realtime: только интерфейс, реализации сейчас нет.
import type { Command } from '../model/commands';
import type { CommandMeta } from '../store/editorStore';

export interface SyncChannel {
  /** Возвращает disconnect. */
  connect(layoutId: string, onRemote: (cmd: Command, meta: CommandMeta) => void): () => void;
  send(cmd: Command, meta: CommandMeta): void;
}
