// Поля панелей. Текстовые и числовые поля коммитят значение по blur / Enter и между правками показывают то, что
// лежит в объекте (в том числе живые числа перетаскивания); ползунки, флажки, списки и цвет — на каждое изменение.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEditor } from '../store/editorStore';
import { formatMetres, normalizeHexColor, parseNumber } from './format';
import './panels.css';

/**
 * Черновик текста поля. Пока пользователь не начал печатать, черновика нет и поле показывает внешнее значение.
 * Ref дублирует состояние: Escape сбрасывает черновик и тут же вызывает blur — обработчик blur не должен увидеть
 * устаревший текст из замыкания.
 */
function useDraft(onCommit: (text: string) => void) {
  const latest = useRef<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  /** Макет, в котором начат ввод: незавершённая правка не должна попасть в другой макет (id мебели площадки общие). */
  const layoutAt = useRef<string | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  // Поле может исчезнуть, не потеряв фокус: клик в сцене меняет выбор раньше, чем браузер снимет фокус с поля, а
  // у удалённого из DOM элемента blur не приходит. Набранное значение коммитится при размонтировании — в тот объект,
  // для которого поле было нарисовано. В StrictMode лишний цикл effect → cleanup проходит с пустым черновиком.
  useEffect(
    () => () => {
      const value = latest.current;
      if (value === null) return;
      latest.current = null;
      if (useEditor.getState().layout.id === layoutAt.current) commitRef.current(value);
    },
    [],
  );
  const edit = (next: string | null) => {
    if (next !== null && latest.current === null) layoutAt.current = useEditor.getState().layout.id;
    latest.current = next;
    setText(next);
  };
  const commit = () => {
    const value = latest.current;
    if (value === null) return;
    edit(null);
    onCommit(value);
  };
  const cancel = () => edit(null);
  return { text, edit, commit, cancel };
}

function isEnter(e: KeyboardEvent): boolean {
  return e.code === 'Enter' || e.code === 'NumpadEnter';
}

/** Клавиши внутри поля не должны доходить до горячих клавиш редактора (Delete, Ctrl+Z, буквы режимов). */
function keepKeys(e: KeyboardEvent): void {
  e.stopPropagation();
}

/** Подпись над полем. */
export function Field(props: { label: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <label className={props.className ? `ui-field ${props.className}` : 'ui-field'} title={props.title}>
      <span className="ui-label">{props.label}</span>
      {props.children}
    </label>
  );
}

interface NumberInputProps {
  value: number;
  /** Вывод значения; по умолчанию метры с двумя знаками. */
  format?: (value: number) => string;
  /** Вызывается только с конечным числом, отличным от показанного. */
  onCommit: (value: number) => void;
  disabled?: boolean;
  /** Справочное значение: видно, но не редактируется. */
  readOnly?: boolean;
  ariaLabel?: string;
  title?: string;
}

