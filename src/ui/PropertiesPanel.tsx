// Свойства выбранного объекта (справа сверху). Поля строятся из записи каталога и крепления; каждая правка —
// patchObject(id, set, label, mergeKey): размер, крепление и блокировку проверяет cmdPatch, своей арифметики здесь нет.
import { useMemo } from 'react';
import { getItem, resolveParams } from '../catalog';
import type { CatalogItem, ParamDef } from '../catalog/types';
import type { ObjectPatch } from '../model/commands';
import { wallSurfaces } from '../model/geometry';
import { MAX_LIGHTS } from '../model/lights';
import { LAYOUT_LIMITS } from '../model/migrate';
import { HEAD_CLEARANCE, describeMount } from '../model/pose';
import type { MountReadout } from '../model/pose';
import type { MountKind, ParamValue, RoomDef, SceneObject, Vec3 } from '../model/types';
import { deleteObject, duplicateObject, patchObject, setObjectMount } from '../store/actions';
import { useEditor } from '../store/editorStore';
import { getObject, useActiveLightIds, useCanEdit, useSelected } from '../store/selectors';
import { CheckField, ColorField, Field, NumberField, NumberInput, Segmented, SelectField, SliderField, TextField, TextInput } from './fields';
import {
  MOUNT_HINTS,
  MOUNT_LABELS,
  formatMetres,
  formatPlain,
  rotationDegrees,
  snapToStep,
  stepDigits,
  textLimit,
  toRadians,
} from './format';
import { useSceneContext } from './hooks';
import { Icon } from './icons';
import './panels.css';

type Patch = (set: ObjectPatch, label: string, mergeKey?: string) => void;

const AXES: readonly { axis: 0 | 1 | 2; label: string; title: string }[] = [
  { axis: 0, label: 'Ш', title: 'Ширина' },
  { axis: 1, label: 'В', title: 'Высота' },
  { axis: 2, label: 'Г', title: 'Глубина' },
];

/** Куда светит прожектор при нулевом наклоне — по креплению (lightDirection в src/model/lights.ts). */
const TILT_NOTES: Record<MountKind, string> = {
  ceiling: '0° — строго вниз',
  floor: '0° — строго вверх',
  surface: '0° — строго вверх',
  wall: '0° — от стены, 90° — вниз',
};

function formatDegrees(value: number): string {
  return formatPlain(value, 1);
}

/** Новое случайное целое для параметра seed, отличное от текущего. */
function randomSeed(current: number): number {
  let next = current;
  while (next === current) next = Math.floor(Math.random() * 1_000_000_000);
  return next;
}

export function PropertiesPanel() {
  const selected = useSelected();
  if (!selected) {
    return (
      <section className="panel ui-props" aria-label="Свойства">
        <h2 className="panel-title">Свойства</h2>
        <p className="ui-empty">Ничего не выбрано</p>
      </section>
    );
  }
  // key: черновики полей не переезжают на другой объект при смене выбора.
  return <ObjectProperties key={selected.id} object={selected} />;
}

