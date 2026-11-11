// Шов DOM ↔ canvas (регистрирует EditorOverlay из W2).
import type { Ray } from '../model/types';

export interface ViewportBridge {
  /** Луч через центр вьюпорта текущей камеры. */
  centerRay(): Ray | null;
  /** setCapturing(true) → два requestAnimationFrame → canvas.toBlob('image/png') → setCapturing(false). */
  capturePng(): Promise<Blob | null>;
}

let current: ViewportBridge | null = null;

export function setViewportBridge(bridge: ViewportBridge | null): void {
  current = bridge;
}

export function viewportBridge(): ViewportBridge | null {
  return current;
}
