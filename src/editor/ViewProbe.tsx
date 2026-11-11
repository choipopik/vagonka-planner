// Сообщает стору, с какой стороны камера смотрит на потолок и стены: от этого зависят призраки и выбор мышью (Р4).
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { wallSurfaces } from '../model/geometry';
import { backSurfaces, isViewFromAbove } from '../model/layers';
import type { CameraMode, RoomDef } from '../model/types';
import { useEditor } from '../store/editorStore';

/** Работает во всех режимах камеры (в прогулке и на плане список «изнанок» пуст). Ничего не рисует. */
export function ViewProbe({ room, mode }: { room: RoomDef; mode: CameraMode }) {
  const surfaces = useMemo(() => wallSurfaces(room), [room]);

  useFrame(({ camera }) => {
    const { x, y, z } = camera.position;
    const state = useEditor.getState();
    const above = isViewFromAbove(mode, y, room.size.height);
    if (above !== state.viewFromAbove) state.setViewFromAbove(above);
    // Стор сам отбрасывает поэлементно равный список — подписчики просыпаются только при смене состава.
    state.setBackSurfaces(backSurfaces(mode, [x, y, z], surfaces));
  });

  return null;
}
