import { describe, expect, it } from 'vitest';
import {
  AMBIENCES,
  MAX_LIGHTS,
  activeLightIds,
  effectiveAmbience,
  lightDirection,
  lightSettings,
  reservedLights,
} from './lights';
import { testRoom } from './testRoom';
import type { AmbienceId, CameraMode, MountKind, RoomDef, SceneObject, Vec3, WashDef } from './types';

function light(id: string, over: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    kind: 'light',
    type: 'light.point',
    origin: 'user',
    name: id,
    mount: { kind: 'ceiling', x: 0, z: 0, drop: 0.4 },
    rotationY: 0,
    size: [0.15, 0.15, 0.15],
    color: '#ffd9a0',
    assetId: null,
    locked: false,
    visible: true,
    params: {},
    ...over,
  };
}

const box = (id: string): SceneObject => light(id, { kind: 'primitive', type: 'box', mount: { kind: 'floor', x: 0, z: 0, lift: 0 } });
const DEG = Math.PI / 180;
const MODES: CameraMode[] = ['orbit', 'top', 'walk'];
const MOUNTS: MountKind[] = ['floor', 'wall', 'ceiling', 'surface'];

function expectVec(actual: Vec3, expected: Vec3) {
  expect(actual[0]).toBeCloseTo(expected[0], 12);
  expect(actual[1]).toBeCloseTo(expected[1], 12);
  expect(actual[2]).toBeCloseTo(expected[2], 12);
}

describe('activeLightIds', () => {
  const many = Array.from({ length: 20 }, (_, i) => light(`l${i}`));

  it('предел 12: активны первые MAX_LIGHTS в порядке макета', () => {
    expect(MAX_LIGHTS).toBe(12);
    const active = activeLightIds(many);
    expect([...active]).toEqual(many.slice(0, 12).map((o) => o.id));
    // Порядок макета, а не id: тот же набор в обратном порядке даёт последние 12.
    const reversed = many.slice().reverse();
    expect([...activeLightIds(reversed)]).toEqual(reversed.slice(0, 12).map((o) => o.id));
    // Меньше предела — все.
    expect([...activeLightIds(many.slice(0, 3))]).toEqual(['l0', 'l1', 'l2']);
    expect(activeLightIds([]).size).toBe(0);
  });

  it('reserved уменьшает число слотов', () => {
    expect([...activeLightIds(many, 4)]).toEqual(many.slice(0, 8).map((o) => o.id));
    expect(activeLightIds(many, 0).size).toBe(12);
    expect(activeLightIds(many, 12).size).toBe(0);
    expect(activeLightIds(many, 100).size).toBe(0);
    // Отрицательный резерв не добавляет слотов сверх предела.
    expect(activeLightIds(many, -5).size).toBe(12);
  });

  it('скрытые и не-лампы не считаются и слотов не занимают', () => {
    const objects = [
      box('b0'),
      light('hidden-0', { visible: false }),
      ...many.slice(0, 5),
      box('b1'),
      light('hidden-1', { visible: false }),
      ...many.slice(5),
    ];
    const active = activeLightIds(objects);
    expect([...active]).toEqual(many.slice(0, 12).map((o) => o.id));
    expect(active.has('hidden-0')).toBe(false);
    expect(active.has('b0')).toBe(false);
    // Заблокированная лампа — обычная лампа.
    expect(activeLightIds([light('locked', { locked: true })]).has('locked')).toBe(true);
    // Прожектор тоже лампа.
    expect(activeLightIds([light('spot', { type: 'light.spot' })]).has('spot')).toBe(true);
  });
});

