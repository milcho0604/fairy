import { useEffect, useRef, useState } from 'react';
import { type I18nKey, t } from '../../../shared/i18n/index.ts';
import type { EventClash, PanelState, PanelTab } from '../../../shared/ipc.ts';
import { nextUnlock } from '../../../shared/pet-life.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { PetFace } from '../PetFace.tsx';
import { EventTab } from './EventTab.tsx';
import { addedText, timeOf, whenLabel } from './format.ts';
import { CoinIcon, GearIcon } from './icons.tsx';
import { escClosesWindow, tabByKey, undoByKey } from './keys.ts';
import { NoteTab } from './NoteTab.tsx';
import { ShopTab } from './ShopTab.tsx';
import { TodayTab } from './TodayTab.tsx';
import { TodoTab } from './TodoTab.tsx';

const bridge = window.jjakkungPanel;
const UNDO_MS = 5000;
/** 일정으로 넣은 알림은 고를 것이 둘이라(되돌리기, 할 일로) 조금 더 둔다 */
const CHOICE_MS = 8000;
/** 알림에 마우스를 올렸다 떼면 이만큼 더 둔다 */
const LINGER_MS = 2500;
const TABS: { id: PanelTab; label: I18nKey }[] = [
  { id: 'today', label: 'panel.tab.today' },
  { id: 'todo', label: 'panel.tab.todo' },
  { id: 'note', label: 'panel.tab.note' },
  { id: 'event', label: 'panel.tab.event' },
  { id: 'shop', label: 'panel.tab.shop' },
];
const TAB_KEY = 'jj.panel.tab';
const MAC = navigator.userAgent.includes('Mac');
/** 탭 풀이와 설정 단축키 칸에 보이는 수식키 */
const MOD = MAC ? 'Cmd' : 'Ctrl';

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
  | { kind: 'todo-removed'; id: number }
  /** 할 일 칸에 적은 한 줄이 시각이 있어 일정으로 들어갔다. text 는 적은 글 그대로 (할 일로 옮길 때) */
  | { kind: 'to-event'; id: number; startAt: number; text: string; clash?: EventClash }
  /** 지난 마감을 오늘로 옮겼다. 되돌리면 원래 마감으로 */
  | { kind: 'moved'; moved: { id: number; due: string | null }[] }
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

/** 마지막 탭을 기억한다 (다음에 열 때 그 탭) */
function rememberTab(next: PanelTab) {
  try {
    localStorage.setItem(TAB_KEY, next);
  } catch {
    // 저장 못 해도 이번에는 바뀐다
  }
}

