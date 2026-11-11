// Конвейер указателя без браузера: настоящие стор, пикер и камера three.js; элемент, окно и кадры — подделки.
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Camera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '../catalog';
import { wallSurfaces } from '../model/geometry';
import { backSurfaces } from '../model/layers';
import { createLayout } from '../model/layout';
import { ROTATION_STEP } from '../model/pose';
import { testRoom } from '../model/testRoom';
import type { Mount, SceneObject } from '../model/types';
import { subscribeCommands, useEditor } from '../store/editorStore';
import { cancelGesture } from './gesture';
import { attachPointerController } from './PointerController';

// Стор берёт помещение из реестра; для тестов реестр — одно тестовое помещение (lounge не загружается вовсе).
vi.mock('../rooms', async () => {
  const { testRoom: room } = await import('../model/testRoom');
  return { rooms: [room], getRoom: () => room };
});

type Listener = (event: unknown) => void;

/** Минимум HTMLElement, которым пользуется конвейер. Запоминает флаг capture каждого слушателя. */
class FakeElement {
  readonly listeners: { type: string; fn: Listener; capture: boolean }[] = [];
  readonly captured = new Set<number>();
  readonly style = { cursor: '' };
  readonly clientHeight = 600;

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  addEventListener(type: string, fn: Listener, options?: { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: options?.capture === true });
  }
  removeEventListener(type: string, fn: Listener, options?: { capture?: boolean }) {
    const capture = options?.capture === true;
    const index = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (index >= 0) this.listeners.splice(index, 1);
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  fire(type: string, event: unknown = {}) {
    for (const l of [...this.listeners]) if (l.type === type) l.fn(event);
  }
}

/** Контролы камеры: запоминают, с каким enableDamping вызывался update(). */
class FakeControls {
  enabled = true;
  enableDamping = true;
  target = new Vector3(0, 0, 0);
  readonly updates: boolean[] = [];
  update() {
    this.updates.push(this.enableDamping);
  }
}

// Камера плана 800 × 600 px, 50 px/м, центр — мировое начало координат: мировые (x, z) ↔ экран (400 + 50x, 300 + 50z).
function topCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 200);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.zoom = 50;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

function pointer(x: number, z: number, over: Record<string, unknown> = {}) {
  return { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', clientX: 400 + 50 * x, clientY: 300 + 50 * z, ...over };
}

function obj(id: string, type: string, mount: Mount, over: Partial<SceneObject> = {}): SceneObject {
  const item = getItem(type);
  return {
    id,
    kind: item.kind,
    type,
    origin: 'user',
    name: id,
    mount,
    rotationY: 0,
    size: item.size,
    color: item.color,
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

const state = () => useEditor.getState();
const find = (id: string) => state().layout.objects.find((o) => o.id === id);
/** Пустое место тестового помещения (ни мебели, ни колонны). */
const EMPTY: [number, number] = [4.2, 2.2];

let el: FakeElement;
let win: FakeElement;
let controls: FakeControls;
let camera: Camera;
let detach: (() => void) | null;
let frames: (Listener | null)[];
let commands: string[];
let stopCommands: () => void;

/** Выполняет запланированные кадры (как браузер перед отрисовкой). */
function flushFrames() {
  const queue = frames;
  frames = [];
  for (const cb of queue) cb?.(0);
}

function open(extra: SceneObject[]) {
  state().openLayout({ ...createLayout(testRoom), objects: [...testRoom.fixtures.map((o) => structuredClone(o)), ...extra] });
}

function attach(mode: 'orbit' | 'top' = 'top') {
  detach = attachPointerController(
    el as unknown as HTMLElement,
    { camera: () => camera, controls: () => controls, mode },
    win as unknown as Window,
  );
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: Listener) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    if (id >= 1 && id <= frames.length) frames[id - 1] = null;
  });
  el = new FakeElement();
  win = new FakeElement();
  controls = new FakeControls();
  camera = topCamera();
  detach = null;

  const s = state();
  s.setCameraMode('top');
  s.setLayer('auto');
  s.setGridSnap(true);
  s.setViewFromAbove(true);
  s.setBackSurfaces([]);
  s.setCapturing(false);
  open([obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 })]);

  commands = [];
  stopCommands = subscribeCommands((_cmd, meta) => commands.push(meta.origin));
});

