// Чистые помощники списков: строки списка объектов и группы библиотеки. Без React и DOM.
import type { CatalogItem } from '../catalog/types';
import type { SceneObject } from '../model/types';

// ---------- Список объектов ----------

export interface ListRow {
  id: string;
  /** 1 — объект стоит на хозяине из той же группы и показан с отступом сразу под ним. */
  depth: 0 | 1;
  /** Хозяин из ДРУГОЙ группы (декор на столе площадки): строка остаётся в своей группе с пометкой «на: ‹имя›». */
  hostId: string | null;
}

export interface ObjectListModel {
  /** origin 'user'. */
  decor: ListRow[];
  /** origin 'venue'. */
  venue: ListRow[];
}

/**
 * Строки списка в порядке макета. Объект, стоящий на хозяине из своей группы, идёт сразу под ним (depth 1);
 * стоящий на хозяине из другой группы остаётся на своём месте и получает hostId. Битая ссылка (хозяина нет, хозяин —
 * сам объект или сам стоит на чём-то) — обычная строка верхнего уровня: ни один объект из списка не пропадает.
 */
export function buildObjectList(objects: readonly SceneObject[]): ObjectListModel {
  const byId = new Map<string, SceneObject>();
  for (const o of objects) if (!byId.has(o.id)) byId.set(o.id, o);

  const hostOf = (o: SceneObject): SceneObject | undefined => {
    if (o.mount.kind !== 'surface') return undefined;
    const host = byId.get(o.mount.hostId);
    return host && host.id !== o.id && host.mount.kind !== 'surface' ? host : undefined;
  };

  // Дети по хозяину из той же группы, в порядке макета.
  const nested = new Map<string, SceneObject[]>();
  const seen = new Set<string>();
  const unique: SceneObject[] = [];
  for (const o of objects) {
    if (seen.has(o.id)) continue; // дубликат id (битый макет до sanitizeLayout): побеждает первый
    seen.add(o.id);
    unique.push(o);
    const host = hostOf(o);
    if (host && host.origin === o.origin) {
      const list = nested.get(host.id);
      if (list) list.push(o);
      else nested.set(host.id, [o]);
    }
  }

  const model: ObjectListModel = { decor: [], venue: [] };
  for (const o of unique) {
    const host = hostOf(o);
    if (host && host.origin === o.origin) continue; // появится под хозяином
    const rows = o.origin === 'user' ? model.decor : model.venue;
    rows.push({ id: o.id, depth: 0, hostId: host ? host.id : null });
    for (const child of nested.get(o.id) ?? []) rows.push({ id: child.id, depth: 1, hostId: null });
  }
  return model;
}

function sameRows(a: readonly ListRow[], b: readonly ListRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].depth !== b[i].depth || a[i].hostId !== b[i].hostId) return false;
  }
  return true;
}

let listFor: readonly SceneObject[] | undefined;
let listModel: ObjectListModel = { decor: [], venue: [] };

/**
 * buildObjectList с мемоизацией для селектора zustand v5: тот же массив объектов → тот же результат; другой массив
 * с той же структурой (перетаскивание, правка свойств) → прежние ссылки на группы, чтобы список не перерисовывался.
 */
export function stableObjectList(objects: readonly SceneObject[]): ObjectListModel {
  if (objects === listFor) return listModel;
  listFor = objects;
  const next = buildObjectList(objects);
  const decor = sameRows(next.decor, listModel.decor) ? listModel.decor : next.decor;
  const venue = sameRows(next.venue, listModel.venue) ? listModel.venue : next.venue;
  if (decor !== listModel.decor || venue !== listModel.venue) listModel = { decor, venue };
  return listModel;
}

// ---------- Библиотека ----------

export interface LibraryGroup {
  category: string;
  items: CatalogItem[];
}

/** Для поиска: нижний регистр, «ё» = «е», пробелы по краям убраны. */
function normalize(text: string): string {
  return text.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
}

/**
 * Записи каталога по группам `category`; порядок групп и записей — как во входном списке (listedItems() — порядок
 * наборов). Запрос — слова через пробел; запись подходит, если каждое слово есть в названии, подсказке или категории.
 * Пустые группы не возвращаются.
 */
export function groupLibrary(items: readonly CatalogItem[], query: string): LibraryGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const groups: LibraryGroup[] = [];
  const byCategory = new Map<string, LibraryGroup>();
  for (const item of items) {
    if (words.length > 0) {
      const haystack = normalize(`${item.title} ${item.hint ?? ''} ${item.category}`);
      if (!words.every((word) => haystack.includes(word))) continue;
    }
    let group = byCategory.get(item.category);
    if (!group) {
      group = { category: item.category, items: [] };
      byCategory.set(item.category, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
