import { describe, expect, it } from 'vitest';
import { lounge } from '../rooms/lounge';
import {
  clampToRoom,
  constrainWalk,
  floorAt,
  getSurface,
  nearestSurface,
  panelTransform,
  platformAt,
  snapTo,
  wallFrame,
  wallSurfaces,
} from './geometry';
import { createLayout } from './layout';
import { sanitizeLayout } from './ops';
import { ROTATION_STEP, makeContext, resolvePose } from './pose';
import { testRoom } from './testRoom';

// ---------- lounge: только утверждения, выведенные из его же данных ----------

const wallOf = (id: string) => lounge.walls.find((w) => w.id === id)!;

describe('lounge · стены', () => {
  it('нормали всех стен смотрят внутрь помещения', () => {
    for (const w of lounge.walls) {
      const f = wallFrame(w);
      // Скалярное произведение нормали и вектора «от середины стены к центру» положительно.
      expect(f.normal[0] * -f.mid[0] + f.normal[1] * -f.mid[1], w.id).toBeGreaterThan(0);
    }
  });

  it('длины стен в сумме дают периметр помещения', () => {
    const perimeter = lounge.walls.reduce((sum, w) => sum + wallFrame(w).length, 0);
    expect(perimeter).toBeCloseTo(2 * (lounge.size.length + lounge.size.width));
  });
});

describe('lounge · панели', () => {
  it('помещаются на своих стенах и под потолком', () => {
    for (const p of lounge.panels) {
      const f = wallFrame(wallOf(p.wall));
      expect(p.offset, p.id).toBeGreaterThanOrEqual(0);
      expect(p.offset + p.width, p.id).toBeLessThanOrEqual(f.length + 1e-9);
      expect(p.bottom + p.height, p.id).toBeLessThanOrEqual(lounge.size.height + 1e-9);
    }
  });

  it('каждая панель стоит перед своей стеной, offset отсчитывается от левого края', () => {
    for (const p of lounge.panels) {
      const w = wallOf(p.wall);
      const f = wallFrame(w);
      const { position, rotationY } = panelTransform(w, p);
      const dx = position[0] - w.from[0];
      const dz = position[2] - w.from[1];
      expect(dx * f.dir[0] + dz * f.dir[1], p.id).toBeCloseTo(p.offset + p.width / 2);
      const out = dx * f.normal[0] + dz * f.normal[1];
      expect(out, p.id).toBeGreaterThan(0);
      expect(out, p.id).toBeLessThan(0.1);
      expect(position[1], p.id).toBeCloseTo(p.bottom + p.height / 2);
      expect(rotationY, p.id).toBeCloseTo(f.rotationY);
    }
  });
});

describe('lounge · прогулка', () => {
  const radius = 0.3;

  it('не выпускает за стены', () => {
    const far = 10 * Math.max(lounge.size.length, lounge.size.width);
    const [x, z] = constrainWalk(lounge, far, -far, radius);
    expect(x).toBeCloseTo(lounge.size.length / 2 - radius);
    expect(z).toBeCloseTo(-lounge.size.width / 2 + radius);
  });

  it('выталкивает из каждой колонны', () => {
    for (const c of lounge.columns) {
      const [x, z] = constrainWalk(lounge, c.position[0] + c.size[0] / 4, c.position[1], radius);
      const inside =
        Math.abs(x - c.position[0]) < c.size[0] / 2 + radius - 1e-9 &&
        Math.abs(z - c.position[1]) < c.size[1] / 2 + radius - 1e-9;
      expect(inside, c.id).toBe(false);
    }
  });

  it('точка старта свободна', () => {
    const [sx, sz] = lounge.spawn.position;
    expect(constrainWalk(lounge, sx, sz, radius)).toEqual([sx, sz]);
  });

  it('подиум определяется по координатам', () => {
    for (const p of lounge.platforms) {
      const cx = (p.min[0] + p.max[0]) / 2;
      const cz = (p.min[1] + p.max[1]) / 2;
      expect(platformAt(lounge.platforms, cx, cz)?.id).toBe(p.id);
      expect(floorAt(lounge, cx, cz)).toBe(p.height);
    }
    const [sx, sz] = lounge.spawn.position;
    expect(platformAt(lounge.platforms, sx, sz)).toBeUndefined();
    expect(floorAt(lounge, sx, sz)).toBe(0);
  });
});

