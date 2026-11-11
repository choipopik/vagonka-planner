// Материалы и текстуры создаются без WebGL — их свойства проверяются в Node.
import {
  AdditiveBlending,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  NormalBlending,
  SRGBColorSpace,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Part } from '../../catalog/types';
import { GHOST_OPACITY } from '../../model/layers';
import { CUTOUT_ALPHA, GHOST_RENDER_ORDER, getMaterial } from './materialCache';
import { TEXTURE_CACHE_SIZE, getTexture } from './textureCache';

function part(over: Partial<Part> = {}): Part {
  return { shape: 'box', position: [0, 0, 0], size: [1, 1, 1], color: '#808080', ...over };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getMaterial: вид материала', () => {
  it('lit (по умолчанию) — MeshStandardMaterial с умолчаниями 0.85 / 0', () => {
    const material = getMaterial(part(), false);
    expect(material).toBeInstanceOf(MeshStandardMaterial);
    const standard = material as MeshStandardMaterial;
    expect(standard.roughness).toBe(0.85);
    expect(standard.metalness).toBe(0);
    expect(standard.emissive.getHex()).toBe(0x000000);
    expect(standard.transparent).toBe(false);
    expect(standard.opacity).toBe(1);
    expect(standard.side).toBe(FrontSide);
    expect(standard.depthWrite).toBe(true);
    expect(standard.blending).toBe(NormalBlending);
    expect(standard.alphaTest).toBe(0);
    expect(standard.map).toBeNull();
  });

  it('цвет части в материал не входит: материал белый, цвет идёт в instanceColor', () => {
    const red = getMaterial(part({ color: '#ff0000' }), false) as MeshStandardMaterial;
    const blue = getMaterial(part({ color: '#0000ff' }), false);
    expect(red).toBe(blue);
    expect(red.color.getHex()).toBe(0xffffff);
  });

  it('lit с emissive, roughness, metalness', () => {
    const material = getMaterial(part({ emissive: '#ff8800', emissiveIntensity: 2, roughness: 0.3, metalness: 0.7 }), false) as MeshStandardMaterial;
    expect(material.emissive.getHexString()).toBe('ff8800');
    expect(material.emissiveIntensity).toBe(2);
    expect(material.roughness).toBe(0.3);
    expect(material.metalness).toBe(0.7);
  });

  it('glow — MeshBasicMaterial без тонмаппинга', () => {
    const material = getMaterial(part({ look: 'glow' }), false);
    expect(material).toBeInstanceOf(MeshBasicMaterial);
    expect(material.toneMapped).toBe(false);
  });

  it('matcap — MeshMatcapMaterial, paint идёт в matcap, а не в map', () => {
    const paint = { painter: 'test.materialCache.matcap', px: [64, 64] as [number, number] };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const material = getMaterial(part({ shape: 'sphere', look: 'matcap', paint }), false);
    expect(material).toBeInstanceOf(MeshMatcapMaterial);
    const matcap = material as MeshMatcapMaterial;
    expect(matcap.matcap).toBe(getTexture(paint));
    expect(matcap.map).toBeNull();
  });

  it('paint у lit и glow идёт в map', () => {
    const paint = { painter: 'test.materialCache.map', px: [32, 32] as [number, number] };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((getMaterial(part({ paint }), false) as MeshStandardMaterial).map).toBe(getTexture(paint));
    expect((getMaterial(part({ paint, look: 'glow' }), false) as MeshBasicMaterial).map).toBe(getTexture(paint));
  });

  it('opacity < 1 → прозрачный материал', () => {
    const material = getMaterial(part({ opacity: 0.4 }), false);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.4);
    expect(material.depthWrite).toBe(true);
  });

  it('additive → AdditiveBlending, без записи глубины', () => {
    const material = getMaterial(part({ look: 'glow', additive: true, opacity: 0.25 }), false);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.25);
  });

  it('doubleSided → DoubleSide; cutout → alphaTest 0.5', () => {
    expect(getMaterial(part({ doubleSided: true }), false).side).toBe(DoubleSide);
    expect(CUTOUT_ALPHA).toBe(0.5);
    expect(getMaterial(part({ cutout: true }), false).alphaTest).toBe(0.5);
  });
});

