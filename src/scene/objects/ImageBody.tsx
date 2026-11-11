// Тело объекта-картинки: `image` — стоячий лист (на стене, на ножках, на нитях под потолком), `image.flat` — лист плашмя.
// Текстура — из репозитория через assetCache; нет файла → заглушка.
import { memo } from 'react';
import { DoubleSide, FrontSide } from 'three';
import type { Texture } from 'three';
import { imageHasAlpha, useImageTexture } from '../../assets/assetCache';
import { buildInput } from '../../catalog';
import { GHOST_OPACITY } from '../../model/layers';
import type { MountKind, Vec3 } from '../../model/types';
import { dropOf, sameBody } from './bodyProps';
import type { BodyProps } from './bodyProps';
import { getGeometry } from './geometryCache';
import { HANGER_MIN_DROP, Hanger } from './Hanger';
import { CUTOUT_ALPHA, GHOST_RENDER_ORDER } from './materialCache';
import { Placeholder } from './Placeholder';

/** Толщина тёмной подложки, м. */
const BACKING = 0.01;
const BACKING_COLOR = '#1c1a1d';
/** Зазор между подложкой и листом, чтобы грани не мерцали, м. */
const SHEET_GAP = 0.001;
/** Сечение ножек и подкосов, м. */
const LEG = 0.02;
const LEG_COLOR = '#2a2622';

const FACE_UP: Vec3 = [-Math.PI / 2, 0, 0];
const FACE_DOWN: Vec3 = [Math.PI / 2, 0, 0];

interface Look {
  ghost: boolean;
  /** Отбрасывает тень (не призрак и не под потолком). */
  shadows: boolean;
}

/** Материал вспомогательных деталей (подложка, ножки); в призраке так же прозрачен на 30 %. */
function SolidMaterial({ color, ghost }: { color: string; ghost: boolean }) {
  return (
    <meshStandardMaterial
      key={ghost ? 'ghost' : 'solid'}
      color={color}
      roughness={0.9}
      transparent={ghost}
      opacity={ghost ? GHOST_OPACITY : 1}
      depthWrite={!ghost}
      side={ghost ? DoubleSide : FrontSide}
    />
  );
}

interface SheetProps extends Look {
  texture: Texture;
  /** Ширина и высота листа, м. */
  width: number;
  height: number;
  position: Vec3;
  rotation?: Vec3;
  tint: string;
  glow: boolean;
  doubleSided: boolean;
}

/** Сам лист с картинкой: плоскость лицом в локальный +Z. PNG / WebP — вырезанный силуэт (alphaTest). */
function Sheet({ texture, width, height, position, rotation, tint, glow, doubleSided, ghost, shadows }: SheetProps) {
  const alpha = imageHasAlpha(texture);
  const opacity = ghost ? GHOST_OPACITY : 1;
  const common = {
    map: texture,
    color: tint,
    transparent: ghost,
    opacity,
    depthWrite: !ghost,
    // Призрак двусторонний всегда: односторонний лист со спины иначе не виден вовсе.
    side: ghost || doubleSided ? DoubleSide : FrontSide,
    // alphaTest сравнивается с альфой после умножения на opacity — порог масштабируется вместе с ней.
    alphaTest: alpha ? CUTOUT_ALPHA * opacity : 0,
  };
  // Смена этих флагов требует новой шейдерной программы — материал пересоздаётся через key.
  const key = `${alpha ? 'cut' : 'full'}|${ghost ? 'ghost' : 'solid'}|${common.side}`;
  return (
    <mesh
      geometry={getGeometry('plane')}
      position={position}
      rotation={rotation}
      scale={[width, height, 1]}
      castShadow={shadows}
      receiveShadow={!glow && !ghost}
      renderOrder={ghost ? GHOST_RENDER_ORDER : 0}
    >
      {glow ? (
        <meshBasicMaterial key={key} {...common} toneMapped={false} />
      ) : (
        <meshStandardMaterial key={key} {...common} roughness={0.9} />
      )}
    </mesh>
  );
}

interface BoxProps extends Look {
  position: Vec3;
  size: Vec3;
  rotation?: Vec3;
  color: string;
}

function Box({ position, size, rotation, color, ghost, shadows }: BoxProps) {
  return (
    <mesh
      geometry={getGeometry('box')}
      position={position}
      rotation={rotation}
      scale={size}
      castShadow={shadows}
      receiveShadow={!ghost}
      renderOrder={ghost ? GHOST_RENDER_ORDER : 0}
    >
      <SolidMaterial color={color} ghost={ghost} />
    </mesh>
  );
}

export interface ImageLayoutProps extends Look {
  texture: Texture;
  size: Vec3;
  mount: MountKind;
  drop: number;
  tint: string;
  glow: boolean;
}