describe('lounge · мебель площадки', () => {
  it('макет получает независимую копию мебели', () => {
    const layout = createLayout(lounge);
    expect(layout.schemaVersion).toBe(2);
    expect(layout.objects).toEqual(lounge.fixtures);
    expect(layout.objects).toHaveLength(lounge.fixtures.length);
    const original = structuredClone(lounge.fixtures[0]);
    layout.objects[0].size[0] += 1;
    layout.objects[0].mount = { kind: 'floor', x: 0, z: 0, lift: 0 };
    expect(lounge.fixtures[0]).toEqual(original);
  });

  it('у объектов нет поля position, зато есть крепление, assetId и params', () => {
    for (const o of lounge.fixtures) {
      expect('position' in o, o.id).toBe(false);
      expect(o.origin, o.id).toBe('venue');
      expect(['floor', 'wall', 'ceiling', 'surface'], o.id).toContain(o.mount.kind);
      expect(o.assetId, o.id).toBeNull();
      // Параметры — простая запись (у ламп на проводах W1 вправе задать count / seed); {} — если параметров нет.
      expect(typeof o.params === 'object' && o.params !== null && !Array.isArray(o.params), o.id).toBe(true);
    }
    expect(new Set(lounge.fixtures.map((o) => o.id)).size).toBe(lounge.fixtures.length);
  });

  it('createLayout ставит мебель туда же, что этап 1: на пол или на подиум под ней', () => {
    const layout = createLayout(lounge);
    const ctx = makeContext(lounge, layout.objects);
    let onPodium = 0;
    for (const o of layout.objects) {
      const pose = resolvePose(o, ctx);
      const [x, y, z] = pose.position;
      if (o.mount.kind === 'floor') {
        expect(o.mount.lift, o.id).toBe(0);
        expect(y, o.id).toBe(floorAt(lounge, x, z));
        if (platformAt(lounge.platforms, x, z)) {
          onPodium++;
          expect(y, o.id).toBeGreaterThan(0);
        } else {
          expect(y, o.id).toBe(0);
        }
      } else if (o.mount.kind === 'ceiling') {
        expect(y + o.size[1], o.id).toBeCloseTo(lounge.size.height - o.mount.drop);
      }
    }
    // Кабинки и их столы стоят на подиуме, на его высоте. Список берётся по id мебели, а не по той же формуле,
    // что считает позу: если кабинку сдвинуть с подиума, проверка упадёт.
    const booths = layout.objects.filter((o) => o.id.startsWith('venue-booth-'));
    expect(booths.length).toBeGreaterThan(0);
    for (const o of booths) {
      const [x, y, z] = resolvePose(o, ctx).position;
      const platform = platformAt(lounge.platforms, x, z);
      expect(platform, o.id).toBeDefined();
      expect(platform!.height, o.id).toBeGreaterThan(0);
      expect(y, o.id).toBe(platform!.height);
    }
    expect(lounge.platforms.length).toBeGreaterThan(0);
    expect(onPodium).toBeGreaterThanOrEqual(booths.length);
  });

  it('мебель стоит внутри помещения', () => {
    const ctx = makeContext(lounge, lounge.fixtures);
    for (const o of lounge.fixtures) {
      const [x, , z] = resolvePose(o, ctx).position;
      expect(Math.abs(x), o.id).toBeLessThan(lounge.size.length / 2);
      expect(Math.abs(z), o.id).toBeLessThan(lounge.size.width / 2);
    }
  });

  it('все fixtures проходят sanitizeLayout без изменений', () => {
    const layout = createLayout(lounge);
    expect(sanitizeLayout(layout, lounge)).toBe(layout);
  });
});

