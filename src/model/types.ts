/** Все размеры и координаты — в метрах. Ось X — вдоль длинной стены, Z — поперёк, Y — вверх. */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Луч в мировых координатах; dir нормирован. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

// ---------- Помещение ----------

/**
 * Стена задаётся отрезком from → to на полу. Порядок точек такой, что при взгляде
 * на стену изнутри помещения `from` находится слева: тогда `offset` панелей
 * отсчитывается слева направо, как на фото.
 */
export interface WallDef {
  id: string;
  from: Vec2;
  to: Vec2;
  lowerColor: string;
  upperColor: string;
  /** Высота, на которой нижний цвет сменяется верхним. */
  splitHeight: number;
  /** Название для панели свойств («Дальняя стена»); по умолчанию id. */
  name?: string;
}

export type PanelKind = 'photo' | 'opening' | 'curtain';

/** Прямоугольник на стене: фото, проём или штора. */
export interface WallPanel {
  id: string;
  wall: string;
  kind: PanelKind;
  /** Расстояние от левого края стены (от `from`) до левого края панели. */
  offset: number;
  width: number;
  /** Высота нижнего края над полом. */
  bottom: number;
  height: number;
  color: string;
  /** Путь к текстуре относительно public/. */
  texture?: string;
  label?: string;
  /** Порядок наложения: панель с большим слоем рисуется поверх. */
  layer?: number;
}

/** Грань колонны по направлению её нормали: n = −Z, e = +X, s = +Z, w = −X. */
export type ColumnFace = 'n' | 'e' | 's' | 'w';

export interface ColumnFaceDef {
  /** Процедурная кирпичная кладка вместо краски. */
  brick?: boolean;
  /** Запечённая текстура грани относительно public/ (перекрывает brick). */
  texture?: string;
}

export interface ColumnDef {
  id: string;
  position: Vec2;
  size: Vec2;
  /** Цвет краски для граней без описания. */
  color: string;
  faces?: Partial<Record<ColumnFace, ColumnFaceDef>>;
  /** Название для панели свойств («Левая колонна»); по умолчанию id. */
  name?: string;
}

/** Подиум: прямоугольник пола, поднятый на `height`. */
export interface PlatformDef {
  id: string;
  min: Vec2;
  max: Vec2;
  height: number;
  color: string;
}

/** Стационарный прожектор площадки; включается атмосферой «Вечеринка». */
export interface WashDef {
  id: string;
  position: Vec3;
  target: Vec3;
  color: string;
  /** Канделы. */
  intensity: number;
  /** Половина угла конуса, радианы. */
  angle: number;
}

export interface RoomDef {
  id: string;
  name: string;
  size: { length: number; width: number; height: number };
  floorColor: string;
  ceilingColor: string;
  /** 'terrazzo' — процедурная крошка поверх floorColor. По умолчанию 'plain'. */
  floorSurface?: 'plain' | 'terrazzo';
  walls: WallDef[];
  panels: WallPanel[];
  columns: ColumnDef[];
  platforms: PlatformDef[];
  /** Мебель площадки: копируется в новый макет с origin: 'venue'. */
  fixtures: SceneObject[];
  /** Заливки для атмосферы «Вечеринка». */
  washes?: WashDef[];
  /** Точка старта прогулки и направление взгляда (0 — в сторону −Z). */
  spawn: { position: Vec2; yaw: number };
}

// ---------- Крепления ----------

export type MountKind = 'floor' | 'wall' | 'ceiling' | 'surface';

export type Mount =
  /** Стоит на полу или подиуме под точкой (x, z). lift — зазор между опорой и основанием. */
  | { kind: 'floor'; x: number; z: number; lift: number }
  /**
   * Спиной к стене или грани колонны (id из wallSurfaces()). along — от `from` поверхности до центра объекта,
   * bottom — высота основания над полом помещения (y = 0).
   */
  | { kind: 'wall'; surfaceId: string; along: number; bottom: number }
  /** Висит под потолком. drop — расстояние от потолка вниз до ВЕРХА объекта. */
  | { kind: 'ceiling'; x: number; z: number; drop: number }
  /** Стоит на верхней грани другого объекта. (u, v) — центр основания в локальных X/Z хозяина. */
  | { kind: 'surface'; hostId: string; u: number; v: number };

// ---------- Объекты и макет ----------

export type ObjectKind = 'primitive' | 'image' | 'model' | 'light' | 'preset';

export interface SceneObject {
  // --- неизменяемые после создания ---
  id: string;
  kind: ObjectKind;
  /** id записи каталога (CatalogItem.id): 'sofaU', 'box', 'light.spot', 'image', 'model', 'hp.dementor'. */
  type: string;
  origin: 'venue' | 'user';
  // --- изменяемые (ровно ключи ObjectPatch) ---
  name: string;
  mount: Mount;
  /** Радианы вокруг +Y. floor/ceiling — мировой угол; surface — относительно хозяина; wall — игнорируется (0). */
  rotationY: number;
  /** Габариты: ширина (X), высота (Y), глубина (Z). */
  size: Vec3;
  /** '#rrggbb'. */
  color: string;
  /** Только image / model; иначе null. */
  assetId: string | null;
  locked: boolean;
  visible: boolean;
  /** {} — если у типа нет параметров. Хранятся только отличия; значения по умолчанию даёт каталог. */
  params: Params;
}

export const SCHEMA_VERSION = 2;

export interface Layout {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  roomId: string;
  /** Порядок вставки; определяет порядок в списке и приоритет ламп (первые 12 активны). */
  objects: SceneObject[];
  updatedAt: number;
}

export type CameraMode = 'orbit' | 'top' | 'walk';
/** Переключатель «Слой» на панели инструментов. */
export type LayerMode = 'auto' | 'floor' | 'ceiling';
export type AmbienceId = 'work' | 'party';

// ---------- Пользовательские файлы ----------

export type AssetKind = 'image' | 'model';
/** 'model/gltf+json' — только самодостаточный .gltf (буферы и картинки — data: URI). */
export type AssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'model/gltf-binary' | 'model/gltf+json';

export interface AssetMeta {
  /** 'a_' + первые 32 hex-символа SHA-256 содержимого. */
  id: string;
  kind: AssetKind;
  /** Исходное имя файла, ≤ 120 символов. */
  name: string;
  mime: AssetMime;
  bytes: number;
  createdAt: number;
  /** Картинка: пиксели. */
  width?: number;
  height?: number;
  /** Модель: габариты как в файле, метры. */
  naturalSize?: Vec3;
}
