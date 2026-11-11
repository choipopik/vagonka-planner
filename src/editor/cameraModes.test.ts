// Тест лежит в src/editor: пакету W2 в src/scene/controls принадлежит только CameraModes.tsx.
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three-stdlib';
import { describe, expect, it } from 'vitest';
import { ORBIT_MAX_POLAR, ORBIT_MIN_CAMERA_Y, keepOrbitAboveFloor } from '../scene/controls/CameraModes';

/** Облёт, как в OrbitMode: цель (0, 1, 0), предел наклона ORBIT_MAX_POLAR, onChange = keepOrbitAboveFloor. */
function orbit(distance: number): { camera: PerspectiveCamera; controls: OrbitControls } {
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 200);
  camera.position.set(0, 1 + distance * 0.6, distance * 0.8);
  const controls = new OrbitControls(camera);
  controls.target.set(0, 1, 0);
  controls.maxPolarAngle = ORBIT_MAX_POLAR;
  controls.enableDamping = false;
  controls.addEventListener('change', keepOrbitAboveFloor);
  controls.update();
  return { camera, controls };
}

describe('OrbitMode', () => {
  it('предел наклона больше 90°: вблизи цели камера смотрит снизу вверх', () => {
    expect(ORBIT_MAX_POLAR).toBeCloseTo(1.75, 12);
    const { camera, controls } = orbit(3);
    controls.setPolarAngle(Math.PI);
    expect(controls.getPolarAngle()).toBeCloseTo(ORBIT_MAX_POLAR, 6);
    // 1 + 3·cos(1.75) ≈ 0.47: камера ниже цели, но выше пола.
    expect(camera.position.y).toBeLessThan(1);
    expect(camera.position.y).toBeGreaterThan(ORBIT_MIN_CAMERA_Y);
  });

  it('издалека камера не опускается ниже 0.3 м и продолжает смотреть на цель', () => {
    const { camera, controls } = orbit(10);
    controls.setPolarAngle(Math.PI);
    // Без ограничения было бы 1 + 10·cos(1.75) ≈ −0.78.
    expect(camera.position.y).toBeCloseTo(ORBIT_MIN_CAMERA_Y, 9);
    const toTarget = controls.target.clone().sub(camera.position).normalize();
    const forward = camera.getWorldDirection(toTarget.clone());
    expect(forward.dot(toTarget)).toBeCloseTo(1, 9);
    // Расстояние до цели сохраняется: упираясь в пол, камера не подползает к цели.
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 6);

    // Следующие кадры не «дёргают» камеру и не роняют её снова.
    const settled = camera.position.clone();
    for (let i = 0; i < 20; i++) controls.update();
    expect(camera.position.y).toBeGreaterThanOrEqual(ORBIT_MIN_CAMERA_Y - 1e-4);
    expect(camera.position.distanceTo(settled)).toBeLessThan(1e-3);

    // Камеру продолжают тянуть вниз: расстояние до цели не убывает от кадра к кадру.
    for (let i = 0; i < 20; i++) {
      controls.setPolarAngle(Math.PI);
      controls.update();
    }
    expect(camera.position.y).toBeCloseTo(ORBIT_MIN_CAMERA_Y, 6);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 4);
  });

  it('событие без контролов не бросает', () => {
    expect(() => keepOrbitAboveFloor(undefined)).not.toThrow();
  });
});
