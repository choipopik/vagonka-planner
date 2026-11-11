// Разбор моделей без WebGL: GLTFLoader.parseAsync работает в Node, пока в модели нет текстур.
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PointLight } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectGltf } from './gltf';
import { countTriangles, disposeModel, measureModel, offlineUrl, parseModel, stripLightsAndCameras } from './modelLoader';
import { TRIANGLES_BASE, TRIANGLES_COUNT, TRIANGLES_SIZE, glb, gltfText, triangleGltf } from './testModels';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** В Node нет ProgressEvent, которым FileLoader из three сообщает о ходе чтения data:-буфера; в браузере он есть. */
function stubProgressEvent(): void {
  if (typeof ProgressEvent !== 'undefined') return;
  vi.stubGlobal(
    'ProgressEvent',
    class {
      readonly type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
}

function expectVec(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
}

describe('offlineUrl', () => {
  it('пропускает только blob: и data:', () => {
    expect(offlineUrl('blob:http://localhost/1234')).toBe('blob:http://localhost/1234');
    expect(offlineUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(offlineUrl('DATA:application/octet-stream;base64,AAAA')).toBe('DATA:application/octet-stream;base64,AAAA');
  });

  it('любой другой адрес заменяет пустышкой, с которой некуда сходить', () => {
    for (const url of ['https://example.com/a.bin', 'http://example.com/a.png', '//example.com/a.png', 'scene.bin', './tex/wood.png', '/abs.bin', 'file:///etc/passwd', '']) {
      const safe = offlineUrl(url);
      expect(safe).toBe('data:,');
      expect(safe).not.toContain('example.com');
    }
  });
});

describe('parseModel', () => {
  it('разбирает GLB с BIN-чанком: габариты, центр основания, число треугольников', async () => {
    const { json, bin } = triangleGltf('bin');
    const buffer = glb(json, bin);
    expect(inspectGltf(buffer).ok).toBe(true);
    const model = await parseModel(buffer);
    expectVec(model.bounds.size, TRIANGLES_SIZE);
    expectVec(model.bounds.base, TRIANGLES_BASE);
    expect(model.triangles).toBe(TRIANGLES_COUNT);
    expect(model.scene.children.length).toBeGreaterThan(0);
    disposeModel(model.scene);
  });

  it('разбирает текстовый .gltf с data:-буфером тем же вызовом', async () => {
    stubProgressEvent();
    const { json } = triangleGltf('data');
    const buffer = gltfText(json);
    expect(inspectGltf(buffer).ok).toBe(true);
    const model = await parseModel(buffer);
    expectVec(model.bounds.size, TRIANGLES_SIZE);
    expectVec(model.bounds.base, TRIANGLES_BASE);
    expect(model.triangles).toBe(TRIANGLES_COUNT);
    disposeModel(model.scene);
  });

  it('не обращается к сети', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { json, bin } = triangleGltf('bin');
    const model = await parseModel(glb(json, bin));
    disposeModel(model.scene);
    for (const call of fetchSpy.mock.calls) {
      const target = call[0];
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      expect(url).toMatch(/^(data|blob):/);
    }
  });

  it('источники света и камеры из модели выбрасываются', async () => {
    const { json, bin } = triangleGltf('bin', { extras: true });
    const model = await parseModel(glb(json, bin));
    let lights = 0;
    let cameras = 0;
    model.scene.traverse((object) => {
      const flags = object as { isLight?: boolean; isCamera?: boolean };
      if (flags.isLight) lights += 1;
      if (flags.isCamera) cameras += 1;
    });
    expect(lights).toBe(0);
    expect(cameras).toBe(0);
    // Габариты считаются по геометрии, а не по разбросанным вокруг лампам и камерам.
    expectVec(model.bounds.size, TRIANGLES_SIZE);
    disposeModel(model.scene);
  });

  it('модель без геометрии → ошибка с русским текстом', async () => {
    const empty = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
    await expect(parseModel(empty)).rejects.toThrow('В модели нет геометрии');
  });

  it('модель без сцены → ошибка', async () => {
    await expect(parseModel(glb({ asset: { version: '2.0' } }))).rejects.toThrow();
  });

  it('битые данные → отклонённый промис, а не исключение мимо try/catch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { json } = triangleGltf('bin');
    // Буфер без BIN-чанка и без uri: геометрию взять неоткуда.
    await expect(parseModel(glb(json))).rejects.toBeDefined();
    await expect(parseModel(new TextEncoder().encode('не модель').buffer as ArrayBuffer)).rejects.toBeDefined();
  });
});

describe('measureModel / countTriangles / stripLightsAndCameras / disposeModel', () => {
  function sample(): { root: Group; box: Mesh; plain: Mesh } {
    const root = new Group();
    const box = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
    box.position.set(1, 2, 0);
    const plain = new Mesh(new BoxGeometry(1, 1, 1).toNonIndexed(), new MeshBasicMaterial());
    plain.position.set(-3, 0.5, 0);
    root.add(box, plain);
    return { root, box, plain };
  }

  it('габариты учитывают положение узлов; base — центр основания', () => {
    const { root } = sample();
    const bounds = measureModel(root);
    // X: от −3.5 до 2; Y: от 0 до 4; Z: от −3 до 3.
    expectVec(bounds.size, [5.5, 4, 6]);
    expectVec(bounds.base, [-0.75, 0, 0]);
  });

  it('пустая группа → ошибка', () => {
    expect(() => measureModel(new Group())).toThrow('В модели нет геометрии');
  });

  it('треугольники считаются и по индексу, и без него', () => {
    const { root } = sample();
    expect(countTriangles(root)).toBe(12 + 12);
    expect(countTriangles(new Group())).toBe(0);
  });

  it('stripLightsAndCameras убирает вложенные лампы и камеры, меши остаются', () => {
    const { root, box } = sample();
    const inner = new Group();
    inner.add(new PointLight(), new PerspectiveCamera());
    box.add(inner);
    root.add(new PointLight());
    stripLightsAndCameras(root);
    const kinds: string[] = [];
    root.traverse((object) => kinds.push(object.type));
    expect(kinds).not.toContain('PointLight');
    expect(kinds).not.toContain('PerspectiveCamera');
    expect(kinds.filter((type) => type === 'Mesh')).toHaveLength(2);
  });

  it('disposeModel освобождает геометрии и материалы (в том числе массив материалов)', () => {
    const { root, box, plain } = sample();
    const extra = new MeshBasicMaterial();
    plain.material = [plain.material as MeshBasicMaterial, extra];
    const disposed: string[] = [];
    box.geometry.addEventListener('dispose', () => disposed.push('box-geometry'));
    (box.material as MeshBasicMaterial).addEventListener('dispose', () => disposed.push('box-material'));
    plain.geometry.addEventListener('dispose', () => disposed.push('plain-geometry'));
    extra.addEventListener('dispose', () => disposed.push('extra-material'));
    disposeModel(root);
    expect(disposed.sort()).toEqual(['box-geometry', 'box-material', 'extra-material', 'plain-geometry']);
  });
});
