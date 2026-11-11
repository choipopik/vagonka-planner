// Разбор GLB / самодостаточного .gltf: один GLTFLoader на приложение, сеть заблокирована, Draco не подключён,
// Meshopt — встроенным декодером. Геометрия разбирается и без WebGL, поэтому модуль тестируется в Node.
import { Box3, LoadingManager, Vector3 } from 'three';
import type { Material, Object3D, Texture } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Vec3 } from '../model/types';

/** Что нужно знать о разобранной модели, чтобы вписать её в габарит объекта. */
export interface ModelBounds {
  /** Габариты как в файле, м. */
  size: Vec3;
  /** Центр основания габаритного бокса в координатах модели: [cx, minY, cz]. */
  base: Vec3;
}

export interface ParsedModel {
  scene: Object3D;
  bounds: ModelBounds;
  triangles: number;
}

/** URL, по которому заведомо ничего не загрузится и никуда не уйдёт запрос. */
const INERT_URL = 'data:,';

/**
 * Модификатор URL менеджера загрузки: всё, кроме blob: и data:, заменяется пустышкой. inspectGltf уже отклонил
 * внешние uri буферов и картинок; это вторая линия защиты — из модели нельзя сходить в сеть.
 */
export function offlineUrl(url: string): string {
  return /^(blob|data):/i.test(url) ? url : INERT_URL;
}

let loader: GLTFLoader | undefined;

function getLoader(): GLTFLoader {
  if (!loader) {
    const manager = new LoadingManager();
    manager.setURLModifier(offlineUrl);
    loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

function isRenderable(object: Object3D): object is Object3D & { geometry: { dispose(): void }; material: Material | Material[] } {
  return 'geometry' in object && 'material' in object;
}

/** Число треугольников во всех мешах (линии и точки не считаются). */
export function countTriangles(root: Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    const mesh = object as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } } };
    if (mesh.isMesh !== true || !mesh.geometry) return;
    const count = mesh.geometry.index ? mesh.geometry.index.count : (mesh.geometry.attributes.position?.count ?? 0);
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

/** Габариты модели (Box3().setFromObject) и центр основания. Бросает Error, если в модели нечего рисовать. */
export function measureModel(root: Object3D): ModelBounds {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const numbers = [size.x, size.y, size.z, center.x, box.min.y, center.z];
  if (box.isEmpty() || !numbers.every(Number.isFinite)) throw new Error('В модели нет геометрии');
  return { size: [size.x, size.y, size.z], base: [center.x, box.min.y, center.z] };
}

/**
 * Убирает из модели источники света и камеры (KHR_lights_punctual, камеры экспорта): свет в зале дают только
 * объекты-лампы в пределах MAX_LIGHTS, а лишние источники ещё и перекомпилировали бы шейдеры.
 */
export function stripLightsAndCameras(root: Object3D): void {
  const extra: Object3D[] = [];
  root.traverse((object) => {
    const flags = object as { isLight?: boolean; isCamera?: boolean };
    if (flags.isLight === true || flags.isCamera === true) extra.push(object);
  });
  for (const object of extra) object.removeFromParent();
}

/**
 * Разбирает .glb или текстовый .gltf одним и тем же вызовом parseAsync(buffer, '') — загрузчик сам различает их по
 * сигнатуре 'glTF'. Вызывать только после inspectGltf(buffer).ok. Анимации игнорируются.
 */
export async function parseModel(buffer: ArrayBuffer): Promise<ParsedModel> {
  const gltf = await getLoader().parseAsync(buffer, '');
  const scene: Object3D | undefined = gltf.scene ?? gltf.scenes[0];
  if (!scene) throw new Error('В модели нет сцены');
  stripLightsAndCameras(scene);
  try {
    return { scene, bounds: measureModel(scene), triangles: countTriangles(scene) };
  } catch (error) {
    disposeModel(scene);
    throw error;
  }
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    const texture = value as Partial<Texture> | null | undefined;
    if (texture && typeof texture === 'object' && texture.isTexture === true) {
      // ImageBitmap сам память не отдаёт.
      const image = texture.image as { close?: () => void } | null | undefined;
      texture.dispose?.();
      if (image && typeof image.close === 'function') image.close();
    }
  }
  material.dispose();
}

/** Освобождает геометрии, материалы и текстуры разобранной модели (клоны делят их с оригиналом). */
export function disposeModel(root: Object3D): void {
  root.traverse((object) => {
    if (!isRenderable(object)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material) disposeMaterial(material);
  });
}
