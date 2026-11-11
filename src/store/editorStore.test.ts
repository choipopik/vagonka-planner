import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogLookup, getItem } from '../catalog';
import { deepEqual } from '../model/commands';
import type { Command } from '../model/commands';
import { MERGE_WINDOW_MS } from '../model/history';
import { createLayout } from '../model/layout';
import { MAX_LIGHTS } from '../model/lights';
import { parseLayout } from '../model/migrate';
import { MAX_SIZE, MIN_SIZE, createObject, sanitizeLayout } from '../model/ops';
import { GRID_STEP, makeContext, resolvePose } from '../model/pose';
import type { Mount, SceneObject } from '../model/types';
import { getRoom, rooms } from '../rooms';
import {
  addObject,
  deleteObject,
  duplicateObject,
  patchObject,
  resetFurniture,
  setObjectMount,
} from './actions';
import { setViewportBridge, viewportBridge } from './bridge';
import { subscribeCommands, useEditor } from './editorStore';
import type { CommandMeta } from './editorStore';
import {
  canEdit,
  getBackSurfaces,
  getContext,
  getLayerView,
  getObject,
  getObjects,
} from './selectors';

// Стор работает с реестром помещений, поэтому тесты идут на его первом помещении; все координаты берутся
// из данных самого помещения и макета, без числовых литералов.
const room = rooms[0];

const state = () => useEditor.getState();
const objects = () => state().layout.objects;
const find = (id: string): SceneObject => {
  const o = objects().find((x) => x.id === id);
  if (!o) throw new Error(`нет объекта ${id}`);
  return o;
};
const worldOf = (id: string) => resolvePose(find(id), makeContext(room, objects())).position;

/** Кладёт в макет новый объект типа type на данном креплении (одной командой add) и возвращает его. */
function put(type: string, mount: Mount, name?: string): SceneObject {
  const object = createObject(getItem(type), mount, name === undefined ? undefined : { name });
  state().dispatch({ type: 'add', items: [{ object }] }, { label: 'Добавить' });
  return object;
}

/** Первый стол площадки, стоящий на полу. */
function venueTable(): SceneObject {
  const table = objects().find((o) => o.type === 'table' && o.origin === 'venue' && o.mount.kind === 'floor');
  if (!table) throw new Error('в помещении нет стола');
  return table;
}

function floorMountOf(o: SceneObject): Extract<Mount, { kind: 'floor' }> {
  if (o.mount.kind !== 'floor') throw new Error('объект не на полу');
  return o.mount;
}

/** Записывает всё, что видят подписчики команд. */
function record(): { seen: { cmd: Command; meta: CommandMeta }[]; stop: () => void } {
  const seen: { cmd: Command; meta: CommandMeta }[] = [];
  const stop = subscribeCommands((cmd, meta) => seen.push({ cmd, meta }));
  return { seen, stop };
}

