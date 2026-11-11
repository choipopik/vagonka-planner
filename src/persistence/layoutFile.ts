// Формат экспорта: один файл *.vagonka.json — макет и только те пользовательские файлы, на которые ссылаются объекты.
// Импорт — недоверенный ввод: каждое поле проверяется, ничего из файла не исполняется и не используется как HTML / URL.
import { ASSET_LIMITS, assetIdsOf, sniffMime } from '../model/assets';
import { newId } from '../model/layout';
import { LAYOUT_LIMITS, LAYOUT_PATTERNS, LayoutFormatError, parseLayout } from '../model/migrate';
import { reconcileVenue, sanitizeLayout } from '../model/ops';
import type { AssetKind, AssetMeta, AssetMime, Layout, RoomDef, Vec3 } from '../model/types';
import { rooms } from '../rooms';
import { RepositoryError } from './repository';
import type { LayoutRepository } from './repository';

export interface LayoutFile {
  format: 'vagonka-layout';
  version: 1;
  /** ISO 8601. */
  exportedAt: string;
  layout: Layout;
  /** Только файлы, на которые ссылаются объекты макета. */
  assets: { meta: AssetMeta; base64: string }[];
}

export interface ImportResult {
  layout: Layout;
  /** По-русски, для показа пользователю. */
  warnings: string[];
}

export const LAYOUT_FILE_FORMAT = 'vagonka-layout';
export const LAYOUT_FILE_VERSION = 1;
export const LAYOUT_FILE_EXTENSION = '.vagonka.json';

// ---------- base64 ----------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Код символа → 6 бит; −1 — символ не из алфавита. */
const DECODE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** Кратно 3: куски кодируются без дополнения и склеиваются в правильный base64. */
const ENCODE_CHUNK = 0x3000;

/** Кусками, без переполнения стека на больших буферах. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + ENCODE_CHUNK)));
  }
  return out;
}

/** Строгий разбор: только алфавит base64 и дополнение '=' в конце; на любом другом входе бросает Error. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const length = text.length;
  if (length % 4 !== 0) throw new Error('Неверный base64: длина не кратна четырём');
  let padding = 0;
  if (length > 0 && text.charCodeAt(length - 1) === 0x3d) padding = text.charCodeAt(length - 2) === 0x3d ? 2 : 1;

  const out = new Uint8Array((length / 4) * 3 - padding);
  const sextet = (index: number): number => {
    const code = text.charCodeAt(index);
    const value = code < 128 ? DECODE[code] : -1;
    if (value < 0) throw new Error('Неверный base64: посторонний символ');
    return value;
  };

  let o = 0;
  const full = padding > 0 ? length - 4 : length;
  for (let i = 0; i < full; i += 4) {
    const n = (sextet(i) << 18) | (sextet(i + 1) << 12) | (sextet(i + 2) << 6) | sextet(i + 3);
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 0xff;
    out[o++] = n & 0xff;
  }
  if (padding === 1) {
    const n = (sextet(full) << 18) | (sextet(full + 1) << 12) | (sextet(full + 2) << 6);
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 0xff;
  } else if (padding === 2) {
    const n = (sextet(full) << 18) | (sextet(full + 1) << 12);
    out[o++] = n >> 16;
  }
  return out;
}

// ---------- Экспорт ----------

/**
 * Собирает файл: макет как есть и файлы, на которые ссылаются его объекты (в порядке первого упоминания).
 * Файл, которого в хранилище уже нет, в сборку не попадает — объект при импорте будет показан заглушкой.
 */
