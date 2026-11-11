import { Hud } from './editor/Hud';
import { useShortcuts } from './editor/shortcuts';
import { Viewport } from './scene/Viewport';
import { useEditor } from './store/editorStore';
import { useCanEdit } from './store/selectors';
import { LibraryPanel } from './ui/LibraryPanel';
import { ObjectList } from './ui/ObjectList';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Toolbar } from './ui/Toolbar';

/** Сетка приложения: toolbar / (left | viewport | right) / hint; тост поверх. */
export function App() {
  useShortcuts();
  const notice = useEditor((s) => s.notice);
  const canEdit = useCanEdit();
  const sideClass = canEdit ? 'side' : 'side is-disabled';
  // Подпись рисуют стили (.side.is-disabled::before) из data-атрибута: пустая панель-заглушка остаётся :empty и скрыта.
  const sideNote = canEdit ? undefined : 'В режиме прогулки редактирование отключено';

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <aside className={`${sideClass} side-left`} inert={!canEdit} data-note={sideNote}>
          <LibraryPanel />
        </aside>
        <main className="viewport">
          <Viewport />
        </main>
        <aside className={`${sideClass} side-right`} inert={!canEdit} data-note={sideNote}>
          <PropertiesPanel />
          <ObjectList />
        </aside>
      </div>
      <footer className="hint">
        <Hud />
      </footer>
      {notice && (
        <div className={`toast toast-${notice.level}`} role="status">
          {notice.text}
        </div>
      )}
    </div>
  );
}