beforeEach(() => {
  const s = state();
  s.setCameraMode('orbit');
  s.openLayout(createLayout(room));
  s.setLayer('auto');
  s.setGridSnap(true);
  s.setAmbience('work');
  s.setViewFromAbove(true);
  s.setBackSurfaces([]);
  s.dismissNotice();
  setViewportBridge(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('начальное состояние', () => {
  it('соответствует спецификации', () => {
    const s = state();
    expect(s.roomId).toBe(room.id);
    expect(s.layout.roomId).toBe(room.id);
    expect(s.layout.objects.map((o) => o.id)).toEqual(room.fixtures.map((f) => f.id));
    expect(s.history).toEqual({ past: [], future: [] });
    expect(s.draft).toBeNull();
    expect(s.selectedId).toBeNull();
    expect(s.hoveredId).toBeNull();
    expect(s.capturing).toBe(false);
    expect(s.cameraMode).toBe('orbit');
    expect(s.layer).toBe('auto');
    expect(s.gridSnap).toBe(true);
    expect(s.showLabels).toBe(true);
    expect(s.ambience).toBe('work');
    expect(s.viewFromAbove).toBe(true);
    expect(s.backSurfaceIds).toEqual([]);
    expect(s.saveStatus).toBe('saved');
    expect(s.storage).toBe('local');
    expect(s.notice).toBeNull();
    expect(s.assets).toEqual([]);
  });
});

describe('dispatch, история, undo и redo', () => {
  it('dispatch → история → undo → redo', () => {
    const before = state().layout;
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });

    expect(objects().some((o) => o.id === box.id)).toBe(true);
    expect(state().history.past).toHaveLength(1);
    expect(state().history.past[0].label).toBe('Добавить');
    expect(state().history.future).toHaveLength(0);
    expect(state().saveStatus).toBe('dirty');
    const afterAdd = state().layout;

    state().undo();
    expect(deepEqual(objects(), before.objects)).toBe(true);
    expect(state().history.past).toHaveLength(0);
    expect(state().history.future).toHaveLength(1);

    state().redo();
    expect(deepEqual(objects(), afterAdd.objects)).toBe(true);
    expect(state().history.past).toHaveLength(1);
    expect(state().history.future).toHaveLength(0);
  });

  it('undo и redo без истории ничего не делают', () => {
    const before = state();
    state().undo();
    state().redo();
    expect(state()).toBe(before);
  });

  it('пустая команда не меняет состояние и не будит слушателей', () => {
    const { seen, stop } = record();
    const before = state();
    state().dispatch({ type: 'batch', commands: [] });
    state().dispatch({ type: 'remove', ids: ['no-such-object'] });
    state().dispatch({ type: 'rename', name: before.layout.name });
    expect(state()).toBe(before);
    expect(seen).toHaveLength(0);
    stop();
  });

  it('dispatch обновляет updatedAt, а roomId остаётся равным layout.roomId', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    state().dispatch({ type: 'rename', name: 'Свадьба' });
    expect(state().layout.name).toBe('Свадьба');
    expect(state().layout.updatedAt).toBe(1_700_000_000_000);
    expect(state().roomId).toBe(state().layout.roomId);
  });

  it('новая команда после undo очищает future', () => {
    put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().undo();
    expect(state().history.future).toHaveLength(1);
    put('sphere', { kind: 'floor', x: 0, z: 0, lift: 0 });
    expect(state().history.future).toHaveLength(0);
    expect(state().history.past).toHaveLength(1);
  });

  it('record: false применяет команду, не записывая её в историю', () => {
    state().dispatch({ type: 'rename', name: 'Без истории' }, { record: false });
    expect(state().layout.name).toBe('Без истории');
    expect(state().history.past).toHaveLength(0);
    expect(state().saveStatus).toBe('dirty');
  });

  it('команды с одним mergeKey в пределах окна склеиваются в один шаг', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const initialColor = find(box.id).color;

    patchObject(box.id, { color: '#112233' }, 'Цвет', `color:${box.id}`);
    vi.setSystemTime(1_700_000_000_000 + MERGE_WINDOW_MS / 2);
    patchObject(box.id, { color: '#445566' }, 'Цвет', `color:${box.id}`);
    expect(state().history.past).toHaveLength(2);

    vi.setSystemTime(1_700_000_000_000 + MERGE_WINDOW_MS * 3);
    patchObject(box.id, { color: '#778899' }, 'Цвет', `color:${box.id}`);
    expect(state().history.past).toHaveLength(3);

    state().undo();
    expect(find(box.id).color).toBe('#445566');
    state().undo();
    expect(find(box.id).color).toBe(initialColor);
    state().redo();
    expect(find(box.id).color).toBe('#445566');
  });

  it('undo и redo ничего не делают в прогулке и пока есть draft', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });

    state().setDraft({ [box.id]: { color: '#010203' } });
    state().undo();
    expect(objects().some((o) => o.id === box.id)).toBe(true);
    expect(state().history.past).toHaveLength(1);
    state().setDraft(null);

    state().setCameraMode('walk');
    state().undo();
    expect(objects().some((o) => o.id === box.id)).toBe(true);

    state().setCameraMode('orbit');
    state().undo();
    expect(objects().some((o) => o.id === box.id)).toBe(false);

    state().setCameraMode('walk');
    state().redo();
    expect(objects().some((o) => o.id === box.id)).toBe(false);
    state().setCameraMode('top');
    state().redo();
    expect(objects().some((o) => o.id === box.id)).toBe(true);
  });

  it('команда, удалившая выбранный и наведённый объект, сбрасывает выбор', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const other = put('sphere', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().select(box.id);
    state().setHovered(other.id);
    state().dispatch({ type: 'remove', ids: [box.id] });
    expect(state().selectedId).toBeNull();
    expect(state().hoveredId).toBe(other.id);
    state().dispatch({ type: 'remove', ids: [other.id] });
    expect(state().hoveredId).toBeNull();
  });

  it('local-команда сбрасывает draft', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().setDraft({ [box.id]: { color: '#010203' } });
    state().dispatch({ type: 'rename', name: 'Другое имя' });
    expect(state().draft).toBeNull();
  });
});

