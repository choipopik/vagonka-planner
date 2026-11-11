// Панель инструментов: помещение, макеты (W4), камера, слой, сетка, атмосфера, отмена/повтор, мебель, снимок, подписи.
// Макет меняют только действия стора (undo / redo / resetFurniture) и switchRoom; остальное — настройки вида.
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AMBIENCES } from '../model/lights';
import type { AmbienceId, CameraMode, LayerMode } from '../model/types';
import { LayoutsMenu } from '../persistence/LayoutsMenu';
import { switchRoom } from '../persistence/session';
import { rooms } from '../rooms';
import { resetFurniture } from '../store/actions';
import { viewportBridge } from '../store/bridge';
import { useEditor } from '../store/editorStore';
import { useCanEdit, useRoom } from '../store/selectors';
import { CheckField, Segmented } from './fields';
import { snapshotFileName } from './format';
import { useVenueDirty } from './hooks';
import './panels.css';

const CAMERA_MODES: readonly { value: CameraMode; label: string; title: string }[] = [
  { value: 'orbit', label: 'Облёт', title: 'Вид снаружи: вращение вокруг зала' },
  { value: 'top', label: 'План', title: 'Вид сверху' },
  { value: 'walk', label: 'Прогулка', title: 'Вид глазами гостя; редактирование отключено' },
];

const LAYER_HINT = 'Авто: при виде сверху потолочный декор полупрозрачен';

const LAYERS: readonly { value: LayerMode; label: string; title: string }[] = [
  { value: 'auto', label: 'Авто', title: LAYER_HINT },
  { value: 'floor', label: 'Пол', title: 'Пол: потолочный декор полупрозрачен и не мешает выбирать то, что под ним' },
  { value: 'ceiling', label: 'Потолок', title: 'Потолок: выбирается и двигается только потолочный декор' },
];

const AMBIENCE_IDS: readonly AmbienceId[] = ['work', 'party'];
const AMBIENCE_OPTIONS = AMBIENCE_IDS.map((id) => ({ value: id, label: AMBIENCES[id].title }));

/** Скачивание файла: временная ссылка на Blob; URL освобождается после того, как браузер начал загрузку. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Toolbar() {
  const room = useRoom();
  const canEdit = useCanEdit();
  const venueDirty = useVenueDirty();
  const view = useEditor(
    useShallow((s) => ({
      cameraMode: s.cameraMode,
      layer: s.layer,
      gridSnap: s.gridSnap,
      showLabels: s.showLabels,
      ambience: s.ambience,
      undoLabel: s.history.past.length > 0 ? s.history.past[s.history.past.length - 1].label : null,
      redoLabel: s.history.future.length > 0 ? s.history.future[s.history.future.length - 1].label : null,
    })),
  );
  const actions = useEditor(
    useShallow((s) => ({
      setCameraMode: s.setCameraMode,
      setLayer: s.setLayer,
      setGridSnap: s.setGridSnap,
      toggleLabels: s.toggleLabels,
      setAmbience: s.setAmbience,
      undo: s.undo,
      redo: s.redo,
    })),
  );
  const [capturing, setCapturing] = useState(false);
  const { length, width, height } = room.size;

  const snapshot = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const blob = (await viewportBridge()?.capturePng()) ?? null;
      const state = useEditor.getState();
      if (blob) downloadBlob(blob, snapshotFileName(state.layout.name, new Date()));
      else state.notify('warn', 'Не удалось сделать снимок');
    } catch {
      useEditor.getState().notify('error', 'Не удалось сделать снимок');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <header className="toolbar">
      <span className="brand">Vagonka · планировщик</span>

      <label className="field">
        <span>Помещение</span>
        <select value={room.id} onChange={(e) => void switchRoom(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <LayoutsMenu />

      <Segmented label="Режим камеры" options={CAMERA_MODES} value={view.cameraMode} onChange={actions.setCameraMode} />

      <div className="field" title={LAYER_HINT}>
        <span>Слой</span>
        <Segmented label="Слой" options={LAYERS} value={view.layer} onChange={actions.setLayer} disabled={!canEdit} />
      </div>

      <CheckField
        label="Сетка 10 см"
        title="Привязка к сетке 10 см при перетаскивании и добавлении (клавиша G)"
        checked={view.gridSnap}
        disabled={!canEdit}
        onChange={actions.setGridSnap}
      />

      <Segmented
        label="Атмосфера"
        title="Освещение сцены; на плане всегда рабочий свет"
        options={AMBIENCE_OPTIONS}
        value={view.ambience}
        onChange={actions.setAmbience}
      />

      <div className="ui-tool-group" role="group" aria-label="История">
        <button
          type="button"
          className="btn ui-btn-glyph"
          disabled={!canEdit || view.undoLabel === null}
          aria-label="Отменить"
          title={view.undoLabel === null ? 'Отменить (Ctrl+Z)' : `Отменить: ${view.undoLabel} (Ctrl+Z)`}
          onClick={actions.undo}
        >
          ↶
        </button>
        <button
          type="button"
          className="btn ui-btn-glyph"
          disabled={!canEdit || view.redoLabel === null}
          aria-label="Повторить"
          title={view.redoLabel === null ? 'Повторить (Ctrl+Shift+Z)' : `Повторить: ${view.redoLabel} (Ctrl+Shift+Z)`}
          onClick={actions.redo}
        >
          ↷
        </button>
      </div>

      <button
        type="button"
        className="btn"
        disabled={!canEdit || !venueDirty}
        title="Вернуть мебель площадки в исходную расстановку (один шаг отмены)"
        onClick={resetFurniture}
      >
        Сбросить мебель
      </button>

      <button type="button" className="btn" disabled={capturing} title="Сохранить картинку текущего вида (PNG)" onClick={() => void snapshot()}>
        Снимок
      </button>

      <CheckField label="Подписи" checked={view.showLabels} onChange={actions.toggleLabels} />

      <span className="dims" title="Размеры оценены по фото и могут отличаться от реальных">
        ≈ {length} × {width} м, потолок {height} м
      </span>
    </header>
  );
}
