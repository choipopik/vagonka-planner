import type { CatalogItem, CatalogLookup } from '../catalog/types';
import { PATCH_KEYS, applyCommand, applyPatch, deepEqual, isNoop } from './commands';
import type { Command, ObjectPatch } from './commands';
import { newId } from './layout';
import { LAYOUT_LIMITS, LAYOUT_PATTERNS } from './migrate';
import { childrenOf, clampMount, makeContext, remount, resolvePose, toLocal, toWorld } from './pose';
import type { SceneContext } from './pose';
import type { Layout, Mount, MountKind, Params, RoomDef, SceneObject, Vec3 } from './types';

/** Пределы любой стороны объекта, метры (I4). Единственное место; панель свойств и ручки пользуются clampSize. */
export const MIN_SIZE = 0.01;
export const MAX_SIZE = 20;

/** Предел длины имени объекта — тот же, что проверяет parseLayout. */
const NAME_LIMIT = LAYOUT_LIMITS.name;
/** Сдвиг копии относительно оригинала, м. */
const COPY_SHIFT = 0.3;
const COPY_SUFFIX = ' (копия)';

const EMPTY: Command = { type: 'batch', commands: [] };

/**
 * Угол, который переживёт сохранение: parseLayout отбрасывает объект с |rotationY| > LAYOUT_LIMITS.coord, а углы
 * складываются (мировой угол ребёнка = угол хозяина + свой) и ничем не ограничены. Угол за пределом заменяется
 * равным ему по модулю 2π из (−π, π]; обычные углы не трогаются. Не число → fallback.
 */
function safeAngle(angle: number, fallback: number): number {
  if (!Number.isFinite(angle)) return fallback;
  if (Math.abs(angle) <= LAYOUT_LIMITS.coord) return angle;
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.round(angle / turn);
  // Для огромных чисел остаток теряет смысл и может выйти за пределы — тогда просто 0.
  return Math.abs(wrapped) <= Math.PI + 1e-9 ? wrapped : 0;
}

/** Сторона, допустимая по I4: не число или ≤ 0 → fallback, иначе зажимается в [MIN_SIZE, MAX_SIZE]. */
function safeSide(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, value));
}

/** Цвет '#rrggbb' — единственный вид, который parseLayout оставляет; с любым другим объект пропал бы при загрузке. */
function isColor(value: unknown): value is string {
  return typeof value === 'string' && LAYOUT_PATTERNS.color.test(value);
}

/** Идентификатор файла вида a_<32 hex>; с любым другим parseLayout отбросил бы объект. */
function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && LAYOUT_PATTERNS.assetId.test(value);
}

/** Параметры — простая запись не более чем из LAYOUT_LIMITS.paramKeys ключей (иначе parseLayout отбросил бы объект). */
function isParams(value: unknown): value is Params {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length <= LAYOUT_LIMITS.paramKeys
  );
}

type PatchEntry = { id: string; set: ObjectPatch };

/** Собирает команды в одну: пустые патчи и remove выбрасываются; одна команда возвращается без обёртки. */
function pack(commands: Command[]): Command {
  const real = commands.filter((c) => {
    if (c.type === 'patch') return c.patches.length > 0;
    if (c.type === 'remove') return c.ids.length > 0;
    if (c.type === 'add') return c.items.length > 0;
    if (c.type === 'batch') return c.commands.length > 0;
    return true;
  });
  if (real.length === 0) return EMPTY;
  return real.length === 1 ? real[0] : { type: 'batch', commands: real };
}