describe('subscribeCommands', () => {
  it('видит local-команду, а undo и redo — как history', () => {
    const { seen, stop } = record();
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().undo();
    state().redo();
    stop();

    expect(seen.map((e) => e.meta.origin)).toEqual(['local', 'history', 'history']);
    expect(seen[0].cmd).toEqual({ type: 'add', items: [{ object: box }] });
    expect(seen[1].cmd).toEqual({ type: 'remove', ids: [box.id] });
    expect(seen[2].cmd).toEqual(seen[0].cmd);
    for (const e of seen) expect(e.meta.layoutId).toBe(state().layout.id);
    expect(seen[1].meta.seq).toBeGreaterThan(seen[0].meta.seq);
    expect(seen[2].meta.seq).toBeGreaterThan(seen[1].meta.seq);
  });

  it('отписка прекращает оповещения, а одна и та же функция может быть подписана дважды', () => {
    let calls = 0;
    const listener = () => {
      calls++;
    };
    const stopA = subscribeCommands(listener);
    const stopB = subscribeCommands(listener);
    state().dispatch({ type: 'rename', name: 'А' });
    expect(calls).toBe(2);
    stopA();
    state().dispatch({ type: 'rename', name: 'Б' });
    expect(calls).toBe(3);
    stopB();
    stopB();
    state().dispatch({ type: 'rename', name: 'В' });
    expect(calls).toBe(3);
  });

  it('ошибка одного слушателя не ломает команду и не мешает остальным', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stopBad = subscribeCommands(() => {
      throw new Error('сломан');
    });
    const { seen, stop } = record();
    state().dispatch({ type: 'rename', name: 'Имя' });
    expect(state().layout.name).toBe('Имя');
    expect(seen).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    stopBad();
    stop();
    spy.mockRestore();
  });
});

