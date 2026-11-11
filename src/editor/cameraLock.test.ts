import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three-stdlib';
import { describe, expect, it } from 'vitest';
import { asControls, lockCamera, stopInertia } from './cameraLock';

/** Настоящие OrbitControls (как у drei: без DOM-элемента) с включённым затуханием и остатком вращения. */
function spinning(): { camera: PerspectiveCamera; controls: OrbitControls } {
  const camera = new PerspectiveCamera(50, 1.5, 0.1, 200);
  camera.position.set(0, 6, 9);
  const controls = new OrbitControls(camera);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.update();
  // Просим повернуться на радиан: update() внутри применяет только долю dampingFactor, остальное — «инерция».
  controls.setAzimuthalAngle(controls.getAzimuthalAngle() + 1);
  return { camera, controls };
}

describe('stopInertia (лекарство из спайка Р6)', () => {
  it('контроль сценария: без гашения камера продолжает ехать на следующих update()', () => {
    const { camera, controls } = spinning();
    const before = camera.position.clone();
    controls.update();
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.01);
  });

  it('после гашения камера стоит на месте, сколько бы раз ни вызывался update()', () => {
    const { camera, controls } = spinning();
    const position = camera.position.clone();
    const target = controls.target.clone();
    const quaternion = camera.quaternion.clone();

    stopInertia(controls, camera);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-6);
    expect(controls.enableDamping).toBe(true);

    for (let i = 0; i < 10; i++) controls.update();
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-9);
  });

  it('контролы без update / target не трогаются', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(1, 2, 3);
    stopInertia({ enabled: true }, camera);
    stopInertia({ enabled: true, target: new Vector3() }, camera);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
  });

  it('enableDamping возвращается, даже если update() бросил', () => {
    const camera = new PerspectiveCamera();
    const controls = {
      enabled: true,
      enableDamping: true,
      target: new Vector3(),
      update: () => {
        throw new Error('boom');
      },
    };
    expect(() => stopInertia(controls, camera)).toThrow('boom');
    expect(controls.enableDamping).toBe(true);
  });
});

describe('lockCamera', () => {
  it('выключает контролы и возвращает функцию, которая включает их обратно', () => {
    const { camera, controls } = spinning();
    const position = camera.position.clone();
    const unlock = lockCamera(controls, camera);
    expect(controls.enabled).toBe(false);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
    unlock();
    expect(controls.enabled).toBe(true);
    // После разблокировки камера не «доезжает».
    for (let i = 0; i < 5; i++) controls.update();
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-6);
  });

  it('контролов нет → пустая функция', () => {
    const camera = new PerspectiveCamera();
    expect(() => lockCamera(null, camera)()).not.toThrow();
    expect(() => lockCamera(undefined, camera)()).not.toThrow();
    expect(asControls(null)).toBeNull();
    expect(asControls({})).toBeNull();
    expect(asControls({ enabled: true })).not.toBeNull();
  });
});