/**
 * Единственное правило изменения размера (панель свойств → cmdPatch, ручки → resolveResize). Чистая, не округляет.
 * lo[i] = max(MIN_SIZE, item.minSize?.[i] ?? 0), hi[i] = min(MAX_SIZE, item.maxSize?.[i] ?? ∞).
 *   - компонент next[i] не конечен или ≤ 0 → берётся prev[i];
 *   - ось item.flatAxis всегда сохраняет prev (толщина листа не масштабируется и не редактируется);
 *   - resize 'none'    → prev;
 *   - resize 'free'    → каждая ось независимо зажимается в [lo, hi];
 *   - resize 'uniform' → ОДИН коэффициент k = next[a] / prev[a], где a — ось с наибольшим |next[i] / prev[i] − 1|
 *                        (кроме flatAxis); k зажимается в [max_i(lo[i] / prev[i]), min_i(hi[i] / prev[i])] по тем же осям;
 *                        результат = prev × k покомпонентно — пропорции сохраняются точно.
 * Если ничего не изменилось — возвращается prev (та же ссылка).
 */
export function clampSize(item: CatalogItem, prev: Vec3, next: Vec3): Vec3 {
  if (item.resize === 'none') return prev;
  const axes = ([0, 1, 2] as const).filter((i) => i !== item.flatAxis);
  const lo = (i: number) => Math.max(MIN_SIZE, item.minSize?.[i] ?? 0);
  const hi = (i: number) => Math.min(MAX_SIZE, item.maxSize?.[i] ?? Infinity);
  const wanted = (i: number) => {
    const v = next[i];
    return Number.isFinite(v) && v > 0 ? v : prev[i];
  };
  const result: Vec3 = [prev[0], prev[1], prev[2]];

  if (item.resize === 'free') {
    for (const i of axes) result[i] = Math.min(hi(i), Math.max(lo(i), wanted(i)));
  } else {
    // uniform: один коэффициент по оси с наибольшим относительным изменением.
    let k = 1;
    let strongest = 0;
    let kMin = 0;
    let kMax = Infinity;
    for (const i of axes) {
      if (!(prev[i] > 0)) continue; // вырожденный исходный размер в коэффициенте не участвует
      const ratio = wanted(i) / prev[i];
      if (Math.abs(ratio - 1) > strongest) {
        strongest = Math.abs(ratio - 1);
        k = ratio;
      }
      kMin = Math.max(kMin, lo(i) / prev[i]);
      kMax = Math.min(kMax, hi(i) / prev[i]);
    }
    k = Math.min(kMax, Math.max(kMin, k));
    if (k !== 1 && Number.isFinite(k) && k > 0) {
      // prev × (hi / prev) может дать hi + 1 ulp (20.000000000000004): итог дожимается в [lo, hi], иначе нарушился бы I4,
      // а sanitizeLayout «чинил» бы результат построителя. Для допустимого prev поправка не больше ошибки округления.
      for (const i of axes) {
        const side = prev[i] * k;
        result[i] = lo(i) <= hi(i) ? Math.min(hi(i), Math.max(lo(i), side)) : side;
      }
    }
  }
  return result[0] === prev[0] && result[1] === prev[1] && result[2] === prev[2] ? prev : result;
}

export interface ObjectInit {
  name?: string;
  size?: Vec3;
  color?: string;
  rotationY?: number;
  assetId?: string | null;
  params?: Params;
}

/**
 * id = newId('obj'), origin 'user', name = init.name ?? item.title, остальное — из item; locked false, visible true.
 * Сверх спецификации (I4 и «объект переживает сохранение»): сторона init.size, которая не число или ≤ 0, берётся из
 * item.size, остальные зажимаются в [MIN_SIZE, MAX_SIZE]; цвет не вида '#rrggbb' → item.color; assetId не вида
 * a_<32 hex> → null; угол не число → 0; негодные params → {}.
 */
export function createObject(item: CatalogItem, mount: Mount, init?: ObjectInit): SceneObject {
  const size = init?.size ?? item.size;
  return {
    id: newId('obj'),
    kind: item.kind,
    type: item.id,
    origin: 'user',
    name: (init?.name ?? item.title).slice(0, NAME_LIMIT),
    mount,
    rotationY: safeAngle(init?.rotationY ?? 0, 0),
    size: [safeSide(size[0], item.size[0]), safeSide(size[1], item.size[1]), safeSide(size[2], item.size[2])],
    color: isColor(init?.color) ? init.color : item.color,
    assetId: isAssetId(init?.assetId) ? init.assetId : null,
    locked: false,
    visible: true,
    params: isParams(init?.params) ? { ...init.params } : {},
  };
}

