# Vagonka · планировщик площадки — спецификация этапа 2 (редактор, потолок, декор)

Документ сводит три независимых предложения (interaction-first, data-first, decor-first) в одну спецификацию.
Проза — по-русски, идентификаторы и код — по-английски. Раздел 2 «Контракты» — истина в последней инстанции:
если текст в других разделах расходится с сигнатурой, верна сигнатура.

Что проверено по `node_modules`, а не по памяти (three 0.187.0, @react-three/fiber 9.8.2, @react-three/drei 10.7.9,
three-stdlib 2.36.1, zustand 5.1.0, idb-keyval 6.3.0, vitest 5.1.0, TypeScript 7.0.2, Node 26.8.1):

| Факт | Где проверен |
|---|---|
| `OrbitControls` из three-stdlib: `onPointerDown` начинается с `if (scope.enabled === false) return` | `three-stdlib/controls/OrbitControls.js:614–617` |
| drei `OrbitControls` подключается к `events.connected` (div-обёртка Canvas), `makeDefault` кладёт экземпляр в `state.controls` | `@react-three/drei/core/OrbitControls.js:27–71` |
| R3F: `state.events.connect(eventSource ?? divRef.current)`; `ThreeEvent` несёт `ray`, `delta`; есть `onPointerMissed` | `@react-three/fiber/dist/react-three-fiber.esm.js:67–103`, `declarations/src/core/events.d.ts` |
| drei `TransformControls`: props `mode, space, showX/Y/Z, translationSnap, rotationSnap, scaleSnap, onObjectChange, onMouseDown/Up`; сам отключает `makeDefault`-контролы по `dragging-changed` | `@react-three/drei/core/TransformControls.d.ts`, `.js:53` (в итоге **не используется**, см. решение Р7) |
| `PointLight`/`SpotLight`: intensity в канделах, `decay = 2`; `useLegacyLights` в `three/src` отсутствует | `three/src/lights/PointLight.js:25–29` |
| `Raycaster.setFromCamera` поддерживает ортографическую камеру | `three/src/core/Raycaster.js:127` |
| `GLTFLoader.parseAsync(data, path)`, `setMeshoptDecoder`; декодер Meshopt лежит в `three/examples/jsm/libs/meshopt_decoder.module.js`; Draco требует внешних wasm | `three/examples/jsm/loaders/GLTFLoader.js:386,573` |
| `GLTFLoader.parse` принимает и `ArrayBuffer` с GLB, и `ArrayBuffer`/строку с JSON `.gltf` (смотрит на сигнатуру `glTF`); расширение Draco создаётся по `extensionsUsed` (не только `extensionsRequired`) и без `DRACOLoader` бросает «No DRACOLoader instance provided» | `GLTFLoader.js:439–470, 519–534, 2000–2004` |
| В `@types/react` 19 **нет глобального** пространства имён `JSX` (только `React.JSX`); R3F расширяет модули `react` / `react/jsx-runtime`, а не глобальную область | `@types/react/index.d.ts:4226`, `@react-three/fiber/dist/declarations/src/three-types.d.ts` |
| `CylinderGeometry`: шов `u = 0/1` приходится на локальный +Z (`x = sin θ, z = cos θ`); `SphereGeometry`: `u = 0` на −X, `u = 0.25` на +Z | `three/src/geometries/CylinderGeometry.js:119–130`, `SphereGeometry.js:105–118` |
| `vite.config.ts`: `server: { port: 5173, strictPort: true }`; в `.claude/launch.json` одна конфигурация `date-map` → dev-сервер в каталоге может быть только один | `vite.config.ts`, `.claude/launch.json` |
| `three/addons/*` — алиас `three/examples/jsm/*` | `three/package.json` exports |
| Node 26.8 импортирует `.ts` из `.mjs` без флагов (type stripping) | пробный запуск `node probe.mjs` → `ts-import-ok 42` |
| `sharp` сейчас не установлен (его ставит F до заморозки); конфигурации vitest нет (include по умолчанию `**/*.test.ts`) | `package.json`, корень проекта |
| `src/rooms/lounge.ts` содержит только `import type` → Node-скрипт может импортировать его так же, как `homography.ts` | `src/rooms/lounge.ts:1` |

Что видно на входных материалах и повлияло на решения:

- **Потолок площадки не пустой** (фото 3, 4): вдоль линии колонн идёт чёрный воздуховод с трубами, на проводах висят
  лампы Эдисона (0.4–0.8 м вниз), перед муралом висит проектор, на верхушках колонн стоят красные PAR-прожекторы.
  Потолочный декор должен с этим сосуществовать → эти вещи входят в модель как скрываемая «мебель площадки»
  с потолочным креплением.
- Столы кабинок стоят **внутри** П-образных диванов (фото 4), а настольный декор ставится именно на них →
  выбор мышью по одному габаритному боксу на объект не годится (диван «съедает» стол).
- Колонны: часть граней — кирпич, часть — красная краска с надписью; это естественное место для плакатов →
  грани колонн считаются стенами для настенного крепления.
- Референсы декора: 3 из 11 предметов живут на потолке (облака со свечами и шляпами, сова с письмами, клетка
  как вариант); это большие разрежённые объёмы до 4 × 3 × 1.1 м, которые в облёте оказываются между камерой и полом.
  Большинство остального — плоская печать (газеты, конверты, сова-вырезка, указатель, фоторамка): правильный
  примитив — плоскость с canvas-текстурой, а не скульптурная сетка.

---

## 1. Решения

| № | Тема | Решение | Почему (и что отвергнуто) |
|---|---|---|---|
| Р1 | Модель креплений | `SceneObject.mount` — размеченное объединение `floor / wall / ceiling / surface`; мировая поза **не хранится**, а выводится одной чистой функцией `resolvePose()` | Размеры помещения «на глаз» и будут правиться в `src/rooms/*.ts`: свеча «0.4 м от потолка» и плакат «стена far, 3.2 м от края» сами едут за потолком/стеной; предмет на столе едет за столом, в т. ч. при «Сбросить мебель». Отвергнуто: хранить мировую позицию + `settle()` (нужен инвариант и ручной перенос зависимых объектов в каждой команде) |
| Р2 | Стены для декора | `wallSurfaces(room)` = стены помещения + 4 грани каждой колонны; настенное крепление ссылается на `surfaceId` | Плакаты на колоннах — без отдельного типа крепления; ~30 строк чистого кода |
| Р3 | Потолок как поверхность | Крепление `ceiling { x, z, drop }`: `drop` — расстояние от потолка до **верха** объекта; тип крепления меняется только явно (панель свойств), при перетаскивании потолочный объект остаётся потолочным | С орбитальной камеры и с плана луч не попадает в потолок снизу, поэтому «переключение на потолок по курсору» работать не может; явное — предсказуемо |
| Р4 | Видимость потолка и ближних стен по режимам камеры | Плоскости потолка и стен остаются односторонними (сверху и снаружи не видны). Декор на отсечённой поверхности ведёт себя одинаково для потолка и стен: **сплошной**, когда камера видит лицевую сторону поверхности (прогулка, облёт изнутри); **призрак 30 % + контур, клики проходят насквозь**, когда камера смотрит на поверхность с изнанки — потолочный декор при виде сверху (план или камера облёта выше потолка), настенный — когда камера облёта находится за плоскостью его стены или грани колонны. Один переключатель «Слой: Авто · Пол · Потолок» перекрывает автоматику для потолка. Выбранный объект никогда не призрак и всегда доступен для перетаскивания | Требование «потолок не мешает в облёте, но декор виден во всех режимах» выполняется автоматически, без действий пользователя; баннер или стена газет на ближней стене не заслоняет зал и не перехватывает клики; одна чистая функция `layerView()`, одна `backSurfaces()` и два предиката. Отвергнуто: пометка `canopy` на отдельных частях и chip-ручка (усложняет рендерер), два независимых переключателя `editLayer` + `ceilingView`, скрывать настенный декор со спины полностью (он «пропадает» из вида) |
| Р5 | Выбор мышью | Аналитический, на чистом TypeScript: луч против локальных боксов, выведенных из тех же `Part[]`, что и рендер; на мешах сцены **нет** обработчиков R3F. Побеждает **ближайшее** попадание (выбранный объект — только при равенстве в пределах 2 см) | Потолок и ближние стены отсечены и не рейкастятся; составные объекты выбираются по реальным частям (стол внутри кабинки, дырка фоторамки); правило «заблокирован / скрыт / призрак» — один предикат; всё тестируется vitest без браузера; рендереры не знают о событиях |
| Р6 | Указатель | Один DOM-конвейер: capture-слушатель `pointerdown` на div-обёртке Canvas решает «объект или камера» и ставит `controls.enabled = false` до того, как событие увидит OrbitControls | Проверено по исходникам (см. таблицу выше); не зависит от порядка регистрации слушателей |
| Р7 | Гизмо | Свой лёгкий набор ручек (поворот, ширина/глубина/высота либо равномерный масштаб, опуск от потолка), математика — чистые функции. drei `TransformControls` не используется | TransformControls мутирует `Object3D.scale`, а у нас размеры в метрах, одна степень свободы поворота и движение, ограниченное креплением; его Y-стрелка вырождается на плане; это второй конвейер указателя, который нельзя протестировать без браузера |
| Р8 | Перетаскивание | Тело объекта = перемещение по своей поверхности. Автоматически переключается только `floor ⇄ surface` (навели на столешницу — встал на стол). `wall` скользит по стенам и перепрыгивает между ними, `ceiling` скользит под потолком. Привязка к сетке 10 см — переключатель | Простое предсказуемое правило; «картинки липнут к стенам» выполняется тем, что картинка создаётся настенной и не покидает стен. Отвергнуто: смена крепления по поверхности под курсором с гистерезисом (сложно и неочевидно на плане) |
| Р9 | Добавление из библиотеки | Клик по карточке → объект появляется в центре вида на своём креплении по умолчанию и сразу выбран | Самый простой обнаруживаемый путь. Отвергнуто: модальный режим «размещения» с призраком и перетаскивание карточки в сцену |
| Р10 | Команды | `add / remove / patch / rename / batch`; чистые `applyCommand(layout, cmd)` и `invertCommand(layout, cmd)`; патч заменяет свойство целиком (LWW по свойству); побочные эффекты (дети падают на пол при удалении или скрытии стола) и проверки (размер, крепление, инвариант I2) собираются **построителями** в `ops.ts`, а не редьюсером. **Любой** локальный патч объекта — из панели или перетаскивания — проходит через один построитель `cmdPatch` | Требование задачи — явные `applyCommand/invertCommand`; команды остаются «тупыми» и пригодны для сети; у инвариантов одно место, а не «каждый вызывающий помнит». Отвергнуто: `diffLayouts` + `layout.replace` (изящно, но больше механизма, чем нужно одному пользователю) |
| Р11 | Склейка undo | Перетаскивание и ручки пишут во временный `draft` (не в макет и не в историю) и по отпусканию коммитят **одну** команду (`cmdPatch` на каждый объект draft, обычно один `patch`). Дискретные правки (поля, ползунки, цвет) склеиваются по `mergeKey` в окне 1 с: `undo = batch[undo₂, undo₁]`, `redo = batch[redo₁, redo₂]` | История и будущий сетевой канал свободны от шума 60 Гц; склейка корректна при любом составе патчей. Отвергнуто: «жесты», мутирующие макет в процессе |
| Р12 | Выделение | Один объект: `selectedId` (строка или `null`) | Мультивыбор не запрошен; команды уже принимают массивы |
| Р13 | Формат каталога | Тип объекта — данные: `CatalogItem { id, kind, title, category, size, resize, mounts, params[], build() }`; `build()` — чистая функция `BuildInput → Part[]` (плоский список box / cylinder / sphere / plane / torus с материалом и ссылкой на canvas-painter). Рендерер сам группирует одинаковые части в `InstancedMesh` | Новая тема = папка + одна строка в `src/catalog/index.ts`, редактор не трогается; билдеры тестируются в Node; формат проще, чем `DecorModel` с lathe/extrude/линиями, а число draw call’ов то же. Отвергнуто: `registerPack()` (статический импорт проще), lathe/extrude-геометрия |
| Р14 | Свечение и свет | Пресеты не создают настоящих источников света: пламя, лица шляп, гирлянда — материалы `glow` (unlit, `toneMapped: false`) и аддитивные ореолы; облака — `matcap` с нарисованной текстурой. Настоящий свет — только объекты `light.*` и «заливки» помещения в «Вечеринке»; активны первые 12 | 30 свечей не могут быть 30 лампами; изменение числа ламп перекомпилирует шейдеры. Отвергнуто: опция `realLight` в пресетах |
| Р15 | Атмосфера | «Рабочий свет» / «Вечеринка» — настройка **вида** (стор + локальные настройки), не часть макета и не в истории; на плане всегда рабочий свет | Пользователь щёлкает туда-сюда, чтобы оценить вид; план должен читаться |
| Р16 | Хранение файлов | Картинки и модели — content-addressed (`a_` + 32 hex SHA-256) записи `{ meta, blob }` в **одном** хранилище IndexedDB (idb-keyval); макеты — JSON в localStorage по ключу на макет, **без отдельного индекса** (`list()` читает сами макеты). Автоматической сборки мусора нет: файл удаляется вручную и только если не используется ни одним сохранённым макетом | Дедупликация при загрузке и импорте, естественный ключ для будущего сервера; GC конфликтует с undo. Отвергнуто: индекс макетов с самовосстановлением и две базы (блобы + метаданные) — механизм ради экономии чтения десятка небольших записей |
| Р17 | Сохранение | `LayoutRepository` (list/load/save/remove + putAsset/getAsset/listAssets/removeAsset), `LocalRepository`, автосохранение через `subscribeCommands` с задержкой 800 мс и синхронным сбросом на `pagehide`; несколько именованных макетов на помещение; `schemaVersion = 2` + `parseLayout()` (миграция + проверка по полям) | Швы: сервер = другая реализация интерфейса в `src/persistence/index.ts`; realtime = `subscribeCommands` + `dispatch(cmd, { origin: 'remote' })`. Отвергнуто как преждевременное: `rev/baseRev`, отдельные `SessionStore`/`Services`-контейнер |
| Р18 | Формат экспорта | Один файл `*.vagonka.json`: `{ format: 'vagonka-layout', version: 1, exportedAt, layout, assets: [{ meta, base64 }] }`, только используемые файлы. Импорт: проверка, mime по сигнатуре байтов, id файла пересчитывается из содержимого, всегда создаётся **новый** макет | Один файл удобно переслать; импорт не доверяет содержимому |
| Р19 | Запекание текстур | Чистый `src/texture/homography.ts` (гомография 8×8, билинейная выборка) + `scripts/bake-textures.mjs` (sharp только декодирует/кодирует), квады в `scripts/textures.json`; правило «один квад = одна панель `photo` (или грань колонны) = один JPEG»; метрические размеры квада скрипт берёт **из `src/rooms/<room>.ts`** по id панели, а не из JSON; `--debug` рисует квады поверх исходников. Кирпич колонн, пол, шторы — процедурные canvas-текстуры | Математика тестируется vitest и проверяется `tsc`; Node 26 импортирует `.ts` напрямую; размеры помещения по-прежнему правятся в одном месте (решение пользователя 4); шесть фото не дают чистых, развёрнутых и тайлящихся источников для пола/кирпича/штор |
| Р20 | Пользовательские модели | `.glb` и **самодостаточный** `.gltf` (все буферы и картинки — `data:` URI); до разбора — `inspectGltf()` (Draco и внешние URI отклоняются с понятным сообщением, Meshopt принимается); модель нормируется: начало в центре основания, вписана в `size` | Решение пользователя 2 называет «GLB/GLTF»; однофайловый `.gltf` не требует сети и разбирается тем же `GLTFLoader.parseAsync`. `.gltf` с соседними `.bin`/картинками — отказ «сохраните модель как .glb»: набор файлов не помещается в модель «один файл = один блоб». Декодер Draco у drei тянется с CDN — для статического офлайн-сайта неприемлемо |
| Р21 | Параллельная работа | Фундамент (один агент) пишет все контракты и компилируемые заглушки каждого чужого файла, ставит `sharp`, проводит браузерный спайк указателя и замораживается; дальше 7 пакетов с эксклюзивными файлами, **без dev-сервера и браузера** (приёмка — `tsc`, `vitest`, чтение кода); затем один интеграционный проход со всеми браузерными проверками | Без git единственная защита — «у каждого файла один писатель» и зелёный `tsc` с первого дня; порт 5173 один (`strictPort`), а общий сервер показывал бы полуготовые файлы семи агентов |
| Р22 | Каталог ↔ модель | `src/model/**` импортирует из `src/catalog` только **типы** (`catalog/types`); данные каталога чистые функции модели получают параметром — `CatalogLookup` (`getItem`, `isSupport`) в `ops.ts`, запись `CatalogItem` и предикат `isSupport` в `place.ts` / `surfaces.ts`, уже слитые `params` в `lights.ts`; реализацию — `catalogLookup` из `src/catalog/index.ts` — передают стор и действия. `src/catalog/index.ts` вправе импортировать `src/model/*` | Нет цикла `model/ops → catalog/index → model`; тесты модели не загружают 11 модулей декора; одно правило вместо смеси «где-то внедрение, где-то импорт» |

Вне объёма (сознательно): столкновения объектов между собой, мультивыбор, тени от пользовательских ламп,
тач/мобильные, столкновения с декором в прогулке, сервер и realtime (только швы), сдвиг и поворот объектов клавишами
(точные значения вводятся в панели свойств), живые числа перетаскивания в подвале (их показывает панель свойств),
сброс одного предмета мебели (есть только общий «Сбросить мебель»), `.gltf` из нескольких файлов.

---

## 2. Контракты

Кто создаёт файлы раздела:

- **2.1–2.19** (кроме `src/persistence/layoutFile.ts`) создаёт и **замораживает** пакет F (фундамент): либо финальный
  код, либо компилируемую заглушку для файла, помеченного «тело — пакет Wn».
- **2.20** (`src/editor/{constants,pick,drag,handles}.ts`), **2.21** (`src/texture/homography.ts`) и
  `src/persistence/layoutFile.ts` создают сами владельцы — W2, W1 и W4. Заглушек F для них **нет**: ни один другой
  пакет эти файлы не импортирует; сигнатуры заморожены ради тестов и интеграционной сверки.

Сигнатуры ниже должны появиться в коде дословно; тела пишет владелец файла. Комментарии в коде — по-русски, как в этапе 1.

Общие соглашения:

- Метры, радианы. X — вдоль длинной стены, Z — поперёк, Y — вверх.
- Локальная система **любого** объекта при любом креплении: начало — центр основания габаритного бокса,
  `x ∈ [−w/2, w/2]`, `y ∈ [0, h]`, `z ∈ [−d/2, d/2]`, «лицо» смотрит в +Z, `size = [w, h, d]`.
  У потолочного объекта верх — локальный `y = h`; настенный объект касается стены спиной (`z = −d/2`).
- Поворот вокруг Y на угол θ переводит локальный +Z в мировой `(sin θ, 0, cos θ)` (как у three.js и `wallFrame().rotationY`).
- Чистые модули (`src/model/**`, `src/catalog/**`, `src/texture/**`, `src/editor/{pick,drag,handles}.ts`) не импортируют
  `three`, `react` и DOM и не вызывают `Math.random()` / `Date.now()` (кроме `newId()` и стора).
- Направление зависимостей (Р22): `src/model/**` импортирует из `src/catalog` только `import type … from '../catalog/types'`.
  Всё, что модели нужно знать о каталоге, приходит параметром `catalog: CatalogLookup` (2.14). `src/catalog/index.ts`
  может импортировать `src/model/*` (значениями). `src/rooms/<id>.ts` содержит **только** `import type` и экспортирует
  `const <id>: RoomDef` — эти файлы напрямую импортирует Node-скрипт запекания.
- React-компоненты объявляются `export function Name(props: …) { … }` **без аннотации возвращаемого типа**, как в этапе 1
  (в `@types/react` 19 нет глобального `JSX`; писать `JSX.Element` нельзя — ошибка TS2503).

### 2.1 `src/model/types.ts`

```ts
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
```

Инварианты макета (держат построители `ops.ts`, восстанавливает `sanitizeLayout`):

- **I1** id объектов уникальны.
- **I2** `surface.hostId` указывает на существующий объект с креплением `floor`, отличный от самого объекта
  (глубина ровно 1, циклов нет). Следствие: объект, на котором что-то стоит, сам стоит на полу.
- **I3** `id / kind / type / origin` не меняются.
- **I4** все числа конечны, `MIN_SIZE ≤ size[i] ≤ MAX_SIZE` (2.10).
- **I5** на скрытом объекте (`visible: false`) ничего не стоит: при скрытии и удалении хозяина его дети переводятся на пол.

Локальные правки попадают в макет только через построители `ops.ts` (`cmdPatch`, `cmdRemove`, `cmdDuplicate`,
`cmdSetMount`, `cmdResetVenue`) — в том числе результат перетаскивания (`commitDraft`). Сырой `patch` мимо построителей
отправляют только undo/redo (обратные команды уже проверенных) и будущий сетевой канал.

### 2.2 `src/model/geometry.ts`

Существующие `WallFrame`, `wallFrame`, `panelTransform`, `platformAt`, `constrainWalk` сохраняются; `wallFrame`
принимает любой объект с `from/to`. Добавляется:

```ts
import type { PlatformDef, RoomDef, Vec2, Vec3, WallDef, WallPanel } from './types';

export interface WallFrame { length: number; dir: Vec2; normal: Vec2; rotationY: number; mid: Vec2 }
export function wallFrame(wall: { from: Vec2; to: Vec2 }): WallFrame;
export function panelTransform(wall: WallDef, panel: WallPanel): { position: Vec3; rotationY: number };
export function platformAt(platforms: PlatformDef[], x: number, z: number): PlatformDef | undefined;
export function constrainWalk(room: RoomDef, x: number, z: number, radius: number): Vec2;

/** Вертикальный прямоугольник, на который можно вешать декор: стена помещения или грань колонны. */
export interface WallSurface {
  /** Стена: wall.id. Грань колонны: `${column.id}:${face}`, например 'col-left:s'. */
  id: string;
  from: Vec2;
  to: Vec2;
  /** Высота поверхности = высота помещения. */
  height: number;
  /** Для панели свойств: wall.name ?? wall.id; «‹column.name ?? column.id› · ‹север|восток|юг|запад›». */
  name: string;
}

/**
 * Стены помещения в порядке room.walls, затем по 4 грани каждой колонны в порядке n, e, s, w.
 * У каждой поверхности wallFrame().normal смотрит в свободное пространство, `from` — слева для зрителя.
 * Грань колонны (cx, cz), размер (sx, sz):
 *   n: from (cx + sx/2, cz − sz/2) → to (cx − sx/2, cz − sz/2)
 *   e: from (cx + sx/2, cz + sz/2) → to (cx + sx/2, cz − sz/2)
 *   s: from (cx − sx/2, cz + sz/2) → to (cx + sx/2, cz + sz/2)
 *   w: from (cx − sx/2, cz − sz/2) → to (cx − sx/2, cz + sz/2)
 */
export function wallSurfaces(room: RoomDef): WallSurface[];
export function getSurface(room: RoomDef, id: string): WallSurface | undefined;

/** Высота пола под точкой: высота подиума или 0. */
export function floorAt(room: RoomDef, x: number, z: number): number;
/** Зажимает точку в прямоугольник ±length/2 × ±width/2 с отступом margin (по умолчанию 0). */
export function clampToRoom(room: RoomDef, x: number, z: number, margin?: number): Vec2;
/**
 * Ближайшая поверхность к точке пола: along зажат в [0, length], distance — расстояние до ближайшей точки отрезка (≥ 0).
 * prefer — необязательный фильтр: если ему удовлетворяет хотя бы одна поверхность, выбирается ближайшая из таких;
 * если ни одна — ближайшая из всех (функция всегда возвращает результат).
 */
export function nearestSurface(
  room: RoomDef,
  x: number,
  z: number,
  prefer?: (surface: WallSurface) => boolean,
): { surface: WallSurface; along: number; distance: number };
/** Округление к шагу; step ≤ 0 → value. */
export function snapTo(value: number, step: number): number;
```

### 2.3 `src/model/pose.ts` — крепление → мировая поза