function ObjectProperties(props: { object: SceneObject }) {
  const o = props.object;
  const ctx = useSceneContext();
  const canEdit = useCanEdit();
  const activeLights = useActiveLightIds();
  const assetId = o.assetId;
  const assetName = useEditor((s) => (assetId === null ? undefined : s.assets.find((a) => a.id === assetId)?.name));

  const item = getItem(o.type);
  const readout = describeMount(o, ctx);
  /** Заблокированный объект принимает только locked и visible (cmdPatch), остальные поля выключены. */
  const disabled = !canEdit || o.locked;
  const patch: Patch = (set, label, mergeKey) => patchObject(o.id, set, label, mergeKey);

  const lightOff = o.kind === 'light' && o.visible && !activeLights.has(o.id);

  return (
    <section className="panel ui-props" aria-label="Свойства">
      <header className="ui-head">
        <h2 className="panel-title">Свойства</h2>
        <span className="ui-kind" title={o.origin === 'venue' ? 'Мебель площадки' : 'Декор'}>
          {item.title}
          {o.origin === 'venue' ? ' · площадка' : ''}
        </span>
      </header>

      {lightOff && (
        <p className="ui-badge ui-badge-warn" title={`Одновременно светят только первые ${MAX_LIGHTS} источников (по порядку в списке)`}>
          выключена: лимит {MAX_LIGHTS}
        </p>
      )}
      {o.locked && <p className="ui-note">Объект заблокирован: менять можно только видимость.</p>}

      <TextField
        label="Имя"
        value={o.name}
        maxLength={LAYOUT_LIMITS.name}
        disabled={disabled}
        onCommit={(text) => {
          const name = text.trim();
          if (name !== '' && name !== o.name) patch({ name }, 'Имя');
        }}
      />
      {assetName !== undefined && (
        <p className="ui-note ui-ellipsis" title={assetName}>
          Файл: {assetName}
        </p>
      )}

      <MountSwitch object={o} item={item} disabled={disabled} />
      <MountFields object={o} room={ctx.room} readout={readout} disabled={disabled} patch={patch} />
      <SizeFields object={o} item={item} disabled={disabled} patch={patch} />

      {item.colorable !== false && (
        <ColorField
          label="Цвет"
          value={o.color}
          disabled={disabled}
          onChange={(color, live) => patch({ color }, 'Цвет', live ? `color:${o.id}` : undefined)}
        />
      )}

      {item.params.length > 0 && <ParamFields object={o} item={item} disabled={disabled} patch={patch} />}

      <div className="ui-actions">
        <button
          type="button"
          className="btn"
          aria-pressed={o.locked}
          disabled={!canEdit}
          onClick={() => patch({ locked: !o.locked }, o.locked ? 'Разблокировать' : 'Заблокировать')}
        >
          <Icon name={o.locked ? 'lock' : 'unlock'} />
          {o.locked ? 'Разблокировать' : 'Заблокировать'}
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={!o.visible}
          disabled={!canEdit}
          onClick={() => patch({ visible: !o.visible }, o.visible ? 'Скрыть' : 'Показать')}
        >
          <Icon name={o.visible ? 'eye' : 'eyeOff'} />
          {o.visible ? 'Скрыть' : 'Показать'}
        </button>
        <button type="button" className="btn" disabled={!canEdit} title="Копия рядом с оригиналом (Ctrl+D)" onClick={() => duplicateObject(o.id)}>
          <Icon name="copy" />
          Дублировать
        </button>
        <button
          type="button"
          className="btn ui-danger"
          disabled={disabled}
          title={o.origin === 'venue' ? 'Мебель площадки не удаляется, а скрывается (Delete)' : 'Удалить (Delete)'}
          onClick={() => deleteObject(o.id)}
        >
          <Icon name="trash" />
          Удалить
        </button>
      </div>
      {o.origin === 'venue' && <p className="ui-note">Вернуть мебель площадки на место — кнопка «Сбросить мебель».</p>}
    </section>
  );
}

// ---------- Крепление ----------

function MountSwitch(props: { object: SceneObject; item: CatalogItem; disabled: boolean }) {
  const { object: o, item, disabled } = props;
  const current = o.mount.kind;
  // Сегменты — только из item.mounts; текущее крепление вне списка (мебель площадки, запасная запись) показано, но одно.
  const kinds = item.mounts.includes(current) ? item.mounts : [current, ...item.mounts];
  const options = kinds.map((kind) => ({ value: kind, label: MOUNT_LABELS[kind], title: MOUNT_HINTS[kind] }));

  const change = (to: MountKind) => {
    if (to === current) return;
    setObjectMount(o.id, to);
    if (getObject(o.id)?.mount.kind !== to) {
      useEditor
        .getState()
        .notify('warn', to === 'surface' ? 'Нет стола или другой опоры, на которую можно поставить предмет' : 'Не удалось сменить крепление');
    }
  };

  return (
    <div className="ui-field">
      <span className="ui-label">Крепление</span>
      {options.length > 1 ? (
        <Segmented label="Крепление" options={options} value={current} onChange={change} disabled={disabled} fill />
      ) : (
        <span className="ui-static">
          <Icon name={current} />
          {MOUNT_LABELS[current]}
        </span>
      )}
    </div>
  );
}

function RotationField(props: { object: SceneObject; disabled: boolean; patch: Patch }) {
  const { object: o, disabled, patch } = props;
  return (
    <NumberField
      label="Поворот, °"
      value={rotationDegrees(o.rotationY)}
      format={formatDegrees}
      disabled={disabled}
      onCommit={(deg) => patch({ rotationY: toRadians(deg) }, 'Поворот')}
    />
  );
}