/**
 * «Дети на пол» — общий шаг всех построителей ниже: каждый объект, стоящий на хозяине, получает
 * patch { mount: { kind: 'floor', x, z, lift: 0 }, rotationY: мировой угол } в тех же мировых X/Z
 * (по resolvePose ДО изменения хозяина). В итоговом batch эти патчи идут ПЕРЕД изменением самого хозяина.
 * skip — дети, которых опускать не нужно (они сами удаляются той же командой).
 */
function childrenToFloor(ctx: SceneContext, hostId: string, skip?: ReadonlySet<string>): PatchEntry[] {
  return childrenOf(ctx.objects, hostId)
    .filter((child) => !skip?.has(child.id))
    .map((child) => {
      const pose = resolvePose(child, ctx);
      const mount = clampMount({ kind: 'floor', x: pose.position[0], z: pose.position[2], lift: 0 }, child.size, ctx);
      return { id: child.id, set: { mount, rotationY: safeAngle(pose.rotationY, 0) } };
    });
}

/**
 * ЕДИНСТВЕННЫЙ построитель патча одного объекта: через него идут patchObject (панели) и commitDraft (перетаскивание,
 * ручки). Возвращает команду, сохраняющую I2, I4, I5; пустой batch, если объекта нет или патч ничего не меняет.
 *   1. Заблокированный объект принимает только ключи locked и visible; остальные отбрасываются.
 *   2. set.size        → clampSize(catalog.getItem(o.type), o.size, set.size).
 *   3. set.mount 'surface' допустим, только если хозяин существует, отличен от объекта, сам стоит на полу и виден;
 *      иначе ключи mount и rotationY из патча отбрасываются (объект остаётся, где был).
 *   4. set.mount 'wall' с неизвестным surfaceId → ключ mount отбрасывается.
 *   5. Если в патче есть mount или size — итоговое крепление (новое или текущее) проходит clampMount с итоговым size
 *      и включается в патч.
 *   6. Если у объекта есть дети и патч (а) делает его невидимым (visible: false) либо (б) переводит на крепление,
 *      отличное от 'floor', — сначала «дети на пол».
 * Результат: один patch либо batch[patch детей…, patch объекта].
 * Сверх спецификации: имя обрезается до 120 символов, не-число в rotationY отбрасывается, угол за пределом
 * LAYOUT_LIMITS.coord приводится по модулю 2π (иначе parseLayout отбросил бы объект при следующей загрузке), а если
 * у хозяина меняется размер и дети остаются на нём, их (u, v) заново зажимаются в новую столешницу (иначе это сделал
 * бы sanitizeLayout при следующей загрузке). По той же причине отбрасываются ключи, с которыми parseLayout выкинул бы
 * объект целиком: color не вида '#rrggbb', assetId не null и не вида a_<32 hex>, params не запись или больше
 * LAYOUT_LIMITS.paramKeys ключей.
 */