```ts
import type { WallSurface } from './geometry';
import type { Mount, MountKind, Ray, RoomDef, SceneObject, Vec3 } from './types';

/**
 * Зазор между стеной и настенным декором: больше всего, что RoomShell рисует на стене, —
 * фотопанели второго слоя (PANEL_GAP × 2 = 0.024) и гребня складки шторы (PANEL_GAP + 0.015 = 0.027, см. W1).
 */
export const WALL_GAP = 0.03;
export const GRID_STEP = 0.1;
export const SIZE_STEP = 0.05;
export const ROTATION_STEP = Math.PI / 12;
/** Ниже этой высоты подвешенный декор задевает головы — панель свойств показывает предупреждение. */
export const HEAD_CLEARANCE = 2.0;

/** Мировая поза: position — центр основания, rotationY — вокруг +Y. */
export interface Pose {
  position: Vec3;
  rotationY: number;
}

export interface SceneContext {
  room: RoomDef;
  objects: readonly SceneObject[];
  get(id: string): SceneObject | undefined;
  surface(id: string): WallSurface | undefined;
}
export function makeContext(room: RoomDef, objects: readonly SceneObject[]): SceneContext;

/**
 * Единственное место, где крепление превращается в мировую позу. Никогда не бросает.
 *   floor   — [x, floorAt(x, z) + lift, z], rotationY
 *   ceiling — [x, H − drop − h, z], rotationY
 *   wall    — from + dir·along + normal·(WALL_GAP + d/2), y = bottom; rotationY = wallFrame(surface).rotationY
 *   surface — toWorld(hostPose, [u, host.size[1], v]); rotationY = hostPose.rotationY + rotationY
 * Битая ссылка: surface без хозяина (или хозяин не floor) → как floor в (0, 0), lift 0;
 * wall без поверхности → [0, bottom, 0], rotationY 0. Это страховка от падения, а не поведение: построители ops.ts
 * (cmdPatch, cmdRemove, cmdSetMount, cmdResetVenue, reconcileVenue) не создают битых ссылок — прежде чем хозяин
 * исчезнет, перестанет стоять на полу или будет скрыт, его дети переводятся на пол в своих мировых X/Z.
 */
export function resolvePose(o: SceneObject, ctx: SceneContext): Pose;
export function isMountBroken(o: SceneObject, ctx: SceneContext): boolean;

export function toWorld(pose: Pose, local: Vec3): Vec3;
export function toLocal(pose: Pose, world: Vec3): Vec3;
export function rayToLocal(pose: Pose, ray: Ray): Ray;

/**
 * Удерживает объект в допустимых пределах (возвращает тот же объект, если ничего не изменилось):
 *   floor   — (x, z) = clampToRoom; lift ∈ [0, max(0, H − floorAt − h)]
 *   ceiling — (x, z) = clampToRoom; drop ∈ [0, max(0, H − h)]
 *   wall    — along ∈ [w/2, length − w/2] (если w > length → length/2); bottom ∈ [0, max(0, H − h)]
 *   surface — u ∈ [−W/2, W/2], v ∈ [−D/2, D/2], где W, D — ширина и глубина хозяина (центр основания остаётся на столешнице)
 */
export function clampMount(mount: Mount, size: Vec3, ctx: SceneContext): Mount;
/** Округляет x, z | along, bottom | drop | u, v | lift к шагу. */
export function snapMount(mount: Mount, step: number): Mount;

/**
 * Переводит объект на другой тип крепления, сохраняя мировые X/Z (кнопки «Крепление» в панели свойств):
 *   → floor   { x, z, lift: 0 }
 *   → ceiling { x, z, drop: opts.drop ?? 0 }
 *   → wall    opts.surfaceId либо nearestSurface(x, z); along — проекция; bottom = opts.bottom ?? текущая высота основания
 *   → surface только с opts.hostId: (u, v) = toLocal(hostPose, position); без hostId → как floor
 * Результат проходит clampMount.
 */
export function remount(
  o: SceneObject,
  to: MountKind,
  ctx: SceneContext,
  opts?: { surfaceId?: string; hostId?: string; drop?: number; bottom?: number },
): Mount;

/** Объекты, стоящие на hostId. */
export function childrenOf(objects: readonly SceneObject[], hostId: string): SceneObject[];

/** Числа для панели свойств. */
export interface MountReadout {
  /** Высота основания над полом помещения (y = 0). */
  baseY: number;
  topY: number;
  /** От низа объекта до пола/подиума под ним (запас по высоте для подвешенного декора). */
  clearance: number;
  /** wall: название поверхности и расстояние от её левого края до левого края объекта. */
  surfaceName?: string;
  leftEdge?: number;
  /** surface: имя хозяина. */
  hostName?: string;
}
export function describeMount(o: SceneObject, ctx: SceneContext): MountReadout;
```

### 2.4 `src/model/layers.ts` — видимость декора на отсечённых поверхностях (потолок и ближние стены)

```ts
import type { WallSurface } from './geometry';
import type { CameraMode, LayerMode, SceneObject, Vec3 } from './types';

/** Непрозрачность декора-призрака (потолочного при виде сверху, настенного при виде со спины). */
export const GHOST_OPACITY = 0.3;

/** Что сейчас «в фокусе». both — всё сплошное и выбирается. */
export type LayerView = 'both' | 'floor' | 'ceiling';

/** top → true; orbit → cameraY > roomHeight; walk → false. */
export function isViewFromAbove(mode: CameraMode, cameraY: number, roomHeight: number): boolean;

/**
 * walk → 'both' всегда.
 * layer 'floor' → 'floor'; layer 'ceiling' → 'ceiling';
 * layer 'auto' → viewFromAbove ? 'floor' : 'both'.
 */
export function layerView(layer: LayerMode, mode: CameraMode, viewFromAbove: boolean): LayerView;

/**
 * id поверхностей wallSurfaces(room), на которые камера смотрит С ИЗНАНКИ (их плоскости отсечены, а декор на них
 * повёрнут к камере спиной): mode 'orbit' и dot([camera.x − from.x, camera.z − from.z], normal) < 0.
 * mode 'top' и 'walk' → []. Порядок — как в surfaces. С камерой внутри помещения это только дальние грани колонн.
 */
export function backSurfaces(mode: CameraMode, camera: Vec3, surfaces: readonly WallSurface[]): string[];

/** Настенный объект, чья поверхность есть в back. */
export function isOnBackSurface(o: SceneObject, back: readonly string[]): boolean;

/**
 * Рисовать призраком (кроме выбранного — он всегда сплошной):
 *   потолочный объект при view === 'floor'  ИЛИ  isOnBackSurface(o, back).
 */
export function isGhosted(o: SceneObject, view: LayerView, back: readonly string[], selectedId: string | null): boolean;

/**
 * Можно выбрать мышью: o.visible && !o.locked && (
 *   o.id === selectedId ||
 *   (!isOnBackSurface(o, back) && (
 *     view === 'both' ||
 *     (view === 'floor' && o.mount.kind !== 'ceiling') || (view === 'ceiling' && o.mount.kind === 'ceiling'))))
 */
export function isPickable(o: SceneObject, view: LayerView, back: readonly string[], selectedId: string | null): boolean;
```

Итоговая таблица поведения (для W2, W3 и тестов):

| Режим камеры | Плоскость потолка | Потолочный декор при «Слой: Авто» | «Слой: Пол» | «Слой: Потолок» |
|---|---|---|---|---|
| Прогулка | видна (изнутри) | сплошной, редактирования нет | — (всегда как «Авто») | — |
| Облёт, камера ниже потолка | видна изнутри | сплошной, выбирается | призрак, клики насквозь | сплошной, выбирается; напольные — сплошные, клики насквозь |
| Облёт, камера выше потолка | отсечена | **призрак 30 % + контур, клики насквозь** | то же | сплошной, выбирается; напольные — клики насквозь |
| План | отсечена | **призрак 30 % + контур, клики насквозь** | то же | сплошной, выбирается; напольные — клики насквозь |

То же правило для настенного декора (переключатель «Слой» на него не влияет):

| Режим камеры | Плоскость стены / грань колонны | Декор на этой поверхности |
|---|---|---|
| Прогулка, план | — (`backSurfaces` пуст) | сплошной; на плане выбирается (тонкое раздувается до 10 px) |
| Облёт, камера перед плоскостью поверхности | видна | сплошной, выбирается |
| Облёт, камера за плоскостью поверхности (ближняя стена при обычном виде снаружи) | отсечена | **призрак 30 % + контур, клики насквозь**; перетаскивание выбранного — по правилу плана (W2) |

Выбранный объект (в т. ч. из списка объектов или только что добавленный) всегда сплошной и перетаскивается.
Побеждает ближайшее к камере попадание: чтобы добраться до предметов под выбранным потолочным объектом, выбор
снимают (Esc или клик по пустому месту) — после этого он снова призрак и клики проходят насквозь.

### 2.5 `src/model/surfaces.ts` — пересечения луча с поверхностями помещения

```ts
import type { SceneContext } from './pose';
import type { Ray, RoomDef, SceneObject, Vec3 } from './types';

/** Пересечение с горизонтальной плоскостью; null — луч параллелен или плоскость позади. */
export function rayPlaneY(ray: Ray, y: number): Vec3 | null;

export interface FloorHit { kind: 'floor'; point: Vec3; distance: number }
export interface WallHit { kind: 'wall'; surfaceId: string; along: number; y: number; point: Vec3; distance: number }
export interface TopHit { kind: 'top'; hostId: string; u: number; v: number; point: Vec3; distance: number }

/**
 * Только при dir.y < 0. Ближайшее из: верх подиума (внутри его прямоугольника) и плоскость y = 0
 * (без ограничения размерами помещения — вызывающий зажимает clampToRoom).
 */
export function hitFloor(ray: Ray, room: RoomDef): FloorHit | null;

/**
 * Поверхности wallSurfaces(room), обращённые к лучу (dot(dir, normal) < 0), в пределах 0 ≤ along ≤ length, 0 ≤ y ≤ height.
 * Отсортированы от ближней к дальней. С орбитальной камеры это ровно те стены, которые видны (ближние отсечены);
 * вертикальный луч плана не попадает ни в одну.
 */
export function hitWalls(ray: Ray, room: RoomDef): WallHit[];

/** Верхние грани объектов-опор (isSupport), только при dir.y < 0; от ближней к дальней. exclude — id, которые пропускаются. */
export function hitTops(
  ray: Ray,
  ctx: SceneContext,
  isSupport: (o: SceneObject) => boolean,
  exclude?: ReadonlySet<string>,
): TopHit[];
```

### 2.6 `src/model/place.ts` — куда поставить новый объект

```ts
import type { CatalogItem } from '../catalog/types';
import type { SceneContext } from './pose';
import type { Mount, Ray, SceneObject, Vec3 } from './types';

/**
 * Крепление для НОВОГО объекта. kind = item.mounts[0]. ray — луч через центр вида (null → центр помещения).
 * P = clampToRoom(hitFloor(ray)?.point ?? [0, 0, 0]).
 *   floor   — { x: P.x, z: P.z, lift: 0 }
 *   surface — ближайший hitTops(ray) → { hostId, u, v }; иначе, если item.mounts содержит 'floor' → floor в P;
 *             иначе ближайшая к P опора (u = v = 0); опор нет → floor в P
 *   wall    — ближайший hitWalls(ray), чья поверхность не у́же объекта (wallFrame(s).length ≥ size[0]; если таких
 *             попаданий нет — просто ближайший) → { surfaceId, along, bottom: hit.y − h/2 };
 *             попаданий нет вовсе → nearestSurface(P, prefer) → { along, bottom: item.defaultBottom ?? 1.2 }, где
 *             prefer(s) = wallFrame(s).length ≥ size[0] &&
 *                         (ray === null || |ray.dir.y| > 0.98 || dot(ray.dir.xz, wallFrame(s).normal) < 0):
 *             объект не вешается на грань колонны, которая у́же его самого, и на стену, повёрнутую к камере изнанкой
 *             (луч из центра обычного вида в облёте упирается в пол посреди зала, а ближе всего к этой точке — колонны)
 *   ceiling — { x: P.x, z: P.z, drop: item.defaultDrop ?? 0 }
 * Затем snapMount(grid), если grid !== null, и clampMount. Если в результате крепление совпадает (в пределах 5 см)
 * с креплением уже существующего объекта того же type — сдвиг на 0.3 м по x | along | u и повторный clampMount.
 */
export function placeNew(
  item: CatalogItem,
  size: Vec3,
  ray: Ray | null,
  ctx: SceneContext,
  isSupport: (o: SceneObject) => boolean,
  grid: number | null,
): Mount;
```

### 2.7 `src/model/rng.ts`, `src/model/color.ts`

```ts
// rng.ts
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [a, b) */
  range(a: number, b: number): number;
  /** Целое в [a, b]. */
  int(a: number, b: number): number;
  pick<T>(items: readonly T[]): T;
  /** Фишер–Йетс на копии. */
  shuffle<T>(items: readonly T[]): T[];
}
/** mulberry32: один seed → одна последовательность на любой машине. */
export function createRng(seed: number): Rng;
/** Стабильный 32-битный хэш строки (FNV-1a) — для сидов из текста. */
export function hashString(s: string): number;
/** Гладкий 2D value-noise в [0, 1], детерминированный для (x, z, seed). */
export function valueNoise2(x: number, z: number, seed: number): number;

// color.ts — общие помощники билдеров (basic, W6, W7): одна реализация, одно округление
/** Затемняет (factor < 1) или осветляет (factor > 1): каждый канал × factor, округление, зажим 0…255. '#rrggbb' → '#rrggbb'. */
export function shade(hex: string, factor: number): string;
/** Линейная смесь по каналам: t = 0 → a, t = 1 → b; t зажимается в [0, 1]. '#rrggbb' → '#rrggbb' (нижний регистр). */
export function mix(a: string, b: string, t: number): string;
export function clamp(value: number, min: number, max: number): number;
/** a + (b − a)·t, без зажима t. */
export function lerp(a: number, b: number, t: number): number;
```

`shade` — перенос функции из `scene/objects/parts.ts` этапа 1 без изменения поведения. Вход не `#rrggbb` → возвращается
как есть (никогда не бросает).

### 2.8 `src/model/commands.ts` — единственный способ менять макет

```ts
import type { Layout, SceneObject } from './types';

/** Свойство заменяется ЦЕЛИКОМ (mount и params — тоже; слияния по ключам нет). id / kind / type / origin патчить нельзя. */
export type ObjectPatch = Partial<
  Pick<SceneObject, 'name' | 'mount' | 'rotationY' | 'size' | 'color' | 'assetId' | 'locked' | 'visible' | 'params'>
>;

export type Command =
  /** id назначает отправитель. index — позиция вставки в objects на момент вставки этого элемента; по умолчанию в конец. */
  | { type: 'add'; items: { object: SceneObject; index?: number }[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'patch'; patches: { id: string; set: ObjectPatch }[] }
  | { type: 'rename'; name: string }
  | { type: 'batch'; commands: Command[] };

/**
 * Чистая, не мутирует вход, никогда не бросает. Не трогает updatedAt (это делает стор).
 *   add    — элементы по порядку; объект с уже существующим id пропускается; index зажимается в [0, length]
 *   remove — неизвестные id пропускаются
 *   patch  — неизвестные id пропускаются; читаются только ключи ObjectPatch; значение, deep-равное текущему, не создаёт новый объект
 *   rename — заменяет layout.name
 *   batch  — последовательно; вложенные batch разрешены
 * Нетронутые объекты сохраняют ссылку; если ничего не изменилось — возвращается ТОТ ЖЕ layout.
 */
export function applyCommand(layout: Layout, cmd: Command): Layout;

/**
 * Обратная команда относительно layout ДО применения cmd:
 *   applyCommand(applyCommand(l, c), invertCommand(l, c)) deep-равен l (включая порядок объектов).
 *   add    → remove тех id, которые реально добавятся
 *   remove → add удалённых объектов с их прежними индексами, по возрастанию индекса
 *   patch  → patch с прежними значениями тех же ключей (только для существующих id)
 *   rename → rename с прежним именем
 *   batch  → batch обратных команд в обратном порядке (каждая — относительно промежуточного состояния)
 */
export function invertCommand(layout: Layout, cmd: Command): Command;

/** true, если applyCommand(layout, cmd) === layout. */
export function isNoop(layout: Layout, cmd: Command): boolean;
export function applyPatch(o: SceneObject, set: ObjectPatch): SceneObject;
/** id объектов, которые команда добавляет, удаляет или патчит (без повторов). */
export function touchedIds(cmd: Command): string[];
```

Шов realtime: команды — чистый JSON с id, назначенными клиентом, без производного состояния; `patch` заменяет
свойства целиком, неизвестные id пропускаются, повторный `add` игнорируется → те же команды можно рассылать как есть
с «последний пишущий побеждает» по свойству.

### 2.9 `src/model/history.ts`

```ts
import type { Command } from './commands';

export interface HistoryEntry {
  label: string;
  redo: Command;
  undo: Command;
  mergeKey?: string;
  time: number;
}
export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}
export const EMPTY_HISTORY: History;
export const HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 1000;

/**
 * Добавляет шаг и очищает future. Если e.mergeKey задан, равен mergeKey верхнего шага и e.time − top.time ≤ MERGE_WINDOW_MS,
 * верхний шаг ЗАМЕНЯЕТСЯ склеенным: { label: top.label, mergeKey, time: e.time,
 *   redo: batch[top.redo, e.redo], undo: batch[e.undo, top.undo] }.
 * past обрезается до HISTORY_LIMIT (выпадают старейшие).
 */
export function pushHistory(h: History, e: HistoryEntry): History;
/** null — отменять нечего. command — то, что нужно применить (entry.undo). */
export function undoStep(h: History): { history: History; command: Command; label: string } | null;
export function redoStep(h: History): { history: History; command: Command; label: string } | null;
```

### 2.10 `src/model/ops.ts` — чистые построители команд (вся «умная» семантика здесь)

```ts
import type { CatalogItem, CatalogLookup } from '../catalog/types';
import type { Command, ObjectPatch } from './commands';
import type { Layout, Mount, MountKind, Params, RoomDef, SceneObject, Vec3 } from './types';

/** Пределы любой стороны объекта, метры (I4). Единственное место; панель свойств и ручки пользуются clampSize. */
export const MIN_SIZE = 0.01;
export const MAX_SIZE = 20;

/**
 * Единственное правило изменения размера (панель свойств → cmdPatch, ручки → resolveResize). Чистая, не округляет.
 * lo[i] = max(MIN_SIZE, item.minSize?.[i] ?? 0), hi[i] = min(MAX_SIZE, item.maxSize?.[i] ?? ∞).
 *   - компонент next[i] не конечен или ≤ 0 → берётся prev[i];
 *   - ось item.flatAxis всегда сохраняет prev (толщина листа не масштабируется и не редактируется);
 *   - resize 'none'    → prev;
 *   - resize 'free'    → каждая ось независимо зажимается в [lo, hi];
 *   - resize 'uniform' → ОДИН коэффициент k = next[a] / prev[a], где a — ось с наибольшим |next[i] / prev[i] − 1|
 *                        (кроме flatAxis); k зажимается в [max_i(lo[i] / prev[i]), min_i(hi[i] / prev[i])] по тем же осям;
 *                        результат = prev × k покомпонентно — пропорции сохраняются точно.
 * Если ничего не изменилось — возвращается prev (та же ссылка).
 */
export function clampSize(item: CatalogItem, prev: Vec3, next: Vec3): Vec3;

export interface ObjectInit {
  name?: string;
  size?: Vec3;
  color?: string;
  rotationY?: number;
  assetId?: string | null;
  params?: Params;
}
/** id = newId('obj'), origin 'user', name = init.name ?? item.title, остальное — из item; locked false, visible true. */
export function createObject(item: CatalogItem, mount: Mount, init?: ObjectInit): SceneObject;

/**
 * «Дети на пол» — общий шаг всех построителей ниже (в сигнатурах не экспортируется отдельно): каждый объект, стоящий на
 * хозяине, получает patch { mount: { kind: 'floor', x, z, lift: 0 }, rotationY: мировой угол } в тех же мировых X/Z
 * (по resolvePose ДО изменения хозяина). В итоговом batch эти патчи идут ПЕРЕД изменением самого хозяина.
 */

/**
 * ЕДИНСТВЕННЫЙ построитель патча одного объекта: через него идут patchObject (панели) и commitDraft (перетаскивание,
 * ручки). Возвращает команду, сохраняющую I2, I4, I5; пустой batch, если объекта нет или патч ничего не меняет.
 *   1. Заблокированный объект принимает только ключи locked и visible; остальные отбрасываются.
 *   2. set.size        → clampSize(catalog.getItem(o.type), o.size, set.size).
 *   3. set.mount 'surface' допустим, только если хозяин существует, отличен от объекта, сам стоит на полу и виден;
 *      иначе ключи mount и rotationY из патча отбрасываются (объект остаётся, где был).
 *   4. set.mount 'wall' с неизвестным surfaceId → ключ mount отбрасывается.
 *   5. Если в патче есть mount или size — итоговое крепление (новое или текущее) проходит clampMount с итоговым size
 *      и включается в патч.
 *   6. Если у объекта есть дети и патч (а) делает его невидимым (visible: false) либо (б) переводит на крепление,
 *      отличное от 'floor', — сначала «дети на пол».
 * Результат: один patch либо batch[patch детей…, patch объекта].
 */
export function cmdPatch(layout: Layout, id: string, set: ObjectPatch, room: RoomDef, catalog: CatalogLookup): Command;

/**
 * «Удалить». Заблокированные пропускаются. В обоих случаях сначала «дети на пол».
 * origin 'venue' → patch { visible: false } (мебель площадки не удаляется, а скрывается); origin 'user' → remove.
 */
export function cmdRemove(layout: Layout, ids: readonly string[], room: RoomDef): Command;

/**
 * «Дублировать». Копия: новый id, origin 'user', locked false, name + ' (копия)', сдвиг 0.3 м (x | along | u) + clampMount;
 * вставляется сразу после оригинала. Объекты, стоящие на оригинале, не копируются.
 */
export function cmdDuplicate(layout: Layout, ids: readonly string[], room: RoomDef): { command: Command; newIds: string[] };

/**
 * Смена типа крепления через remount(). drop/bottom по умолчанию — catalog.getItem(o.type).defaultDrop / defaultBottom.
 * → surface: хозяин — опора (catalog.isSupport, не сам объект), чья столешница содержит мировые X/Z объекта, иначе
 *   ближайшая по центру; опор нет → пустой batch.
 * Если у объекта есть дети и to !== 'floor' — сначала «дети на пол» (I2). Мировой угол сохраняется.
 */
export function cmdSetMount(layout: Layout, id: string, to: MountKind, room: RoomDef, catalog: CatalogLookup): Command;

/**
 * «Сбросить мебель» — один шаг undo. Для каждой fixture: объект есть → patch всех изменяемых полей, отличающихся от исходных
 * (включая visible: true, locked: false); объекта нет → add копии. Объекты origin 'venue', которых нет в room.fixtures,
 * удаляются («дети на пол»). Пользовательский декор не трогается: стоящее на столах остаётся на них и едет вместе со столом.
 */
export function cmdResetVenue(layout: Layout, room: RoomDef): Command;
/** Отличается ли мебель от исходной (включает кнопку «Сбросить мебель»). */
export function venueDirty(layout: Layout, room: RoomDef): boolean;

/**
 * При загрузке, вне истории: добавляет fixtures, которых нет в макете; удаляет устаревшие объекты origin 'venue',
 * ПЕРЕД удалением переводя их детей на пол в мировых X/Z («дети на пол» — иначе sanitizeLayout смог бы поставить
 * осиротевшие предметы только в (0, 0)).
 */
export function reconcileVenue(layout: Layout, room: RoomDef): Layout;
/**
 * При загрузке/импорте, вне истории: восстанавливает I1–I5 — дубликаты id отбрасываются; size зажимается в
 * [MIN_SIZE, MAX_SIZE]; битые wall-крепления и surface-крепления с пропавшим хозяином переводятся на пол в (0, 0);
 * surface-крепление, чей хозяин существует, но стоит не на полу или скрыт, — на пол в мировых X/Z точки
 * toWorld(resolvePose(хозяин), [u, 0, v]); каждое крепление проходит clampMount. Идемпотентна; без изменений
 * возвращает тот же layout.
 */
export function sanitizeLayout(layout: Layout, room: RoomDef): Layout;
```

Правило скрытия (I5), одно для всех путей: «Удалить» на мебели площадки, глаз в списке объектов и «Скрыть» в панели
свойств приводят к одной и той же команде — дети хозяина сначала опускаются на пол в своих мировых X/Z, затем хозяин
становится невидимым. Обратный шаг (undo) возвращает и хозяина, и детей на столешницу. Повторный показ хозяина детей
обратно не поднимает.

### 2.11 `src/model/layout.ts`, `src/model/migrate.ts`

```ts
// layout.ts — сигнатуры этапа 1 сохраняются
export function newId(prefix?: string): string;
/** Копия мебели площадки в исходной расстановке. */
export function venueObjects(room: RoomDef): SceneObject[];
export function createLayout(room: RoomDef, name?: string): Layout;   // schemaVersion 2

// migrate.ts
export type LayoutErrorCode = 'not-object' | 'newer-version' | 'bad-layout';
export class LayoutFormatError extends Error {
  readonly code: LayoutErrorCode;
  constructor(code: LayoutErrorCode, message: string);
}
export const LAYOUT_LIMITS: { objects: 2000; name: 120; paramKeys: 64; paramString: 4000; coord: 500; sizeMin: 0.005; sizeMax: 60 };

/**
 * Недоверенный JSON (localStorage, импорт) → Layout текущей схемы. Миграции: MIGRATIONS[1] = v1 → v2
 * (position [x, y, z] + rotationY → mount { kind: 'floor', x, z, lift: y }; assetId ?? null; params ?? {}).
 * Проверка: объекты пересобираются ПО ПОЛЯМ (лишние ключи, __proto__ и т. п. не переносятся); числа конечны и в пределах
 * LAYOUT_LIMITS; kind и mount.kind — из закрытых множеств. Строковые поля — КАЖДОЕ по своему правилу (LAYOUT_PATTERNS):
 *   layout.id, object.id, mount.hostId   /^[A-Za-z0-9_-]{1,64}$/
 *   mount.surfaceId                       /^[A-Za-z0-9_-]{1,64}(:[nesw])?$/        ('far', 'col-left:s')
 *   object.type                           /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/         ('sofaU', 'light.spot', 'hp.dementor')
 *   object.assetId                        null либо /^a_[0-9a-f]{32}$/
 *   object.color                          /^#[0-9a-fA-F]{6}$/
 *   ключи params                          /^[A-Za-z][A-Za-z0-9_]{0,31}$/
 *   layout.roomId                         /^[A-Za-z0-9_-]{1,64}$/
 * Плохой объект отбрасывается и передаётся в onDrop; неизвестный type СОХРАНЯЕТСЯ (рисуется заглушкой).
 * Структурный мусор → LayoutFormatError.
 */
export function parseLayout(raw: unknown, onDrop?: (index: number, reason: string) => void): Layout;
export const LAYOUT_PATTERNS: {
  id: RegExp; surfaceId: RegExp; type: RegExp; assetId: RegExp; color: RegExp; paramKey: RegExp;
};
```

Примечание к v1 → v2: миграция не знает помещения, поэтому `lift = y` дважды учитывает подиум для объектов v1, стоявших
на нём. Это принято: этап 1 ничего не сохранял, миграция существует как шаблон и тест для будущих версий.

`src/model/testRoom.ts` (F, заморожен) — синтетическое помещение для тестов. Тесты чистой математики (F: `pose`,
`surfaces`, `place`, `ops`, `layers`; W2: `pick`, `drag`, `handles`) пользуются **только** им, а не `lounge`: размеры
лаунжа правит W1 (и позже пользователь, решение 4), и ни одна такая правка не должна ломать чужие замороженные тесты.

