// Меню макетов (встраивается в Toolbar): кнопка с названием текущего макета → выпадающая панель со списком макетов
// помещения и действиями; рядом — постоянный индикатор сохранения. Работает и в режиме прогулки.
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { LAYOUT_LIMITS } from '../model/migrate';
import { useEditor } from '../store/editorStore';
import type { SaveStatus } from '../store/editorStore';
import { MEMORY_STORAGE_TEXT } from './index';
import type { LayoutMeta } from './repository';
import {
  createNamedLayout,
  deleteLayout,
  duplicateCurrentLayout,
  exportCurrentLayout,
  importLayoutFile,
  listLayouts,
  openLayoutById,
  renameCurrentLayout,
} from './session';
import './layouts.css';

const MEMORY_ADVICE = 'Чтобы не потерять работу, используйте «Экспорт в файл»';

const SAVE_STATUS: Record<SaveStatus, { text: string; tone: string; title: string }> = {
  saved: { text: 'Сохранено', tone: 'ok', title: 'Все изменения сохранены в этом браузере' },
  saving: { text: 'Сохранение…', tone: 'busy', title: 'Макет сохраняется' },
  dirty: { text: 'Не сохранено', tone: 'dirty', title: 'Есть несохранённые изменения — они сохранятся автоматически' },
  error: { text: 'Не сохранено', tone: 'error', title: 'Не удалось сохранить макет. Экспортируйте его в файл' },
};

type FormKind = 'new' | 'saveAs' | 'rename';

