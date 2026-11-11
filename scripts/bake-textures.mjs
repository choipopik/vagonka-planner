// Запекание фототекстур стен: node scripts/bake-textures.mjs [room] [--only id] [--debug]
//
// Квады (углы прямоугольника стены на исходном фото) лежат в scripts/textures.json. Метрические размеры в JSON не
// дублируются: они берутся из определения помещения src/rooms/<room>.ts — по id панели или грани колонны.
// Математика — src/texture/homography.ts (Node снимает типы без сборки); sharp только декодирует и кодирует.
//
// Цикл настройки: правка JSON → npm run bake -- --debug → просмотр assets-src/<room>/_debug/*.jpg → правка.

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { outputSize, rectify } from '../src/texture/homography.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'scripts', 'textures.json');
const MAX_SIDE = 2048;
const OVERSAMPLE = 1.25;
/** Ниже этой плотности текстура на стене заметно мылит. */
const MIN_PX_PER_M = 60;
const DEFAULT_QUALITY = 82;
const FACES = ['n', 'e', 's', 'w'];
const DEBUG_COLORS = ['#00e5ff', '#ffe600', '#7dff5a', '#ff5ad1', '#ff8a00', '#ffffff'];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { room: null, only: null, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--debug') args.debug = true;
    else if (a === '--only') {
      args.only = argv[++i] ?? fail('После --only нужен id текстуры');
    } else if (a.startsWith('--only=')) args.only = a.slice('--only='.length);
    else if (a.startsWith('--')) fail(`Неизвестный флаг ${a}. Использование: node scripts/bake-textures.mjs [room] [--only id] [--debug]`);
    else if (args.room === null) args.room = a;
    else fail(`Лишний аргумент ${a}`);
  }
  return args;
}