```ts
import type { RoomDef } from './types';

/**
 * 10 × 6 × 3 м. Стены 'far' (z = −3), 'right' (x = +5), 'near' (z = +3), 'left' (x = −5) — `from` слева при взгляде
 * изнутри, как в lounge. Колонна 'col' в (2, 0), размер 0.8 × 0.6. Подиум 'podium': min (−5, −3), max (0, −1), высота 0.2.
 * Панелей и заливок нет. Мебель (origin 'venue', крепление floor, lift 0, rotationY 0, если не сказано иное):
 *   'venue-table'  type 'table'  в (−2, 1),   размер 1.1 × 0.75 × 0.7
 *   'venue-table2' type 'table'  в (−2, −2),  размер 1.0 × 0.75 × 0.6, rotationY π/2   (стоит на подиуме)
 *   'venue-sofa'   type 'sofaU'  в (−2, 1.3), размер 2.8 × 0.85 × 1.8, rotationY π    (кабинка вокруг 'venue-table')
 * spawn: (3, 2), yaw 0.
 */
export const testRoom: RoomDef;
```

### 2.12 `src/model/lights.ts`

```ts
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
 * type = o.type === 'light.spot' ? 'spot' : 'point'; color = o.color; остальное — из params (УЖЕ слитых с умолчаниями
 * каталога: resolveParams(getItem(o.type), o.params), их передаёт вызывающий), градусы → радианы, зажим в допустимые
 * пределы; отсутствующий ключ → intensity 15, distance 8, angle 30°, penumbra 0.5, tilt 0.
 */
export function lightSettings(o: SceneObject, params: Params): LightSettings;

/**
 * Единичный вектор направления луча прожектора в ЛОКАЛЬНЫХ координатах объекта (лицо — +Z):
 *   ceiling         — от «строго вниз» к лицу:      [0, −cos tilt,  sin tilt]
 *   floor, surface  — от «строго вверх» к лицу:     [0,  cos tilt,  sin tilt]
 *   wall            — от нормали стены (+Z) вниз:   [0, −sin tilt,  cos tilt]
 * tilt = 0 — вдоль оси крепления (вниз / вверх / от стены). Куда смотрит лицо, задаёт rotationY (у стены — её нормаль).
 */
export function lightDirection(mount: MountKind, tilt: number): Vec3;

/** Первые (MAX_LIGHTS − reserved) видимых объектов kind 'light' в порядке макета. Остальные рисуются тусклым маркером. */
export function activeLightIds(objects: readonly SceneObject[], reserved?: number): ReadonlySet<string>;

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
export const AMBIENCES: Record<AmbienceId, AmbienceDef>;
/** На плане всегда 'work', чтобы план читался. */
export function effectiveAmbience(ambience: AmbienceId, mode: CameraMode): AmbienceId;
/** Сколько слотов из MAX_LIGHTS заняты заливками помещения при данной атмосфере и режиме. */
export function reservedLights(room: RoomDef, ambience: AmbienceId, mode: CameraMode): number;
```

Значения `AMBIENCES`:

- `work` «Рабочий свет» — ровно свет этапа 1: фон `#1b1a1d`, ambient `#ffffff` 1.1, hemisphere `#ffffff / #6b5a55` 0.9,
  sun 1.6 (тени, кроме плана), exposure 1, washes false.
- `party` «Вечеринка» — фон `#070608`, ambient `#5a3038` 0.18, hemisphere `#3a1418 / #120808` 0.25, sun null
  (прохода теней нет), exposure 1.15, washes true.

### 2.13 `src/model/assets.ts`

```ts
import type { AssetMime, SceneObject } from './types';

export const ASSET_LIMITS: { imageBytes: 15_728_640; modelBytes: 41_943_040; imageMaxSide: 2048; importFileBytes: 314_572_800 };
/**
 * Только по содержимому. Сигнатуры: PNG 89 50 4E 47 · JPEG FF D8 FF · WebP 'RIFF'…'WEBP' · GLB 'glTF' →
 * 'model/gltf-binary'. Текстовый .gltf: первый значащий байт (после BOM и пробелов) — '{', весь файл разбирается
 * JSON.parse (в try/catch) и у результата asset.version — строка → 'model/gltf+json'. Иное (в т. ч. SVG) → null.
 */
export function sniffMime(bytes: Uint8Array): AssetMime | null;
/** 'a_' + первые 32 hex SHA-256 (crypto.subtle; если недоступен — 'a_' + 32 случайных hex, дедупликация теряется). */
export function hashAssetId(bytes: ArrayBuffer): Promise<string>;
export function assetIdsOf(objects: readonly SceneObject[]): Set<string>;
```

### 2.14 `src/catalog/types.ts` — формат каталога (шов для тем)

```ts
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
```

### 2.15 `src/catalog/index.ts`, `src/catalog/bounds.ts`, `src/catalog/testing.ts`

```ts
// index.ts — может импортировать src/model/* значениями (createObject, placeNew, makeContext — для galleryObjects);
// обратного импорта нет: src/model знает только типы из ./types (Р22)
import type { RoomDef, SceneObject, Params } from '../model/types';
import type { BuildInput, CatalogItem, CatalogLookup, CatalogSet, Painter, Part } from './types';

/** [basicSet, hpSet], отсортированы по order. Новая тема = папка в src/catalog/sets/ + одна строка здесь. */
export const catalogSets: readonly CatalogSet[];
/** Серый ящик 0.5³, kind 'primitive', все крепления — для неизвестных type. */
export const FALLBACK_ITEM: CatalogItem;
/** Никогда не бросает: неизвестный type → FALLBACK_ITEM. */
export function getItem(type: string): CatalogItem;
export function hasItem(type: string): boolean;
/** Записи с listed !== false в порядке наборов. */
export function listedItems(): CatalogItem[];
export function getPainter(name: string): Painter | undefined;
/** Умолчания ParamDef, поверх — сохранённые значения; числа зажаты в [min, max]; неизвестные ключи сохраняются. */
export function resolveParams(item: CatalogItem, params: Params): Params;
export function buildInput(o: SceneObject): BuildInput;
/**
 * Части объекта: item.build(buildInput(o)); нет build → []. Мемоизация по ключу type | size | color | JSON(params) | mount.kind
 * (LRU на 256 записей), поэтому вызывать можно на каждое движение мыши.
 */
export function partsOf(o: SceneObject): readonly Part[];
/** getItem(o.type).support === true && o.visible && o.mount.kind === 'floor'. */
export function isSupport(o: SceneObject): boolean;
/** { getItem, isSupport } — то, что стор, действия и W2 передают в функции src/model с параметром `catalog`. */
export const catalogLookup: CatalogLookup;
/** Для отладки (`#gallery` в адресе): по одному объекту каждой записи каталога на её креплении по умолчанию, разложены по помещению. */
export function galleryObjects(room: RoomDef): SceneObject[];

// bounds.ts
import type { SceneObject } from '../model/types';
import type { LocalBox, Part } from './types';
/** Габаритный бокс объекта: center [0, h/2, 0], size. */
export function objectBox(o: Pick<SceneObject, 'size'>): LocalBox;
/** AABB части с учётом её поворота (у цилиндра с taper > 1 поперечник = диаметр × taper). */
export function partBounds(part: Part): LocalBox;
/**
 * Боксы для выбора мышью (мемоизация тем же ключом, что partsOf):
 *   item.pickBoxes?.(input) → иначе partBounds каждой не-additive части, если частей 1…200 → иначе [objectBox(o)].
 */
export function pickBoxes(o: SceneObject): readonly LocalBox[];

// testing.ts — общий помощник для тестов билдеров (F, W6, W7)
import type { BuildInput, CatalogItem, Painter } from './types';
/**
 * Строит item с умолчаниями (поверх — overrides) и возвращает список нарушений (пустой = всё хорошо):
 * NaN/Infinity; size ≤ 0; не-additive часть вне габарита (допуск 10 % + 2 см); повторная сборка не deep-равна первой;
 * paint.painter отсутствует в painters; частей больше maxParts (по умолчанию 900).
 */
export function checkBuild(
  item: CatalogItem,
  painters: Record<string, Painter>,
  overrides?: Partial<BuildInput>,
  maxParts?: number,
): string[];
```

Набор `basic` (`src/catalog/sets/basic.ts`, фундамент, заморожен; id заморожены, на них ссылается `rooms/lounge.ts`).
Билдеры мебели — прямой перенос сегодняшнего `scene/objects/parts.ts`; `shade()` берётся из `src/model/color.ts` (2.7).
Единственное отличие от этапа 1 — `barrier`: его опоры длиной 0.5 м выходили далеко за габарит глубиной 0.06 м (тест
этапа 1 исключал ограждение из проверки габарита). Теперь габарит — настоящий след на полу: `size = 2.2 × 1.1 × 0.5`,
перила и прутья — фиксированной толщины (перила `min(0.06, d)`, прутья 0.02) по оси объекта, опоры `[0.06, 0.03, d]`.
Вид не меняется; F правит `size` двух ограждений в `rooms/lounge.ts` на `[2.2, 1.1, 0.5]`. Каждая запись набора проходит
`checkBuild` без исключений.

| id | kind | title | category | size, м | resize | mounts | Прочее |
|---|---|---|---|---|---|---|---|
| `sofa` | primitive | Диван | Мебель | 1.6 × 0.8 × 0.75 | free | floor | |
| `sofaU` | primitive | Диван-кабинка | Мебель | 2.8 × 0.85 × 1.8 | free | floor | |
| `table` | primitive | Стол | Мебель | 1.1 × 0.75 × 0.7 | free | floor | `support` |
| `highTable` | primitive | Высокая стойка | Мебель | 1.4 × 1.1 × 0.5 | free | floor | `support` |
| `phoneBooth` | primitive | Телефонная будка | Мебель | 0.9 × 2.4 × 0.9 | uniform | floor | |
| `barrier` | primitive | Ограждение | Мебель | 2.2 × 1.1 × 0.5 | free | floor | `minSize` 0.4 × 0.4 × 0.3 |
| `floorLamp` | primitive | Торшер | Мебель | 0.45 × 1.6 × 0.45 | uniform | floor | |
| `box` | primitive | Ящик | Фигуры | 0.5 × 0.5 × 0.5 | free | floor, surface, ceiling | `support` |
| `cylinder` | primitive | Цилиндр | Фигуры | 0.5 × 0.5 × 0.5 | free | floor, surface, ceiling | `support` |
| `sphere` | primitive | Шар | Фигуры | 0.4 × 0.4 × 0.4 | uniform | floor, surface, ceiling | |
| `cone` | primitive | Конус | Фигуры | 0.4 × 0.6 × 0.4 | free | floor, surface, ceiling | |
| `panel` | primitive | Щит / баннер | Фигуры | 1.5 × 1.0 × 0.03 | free | wall, floor, ceiling | |
| `light.point` | light | Лампа | Свет | 0.15 × 0.15 × 0.15 | none | ceiling, wall, floor, surface | `defaultDrop 0.4`; params `intensity` «Яркость, кд» 15 (0–200), `distance` «Дальность, м» 8 (1–15) |
| `light.spot` | light | Прожектор | Свет | 0.18 × 0.22 × 0.18 | none | ceiling, wall, floor, surface | params `intensity` 40 (0–200), `distance` 8 (1–15), `angle` «Угол, °» 30 (10–60), `penumbra` «Мягкость» 0.5 (0–1), `tilt` «Наклон, °» 0 (0–90) |
| `image` | image | Картинка | Мои файлы | 1.0 × 1.0 × 0.02 | uniform | wall, floor, ceiling, surface | `flatAxis: 2`; `listed: false`, `hanger: false` (две свои нити рисует `ImageBody`); params `glow` «Светится» false |
| `image.flat` | image | Картинка плашмя | Мои файлы | 1.0 × 0.02 × 1.0 | uniform | floor, ceiling, surface | `flatAxis: 1`; `listed: false`, `hanger: false`; params `glow` false |
| `model` | model | 3D-модель | Мои файлы | 1 × 1 × 1 | uniform | floor, surface, ceiling, wall | `listed: false` |
| `duct` | primitive | Воздуховод | Площадка | 12 × 0.45 × 0.5 | free | ceiling | `listed: false`, `hanger: false` |
| `pendantBulbs` | preset | Лампы на проводах | Площадка | 2.0 × 0.8 × 0.6 | free | ceiling | `listed: false`, `hanger: false`; params `count` 5 (1–12), `seed`; провод = тонкий цилиндр, лампа = сфера `glow` `#ffd9a0` + аддитивный ореол |
| `projector` | primitive | Проектор | Площадка | 0.4 × 0.18 × 0.35 | uniform | ceiling | `listed: false`, `defaultDrop 0.35` |

Цвет лампы — `SceneObject.color`. Картинка: изображение лежит в плоскости XY (`image`) либо XZ (`image.flat`: на полу/столе —
лицом вверх, под потолком — лицом вниз); высота (соответственно глубина) нового объекта берётся из пропорций файла.

### 2.16 `src/store/editorStore.ts`

```ts
import type { StoreApi, UseBoundStore } from 'zustand';
import type { Command, ObjectPatch } from '../model/commands';
import type { History } from '../model/history';
import type { AmbienceId, AssetMeta, CameraMode, LayerMode, Layout } from '../model/types';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
/** Куда пишет репозиторий: 'local' — хранилища браузера; 'memory' — они недоступны, макеты живут до закрытия вкладки. */
export type StorageMode = 'local' | 'memory';
export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}
export interface DispatchOptions {
  /** Подпись шага в истории («Перемещение», «Размер»…). */
  label?: string;
  mergeKey?: string;
  /** По умолчанию 'local'. 'remote' — применить, не записывая в историю. */
  origin?: 'local' | 'remote';
  /** По умолчанию origin === 'local'. */
  record?: boolean;
}
export interface CommandMeta {
  layoutId: string;
  /** 'history' — команда применена через undo/redo. */
  origin: 'local' | 'remote' | 'history';
  /** Монотонный счётчик команд в этой вкладке. */
  seq: number;
  time: number;
}

export interface EditorState {
  // ---- документ ----
  /** Всегда равен layout.roomId. */
  roomId: string;
  layout: Layout;
  history: History;

  // ---- временное ----
  /** Живые значения перетаскиваемого объекта; не входят ни в макет, ни в историю. */
  draft: Readonly<Record<string, ObjectPatch>> | null;
  selectedId: string | null;
  hoveredId: string | null;
  /** true на время снимка: оверлеи редактора и маркеры ламп скрыты. */
  capturing: boolean;
  /** Камера выше потолка либо план (пишет ViewProbe из W2). */
  viewFromAbove: boolean;
  /** backSurfaces(…): id стен и граней колонн, на которые камера смотрит с изнанки (пишет ViewProbe из W2). */
  backSurfaceIds: readonly string[];
  saveStatus: SaveStatus;
  /** Ставит W4 один раз при старте; при 'memory' LayoutsMenu показывает постоянную метку «Не сохраняется». */
  storage: StorageMode;
  notice: Notice | null;
  /** Библиотека пользовательских файлов (W4 заполняет при старте, W3 — после загрузки/удаления). */
  assets: AssetMeta[];

  // ---- вид (не часть макета, не в истории) ----
  cameraMode: CameraMode;
  layer: LayerMode;
  gridSnap: boolean;
  showLabels: boolean;
  ambience: AmbienceId;

  // ---- команды ----
  /**
   * ЕДИНСТВЕННЫЙ способ изменить layout.objects / layout.name.
   * 1. isNoop → выход. 2. inverse = invertCommand(layout, cmd); layout = { ...applyCommand(layout, cmd), updatedAt: Date.now() }.
   * 3. draft: origin 'local' (и undo/redo) → draft = null; origin 'remote' → из draft убираются только id объектов,
   *    которых после команды больше нет (чужая правка не обрывает локальное перетаскивание; пустой draft → null).
   *    selectedId / hoveredId сбрасываются, если объекта больше нет.
   * 4. origin 'local' и record !== false → pushHistory({ label, redo: cmd, undo: inverse, mergeKey, time }).
   * 5. saveStatus = 'dirty'. 6. Слушатели subscribeCommands.
   */
  dispatch(cmd: Command, opts?: DispatchOptions): void;
  /** Ничего не делают в режиме прогулки и пока draft !== null. Слушатели получают origin 'history'. */
  undo(): void;
  redo(): void;
  setDraft(draft: Record<string, ObjectPatch> | null): void;
  /**
   * draft → ОДИН dispatch с label: для каждого id — cmdPatch(layout, id, draft[id], room, catalogLookup) (несколько id →
   * batch), затем draft = null. Сырой patch мимо cmdPatch не отправляется: результат перетаскивания проходит те же
   * проверки размера, крепления и I2/I5, что и правка из панели. Пустой draft или пустая команда → только draft = null.
   */
  commitDraft(label: string): void;

  // ---- выбор и вид ----
  select(id: string | null): void;
  setHovered(id: string | null): void;
  /** Вход в 'walk' сбрасывает draft, selectedId, hoveredId. */
  setCameraMode(mode: CameraMode): void;
  setLayer(layer: LayerMode): void;
  setViewFromAbove(above: boolean): void;
  /** Не меняет состояние (и не будит подписчиков), если список поэлементно равен текущему. */
  setBackSurfaces(ids: readonly string[]): void;
  setGridSnap(on: boolean): void;
  toggleLabels(): void;
  setAmbience(id: AmbienceId): void;
  setCapturing(on: boolean): void;
  setSaveStatus(status: SaveStatus): void;
  setStorageMode(mode: StorageMode): void;
  /** Показывает тост на 5 с (заменяет предыдущий); id назначается автоматически. Постоянных тостов нет — для них есть поля состояния (storage, saveStatus). */
  notify(level: Notice['level'], text: string): void;
  dismissNotice(): void;
  setAssets(assets: AssetMeta[]): void;
  /** Заменяет документ: roomId = layout.roomId, история, draft, выбор сбрасываются, saveStatus = 'saved'. В историю не пишется. */
  openLayout(layout: Layout): void;
}

export const useEditor: UseBoundStore<StoreApi<EditorState>>;

/** Шов автосохранения и realtime: вызывается после каждой применённой команды (local, remote, history). Возвращает отписку. */
export function subscribeCommands(listener: (cmd: Command, meta: CommandMeta) => void): () => void;
```

Начальное состояние: `layout = createLayout(rooms[0])`, `cameraMode 'orbit'`, `layer 'auto'`, `gridSnap true`,
`showLabels true`, `ambience 'work'`, `viewFromAbove true`, `backSurfaceIds []`, `saveStatus 'saved'`, `storage 'local'`,
остальное пусто. Стор (не чистый модуль) импортирует `getRoom` из `src/rooms` и `catalogLookup` из `src/catalog`.

### 2.17 `src/store/selectors.ts`, `src/store/actions.ts`, `src/store/bridge.ts`

```ts
// selectors.ts — рендереры и панели читают объекты ТОЛЬКО отсюда (значения уже слиты с draft)
import type { LayerView } from '../model/layers';
import type { Pose, SceneContext } from '../model/pose';
import type { RoomDef, SceneObject } from '../model/types';

/** Объект с применённым draft. Результат кэшируется по паре ссылок (object, patch) — селектор стабилен для zustand v5. */
export function useObject(id: string): SceneObject | undefined;
/** Стабильный массив id (меняется только при add / remove / перестановке). */
export function useObjectIds(): string[];
/** Мировая поза с учётом draft объекта и его хозяина; ссылка стабильна, пока числа равны. */
export function usePose(id: string): Pose | undefined;
export function useSelected(): SceneObject | undefined;
/** cameraMode !== 'walk'. */
export function useCanEdit(): boolean;
/** layerView(layer, cameraMode, viewFromAbove). */
export function useLayerView(): LayerView;
/** state.backSurfaceIds (ссылка стабильна между изменениями). */
export function useBackSurfaces(): readonly string[];
/** isGhosted(o, layerView, backSurfaceIds, selectedId) для объекта с draft; false, если объекта нет. */
export function useIsGhosted(id: string): boolean;
export function useRoom(): RoomDef;
/** activeLightIds(objects, reservedLights(room, ambience, cameraMode)); мемоизация по ссылкам. */
export function useActiveLightIds(): ReadonlySet<string>;

// Снимки для обработчиков событий (вне React)
export function getObject(id: string): SceneObject | undefined;
export function getObjects(): readonly SceneObject[];
/** makeContext(room, getObjects()); мемоизация по (room, layout.objects, draft). */
export function getContext(): SceneContext;
export function getLayerView(): LayerView;
export function getBackSurfaces(): readonly string[];
export function canEdit(): boolean;

// actions.ts — высокоуровневые действия; панели и горячие клавиши вызывают ТОЛЬКО их. Каждое — один dispatch, один шаг undo.
// Все — no-op при !canEdit().
import type { CatalogItem } from '../catalog/types';
import type { ObjectPatch } from '../model/commands';
import type { ObjectInit } from '../model/ops';
import type { MountKind } from '../model/types';

/**
 * Создаёт объект: size = init.size ?? item.size; mount = placeNew(item, size, viewportBridge()?.centerRay() ?? null, …,
 * gridSnap ? GRID_STEP : null); dispatch add («Добавить: ‹title›»); select(новый id). Возвращает id.
 * Если это лампа и она оказалась за пределом activeLightIds — notify('warn', 'Активны только первые 12 источников света').
 */
export function addObject(item: CatalogItem, init?: ObjectInit): string | null;
/**
 * Патч одного объекта: dispatch(cmdPatch(layout, id, set, room, catalogLookup), { label, mergeKey }). Вся проверка —
 * в cmdPatch (2.10): clampSize для size, clampMount для крепления, заблокированный объект принимает только
 * { locked } и { visible }, скрытие хозяина сначала опускает его детей на пол. Пустая команда не отправляется.
 */
export function patchObject(id: string, set: ObjectPatch, label: string, mergeKey?: string): void;
/** dispatch(cmdSetMount(layout, id, to, room, catalogLookup)). */
export function setObjectMount(id: string, to: MountKind): void;
export function deleteObject(id: string): void;
/** Выбирает копию; возвращает её id. */
export function duplicateObject(id: string): string | null;
export function resetFurniture(): void;

// bridge.ts — шов DOM ↔ canvas (регистрирует EditorOverlay из W2)
import type { Ray } from '../model/types';
export interface ViewportBridge {
  /** Луч через центр вьюпорта текущей камеры. */
  centerRay(): Ray | null;
  /** setCapturing(true) → два requestAnimationFrame → canvas.toBlob('image/png') → setCapturing(false). */
  capturePng(): Promise<Blob | null>;
}
export function setViewportBridge(bridge: ViewportBridge | null): void;
export function viewportBridge(): ViewportBridge | null;
```

### 2.18 `src/persistence/repository.ts`, `sync.ts` (F) и `index.ts`, `session.ts`, `layoutFile.ts` (тела — W4)

```ts
// repository.ts
import type { AssetKind, AssetMeta, Layout, Vec3 } from '../model/types';

export interface LayoutMeta {
  id: string;
  name: string;
  roomId: string;
  updatedAt: number;
}
export type RepositoryErrorCode = 'quota' | 'unavailable' | 'corrupt';
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  constructor(code: RepositoryErrorCode, message?: string);
}

export interface LayoutRepository {
  /** Новые первыми. Без roomId — все помещения. */
  list(roomId?: string): Promise<LayoutMeta[]>;
  /** Уже прошёл parseLayout. null — нет такого. Нечитаемый → RepositoryError('corrupt'), запись не удаляется. */
  load(id: string): Promise<Layout | null>;
  /** Создаёт или перезаписывает. Нет места → RepositoryError('quota'), сохранённое не портится. */
  save(layout: Layout): Promise<void>;
  /** Файлы не трогает. */
  remove(id: string): Promise<void>;
  /** Идемпотентно: одинаковые байты → один id (hashAssetId). mime определяется sniffMime; неизвестный → RepositoryError('corrupt'). */
  putAsset(blob: Blob, info: { kind: AssetKind; name: string; width?: number; height?: number; naturalSize?: Vec3 }): Promise<AssetMeta>;
  getAsset(id: string): Promise<Blob | null>;
  listAssets(): Promise<AssetMeta[]>;
  removeAsset(id: string): Promise<void>;
}

/** В памяти: тесты, заглушка фундамента и запасной вариант, когда хранилища браузера недоступны. */
export class MemoryRepository implements LayoutRepository { /* … */ }

// sync.ts — шов realtime: только интерфейс, реализации сейчас нет
import type { Command } from '../model/commands';
import type { CommandMeta } from '../store/editorStore';
export interface SyncChannel {
  /** Возвращает disconnect. */
  connect(layoutId: string, onRemote: (cmd: Command, meta: CommandMeta) => void): () => void;
  send(cmd: Command, meta: CommandMeta): void;
}

// index.ts — тело W4 (заглушка F: new MemoryRepository()). Если хранилища браузера недоступны, W4 подставляет
// MemoryRepository, а startSession вызывает setStorageMode('memory') и один раз notify('warn', …).
export const repository: LayoutRepository;

// session.ts — тело W4 (заглушки F работают в памяти: startSession ничего не делает, switchRoom открывает createLayout(room),
// остальное — notify('warn', 'Сохранение ещё не подключено'))
/** Читает настройки, библиотеку файлов, открывает последний макет последнего помещения (или создаёт «Макет 1»), включает автосохранение. Идемпотентна (StrictMode). */
export function startSession(): Promise<void>;
/** Сохраняет текущий макет и открывает последний макет помещения (или создаёт). */
export function switchRoom(roomId: string): Promise<void>;
/** Макеты текущего помещения, новые первыми. */
export function listLayouts(): Promise<LayoutMeta[]>;
export function openLayoutById(id: string): Promise<void>;
export function createNamedLayout(name: string): Promise<void>;
/** «Сохранить как…»: копия становится текущей. */
export function duplicateCurrentLayout(name: string): Promise<void>;
/** dispatch({ type: 'rename', name }). */
export function renameCurrentLayout(name: string): void;
/** Удаляет; если это текущий — открывает следующий по новизне или создаёт новый. */
export function deleteLayout(id: string): Promise<void>;
/** Сохраняет, собирает файл и запускает скачивание `<room>-<имя>-<yyyy-mm-dd>.vagonka.json`. */
export function exportCurrentLayout(): Promise<void>;
/** Импортирует как НОВЫЙ макет, обновляет библиотеку файлов, открывает его (переключая помещение). Ошибки — notify. */
export function importLayoutFile(file: File): Promise<void>;
/** Названия сохранённых макетов (и текущего), в которых используется файл. */
export function assetUsage(assetId: string): Promise<string[]>;
/** Немедленно сохранить, если есть несохранённое. */
export function flushSave(): Promise<void>;

// layoutFile.ts — формат экспорта (файл целиком создаёт W4; заглушки F нет — его импортирует только session.ts из W4)
export interface LayoutFile {
  format: 'vagonka-layout';
  version: 1;
  /** ISO 8601. */
  exportedAt: string;
  layout: Layout;
  /** Только файлы, на которые ссылаются объекты макета. */
  assets: { meta: AssetMeta; base64: string }[];
}
export function bytesToBase64(bytes: Uint8Array): string;          // кусками, без переполнения стека
export function base64ToBytes(text: string): Uint8Array;           // бросает на неверном входе
export function buildLayoutFile(layout: Layout, repo: LayoutRepository): Promise<LayoutFile>;
export interface ImportResult {
  layout: Layout;
  /** По-русски, для показа пользователю. */
  warnings: string[];
}
/** Проверяет, сохраняет вложенные файлы и макет в repo как НОВЫЙ (новый id, имя + « (импорт)» при совпадении). Бросает LayoutFormatError / RepositoryError. */
export function readLayoutFile(text: string, repo: LayoutRepository, roomIds: readonly string[]): Promise<ImportResult>;
```

