import { describe, expect, it } from 'vitest';
import { getItem } from '../catalog';
import { hashAssetId } from '../model/assets';
import { deepEqual } from '../model/commands';
import { createLayout } from '../model/layout';
import { createObject } from '../model/ops';
import { testRoom } from '../model/testRoom';
import type { Layout } from '../model/types';
import { repository } from './index';
import { MemoryRepository, RepositoryError } from './repository';
import type { LayoutRepository } from './repository';

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

describe('RepositoryError', () => {
  it('несёт код и остаётся Error', () => {
    const error = new RepositoryError('quota', 'Нет места');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error.code).toBe('quota');
    expect(error.message).toBe('Нет места');
    expect(error.name).toBe('RepositoryError');
    expect(new RepositoryError('unavailable').code).toBe('unavailable');
  });
});

describe('MemoryRepository — макеты', () => {
  it('save → load возвращает deep-равный макет, но не ту же ссылку', async () => {
    const repo = new MemoryRepository();
    const layout = layoutAt('Свадьба', 1000);
    layout.objects.push(createObject(getItem('box'), { kind: 'floor', x: 1, z: 1, lift: 0 }));
    await repo.save(layout);

    const loaded = await repo.load(layout.id);
    expect(loaded).not.toBeNull();
    expect(loaded).not.toBe(layout);
    expect(deepEqual(loaded, JSON.parse(JSON.stringify(layout)))).toBe(true);

    // Правка загруженной копии или исходного объекта не меняет сохранённое.
    loaded!.name = 'Испорчено';
    layout.name = 'Тоже испорчено';
    expect((await repo.load(layout.id))?.name).toBe('Свадьба');
  });

  it('load неизвестного id → null', async () => {
    expect(await new MemoryRepository().load('no-such-layout')).toBeNull();
  });

  it('save перезаписывает макет с тем же id', async () => {
    const repo = new MemoryRepository();
    const layout = layoutAt('Первое имя', 1000);
    await repo.save(layout);
    await repo.save({ ...layout, name: 'Второе имя', updatedAt: 2000 });

    expect(await repo.list()).toEqual([{ id: layout.id, name: 'Второе имя', roomId: testRoom.id, updatedAt: 2000 }]);
    expect((await repo.load(layout.id))?.name).toBe('Второе имя');
  });

  it('list: новые первыми, с фильтром по помещению и без', async () => {
    const repo = new MemoryRepository();
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

  it('remove удаляет макет, не трогая остальные и файлы', async () => {
    const repo = new MemoryRepository();
    const a = layoutAt('А', 1000);
    const b = layoutAt('Б', 2000);
    await repo.save(a);
    await repo.save(b);
    const asset = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });

    await repo.remove(a.id);
    await repo.remove('no-such-layout');

    expect(await repo.load(a.id)).toBeNull();
    expect((await repo.list()).map((m) => m.id)).toEqual([b.id]);
    expect(await repo.getAsset(asset.id)).not.toBeNull();
  });

  it('нечитаемый макет: load → RepositoryError("corrupt"), запись не удаляется и не попадает в список', async () => {
    const repo = new MemoryRepository();
    const good = layoutAt('Хороший', 1000);
    // Такой roomId parseLayout не принимает: запись сохранена, но прочитать её нельзя.
    const broken = layoutAt('Битый', 2000, 'room id with spaces');
    await repo.save(good);
    await repo.save(broken);

    const error = await rejection(repo.load(broken.id));
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('corrupt');
    expect((await repo.list()).map((m) => m.id)).toEqual([good.id]);

    // Запись на месте: её можно перезаписать исправленным макетом.
    expect(await rejection(repo.load(broken.id))).toBeInstanceOf(RepositoryError);
    await repo.save({ ...broken, roomId: testRoom.id });
    expect((await repo.load(broken.id))?.name).toBe('Битый');
  });

  it('экземпляры независимы', async () => {
    const one = new MemoryRepository();
    const two = new MemoryRepository();
    await one.save(layoutAt('Только в первом', 1000));
    expect(await two.list()).toEqual([]);
  });
});

