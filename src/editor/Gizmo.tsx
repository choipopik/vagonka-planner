// Каркасы выбранного и наведённого объекта и ручки выбранного. Всё строится из позы и размера, а не из мешей объекта:
// одинаково работает для частей, GLB, картинок и ламп. Событий указателя здесь нет — ручки выбирает PointerController.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { toWorld } from '../model/pose';
import type { Pose } from '../model/pose';
import type { SceneObject, Vec3 } from '../model/types';
import { useEditor } from '../store/editorStore';
import { getContext, useObject, usePose } from '../store/selectors';
import { HANDLE_PX } from './constants';
import { editHandles } from './gesture';
import type { Handle, HandleKind } from './handles';
import { boxEdges } from './overlayGeometry';
import { unitsPerPixelAt } from './viewRay';

/** Оверлеи рисуются после всей сцены (включая прозрачных призраков) и без проверки глубины. */
const FRAME_ORDER = 1000;
const STEM_ORDER = 1001;
const HANDLE_ORDER = 1002;

const SELECTED_COLOR = '#ffd166';
const LOCKED_COLOR = '#9a9a9a';
const HOVER_COLOR = '#ffffff';
const HANDLE_BORDER = '#19181b';
const HANDLE_COLORS: Record<HandleKind, string> = {
  rotate: '#ffd166',
  'resize-w': '#ffffff',
  'resize-d': '#ffffff',
  'resize-h': '#ffffff',
  'resize-uniform': '#ffffff',
  drop: '#7fd4ff',
};

const NO_SIZE: Vec3 = [0, 0, 0];
/** Единичные отрезки для «ножек» ручек: вдоль +Z (поворот) и вдоль +Y (опуск). */
const UNIT_Z = new Float32Array([0, 0, 0, 0, 0, 1]);
const UNIT_Y = new Float32Array([0, 0, 0, 0, 1, 0]);

/** Ориентированный каркас габаритного бокса. Выбранный: заблокированный — серый, скрытый — пунктир; наведённый — тонкий светлый. */
function ObjectFrame({ id, tone }: { id: string; tone: 'selected' | 'hover' }) {
  const o = useObject(id);
  const pose = usePose(id);
  const [w, h, d] = o?.size ?? NO_SIZE;
  const edges = useMemo(() => boxEdges([w, h, d]), [w, h, d]);
  if (!o || !pose) return null;

  const hover = tone === 'hover';
  const color = hover ? HOVER_COLOR : o.locked ? LOCKED_COLOR : SELECTED_COLOR;
  const opacity = hover ? 0.55 : 1;
  return (
    <lineSegments position={pose.position} rotation={[0, pose.rotationY, 0]} renderOrder={FRAME_ORDER} frustumCulled={false}>
      {/* key: при смене размера геометрия создаётся заново (расстояния для пунктира — в метрах, а не в долях ребра). */}
      <bufferGeometry key={`${w}|${h}|${d}`}>
        <bufferAttribute attach="attributes-position" args={[edges.positions, 3]} />
        <bufferAttribute attach="attributes-lineDistance" args={[edges.distances, 1]} />
      </bufferGeometry>
      {!hover && !o.visible ? (
        <lineDashedMaterial color={color} dashSize={0.12} gapSize={0.08} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      ) : (
        <lineBasicMaterial color={color} opacity={opacity} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      )}
    </lineSegments>
  );
}

/** Форма ручки — аргументы circleGeometry [радиус, сегменты, начальный угол]: круг (поворот), квадрат (размер), ромб (опуск). */
const ROUND: [number, number, number] = [0.72, 24, 0];
const SQUARE: [number, number, number] = [0.85, 4, Math.PI / 4];
const DIAMOND: [number, number, number] = [0.85, 4, 0];

function shapeArgs(kind: HandleKind): [number, number, number] {
  if (kind === 'rotate') return ROUND;
  if (kind === 'drop') return DIAMOND;
  return SQUARE;
}

/** Ручка постоянного экранного размера: каждый кадр поворачивается к камере и масштабируется под HANDLE_PX. */
function HandleDot({ handle }: { handle: Handle }) {
  const ref = useRef<Group>(null);
  const { kind, position } = handle;
  const args = shapeArgs(kind);

  useFrame(({ camera, size }) => {
    const group = ref.current;
    if (!group) return;
    group.quaternion.copy(camera.quaternion);
    // Тот же масштаб, по которому ручку выбирает pickTarget: радиус попадания — HANDLE_PX, рисуется чуть меньше.
    group.scale.setScalar(Math.max(1e-6, HANDLE_PX * unitsPerPixelAt(camera, size.height, position)));
  });

  return (
    <group ref={ref} position={position}>
      <mesh renderOrder={HANDLE_ORDER} scale={1.28} frustumCulled={false}>
        <circleGeometry args={args} />
        <meshBasicMaterial color={HANDLE_BORDER} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh renderOrder={HANDLE_ORDER + 1} frustumCulled={false}>
        <circleGeometry args={args} />
        <meshBasicMaterial color={HANDLE_COLORS[kind]} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Тонкая «ножка» от объекта к вынесенной ручке (поворот — от лицевой грани, опуск — от низа объекта). */
function Stem({ handle, o, pose }: { handle: Handle; o: SceneObject; pose: Pose }) {
  if (handle.kind === 'rotate') {
    const from = toWorld(pose, [0, 0, o.size[2] / 2]);
    const length = Math.hypot(handle.position[0] - from[0], handle.position[2] - from[2]);
    return (
      <lineSegments position={from} rotation={[0, pose.rotationY, 0]} scale={[1, 1, length]} renderOrder={STEM_ORDER} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[UNIT_Z, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={SELECTED_COLOR} opacity={0.7} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </lineSegments>
    );
  }
  if (handle.kind === 'drop') {
    const length = Math.max(0, pose.position[1] - handle.position[1]);
    return (
      <lineSegments position={handle.position} scale={[1, length, 1]} renderOrder={STEM_ORDER} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[UNIT_Y, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={HANDLE_COLORS.drop} opacity={0.7} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </lineSegments>
    );
  }
  return null;
}

function Handles({ o, pose, mode }: { o: SceneObject; pose: Pose; mode: 'orbit' | 'top' }) {
  // Поза входит в зависимости: ручки предмета на столе едут и за самим предметом, и за столом.
  const handles = useMemo(() => editHandles(o, getContext(), mode), [o, pose, mode]);
  return (
    <>
      {handles.map((handle) => (
        <group key={handle.kind}>
          <Stem handle={handle} o={o} pose={pose} />
          <HandleDot handle={handle} />
        </group>
      ))}
    </>
  );
}

function SelectedGizmo({ id, mode }: { id: string; mode: 'orbit' | 'top' }) {
  const o = useObject(id);
  const pose = usePose(id);
  if (!o || !pose) return null;
  return (
    <>
      <ObjectFrame id={id} tone="selected" />
      <Handles o={o} pose={pose} mode={mode} />
    </>
  );
}

/** Монтируется только при mode !== 'walk'; скрыт на время снимка. */
export function Gizmo({ mode }: { mode: 'orbit' | 'top' }) {
  const capturing = useEditor((s) => s.capturing);
  const selectedId = useEditor((s) => s.selectedId);
  const hoveredId = useEditor((s) => s.hoveredId);
  if (capturing) return null;
  return (
    <>
      {hoveredId !== null && hoveredId !== selectedId && <ObjectFrame key={`hover:${hoveredId}`} id={hoveredId} tone="hover" />}
      {selectedId !== null && <SelectedGizmo key={selectedId} id={selectedId} mode={mode} />}
    </>
  );
}