Швы на будущее (кода сейчас нет):

- **Общая серверная база макетов** — `HttpRepository implements LayoutRepository`, одна строка в `src/persistence/index.ts`.
  Content-addressed id файлов становятся `PUT /assets/<id>` (загрузка пропускается, если файл уже есть).
- **Совместное редактирование** — `SyncChannel`: `subscribeCommands(send)` для команд с origin `local` / `history`;
  входящие — `dispatch(cmd, { origin: 'remote' })` (применяются, в локальную историю не пишутся и **не сбрасывают**
  локальный `draft`, см. шаг 3 в 2.16 — чужая правка не обрывает перетаскивание). `draft` позже можно рассылать как
  присутствие, не трогая документ.

### 2.19 Компоненты и точки входа (заглушки создаёт F, тело — указанный пакет)

Заморожены имя экспорта, файл и тип props. Возвращаемый тип компонентов **не аннотируется** (выводится): в
`@types/react` 19 нет глобального `JSX`, `(): JSX.Element` не компилируется. Все компоненты возвращают элемент; только
`EditorOverlay` может вернуть `null`.

| Символ (заморожены имя, файл, props) | Файл | Тело | Заглушка F |
|---|---|---|---|
| `Viewport()` | `src/scene/Viewport.tsx` | **F, финальная** | — |
| `App()` | `src/App.tsx` | **F, финальная** | — |
| `RoomShell(props: { room: RoomDef; mode: CameraMode; showLabels: boolean })` | `src/scene/RoomShell.tsx` | W1 | код этапа 1 без изменений |
| `Ambience(props: { room: RoomDef; mode: CameraMode; ambience: AmbienceId })` | `src/scene/Ambience.tsx` | W1 | свет этапа 1 |
| `EditorOverlay(props: { room: RoomDef; mode: CameraMode })` (элемент или `null`) | `src/editor/EditorOverlay.tsx` | W2 | `null` |
| `Hud()` (DOM, в подвале под вьюпортом) | `src/editor/Hud.tsx` | W2 | подсказки этапа 1 по режимам |
| `useShortcuts(): void` | `src/editor/shortcuts.ts` | W2 | пустой хук |
| `OrbitMode / TopMode / WalkMode(props: { room: RoomDef })` | `src/scene/controls/CameraModes.tsx` | W2 | код этапа 1 без изменений |
| `SceneObjects()` | `src/scene/SceneObjects.tsx` | W3 | рисует `partsOf(o)` простыми мешами в `resolvePose` |
| `AssetShelf()` (встраивается в `LibraryPanel`) | `src/assets/AssetShelf.tsx` | W3 | `<></>` |
| `LayoutsMenu()` (встраивается в `Toolbar`) | `src/persistence/LayoutsMenu.tsx` | W4 | `<></>` |
| `repository`, функции `session.ts` | `src/persistence/index.ts`, `session.ts` | W4 | см. 2.18 |
| `Toolbar()` | `src/ui/Toolbar.tsx` | W5 | панель этапа 1 на новом сторе (`switchRoom`, без экспорта `hints`) |
| `LibraryPanel()`, `PropertiesPanel()`, `ObjectList()` | `src/ui/*.tsx` | W5 | `<></>` |
| `export const item: CatalogItem; export const painters: Record<string, Painter>` | `src/catalog/sets/hp/<имя>.ts` × 11 | W6 / W7 | запись с финальными id / title / mounts / size из раздела 4, `build` = один бокс, `painters = {}` |

`Viewport` (финальная композиция, F):

```tsx
<Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }}>
  <Ambience room={room} mode={mode} ambience={ambience} />
  <RoomShell room={room} mode={mode} showLabels={showLabels} />
  <SceneObjects />
  <EditorOverlay room={room} mode={mode} />
  {mode === 'orbit' && <OrbitMode key={room.id} room={room} />}
  {mode === 'top' && <TopMode key={room.id} room={room} />}
  {mode === 'walk' && <WalkMode key={room.id} room={room} />}
</Canvas>
```

(`<color attach="background">` и все источники света переезжают из `Viewport` в `Ambience`.)

`App` (финальная композиция, F): `useShortcuts()`; сетка `toolbar / (left | viewport | right) / hint`:

```tsx
<div className="app">
  <Toolbar />
  <div className="workspace">
    <aside className="side side-left"><LibraryPanel /></aside>
    <main className="viewport"><Viewport /></main>
    <aside className="side side-right"><PropertiesPanel /><ObjectList /></aside>
  </div>
  <footer className="hint"><Hud /></footer>
  {notice && <div className={`toast toast-${notice.level}`} role="status">{notice.text}</div>}
</div>
```

Тост исчезает через 5 с (`dismissNotice`); всё, что должно быть видно постоянно, показывается не тостом, а по полям
состояния (`storage === 'memory'` и `saveStatus` — в `LayoutsMenu`). Боковые панели получают класс `is-disabled` (и `inert`) при `!useCanEdit()` с
подписью «В режиме прогулки редактирование отключено». `main.tsx`: `await startSession()` не блокирует первый рендер;
при `location.hash === '#gallery'` вместо сессии открывается `{ ...createLayout(room), objects: galleryObjects(room) }`.

CSS: `src/styles.css` (F) — токены этапа 1, сетка `.workspace / .side`, общие классы `.panel .panel-title .btn .icon-btn .field
.row .list .toast .is-disabled`. Каждый пакет добавляет **свой** CSS-файл и импортирует его из своих компонентов:
`src/editor/editor.css` (W2), `src/assets/assets.css` (W3), `src/persistence/layouts.css` (W4), `src/ui/panels.css` (W5).
Никаких CSS-фреймворков.

### 2.20 Чистые модули взаимодействия (`src/editor/`; файлы создаёт W2, заглушек F нет; сигнатуры заморожены ради тестов)

```ts
// constants.ts (пределы размера MIN_SIZE / MAX_SIZE живут в src/model/ops.ts — см. clampSize)
export const DRAG_THRESHOLD_PX = 4;
export const HANDLE_PX = 9;
export const PICK_MIN_PX = 10;
/** Выбранный объект выигрывает у более близкого попадания, только если разница расстояний не больше этой, м. */
export const PICK_TIE = 0.02;

// pick.ts
import type { LocalBox } from '../catalog/types';
import type { SceneContext } from '../model/pose';
import type { Ray, RoomDef, SceneObject, Vec3 } from '../model/types';

/** Slab-тест луча (в локальных координатах бокса) против AABB; каждая сторона бокса раздувается минимум до minThickness. Расстояние входа или null. */
export function rayBox(ray: Ray, box: LocalBox, minThickness?: number): number | null;
export interface ObjectHit { id: string; distance: number; point: Vec3 }
/**
 * Для каждого объекта, прошедшего pickable: луч → локальные координаты (rayToLocal(resolvePose)) → ближайший из pickBoxes(o).
 * minThickness(distance) — мировая толщина, соответствующая PICK_MIN_PX на этом расстоянии. Результат — от ближнего к дальнему.
 */
export function pickObjects(
  ray: Ray,
  ctx: SceneContext,
  opts: { pickable(o: SceneObject): boolean; minThickness(distance: number): number },
): ObjectHit[];
/** Расстояние до ближайшей колонны на пути луча (AABB колонны на всю высоту); Infinity — колонн нет. */
export function columnDistance(ray: Ray, room: RoomDef): number;
/**
 * Отбрасывает попадания дальше occluder; побеждает БЛИЖАЙШЕЕ. Единственное исключение: если среди оставшихся есть
 * выбранный объект и его distance ≤ ближайшая + PICK_TIE — побеждает он (соприкасающиеся поверхности не «перехватывают»
 * перетаскивание). Фонарь на выбранном столе и стол внутри выбранной кабинки выбираются с первого клика.
 */
export function choosePick(hits: ObjectHit[], selectedId: string | null, occluder: number): ObjectHit | null;

// drag.ts — данные каталога (getItem, isSupport, catalogLookup) модули src/editor импортируют прямо из '../catalog':
// правило Р22 о внедрении касается только src/model
import type { Mount } from '../model/types';
export interface DragEnv {
  ctx: SceneContext;
  /** null — привязка выключена (тогда значения округляются до 1 см). */
  grid: number | null;
  mode: 'orbit' | 'top';
}
export interface MoveSession {
  id: string;
  /** Объект на момент начала (без draft). */
  start: SceneObject;
  /** Высота основания в начале. */
  baseY: number;
  /**
   * Только wall. 'hit' — в начале луч попал в поверхность самого объекта (hitWalls нашёл её лицевой стороной): дальше
   * объект следует за попаданиями в стены. 'floor' — не попал (план; объект на отсечённой стене, взятый «со спины»;
   * скользящий луч): дальше объект следует за точкой пола под курсором к ближайшей поверхности.
   */
  wallVia?: 'hit' | 'floor';
  /**
   * floor/ceiling/surface: мировые (x, z) центра основания минус точка луча на плоскости y = baseY.
   * wall, wallVia 'hit':   (along, bottom) объекта минус (along, y) попадания в его поверхность.
   * wall, wallVia 'floor': [along объекта − along проекции точки пола (rayPlaneY(ray, 0)) на его поверхность, 0];
   *                        точки пола нет → [0, 0].
   */
  offset: [number, number];
}
export interface MoveResult { mount: Mount; rotationY: number }
export function beginMove(o: SceneObject, ray: Ray, ctx: SceneContext): MoveSession;
/** Новое крепление для луча под курсором; null — луч не попал в свою поверхность (вызывающий оставляет прежнее). Правила — в разделе W2. */
export function resolveMove(s: MoveSession, ray: Ray, env: DragEnv): MoveResult | null;

// handles.ts
export type HandleKind = 'rotate' | 'resize-w' | 'resize-d' | 'resize-h' | 'resize-uniform' | 'drop';
export interface Handle { kind: HandleKind; position: Vec3 }
/** Ручки выбранного незаблокированного объекта в мировых координатах. Состав — таблица в разделе W2. */
export function handlesFor(o: SceneObject, ctx: SceneContext, mode: 'orbit' | 'top'): Handle[];
/** Ближайшая ручка, до которой луч проходит ближе radiusAt(position). */
export function pickHandle(ray: Ray, handles: Handle[], radiusAt: (p: Vec3) => number): Handle | null;
/** Параметр t ближайшей к лучу точки прямой point + t·axis; null — почти параллельны. */
export function closestOnAxis(ray: Ray, point: Vec3, axis: Vec3): number | null;
/** Новый SceneObject.rotationY (для surface — относительно хозяина); привязка ROTATION_STEP при env.grid !== null. */
export function resolveRotate(o: SceneObject, ray: Ray, env: DragEnv): number | null;
/**
 * Новый size. o — объект на момент начала жеста (без draft). Порядок:
 *   1. из луча — новое значение ОДНОЙ оси: resize-w / -d / -h → эта ось; resize-uniform → коэффициент k, применяется
 *      к наибольшей стороне o.size (кроме item.flatAxis);
 *   2. при env.grid !== null это одно значение округляется к SIZE_STEP (но не ниже SIZE_STEP); остальные оси НЕ округляются;
 *   3. free → next = o.size с заменённой осью; uniform → next = o.size × (округлённое / исходное наибольшей стороны);
 *   4. return clampSize(getItem(o.type), o.size, next) — пределы и сохранение пропорций там (2.10).
 * Картинка 1 × 0.75 × 0.02, уменьшенная вдвое, даёт 0.5 × 0.375 × 0.02; у щита 1.5 × 1.0 × 0.03 ручка ширины не трогает d.
 */
export function resolveResize(o: SceneObject, kind: HandleKind, ray: Ray, env: DragEnv): Vec3 | null;
/** Новое крепление ceiling с drop ∈ [0, H − h]. */
export function resolveDrop(o: SceneObject, ray: Ray, env: DragEnv): Mount | null;
```

### 2.21 `src/texture/homography.ts` (файл создаёт W1; заглушки F нет)

```ts
export type Pt = [number, number];
/** Углы прямоугольника стены на фото: верх-лево, верх-право, низ-право, низ-лево (пиксели источника; могут лежать вне кадра). */
export type Quad = [Pt, Pt, Pt, Pt];
/** 3×3 по строкам. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
/** H: H·from[i] ~ to[i]. Система 8×8 (h33 = 1), Гаусс с выбором главного элемента. Вырожденный квад → Error. */
export function solveHomography(from: Quad, to: Quad): Mat3;
export function applyHomography(h: Mat3, x: number, y: number): Pt;
/** Пиксель результата (0…w, 0…h) → пиксель источника. */
export function rectToQuad(w: number, h: number, quad: Quad): Mat3;
/** Длинная сторона = min(maxSide, ceil(oversample × самая длинная сторона квада)); вторая — из метрических пропорций. По умолчанию 2048 и 1.25. */
export function outputSize(quad: Quad, metres: [number, number], maxSide?: number, oversample?: number): [number, number];
export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4;
}
/** Обратное отображение в центрах пикселей, билинейная выборка, на выходе RGB. Вне источника → fill. gain умножает каналы (коррекция красной засветки). */
export function rectify(
  src: RawImage,
  quad: Quad,
  outW: number,
  outH: number,
  opts?: { fill?: [number, number, number]; gain?: [number, number, number] },
): RawImage;
```

Файл не должен содержать импортов и неудаляемого TS-синтаксиса (enum, namespace, параметры-свойства): его напрямую
импортирует Node-скрипт.

---

## 3. Пакеты работ

Порядок: **F (один агент) → заморозка → W1…W7 параллельно → I (один агент)**.

Правила параллельной фазы (обязательны для всех пакетов W):

1. Пакет пишет **только** в файлы из своего списка. Чужие файлы и всё, что помечено «F, заморожено», не редактируются.
   Если замороженный контракт неверен или его не хватает — не править, а сообщить в отчёте; правку внесёт интегратор.
2. Импортировать из других пакетов можно только символы раздела 2 (и только по указанным путям).
3. Проверка в процессе — **только** `npx tsc --noEmit` (чинить только ошибки в своих файлах; чужие полуготовые файлы могут
   временно ломать сборку) и `npx vitest run <свои пути>`; W1 дополнительно запускает свой Node-скрипт `npm run bake`
   (он пишет только в файлы W1). Пакеты W **не запускают и не останавливают dev-сервер**
   (`npm run dev`, `vite preview`, конфигурация `date-map`) и не открывают приложение в браузере: порт один
   (`strictPort: 5173`), а сервер показывал бы дерево с полуготовыми файлами семи агентов. Приёмка пакетов W — `tsc`,
   `vitest` и критерии, читаемые по коду. **Все** браузерные проверки (перетаскивание, призраки, `#gallery`, текстуры,
   снимок) выполняет интегратор; единственная браузерная проверка до него — спайк указателя в F.
4. `package.json`, `package-lock.json`, `node_modules`, `vite.config.ts`, `tsconfig.json`, `index.html` и
   `.claude/launch.json` принадлежат F и после заморозки **только читаются** всеми пакетами W: `npm install` во время
   параллельной фазы переписал бы `node_modules` под работающими `tsc` / `vitest` соседей. Единственную новую
   зависимость — `sharp` (dev) — ставит F до заморозки.
5. Тексты интерфейса — по-русски. Горячие клавиши — по `KeyboardEvent.code` (раскладка ЙЦУКЕН).
6. Все слушатели и регистрации (`setViewportBridge`, `subscribeCommands`) — в эффектах с симметричной очисткой (StrictMode).
7. Тесты чистой математики используют `testRoom` (2.11), а не `lounge`: размеры лаунжа меняет W1. Про `lounge` в
   тестах допустимы только утверждения, выведенные из его же данных (без числовых литералов координат).

Сводка владения (ни один файл не встречается дважды):

| Пакет | Файлы |
|---|---|
| **F** Фундамент | `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.claude/launch.json` (последние четыре не меняются), `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/model/**`, `src/catalog/{types,index,bounds,testing}.ts`, `src/catalog/catalog.test.ts`, `src/catalog/sets/basic.ts`, `src/catalog/sets/hp/index.ts`, `src/store/**`, `src/persistence/{repository,sync}.ts`, `src/persistence/repository.test.ts`, `src/scene/Viewport.tsx`, `src/rooms/index.ts`; удаляет `src/scene/objects/parts.ts`, `src/scene/objects/Primitive.tsx`; создаёт заглушки из таблицы 2.19 |
| **W1** Помещение и текстуры | `scripts/**`, `public/textures/**`, `assets-src/**/_debug/**`, `src/texture/**`, `src/rooms/lounge.ts`, `src/scene/RoomShell.tsx`, `src/scene/roomTextures.ts`, `src/scene/Label.tsx`, `src/scene/Ambience.tsx` |
| **W2** Взаимодействие | `src/editor/**`, `src/scene/controls/CameraModes.tsx` |
| **W3** Рендер объектов и файлы | `src/scene/SceneObjects.tsx`, `src/scene/objects/**`, `src/assets/**` |
| **W4** Сохранение | `src/persistence/**`, кроме `repository.ts`, `repository.test.ts` и `sync.ts` |
| **W5** Панели | `src/ui/**` |
| **W6** ГП: потолок и плоское | `src/catalog/sets/hp/{cloudCeiling,owlPost,prophetWall,signpost,wizardFrame,paper}.ts`, `src/catalog/sets/hp/flat.test.ts` |
| **W7** ГП: фигуры и настольное | `src/catalog/sets/hp/{dementor,dobby,hatLantern,mandrakes,owlCage,xmasTree,sortingHat}.ts`, `src/catalog/sets/hp/figures.test.ts` |
| **I** Интеграция | любой файл (после завершения W1…W7) |

`src/rooms/lounge.ts` получает одну механическую правку в F (объекты v2) и затем принадлежит W1 — это последовательная
передача, а не совместное владение. То же для остальных заглушек: после заморозки у файла один писатель.

---

### F — Фундамент (первым, один агент; затем заморожен)

**Цель.** Модель v2 с креплениями, команды, история, стор, каталог с набором `basic`, интерфейс репозитория, финальные
`App`/`Viewport` и компилируемые заглушки всех чужих точек входа. После F приложение выглядит и ведёт себя как этап 1
(та же мебель на тех же местах, три режима камеры), но уже на новой модели.

**Файлы (создаёт / меняет).**

