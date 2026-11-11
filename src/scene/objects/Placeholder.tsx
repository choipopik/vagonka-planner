// Заглушка объекта, который нечем нарисовать (неизвестный type, нет файла, модель не разобралась):
// пунктирный бокс по габариту и знак «?» в центре. Объект остаётся выбираемым и редактируемым.
import { useEffect, useMemo } from 'react';
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, LineDashedMaterial, SRGBColorSpace, SpriteMaterial } from 'three';
import { GHOST_OPACITY } from '../../model/layers';
import type { Vec3 } from '../../model/types';
import { GHOST_RENDER_ORDER } from './materialCache';

const PLACEHOLDER_COLOR = '#d9a441';
/** Длина штриха и пробела пунктира, м. */
const DASH = 0.06;
const GAP = 0.04;

const solidLine = new LineDashedMaterial({ color: PLACEHOLDER_COLOR, dashSize: DASH, gapSize: GAP });
const ghostLine = new LineDashedMaterial({
  color: PLACEHOLDER_COLOR,
  dashSize: DASH,
  gapSize: GAP,
  transparent: true,
  opacity: GHOST_OPACITY,
  depthWrite: false,
});

/** 12 рёбер бокса [−w/2, w/2] × [0, h] × [−d/2, d/2] парами точек + длина вдоль ребра для пунктира. */
function boxEdges([w, h, d]: Vec3): BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const corners: Vec3[] = [
    [-x, 0, -z],
    [x, 0, -z],
    [x, 0, z],
    [-x, 0, z],
    [-x, h, -z],
    [x, h, -z],
    [x, h, z],
    [-x, h, z],
  ];
  const pairs = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const positions: number[] = [];
  const distances: number[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = corners[pairs[i]];
    const b = corners[pairs[i + 1]];
    positions.push(...a, ...b);
    distances.push(0, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
  return geometry;
}

let questionMaterials: { solid: SpriteMaterial; ghost: SpriteMaterial } | null | undefined;

/** Материалы спрайта «?»; создаются при первом показе (нужен canvas), вне браузера — null. */
function getQuestionMaterials(): { solid: SpriteMaterial; ghost: SpriteMaterial } | null {
  if (questionMaterials !== undefined) return questionMaterials;
  questionMaterials = null;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = PLACEHOLDER_COLOR;
  ctx.font = 'bold 104px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  questionMaterials = {
    solid: new SpriteMaterial({ map, toneMapped: false }),
    ghost: new SpriteMaterial({ map, toneMapped: false, opacity: GHOST_OPACITY, depthWrite: false }),
  };
  return questionMaterials;
}

/** Пунктирный бокс size с «?». */
export function Placeholder({ size, ghost }: { size: Vec3; ghost: boolean }) {
  const [w, h, d] = size;
  const geometry = useMemo(() => boxEdges([w, h, d]), [w, h, d]);
  // Освобождённая геометрия при повторном монтировании (StrictMode) просто загрузится в видеокарту заново.
  useEffect(() => () => geometry.dispose(), [geometry]);

  const question = getQuestionMaterials();
  // Знак не больше габарита и не мельче 8 см, чтобы читался на плоских предметах.
  const sign = Math.max(0.08, Math.min(0.5, 0.6 * Math.max(Math.min(w, h), Math.min(h, d), Math.min(w, d))));
  const order = ghost ? GHOST_RENDER_ORDER : 0;
  return (
    <>
      <lineSegments geometry={geometry} material={ghost ? ghostLine : solidLine} renderOrder={order} />
      {question && (
        <sprite
          material={ghost ? question.ghost : question.solid}
          position={[0, h / 2, 0]}
          scale={[sign, sign, 1]}
          renderOrder={order}
        />
      )}
    </>
  );
}
