import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { nextUnlock } from '../../../shared/pet-life.ts';
import {
  type KeptToast,
  liveToasts,
  splitToasts,
  TOAST_KEEP_MAX,
  type Toast,
  undoable,
} from '../../../shared/toast-keep.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { PetFace } from '../PetFace.tsx';
import { EventTab } from './EventTab.tsx';
import { addedText, timeOf, whenLabel } from './format.ts';
import { CoinIcon, GearIcon, PinIcon } from './icons.tsx';
import { escClosesSurface, tabStepByKey, undoByKey, undoFieldText } from './keys.ts';
import { PlanSheetHost } from './MorningPlan.tsx';
import { NoteTab } from './NoteTab.tsx';
import { planTodosKey } from './plan-refresh.ts';
import { ResizeGrips } from './ResizeGrips.tsx';
import { ShopTab } from './ShopTab.tsx';
import { SurfaceProvider } from './surface.tsx';
import { TodayTab } from './TodayTab.tsx';
import { TodoTab } from './TodoTab.tsx';
import { isTab, TABS, tabForKey, tabShortcut } from './tabs.ts';
import { useWide } from './use-wide.ts';

const bridge = window.jjakkungPanel;
const UNDO_MS = 8000;
/** 일정으로 넣은 알림은 고를 것이 둘이라(되돌리기, 할 일로) 조금 더 둔다 */
const CHOICE_MS = 10_000;
/** 알림에 마우스를 올렸다 떼면 이만큼 더 둔다 */
const LINGER_MS = 2500;
const TAB_KEY = 'jj.panel.tab';
/** 이 껍데기는 작은 패널이다 (큰 창의 껍데기는 'home') */
const SURFACE_KIND = 'panel';
const MAC = navigator.userAgent.includes('Mac');
/** 탭 풀이와 설정 단축키 칸에 보이는 수식키 */
const MOD = MAC ? 'Cmd' : 'Ctrl';

