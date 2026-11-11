import { useEffect, useMemo, useState } from 'react';
import { SRGBColorSpace, TextureLoader } from 'three';
import type { Texture } from 'three';
import { panelTransform, wallFrame, wallSurfaces } from '../model/geometry';
import type { WallSurface } from '../model/geometry';
import type { CameraMode, ColumnDef, ColumnFace, ColumnFaceDef, RoomDef, Vec3, WallDef, WallPanel } from '../model/types';
import { Label, LABEL_ASPECT } from './Label';
import { BRICK_TILE, TERRAZZO_TILE, curtainGeometry, tiledPlane, useRoomTextures } from './roomTextures';
import type { RoomTextures } from './roomTextures';

const WALL_THICKNESS = 0.2;
/** Плоскости граней колонн и вставки пола лежат на 2 мм перед своей опорой: меньше WALL_GAP, декор остаётся перед ними. */
const SKIN = 0.002;
/** Ширина тёмной полосы-вставки в полу, м. */
const INLAY_WIDTH = 0.22;
const INLAY_COLOR = '#4b443d';
const FACES: readonly ColumnFace[] = ['n', 'e', 's', 'w'];

/** Пути, о которых уже предупредили: одно сообщение на файл, сколько бы панелей и перемонтирований ни было. */
const warned = new Set<string>();

/**
 * Запечённая фототекстура панели или грани колонны: public/<path> → Texture (sRGB, anisotropy 8).
 * Без Suspense: пока файл грузится, а также если его нет (404, запекание не выполнялось), возвращает null —
 * панель остаётся одноцветной. Текстура освобождается при смене пути и при размонтировании.
 */
function usePanelTexture(path: string | undefined): Texture | null {
  const [loaded, setLoaded] = useState<{ path: string; texture: Texture } | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let texture: Texture | null = null;
    new TextureLoader().load(
      import.meta.env.BASE_URL + path,
      (result) => {
        if (cancelled) {
          result.dispose();
          return;
        }
        result.colorSpace = SRGBColorSpace;
        result.anisotropy = 8;
        texture = result;
        setLoaded({ path, texture: result });
      },
      undefined,
      () => {
        if (warned.has(path)) return;
        warned.add(path);
        console.warn(`Текстура ${path} не загрузилась — панель остаётся одноцветной (запустите npm run bake).`);
      },
    );
    return () => {
      cancelled = true;
      texture?.dispose();
      setLoaded((current) => (current && current.path === path ? null : current));
    };
  }, [path]);

  // Текстура прежнего пути не показывается на панели с новым.
  return loaded && loaded.path === path ? loaded.texture : null;
}

/**
 * Стены и потолок — односторонние плоскости, смотрящие внутрь: снаружи и сверху
 * они не видны и не мешают облёту. Толщина стен рисуется только на виде сверху.
 */
function Wall({ wall, height, plan }: { wall: WallDef; height: number; plan: boolean }) {
  const f = wallFrame(wall);
  const upperH = height - wall.splitHeight;
  return (
    <group position={[f.mid[0], 0, f.mid[1]]} rotation={[0, f.rotationY, 0]}>
      <mesh position={[0, wall.splitHeight / 2, 0]} receiveShadow>
        <planeGeometry args={[f.length, wall.splitHeight]} />
        <meshStandardMaterial color={wall.lowerColor} roughness={0.95} />
      </mesh>
      <mesh position={[0, wall.splitHeight + upperH / 2, 0]} receiveShadow>
        <planeGeometry args={[f.length, upperH]} />
        <meshStandardMaterial color={wall.upperColor} roughness={0.95} />
      </mesh>
      {plan && (
        <mesh position={[0, height / 2, -WALL_THICKNESS / 2]}>
          <boxGeometry args={[f.length + WALL_THICKNESS * 2, height, WALL_THICKNESS]} />
          <meshBasicMaterial color="#2b2526" />
        </mesh>
      )}
    </group>
  );
}

