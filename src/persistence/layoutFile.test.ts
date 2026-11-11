import { describe, expect, it } from 'vitest';
import { getItem } from '../catalog';
import { ASSET_LIMITS, hashAssetId } from '../model/assets';
import { deepEqual } from '../model/commands';
import { createLayout } from '../model/layout';
import { LayoutFormatError } from '../model/migrate';
import { createObject } from '../model/ops';
import { testRoom } from '../model/testRoom';
import { SCHEMA_VERSION } from '../model/types';
import type { Layout, SceneObject } from '../model/types';
import { base64ToBytes, buildLayoutFile, bytesToBase64, layoutFileName, readLayoutFile } from './layoutFile';
import type { LayoutFile } from './layoutFile';
import { MemoryRepository, RepositoryError } from './repository';
import type { LayoutRepository } from './repository';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length);
  out.set(values);
  return out;
}
const pngBytes = (...tail: number[]) => bytes(...PNG_HEAD, ...tail);
const png = (...tail: number[]) => new Blob([pngBytes(...tail)]);
const glb = (...tail: number[]) => new Blob([bytes(0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, ...tail)]);

/** Эталон: независимая от проверяемого кода сборка двоичной строки по одному байту. */
function referenceBase64(source: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < source.length; i += 1024) {
    let chunk = '';
    for (let j = i; j < Math.min(source.length, i + 1024); j++) chunk += String.fromCharCode(source[j]);
    parts.push(chunk);
  }
  return btoa(parts.join(''));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const ROOM_IDS = [testRoom.id];
const roomOf = (roomId: string) => (roomId === testRoom.id ? testRoom : undefined);
const importFile = (text: string, repo: LayoutRepository) => readLayoutFile(text, repo, ROOM_IDS, roomOf);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('ожидалась ошибка');
}

function imageObject(assetId: string, x = 3): SceneObject {
  return createObject(getItem('image'), { kind: 'floor', x, z: 1, lift: 0 }, { assetId, name: 'Плакат' });
}

/** Макет тестового помещения: мебель площадки + ящик, плакат на стене и картинка с файлом. */
async function sample(repo: LayoutRepository): Promise<{ layout: Layout; used: string; unused: string }> {
  const used = await repo.putAsset(png(1, 2, 3), { kind: 'image', name: 'плакат.png', width: 640, height: 480 });
  const unused = await repo.putAsset(png(9, 9, 9), { kind: 'image', name: 'лишний.png' });
  const layout = createLayout(testRoom, 'Вечеринка');
  layout.objects.push(
    createObject(getItem('box'), { kind: 'floor', x: 3, z: -1, lift: 0 }, { color: '#112233' }),
    createObject(getItem('panel'), { kind: 'wall', surfaceId: 'far', along: 7, bottom: 1.2 }),
    createObject(getItem('light.spot'), { kind: 'ceiling', x: 1, z: 1, drop: 0 }),
    imageObject(used.id),
  );
  await repo.save(layout);
  return { layout, used: used.id, unused: unused.id };
}

describe('base64', () => {
  it('туда-обратно на коротких буферах всех длин по модулю 3', () => {
    for (let length = 0; length <= 10; length++) {
      const source = new Uint8Array(length).map((_, i) => (i * 37 + 250) & 0xff);
      const text = bytesToBase64(source);
      expect(text).toBe(referenceBase64(source));
      expect([...base64ToBytes(text)]).toEqual([...source]);
    }
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('')).toHaveLength(0);
  });

  it('все значения байта', () => {
    const source = new Uint8Array(256).map((_, i) => i);
    expect([...base64ToBytes(bytesToBase64(source))]).toEqual([...source]);
  });

  it('большой буфер: без переполнения стека, совпадает с эталоном', () => {
    // 5 МБ + 1 байт: много кусков кодирования и неполный хвост.
    const source = new Uint8Array(5 * 1_048_576 + 1);
    let seed = 12345;
    for (let i = 0; i < source.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      source[i] = seed >>> 16;
    }
    const text = bytesToBase64(source);
    expect(text === referenceBase64(source)).toBe(true);
    const back = base64ToBytes(text);
    expect(back.length).toBe(source.length);
    expect(sameBytes(back, source)).toBe(true);
  });

  it('base64ToBytes бросает на неверном входе', () => {
    for (const bad of ['A', 'AB', 'ABC', 'AB=C', '=AAA', 'A===', 'AAA*', 'AA AA', 'AAAA\n', 'AAAA=', 'АБВГ', 'AA==AAAA', 'data:image/png;base64,AAAA']) {
      expect(() => base64ToBytes(bad), bad).toThrow();
    }
  });
});

