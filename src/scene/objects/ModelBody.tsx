// Тело объекта-модели: клон разобранной сцены GLB / glTF из assetCache, приведённый к началу координат в центре
// основания и вписанный в size объекта. Нет файла или модель не разобралась → заглушка.
import { memo, useLayoutEffect, useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Material, Mesh, Object3D } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { modelBoundsOf, useModelScene } from '../../assets/assetCache';
import { GHOST_OPACITY } from '../../model/layers';
import type { Vec3 } from '../../model/types';
import { sameBody } from './bodyProps';
import type { BodyProps } from './bodyProps';
import { GHOST_RENDER_ORDER } from './materialCache';
import { Placeholder } from './Placeholder';

/** Сторона габарита модели, меньше которой масштаб по этой оси не считается (плоская модель), м. */
const FLAT_SIDE = 1e-6;

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/** Прозрачная двусторонняя копия материала для призрака (своя на экземпляр — оригинал общий для всех клонов). */
function ghostMaterial(source: Material): Material {
  const material = source.clone();
  material.transparent = true;
  material.opacity = source.opacity * GHOST_OPACITY;
  material.depthWrite = false;
  material.side = DoubleSide;
  // alphaTest сравнивается с альфой после умножения на opacity.
  if (source.alphaTest > 0) material.alphaTest = source.alphaTest * GHOST_OPACITY;
  return material;
}

export interface ModelInstanceProps {
  /** Общая разобранная сцена файла (не добавляется в граф — рисуется её клон). */
  scene: Object3D;
  size: Vec3;
  ghost: boolean;
  /** Отбрасывает тень (не призрак и не под потолком). */
  shadows: boolean;
}

export function ModelInstance({ scene, size, ghost, shadows }: ModelInstanceProps) {
  // По клону на объект: клон делит геометрии, материалы и текстуры с оригиналом; анимации не переносятся.
  const instance = useMemo(() => cloneSkinned(scene), [scene]);

  useLayoutEffect(() => {
    const restore: (() => void)[] = [];
    const created: Material[] = [];
    instance.traverse((node) => {
      if (!isMesh(node)) return;
      const { castShadow, receiveShadow, renderOrder, material } = node;
      node.castShadow = shadows;
      node.receiveShadow = !ghost;
      if (ghost) {
        node.renderOrder = GHOST_RENDER_ORDER;
        if (Array.isArray(material)) {
          const copies = material.map(ghostMaterial);
          created.push(...copies);
          node.material = copies;
        } else {
          const copy = ghostMaterial(material);
          created.push(copy);
          node.material = copy;
        }
      }
      restore.push(() => {
        node.castShadow = castShadow;
        node.receiveShadow = receiveShadow;
        node.renderOrder = renderOrder;
        node.material = material;
      });
    });
    return () => {
      for (const undo of restore) undo();
      // Копии материалов делят текстуры с оригиналом — освобождается только сам материал.
      for (const material of created) material.dispose();
    };
  }, [instance, ghost, shadows]);

  const bounds = modelBoundsOf(scene);
  const natural = bounds?.size ?? [1, 1, 1];
  const base = bounds?.base ?? [0, 0, 0];
  const factor = (i: 0 | 1 | 2) => (natural[i] > FLAT_SIDE && Number.isFinite(size[i] / natural[i]) ? size[i] / natural[i] : 1);
  return (
    <group scale={[factor(0), factor(1), factor(2)]}>
      <group position={[-base[0], -base[1], -base[2]]}>
        <primitive object={instance} />
      </group>
    </group>
  );
}

/** Тело объекта kind 'model'. */
export const ModelBody = memo(function ModelBody({ object, ghost }: BodyProps) {
  const { scene, status } = useModelScene(object.assetId);
  // Пока файл читается и разбирается, не рисуется ничего.
  if (status === 'loading') return null;
  if (!scene) return <Placeholder size={object.size} ghost={ghost} />;
  return (
    <ModelInstance scene={scene} size={object.size} ghost={ghost} shadows={!ghost && object.mount.kind !== 'ceiling'} />
  );
}, sameBody);