/** `image`: лист w × h в плоскости XY лицом в +Z. */
export function StandingImage({ texture, size, mount, drop, tint, glow, ghost, shadows }: ImageLayoutProps) {
  const [w, h, d] = size;
  const look = { ghost, shadows };
  const alpha = imageHasAlpha(texture);
  const sheet = { texture, width: w, height: h, tint, glow, ...look };

  if (mount === 'ceiling') {
    // Двусторонний лист на двух нитях от верхних углов до потолка.
    const inset = Math.min(0.05, w * 0.1);
    return (
      <>
        <Sheet {...sheet} position={[0, h / 2, 0]} doubleSided />
        {drop > HANGER_MIN_DROP && (
          <>
            <Hanger from={[-w / 2 + inset, h, 0]} length={drop} ghost={ghost} />
            <Hanger from={[w / 2 - inset, h, 0]} length={drop} ghost={ghost} />
          </>
        )}
      </>
    );
  }

  if (mount === 'wall') {
    // Спинка габарита (z = −d/2) обращена к стене: подложка прижата к ней, лист — перед подложкой.
    const back = -d / 2;
    return (
      <>
        {!alpha && <Box {...look} position={[0, h / 2, back + BACKING / 2]} size={[w, h, BACKING]} color={BACKING_COLOR} />}
        <Sheet {...sheet} position={[0, h / 2, back + BACKING + SHEET_GAP]} doubleSided={alpha} />
      </>
    );
  }

  // Пол и стол: тот же лист на двух ножках; на полу у каждой ножки ещё и подкос назад.
  const legX = Math.max(0, w / 2 - Math.max(LEG, w * 0.12));
  const legZ = -BACKING - LEG / 2;
  const braceTop = h * 0.65;
  const braceReach = Math.min(0.45, Math.max(0.08, h * 0.35));
  const braceLength = Math.hypot(braceTop, braceReach);
  // Подкос идёт от точки на ножке вниз и назад: ось Y бокса наклоняется вокруг X.
  const braceTilt = Math.atan2(braceReach, braceTop);
  return (
    <>
      {!alpha && <Box {...look} position={[0, h / 2, -BACKING / 2]} size={[w, h, BACKING]} color={BACKING_COLOR} />}
      <Sheet {...sheet} position={[0, h / 2, SHEET_GAP]} doubleSided={alpha} />
      {[-legX, legX].map((x) => (
        <group key={x}>
          <Box {...look} position={[x, h / 2, legZ]} size={[LEG, h, LEG]} color={LEG_COLOR} />
          {mount === 'floor' && (
            <Box
              {...look}
              position={[x, braceTop / 2, legZ - LEG / 2 - braceReach / 2]}
              rotation={[braceTilt, 0, 0]}
              size={[LEG, braceLength, LEG]}
              color={LEG_COLOR}
            />
          )}
        </group>
      ))}
    </>
  );
}

/** `image.flat`: лист w × d горизонтально — лицом вверх, под потолком — лицом вниз. */
export function FlatImage({ texture, size, mount, drop, tint, glow, ghost, shadows }: ImageLayoutProps) {
  const [w, h, d] = size;
  const look = { ghost, shadows };
  const alpha = imageHasAlpha(texture);
  const down = mount === 'ceiling';
  const sheet = { texture, width: w, height: d, tint, glow, ...look };
  // Подложка занимает толщину габарита, лист лежит на её лицевой стороне.
  const backing = Math.max(0, h - 2 * SHEET_GAP);
  const inset = Math.min(0.05, Math.min(w, d) * 0.1);
  return (
    <>
      {!alpha && backing > 0 && (
        <Box {...look} position={[0, down ? h - backing / 2 : backing / 2, 0]} size={[w, backing, d]} color={BACKING_COLOR} />
      )}
      {down ? (
        <Sheet {...sheet} position={[0, alpha ? h / 2 : 0, 0]} rotation={FACE_DOWN} doubleSided={alpha} />
      ) : (
        <Sheet {...sheet} position={[0, alpha ? h / 2 : h, 0]} rotation={FACE_UP} doubleSided={alpha} />
      )}
      {down &&
        drop > HANGER_MIN_DROP &&
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sx, sz]) => (
          <Hanger
            key={`${sx}|${sz}`}
            from={[sx * (w / 2 - inset), h, sz * (d / 2 - inset)]}
            length={drop}
            ghost={ghost}
          />
        ))}
    </>
  );
}

/** Тело объекта kind 'image'. */
export const ImageBody = memo(function ImageBody({ object, ghost }: BodyProps) {
  const { texture, status } = useImageTexture(object.assetId);
  // Пока файл читается, не рисуется ничего; нет файла или он не читается — заглушка.
  if (status === 'loading') return null;
  if (!texture) return <Placeholder size={object.size} ghost={ghost} />;

  const mount = object.mount.kind;
  const layout: ImageLayoutProps = {
    texture,
    size: object.size,
    mount,
    drop: dropOf(object),
    tint: object.color,
    glow: buildInput(object).params.glow === true,
    ghost,
    // Потолочный декор тень не отбрасывает.
    shadows: !ghost && mount !== 'ceiling',
  };
  return object.type === 'image.flat' ? <FlatImage {...layout} /> : <StandingImage {...layout} />;
}, sameBody);