// ---------- testRoom: чистая математика ----------

describe('wallFrame', () => {
  it('rotationY поворачивает локальный +Z в нормаль стены', () => {
    for (const s of wallSurfaces(testRoom)) {
      const f = wallFrame(s);
      expect(Math.sin(f.rotationY), s.id).toBeCloseTo(f.normal[0]);
      expect(Math.cos(f.rotationY), s.id).toBeCloseTo(f.normal[1]);
    }
  });
});

describe('wallSurfaces', () => {
  const surfaces = wallSurfaces(testRoom);

  it('4 стены, затем по 4 грани на колонну в порядке n, e, s, w', () => {
    expect(surfaces.map((s) => s.id)).toEqual(['far', 'right', 'near', 'left', 'col:n', 'col:e', 'col:s', 'col:w']);
    expect(surfaces).toHaveLength(testRoom.walls.length + 4 * testRoom.columns.length);
    for (const s of surfaces) expect(s.height).toBe(testRoom.size.height);
  });

  it('нормали стен смотрят внутрь, длины равны размерам помещения', () => {
    const byId = new Map(surfaces.map((s) => [s.id, wallFrame(s)]));
    expect(byId.get('far')!.normal[1]).toBeCloseTo(1);
    expect(byId.get('far')!.normal[0]).toBeCloseTo(0);
    expect(byId.get('right')!.normal[0]).toBeCloseTo(-1);
    expect(byId.get('near')!.normal[1]).toBeCloseTo(-1);
    expect(byId.get('left')!.normal[0]).toBeCloseTo(1);
    expect(byId.get('far')!.length).toBeCloseTo(10);
    expect(byId.get('near')!.length).toBeCloseTo(10);
    expect(byId.get('right')!.length).toBeCloseTo(6);
    expect(byId.get('left')!.length).toBeCloseTo(6);
  });

  it('нормали граней колонны смотрят от её центра, длины равны размерам колонны', () => {
    const col = testRoom.columns[0];
    const expected = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const;
    for (const face of ['n', 'e', 's', 'w'] as const) {
      const s = getSurface(testRoom, `col:${face}`)!;
      const f = wallFrame(s);
      expect(f.normal[0], face).toBeCloseTo(expected[face][0]);
      expect(f.normal[1], face).toBeCloseTo(expected[face][1]);
      // Середина грани отстоит от центра колонны по нормали.
      const out = (f.mid[0] - col.position[0]) * f.normal[0] + (f.mid[1] - col.position[1]) * f.normal[1];
      expect(out, face).toBeCloseTo(face === 'n' || face === 's' ? col.size[1] / 2 : col.size[0] / 2);
      expect(f.length, face).toBeCloseTo(face === 'n' || face === 's' ? col.size[0] : col.size[1]);
    }
  });

  it('`from` — слева для зрителя: зритель перед гранью видит from → to слева направо', () => {
    // Зритель смотрит против нормали (вектор взгляда f = −normal); его «право» в плоскости XZ — (−f.z, f.x).
    for (const s of surfaces) {
      const f = wallFrame(s);
      const right = [f.normal[1], -f.normal[0]];
      const span = [s.to[0] - s.from[0], s.to[1] - s.from[1]];
      expect(span[0] * right[0] + span[1] * right[1], s.id).toBeCloseTo(f.length);
    }
    // И явно, по координатам граней колонны (2, 0) размером 0.8 × 0.6.
    expect(getSurface(testRoom, 'col:s')).toMatchObject({ from: [1.6, 0.3], to: [2.4, 0.3] });
    expect(getSurface(testRoom, 'col:n')).toMatchObject({ from: [2.4, -0.3], to: [1.6, -0.3] });
    expect(getSurface(testRoom, 'col:e')).toMatchObject({ from: [2.4, 0.3], to: [2.4, -0.3] });
    expect(getSurface(testRoom, 'col:w')).toMatchObject({ from: [1.6, -0.3], to: [1.6, 0.3] });
  });

  it('имена: стена — name ?? id, грань — «колонна · сторона света»', () => {
    expect(getSurface(testRoom, 'far')!.name).toBe('far');
    expect(getSurface(testRoom, 'col:s')!.name).toBe('col · юг');
    const named = {
      ...testRoom,
      walls: testRoom.walls.map((w) => (w.id === 'far' ? { ...w, name: 'Дальняя стена' } : w)),
      columns: testRoom.columns.map((c) => ({ ...c, name: 'Колонна' })),
    };
    expect(getSurface(named, 'far')!.name).toBe('Дальняя стена');
    expect(wallSurfaces(named).slice(4).map((s) => s.name)).toEqual([
      'Колонна · север',
      'Колонна · восток',
      'Колонна · юг',
      'Колонна · запад',
    ]);
    expect(getSurface(testRoom, 'nope')).toBeUndefined();
    expect(getSurface(testRoom, 'col:x')).toBeUndefined();
  });
});

