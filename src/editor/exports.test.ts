// Точки входа пакета W2 (таблица 2.19): модули загружаются без DOM и экспортируют замороженные имена.
import { describe, expect, it } from 'vitest';

describe('точки входа W2', () => {
  it('EditorOverlay, Hud, useShortcuts', async () => {
    const overlay = await import('./EditorOverlay');
    const hud = await import('./Hud');
    const shortcuts = await import('./shortcuts');
    expect(typeof overlay.EditorOverlay).toBe('function');
    expect(typeof hud.Hud).toBe('function');
    expect(typeof shortcuts.useShortcuts).toBe('function');
  });

  it('OrbitMode, TopMode, WalkMode', async () => {
    const modes = await import('../scene/controls/CameraModes');
    expect(typeof modes.OrbitMode).toBe('function');
    expect(typeof modes.TopMode).toBe('function');
    expect(typeof modes.WalkMode).toBe('function');
  });

  it('константы 2.20', async () => {
    const constants = await import('./constants');
    // Объект-модуль имеет Symbol.toStringTag, поэтому сравниваются его собственные перечислимые свойства.
    expect({ ...constants }).toEqual({ DRAG_THRESHOLD_PX: 4, HANDLE_PX: 9, PICK_MIN_PX: 10, PICK_TIE: 0.02 });
  });
});
