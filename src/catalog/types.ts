import type { MountKind, ObjectKind, Params, SceneObject, Vec3 } from '../model/types';

// ---------- Параметры (панель свойств строит по ним поля) ----------
export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; type: 'text'; default: string; multiline?: boolean; maxLength?: number }
  /** Целый seed; в панели — кнопка «Перемешать». */
  | { key: string; label: string; type: 'seed'; default: number };

// ---------- Части (плоские данные; ни three.js, ни DOM) ----------
export type PartShape = 'box' | 'cylinder' | 'sphere' | 'plane' | 'torus';

/** Ссылка на canvas-текстуру. Ключ кэша = painter + JSON(args) + px. */
export interface PaintRef {
  painter: string;
  args?: Params;
  px: [number, number];
}

export interface Part {
  shape: PartShape;
  /** Центр части в локальных координатах объекта. */
  position: Vec3;
  /**
   * box      — [w, h, d]
   * cylinder — [диаметр по X (низ), высота, диаметр по Z (низ)], ось Y
   * sphere   — три диаметра (эллипсоид)
   * plane    — [w, h, 0], лежит в плоскости XY лицом в +Z
   * torus    — [D, D, t]: кольцо в плоскости XY (ось Z), внешний диаметр D, диаметр трубки t
   */
  size: Vec3;
  /** Эйлер XYZ, радианы. */
  rotation?: Vec3;
  color: string;
  /** Только cylinder: радиус верха / радиус низа; 0 — конус. По умолчанию 1. Используйте значения, кратные 0.05. */
  taper?: number;
  /**
   * 'lit'    — MeshStandardMaterial (по умолчанию)
   * 'glow'   — MeshBasicMaterial, toneMapped: false: выглядит самосветящимся в любой атмосфере
   * 'matcap' — MeshMatcapMaterial, matcap = paint; не зависит от света сцены
   */
  look?: 'lit' | 'glow' | 'matcap';
  /** Только 'lit'. */
  emissive?: string;
  emissiveIntensity?: number;
  /** По умолчанию 0.85 / 0. */
  roughness?: number;
  metalness?: number;
  /** < 1 → прозрачный материал. */
  opacity?: number;
  /** AdditiveBlending + depthWrite: false (ореолы). Такие части не отбрасывают тень, не участвуют в выборе мышью и в проверке габарита. */
  additive?: boolean;
  doubleSided?: boolean;
  /** alphaTest 0.5 по альфа-каналу paint (вырезанные силуэты). */
  cutout?: boolean;
  /**
   * Карта цвета ('lit' / 'glow') либо matcap-текстура ('matcap'). Как canvas painter’а ложится на форму (договор между
   * painters из W6/W7 и единичными геометриями W3; верх canvas — всегда локальный +Y):
   *   plane    — canvas прямо, левый край — локальный −X (со стороны +Z читается слева направо; с изнанки
   *              doubleSided-плоскости — зеркально, поэтому «оборот» с текстом делают второй плоскостью)
   *   box      — каждая из шести граней получает весь canvas; на грани +Z он расположен как на plane
   *   cylinder — canvas один раз оборачивает боковую поверхность вокруг оси Y; ГОРИЗОНТАЛЬНЫЙ ЦЕНТР canvas смотрит в
   *              локальный +Z, левый край и шов — сзади (−Z); при взгляде спереди читается слева направо
   *   sphere   — так же, как cylinder (равнопромежуточная развёртка, полюса — верх и низ canvas)
   *   torus    — раскладка не гарантируется: только однотонные или тайлящиеся рисунки
   * Для 'matcap' раскладка не имеет значения.
   */
  paint?: PaintRef;
}