afterEach(() => {
  detach?.();
  stopCommands();
  vi.unstubAllGlobals();
});

describe('регистрация слушателей', () => {
  it('pointerdown / move / up / cancel висят в фазе capture; очистка снимает всё', () => {
    attach();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      const found = el.listeners.filter((l) => l.type === type);
      expect(found).toHaveLength(1);
      expect(found[0].capture).toBe(true);
    }
    expect(win.listeners.map((l) => l.type)).toEqual(['blur']);
    detach?.();
    detach = null;
    expect(el.listeners).toHaveLength(0);
    expect(win.listeners).toHaveLength(0);
    // Escape после размонтирования отменять нечего.
    expect(cancelGesture()).toBe(false);
  });

  it('StrictMode: повторное подключение после очистки работает как первое', () => {
    attach();
    detach?.();
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    expect(state().selectedId).toBe('crate');
    expect(el.listeners.filter((l) => l.type === 'pointerdown')).toHaveLength(1);
  });
});

describe('клик', () => {
  it('по объекту: камера заблокирована на время нажатия, по отпусканию — только выбор', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    expect(controls.enabled).toBe(false);
    expect(el.captured.has(1)).toBe(true);
    expect(state().selectedId).toBeNull();

    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    expect(state().selectedId).toBe('crate');
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    expect(state().draft).toBeNull();
    expect(commands).toEqual([]);
    expect(state().history.past).toHaveLength(0);
  });

  it('дрожание в пределах порога остаётся кликом', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(3.04, 1.04));
    flushFrames();
    el.fire('pointerup', pointer(3.04, 1.04, { buttons: 0 }));
    expect(state().selectedId).toBe('crate');
    expect(commands).toEqual([]);
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
  });

  it('по пустому месту: событие не тронуто (камера свободна), выбор снимается', () => {
    attach();
    state().select('crate');
    el.fire('pointerdown', pointer(...EMPTY));
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    expect(controls.updates).toEqual([]);
    el.fire('pointerup', pointer(...EMPTY, { buttons: 0 }));
    expect(state().selectedId).toBeNull();
  });

  it('перетаскивание фона — движение камеры: выбор остаётся', () => {
    attach();
    state().select('crate');
    el.fire('pointerdown', pointer(...EMPTY));
    el.fire('pointermove', pointer(EMPTY[0] + 1, EMPTY[1]));
    el.fire('pointerup', pointer(EMPTY[0] + 1, EMPTY[1], { buttons: 0 }));
    expect(state().selectedId).toBe('crate');
    expect(controls.enabled).toBe(true);
  });

  it('не левая кнопка, касание и режим снимка игнорируются', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1, { button: 2, buttons: 2 }));
    el.fire('pointerup', pointer(3, 1, { button: 2, buttons: 0 }));
    el.fire('pointerdown', pointer(3, 1, { pointerType: 'touch' }));
    el.fire('pointerup', pointer(3, 1, { pointerType: 'touch', buttons: 0 }));
    state().setCapturing(true);
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    state().setCapturing(false);
    expect(state().selectedId).toBeNull();
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
  });

  it('заблокированный объект не берётся: клик проходит к камере', () => {
    open([obj('crate', 'box', { kind: 'floor', x: 3, z: 1, lift: 0 }, { locked: true })]);
    attach();
    state().select('crate');
    el.fire('pointerdown', pointer(3, 1));
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    el.fire('pointermove', pointer(4, 1));
    flushFrames();
    expect(state().draft).toBeNull();
  });
});

