// Чистая подготовка частей каталога к рендеру: ключи геометрии и материала, группы для InstancedMesh, матрицы.
// Ни React, ни DOM; из three — только математика (работает в Node).
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { PaintRef, Part } from '../../catalog/types';

/** Число без шума плавающей точки — для ключей. */
function num(value: number, digits = 3): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : '0';
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Сужение цилиндра для ключа геометрии: два знака, не меньше 0 (0 — конус). */
export function taperOf(part: Part): number {
  const taper = part.taper ?? 1;
  return Number.isFinite(taper) ? Math.max(0, Math.round(taper * 100) / 100) : 1;
}

/** Самое тонкое и самое толстое кольцо, для которых есть единичная геометрия. */
const TORUS_RATIO_MIN = 0.01;
const TORUS_RATIO_MAX = 0.5;

/** Отношение диаметра трубки к внешнему диаметру кольца (t / D), два знака, в пределах [0.01, 0.5]. */
export function torusRatio(part: Part): number {
  const [outer, , tube] = part.size;
  const ratio = outer > 0 && Number.isFinite(tube / outer) ? tube / outer : TORUS_RATIO_MIN;
  return Math.min(TORUS_RATIO_MAX, Math.max(TORUS_RATIO_MIN, Math.round(ratio * 100) / 100));
}

/** Ключ кэша canvas-текстуры: painter + JSON(args) + px (как сказано у PaintRef). */
export function paintKey(paint: PaintRef): string {
  return `${paint.painter}:${JSON.stringify(paint.args ?? {})}:${paint.px[0]}x${paint.px[1]}`;
}

/**
 * 'box' | 'plane' | `cylinder:${taper}` | `torus:${t/D, 2 знака}` |
 * 'sphere' (без paint либо look 'matcap') | 'sphere:uv' (с paint: нужна аккуратная развёртка).
 */
export function geometryKey(part: Part): string {
  switch (part.shape) {
    case 'box':
      return 'box';
    case 'plane':
      return 'plane';
    case 'cylinder':
      return `cylinder:${taperOf(part)}`;
    case 'torus':
      return `torus:${torusRatio(part).toFixed(2)}`;
    case 'sphere':
      return part.paint && part.look !== 'matcap' ? 'sphere:uv' : 'sphere';
  }
}

/**
 * Всё, что влияет на материал, КРОМЕ color (цвет идёт в instanceColor): look, emissive, roughness, opacity, additive,
 * doubleSided, cutout, paint, ghost. Умолчания подставлены: часть с явным `roughness: 0.85` и часть без него дают один ключ.
 */
export function materialKey(part: Part, ghost: boolean): string {
  const look = part.look ?? 'lit';
  const lit = look === 'lit';
  const emissive = lit && part.emissive ? part.emissive.toLowerCase() : '';
  return [
    look,
    emissive,
    emissive ? num(part.emissiveIntensity ?? 1) : '',
    lit ? num(part.roughness ?? 0.85) : '',
    lit ? num(part.metalness ?? 0) : '',
    num(clamp01(part.opacity ?? 1)),
    part.additive ? 'add' : '',
    part.doubleSided ? 'ds' : '',
    part.cutout ? 'cut' : '',
    part.paint ? paintKey(part.paint) : '',
    ghost ? 'ghost' : '',
  ].join('|');
}

/**
 * Отбрасывает ли часть тень (если объект не на потолке): look 'lit', не additive, непрозрачная. Зависит только от
 * полей, входящих в materialKey, поэтому одинаково для всех частей группы.
 */
export function castsShadow(part: Part): boolean {
  return (part.look ?? 'lit') === 'lit' && part.additive !== true && clamp01(part.opacity ?? 1) >= 1;
}

export interface PartGroup {
  geometryKey: string;
  materialKey: string;
  parts: Part[];
}

/** Части с одинаковой геометрией и материалом — одна группа (один InstancedMesh). Порядок групп — по первому появлению. */
export function groupParts(parts: readonly Part[], ghost: boolean): PartGroup[] {
  const groups = new Map<string, PartGroup>();
  for (const part of parts) {
    const gKey = geometryKey(part);
    const mKey = materialKey(part, ghost);
    const key = `${gKey}\n${mKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { geometryKey: gKey, materialKey: mKey, parts: [] };
      groups.set(key, group);
    }
    group.parts.push(part);
  }
  return [...groups.values()];
}

/** Масштаб, отображающий единичную геометрию (geometryCache) в size части. */
function partScale(part: Part): [number, number, number] {
  const [sx, sy, sz] = part.size;
  switch (part.shape) {
    case 'plane':
      // У плоскости нет толщины: третья компонента size равна 0, а нулевой масштаб вырождает матрицу нормалей.
      return [sx, sy, 1];
    case 'torus':
      // Единичный тор — внешний диаметр 1 с трубкой t / D; равномерный масштаб D сохраняет круглое сечение трубки.
      return [sx, sx, sx];
    default:
      return [sx, sy, sz];
  }
}

const position = new Vector3();
const scale = new Vector3();
const quaternion = new Quaternion();
const euler = new Euler();
const matrix = new Matrix4();

/** 16 чисел по столбцам: position · rotation (Эйлер XYZ) · scale, где scale отображает единичную геометрию в size части. */
export function partMatrix(part: Part): number[] {
  const rotation = part.rotation;
  euler.set(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0, 'XYZ');
  quaternion.setFromEuler(euler);
  position.set(part.position[0], part.position[1], part.position[2]);
  const [sx, sy, sz] = partScale(part);
  scale.set(sx, sy, sz);
  return matrix.compose(position, quaternion, scale).toArray();
}
