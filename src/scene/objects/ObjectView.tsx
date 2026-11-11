// Один объект макета: группа в мировой позе, внутри — «тело» по виду объекта, нить подвеса и контур призрака.
// При перетаскивании меняется только поза группы: тела мемоизированы (sameBody) и не пересобираются.
import { memo } from 'react';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from 'three';
import { getItem, hasItem } from '../../catalog';
import type { SceneObject } from '../../model/types';
import { useIsGhosted, useObject, usePose } from '../../store/selectors';
import { dropOf } from './bodyProps';
import { HANGER_MIN_DROP, Hanger } from './Hanger';
import { ImageBody } from './ImageBody';
import { LightBody } from './LightBody';
import { GHOST_RENDER_ORDER } from './materialCache';
import { ModelBody } from './ModelBody';
import { PartsBody } from './PartsBody';
import { Placeholder } from './Placeholder';

/** Единичный квадрат в плоскости XY (центр в нуле) для контуров призрака; размер задаётся масштабом. */
const outlineGeometry = new BufferGeometry().setAttribute(
  'position',
  new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
);
const outlineMaterial = new LineBasicMaterial({ color: '#f1ece4', transparent: true, opacity: 0.8, depthWrite: false });
/** Поворот квадрата XY в горизонтальную плоскость XZ. */
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

/** Контур призрака: у потолочного объекта — верхняя грань (w × d на y = h), у настенного — спинка (w × h на z = −d/2). */
function GhostOutline({ object }: { object: SceneObject }) {
  const [w, h, d] = object.size;
  if (object.mount.kind === 'ceiling') {
    return (
      <lineLoop
        geometry={outlineGeometry}
        material={outlineMaterial}
        position={[0, h, 0]}
        rotation={FLAT}
        scale={[w, d, 1]}
        renderOrder={GHOST_RENDER_ORDER + 1}
      />
    );
  }
  if (object.mount.kind === 'wall') {
    return (
      <lineLoop
        geometry={outlineGeometry}
        material={outlineMaterial}
        position={[0, h / 2, -d / 2]}
        scale={[w, h, 1]}
        renderOrder={GHOST_RENDER_ORDER + 1}
      />
    );
  }
  return null;
}

/** Тело по виду записи каталога; неизвестный type → заглушка. */
function Body({ object, ghost }: { object: SceneObject; ghost: boolean }) {
  if (!hasItem(object.type)) return <Placeholder size={object.size} ghost={ghost} />;
  switch (getItem(object.type).kind) {
    case 'image':
      return <ImageBody object={object} ghost={ghost} />;
    case 'model':
      return <ModelBody object={object} ghost={ghost} />;
    case 'light':
      return <LightBody object={object} ghost={ghost} />;
    default:
      return <PartsBody object={object} ghost={ghost} />;
  }
}

export const ObjectView = memo(function ObjectView({ id }: { id: string }) {
  const object = useObject(id);
  const pose = usePose(id);
  // Призрак определяется только здесь: потолочный объект при виде сверху или настенный на поверхности,
  // повёрнутой к камере изнанкой; выбранный — никогда.
  const ghost = useIsGhosted(id);
  if (!object || !pose || !object.visible) return null;

  const item = getItem(object.type);
  const drop = dropOf(object);
  // Нить лампы рисует LightBody вместе с маркером (в прогулке и на снимке скрыты оба), нити картинки — ImageBody.
  const hanger = item.kind !== 'light' && item.hanger !== false && drop > HANGER_MIN_DROP;
  return (
    // При перетаскивании меняется только поза этой группы.
    <group position={pose.position} rotation-y={pose.rotationY}>
      <Body object={object} ghost={ghost} />
      {hanger && <Hanger from={[0, object.size[1], 0]} length={drop} ghost={ghost} />}
      {ghost && <GhostOutline object={object} />}
    </group>
  );
});