/** 마지막에 본 탭 (창은 열 때마다 새로 만들어서 브라우저 저장소에 둔다). 못 읽으면 오늘. */
function savedTab(): PanelTab {
  // 펫 메뉴 "상점"처럼 탭을 정해서 열면 주소 뒤에 붙어 온다
  const asked = location.hash.slice(1);
  if (isTab(asked)) return asked;
  try {
    const v = localStorage.getItem(TAB_KEY);
    return isTab(v) ? v : 'today';
  } catch {
    return 'today';
  }
}

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
  // 되돌리기 알림 (#145): 여럿이 쌓이고, 메인이 들고 있어 패널을 벗어났다 다시 열어도 남은 시간 동안 보인다
  const [toasts, setToasts] = useState<KeptToast[]>(() => liveToasts(bridge.toastsGet(), Date.now()));
  const toastKey = useRef(toasts.reduce((m, k) => Math.max(m, k.key), 0) + 1);
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  /** 덮개 자리: 본문 칸 위에 덮는 것(주간 카드, 줄 메뉴)을 면 기준으로 올린다 (surface.tsx) */
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  const surface = useMemo(
    () => ({ kind: SURFACE_KIND, close: () => bridge.close(), overlayRoot }) as const,
    [overlayRoot],
  );
  /** 본문 칸. 폭 구간은 data-zone 으로 단다 (use-wide.ts) */
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const zone = useWide(bodyEl);
  /** 가장 나중 알림이 뜬 때 (되돌리기 키가 입력칸 글 되돌리기와 겹칠 때 나중 일이 이긴다) */
  const lastToastAt = useRef<number>(undefined);
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
      if (escClosesSurface(e, SURFACE_KIND)) {
        bridge.close();
        return;
      }
      // Cmd/Ctrl + 1~5: 탭 옮기기
      const next = tabForKey(e, MAC);
      if (next) {
        e.preventDefault();
        setTabState(next);
        rememberTab(next);
        return;
      }
      // Cmd/Ctrl+Z: 쓰던 글이 없으면 방금 끝낸 것, 지운 것 되돌리기. 입력칸에 쓴 적이 있으면(다 지웠어도)
      // 입력칸 자체 되돌리기에 둔다 (지운 글을 되살리려던 Cmd+Z 가 할 일을 되살리고 글은 잃었다)
      const el = document.activeElement;
      const field =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? undoFieldText(el.value, typed.get(el), lastToastAt.current)
          : undefined;
      if (undoByKey(e, MAC, field) && undoRef.current()) e.preventDefault();
    };
    // 포커스를 받은 뒤 글을 고친 입력칸과 마지막으로 고친 때 (떠나면 잊는다)
    const typed = new WeakMap<EventTarget, number>();
    const onInput = (e: Event) => {
      if (e.target) typed.set(e.target, Date.now());
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

  // 할 일, 일정 탭은 열자마자 입력칸에 커서를 둔다. 탭 줄에서 ← → 로 옮겼으면 커서는 탭에 남긴다 (tablist 관례)
  const tabKeyMove = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭이 바뀔 때와 처음 그릴 때만
  useEffect(() => {
    if (tabKeyMove.current) {
      tabKeyMove.current = false;
      document.getElementById(`ptab-${tab}`)?.focus();
      return;
    }
    inputRef.current?.focus();
  }, [tab, !!s]);

  // 알림이 사라질 때. 마우스가 올라가 있거나 키보드로 단추에 와 있으면 조금 더 둔다
  useEffect(() => {
    if (toasts.length === 0) return;
    const wait = Math.max(0, Math.min(...toasts.map((k) => k.until)) - Date.now()) + 5;
    const id = setTimeout(() => {
      const el = toastRef.current;
      const now = Date.now();
      const holding = !!el && (el.matches(':hover') || el.contains(document.activeElement));
      setToasts((prev) =>
        holding
          ? prev.map((k) => (k.until <= now ? { ...k, until: now + LINGER_MS } : k))
          : liveToasts(prev, now),
      );
    }, wait);
    return () => clearTimeout(id);
  }, [toasts]);
  // 알림을 메인에도 맡긴다 (패널을 벗어났다 다시 열어도 남은 시간 동안 보이게). 되돌리기 키가 입력칸 글 되돌리기와 겹칠 때 쓸 때도 적어 둔다
  useEffect(() => {
    bridge.toastsSet(toasts);
    lastToastAt.current = undoable(toasts).at(-1)?.at;
  }, [toasts]);

  if (!s) return <div className="card-window panel" />;

  const showToast = (next: Toast) => {
    const now = Date.now();
    const key = toastKey.current++;
    const until = now + (next.kind === 'to-event' ? CHOICE_MS : UNDO_MS);
    setToasts((prev) =>
      [
        // 알리기만 하는 알림은 앞의 알리기 알림을 대신한다 (되돌릴 수 있는 알림은 덮지 않는다)
        ...liveToasts(prev, now).filter((k) => !(next.kind === 'added' && k.toast.kind === 'added')),
        { key, at: now, until, toast: next },
      ].slice(-TOAST_KEEP_MAX),
    );
  };
  const dropToast = (key: number) => setToasts((prev) => prev.filter((k) => k.key !== key));
  /** 일정으로 들어간 한 줄을 할 일로 옮긴다 */
  const toTodo = async (item: KeptToast & { toast: Extract<Toast, { kind: 'to-event' }> }) => {
    const r = await bridge.eventToTodo(item.toast.id, item.toast.text);
    dropToast(item.key);
    showToast({ kind: 'added', text: r.ok ? addedText(r, s.today) : (r.error ?? t('panel.retry')) });
  };

  /** 오후로 읽은 일정을 오전으로 옮긴다 (알림은 남겨 옮긴 시각을 보인다) */
  const toAm = (item: KeptToast & { toast: Extract<Toast, { kind: 'to-event' }> }) => {
    const { toast } = item;
    if (!toast.am) return;
    bridge.eventUpdate(toast.id, toast.am);
    const { am, clash: _clash, ...rest } = toast;
    const now = Date.now();
    setToasts((prev) =>
      prev.map((k) =>
        k.key === item.key
          ? { ...k, until: Math.max(k.until, now + UNDO_MS), toast: { ...rest, startAt: am.startAt } }
          : k,
      ),
    );
  };

  const complete = async (todo: Todo) => {
    const coins = await bridge.complete(todo.id);
    // 이미 끝낸 할 일 (체크를 빠르게 여러 번 눌렀다): 앞의 "끝! 코인" 알림을 덮지 않는다
    if (coins === null) return;
    showToast({ kind: 'done', id: todo.id, coins });
  };

  const feed = async () => {
    const r = await bridge.feed();
    setFed(r.ok ? t('panel.fed') : t('panel.noCoins'));
    setTimeout(() => setFed(''), 1500);
  };

  const hungry = s.fullness < s.hungryBelow;

  /** 알림의 되돌리기 (단추와 Cmd/Ctrl+Z 가 같이 쓴다) */
  const undoToast = (item: KeptToast) => {
    const { toast } = item;
    if (toast.kind === 'done') bridge.undo(toast.id);
    if (toast.kind === 'note-removed') bridge.noteRestore(toast.id);
    if (toast.kind === 'event-removed') bridge.eventRestore(toast.id);
    if (toast.kind === 'todo-removed') bridge.restore(toast.id);
    if (toast.kind === 'to-event') bridge.eventRemove(toast.id);
    if (toast.kind === 'moved') bridge.undoMoveOverdue();
    if (toast.kind === 'flagged') bridge.remove(toast.id);
    dropToast(item.key);
  };
  // Cmd/Ctrl+Z 는 가장 나중 알림부터 하나씩 되돌린다
  undoRef.current = () => {
    const last = undoable(toasts).at(-1);
    if (!last) return false;
    undoToast(last);
    return true;
  };
  const { folded, shown } = splitToasts(toasts);
  const foldedUndoable = undoable(folded);

  const renderToast = (item: KeptToast) => {
    const { toast } = item;
    return (
      <div key={item.key} className="toast" role="status">
        {toast.kind === 'to-event' ? (
          // 언제로 넣었는지는 따로 한 줄 (좁아도 시각이 쪼개지지 않게)
          <span>
            {t('panel.toast.toEvent')}
            <strong className="toast-when">
              {whenLabel(toast.startAt, s.today)}
              {toast.am && <small className="toast-guess"> {t('panel.toast.pmGuess')}</small>}
            </strong>
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
            <button type="button" className="undo" title={`${MOD}+Z`} onClick={() => undoToast(item)}>
              {t('panel.undo')}
            </button>
            {toast.kind === 'flagged' && toast.past && (
              <button
                type="button"
                className="undo"
                onClick={() => {
                  bridge.update(toast.id, { due: s.today });
                  dropToast(item.key);
                }}
              >
                {t('panel.toast.toToday')}
              </button>
            )}
            {toast.kind === 'to-event' && toast.am && (
              <button type="button" className="undo" onClick={() => toAm({ ...item, toast })}>
                {t('panel.toast.toAm')}
              </button>
            )}
            {toast.kind === 'to-event' && (
              <button type="button" className="undo" onClick={() => toTodo({ ...item, toast })}>
                {t('panel.toast.asTodo')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <SurfaceProvider value={surface}>
      <div className="surface" ref={setOverlayRoot}>
        <div className="card-window panel">
          <header>
            <PetFace />
            {/* 창 제목: 화면 읽기 프로그램에는 h1, 보이는 글은 그대로 */}
            <h1 className="sr-only">{s.petName}</h1>
            <strong aria-hidden="true">{s.petName}</strong>
            <span className="coins" title={t('panel.coinsHint')}>
              <CoinIcon />
              {s.balance}
            </span>
            {/* 패널 고정 핀 (#145): 켜면 다른 곳을 눌러도 닫히지 않는다. 설정에도 같은 칸 */}
            <button
              type="button"
              className={`icon-btn keep-pin ${s.keepOpen ? 'on' : ''}`}
              aria-pressed={s.keepOpen}
              aria-label={t('keep.pin')}
              title={s.keepOpen ? t('keep.unpin') : `${t('keep.pin')}: ${t('keep.pinHint')}`}
              onClick={() => bridge.setKeepOpen(!s.keepOpen)}
            >
              <PinIcon />
            </button>
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
          {s.life.sulk > 0 && (
            <p className="hint sulk">{t('panel.sulk', { name: s.petName, n: s.life.sulk })}</p>
          )}
          {s.life.poutWhy && (
            <p className="hint sulk">{t('pout.panel', { name: s.petName, why: s.life.poutWhy })}</p>
          )}
          {hungry && <p className="hint hungry">{t('panel.hungry', { name: s.petName })}</p>}

          {/* 탭 목록 (설정 창 탭과 같은 aria tablist): 탭 키로는 고른 탭 하나에만 오고, ← → Home End 로 옮긴다 */}
          <div className="tabs" role="tablist" aria-label={t('panel.nav')}>
            {TABS.map((tb, i) => (
              <button
                key={tb.id}
                type="button"
                role="tab"
                id={`ptab-${tb.id}`}
                aria-selected={tab === tb.id}
                aria-controls="ptab-panel"
                tabIndex={tab === tb.id ? 0 : -1}
                title={t('panel.tabKey', { tab: t(tb.label), keys: tabShortcut(tb.id, MOD) })}
                className={tab === tb.id ? 'on' : ''}
                onClick={() => setTab(tb.id)}
                onKeyDown={(e) => {
                  const to = tabStepByKey(e.key, i, TABS.length);
                  const next = to === undefined ? undefined : TABS[to];
                  if (!next) return;
                  e.preventDefault();
                  if (next.id === tab) return;
                  tabKeyMove.current = true;
                  setTab(next.id);
                }}
              >
                {t(tb.label)}
                {tb.id === 'today' && s.focus.phase === 'focus' && (
                  <i className="dot" title={t('panel.today.focusing')} />
                )}
              </button>
            ))}
          </div>

          {/* 탭 내용이 창의 본문 (화면 읽기 프로그램의 main 이동) */}
          <main className="panel-main">
            <div
              ref={setBodyEl}
              className="panel-tabpanel"
              id="ptab-panel"
              role="tabpanel"
              aria-labelledby={`ptab-${tab}`}
              data-zone={zone}
            >
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
                        ...(r.am ? { am: r.am } : {}),
                      });
                    // 여러 줄 붙여 넣기: "할 일 3개 넣었어"
                    if (r.kind === 'many') showToast({ kind: 'added', text: addedText(r, s.today) });
                    // "30분 뒤 알려 줘": 언제 알려 줄지
                    if (r.kind === 'todo' && r.remindAt !== undefined)
                      showToast({ kind: 'added', text: addedText(r, s.today) });
                    if (r.kind === 'todo' && (r.past || r.monthly))
                      showToast({ kind: 'flagged', id: r.id, text: addedText(r, s.today), past: !!r.past });
                  }}
                  onRemoved={(todo) => showToast({ kind: 'todo-removed', id: todo.id })}
                />
              )}
              {tab === 'note' && (
                <NoteTab s={s} onRemoved={(id) => showToast({ kind: 'note-removed', id })} />
              )}
              {tab === 'shop' && <ShopTab s={s} />}
              {tab === 'event' && (
                <EventTab
                  s={s}
                  inputRef={inputRef}
                  onRemoved={(id) => showToast({ kind: 'event-removed', id })}
                  onComplete={complete}
                  onTodoRemoved={(todo) => showToast({ kind: 'todo-removed', id: todo.id })}
                />
              )}
            </div>
          </main>

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

          {/* 아침 계획 시트 (MorningPlan.tsx): 아침 첫 열기, 펫 한마디, 오늘 탭 카드에서 띄운다 */}
          <PlanSheetHost
            goToday={() => setTab('today')}
            onSaved={(text) => showToast({ kind: 'added', text })}
            todosKey={planTodosKey(s.open)}
          />

          {/* 크기 손잡이: 카드 안 오른쪽 아래. 다른 칸 위에 얹는다 */}
          <ResizeGrips />

          {toasts.length > 0 && (
            // 알림이 여럿이면 쌓는다(최근 셋). 더 오래된 것은 "되돌릴 수 있는 것 N개 더" 한 줄로 합친다.
            // 읽는 동안(마우스를 올린 동안)은 사라지지 않는다
            <div ref={toastRef} className="toast-stack">
              {foldedUndoable.length > 0 && (
                <div className="toast toast-more" role="status">
                  <span>{t('keep.toast.more', { n: foldedUndoable.length })}</span>
                  <div className="toast-actions">
                    <button type="button" className="undo" onClick={() => foldedUndoable.forEach(undoToast)}>
                      {t('keep.toast.undoAll')}
                    </button>
                  </div>
                </div>
              )}
              {shown.map(renderToast)}
            </div>
          )}
        </div>
      </div>
    </SurfaceProvider>
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
