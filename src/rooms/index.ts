import type { RoomDef } from '../model/types';
import { lounge } from './lounge';

/** Реестр помещений. Новое помещение = новый файл рядом + строка здесь. */
export const rooms: RoomDef[] = [lounge];

export function getRoom(id: string): RoomDef {
  return rooms.find((r) => r.id === id) ?? rooms[0];
}