- Меняет: `package.json` и `package-lock.json` (`npm install -D sharp`; скрипт `"bake": "node scripts/bake-textures.mjs"`),
  `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/model/types.ts`, `src/model/geometry.ts`,
  `src/model/geometry.test.ts`, `src/model/layout.ts`, `src/store/editorStore.ts`, `src/scene/Viewport.tsx`.
  `src/rooms/index.ts`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.claude/launch.json` не меняются, но заморожены.
- Создаёт: `src/model/{pose,layers,surfaces,place,rng,color,commands,history,ops,migrate,lights,assets}.ts` и по тесту
  `*.test.ts` на каждый; `src/model/testRoom.ts`; `src/catalog/{types,index,bounds,testing}.ts`,
  `src/catalog/catalog.test.ts`, `src/catalog/sets/basic.ts`, `src/catalog/sets/hp/index.ts`;
  `src/store/{selectors,actions,bridge}.ts`, `src/store/editorStore.test.ts`; `src/persistence/{repository,sync}.ts`,
  `src/persistence/repository.test.ts`.
- **Не создаёт** (их создают владельцы по сигнатурам раздела 2): `src/editor/{constants,pick,drag,handles}.ts` (W2),
  `src/texture/homography.ts` (W1), `src/persistence/layoutFile.ts` (W4).
- Удаляет: `src/scene/objects/parts.ts`, `src/scene/objects/Primitive.tsx` (билдеры переезжают в `basic.ts`, `shade()` —
  в `src/model/color.ts`; тест «примитивы» в `geometry.test.ts` заменяется проверкой `checkBuild` в `catalog.test.ts`).
- Заглушки (см. 2.19), которые после заморозки F не трогает: `src/rooms/lounge.ts` (хелпер `venue()` принимает `[x, z]`
  и возвращает объект v2: `mount: { kind: 'floor', x, z, lift: 0 }`, `assetId: null`, `params: {}`; высота подиума больше
  не записывается — её даёт `floorAt`; размер обоих ограждений → `[2.2, 1.1, 0.5]`; в файле остаётся только
  `import type`), `src/scene/Ambience.tsx`, `src/editor/{EditorOverlay.tsx,Hud.tsx,shortcuts.ts}`,
  `src/scene/SceneObjects.tsx`, `src/assets/AssetShelf.tsx`, `src/persistence/{index.ts,session.ts,LayoutsMenu.tsx}`,
  `src/ui/{Toolbar,LibraryPanel,PropertiesPanel,ObjectList}.tsx`, 11 модулей `src/catalog/sets/hp/*.ts`.
  `src/scene/RoomShell.tsx`, `src/scene/Label.tsx`, `src/scene/controls/CameraModes.tsx` остаются как есть.

**`sharp`.** `npm install -D sharp` выполняется здесь, до заморозки, пока в каталоге работает один агент. Проверка:
`node -e "import('sharp').then(m => console.log(m.default.versions))"`. Если установка не удалась (нет сети, нет
готового бинарника под платформу) — F сообщает об этом в отчёте и продолжает: W1 всё равно пишет скрипт и JSON, а
запекание и установку повторяет интегратор; панели без файла текстуры остаются одноцветными.

**Спайк указателя (в браузере, до заморозки).** Единственный момент до интеграции, когда дерево стабильно и dev-сервер
запускает один агент. Временный компонент ≈ 30 строк внутри `<Canvas>` (после проверки удаляется): capture-слушатель
`pointerdown` на `useThree(s => s.events.connected)`, который при попадании луча в ящик-заглушку ставит
`controls.enabled = false`, вызывает `setPointerCapture` и двигает ящик через `setDraft` / `commitDraft`. Проверить в
облёте и на плане: камера не вращается и не сдвигается, пока тянут ящик; после отпускания нет «доезда» по инерции;
клик по пустому месту по-прежнему вращает камеру. Результат — одна строка в отчёте F **и** комментарий в начале
заглушки `src/editor/EditorOverlay.tsx`: `// Спайк Р6: enabled=false достаточно` либо
`// Спайк Р6: дополнительно переключать enableRotate/enablePan` (тогда W2 реализует запасной вариант). Контракты
раздела 2 от исхода не зависят: оба варианта живут внутри `PointerController`.

`src/catalog/sets/hp/index.ts` (финальный): импортирует `item` и `painters` из 11 модулей и собирает
`export const hpSet: CatalogSet = { id: 'harry-potter', title: 'Гарри Поттер', order: 50, items: [...], painters: {...} }`
в порядке раздела 4. Набор `basic` имеет `order: 10`.

**Критерии приёмки.**

- `npx tsc --noEmit` без ошибок; `npx vitest run` зелёный; `npx vite build` проходит.
- В `src/model/**`, `src/catalog/**` нет импортов `three`, `react`, `zustand`; в `src/model/**` нет импортов из
  `../catalog`, кроме `import type … from '../catalog/types'` (оба — grep’ом).
- У `SceneObject` нет поля `position`: мировая поза берётся только из `resolvePose` / `usePose`; в сторе `layout`
  присваивается только внутри `dispatch`, `undo`, `redo` и `openLayout` (проверяется grep’ом по `layout:`).
- Каждый символ разделов 2.1–2.19, кроме `layoutFile.ts`, экспортируется из указанного файла с указанной сигнатурой
  (2.20, 2.21 и `layoutFile.ts` — зона W2, W1, W4). Ни в одном `.tsx` нет `JSX.Element`.
- `createLayout(lounge)` ставит мебель туда же, что этап 1: тест сравнивает `resolvePose(o).position[1]` с
  `floorAt(lounge, x, z)` для каждого предмета (кабинки оказываются на высоте подиума) — **без числовых литералов**
  координат лаунжа; все fixtures проходят `sanitizeLayout` без изменений.
- Модельные тесты (`pose`, `surfaces`, `place`, `ops`, `layers`) не импортируют `lounge` — только `testRoom`.
- `sharp` установлен (или отказ описан в отчёте); спайк указателя выполнен, его результат записан в заглушке
  `EditorOverlay.tsx`; временный код спайка удалён.

**Тесты (vitest, Node).**

- `geometry`: прежние тесты про `lounge` (нормали стен, панели помещаются, прогулка) — переписаны так, чтобы координаты
  брались из данных помещения, а не литералами; на `testRoom`: `wallSurfaces` — 4 стены + 4 грани на колонну, нормали
  граней смотрят от центра колонны, длины равны размерам; `floorAt` на подиуме и вне; `clampToRoom`; `nearestSurface` у
  каждой стены, в углу и у колонны, с фильтром `prefer` (есть подходящие → ближайшая из них; нет → ближайшая из всех); `snapTo`.
- `pose`: `resolvePose` для каждого крепления (пол на подиуме добавляет его высоту; потолок: `y = H − drop − h`; стена: спина в
  `WALL_GAP` от стены и лицо внутрь для всех четырёх стен и грани колонны; surface следует за повёрнутым хозяином);
  изменение `room.size.height` двигает только потолочные объекты; битые ссылки не бросают, `isMountBroken`;
  `clampMount` по каждому креплению; `snapMount`; `remount` floor ⇄ ceiling ⇄ wall сохраняет мировые X/Z;
  `toLocal(toWorld(p)) = p`; `describeMount` (clearance над подиумом).
- `layers`: таблица истинности `layerView`, `isGhosted`, `isPickable` (выбранный, заблокированный, скрытый);
  `backSurfaces`: камера облёта снаружи за ближней стеной → её id (и дальние грани колонны), внутри помещения → только
  дальние грани колонны, `top` / `walk` → пусто; настенный объект на такой поверхности — призрак и не выбирается, пока
  не выбран; потолочный и напольный от `back` не зависят.
- `surfaces`: `rayPlaneY` (попадание, параллель, позади); пол против верха подиума; `hitWalls` — только обращённые к лучу,
  вертикальный луч не попадает; `hitTops` на повёрнутом столе и с `exclude`.
- `place`: каждое крепление по умолчанию; настольный предмет попадает на стол под лучом; настенный — на ближайшую
  поверхность, когда луч мимо; **настенный шириной 1.5 м при луче в пол рядом с колонной встаёт на стену, а не на грань
  колонны 0.8 м**, и не на стену, обращённую к лучу изнанкой; предмет у́же грани — на колонну; `ray = null`; сдвиг
  второго одинакового объекта.
- `commands`: каждая команда; `apply(invert)` восстанавливает макет deep-equal, включая порядок (свойство-тест на случайных
  последовательностях с `createRng`); неизвестные id; повторный add; вход не мутируется; ссылки нетронутых объектов
  сохраняются; `isNoop`; `touchedIds`.
- `history`: push очищает future; склейка по `mergeKey` внутри/вне 1 с и её undo/redo возвращают исходное/конечное
  состояние; лимит 200; симметрия undo/redo.
- `ops`: `createObject` (умолчания); `clampSize`: картинка 1 × 0.75 × 0.02 с коэффициентом 0.5 → 0.5 × 0.375 × 0.02
  (`flatAxis` не тронут, пропорции точные); `free` меняет одну ось и не трогает толщину щита 0.03; `none` → prev; 0,
  отрицательное, NaN, 1000 → в пределах `[MIN_SIZE, MAX_SIZE]` и `minSize / maxSize`; uniform упирается в предел, не ломая
  пропорций. `cmdPatch`: заблокированный принимает только `locked / visible`; размер проходит `clampSize`, крепление —
  `clampMount`; **скрытие стола с фонарём** → фонарь на полу в тех же мировых X/Z, затем стол невидим, один обратимый
  шаг; surface на несуществующего, скрытого или не стоящего на полу хозяина отбрасывается; **патч, ставящий ящик с
  фонарём на стол, сначала опускает фонарь на пол** (после команды `sanitizeLayout` ничего не меняет — I2 цел).
  Удаление стола роняет детей на пол в тех же X/Z; удаление мебели площадки = скрытие, **и её дети тоже на полу**;
  заблокированные пропускаются; дубликат (новый id, имя, сдвиг, origin); `cmdSetMount` во все стороны и с детьми;
  `cmdResetVenue` (сдвинутая, скрытая, отсутствующая, устаревшая мебель; декор не тронут; предмет на столе остался на столе)
  и это один обратимый шаг; `venueDirty`; `reconcileVenue` — **предмет на устаревшем столе площадки оказывается на полу
  в своих мировых X/Z, а не в (0, 0)**; `sanitizeLayout` идемпотентна, ребёнка скрытого хозяина ставит на пол под ним.
- `migrate`: принимает результат `createLayout`; v1 → v2; NaN/Infinity, плохие цвета/id, дубликаты, неизвестный kind,
  `__proto__` в params (у результата чистый прототип), слишком много объектов; неизвестный `type` сохраняется; `onDrop`;
  `newer-version`; **настенное крепление на `'col:s'`, объекты с `type` `'light.spot'`, `'image.flat'`, `'hp.dementor'` и
  `assetId` вида `a_…` переживают `parseLayout(JSON.parse(JSON.stringify(layout)))` без единого вызова `onDrop`**;
  `surfaceId` `'col:x'` и `type` с пробелом отбрасываются.
- `lights`: предел 12, порядок макета, `reserved`, скрытые не считаются; `lightSettings` зажимает и подставляет
  умолчания; `lightDirection`: единичная длина, `tilt = 0` → вниз (потолок), вверх (пол / стол), `+Z` (стена);
  `tilt = π/2` → `+Z` (потолок, пол), вниз (стена); `effectiveAmbience`.
- `assets`: `sniffMime` для PNG/JPEG/WebP/GLB, текстового `.gltf` (с BOM и без), JSON без `asset.version`, мусора;
  `assetIdsOf`; `hashAssetId` стабилен.
- `rng`: детерминизм, границы, `shuffle` — перестановка, `valueNoise2 ∈ [0, 1]`. `color`: `shade` совпадает с этапом 1
  на трёх примерах; `mix` на концах и в середине, зажим `t`; не-hex вход возвращается как есть.
- `catalog`: id уникальны по всем наборам; у каждой записи ≥ 1 крепление и размер в пределах min/max; `resolveParams`;
  `getItem`-fallback; `checkBuild` пуст для **каждой** записи с `build` при умолчаниях (включая `barrier` — исключений
  нет); `pickBoxes` П-образного дивана оставляет середину пустой; `galleryObjects` проходят `sanitizeLayout` без изменений.
- `repository`: `MemoryRepository` — CRUD макетов, `putAsset` идемпотентен и content-addressed.
- `editorStore`: dispatch → история → undo → redo; `subscribeCommands` видит undo как `history`; remote не пишется в
  историю; **remote-команда не сбрасывает draft чужого объекта, а remote-удаление объекта убирает из draft только его**;
  `commitDraft` даёт ровно одну команду; **`commitDraft` с draft, ставящим ящик с фонарём на стол, и с draft, задающим
  размер 0, оставляет макет, который `sanitizeLayout` не меняет**; `getObjects()` слит с draft; вход в walk сбрасывает
  выбор и draft; `patchObject` зажимает крепление и размер; скрытие хозяина через `patchObject` опускает детей;
  `setBackSurfaces` с равным списком не меняет состояние; `addObject` выбирает новый объект; действия — no-op в walk.

---

### W1 — Помещение и фототекстуры (объём A + атмосфера)

**Цель.** Фото на стенах, кирпич колонн, пол, шторы, потолочные «жильцы» площадки, атмосферы.

**Файлы.** `scripts/bake-textures.mjs`, `scripts/textures.json`, `public/textures/lounge/*.jpg` (сгенерированные),
`assets-src/lounge/_debug/*` (сгенерированные), `src/texture/homography.ts`, `src/texture/homography.test.ts`,
`src/rooms/lounge.ts`, `src/scene/RoomShell.tsx`, `src/scene/roomTextures.ts`, `src/scene/Label.tsx`, `src/scene/Ambience.tsx`.
`package.json` и `node_modules` W1 **не трогает**: `sharp` и скрипт `"bake"` уже добавлены F. Если `import('sharp')` не
работает (F сообщил об отказе установки) — W1 пишет скрипт и JSON, проверяет математику тестами, а запекание оставляет
интегратору; `npm install` в параллельной фазе не выполняется.

**Можно импортировать.** `src/model/types`, `src/model/geometry`, `src/model/lights` (`AMBIENCES`, `effectiveAmbience`),
`src/model/rng`, `src/model/color`.

**Запекание.**

- `node scripts/bake-textures.mjs [room] [--only id] [--debug]`. Скрипт импортирует напрямую `../src/texture/homography.ts`
  и `../src/rooms/<room>.ts` (экспорт `const <room>: RoomDef`; в файле помещения только `import type`, поэтому Node
  снимает типы без сборки — так же, как у `homography.ts`).
  sharp используется для запекания только так: `sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })` и
  `sharp(buf, { raw: { width, height, channels: 3 } }).jpeg({ quality, mozjpeg: true }).toFile(out)`; ещё один вызов
  разрешён **только в `--debug`** (см. ниже).
- `scripts/textures.json`:
  ```json
  { "version": 1,
    "rooms": { "lounge": { "srcDir": "assets-src/lounge", "outDir": "public/textures/lounge", "textures": [
      { "id": "banner", "src": "1.jpg", "quad": [[488,265],[921,297],[920,522],[488,538]],
        "panel": "banner", "fill": "#c9c5c0", "gain": [1, 1, 1], "quality": 82 },
      { "id": "column-sign", "src": "6.jpg", "quad": [[872,40],[1040,22],[1022,800],[862,775]],
        "column": "col-left:w" }
    ] } } }
  ```
  `quad` — пиксели исходного фото в порядке верх-лево → верх-право → низ-право → низ-лево **прямоугольника стены, который
  изображает панель**; точки могут лежать вне кадра. **Метрические размеры в JSON не дублируются** (решение
  пользователя 4 — размеры помещения правятся в одном месте): скрипт берёт их из определения помещения —
  `"panel": "<id панели>"` → `[panel.width, panel.height]`; `"column": "<id колонны>:<грань>"` →
  `[длина грани, room.size.height]`. Ровно один из ключей `panel` / `column` обязателен; неизвестный id → ошибка с
  перечнем допустимых. Необязательный `"metres": [w, h]` перекрывает размеры из помещения (запасной путь, если импорт
  `.ts` перестанет работать). Размер результата — `outputSize(quad, metres, 2048, 1.25)`; скрипт предупреждает, если
  вышло меньше 60 px/м. После правки размеров панели в `lounge.ts` достаточно перезапустить `npm run bake`.
- `--debug` пишет в `assets-src/<room>/_debug/`: `<фото>.jpg` со всеми квадами (обводка и подпись id) и `<id>.jpg` с
  результатом. Обводку и подписи рисует сам sharp одним SVG-слоем — единственный дополнительный вызов:
  `sharp(src).composite([{ input: Buffer.from(svg) }]).jpeg().toFile(out)`, где `svg` содержит по `<polygon>` и
  `<text>` на квад (своего растеризатора шрифтов не пишем). Цикл настройки: правка JSON → запуск → просмотр → правка.
- Правило: **один квад = одна панель `photo` (или грань колонны) = один JPEG**. Чтобы затекстурить часть стены — заведите
  панель на эту часть. Заслонённое мебелью не выпрямляется: панель режется по свободной области (мурал начинается от
  линии спинок диванов, под ним остаётся существующая одноцветная панель `mural-base`).
- Стартовые квады (грубые, уточнить через `--debug`). Колонка «размер панели» — то, что W1 записывает в `lounge.ts`
  (в JSON этих чисел нет):

  | id | фото | quad TL, TR, BR, BL | цель | размер панели в `lounge.ts`, м |
  |---|---|---|---|---|
  | `mural` | 4 | (152,30) (1050,112) (1047,432) (152,452) | `panel: mural` — дальняя стена, bottom 1.0 | 9.7 × 1.9 |
  | `mona` | 4 | (1117,127) (1250,140) (1247,300) (1115,292) | `panel: mona` — дальняя стена, над гардеробом | 1.3 × 1.2 |
  | `banner` | 1 | (488,265) (921,297) (920,522) (488,538) | `panel: banner` — ближняя стена | 2.2 × 1.15 |
  | `smoke-door` | 1 | (193,372) (378,378) (378,728) (197,738) | `panel: smoke` — ближняя стена | 1.0 × 2.1 |
  | `collage-right` | 5 | (862,307) (1005,300) (1005,470) (862,478) | `panel: collage-right` — правая стена | 1.8 × 1.5 |
  | `collage-left` | 6 | (176,228) (352,236) (352,500) (176,506) | `panel: collage-left` — левая стена | 1.7 × 1.4 |
  | `red-bar` | 6 | (478,215) (645,222) (640,600) (478,605) | `panel: red-bar-photo` — левая стена, вывеска и дверь (новая панель `photo`) | 1.4 × 3.0 |
  | `column-sign` (по желанию) | 6 | (872,40) (1040,22) (1022,800) (862,775) | `column: col-left:w` (грань уточнить по фото) | из колонны и высоты помещения |

**`RoomShell`.**

- `panel.texture` → собственный загрузчик `usePanelTexture(path)` без Suspense, URL = `import.meta.env.BASE_URL + path`,
  sRGB, anisotropy 8. Пока не загрузилось или 404 — панель остаётся одноцветной (один `console.warn`); после загрузки
  `map` ставится, `color` становится белым. Материал остаётся `meshStandardMaterial` (фото темнеют в «Вечеринке»).
- Колонны: **бокс этапа 1 остаётся** (цвет `column.color`, `castShadow` / `receiveShadow`) — у колонны есть верхняя
  грань, она видна на плане и в облёте сверху и совпадает с тем, как её учитывает выбор мышью (`columnDistance`: сплошной
  заслоняющий объём). Грани, описанные в `column.faces`, рисуются **поверх** бокса плоскостями на 2 мм перед гранью
  (`wallSurfaces` даёт их рамки; 2 мм < `WALL_GAP`, декор на колонне остаётся перед ними): грань `brick` — процедурная
  кладка (canvas 512², ложковая перевязка, кирпич 25 × 6.5 см, разброс цвета вокруг `#9a4a35`, серый шов, тайлится,
  `repeat` по размеру грани); грань с `texture` — запечённый JPEG. Грани без описания — просто краска бокса.
- Пол `floorSurface: 'terrazzo'` — процедурная крошка 1024² (бежевая основа `floorColor`, тёмная и светлая крошка,
  повтор каждые 2 м) + две тёмные полосы-вставки, видимые на фото 3 и 6 (тонкие плоскости на 2 мм над полом).
- Шторы (`kind: 'curtain'`): плоскость с 48 сегментами по ширине, складки — смещение **только от стены в комнату**,
  `0…+1.5 см` от плоскости панели (`0.0075·(1 + sin)`, шаг складки ≈ 0.18 м): гребень складки на
  `PANEL_GAP + 0.015 = 0.027 м` от стены, то есть ближе `WALL_GAP = 0.03` — плакат или картинка, повешенные поверх
  шторы, не тонут в складках. Объём дорисовывает canvas с вертикальными светло-тёмными полосами, умноженный на цвет панели.
- Потолок — та же односторонняя плоскость, что сейчас. На мешах помещения **нет** обработчиков указателя.
- Все процедурные текстуры живут в `src/scene/roomTextures.ts`, создаются один раз и освобождаются при размонтировании.

**`src/rooms/lounge.ts`.** Добавить: `name` стен («Дальняя стена», «Правая торцевая», «Ближняя стена», «Левая торцевая») и
колонн; `faces` колонн по фото (кирпич на гранях, обращённых к торцам зала, краска на остальных — уточнить по фото 3 и 6);
`floorSurface: 'terrazzo'`; `texture` панелей и новые панели под квады; `washes` — четыре красных прожектора `#ff1a1a`, 60 кд,
полуугол 0.7 рад: `[−2.25, 2.9, 0.45] → [−3.0, 0, 2.2]`, `[2.15, 2.9, 0.45] → [3.0, 0, 2.2]`,
`[−8.3, 2.6, 1.5] → [−6.5, 0, 0.5]`, `[7.9, 2.7, −1.2] → [6.2, 0, 0.2]`; потолочные объекты площадки (`origin: 'venue'`,
крепление `ceiling`, на глаз по фото 3 и 4): `duct` вдоль линии колонн (≈ 15 × 0.45 × 0.5 м, `z ≈ −0.6`, drop 0.05),
3–4 группы `pendantBulbs` (между колоннами и у длинных стен, drop 0), `projector` перед муралом (drop 0.35).
Все размеры по-прежнему правятся только в этом файле; скрипт запекания читает размеры панелей и колонн отсюда же.
В файле остаются только `import type` и экспорт `const lounge: RoomDef` (его импортирует Node-скрипт).

**`Ambience`.** Рисует `AMBIENCES[effectiveAmbience(ambience, mode)]`: `<color attach="background">`, ambient, hemisphere,
направленный свет с тенями (как в этапе 1: без теней на плане), `gl.toneMappingExposure`; при `washes` — по одному
`<spotLight>` на `room.washes` (`penumbra 0.6`, `distance 9`, `decay 2`, без теней, цель — отдельный `Object3D`).

**Критерии приёмки.**

- `npm run bake` создаёт JPEG’и из таблицы (суммарно < 1.5 МБ); `npm run bake -- --debug` создаёт отладочные картинки
  (скрипт — Node, не dev-сервер, запускать можно; если `sharp` не установлен — пункт переходит к интегратору).
- `src/texture/homography.ts` не содержит импортов; `src/rooms/lounge.ts` содержит только `import type`; `tsc` чист.
- В `scripts/textures.json` нет метрических размеров, кроме необязательного `metres`; каждая запись ссылается на
  существующую панель или грань колонны (скрипт падает с понятной ошибкой на неизвестном id).
- В `RoomShell.tsx` нет `onPointer*` / `onClick`; при отсутствии файла текстуры панель одноцветная (читается по коду
  загрузчика); колонна — бокс с верхней гранью плюс плоскости граней; смещение складок штор не превышает 1.5 см.
- `lounge.ts`: тесты `geometry.test.ts` («панели помещаются на стенах») проходят; все fixtures проходят
  `sanitizeLayout(createLayout(lounge), lounge)` без изменений (проверяется существующим тестом F и сквозным тестом
  интегратора); потолочные fixtures имеют `mount.kind === 'ceiling'` и существующие `type` из набора `basic`.
- `Ambience` не создаёт теней в `party` и на плане; число `spotLight` = `reservedLights(...)`.
- Как выглядят текстуры, шторы и атмосферы в приложении, проверяет интегратор (правило 3); W1 смотрит только
  отладочные JPEG’и скрипта.

**Тесты.** `homography.test.ts`: тождественный квад; 4 угла отображаются точно; известная проективная деформация
восстанавливается с точностью 1e-6; вырожденный квад бросает; `rectify` синтетической шахматной доски воспроизводит доску
(погрешность ≤ 2 уровней); осевой квад = обычная обрезка; `outputSize` — пропорции и пределы; вне кадра — `fill`; `gain`.

---

### W2 — Взаимодействие во вьюпорте (объём B: выбор, перетаскивание, гизмо, клавиши)

**Цель.** Выбор кликом, перемещение по своей поверхности, ручки поворота/размера/опуска, направляющие для потолка,
горячие клавиши, снимок. В режиме прогулки ничего из этого не активно.

**Файлы.** `src/editor/EditorOverlay.tsx`, `PointerController.tsx`, `Gizmo.tsx`, `Guides.tsx`, `ViewProbe.tsx`, `Hud.tsx`,
`shortcuts.ts`, `constants.ts`, `viewRay.ts`, `pick.ts`, `drag.ts`, `handles.ts`, `editor.css`, `pick.test.ts`, `drag.test.ts`,
`handles.test.ts`; `src/scene/controls/CameraModes.tsx`.

**Можно импортировать.** `src/model/*` (в т. ч. `testRoom` — в тестах, `clampSize` / `MIN_SIZE` из `ops`),
`src/catalog/{index,bounds,types}`, `src/store/{editorStore,selectors,actions,bridge}`.
Из W3 — ничего: контуры и ручки строятся из поз и размеров, а не из мешей.

**Спайк Р6 уже выполнен в F.** Его результат записан комментарием в начале заглушки `src/editor/EditorOverlay.tsx`:
достаточно ли `controls.enabled = false` или нужно дополнительно переключать `enableRotate / enablePan`. W2 реализует
указанный вариант; браузер и dev-сервер пакету не нужны и не используются (правило 3).

**Поток событий указателя** (`PointerController`, монтируется только при `mode !== 'walk'`):

```
div-обёртка Canvas (= useThree(s => s.events.connected); OrbitControls слушает его же в фазе всплытия)
  ▲ слушатели в фазе CAPTURE
pointerdown  1. только button 0, pointerType mouse|pen, не capturing
             2. ray = viewRay(event)                     (Raycaster.setFromCamera — годится для обеих камер)
             3. цель = ручка выбранного объекта (pickHandle) → иначе объект (pickObjects + choosePick) → иначе ничего
             4а. ручка или объект: controls.enabled = false; el.setPointerCapture(id); состояние 'handle' | 'pending'
             4б. ничего: запомнить точку и НЕ трогать событие → OrbitControls вращает / двигает камеру
pointermove  pending → 'moving', когда указатель ушёл дальше DRAG_THRESHOLD_PX
             moving / handle → setDraft({ [id]: patch })           (не чаще раза за кадр, через requestAnimationFrame)
             без нажатых кнопок → hover: pickObjects → setHovered + cursor
pointerup    pending → только select(id)
             moving / handle → commitDraft(label); controls.enabled = true   (commitDraft сам проводит draft через cmdPatch)
             путь 4б и сдвиг < DRAG_THRESHOLD_PX → select(null)     (клик по пустому месту снимает выбор)
Escape / pointercancel / blur → setDraft(null); controls.enabled = true
```

`controls` берётся из `useThree(s => s.controls)` (тип `EventDispatcher | null`, приводится к `{ enabled: boolean }`).
Заблокированный выбранный объект не имеет ручек и не двигается. Подписи шагов: «Перемещение», «Поворот», «Размер», «Опуск».

| Левая кнопка | по объекту | по пустому месту |
|---|---|---|
| Облёт | двигает объект (и выбирает его) | вращает камеру |
| План | двигает объект | двигает план |
| Прогулка | осмотр (слушатели `WalkMode`) | осмотр |

**Выбор (`pick.ts`).** `pickable = o => isPickable(o, getLayerView(), getBackSurfaces(), selectedId)`. Попадания дальше
ближайшей колонны отбрасываются (колонны заслоняют; отсечённые стены и потолок — нет: сквозь них видно, значит сквозь них
и кликается). Декор на отсечённой поверхности — потолочный при виде сверху и настенный на стене, повёрнутой к камере
изнанкой, — не выбирается, пока не выбран (клики проходят сквозь него к тому, что в зале): это решает `isPickable`, в
`pick.ts` своей логики для этого нет. Среди оставшихся побеждает **ближайшее** попадание (`choosePick`); выбранный объект
выигрывает только при разнице ≤ `PICK_TIE`.
`minThickness(distance)` = `PICK_MIN_PX × unitsPerPixel`: тонкие баннеры, нити и настенные плакаты на плане остаются
кликабельными. `unitsPerPixel`: `1 / camera.zoom` для ортографической камеры, `2·distance·tan(fov/2) / высота_вьюпорта`
для перспективной.

**Перемещение (`resolveMove`).** Тип крепления при перетаскивании не меняется, кроме `floor ⇄ surface`.

- `ceiling`: `p = rayPlaneY(ray, s.baseY)`; `(x, z) = p.xz + s.offset`; `drop` прежний.
- `wall` — два пути, выбранные один раз в `beginMove` (`s.wallVia`), чтобы объект не «прыгал» посреди жеста:
  - `'hit'` (луч в начале попал в лицевую сторону поверхности самого объекта): ближайшее `hitWalls(ray)`:
    `along = hit.along + s.offset[0]`, `bottom = hit.y + s.offset[1]` (поверхность может смениться, включая грани
    колонн). Нет попадания → `null`.
  - `'floor'` (план; либо объект на отсечённой стене, взятый «со спины» — `hitWalls` возвращает только лицевые
    поверхности и его собственную не видит; либо скользящий луч): `fp = rayPlaneY(ray, 0)` (только при `dir.y < 0`,
    иначе `null`), поверхность = `nearestSurface(fp)`, `along` = проекция `fp` на неё `+ s.offset[0]`, `bottom` прежний.
    Объект остаётся на своей стене, пока курсор ведут вдоль неё, и переходит на другую, когда точка пола оказывается
    ближе к ней. **Противоположная стена «по лучу» никогда не выбирается** — телепортации через зал нет.
- `floor` и `surface`:
  1. если `getItem(start.type).mounts` содержит `'surface'` **и на самом объекте никто не стоит**
     (`childrenOf(env.ctx.objects, s.id).length === 0`; хозяин с детьми остаётся на полу — иначе нарушился бы I2):
     для каждой опоры `h` (`isSupport`, не сам объект):
     `q = rayPlaneY(ray, верх h)`; `c = q.xz + s.offset`; `(u, v) = toLocal(pose(h), [c.x, верх, c.z])`; если
     `|u| ≤ W/2` и `|v| ≤ D/2` — кандидат. Ближайший по `|q − origin|` кандидат → `{ kind: 'surface', hostId, u, v }`,
     `rotationY = мировой угол − угол хозяина`;
  2. иначе, если `mounts` содержит `'floor'`: если объект в начале стоял на полу — `q = rayPlaneY(ray, s.baseY)`
     (плоскость на высоте захвата: нет скачка от параллакса), иначе (съезжает со стола) — `q = hitFloor(ray).point`;
     `(x, z) = q.xz + s.offset` → `{ kind: 'floor', x, z, lift }` (`lift` — прежний, если стоял на полу, иначе 0),
     `rotationY` = мировой угол; `q = null` → `null`;
  3. иначе (только настольный предмет вне опор) → `null`.
- В конце: `snapMount(env.grid ?? 0.01)` → `clampMount`. Столкновений между объектами нет.

**Ручки (`handlesFor`).** Мировые точки постоянного экранного размера (`HANDLE_PX`), рисуются с `depthTest={false}` и
высоким `renderOrder`, выбираются аналитически. Изменение размера симметрично относительно центра по X/Z и растёт от
основания по Y (у потолочного — вниз от верха, т. к. `drop` не меняется) — крепление при этом не трогается, только `clampMount`.

| Ручка | Когда есть | Локальное положение | Математика |
|---|---|---|---|
| `rotate` | крепление не `wall` | `[0, 0, d/2 + 0.35]` | `p = rayPlaneY(ray, y ручки)`; угол = `atan2(p.x − c.x, p.z − c.z)`; привязка 15° |
| `resize-w` | `resize: 'free'` | `[w/2, h/2, 0]` | `t = closestOnAxis(ray, центр, локальная X)`; `w = 2·abs(t)` |
| `resize-d` | `'free'`, не `wall` | `[0, h/2, d/2]` | `d = 2·abs(t)` по локальной Z |
| `resize-h` | `'free'`, не план | `[0, h, 0]`; потолок: `[0, 0, 0]` | по вертикали: пол/стена/стол `h = y − низ`; потолок `h = верх − y` |
| `resize-uniform` | `resize: 'uniform'` | `[w/2, h, d/2]`; потолок: `[w/2, 0, d/2]` | якорь — центр основания (потолок — центр верха); `k` = проекция ближайшей к лучу точки на прямую якорь→ручка / исходная длина; дальше — правило `resolveResize` (2.20): округляется только наибольшая сторона, остальные выводятся из `k` в `clampSize`, ось `flatAxis` не меняется |
| `drop` | крепление `ceiling`, не план | `[0, −0.15, 0]` | `y` ближайшей точки вертикали; `drop = H − (y + 0.15) − h`, зажим `[0, H − h]` |

Вырожденные случаи (луч почти параллелен оси) возвращают `null`, кадр пропускается — поэтому вертикальных ручек нет на плане.
Ручек `resize-w / -d / -h` по оси `item.flatAxis` нет. Пределы размера и сохранение пропорций — только через
`clampSize` (F); своих `MIN_SIZE / MAX_SIZE` и своей версии «uniform» в пакете нет. Привязка `SIZE_STEP` касается одной —
перетаскиваемой — оси: толщина 0.02–0.03 м у картинок и щитов при изменении ширины не округляется и не «раздувается».

**Оверлеи (`Gizmo`, `Guides`).** Скрыты при `capturing`.

- Выбранный объект — ориентированный каркас габаритного бокса (заблокированный — серый, скрытый — пунктир); наведённый —
  тонкий светлый каркас. Пост-обработки нет: бокс одинаково работает для частей, GLB, картинок и ламп.
- Потолочный выбранный объект: пунктирный отвес от центра низа до пола + прямоугольник-проекция на полу; при
  `layerView === 'ceiling'` — бледная сетка 0.5 м на высоте потолка.
- `gridSnap` включён → сетка на полу: линии 1 м (каждые 10 см — тонкие, только на плане при крупном масштабе), `y = 0.005`.

**`ViewProbe`.** Один `useFrame`: `isViewFromAbove(mode, camera.position.y, room.size.height)` → `setViewFromAbove`
только при смене значения; `backSurfaces(mode, camera.position, surfaces)` → `setBackSurfaces` (стор сам отбрасывает
равный список; `surfaces = wallSurfaces(room)` считается один раз в `useMemo`, в `top` / `walk` список пуст).

**`EditorOverlay`.** Всегда: `ViewProbe` и регистрация `ViewportBridge` (`centerRay` — луч через NDC (0, 0); `capturePng` —
см. 2.17; снимок работает и в прогулке). При `mode !== 'walk'`: `PointerController`, `Gizmo`, `Guides`.

**`Hud`.** Статичная строка-подсказка в подвале, по режиму камеры:
облёт «Клик — выбрать · тянуть объект — двигать · тянуть фон — вращать · правая кнопка — сдвиг · колесо — масштаб»;
план «Клик — выбрать · тянуть объект — двигать · тянуть фон — сдвиг плана · колесо — масштаб»;
прогулка — текст этапа 1. Живых чисел перетаскивания в подвале нет: их уже показывает панель свойств (её поля читают
объект, слитый с `draft`, — координаты, опуск от потолка, «низ на высоте», размер и угол меняются по ходу жеста).

**Клавиши (`useShortcuts`)** — по `event.code`; игнорируются, когда фокус в input / textarea / select / contenteditable;
все изменяющие — в режиме прогулки не работают. Набор — ровно объём B; сдвига стрелками и поворота клавишей нет
(точные значения вводятся в панели свойств).

| Клавиши | Действие |
|---|---|
| `Ctrl/Cmd+KeyZ` · `Ctrl/Cmd+Shift+KeyZ`, `Ctrl+KeyY` | undo · redo |
| `Delete`, `Backspace` | `deleteObject(selectedId)` |
| `Ctrl/Cmd+KeyD` | `duplicateObject` (с `preventDefault` — иначе закладка браузера) |
| `Escape` | отменить текущее перетаскивание, иначе снять выбор |
| `KeyG` | привязка к сетке вкл/выкл |

**`CameraModes.tsx`.** `OrbitMode`: `maxPolarAngle = 1.75` (≈ 100°), чтобы изнутри можно было смотреть на потолочный декор
снизу; в `onChange` камера не опускается ниже `y = 0.3`. `TopMode` и `WalkMode` — без изменений поведения.

**Критерии приёмки.**

- В `src/editor/{pick,drag,handles}.ts` нет импортов `three` / `react`; `tsc` чист; тесты пакета зелёные.
- Ни в одном файле пакета нет обработчиков R3F (`onPointerDown=` и т. п.) на объектах сцены и нет `TransformControls`.
- В `PointerController` слушатели вешаются с `{ capture: true }` и снимаются в очистке эффекта; `controls.enabled`
  возвращается в `true` на всех путях выхода (pointerup, cancel, Escape, размонтирование).
- За одно перетаскивание вызывается ровно один `commitDraft` (читается по коду); при `mode === 'walk'` контроллер не смонтирован.
- Реализован вариант перехвата, указанный в комментарии спайка F; `src/editor/constants.ts` не содержит `MIN_SIZE` /
  `MAX_SIZE`; в пакете нет собственного зажима размера — только `clampSize`.
- Поведение в браузере (камера не двигается при перетаскивании, призраки, перетаскивание «со спины») проверяет
  интегратор; пакет сдаётся по `tsc`, тестам и чтению кода.

**Тесты** (помещение — `testRoom`, не `lounge`).

- `pick`: `rayBox` (внутри, мимо, касание, раздувание тонкого бокса); ближайший побеждает; **фонарь на выбранном столе
  выбирается, а не стол; стол внутри выбранной кабинки выбирается**; выбранный побеждает только при разнице расстояний
  ≤ `PICK_TIE`; заблокированные / скрытые / призраки пропускаются; **настенный объект на поверхности из `back` не
  выбирается и не заслоняет то, что за ним, а будучи выбранным — выбирается**; колонна заслоняет; стол внутри кабинки
  выбирается сверху; сквозь «дырку» объекта, чьи боксы выбора — четыре полосы рамки, выбирается то, что за ним (тестовый
  объект с заданными боксами; от W6 тест не зависит).
- `drag`: пол — смещение захвата сохраняется, нет скачка в первый кадр; въезд на подиум поднимает позу на его высоту;
  фонарь над столом → `surface` с верными `u, v`, со стола → пол; предмет без `'surface'` в `mounts` игнорирует столы;
  **ящик, на котором стоит фонарь, игнорирует столешницы и остаётся на полу; тот же ящик без детей встаёт на стол**;
  настенный: скольжение, переход на соседнюю стену и на грань колонны, на плане — ближайшая поверхность без скачка в
  первый кадр, со стен не уходит; **настенный объект на ближней стене, взятый лучом снаружи (со спины): `wallVia ===
  'floor'`, первый `resolveMove` оставляет его на той же стене (сдвиг `along` < 1 см), на противоположную стену он не
  перескакивает**; потолочный остаётся потолочным и игнорирует столы, `drop` сохраняется; сетка вкл/выкл; зажим в помещении.
- `handles`: состав ручек по креплению и режиму (нет вертикальных на плане, нет `rotate` и `resize-d` на стене, нет
  ручки по `flatAxis`); поворот с привязкой 15° и относительный угол для `surface`; ширина симметрична; высота
  потолочного объекта держит верх; `drop` зажат в `[0, H − h]`; **картинка 1 × 0.75 × 0.02, уменьшенная вдвое
  uniform-ручкой при включённой сетке, даёт 0.5 × 0.375 × 0.02; ручка ширины щита 1.5 × 1.0 × 0.03 не меняет `d`**;
  округляется только перетаскиваемая ось; min/max — через `clampSize`; параллельный луч → `null`.

---

### W3 — Рендер объектов, пользовательские файлы, лампы (объём C)

**Цель.** Один универсальный рендерер `Part[]`, картинки, модели GLB / glTF, лампы, призраки декора на отсечённых
поверхностях (потолочного при виде сверху, настенного при виде со спины), загрузка файлов.

**Файлы.** `src/scene/SceneObjects.tsx`; `src/scene/objects/ObjectView.tsx`, `PartsBody.tsx`, `partGroups.ts`,
`partGroups.test.ts`, `geometryCache.ts`, `geometryCache.test.ts`, `materialCache.ts`, `textureCache.ts`, `ImageBody.tsx`,
`ModelBody.tsx`, `LightBody.tsx`, `Placeholder.tsx`; `src/assets/AssetShelf.tsx`, `importAsset.ts`, `assetCache.ts`,
`gltf.ts`, `gltf.test.ts`, `assets.css`.

**Можно импортировать.** `src/model/*`, `src/catalog/{index,types}`, `src/store/{editorStore,selectors,actions}`,
`repository` из `src/persistence/index`, `assetUsage` из `src/persistence/session`. Из W2 — ничего (`GHOST_OPACITY` лежит в `src/model/layers`).

**Внутренние чистые контракты.**

```ts
// partGroups.ts (можно импортировать математику three: Matrix4, Euler — она работает в Node)
import type { Part } from '../../catalog/types';
/**
 * 'box' | 'plane' | `cylinder:${taper}` | `torus:${t/D, 2 знака}` |
 * 'sphere' (без paint либо look 'matcap') | 'sphere:uv' (с paint: нужна аккуратная развёртка).
 */