function MountFields(props: { object: SceneObject; room: RoomDef; readout: MountReadout; disabled: boolean; patch: Patch }) {
  const { object: o, room, readout, disabled, patch } = props;
  const surfaces = useMemo(() => wallSurfaces(room), [room]);
  const m = o.mount;

  switch (m.kind) {
    case 'floor':
      return (
        <div className="ui-grid2">
          <NumberField label="X, м" value={m.x} disabled={disabled} onCommit={(x) => patch({ mount: { ...m, x } }, 'Положение')} />
          <NumberField label="Z, м" value={m.z} disabled={disabled} onCommit={(z) => patch({ mount: { ...m, z } }, 'Положение')} />
          <NumberField
            label="Высота над полом, м"
            title="Зазор между полом (или подиумом) и основанием"
            value={m.lift}
            disabled={disabled}
            onCommit={(lift) => patch({ mount: { ...m, lift } }, 'Высота над полом')}
          />
          <RotationField object={o} disabled={disabled} patch={patch} />
        </div>
      );

    case 'wall': {
      const half = o.size[0] / 2;
      const known = surfaces.some((s) => s.id === m.surfaceId);
      const options = surfaces.map((s) => ({ value: s.id, label: s.name }));
      if (!known) options.unshift({ value: m.surfaceId, label: '— поверхность не найдена —' });
      return (
        <>
          <SelectField
            label="Поверхность"
            value={m.surfaceId}
            options={options}
            disabled={disabled}
            onChange={(surfaceId) => patch({ mount: { ...m, surfaceId } }, 'Поверхность')}
          />
          <div className="ui-grid2">
            <NumberField
              label="От левого края, м"
              title="От левого края поверхности до левого края предмета"
              value={readout.leftEdge ?? m.along - half}
              disabled={disabled}
              onCommit={(left) => patch({ mount: { ...m, along: left + half } }, 'Положение')}
            />
            <NumberField
              label="Низ над полом, м"
              value={m.bottom}
              disabled={disabled}
              onCommit={(bottom) => patch({ mount: { ...m, bottom } }, 'Высота')}
            />
          </div>
          <p className="ui-note">Верх: {formatMetres(readout.topY)} м</p>
        </>
      );
    }

    case 'ceiling': {
      const low = readout.clearance < HEAD_CLEARANCE;
      return (
        <>
          <div className="ui-grid2">
            <NumberField label="X, м" value={m.x} disabled={disabled} onCommit={(x) => patch({ mount: { ...m, x } }, 'Положение')} />
            <NumberField label="Z, м" value={m.z} disabled={disabled} onCommit={(z) => patch({ mount: { ...m, z } }, 'Положение')} />
            <NumberField
              label="Опуск от потолка, м"
              title="От потолка до верха предмета"
              value={m.drop}
              disabled={disabled}
              onCommit={(drop) => patch({ mount: { ...m, drop } }, 'Опуск от потолка')}
            />
            <RotationField object={o} disabled={disabled} patch={patch} />
          </div>
          <p className={low ? 'ui-note ui-warn' : 'ui-note'} role={low ? 'status' : undefined}>
            Низ на высоте {formatMetres(readout.clearance)} м
            {low && ` — ниже ${formatPlain(HEAD_CLEARANCE, 1)} м, гости могут задеть головой`}
          </p>
        </>
      );
    }

    case 'surface':
      return (
        <>
          <div className="ui-host">
            <span className="ui-ellipsis" title={readout.hostName}>
              Стоит на: {readout.hostName ?? '—'}
            </span>
            <button type="button" className="btn ui-btn-small" disabled={disabled} onClick={() => setObjectMount(o.id, 'floor')}>
              Снять на пол
            </button>
          </div>
          <div className="ui-grid2">
            <RotationField object={o} disabled={disabled} patch={patch} />
          </div>
        </>
      );
  }
}

// ---------- Размер ----------

