// Сессия в Node: хранилищ браузера нет, поэтому `repository` — запасной MemoryRepository, а настройки лежат в памяти.
// Про lounge здесь утверждается только то, что следует из его же данных (без литералов координат).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '../catalog';
import { ASSET_LIMITS } from '../model/assets';
import { createLayout } from '../model/layout';
import { createObject } from '../model/ops';
import type { Layout } from '../model/types';
import { rooms } from '../rooms';
import { useEditor } from '../store/editorStore';
import { AUTOSAVE_DELAY_MS } from './autosave';
import { MEMORY_STORAGE_TEXT, repository, settingsStore, storageMode } from './index';
import { buildLayoutFile } from './layoutFile';
import { PREFS_KEY, defaultPrefs, readPrefs, writePrefs } from './prefs';
import { MemoryRepository, RepositoryError } from './repository';
import {
  assetUsage,
  createNamedLayout,
  deleteLayout,
  duplicateCurrentLayout,
  flushSave,
  importLayoutFile,
  listLayouts,
  openLayoutById,
  renameCurrentLayout,
  startSession,
  stopSession,
  switchRoom,
} from './session';

const room = rooms[0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (...tail: number[]) => new Blob([new Uint8Array([...PNG_HEAD, ...tail])]);

/** id записей, которые list() не показывает (нечитаемые), — чтобы убрать их после теста. */
const hidden: string[] = [];

async function wipe(): Promise<void> {
  stopSession();
  for (const meta of await repository.list()) await repository.remove(meta.id);
  for (const id of hidden.splice(0)) await repository.remove(id);
  for (const meta of await repository.listAssets()) await repository.removeAsset(meta.id);
  settingsStore.remove(PREFS_KEY);

  const state = useEditor.getState();
  state.openLayout(createLayout(room));
  state.setAssets([]);
  state.setAmbience('work');
  state.setLayer('auto');
  state.setGridSnap(true);
  if (!useEditor.getState().showLabels) state.toggleLabels();
  state.setCameraMode('orbit');
  state.setStorageMode('local');
  state.dismissNotice();
}

/** Перезапуск вкладки: сессия остановлена, стор — как при загрузке страницы; хранилище и настройки остаются. */
function restart(): void {
  stopSession();
  const state = useEditor.getState();
  state.openLayout(createLayout(room));
  state.setAssets([]);
  state.setAmbience('work');
  state.dismissNotice();
}

function current(): Layout {
  return useEditor.getState().layout;
}

function rename(name: string): void {
  useEditor.getState().dispatch({ type: 'rename', name });
}

async function savedNames(): Promise<string[]> {
  return (await repository.list(room.id)).map((m) => m.name).sort();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await wipe();
});

