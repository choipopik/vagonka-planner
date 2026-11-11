// Дымовая проверка рендера без WebGL: react-dom/server исполняет компоненты сцены и печатает их дерево как разметку
// (элементы three становятся тегами). Проверяется структура дерева, а не картинка: её смотрит интегратор в браузере.
import type { ReactElement } from 'react';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, partsOf } from '../../catalog';
import { createObject } from '../../model/ops';
import type { Mount, SceneObject } from '../../model/types';
import { useEditor } from '../../store/editorStore';
import { SceneObjects } from '../SceneObjects';
import { FlatImage, ImageBody, StandingImage } from './ImageBody';
import type { ImageLayoutProps } from './ImageBody';
import { LightBody } from './LightBody';
import { ModelBody, ModelInstance } from './ModelBody';
import { ObjectView } from './ObjectView';
import { groupParts } from './partGroups';
import { PartsBody } from './PartsBody';
import { Placeholder } from './Placeholder';

const FLOOR: Mount = { kind: 'floor', x: 0, z: 0, lift: 0 };
const CEILING: Mount = { kind: 'ceiling', x: 0, z: 0, drop: 0.5 };
const WALL: Mount = { kind: 'wall', surfaceId: 'none', along: 1, bottom: 1 };

function make(type: string, mount: Mount = FLOOR, over: Partial<SceneObject> = {}): SceneObject {
  return { ...createObject(getItem(type), mount), ...over };
}

function count(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  // React DOM не знает элементов three и предупреждает о регистре тегов и нестроковых атрибутах — здесь это ожидаемо.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PartsBody', () => {
  it('число instancedMesh = groupParts(partsOf(o)).length — для каждой записи каталога площадки и фигур', () => {
    for (const type of ['sofa', 'sofaU', 'table', 'highTable', 'phoneBooth', 'barrier', 'floorLamp', 'box', 'cylinder', 'sphere', 'cone', 'panel']) {
      const object = make(type);
      const groups = groupParts(partsOf(object), false);
      expect(groups.length).toBeGreaterThan(0);
      expect(count(render(<PartsBody object={object} ghost={false} />), 'instancedMesh')).toBe(groups.length);
    }
  });

  it('пресет с параметрами: групп меньше, чем частей (части собраны в инстансы)', () => {
    const object = make('pendantBulbs', CEILING, { params: { count: 8 } });
    const parts = partsOf(object);
    const groups = groupParts(parts, false);
    expect(parts.length).toBeGreaterThan(groups.length);
    expect(count(render(<PartsBody object={object} ghost={false} />), 'instancedMesh')).toBe(groups.length);
  });

  it('призрак: то же число мешей, все — с renderOrder выше сплошных', () => {
    const object = make('sofaU');
    const solid = render(<PartsBody object={object} ghost={false} />);
    const ghost = render(<PartsBody object={object} ghost />);
    expect(count(ghost, 'instancedMesh')).toBe(count(solid, 'instancedMesh'));
    expect(solid).toContain('renderOrder="0"');
    expect(ghost).not.toContain('renderOrder="0"');
  });
});

describe('ImageBody / ModelBody: нет файла', () => {
  it('картинка без assetId → заглушка (пунктирный бокс)', () => {
    const html = render(<ImageBody object={make('image', WALL)} ghost={false} />);
    expect(count(html, 'lineSegments')).toBe(1);
    expect(count(html, 'mesh')).toBe(0);
  });

  it('модель без assetId → заглушка', () => {
    const html = render(<ModelBody object={make('model')} ghost={false} />);
    expect(count(html, 'lineSegments')).toBe(1);
    expect(count(html, 'primitive')).toBe(0);
  });

  it('файл ещё читается → не рисуется ничего', () => {
    const assetId = 'a_0123456789abcdef0123456789abcdef';
    expect(render(<ImageBody object={make('image', WALL, { assetId })} ghost={false} />)).toBe('');
    expect(render(<ModelBody object={make('model', FLOOR, { assetId })} ghost={false} />)).toBe('');
  });

  it('Placeholder рисуется и призраком', () => {
    expect(count(render(<Placeholder size={[1, 2, 0.5]} ghost />), 'lineSegments')).toBe(1);
  });
});

