import { describe, expect, it } from 'vitest';
import { getItem } from '../catalog';
import { hashAssetId } from '../model/assets';
import { deepEqual } from '../model/commands';
import { createLayout } from '../model/layout';
import { createObject } from '../model/ops';
import { testRoom } from '../model/testRoom';
import { SCHEMA_VERSION } from '../model/types';
import type { Layout } from '../model/types';
import { LAYOUT_KEY_PREFIX, createLocalRepository } from './localRepository';
import type { AssetRecord } from './localRepository';
import { RepositoryError } from './repository';
import type { LayoutRepository } from './repository';
import { browserStringStore, isQuotaError, memoryRecordStore, memoryStringStore } from './stores';
import type { RecordStore, StringStore } from './stores';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length);
  out.set(values);
  return out;
}
const png = (...tail: number[]) => new Blob([bytes(...PNG_HEAD, ...tail)]);
const glb = (...tail: number[]) => new Blob([bytes(0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, ...tail)]);

function layoutAt(name: string, updatedAt: number, roomId = testRoom.id): Layout {
  return { ...createLayout(testRoom, name), roomId, updatedAt };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('ожидалась ошибка');
}

interface Bench {
  repo: LayoutRepository;
  strings: StringStore;
  assets: RecordStore<AssetRecord>;
  /** Часы репозитория (createdAt файлов). */
  clock: { now: number };
}

function bench(quotaChars?: number): Bench {
  const strings = memoryStringStore(quotaChars);
  const assets = memoryRecordStore<AssetRecord>();
  const clock = { now: 1000 };
  return { repo: createLocalRepository({ strings, assets, now: () => clock.now }), strings, assets, clock };
}

const keyOf = (id: string) => `${LAYOUT_KEY_PREFIX}${id}`;