describe('remote-команды', () => {
  it('применяются, не попадают в историю и видны слушателям как remote', () => {
    const { seen, stop } = record();
    const object = createObject(getItem('box'), { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().dispatch({ type: 'add', items: [{ object }] }, { origin: 'remote' });
    stop();

    expect(objects().some((o) => o.id === object.id)).toBe(true);
    expect(state().history.past).toHaveLength(0);
    expect(state().saveStatus).toBe('dirty');
    expect(seen.map((e) => e.meta.origin)).toEqual(['remote']);

    // record: true не превращает чужую правку в шаг локальной истории.
    state().dispatch({ type: 'rename', name: 'Чужое имя' }, { origin: 'remote', record: true });
    expect(state().history.past).toHaveLength(0);
  });

  it('не сбрасывают draft чужого объекта, а удаление объекта убирает из draft только его', () => {
    const a = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const b = put('sphere', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const c = put('cone', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const draft = { [a.id]: { color: '#010203' }, [b.id]: { color: '#040506' } };
    state().setDraft(draft);
    state().select(b.id);

    // Чужая правка третьего объекта: draft не тронут вовсе (та же ссылка).
    state().dispatch({ type: 'patch', patches: [{ id: c.id, set: { color: '#0a0b0c' } }] }, { origin: 'remote' });
    expect(state().draft).toBe(draft);

    // Чужая правка самого перетаскиваемого объекта тоже не обрывает перетаскивание.
    state().dispatch({ type: 'patch', patches: [{ id: a.id, set: { name: 'Чужое имя' } }] }, { origin: 'remote' });
    expect(state().draft).toBe(draft);

    // Чужое удаление: из draft уходит только удалённый объект, выбор сбрасывается.
    state().dispatch({ type: 'remove', ids: [b.id] }, { origin: 'remote' });
    expect(state().draft).toEqual({ [a.id]: { color: '#010203' } });
    expect(state().selectedId).toBeNull();

    // Удалён последний объект draft → null.
    state().dispatch({ type: 'remove', ids: [a.id] }, { origin: 'remote' });
    expect(state().draft).toBeNull();
  });
});

describe('draft и commitDraft', () => {
  it('getObjects(), getObject() и getContext() слиты с draft, а макет и история не тронуты', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const layoutBefore = state().layout;
    const historyBefore = state().history;
    expect(getObjects()).toBe(layoutBefore.objects);

    const mount: Mount = { ...floorMountOf(find(box.id)), x: floorMountOf(find(box.id)).x + GRID_STEP };
    state().setDraft({ [box.id]: { mount } });

    expect(state().layout).toBe(layoutBefore);
    expect(state().history).toBe(historyBefore);
    expect(getObject(box.id)?.mount).toEqual(mount);
    expect(getObjects().find((o) => o.id === box.id)?.mount).toEqual(mount);
    expect(getObjects().map((o) => o.id)).toEqual(layoutBefore.objects.map((o) => o.id));
    expect(getContext().get(box.id)?.mount).toEqual(mount);
    expect(getContext().room).toBe(room);
    // Остальные объекты сохраняют ссылки; повторные вызовы возвращают те же массив и контекст.
    const untouched = layoutBefore.objects[0];
    expect(getObject(untouched.id)).toBe(untouched);
    expect(getObjects()).toBe(getObjects());
    expect(getContext()).toBe(getContext());
    expect(getObject(box.id)).toBe(getObject(box.id));

    state().setDraft(null);
    expect(getObjects()).toBe(layoutBefore.objects);
    expect(getObject(box.id)).toBe(find(box.id));
  });

  it('commitDraft даёт ровно одну команду и один шаг истории', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const from = floorMountOf(find(box.id));
    const { seen, stop } = record();
    const pastBefore = state().history.past.length;

    state().setDraft({ [box.id]: { mount: { ...from, x: from.x + GRID_STEP } } });
    state().setDraft({ [box.id]: { mount: { ...from, x: from.x + 2 * GRID_STEP } } });
    state().setDraft({ [box.id]: { mount: { ...from, x: from.x + 3 * GRID_STEP } } });
    expect(seen).toHaveLength(0);
    state().commitDraft('Перемещение');
    stop();

    expect(seen).toHaveLength(1);
    expect(seen[0].meta.origin).toBe('local');
    expect(state().history.past).toHaveLength(pastBefore + 1);
    expect(state().history.past[pastBefore].label).toBe('Перемещение');
    expect(state().draft).toBeNull();
    expect(floorMountOf(find(box.id)).x).toBeCloseTo(from.x + 3 * GRID_STEP, 9);

    state().undo();
    expect(find(box.id).mount).toEqual(from);
  });

  it('draft с несколькими объектами — одна команда batch и один шаг undo', () => {
    const a = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const b = put('sphere', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const colors = [find(a.id).color, find(b.id).color];
    const { seen, stop } = record();
    const pastBefore = state().history.past.length;

    state().setDraft({ [a.id]: { color: '#010203' }, [b.id]: { color: '#040506' } });
    state().commitDraft('Цвет');
    stop();

    expect(seen).toHaveLength(1);
    expect(seen[0].cmd.type).toBe('batch');
    expect(state().history.past).toHaveLength(pastBefore + 1);
    expect([find(a.id).color, find(b.id).color]).toEqual(['#010203', '#040506']);
    state().undo();
    expect([find(a.id).color, find(b.id).color]).toEqual(colors);
  });

  it('пустой draft, draft без изменений и draft неизвестного объекта только сбрасывают draft', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const { seen, stop } = record();
    const layoutBefore = state().layout;
    const historyBefore = state().history;

    state().commitDraft('Ничего');
    state().setDraft({});
    state().commitDraft('Ничего');
    expect(state().draft).toBeNull();
    state().setDraft({ [box.id]: { mount: find(box.id).mount, color: find(box.id).color } });
    state().commitDraft('Ничего');
    expect(state().draft).toBeNull();
    state().setDraft({ 'no-such-object': { color: '#010203' } });
    state().commitDraft('Ничего');
    stop();

    expect(state().draft).toBeNull();
    expect(state().layout).toBe(layoutBefore);
    expect(state().history).toBe(historyBefore);
    expect(seen).toHaveLength(0);
  });

  it('draft, ставящий ящик с фонарём на стол, оставляет макет, который sanitizeLayout не меняет', () => {
    const table = venueTable();
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 }, 'Ящик');
    const lantern = put('sphere', { kind: 'surface', hostId: box.id, u: 0, v: 0 }, 'Фонарь');
    expect(find(lantern.id).mount.kind).toBe('surface');
    const lanternWorld = worldOf(lantern.id);
    const pastBefore = state().history.past.length;
    const { seen, stop } = record();

    state().setDraft({ [box.id]: { mount: { kind: 'surface', hostId: table.id, u: 0, v: 0 } } });
    state().commitDraft('Перемещение');
    stop();

    expect(seen).toHaveLength(1);
    expect(state().history.past).toHaveLength(pastBefore + 1);
    const layout = state().layout;
    expect(sanitizeLayout(layout, room)).toBe(layout);
    expect(find(box.id).mount).toMatchObject({ kind: 'surface', hostId: table.id });
    // Фонарь сначала опущен на пол в своих мировых X/Z.
    const dropped = find(lantern.id);
    expect(dropped.mount.kind).toBe('floor');
    expect(worldOf(lantern.id)[0]).toBeCloseTo(lanternWorld[0], 6);
    expect(worldOf(lantern.id)[2]).toBeCloseTo(lanternWorld[2], 6);

    // Один обратимый шаг.
    state().undo();
    expect(find(box.id).mount.kind).toBe('floor');
    expect(find(lantern.id).mount).toEqual(lantern.mount);
  });

  it('draft, задающий размер 0, оставляет макет, который sanitizeLayout не меняет', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().setDraft({ [box.id]: { size: [0, 0, 0] } });
    state().commitDraft('Размер');

    const layout = state().layout;
    expect(sanitizeLayout(layout, room)).toBe(layout);
    for (const side of find(box.id).size) {
      expect(side).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(side).toBeLessThanOrEqual(MAX_SIZE);
    }
    expect(state().draft).toBeNull();
  });
});

