// Универсальный рендерер частей каталога: одинаковые части собираются в InstancedMesh (по одному на группу).
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Matrix4 } from 'three';
import type { InstancedMesh } from 'three';
import { partsOf } from '../../catalog';
import { sameBody } from './bodyProps';
import type { BodyProps } from './bodyProps';
import { getGeometry } from './geometryCache';
import { GHOST_RENDER_ORDER, getMaterial } from './materialCache';
import { castsShadow, groupParts, partMatrix } from './partGroups';
import type { PartGroup } from './partGroups';

const matrix = new Matrix4();
const color = new Color();

interface GroupMeshProps {
  group: PartGroup;
  ghost: boolean;
  /** Объект может отбрасывать тень (не на потолке и не призрак). */
  shadows: boolean;
}

/**
 * Один InstancedMesh на группу. Компонент монтируется заново (key в PartsBody), когда меняется геометрия, материал
 * или число частей, поэтому args стабильны всю его жизнь; при смене самих частей переписываются только матрицы и цвета.
 */
const GroupMesh = memo(function GroupMesh({ group, ghost, shadows }: GroupMeshProps) {
  const ref = useRef<InstancedMesh>(null);
  const count = group.parts.length;
  const first = group.parts[0];
  const geometry = useMemo(() => getGeometry(group.geometryKey), [group.geometryKey]);
  // Материал зависит только от полей, входящих в materialKey, — годится любая часть группы.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => getMaterial(first, ghost), [group.materialKey, ghost]);

  // Матрицы и цвета пишутся один раз на сборку, не на кадр.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    group.parts.forEach((part, i) => {
      mesh.setMatrixAt(i, matrix.fromArray(partMatrix(part)));
      mesh.setColorAt(i, color.set(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [group]);

  const lit = (first.look ?? 'lit') === 'lit';
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, count]}
      castShadow={shadows && castsShadow(first)}
      receiveShadow={lit && !ghost}
      renderOrder={ghost ? GHOST_RENDER_ORDER : 0}
    />
  );
});

/**
 * Тело объекта kind 'primitive' | 'preset': partsOf(o) → groupParts → по одному instancedMesh на группу.
 * Пересборка только при смене type / size / color / params / mount.kind (partsOf мемоизирован по этому ключу).
 */
export const PartsBody = memo(function PartsBody({ object, ghost }: BodyProps) {
  const parts = partsOf(object);
  const groups = useMemo(() => groupParts(parts, ghost), [parts, ghost]);
  // Потолочный декор тень не отбрасывает: облачный потолок не должен затемнять зал в рабочем свете.
  const shadows = !ghost && object.mount.kind !== 'ceiling';
  return (
    <>
      {groups.map((group) => (
        <GroupMesh
          key={`${group.geometryKey}\n${group.materialKey}\n${group.parts.length}`}
          group={group}
          ghost={ghost}
          shadows={shadows}
        />
      ))}
    </>
  );
}, sameBody);
