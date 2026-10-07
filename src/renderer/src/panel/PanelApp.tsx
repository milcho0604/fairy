import { useEffect, useRef, useState } from 'react';
import { type I18nKey, t } from '../../../shared/i18n/index.ts';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { nextUnlock } from '../../../shared/pet-life.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { PetFace } from '../PetFace.tsx';
import { EventTab } from './EventTab.tsx';
import { CoinIcon } from './icons.tsx';
import { NoteTab } from './NoteTab.tsx';
import { ShopTab } from './ShopTab.tsx';
import { TodayTab } from './TodayTab.tsx';
import { TodoTab } from './TodoTab.tsx';

const bridge = window.jjakkungPanel;
const UNDO_MS = 5000;
const TABS: { id: PanelTab; label: I18nKey }[] = [
  { id: 'today', label: 'panel.tab.today' },
  { id: 'todo', label: 'panel.tab.todo' },
  { id: 'note', label: 'panel.tab.note' },
  { id: 'event', label: 'panel.tab.event' },
  { id: 'shop', label: 'panel.tab.shop' },
];
const TAB_KEY = 'jj.panel.tab';

/** 마지막에 본 탭 (창은 열 때마다 새로 만들어서 브라우저 저장소에 둔다). 못 읽으면 오늘. */
function savedTab(): PanelTab {
  // 펫 메뉴 "상점"처럼 탭을 정해서 열면 주소 뒤에 붙어 온다
  const asked = location.hash.slice(1);
  if (TABS.some((tb) => tb.id === asked)) return asked as PanelTab;
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((tb) => tb.id === v) ? (v as PanelTab) : 'today';
  } catch {
    return 'today';
  }
}

type Toast =
  | { kind: 'done'; id: number; coins: number }
  | { kind: 'note-removed'; id: number }
  | { kind: 'event-removed'; id: number }
  | { kind: 'added'; text: string };

const UNLOCK_KEYS = {
  wave: 'panel.unlock.wave',
  dance: 'panel.unlock.dance',
  flower: 'panel.unlock.flower',
} as const;

/** 다음 친밀도 단계에 열리는 것 */
function unlockHint(affection: number): string {
  const next = nextUnlock(affection);
  if (!next) return t('panel.unlockAll');
  return t('panel.unlockNext', { step: next.step, what: t(UNLOCK_KEYS[next.unlock]) });
}

export function PanelApp() {
  const [s, setS] = useState<PanelState>();
  const [tab, setTabState] = useState<PanelTab>(savedTab);
  const [toast, setToast] = useState<Toast>();
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setTab = (next: PanelTab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // 저장 못 해도 이번에는 바뀐다
    }
  };

  useEffect(() => {
    bridge.snapshot().then(setS);
    bridge.onState(setS);
    bridge.onTab((next) => setTabState(next));
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

  const showToast = (next: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(undefined), UNDO_MS);
  };

  const complete = async (todo: Todo) => {
    const coins = await bridge.complete(todo.id);
    showToast({ kind: 'done', id: todo.id, coins });
  };

  const feed = async () => {
    const r = await bridge.feed();
    setFed(r.ok ? t('panel.fed') : t('panel.noCoins'));
    setTimeout(() => setFed(''), 1500);
  };

  const hungry = s.fullness < s.hungryBelow;

  return (
    <div className="card-window panel">
      <header>
        <PetFace />
        <strong>{s.petName}</strong>
        <span className="coins" title={t('panel.coinsHint')}>
          <CoinIcon />
          {s.balance}
        </span>
      </header>

      <div className="fullness">
        <span className="label">{t('panel.fullness')}</span>
        <span className={`track ${hungry ? 'low' : ''}`} aria-hidden="true">
          <span className="fill" style={{ width: `${s.fullness}%` }} />
        </span>
        <span className="value">{s.fullness}</span>
        <button
          type="button"
          className="ghost small"
          disabled={s.balance < s.foodCost || s.fullness >= 100}
          title={
            s.fullness >= 100
              ? t('pet.full')
              : s.balance < s.foodCost
                ? t('panel.feedNeed', { n: s.foodCost })
                : undefined
          }
          onClick={feed}
        >
          {fed || t('panel.feed', { n: s.foodCost })}
        </button>
      </div>
      <div className="life">
        <span title={t('panel.moodHint')}>{t('panel.mood', { n: s.life.mood })}</span>
        <span title={t('panel.affectionHint')}>{t('panel.affection', { n: s.life.affection })}</span>
        <small className="unlock-next" title={unlockHint(s.life.affection)}>
          {unlockHint(s.life.affection)}
        </small>
      </div>
      {s.life.sulk > 0 && <p className="hint sulk">{t('panel.sulk', { name: s.petName, n: s.life.sulk })}</p>}
      {hungry && <p className="hint hungry">{t('panel.hungry', { name: s.petName })}</p>}

      <nav className="tabs" aria-label={t('panel.nav')}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            className={tab === tb.id ? 'on' : ''}
            aria-current={tab === tb.id ? 'page' : undefined}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.label)}
            {tb.id === 'today' && s.focus.phase === 'focus' && (
              <i className="dot" title={t('panel.today.focusing')} />
            )}
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
            if (kind === 'event') showToast({ kind: 'added', text: t('panel.toast.toEvent') });
          }}
        />
      )}
      {tab === 'note' && <NoteTab s={s} onRemoved={(id) => showToast({ kind: 'note-removed', id })} />}
      {tab === 'shop' && <ShopTab s={s} />}
      {tab === 'event' && (
        <EventTab s={s} inputRef={inputRef} onRemoved={(id) => showToast({ kind: 'event-removed', id })} />
      )}

      <footer>
        <button type="button" className="ghost" onClick={() => bridge.openChat()}>
          {t('panel.chatWith', { name: s.petName })}
        </button>
        <button type="button" className="ghost" onClick={() => bridge.lookTogether()}>
          {t('panel.lookTogether')}
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
              {t('panel.undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toastText(toast: Toast): string {
  if (toast.kind === 'done')
    return toast.coins > 0 ? t('panel.toast.done', { n: toast.coins }) : t('panel.toast.doneNoCoin');
  if (toast.kind === 'note-removed') return t('panel.toast.noteRemoved');
  if (toast.kind === 'event-removed') return t('panel.toast.eventRemoved');
  return toast.text;
}