describe('выбор и вид', () => {
  it('вход в прогулку сбрасывает выбор, наведение и draft', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().select(box.id);
    state().setHovered(box.id);
    state().setDraft({ [box.id]: { color: '#010203' } });

    state().setCameraMode('top');
    expect(state().selectedId).toBe(box.id);
    expect(state().hoveredId).toBe(box.id);
    expect(state().draft).not.toBeNull();

    state().setCameraMode('walk');
    expect(state().cameraMode).toBe('walk');
    expect(state().selectedId).toBeNull();
    expect(state().hoveredId).toBeNull();
    expect(state().draft).toBeNull();
    expect(canEdit()).toBe(false);
  });

  it('setBackSurfaces с равным списком не меняет состояние', () => {
    const surfaceIds = [room.walls[0].id, room.walls[1].id];
    state().setBackSurfaces(surfaceIds);
    expect(getBackSurfaces()).toEqual(surfaceIds);

    let changes = 0;
    const unsubscribe = useEditor.subscribe(() => {
      changes++;
    });
    const before = state();
    state().setBackSurfaces([...surfaceIds]);
    expect(state()).toBe(before);
    expect(getBackSurfaces()).toBe(before.backSurfaceIds);
    expect(changes).toBe(0);

    state().setBackSurfaces([surfaceIds[1], surfaceIds[0]]);
    expect(changes).toBe(1);
    expect(getBackSurfaces()).toEqual([surfaceIds[1], surfaceIds[0]]);
    state().setBackSurfaces([]);
    expect(changes).toBe(2);
    unsubscribe();
  });

  it('сеттеры вида с прежним значением не будят подписчиков', () => {
    let changes = 0;
    const unsubscribe = useEditor.subscribe(() => {
      changes++;
    });
    const s = state();
    s.select(null);
    s.setHovered(null);
    s.setCameraMode(s.cameraMode);
    s.setLayer(s.layer);
    s.setViewFromAbove(s.viewFromAbove);
    s.setGridSnap(s.gridSnap);
    s.setAmbience(s.ambience);
    s.setCapturing(s.capturing);
    s.setSaveStatus(s.saveStatus);
    s.setStorageMode(s.storage);
    s.setDraft(null);
    s.dismissNotice();
    expect(changes).toBe(0);
    unsubscribe();
  });

  it('сеттеры вида меняют свои поля и не трогают макет и историю', () => {
    const layoutBefore = state().layout;
    const s = state();
    s.setLayer('ceiling');
    s.setViewFromAbove(false);
    s.setGridSnap(false);
    s.toggleLabels();
    s.setAmbience('party');
    s.setCapturing(true);
    s.setSaveStatus('error');
    s.setStorageMode('memory');
    const asset = { id: `a_${'0'.repeat(32)}`, kind: 'image' as const, name: 'a.png', mime: 'image/png' as const, bytes: 1, createdAt: 1 };
    s.setAssets([asset]);

    const next = state();
    expect(next.layer).toBe('ceiling');
    expect(next.viewFromAbove).toBe(false);
    expect(next.gridSnap).toBe(false);
    expect(next.showLabels).toBe(false);
    expect(next.ambience).toBe('party');
    expect(next.capturing).toBe(true);
    expect(next.saveStatus).toBe('error');
    expect(next.storage).toBe('memory');
    expect(next.assets).toEqual([asset]);
    expect(next.layout).toBe(layoutBefore);
    expect(next.history.past).toHaveLength(0);
    expect(getLayerView()).toBe('ceiling');

    s.toggleLabels();
    s.setCapturing(false);
    s.setStorageMode('local');
    s.setAssets([]);
    s.setSaveStatus('saved');
  });

  it('getLayerView следует за layer, режимом камеры и viewFromAbove', () => {
    state().setViewFromAbove(true);
    expect(getLayerView()).toBe('floor');
    state().setViewFromAbove(false);
    expect(getLayerView()).toBe('both');
    state().setLayer('ceiling');
    expect(getLayerView()).toBe('ceiling');
    state().setCameraMode('walk');
    expect(getLayerView()).toBe('both');
  });

  it('openLayout заменяет документ и сбрасывает историю, draft, выбор и статус сохранения', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().select(box.id);
    state().setHovered(box.id);
    state().setDraft({ [box.id]: { color: '#010203' } });
    const { seen, stop } = record();

    const fresh = createLayout(getRoom(room.id), 'Другой макет');
    state().openLayout(fresh);
    stop();

    expect(state().layout).toBe(fresh);
    expect(state().roomId).toBe(fresh.roomId);
    expect(state().history).toEqual({ past: [], future: [] });
    expect(state().draft).toBeNull();
    expect(state().selectedId).toBeNull();
    expect(state().hoveredId).toBeNull();
    expect(state().saveStatus).toBe('saved');
    expect(seen).toHaveLength(0);
  });
});