describe('перетаскивание объекта', () => {
  it('draft во время жеста, одна команда «Перемещение» по отпусканию, камера разблокирована', () => {
    attach();
    el.fire('pointerdown', pointer(3.1, 1.1));
    el.fire('pointermove', pointer(4.1, 1.6));
    // Порог пройден: объект выбран, но draft появится только с кадром.
    expect(state().selectedId).toBe('crate');
    expect(state().draft).toBeNull();
    flushFrames();
    // Смещение захвата (0.1, 0.1) сохранено: центр — в (4, 1.5).
    expect(state().draft).toEqual({ crate: { mount: { kind: 'floor', x: 4, z: 1.5, lift: 0 } } });
    expect(controls.enabled).toBe(false);
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(commands).toEqual([]);

    el.fire('pointerup', pointer(4.1, 1.6, { buttons: 0 }));
    expect(state().draft).toBeNull();
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 4, z: 1.5, lift: 0 });
    expect(commands).toEqual(['local']);
    expect(state().history.past.map((step) => step.label)).toEqual(['Перемещение']);
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    expect(el.style.cursor).toBe('');

    // Один шаг undo возвращает объект на место.
    state().undo();
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
  });

  it('камера не получает остатка инерции: update() вызван один раз с выключенным затуханием', () => {
    attach();
    const position = camera.position.clone();
    el.fire('pointerdown', pointer(3, 1));
    expect(controls.updates).toEqual([false]);
    expect(controls.enableDamping).toBe(true);
    expect(camera.position.equals(position)).toBe(true);
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    expect(controls.updates).toEqual([false]);
  });

  it('draft обновляется не чаще раза за кадр', () => {
    attach();
    let drafts = 0;
    const stop = useEditor.subscribe((s, prev) => {
      if (s.draft !== prev.draft) drafts++;
    });
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(3.5, 1));
    el.fire('pointermove', pointer(3.7, 1));
    el.fire('pointermove', pointer(3.9, 1));
    expect(frames.filter(Boolean)).toHaveLength(1);
    flushFrames();
    expect(drafts).toBe(1);
    expect(state().draft).toEqual({ crate: { mount: { kind: 'floor', x: 3.9, z: 1, lift: 0 } } });
    el.fire('pointerup', pointer(3.9, 1, { buttons: 0 }));
    stop();
  });

  it('отпускание до кадра: последнее положение указателя всё равно попадает в команду', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(3.5, 1));
    flushFrames();
    el.fire('pointermove', pointer(4.4, 2));
    el.fire('pointerup', pointer(4.4, 2, { buttons: 0 }));
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 4.4, z: 2, lift: 0 });
    expect(commands).toEqual(['local']);
    // Отменённый кадр больше ничего не делает.
    flushFrames();
    expect(state().draft).toBeNull();
    expect(commands).toEqual(['local']);
  });

  it('привязка к сетке выключена → сантиметры', () => {
    attach();
    state().setGridSnap(false);
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(3.456, 1.234));
    el.fire('pointerup', pointer(3.456, 1.234, { buttons: 0 }));
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3.46, z: 1.23, lift: 0 });
  });

  it('пол → столешница и обратно', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(-2, 1));
    el.fire('pointerup', pointer(-2, 1, { buttons: 0 }));
    expect(find('crate')?.mount).toEqual({ kind: 'surface', hostId: 'venue-table', u: 0, v: 0 });

    // Стол остаётся выбираемым: ящик на нём ближе к камере и берётся первым.
    el.fire('pointerdown', pointer(-2, 1));
    el.fire('pointermove', pointer(3, 2));
    el.fire('pointerup', pointer(3, 2, { buttons: 0 }));
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 2, lift: 0 });
    expect(state().history.past).toHaveLength(2);
  });

  it('жест без результата (вернули на место) не пишет команду', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(3.5, 1));
    flushFrames();
    el.fire('pointermove', pointer(3, 1));
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    expect(commands).toEqual([]);
    expect(state().draft).toBeNull();
    expect(controls.enabled).toBe(true);
  });
});