describe('buildLayoutFile', () => {
  it('шапка формата и копия макета', async () => {
    const repo = new MemoryRepository();
    const { layout } = await sample(repo);
    const file = await buildLayoutFile(layout, repo);

    expect(file.format).toBe('vagonka-layout');
    expect(file.version).toBe(1);
    expect(new Date(file.exportedAt).toISOString()).toBe(file.exportedAt);
    expect(file.layout).toEqual(layout);
    expect(file.layout).not.toBe(layout);
    expect(file.layout.objects).not.toBe(layout.objects);
  });

  it('в файл попадают только файлы, на которые ссылаются объекты', async () => {
    const repo = new MemoryRepository();
    const { layout, used, unused } = await sample(repo);
    const file = await buildLayoutFile(layout, repo);

    expect(file.assets.map((a) => a.meta.id)).toEqual([used]);
    expect(file.assets.some((a) => a.meta.id === unused)).toBe(false);
    expect(file.assets[0].meta).toMatchObject({ kind: 'image', name: 'плакат.png', mime: 'image/png', width: 640, height: 480 });
    expect([...base64ToBytes(file.assets[0].base64)]).toEqual([...pngBytes(1, 2, 3)]);
  });

  it('файл, на который ссылаются несколько объектов, вкладывается один раз; пропавший файл пропускается', async () => {
    const repo = new MemoryRepository();
    const { layout, used } = await sample(repo);
    const gone = await repo.putAsset(png(4, 4), { kind: 'image', name: 'пропал.png' });
    layout.objects.push(imageObject(used, 2), imageObject(gone.id, 4));
    await repo.removeAsset(gone.id);

    const file = await buildLayoutFile(layout, repo);
    expect(file.assets.map((a) => a.meta.id)).toEqual([used]);
  });

  it('макет без файлов: список вложений пуст; результат сериализуется в JSON', async () => {
    const repo = new MemoryRepository();
    const file = await buildLayoutFile(createLayout(testRoom, 'Пустой'), repo);
    expect(file.assets).toEqual([]);
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });
});