describe('раскладки картинки (текстура уже загружена)', () => {
  function layout(over: Partial<ImageLayoutProps> = {}, alpha = false): ImageLayoutProps {
    const texture = new Texture();
    texture.userData.hasAlpha = alpha;
    return { texture, size: [1, 0.5, 0.02], mount: 'wall', drop: 0, tint: '#ffffff', glow: false, ghost: false, shadows: true, ...over };
  }

  it('стена: лист и тёмная подложка; PNG / WebP — только лист', () => {
    expect(count(render(<StandingImage {...layout()} />), 'mesh')).toBe(2);
    expect(count(render(<StandingImage {...layout({}, true)} />), 'mesh')).toBe(1);
  });

  it('пол: лист, подложка, две ножки и два подкоса; стол — без подкосов', () => {
    expect(count(render(<StandingImage {...layout({ mount: 'floor' })} />), 'mesh')).toBe(6);
    expect(count(render(<StandingImage {...layout({ mount: 'surface' })} />), 'mesh')).toBe(4);
  });

  it('потолок: один лист и две нити до потолка (нитей нет, если объект прижат к потолку)', () => {
    expect(count(render(<StandingImage {...layout({ mount: 'ceiling', drop: 0.6 })} />), 'mesh')).toBe(3);
    expect(count(render(<StandingImage {...layout({ mount: 'ceiling', drop: 0 })} />), 'mesh')).toBe(1);
  });

  it('плашмя: лист лицом вверх, под потолком — лицом вниз', () => {
    const flat = layout({ size: [1, 0.02, 0.5], mount: 'floor' });
    const up = render(<FlatImage {...flat} />);
    expect(count(up, 'mesh')).toBe(2);
    expect(up).toContain(`rotation="${-Math.PI / 2},0,0"`);
    const down = render(<FlatImage {...flat} mount="ceiling" />);
    expect(down).toContain(`rotation="${Math.PI / 2},0,0"`);
    expect(count(render(<FlatImage {...flat} mount="ceiling" drop={0.5} />), 'mesh')).toBe(2 + 4);
  });

  it('glow → MeshBasicMaterial, иначе MeshStandardMaterial', () => {
    const lit = render(<StandingImage {...layout({}, true)} />);
    expect(count(lit, 'meshStandardMaterial')).toBe(1);
    expect(count(lit, 'meshBasicMaterial')).toBe(0);
    const glow = render(<StandingImage {...layout({ glow: true }, true)} />);
    expect(count(glow, 'meshBasicMaterial')).toBe(1);
    expect(count(glow, 'meshStandardMaterial')).toBe(0);
  });

  it('призрак: и лист, и подложка прозрачны на 30 %', () => {
    const html = render(<StandingImage {...layout({ ghost: true, shadows: false })} />);
    expect((html.match(/opacity="0.3"/g) ?? []).length).toBe(2);
    expect(render(<StandingImage {...layout()} />)).not.toContain('opacity="0.3"');
  });
});

describe('ModelInstance', () => {
  function scene(): Group {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 4, 1), new MeshBasicMaterial());
    mesh.position.set(3, 2, -1);
    root.add(mesh);
    // Как записывает assetCache при разборе: габариты и центр основания.
    root.userData.modelBounds = { size: [2, 4, 1], base: [3, 0, -1] };
    return root;
  }

  it('модель вписывается в size и переносится началом координат в центр основания', () => {
    const html = render(<ModelInstance scene={scene()} size={[1, 2, 0.5]} ghost={false} shadows />);
    expect(html).toContain('<group scale="0.5,0.5,0.5">');
    expect(html).toContain('<group position="-3,0,1">');
    expect(count(html, 'primitive')).toBe(1);
  });

  it('неравномерный размер — свой коэффициент по каждой оси; плоская ось модели не масштабируется', () => {
    expect(render(<ModelInstance scene={scene()} size={[4, 2, 3]} ghost={false} shadows />)).toContain('<group scale="2,0.5,3">');
    const flat = scene();
    flat.userData.modelBounds = { size: [2, 0, 1], base: [0, 0, 0] };
    expect(render(<ModelInstance scene={flat} size={[1, 0.3, 1]} ghost={false} shadows />)).toContain('<group scale="0.5,1,1">');
  });
});

describe('LightBody', () => {
  const light = (type: string, mount: Mount) => make(type, mount, { id: 'venue-test-light' });

  it('лампа вне макета не активна: только маркер, источника света нет', () => {
    const html = render(<LightBody object={light('light.point', FLOOR)} ghost={false} />);
    expect(count(html, 'pointLight')).toBe(0);
    expect(count(html, 'spotLight')).toBe(0);
    expect(count(html, 'mesh')).toBe(2);
  });

  it('потолочная лампа с опуском — маркер и нить', () => {
    const html = render(<LightBody object={light('light.point', CEILING)} ghost={false} />);
    expect(count(html, 'mesh')).toBe(3);
  });

  it('прожектор: маркер-банка при любом креплении', () => {
    for (const mount of [FLOOR, WALL, { ...CEILING, drop: 0 }]) {
      const html = render(<LightBody object={light('light.spot', mount)} ghost={false} />);
      expect(count(html, 'mesh')).toBe(2);
    }
  });
});

describe('ObjectView / SceneObjects на начальном макете стора', () => {
  const objects = () => useEditor.getInitialState().layout.objects;

  it('каждый видимый объект — одна группа в своей позе; меши — по группам частей', () => {
    expect(objects().length).toBeGreaterThan(0);
    expect(useEditor.getInitialState().viewFromAbove).toBe(true);
    for (const object of objects()) {
      const html = render(<ObjectView id={object.id} />);
      if (!object.visible) {
        expect(html).toBe('');
        continue;
      }
      expect(html.startsWith('<group position="')).toBe(true);
      expect(html).toContain('rotation-y="');
      const item = getItem(object.type);
      if (item.kind === 'primitive' || item.kind === 'preset') {
        expect(count(html, 'instancedMesh')).toBe(groupParts(partsOf(object), false).length);
      }
      // В начальном состоянии стора вид считается видом сверху: потолочные объекты — призраки с контуром
      // верхней грани, остальные — сплошные и без контура.
      expect(count(html, 'lineLoop')).toBe(object.mount.kind === 'ceiling' ? 1 : 0);
    }
  });

  it('неизвестный id → ничего', () => {
    expect(render(<ObjectView id="no-such-object" />)).toBe('');
  });

  it('SceneObjects рисует все объекты макета', () => {
    const html = render(<SceneObjects />);
    const visible = objects().filter((o) => o.visible);
    const meshes = visible
      .filter((o) => ['primitive', 'preset'].includes(getItem(o.type).kind))
      .reduce((n, o) => n + groupParts(partsOf(o), false).length, 0);
    expect(count(html, 'instancedMesh')).toBe(meshes);
    // Обработчиков указателя на мешах нет.
    expect(html).not.toMatch(/onpointer|onclick/i);
  });
});
