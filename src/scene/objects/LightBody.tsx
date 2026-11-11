// Тело объекта-лампы: маркер (лампочка / банка прожектора с glow-линзой цвета света) и сам источник света.
// Источник есть только у активных ламп (первые 12 с учётом заливок помещения); теней лампы не отбрасывают.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, FrontSide, Quaternion, Vector3 } from 'three';
import type { Object3D, SpotLight } from 'three';
import { buildInput, getItem } from '../../catalog';
import { GHOST_OPACITY } from '../../model/layers';
import { lightDirection, lightSettings } from '../../model/lights';
import type { LightSettings } from '../../model/lights';
import type { Vec3 } from '../../model/types';
import { useEditor } from '../../store/editorStore';
import { useActiveLightIds } from '../../store/selectors';
import { dropOf, sameBody } from './bodyProps';
import type { BodyProps } from './bodyProps';
import { getGeometry } from './geometryCache';
import { HANGER_MIN_DROP, Hanger } from './Hanger';
import { GHOST_RENDER_ORDER } from './materialCache';

const HOUSING_COLOR = '#1b1b1e';
/** Во сколько раз тусклее линза лампы, которая не светит (сверх предела источников). */
const INACTIVE_DIM = 0.22;
const UP = new Vector3(0, 1, 0);

interface MarkerProps {
  settings: LightSettings;
  /** Габарит объекта. */
  size: Vec3;
  /** Центр габарита — точка источника. */
  origin: Vec3;
  /** Единичный вектор направления луча (локальные координаты объекта). */
  direction: Vec3;
  active: boolean;
  ghost: boolean;
}

/**
 * Маркер лампы. Локальная ось +Y группы маркера направлена вдоль луча: корпус — сзади, линза — спереди.
 * Лампа — патрон и шар-колба, прожектор — банка с диском-линзой на срезе.
 */
function Marker({ settings, size, origin, direction, active, ghost }: MarkerProps) {
  const [dx, dy, dz] = direction;
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(UP, new Vector3(dx, dy, dz).normalize()), [dx, dy, dz]);
  const lens = useMemo(() => {
    const color = new Color(settings.color);
    return active ? color : color.multiplyScalar(INACTIVE_DIM);
  }, [settings.color, active]);

  // Маркер вписан в наименьшую сторону габарита, чтобы при любом наклоне не выходить за него.
  const span = Math.min(size[0], size[1], size[2]);
  const order = ghost ? GHOST_RENDER_ORDER : 0;
  const opacity = ghost ? GHOST_OPACITY : 1;
  const side = ghost ? DoubleSide : FrontSide;
  const key = ghost ? 'ghost' : 'solid';
  const housing = (
    <meshStandardMaterial key={key} color={HOUSING_COLOR} roughness={0.6} transparent={ghost} opacity={opacity} depthWrite={!ghost} side={side} />
  );
  const glow = (
    <meshBasicMaterial key={key} color={lens} toneMapped={false} transparent={ghost} opacity={opacity} depthWrite={!ghost} side={side} />
  );

  if (settings.type === 'spot') {
    const length = span * 0.8;
    const diameter = span * 0.62;
    const rim = span * 0.05;
    return (
      <group position={origin} quaternion={quaternion}>
        <mesh geometry={getGeometry('cylinder:0.7')} position={[0, -rim / 2, 0]} scale={[diameter, length - rim, diameter]} rotation={[Math.PI, 0, 0]} renderOrder={order}>
          {housing}
        </mesh>
        <mesh geometry={getGeometry('cylinder:1')} position={[0, length / 2 - rim / 2, 0]} scale={[diameter * 0.88, rim, diameter * 0.88]} renderOrder={order}>
          {glow}
        </mesh>
      </group>
    );
  }

  const bulb = span * 0.6;
  const socket = span * 0.3;
  return (
    <group position={origin} quaternion={quaternion}>
      <mesh geometry={getGeometry('cylinder:1')} position={[0, -bulb / 2 - socket / 2 + bulb * 0.12, 0]} scale={[bulb * 0.5, socket, bulb * 0.5]} renderOrder={order}>
        {housing}
      </mesh>
      <mesh geometry={getGeometry('sphere')} scale={[bulb, bulb, bulb]} position={[0, bulb * 0.1, 0]} renderOrder={order}>
        {glow}
      </mesh>
    </group>
  );
}

/** Прожектор: цель — Object3D-сосед внутри группы объекта в точке «источник + направление». */
function SpotSource({ settings, origin, direction }: { settings: LightSettings; origin: Vec3; direction: Vec3 }) {
  const light = useRef<SpotLight>(null);
  const target = useRef<Object3D>(null);
  useLayoutEffect(() => {
    const spot = light.current;
    const aim = target.current;
    if (!spot || !aim) return undefined;
    const previous = spot.target;
    spot.target = aim;
    return () => {
      spot.target = previous;
    };
  }, []);
  return (
    <>
      <object3D ref={target} position={[origin[0] + direction[0], origin[1] + direction[1], origin[2] + direction[2]]} />
      <spotLight
        ref={light}
        position={origin}
        color={settings.color}
        intensity={settings.intensity}
        distance={settings.distance}
        angle={settings.angle}
        penumbra={settings.penumbra}
        decay={2}
        castShadow={false}
      />
    </>
  );
}

/** Тело объекта kind 'light'. */
export const LightBody = memo(function LightBody({ object, ghost }: BodyProps) {
  const active = useActiveLightIds().has(object.id);
  // В прогулке и на снимке маркеры не видны — остаётся только свет.
  const markerHidden = useEditor((s) => s.cameraMode === 'walk' || s.capturing);
  const settings = lightSettings(object, buildInput(object).params);
  const mount = object.mount.kind;
  const [, h] = object.size;
  const origin: Vec3 = [0, h / 2, 0];
  // Направление луча — только из lightDirection (2.12): своих формул наклона здесь нет.
  const direction = lightDirection(mount, settings.tilt);
  const drop = dropOf(object);
  const hanger = getItem(object.type).hanger !== false && drop > HANGER_MIN_DROP;

  return (
    <>
      {!markerHidden && (
        <>
          <Marker settings={settings} size={object.size} origin={origin} direction={direction} active={active} ghost={ghost} />
          {hanger && <Hanger from={[0, h, 0]} length={drop} ghost={ghost} />}
        </>
      )}
      {active &&
        (settings.type === 'spot' ? (
          <SpotSource settings={settings} origin={origin} direction={direction} />
        ) : (
          <pointLight
            position={origin}
            color={settings.color}
            intensity={settings.intensity}
            distance={settings.distance}
            decay={2}
            castShadow={false}
          />
        ))}
    </>
  );
}, sameBody);
