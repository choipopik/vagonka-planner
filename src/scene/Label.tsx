import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Vec3 } from '../model/types';

const PX_W = 512;
const PX_H = 128;
/** Отношение ширины таблички к высоте. */
export const LABEL_ASPECT = PX_W / PX_H;

/** Текстовая табличка, нарисованная на canvas (без загрузки шрифтов из сети). */
export function Label({ text, width, position, rotation }: { text: string; width: number; position: Vec3; rotation: Vec3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = PX_W;
    canvas.height = PX_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(12, 10, 10, 0.78)';
    ctx.beginPath();
    ctx.roundRect(4, 4, PX_W - 8, PX_H - 8, 28);
    ctx.fill();

    let fontSize = 64;
    const font = (s: number) => `600 ${s}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.font = font(fontSize);
    while (ctx.measureText(text).width > PX_W - 56 && fontSize > 20) {
      fontSize -= 4;
      ctx.font = font(fontSize);
    }
    ctx.fillStyle = '#f4efe6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, PX_W / 2, PX_H / 2 + 2);

    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, width / LABEL_ASPECT]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}
