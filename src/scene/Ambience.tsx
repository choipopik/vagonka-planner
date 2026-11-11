import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Object3D } from 'three';
import { AMBIENCES, effectiveAmbience, reservedLights } from '../model/lights';
import type { AmbienceId, CameraMode, RoomDef, WashDef } from '../model/types';

/** Стационарный прожектор площадки: конус без теней, цель — отдельный Object3D в сцене. */
function Wash({ wash }: { wash: WashDef }) {
  const target = useMemo(() => new Object3D(), []);
  return (
    <>
      <primitive object={target} position={wash.target} />
      <spotLight
        position={wash.position}
        target={target}
        color={wash.color}
        intensity={wash.intensity}
        angle={wash.angle}
        penumbra={0.6}
        distance={9}
        decay={2}
        castShadow={false}
      />
    </>
  );
}

/**
 * Свет и фон сцены по выбранной атмосфере. На плане всегда «Рабочий свет» (effectiveAmbience), чтобы план читался.
 * Тени даёт только направленный «верхний» свет: его нет в «Вечеринке», а на плане он светит без теней.
 */
export function Ambience({ room, mode, ambience }: { room: RoomDef; mode: CameraMode; ambience: AmbienceId }) {
  const def = AMBIENCES[effectiveAmbience(ambience, mode)];
  const gl = useThree((state) => state.gl);
  const span = Math.max(room.size.length, room.size.width);
  // Ровно столько заливок, сколько слотов под них резервирует модель света (reservedLights): остальные лампы макета
  // делят оставшиеся MAX_LIGHTS − reserved.
  const washes = (room.washes ?? []).slice(0, reservedLights(room, ambience, mode));

  useEffect(() => {
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = def.exposure;
    return () => {
      gl.toneMappingExposure = previous;
    };
  }, [gl, def.exposure]);

  return (
    <>
      <color attach="background" args={[def.background]} />

      <ambientLight color={def.ambient.color} intensity={def.ambient.intensity} />
      {def.hemisphere && (
        <hemisphereLight color={def.hemisphere.sky} groundColor={def.hemisphere.ground} intensity={def.hemisphere.intensity} />
      )}
      {def.sun && (
        <directionalLight
          position={[span * 0.35, span, span * 0.45]}
          intensity={def.sun.intensity}
          // На плане тени только мешают читать расстановку.
          castShadow={mode !== 'top'}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-span}
          shadow-camera-right={span}
          shadow-camera-top={span}
          shadow-camera-bottom={-span}
          shadow-camera-far={span * 4}
          shadow-bias={-0.0005}
        />
      )}

      {washes.map((wash) => (
        <Wash key={wash.id} wash={wash} />
      ))}
    </>
  );
}
