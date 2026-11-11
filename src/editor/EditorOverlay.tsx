// Спайк Р6: enabled=false достаточно
// Измерено в браузере (облёт и план): при controls.enabled = false в capture-pointerdown камера не сдвигается ни во
// время перетаскивания, ни после отпускания; перетаскивание пустого места по-прежнему двигает камеру. Переключать
// enableRotate / enablePan не нужно (и хуже: инерция камеры тогда продолжается прямо во время перетаскивания).
// Оговорка: если объект схвачен, пока камера ещё доезжает по инерции после своего жеста, enabled = false эту инерцию
// замораживает (drei не вызывает update() у выключенных контролов), и после отпускания камера доезжает остаток.
// Проверенное лекарство — погасить остаток в момент захвата: запомнить camera.position и controls.target, вызвать
// controls.update() с enableDamping = false (применяет и обнуляет накопленные дельты), вернуть позицию и цель,
// camera.lookAt(target).
//
// Реализация (W2): именно этот вариант — PointerController.tsx (lockCamera / stopInertia / unlockCamera).
//
// EditorOverlay — всё, что редактор добавляет внутрь Canvas:
//   всегда            — ViewProbe (с какой стороны камера смотрит на потолок и стены) и регистрация ViewportBridge
//                       (луч через центр вида для «Добавить», снимок PNG — снимок работает и в прогулке);
//   mode !== 'walk'   — PointerController (выбор и перетаскивание), Gizmo (каркасы и ручки), Guides (сетки и отвесы).
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { CameraMode, RoomDef } from '../model/types';
import { setViewportBridge } from '../store/bridge';
import type { ViewportBridge } from '../store/bridge';
import { useEditor } from '../store/editorStore';
import { Gizmo } from './Gizmo';
import { Guides } from './Guides';
import { PointerController } from './PointerController';
import { ViewProbe } from './ViewProbe';
import { rayThroughNdc } from './viewRay';

/** Шов DOM ↔ canvas: панели и действия получают луч и снимок, не зная о three.js. */
function BridgeRegistration() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    let capture: Promise<Blob | null> | null = null;

    const bridge: ViewportBridge = {
      centerRay() {
        return rayThroughNdc(get().camera, 0, 0);
      },
      capturePng() {
        // Повторный вызов во время снимка получает тот же результат, а не снимает capturing раньше времени.
        if (capture) return capture;
        const canvas = get().gl.domElement;
        useEditor.getState().setCapturing(true);
        const pending = new Promise<Blob | null>((resolve) => {
          const done = (blob: Blob | null) => {
            useEditor.getState().setCapturing(false);
            capture = null;
            resolve(blob);
          };
          // Два кадра: React убирает оверлеи редактора и маркеры ламп, затем сцена рисуется уже без них.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              try {
                canvas.toBlob(done, 'image/png');
              } catch {
                done(null);
              }
            }),
          );
        });
        capture = pending;
        return pending;
      },
    };

    setViewportBridge(bridge);
    return () => setViewportBridge(null);
  }, [get]);

  return null;
}

export function EditorOverlay(props: { room: RoomDef; mode: CameraMode }) {
  const { room, mode } = props;
  return (
    <>
      <ViewProbe room={room} mode={mode} />
      <BridgeRegistration />
      {mode !== 'walk' && (
        <>
          <PointerController mode={mode} />
          <Gizmo mode={mode} />
          <Guides room={room} mode={mode} />
        </>
      )}
    </>
  );
}
