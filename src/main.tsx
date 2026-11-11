import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { galleryObjects } from './catalog';
import { createLayout } from './model/layout';
import { startSession } from './persistence/session';
import { getRoom } from './rooms';
import { useEditor } from './store/editorStore';
import './styles.css';

if (location.hash === '#gallery') {
  // Отладочная галерея: по одному объекту каждой записи каталога вместо сохранённого макета; сессия не запускается.
  const room = getRoom(useEditor.getState().roomId);
  useEditor.getState().openLayout({ ...createLayout(room, 'Галерея'), objects: galleryObjects(room) });
} else {
  // Первый рендер не ждёт сессию: до её готовности виден макет по умолчанию.
  startSession().catch((error: unknown) => {
    console.error(error);
    useEditor.getState().notify('error', 'Не удалось открыть сохранённые макеты');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
