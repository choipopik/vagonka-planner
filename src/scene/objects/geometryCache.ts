// Единичные геометрии-синглтоны по geometryKey(part). Создаются без WebGL — модуль тестируется в Node.
// Здесь же, один раз при создании, выполняется договор о развёртке Part.paint (2.14).
import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, PlaneGeometry, SphereGeometry, TorusGeometry } from 'three';
import type { BufferGeometry } from 'three';

/** Сегментов по окружности цилиндра. */
const CYLINDER_SEGMENTS = 20;
/**
 * Подразбиение икосаэдра для однотонных и matcap-сфер. В three 0.187 грань делится на (detail + 1)² треугольников:
 * detail 3 даёт 20 · 16 = 320 треугольников на сферу — бюджет из спецификации (detail 2 дал бы только 180).
 */
const ICOSPHERE_DETAIL = 3;

const cache = new Map<string, BufferGeometry>();
const warned = new Set<string>();

function create(key: string): BufferGeometry {
  const [shape, arg] = key.split(':');
  switch (shape) {
    case 'box':
      // Каждая грань получает весь canvas; на грани +Z он лежит как на plane.
      return new BoxGeometry(1, 1, 1);
    case 'plane':
      // В плоскости XY лицом в +Z; u = 0 на левом крае (x = −0.5), верх canvas — +Y.
      return new PlaneGeometry(1, 1);
    case 'cylinder': {
      const parsed = Number(arg ?? 1);
      const taper = Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
      // У стандартного цилиндра шов u = 0/1 смотрит в +Z; поворот на π уводит шов назад, а u = 0.5 — вперёд (+Z).
      return new CylinderGeometry(0.5 * taper, 0.5, 1, CYLINDER_SEGMENTS).rotateY(Math.PI);
    }
    case 'sphere':
      if (arg === 'uv') {
        // У стандартной сферы в +Z смотрит u = 0.25; после поворота вперёд смотрит u = 0.5, u растёт от −X к +X.
        return new SphereGeometry(0.5, 20, 12).rotateY(-Math.PI / 2);
      }
      return new IcosahedronGeometry(0.5, ICOSPHERE_DETAIL);
    case 'torus': {
      // Внешний диаметр 1: радиус кольца + радиус трубки = 0.5. Кольцо лежит в плоскости XY (ось Z).
      const parsed = Number(arg ?? 0.1);
      const ratio = Number.isFinite(parsed) ? Math.min(0.5, Math.max(0.01, parsed)) : 0.1;
      return new TorusGeometry((1 - ratio) / 2, ratio / 2, 10, 32);
    }
    default:
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`Неизвестный ключ геометрии «${key}» — рисуется бокс`);
      }
      return new BoxGeometry(1, 1, 1);
  }
}

/** Единичная геометрия-синглтон по geometryKey(part). Раскладка UV — по договору Part.paint (2.14). */
export function getGeometry(key: string): BufferGeometry {
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = create(key);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    cache.set(key, geometry);
  }
  return geometry;
}
