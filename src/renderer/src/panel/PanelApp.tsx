import { useEffect, useRef, useState } from 'react';
import type { PanelState } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { PetFace } from '../PetFace.tsx';

const bridge = window.jjakkungPanel;
const UNDO_MS = 5000;

export function PanelApp() {
  const [s, setS] = useState<PanelState>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ id: number; coins: number }>();
  const [showDone, setShowDone] = useState(false);
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    bridge.snapshot().then(setS);
    bridge.onState(setS);
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') bridge.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!s) return <div className="card-window panel" />;

  const add = async () => {
    const r = await bridge.add(text);
    if (!r.ok) {
      setError(r.error ?? '못 넣었어');
      return;
    }
    setText('');
    setError('');
  };

  const complete = async (t: Todo) => {
    const coins = await bridge.complete(t.id);
    clearTimeout(toastTimer.current);
    setToast({ id: t.id, coins });
    toastTimer.current = setTimeout(() => setToast(undefined), UNDO_MS);
  };

  const feed = async () => {
    const r = await bridge.feed();
    setFed(r.ok ? '냠냠' : '코인이 모자라');
    setTimeout(() => setFed(''), 1500);
  };

  const hungry = s.fullness < s.hungryBelow;

  return (
    <div className="card-window panel">
      <header>
        <PetFace />
        <strong>{s.petName}</strong>
        <span className="coins" title="코인: 할 일을 끝내면 생기고 밥을 줄 때 써">
          <CoinIcon />
          {s.balance}
        </span>
      </header>

      <div className="fullness">
        <span className="label">배부름</span>
        <span className={`track ${hungry ? 'low' : ''}`} aria-hidden="true">
          <span className="fill" style={{ width: `${s.fullness}%` }} />
        </span>
        <span className="value">{s.fullness}</span>
        <button
          type="button"
          className="ghost small"
          disabled={s.balance < s.foodCost}
          title={
            s.balance < s.foodCost ? `코인이 ${s.foodCost}개 있어야 해. 할 일을 끝내면 생겨.` : undefined
          }
          onClick={feed}
        >
          {fed || `밥 주기 ${s.foodCost}`}
        </button>
      </div>
      {hungry && <p className="hint hungry">{withParticle(s.petName, '이')} 배고파 보여.</p>}

      <div className="add">
        <input
          ref={inputRef}
          value={text}
          aria-label="할 일 추가"
          placeholder="할 일 추가 (예: 내일 보고서 쓰기!)"
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

      <ul className="todos">
        {s.open.length === 0 && (
          <li className="empty">할 일이 없어. 위에 적어 봐. "내일", "!"를 붙이면 마감과 중요 표시가 돼.</li>
        )}
        {s.open.map((t) => (
          <TodoRow key={t.id} todo={t} today={s.today} onComplete={() => complete(t)} />
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

      <footer>
        <button type="button" className="ghost" onClick={() => bridge.openChat()}>
          {withParticle(s.petName, '과')} 대화
        </button>
        <button type="button" className="ghost" onClick={() => bridge.lookTogether()}>
          같이 보기
        </button>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.coins > 0 ? `끝! 코인 ${toast.coins}개` : '끝! (오늘 코인은 다 받았어)'}</span>
          <button
            type="button"
            className="undo"
            onClick={() => {
              bridge.undo(toast.id);
              setToast(undefined);
            }}
          >
            되돌리기
          </button>
        </div>
      )}
    </div>
  );
}

function TodoRow({ todo: t, today, onComplete }: { todo: Todo; today: string; onComplete: () => void }) {
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
        <button type="button" className="title" title="눌러서 고치기" onClick={() => setEditing(true)}>
          {t.title}
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
    </li>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 6.2l2.4 2.4 4.6-4.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg className="coin" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3.6" className="inner" />
    </svg>
  );
}