export function cmdPatch(layout: Layout, id: string, set: ObjectPatch, room: RoomDef, catalog: CatalogLookup): Command {
  const ctx = makeContext(room, layout.objects);
  const o = ctx.get(id);
  if (!o) return EMPTY;

  // Читаем только ключи ObjectPatch; undefined считается отсутствием ключа.
  const next: ObjectPatch = {};
  const source = set as Record<string, unknown>;
  const target = next as Record<string, unknown>;
  for (const key of PATCH_KEYS) {
    if (o.locked && key !== 'locked' && key !== 'visible') continue; // шаг 1
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) target[key] = source[key];
  }

  if (next.name !== undefined) next.name = next.name.slice(0, NAME_LIMIT);
  if (next.color !== undefined && !isColor(next.color)) delete next.color;
  if (next.assetId !== undefined && next.assetId !== null && !isAssetId(next.assetId)) delete next.assetId;
  if (next.params !== undefined && !isParams(next.params)) delete next.params;
  if (next.rotationY !== undefined) {
    if (Number.isFinite(next.rotationY)) next.rotationY = safeAngle(next.rotationY, o.rotationY);
    else delete next.rotationY;
  }
  if (next.size) next.size = clampSize(catalog.getItem(o.type), o.size, next.size); // шаг 2

  if (next.mount?.kind === 'surface') {
    // шаг 3
    const host = ctx.get(next.mount.hostId);
    if (!host || host.id === o.id || host.mount.kind !== 'floor' || !host.visible) {
      delete next.mount;
      delete next.rotationY;
    }
  } else if (next.mount?.kind === 'wall' && !ctx.surface(next.mount.surfaceId)) {
    delete next.mount; // шаг 4
  }

  if (next.mount || next.size) next.mount = clampMount(next.mount ?? o.mount, next.size ?? o.size, ctx); // шаг 5

  // В команде остаётся только то, что действительно меняется.
  for (const key of PATCH_KEYS) if (key in next && deepEqual(next[key], o[key])) delete next[key];
  if (Object.keys(next).length === 0) return EMPTY;

  let childPatches: PatchEntry[] = [];
  const children = childrenOf(layout.objects, id);
  if (children.length > 0) {
    if (next.visible === false || (next.mount && next.mount.kind !== 'floor')) {
      childPatches = childrenToFloor(ctx, id); // шаг 6
    } else if (next.size) {
      const after = makeContext(
        room,
        layout.objects.map((x) => (x.id === id ? applyPatch(o, next) : x)),
      );
      for (const child of children) {
        const mount = clampMount(child.mount, child.size, after);
        if (mount !== child.mount) childPatches.push({ id: child.id, set: { mount } });
      }
    }
  }

  const own: Command = { type: 'patch', patches: [{ id, set: next }] };
  return childPatches.length > 0 ? { type: 'batch', commands: [{ type: 'patch', patches: childPatches }, own] } : own;
}

/**
 * «Удалить». Заблокированные пропускаются. В обоих случаях сначала «дети на пол».
 * origin 'venue' → patch { visible: false } (мебель площадки не удаляется, а скрывается); origin 'user' → remove.
 */
export function cmdRemove(layout: Layout, ids: readonly string[], room: RoomDef): Command {
  const ctx = makeContext(room, layout.objects);
  const targets: SceneObject[] = [];
  for (const id of new Set(ids)) {
    const o = ctx.get(id);
    if (o && !o.locked) targets.push(o);
  }
  // Детей, которые сами исчезают этой же командой, опускать на пол незачем.
  const removed = new Set(targets.filter((o) => o.origin === 'user').map((o) => o.id));

  const patches: PatchEntry[] = [];
  for (const o of targets) {
    if (o.origin === 'venue' && !o.visible) continue; // уже скрыта
    patches.push(...childrenToFloor(ctx, o.id, removed));
    if (o.origin === 'venue') patches.push({ id: o.id, set: { visible: false } });
  }
  return pack([
    { type: 'patch', patches },
    { type: 'remove', ids: [...removed] },
  ]);
}

function shiftMount(m: Mount, by: number): Mount {
  switch (m.kind) {
    case 'floor':
      return { ...m, x: m.x + by };
    case 'ceiling':
      return { ...m, x: m.x + by };
    case 'wall':
      return { ...m, along: m.along + by };
    case 'surface':
      return { ...m, u: m.u + by };
  }
}

/**
 * «Дублировать». Копия: новый id, origin 'user', locked false, name + ' (копия)', сдвиг 0.3 м (x | along | u) + clampMount;
 * вставляется сразу после оригинала. Объекты, стоящие на оригинале, не копируются.
 */
