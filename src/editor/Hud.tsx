// Строка-подсказка в подвале под вьюпортом. Живых чисел перетаскивания здесь нет: их показывает панель свойств
// (её поля читают объект, слитый с draft).
import type { CameraMode } from '../model/types';
import { useEditor } from '../store/editorStore';
import './editor.css';

const hints: Record<CameraMode, string> = {
  orbit: 'Клик — выбрать · тянуть объект — двигать · тянуть фон — вращать · правая кнопка — сдвиг · колесо — масштаб',
  top: 'Клик — выбрать · тянуть объект — двигать · тянуть фон — сдвиг плана · колесо — масштаб',
  walk: 'W A S D — ходить · ← → или мышь с зажатой кнопкой — осматриваться · Shift — быстрее',
};

/** DOM, в подвале под вьюпортом. */
export function Hud() {
  const mode = useEditor((s) => s.cameraMode);
  return <span className="hud-hint">{hints[mode]}</span>;
}
