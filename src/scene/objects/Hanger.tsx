// Нить подвеса: тонкий цилиндр от точки на объекте вертикально вверх до потолка.
import { DoubleSide, MeshStandardMaterial } from 'three';
import { GHOST_OPACITY } from '../../model/layers';
import type { Vec3 } from '../../model/types';
import { getGeometry } from './geometryCache';
import { GHOST_RENDER_ORDER } from './materialCache';

/** Диаметр нити, м. */
export const HANGER_DIAMETER = 0.003;
/** Нить рисуется, только если объект опущен от потолка больше чем на это расстояние, м. */
export const HANGER_MIN_DROP = 0.03;
const HANGER_COLOR = '#d8d8d8';

const solidMaterial = new MeshStandardMaterial({ color: HANGER_COLOR, roughness: 0.8 });
const ghostMaterial = new MeshStandardMaterial({
  color: HANGER_COLOR,
  roughness: 0.8,
  transparent: true,
  opacity: GHOST_OPACITY,
  depthWrite: false,
  side: DoubleSide,
});

/** Нить длиной length от точки from (локальные координаты объекта) вверх. */
export function Hanger({ from, length, ghost }: { from: Vec3; length: number; ghost: boolean }) {
  if (!(length > 0)) return null;
  return (
    <mesh
      geometry={getGeometry('cylinder:1')}
      material={ghost ? ghostMaterial : solidMaterial}
      position={[from[0], from[1] + length / 2, from[2]]}
      scale={[HANGER_DIAMETER, length, HANGER_DIAMETER]}
      renderOrder={ghost ? GHOST_RENDER_ORDER : 0}
    />
  );
}