export function geometryKey(part: Part): string;
/** Всё, что влияет на материал, КРОМЕ color (цвет идёт в instanceColor): look, emissive, roughness, opacity, additive, doubleSided, cutout, paint, ghost. */
export function materialKey(part: Part, ghost: boolean): string;
export interface PartGroup { geometryKey: string; materialKey: string; parts: Part[] }
export function groupParts(parts: readonly Part[], ghost: boolean): PartGroup[];
/** 16 чисел по столбцам: position · rotation (Эйлер XYZ) · scale, где scale отображает единичную геометрию в size части. */
export function partMatrix(part: Part): number[];

// geometryCache.ts (three; геометрии создаются в Node без WebGL — модуль тестируется vitest)
import type { BufferGeometry } from 'three';
/** Единичная геометрия-синглтон по geometryKey(part). Раскладка UV — по договору Part.paint (2.14). */
export function getGeometry(key: string): BufferGeometry;

// src/assets/gltf.ts — чистый, без three
export interface GltfInfo {
  ok: boolean;
  /** Русский текст для пользователя, когда ok === false. */
  error?: string;
  container: 'glb' | 'gltf';
  /** asset.version из JSON ('2.0'). */
  version?: string;
  extensionsUsed: string[];
  extensionsRequired: string[];
  /** buffers[].uri и images[].uri, не начинающиеся с 'data:'. */
  externalUris: string[];
}
/**
 * GLB: читает заголовок (сигнатура 'glTF', версия контейнера 2) и JSON-чанк. Текстовый .gltf: JSON.parse всего файла.
 * ok === false, если: не разбирается / asset.version не '2.x' → «Это не файл glTF 2.0»;
 * 'KHR_draco_mesh_compression' есть в extensionsUsed ИЛИ в extensionsRequired → «Модель сжата Draco — пересохраните
 * без сжатия» (GLTFLoader создаёт расширение уже по extensionsUsed и падает без DRACOLoader);
 * externalUris не пуст → «Модель ссылается на соседние файлы — сохраните её одним файлом .glb».
 */
export function inspectGltf(buffer: ArrayBuffer): GltfInfo;
/** Размер нового объекта по габаритам модели: родной, если все стороны в [0.05, 6] м, иначе масштаб до 1 м по наибольшей стороне. */
export function defaultModelSize(naturalSize: Vec3): { size: Vec3; rescaled: boolean };

// src/assets/importAsset.ts
/** Проверяет, нормализует, сохраняет через repository.putAsset, обновляет store.assets. Бросает Error с русским текстом для пользователя. */
export function importAsset(file: File): Promise<AssetMeta>;

// src/assets/assetCache.ts — кэши со счётчиком ссылок; освобождение через 5 с после последнего release (переживает undo/redo и перемонтирование)
export function useImageTexture(assetId: string | null): { texture: THREE.Texture | null; status: 'loading' | 'ready' | 'missing' };
export function useModelScene(assetId: string | null): { scene: THREE.Object3D | null; status: 'loading' | 'ready' | 'missing' | 'error' };
export function useAssetUrl(assetId: string): string | null;     // object URL для миниатюр
```

**Поведение.**

- `SceneObjects`: `useObjectIds().map(id => <ObjectView key={id} id={id} />)`.
- `ObjectView({ id })`: `o = useObject(id)`, `pose = usePose(id)`; `!o.visible` → `null`.
  `ghost = useIsGhosted(id)` (= `isGhosted(o, layerView, backSurfaceIds, selectedId)`: потолочный объект при виде
  сверху **или** настенный объект на стене / грани колонны, повёрнутой к камере изнанкой; выбранный — никогда). Структура:
  ```
  <group position={pose.position} rotation-y={pose.rotationY}>     ← при перетаскивании меняется только это
    primitive | preset → <PartsBody/>     image → <ImageBody/>     model → <ModelBody/>     light → <LightBody/>
    неизвестный type (!hasItem) или нет файла → <Placeholder/> (пунктирный бокс size с «?»)
    крепление ceiling, drop > 0.03, item.hanger !== false → нить: цилиндр Ø 3 мм от [0, h, 0] до [0, h + drop, 0], #d8d8d8
    ghost, крепление ceiling → контур верхней грани (LineLoop w × d на y = h)
    ghost, крепление wall    → контур спинки (LineLoop w × h в плоскости z = −d/2)
  </group>
  ```
  Призрак настенного объекта: все его материалы получают вариант `ghost` **и становятся двусторонними** — односторонние
  листы (стена газет, картинка) со спины иначе не видны вовсе, а так на ближней стене остаётся бледный силуэт с
  контуром, который не заслоняет зал. Тёмная подложка `image` и бокс `panel` в призраке так же прозрачны на 30 %.
  Компонент мемоизирован; `applyCommand` сохраняет ссылки нетронутых объектов → перетаскивание перерисовывает один компонент.
- `PartsBody`: `partsOf(o)` → `groupParts` → по одному `<instancedMesh args={[geometry, material, n]}>` на группу; матрицы
  и `instanceColor` пишутся один раз в `useLayoutEffect`, затем `computeBoundingSphere()`. Не использовать drei `<Instances>`.
  Пересборка только при смене `type / size / color / params / mount.kind`, не при перемещении.
- `geometryCache`: единичные геометрии — синглтоны модуля по `geometryKey` (box 1³; `sphere` — `IcosahedronGeometry(0.5, 2)`
  для однотонных и matcap-сфер (облака: 320 треугольников на штуку); `sphere:uv` — `SphereGeometry(0.5, 20, 12)` для сфер
  с `paint`; plane 1×1; cylinder радиус 0.5, высота 1, 20 сегментов, верх `0.5·taper`; torus с внешним диаметром 1).
  **Договор о развёртке (2.14) выполняется здесь, один раз при создании:** у стандартного `CylinderGeometry` шов
  `u = 0/1` смотрит в +Z, у `SphereGeometry` в +Z смотрит `u = 0.25` — поэтому геометрия цилиндра поворачивается
  `rotateY(Math.PI)`, а `sphere:uv` — `rotateY(-Math.PI / 2)`: после этого `u = 0.5` (центр canvas) приходится на
  локальный +Z, `u` растёт от −X к +X при взгляде спереди. Рожица мандрагоры и крапины совы оказываются спереди, а не на затылке.
- `materialCache`: `getMaterial(part, ghost)` по `materialKey`, общий для всех объектов. Вариант `ghost`: тот же материал,
  `transparent`, `opacity × GHOST_OPACITY`, `depthWrite: false`, `side: DoubleSide` (всегда — и для потолочных, и для
  настенных призраков), `renderOrder` выше сплошных. `cutout` → `alphaTest 0.5`.
- `textureCache`: `getTexture(paint)` — canvas `px`, `getPainter(paint.painter)` → `CanvasTexture` (sRGB, anisotropy 4);
  LRU на 96 записей с `dispose()` (текстовые параметры иначе плодят текстуру на каждое нажатие). Неизвестный painter →
  однотонная текстура и один `console.warn`.
- Тени: часть отбрасывает тень, если `look` = `'lit'`, не `additive`, `opacity` не задан, а объект не на потолке
  (облачный потолок не должен затемнять зал в рабочем свете). Принимают тень все `'lit'`-части.
- `ImageBody`: текстура — `TextureLoader.loadAsync(objectURL)`, sRGB, anisotropy 8. `image`: стена — плоскость w × h
  + тёмная подложка 1 см; пол — та же плоскость на двух ножках с подкосом; потолок — двусторонняя плоскость и две нити от
  верхних углов до потолка; стол — как пол без подкоса. `image.flat`: плоскость w × d горизонтально (лицом вверх, под
  потолком — вниз). PNG/WebP → `alphaTest 0.5` без подложки. `params.glow` → `MeshBasicMaterial`, `toneMapped: false`.
- `ModelBody`: `GLTFLoader` из `three/addons/loaders/GLTFLoader.js` + `MeshoptDecoder` из
  `three/addons/libs/meshopt_decoder.module.js`, `parseAsync(buffer, '')` в `try/catch` — один и тот же вызов для `.glb`
  и текстового `.gltf` (загрузчик сам различает их по сигнатуре `glTF`); `LoadingManager.setURLModifier`
  обнуляет любой URL, кроме `blob:` / `data:`. Одна разобранная сцена на файл в кэше, по клону на объект
  (`SkeletonUtils.clone`), анимации игнорируются. Нормировка: `group(scale = size / naturalSize) >
  group(position = [−cx, −minY, −cz]) > primitive`. Призрак — клонированные на экземпляр материалы с прозрачностью.
- `LightBody`: `s = lightSettings(o, buildInput(o).params)`; маркер (банка/лампочка с `glow`-линзой цвета света; тусклый,
  если лампа не активна; скрыт в прогулке и при `capturing`); если `useActiveLightIds().has(o.id)` — `<pointLight>` /
  `<spotLight>` с `castShadow={false}`, `decay={2}`. Источник — в центре габарита `[0, h/2, 0]`; цель спота —
  `Object3D`-сосед внутри группы объекта в точке `источник + lightDirection(o.mount.kind, s.tilt)` (2.12) — своих
  формул наклона в компоненте нет; линза маркера смотрит туда же.
- `importAsset`: тип только по `sniffMime` (не по расширению и не по `file.type`). Картинки: > `imageBytes` — отказ;
  сторона > 2048 — уменьшение (с альфой остаётся PNG, иначе JPEG 0.85); измерить `width / height`. Модели
  (`model/gltf-binary` и `model/gltf+json`): > `modelBytes` — отказ; `inspectGltf` — при `ok === false` бросается его
  `error` (не glTF 2.0; Draco в `extensionsUsed` или `extensionsRequired`; внешние файлы → «сохраните её одним файлом
  .glb»); после разбора — габариты (`Box3().setFromObject`) в `naturalSize`, > 300 тыс. треугольников — предупреждение.
  `AssetShelf` принимает `.glb, .gltf, .png, .jpg, .jpeg, .webp`.
- `AssetShelf` («Мои файлы», внизу библиотеки): кнопка «Загрузить…» и зона перетаскивания файлов; сетка миниатюр
  `store.assets`. Картинка: кнопки «На стену» (`addObject(getItem('image'), { assetId, name, size: [1, 1·h/w, 0.02] })`) и
  «Плашмя» (`image.flat`, `size: [1, 0.02, 1·h/w]`). Модель: «Добавить» (`model`, `size = defaultModelSize(naturalSize).size`).
  «Удалить файл»: `assetUsage(id)` — если список не пуст, отказ с перечислением макетов; иначе `repository.removeAsset` +
  `setAssets`. Ошибки — `notify('error', …)`.

**Критерии приёмки.**

- Ни в одном файле пакета нет обработчиков указателя на мешах сцены.
- `partGroups.ts` и `gltf.ts` не импортируют React/DOM; `gltf.ts` не импортирует `three`.
- Число `instancedMesh` у объекта = `groupParts(partsOf(o)).length` (читается по коду); `useFrame` в пакете нет.
- Нет `useGLTF` / Draco / обращений к сети; `tsc` чист; тесты пакета зелёные.
- Призрак определяется только через `useIsGhosted`; направление прожектора — только через `lightDirection`.
- Как выглядят призраки, картинки, модели и лампы, проверяет интегратор (правило 3).

**Тесты.** `partGroups`: группировка по геометрии и материалу, цвет не дробит группы, призрак меняет ключ, сфера с `paint`
получает ключ `sphere:uv`, без него и с matcap — `sphere`; `partMatrix` для каждой формы (масштаб плоскости, тора,
эллипсоида; поворот). `geometryCache` (договор о развёртке): у геометрий `cylinder:1` и `sphere:uv` вершина боковой
поверхности с наибольшим `z` имеет `u ≈ 0.5`, вершина с наименьшим `x` — `u ≈ 0.25`, с наибольшим `x` — `u ≈ 0.75`; у
plane левый край (`x = −0.5`) имеет `u = 0`. `gltf`: `inspectGltf` на минимальном собранном вручную GLB и на текстовом
`.gltf` с `data:`-буфером (оба `ok`); неверная сигнатура; версия 1; Draco в `extensionsRequired`; **Draco только в
`extensionsUsed`** (тоже отказ с сообщением про Draco); внешние URI в `buffers` и в `images`; Meshopt принимается;
`defaultModelSize`.

---

### W4 — Сохранение (объём D)

**Цель.** `LocalRepository`, автосохранение, именованные макеты по помещениям, экспорт/импорт одним файлом, меню макетов.

**Файлы.** `src/persistence/index.ts`, `localRepository.ts`, `localRepository.test.ts`, `stores.ts`, `session.ts`,
`autosave.ts`, `autosave.test.ts`, `layoutFile.ts`, `layoutFile.test.ts`, `prefs.ts`, `LayoutsMenu.tsx`, `layouts.css`.

**Можно импортировать.** `src/model/*` (в т. ч. `parseLayout`, `reconcileVenue`, `sanitizeLayout`, `hashAssetId`,
`sniffMime`, `assetIdsOf`), `src/store/{editorStore,selectors}`, `src/rooms`, `src/persistence/{repository,sync}`.

**Хранилище.**

| Где | Ключ | Значение |
|---|---|---|
| localStorage | `vagonka:layout:<id>` | `Layout` (JSON) |
| localStorage | `vagonka:prefs` | `{ roomId, lastLayoutByRoom, showLabels, gridSnap, ambience, layer }` |
| IndexedDB, база `vagonka-assets`, хранилище `assets` (одно, `createStore` из idb-keyval) | `<assetId>` | `{ meta: AssetMeta; blob: Blob }` |

Отдельного индекса макетов нет: макеты не содержат бинарных данных, их единицы или десятки, и `list()` читает сами
записи. Одна запись на файл — метаданные и блоб пишутся и удаляются одной операцией, порядок «сначала блоб, потом
мета» не нужен. Хранилища внедряются, чтобы всё тестировалось в Node:

```ts
// stores.ts
export interface StringStore { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void; keys(): string[] }
export interface RecordStore<T> { get(key: string): Promise<T | undefined>; set(key: string, value: T): Promise<void>; del(key: string): Promise<void>; keys(): Promise<string[]>; values(): Promise<T[]> }
export function browserStringStore(storage: Storage): StringStore;
export function idbRecordStore<T>(dbName: string, storeName: string): RecordStore<T>;
/** quotaChars: при превышении set бросает DOMException с name 'QuotaExceededError'. */
export function memoryStringStore(quotaChars?: number): StringStore;
export function memoryRecordStore<T>(): RecordStore<T>;

// localRepository.ts
export interface AssetRecord { meta: AssetMeta; blob: Blob }
export interface LocalRepositoryDeps { strings: StringStore; assets: RecordStore<AssetRecord>; now: () => number }
export function createLocalRepository(deps: LocalRepositoryDeps): LayoutRepository;

// index.ts (дополнительно к `repository`; используется только внутри пакета — session.ts передаёт его в setStorageMode)
export const storageMode: StorageMode;

