import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '../catalog';
import { createLayout } from '../model/layout';
import { createObject } from '../model/ops';
import { testRoom } from '../model/testRoom';
import type { SceneObject } from '../model/types';
import { useEditor } from '../store/editorStore';
import { registerGestureCancel } from './gesture';
import { handleShortcut, isTextTarget, shortcutAction } from './shortcuts';
import type { ShortcutEvent, ShortcutKey } from './shortcuts';

// Стор берёт помещение из реестра; для тестов реестр — одно тестовое помещение (lounge не загружается вовсе).
vi.mock('../rooms', async () => {
  const { testRoom: room } = await import('../model/testRoom');
  return { rooms: [room], getRoom: () => room };
});

const room = testRoom;
const state = () => useEditor.getState();
const ids = () => state().layout.objects.map((o) => o.id);

function key(code: string, mods: Partial<ShortcutKey> = {}): ShortcutKey {
  return { code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

/** Нажатие клавиши; возвращает, был ли вызван preventDefault. */
function press(code: string, mods: Partial<ShortcutKey> = {}, target: unknown = { tagName: 'BODY' }): boolean {
  let prevented = false;
  const event: ShortcutEvent = {
    ...key(code, mods),
    target,
    preventDefault() {
      prevented = true;
    },
  };
  handleShortcut(event);
  return prevented;
}

function put(): SceneObject {
  const object = createObject(getItem('box'), { kind: 'floor', x: 3, z: 1, lift: 0 });
  state().dispatch({ type: 'add', items: [{ object }] }, { label: 'Добавить' });
  return object;
}

let unregister: (() => void) | undefined;

beforeEach(() => {
  const s = state();
  s.setCameraMode('orbit');
  s.openLayout(createLayout(room));
  s.setGridSnap(true);
});

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe('shortcutAction: таблица клавиш (по KeyboardEvent.code)', () => {
  it('undo / redo', () => {
    expect(shortcutAction(key('KeyZ', { ctrlKey: true }))).toBe('undo');
    expect(shortcutAction(key('KeyZ', { metaKey: true }))).toBe('undo');
    expect(shortcutAction(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutAction(key('KeyZ', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutAction(key('KeyY', { ctrlKey: true }))).toBe('redo');
    // Cmd+Y — команда браузера, не redo.
    expect(shortcutAction(key('KeyY', { metaKey: true }))).toBeNull();
    expect(shortcutAction(key('KeyZ'))).toBeNull();
  });

  it('удаление, дублирование, Escape, сетка', () => {
    expect(shortcutAction(key('Delete'))).toBe('delete');
    expect(shortcutAction(key('Backspace'))).toBe('delete');
    expect(shortcutAction(key('KeyD', { ctrlKey: true }))).toBe('duplicate');
    expect(shortcutAction(key('KeyD', { metaKey: true }))).toBe('duplicate');
    expect(shortcutAction(key('Escape'))).toBe('escape');
    expect(shortcutAction(key('KeyG'))).toBe('grid');
  });

  it('чужие сочетания не перехватываются', () => {
    // KeyD без модификатора — шаг вправо в прогулке; Ctrl+G и Alt-сочетания — команды браузера и системы.
    expect(shortcutAction(key('KeyD'))).toBeNull();
    expect(shortcutAction(key('KeyG', { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key('KeyG', { shiftKey: true }))).toBeNull();
    expect(shortcutAction(key('KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutAction(key('Delete', { altKey: true }))).toBeNull();
    expect(shortcutAction(key('ArrowLeft'))).toBeNull();
    expect(shortcutAction(key('KeyR'))).toBeNull();
  });

  it('автоповтор не плодит копии и не мигает сеткой, но повторяет undo', () => {
    expect(shortcutAction(key('KeyD', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(shortcutAction(key('KeyG', { repeat: true }))).toBeNull();
    expect(shortcutAction(key('KeyZ', { ctrlKey: true, repeat: true }))).toBe('undo');
  });
});

describe('isTextTarget', () => {
  it('input / textarea / select / contenteditable — поле ввода', () => {
    expect(isTextTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTextTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTextTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTextTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('остальное — нет', () => {
    expect(isTextTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextTarget({ tagName: 'CANVAS', isContentEditable: false })).toBe(false);
    expect(isTextTarget(null)).toBe(false);
    expect(isTextTarget(undefined)).toBe(false);
  });
});

describe('handleShortcut', () => {
  it('Delete и Backspace удаляют выбранный объект; без выбора ничего не происходит', () => {
    const before = ids();
    expect(press('Delete')).toBe(false);
    expect(ids()).toEqual(before);

    const a = put();
    state().select(a.id);
    expect(press('Delete')).toBe(true);
    expect(ids()).toEqual(before);
    expect(state().selectedId).toBeNull();

    const b = put();
    state().select(b.id);
    press('Backspace');
    expect(ids()).toEqual(before);
  });

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo и redo', () => {
    const before = ids();
    const a = put();
    expect(press('KeyZ', { ctrlKey: true })).toBe(true);
    expect(ids()).toEqual(before);
    press('KeyZ', { ctrlKey: true, shiftKey: true });
    expect(ids()).toEqual([...before, a.id]);
    press('KeyZ', { metaKey: true });
    expect(ids()).toEqual(before);
    press('KeyY', { ctrlKey: true });
    expect(ids()).toEqual([...before, a.id]);
  });

  it('Ctrl+D дублирует и выбирает копию; preventDefault — даже без выбора', () => {
    const count = ids().length;
    expect(press('KeyD', { ctrlKey: true })).toBe(true);
    expect(ids()).toHaveLength(count);

    const a = put();
    state().select(a.id);
    expect(press('KeyD', { metaKey: true })).toBe(true);
    expect(ids()).toHaveLength(count + 2);
    expect(state().selectedId).not.toBeNull();
    expect(state().selectedId).not.toBe(a.id);
    // Один шаг undo убирает копию.
    press('KeyZ', { ctrlKey: true });
    expect(ids()).toHaveLength(count + 1);
  });

  it('KeyG переключает привязку к сетке', () => {
    expect(state().gridSnap).toBe(true);
    press('KeyG');
    expect(state().gridSnap).toBe(false);
    press('KeyG');
    expect(state().gridSnap).toBe(true);
  });

  it('Escape: сначала отменяет перетаскивание, иначе снимает выбор', () => {
    const a = put();
    state().select(a.id);

    // Идёт жест: отменяется он, выбор остаётся.
    let cancelled = 0;
    unregister = registerGestureCancel(() => {
      cancelled++;
      state().setDraft(null);
      return true;
    });
    state().setDraft({ [a.id]: { rotationY: 1 } });
    press('Escape');
    expect(cancelled).toBe(1);
    expect(state().draft).toBeNull();
    expect(state().selectedId).toBe(a.id);
    unregister();
    unregister = undefined;

    // Жеста нет, но draft остался (контроллер размонтирован) — сбрасывается draft, выбор цел.
    state().setDraft({ [a.id]: { rotationY: 1 } });
    press('Escape');
    expect(state().draft).toBeNull();
    expect(state().selectedId).toBe(a.id);

    // Ничего не тянут — снимается выбор.
    press('Escape');
    expect(state().selectedId).toBeNull();
  });

  it('во время перетаскивания Delete и Ctrl+D не работают', () => {
    const a = put();
    const count = ids().length;
    state().select(a.id);
    state().setDraft({ [a.id]: { rotationY: 1 } });
    press('Delete');
    press('KeyD', { ctrlKey: true });
    expect(ids()).toHaveLength(count);
    expect(state().draft).not.toBeNull();
    state().setDraft(null);
  });

  it('фокус в поле ввода: клавиши не перехватываются', () => {
    const a = put();
    const count = ids().length;
    state().select(a.id);
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(press('Backspace', {}, target)).toBe(false);
      expect(press('KeyZ', { ctrlKey: true }, target)).toBe(false);
      expect(press('KeyD', { ctrlKey: true }, target)).toBe(false);
      press('KeyG', {}, target);
      press('Escape', {}, target);
    }
    expect(ids()).toHaveLength(count);
    expect(state().gridSnap).toBe(true);
    expect(state().selectedId).toBe(a.id);
  });

  it('в режиме прогулки изменяющие клавиши не работают', () => {
    const a = put();
    const withObject = ids();
    state().select(a.id);
    state().setCameraMode('walk');
    // Вход в прогулку сам снимает выбор; возвращаем его, чтобы проверить именно клавиши.
    state().select(a.id);
    press('Delete');
    press('KeyD', { ctrlKey: true });
    press('KeyZ', { ctrlKey: true });
    press('KeyG');
    expect(ids()).toEqual(withObject);
    expect(state().gridSnap).toBe(true);
    state().setCameraMode('orbit');
  });

  it('уже обработанное событие и ввод через IME пропускаются', () => {
    const a = put();
    const count = ids().length;
    state().select(a.id);
    handleShortcut({ ...key('Delete'), target: null, defaultPrevented: true, preventDefault() {} });
    handleShortcut({ ...key('Delete'), target: null, isComposing: true, preventDefault() {} });
    expect(ids()).toHaveLength(count);
  });
});
