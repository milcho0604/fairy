import { useState } from 'react';
import type { PanelState } from '../../../shared/ipc.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { REPEAT_LABEL, REPEATS, type Repeat, type Todo } from '../../../shared/todo-store.ts';
import { CheckIcon, RepeatIcon, StarIcon } from './icons.tsx';

const bridge = window.jjakkungPanel;

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
}: {
  s: PanelState;
  onComplete: (t: Todo) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAdded: (kind: 'todo' | 'event') => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);

  const add = async () => {
    const r = await bridge.add(text);
    if (!r.ok) {
      setError(r.error ?? '못 넣었어');
      return;
    }
    setText('');
    setError('');
    onAdded(r.kind ?? 'todo');
  };

  return (
    <>
      <div className="add">
        <input
          ref={inputRef}
          value={text}
          aria-label="할 일 추가"
          placeholder="할 일 추가 (예: 내일 보고서 쓰기!, 매일 운동)"
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add();
          }}
        />
      </div>
      {error && <p className="hint error">{error}</p>}

      <ul className="todos scroll">
        {s.open.length === 0 && (
          <li className="empty">
            할 일이 없어. 위에 적어 봐. "내일", "!"를 붙이면 마감과 중요 표시, "매일", "평일", "매주"로
            시작하면 반복이 돼.
          </li>
        )}
        {s.open.map((t) => (
          <TodoRow key={t.id} todo={t} today={s.today} onComplete={() => onComplete(t)} />
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
            오늘 끝낸 일 {s.doneToday.length}
          </button>
          {showDone && (
            <ul className="todos">
              {s.doneToday.map((t) => (
                <li key={t.id} className="todo done-item">
                  <button
                    type="button"
                    className="check on"
                    aria-label="끝낸 것 되돌리기"
                    onClick={() => bridge.undo(t.id)}
                  >
                    <CheckIcon />
                  </button>
                  <span className="title">{t.title}</span>
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
  todo: t,
  today,
  onComplete,
  compact,
}: {
  todo: Todo;
  today: string;
  onComplete: () => void;
  /** 오늘 탭: 고치기 단추 없이 */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const due = t.due ? dueLabel(t.due, today) : undefined;
  return (
    <li className="todo">
      <button type="button" className="check" aria-label={`${t.title} 끝내기`} onClick={onComplete}>
        <CheckIcon />
      </button>
      {editing ? (
        <input
          className="title-edit"
          value={title}
          aria-label="할 일 제목 고치기"
          // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 바로 그 칸이라 커서가 가야 한다
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== t.title) bridge.update(t.id, { title });
            else setTitle(t.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTitle(t.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="title"
          title={compact ? undefined : '눌러서 고치기'}
          onClick={() => !compact && setEditing(true)}
        >
          {t.title}
        </button>
      )}
      {!compact && (
        <button
          type="button"
          className={`repeat ${t.repeat ? 'on' : ''}`}
          aria-label={
            t.repeat ? `반복: ${REPEAT_LABEL[t.repeat]} (눌러서 바꾸기)` : '반복 안 함 (눌러서 매일로)'
          }
          title={t.repeat ? `${REPEAT_LABEL[t.repeat]} 반복` : '반복'}
          onClick={() => bridge.update(t.id, { repeat: nextRepeat(t.repeat) })}
        >
          <RepeatIcon />
          {t.repeat && <span>{REPEAT_LABEL[t.repeat]}</span>}
        </button>
      )}
      <label className={`due ${due?.overdue ? 'overdue' : ''} ${t.due ? '' : 'none'}`} title="마감일">
        {due?.text ?? '마감'}
        <input
          type="date"
          value={t.due ?? ''}
          aria-label="마감일"
          onChange={(e) => bridge.update(t.id, { due: e.target.value || null })}
        />
      </label>
      {!compact && (
        <>
          <button
            type="button"
            className={`star ${t.important ? 'on' : ''}`}
            aria-pressed={t.important}
            aria-label="중요"
            onClick={() => bridge.update(t.id, { important: !t.important })}
          >
            <StarIcon />
          </button>
          <button
            type="button"
            className="remove"
            aria-label={`${t.title} 지우기`}
            onClick={() => bridge.remove(t.id)}
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}
