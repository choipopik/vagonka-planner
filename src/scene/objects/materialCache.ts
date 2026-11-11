// Материалы частей каталога, общие для всех объектов: один материал на materialKey(part, ghost).
// Цвет части в материал не входит — он пишется в instanceColor (материал белый).
import {
  AdditiveBlending,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  NormalBlending,
} from 'three';
import type { Material } from 'three';
import type { Part } from '../../catalog/types';
import { GHOST_OPACITY } from '../../model/layers';
import { LruCache } from './lru';
import { materialKey } from './partGroups';
import { TEXTURE_CACHE_SIZE, getTexture } from './textureCache';

/** Сколько материалов без текстуры держит кэш (их число ограничено разнообразием каталога). */
export const MATERIAL_CACHE_SIZE = 512;
/**
 * Материалы с paint живут в отдельном кэше того же размера, что и кэш текстур: материал держит canvas своей
 * текстуры, а текстовые параметры порождают новый paint на каждую правку.
 */
export const PAINTED_MATERIAL_CACHE_SIZE = TEXTURE_CACHE_SIZE;
/** Порог отсечения вырезанных силуэтов по альфа-каналу paint. */
export const CUTOUT_ALPHA = 0.5;
/** renderOrder мешей-призраков: рисуются после сплошных. */
export const GHOST_RENDER_ORDER = 10;

// Вытесненный материал, который ещё на сцене, продолжает работать: three заново соберёт для него программу.
const plain = new LruCache<Material>(MATERIAL_CACHE_SIZE, (material) => material.dispose());
const painted = new LruCache<Material>(PAINTED_MATERIAL_CACHE_SIZE, (material) => material.dispose());

function createMaterial(part: Part, ghost: boolean): Material {
  const look = part.look ?? 'lit';
  const additive = part.additive === true;
  const own = part.opacity ?? 1;
  const base = Number.isFinite(own) ? Math.min(1, Math.max(0, own)) : 1;
  const opacity = ghost ? base * GHOST_OPACITY : base;
  const texture = part.paint ? getTexture(part.paint) : null;

  const common = {
    color: '#ffffff',
    opacity,
    transparent: ghost || additive || base < 1,
    // Призрак двусторонний всегда: односторонний лист (стена газет) со спины иначе не виден вовсе.
    side: ghost || part.doubleSided ? DoubleSide : FrontSide,
    blending: additive ? AdditiveBlending : NormalBlending,
    depthWrite: !(ghost || additive),
    // alphaTest сравнивается с альфой ПОСЛЕ умножения на opacity — порог масштабируется вместе с ней.
    alphaTest: part.cutout ? CUTOUT_ALPHA * opacity : 0,
  };

  if (look === 'glow') {
    return new MeshBasicMaterial({ ...common, map: texture, toneMapped: false });
  }
  if (look === 'matcap') {
    return new MeshMatcapMaterial({ ...common, matcap: texture });
  }
  return new MeshStandardMaterial({
    ...common,
    map: texture,
    roughness: part.roughness ?? 0.85,
    metalness: part.metalness ?? 0,
    emissive: part.emissive ?? '#000000',
    emissiveIntensity: part.emissiveIntensity ?? 1,
  });
}

/**
 * Материал части по materialKey. Вариант ghost — тот же материал, но transparent, opacity × GHOST_OPACITY,
 * depthWrite: false и side: DoubleSide (и для потолочных, и для настенных призраков).
 */
export function getMaterial(part: Part, ghost: boolean): Material {
  const key = materialKey(part, ghost);
  const cache = part.paint ? painted : plain;
  let material = cache.get(key);
  if (!material) {
    material = createMaterial(part, ghost);
    cache.set(key, material);
  }
  return material;
}