function parseHex(hex, what) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) fail(`${what}: цвет должен быть вида #rrggbb, получено ${JSON.stringify(hex)}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isPair(v) {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function checkQuad(quad, what) {
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isPair)) {
    fail(`${what}: quad — четыре точки [x, y] в порядке верх-лево, верх-право, низ-право, низ-лево`);
  }
  return quad;
}

/** Определение помещения из src/rooms/<room>.ts (экспорт const <room>: RoomDef). null — импорт не удался. */
async function loadRoom(roomId) {
  const file = path.join(ROOT, 'src', 'rooms', `${roomId}.ts`);
  try {
    const mod = await import(pathToFileURL(file).href);
    const room = mod[roomId];
    if (!room || typeof room !== 'object') fail(`${path.relative(ROOT, file)} не экспортирует const ${roomId}`);
    return room;
  } catch (error) {
    console.warn(`! Не удалось импортировать ${path.relative(ROOT, file)}: ${error.message}`);
    console.warn('  Размеры будут взяты только из необязательного поля "metres" записей.');
    return null;
  }
}

/** Метры [ширина, высота] и цвет заливки по умолчанию для записи: из панели, грани колонны или поля metres. */
function resolveTarget(entry, room, what) {
  const hasPanel = typeof entry.panel === 'string';
  const hasColumn = typeof entry.column === 'string';
  if (hasPanel === hasColumn) fail(`${what}: нужен ровно один из ключей "panel" / "column"`);

  let metres = null;
  let color = null;
  let target = '';
  if (room) {
    if (hasPanel) {
      const panel = (room.panels ?? []).find((p) => p.id === entry.panel);
      if (!panel) {
        fail(`${what}: неизвестная панель "${entry.panel}". Допустимые: ${(room.panels ?? []).map((p) => p.id).join(', ')}`);
      }
      metres = [panel.width, panel.height];
      color = panel.color;
      target = `панель ${panel.id}`;
    } else {
      const allowed = (room.columns ?? []).flatMap((c) => FACES.map((f) => `${c.id}:${f}`));
      const [columnId, face] = entry.column.split(':');
      const column = (room.columns ?? []).find((c) => c.id === columnId);
      if (!column || !FACES.includes(face) || !allowed.includes(entry.column)) {
        fail(`${what}: неизвестная грань колонны "${entry.column}". Допустимые: ${allowed.join(', ')}`);
      }
      // Грани n / s идут вдоль X (size[0]), e / w — вдоль Z (size[1]); высота грани = высота помещения.
      metres = [face === 'n' || face === 's' ? column.size[0] : column.size[1], room.size.height];
      color = column.color;
      target = `грань ${entry.column}`;
    }
  } else {
    target = hasPanel ? `панель ${entry.panel}` : `грань ${entry.column}`;
  }

  if (entry.metres !== undefined) {
    if (!isPair(entry.metres) || !(entry.metres[0] > 0) || !(entry.metres[1] > 0)) fail(`${what}: "metres" — [ширина, высота] в метрах`);
    metres = entry.metres;
  }
  if (!metres) fail(`${what}: размеры неизвестны — помещение не импортировано и поля "metres" нет`);
  if (!(metres[0] > 0) || !(metres[1] > 0)) fail(`${what}: нулевой размер цели (${metres.join(' × ')} м)`);
  return { metres, color, target };
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

/** Один SVG-слой размером с фото: обводка каждого квада, номера углов и подпись id. Точки вне кадра обрезаются. */
function debugSvg(width, height, items) {
  const body = items
    .map(({ id, quad }, index) => {
      const color = DEBUG_COLORS[index % DEBUG_COLORS.length];
      const points = quad.map((p) => `${p[0]},${p[1]}`).join(' ');
      const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
      const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
      const tx = Math.min(width - 8, Math.max(8, cx));
      const ty = Math.min(height - 8, Math.max(20, cy));
      const corners = quad
        .map((p, k) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/><text x="${p[0] + 6}" y="${p[1] - 6}" font-size="14" fill="${color}" stroke="#000" stroke-width="0.6">${k + 1}</text>`)
        .join('');
      return (
        `<polygon points="${points}" fill="none" stroke="#000" stroke-width="4" stroke-opacity="0.6"/>` +
        `<polygon points="${points}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="2"/>` +
        corners +
        `<text x="${tx}" y="${ty}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="${color}" stroke="#000" stroke-width="1" paint-order="stroke">${escapeXml(id)}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

async function bakeRoom(roomId, config, args) {
  const srcDir = path.resolve(ROOT, config.srcDir ?? fail(`rooms.${roomId}: нет srcDir`));
  const outDir = path.resolve(ROOT, config.outDir ?? fail(`rooms.${roomId}: нет outDir`));
  const debugDir = path.join(srcDir, '_debug');
  const textures = Array.isArray(config.textures) ? config.textures : fail(`rooms.${roomId}: textures — массив`);

  const ids = new Set();
  for (const t of textures) {
    if (typeof t.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(t.id)) fail(`rooms.${roomId}: id текстуры — строчные латинские буквы, цифры и дефис (${JSON.stringify(t.id)})`);
    if (ids.has(t.id)) fail(`rooms.${roomId}: id "${t.id}" повторяется`);
    ids.add(t.id);
  }
  if (args.only && !ids.has(args.only)) fail(`rooms.${roomId}: нет текстуры "${args.only}". Есть: ${[...ids].join(', ')}`);

  const room = await loadRoom(roomId);

  // Сначала проверяем ВСЕ записи (неизвестный id панели — ошибка до первой записи файла), потом печём.
  const jobs = textures.map((t) => {
    const what = `rooms.${roomId}.textures["${t.id}"]`;
    if (typeof t.src !== 'string' || t.src.includes('..') || path.isAbsolute(t.src)) fail(`${what}: src — имя файла внутри srcDir`);
    const quad = checkQuad(t.quad, what);
    const { metres, color, target } = resolveTarget(t, room, what);
    const fill = parseHex(t.fill ?? color ?? '#000000', `${what}.fill`);
    const gain = t.gain ?? [1, 1, 1];
    if (!Array.isArray(gain) || gain.length !== 3 || !gain.every((g) => typeof g === 'number' && g >= 0 && Number.isFinite(g))) {
      fail(`${what}: gain — три неотрицательных множителя [r, g, b]`);
    }
    const quality = t.quality ?? DEFAULT_QUALITY;
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) fail(`${what}: quality — целое 1…100`);
    return { id: t.id, src: t.src, quad, metres, fill, gain, quality, target };
  });

  await mkdir(outDir, { recursive: true });
  if (args.debug) await mkdir(debugDir, { recursive: true });

  const decoded = new Map();
  const decode = async (name) => {
    if (!decoded.has(name)) {
      const file = path.join(srcDir, name);
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 3) fail(`${name}: ожидалось 3 канала после removeAlpha, получено ${info.channels}`);
      decoded.set(name, { data, width: info.width, height: info.height, channels: 3 });
    }
    return decoded.get(name);
  };

  let total = 0;
  let baked = 0;
  console.log(`Помещение «${roomId}»: ${path.relative(ROOT, srcDir)} → ${path.relative(ROOT, outDir)}`);
  for (const job of jobs) {
    if (args.only && job.id !== args.only) continue;
    const image = await decode(job.src);
    const [w, h] = outputSize(job.quad, job.metres, MAX_SIDE, OVERSAMPLE);
    const result = rectify(image, job.quad, w, h, { fill: job.fill, gain: job.gain });
    const out = path.join(outDir, `${job.id}.jpg`);
    const encode = (file) =>
      sharp(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength), {
        raw: { width: result.width, height: result.height, channels: 3 },
      })
        .jpeg({ quality: job.quality, mozjpeg: true })
        .toFile(file);
    await encode(out);
    if (args.debug) await encode(path.join(debugDir, `${job.id}.jpg`));

    const bytes = (await stat(out)).size;
    total += bytes;
    baked++;
    const density = Math.min(w / job.metres[0], h / job.metres[1]);
    console.log(
      `  ${job.id.padEnd(16)} ${job.src.padEnd(8)} → ${String(w).padStart(4)} × ${String(h).padEnd(4)} ` +
        `(${job.metres[0]} × ${job.metres[1]} м, ${Math.round(density)} px/м, ${(bytes / 1024).toFixed(0)} КБ) · ${job.target}`,
    );
    if (density < MIN_PX_PER_M) {
      console.warn(`  ! ${job.id}: плотность ${density.toFixed(0)} px/м меньше ${MIN_PX_PER_M} — квад мелкий на фото, текстура будет мылить`);
    }
    const [sw, sh] = [image.width, image.height];
    if (job.quad.some((p) => p[0] < 0 || p[0] > sw || p[1] < 0 || p[1] > sh)) {
      console.warn(`  ! ${job.id}: часть квада вне кадра ${sw} × ${sh} — эта область залита цветом fill`);
    }
  }
  console.log(`  Итого: ${baked} файл(ов), ${(total / 1024).toFixed(0)} КБ`);

  if (args.debug) {
    // По одному файлу на исходное фото: все его квады одним SVG-слоем (единственный дополнительный вызов sharp).
    const bySrc = new Map();
    for (const job of jobs) {
      if (!bySrc.has(job.src)) bySrc.set(job.src, []);
      bySrc.get(job.src).push(job);
    }
    for (const [name, items] of bySrc) {
      if (args.only && !items.some((j) => j.id === args.only)) continue;
      const image = await decode(name);
      const svg = debugSvg(image.width, image.height, items);
      const out = path.join(debugDir, `${path.parse(name).name}.jpg`);
      await sharp(path.join(srcDir, name))
        .composite([{ input: Buffer.from(svg) }])
        .jpeg()
        .toFile(out);
      console.log(`  отладка: ${path.relative(ROOT, out)} (${items.map((j) => j.id).join(', ')})`);
    }
  }
  return total;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  if (config.version !== 1) fail(`scripts/textures.json: неизвестная версия ${JSON.stringify(config.version)} (ожидалась 1)`);
  const rooms = config.rooms && typeof config.rooms === 'object' ? config.rooms : fail('scripts/textures.json: нет раздела rooms');
  const names = Object.keys(rooms);
  if (args.room && !names.includes(args.room)) fail(`Помещения "${args.room}" нет в scripts/textures.json. Есть: ${names.join(', ')}`);
  for (const name of args.room ? [args.room] : names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`Недопустимое имя помещения ${JSON.stringify(name)}`);
    await bakeRoom(name, rooms[name], args);
  }
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