/** Фото, проём или одноцветная панель: плоскость; после загрузки texture — map, цвет белый. */
function FlatPanel({ panel, position, rotationY }: { panel: WallPanel; position: Vec3; rotationY: number }) {
  const texture = usePanelTexture(panel.texture);
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} receiveShadow>
      <planeGeometry args={[panel.width, panel.height]} />
      {/* key: появление map меняет шейдер — материал создаётся заново, а не правится на месте. */}
      <meshStandardMaterial key={texture ? 'photo' : 'plain'} color={texture ? '#ffffff' : panel.color} map={texture} roughness={0.9} />
    </mesh>
  );
}

/**
 * Штора: складки смещены только от стены в комнату (0…1.5 см от плоскости панели), объём дорисовывают
 * вертикальные светло-тёмные полосы текстуры, умноженные на цвет панели.
 */
function CurtainPanel({ panel, position, rotationY, textures }: { panel: WallPanel; position: Vec3; rotationY: number; textures: RoomTextures }) {
  const geometry = useMemo(() => curtainGeometry(panel.width, panel.height), [panel.width, panel.height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} geometry={geometry} receiveShadow>
      <meshStandardMaterial color={panel.color} map={textures.curtain} roughness={1} />
    </mesh>
  );
}

function Panel({
  wall,
  panel,
  height,
  plan,
  showLabel,
  textures,
}: {
  wall: WallDef;
  panel: WallPanel;
  height: number;
  plan: boolean;
  showLabel: boolean;
  textures: RoomTextures;
}) {
  const { position, rotationY } = panelTransform(wall, panel);
  const f = wallFrame(wall);
  const along = panel.offset + panel.width / 2;
  const onWall = (out: number, y: number): Vec3 => [
    wall.from[0] + f.dir[0] * along + f.normal[0] * out,
    y,
    wall.from[1] + f.dir[1] * along + f.normal[1] * out,
  ];

  // Одинаковый размер у всех табличек, чтобы текст читался одинаково.
  const labelW = 1.6;
  const labelH = labelW / LABEL_ASPECT;
  // На плане табличка лежит на полу текстом к зрителю; у торцевых стен она уходит внутрь по ширине.
  const sideWall = Math.abs(f.normal[0]) > 0.5;
  const planOut = 0.2 + (sideWall ? labelW / 2 : labelH / 2);

  return (
    <>
      {panel.kind === 'curtain' ? (
        <CurtainPanel panel={panel} position={position} rotationY={rotationY} textures={textures} />
      ) : (
        <FlatPanel panel={panel} position={position} rotationY={rotationY} />
      )}

      {plan && panel.kind === 'opening' && (
        <mesh position={onWall(-WALL_THICKNESS / 2, height + 0.02)} rotation={[0, rotationY, 0]}>
          <boxGeometry args={[panel.width, 0.02, WALL_THICKNESS + 0.02]} />
          <meshBasicMaterial color="#e0cfa6" />
        </mesh>
      )}

      {showLabel && panel.label && !plan && (
        <Label
          text={panel.label}
          width={labelW}
          position={onWall(0.05, panel.bottom + panel.height - labelH / 2 - 0.12)}
          rotation={[0, rotationY, 0]}
        />
      )}
      {showLabel && panel.label && plan && (
        <Label text={panel.label} width={labelW} position={onWall(planOut, 0.2)} rotation={[-Math.PI / 2, 0, 0]} />
      )}
    </>
  );
}

/**
 * Облицовка одной грани колонны — плоскость на 2 мм перед гранью бокса: запечённое фото (texture) или процедурная
 * кладка (brick). Пока фото не загрузилось (или файла нет), грань с brick рисуется кирпичом, без brick — краской бокса.
 */
