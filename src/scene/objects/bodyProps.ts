// Общие props «тел» объекта и сравнение для memo: тело не перерисовывается, пока объект только перемещается.
import type { SceneObject } from '../../model/types';

export interface BodyProps {
  /** Объект с применённым draft. */
  object: SceneObject;
  /** Рисовать призраком (решает только useIsGhosted в ObjectView). */
  ghost: boolean;
}

/** Опуск от потолка: от него зависит длина нитей; у остальных креплений — 0. */
export function dropOf(o: SceneObject): number {
  return o.mount.kind === 'ceiling' ? o.mount.drop : 0;
}

/**
 * true, если вид тела не изменился: те же type / size / color / assetId / params / mount.kind (и опуск от потолка).
 * Перемещение, поворот, имя, блокировка на тело не влияют — их отрабатывает группа позы в ObjectView.
 */
export function sameBody(prev: BodyProps, next: BodyProps): boolean {
  const a = prev.object;
  const b = next.object;
  if (prev.ghost !== next.ghost) return false;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.color === b.color &&
    a.assetId === b.assetId &&
    a.params === b.params &&
    a.mount.kind === b.mount.kind &&
    dropOf(a) === dropOf(b) &&
    (a.size === b.size || (a.size[0] === b.size[0] && a.size[1] === b.size[1] && a.size[2] === b.size[2]))
  );
}