describe('выход без коммита', () => {
  function startDrag() {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    el.fire('pointermove', pointer(4, 1.5));
    flushFrames();
    expect(state().draft).not.toBeNull();
    expect(controls.enabled).toBe(false);
  }
  function expectCancelled() {
    expect(state().draft).toBeNull();
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(commands).toEqual([]);
  }

  it('Escape: draft сброшен, камера разблокирована; запоздалый pointerup ничего не делает', () => {
    startDrag();
    expect(cancelGesture()).toBe(true);
    expectCancelled();
    el.fire('pointermove', pointer(4.5, 1.5));
    flushFrames();
    el.fire('pointerup', pointer(4.5, 1.5, { buttons: 0 }));
    expectCancelled();
    // Второй Escape отменять уже нечего (снимет выбор — это делает useShortcuts).
    expect(cancelGesture()).toBe(false);
  });

  it('Escape до порога перетаскивания отменяет и выбор по отпусканию', () => {
    attach();
    el.fire('pointerdown', pointer(3, 1));
    expect(cancelGesture()).toBe(true);
    expect(controls.enabled).toBe(true);
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
    expect(state().selectedId).toBeNull();
  });

  it('pointercancel', () => {
    startDrag();
    el.fire('pointercancel', pointer(4, 1.5));
    expectCancelled();
  });

  it('потеря захвата указателя', () => {
    startDrag();
    el.fire('lostpointercapture', pointer(4, 1.5));
    expectCancelled();
  });

  it('blur окна', () => {
    startDrag();
    win.fire('blur');
    expectCancelled();
  });

  it('размонтирование посреди жеста', () => {
    startDrag();
    detach?.();
    detach = null;
    expectCancelled();
    expect(el.listeners).toHaveLength(0);
  });

  it('новое нажатие без pointerup отменяет прежний жест', () => {
    startDrag();
    el.fire('pointerdown', pointer(...EMPTY));
    expectCancelled();
  });

  it('объект исчез посреди жеста (чужая правка): жест отменяется, команды нет', () => {
    startDrag();
    state().dispatch({ type: 'remove', ids: ['crate'] }, { origin: 'remote' });
    commands.length = 0;
    el.fire('pointermove', pointer(4.5, 1.5));
    flushFrames();
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
    el.fire('pointerup', pointer(4.5, 1.5, { buttons: 0 }));
    expect(state().draft).toBeNull();
    expect(commands).toEqual([]);
  });
});

describe('ручки', () => {
  // Ручка поворота ящика 0.5³ в (3, 1): локальная [0, 0, d/2 + 0.35] → мировая (3, 0, 1.6).
  const ROTATE: [number, number] = [3, 1.6];

  it('поворот: draft по кадрам, одна команда «Поворот»', () => {
    attach();
    state().select('crate');
    el.fire('pointerdown', pointer(...ROTATE));
    expect(controls.enabled).toBe(false);
    expect(el.captured.has(1)).toBe(true);
    el.fire('pointermove', pointer(4, 1));
    flushFrames();
    expect(state().draft).toEqual({ crate: { rotationY: 6 * ROTATION_STEP } });
    el.fire('pointerup', pointer(4, 1, { buttons: 0 }));
    expect(find('crate')?.rotationY).toBe(6 * ROTATION_STEP);
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(state().history.past.map((step) => step.label)).toEqual(['Поворот']);
    expect(commands).toEqual(['local']);
    expect(controls.enabled).toBe(true);
    expect(state().selectedId).toBe('crate');
  });

  it('ширина: одна команда «Размер», объект остаётся на месте', () => {
    attach();
    state().select('crate');
    // Ручка ширины — в (3.25, 1); тянем до x = 3.4 → ширина 0.8.
    el.fire('pointerdown', pointer(3.25, 1));
    el.fire('pointermove', pointer(3.4, 1));
    el.fire('pointerup', pointer(3.4, 1, { buttons: 0 }));
    expect(find('crate')?.size).toEqual([0.8, 0.5, 0.5]);
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 3, z: 1, lift: 0 });
    expect(state().history.past.map((step) => step.label)).toEqual(['Размер']);
  });

  it('клик по ручке без движения ничего не меняет — даже если перед ним был запланирован кадр наведения', () => {
    attach();
    state().select('crate');
    el.fire('pointermove', pointer(...ROTATE, { buttons: 0 }));
    el.fire('pointerdown', pointer(...ROTATE));
    flushFrames();
    expect(state().draft).toBeNull();
    el.fire('pointerup', pointer(...ROTATE, { buttons: 0 }));
    expect(state().draft).toBeNull();
    expect(commands).toEqual([]);
    expect(controls.enabled).toBe(true);
    expect(state().selectedId).toBe('crate');
  });

  it('Escape во время поворота возвращает прежний угол', () => {
    attach();
    state().select('crate');
    el.fire('pointerdown', pointer(...ROTATE));
    el.fire('pointermove', pointer(4, 1));
    flushFrames();
    expect(cancelGesture()).toBe(true);
    expect(state().draft).toBeNull();
    expect(find('crate')?.rotationY).toBe(0);
    expect(controls.enabled).toBe(true);
    expect(commands).toEqual([]);
  });

  it('без выбора ручек нет: нажатие в точке ручки — пустое место', () => {
    attach();
    el.fire('pointerdown', pointer(...ROTATE));
    expect(controls.enabled).toBe(true);
    expect(el.captured.size).toBe(0);
  });
});

