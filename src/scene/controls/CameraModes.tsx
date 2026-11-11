import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControlsChangeEvent } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MOUSE } from 'three';
import { constrainWalk, platformAt } from '../../model/geometry';
import type { RoomDef } from '../../model/types';

/** Предел наклона облёта (≈ 100°): изнутри помещения можно смотреть на потолочный декор снизу вверх. */
export const ORBIT_MAX_POLAR = 1.75;
/** Ниже этой высоты камера облёта не опускается (иначе она уходила бы под пол), м. */
export const ORBIT_MIN_CAMERA_Y = 0.3;

/**
 * onChange облёта: камера, опустившаяся ниже предела, возвращается на него и снова смотрит на цель. Расстояние до
 * цели при этом сохраняется (камера отъезжает по горизонтали): иначе каждый кадр, пока её продолжают тянуть вниз,
 * она подползала бы к цели — «самопроизвольный» наезд.
 */
export function keepOrbitAboveFloor(e?: OrbitControlsChangeEvent): void {
  const controls = e?.target;
  if (!controls) return;
  const camera = controls.object;
  const target = controls.target;
  // Допуск гасит повторные срабатывания от ошибки округления сферических координат.
  if (camera.position.y >= ORBIT_MIN_CAMERA_Y - 1e-4) return;
  const dx = camera.position.x - target.x;
  const dz = camera.position.z - target.z;
  const dy = ORBIT_MIN_CAMERA_Y - target.y;
  const flat = Math.hypot(dx, dz);
  const reach = camera.position.distanceTo(target) ** 2 - dy * dy;
  // Цель слишком близко к плоскости предела (или камера прямо под ней) — остаётся простой подъём.
  if (reach > 0 && flat > 1e-6) {
    const k = Math.sqrt(reach) / flat;
    camera.position.x = target.x + dx * k;
    camera.position.z = target.z + dz * k;
  }
  camera.position.y = ORBIT_MIN_CAMERA_Y;
  camera.lookAt(target);
}

/** Облёт: вращение вокруг центра помещения. */
export function OrbitMode({ room }: { room: RoomDef }) {
  const { length, width } = room.size;
  return (
    <>
      <PerspectiveCamera makeDefault fov={50} near={0.1} far={200} position={[0, length * 0.6, width * 1.5]} />
      <OrbitControls
        makeDefault
        target={[0, 1, 0]}
        maxPolarAngle={ORBIT_MAX_POLAR}
        minDistance={2}
        maxDistance={60}
        onChange={keepOrbitAboveFloor}
      />
    </>
  );
}

/** План: ортографическая камера строго сверху, дальняя стена — вверху экрана. */
export function TopMode({ room }: { room: RoomDef }) {
  const size = useThree((s) => s.size);
  const zoom = Math.min(size.width / (room.size.length + 3), size.height / (room.size.width + 4));
  return (
    <>
      <OrthographicCamera makeDefault position={[0, 50, 0]} up={[0, 0, -1]} zoom={zoom} near={0.1} far={200} />
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enableRotate={false}
        screenSpacePanning
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      />
    </>
  );
}

const EYE_HEIGHT = 1.65;
const BODY_RADIUS = 0.3;
const WALK_SPEED = 2.2;
const RUN_SPEED = 4.5;
const TURN_SPEED = 1.8;
const LOOK_SENSITIVITY = 0.0035;
const MAX_PITCH = 1.2;

/**
 * Прогулка от первого лица: WASD — ходить, стрелки ← → — поворачиваться,
 * мышь с зажатой кнопкой — осматриваться. Коды клавиш не зависят от раскладки.
 */
export function WalkMode({ room }: { room: RoomDef }) {
  const gl = useThree((s) => s.gl);
  const pose = useRef({ x: room.spawn.position[0], z: room.spawn.position[1], y: EYE_HEIGHT, yaw: room.spawn.yaw, pitch: 0 });
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const el = gl.domElement;
    const pressed = keys.current;
    let dragging = false;

    const down = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const p = pose.current;
      p.yaw -= e.movementX * LOOK_SENSITIVITY;
      p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch - e.movementY * LOOK_SENSITIVITY));
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code.startsWith('Arrow')) e.preventDefault();
      pressed.add(e.code);
    };
    const keyUp = (e: KeyboardEvent) => pressed.delete(e.code);
    const blur = () => pressed.clear();

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      pressed.clear();
    };
  }, [gl]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const p = pose.current;
    const k = keys.current;

    if (k.has('ArrowLeft')) p.yaw += TURN_SPEED * dt;
    if (k.has('ArrowRight')) p.yaw -= TURN_SPEED * dt;

    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (forward || strafe) {
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED) * dt;
      const norm = Math.hypot(forward, strafe);
      const sin = Math.sin(p.yaw);
      const cos = Math.cos(p.yaw);
      // Вперёд при yaw = 0 — в сторону −Z; вправо — в сторону +X.
      const x = p.x + ((-sin * forward + cos * strafe) / norm) * speed;
      const z = p.z + ((-cos * forward - sin * strafe) / norm) * speed;
      [p.x, p.z] = constrainWalk(room, x, z, BODY_RADIUS);
    }

    const floor = platformAt(room.platforms, p.x, p.z)?.height ?? 0;
    p.y += (EYE_HEIGHT + floor - p.y) * Math.min(1, dt * 10);

    camera.position.set(p.x, p.y, p.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  });

  return <PerspectiveCamera makeDefault fov={70} near={0.05} far={200} />;
}
