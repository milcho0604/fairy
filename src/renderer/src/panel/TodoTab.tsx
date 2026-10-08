import { useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult, PanelState } from '../../../shared/ipc.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { REPEAT_LABEL, REPEATS, type Repeat, type Todo } from '../../../shared/todo-store.ts';
import { CheckIcon, RepeatIcon, StarIcon } from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';

const bridge = window.jjakkungPanel;
/** 쓰다 만 한 줄. 다른 곳을 눌러 패널이 닫혀도 다음에 열면 그대로 있다 */
const DRAFT_KEY = 'jj.panel.todoDraft';

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 못 적으면 이번 창에서만 남는다
  }
}

/** 없음 → 매일 → 평일 → 매주 → 없음 */
function nextRepeat(r: Repeat | null): Repeat | null {
  if (r === null) return REPEATS[0] ?? null;
  const i = REPEATS.indexOf(r);
  return REPEATS[i + 1] ?? null;
}

export function TodoTab({
  s,
  onComplete,
  inputRef,
  onAdded,
  onRemoved,
}: {
  s: PanelState;
  onComplete: (todo: Todo) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 넣었다. 넣은 글(text)도 같이 (일정으로 들어간 것을 알림에서 할 일로 옮길 때 쓴다) */
  onAdded: (r: Extract<PanelAddResult, { ok: true }>, text: string) => void;
  /** 지웠다 (되돌리기 알림) */
  onRemoved: (todo: Todo) => void;
}) {
  const [text, setTextState] = useState(readDraft);
  const setText = (next: string) => {
    setTextState(next);
    writeDraft(next);
  };
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);

  /** value 를 넣는다. 여러 줄 붙여 넣기면 칸에 적던 글은 그대로 둔다 */
  const add = async (value = text) => {
    const r = await bridge.add(value);
    if (!r.ok) {
      setError(r.error ?? t('panel.add.failed'));
      return;
    }
    if (value === text) setText('');
    setError('');
    onAdded(r, value);
  };

  return (
    <>
      <div className="add">
        <input
          ref={inputRef}
          value={text}
          aria-label={t('panel.todo.add')}
          placeholder={t('panel.todo.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add();
            // 쓰던 줄이 있으면 Esc 는 먼저 그것만 지운다 (한 번 더 누르면 패널이 닫힌다)
            if (isEsc(e) && text) {
              takeEsc(e);
              setText('');
              setError('');
            }
          }}
          onPaste={(e) => {
            // 여러 줄을 붙여 넣으면 줄마다 할 일 하나 (한 줄 칸이 줄바꿈을 지워 한 줄로 붙이지 않게)
            const pasted = e.clipboardData.getData('text');
            if (pasted.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
            e.preventDefault();
            void add(pasted);
          }}
        />
      </div>
      {error && <p className="hint error">{error}</p>}

      <ul className="todos scroll">
        {s.open.length === 0 && <li className="empty">{t('panel.todo.empty')}</li>}
        {s.open.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            today={s.today}
            onComplete={() => onComplete(todo)}
            onRemoved={() => onRemoved(todo)}
          />
        ))}
      </ul>

      {s.doneToday.length > 0 && (
        <div className="done">
          <button
            type="button"
            className="done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {t('panel.todo.doneToday', { n: s.doneToday.length })}
          </button>
          {showDone && (
            <ul className="todos">
              {s.doneToday.map((todo) => (
                <li key={todo.id} className="todo done-item">
                  <button
                    type="button"
                    className="check on"
                    aria-label={t('panel.todo.undoDone')}
                    onClick={() => bridge.undo(todo.id)}
                  >
                    <CheckIcon />
                  </button>
                  <span className="title">{todo.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export function TodoRow({
  todo,
  today,
  onComplete,
  onRemoved,
  compact,
}: {
  todo: Todo;
  today: string;
  onComplete: () => void;
  /** 지웠다 (되돌리기 알림) */
  onRemoved?: () => void;
  /** 오늘 탭: 고치기 단추 없이 */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const due = todo.due ? dueLabel(todo.due, today) : undefined;
  const repeatButton = (
    <button
      type="button"
      className={`repeat ${todo.repeat ? 'on' : ''}`}
      aria-label={
        todo.repeat
          ? t('panel.todo.repeatOn', { label: REPEAT_LABEL[todo.repeat] })
          : t('panel.todo.repeatOff')
      }
      title={
        todo.repeat
          ? t('panel.todo.repeatTitle', { label: REPEAT_LABEL[todo.repeat] })
          : t('panel.todo.repeat')
      }
      onClick={() => bridge.update(todo.id, { repeat: nextRepeat(todo.repeat) })}
    >
      <RepeatIcon />
      {todo.repeat && <span>{REPEAT_LABEL[todo.repeat]}</span>}
    </button>
  );
  const dueChip = (
    <label
      className={`due ${due?.overdue ? 'overdue' : ''} ${todo.due ? '' : 'none'}`}
      title={t('panel.todo.dueDate')}
    >
      {due?.text ?? t('panel.todo.due')}
      <input
        type="date"
        value={todo.due ?? ''}
        aria-label={t('panel.todo.dueDate')}
        onChange={(e) => bridge.update(todo.id, { due: e.target.value || null })}
      />
    </label>
  );
  return (
    <li className="todo">
      <button
        type="button"
        className="check"
        aria-label={t('panel.todo.complete', { title: todo.title })}
        onClick={onComplete}
      >
        <CheckIcon />
      </button>
      {editing ? (
        <input
          className="title-edit"
          value={title}
          aria-label={t('panel.todo.editTitle')}
          // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 바로 그 칸이라 커서가 가야 한다
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== todo.title) bridge.update(todo.id, { title });
            else setTitle(todo.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            if (isEsc(e)) {
              takeEsc(e);
              setTitle(todo.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="title"
          title={compact ? undefined : t('panel.todo.clickToEdit')}
          onClick={() => !compact && setEditing(true)}
        >
          {todo.title}
        </button>
      )}
      {/* 줄 끝 단추. 마우스를 올려야 나오는 것(extra)은 제목 위에 겹쳐 띄워 제목 폭과 줄 높이가 바뀌지 않게 */}
      <span className="tools">
        {(!compact || !todo.due) && (
          <span className="extra">
            {!compact && !todo.repeat && repeatButton}
            {!todo.due && dueChip}
            {!compact && (
              <button
                type="button"
                className="remove"
                aria-label={t('panel.todo.remove', { title: todo.title })}
                onClick={() => {
                  bridge.remove(todo.id);
                  onRemoved?.();
                }}
              >
                ×
              </button>
            )}
          </span>
        )}
        {!compact && todo.repeat && repeatButton}
        {todo.due && dueChip}
        {!compact && (
          <button
            type="button"
            className={`star ${todo.important ? 'on' : ''}`}
            aria-pressed={todo.important}
            aria-label={t('panel.todo.important')}
            onClick={() => bridge.update(todo.id, { important: !todo.important })}
          >
            <StarIcon />
          </button>
        )}
      </span>
    </li>
  );
}
