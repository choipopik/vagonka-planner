import { Canvas } from '@react-three/fiber';
import { EditorOverlay } from '../editor/EditorOverlay';
import { useEditor } from '../store/editorStore';
import { useRoom } from '../store/selectors';
import { Ambience } from './Ambience';
import { OrbitMode, TopMode, WalkMode } from './controls/CameraModes';
import { RoomShell } from './RoomShell';
import { SceneObjects } from './SceneObjects';

export function Viewport() {
  const room = useRoom();
  const mode = useEditor((s) => s.cameraMode);
  const showLabels = useEditor((s) => s.showLabels);
  const ambience = useEditor((s) => s.ambience);

  return (
    // preserveDrawingBuffer нужен для кнопки «Снимок».
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }}>
      <Ambience room={room} mode={mode} ambience={ambience} />
      <RoomShell room={room} mode={mode} showLabels={showLabels} />
      <SceneObjects />
      <EditorOverlay room={room} mode={mode} />
      {/* key = помещение: при переключении камера встаёт в исходную точку. */}
      {mode === 'orbit' && <OrbitMode key={room.id} room={room} />}
      {mode === 'top' && <TopMode key={room.id} room={room} />}
      {mode === 'walk' && <WalkMode key={room.id} room={room} />}
    </Canvas>
  );
}