describe('lightSettings', () => {
  it('тип — по type объекта, цвет — цвет объекта', () => {
    expect(lightSettings(light('a'), {}).type).toBe('point');
    expect(lightSettings(light('a', { type: 'light.spot' }), {}).type).toBe('spot');
    expect(lightSettings(light('a', { type: 'something.else' }), {}).type).toBe('point');
    expect(lightSettings(light('a', { color: '#123456' }), {}).color).toBe('#123456');
  });

  it('отсутствующие ключи → умолчания: 15 кд, 8 м, 30°, 0.5, 0', () => {
    const s = lightSettings(light('a', { type: 'light.spot' }), {});
    expect(s.intensity).toBe(15);
    expect(s.distance).toBe(8);
    expect(s.angle).toBeCloseTo(30 * DEG, 12);
    expect(s.penumbra).toBe(0.5);
    expect(s.tilt).toBe(0);
  });

  it('значения берутся из переданных params; градусы → радианы', () => {
    const o = light('a', { type: 'light.spot', params: { intensity: 1 } });
    // Объект хранит только отличия — читаются УЖЕ слитые params, а не o.params.
    const s = lightSettings(o, { intensity: 40, distance: 6, angle: 45, penumbra: 0.25, tilt: 60 });
    expect(s.intensity).toBe(40);
    expect(s.distance).toBe(6);
    expect(s.angle).toBeCloseTo(Math.PI / 4, 12);
    expect(s.penumbra).toBe(0.25);
    expect(s.tilt).toBeCloseTo(Math.PI / 3, 12);
  });

  it('зажимает в допустимые пределы', () => {
    const o = light('a', { type: 'light.spot' });
    const high = lightSettings(o, { intensity: 1e6, distance: 1e6, angle: 170, penumbra: 5, tilt: 400 });
    expect(high.intensity).toBe(200);
    expect(high.distance).toBe(15);
    expect(high.angle).toBeCloseTo(60 * DEG, 12);
    expect(high.penumbra).toBe(1);
    expect(high.tilt).toBeCloseTo(Math.PI / 2, 12);
    const low = lightSettings(o, { intensity: -5, distance: 0, angle: 1, penumbra: -1, tilt: -30 });
    expect(low.intensity).toBe(0);
    expect(low.distance).toBe(1);
    expect(low.angle).toBeCloseTo(10 * DEG, 12);
    expect(low.penumbra).toBe(0);
    expect(low.tilt).toBe(0);
  });

  it('мусор вместо числа → умолчание; distance всегда конечное', () => {
    const o = light('a', { type: 'light.spot' });
    const s = lightSettings(o, { intensity: 'ярко', distance: Infinity, angle: NaN, penumbra: true, tilt: '45' });
    expect(s).toEqual({ ...lightSettings(o, {}), color: o.color });
    expect(Number.isFinite(s.distance)).toBe(true);
    for (const value of [s.intensity, s.distance, s.angle, s.penumbra, s.tilt]) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('lightDirection', () => {
  it('единичная длина при любом наклоне и креплении', () => {
    for (const mount of MOUNTS) {
      for (const tilt of [0, 0.1, Math.PI / 6, Math.PI / 4, 1, Math.PI / 2]) {
        expect(Math.hypot(...lightDirection(mount, tilt)), `${mount} ${tilt}`).toBeCloseTo(1, 12);
        // Луч наклоняется только в плоскости YZ: вбок (по X) не уходит.
        expect(lightDirection(mount, tilt)[0], `${mount} ${tilt}`).toBe(0);
      }
    }
  });

  it('tilt = 0 — вдоль оси крепления: вниз (потолок), вверх (пол / стол), +Z (стена)', () => {
    expectVec(lightDirection('ceiling', 0), [0, -1, 0]);
    expectVec(lightDirection('floor', 0), [0, 1, 0]);
    expectVec(lightDirection('surface', 0), [0, 1, 0]);
    expectVec(lightDirection('wall', 0), [0, 0, 1]);
  });

  it('tilt = π/2 → +Z (потолок, пол, стол), вниз (стена)', () => {
    expectVec(lightDirection('ceiling', Math.PI / 2), [0, 0, 1]);
    expectVec(lightDirection('floor', Math.PI / 2), [0, 0, 1]);
    expectVec(lightDirection('surface', Math.PI / 2), [0, 0, 1]);
    expectVec(lightDirection('wall', Math.PI / 2), [0, -1, 0]);
  });

  it('промежуточный наклон — от оси крепления к лицу (у стены — вниз)', () => {
    const t = Math.PI / 6;
    expectVec(lightDirection('ceiling', t), [0, -Math.cos(t), Math.sin(t)]);
    expectVec(lightDirection('floor', t), [0, Math.cos(t), Math.sin(t)]);
    expectVec(lightDirection('surface', t), [0, Math.cos(t), Math.sin(t)]);
    expectVec(lightDirection('wall', t), [0, -Math.sin(t), Math.cos(t)]);
  });
});

describe('AMBIENCES / effectiveAmbience / reservedLights', () => {
  const wash = (id: string): WashDef => ({ id, position: [0, 3, 0], target: [0, 0, 0], color: '#ff0000', intensity: 100, angle: 0.5 });
  const withWashes = (n: number): RoomDef => ({ ...testRoom, washes: Array.from({ length: n }, (_, i) => wash(`w${i}`)) });

  it('значения атмосфер — как в спецификации', () => {
    expect(AMBIENCES.work).toEqual({
      id: 'work',
      title: 'Рабочий свет',
      background: '#1b1a1d',
      ambient: { color: '#ffffff', intensity: 1.1 },
      hemisphere: { sky: '#ffffff', ground: '#6b5a55', intensity: 0.9 },
      sun: { intensity: 1.6 },
      exposure: 1,
      washes: false,
    });
    expect(AMBIENCES.party).toEqual({
      id: 'party',
      title: 'Вечеринка',
      background: '#070608',
      ambient: { color: '#5a3038', intensity: 0.18 },
      hemisphere: { sky: '#3a1418', ground: '#120808', intensity: 0.25 },
      sun: null,
      exposure: 1.15,
      washes: true,
    });
    for (const id of Object.keys(AMBIENCES) as AmbienceId[]) expect(AMBIENCES[id].id).toBe(id);
  });

  it('effectiveAmbience: на плане всегда work, иначе — выбранная', () => {
    expect(effectiveAmbience('party', 'top')).toBe('work');
    expect(effectiveAmbience('work', 'top')).toBe('work');
    expect(effectiveAmbience('party', 'orbit')).toBe('party');
    expect(effectiveAmbience('party', 'walk')).toBe('party');
    expect(effectiveAmbience('work', 'orbit')).toBe('work');
    expect(effectiveAmbience('work', 'walk')).toBe('work');
  });

  it('reservedLights: заливки занимают слоты только в «Вечеринке» и не на плане', () => {
    const room = withWashes(4);
    expect(reservedLights(room, 'party', 'orbit')).toBe(4);
    expect(reservedLights(room, 'party', 'walk')).toBe(4);
    expect(reservedLights(room, 'party', 'top')).toBe(0);
    for (const mode of MODES) expect(reservedLights(room, 'work', mode), mode).toBe(0);
    // Помещение без заливок.
    for (const mode of MODES) expect(reservedLights(testRoom, 'party', mode), mode).toBe(0);
    expect(reservedLights(withWashes(0), 'party', 'orbit')).toBe(0);
    // Заливок больше, чем слотов.
    expect(reservedLights(withWashes(30), 'party', 'orbit')).toBe(MAX_LIGHTS);
  });

  it('заливки и лампы вместе не превышают MAX_LIGHTS', () => {
    const lamps = Array.from({ length: 20 }, (_, i) => light(`l${i}`));
    for (const n of [0, 4, 12, 30]) {
      const reserved = reservedLights(withWashes(n), 'party', 'orbit');
      const active = activeLightIds(lamps, reserved);
      expect(reserved + active.size, `заливок ${n}`).toBe(MAX_LIGHTS);
    }
  });
});
