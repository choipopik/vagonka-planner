// Список объектов макета (справа снизу): «Декор» и «Мебель площадки». Клик выбирает; кнопки строки — обычные
// действия стора (patchObject / duplicateObject / deleteObject), то же, что в панели свойств.
import { memo, useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { MAX_LIGHTS } from '../model/lights';
import { deleteObject, duplicateObject, patchObject, resetFurniture } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { useActiveLightIds, useCanEdit, useObject } from '../store/selectors';
import { MOUNT_HINTS } from './format';
import { useObjectListModel, useVenueDirty } from './hooks';
import { Icon } from './icons';
import type { ListRow } from './lists';
import './panels.css';

export function ObjectList() {
  const model = useObjectListModel();
  const selectedId = useEditor((s) => s.selectedId);
  const activeLights = useActiveLightIds();
  const canEdit = useCanEdit();
  const venueDirty = useVenueDirty();

  const group = (rows: readonly ListRow[]) =>
    rows.map((row) => (
      <ObjectRow key={row.id} row={row} selected={row.id === selectedId} activeLights={activeLights} canEdit={canEdit} />
    ));

  return (
    <section className="panel ui-objects" aria-label="Объекты макета">
      <div className="ui-group-head">
        <h2 className="panel-title">Декор</h2>
        <span className="ui-count">{model.decor.length}</span>
      </div>
      {model.decor.length > 0 ? (
        <ul className="list ui-rows" role="listbox" aria-label="Декор">
          {group(model.decor)}
        </ul>
      ) : (
        <p className="ui-empty">Пока пусто — добавьте предметы из библиотеки слева.</p>
      )}

      <div className="ui-group-head">
        <h2 className="panel-title">Мебель площадки</h2>
        <span className="ui-count">{model.venue.length}</span>
        <button
          type="button"
          className="btn ui-btn-small ui-push"
          disabled={!canEdit || !venueDirty}
          title="Вернуть мебель площадки в исходную расстановку (один шаг отмены)"
          onClick={resetFurniture}
        >
          Сбросить мебель
        </button>
      </div>
      {model.venue.length > 0 ? (
        <ul className="list ui-rows" role="listbox" aria-label="Мебель площадки">
          {group(model.venue)}
        </ul>
      ) : (
        <p className="ui-empty">В этом помещении нет мебели площадки.</p>
      )}
    </section>
  );
}

/** Клик по кнопке строки не должен выбирать строку. */
function inRow(action: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    action();
  };
}

const ObjectRow = memo(function ObjectRow(props: {
  row: ListRow;
  selected: boolean;
  activeLights: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const { row, selected, activeLights, canEdit } = props;
  const o = useObject(row.id);
  const ref = useRef<HTMLLIElement>(null);

  // Выбранная (в том числе кликом в сцене) строка прокручивается в видимую область списка.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!o) return null;

  const id = o.id;
  const select = () => useEditor.getState().select(id);
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return; // клавиши кнопок строки — их собственные
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      select();
    }
  };

  const lightOff = o.kind === 'light' && o.visible && !activeLights.has(id);
  const className = [row.depth === 1 ? 'ui-row ui-row-child' : 'ui-row', o.visible ? '' : 'ui-row-hidden'].filter(Boolean).join(' ');

  return (
    <li ref={ref} className={className} role="option" aria-selected={selected} tabIndex={0} onClick={select} onKeyDown={onKeyDown}>
      <span className="ui-row-mount" title={MOUNT_HINTS[o.mount.kind]}>
        <Icon name={o.mount.kind} />
      </span>
      <span className="ui-row-name" title={o.name}>
        {o.name || '(без имени)'}
        {row.hostId !== null && <HostNote hostId={row.hostId} />}
      </span>
      {lightOff && (
        <span className="ui-badge ui-badge-warn" title={`Выключена: одновременно светят только первые ${MAX_LIGHTS} источников`}>
          выкл
        </span>
      )}
      <button
        type="button"
        className="icon-btn ui-row-btn"
        aria-pressed={!o.visible}
        aria-label={o.visible ? 'Скрыть' : 'Показать'}
        title={o.visible ? 'Скрыть' : 'Показать'}
        disabled={!canEdit}
        onClick={inRow(() => patchObject(id, { visible: !o.visible }, o.visible ? 'Скрыть' : 'Показать'))}
      >
        <Icon name={o.visible ? 'eye' : 'eyeOff'} />
      </button>
      <button
        type="button"
        className="icon-btn ui-row-btn"
        aria-pressed={o.locked}
        aria-label={o.locked ? 'Разблокировать' : 'Заблокировать'}
        title={o.locked ? 'Разблокировать' : 'Заблокировать'}
        disabled={!canEdit}
        onClick={inRow(() => patchObject(id, { locked: !o.locked }, o.locked ? 'Разблокировать' : 'Заблокировать'))}
      >
        <Icon name={o.locked ? 'lock' : 'unlock'} />
      </button>
      <button
        type="button"
        className="icon-btn ui-row-btn ui-row-extra"
        aria-label="Дублировать"
        title="Дублировать"
        disabled={!canEdit}
        onClick={inRow(() => duplicateObject(id))}
      >
        <Icon name="copy" />
      </button>
      <button
        type="button"
        className="icon-btn ui-row-btn ui-row-extra"
        aria-label="Удалить"
        title={o.origin === 'venue' ? 'Убрать (мебель площадки скрывается, а не удаляется)' : 'Удалить'}
        disabled={!canEdit || o.locked}
        onClick={inRow(() => deleteObject(id))}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
});

/** «на: ‹имя хозяина›» — для декора, стоящего на мебели площадки (хозяин показан в другой группе). */
function HostNote(props: { hostId: string }) {
  const host = useObject(props.hostId);
  if (!host) return null;
  return <span className="ui-row-host"> · на: {host.name}</span>;
}