describe('getMaterial: призрак', () => {
  it('тот же материал, но прозрачный на 30 %, двусторонний, без записи глубины', () => {
    const solid = getMaterial(part({ roughness: 0.4 }), false) as MeshStandardMaterial;
    const ghost = getMaterial(part({ roughness: 0.4 }), true) as MeshStandardMaterial;
    expect(ghost).not.toBe(solid);
    expect(ghost).toBeInstanceOf(MeshStandardMaterial);
    expect(ghost.roughness).toBe(0.4);
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBeCloseTo(GHOST_OPACITY, 9);
    expect(ghost.depthWrite).toBe(false);
    expect(ghost.side).toBe(DoubleSide);
    // Сплошной вариант при этом не изменился.
    expect(solid.transparent).toBe(false);
    expect(solid.opacity).toBe(1);
    expect(solid.side).toBe(FrontSide);
  });

  it('двусторонний всегда — и для односторонних листов', () => {
    for (const over of [{}, { doubleSided: false }, { look: 'glow' as const }, { look: 'matcap' as const }]) {
      expect(getMaterial(part(over), true).side).toBe(DoubleSide);
    }
  });

  it('opacity части умножается на GHOST_OPACITY', () => {
    expect(getMaterial(part({ opacity: 0.5 }), true).opacity).toBeCloseTo(0.5 * GHOST_OPACITY, 9);
  });

  it('порог cutout масштабируется вместе с прозрачностью призрака', () => {
    expect(getMaterial(part({ cutout: true }), true).alphaTest).toBeCloseTo(CUTOUT_ALPHA * GHOST_OPACITY, 9);
  });

  it('призраки рисуются после сплошных', () => {
    expect(GHOST_RENDER_ORDER).toBeGreaterThan(0);
  });
});

describe('getMaterial: общий кэш', () => {
  it('один materialKey — один материал для всех объектов', () => {
    const a = getMaterial(part({ position: [1, 2, 3], size: [3, 2, 1], color: '#123456' }), false);
    const b = getMaterial(part({ shape: 'cylinder', rotation: [0, 1, 0] }), false);
    expect(a).toBe(b);
    expect(getMaterial(part({ roughness: 0.85 }), false)).toBe(a);
  });

  it('разные поля материала — разные материалы', () => {
    const base = getMaterial(part(), false);
    expect(getMaterial(part({ roughness: 0.2 }), false)).not.toBe(base);
    expect(getMaterial(part({ look: 'glow' }), false)).not.toBe(base);
    expect(getMaterial(part(), true)).not.toBe(base);
  });
});

describe('getTexture', () => {
  it('неизвестный painter → однотонная sRGB-текстура и одно предупреждение', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const paint = { painter: 'test.unknownPainter', px: [128, 64] as [number, number] };
    const texture = getTexture(paint);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    const image = texture.image as { width: number; height: number; data: Uint8Array };
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(Array.from(image.data)).toEqual([255, 255, 255, 255]);
    // Тот же painter с другими аргументами — другая текстура, но предупреждение уже было.
    getTexture({ ...paint, args: { text: 'другое' } });
    getTexture({ ...paint, px: [64, 64] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('test.unknownPainter');
  });

  it('одинаковые painter + args + px → один объект', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = getTexture({ painter: 'test.same', args: { text: 'A', n: 1 }, px: [64, 64] });
    const b = getTexture({ painter: 'test.same', args: { text: 'A', n: 1 }, px: [64, 64] });
    expect(a).toBe(b);
    expect(getTexture({ painter: 'test.same', args: { text: 'B', n: 1 }, px: [64, 64] })).not.toBe(a);
    expect(getTexture({ painter: 'test.same', args: { text: 'A', n: 1 }, px: [32, 64] })).not.toBe(a);
  });

  it('LRU на 96 записей: вытесненная текстура освобождается', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(TEXTURE_CACHE_SIZE).toBe(96);
    const paint = (i: number) => ({ painter: 'test.lru', args: { text: `строка ${i}` }, px: [16, 16] as [number, number] });
    const first = getTexture(paint(0));
    const disposed = vi.fn();
    first.addEventListener('dispose', disposed);
    for (let i = 1; i < TEXTURE_CACHE_SIZE; i++) getTexture(paint(i));
    // Кэш полон, но первая запись ещё в нём (обращение делает её самой свежей).
    expect(getTexture(paint(0))).toBe(first);
    expect(disposed).not.toHaveBeenCalled();
    // Ещё 96 новых записей вытесняют все прежние.
    for (let i = TEXTURE_CACHE_SIZE; i < 2 * TEXTURE_CACHE_SIZE; i++) getTexture(paint(i));
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(getTexture(paint(0))).not.toBe(first);
  });

  it('материалы с paint тоже не копятся: вытесненный материал освобождается', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const painted = (i: number) => part({ paint: { painter: 'test.materialLru', args: { text: `надпись ${i}` }, px: [16, 16] } });
    const first = getMaterial(painted(0), false);
    const disposed = vi.fn();
    first.addEventListener('dispose', disposed);
    for (let i = 1; i <= TEXTURE_CACHE_SIZE; i++) getMaterial(painted(i), false);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(getMaterial(painted(0), false)).not.toBe(first);
  });
});