describe('тосты', () => {
  it('notify заменяет предыдущий тост, назначает id и убирает тост через 5 с', () => {
    vi.useFakeTimers();
    state().notify('info', 'Первый');
    const first = state().notice;
    expect(first).toMatchObject({ level: 'info', text: 'Первый' });

    vi.advanceTimersByTime(3000);
    state().notify('error', 'Второй');
    const second = state().notice;
    expect(second).toMatchObject({ level: 'error', text: 'Второй' });
    expect(second?.id).not.toBe(first?.id);

    // Таймер первого тоста не должен убрать второй.
    vi.advanceTimersByTime(3000);
    expect(state().notice).toBe(second);
    vi.advanceTimersByTime(2000);
    expect(state().notice).toBeNull();
  });

  it('dismissNotice убирает тост сразу', () => {
    vi.useFakeTimers();
    state().notify('warn', 'Внимание');
    state().dismissNotice();
    expect(state().notice).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(state().notice).toBeNull();
  });
});

describe('действия', () => {
  it('addObject создаёт объект, выбирает его и записывает один шаг истории', () => {
    const item = getItem('box');
    const { seen, stop } = record();
    const id = addObject(item);
    stop();

    expect(id).not.toBeNull();
    const o = find(id!);
    expect(o.type).toBe('box');
    expect(o.origin).toBe('user');
    expect(o.name).toBe(item.title);
    expect(o.size).toEqual(item.size);
    expect(o.mount.kind).toBe(item.mounts[0]);
    expect(state().selectedId).toBe(id);
    expect(seen).toHaveLength(1);
    expect(state().history.past).toHaveLength(1);
    expect(state().history.past[0].label).toBe(`Добавить: ${item.title}`);
    expect(sanitizeLayout(state().layout, room)).toBe(state().layout);

    state().undo();
    expect(objects().some((x) => x.id === id)).toBe(false);
    expect(state().selectedId).toBeNull();
  });

  it('addObject учитывает init и луч из ViewportBridge', () => {
    const table = venueTable();
    const top = worldOf(table.id);
    // Луч строго вниз над центром стола: настольный по умолчанию предмет встаёт на стол.
    setViewportBridge({
      centerRay: () => ({ origin: [top[0], room.size.height, top[2]], dir: [0, -1, 0] }),
      capturePng: () => Promise.resolve(null),
    });
    expect(viewportBridge()).not.toBeNull();

    const surfaceItem = [...getItem('sphere').mounts].includes('surface') ? getItem('sphere') : getItem('box');
    const id = addObject({ ...surfaceItem, mounts: ['surface', 'floor'] }, { name: 'Фонарь', color: '#102030' });
    const o = find(id!);
    expect(o.name).toBe('Фонарь');
    expect(o.color).toBe('#102030');
    expect(o.mount).toMatchObject({ kind: 'surface', hostId: table.id });

    setViewportBridge(null);
    expect(viewportBridge()).toBeNull();
  });

  it('addObject приводит init.size к допустимому: очень вытянутая картинка и мусор не нарушают I4 и переживают сохранение', () => {
    const image = getItem('image');
    // Картинка 8000 × 30 пикселей: [1, 1·h/w, 0.02] (вызов W3) — высота меньше MIN_SIZE.
    const thin = find(addObject(image, { size: [1, 30 / 8000, 0.02] })!);
    expect(thin.size).toEqual([1, MIN_SIZE, 0.02]);
    const huge = find(addObject(image, { size: [MAX_SIZE * 5, 1, 0.02] })!);
    expect(huge.size).toEqual([MAX_SIZE, 1, 0.02]);
    const junk = find(addObject(getItem('box'), { size: [Number.NaN, -1, Number.POSITIVE_INFINITY] })!);
    expect(junk.size).toEqual(getItem('box').size);

    expect(sanitizeLayout(state().layout, room)).toBe(state().layout);
    const dropped: string[] = [];
    const reloaded = parseLayout(JSON.parse(JSON.stringify(state().layout)), (_, reason) => dropped.push(reason));
    expect(dropped).toEqual([]);
    expect(reloaded.objects.map((o) => o.id)).toEqual(objects().map((o) => o.id));
  });

  it('patchObject с цветом не вида #rrggbb или чужим assetId ничего не меняет', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const before = state();
    patchObject(box.id, { color: '#fff' }, 'Цвет');
    patchObject(box.id, { color: 'red' }, 'Цвет');
    patchObject(box.id, { assetId: 'photo.png' }, 'Файл');
    expect(state()).toBe(before);
  });

  it('лампа сверх предела активных источников даёт предупреждение', () => {
    const lamp = getItem('light.point');
    for (let i = 0; i < MAX_LIGHTS; i++) addObject(lamp);
    expect(state().notice).toBeNull();
    const extra = addObject(lamp);
    expect(extra).not.toBeNull();
    expect(state().notice).toMatchObject({ level: 'warn', text: 'Активны только первые 12 источников света' });
    state().dismissNotice();
  });

  it('patchObject зажимает крепление и размер', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const far = Math.max(room.size.length, room.size.width) * 10;

    patchObject(box.id, { mount: { kind: 'floor', x: far, z: -far, lift: 0 } }, 'Перемещение');
    const mount = floorMountOf(find(box.id));
    expect(Math.abs(mount.x)).toBeLessThanOrEqual(room.size.length / 2);
    expect(Math.abs(mount.z)).toBeLessThanOrEqual(room.size.width / 2);

    patchObject(box.id, { size: [1000, -5, Number.NaN] }, 'Размер');
    for (const side of find(box.id).size) {
      expect(Number.isFinite(side)).toBe(true);
      expect(side).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(side).toBeLessThanOrEqual(MAX_SIZE);
    }
    expect(sanitizeLayout(state().layout, room)).toBe(state().layout);
    expect(state().history.past.map((e) => e.label)).toEqual(['Добавить', 'Перемещение', 'Размер']);
  });

  it('patchObject без изменений и для неизвестного объекта ничего не отправляет', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const before = state();
    patchObject(box.id, { color: find(box.id).color }, 'Цвет');
    patchObject('no-such-object', { color: '#010203' }, 'Цвет');
    expect(state()).toBe(before);
  });

  it('заблокированный объект принимает через patchObject только locked и visible', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    patchObject(box.id, { locked: true }, 'Блокировка');
    const color = find(box.id).color;
    patchObject(box.id, { color: '#010203' }, 'Цвет');
    expect(find(box.id).color).toBe(color);
    patchObject(box.id, { visible: false }, 'Скрыть');
    expect(find(box.id).visible).toBe(false);
  });

  it('скрытие хозяина через patchObject опускает детей на пол одним обратимым шагом', () => {
    const table = venueTable();
    const lantern = put('sphere', { kind: 'surface', hostId: table.id, u: 0, v: 0 }, 'Фонарь');
    const world = worldOf(lantern.id);
    const pastBefore = state().history.past.length;

    patchObject(table.id, { visible: false }, 'Скрыть');

    expect(find(table.id).visible).toBe(false);
    expect(find(lantern.id).mount.kind).toBe('floor');
    expect(worldOf(lantern.id)[0]).toBeCloseTo(world[0], 6);
    expect(worldOf(lantern.id)[2]).toBeCloseTo(world[2], 6);
    expect(state().history.past).toHaveLength(pastBefore + 1);
    expect(sanitizeLayout(state().layout, room)).toBe(state().layout);

    state().undo();
    expect(find(table.id).visible).toBe(true);
    expect(find(lantern.id).mount).toEqual(lantern.mount);
  });

  it('setObjectMount меняет тип крепления, сохраняя мировые X/Z', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const world = worldOf(box.id);
    setObjectMount(box.id, 'ceiling');
    expect(find(box.id).mount.kind).toBe('ceiling');
    expect(worldOf(box.id)[0]).toBeCloseTo(world[0], 6);
    expect(worldOf(box.id)[2]).toBeCloseTo(world[2], 6);
    expect(state().history.past).toHaveLength(2);
    state().undo();
    expect(find(box.id).mount.kind).toBe('floor');
  });

  it('deleteObject удаляет декор, а мебель площадки скрывает', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    state().select(box.id);
    deleteObject(box.id);
    expect(objects().some((o) => o.id === box.id)).toBe(false);
    expect(state().selectedId).toBeNull();

    const table = venueTable();
    deleteObject(table.id);
    expect(find(table.id).visible).toBe(false);
    // Повторное удаление уже скрытой мебели — пустая команда.
    const past = state().history.past.length;
    deleteObject(table.id);
    expect(state().history.past).toHaveLength(past);
  });

  it('duplicateObject вставляет копию после оригинала и выбирает её', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 }, 'Ящик');
    const copyId = duplicateObject(box.id);
    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(box.id);
    expect(state().selectedId).toBe(copyId);
    const ids = objects().map((o) => o.id);
    expect(ids.indexOf(copyId!)).toBe(ids.indexOf(box.id) + 1);
    expect(find(copyId!).origin).toBe('user');
    expect(duplicateObject('no-such-object')).toBeNull();
  });

  it('resetFurniture возвращает мебель одним шагом и не трогает декор', () => {
    const table = venueTable();
    const original = find(table.id);
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    patchObject(table.id, { color: '#010203', rotationY: original.rotationY + 1 }, 'Правка');
    deleteObject(room.fixtures[0].id);
    const past = state().history.past.length;

    resetFurniture();
    expect(state().history.past).toHaveLength(past + 1);
    for (const fixture of room.fixtures) expect(deepEqual(find(fixture.id), fixture)).toBe(true);
    expect(objects().some((o) => o.id === box.id)).toBe(true);

    // Мебель уже исходная — повторный сброс ничего не отправляет.
    resetFurniture();
    expect(state().history.past).toHaveLength(past + 1);
  });

  it('в прогулке все действия ничего не делают', () => {
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const table = venueTable();
    patchObject(table.id, { color: '#010203' }, 'Цвет');
    state().setCameraMode('walk');
    const before = state();
    const { seen, stop } = record();

    expect(addObject(getItem('box'))).toBeNull();
    patchObject(box.id, { color: '#040506' }, 'Цвет');
    setObjectMount(box.id, 'ceiling');
    deleteObject(box.id);
    expect(duplicateObject(box.id)).toBeNull();
    resetFurniture();
    stop();

    expect(state()).toBe(before);
    expect(seen).toHaveLength(0);
  });

  it('действия передают в модель настоящий каталог', () => {
    // Ящик — опора в каталоге: предмет можно поставить на него через patchObject.
    const box = put('box', { kind: 'floor', x: 0, z: 0, lift: 0 });
    const ball = put('sphere', { kind: 'floor', x: 0, z: 0, lift: 0 });
    expect(catalogLookup.isSupport(find(box.id))).toBe(true);
    patchObject(ball.id, { mount: { kind: 'surface', hostId: box.id, u: 0, v: 0 } }, 'Перемещение');
    expect(find(ball.id).mount).toMatchObject({ kind: 'surface', hostId: box.id });
    expect(sanitizeLayout(state().layout, room)).toBe(state().layout);
  });
});