describe('floorAt / clampToRoom / snapTo', () => {
  it('floorAt на подиуме и вне его', () => {
    expect(floorAt(testRoom, -2, -2)).toBe(0.2);
    expect(floorAt(testRoom, 0, -1)).toBe(0.2); // граница подиума включена
    expect(floorAt(testRoom, 0.01, -2)).toBe(0);
    expect(floorAt(testRoom, -2, -0.99)).toBe(0);
    expect(floorAt(testRoom, 3, 2)).toBe(0);
  });

  it('clampToRoom зажимает в прямоугольник помещения, с отступом и без', () => {
    expect(clampToRoom(testRoom, 1, 2)).toEqual([1, 2]);
    expect(clampToRoom(testRoom, 100, -100)).toEqual([5, -3]);
    expect(clampToRoom(testRoom, -100, 100, 0.5)).toEqual([-4.5, 2.5]);
    expect(clampToRoom(testRoom, 4.8, 0, 0.5)).toEqual([4.5, 0]);
    // Отступ больше половины помещения не выворачивает прямоугольник наизнанку.
    expect(clampToRoom(testRoom, 2, 2, 100)).toEqual([0, 0]);
    expect(clampToRoom(testRoom, NaN, Infinity)).toEqual([0, 0]);
  });

  it('snapTo округляет к шагу; step ≤ 0 → value', () => {
    expect(snapTo(1.24, 0.1)).toBeCloseTo(1.2, 12);
    expect(snapTo(1.26, 0.1)).toBeCloseTo(1.3, 12);
    expect(snapTo(0.3, 0.1)).toBe(0.3);
    expect(snapTo(-0.26, 0.1)).toBeCloseTo(-0.3, 12);
    expect(snapTo(0.37, 0.25)).toBe(0.25);
    expect(snapTo(1.2345, 0)).toBe(1.2345);
    expect(snapTo(1.2345, -1)).toBe(1.2345);
    expect(Object.is(snapTo(-0.01, 0.1), 0)).toBe(true);
    // Двоичный хвост десятичных шагов убирается…
    expect(snapTo(0.31, 0.1)).toBe(0.3);
    expect(snapTo(0.16, 0.05)).toBe(0.15);
    expect(snapTo(-0.7, 0.1)).toBe(-0.7);
    expect(snapTo(123.44, 0.1)).toBe(123.4);
  });

  it('snapTo: результат — точное кратное шага и для недесятичного шага (ROTATION_STEP)', () => {
    expect(snapTo(Math.PI / 2, ROTATION_STEP)).toBe(Math.PI / 2);
    expect(snapTo(Math.PI / 2 + 0.1, ROTATION_STEP)).toBe(6 * ROTATION_STEP);
    for (let k = -48; k <= 48; k++) {
      expect(snapTo(k * ROTATION_STEP, ROTATION_STEP), `k = ${k}`).toBe(k * ROTATION_STEP + 0);
      expect(snapTo(k * ROTATION_STEP + 0.12, ROTATION_STEP), `k = ${k}, сдвиг +`).toBe(k * ROTATION_STEP + 0);
      expect(snapTo(k * ROTATION_STEP - 0.12, ROTATION_STEP), `k = ${k}, сдвиг −`).toBe(k * ROTATION_STEP + 0);
    }
    // Шаг, не представимый ни в двоичном, ни в десятичном виде.
    expect(snapTo(2.1, 1 / 3)).toBe(6 * (1 / 3));
  });
});

