// Дымовой тест панелей без браузера: статическая разметка (react-dom/server) на настоящем сторе. Проверяет, что
// панели рисуются для каждого крепления и типа параметров и показывают нужные поля; вид и поведение — у интегратора.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, listedItems } from '../catalog';
import { createLayout } from '../model/layout';
import { MAX_LIGHTS } from '../model/lights';
import type { MountKind } from '../model/types';
import { getRoom, rooms } from '../rooms';
import { addObject, patchObject, setObjectMount } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { getObject } from '../store/selectors';
import { LibraryPanel } from './LibraryPanel';
import { ObjectList } from './ObjectList';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';

// Соседние пакеты (W3, W4) в этом тесте не участвуют.
vi.mock('../assets/AssetShelf', () => ({ AssetShelf: () => null }));
vi.mock('../persistence/LayoutsMenu', () => ({ LayoutsMenu: () => null }));
vi.mock('../persistence/session', () => ({ switchRoom: () => Promise.resolve() }));

const state = () => useEditor.getState();

/**
 * Статическая разметка при ТЕКУЩЕМ состоянии стора. Серверный рендер zustand читает getInitialState(), поэтому перед
 * рендером текущее состояние копируется в объект начального (он один и тот же на всё время жизни стора).
 */
function render(element: ReactElement): string {
  Object.assign(useEditor.getInitialState(), state());
  return renderToStaticMarkup(element);
}

/** Добавляет предмет каталога (он становится выбранным) и, если нужно, перевешивает. */
function add(type: string, mount?: MountKind): string {
  const id = addObject(getItem(type));
  if (id === null) throw new Error(`не удалось добавить ${type}`);
  if (mount) {
    setObjectMount(id, mount);
    expect(getObject(id)?.mount.kind).toBe(mount);
  }
  return id;
}

const properties = () => render(<PropertiesPanel />);

beforeEach(() => {
  state().setCameraMode('orbit');
  state().openLayout(createLayout(getRoom(rooms[0].id)));
});

describe('PropertiesPanel', () => {
  it('без выбора — «Ничего не выбрано»', () => {
    expect(properties()).toContain('Ничего не выбрано');
  });

  it('пол: X, Z, высота над полом, поворот, размер, цвет, кнопки', () => {
    add('box');
    const html = properties();
    for (const text of ['Имя', 'Крепление', 'X, м', 'Z, м', 'Высота над полом, м', 'Поворот, °', 'Размер Ш × В × Г, м', 'Цвет']) {
      expect(html).toContain(text);
    }
    for (const text of ['Заблокировать', 'Скрыть', 'Дублировать', 'Удалить']) expect(html).toContain(text);
    // Сегменты крепления — только из item.mounts ящика: пол, стол, потолок.
    expect(html).toContain('>Пол<');
    expect(html).toContain('>Стол<');
    expect(html).toContain('>Потолок<');
    expect(html).not.toContain('>Стена<');
  });

  it('потолок: опуск и «низ на высоте»', () => {
    add('box', 'ceiling');
    const html = properties();
    expect(html).toContain('Опуск от потолка, м');
    expect(html).toContain('Низ на высоте');
    expect(html).toContain('Поворот, °');
    expect(html).not.toContain('Высота над полом, м');
  });

  it('потолок: предупреждение, когда низ ниже роста', () => {
    const id = add('box', 'ceiling');
    const o = getObject(id);
    if (o?.mount.kind !== 'ceiling') throw new Error('ожидалось потолочное крепление');
    patchObject(id, { mount: { ...o.mount, drop: 1.5 } }, 'Опуск от потолка');
    expect(properties()).toContain('гости могут задеть головой');
  });

  it('стена: поверхность, от левого края, низ, верх; поворота нет', () => {
    add('panel');
    const html = properties();
    for (const text of ['Поверхность', 'От левого края, м', 'Низ над полом, м', 'Верх: ']) expect(html).toContain(text);
    expect(html).not.toContain('Поворот, °');
  });

  it('стол: «Стоит на» и «Снять на пол»', () => {
    const id = add('box', 'surface');
    const o = getObject(id);
    const host = o?.mount.kind === 'surface' ? getObject(o.mount.hostId) : undefined;
    const html = properties();
    expect(host).toBeDefined();
    expect(html).toContain(`Стоит на: ${host?.name}`);
    expect(html).toContain('Снять на пол');
    expect(html).toContain('Поворот, °');
  });

  it('прожектор: параметры каталога и подпись наклона по креплению', () => {
    const id = add('light.spot');
    expect(getObject(id)?.mount.kind).toBe('ceiling');
    let html = properties();
    for (const def of getItem('light.spot').params) expect(html).toContain(def.label);
    expect(html).toContain('0° — строго вниз');
    expect(html).toContain('Размер этого предмета не меняется');

    setObjectMount(id, 'floor');
    expect(properties()).toContain('0° — строго вверх');
    setObjectMount(id, 'wall');
    html = properties();
    expect(html).toContain('0° — от стены, 90° — вниз');
  });

  it('лампа за лимитом помечена', () => {
    let last = '';
    for (let i = 0; i <= MAX_LIGHTS; i++) last = add('light.point');
    expect(state().selectedId).toBe(last);
    expect(properties()).toContain(`выключена: лимит ${MAX_LIGHTS}`);
    expect(render(<ObjectList />)).toContain('выкл');
  });

  it('заблокированный объект: поля выключены, пояснение показано', () => {
    const id = add('box');
    patchObject(id, { locked: true }, 'Заблокировать');
    const html = properties();
    expect(html).toContain('Объект заблокирован');
    expect(html).toContain('Разблокировать');
  });

  it('каждая запись библиотеки рисуется со всеми своими параметрами', () => {
    for (const item of listedItems()) {
      const id = addObject(item);
      expect(id, item.id).not.toBeNull();
      const html = properties();
      expect(html, item.id).toContain(item.title);
      for (const def of item.params) expect(html, `${item.id}.${def.key}`).toContain(def.type === 'seed' ? 'Перемешать' : def.label);
      if (item.colorable === false) expect(html, item.id).not.toContain('>Цвет<');
    }
  });

  it('мебель площадки: подсказка про «Сбросить мебель»', () => {
    const venue = state().layout.objects.find((o) => o.origin === 'venue');
    if (!venue) throw new Error('в помещении нет мебели площадки');
    state().select(venue.id);
    expect(properties()).toContain('Сбросить мебель');
  });
});