describe('наведение', () => {
  it('без нажатых кнопок: подсветка объекта и курсор, раз в кадр', () => {
    attach();
    el.fire('pointermove', pointer(3, 1, { buttons: 0 }));
    expect(state().hoveredId).toBeNull();
    flushFrames();
    expect(state().hoveredId).toBe('crate');
    expect(el.style.cursor).toBe('grab');

    el.fire('pointermove', pointer(...EMPTY, { buttons: 0 }));
    flushFrames();
    expect(state().hoveredId).toBeNull();
    expect(el.style.cursor).toBe('');
  });

  it('над ручкой выбранного объекта — курсор ручки, подсветки нет', () => {
    attach();
    state().select('crate');
    el.fire('pointermove', pointer(3, 1.6, { buttons: 0 }));
    flushFrames();
    expect(state().hoveredId).toBeNull();
    expect(el.style.cursor).toBe('crosshair');
  });

  it('с нажатой кнопкой (камеру тянут) наведение не считается; после отпускания за окном — оживает', () => {
    attach();
    el.fire('pointerdown', pointer(...EMPTY));
    el.fire('pointermove', pointer(3, 1));
    flushFrames();
    expect(state().hoveredId).toBeNull();
    // pointerup не дошёл (отпустили за пределами вьюпорта) — следующее движение без кнопок возвращает наведение.
    el.fire('pointermove', pointer(3, 1, { buttons: 0 }));
    flushFrames();
    expect(state().hoveredId).toBe('crate');
  });

  it('уход указателя с вьюпорта и нажатие сбрасывают подсветку', () => {
    attach();
    el.fire('pointermove', pointer(3, 1, { buttons: 0 }));
    flushFrames();
    el.fire('pointerleave');
    expect(state().hoveredId).toBeNull();
    expect(el.style.cursor).toBe('');

    el.fire('pointermove', pointer(3, 1, { buttons: 0 }));
    flushFrames();
    el.fire('pointerdown', pointer(3, 1));
    expect(state().hoveredId).toBeNull();
    expect(el.style.cursor).toBe('grabbing');
    el.fire('pointerup', pointer(3, 1, { buttons: 0 }));
  });
});

describe('слои и призраки', () => {
  it('потолочный объект при виде сверху пропускает клик к столу под ним; выбранный — берётся сам', () => {
    open([obj('cloud', 'box', { kind: 'ceiling', x: -2, z: 1, drop: 0.2 }, { size: [3, 0.5, 3] })]);
    attach();
    el.fire('pointerdown', pointer(-2, 1));
    el.fire('pointerup', pointer(-2, 1, { buttons: 0 }));
    expect(state().selectedId).toBe('venue-table');

    // Выбранный потолочный объект перетаскивается и остаётся потолочным.
    state().select('cloud');
    el.fire('pointerdown', pointer(-2, 1));
    el.fire('pointermove', pointer(1, 2));
    el.fire('pointerup', pointer(1, 2, { buttons: 0 }));
    expect(find('cloud')?.mount).toEqual({ kind: 'ceiling', x: 1, z: 2, drop: 0.2 });
    expect(state().history.past.map((step) => step.label)).toEqual(['Перемещение']);
  });

  it('настенный щит на плане скользит вдоль стены и не уходит с неё', () => {
    open([obj('banner', 'panel', { kind: 'wall', surfaceId: 'far', along: 5, bottom: 1.2 })]);
    attach();
    // Центр щита на плане: (0, −2.955); тонкий бокс раздувается до 10 px.
    el.fire('pointerdown', pointer(0, -2.95));
    el.fire('pointermove', pointer(1.5, -2));
    el.fire('pointerup', pointer(1.5, -2, { buttons: 0 }));
    expect(find('banner')?.mount).toEqual({ kind: 'wall', surfaceId: 'far', along: 6.5, bottom: 1.2 });
  });
});