const FORMS: Record<FormKind, { title: string; submit: string; placeholder: string }> = {
  new: { title: 'Новый макет', submit: 'Создать', placeholder: 'Название (можно оставить пустым)' },
  saveAs: { title: 'Сохранить как…', submit: 'Сохранить копию', placeholder: 'Название копии' },
  rename: { title: 'Переименовать макет', submit: 'Переименовать', placeholder: 'Название макета' },
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function formatTime(updatedAt: number): string {
  return updatedAt > 0 ? dateFormat.format(new Date(updatedAt)) : '';
}

/**
 * Индикатор сохранения. При storage === 'memory' вместо него ВСЕГДА видна метка «Не сохраняется»: она зависит
 * только от поля состояния storage, а не от тоста, который исчезает через 5 с.
 */
function SaveBadge() {
  const storage = useEditor((s) => s.storage);
  const saveStatus = useEditor((s) => s.saveStatus);
  if (storage === 'memory') {
    return (
      <span className="layouts-status layouts-status-warn" title={`${MEMORY_STORAGE_TEXT}. ${MEMORY_ADVICE}`}>
        Не сохраняется
      </span>
    );
  }
  const status = SAVE_STATUS[saveStatus];
  return (
    <span className={`layouts-status layouts-status-${status.tone}`} title={status.title}>
      {status.text}
    </span>
  );
}

export function LayoutsMenu() {
  const layoutId = useEditor((s) => s.layout.id);
  const layoutName = useEditor((s) => s.layout.name);
  const roomId = useEditor((s) => s.roomId);
  const storage = useEditor((s) => s.storage);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LayoutMeta[]>([]);
  const [form, setForm] = useState<{ kind: FormKind; value: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Растёт после операций, меняющих список, но не текущий макет (удаление чужого макета). */
  const [revision, setRevision] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const formKind = form?.kind ?? null;

  // Список макетов помещения: при открытии панели и после каждой смены текущего макета, его имени или помещения.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listLayouts().then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, [open, layoutId, layoutName, roomId, revision]);

  // Щелчок мимо меню закрывает панель.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
        setForm(null);
        setConfirmId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  // Поле названия получает фокус при открытии формы.
  useEffect(() => {
    if (formKind === null) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [formKind]);

  const close = () => {
    setOpen(false);
    setForm(null);
    setConfirmId(null);
  };

  /** Одна операция за раз; ошибки показывает сама сессия (notify), наружу они не выходят. */
  const run = async (task: () => Promise<void>, closeAfter: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
      setRevision((n) => n + 1);
      if (closeAfter) close();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code !== 'Escape' || !open) return;
    // Escape закрывает сначала форму или подтверждение, затем панель; до горячих клавиш редактора не доходит.
    event.stopPropagation();
    if (form !== null) setForm(null);
    else if (confirmId !== null) setConfirmId(null);
    else {
      close();
      toggleRef.current?.focus();
    }
  };

  const openForm = (kind: FormKind) => {
    setConfirmId(null);
    const value = kind === 'rename' ? layoutName : kind === 'saveAs' ? `${layoutName} — копия`.slice(0, LAYOUT_LIMITS.name) : '';
    setForm({ kind, value });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form === null || busy) return;
    const { kind, value } = form;
    if (kind === 'rename') {
      renameCurrentLayout(value);
      setForm(null);
    } else if (kind === 'new') {
      void run(() => createNamedLayout(value), true);
    } else {
      void run(() => duplicateCurrentLayout(value), true);
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Сброс значения: повторный выбор того же файла снова вызовет change.
    event.target.value = '';
    if (file) void run(() => importLayoutFile(file), true);
  };

  const onDelete = (id: string) => {
    setConfirmId(null);
    void run(() => deleteLayout(id), false);
  };

  // Переименование работает и с пустым списком; имя из пробелов сессия проигнорирует.
  const submitDisabled = busy || (form?.kind === 'rename' && form.value.trim() === '');

  return (
    <div className="layouts-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="btn layouts-toggle"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Макет: ${layoutName}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="layouts-toggle-label">Макет</span>
        <span className="layouts-toggle-name">{layoutName}</span>
        <span className="layouts-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <SaveBadge />

      {open && (
        <div className="layouts-panel" id={panelId} role="group" aria-label="Макеты помещения">
          {storage === 'memory' && (
            <p className="layouts-note layouts-note-warn">
              {MEMORY_STORAGE_TEXT}. {MEMORY_ADVICE}.
            </p>
          )}

          <ul className="list layouts-list" aria-label="Макеты этого помещения">
            {items.map((item) => {
              const current = item.id === layoutId;
              const time = formatTime(item.updatedAt);
              return (
                <li key={item.id} aria-selected={current} className="layouts-item">
                  {confirmId === item.id ? (
                    <>
                      <span className="layouts-confirm">Удалить «{item.name}»?</span>
                      <button type="button" className="btn layouts-small layouts-danger" disabled={busy} onClick={() => onDelete(item.id)}>
                        Удалить
                      </button>
                      <button type="button" className="btn layouts-small" onClick={() => setConfirmId(null)}>
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="layouts-open"
                        disabled={busy || current}
                        aria-current={current ? 'true' : undefined}
                        title={current ? 'Этот макет открыт' : `Открыть «${item.name}»`}
                        onClick={() => void run(() => openLayoutById(item.id), true)}
                      >
                        <span className="layouts-name">{item.name}</span>
                        <span className="layouts-time">{current ? 'открыт' : time}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn layouts-delete"
                        disabled={busy}
                        aria-label={`Удалить макет «${item.name}»`}
                        title="Удалить макет"
                        onClick={() => {
                          setForm(null);
                          setConfirmId(item.id);
                        }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {form !== null ? (
            <form className="layouts-form" onSubmit={onSubmit}>
              <label className="layouts-form-label">
                <span>{FORMS[form.kind].title}</span>
                <input
                  ref={nameRef}
                  type="text"
                  value={form.value}
                  maxLength={LAYOUT_LIMITS.name}
                  placeholder={FORMS[form.kind].placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setForm({ kind: form.kind, value: event.target.value })}
                />
              </label>
              <div className="row">
                <button type="submit" className="btn layouts-small" disabled={submitDisabled}>
                  {FORMS[form.kind].submit}
                </button>
                <button type="button" className="btn layouts-small" onClick={() => setForm(null)}>
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <div className="layouts-actions">
              <button type="button" className="btn layouts-small" disabled={busy} onClick={() => openForm('new')}>
                Новый
              </button>
              <button type="button" className="btn layouts-small" disabled={busy} onClick={() => openForm('saveAs')}>
                Сохранить как…
              </button>
              <button type="button" className="btn layouts-small" disabled={busy} onClick={() => openForm('rename')}>
                Переименовать
              </button>
            </div>
          )}

          <div className="layouts-actions layouts-files">
            <button
              type="button"
              className="btn layouts-small"
              disabled={busy}
              title="Скачать макет одним файлом вместе с картинками и моделями"
              onClick={() => void run(() => exportCurrentLayout(), true)}
            >
              Экспорт в файл
            </button>
            <button
              type="button"
              className="btn layouts-small"
              disabled={busy}
              title="Открыть файл *.vagonka.json как новый макет"
              onClick={() => fileRef.current?.click()}
            >
              Импорт из файла
            </button>
            <input ref={fileRef} className="layouts-file-input" type="file" accept=".json" tabIndex={-1} aria-hidden="true" onChange={onFile} />
          </div>
        </div>
      )}
    </div>
  );
}
