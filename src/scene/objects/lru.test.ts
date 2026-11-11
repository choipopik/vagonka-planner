import { describe, expect, it } from 'vitest';
import { LruCache } from './lru';

function setup(limit: number) {
  const evicted: string[] = [];
  const cache = new LruCache<{ name: string }>(limit, (value, key) => evicted.push(`${key}=${value.name}`));
  return { cache, evicted };
}

describe('LruCache', () => {
  it('хранит до limit записей и вытесняет самую давнюю', () => {
    const { cache, evicted } = setup(2);
    cache.set('a', { name: 'A' });
    cache.set('b', { name: 'B' });
    expect(evicted).toEqual([]);
    cache.set('c', { name: 'C' });
    expect(evicted).toEqual(['a=A']);
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.name).toBe('B');
  });

  it('get делает запись самой свежей', () => {
    const { cache, evicted } = setup(2);
    cache.set('a', { name: 'A' });
    cache.set('b', { name: 'B' });
    cache.get('a');
    cache.set('c', { name: 'C' });
    expect(evicted).toEqual(['b=B']);
    expect(cache.has('a')).toBe(true);
  });

  it('has не меняет порядок', () => {
    const { cache, evicted } = setup(2);
    cache.set('a', { name: 'A' });
    cache.set('b', { name: 'B' });
    cache.has('a');
    cache.set('c', { name: 'C' });
    expect(evicted).toEqual(['a=A']);
  });

  it('замена значения вытесняет прежнее; повторная запись того же объекта — нет', () => {
    const { cache, evicted } = setup(2);
    const value = { name: 'A' };
    cache.set('a', value);
    cache.set('a', value);
    expect(evicted).toEqual([]);
    cache.set('a', { name: 'A2' });
    expect(evicted).toEqual(['a=A']);
    expect(cache.size).toBe(1);
    expect(cache.get('a')?.name).toBe('A2');
  });

  it('clear вытесняет всё', () => {
    const { cache, evicted } = setup(3);
    cache.set('a', { name: 'A' });
    cache.set('b', { name: 'B' });
    cache.clear();
    expect(evicted).toEqual(['a=A', 'b=B']);
    expect(cache.size).toBe(0);
  });

  it('предел не меньше одной записи', () => {
    const { cache, evicted } = setup(0);
    cache.set('a', { name: 'A' });
    expect(cache.size).toBe(1);
    cache.set('b', { name: 'B' });
    expect(evicted).toEqual(['a=A']);
    expect(cache.size).toBe(1);
  });
});
