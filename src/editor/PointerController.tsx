// Единственный конвейер указателя редактора (решение Р6). Слушатели висят в фазе CAPTURE на div-обёртке Canvas —
// том же элементе, на котором OrbitControls слушает pointerdown в фазе всплытия: к моменту, когда событие дойдёт до
// контролов, здесь уже решено «объект или камера» и controls.enabled выставлен. На мешах сцены обработчиков нет.
//
//   pointerdown  ручка выбранного объекта → объект → ничего (тогда событие не трогается: камеру двигает OrbitControls)
//   pointermove  pending → moving после DRAG_THRESHOLD_PX; moving / handle → setDraft не чаще раза за кадр; без кнопок → hover
//   pointerup    pending → select; moving / handle → ровно один commitDraft; клик по пустому месту → select(null)
//   Escape / pointercancel / blur / размонтирование → draft сброшен, controls.enabled = true
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { Camera } from 'three';
import { GRID_STEP } from '../model/pose';
import type { Ray, SceneObject } from '../model/types';
import { useEditor } from '../store/editorStore';
import { getBackSurfaces, getContext, getLayerView } from '../store/selectors';
import { lockCamera } from './cameraLock';
import { DRAG_THRESHOLD_PX } from './constants';
import { beginMove } from './drag';
import type { DragEnv, MoveSession } from './drag';
import { gestureLabel, handlePatch, movePatch, pickTarget, registerGestureCancel } from './gesture';
import type { PickTarget } from './gesture';
import type { HandleKind } from './handles';
import { unitsPerPixel, unitsPerPixelAt, viewRay } from './viewRay';

type Gesture =
  | { kind: 'idle' }
  /** Путь 4б: нажали на пустое место, камерой управляет OrbitControls; здесь только отличаем клик от перетаскивания. */
  | { kind: 'camera'; pointerId: number; x: number; y: number }
  /** Нажали на объект, порог перетаскивания ещё не пройден. */
  | { kind: 'pending'; pointerId: number; x: number; y: number; id: string; ray: Ray }
  | { kind: 'moving'; pointerId: number; id: string; session: MoveSession }
  /** active — порог пройден: простой клик по ручке ничего не меняет. */
  | { kind: 'handle'; pointerId: number; x: number; y: number; id: string; handle: HandleKind; start: SceneObject; active: boolean };

const IDLE: Gesture = { kind: 'idle' };

function cursorFor(target: PickTarget | null): string {
  if (!target) return '';
  if (target.kind === 'object') return 'grab';
  switch (target.handle) {
    case 'rotate':
      return 'crosshair';
    case 'resize-w':
    case 'resize-d':
      return 'ew-resize';
    case 'resize-h':
    case 'drop':
      return 'ns-resize';
    case 'resize-uniform':
      return 'nwse-resize';
  }
}

/** Откуда конвейер берёт камеру и контролы: они пересоздаются при смене помещения, а слушатели остаются. */
export interface PointerView {
  camera(): Camera;
  /** makeDefault-контролы (state.controls) или null. */
  controls(): unknown;
  mode: 'orbit' | 'top';
}

/**
 * Вешает конвейер указателя на div-обёртку Canvas и возвращает функцию очистки (снимает все слушатели, отменяет
 * незавершённый жест, возвращает controls.enabled = true). Без React: компонент ниже вызывает её из эффекта.
 */
