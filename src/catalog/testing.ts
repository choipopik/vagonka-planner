// Общий помощник для тестов билдеров (F, W6, W7).
import { deepEqual } from '../model/commands';
import { partBounds } from './bounds';
import { resolveParams } from './index';
import type { BuildInput, CatalogItem, Painter, Part } from './types';

const AXES = ['x', 'y', 'z'] as const;

function numbersOf(part: Part): number[] {
  const numbers = [...part.position, ...part.size, ...(part.rotation ?? [])];
  for (const value of [part.taper, part.emissiveIntensity, part.roughness, part.metalness, part.opacity]) {
    if (value !== undefined) numbers.push(value);
  }
  return numbers;
}

/**
 * Строит item с умолчаниями (поверх — overrides) и возвращает список нарушений (пустой = всё хорошо):
 * NaN/Infinity; size ≤ 0; не-additive часть вне габарита (допуск 10 % + 2 см); повторная сборка не deep-равна первой;
 * paint.painter отсутствует в painters; частей больше maxParts (по умолчанию 900).
 * overrides.params сливаются с умолчаниями и зажимаются (resolveParams), как это делает buildInput для настоящих объектов.
 */
export function checkBuild(
  item: CatalogItem,
  painters: Record<string, Painter>,
  overrides?: Partial<BuildInput>,
  maxParts = 900,
): string[] {
  if (!item.build) {
    return item.kind === 'primitive' || item.kind === 'preset' ? [`${item.id}: у записи нет build`] : [];
  }
  const input: BuildInput = {
    size: overrides?.size ?? item.size,
    color: overrides?.color ?? item.color,
    params: resolveParams(item, overrides?.params ?? {}),
    mount: overrides?.mount ?? item.mounts[0] ?? 'floor',
  };
  const problems: string[] = [];
  let parts: Part[];
  try {
    parts = item.build(input);
  } catch (error) {
    return [`${item.id}: build бросил исключение: ${String(error)}`];
  }
  if (parts.length > maxParts) problems.push(`${item.id}: частей ${parts.length} > ${maxParts}`);

  const [w, h, d] = input.size;
  // Габарит с допуском 10 % размера + 2 см по каждой оси.
  const min = [-w / 2 - (0.1 * w + 0.02), -(0.1 * h + 0.02), -d / 2 - (0.1 * d + 0.02)];
  const max = [w / 2 + (0.1 * w + 0.02), h + (0.1 * h + 0.02), d / 2 + (0.1 * d + 0.02)];
  const missing = new Set<string>();

  parts.forEach((part, index) => {
    const tag = `${item.id}: часть ${index} (${part.shape})`;
    if (numbersOf(part).some((value) => !Number.isFinite(value))) {
      problems.push(`${tag}: NaN или Infinity`);
      return;
    }
    // У плоскости третья компонента размера — ноль по определению.
    const sides = part.shape === 'plane' ? [part.size[0], part.size[1]] : part.size;
    if (sides.some((side) => !(side > 0)) || part.size[2] < 0) problems.push(`${tag}: size ≤ 0`);
    if (!part.additive) {
      const bounds = partBounds(part);
      for (let axis = 0; axis < 3; axis++) {
        const lo = bounds.center[axis] - bounds.size[axis] / 2;
        const hi = bounds.center[axis] + bounds.size[axis] / 2;
        if (lo < min[axis] - 1e-9 || hi > max[axis] + 1e-9) {
          problems.push(
            `${tag}: вне габарита по ${AXES[axis]}: [${lo.toFixed(3)}, ${hi.toFixed(3)}] при допуске [${min[axis].toFixed(3)}, ${max[axis].toFixed(3)}]`,
          );
        }
      }
    }
    if (part.paint && !Object.prototype.hasOwnProperty.call(painters, part.paint.painter)) missing.add(part.paint.painter);
  });
  for (const name of missing) problems.push(`${item.id}: painter '${name}' отсутствует в painters`);

  if (!deepEqual(parts, item.build(input))) problems.push(`${item.id}: повторная сборка не deep-равна первой`);
  return problems;
}