// autosave.ts
export const AUTOSAVE_DELAY_MS = 800;
export const AUTOSAVE_MAX_WAIT_MS = 5000;
/** Подписывается на subscribeCommands; возвращает stop(). timers внедряются для тестов. */
export function startAutosave(repo: LayoutRepository, timers?: { set: typeof setTimeout; clear: typeof clearTimeout }): () => void;
```

**Поведение.**

- `save`: одна запись `vagonka:layout:<id>` — **синхронно до первого `await`**, чтобы сохранение из `pagehide` /
  `visibilitychange → hidden` было надёжным. Квота → `RepositoryError('quota')`, прежнее значение ключа не испорчено.
  Определение квоты: `DOMException` с `name` `QuotaExceededError` / `NS_ERROR_DOM_QUOTA_REACHED` либо `code` 22 / 1014.
- `list`: перебор ключей `vagonka:layout:*`; из каждой записи через `JSON.parse` берутся только
  `{ id, name, roomId, updatedAt }` (с проверкой типов; полный `parseLayout` не нужен). Запись, которая не разбирается,
  в список не попадает, но и не удаляется. Сортировка по `updatedAt` по убыванию.
- `load`: `JSON.parse` → `parseLayout`; ошибка → `RepositoryError('corrupt')`, строка остаётся на месте.
- `putAsset`: `sniffMime` → `hashAssetId`; если запись с таким id уже есть — вернуть её `meta`; иначе одна запись
  `{ meta, blob }`. `getAsset` → `blob` записи; `listAssets` → `meta` всех записей; `removeAsset` — одно удаление.
  Автоматической сборки мусора нет.
- `index.ts`: `repository = createLocalRepository(...)`, `storageMode = 'local'`; если localStorage / IndexedDB
  недоступны (проверяется пробной записью в `try/catch`) — `repository = new MemoryRepository()`, `storageMode = 'memory'`.
  `startSession` вызывает `setStorageMode(storageMode)` и при `'memory'` один раз показывает тост
  `notify('warn', 'Хранилище браузера недоступно: макеты не сохранятся после закрытия вкладки')`. Тост исчезнет через
  5 с — **постоянный** признак даёт `LayoutsMenu`: при `storage === 'memory'` вместо индикатора сохранения всегда видна
  метка «Не сохраняется» (класс предупреждения) с тем же текстом в подсказке и советом «Экспорт в файл».
- Автосохранение: после каждой команды — таймер 800 мс (принудительно через 5 с непрерывных правок); `saveStatus`
  `dirty → saving → saved | error`; ошибка квоты → `notify('error', 'Не удалось сохранить: мало места. Экспортируйте макет в файл')`,
  следующая правка повторяет попытку; сессия продолжает работать в памяти.
- Путь загрузки: `repository.load` → `reconcileVenue` → `sanitizeLayout` → `openLayout`. Нечитаемый макет пропускается
  (берётся следующий кандидат) и никогда не удаляется автоматически.
- `startSession`: настройки из `prefs` → стор; `setAssets(await repository.listAssets())`; открыть
  `lastLayoutByRoom[roomId]`, иначе самый новый макет помещения, иначе создать и сохранить «Макет 1»; `startAutosave`;
  подписка на стор, сохраняющая `prefs` при смене вида; слушатели `pagehide` / `visibilitychange` → `flushSave()`.
- Экспорт: `flushSave` → `buildLayoutFile` → скачивание через `URL.createObjectURL`. В файл попадают только файлы,
  на которые ссылаются объекты.
- Импорт (`readLayoutFile`), всё — недоверенный ввод: размер файла > `importFileBytes` → отказ до чтения; `JSON.parse` в
  `try/catch`; `format === 'vagonka-layout'`, `version` — целое ≤ 1 (больше → «Файл создан более новой версией»);
  `layout` → `parseLayout` (отброшенные объекты → предупреждения); `roomId` не из `roomIds` → ошибка «В файле помещение
  „x“, которого нет в этой версии»; каждый файл: base64 → байты, проверка размера, `sniffMime` (не распознан → пропуск и
  предупреждение), `putAsset` — **id пересчитывается из содержимого**, карта `id из файла → настоящий id` переписывает
  `assetId` объектов; объекты с неразрешённым `assetId` остаются (рисуются заглушкой) + предупреждение; затем
  `reconcileVenue` + `sanitizeLayout`, новый id макета, `repo.save`. Ничего из файла не исполняется и не используется как HTML/URL.
- `assetUsage(id)`: текущий макет + все сохранённые (`list` → `load`), возвращает названия.
- `LayoutsMenu`: кнопка с названием текущего макета → выпадающая панель: список макетов помещения (открыть, удалить с
  подтверждением), «Новый», «Сохранить как…», «Переименовать», «Экспорт в файл», «Импорт из файла» (`<input type="file"
  accept=".json">`), индикатор «Сохранено / Сохранение… / Не сохранено» — либо, при `storage === 'memory'`, постоянная
  метка «Не сохраняется». Работает и в режиме прогулки.

**Критерии приёмки.** В `localRepository.ts` между началом `save` и записью в `StringStore` нет `await`; ни одного
прямого обращения к `localStorage` / `indexedDB` вне `stores.ts` и `index.ts`; ключа `vagonka:index` и второй базы
IndexedDB нет; `repository` — единственный экспорт, которым пользуются другие пакеты; метка «Не сохраняется» зависит
только от `storage`, а не от тоста; `tsc` чист; тесты пакета зелёные.

**Тесты.** `localRepository` (на memory-хранилищах): save/list/load/remove; `list` пропускает битую запись, не удаляя её,
и не видит чужих ключей; квота не портит
сохранённое; битый JSON → `corrupt`; `putAsset` идемпотентен, content-addressed, отвергает неизвестные байты. `autosave`
(фальшивые таймеры): задержка, максимум ожидания, статусы, повтор после ошибки. `layoutFile`: base64 туда-обратно (в т. ч.
большой буфер); экспорт содержит только используемые файлы; экспорт → импорт: объекты равны, id файлов сохранены, id
макета новый; импорт v1-файла мигрирует; отказ на неверном `format`, новой версии, неизвестном помещении; несовпадение
mime → предупреждение; отсутствующий файл → предупреждение.

---

### W5 — Панели (объём B: библиотека, свойства, список, панель инструментов)

**Цель.** Весь DOM-интерфейс редактора, кроме меню макетов (W4), полки файлов (W3) и подвала (W2).

**Файлы.** `src/ui/Toolbar.tsx`, `LibraryPanel.tsx`, `PropertiesPanel.tsx`, `ObjectList.tsx`, `fields.tsx`, `format.ts`,
`format.test.ts`, `panels.css`.

**Можно импортировать.** `src/model/*`, `src/catalog/{index,types}`, `src/store/*`, `src/rooms`, `switchRoom` из
`src/persistence/session`, `LayoutsMenu` из `src/persistence/LayoutsMenu`, `AssetShelf` из `src/assets/AssetShelf`.

**Поведение.**

- **Toolbar**: бренд; помещение (`switchRoom`); `<LayoutsMenu />`; режим камеры; «Слой: Авто · Пол · Потолок» (`setLayer`;
  недоступен в прогулке; подсказка «Авто: при виде сверху потолочный декор полупрозрачен»); «Сетка 10 см» (`setGridSnap`);
  атмосфера «Рабочий свет · Вечеринка»; «↶ / ↷» (выключены по `history.past/future.length` и в прогулке);
  «Сбросить мебель» (`resetFurniture`, включена при `venueDirty`); «Снимок»
  (`viewportBridge()?.capturePng()` → скачивание `vagonka-<макет>-<yyyy-mm-dd>.png`); «Подписи»; размеры помещения.
- **LibraryPanel** (слева): поиск; `listedItems()` по группам `category` в порядке наборов; карточка — название, `hint`,
  значки креплений; клик → `addObject(item)`; внизу `<AssetShelf />`.
- **PropertiesPanel** (справа сверху), строится из `useSelected()`, `getItem(o.type)`, `describeMount(o, ctx)`; без
  выбора — «Ничего не выбрано». Поля:
  - имя; «Крепление» — сегменты только из `item.mounts` (`setObjectMount`);
  - по креплению:

    | Крепление | Поля |
    |---|---|
    | `floor` | X, Z; «Высота над полом» (lift); «Поворот, °» |
    | `wall` | «Поверхность» (select из `wallSurfaces`), «От левого края» (= along − w/2), «Низ над полом» (bottom), справочно «Верх: … м» |
    | `ceiling` | X, Z; «Опуск от потолка» (drop); справочно «Низ на высоте … м» с предупреждением при < `HEAD_CLEARANCE`; «Поворот, °» |
    | `surface` | «Стоит на: ‹имя›», кнопка «Снять на пол» (`setObjectMount(id, 'floor')`); «Поворот, °» |

  - размер Ш × В × Г в метрах: панель отправляет `patchObject(id, { size: [...] })` с заменённой **одной** осью и
    показывает то, что вернулось в объект. Правило размера целиком в `clampSize` (F, через `cmdPatch`): uniform сам
    масштабирует остальные оси, пределы `MIN_SIZE / MAX_SIZE` и `minSize / maxSize` применяются там же, 0 / отрицательное /
    мусор не проходят. Своей арифметики размера в панели нет. `resize: 'none'` — поля только для чтения; поле оси
    `item.flatAxis` — только для чтения;
  - цвет, если `colorable !== false`; по одному полю на `ParamDef` (number → ползунок + поле с единицей; boolean → флажок;
    select; color; text → input / textarea, коммит по blur; seed → кнопка «Перемешать» = новое случайное целое);
  - лампы: цвет и параметры из каталога; значок «выключена: лимит 12», если id нет в `useActiveLightIds()`;
  - лампа-прожектор: под полем «Наклон, °» — подпись по креплению: потолок «0° — строго вниз», пол / стол «0° — строго
    вверх», стена «0° — от стены, 90° — вниз»; наклон идёт в сторону «лица» объекта, которое задаёт «Поворот, °»;
  - кнопки «Заблокировать», «Скрыть», «Дублировать», «Удалить». «Скрыть» и глаз в списке — обычный
    `patchObject(id, { visible: false }, 'Скрыть')`: если на объекте что-то стоит, `cmdPatch` сам сначала опускает это на
    пол (I5), панель об этом не заботится. Вернуть мебель площадки на место можно только общей кнопкой «Сбросить мебель».

  Все правки идут через `patchObject(id, set, label, mergeKey)`; `params` патчится целиком (`{ ...o.params, [key]: value }`).
  Числовые поля коммитят по blur / Enter; ползунки и цвет — на каждое изменение с `mergeKey = '<поле>:<id>'`
  (склейка 1 с → один шаг undo). Запятая принимается как десятичный разделитель.
- **ObjectList** (справа снизу): группы «Декор» (`origin: 'user'`) и «Мебель площадки»; строка: значок крепления, имя,
  глаз, замок, дублировать, удалить; стоящие на столе — с отступом под хозяином; клик выбирает (`select`); выбранная строка
  подсвечена и прокручена в видимую область; лампы за лимитом помечены.
- В режиме прогулки поля и кнопки, меняющие макет, недоступны (класс `is-disabled` ставит `App`; `disabled` — сами поля).

**Чистый помощник** `format.ts`: `parseNumber(text: string): number | null` (запятая/точка, пробелы),
`formatMetres(value: number): string` (2 знака), `toDegrees(rad: number): number`, `toRadians(deg: number): number`,
`normalizeDegrees(deg: number): number` (в (−180, 180]).

**Критерии приёмки.** Панели не вызывают `dispatch` напрямую — только функции `actions.ts` / `session.ts` и сеттеры вида;
объекты читаются через селекторы 2.17; все селекторы, возвращающие новые массивы, обёрнуты в `useShallow`; нет UI-библиотек;
в пакете нет собственных пределов и масштабирования размера (только `patchObject` → `clampSize`), нет импортов из
`src/editor`; ни в одном `.tsx` нет `JSX.Element`; `tsc` чист; тест `format` зелёный. Вид и поведение панелей в браузере
проверяет интегратор (правило 3).

**Тесты.** `format`: разбор «1,25», « 2.5 », мусора; округление; градусы ⇄ радианы; нормализация.

---

### W6 — Гарри Поттер: потолок и плоское · W7 — Гарри Поттер: фигуры и настольное (объём E)

**Цель.** 11 процедурных пресетов из раздела 4 как данные каталога.

**Файлы W6.** `src/catalog/sets/hp/cloudCeiling.ts`, `owlPost.ts`, `prophetWall.ts`, `signpost.ts`, `wizardFrame.ts`,
`paper.ts` (общие помощники рисования пергамента и текста), `flat.test.ts`.

**Файлы W7.** `src/catalog/sets/hp/dementor.ts`, `dobby.ts`, `hatLantern.ts`, `mandrakes.ts`, `owlCage.ts`, `xmasTree.ts`,
`sortingHat.ts` (общий билдер шляпы), `figures.test.ts`.

**Можно импортировать.** `src/catalog/types`, `src/catalog/testing`, `src/model/rng`, `src/model/color` (`shade`, `mix`,
`clamp`, `lerp` — своих копий не писать), `src/model/types`; W6 — свой `paper.ts`, W7 — свой `sortingHat.ts`. Друг у
друга и у других пакетов — ничего (в т. ч. не `src/catalog/sets/basic`). `src/catalog/sets/hp/index.ts` не трогать.

**Правила.**

- Каждый модуль экспортирует `item: CatalogItem` и `painters: Record<string, Painter>` (имена painters с префиксом `hp.`);
  id, название, крепления и размер — строго по разделу 4 (их уже содержит заглушка).
- `build` чистый, случайность — только `createRng(Number(params.seed))`. **Фигуры** (`resize: 'uniform'`) выводят все
  размеры из `size`. **Площадные** предметы (облака, стена газет, сова с письмами, мандрагоры) держат реальные размеры
  элементов (свеча — 18 см, лист — A3) и заполняют бо́льшую площадь **бо́льшим числом** элементов, с жёстким пределом.
- Одинаковые элементы должны совпадать по `shape`, `taper`, материалу и `paint` (различаться только `position / rotation /
  size / color`) — тогда рендерер рисует их одним вызовом. Используйте несколько фиксированных значений `taper`.
- Painters: только системные шрифты (`Georgia, "Times New Roman", serif` / `system-ui`), подгонка текста по ширине как в
  `Label.tsx`; никаких портретов и узнаваемых лиц — обобщённые силуэты; ≤ 1024² на текстуру. Рисунок располагается по
  договору `Part.paint` (2.14): то, что должно смотреть вперёд на цилиндре или сфере (рожица, грудь совы), рисуется в
  **горизонтальном центре** canvas; шов — по левому/правому краю.
- Габарит (2.14) соблюдается при **любом** допустимом входе: умолчания, `minSize` / `maxSize`, крайние значения каждого
  параметра. Известные случаи раздел 4 расписывает явно (`T′`, `L′` и радиус у облаков, ширина шляпы у мандрагор, предел
  развода рукавов у дементора, размах и опуск совы) — эти зажимы нельзя опускать. Если при крайнем входе рецепт всё же
  вывел бы часть за габарит, билдер обязан уменьшить элемент или сдвинуть его внутрь, а не полагаться на допуск.
- Визуальной проверки в пакете **нет**: dev-сервер и браузер в параллельной фазе не запускаются (правило 3). Пакет
  сдаётся по тестам геометрии; `#gallery` в обеих атмосферах смотрит интегратор и там же подгоняет пропорции и цвета.

**Критерии приёмки.** `checkBuild(item, painters)` пуст при умолчаниях, при `minSize` и `maxSize` и при минимальном и
максимальном значении каждого числового параметра; пределы числа частей из раздела 4 соблюдены при максимальных
параметрах; в пакете нет собственных `shade` / `mix`; `tsc` чист; тесты пакета зелёные.

**Тесты (на каждый предмет).** Детерминизм при равном входе; другой seed → другой результат (у предметов с seed);
параметры-счётчики меняют число частей (свечи, шляпы, письма, листы, горшки, прутья, ярусы); фигуры масштабируются
пропорционально; площадные держат размер элементов и меняют их число; ни одна свеча не ниже `y = 0` — в том числе при
`h = 0.6` и `thickness = 0.6`; листы газет: только крен (нет поворотов вокруг X и Y), `z` принимает не более 25
значений с шагом 1 мм, любые два листа с одинаковым `z` разнесены не меньше чем на 4 ячейки сетки; указатель создаёт
по доске на строку текста; `pickBoxes` облаков = плита + шляпы; дементор при `arms = 1` и мандрагоры при `minSize`
проходят `checkBuild`.

---

### I — Интеграция (последним, один агент; может править любой файл)

**Цель.** Собрать всё вместе и довести до зелёной сборки.

1. `npx tsc --noEmit`, `npx vitest run`, `npx vite build` — зелёные; `npm run bake` выполнен, JPEG’и на месте (если F
   сообщил, что `sharp` не установился, — установка и запекание выполняются здесь).
2. Сверка контрактов: grep по каждому символу раздела 2 — экспортируется из указанного файла (2.20, 2.21 и
   `layoutFile.ts` — из файлов W2, W1, W4), заглушек не осталось (поиск «ещё не подключено», `build` = один бокс в
   `hp/*`); нет `JSX.Element`; в `src/model` нет импортов `catalog/index`; копий `shade` / `mix` вне `src/model/color.ts` нет.
3. Сквозные тесты (добавить `src/integration.test.ts`): для каждой записи каталога `checkBuild` пуст (умолчания,
   `minSize`, `maxSize`) и все `paint.painter` существуют в `getPainter`; `createLayout(lounge)` проходит
   `sanitizeLayout` без изменений; сценарий «добавить фонарь → поставить на стол → сдвинуть стол → сбросить мебель →
   undo ×N» возвращает исходный макет; сценарий «фонарь на столе кабинки → скрыть стол → фонарь на полу под столом →
   undo → фонарь снова на столе»; экспорт → импорт на `MemoryRepository` сохраняет объекты, включая плакат на грани
   колонны и лампу `light.spot`.
4. Браузерный прогон (`npm run dev`, конфигурация `date-map` в `.claude/launch.json`) — **все** визуальные проверки
   проекта собраны здесь, потому что пакеты W браузер не открывали:
   - указатель: перетаскивание в облёте и на плане не двигает камеру (вариант из спайка F);
   - потолок: облачный потолок сверху — призрак, изнутри — сплошной; «Слой: Потолок» позволяет двигать его на плане;
     ручка опуска; потолочные «жильцы» площадки на месте;
   - стены: щит и стена газет на **ближней** стене при обычном виде снаружи — бледный призрак с контуром, зал за ними
     виден и кликается; выбранный из списка, он тянется вдоль своей стены и не перескакивает на дальнюю; изнутри — сплошной;
   - фонарь встаёт на стол в кабинке и выбирается с первого клика при выбранном столе; ящик с фонарём на стол не
     заезжает; скрытие стола опускает фонарь на пол; плакат переходит со стены на колонну; колонны видны на плане;
   - размеры: uniform-ручка картинки сохраняет пропорции и толщину; поля размера не принимают 0;
   - прожектор на потолке, стене и полу светит туда, куда обещает подпись «Наклон»;
   - `#gallery` в обеих атмосферах: каждый из 11 пресетов сверяется с референсом из `decor_refs/` (рожицы мандрагор и
     грудь совы — спереди), пропорции и цвета подгоняются здесь;
   - фототекстуры, кирпич, пол, шторы (плакат поверх шторы не тонет в складках);
   - undo/redo; перезагрузка страницы восстанавливает макет и файлы; загрузка `.glb` и однофайлового `.gltf`; снимок
     PNG без оверлеев; `renderer.info.render.calls` < 250 на полной сцене ГП.
5. Правки замороженных контрактов, о которых сообщили пакеты, вносятся здесь и отражаются в этом документе.

---

## 4. Справочник декора «Гарри Поттер»

Набор `harry-potter`, группа библиотеки «Гарри Поттер», все записи `kind: 'preset'`. Обозначения: `w, h, d` — текущий
`size`; «цил.» — `cylinder`; `taper 0` — конус; «glow» — `look: 'glow'`; «адд.» — `additive: true`; DC — ожидаемое число
вызовов отрисовки (= число групп «геометрия + материал»). У каждого предмета есть параметр `seed` («Перемешать»), если не
сказано иное. Референсы — `decor_refs/*.jpg`. Настоящих источников света пресеты не создают (Р14).

### 4.1 `hp.cloudCeiling` — «Облачный потолок со свечами» · W6

- **Крепление:** ceiling (drop 0, `hanger: false`). **Размер:** 4.0 × 1.1 × 3.0 (ширина × глубина свисания × глубина);
  `resize: 'free'`, min 1 × 0.6 × 1, max 12 × 2 × 8.
- **Параметры:** `thickness` «Толщина облаков, м» 0.35 (0.2–0.6) · `density` «Плотность, шт/м²» 12 (6–20) · `glowColor`
  «Цвет свечения» `#3fe0a8` · `glow` «Свечение» 1 (0–2) · `candles` «Свечи, шт/м²» 2.5 (0–6) · `hats` «Шляпы» 2 (0–8) · `seed`.
- **Рецепт.** Сначала зажимы — чтобы габарит и правило «ни одна свеча не ниже `y = 0`» выполнялись и при минимальной
  высоте 0.6 м с толщиной 0.6 м: `T = min(thickness, h − 0.3)` (под облаками всегда остаётся ≥ 0.3 м). Дальше `T` —
  уже зажатая толщина; `mix`, `lerp`, `clamp` — из `src/model/color.ts`.
  - *Облака* (1 DC): `n = min(400, round(density·w·d))` сфер на сетке с дрожанием ±0.45 ячейки
    (`cols = ceil(√(n·w/d))`). `r = min(lerp(0.20, 0.38, u²)·√(T/0.35), 0.4·min(w, d))`, `size = [2.5r, 1.4r, 2.5r]`, центр
    `y = h − 0.7r − 0.02 − 0.3·T·u₂`, `|x| ≤ max(0, w/2 − 1.25r)`, `|z| ≤ max(0, d/2 − 1.25r)` (сфера целиком внутри
    прямоугольника); в 0.3 м от края — ×0.75 (рваная кромка).
    `look: 'matcap'`, `paint: { painter: 'hp.cloudMatcap', args: { color: glowColor, glow }, px: [128, 128] }`; цвет части =
    `mix('#12443a', '#ffffff', 0.55 + 0.45·valueNoise2(0.9x, 0.9z, seed))` → неровные «лужи света», как на референсе.
  - *Свечи* (4 DC): `n = min(120, round(candles·w·d))`, длина `L = min(0.18 ± 0.04, h − T − 0.07)` (не меньше 0.05).
    Верх свечи `yTop = (h − T) − range(0.05, max(0.05, h − T − L − 0.02))` — каждая на своей высоте; низ свечи
    `yTop − L ≥ 0.02` при любых допустимых `h` и `thickness` (при `h = 0.6`, `thickness = 0.6`: `T = 0.3`, `L ≤ 0.22`,
    низ ≥ 0.02).
    Тело — цил. `[0.022, L, 0.022]`, `#f3ead2`, `emissive #ffcf8a` 0.25; пламя — цил. `taper 0` `[0.016, 0.035, 0.016]`,
    glow `#ffc15a`; ореол — сфера Ø 0.07, glow адд. `opacity 0.35`, `#ff9a2e`; нить — цил. Ø 0.002 от пламени до
    `y = h − T/2`, `#d8d8d8`, `opacity 0.35`.
  - *Шляпы ведьм* (2 DC): поля — цил. `[0.42, 0.012, 0.42]`; тулья — цил. `taper 0` `[0.22, 0.40, 0.22]`; `#15131a`,
    roughness 0.9; общий наклон ≤ 12°; низ шляпы на `(0.3…0.6)·(h − T)` ниже облаков, но не ниже `y = 0.02`; центр
    шляпы — не ближе 0.25 м к краю прямоугольника; нить до облаков.
  - `pickBoxes`: плита `{ center: [0, h − T/2, 0], size: [w, T, d] }` + по боксу 0.42³ на шляпу.
- **Пределы:** облаков ≤ 400, свечей ≤ 120, всего частей ≤ 950 (в тесте `checkBuild(..., 950)`). ≈ 7 DC.
- Painter `hp.cloudMatcap`: радиальный градиент — центр `mix(#fff, color, 0.25·glow)`, на 0.55 радиуса `color`, край
  `color × 0.15`; при `glow = 0` — нейтральная серо-белая «вата». Запасной вариант, если matcap смотрится плохо:
  `look: 'lit'` + `emissive: glowColor` (правка одной строки в билдере).

### 4.2 `hp.dementor` — «Дементор на стойке» · W7

- **Крепление:** floor. **Размер:** 0.9 × 2.0 × 0.7, `uniform`. Цвет объекта = ткань `#0b0b0f`.
- **Параметры:** `arms` «Руки в стороны» 0.5 (0–1) · `tatter` «Лохмотья» 0.6 (0–1) · `hover` «Подол над полом, м» 0 (0–0.4) ·
  `showBase` «Стойка» true · `seed`.
- **Рецепт:** стойка — диск цил. `[0.5w, 0.03, 0.5w]` и шест цил. Ø 0.04 до `0.78h`, `#cdbf9c` (как фанера и брус на
  референсе). Плащ — 4 усечённых цил. эллиптического сечения (`size = [2r, высота, 2r·d/w]`, `taper = r_верх / r_низ`,
  округлённый до 0.05) между уровнями `(r, y)`: `(0.46w, hover) → (0.40w, 0.25h) → (0.33w, 0.55h) → (0.30w, 0.76h) →
  (0.12w, 0.83h)`; roughness 0.95. Лохмотья подола — `round(8 + 10·tatter)` тонких боксов `[0.06w, (0.10…0.25)h, 0.01]`
  по периметру подола, отклонённых наружу не более чем на 10°, со случайной длиной. Плечи — бокс `[0.5w, 0.05, 0.08]`
  на `0.76h`.
  Рукава (на референсе руки висят вдоль тела, плащ узкий) — 2 цил. длиной `L = 0.40h`, диаметр у кисти `0.22w`,
  `taper 0.6` (у плеча у́же), подвешены за верхний конец в точках `(±0.2w, 0.76h, 0)` и отведены в стороны на угол
  `φ = arms·φmax`, где `φmax = asin(min(1, 0.25w / L))` (≈ 16° при пропорциях по умолчанию): нижний конец рукава
  оказывается не дальше `x = ±0.45w`, вместе с радиусом — внутри `w/2` плюс допуск **при любом `arms`**. Центр части —
  `(±(0.2w + (L/2)·sin φ), 0.76h − (L/2)·cos φ, 0)`, поворот вокруг Z на `±φ`. Капюшон — сфера
  `[0.34w, 0.2h, 0.36w]` на `0.88h` + пик цил. `taper 0` `[0.2w, 0.14h, 0.2w]` с центром `[0, 0.93h, 0.04w]`, наклон 35°
  вперёд (вершина не выше `1.02h`). Провал лица — сфера
  `[0.2w, 0.13h, 0.06w]` в `[0, 0.87h, 0.15w]`, glow `#020203` (неосвещаемая чёрная дыра). ≈ 6 DC.

### 4.3 `hp.prophetWall` — «Стена газет „Ежедневный пророк“» · W6

- **Крепление:** wall. **Размер:** 1.5 × 2.5 × 0.06, `free`, max 6 × 3 × 0.06.
- **Параметры:** `density` «Листов на м²» 16 (6–30) · `sheetScale` «Размер листа» 1 (0.7–1.4; базовый лист 0.30 × 0.42 м) ·
  `tilt` «Разброс наклона, °» 18 (0–35) · `lang` «Язык» ru / en (ru) · `seed`.
- **Рецепт:** `n = min(160, round(density·w·h))` плоскостей `[0.30, 0.42, 0]·sheetScale`, roughness 0.9,
  `paint: { painter: 'hp.prophetPage', args: { variant: 0…7, lang }, px: [384, 544] }` (8 вариантов → 8 DC). Раскладка:
  сетка с ячейкой 0.62 × размер листа (≈ 38 % перекрытия), дрожание ±0.3 ячейки, **только крен** `±tilt` (поворот
  вокруг Z). Тангажа и рыскания нет: лист 0.30 × 0.42 м, наклонённый на 3°, занимает по глубине ±11 мм и прорезал бы
  соседей по видимым линиям; загнутые углы и тени под краями рисует painter.
  Наслоение — по ячейке сетки, а не по порядковому номеру: `layer = perm[(col mod 5) + 5·(row mod 5)]`, где `perm` —
  перестановка `0…24` из `rng.shuffle`; `z = −d/2 + 0.004 + layer·0.001`. Листы с одинаковым `z` отстоят друг от друга
  минимум на 5 ячеек и не могут перекрыться (лист с креном и дрожанием дотягивается не дальше ≈ 3.4 ячейки), а
  перекрывающиеся соседи всегда разделены ≥ 1 мм — это вчетверо больше разрешения буфера глубины орбитальной камеры
  на 20 м (≈ 0.24 мм при `near = 0.1`). Вся стопка — 29 мм, помещается в `d = 0.06`. Листы могут выступать за
  прямоугольник не более чем на 10 %; варианты — перемешанным round-robin, чтобы соседи различались.
- Painter `hp.prophetPage`: пергамент `#d9b77a` с пятнами, затемнение по краям и «загнутый» уголок (объём — рисунком), шапка «Ежедневный Пророк» / “The Daily Prophet”, один крупный
  заголовок на вариант («РАЗЫСКИВАЕТСЯ», «НЕЖЕЛАТЕЛЬНОЕ ЛИЦО № 1», «МАССОВЫЙ ПОБЕГ ИЗ АЗКАБАНА», «ТЁМНАЯ МЕТКА СЕЕТ ПАНИКУ»,
  «ВЫ ВИДЕЛИ ЭТОГО ВОЛШЕБНИКА?», «МАЛЬЧИК, КОТОРЫЙ ВЫЖИЛ», «ТОТ-КОГО-НЕЛЬЗЯ-НАЗЫВАТЬ ВЕРНУЛСЯ», «ПРОКЛАМАЦИЯ · Декрет № 24»),
  тёмный «фотоблок» с обобщённым силуэтом головы и плеч (без портретного сходства), серые колонки строк; у вариантов
  «разыскивается» — крупное фото.

### 4.4 `hp.owlPost` — «Сова с письмами» · W6

- **Крепление:** ceiling (drop 0, `hanger: false`). **Размер:** 1.6 × 1.5 × 1.6, `free`, min 0.8 × 0.8 × 0.8.
- **Параметры:** `letters` «Письма» 25 (5–60) · `wingspan` «Размах крыльев, м» 1.2 (0.8–1.6) · `owlDrop` «Сова ниже потолка, м»
  0.25 (0.1–0.6) · `seed`.
- **Рецепт.** Зажимы под габарит: `W = min(wingspan, w)`, `D = min(owlDrop, h − 0.5·W − 0.05)`. Сова, как на референсе, —
  плоская печатная вырезка: плоскость `[W, 0.5·W, 0]`, `doubleSided`,
  `cutout`, `paint: { painter: 'hp.owlFlying', px: [1024, 512] }`, наклон 15° к зрителю, центр на
  `y = h − D − 0.25·W`; для объёма — белые сферы тела `[0.16, 0.2, 0.14]·W` и головы. Письма — по две
  плоскости 0.22 × 0.15 спина к спине (`hp.letterFront` — кремовая бумага, зелёные рукописные строки адреса;
  `hp.letterBack` — клапан и красная сургучная печать; `px: [256, 176]`), равномерно по площади (мин. расстояние 0.18 м,
  `|x| ≤ w/2 − 0.11`, `|z| ≤ d/2 − 0.11`), центр на `y ∈ [0.1, h − 0.25]`, любой угол рыскания, крен ±25°, тангаж ±15°. Нити — цил. Ø 0.002 от верхнего края
  каждого письма до `y = h`, две — к сове. ≈ 6 DC. Выбор мышью — по частям (≤ 200).

### 4.5 `hp.signpost` — «Указатель» · W6

- **Крепление:** floor, wall. **Размер:** 1.0 × 1.8 × 0.12, `uniform`.
- **Параметры:** `boards` «Таблички (по строке на каждую)», многострочный текст, по умолчанию: Хогвартс · Косой переулок ·
  Хогсмид · Гринготтс · Азкабан · Министерство магии · Платформа 9¾ · Хижина Хагрида · `boardColor` `#141414` ·
  `textColor` `#f4f1ea` · `seed`.
- **Рецепт** (референс — плоская чёрная картонная вырезка; `k = h / 1.8`): столб — бокс `[0.09k, h, 0.03]`; холм —
  плоскость `[0.55w, 0.16h, 0]` у пола, `cutout`, `doubleSided`, `paint: 'hp.signMound'` (чёрный полуэллипс). На каждую
  непустую строку (не более 10) — табличка: плоскость `[bw, bh, 0]`, `cutout`,
  `paint: { painter: 'hp.signBoard', args: { text, dir, boardColor, textColor, seed }, px: [512, 128] }` на `z = +0.02`
  и её «изнанка» без текста (`text: ''`, развёрнута на 180° вокруг Y) на `z = −0.02`. `bw = clamp((0.25 + 0.045·символов)·k,
  0.4k, w)`, `bh = 0.15k` (нижняя — `0.2k`), `y` равномерно от `0.30h` до `0.95h`, направление стрелки чередуется по rng,
  крен ±6°. ≈ 12 DC.
- Painter `hp.signBoard`: силуэт доски с острым концом (в сторону `dir`) и зазубренным хвостом на прозрачном фоне; жирные
  засечные заглавные буквы с дрожанием базовой линии, поворотом ±6° и размером ±12 % на глиф (имитация надписи от руки);
  текст ужимается по ширине. На референсе два названия написаны иначе («Хогсмит», «Грин Готс»); умолчания — по ТЗ, текст
  редактируется.

### 4.6 `hp.hatLantern` — «Шляпа-фонарь» · W7

- **Крепление:** surface, floor. **Размер:** 0.36 × 0.35 × 0.36, `uniform`.
- **Параметры:** `glowColor` «Цвет свечения» `#ffab3d` · `glow` «Яркость» 1 (0–2) · `seed`.
- **Общий помощник** `sortingHat(w, h, opts: { color: string; face: 'glow' | 'dark' | 'none'; glowColor?: string; glow?: number;
  origin?: Vec3 }): Part[]` (файл `sortingHat.ts`, используется также в 4.8): поля — цил. `[w, 0.03h, w]`; тулья — 4 цил.
  с уменьшающимся диаметром и «заваленной» макушкой: Ø `0.62w → 0.56w` (`y` 0.03h–0.30h), `0.56w → 0.40w` (0.30h–0.55h,
  сдвиг `z −0.02w`), `0.40w → 0.22w` (0.55h–0.80h, сдвиг `−0.06w`, наклон −10° вокруг X), конус `0.22w → 0` (0.80h–1.0h,
  сдвиг `−0.12w`, наклон −25°); складки — 2 тора (трубка `0.03w`) на стыках, лёжа горизонтально; кожа `#4a3f33`, roughness 0.85.
  Лицо `'glow'`: глаза — 2 бокса `[0.12w, 0.05h, 0.02w]` на `y = 0.42h`, `x = ±0.11w`, `z ≈ 0.25w`, крен ±25° (злой
  прищур), рот — бокс `[0.34w, 0.045h, 0.02w]` на `y = 0.2h`, `z ≈ 0.3w`; все — glow `glowColor`. Лицо `'dark'` — те же
  боксы цветом `shade(color, 0.3)` без свечения (`shade` — из `src/model/color.ts`). Все части шляпы лежат внутри
  цилиндра полей: `|x|, |z| ≤ w/2` от `origin`.
- **Рецепт:** `sortingHat(w, h, { color, face: 'glow', glowColor, glow })` + пятно света на столе: плоскость
  `[1.6w, 1.6w, 0]`, положена горизонтально на `y = 0.002`, glow адд., `paint: { painter: 'hp.glowDisc', args: { color:
  glowColor }, px: [128, 128] }`, `opacity 0.45·glow` (аддитивная часть вправе выходить за габарит). ≈ 6 DC.
  Настоящий свет при желании ставится рядом объектом «Лампа».

### 4.7 `hp.wizardFrame` — «Фоторамка „Have you seen this wizard?“» · W6

- **Крепление:** floor (фотозона). **Размер:** 1.2 × 1.9 × 0.4 (щит 1.2 × 1.6 на ножках 0.3), `uniform`. Цвет объекта —
  пергамент `#cdb58a`.
- **Параметры:** `legs` «Ножки, м» 0.3 (0–0.6) · `title` «Заголовок» «HAVE YOU SEEN THIS WIZARD?» · `plate` «Табличка»
  «AZKABAN PRISON» · `number` «Номер» «ᛈᚹ390». Без `seed`.
- **Рецепт** (`B = h − legs` — высота щита, толщина 0.02, `k = h / 1.9`): 4 бокса вокруг **настоящей** дыры (за рамкой
  можно стоять и сквозь неё кликать): верх `[w, 0.27B, 0.02]` с `paint: 'hp.frameTop' { title, color }` `px [768, 256]`;
  низ `[w, 0.21B, 0.02]` с `'hp.frameBottom' { color }` `px [768, 200]` (чёрная полоса-предупреждение, мелкий текст);
  бока `[0.12w, 0.52B, 0.02]` × 2 с `'hp.parchment' { color }`. Табличка с номером — бокс `[0.42w, 0.13B, 0.015]`,
  свисает в низ дыры, `z = +0.012`, `'hp.framePlate' { plate, number }` `px [512, 160]`. Ножки — 2 бокса
  `[0.07k, legs + 0.3k, 0.02]` и 2 задних подкоса под 20° до `z = −d/2`, брус `#c9a36b`. ≈ 5 DC. `pickBoxes` не задаётся —
  боксы частей оставляют дыру «прозрачной» для кликов.

### 4.8 `hp.mandrakes` — «Мандрагоры и шляпа» · W7

- **Крепление:** surface, floor. **Размер:** 0.6 × 0.4 × 0.45, `free`, min 0.3 × 0.3 × 0.25.
- **Параметры:** `pots` «Горшки» 6 (3–12) · `withHat` «Распределяющая шляпа» true · `seed`.
- **Рецепт:** горшки расставлены с минимальным расстоянием 0.11 м в передних 60 % площадки (сколько поместилось, но не
  больше `pots`), центры — не ближе 0.06 м к краям: `|x| ≤ w/2 − 0.06`, `z ∈ [−0.1d + 0.06, d/2 − 0.06]`.
  Горшок — цил. `[0.07, 0.05, 0.07]`, `taper 1.3`, `#1c1512`; земля — сфера `[0.085, 0.03, 0.085]`,
  `#4b3226`; корень — цил. `[0.04, 0.05, 0.04]`, `taper 0.7`, `#c98d55`, `paint: 'hp.mandrakeFace'` `px [128, 128]`
  (хмурая рожица — в горизонтальном центре canvas: по договору `Part.paint` он смотрит в локальный +Z, к зрителю);
  стебель — цил. Ø 0.004 × 0.03; листья — 2–3 сферы `[0.035, 0.004, 0.06]`, `#4f9a3a`, отклонены наружу
  на 30–50°. `withHat` → шляпа шириной `hw = min(0.25, 0.8·d, 0.8·w)` и высотой `min(0.25, h)`, прижата к заднему краю
  изнутри: `sortingHat(hw, min(0.25, h), { color: '#7a4a22', face: 'dark', origin: [0, 0, −d/2 + hw/2] })` — при
  минимальном размере 0.3 × 0.3 × 0.25 шляпа сужается до 0.2 м и остаётся в габарите (при размере по умолчанию
  `hw = 0.25`, центр на `z = −0.1`).
  Остальные элементы не масштабируются с размером объекта. ≈ 10 DC.

### 4.9 `hp.dobby` — «Добби» · W7

- **Крепление:** floor. **Размер:** 0.45 × 1.0 × 0.3, `uniform`. Без параметров и `seed`; цвет объекта — кожа `#d9a98c`
  (`colorable: false`).
- **Рецепт** (доли `h`): ноги — 2 цил. Ø `0.055h`, `taper 0.8`, высота `0.30h`, `x = ±0.07h`; ступни — сферы
  `[0.06h, 0.03h, 0.13h]`, вынесены вперёд; наволочка — цил. `[0.26h, 0.41h, 0.22h]`, `taper 0.7`, `y` 0.27h–0.68h,
  `#141414`, с двумя «узлами» на плечах (боксы 0.03h); руки — плечо цил. Ø `0.04h` × `0.22h` вниз от `0.66h`, предплечье
  Ø `0.035h` × `0.2h` вперёд; кисти — 2 сферы Ø `0.05h`, сложены перед грудью в `[±0.02h, 0.45h, 0.12h]`; шея — цил.
  Ø `0.05h`; голова — сфера `[0.19h, 0.17h, 0.19h]` на `0.84h`; уши летучей мыши — сферы `[0.13h, 0.08h, 0.012h]` на
  `x = ±0.14h`, развёрнуты ±20°; нос — цил. `taper 0` `[0.018h, 0.07h, 0.018h]`, направлен в +Z; глаза — сферы Ø `0.044h`,
  `#cfe3c0`, зрачки Ø `0.02h`, `#1a1a1a`. ≈ 6 DC.

### 4.10 `hp.owlCage` — «Сова в клетке» · W7

- **Крепление:** surface, ceiling (`defaultDrop: 0.6`, `hanger: true` — общая нить играет роль цепи), floor.
  **Размер:** 0.32 × 0.6 × 0.32, `uniform`.
- **Параметры:** `bars` «Прутья» 20 (12–32) · `cageColor` «Цвет клетки» `#3a2a20` · `withOwl` «Сова» true. Без `seed`.
- **Рецепт** (`R = w/2 − 0.005`): дно — цил. `[w, 0.03, w]`; обручи — 3 тора Ø `w`, трубка 0.012, горизонтально, на
  `0.03`, `0.32h`, `0.62h`; прутья — `bars` цил. Ø 0.006 высотой `0.60h` по окружности `R`; купол — `bars / 2` цил. от
  `(R, 0.62h)` к `(0.35R, 0.84h)`; луковка — сфера `[0.3w, 0.1h, 0.3w]` на `0.88h`; кольцо — тор Ø 0.05 вертикально на
  `0.96h`. Сова: тело — сфера `[0.62w, 0.42h, 0.56w]` с `paint: 'hp.owlFeathers'` `px [256, 256]` (белое, редкие тёмные
  крапины); голова — сфера `[0.5w, 0.2h, 0.46w]` на `0.47h`; глаза — сферы Ø `0.07w`, `#f2c400`, зрачки Ø `0.035w`; клюв —
  цил. `taper 0`; крылья — сферы `[0.12w, 0.3h, 0.4w]` по бокам. ≈ 8 DC.

### 4.11 `hp.xmasTree` — «Ёлка 150 см» · W7

- **Крепление:** floor. **Размер:** 0.8 × 1.5 × 0.8 (высота 150 см, диаметр 80 см — по карточке товара), `uniform`.
  Цвет объекта — хвоя `#2f5d34`.
- **Параметры:** `tiers` «Ярусы» 8 (5–12) · `lights` «Гирлянда» true · `ornaments` «Шары» 0 (0–40) · `star` «Звезда» false · `seed`.
- **Рецепт:** стальная крестовина — 2 бокса `[0.5w, 0.03, 0.05]` крест-накрест, `#22302a`; ствол — цил. Ø 0.05 × `0.2h`,
  `#4a3524`; хвоя — `tiers` перекрывающихся цил. `taper 0.1`: ярус `i` (0 — нижний) с нижним радиусом
  `0.5w·(1 − i/tiers)^0.9`, шаг по высоте `0.86h / tiers`, высота яруса = 1.6 шага, `paint: 'hp.needles'` `px [256, 256]`
  (тайлящаяся хвоя); кончики веток — ≤ 200 маленьких цил. `taper 0` `[0.05, 0.14, 0.05]` по кромкам ярусов (центр — на
  0.9 радиуса яруса, чтобы кончик нижнего яруса не выходил за габарит), наклон наружу
  и вниз 60–75°, с разбросом цвета; `lights` → ≤ 60 сфер Ø 0.024 по спирали, glow тёплых оттенков (белый / красный /
  золото); `ornaments` → сферы Ø 0.06, roughness 0.3, metalness 0.6; `star` → плоскость `[0.14, 0.14, 0]`, `cutout`,
  `doubleSided`, glow, `paint: 'hp.star'`, на макушке (ёлка при этом ниже на 0.1). ≈ 7 DC. Модуль самодостаточен: позже
  его можно перенести в набор «Новый год» сменой одной строки импорта.

### 4.12 Painters набора

W6 (`paper.ts` — общий фон пергамента и подгонка текста): `hp.cloudMatcap`, `hp.prophetPage`, `hp.letterFront`,
`hp.letterBack`, `hp.owlFlying`, `hp.signBoard`, `hp.signMound`, `hp.frameTop`, `hp.frameBottom`, `hp.framePlate`,
`hp.parchment`. W7: `hp.glowDisc`, `hp.mandrakeFace`, `hp.owlFeathers`, `hp.needles`, `hp.star`.

Оценка полной сцены ГП (2 облачных потолка, 3 дементора, стена газет, сова с письмами, указатель, 6 фонарей, рамка,
мандрагоры, Добби, клетка, ёлка): ≈ 130 вызовов отрисовки и < 250 тыс. треугольников; вместе с мебелью и помещением —
в пределах цели < 250 вызовов.

---

## 5. Риски

| № | Риск | Что делаем |
|---|---|---|
| 1 | Параллельные агенты без git ломают друг другу сборку или пишут в один файл | Замороженный фундамент с компилируемыми заглушками; таблица эксклюзивного владения; свой CSS-файл у каждого пакета; агент чинит только свои ошибки `tsc`; о неверном контракте сообщают, а не правят; один интеграционный проход |
| 2 | Фундамент велик и блокирует всех | Он почти целиком чистый TypeScript с тестами; ворота заморозки объективны (`tsc` + `vitest` + поведение этапа 1); заглушки позволяют стартовать всем семи пакетам сразу |
| 3 | Перехват указателя в capture-фазе ведёт себя не так, как прочитано в исходниках (инерция, pointer capture) | Спайк в браузере выполняет **F** до заморозки, на стабильном дереве и единственном dev-сервере; результат записан в заглушке `EditorOverlay.tsx`; запасной вариант — дополнительно переключать `enableRotate / enablePan`; оба варианта живут внутри `PointerController`, контракты и математика перетаскивания от исхода не зависят |
| 4 | Аналитический выбор расходится с картинкой (клик по видимому — мимо, по пустому — попадание) | Боксы выбора выводятся из тех же `Part[]`, что и рендер; тонкое раздувается до 10 px; побеждает ближайшее попадание, поэтому контур наведения показывает ровно то, что будет выбрано; колонны рисуются сплошным боксом — так же, как их учитывает `columnDistance`; всегда можно выбрать из списка объектов |
| 5 | Декор на отсечённой поверхности — потолочный или на ближней стене — всё же мешает в облёте либо, наоборот, «пропадает» | Одно правило для потолка и стен: «с изнанки — призрак, клики насквозь; с лица — сплошной»; выбранный всегда сплошной; явный «Слой» для потолка; контур верхней грани / спинки у призрака; двусторонние материалы призрака (листы видны и со спины); `GHOST_OPACITY` — одна константа |
| 6 | Скачки и выход за пределы при смене крепления, на краю подиума, при удалении или скрытии хозяина, при перетаскивании «со спины» | Всё сведено к чистым `resolvePose`, `clampMount`, `remount`, `resolveMove` с табличными тестами; хозяин с детьми не заезжает на стол; настенный объект, взятый со спины, ведётся по точке пола и не перескакивает на противоположную стену; **любой** локальный патч идёт через `cmdPatch`; `sanitizeLayout` при загрузке гарантирует, что любой сохранённый макет рисуется |
| 7 | Размеры помещения правят после того, как макеты сохранены или пока идут чужие тесты | Крепления относительные; `reconcileVenue` (детей устаревшей мебели — на пол под ней) + `sanitizeLayout` при каждой загрузке; тесты математики используют `testRoom`, а про `lounge` — только утверждения из его же данных; размеры текстур скрипт берёт из `lounge.ts` |
| 8 | Процедурный декор нельзя оценить юнит-тестами, а в параллельной фазе W6/W7 не видят результата вовсе (браузера нет) | Билдеры чистые → тесты геометрии, габаритов при крайних входах и детерминизма; рецепты раздела 4 заданы числами по референсам; договор о развёртке `paint` исключает «лицо на затылке»; визуальная сверка всех 11 предметов с `decor_refs/` и подгонка — отдельный пункт интегратора (`#gallery`) |
| 9 | Вид облаков зависит от matcap-приёма | Сделать этот предмет в W6 первым; запасной вариант — `lit` + `emissive` (одна строка) |
| 10 | Сотни частей в пресете роняют частоту кадров | Жёсткие пределы в билдерах (проверяются тестами); группировка в `InstancedMesh`; общие кэши геометрии/материалов/текстур; пересборка только при смене размера/параметров; `dpr ≤ 2`; тени только от «солнца» и не от потолочного декора |
| 11 | Смена числа ламп перекомпилирует шейдеры (подвисание 0.1–0.4 с при добавлении лампы и смене атмосферы) | Принято при ≤ 12 лампах и общих материалах; если мешает — фиксированный пул из 12 ламп с нулевой яркостью (правка только в `LightBody` / `Ambience`) |
| 12 | Выпрямленные фото выглядят плохо (косой ракурс, перекрытия, красная засветка) | `--debug` с квадами поверх исходника; панели режутся по свободной области; `gain` по каналам; любая панель без файла остаётся одноцветной; кирпич, пол и шторы от фото не зависят |
| 13 | Квота localStorage / недоступный или вычищенный IndexedDB | В макетах нет бинарных данных; `RepositoryError('quota')` → `saveStatus: 'error'` + совет экспортировать; запасной `MemoryRepository`, о котором говорит не тост, а поле `storage === 'memory'` → постоянная метка «Не сохраняется» в меню макетов; картинки ужимаются до 2048 px |
| 14 | Вредный или экзотический импорт / модель | Проверка макета по полям с отдельным правилом на каждое строковое поле (id, `surfaceId` с гранью колонны, `type` с точкой, `assetId`), mime по сигнатуре, пересчёт id, без SVG; `inspectGltf` до разбора (Draco в `extensionsUsed` или `extensionsRequired`, внешние URI), лимиты размера, `setURLModifier` блокирует сеть, без Draco-CDN; при сбое — заглушка-бокс |
| 15 | zustand v5: бесконечные перерисовки из-за селекторов, возвращающих новые объекты | Кэшированные селекторы в `selectors.ts` (draft-слияние по паре ссылок), правило `useShallow` в критериях W5; тест стора проверяет стабильность ссылок |
| 16 | Утечка текстур от текстовых параметров; двойной монтаж в StrictMode | LRU-96 с `dispose`, текстовые поля коммитят по blur; кэши на уровне модуля и идемпотентны; все слушатели — в эффектах с очисткой |
| 17 | Шрифты canvas различаются между ОС | Обобщённые стеки serif / sans, подгонка по ширине, никаких допущений о метриках глифов |
| 18 | Импорт `.ts` из Node-скрипта перестанет работать | Проверено на Node 26.8; `homography.ts` без импортов и неудаляемого синтаксиса; запасной вариант — транспилированная копия рядом со скриптом |
| 19 | Отмена после удаления файла из библиотеки | Удаление запрещено, пока файл используется сохранённым или открытым макетом; если объект всё же вернулся через undo без файла — рисуется заглушка «?» и остаётся редактируемым |
| 20 | `npm install -D sharp` не проходит (нет сети, нет бинарника под платформу) | Ставит F, пока в каталоге один агент, — параллельной фазе это не мешает в любом исходе; при отказе W1 сдаёт скрипт, JSON и тесты гомографии, запекание делает интегратор; панели без текстуры остаются одноцветными, кирпич, пол и шторы от `sharp` не зависят |
| 21 | Все браузерные проверки сдвинуты на интегратора — ошибки вида и поведения всплывают поздно и в одном месте | Плата за один порт и общее дерево. Смягчение: спайк указателя — в F; вся логика выбора, перетаскивания, призраков, размеров и света — чистые функции с тестами (включая случаи из отчётов рецензентов); у интегратора явный чек-лист (раздел I, п. 4), а не «дымовой прогон» |
| 22 | Сквозь выбранный большой потолочный объект (облака 4 × 3 м) при виде сверху не кликаются предметы под ним | Принято: выбранный объект должен оставаться перетаскиваемым; Esc или клик по пустому месту снимает выбор — после этого он призрак и клики проходят насквозь; предметы под ним всегда доступны из списка объектов |