export function attachPointerController(
  el: HTMLElement,
  view: PointerView,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const { mode } = view;
  let gesture: Gesture = IDLE;
  /** Включает обратно контролы, выключенные текущим жестом; вызывается на любом пути выхода. */
  let unlockCamera: (() => void) | null = null;
  /** Последнее положение указателя, ещё не обработанное кадром. */
  let pending: { x: number; y: number } | null = null;
  let frame = 0;

  const store = () => useEditor.getState();
  /** Проверка через функцию: после вызова, который мог завершить жест, сужение типа gesture уже неверно. */
  const isIdle = () => gesture.kind === 'idle';
  const rayAt = (x: number, y: number) => viewRay(view.camera(), el.getBoundingClientRect(), x, y);
  const beyondThreshold = (from: { x: number; y: number }, e: PointerEvent) =>
    Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_THRESHOLD_PX;
  const setCursor = (cursor: string) => {
    if (el.style.cursor !== cursor) el.style.cursor = cursor;
  };

  const targetAt = (ray: Ray): PickTarget | null => {
    const camera = view.camera();
    const height = el.clientHeight;
    return pickTarget(ray, {
      ctx: getContext(),
      selectedId: store().selectedId,
      layerView: getLayerView(),
      back: getBackSurfaces(),
      mode,
      perPixel: (distance) => unitsPerPixel(camera, height, distance),
      perPixelAt: (point) => unitsPerPixelAt(camera, height, point),
    });
  };

  // ---- захват и освобождение указателя ----

  const capturePointer = (pointerId: number) => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // Указатель уже не активен (отпущен между событиями) — жест закончится по pointerup / pointercancel.
    }
  };
  const releasePointer = (pointerId: number) => {
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Захвата уже нет.
    }
  };

  /** Общий выход из любого жеста: кадр отменён, указатель отпущен, камера разблокирована. Draft не трогает. */
  const finish = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    if (gesture.kind === 'pending' || gesture.kind === 'moving' || gesture.kind === 'handle') {
      releasePointer(gesture.pointerId);
    }
    unlockCamera?.();
    unlockCamera = null;
    gesture = IDLE;
    setCursor('');
  };

  /** Escape / pointercancel / blur / размонтирование. true — отменён жест над объектом или ручкой. */
  const cancel = (): boolean => {
    const overObject = gesture.kind === 'pending' || gesture.kind === 'moving' || gesture.kind === 'handle';
    const hadDraft = gesture.kind === 'moving' || (gesture.kind === 'handle' && gesture.active);
    finish();
    if (hadDraft) store().setDraft(null);
    return overObject;
  };

  // ---- кадры ----

  /** Кадр перетаскивания: луч под указателем → патч → draft. Пустой результат (луч мимо поверхности) кадр пропускает. */
  const applyDrag = () => {
    const point = pending;
    pending = null;
    if (!point) return;
    // Ручка, не прошедшая порог, ещё ничего не меняет: простой клик по ней не должен оставить draft.
    if (gesture.kind !== 'moving' && !(gesture.kind === 'handle' && gesture.active)) return;
    const ray = rayAt(point.x, point.y);
    if (!ray) return;
    const ctx = getContext();
    if (!ctx.get(gesture.id)) {
      // Объект исчез посреди жеста (удаление, другой макет, чужая правка).
      cancel();
      return;
    }
    const env: DragEnv = { ctx, grid: store().gridSnap ? GRID_STEP : null, mode };
    const patch =
      gesture.kind === 'moving' ? movePatch(gesture.session, ray, env) : handlePatch(gesture.start, gesture.handle, ray, env);
    if (patch) store().setDraft({ [gesture.id]: patch });
  };

  /** Кадр наведения: подсветка объекта под курсором и форма курсора. */
  const applyHover = () => {
    const point = pending;
    pending = null;
    if (!point || gesture.kind !== 'idle' || store().capturing) return;
    const ray = rayAt(point.x, point.y);
    if (!ray) return;
    const target = targetAt(ray);
    store().setHovered(target?.kind === 'object' ? target.id : null);
    setCursor(cursorFor(target));
  };

  const onFrame = () => {
    frame = 0;
    if (gesture.kind === 'idle') applyHover();
    else applyDrag();
  };
  /** Не чаще раза за кадр: события мыши приходят чаще, чем рисуется сцена. */
  const schedule = (e: PointerEvent) => {
    pending = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(onFrame);
  };

  // ---- события ----

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (store().capturing) return;
    // Предыдущий жест не дождался pointerup (отпустили за окном) — он отменяется, а не «продолжается».
    // Заодно снимается запланированный кадр наведения: его координаты не должны попасть в кадр перетаскивания.
    cancel();

    const ray = rayAt(e.clientX, e.clientY);
    const target = ray ? targetAt(ray) : null;
    // Объект ручки — на момент начала жеста (draft в этот момент пуст).
    const start = target?.kind === 'handle' ? getContext().get(target.id) : undefined;
    if (!ray || !target || (target.kind === 'handle' && !start)) {
      // 4б. Пустое место: событие не трогаем — OrbitControls вращает / двигает камеру.
      gesture = { kind: 'camera', pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }

    // 4а. Ручка или объект: камера выключается ДО того, как событие увидит OrbitControls (фаза всплытия).
    unlockCamera = lockCamera(view.controls(), view.camera());
    capturePointer(e.pointerId);
    store().setHovered(null);
    if (target.kind === 'handle' && start) {
      gesture = {
        kind: 'handle',
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        id: target.id,
        handle: target.handle,
        start,
        active: false,
      };
    } else {
      gesture = { kind: 'pending', pointerId: e.pointerId, x: e.clientX, y: e.clientY, id: target.id, ray };
    }
    setCursor(target.kind === 'handle' ? cursorFor(target) : 'grabbing');
  };

  const onPointerMove = (e: PointerEvent) => {
    switch (gesture.kind) {
      case 'idle':
        if (e.buttons === 0 && (e.pointerType === 'mouse' || e.pointerType === 'pen')) schedule(e);
        return;
      case 'camera':
        // Кнопку отпустили за пределами вьюпорта (pointerup сюда не дошёл): жест камеры закончен, наведение оживает.
        if (e.buttons === 0) {
          gesture = IDLE;
          schedule(e);
        }
        return;
      case 'pending': {
        if (e.pointerId !== gesture.pointerId || !beyondThreshold(gesture, e)) return;
        // Порог пройден: объект выбирается и начинает двигаться. Сессия строится по лучу НАЖАТИЯ — смещение захвата
        // считается от точки, за которую объект взяли, и первый кадр не даёт скачка.
        const ctx = getContext();
        const start = ctx.get(gesture.id);
        if (!start) {
          cancel();
          return;
        }
        store().select(gesture.id);
        gesture = { kind: 'moving', pointerId: gesture.pointerId, id: gesture.id, session: beginMove(start, gesture.ray, ctx) };
        schedule(e);
        return;
      }
      case 'handle':
        if (e.pointerId !== gesture.pointerId) return;
        if (!gesture.active) {
          if (!beyondThreshold(gesture, e)) return;
          gesture.active = true;
        }
        schedule(e);
        return;
      case 'moving':
        if (e.pointerId === gesture.pointerId) schedule(e);
        return;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (gesture.kind === 'idle' || e.pointerId !== gesture.pointerId) return;
    switch (gesture.kind) {
      case 'camera': {
        const click = !beyondThreshold(gesture, e);
        gesture = IDLE;
        // Клик по пустому месту снимает выбор; перетаскивание фона — это движение камеры.
        if (click) store().select(null);
        return;
      }
      case 'pending': {
        const id = gesture.id;
        finish();
        store().select(id);
        return;
      }
      case 'handle':
      case 'moving': {
        const dragged = gesture.kind === 'moving' || gesture.active;
        const label = gestureLabel(gesture.kind === 'moving' ? 'move' : gesture.handle);
        // Последнее положение указателя могло ещё не дойти до кадра — применяем его до коммита.
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
          applyDrag();
        }
        // applyDrag мог отменить жест (объект исчез): тогда коммитить нечего.
        if (isIdle()) return;
        finish();
        // Единственный commitDraft жеста: draft → одна команда через cmdPatch; пустой draft — без команды.
        if (dragged) store().commitDraft(label);
        return;
      }
    }
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (gesture.kind !== 'idle' && e.pointerId === gesture.pointerId) cancel();
  };
  const onLostCapture = (e: PointerEvent) => {
    // После штатного pointerup жест уже завершён, и это событие ничего не делает.
    if ((gesture.kind === 'pending' || gesture.kind === 'moving' || gesture.kind === 'handle') && e.pointerId === gesture.pointerId) {
      cancel();
    }
  };
  const onPointerLeave = () => {
    if (gesture.kind !== 'idle') return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    store().setHovered(null);
    setCursor('');
  };
  const onBlur = () => {
    cancel();
  };

  const options = { capture: true } as const;
  el.addEventListener('pointerdown', onPointerDown, options);
  el.addEventListener('pointermove', onPointerMove, options);
  el.addEventListener('pointerup', onPointerUp, options);
  el.addEventListener('pointercancel', onPointerCancel, options);
  el.addEventListener('lostpointercapture', onLostCapture, options);
  el.addEventListener('pointerleave', onPointerLeave);
  win.addEventListener('blur', onBlur);
  const unregister = registerGestureCancel(cancel);

  return () => {
    // Размонтирование (вход в прогулку, смена режима) посреди жеста: draft сброшен, камера разблокирована.
    cancel();
    unregister();
    el.removeEventListener('pointerdown', onPointerDown, options);
    el.removeEventListener('pointermove', onPointerMove, options);
    el.removeEventListener('pointerup', onPointerUp, options);
    el.removeEventListener('pointercancel', onPointerCancel, options);
    el.removeEventListener('lostpointercapture', onLostCapture, options);
    el.removeEventListener('pointerleave', onPointerLeave);
    win.removeEventListener('blur', onBlur);
    store().setHovered(null);
    el.style.cursor = '';
  };
}

/** Монтируется только при mode !== 'walk' (EditorOverlay). Ничего не рисует. */
export function PointerController({ mode }: { mode: 'orbit' | 'top' }) {
  const el = useThree((s) => s.events.connected) as HTMLElement | undefined;
  // get() отдаёт актуальные камеру и контролы на момент события.
  const get = useThree((s) => s.get);

  useEffect(() => {
    if (!el) return;
    return attachPointerController(el, { camera: () => get().camera, controls: () => get().controls, mode });
  }, [el, get, mode]);

  return null;
}