describe('readLayoutFile — экспорт → импорт', () => {
  it('объекты равны, id файлов сохранены, id макета новый, макет сохранён в репозитории', async () => {
    const source = new MemoryRepository();
    const { layout, used } = await sample(source);
    const text = JSON.stringify(await buildLayoutFile(layout, source));

    const target = new MemoryRepository();
    const result = await importFile(text, target);

    expect(result.warnings).toEqual([]);
    expect(result.layout.id).not.toBe(layout.id);
    expect(result.layout.name).toBe('Вечеринка');
    expect(result.layout.roomId).toBe(testRoom.id);
    expect(result.layout.schemaVersion).toBe(SCHEMA_VERSION);
    expect(deepEqual(result.layout.objects, JSON.parse(JSON.stringify(layout.objects)))).toBe(true);

    // Файл попал в библиотеку под тем же id (id — хеш содержимого) и с теми же байтами.
    expect((await target.listAssets()).map((m) => m.id)).toEqual([used]);
    expect([...new Uint8Array(await (await target.getAsset(used))!.arrayBuffer())]).toEqual([...pngBytes(1, 2, 3)]);
    expect((await target.listAssets())[0]).toMatchObject({ kind: 'image', name: 'плакат.png', mime: 'image/png', width: 640, height: 480 });

    // Макет сохранён как новый.
    expect((await target.list()).map((m) => m.id)).toEqual([result.layout.id]);
    expect(deepEqual(await target.load(result.layout.id), JSON.parse(JSON.stringify(result.layout)))).toBe(true);
  });

  it('импорт в тот же репозиторий всегда создаёт НОВЫЙ макет; имя получает « (импорт)»', async () => {
    const repo = new MemoryRepository();
    const { layout } = await sample(repo);
    const text = JSON.stringify(await buildLayoutFile(layout, repo));

    const first = await importFile(text, repo);
    const second = await importFile(text, repo);

    expect(first.layout.name).toBe('Вечеринка (импорт)');
    expect(second.layout.name).toBe('Вечеринка (импорт 2)');
    expect(new Set([layout.id, first.layout.id, second.layout.id]).size).toBe(3);
    expect((await repo.list()).map((m) => m.name).sort()).toEqual(['Вечеринка', 'Вечеринка (импорт)', 'Вечеринка (импорт 2)'].sort());
    // Исходный макет не тронут; файлы не задвоились.
    expect(deepEqual(await repo.load(layout.id), JSON.parse(JSON.stringify(layout)))).toBe(true);
    expect(await repo.listAssets()).toHaveLength(2);
  });

  it('длинное имя с суффиксом не превышает предела', async () => {
    const repo = new MemoryRepository();
    const layout = createLayout(testRoom, 'я'.repeat(120));
    await repo.save(layout);
    const result = await importFile(JSON.stringify(await buildLayoutFile(layout, repo)), repo);
    expect(result.layout.name).toHaveLength(120);
    expect(result.layout.name.endsWith(' (импорт)')).toBe(true);
  });

  it('модель: вид определяется по содержимому, naturalSize переносится', async () => {
    const source = new MemoryRepository();
    const model = await source.putAsset(glb(1, 2), { kind: 'model', name: 'сова.glb', naturalSize: [0.4, 0.6, 0.3] });
    const layout = createLayout(testRoom, 'С моделью');
    layout.objects.push(createObject(getItem('model'), { kind: 'floor', x: 3, z: 1, lift: 0 }, { assetId: model.id }));
    const text = JSON.stringify(await buildLayoutFile(layout, source));

    const target = new MemoryRepository();
    const result = await importFile(text, target);
    expect(result.warnings).toEqual([]);
    expect(await target.listAssets()).toEqual([
      expect.objectContaining({ id: model.id, kind: 'model', mime: 'model/gltf-binary', name: 'сова.glb', naturalSize: [0.4, 0.6, 0.3] }),
    ]);
  });

  it('импорт v1-файла мигрирует макет', async () => {
    const v1 = {
      format: 'vagonka-layout',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      layout: {
        schemaVersion: 1,
        id: 'stage-one',
        name: 'С первого этапа',
        roomId: testRoom.id,
        updatedAt: 500,
        objects: [
          {
            id: 'obj-1',
            kind: 'primitive',
            type: 'box',
            origin: 'user',
            name: 'Ящик',
            position: [3, 0, 1],
            rotationY: 0.5,
            size: [0.5, 0.5, 0.5],
            color: '#b8b2a7',
            locked: false,
            visible: true,
          },
        ],
      },
      assets: [],
    };
    const repo = new MemoryRepository();
    const result = await importFile(JSON.stringify(v1), repo);

    expect(result.layout.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.layout.id).not.toBe('stage-one');
    const box = result.layout.objects.find((o) => o.id === 'obj-1');
    expect(box).toBeDefined();
    expect(box!.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(box!.rotationY).toBe(0.5);
    expect(box!.assetId).toBeNull();
    expect(box!.params).toEqual({});
    // reconcileVenue добавил мебель площадки, которой в старом файле не было.
    for (const fixture of testRoom.fixtures) expect(result.layout.objects.some((o) => o.id === fixture.id)).toBe(true);
    expect((await repo.load(result.layout.id))?.objects).toHaveLength(1 + testRoom.fixtures.length);
  });

  it('sanitizeLayout: битые крепления и размеры из файла приводятся в порядок', async () => {
    const layout = createLayout(testRoom, 'Кривой');
    const orphan = createObject(getItem('box'), { kind: 'surface', hostId: 'no-such-host', u: 0, v: 0 });
    const poster = createObject(getItem('panel'), { kind: 'wall', surfaceId: 'no-such-wall', along: 1, bottom: 1 });
    layout.objects.push(orphan, poster);
    const file: LayoutFile = { format: 'vagonka-layout', version: 1, exportedAt: new Date().toISOString(), layout, assets: [] };

    const result = await importFile(JSON.stringify(file), new MemoryRepository());
    expect(result.layout.objects.find((o) => o.id === orphan.id)?.mount.kind).toBe('floor');
    expect(result.layout.objects.find((o) => o.id === poster.id)?.mount.kind).toBe('floor');
  });
});

describe('readLayoutFile — отказы', () => {
  async function validText(): Promise<string> {
    const repo = new MemoryRepository();
    const { layout } = await sample(repo);
    return JSON.stringify(await buildLayoutFile(layout, repo));
  }
  async function patched(change: (file: Record<string, unknown>) => void): Promise<string> {
    const file = JSON.parse(await validText()) as Record<string, unknown>;
    change(file);
    return JSON.stringify(file);
  }
  /** Отказ не оставляет в репозитории ни макета, ни файлов. */
  async function expectRefusal(text: string): Promise<LayoutFormatError> {
    const repo = new MemoryRepository();
    const error = await rejection(importFile(text, repo));
    expect(error).toBeInstanceOf(LayoutFormatError);
    expect(await repo.list()).toEqual([]);
    expect(await repo.listAssets()).toEqual([]);
    return error as LayoutFormatError;
  }

  it('не JSON', async () => {
    await expectRefusal('это не JSON');
    await expectRefusal('');
    await expectRefusal('[1, 2, 3]');
    await expectRefusal('null');
  });

  it('неверный format', async () => {
    await expectRefusal(await patched((f) => (f.format = 'other-layout')));
    await expectRefusal(await patched((f) => delete f.format));
    await expectRefusal(await patched((f) => (f.format = ['vagonka-layout'])));
  });

  it('новая версия → «Файл создан более новой версией»', async () => {
    const error = await expectRefusal(await patched((f) => (f.version = 2)));
    expect(error.code).toBe('newer-version');
    expect(error.message).toBe('Файл создан более новой версией');
  });

  it('версия не целое число', async () => {
    await expectRefusal(await patched((f) => (f.version = '1')));
    await expectRefusal(await patched((f) => (f.version = 0.5)));
    await expectRefusal(await patched((f) => (f.version = 0)));
    await expectRefusal(await patched((f) => delete f.version));
  });

  it('макет новее схемы приложения', async () => {
    const error = await expectRefusal(
      await patched((f) => ((f.layout as Record<string, unknown>).schemaVersion = SCHEMA_VERSION + 1)),
    );
    expect(error.code).toBe('newer-version');
  });

  it('неизвестное помещение → ошибка с его id', async () => {
    const error = await expectRefusal(await patched((f) => ((f.layout as Record<string, unknown>).roomId = 'rooftop')));
    expect(error.message).toBe('В файле помещение „rooftop“, которого нет в этой версии');
  });

  it('помещение есть в описаниях, но не в списке допустимых', async () => {
    const repo = new MemoryRepository();
    const error = await rejection(readLayoutFile(await validText(), repo, ['somewhere-else'], roomOf));
    expect(error).toBeInstanceOf(LayoutFormatError);
    expect(await repo.list()).toEqual([]);
  });

  it('структурный мусор вместо макета', async () => {
    await expectRefusal(await patched((f) => (f.layout = 'макет')));
    await expectRefusal(await patched((f) => delete f.layout));
    await expectRefusal(await patched((f) => ((f.layout as Record<string, unknown>).objects = {})));
    await expectRefusal(await patched((f) => ((f.layout as Record<string, unknown>).id = '../../etc/passwd')));
  });

  it('нет места в хранилище → RepositoryError("quota") от repo.save', async () => {
    const inner = new MemoryRepository();
    const full: LayoutRepository = {
      list: (roomId) => inner.list(roomId),
      load: (id) => inner.load(id),
      remove: (id) => inner.remove(id),
      putAsset: (blob, info) => inner.putAsset(blob, info),
      getAsset: (id) => inner.getAsset(id),
      listAssets: () => inner.listAssets(),
      removeAsset: (id) => inner.removeAsset(id),
      save: async () => {
        throw new RepositoryError('quota');
      },
    };
    const error = await rejection(importFile(await validText(), full));
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe('quota');
  });
});

describe('readLayoutFile — файлы и предупреждения', () => {
  /** Файл экспорта с одним объектом-картинкой, ссылающимся на fileId, и заданными вложениями. */
  function fileWith(fileId: string, assets: unknown[], extraObjects: unknown[] = []): string {
    const layout = createLayout(testRoom, 'Импорт');
    const image = imageObject(fileId);
    return JSON.stringify({
      format: 'vagonka-layout',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      layout: { ...layout, objects: [...layout.objects, image, ...extraObjects] },
      assets,
    });
  }
  const imageOf = (layout: Layout) => layout.objects.find((o) => o.kind === 'image');
  const FAKE_ID = `a_${'0'.repeat(32)}`;

  it('id файла пересчитывается из содержимого, ссылки объектов переписываются', async () => {
    const content = pngBytes(5, 6, 7);
    const realId = await hashAssetId(content.buffer);
    const text = fileWith(FAKE_ID, [
      { meta: { id: FAKE_ID, kind: 'image', name: 'подмена.png', mime: 'image/png', bytes: 1, createdAt: 1 }, base64: bytesToBase64(content) },
    ]);

    const repo = new MemoryRepository();
    const result = await importFile(text, repo);
    expect(realId).not.toBe(FAKE_ID);
    expect(imageOf(result.layout)?.assetId).toBe(realId);
    expect((await repo.listAssets()).map((m) => m.id)).toEqual([realId]);
    expect(await repo.getAsset(FAKE_ID)).toBeNull();
    // Размер и время — настоящие, а не заявленные в файле.
    expect((await repo.listAssets())[0].bytes).toBe(content.length);
    expect(result.warnings).toEqual([]);
  });

  it('несовпадение mime → предупреждение; файл принимается с типом по содержимому', async () => {
    const content = pngBytes(1);
    const id = await hashAssetId(content.buffer);
    const text = fileWith(id, [
      { meta: { id, kind: 'model', name: 'якобы.jpg', mime: 'image/jpeg', bytes: 9, createdAt: 1 }, base64: bytesToBase64(content) },
    ]);

    const repo = new MemoryRepository();
    const result = await importFile(text, repo);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('якобы.jpg');
    expect(result.warnings[0]).toContain('image/jpeg');
    expect(result.warnings[0]).toContain('image/png');
    // Вид — тоже по содержимому, а не по заявленному kind.
    expect(await repo.listAssets()).toEqual([expect.objectContaining({ id, kind: 'image', mime: 'image/png' })]);
    expect(imageOf(result.layout)?.assetId).toBe(id);
  });

  it('заявленный mime с разметкой в предупреждение не попадает', async () => {
    const content = pngBytes(1);
    const id = await hashAssetId(content.buffer);
    const text = fileWith(id, [
      { meta: { id, kind: 'image', name: 'x.png', mime: '<img src=x onerror=alert(1)>' }, base64: bytesToBase64(content) },
    ]);
    const result = await importFile(text, new MemoryRepository());
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).not.toContain('<img');
  });

  it('отсутствующий файл → предупреждение, объект остаётся со своей ссылкой', async () => {
    const repo = new MemoryRepository();
    const result = await importFile(fileWith(FAKE_ID, []), repo);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Не найдены файлы');
    expect(imageOf(result.layout)?.assetId).toBe(FAKE_ID);
    expect(await repo.listAssets()).toEqual([]);
    expect((await repo.load(result.layout.id))?.objects.some((o) => o.assetId === FAKE_ID)).toBe(true);
  });

  it('файла нет во вложениях, но он уже лежит в библиотеке под тем же id — предупреждения нет', async () => {
    const repo = new MemoryRepository();
    const existing = await repo.putAsset(png(8, 8), { kind: 'image', name: 'уже есть.png' });
    const result = await importFile(fileWith(existing.id, []), repo);
    expect(result.warnings).toEqual([]);
    expect(imageOf(result.layout)?.assetId).toBe(existing.id);
  });

  it('файл неизвестного формата пропускается с предупреждением', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const text = fileWith(FAKE_ID, [
      { meta: { id: FAKE_ID, kind: 'image', name: 'вектор.svg', mime: 'image/png' }, base64: bytesToBase64(svg) },
    ]);
    const repo = new MemoryRepository();
    const result = await importFile(text, repo);

    expect(await repo.listAssets()).toEqual([]);
    expect(result.warnings.some((w) => w.includes('вектор.svg') && w.includes('неизвестного формата'))).toBe(true);
    // Объект остаётся (рисуется заглушкой) — и об этом тоже сказано.
    expect(imageOf(result.layout)?.assetId).toBe(FAKE_ID);
    expect(result.warnings.some((w) => w.includes('Не найдены файлы'))).toBe(true);
  });

  it('битый base64 и повреждённые записи вложений пропускаются с предупреждениями', async () => {
    const text = fileWith(FAKE_ID, [
      { meta: { id: FAKE_ID, kind: 'image', name: 'битый.png', mime: 'image/png' }, base64: '!!!не base64!!!' },
      'строка вместо записи',
      { meta: { id: 'не id', name: 'x' }, base64: 'AAAA' },
      { meta: null, base64: 'AAAA' },
      { meta: { id: FAKE_ID }, base64: 42 },
    ]);
    const repo = new MemoryRepository();
    const result = await importFile(text, repo);

    expect(await repo.listAssets()).toEqual([]);
    expect(result.warnings.some((w) => w.includes('битый.png') && w.includes('повреждён'))).toBe(true);
    expect(result.warnings.filter((w) => w.startsWith('Вложенный файл №')).length).toBe(4);
    expect((await repo.list()).map((m) => m.id)).toEqual([result.layout.id]);
  });

  it('список вложений не массив → предупреждение, макет импортируется', async () => {
    const file = JSON.parse(fileWith(FAKE_ID, [])) as Record<string, unknown>;
    file.assets = { length: 3 };
    const result = await importFile(JSON.stringify(file), new MemoryRepository());
    expect(result.warnings.some((w) => w.includes('Список вложенных файлов'))).toBe(true);
  });

  it('вложение, на которое не ссылается ни один объект, в библиотеку не попадает', async () => {
    const wanted = pngBytes(1);
    const extra = pngBytes(2);
    const wantedId = await hashAssetId(wanted.buffer);
    const extraId = await hashAssetId(extra.buffer);
    const text = fileWith(wantedId, [
      { meta: { id: extraId, kind: 'image', name: 'лишний.png', mime: 'image/png' }, base64: bytesToBase64(extra) },
      { meta: { id: wantedId, kind: 'image', name: 'нужный.png', mime: 'image/png' }, base64: bytesToBase64(wanted) },
    ]);
    const repo = new MemoryRepository();
    const result = await importFile(text, repo);
    expect((await repo.listAssets()).map((m) => m.id)).toEqual([wantedId]);
    expect(result.warnings).toEqual([]);
  });

  it('слишком большая картинка пропускается с предупреждением', async () => {
    const big = new Uint8Array(ASSET_LIMITS.imageBytes + 1);
    big.set(PNG_HEAD);
    const text = fileWith(FAKE_ID, [
      { meta: { id: FAKE_ID, kind: 'image', name: 'огромная.png', mime: 'image/png' }, base64: bytesToBase64(big) },
    ]);
    const repo = new MemoryRepository();
    const result = await importFile(text, repo);

    expect(await repo.listAssets()).toEqual([]);
    expect(result.warnings.some((w) => w.includes('огромная.png') && w.includes('15 МБ'))).toBe(true);
    expect(imageOf(result.layout)?.assetId).toBe(FAKE_ID);
  });

  it('негодные размеры и длинное имя в метаданных не переносятся как есть', async () => {
    const content = pngBytes(3);
    const id = await hashAssetId(content.buffer);
    const text = fileWith(id, [
      {
        meta: { id, kind: 'image', name: 'я'.repeat(500), mime: 'image/png', width: -5, height: 'много', naturalSize: [1, 2, 3], evil: true },
        base64: bytesToBase64(content),
      },
    ]);
    const repo = new MemoryRepository();
    await importFile(text, repo);
    const [meta] = await repo.listAssets();
    expect(meta.name).toHaveLength(120);
    expect(meta.width).toBeUndefined();
    expect(meta.height).toBeUndefined();
    expect(meta.naturalSize).toBeUndefined();
    expect('evil' in meta).toBe(false);
  });

  it('отброшенные объекты → предупреждение; лишние поля из файла не переносятся', async () => {
    const content = pngBytes(1);
    const id = await hashAssetId(content.buffer);
    const file = JSON.parse(
      fileWith(id, [{ meta: { id, kind: 'image', name: 'a.png', mime: 'image/png' }, base64: bytesToBase64(content) }], [
        { id: 'bad one', kind: 'primitive', type: 'box' },
        'не объект',
      ]),
    ) as { layout: Record<string, unknown> & { objects: Record<string, unknown>[] } };
    file.layout.html = '<script>alert(1)</script>';
    file.layout.objects[0].onload = 'alert(1)';

    const repo = new MemoryRepository();
    const result = await importFile(JSON.stringify(file), repo);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Пропущено объектов с ошибками: 2');
    expect('html' in result.layout).toBe(false);
    expect(result.layout.objects.every((o) => !('onload' in o))).toBe(true);
    expect(result.layout.objects).toHaveLength(testRoom.fixtures.length + 1);
  });
});

describe('layoutFileName', () => {
  it('<room>-<имя>-<yyyy-mm-dd>.vagonka.json', () => {
    expect(layoutFileName('lounge', 'Гарри Поттер', new Date(2026, 10, 11))).toBe('lounge-Гарри-Поттер-2026-11-11.vagonka.json');
    expect(layoutFileName('lounge', 'Макет 1', new Date(2027, 0, 5))).toBe('lounge-Макет-1-2027-01-05.vagonka.json');
  });

  it('запрещённые в именах файлов символы убираются; пустое имя заменяется', () => {
    const name = layoutFileName('lounge', '../..\\a:b*c?"<>|', new Date(2026, 0, 1));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith('-2026-01-01.vagonka.json')).toBe(true);
    expect(layoutFileName('lounge', '   ', new Date(2026, 0, 1))).toBe('lounge-maket-2026-01-01.vagonka.json');
  });
});
