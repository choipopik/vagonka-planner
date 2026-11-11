import type { AmbienceId, CameraMode, MountKind, Params, RoomDef, SceneObject, Vec3 } from './types';

export const MAX_LIGHTS = 12;

export interface LightSettings {
  type: 'point' | 'spot';
  color: string;
  /** Канделы. */
  intensity: number;
  /** Метры, всегда конечное. */
  distance: number;
  /** Половина угла конуса, радианы (spot). */
  angle: number;
  penumbra: number;
  /** Наклон луча от оси крепления, радианы, 0…π/2 (spot). Куда именно — lightDirection(). */
  tilt: number;
}

/**
 * Допустимые пределы и умолчания параметров лампы (помощник; в спецификации не описан). Углы — в градусах, как в
 * панели свойств. Из этих же чисел набор `basic` строит поля `light.point` / `light.spot`, чтобы ползунок и
 * зажим в lightSettings не расходились.
 */
export const LIGHT_LIMITS = {
  intensity: { min: 0, max: 200, default: 15 },
  distance: { min: 1, max: 15, default: 8 },
  angle: { min: 10, max: 60, default: 30 },
  penumbra: { min: 0, max: 1, default: 0.5 },
  tilt: { min: 0, max: 90, default: 0 },
} as const;

const DEG = Math.PI / 180;

function setting(params: Params, key: keyof typeof LIGHT_LIMITS): number {
  const limit = LIGHT_LIMITS[key];
  const raw = params[key];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : limit.default;
  return Math.min(limit.max, Math.max(limit.min, value));
}

/**
 * type = o.type === 'light.spot' ? 'spot' : 'point'; color = o.color; остальное — из params (УЖЕ слитых с умолчаниями
 * каталога: resolveParams(getItem(o.type), o.params), их передаёт вызывающий), градусы → радианы, зажим в допустимые
 * пределы; отсутствующий ключ → intensity 15, distance 8, angle 30°, penumbra 0.5, tilt 0.
 */
export function lightSettings(o: SceneObject, params: Params): LightSettings {
  return {
    type: o.type === 'light.spot' ? 'spot' : 'point',
    color: o.color,
    intensity: setting(params, 'intensity'),
    distance: setting(params, 'distance'),
    angle: setting(params, 'angle') * DEG,
    penumbra: setting(params, 'penumbra'),
    tilt: setting(params, 'tilt') * DEG,
  };
}

/**
 * Единичный вектор направления луча прожектора в ЛОКАЛЬНЫХ координатах объекта (лицо — +Z):
 *   ceiling         — от «строго вниз» к лицу:      [0, −cos tilt,  sin tilt]
 *   floor, surface  — от «строго вверх» к лицу:     [0,  cos tilt,  sin tilt]
 *   wall            — от нормали стены (+Z) вниз:   [0, −sin tilt,  cos tilt]
 * tilt = 0 — вдоль оси крепления (вниз / вверх / от стены). Куда смотрит лицо, задаёт rotationY (у стены — её нормаль).
 */
export function lightDirection(mount: MountKind, tilt: number): Vec3 {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  if (mount === 'ceiling') return [0, -c, s];
  if (mount === 'wall') return [0, -s, c];
  return [0, c, s];
}

/** Первые (MAX_LIGHTS − reserved) видимых объектов kind 'light' в порядке макета. Остальные рисуются тусклым маркером. */
export function activeLightIds(objects: readonly SceneObject[], reserved = 0): ReadonlySet<string> {
  const limit = Math.max(0, MAX_LIGHTS - Math.max(0, reserved));
  const ids = new Set<string>();
  for (const o of objects) {
    if (ids.size >= limit) break;
    if (o.kind === 'light' && o.visible) ids.add(o.id);
  }
  return ids;
}

export interface AmbienceDef {
  id: AmbienceId;
  title: string;
  background: string;
  ambient: { color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number } | null;
  /** Направленный «верхний» свет — единственный источник теней в приложении. null — выключен. */
  sun: { intensity: number } | null;
  exposure: number;
  /** Включить room.washes как настоящие прожекторы. */
  washes: boolean;
}

export const AMBIENCES: Record<AmbienceId, AmbienceDef> = {
  // Ровно свет этапа 1.
  work: {
    id: 'work',
    title: 'Рабочий свет',
    background: '#1b1a1d',
    ambient: { color: '#ffffff', intensity: 1.1 },
    hemisphere: { sky: '#ffffff', ground: '#6b5a55', intensity: 0.9 },
    sun: { intensity: 1.6 },
    exposure: 1,
    washes: false,
  },
  party: {
    id: 'party',
    title: 'Вечеринка',
    background: '#070608',
    ambient: { color: '#5a3038', intensity: 0.18 },
    hemisphere: { sky: '#3a1418', ground: '#120808', intensity: 0.25 },
    sun: null,
    exposure: 1.15,
    washes: true,
  },
};

/** На плане всегда 'work', чтобы план читался. */
export function effectiveAmbience(ambience: AmbienceId, mode: CameraMode): AmbienceId {
  return mode === 'top' ? 'work' : ambience;
}

/** Сколько слотов из MAX_LIGHTS заняты заливками помещения при данной атмосфере и режиме. */
export function reservedLights(room: RoomDef, ambience: AmbienceId, mode: CameraMode): number {
  if (!AMBIENCES[effectiveAmbience(ambience, mode)].washes) return 0;
  return Math.min(MAX_LIGHTS, room.washes?.length ?? 0);
}
