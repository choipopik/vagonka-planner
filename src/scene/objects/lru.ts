// Небольшой LRU-кэш с обратным вызовом при вытеснении (dispose текстур и материалов). Чистый модуль.

export class LruCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly limit: number;
  private readonly onEvict: (value: V, key: string) => void;

  constructor(limit: number, onEvict: (value: V, key: string) => void) {
    this.limit = Math.max(1, Math.floor(limit));
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Возвращает запись и делает её самой «свежей». */
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Map хранит порядок вставки: перевставка переносит запись в конец.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Кладёт запись (заменённое значение вытесняется) и вытесняет самые старые сверх предела. */
  set(key: string, value: V): void {
    const previous = this.entries.get(key);
    this.entries.delete(key);
    if (previous !== undefined && previous !== value) this.onEvict(previous, key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.entries().next();
      if (oldest.done) break;
      const [oldKey, oldValue] = oldest.value;
      this.entries.delete(oldKey);
      this.onEvict(oldValue, oldKey);
    }
  }

  /** Вытесняет всё. */
  clear(): void {
    const all = [...this.entries];
    this.entries.clear();
    for (const [key, value] of all) this.onEvict(value, key);
  }
}