export function cmdDuplicate(layout: Layout, ids: readonly string[], room: RoomDef): { command: Command; newIds: string[] } {
  const ctx = makeContext(room, layout.objects);
  const newIds: string[] = [];
  const copies: { object: SceneObject; origin: number }[] = [];
  for (const id of new Set(ids)) {
    const origin = layout.objects.findIndex((o) => o.id === id);
    if (origin < 0) continue;
    const o = layout.objects[origin];
    const copy: SceneObject = {
      ...structuredClone(o),
      id: newId('obj'),
      origin: 'user',
      locked: false,
      name: (o.name.slice(0, NAME_LIMIT - COPY_SUFFIX.length) + COPY_SUFFIX),
      mount: clampMount(shiftMount(o.mount, COPY_SHIFT), o.size, ctx),
    };
    newIds.push(copy.id);
    copies.push({ object: copy, origin });
  }
  // index — позиция на момент вставки: каждая предыдущая вставка сдвигает следующие на единицу.
  const items = copies
    .slice()
    .sort((a, b) => a.origin - b.origin)
    .map((c, k) => ({ object: c.object, index: c.origin + 1 + k }));
  return { command: items.length > 0 ? { type: 'add', items } : EMPTY, newIds };
}

/**
 * Смена типа крепления через remount(). drop/bottom по умолчанию — catalog.getItem(o.type).defaultDrop / defaultBottom.
 * → surface: хозяин — опора (catalog.isSupport, не сам объект), чья столешница содержит мировые X/Z объекта, иначе
 *   ближайшая по центру; опор нет → пустой batch.
 * Если у объекта есть дети и to !== 'floor' — сначала «дети на пол» (I2). Мировой угол сохраняется.
 * Заблокированный объект не перевешивается (пустой batch) — то же правило, что в cmdPatch.
 */
export function cmdSetMount(layout: Layout, id: string, to: MountKind, room: RoomDef, catalog: CatalogLookup): Command {
  const ctx = makeContext(room, layout.objects);
  const o = ctx.get(id);
  if (!o || o.mount.kind === to) return EMPTY;
  const item = catalog.getItem(o.type);
  const pose = resolvePose(o, ctx);

  let hostId: string | undefined;
  let rotationY = pose.rotationY;
  if (to === 'surface') {
    let best: { host: SceneObject; inside: boolean; distance: number } | undefined;
    for (const host of layout.objects) {
      if (host.id === id || !catalog.isSupport(host)) continue;
      const hostPose = resolvePose(host, ctx);
      const local = toLocal(hostPose, pose.position);
      const inside = Math.abs(local[0]) <= host.size[0] / 2 && Math.abs(local[2]) <= host.size[2] / 2;
      const distance = Math.hypot(local[0], local[2]);
      if (!best || (inside && !best.inside) || (inside === best.inside && distance < best.distance)) {
        best = { host, inside, distance };
      }
    }
    if (!best) return EMPTY;
    hostId = best.host.id;
    rotationY = pose.rotationY - resolvePose(best.host, ctx).rotationY;
  } else if (to === 'wall') {
    rotationY = 0; // у настенного объекта угол задаёт стена
  }

  const mount = remount(o, to, ctx, { hostId, drop: item.defaultDrop, bottom: item.defaultBottom });
  if (mount.kind !== to) return EMPTY; // перевесить не на что (нет стен)
  return cmdPatch(layout, id, { mount, rotationY }, room, catalog);
}

/** Патч, возвращающий объект к исходному состоянию fixture (только отличающиеся поля). */
function restorePatch(o: SceneObject, fixture: SceneObject): ObjectPatch {
  const set: ObjectPatch = {};
  const target = set as Record<string, unknown>;
  for (const key of PATCH_KEYS) {
    if (!deepEqual(o[key], fixture[key])) target[key] = structuredClone(fixture[key]);
  }
  return set;
}

