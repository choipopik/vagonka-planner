// Направляющие: отвес и проекция выбранного потолочного объекта, сетка на высоте потолка для слоя «Потолок»,
// сетка привязки на полу. Событий указателя нет; на время снимка всё скрыто.
import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import type { OrthographicCamera } from 'three';
import { floorAt } from '../model/geometry';
import type { RoomDef, Vec2 } from '../model/types';
import { useEditor } from '../store/editorStore';
import { useLayerView, useObject, usePose } from '../store/selectors';
import { gridLines, isLightColor, plumbLine, rectEdges } from './overlayGeometry';

const GUIDE_COLOR = '#7fd4ff';
/** Сетка лежит чуть выше пола и подиумов, чтобы не мерцать с ними. */
const FLOOR_GRID_Y = 0.005;
const MAJOR_STEP = 1;
const MINOR_STEP = 0.1;
/** Шаг бледной сетки на высоте потолка, м. */
const CEILING_STEP = 0.5;
/** Линии через 10 см рисуются только на плане и только при масштабе крупнее этого, px/м (10 см ≥ 8 px). */
const MINOR_GRID_ZOOM = 80;

function Lines(props: { positions: Float32Array; color: string; opacity: number; cacheKey: string; renderOrder?: number }) {
  if (props.positions.length === 0) return null;
  return (
    <lineSegments renderOrder={props.renderOrder ?? 1} frustumCulled={false}>
      <bufferGeometry key={props.cacheKey}>
        <bufferAttribute attach="attributes-position" args={[props.positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={props.color} opacity={props.opacity} transparent depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

/** Выбранный потолочный объект: пунктирный отвес от центра низа до пола и прямоугольник-проекция на полу. */
function CeilingGuide({ id, room }: { id: string; room: RoomDef }) {
  const o = useObject(id);
  const pose = usePose(id);
  const w = o?.size[0] ?? 0;
  const d = o?.size[2] ?? 0;
  const x = pose?.position[0] ?? 0;
  const z = pose?.position[2] ?? 0;
  const floorY = floorAt(room, x, z);
  const height = Math.max(0, (pose?.position[1] ?? 0) - floorY);
  const rect = useMemo(() => rectEdges(w, d), [w, d]);
  const plumb = useMemo(() => plumbLine(height), [height]);
  if (!o || !pose || o.mount.kind !== 'ceiling') return null;

  return (
    <group position={[x, floorY + 2 * FLOOR_GRID_Y, z]}>
      <lineSegments rotation={[0, pose.rotationY, 0]} renderOrder={2} frustumCulled={false}>
        <bufferGeometry key={`${w}|${d}`}>
          <bufferAttribute attach="attributes-position" args={[rect.positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={GUIDE_COLOR} opacity={0.9} transparent depthWrite={false} toneMapped={false} />
      </lineSegments>
      <lineSegments renderOrder={2} frustumCulled={false}>
        <bufferGeometry key={height}>
          <bufferAttribute attach="attributes-position" args={[plumb.positions, 3]} />
          <bufferAttribute attach="attributes-lineDistance" args={[plumb.distances, 1]} />
        </bufferGeometry>
        <lineDashedMaterial color={GUIDE_COLOR} dashSize={0.1} gapSize={0.07} opacity={0.9} transparent depthWrite={false} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Бледная сетка 0.5 м на высоте потолка — ориентир при работе со слоем «Потолок». */
function CeilingGrid({ room }: { room: RoomDef }) {
  const { length, width, height } = room.size;
  const positions = useMemo(
    () => gridLines([-length / 2, -width / 2], [length / 2, width / 2], CEILING_STEP, height - 0.01),
    [length, width, height],
  );
  return <Lines positions={positions} color="#ffffff" opacity={0.16} cacheKey={`${length}|${width}|${height}`} />;
}

interface GridPatch {
  key: string;
  min: Vec2;
  max: Vec2;
  y: number;
  /** Тёмные линии на светлой поверхности и наоборот. */
  color: string;
}

/** Сетка привязки: линии через 1 м на полу и на подиумах; на плане при крупном масштабе — ещё и через 10 см. */
function FloorGrid({ room, mode }: { room: RoomDef; mode: 'orbit' | 'top' }) {
  const [minor, setMinor] = useState(false);

  useFrame(({ camera }) => {
    const ortho = camera as OrthographicCamera;
    const next = mode === 'top' && ortho.isOrthographicCamera === true && ortho.zoom >= MINOR_GRID_ZOOM;
    if (next !== minor) setMinor(next);
  });

  const patches = useMemo<GridPatch[]>(() => {
    const { length, width } = room.size;
    const tone = (hex: string) => (isLightColor(hex) ? '#000000' : '#ffffff');
    return [
      { key: 'floor', min: [-length / 2, -width / 2], max: [length / 2, width / 2], y: FLOOR_GRID_Y, color: tone(room.floorColor) },
      ...room.platforms.map(
        (p): GridPatch => ({ key: p.id, min: p.min, max: p.max, y: p.height + FLOOR_GRID_Y, color: tone(p.color) }),
      ),
    ];
  }, [room]);

  const lines = useMemo(
    () =>
      patches.map((patch) => ({
        patch,
        major: gridLines(patch.min, patch.max, MAJOR_STEP, patch.y),
        minor: minor ? gridLines(patch.min, patch.max, MINOR_STEP, patch.y, Math.round(MAJOR_STEP / MINOR_STEP)) : null,
      })),
    [patches, minor],
  );

  return (
    <>
      {lines.map(({ patch, major, minor: fine }) => (
        <group key={patch.key}>
          <Lines positions={major} color={patch.color} opacity={0.3} cacheKey={`${room.id}:${patch.key}:major`} />
          {fine && <Lines positions={fine} color={patch.color} opacity={0.12} cacheKey={`${room.id}:${patch.key}:minor`} />}
        </group>
      ))}
    </>
  );
}

/** Монтируется только при mode !== 'walk'. */
export function Guides({ room, mode }: { room: RoomDef; mode: 'orbit' | 'top' }) {
  const capturing = useEditor((s) => s.capturing);
  const selectedId = useEditor((s) => s.selectedId);
  const gridSnap = useEditor((s) => s.gridSnap);
  const layerView = useLayerView();
  if (capturing) return null;
  return (
    <>
      {gridSnap && <FloorGrid room={room} mode={mode} />}
      {layerView === 'ceiling' && <CeilingGrid room={room} />}
      {selectedId !== null && <CeilingGuide key={selectedId} id={selectedId} room={room} />}
    </>
  );
}
