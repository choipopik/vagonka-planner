// Все объекты макета: по одному мемоизированному ObjectView на id. Обработчиков указателя на мешах нет —
// выбор и перетаскивание делает аналитический пикер редактора (src/editor).
import { useEffect } from 'react';
import { watchAssetLibrary } from '../assets/assetCache';
import { useObjectIds } from '../store/selectors';
import { ObjectView } from './objects/ObjectView';

/** Все объекты макета. */
export function SceneObjects() {
  const ids = useObjectIds();
  // Файл, появившийся в библиотеке после того, как объект нарисован заглушкой (импорт макета, повторная загрузка),
  // перечитывается из хранилища.
  useEffect(() => watchAssetLibrary(), []);
  return (
    <>
      {ids.map((id) => (
        <ObjectView key={id} id={id} />
      ))}
    </>
  );
}
