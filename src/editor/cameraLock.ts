// Блокировка камеры на время жеста над объектом — вариант, проверенный спайком Р6 (см. начало EditorOverlay.tsx):
// controls.enabled = false в capture-pointerdown + гашение остатка инерции в момент захвата.
import type { Camera, Vector3 } from 'three';

/** То, что нужно от makeDefault-контролов (OrbitControls из three-stdlib); state.controls типизирован как EventDispatcher. */
export interface ControlsLike {
  enabled: boolean;
  enableDamping?: boolean;
  target?: Vector3;
  update?: () => unknown;
}

export function asControls(controls: unknown): ControlsLike | null {
  return controls !== null && typeof controls === 'object' && 'enabled' in controls ? (controls as ControlsLike) : null;
}

/**
 * Гасит остаток инерции камеры: drei не вызывает update() у выключенных контролов, и без этого камера «доезжала» бы
 * после отпускания объекта. update() с enableDamping = false применяет и обнуляет накопленные дельты; позиция и цель
 * затем возвращаются на место, камера снова смотрит на цель.
 */
export function stopInertia(controls: ControlsLike, camera: Camera): void {
  if (typeof controls.update !== 'function' || !controls.target) return;
  const position = camera.position.clone();
  const target = controls.target.clone();
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  try {
    controls.update();
  } finally {
    controls.enableDamping = damping;
  }
  camera.position.copy(position);
  controls.target.copy(target);
  camera.lookAt(target);
}

/**
 * Выключает контролы камеры и возвращает функцию, которая включает их обратно (её вызывают на ЛЮБОМ пути выхода из
 * жеста). Контролов нет (режим только что сменился) → блокировать нечего, возвращается пустая функция.
 */
export function lockCamera(controls: unknown, camera: Camera): () => void {
  const found = asControls(controls);
  if (!found) return () => {};
  stopInertia(found, camera);
  found.enabled = false;
  return () => {
    found.enabled = true;
  };
}