describe('nearestSurface', () => {
  it('у каждой стены — эта стена, along отсчитывается от from', () => {
    const far = nearestSurface(testRoom, -3, -2.5);
    expect(far.surface.id).toBe('far');
    expect(far.along).toBeCloseTo(2);
    expect(far.distance).toBeCloseTo(0.5);

    const right = nearestSurface(testRoom, 4.6, 1);
    expect(right.surface.id).toBe('right');
    expect(right.along).toBeCloseTo(4);
    expect(right.distance).toBeCloseTo(0.4);

    const near = nearestSurface(testRoom, -4, 2.8);
    expect(near.surface.id).toBe('near');
    expect(near.along).toBeCloseTo(9);
    expect(near.distance).toBeCloseTo(0.2);

    const left = nearestSurface(testRoom, -4.7, 1);
    expect(left.surface.id).toBe('left');
    expect(left.along).toBeCloseTo(2);
    expect(left.distance).toBeCloseTo(0.3);
  });

  it('в углу выбирается ближайшая из двух стен, along зажат в пределах стены', () => {
    const a = nearestSurface(testRoom, 4.9, -2.5);
    expect(a.surface.id).toBe('right');
    expect(a.along).toBeCloseTo(0.5);
    const b = nearestSurface(testRoom, 4.5, -2.9);
    expect(b.surface.id).toBe('far');
    expect(b.along).toBeCloseTo(9.5);
    // За пределами помещения along не выходит за отрезок, distance — до его конца.
    const out = nearestSurface(testRoom, 7, -3);
    expect(out.along).toBeGreaterThanOrEqual(0);
    expect(out.along).toBeLessThanOrEqual(wallFrame(out.surface).length);
    expect(out.distance).toBeCloseTo(2);
  });

  it('у колонны — её ближайшая грань', () => {
    const s = nearestSurface(testRoom, 2.1, 0.5);
    expect(s.surface.id).toBe('col:s');
    expect(s.along).toBeCloseTo(0.5);
    expect(s.distance).toBeCloseTo(0.2);
    expect(nearestSurface(testRoom, 2.6, 0).surface.id).toBe('col:e');
    expect(nearestSurface(testRoom, 1.4, 0.1).surface.id).toBe('col:w');
    expect(nearestSurface(testRoom, 2, -0.5).surface.id).toBe('col:n');
  });

  it('prefer: есть подходящие → ближайшая из них; нет → ближайшая из всех', () => {
    const wide = (min: number) => (s: { from: [number, number]; to: [number, number] }) => wallFrame(s).length >= min;
    // Рядом с колонной, но нужна поверхность не у́же 1.5 м → ближайшая стена.
    const preferred = nearestSurface(testRoom, 2.1, 0.5, wide(1.5));
    expect(preferred.surface.id).toBe('near');
    expect(preferred.along).toBeCloseTo(2.9);
    expect(preferred.distance).toBeCloseTo(2.5);
    // Фильтру не удовлетворяет ничто → как без фильтра.
    const none = nearestSurface(testRoom, 2.1, 0.5, wide(100));
    expect(none.surface.id).toBe('col:s');
    // Фильтр, пропускающий всё, ничего не меняет.
    expect(nearestSurface(testRoom, 2.1, 0.5, () => true).surface.id).toBe('col:s');
  });
});
