import { useEffect, useRef, useState } from 'react';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { PetFace } from '../PetFace.tsx';
import { EventTab } from './EventTab.tsx';
import { CoinIcon } from './icons.tsx';
import { NoteTab } from './NoteTab.tsx';
import { TodayTab } from './TodayTab.tsx';
import { TodoTab } from './TodoTab.tsx';

const bridge = window.jjakkungPanel;
const UNDO_MS = 5000;
const TABS: { id: PanelTab; label: string }[] = [
  { id: 'today', label: '오늘' },
  { id: 'todo', label: '할 일' },
  { id: 'note', label: '메모' },
  { id: 'event', label: '일정' },
];
const TAB_KEY = 'jj.panel.tab';

/** 마지막에 본 탭 (창은 열 때마다 새로 만들어서 브라우저 저장소에 둔다). 못 읽으면 오늘. */
function savedTab(): PanelTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? (v as PanelTab) : 'today';
  } catch {
    return 'today';
  }
}

type Toast =
  | { kind: 'done'; id: number; coins: number }
  | { kind: 'note-removed'; id: number }
  | { kind: 'event-removed'; id: number }
  | { kind: 'added'; text: string };

export function PanelApp() {
  const [s, setS] = useState<PanelState>();
  const [tab, setTabState] = useState<PanelTab>(savedTab);
  const [toast, setToast] = useState<Toast>();
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setTab = (t: PanelTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // 저장 못 해도 이번에는 바뀐다
    }
  };

  useEffect(() => {
    bridge.snapshot().then(setS);
    bridge.onState(setS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') bridge.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 할 일, 일정 탭은 열자마자 입력칸에 커서를 둔다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭이 바뀔 때와 처음 그릴 때만
  useEffect(() => {
    inputRef.current?.focus();
  }, [tab, !!s]);

  if (!s) return <div className="card-window panel" />;

  const showToast = (t: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(undefined), UNDO_MS);
  };

  const complete = async (t: Todo) => {
    const coins = await bridge.complete(t.id);
    showToast({ kind: 'done', id: t.id, coins });
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
        <span className="coins" title="코인: 할 일과 집중을 끝내면 생기고 밥을 줄 때 써">
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

      <nav className="tabs" aria-label="패널">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'on' : ''}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'today' && s.focus.phase === 'focus' && <i className="dot" title="집중하는 중" />}
          </button>
        ))}
      </nav>

      {tab === 'today' && <TodayTab s={s} onComplete={complete} goTo={setTab} />}
      {tab === 'todo' && (
        <TodoTab
          s={s}
          onComplete={complete}
          inputRef={inputRef}
          onAdded={(kind) => {
            if (kind === 'event') showToast({ kind: 'added', text: '시각이 있어서 일정에 넣었어' });
          }}
        />
      )}
      {tab === 'note' && <NoteTab s={s} onRemoved={(id) => showToast({ kind: 'note-removed', id })} />}
      {tab === 'event' && (
        <EventTab s={s} inputRef={inputRef} onRemoved={(id) => showToast({ kind: 'event-removed', id })} />
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
          <span>{toastText(toast)}</span>
          {toast.kind !== 'added' && (
            <button
              type="button"
              className="undo"
              onClick={() => {
                if (toast.kind === 'done') bridge.undo(toast.id);
                if (toast.kind === 'note-removed') bridge.noteRestore(toast.id);
                if (toast.kind === 'event-removed') bridge.eventRestore(toast.id);
                setToast(undefined);
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toastText(t: Toast): string {
  if (t.kind === 'done') return t.coins > 0 ? `끝! 코인 ${t.coins}개` : '끝! (오늘 코인은 다 받았어)';
  if (t.kind === 'note-removed') return '메모를 지웠어';
  if (t.kind === 'event-removed') return '일정을 지웠어';
  return t.text;
}