describe('LocalRepository — макеты', () => {
  it('ключ макета — vagonka:layout:<id>, значение — JSON макета; отдельного индекса нет', async () => {
    const { repo, strings } = bench();
    const layout = layoutAt('Свадьба', 1000);
    await repo.save(layout);

    expect(LAYOUT_KEY_PREFIX).toBe('vagonka:layout:');
    expect(strings.keys()).toEqual([`vagonka:layout:${layout.id}`]);
    expect(JSON.parse(strings.get(keyOf(layout.id))!)).toEqual(JSON.parse(JSON.stringify(layout)));
  });

  it('save → load возвращает deep-равный макет, но не ту же ссылку', async () => {
    const { repo } = bench();
    const layout = layoutAt('Свадьба', 1000);
    layout.objects.push(createObject(getItem('box'), { kind: 'floor', x: 1, z: 1, lift: 0 }));
    await repo.save(layout);

    const loaded = await repo.load(layout.id);
    expect(loaded).not.toBeNull();
    expect(loaded).not.toBe(layout);
    expect(deepEqual(loaded, JSON.parse(JSON.stringify(layout)))).toBe(true);

    loaded!.name = 'Испорчено';
    layout.name = 'Тоже испорчено';
    expect((await repo.load(layout.id))?.name).toBe('Свадьба');
  });

  it('save пишет в хранилище синхронно — до первого await (сохранение из pagehide)', () => {
    const { repo, strings } = bench();
    const layout = layoutAt('Срочно', 1000);
    // Промис намеренно не ожидается: запись обязана быть на месте сразу после возврата из вызова.
    const pending = repo.save(layout);
    expect(strings.get(keyOf(layout.id))).not.toBeNull();
    return pending;
  });

  it('load неизвестного id → null', async () => {
    expect(await bench().repo.load('no-such-layout')).toBeNull();
  });

  it('save перезаписывает макет с тем же id', async () => {
    const { repo, strings } = bench();
    const layout = layoutAt('Первое имя', 1000);
    await repo.save(layout);
    await repo.save({ ...layout, name: 'Второе имя', updatedAt: 2000 });

    expect(await repo.list()).toEqual([{ id: layout.id, name: 'Второе имя', roomId: testRoom.id, updatedAt: 2000 }]);
    expect((await repo.load(layout.id))?.name).toBe('Второе имя');
    expect(strings.keys()).toHaveLength(1);
  });

  it('list: новые первыми, с фильтром по помещению и без', async () => {
    const { repo } = bench();
    const old = layoutAt('Старый', 1000);
    const fresh = layoutAt('Новый', 3000);
    const other = layoutAt('Другое помещение', 2000, 'other-room');
    await repo.save(old);
    await repo.save(fresh);
    await repo.save(other);

    expect((await repo.list()).map((m) => m.name)).toEqual(['Новый', 'Другое помещение', 'Старый']);
    expect((await repo.list(testRoom.id)).map((m) => m.id)).toEqual([fresh.id, old.id]);
    expect(await repo.list('other-room')).toEqual([
      { id: other.id, name: 'Другое помещение', roomId: 'other-room', updatedAt: 2000 },
    ]);
    expect(await repo.list('empty-room')).toEqual([]);
  });

  it('list не видит чужих ключей', async () => {
    const { repo, strings } = bench();
    const layout = layoutAt('Свой', 1000);
    await repo.save(layout);
    const foreign = JSON.stringify(layoutAt('Чужой', 5000));
    strings.set('vagonka:prefs', JSON.stringify({ roomId: testRoom.id }));
    strings.set('vagonka:layouts', foreign);
    strings.set('other-app:layout:abc', foreign);
    strings.set('layout:abc', foreign);

    expect((await repo.list()).map((m) => m.id)).toEqual([layout.id]);
    // Чужие ключи не тронуты.
    expect(strings.keys().sort()).toEqual(
      [keyOf(layout.id), 'vagonka:prefs', 'vagonka:layouts', 'other-app:layout:abc', 'layout:abc'].sort(),
    );
  });

  it('list пропускает битую запись, не удаляя её', async () => {
    const { repo, strings } = bench();
    const good = layoutAt('Хороший', 1000);
    await repo.save(good);
    const junk: Record<string, string> = {
      [keyOf('broken-json')]: '{"id": "broken-json", "name": ',
      [keyOf('not-object')]: '[1, 2, 3]',
      [keyOf('no-version')]: JSON.stringify({ id: 'no-version', name: 'Без версии', roomId: testRoom.id, objects: [] }),
      [keyOf('newer')]: JSON.stringify({ ...layoutAt('Из будущего', 9000), id: 'newer', schemaVersion: SCHEMA_VERSION + 1 }),
      [keyOf('bad-room')]: JSON.stringify({ ...layoutAt('Плохое помещение', 9000), id: 'bad-room', roomId: 'room id with spaces' }),
      [keyOf('no-name')]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, id: 'no-name', roomId: testRoom.id, objects: [] }),
      // Запись лежит под чужим ключом: открылась бы под другим id.
      [keyOf('alias')]: JSON.stringify(good),
    };
    for (const [key, value] of Object.entries(junk)) strings.set(key, value);

    expect((await repo.list()).map((m) => m.id)).toEqual([good.id]);
    for (const [key, value] of Object.entries(junk)) expect(strings.get(key)).toBe(value);
  });

  it('list читает только шапку: негодное время изменения → 0, имя обрезается', async () => {
    const { repo, strings } = bench();
    const layout = { ...layoutAt('я'.repeat(300), 1000), id: 'odd-time', updatedAt: 'вчера' };
    strings.set(keyOf('odd-time'), JSON.stringify(layout));

    const [meta] = await repo.list();
    expect(meta.updatedAt).toBe(0);
    expect(meta.name).toHaveLength(120);
    expect(Object.keys(meta).sort()).toEqual(['id', 'name', 'roomId', 'updatedAt']);
  });

  it('битый JSON: load → RepositoryError("corrupt"), строка остаётся на месте', async () => {
    const { repo, strings } = bench();
    strings.set(keyOf('broken'), '{"schemaVersion": 2, "id": "broken"');

    const error = await rejection(repo.load('broken'));
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('corrupt');
    expect(strings.get(keyOf('broken'))).toBe('{"schemaVersion": 2, "id": "broken"');
  });

  it('нечитаемый макет: corrupt, запись не удаляется; её можно перезаписать исправленным макетом', async () => {
    const { repo, strings } = bench();
    const good = layoutAt('Хороший', 1000);
    const broken = layoutAt('Битый', 2000, 'room id with spaces');
    await repo.save(good);
    await repo.save(broken);

    const error = await rejection(repo.load(broken.id));
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('corrupt');
    expect((await repo.list()).map((m) => m.id)).toEqual([good.id]);
    expect(strings.get(keyOf(broken.id))).not.toBeNull();

    await repo.save({ ...broken, roomId: testRoom.id });
    expect((await repo.load(broken.id))?.name).toBe('Битый');
  });

  it('запись под чужим ключом: load → corrupt', async () => {
    const { repo, strings } = bench();
    strings.set(keyOf('alias'), JSON.stringify(layoutAt('Под чужим ключом', 1000)));
    const error = await rejection(repo.load('alias'));
    expect((error as RepositoryError).code).toBe('corrupt');
  });

  it('load проводит запись через parseLayout: v1 мигрирует, лишние поля не переносятся', async () => {
    const { repo, strings } = bench();
    const v1 = {
      schemaVersion: 1,
      id: 'old-layout',
      name: 'С первого этапа',
      roomId: testRoom.id,
      updatedAt: 500,
      evil: '<script>alert(1)</script>',
      objects: [
        {
          id: 'obj-1',
          kind: 'primitive',
          type: 'box',
          origin: 'user',
          name: 'Ящик',
          position: [1, 0.5, -1],
          rotationY: 0.5,
          size: [0.5, 0.5, 0.5],
          color: '#b8b2a7',
          locked: false,
          visible: true,
          onclick: 'alert(1)',
        },
      ],
    };
    strings.set(keyOf('old-layout'), JSON.stringify(v1));

    const loaded = await repo.load('old-layout');
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(SCHEMA_VERSION);
    expect('evil' in loaded!).toBe(false);
    expect(loaded!.objects).toHaveLength(1);
    expect(loaded!.objects[0].mount).toEqual({ kind: 'floor', x: 1, z: -1, lift: 0.5 });
    expect(loaded!.objects[0].assetId).toBeNull();
    expect(loaded!.objects[0].params).toEqual({});
    expect('onclick' in loaded!.objects[0]).toBe(false);
    expect('position' in loaded!.objects[0]).toBe(false);
    // Макет первой версии виден и в списке.
    expect(await repo.list()).toEqual([{ id: 'old-layout', name: 'С первого этапа', roomId: testRoom.id, updatedAt: 500 }]);
  });

  it('remove удаляет макет, не трогая остальные и файлы', async () => {
    const { repo, strings } = bench();
    const a = layoutAt('А', 1000);
    const b = layoutAt('Б', 2000);
    await repo.save(a);
    await repo.save(b);
    const asset = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });

    await repo.remove(a.id);
    await repo.remove('no-such-layout');

    expect(await repo.load(a.id)).toBeNull();
    expect((await repo.list()).map((m) => m.id)).toEqual([b.id]);
    expect(strings.keys()).toEqual([keyOf(b.id)]);
    expect(await repo.getAsset(asset.id)).not.toBeNull();
  });

  it('квота: save → RepositoryError("quota"), сохранённое не испорчено', async () => {
    const small = layoutAt('Маленький', 1000);
    const room = keyOf(small.id).length + JSON.stringify(small).length;
    const { repo, strings } = bench(room + 200);
    await repo.save(small);
    const before = strings.get(keyOf(small.id));

    // Тот же макет, выросший сверх квоты.
    const grown: Layout = { ...small, name: 'Выросший', updatedAt: 2000, objects: [...small.objects] };
    for (let i = 0; i < 20; i++) grown.objects.push(createObject(getItem('box'), { kind: 'floor', x: 0, z: 0, lift: 0 }));
    const error = await rejection(repo.save(grown));
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('quota');

    expect(strings.get(keyOf(small.id))).toBe(before);
    expect((await repo.load(small.id))?.name).toBe('Маленький');
    expect(await repo.list()).toEqual([{ id: small.id, name: 'Маленький', roomId: testRoom.id, updatedAt: 1000 }]);

    // Новый макет при переполнении не появляется даже частично.
    const extra = layoutAt('Лишний', 3000);
    expect(((await rejection(repo.save(extra))) as RepositoryError).code).toBe('quota');
    expect(strings.keys()).toEqual([keyOf(small.id)]);
    expect(await repo.load(extra.id)).toBeNull();

    // После освобождения места сохранение снова работает.
    await repo.remove(small.id);
    await repo.save(extra);
    expect((await repo.load(extra.id))?.name).toBe('Лишний');
  });

  it('квота распознаётся по name и по code ошибки хранилища', async () => {
    const failing = (error: unknown): LayoutRepository =>
      createLocalRepository({
        strings: {
          ...memoryStringStore(),
          set: () => {
            throw error;
          },
        },
        assets: memoryRecordStore<AssetRecord>(),
        now: () => 0,
      });
    const codeOf = async (error: unknown) => ((await rejection(failing(error).save(layoutAt('X', 1)))) as RepositoryError).code;

    expect(await codeOf(new DOMException('full', 'QuotaExceededError'))).toBe('quota');
    expect(await codeOf({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe('quota');
    expect(await codeOf({ code: 22 })).toBe('quota');
    expect(await codeOf({ code: 1014 })).toBe('quota');
    // Любая другая ошибка хранилища — «недоступно», а не квота.
    expect(await codeOf(new Error('SecurityError'))).toBe('unavailable');
  });
});

describe('LocalRepository — файлы', () => {
  it('putAsset content-addressed: id = hashAssetId(байты), mime по сигнатуре, одна запись { meta, blob }', async () => {
    const { repo, assets, clock } = bench();
    clock.now = 4242;
    const blob = new Blob([bytes(...PNG_HEAD, 1, 2, 3)], { type: 'text/plain' });
    const meta = await repo.putAsset(blob, { kind: 'image', name: 'плакат.png', width: 640, height: 480 });

    expect(meta.id).toBe(await hashAssetId(await blob.arrayBuffer()));
    expect(meta.id).toMatch(/^a_[0-9a-f]{32}$/);
    expect(meta).toEqual({
      id: meta.id,
      kind: 'image',
      name: 'плакат.png',
      mime: 'image/png',
      bytes: 11,
      createdAt: 4242,
      width: 640,
      height: 480,
    });

    // Ключ записи — id по содержимому; метаданные и блоб лежат вместе.
    expect(await assets.keys()).toEqual([meta.id]);
    const record = await assets.get(meta.id);
    expect(record?.meta).toEqual(meta);
    expect(record?.blob.type).toBe('image/png');

    const stored = await repo.getAsset(meta.id);
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe('image/png');
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([...PNG_HEAD, 1, 2, 3]);
  });

  it('putAsset идемпотентен: одинаковые байты → один id, одна запись, прежние метаданные', async () => {
    const { repo, assets, clock } = bench();
    const first = await repo.putAsset(png(7, 7), { kind: 'image', name: 'первый.png', width: 10, height: 20 });
    clock.now = 9999;
    const again = await repo.putAsset(png(7, 7), { kind: 'image', name: 'второй.png', width: 99, height: 99 });
    const other = await repo.putAsset(png(7, 8), { kind: 'image', name: 'другой.png' });

    expect(again).toEqual(first);
    expect(other.id).not.toBe(first.id);
    expect((await assets.keys()).sort()).toEqual([first.id, other.id].sort());
    expect((await repo.listAssets()).map((m) => m.id).sort()).toEqual([first.id, other.id].sort());
  });

  it('модель: mime GLB и naturalSize (копия, а не ссылка)', async () => {
    const { repo } = bench();
    const naturalSize: [number, number, number] = [1, 2, 3];
    const meta = await repo.putAsset(glb(9), { kind: 'model', name: 'сова.glb', naturalSize });
    expect(meta).toMatchObject({ kind: 'model', mime: 'model/gltf-binary', naturalSize: [1, 2, 3] });
    expect(meta.width).toBeUndefined();

    naturalSize[0] = 100;
    meta.naturalSize![1] = 200;
    expect((await repo.listAssets())[0].naturalSize).toEqual([1, 2, 3]);
  });

  it('неизвестное содержимое → RepositoryError("corrupt"), ничего не сохраняется', async () => {
    const { repo, assets } = bench();
    for (const blob of [new Blob(['<svg></svg>']), new Blob(['просто текст']), new Blob([]), new Blob(['{"a": 1}'])]) {
      const error = await rejection(repo.putAsset(blob, { kind: 'image', name: 'x.svg' }));
      expect(error).toBeInstanceOf(RepositoryError);
      expect((error as RepositoryError).code).toBe('corrupt');
    }
    expect(await repo.listAssets()).toEqual([]);
    expect(await assets.keys()).toEqual([]);
  });

  it('вид из info не сверяется с содержимым (контракт 2.18): kind — как передан, mime — по сигнатуре', async () => {
    const { repo } = bench();
    const meta = await repo.putAsset(png(1), { kind: 'model', name: 'x.glb' });
    expect(meta).toMatchObject({ kind: 'model', mime: 'image/png' });
    expect((await repo.getAsset(meta.id))?.type).toBe('image/png');
  });

  it('имя файла обрезается до 120 символов', async () => {
    const meta = await bench().repo.putAsset(png(1), { kind: 'image', name: 'я'.repeat(300) });
    expect(meta.name).toHaveLength(120);
  });

  it('listAssets: новые первыми, копии метаданных', async () => {
    const { repo, clock } = bench();
    clock.now = 100;
    const old = await repo.putAsset(png(1), { kind: 'image', name: 'старый.png' });
    clock.now = 300;
    const fresh = await repo.putAsset(png(2), { kind: 'image', name: 'новый.png' });
    clock.now = 200;
    const middle = await repo.putAsset(png(3), { kind: 'image', name: 'средний.png' });

    const listed = await repo.listAssets();
    expect(listed.map((m) => m.id)).toEqual([fresh.id, middle.id, old.id]);
    listed[0].name = 'испорчено';
    expect((await repo.listAssets())[0].name).toBe('новый.png');
  });

  it('getAsset неизвестного id → null; removeAsset — одно удаление, только свой файл', async () => {
    const { repo, assets } = bench();
    const a = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });
    const b = await repo.putAsset(png(2), { kind: 'image', name: 'b.png' });
    expect(await repo.getAsset(`a_${'0'.repeat(32)}`)).toBeNull();

    await repo.removeAsset(a.id);
    await repo.removeAsset('no-such-asset');
    expect(await repo.getAsset(a.id)).toBeNull();
    expect((await repo.listAssets()).map((m) => m.id)).toEqual([b.id]);
    expect(await assets.keys()).toEqual([b.id]);
  });

  it('автоматической сборки мусора нет: удаление макета не трогает его файлы', async () => {
    const { repo } = bench();
    const asset = await repo.putAsset(png(5), { kind: 'image', name: 'плакат.png' });
    const layout = layoutAt('С плакатом', 1000);
    layout.objects.push(createObject(getItem('image'), { kind: 'floor', x: 0, z: 0, lift: 0 }, { assetId: asset.id }));
    await repo.save(layout);
    await repo.remove(layout.id);
    expect((await repo.listAssets()).map((m) => m.id)).toEqual([asset.id]);
  });

  it('повреждённая запись хранилища файлов наружу не выходит', async () => {
    const { repo, assets } = bench();
    const good = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });
    const forged = `a_${'f'.repeat(32)}`;
    await assets.set(forged, { meta: { id: forged, kind: 'script', name: 'x', mime: 'text/html' }, blob: 'не блоб' } as unknown as AssetRecord);

    expect((await repo.listAssets()).map((m) => m.id)).toEqual([good.id]);
    expect(await repo.getAsset(forged)).toBeNull();
  });

  it('сбой хранилища файлов → RepositoryError: квота либо «недоступно»', async () => {
    const broken = (error: unknown): LayoutRepository => {
      const fail = async (): Promise<never> => {
        throw error;
      };
      return createLocalRepository({
        strings: memoryStringStore(),
        assets: { get: async () => undefined, set: fail, del: fail, keys: fail, values: fail },
        now: () => 0,
      });
    };
    const full = await rejection(broken(new DOMException('full', 'QuotaExceededError')).putAsset(png(1), { kind: 'image', name: 'a.png' }));
    expect((full as RepositoryError).code).toBe('quota');

    const down = broken(new Error('InvalidStateError'));
    expect(((await rejection(down.putAsset(png(1), { kind: 'image', name: 'a.png' }))) as RepositoryError).code).toBe('unavailable');
    expect(((await rejection(down.listAssets())) as RepositoryError).code).toBe('unavailable');
    expect(((await rejection(down.removeAsset('x'))) as RepositoryError).code).toBe('unavailable');
  });
});