/** Устаревшая мебель площадки (origin 'venue', которой нет в room.fixtures): дети — на пол, затем удаление. */
function removeStaleVenue(layout: Layout, room: RoomDef, ctx: SceneContext): Command[] {
  const fixtureIds = new Set(room.fixtures.map((f) => f.id));
  const stale = layout.objects.filter((o) => o.origin === 'venue' && !fixtureIds.has(o.id));
  if (stale.length === 0) return [];
  const staleIds = new Set(stale.map((o) => o.id));
  const patches = stale.flatMap((o) => childrenToFloor(ctx, o.id, staleIds));
  return [
    { type: 'patch', patches },
    { type: 'remove', ids: [...staleIds] },
  ];
}

/**
 * «Сбросить мебель» — один шаг undo. Для каждой fixture: объект есть → patch всех изменяемых полей, отличающихся от исходных
 * (включая visible: true, locked: false); объекта нет → add копии. Объекты origin 'venue', которых нет в room.fixtures,
 * удаляются («дети на пол»). Пользовательский декор не трогается: стоящее на столах остаётся на них и едет вместе со столом.
 */
export function cmdResetVenue(layout: Layout, room: RoomDef): Command {
  const stale = removeStaleVenue(layout, room, makeContext(room, layout.objects));

  // Каждый следующий шаг строится по состоянию ПОСЛЕ предыдущих — в том же порядке, в каком batch применяется.
  // Иначе «дети на пол» (он записывает ребёнку мировой угол) затёр бы поле, которое до него совпадало с исходным
  // и потому не попало бы в восстановление: мебель после сброса отличалась бы от исходной.
  const afterStale = applyCommand(layout, pack(stale));
  const staleCtx = makeContext(room, afterStale.objects);
  const drops: PatchEntry[] = [];
  for (const fixture of room.fixtures) {
    const o = staleCtx.get(fixture.id);
    if (!o) continue;
    const set = restorePatch(o, fixture);
    // Страховка I2/I5: если исходное состояние предмета — «не на полу» или «скрыт», на нём ничего не остаётся.
    if (set.visible === false || (set.mount && set.mount.kind !== 'floor')) drops.push(...childrenToFloor(staleCtx, o.id));
  }

  const afterDrops = applyCommand(afterStale, pack([{ type: 'patch', patches: drops }]));
  const dropsCtx = makeContext(room, afterDrops.objects);
  const restores: PatchEntry[] = [];
  const missing: { object: SceneObject }[] = [];
  for (const fixture of room.fixtures) {
    const o = dropsCtx.get(fixture.id);
    if (!o) {
      missing.push({ object: structuredClone(fixture) });
      continue;
    }
    const set = restorePatch(o, fixture);
    if (Object.keys(set).length > 0) restores.push({ id: o.id, set });
  }
  const commands: Command[] = [
    ...stale,
    { type: 'patch', patches: drops },
    { type: 'patch', patches: restores },
    { type: 'add', items: missing },
  ];

  // Столешница после сброса могла стать меньше: предметы на ней остаются на ней, но в её пределах.
  const base = pack(commands);
  const after = applyCommand(layout, base);
  if (after !== layout) {
    const afterCtx = makeContext(room, after.objects);
    const reclamp: PatchEntry[] = [];
    for (const child of after.objects) {
      if (child.mount.kind !== 'surface') continue;
      const mount = clampMount(child.mount, child.size, afterCtx);
      if (mount !== child.mount) reclamp.push({ id: child.id, set: { mount } });
    }
    if (reclamp.length > 0) return pack([base, { type: 'patch', patches: reclamp }]);
  }
  return base;
}

/** Отличается ли мебель от исходной (включает кнопку «Сбросить мебель»). */
export function venueDirty(layout: Layout, room: RoomDef): boolean {
  return !isNoop(layout, cmdResetVenue(layout, room));
}

