// Значки панелей: простые контурные SVG 16×16 в цвете текста. Без библиотек.
import type { MountKind } from '../model/types';

export type IconName = MountKind | 'eye' | 'eyeOff' | 'lock' | 'unlock' | 'copy' | 'trash' | 'search';

const PATHS: Record<IconName, string[]> = {
  // Ящик на линии пола.
  floor: ['M1.5 13.5h13', 'M5 13.5v-6h6v6'],
  // Ящик, прижатый к вертикальной стене слева.
  wall: ['M2.5 1.5v13', 'M2.5 5h6.5v6H2.5'],
  // Ящик, подвешенный к линии потолка.
  ceiling: ['M1.5 2.5h13', 'M8 2.5v3', 'M5 5.5h6v5.5H5z'],
  // Ящик на столешнице.
  surface: ['M1.5 9.5h13', 'M4 9.5v5', 'M12 9.5v5', 'M6 9.5v-4.5h4v4.5'],
  eye: ['M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z', 'M10 8a2 2 0 1 1-4 0a2 2 0 0 1 4 0z'],
  eyeOff: [
    'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z',
    'M10 8a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
    'M2.5 2.5l11 11',
  ],
  lock: ['M4 7.5h8v6H4z', 'M5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2'],
  unlock: ['M4 7.5h8v6H4z', 'M5.5 7.5v-2a2.5 2.5 0 0 1 4.8-1'],
  copy: ['M6 6h7.5v7.5H6z', 'M10 6V2.5H2.5V10H6'],
  trash: ['M3 4.5h10', 'M6.5 4.5V3h3v1.5', 'M4.5 4.5l.6 9h5.8l.6-9', 'M6.8 7v4', 'M9.2 7v4'],
  search: ['M11 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0z', 'M10 10l3.5 3.5'],
};

/** Декоративный значок: смысл несёт подпись кнопки (aria-label / title) или текст рядом. */
export function Icon(props: { name: IconName; size?: number }) {
  const size = props.size ?? 16;
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[props.name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