describe('ObjectList', () => {
  it('две группы; декор показан по имени', () => {
    const id = add('box');
    patchObject(id, { name: 'Сундук с мантиями' }, 'Имя');
    const html = render(<ObjectList />);
    expect(html).toContain('Декор');
    expect(html).toContain('Мебель площадки');
    expect(html).toContain('Сундук с мантиями');
    expect(html).toContain('aria-selected="true"');
  });

  it('пустой декор — подсказка', () => {
    expect(render(<ObjectList />)).toContain('добавьте предметы из библиотеки');
  });
});

describe('LibraryPanel', () => {
  it('показывает все записи библиотеки по группам', () => {
    const html = render(<LibraryPanel />);
    for (const item of listedItems()) {
      expect(html).toContain(item.title);
      expect(html).toContain(item.category);
    }
    expect(html).not.toContain('disabled');
  });

  it('в прогулке карточки выключены', () => {
    state().setCameraMode('walk');
    expect(render(<LibraryPanel />)).toContain('disabled');
  });
});

describe('Toolbar', () => {
  it('показывает все группы', () => {
    const html = render(<Toolbar />);
    for (const text of ['Помещение', 'Облёт', 'План', 'Прогулка', 'Слой', 'Авто', 'Сетка 10 см', 'Рабочий свет', 'Вечеринка', 'Сбросить мебель', 'Снимок', 'Подписи']) {
      expect(html).toContain(text);
    }
    expect(html).toContain(rooms[0].name);
  });

  it('отмена включается после правки и выключена в прогулке', () => {
    const undo = (html: string) => /<button[^>]*aria-label="Отменить"[^>]*>/.exec(html)?.[0] ?? '';
    expect(undo(render(<Toolbar />))).toContain('disabled');
    add('box');
    const html = render(<Toolbar />);
    expect(undo(html)).not.toContain('disabled');
    expect(undo(html)).toContain('Добавить: ');
    state().setCameraMode('walk');
    expect(undo(render(<Toolbar />))).toContain('disabled');
  });
});
