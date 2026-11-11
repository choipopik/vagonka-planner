// Действия полки «Мои файлы» без React и DOM: загрузка пачки файлов, удаление файла, добавление объектов.
import { getItem } from '../catalog';
import type { AssetMeta } from '../model/types';
import { repository } from '../persistence/index';
import { assetUsage } from '../persistence/session';
import { addObject } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { defaultModelSize } from './gltf';
import { importAsset } from './importAsset';
import { imageObjectSize, objectNameOf, uploadFailureMessage, usageMessage } from './rules';

export const SHELF_ERRORS = {
  upload: 'Не удалось загрузить файл',
  remove: 'Не удалось удалить файл',
  notImage: 'Этот файл — не картинка',
  notModel: 'Этот файл — не модель',
} as const;

export const SHELF_NOTES = {
  rescaled: 'Размеры модели в файле не похожи на метры — она вписана в 1 м. Размер можно поменять в свойствах',
} as const;

function notifyError(text: string): void {
  useEditor.getState().notify('error', text);
}

/** Загружает файлы по очереди; все отказы — одним тостом. Возвращает загруженные файлы. */
export async function uploadFiles(files: readonly File[]): Promise<AssetMeta[]> {
  const loaded: AssetMeta[] = [];
  const failures: { name: string; message: string }[] = [];
  for (const file of files) {
    try {
      loaded.push(await importAsset(file));
    } catch (error) {
      failures.push({ name: file.name, message: error instanceof Error && error.message ? error.message : SHELF_ERRORS.upload });
    }
  }
  if (failures.length > 0) notifyError(uploadFailureMessage(failures));
  return loaded;
}

/**
 * «Удалить файл»: если файл используется в текущем или сохранённых макетах — отказ с их перечислением;
 * иначе repository.removeAsset + setAssets. Возвращает true, если файл удалён.
 */
export async function removeAsset(assetId: string): Promise<boolean> {
  try {
    const usage = await assetUsage(assetId);
    if (usage.length > 0) {
      notifyError(usageMessage(usage));
      return false;
    }
    await repository.removeAsset(assetId);
    const state = useEditor.getState();
    state.setAssets(state.assets.filter((asset) => asset.id !== assetId));
    return true;
  } catch {
    notifyError(SHELF_ERRORS.remove);
    return false;
  }
}

/** «На стену» (image) и «Плашмя» (image.flat): ширина 1 м, вторая сторона — по пропорциям файла. Возвращает id объекта. */
export function addImageObject(asset: AssetMeta, flat: boolean): string | null {
  if (asset.kind !== 'image') {
    notifyError(SHELF_ERRORS.notImage);
    return null;
  }
  return addObject(getItem(flat ? 'image.flat' : 'image'), {
    assetId: asset.id,
    name: objectNameOf(asset.name, 'Картинка'),
    size: imageObjectSize(asset.width, asset.height, flat),
  });
}

/** «Добавить» (model): размер — defaultModelSize(naturalSize). Возвращает id объекта. */
export function addModelObject(asset: AssetMeta): string | null {
  if (asset.kind !== 'model') {
    notifyError(SHELF_ERRORS.notModel);
    return null;
  }
  const natural = asset.naturalSize;
  const { size, rescaled } = defaultModelSize(natural ?? [1, 1, 1]);
  const id = addObject(getItem('model'), { assetId: asset.id, name: objectNameOf(asset.name, '3D-модель'), size });
  // Модель в сантиметрах или дюймах встала бы размером с зал (или с булавку): о подгонке лучше сказать.
  if (id !== null && natural && rescaled) useEditor.getState().notify('info', SHELF_NOTES.rescaled);
  return id;
}