describe('хранилища (stores.ts)', () => {
  it('memoryStringStore: квота считает символы ключа и значения, отказ не меняет содержимое', () => {
    const store = memoryStringStore(10);
    store.set('ab', '123456'); // 8
    expect(() => store.set('cd', '1')).toThrow(); // 8 + 3 > 10
    expect(store.keys()).toEqual(['ab']);

    // Перезапись учитывает освобождаемое место; слишком длинное значение прежнее не портит.
    store.set('ab', '12345678'); // 10
    let thrown: unknown;
    try {
      store.set('ab', '123456789');
    } catch (error) {
      thrown = error;
    }
    expect(isQuotaError(thrown)).toBe(true);
    expect((thrown as { name: string }).name).toBe('QuotaExceededError');
    expect(store.get('ab')).toBe('12345678');

    store.remove('ab');
    store.remove('no-such-key');
    expect(store.get('ab')).toBeNull();
    store.set('cd', '12345678');
    expect(store.keys()).toEqual(['cd']);
  });

  it('memoryStringStore без квоты не ограничен', () => {
    const store = memoryStringStore();
    store.set('k', 'x'.repeat(100_000));
    expect(store.get('k')).toHaveLength(100_000);
  });

  it('browserStringStore работает через интерфейс Storage', () => {
    const data = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => {
        data.delete(key);
      },
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
    const store = browserStringStore(storage);
    store.set('a', '1');
    store.set('b', '2');
    expect(store.get('a')).toBe('1');
    expect(store.get('zzz')).toBeNull();
    expect(store.keys().sort()).toEqual(['a', 'b']);
    store.remove('a');
    expect(store.keys()).toEqual(['b']);
    expect(data.get('b')).toBe('2');
  });

  it('memoryRecordStore: get / set / del / keys / values', async () => {
    const store = memoryRecordStore<number>();
    await store.set('a', 1);
    await store.set('b', 2);
    expect(await store.get('a')).toBe(1);
    expect(await store.get('zzz')).toBeUndefined();
    expect(await store.keys()).toEqual(['a', 'b']);
    expect(await store.values()).toEqual([1, 2]);
    await store.del('a');
    expect(await store.keys()).toEqual(['b']);
  });

  it('isQuotaError: только признаки переполнения', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
    expect(isQuotaError(new Error('QuotaExceededError'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
  });
});