afterEach(async () => {
  await wipe();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('запасное хранилище', () => {
  it('в Node хранилищ браузера нет: MemoryRepository и режим memory', () => {
    expect(repository).toBeInstanceOf(MemoryRepository);
    expect(storageMode).toBe('memory');
  });

  it('startSession передаёт режим в стор и один раз показывает предупреждение', async () => {
    await startSession();
    expect(useEditor.getState().storage).toBe('memory');
    expect(useEditor.getState().notice).toMatchObject({ level: 'warn', text: MEMORY_STORAGE_TEXT });
    expect(MEMORY_STORAGE_TEXT).toBe('Хранилище браузера недоступно: макеты не сохранятся после закрытия вкладки');

    // Тост исчезает, поле storage — нет: метка «Не сохраняется» в меню макетов зависит только от него.
    useEditor.getState().dismissNotice();
    await startSession();
    expect(useEditor.getState().notice).toBeNull();
    expect(useEditor.getState().storage).toBe('memory');
  });
});

describe('startSession', () => {
  it('пустое хранилище: создаёт и сохраняет «Макет 1»', async () => {
    await startSession();
    expect(current().name).toBe('Макет 1');
    expect(current().roomId).toBe(room.id);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(await repository.list()).toEqual([
      { id: current().id, name: 'Макет 1', roomId: room.id, updatedAt: current().updatedAt },
    ]);
    // Мебель площадки на месте.
    for (const fixture of room.fixtures) expect(current().objects.some((o) => o.id === fixture.id)).toBe(true);
  });

  it('идемпотентна: повторный вызов не создаёт второй макет и вторую подписку', async () => {
    const first = startSession();
    const second = startSession();
    expect(second).toBe(first);
    await first;
    await startSession();
    expect(await savedNames()).toEqual(['Макет 1']);

    rename('Одна запись');
    const save = vi.spyOn(repository, 'save');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await vi.waitFor(() => expect(useEditor.getState().saveStatus).toBe('saved'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('открывает последний открытый макет помещения, а не самый новый', async () => {
    await startSession();
    const firstId = current().id;
    await createNamedLayout('Второй');
    await createNamedLayout('Третий');
    await openLayoutById(firstId);
    expect(readPrefs(settingsStore).lastLayoutByRoom[room.id]).toBe(firstId);

    restart();
    await startSession();
    expect(current().id).toBe(firstId);
    expect(current().name).toBe('Макет 1');
    expect(await savedNames()).toEqual(['Второй', 'Макет 1', 'Третий']);
  });

  it('без записи о последнем макете открывает самый новый макет помещения', async () => {
    const old: Layout = { ...createLayout(room, 'Старый'), updatedAt: 1000 };
    const fresh: Layout = { ...createLayout(room, 'Свежий'), updatedAt: 5000 };
    const foreign: Layout = { ...createLayout(room, 'Чужое помещение'), roomId: 'other-room', updatedAt: 9000 };
    for (const layout of [old, fresh, foreign]) await repository.save(layout);

    await startSession();
    expect(current().id).toBe(fresh.id);
    expect(await repository.list()).toHaveLength(3);
  });

  it('нечитаемый макет пропускается (берётся следующий кандидат) и не удаляется', async () => {
    const good: Layout = { ...createLayout(room, 'Читаемый'), updatedAt: 1000 };
    const broken: Layout = { ...createLayout(room, 'Битый'), roomId: 'room id with spaces', updatedAt: 9000 };
    await repository.save(good);
    await repository.save(broken);
    hidden.push(broken.id);
    writePrefs(settingsStore, { ...defaultPrefs(), roomId: room.id, lastLayoutByRoom: { [room.id]: broken.id } });

    await startSession();
    expect(current().id).toBe(good.id);
    // Запись на месте: load по-прежнему отвечает «corrupt», а не «нет такого».
    await expect(repository.load(broken.id)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('загруженный макет проходит reconcileVenue: недостающая мебель площадки возвращается', async () => {
    const bare: Layout = { ...createLayout(room, 'Без мебели'), objects: [] };
    await repository.save(bare);

    await startSession();
    expect(current().id).toBe(bare.id);
    expect(current().objects.map((o) => o.id).sort()).toEqual(room.fixtures.map((f) => f.id).sort());
    expect(useEditor.getState().saveStatus).toBe('saved');
  });

  it('настройки вида читаются из prefs и пишутся обратно при смене', async () => {
    writePrefs(settingsStore, { ...defaultPrefs(), showLabels: false, gridSnap: false, ambience: 'party', layer: 'ceiling' });
    await startSession();
    expect(useEditor.getState()).toMatchObject({ showLabels: false, gridSnap: false, ambience: 'party', layer: 'ceiling' });

    useEditor.getState().setLayer('floor');
    useEditor.getState().setAmbience('work');
    useEditor.getState().toggleLabels();
    expect(readPrefs(settingsStore)).toMatchObject({
      roomId: room.id,
      showLabels: true,
      gridSnap: false,
      ambience: 'work',
      layer: 'floor',
      lastLayoutByRoom: { [room.id]: current().id },
    });
  });

  it('библиотека файлов попадает в стор', async () => {
    const asset = await repository.putAsset(png(1), { kind: 'image', name: 'плакат.png' });
    await startSession();
    expect(useEditor.getState().assets.map((a) => a.id)).toEqual([asset.id]);
  });

  it('правки, сделанные до готовности сессии, не выбрасываются', async () => {
    const saved: Layout = { ...createLayout(room, 'Сохранённый'), updatedAt: 1000 };
    await repository.save(saved);
    rename('Успел поправить');
    const editedId = current().id;

    await startSession();
    expect(current().id).toBe(editedId);
    expect(current().name).toBe('Успел поправить');
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(await savedNames()).toEqual(['Сохранённый', 'Успел поправить']);
  });

  it('автосохранение: правка записывается через 800 мс', async () => {
    await startSession();
    rename('После правки');
    expect(useEditor.getState().saveStatus).toBe('dirty');
    expect(await savedNames()).toEqual(['Макет 1']);

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await vi.waitFor(() => expect(useEditor.getState().saveStatus).toBe('saved'));
    expect(await savedNames()).toEqual(['После правки']);
  });

  it('stopSession снимает автосохранение и подписку на стор', async () => {
    await startSession();
    stopSession();
    const before = readPrefs(settingsStore);
    rename('Без сессии');
    useEditor.getState().setAmbience('party');
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(await savedNames()).toEqual(['Макет 1']);
    expect(readPrefs(settingsStore)).toEqual(before);
  });
});

describe('именованные макеты', () => {
  it('createNamedLayout: сохраняет текущий, создаёт и открывает новый; пустое имя → «Макет N»', async () => {
    await startSession();
    rename('Первый');
    const firstId = current().id;

    await createNamedLayout('  Свадьба   в   лаунже ');
    expect(current().name).toBe('Свадьба в лаунже');
    expect(current().id).not.toBe(firstId);
    expect(useEditor.getState().saveStatus).toBe('saved');
    // Несохранённое переименование прежнего макета не потеряно.
    expect((await repository.load(firstId))?.name).toBe('Первый');

    await createNamedLayout('');
    expect(current().name).toBe('Макет 1');
    await createNamedLayout('   ');
    expect(current().name).toBe('Макет 2');
    expect(await savedNames()).toEqual(['Макет 1', 'Макет 2', 'Первый', 'Свадьба в лаунже']);
  });

  it('duplicateCurrentLayout: копия с новым id становится текущей, оригинал остаётся', async () => {
    await startSession();
    useEditor.getState().dispatch({
      type: 'add',
      items: [{ object: createObject(getItem('box'), { kind: 'floor', x: 0, z: 0, lift: 0 }) }],
    });
    const source = current();

    await duplicateCurrentLayout('Вариант Б');
    expect(current().id).not.toBe(source.id);
    expect(current().name).toBe('Вариант Б');
    expect(current().objects).toEqual(source.objects);
    expect(current().objects).not.toBe(source.objects);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect((await repository.load(source.id))?.objects).toHaveLength(source.objects.length);
    expect(await savedNames()).toEqual(['Вариант Б', 'Макет 1']);

    // Пустое имя → «<имя> — копия».
    await duplicateCurrentLayout('');
    expect(current().name).toBe('Вариант Б — копия');
  });

  it('renameCurrentLayout: команда rename (отменяется), пустое имя игнорируется', async () => {
    await startSession();
    renameCurrentLayout('  Хэллоуин  ');
    expect(current().name).toBe('Хэллоуин');
    expect(useEditor.getState().saveStatus).toBe('dirty');
    expect(useEditor.getState().history.past).toHaveLength(1);

    renameCurrentLayout('   ');
    expect(current().name).toBe('Хэллоуин');
    renameCurrentLayout('я'.repeat(300));
    expect(current().name).toHaveLength(120);

    useEditor.getState().undo();
    useEditor.getState().undo();
    expect(current().name).toBe('Макет 1');
  });

  it('openLayoutById: сохраняет несохранённое и открывает макет', async () => {
    await startSession();
    const firstId = current().id;
    await createNamedLayout('Второй');
    const secondId = current().id;
    rename('Второй, исправленный');

    await openLayoutById(firstId);
    expect(current().id).toBe(firstId);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(useEditor.getState().history.past).toHaveLength(0);
    expect((await repository.load(secondId))?.name).toBe('Второй, исправленный');
  });

  it('openLayoutById нечитаемого или неизвестного макета: текущий остаётся, запись не удаляется', async () => {
    await startSession();
    const id = current().id;
    const broken: Layout = { ...createLayout(room, 'Битый'), roomId: 'room id with spaces' };
    await repository.save(broken);
    hidden.push(broken.id);

    await openLayoutById(broken.id);
    expect(current().id).toBe(id);
    expect(useEditor.getState().notice?.level).toBe('error');
    await expect(repository.load(broken.id)).rejects.toBeInstanceOf(RepositoryError);

    useEditor.getState().dismissNotice();
    await openLayoutById('no-such-layout');
    expect(current().id).toBe(id);
    expect(useEditor.getState().notice?.level).toBe('error');
  });

  it('deleteLayout чужого макета не трогает текущий', async () => {
    await startSession();
    const firstId = current().id;
    await createNamedLayout('Второй');
    const secondId = current().id;
    rename('Второй с правкой');

    await deleteLayout(firstId);
    expect(current().id).toBe(secondId);
    expect(current().name).toBe('Второй с правкой');
    expect(useEditor.getState().saveStatus).toBe('dirty');
    expect(await repository.load(firstId)).toBeNull();
  });

  it('deleteLayout текущего: открывается следующий по новизне; отложенное автосохранение его не возвращает', async () => {
    await startSession();
    const firstId = current().id;
    await createNamedLayout('Второй');
    const secondId = current().id;
    rename('Второй с правкой');

    await deleteLayout(secondId);
    expect(current().id).toBe(firstId);
    expect(useEditor.getState().saveStatus).toBe('saved');
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(await repository.load(secondId)).toBeNull();
    expect(readPrefs(settingsStore).lastLayoutByRoom[room.id]).toBe(firstId);
  });

  it('deleteLayout последнего макета создаёт новый', async () => {
    await startSession();
    const onlyId = current().id;
    await deleteLayout(onlyId);
    expect(current().id).not.toBe(onlyId);
    expect(current().name).toBe('Макет 1');
    expect((await repository.list()).map((m) => m.id)).toEqual([current().id]);
  });

  it('listLayouts: макеты текущего помещения, новые первыми; текущий — по состоянию стора', async () => {
    const old: Layout = { ...createLayout(room, 'Старый'), updatedAt: 1000 };
    const foreign: Layout = { ...createLayout(room, 'Чужое помещение'), roomId: 'other-room', updatedAt: 9e15 };
    await repository.save(old);
    await repository.save(foreign);
    await startSession();
    await createNamedLayout('Новый');
    rename('Новый, ещё не сохранён');

    const list = await listLayouts();
    expect(list.map((m) => m.name)).toEqual(['Новый, ещё не сохранён', 'Старый']);
    expect(list[0]).toEqual({ id: current().id, name: current().name, roomId: room.id, updatedAt: current().updatedAt });
  });

  it('switchRoom: неизвестное помещение — ничего; то же помещение — только сохранение', async () => {
    await startSession();
    const id = current().id;
    rename('Перед сменой');

    await switchRoom('no-such-room');
    expect(current().id).toBe(id);
    expect(useEditor.getState().saveStatus).toBe('dirty');

    await switchRoom(room.id);
    expect(current().id).toBe(id);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(await savedNames()).toEqual(['Перед сменой']);
  });
});

describe('сохранение и ошибки', () => {
  it('flushSave пишет сразу — запись идёт до возврата из вызова', async () => {
    await startSession();
    rename('Срочно');
    const save = vi.spyOn(repository, 'save');
    const pending = flushSave();
    expect(save).toHaveBeenCalledTimes(1);
    await pending;
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(await savedNames()).toEqual(['Срочно']);

    // Несохранённого нет — повторный вызов ничего не пишет.
    await flushSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('нет места: статус error, макет остаётся открытым, уход с него отменяется; после освобождения — сохраняется', async () => {
    await startSession();
    const id = current().id;
    rename('Не влезает');
    const save = vi.spyOn(repository, 'save').mockRejectedValue(new RepositoryError('quota'));

    await flushSave();
    expect(useEditor.getState().saveStatus).toBe('error');
    expect(useEditor.getState().notice).toMatchObject({ level: 'error' });
    expect(useEditor.getState().notice?.text).toContain('мало места');

    await createNamedLayout('Другой');
    expect(current().id).toBe(id);
    expect(current().name).toBe('Не влезает');
    expect(await savedNames()).toEqual(['Макет 1']);

    save.mockRestore();
    await flushSave();
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(await savedNames()).toEqual(['Не влезает']);
  });

  it('первый макет не удалось сохранить: сессия работает в памяти, следующая правка повторяет попытку', async () => {
    const save = vi.spyOn(repository, 'save').mockRejectedValue(new RepositoryError('quota'));
    await startSession();
    expect(current().name).toBe('Макет 1');
    expect(useEditor.getState().saveStatus).toBe('error');
    expect(await repository.list()).toEqual([]);

    save.mockRestore();
    rename('Со второй попытки');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await vi.waitFor(() => expect(useEditor.getState().saveStatus).toBe('saved'));
    expect(await savedNames()).toEqual(['Со второй попытки']);
  });
});

describe('файлы', () => {
  it('assetUsage: названия текущего и сохранённых макетов, где используется файл', async () => {
    const asset = await repository.putAsset(png(1), { kind: 'image', name: 'плакат.png' });
    const other = await repository.putAsset(png(2), { kind: 'image', name: 'другой.png' });
    const image = () => createObject(getItem('image'), { kind: 'floor', x: 0, z: 0, lift: 0 }, { assetId: asset.id });

    const stored: Layout = createLayout(room, 'Сохранённый с плакатом');
    stored.objects.push(image());
    await repository.save(stored);
    await repository.save(createLayout(room, 'Без плаката'));
    const foreign: Layout = { ...createLayout(room, 'Чужое помещение'), roomId: 'other-room' };
    foreign.objects.push(image());
    await repository.save(foreign);

    await startSession();
    await createNamedLayout('Текущий');
    expect((await assetUsage(asset.id)).sort()).toEqual(['Сохранённый с плакатом', 'Чужое помещение']);

    // Несохранённая правка текущего макета тоже считается.
    useEditor.getState().dispatch({ type: 'add', items: [{ object: image() }] });
    expect((await assetUsage(asset.id)).sort()).toEqual(['Сохранённый с плакатом', 'Текущий', 'Чужое помещение']);
    expect(await assetUsage(other.id)).toEqual([]);
  });
});

describe('importLayoutFile', () => {
  async function exported(): Promise<{ text: string; assetId: string; source: Layout }> {
    const donor = new MemoryRepository();
    const asset = await donor.putAsset(png(7, 7, 7), { kind: 'image', name: 'плакат.png', width: 8, height: 8 });
    const source = createLayout(room, 'Из файла');
    source.objects.push(createObject(getItem('image'), { kind: 'floor', x: 0, z: 0, lift: 0 }, { assetId: asset.id }));
    return { text: JSON.stringify(await buildLayoutFile(source, donor)), assetId: asset.id, source };
  }

  it('импортирует как НОВЫЙ макет, обновляет библиотеку и открывает его', async () => {
    await startSession();
    rename('Мой макет');
    const mineId = current().id;
    const { text, assetId, source } = await exported();

    await importLayoutFile(new File([text], 'party.vagonka.json', { type: 'application/json' }));

    expect(current().id).not.toBe(mineId);
    expect(current().id).not.toBe(source.id);
    expect(current().name).toBe('Из файла');
    expect(current().objects).toHaveLength(source.objects.length);
    expect(current().objects.some((o) => o.assetId === assetId)).toBe(true);
    expect(useEditor.getState().saveStatus).toBe('saved');
    expect(useEditor.getState().assets.map((a) => a.id)).toEqual([assetId]);
    expect(useEditor.getState().notice).toMatchObject({ level: 'info' });
    // Прежний макет сохранён вместе с правкой; импортированный лежит в хранилище.
    expect(await savedNames()).toEqual(['Из файла', 'Мой макет']);
    expect(readPrefs(settingsStore).lastLayoutByRoom[room.id]).toBe(current().id);
  });

  it('негодный файл: ошибка в тосте, текущий макет и хранилище не тронуты', async () => {
    await startSession();
    const id = current().id;

    await importLayoutFile(new File(['это не JSON'], 'x.json'));
    expect(useEditor.getState().notice?.level).toBe('error');
    expect(useEditor.getState().notice?.text).toContain('Импорт не выполнен');
    expect(current().id).toBe(id);

    const { text } = await exported();
    const newer = JSON.stringify({ ...(JSON.parse(text) as object), version: 2 });
    await importLayoutFile(new File([newer], 'x.json'));
    expect(useEditor.getState().notice?.text).toContain('Файл создан более новой версией');

    const foreign = JSON.parse(text) as { layout: { roomId: string } };
    foreign.layout.roomId = 'rooftop';
    await importLayoutFile(new File([JSON.stringify(foreign)], 'x.json'));
    expect(useEditor.getState().notice?.text).toContain('В файле помещение „rooftop“, которого нет в этой версии');

    expect(current().id).toBe(id);
    expect(await savedNames()).toEqual(['Макет 1']);
    expect(await repository.listAssets()).toEqual([]);
  });

  it('слишком большой файл отклоняется до чтения', async () => {
    await startSession();
    const text = vi.fn(async () => '{}');
    const huge = { name: 'huge.json', size: ASSET_LIMITS.importFileBytes + 1, text } as unknown as File;

    await importLayoutFile(huge);
    expect(text).not.toHaveBeenCalled();
    expect(useEditor.getState().notice).toMatchObject({ level: 'error' });
    expect(useEditor.getState().notice?.text).toContain('300 МБ');
  });

  it('замечания импорта показываются предупреждением', async () => {
    await startSession();
    const { text } = await exported();
    const file = JSON.parse(text) as { assets: unknown[] };
    file.assets = [];

    await importLayoutFile(new File([JSON.stringify(file)], 'x.json'));
    expect(current().name).toBe('Из файла');
    expect(useEditor.getState().notice).toMatchObject({ level: 'warn' });
    expect(useEditor.getState().notice?.text).toContain('Не найдены файлы');
  });
});