export function PanelApp() {
  const [s, setS] = useState<PanelState>();
  const [tab, setTabState] = useState<PanelTab>(savedTab);
  const [toast, setToast] = useState<Toast>();
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 지금 알림의 되돌리기 (Cmd/Ctrl+Z). 되돌렸으면 true */
  const undoRef = useRef<() => boolean>(() => false);

  const setTab = (next: PanelTab) => {
    setTabState(next);
    rememberTab(next);
  };

  useEffect(() => {
    bridge.snapshot().then(setS);
    bridge.onState(setS);
    bridge.onTab((next) => setTabState(next));
    // 입력칸이 먼저 Esc 를 처리한다(비우기, 메모 목록으로). 한글 조합 중 Esc 는 조합만 끝낸다
    const onKey = (e: KeyboardEvent) => {
      if (escClosesWindow(e)) {
        bridge.close();
        return;
      }
      // Cmd/Ctrl + 1~5: 탭 옮기기
      const i = tabByKey(e, MAC, TABS.length);
      const next = i === undefined ? undefined : TABS[i];
      if (next) {
        e.preventDefault();
        setTabState(next.id);
        rememberTab(next.id);
        return;
      }
      // Cmd/Ctrl+Z: 쓰던 글이 없으면 방금 끝낸 것, 지운 것 되돌리기. 입력칸에 쓴 적이 있으면(다 지웠어도)
      // 입력칸 자체 되돌리기에 둔다 (지운 글을 되살리려던 Cmd+Z 가 할 일을 되살리고 글은 잃었다)
      const el = document.activeElement;
      const field =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value || (typed.has(el) ? 'typed' : '')
          : undefined;
      if (undoByKey(e, MAC, field) && undoRef.current()) e.preventDefault();
    };
    // 포커스를 받은 뒤 글을 고친 입력칸 (떠나면 잊는다)
    const typed = new WeakSet<EventTarget>();
    const onInput = (e: Event) => {
      if (e.target) typed.add(e.target);
    };
    const onBlur = (e: FocusEvent) => {
      if (e.target) typed.delete(e.target);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('input', onInput, true);
    window.addEventListener('focusout', onBlur, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('input', onInput, true);
      window.removeEventListener('focusout', onBlur, true);
    };
  }, []);

  // 할 일, 일정 탭은 열자마자 입력칸에 커서를 둔다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭이 바뀔 때와 처음 그릴 때만
  useEffect(() => {
    inputRef.current?.focus();
  }, [tab, !!s]);

  if (!s) return <div className="card-window panel" />;

  const hideToastIn = (ms: number) => {
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), ms);
  };
  const showToast = (next: Toast) => {
    setToast(next);
    hideToastIn(next.kind === 'to-event' ? CHOICE_MS : UNDO_MS);
  };
  /** 일정으로 들어간 한 줄을 할 일로 옮긴다 */
  const toTodo = async (toast: Extract<Toast, { kind: 'to-event' }>) => {
    const r = await bridge.eventToTodo(toast.id, toast.text);
    showToast({ kind: 'added', text: r.ok ? addedText(r, s.today) : (r.error ?? t('panel.retry')) });
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

  /** 알림의 되돌리기 (단추와 Cmd/Ctrl+Z 가 같이 쓴다) */
  const undoToast = (toast: Toast) => {
    if (toast.kind === 'done') bridge.undo(toast.id);
    if (toast.kind === 'note-removed') bridge.noteRestore(toast.id);
    if (toast.kind === 'event-removed') bridge.eventRestore(toast.id);
    if (toast.kind === 'todo-removed') bridge.restore(toast.id);
    if (toast.kind === 'to-event') bridge.eventRemove(toast.id);
    if (toast.kind === 'moved') bridge.undoMoveOverdue();
    setToast(undefined);
  };
  undoRef.current = () => {
    if (!toast || toast.kind === 'added') return false;
    undoToast(toast);
    return true;
  };

  return (
    <div className="card-window panel">
      <header>
        <PetFace />
        <strong>{s.petName}</strong>
        <span className="coins" title={t('panel.coinsHint')}>
          <CoinIcon />
          {s.balance}
        </span>
        {/* 설정은 펫 우클릭과 메뉴 막대에만 있어 찾기 어려웠다 */}
        <button
          type="button"
          className="icon-btn"
          aria-label={t('panel.openSettings')}
          title={t('panel.openSettings')}
          onClick={() => bridge.openSettings()}
        >
          <GearIcon />
        </button>
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
      {s.life.poutWhy && (
        <p className="hint sulk">{t('pout.panel', { name: s.petName, why: s.life.poutWhy })}</p>
      )}
      {hungry && <p className="hint hungry">{t('panel.hungry', { name: s.petName })}</p>}

      <nav className="tabs" aria-label={t('panel.nav')}>
        {TABS.map((tb, i) => (
          <button
            key={tb.id}
            type="button"
            title={t('panel.tabKey', { tab: t(tb.label), keys: `${MOD}+${i + 1}` })}
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

      {tab === 'today' && (
        <TodayTab
          s={s}
          onComplete={complete}
          goTo={setTab}
          onMoved={(moved) => showToast({ kind: 'moved', moved })}
        />
      )}
      {tab === 'todo' && (
        <TodoTab
          s={s}
          onComplete={complete}
          inputRef={inputRef}
          onAdded={(r, text) => {
            // 시각이 있어 일정으로 들어갔다: 언제로 넣었는지, 되돌리기, 할 일로
            if (r.kind === 'event')
              showToast({
                kind: 'to-event',
                id: r.id,
                startAt: r.startAt,
                text,
                ...(r.clash ? { clash: r.clash } : {}),
              });
            // 여러 줄 붙여 넣기: "할 일 3개 넣었어"
            if (r.kind === 'many') showToast({ kind: 'added', text: addedText(r, s.today) });
          }}
          onRemoved={(todo) => showToast({ kind: 'todo-removed', id: todo.id })}
        />
      )}
      {tab === 'note' && <NoteTab s={s} onRemoved={(id) => showToast({ kind: 'note-removed', id })} />}
      {tab === 'shop' && <ShopTab s={s} />}
      {tab === 'event' && (
        <EventTab s={s} inputRef={inputRef} onRemoved={(id) => showToast({ kind: 'event-removed', id })} />
      )}

      <footer>
        {/* 이름이 길어도 한 줄 (넘치면 말줄임, 전체는 풀이에) */}
        <button
          type="button"
          className="ghost"
          title={t('panel.chatWith', { name: s.petName })}
          onClick={() => bridge.openChat()}
        >
          {t('panel.chatWith', { name: s.petName })}
        </button>
        <button type="button" className="ghost" onClick={() => bridge.lookTogether()}>
          {t('panel.lookTogether')}
        </button>
      </footer>

      {toast && (
        // 읽는 동안(마우스를 올린 동안)은 사라지지 않는다
        <div
          className="toast"
          role="status"
          onMouseEnter={() => clearTimeout(toastTimer.current)}
          onMouseLeave={() => hideToastIn(LINGER_MS)}
        >
          {toast.kind === 'to-event' ? (
            // 언제로 넣었는지는 따로 한 줄 (좁아도 시각이 쪼개지지 않게)
            <span>
              {t('panel.toast.toEvent')}
              <strong className="toast-when">{whenLabel(toast.startAt, s.today)}</strong>
              {toast.clash && (
                <small className="toast-clash">
                  {t('assist.clash', { time: timeOf(toast.clash.startAt), title: toast.clash.title })}
                </small>
              )}
            </span>
          ) : (
            <span>{toastText(toast)}</span>
          )}
          {toast.kind !== 'added' && (
            // 단추는 한 묶음: 좁으면 둘이 같이 글 아래로 내려간다
            <div className="toast-actions">
              <button type="button" className="undo" title={`${MOD}+Z`} onClick={() => undoToast(toast)}>
                {t('panel.undo')}
              </button>
              {toast.kind === 'to-event' && (
                <button type="button" className="undo" onClick={() => toTodo(toast)}>
                  {t('panel.toast.asTodo')}
                </button>
              )}
            </div>
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
  if (toast.kind === 'todo-removed') return t('panel.toast.todoRemoved');
  if (toast.kind === 'to-event') return t('panel.toast.toEvent');
  if (toast.kind === 'moved') return t('assist.overdue.moved', { n: toast.moved.length });
  return toast.text;
}
