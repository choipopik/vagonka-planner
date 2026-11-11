// Полка пользовательских файлов («Мои файлы», внизу библиотеки): загрузка кнопкой или перетаскиванием,
// сетка миниатюр, добавление картинки / модели в макет, удаление файла.
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { AssetMeta } from '../model/types';
import { useEditor } from '../store/editorStore';
import { useCanEdit } from '../store/selectors';
import { useAssetUrl } from './assetCache';
import { ACCEPTED_EXTENSIONS, assetCaption } from './rules';
import { addImageObject, addModelObject, removeAsset, uploadFiles } from './shelfActions';
import './assets.css';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function ImageThumb({ assetId }: { assetId: string }) {
  const url = useAssetUrl(assetId);
  return url ? <img className="assets-thumb" src={url} alt="" draggable={false} /> : <span className="assets-thumb assets-thumb-empty" aria-hidden="true" />;
}

function AssetTile({ asset, disabled }: { asset: AssetMeta; disabled: boolean }) {
  const [removing, setRemoving] = useState(false);
  const remove = () => {
    setRemoving(true);
    void removeAsset(asset.id).finally(() => setRemoving(false));
  };
  return (
    <li className="assets-tile">
      {asset.kind === 'image' ? (
        <ImageThumb assetId={asset.id} />
      ) : (
        <span className="assets-thumb assets-thumb-model" aria-hidden="true">
          3D
        </span>
      )}
      <span className="assets-name" title={asset.name}>
        {asset.name}
      </span>
      <span className="assets-caption">{assetCaption(asset)}</span>
      <span className="assets-actions">
        {asset.kind === 'image' ? (
          <>
            <button type="button" className="btn assets-btn" disabled={disabled} title="Добавить картинку стоячим листом" onClick={() => addImageObject(asset, false)}>
              На стену
            </button>
            <button type="button" className="btn assets-btn" disabled={disabled} title="Добавить картинку лежащей на полу, столе или под потолком" onClick={() => addImageObject(asset, true)}>
              Плашмя
            </button>
          </>
        ) : (
          <button type="button" className="btn assets-btn" disabled={disabled} title="Добавить модель в центр вида" onClick={() => addModelObject(asset)}>
            Добавить
          </button>
        )}
        <button
          type="button"
          className="icon-btn assets-remove"
          disabled={removing}
          title="Удалить файл"
          aria-label={`Удалить файл ${asset.name}`}
          onClick={remove}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </li>
  );
}

/** Сетка миниатюр библиотеки либо приглашение перетащить файлы, если она пуста. */
export function AssetGrid({ assets, canEdit }: { assets: readonly AssetMeta[]; canEdit: boolean }) {
  if (assets.length === 0) {
    return <p className="assets-drop">Перетащите сюда картинки (PNG, JPEG, WebP) или модели (GLB, glTF одним файлом)</p>;
  }
  return (
    <>
      <ul className="assets-grid">
        {assets.map((asset) => (
          <AssetTile key={asset.id} asset={asset} disabled={!canEdit} />
        ))}
      </ul>
      <p className="assets-hint">Файлы можно перетащить сюда</p>
    </>
  );
}

/** Полка пользовательских файлов, встраивается в LibraryPanel. */
export function AssetShelf() {
  const assets = useEditor((s) => s.assets);
  const canEdit = useCanEdit();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [over, setOver] = useState(false);

  // Файл, брошенный мимо полки, браузер открыл бы вместо приложения (несохранённая работа пропала бы):
  // вне зоны перетаскивания такой бросок просто запрещён.
  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      const transfer = event.dataTransfer;
      if (event.defaultPrevented || !transfer || !Array.from(transfer.types).includes('Files')) return;
      event.preventDefault();
      transfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  const upload = (files: readonly File[]) => {
    if (files.length === 0) return;
    setPending((n) => n + 1);
    void uploadFiles(files).finally(() => setPending((n) => n - 1));
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    // Переход на вложенный элемент — не выход из зоны.
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOver(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setOver(false);
    upload(Array.from(event.dataTransfer.files));
  };

  const busy = pending > 0;
  return (
    <section
      className={over ? 'panel assets-shelf is-over' : 'panel assets-shelf'}
      aria-label="Мои файлы"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="row assets-head">
        <h2 className="panel-title">Мои файлы</h2>
        <button type="button" className="btn assets-upload" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Загрузка…' : 'Загрузить…'}
        </button>
        <input
          ref={input}
          className="assets-input"
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            upload(Array.from(event.target.files ?? []));
            // Тот же файл можно выбрать повторно.
            event.target.value = '';
          }}
        />
      </div>

      <AssetGrid assets={assets} canEdit={canEdit} />
    </section>
  );
}