function SizeFields(props: { object: SceneObject; item: CatalogItem; disabled: boolean; patch: Patch }) {
  const { object: o, item, disabled, patch } = props;
  const fixed = item.resize === 'none';

  /** В patch уходит размер с ОДНОЙ заменённой осью; что из него получится, решает clampSize внутри cmdPatch. */
  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    const size: Vec3 = [o.size[0], o.size[1], o.size[2]];
    size[axis] = value;
    patch({ size }, 'Размер');
  };

  return (
    <div className="ui-field">
      <span className="ui-label" title="Ширина × высота × глубина">
        Размер Ш × В × Г, м
      </span>
      <div className="ui-size">
        {AXES.map(({ axis, label, title }) => {
          const readOnly = fixed || item.flatAxis === axis;
          return (
            <label key={axis} className="ui-axis" title={readOnly && !fixed ? `${title}: толщина листа не меняется` : title}>
              <span>{label}</span>
              <NumberInput
                value={o.size[axis]}
                ariaLabel={`${title}, м`}
                disabled={disabled}
                readOnly={readOnly}
                onCommit={(value) => setAxis(axis, value)}
              />
            </label>
          );
        })}
      </div>
      {fixed && <span className="ui-note">Размер этого предмета не меняется.</span>}
      {item.resize === 'uniform' && <span className="ui-note">Пропорции сохраняются: остальные стороны меняются вместе.</span>}
    </div>
  );
}

// ---------- Параметры каталога ----------

function ParamFields(props: { object: SceneObject; item: CatalogItem; disabled: boolean; patch: Patch }) {
  const { object: o, item, disabled, patch } = props;
  const values = resolveParams(item, o.params);

  /** params патчится целиком; live — правка ползунком или палитрой, склеивается в один шаг undo. */
  const setParam = (def: ParamDef, value: ParamValue, live: boolean) => {
    patch({ params: { ...o.params, [def.key]: value } }, def.label, live ? `param.${def.key}:${o.id}` : undefined);
  };

  return (
    <div className="ui-params">
      <h3 className="ui-subtitle">Параметры</h3>
      {item.params.map((def) => (
        <ParamField key={def.key} def={def} value={values[def.key]} object={o} disabled={disabled} setParam={setParam} />
      ))}
    </div>
  );
}

function ParamField(props: {
  def: ParamDef;
  value: ParamValue | undefined;
  object: SceneObject;
  disabled: boolean;
  setParam: (def: ParamDef, value: ParamValue, live: boolean) => void;
}) {
  const { def, value, object: o, disabled, setParam } = props;

  switch (def.type) {
    case 'number': {
      const digits = stepDigits(def.step);
      const isTilt = o.type === 'light.spot' && def.key === 'tilt';
      return (
        <SliderField
          label={def.label}
          value={typeof value === 'number' ? value : def.default}
          min={def.min}
          max={def.max}
          step={def.step}
          unit={def.unit}
          format={(v) => formatPlain(v, digits)}
          disabled={disabled}
          onChange={(next, live) => setParam(def, snapToStep(next, def.min, def.max, def.step), live)}
          note={
            isTilt && (
              <span className="ui-note">
                {TILT_NOTES[o.mount.kind]}
                {o.mount.kind !== 'wall' && '. Наклон идёт в сторону «лица» предмета — его задаёт «Поворот, °».'}
              </span>
            )
          }
        />
      );
    }

    case 'boolean':
      return (
        <CheckField
          label={def.label}
          checked={typeof value === 'boolean' ? value : def.default}
          disabled={disabled}
          onChange={(checked) => setParam(def, checked, false)}
        />
      );

    case 'select':
      return (
        <SelectField
          label={def.label}
          value={typeof value === 'string' ? value : def.default}
          options={def.options}
          disabled={disabled}
          onChange={(next) => {
            if (def.options.some((option) => option.value === next)) setParam(def, next, false);
          }}
        />
      );

    case 'color':
      return (
        <ColorField
          label={def.label}
          value={typeof value === 'string' ? value : def.default}
          disabled={disabled}
          onChange={(color, live) => setParam(def, color, live)}
        />
      );

    case 'text': {
      const limit = textLimit(def.maxLength);
      return (
        <Field label={def.label}>
          <TextInput
            value={typeof value === 'string' ? value : def.default}
            maxLength={limit}
            multiline={def.multiline}
            disabled={disabled}
            onCommit={(text) => setParam(def, text.slice(0, limit), false)}
          />
        </Field>
      );
    }

    case 'seed': {
      const current = typeof value === 'number' && Number.isFinite(value) ? value : def.default;
      const named = def.label.trim().toLocaleLowerCase('ru') !== 'перемешать';
      return (
        <div className="ui-seed">
          {named && <span className="ui-label">{def.label}</span>}
          <button
            type="button"
            className="btn ui-btn-small"
            disabled={disabled}
            title="Другой случайный вариант"
            onClick={() => setParam(def, randomSeed(current), false)}
          >
            Перемешать
          </button>
        </div>
      );
    }
  }
}