/**
 * При загрузке, вне истории: добавляет fixtures, которых нет в макете; удаляет устаревшие объекты origin 'venue',
 * ПЕРЕД удалением переводя их детей на пол в мировых X/Z («дети на пол» — иначе sanitizeLayout смог бы поставить
 * осиротевшие предметы только в (0, 0)).
 */
export function reconcileVenue(layout: Layout, room: RoomDef): Layout {
  const ctx = makeContext(room, layout.objects);
  const have = new Set(layout.objects.map((o) => o.id));
  const missing = room.fixtures.filter((f) => !have.has(f.id)).map((f) => ({ object: structuredClone(f) }));
  return applyCommand(layout, pack([...removeStaleVenue(layout, room, ctx), { type: 'add', items: missing }]));
}

function clampSide(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, value));
}

/**
 * При загрузке/импорте, вне истории: восстанавливает I1–I5 — дубликаты id отбрасываются; size зажимается в
 * [MIN_SIZE, MAX_SIZE]; битые wall-крепления и surface-крепления с пропавшим хозяином переводятся на пол в (0, 0);
 * surface-крепление, чей хозяин существует, но стоит не на полу или скрыт, — на пол в мировых X/Z точки
 * toWorld(resolvePose(хозяин), [u, 0, v]); каждое крепление проходит clampMount. Идемпотентна; без изменений
 * возвращает тот же layout.
 */
export function sanitizeLayout(layout: Layout, room: RoomDef): Layout {
  // Проход 1: уникальные id, размеры и угол — то, что не зависит от других объектов.
  const seen = new Set<string>();
  let changed = false;
  let objects: SceneObject[] = [];
  for (const o of layout.objects) {
    if (seen.has(o.id)) {
      changed = true;
      continue;
    }
    seen.add(o.id);
    const size: Vec3 = [clampSide(o.size[0]), clampSide(o.size[1]), clampSide(o.size[2])];
    const sizeOk = size[0] === o.size[0] && size[1] === o.size[1] && size[2] === o.size[2];
    const rotationY = safeAngle(o.rotationY, 0);
    if (sizeOk && rotationY === o.rotationY) {
      objects.push(o);
    } else {
      changed = true;
      objects.push({ ...o, size: sizeOk ? o.size : size, rotationY });
    }
  }

  // Проход 2: крепления, не зависящие от других объектов (пол, потолок, стена).
  let ctx = makeContext(room, objects);
  objects = objects.map((o) => {
    if (o.mount.kind === 'surface') return o;
    const broken = o.mount.kind === 'wall' && !ctx.surface(o.mount.surfaceId);
    const mount = clampMount(broken ? { kind: 'floor', x: 0, z: 0, lift: 0 } : o.mount, o.size, ctx);
    if (mount === o.mount) return o;
    changed = true;
    return { ...o, mount };
  });

  // Проход 3: предметы на опорах — хозяева уже приведены в порядок.
  ctx = makeContext(room, objects);
  objects = objects.map((o) => {
    if (o.mount.kind !== 'surface') return o;
    const host = ctx.get(o.mount.hostId);
    let mount: Mount;
    let rotationY = o.rotationY;
    if (!host || host.id === o.id) {
      mount = { kind: 'floor', x: 0, z: 0, lift: 0 };
    } else if (host.mount.kind !== 'floor' || !host.visible) {
      const hostPose = resolvePose(host, ctx);
      const u = Number.isFinite(o.mount.u) ? o.mount.u : 0;
      const v = Number.isFinite(o.mount.v) ? o.mount.v : 0;
      const p = toWorld(hostPose, [u, 0, v]);
      mount = { kind: 'floor', x: p[0], z: p[2], lift: 0 };
      rotationY = safeAngle(hostPose.rotationY + o.rotationY, 0);
    } else {
      mount = o.mount;
    }
    mount = clampMount(mount, o.size, ctx);
    if (mount === o.mount) return o;
    changed = true;
    return { ...o, mount, rotationY };
  });

  return changed ? { ...layout, objects } : layout;
}