export async function buildLayoutFile(layout: Layout, repo: LayoutRepository): Promise<LayoutFile> {
  const used = assetIdsOf(layout.objects);
  const metas = new Map<string, AssetMeta>();
  if (used.size > 0) for (const meta of await repo.listAssets()) metas.set(meta.id, meta);

  const assets: LayoutFile['assets'] = [];
  for (const id of used) {
    const meta = metas.get(id);
    if (!meta) continue;
    const blob = await repo.getAsset(id);
    if (!blob) continue;
    assets.push({ meta, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return {
    format: LAYOUT_FILE_FORMAT,
    version: LAYOUT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    layout: structuredClone(layout),
    assets,
  };
}

/** Имя файла экспорта: `<room>-<имя>-<yyyy-mm-dd>.vagonka.json` (дата местная; запрещённые в именах файлов символы → '-'). */
export function layoutFileName(roomId: string, name: string, date: Date): string {
  const clean = (text: string) =>
    text
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 60);
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${clean(roomId) || 'room'}-${clean(name) || 'maket'}-${day}${LAYOUT_FILE_EXTENSION}`;
}

// ---------- Импорт ----------

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Собственное свойство: унаследованное (в т. ч. подсунутое через __proto__) не читается. */
function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

const ASSET_NAME_LIMIT = 120;
/** Пределы «подсказок» из метаданных файла: пиксели картинки и габариты модели в метрах. */
const PIXELS_MAX = 65_536;
const NATURAL_SIZE_MAX = 10_000;
const MEGABYTE = 1_048_576;

function kindOf(mime: AssetMime): AssetKind {
  return mime.startsWith('image/') ? 'image' : 'model';
}

function pixels(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PIXELS_MAX ? value : undefined;
}

function naturalSizeOf(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const side = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= NATURAL_SIZE_MAX;
  const [x, y, z] = value as unknown[];
  return side(x) && side(y) && side(z) ? [x, y, z] : undefined;
}

/** Заявленный в файле mime попадает только в текст предупреждения — и только если похож на mime. */
function shownMime(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9.+/-]{1,40}$/.test(value) ? value : 'неизвестный тип';
}

/** Имя нового макета: при совпадении с существующим — « (импорт)», затем « (импорт 2)» и т. д.; не длиннее предела. */
function importedName(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim() || 'Импортированный макет';
  if (!taken.has(base)) return base;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (импорт)' : ` (импорт ${n})`;
    const candidate = base.slice(0, LAYOUT_LIMITS.name - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Проверяет, сохраняет вложенные файлы и макет в repo как НОВЫЙ (новый id, имя + « (импорт)» при совпадении).
 * Бросает LayoutFormatError / RepositoryError.
 *
 * Порядок: размер текста → JSON.parse → format / version → parseLayout (отброшенные объекты → предупреждение) →
 * помещение из roomIds → вложенные файлы (base64 → байты, предел размера, mime по сигнатуре, putAsset — id
 * пересчитывается из содержимого) → assetId объектов переписываются по карте «id из файла → настоящий id» →
 * reconcileVenue + sanitizeLayout → новый id → repo.save.
 *
 * roomOf — сверх спецификации (необязательный четвёртый параметр): откуда брать описание помещения для
 * reconcileVenue / sanitizeLayout; по умолчанию — реестр src/rooms. Тесты подставляют testRoom.
 */
export async function readLayoutFile(
  text: string,
  repo: LayoutRepository,
  roomIds: readonly string[],
  roomOf: (roomId: string) => RoomDef | undefined = (roomId) => rooms.find((r) => r.id === roomId),
): Promise<ImportResult> {
  if (text.length > ASSET_LIMITS.importFileBytes) {
    throw new LayoutFormatError('bad-layout', `Файл больше ${Math.round(ASSET_LIMITS.importFileBytes / MEGABYTE)} МБ`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LayoutFormatError('not-object', 'Файл не является JSON');
  }
  if (!isRecord(raw)) throw new LayoutFormatError('not-object', 'Это не файл макета Vagonka');
  if (own(raw, 'format') !== LAYOUT_FILE_FORMAT) throw new LayoutFormatError('bad-layout', 'Это не файл макета Vagonka');
  const version = own(raw, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new LayoutFormatError('bad-layout', 'В файле нет номера версии формата');
  }
  if (version > LAYOUT_FILE_VERSION) throw new LayoutFormatError('newer-version', 'Файл создан более новой версией');

  const warnings: string[] = [];

  // Макет: миграция и проверка по полям; плохие объекты отбрасываются.
  const dropped: string[] = [];
  const parsed = parseLayout(own(raw, 'layout'), (_index, reason) => dropped.push(reason));
  if (dropped.length > 0) {
    warnings.push(`Пропущено объектов с ошибками: ${dropped.length} (например: ${dropped[0]})`);
  }
  const room = roomIds.includes(parsed.roomId) ? roomOf(parsed.roomId) : undefined;
  if (!room) {
    throw new LayoutFormatError('bad-layout', `В файле помещение „${parsed.roomId}“, которого нет в этой версии`);
  }

  // Вложенные файлы. Берутся только те, на которые ссылаются объекты: лишнее в библиотеку не попадает.
  const wanted = assetIdsOf(parsed.objects);
  const idMap = new Map<string, string>();
  const list = own(raw, 'assets');
  if (list !== undefined && !Array.isArray(list)) warnings.push('Список вложенных файлов повреждён и пропущен');
  const entries: unknown[] = Array.isArray(list) ? list : [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const meta = isRecord(entry) ? own(entry, 'meta') : undefined;
    const base64 = isRecord(entry) ? own(entry, 'base64') : undefined;
    if (!isRecord(meta) || typeof base64 !== 'string') {
      warnings.push(`Вложенный файл № ${i + 1} повреждён и пропущен`);
      continue;
    }
    const fileId = own(meta, 'id');
    if (typeof fileId !== 'string' || !LAYOUT_PATTERNS.assetId.test(fileId)) {
      warnings.push(`Вложенный файл № ${i + 1} повреждён и пропущен`);
      continue;
    }
    if (!wanted.has(fileId) || idMap.has(fileId)) continue;

    const rawName = own(meta, 'name');
    const name = (typeof rawName === 'string' && rawName.trim() ? rawName : 'Без имени').slice(0, ASSET_NAME_LIMIT);

    // Грубая оценка размера до разбора base64: больше предела для моделей не бывает ни один файл.
    if (Math.floor((base64.length * 3) / 4) > ASSET_LIMITS.modelBytes + 2) {
      warnings.push(`Файл «${name}» больше ${Math.round(ASSET_LIMITS.modelBytes / MEGABYTE)} МБ и пропущен`);
      continue;
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(base64);
    } catch {
      warnings.push(`Файл «${name}» повреждён и пропущен`);
      continue;
    }
    const mime = sniffMime(bytes);
    if (mime === null) {
      warnings.push(`Файл «${name}» неизвестного формата и пропущен`);
      continue;
    }
    const kind = kindOf(mime);
    const limit = kind === 'image' ? ASSET_LIMITS.imageBytes : ASSET_LIMITS.modelBytes;
    if (bytes.length > limit) {
      warnings.push(`Файл «${name}» больше ${Math.round(limit / MEGABYTE)} МБ и пропущен`);
      continue;
    }
    if (own(meta, 'mime') !== mime) {
      warnings.push(`Файл «${name}»: в файле указан тип «${shownMime(own(meta, 'mime'))}», по содержимому это ${mime}`);
    }

    // Вид файла — по содержимому, а не по заявленному kind; размеры — только как проверенные числа.
    const info: Parameters<LayoutRepository['putAsset']>[1] = { kind, name };
    if (kind === 'image') {
      const width = pixels(own(meta, 'width'));
      const height = pixels(own(meta, 'height'));
      if (width !== undefined && height !== undefined) {
        info.width = width;
        info.height = height;
      }
    } else {
      const naturalSize = naturalSizeOf(own(meta, 'naturalSize'));
      if (naturalSize) info.naturalSize = naturalSize;
    }
    try {
      const stored = await repo.putAsset(new Blob([bytes], { type: mime }), info);
      idMap.set(fileId, stored.id);
    } catch (error) {
      // Нет места или хранилище недоступно — импорт прерывается; «неизвестный формат» после sniffMime сюда не дойдёт.
      if (error instanceof RepositoryError && error.code === 'corrupt') {
        warnings.push(`Файл «${name}» неизвестного формата и пропущен`);
        continue;
      }
      throw error;
    }
  }

  // Ссылки объектов: id из файла → настоящий id. Файл, которого нет во вложениях, но который уже лежит в библиотеке
  // под тем же id (id — это хеш содержимого), считается найденным.
  let unresolved = 0;
  const known = new Map<string, boolean>();
  const objects: Layout['objects'] = [];
  for (const object of parsed.objects) {
    if (object.assetId === null) {
      objects.push(object);
      continue;
    }
    const mapped = idMap.get(object.assetId);
    if (mapped !== undefined) {
      objects.push(mapped === object.assetId ? object : { ...object, assetId: mapped });
      continue;
    }
    let present = known.get(object.assetId);
    if (present === undefined) {
      present = (await repo.getAsset(object.assetId)) !== null;
      known.set(object.assetId, present);
    }
    if (!present) unresolved++;
    objects.push(object);
  }
  if (unresolved > 0) warnings.push(`Не найдены файлы для объектов: ${unresolved}. Они показаны заглушкой`);

  const existing = await repo.list();
  const names = new Set(existing.filter((m) => m.roomId === room.id).map((m) => m.name));
  const ids = new Set(existing.map((m) => m.id));
  let id = newId('layout');
  while (ids.has(id)) id = newId('layout');

  const restored = sanitizeLayout(reconcileVenue({ ...parsed, objects }, room), room);
  const layout: Layout = { ...restored, id, name: importedName(parsed.name, names), updatedAt: Date.now() };
  await repo.save(layout);
  return { layout, warnings };
}