describe('облёт (перспективная камера)', () => {
  /** Камера снаружи за ближней стеной (z = +3), выше потолка — обычный вид облёта. */
  function orbitCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(50, 800 / 600, 0.1, 200);
    cam.position.set(0.3, 5, 10);
    cam.lookAt(0, 1, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
  }
  /** Событие указателя в точке экрана, куда проецируется мировая точка. */
  function at(point: [number, number, number], over: Record<string, unknown> = {}) {
    const ndc = new Vector3(...point).project(camera);
    return {
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: ((ndc.x + 1) / 2) * 800,
      clientY: ((1 - ndc.y) / 2) * 600,
      ...over,
    };
  }
  /** То, что ViewProbe записал бы в стор для этой камеры; цель контролов — точка, на которую камера смотрит. */
  function probe() {
    const p = camera.position;
    controls.target.set(0, 1, 0);
    state().setCameraMode('orbit');
    state().setViewFromAbove(p.y > testRoom.size.height);
    state().setBackSurfaces(backSurfaces('orbit', [p.x, p.y, p.z], wallSurfaces(testRoom)));
  }

  it('напольный объект едет за точкой пола под курсором', () => {
    camera = orbitCamera();
    probe();
    attach('orbit');
    el.fire('pointerdown', at([3, 0, 1]));
    expect(controls.enabled).toBe(false);
    el.fire('pointermove', at([1, 0, 2]));
    el.fire('pointerup', at([1, 0, 2], { buttons: 0 }));
    expect(find('crate')?.mount).toEqual({ kind: 'floor', x: 1, z: 2, lift: 0 });
    expect(controls.enabled).toBe(true);
  });

  it('щит на ближней (отсечённой) стене: невыбранный пропускает клик, выбранный едет вдоль своей стены', () => {
    open([obj('banner', 'panel', { kind: 'wall', surfaceId: 'near', along: 5, bottom: 1.2 })]);
    camera = orbitCamera();
    probe();
    expect(state().backSurfaceIds).toContain('near');
    attach('orbit');
    // Центр щита: x = 0, y = 1.7, z = 3 − WALL_GAP − d/2.
    const z = 3 - 0.03 - 0.015;

    // Призрак: клик проходит насквозь (за щитом в этой точке пусто) — камера свободна, выбор не появляется.
    el.fire('pointerdown', at([0.3, 1.7, z]));
    expect(controls.enabled).toBe(true);
    el.fire('pointerup', at([0.3, 1.7, z], { buttons: 0 }));
    expect(state().selectedId).toBeNull();

    // Выбранный (из списка объектов) берётся «со спины» и остаётся на своей стене: along = 5 − x.
    state().select('banner');
    el.fire('pointerdown', at([0.3, 1.7, z]));
    expect(controls.enabled).toBe(false);
    // Первый кадр (указатель ушёл на 5 px по вертикали — поперёк стены): щит остаётся на своей стене и на месте.
    el.fire('pointermove', at([0.3, 1.7, z], { clientY: at([0.3, 1.7, z]).clientY - 5 }));
    flushFrames();
    const first = state().draft?.banner?.mount;
    expect(first).toEqual({ kind: 'wall', surfaceId: 'near', along: 5, bottom: 1.2 });

    el.fire('pointermove', at([-1.7, 1.7, z]));
    el.fire('pointerup', at([-1.7, 1.7, z], { buttons: 0 }));
    const mount = find('banner')?.mount;
    expect(mount?.kind).toBe('wall');
    if (mount?.kind !== 'wall') return;
    expect(mount.surfaceId).toBe('near');
    expect(mount.along).toBeCloseTo(7, 1);
    expect(mount.bottom).toBe(1.2);
    expect(state().history.past.map((step) => step.label)).toEqual(['Перемещение']);
  });
});