function ColumnSkin({ surface, face, textures }: { surface: WallSurface; face: ColumnFaceDef; textures: RoomTextures }) {
  const f = wallFrame(surface);
  const photo = usePanelTexture(face.texture);
  const brick = !photo && face.brick === true;
  const geometry = useMemo(
    () => tiledPlane(f.length, surface.height, brick ? BRICK_TILE[0] : f.length, brick ? BRICK_TILE[1] : surface.height),
    [f.length, surface.height, brick],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (!photo && !brick) return null;
  return (
    <mesh
      position={[f.mid[0] + f.normal[0] * SKIN, surface.height / 2, f.mid[1] + f.normal[1] * SKIN]}
      rotation={[0, f.rotationY, 0]}
      geometry={geometry}
      receiveShadow
    >
      <meshStandardMaterial key={photo ? 'photo' : 'brick'} color="#ffffff" map={photo ?? textures.brick} roughness={photo ? 0.9 : 0.95} />
    </mesh>
  );
}

/**
 * Колонна — сплошной бокс этапа 1 (есть верхняя грань: видна на плане и в облёте сверху и совпадает с тем, как колонну
 * учитывает выбор мышью), поверх него — плоскости описанных в column.faces граней.
 */
function Column({ column, height, surfaces, textures }: { column: ColumnDef; height: number; surfaces: Map<string, WallSurface>; textures: RoomTextures }) {
  return (
    <>
      <mesh position={[column.position[0], height / 2, column.position[1]]} castShadow receiveShadow>
        <boxGeometry args={[column.size[0], height, column.size[1]]} />
        <meshStandardMaterial color={column.color} roughness={0.9} />
      </mesh>
      {FACES.map((id) => {
        const face = column.faces?.[id];
        const surface = surfaces.get(`${column.id}:${id}`);
        if (!face || !surface || (!face.brick && !face.texture)) return null;
        return <ColumnSkin key={id} surface={surface} face={face} textures={textures} />;
      })}
    </>
  );
}

/** Пол: одноцветный или мозаичная крошка (повтор каждые 2 м) с тёмными полосами-вставками по осям колонн. */
function Floor({ room, textures }: { room: RoomDef; textures: RoomTextures }) {
  const { length, width } = room.size;
  const terrazzo = textures.terrazzo;
  const geometry = useMemo(() => tiledPlane(length, width, TERRAZZO_TILE, TERRAZZO_TILE), [length, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={geometry} receiveShadow>
        <meshStandardMaterial key={terrazzo ? 'terrazzo' : 'plain'} color={terrazzo ? '#ffffff' : room.floorColor} map={terrazzo} roughness={0.7} />
      </mesh>
      {/* Две тёмные полосы поперёк зала (фото 3, 4 и 6): по одной на ось каждой колонны, на 2 мм над полом. */}
      {terrazzo &&
        room.columns.map((c) => (
          <mesh key={c.id} position={[c.position[0], SKIN, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[INLAY_WIDTH, width]} />
            <meshStandardMaterial color={INLAY_COLOR} roughness={0.75} />
          </mesh>
        ))}
    </>
  );
}

export function RoomShell({ room, mode, showLabels }: { room: RoomDef; mode: CameraMode; showLabels: boolean }) {
  const { length, width, height } = room.size;
  const plan = mode === 'top';
  const wallById = new Map(room.walls.map((w) => [w.id, w]));
  const surfaces = useMemo(() => new Map(wallSurfaces(room).map((s) => [s.id, s])), [room]);
  const textures = useRoomTextures(room.floorSurface ?? 'plain', room.floorColor);

  return (
    <group>
      <Floor room={room} textures={textures} />

      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[length, width]} />
        <meshStandardMaterial color={room.ceilingColor} roughness={1} />
      </mesh>

      {room.walls.map((w) => (
        <Wall key={w.id} wall={w} height={height} plan={plan} />
      ))}

      {room.panels.map((p) => {
        const wall = wallById.get(p.wall);
        return wall ? <Panel key={p.id} wall={wall} panel={p} height={height} plan={plan} showLabel={showLabels} textures={textures} /> : null;
      })}

      {room.columns.map((c) => (
        <Column key={c.id} column={c} height={height} surfaces={surfaces} textures={textures} />
      ))}

      {room.platforms.map((p) => (
        <mesh
          key={p.id}
          position={[(p.min[0] + p.max[0]) / 2, p.height / 2, (p.min[1] + p.max[1]) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[p.max[0] - p.min[0], p.height, p.max[1] - p.min[1]]} />
          <meshStandardMaterial color={p.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