/** Числовое поле без подписи: запятая или точка, коммит по blur / Enter, Escape отменяет ввод. */
export function NumberInput(props: NumberInputProps) {
  const { value, onCommit } = props;
  const shown = (props.format ?? formatMetres)(value);
  const draft = useDraft((text) => {
    const parsed = parseNumber(text);
    // Мусор не проходит; текст, равный показанному, — не правка (иначе округлённое значение затёрло бы точное).
    if (parsed === null || parsed === parseNumber(shown)) return;
    onCommit(parsed);
  });

  return (
    <input
      className="ui-number"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={draft.text ?? shown}
      disabled={props.disabled}
      readOnly={props.readOnly}
      aria-label={props.ariaLabel}
      title={props.title}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => draft.edit(e.target.value)}
      onBlur={draft.commit}
      onKeyDown={(e) => {
        keepKeys(e);
        if (isEnter(e)) {
          draft.commit();
        } else if (e.code === 'Escape') {
          draft.cancel();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Числовое поле с подписью над ним. */
export function NumberField(props: NumberInputProps & { label: string }) {
  const { label, ...input } = props;
  return (
    <Field label={label} title={props.title}>
      <NumberInput {...input} />
    </Field>
  );
}

interface TextInputProps {
  value: string;
  /** Вызывается с текстом (уже обрезанным до maxLength), отличным от текущего значения. */
  onCommit: (text: string) => void;
  maxLength?: number;
  /** Многострочное поле: Enter — новая строка, коммит по blur или Ctrl/Cmd + Enter. */
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

/** Текстовое поле без подписи: коммит по blur / Enter, Escape отменяет ввод. */
export function TextInput(props: TextInputProps) {
  const { value, onCommit, maxLength } = props;
  const draft = useDraft((text) => {
    const next = maxLength !== undefined ? text.slice(0, maxLength) : text;
    if (next !== value) onCommit(next);
  });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    keepKeys(e);
    if (isEnter(e) && (!props.multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      draft.commit();
    } else if (e.code === 'Escape') {
      draft.cancel();
      e.currentTarget.blur();
    }
  };
  const common = {
    value: draft.text ?? value,
    maxLength,
    disabled: props.disabled,
    placeholder: props.placeholder,
    'aria-label': props.ariaLabel,
    spellCheck: false,
    onBlur: draft.commit,
    onKeyDown,
  };

  if (props.multiline) {
    const lines = (draft.text ?? value).split('\n').length;
    return (
      <textarea
        className="ui-text"
        rows={Math.min(10, Math.max(3, lines))}
        {...common}
        onChange={(e) => draft.edit(e.target.value)}
      />
    );
  }
  return <input className="ui-text" type="text" autoComplete="off" {...common} onChange={(e) => draft.edit(e.target.value)} />;
}

/** Текстовое поле с подписью над ним. */
export function TextField(props: TextInputProps & { label: string }) {
  const { label, ...input } = props;
  return (
    <Field label={label}>
      <TextInput {...input} />
    </Field>
  );
}

/** Ползунок + числовое поле (+ единица). Ползунок сообщает каждое изменение (live = true), поле — по blur / Enter. */
export function SliderField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format: (value: number) => string;
  onChange: (value: number, live: boolean) => void;
  disabled?: boolean;
  /** Пояснение под полем. */
  note?: ReactNode;
}) {
  const { label, value, min, max, step, onChange, disabled } = props;
  return (
    <div className="ui-field">
      <span className="ui-label">{label}</span>
      <div className="ui-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          disabled={disabled}
          aria-label={label}
          onKeyDown={keepKeys}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next, true);
          }}
        />
        <NumberInput value={value} format={props.format} disabled={disabled} ariaLabel={label} onCommit={(next) => onChange(next, false)} />
        {props.unit && <span className="ui-unit">{props.unit}</span>}
      </div>
      {props.note}
    </div>
  );
}

/**
 * Цвет: системная палитра (каждое движение, live = true) и поле кода (по blur / Enter). Наружу уходит только
 * '#rrggbb' — другие виды цвета cmdPatch отбрасывает.
 */
export function ColorField(props: { label: string; value: string; onChange: (color: string, live: boolean) => void; disabled?: boolean }) {
  const { label, onChange, disabled } = props;
  const color = normalizeHexColor(props.value) ?? '#000000';
  return (
    <div className="ui-field">
      <span className="ui-label">{label}</span>
      <div className="ui-color">
        <input
          type="color"
          value={color}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            const next = normalizeHexColor(e.target.value);
            if (next) onChange(next, true);
          }}
        />
        <TextInput
          value={color}
          maxLength={7}
          disabled={disabled}
          ariaLabel={`${label}: код #rrggbb`}
          onCommit={(text) => {
            const next = normalizeHexColor(text);
            if (next && next !== color) onChange(next, false);
          }}
        />
      </div>
    </div>
  );
}

export function CheckField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className="check ui-check" title={props.title}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={props.label}>
      <select className="ui-select" value={props.value} disabled={props.disabled} onKeyDown={keepKeys} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Группа кнопок «один из»; выбранная — aria-pressed. */
export function Segmented<T extends string>(props: {
  /** Подпись группы для вспомогательных технологий. */
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
  /** Кнопки делят ширину контейнера поровну (в боковой панели). */
  fill?: boolean;
}) {
  return (
    <div className={props.fill ? 'segmented ui-seg-fill' : 'segmented'} role="group" aria-label={props.label} title={props.title}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={props.value === option.value}
          disabled={props.disabled}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
