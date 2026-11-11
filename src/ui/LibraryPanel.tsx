// Библиотека предметов (слева): поиск, карточки по группам каталога, под ними — полка пользовательских файлов (W3).
// Клик по карточке → addObject(item): предмет появляется в центре вида на своём креплении по умолчанию и выбран.
import { useMemo, useState } from 'react';
import { AssetShelf } from '../assets/AssetShelf';
import { listedItems } from '../catalog';
import type { CatalogItem } from '../catalog/types';
import { addObject } from '../store/actions';
import { useCanEdit } from '../store/selectors';
import { MOUNT_HINTS, MOUNT_LABELS } from './format';
import { Icon } from './icons';
import { groupLibrary } from './lists';
import './panels.css';

export function LibraryPanel() {
  const canEdit = useCanEdit();
  const [query, setQuery] = useState('');
  const items = useMemo(() => listedItems(), []);
  const groups = useMemo(() => groupLibrary(items, query), [items, query]);
  /** При поиске группы раскрываются заново (key), чтобы найденное не осталось в свёрнутой группе. */
  const searching = query.trim() !== '';

  return (
    <>
      <section className="panel ui-library" aria-label="Библиотека">
        <h2 className="panel-title">Библиотека</h2>
        <label className="ui-search">
          <Icon name="search" />
          <input
            type="text"
            value={query}
            placeholder="Поиск предмета"
            aria-label="Поиск предмета"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Клавиши поиска не должны доходить до горячих клавиш редактора.
              e.stopPropagation();
              if (e.code === 'Escape') setQuery('');
            }}
          />
        </label>

        {groups.length === 0 && <p className="ui-empty">Ничего не найдено</p>}
        {groups.map((group) => (
          <details key={searching ? `найдено:${group.category}` : group.category} className="ui-lib-group" open>
            <summary>
              <span className="ui-subtitle">{group.category}</span>
              <span className="ui-count">{group.items.length}</span>
            </summary>
            <ul className="ui-cards">
              {group.items.map((item) => (
                <li key={item.id}>
                  <LibraryCard item={item} disabled={!canEdit} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
      <AssetShelf />
    </>
  );
}

function LibraryCard(props: { item: CatalogItem; disabled: boolean }) {
  const { item, disabled } = props;
  const mounts = item.mounts.map((kind) => MOUNT_LABELS[kind].toLocaleLowerCase('ru')).join(', ');
  return (
    <button
      type="button"
      className="ui-card"
      disabled={disabled}
      title={`Добавить в центр вида. Крепление: ${mounts}`}
      onClick={() => addObject(item)}
    >
      <span className="ui-card-swatch" style={{ background: item.color }} aria-hidden="true" />
      <span className="ui-card-text">
        <span className="ui-card-title">{item.title}</span>
        {item.hint && <span className="ui-card-hint">{item.hint}</span>}
      </span>
      <span className="ui-card-mounts">
        {item.mounts.map((kind, index) => (
          <span key={kind} className={index === 0 ? 'ui-mount ui-mount-default' : 'ui-mount'} title={MOUNT_HINTS[kind]}>
            <Icon name={kind} size={14} />
          </span>
        ))}
      </span>
    </button>
  );
}
