import type { Layout, SceneObject } from './types';

/** Свойство заменяется ЦЕЛИКОМ (mount и params — тоже; слияния по ключам нет). id / kind / type / origin патчить нельзя. */
export type ObjectPatch = Partial<
  Pick<SceneObject, 'name' | 'mount' | 'rotationY' | 'size' | 'color' | 'assetId' | 'locked' | 'visible' | 'params'>
>;

export type Command =
  /** id назначает отправитель. index — позиция вставки в objects на момент вставки этого элемента; по умолчанию в конец. */
  | { type: 'add'; items: { object: SceneObject; index?: number }[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'patch'; patches: { id: string; set: ObjectPatch }[] }
  | { type: 'rename'; name: string }
  | { type: 'batch'; commands: Command[] };

/** Изменяемые поля объекта — ровно ключи ObjectPatch (помощник для ops.ts и стора; в спецификации не описан). */
export const PATCH_KEYS = ['name', 'mount', 'rotationY', 'size', 'color', 'assetId', 'locked', 'visible', 'params'] as const;

/** Структурное равенство JSON-значений (помощник; в спецификации не описан). NaN равен NaN. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const arrayA = Array.isArray(a);
  if (arrayA !== Array.isArray(b)) return false;
  if (arrayA) {
    const xs = a as unknown[];
    const ys = b as unknown[];
    if (xs.length !== ys.length) return false;
    for (let i = 0; i < xs.length; i++) if (!deepEqual(xs[i], ys[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(rb, key) || !deepEqual(ra[key], rb[key])) return false;
  }
  return true;
}

export function applyPatch(o: SceneObject, set: ObjectPatch): SceneObject {
  let next: SceneObject | undefined;
  const source = set as Record<string, unknown>;
  for (const key of PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === undefined || deepEqual(o[key], value)) continue;
    next ??= { ...o };
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next ?? o;
}

function insertIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length;
  return Math.min(length, Math.max(0, Math.trunc(index)));
}

function applyToObjects(objects: SceneObject[], name: string, cmd: Command): { objects: SceneObject[]; name: string } {
  switch (cmd.type) {
    case 'add': {
      let next: SceneObject[] | undefined;
      const ids = new Set(objects.map((o) => o.id));
      for (const item of cmd.items) {
        if (ids.has(item.object.id)) continue;
        next ??= objects.slice();
        next.splice(insertIndex(item.index, next.length), 0, item.object);
        ids.add(item.object.id);
      }
      return { objects: next ?? objects, name };
    }
    case 'remove': {
      const ids = new Set(cmd.ids);
      const next = objects.filter((o) => !ids.has(o.id));
      return { objects: next.length === objects.length ? objects : next, name };
    }
    case 'patch': {
      let next: SceneObject[] | undefined;
      for (const p of cmd.patches) {
        const current: SceneObject[] = next ?? objects;
        const i = current.findIndex((o) => o.id === p.id);
        if (i < 0) continue;
        const patched = applyPatch(current[i], p.set);
        if (patched === current[i]) continue;
        next ??= objects.slice();
        next[i] = patched;
      }
      return { objects: next ?? objects, name };
    }
    case 'rename':
      return { objects, name: cmd.name };
    case 'batch': {
      let state = { objects, name };
      for (const c of cmd.commands) state = applyToObjects(state.objects, state.name, c);
      return state;
    }
  }
}

/**
 * Чистая, не мутирует вход, никогда не бросает. Не трогает updatedAt (это делает стор).
 *   add    — элементы по порядку; объект с уже существующим id пропускается; index зажимается в [0, length]
 *   remove — неизвестные id пропускаются
 *   patch  — неизвестные id пропускаются; читаются только ключи ObjectPatch; значение, deep-равное текущему, не создаёт новый объект
 *   rename — заменяет layout.name
 *   batch  — последовательно; вложенные batch разрешены
 * Нетронутые объекты сохраняют ссылку; если ничего не изменилось — возвращается ТОТ ЖЕ layout.
 */
export function applyCommand(layout: Layout, cmd: Command): Layout {
  const next = applyToObjects(layout.objects, layout.name, cmd);
  if (next.objects === layout.objects && next.name === layout.name) return layout;
  return { ...layout, objects: next.objects, name: next.name };
}

/**
 * Обратная команда относительно layout ДО применения cmd:
 *   applyCommand(applyCommand(l, c), invertCommand(l, c)) deep-равен l (включая порядок объектов).
 *   add    → remove тех id, которые реально добавятся
 *   remove → add удалённых объектов с их прежними индексами, по возрастанию индекса
 *   patch  → patch с прежними значениями тех же ключей (только для существующих id)
 *   rename → rename с прежним именем
 *   batch  → batch обратных команд в обратном порядке (каждая — относительно промежуточного состояния)
 */
export function invertCommand(layout: Layout, cmd: Command): Command {
  switch (cmd.type) {
    case 'add': {
      const ids = new Set(layout.objects.map((o) => o.id));
      const added: string[] = [];
      for (const item of cmd.items) {
        if (ids.has(item.object.id)) continue;
        ids.add(item.object.id);
        added.push(item.object.id);
      }
      return { type: 'remove', ids: added };
    }
    case 'remove': {
      const ids = new Set(cmd.ids);
      const items: { object: SceneObject; index: number }[] = [];
      layout.objects.forEach((object, index) => {
        if (ids.has(object.id)) items.push({ object, index });
      });
      return { type: 'add', items };
    }
    case 'patch': {
      // Один и тот же id может встретиться дважды: прежние значения берутся из промежуточного состояния,
      // а обратные патчи идут в обратном порядке.
      const current = new Map<string, SceneObject>();
      const patches: { id: string; set: ObjectPatch }[] = [];
      for (const p of cmd.patches) {
        const before = current.get(p.id) ?? layout.objects.find((o) => o.id === p.id);
        if (!before) continue;
        const source = p.set as Record<string, unknown>;
        const previous: Record<string, unknown> = {};
        for (const key of PATCH_KEYS) {
          if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) previous[key] = before[key];
        }
        patches.push({ id: p.id, set: previous as ObjectPatch });
        current.set(p.id, applyPatch(before, p.set));
      }
      return { type: 'patch', patches: patches.reverse() };
    }
    case 'rename':
      return { type: 'rename', name: layout.name };
    case 'batch': {
      const inverses: Command[] = [];
      let state = layout;
      for (const c of cmd.commands) {
        inverses.push(invertCommand(state, c));
        state = applyCommand(state, c);
      }
      return { type: 'batch', commands: inverses.reverse() };
    }
  }
}

/** true, если applyCommand(layout, cmd) === layout. */
export function isNoop(layout: Layout, cmd: Command): boolean {
  return applyCommand(layout, cmd) === layout;
}

/** id объектов, которые команда добавляет, удаляет или патчит (без повторов). */
export function touchedIds(cmd: Command): string[] {
  const ids = new Set<string>();
  const visit = (c: Command) => {
    switch (c.type) {
      case 'add':
        for (const item of c.items) ids.add(item.object.id);
        break;
      case 'remove':
        for (const id of c.ids) ids.add(id);
        break;
      case 'patch':
        for (const p of c.patches) ids.add(p.id);
        break;
      case 'rename':
        break;
      case 'batch':
        c.commands.forEach(visit);
        break;
    }
  };
  visit(cmd);
  return [...ids];
}