export interface BuildInput {
  size: Vec3;
  color: string;
  /** Уже слиты с умолчаниями и зажаты (resolveParams). */
  params: Params;
  mount: MountKind;
}
/**
 * ЧИСТАЯ: без three.js, DOM, Math.random (только createRng(params.seed)). Одинаковый вход → deep-равный выход.
 * Все не-additive части лежат в боксе [−w/2, w/2] × [0, h] × [−d/2, d/2] с допуском 10 % размера + 2 см по каждой оси:
 * partBounds(part) должен укладываться в [−w/2 − (0.1w + 0.02), w/2 + (0.1w + 0.02)] и т. д. Правило действует при ЛЮБОМ
 * допустимом входе — при умолчаниях, при minSize / maxSize и при крайних значениях параметров (проверяет checkBuild).
 */
export type Builder = (input: BuildInput) => Part[];

/** Рисует текстуру в очищенный canvas; вызывается только в браузере. Шрифты — системные стеки, без сети. */
export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number, args: Params) => void;

/** Бокс в локальных координатах объекта, оси параллельны локальным. */
export interface LocalBox {
  center: Vec3;
  size: Vec3;
}

// ---------- Каталог ----------
export interface CatalogItem {
  /** = SceneObject.type; уникален во всём каталоге. */
  id: string;
  kind: ObjectKind;
  /** Название в библиотеке и имя нового объекта. */
  title: string;
  /** Группа в библиотеке: «Мебель», «Фигуры», «Свет», «Гарри Поттер»… */
  category: string;
  /** Одна короткая строка под названием карточки. */
  hint?: string;
  /** Размер нового объекта. */
  size: Vec3;
  minSize?: Vec3;
  maxSize?: Vec3;
  /** free — w, h, d независимы; uniform — один коэффициент; none — размер не меняется. Правило — clampSize (2.10). */
  resize: 'free' | 'uniform' | 'none';
  /**
   * Ось толщины плоского предмета (0 — X, 1 — Y, 2 — Z): при любом изменении размера сохраняет прежнее значение —
   * не масштабируется при 'uniform', не имеет ручки и поля в панели свойств. У `image` — 2, у `image.flat` — 1.
   */
  flatAxis?: 0 | 1 | 2;
  /** Цвет нового объекта. */
  color: string;
  /** false прячет поле цвета. По умолчанию true. */
  colorable?: boolean;
  /** Допустимые крепления; первое — по умолчанию. */
  mounts: MountKind[];
  /** Опуск от потолка для нового потолочного объекта. По умолчанию 0. */
  defaultDrop?: number;
  /** Высота низа для нового настенного объекта, когда луч не попал в стену. По умолчанию 1.2. */
  defaultBottom?: number;
  params: ParamDef[];
  /** На верхнюю грань можно ставить другие объекты (столы, ящики). */
  support?: boolean;
  /** Рисовать нить от верха объекта до потолка при потолочном креплении и drop > 3 см. По умолчанию true. */
  hanger?: boolean;
  /** false — не показывать в библиотеке (объекты только для площадки, image/model). По умолчанию true. */
  listed?: boolean;
  /** Только kind 'primitive' | 'preset'. */
  build?: Builder;
  /** Грубые боксы для выбора мышью вместо выведенных из частей (большие разрежённые пресеты). */
  pickBoxes?: (input: BuildInput) => LocalBox[];
}

export interface CatalogSet {
  id: string;
  title: string;
  /** Порядок наборов в библиотеке. */
  order: number;
  items: CatalogItem[];
  /** Имена — с префиксом набора: 'hp.prophetPage'. */
  painters?: Record<string, Painter>;
}

/**
 * Всё, что чистые функции src/model знают о каталоге (Р22). Модель получает это ПАРАМЕТРОМ и не импортирует
 * src/catalog/index. Реализация — `catalogLookup` из src/catalog/index.ts; в тестах модели — самодельный объект.
 */
export interface CatalogLookup {
  /** Никогда не бросает: неизвестный type → запасная запись. */
  getItem(type: string): CatalogItem;
  /** На объект можно ставить другие: getItem(o.type).support === true && o.visible && o.mount.kind === 'floor'. */
  isSupport(o: SceneObject): boolean;
}