describe('MemoryRepository — файлы', () => {
  it('putAsset content-addressed: id = hashAssetId(байты), mime по сигнатуре', async () => {
    const repo = new MemoryRepository();
    const blob = new Blob([bytes(...PNG_HEAD, 1, 2, 3)], { type: 'text/plain' });
    const meta = await repo.putAsset(blob, { kind: 'image', name: 'плакат.png', width: 640, height: 480 });

    expect(meta.id).toBe(await hashAssetId(await blob.arrayBuffer()));
    expect(meta.id).toMatch(/^a_[0-9a-f]{32}$/);
    expect(meta).toMatchObject({ kind: 'image', name: 'плакат.png', mime: 'image/png', bytes: 11, width: 640, height: 480 });
    expect(meta.naturalSize).toBeUndefined();

    const stored = await repo.getAsset(meta.id);
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe('image/png');
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([...PNG_HEAD, 1, 2, 3]);
  });

  it('putAsset идемпотентен: одинаковые байты → один id и одна запись', async () => {
    const repo = new MemoryRepository();
    const first = await repo.putAsset(png(7, 7), { kind: 'image', name: 'первый.png', width: 10, height: 20 });
    const again = await repo.putAsset(png(7, 7), { kind: 'image', name: 'второй.png', width: 99, height: 99 });
    const other = await repo.putAsset(png(7, 8), { kind: 'image', name: 'другой.png' });

    expect(again).toEqual(first);
    expect(other.id).not.toBe(first.id);
    expect((await repo.listAssets()).map((m) => m.id).sort()).toEqual([first.id, other.id].sort());
  });

  it('модель: mime GLB и naturalSize', async () => {
    const repo = new MemoryRepository();
    const meta = await repo.putAsset(glb(9), { kind: 'model', name: 'сова.glb', naturalSize: [1, 2, 3] });
    expect(meta).toMatchObject({ kind: 'model', mime: 'model/gltf-binary', naturalSize: [1, 2, 3] });
    expect(meta.width).toBeUndefined();
  });

  it('неизвестное содержимое → RepositoryError("corrupt"), ничего не сохраняется', async () => {
    const repo = new MemoryRepository();
    const garbage = await rejection(repo.putAsset(new Blob(['<svg></svg>']), { kind: 'image', name: 'x.svg' }));
    expect(garbage).toBeInstanceOf(RepositoryError);
    expect((garbage as RepositoryError).code).toBe('corrupt');
    expect(await repo.listAssets()).toEqual([]);
  });

  it('«corrupt» — только неизвестный mime: вид из info не сверяется с содержимым (контракт 2.18)', async () => {
    const repo = new MemoryRepository();
    const meta = await repo.putAsset(png(1), { kind: 'model', name: 'x.glb' });
    // kind — как передан, mime — по сигнатуре байтов.
    expect(meta).toMatchObject({ kind: 'model', mime: 'image/png' });
    expect((await repo.getAsset(meta.id))?.type).toBe('image/png');
  });

  it('имя файла обрезается до 120 символов', async () => {
    const meta = await new MemoryRepository().putAsset(png(1), { kind: 'image', name: 'я'.repeat(300) });
    expect(meta.name).toHaveLength(120);
  });

  it('getAsset неизвестного id → null; removeAsset удаляет только свой файл', async () => {
    const repo = new MemoryRepository();
    const a = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });
    const b = await repo.putAsset(png(2), { kind: 'image', name: 'b.png' });
    expect(await repo.getAsset(`a_${'0'.repeat(32)}`)).toBeNull();

    await repo.removeAsset(a.id);
    await repo.removeAsset('no-such-asset');
    expect(await repo.getAsset(a.id)).toBeNull();
    expect((await repo.listAssets()).map((m) => m.id)).toEqual([b.id]);
  });

  it('listAssets отдаёт копии метаданных', async () => {
    const repo = new MemoryRepository();
    const meta = await repo.putAsset(png(1), { kind: 'image', name: 'a.png' });
    const [listed] = await repo.listAssets();
    expect(listed).toEqual(meta);
    listed.name = 'испорчено';
    expect((await repo.listAssets())[0].name).toBe('a.png');
  });
});

describe('заглушка фундамента', () => {
  // Проверяется только поведение: тело index.ts перепишет W4 (в Node, без хранилищ браузера, это снова память).
  it('repository реализует LayoutRepository: макет сохраняется, читается и удаляется', async () => {
    const repo: LayoutRepository = repository;
    const layout = layoutAt('Через заглушку', 1000);
    await repo.save(layout);
    expect((await repo.load(layout.id))?.name).toBe('Через заглушку');
    await repo.remove(layout.id);
    expect(await repo.load(layout.id)).toBeNull();
  });
});
