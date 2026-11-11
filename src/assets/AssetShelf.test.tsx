// Разметка полки без браузера: react-dom/server рендерит компонент в строку. Серверный рендер zustand читает
// начальное состояние стора (пустую библиотеку), поэтому сетка миниатюр проверяется через AssetGrid с явными props.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetMeta } from '../model/types';
import { useEditor } from '../store/editorStore';
import { AssetGrid, AssetShelf } from './AssetShelf';

const state = () => useEditor.getState();

const image: AssetMeta = {
  id: 'a_00000000000000000000000000000001',
  kind: 'image',
  name: 'плакат розыска.png',
  mime: 'image/png',
  bytes: 860_160,
  createdAt: 2,
  width: 1920,
  height: 1080,
};
const model: AssetMeta = {
  id: 'a_00000000000000000000000000000002',
  kind: 'model',
  name: 'сова.glb',
  mime: 'model/gltf-binary',
  bytes: 3_355_443,
  createdAt: 1,
  naturalSize: [1.2, 0.85, 0.5],
};

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
}

beforeEach(() => {
  state().setCameraMode('orbit');
  state().setAssets([]);
});

afterEach(() => {
  state().setCameraMode('orbit');
  state().setAssets([]);
});

describe('AssetShelf', () => {
  it('пустая библиотека: заголовок, кнопка «Загрузить…» и зона перетаскивания', () => {
    const html = renderToStaticMarkup(<AssetShelf />);
    expect(html).toContain('Мои файлы');
    expect(buttons(html)).toEqual(['Загрузить…']);
    expect(html).toContain('Перетащите сюда');
    expect(html).not.toContain('assets-grid');
  });

  it('поле выбора принимает .glb, .gltf, .png, .jpg, .jpeg, .webp и несколько файлов сразу', () => {
    const html = renderToStaticMarkup(<AssetShelf />);
    const input = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('accept=".glb,.gltf,.png,.jpg,.jpeg,.webp"');
    expect(input).toContain('multiple');
  });

  it('картинка: «На стену» и «Плашмя»; модель: «Добавить»; у каждого файла — «Удалить файл»', () => {
    const html = renderToStaticMarkup(<AssetGrid assets={[image, model]} canEdit />);
    expect(buttons(html)).toEqual(['На стену', 'Плашмя', '', 'Добавить', '']);
    expect(html.match(/title="Удалить файл"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Удалить файл плакат розыска.png"');
    expect(html).toContain('плакат розыска.png');
    expect(html).toContain('1920 × 1080 · 840 КБ');
    expect(html).toContain('сова.glb');
    expect(html).toContain('1,2 × 0,85 × 0,5 м · 3,2 МБ');
    expect(html.match(/class="assets-tile"/g)).toHaveLength(2);
  });

  it('в прогулке кнопки добавления отключены', () => {
    const enabled = renderToStaticMarkup(<AssetGrid assets={[image, model]} canEdit />);
    expect(enabled).not.toMatch(/<button[^>]*disabled[^>]*>На стену/);
    const html = renderToStaticMarkup(<AssetGrid assets={[image, model]} canEdit={false} />);
    for (const label of ['На стену', 'Плашмя', 'Добавить']) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${label}`));
    }
  });

  it('в разметке нет адресов и обработчиков, ведущих в сеть', () => {
    const html = renderToStaticMarkup(<AssetGrid assets={[image, model]} canEdit />) + renderToStaticMarkup(<AssetShelf />);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
