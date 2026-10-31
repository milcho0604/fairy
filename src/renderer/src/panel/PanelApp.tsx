import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXPAND_HINT_MS } from '../../../shared/expand-hint.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState, PanelTab } from '../../../shared/ipc.ts';
import { nextUnlock } from '../../../shared/pet-life.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import type { SurfaceKind } from '../../../shared/surface-kind.ts';
import {
  type KeptToast,
  liveToasts,
  splitToasts,
  TOAST_KEEP_MAX,
  type Toast,
  undoable,
} from '../../../shared/toast-keep.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { FriendsPage } from '../home/FriendsPage.tsx';
import { HomeShell } from '../home/HomeShell.tsx';
import { homeKeyAction, sectionForKey } from '../home/sections.ts';
import { HubHost } from '../hub/HubHost.tsx';
import { LanguageContext } from '../language-context.ts';
import { PetFace } from '../PetFace.tsx';
import { useLanguageUpdates } from '../use-language.ts';
import { EventTab } from './EventTab.tsx';
import { FindAll } from './FindAll.tsx';
import { addedText, timeOf, whenLabel } from './format.ts';
import { CoinIcon, ExpandIcon, GearIcon, MailIcon, PinIcon, SearchIcon } from './icons.tsx';
import { escClosesSurface, type ModKeyLike, tabStepByKey, undoByKey, undoFieldText } from './keys.ts';
import { MailPage, MailSheet } from './MailView.tsx';
import { PlanSheetHost } from './MorningPlan.tsx';
import { mailOverlayAfterTabRequest } from './mail-overlay.ts';
import { OPEN_MAIL_EVENT, useMailUnread } from './mail-state.ts';
import { NoteTab } from './NoteTab.tsx';
import { openNoteById, requestNoteFocus, revealRow } from './open-target.ts';
import { planTodosKey } from './plan-refresh.ts';
import { RecordsTab } from './RecordsTab.tsx';
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
/** 마지막 탭을 적는 칸. 작은 패널과 큰 창이 서로 덮어쓰지 않게 따로 둔다 */
const tabKeyOf = (kind: SurfaceKind) => (kind === 'home' ? 'jj.home.section' : 'jj.panel.tab');
const MAC = navigator.userAgent.includes('Mac');
/** 탭 풀이와 설정 단축키 칸에 보이는 수식키 */
const MOD = MAC ? 'Cmd' : 'Ctrl';

/** 이 면에서 열 수 있는 탭인가: 작은 패널은 탭 줄에 있는 것만, 큰 창은 기록, 쪽지함, 친구, 페어리, 비서 구역도 (#166, 쪽지함은 작은 패널에서는 머리줄 봉투가 여는 덮개) */
const usable = (kind: SurfaceKind, v: unknown): v is PanelTab =>
  isTab(v) ||
  (kind === 'home' && (v === 'records' || v === 'mail' || v === 'friends' || v === 'pet' || v === 'assist'));

/** 마지막에 본 탭 (창은 열 때마다 새로 만들어서 브라우저 저장소에 둔다). 못 읽으면 오늘. */
function savedTab(kind: SurfaceKind): PanelTab {
  // 펫 메뉴 "상점"처럼 탭을 정해서 열면 주소 뒤에 붙어 온다
  const asked = location.hash.slice(1);
  if (usable(kind, asked)) return asked;
  try {
    const v = localStorage.getItem(tabKeyOf(kind));
    return usable(kind, v) ? v : 'today';
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
function rememberTab(kind: SurfaceKind, next: PanelTab) {
  try {
    localStorage.setItem(tabKeyOf(kind), next);
  } catch {
    // 저장 못 해도 이번에는 바뀐다
  }
}

/**
 * 큰 창 Cmd/Ctrl+F: 이 구역의 찾기 칸에 커서를 둔다. 할 일은 접힌 찾기 줄을 펴고, 메모는 입력 줄이 찾기 칸이다.
 * 찾기가 없는 구역(오늘, 일정, 상점)은 아무것도 하지 않는다
 */
function focusFind() {
  const root = document.getElementById('ptab-panel');
  if (!root) return;
  const row = () => root.querySelector<HTMLInputElement>('.find-row input');
  const open = row();
  if (open) {
    open.focus();
    open.select();
    return;
  }
  const btn = root.querySelector<HTMLButtonElement>('.find-btn');
  if (btn) {
    btn.click();
    requestAnimationFrame(() => row()?.focus());
    return;
  }
  if (root.getAttribute('aria-labelledby') === 'ptab-note') {
    const input = root.querySelector<HTMLInputElement>('.add.row input');
    input?.focus();
    input?.select();
  }
}

/** 언어가 바뀌면 아래 memo 줄까지 다시 그리게 언어를 내려 준다 */
export function PanelApp({ kind = 'panel' }: { kind?: SurfaceKind } = {}) {
  const language = useLanguageUpdates();
  return (
    <LanguageContext.Provider value={language}>
      <PanelShell kind={kind} />
    </LanguageContext.Provider>
  );
}

/** 패널 구성요소의 껍데기. kind 가 panel 이면 펫 옆 작은 패널, home 이면 사이드바가 있는 큰 창 (src/renderer/src/home/HomeShell.tsx) */
function PanelShell({ kind }: { kind: SurfaceKind }) {
  const [s, setS] = useState<PanelState>();
  const [tab, setTabState] = useState<PanelTab>(() => savedTab(kind));
  /** 작은 패널의 쪽지함 덮개 (큰 창은 사이드바 구역이라 tab 이 mail). 펫 메뉴가 mail 로 열면 덮개가 열린 채 시작한다 */
  const [mailOpen, setMailOpen] = useState(() => kind === 'panel' && location.hash.slice(1) === 'mail');
  const mailUnread = useMailUnread();
  const [chatOn, setChatOn] = useState(false);
  // 되돌리기 알림 (#145): 여럿이 쌓이고, 메인이 들고 있어 패널을 벗어났다 다시 열어도 남은 시간 동안 보인다
  const [toasts, setToasts] = useState<KeptToast[]>(() => liveToasts(bridge.toastsGet(), Date.now()));
  const toastKey = useRef(toasts.reduce((m, k) => Math.max(m, k.key), 0) + 1);
  const [fed, setFed] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  /** 덮개 자리: 본문 칸 위에 덮는 것(주간 카드, 줄 메뉴)을 면 기준으로 올린다 (surface.tsx) */
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  /** 본문 칸. 폭 구간은 data-zone 으로 단다 (use-wide.ts) */
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const zone = useWide(bodyEl);
  const surface = useMemo(
    () => ({ kind, close: () => bridge.close(), overlayRoot, zone }) as const,
    [kind, overlayRoot, zone],
  );
  /** 가장 나중 알림이 뜬 때 (되돌리기 키가 입력칸 글 되돌리기와 겹칠 때 나중 일이 이긴다) */
  const lastToastAt = useRef<number>(undefined);
  /** 지금 알림의 되돌리기 (Cmd/Ctrl+Z). 되돌렸으면 true */
  const undoRef = useRef<() => boolean>(() => false);

  // 큰 창이 지금 보는 구역을 메인에 알린다 (캘린더 끊김 알림은 비서 구역을 보는 중이면 조용히 한다)
  useEffect(() => {
    if (kind === 'home') bridge.homeSection(chatOn ? 'chat' : tab);
  }, [kind, chatOn, tab]);
  const setTab = (next: PanelTab) => {
    setChatOn(false);
    setTabState(next);
    rememberTab(kind, next);
  };
  /** "크게 볼까요?" 칩이 떠 있다 (패널을 가장 넓게 만든 채 더 끌었을 때, 몇 초 뒤 저절로 사라진다) */
  const [hintOn, setHintOn] = useState(false);
  /** 할 일, 메모, 일정 한 번에 찾기 (#146) */
  const [findOpen, setFindOpen] = useState(false);
  const [findEventTarget, setFindEventTarget] = useState<{ id: number; startAt: number }>();
  const clearFindEventTarget = useCallback(() => setFindEventTarget(undefined), []);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showHint = () => {
    setHintOn(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHintOn(false), EXPAND_HINT_MS);
  };
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  /** 지금 탭 그대로 큰 창으로. 쓰던 글, 보던 위치, 열린 메모를 먼저 메인에 보내 놓고 부른다 (창을 닫을 때와 같은 길).
   * 메인이 큰 창이 보인 뒤에 이 패널을 닫으니 화면이 비는 순간이 없다 */
  const expand = () => {
    window.dispatchEvent(new Event('beforeunload'));
    bridge.expand(mailOpen ? 'mail' : tab);
  };
  const expandRef = useRef(expand);
  expandRef.current = expand;

  useEffect(() => {
    bridge.snapshot().then(setS);
    bridge.onState(setS);
    bridge.onTab((next) => {
      // 작은 패널은 쪽지함이 탭이 아니라 덮개다
      if (kind === 'panel' && next === 'mail') {
        setMailOpen(true);
        return;
      }
      if (!usable(kind, next)) return;
      // 쪽지함이 열린 채 다른 탭을 부르면 덮개가 남지 않게 닫는다
      setMailOpen((open) => mailOverlayAfterTabRequest(kind, next, open));
      setChatOn(false);
      setTabState(next);
    });
    const homeKey = (e: ModKeyLike): boolean => {
      const act = homeKeyAction(e, MAC);
      if (act) {
        if (act === 'settings') bridge.openSettings();
        else if (act === 'close') bridge.close();
        else focusFind();
        return true;
      }
      const sec = sectionForKey(e, MAC);
      if (!sec) return false;
      if (sec.id === 'chat') bridge.openChat();
      else {
        if (sec.id === 'note') requestNoteFocus();
        setChatOn(false);
        setTabState(sec.id);
        rememberTab(kind, sec.id);
      }
      return true;
    };
    // 오늘 탭의 새 쪽지 카드가 쪽지함을 열어 달라고 한다
    const openMailHere = () => {
      if (kind === 'panel') setMailOpen(true);
      else {
        setChatOn(false);
        setTabState('mail');
        rememberTab(kind, 'mail');
      }
    };
    window.addEventListener(OPEN_MAIL_EVENT, openMailHere);
    if (kind === 'home') bridge.onChatKey((key) => void homeKey(key));
    if (kind === 'home') bridge.onChatSection(setChatOn);
    // 패널이 열린 채 트레이, 펫 메뉴로 큰 창을 열면 메인이 이 패널에 먼저 넘겨 달라고 한다
    if (kind === 'panel') bridge.onExpandNow(() => expandRef.current());
    // 입력칸이 먼저 Esc 를 처리한다(비우기, 메모 목록으로). 한글 조합 중 Esc 는 조합만 끝낸다
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K: 할 일, 메모, 일정을 한 번에 찾기
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (escClosesSurface(e, kind)) {
        bridge.close();
        return;
      }
      if (kind === 'home') {
        if (homeKey(e)) {
          e.preventDefault();
          return;
        }
      } else {
        // Cmd/Ctrl + 1~5: 탭 옮기기
        const next = tabForKey(e, MAC);
        if (next) {
          e.preventDefault();
          setTabState(next);
          rememberTab(kind, next);
          return;
        }
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
  }, [kind]);

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

  // 탭 줄이 가로로 스크롤될 만큼 좁으면 고른 탭이 보이게 한다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭이 바뀔 때와 처음 그릴 때만
  useEffect(() => {
    const show = () =>
      document.getElementById(`ptab-${tab}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    show();
    // 창 크기나 확대가 바뀌어도 고른 탭이 보이게
    window.addEventListener('resize', show);
    return () => window.removeEventListener('resize', show);
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

  /** 같은 반복의 다른 회차 시각으로 옮기다 막혔다는 신호(번호가 오르면)를 안내 알림으로. 처음 받은 상태는 기준일 뿐 알리지 않는다 */
  const slotSeen = useRef<number | null>(null);
  const slotTaken = s === undefined ? undefined : (s.eventSlotTaken ?? 0);
  useEffect(() => {
    if (slotTaken === undefined) return;
    const before = slotSeen.current;
    slotSeen.current = slotTaken;
    if (before === null || slotTaken <= before) return;
    const now = Date.now();
    const key = toastKey.current++;
    setToasts((prev) =>
      [
        ...liveToasts(prev, now).filter((k) => k.toast.kind !== 'added'),
        {
          key,
          at: now,
          until: now + UNDO_MS,
          toast: { kind: 'added' as const, text: t('panel.event.slotTaken') },
        },
      ].slice(-TOAST_KEEP_MAX),
    );
  }, [slotTaken]);

  if (!s) return kind === 'home' ? <div className="surface home" /> : <div className="card-window panel" />;

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
    // 반복 할 일: 다음 회차가 언제인지 알린다 (줄이 사라졌다 내일 자리에 다시 나타나 놀라지 않게)
    const next = todo.repeat ? await bridge.nextOf(todo.id) : null;
    showToast({
      kind: 'done',
      id: todo.id,
      coins,
      ...(next?.due ? { next: t('rows.toast.next', { when: dueLabel(next.due, s.today).text }) } : {}),
    });
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
    if (toast.kind === 'focus-stopped') bridge.focusResume();
    if (toast.kind === 'note-removed') bridge.noteRestore(toast.id);
    if (toast.kind === 'event-removed') bridge.eventRestore(toast.id);
    if (toast.kind === 'todo-removed') bridge.restore(toast.id);
    if (toast.kind === 'to-event') bridge.eventRemove(toast.id);
    if (toast.kind === 'moved') bridge.undoMoveOverdue(toast.key);
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

  // 탭 내용이 창의 본문 (화면 읽기 프로그램의 main 이동)
  const mainEl = (
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
            onMoved={(moved, to, key) => showToast({ kind: 'moved', moved, ...(to ? { to } : {}), key })}
            onFocusStopped={(minutes) => showToast({ kind: 'focus-stopped', minutes })}
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
        {tab === 'note' && <NoteTab s={s} onRemoved={(id) => showToast({ kind: 'note-removed', id })} />}
        {tab === 'shop' && <ShopTab s={s} />}
        {tab === 'records' && kind === 'home' && <RecordsTab s={s} />}
        {tab === 'mail' && kind === 'home' && <MailPage />}
        {kind === 'home' && <HubHost tab={tab} />}
        {tab === 'friends' && kind === 'home' && <FriendsPage />}
        {tab === 'event' && (
          <EventTab
            s={s}
            inputRef={inputRef}
            onRemoved={(id) => showToast({ kind: 'event-removed', id })}
            onComplete={complete}
            onTodoRemoved={(todo) => showToast({ kind: 'todo-removed', id: todo.id })}
            onTodoAdded={(r) => showToast({ kind: 'added', text: addedText(r, s.today) })}
            findTarget={findEventTarget}
            onFindTargetHandled={clearFindEventTarget}
          />
        )}
      </div>
    </main>
  );

  /** 찾기에서 고른 곳으로: 탭을 바꾸고 그 줄을 보인다 (메모는 편집기를 연다) */
  const pickFound = (
    tab: PanelTab,
    pick: { kind: 'todo' | 'note' | 'event'; id: number; startAt?: number },
  ) => {
    setTab(tab);
    if (pick.kind === 'note') openNoteById(pick.id);
    else if (pick.kind === 'event') {
      if (typeof pick.startAt === 'number') setFindEventTarget({ id: pick.id, startAt: pick.startAt });
      else void revealRow(`event:${pick.id}`);
    } else void revealRow(`todo:${pick.id}`);
  };
  const findSheet = findOpen ? (
    <FindAll today={s.today} onClose={() => setFindOpen(false)} onPick={pickFound} />
  ) : null;

  // 아침 계획 시트 (MorningPlan.tsx): 아침 첫 열기, 펫 한마디, 오늘 탭 카드에서 띄운다
  const planSheet = (
    <PlanSheetHost
      goToday={() => setTab('today')}
      onSaved={(text) => showToast({ kind: 'added', text })}
      todosKey={planTodosKey(s.open)}
    />
  );

  // 알림이 여럿이면 쌓는다(최근 셋). 더 오래된 것은 "되돌릴 수 있는 것 N개 더" 한 줄로 합친다.
  // 읽는 동안(마우스를 올린 동안)은 사라지지 않는다
  const toastStack = toasts.length > 0 && (
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
  );

  if (kind === 'home')
    return (
      <SurfaceProvider value={surface}>
        <HomeShell
          s={s}
          tab={tab}
          chatOn={chatOn}
          setTab={setTab}
          setOverlayRoot={setOverlayRoot}
          fed={fed}
          onFeed={feed}
          mainEl={mainEl}
          planSheet={planSheet}
          toastStack={toastStack}
        />
        {findSheet}
      </SurfaceProvider>
    );

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
            {/* 쪽지함: 안 읽은 쪽지가 있으면 점, 이름에는 숫자 (색에만 기대지 않는다) */}
            <button
              type="button"
              className={`icon-btn mail-btn${mailUnread > 0 ? ' has-unread' : ''}`}
              aria-label={t('mail.button', { n: mailUnread })}
              title={t('mail.buttonTitle')}
              onClick={() => setMailOpen(true)}
            >
              <MailIcon dot={mailUnread > 0} />
            </button>
            {/* 같은 탭, 쓰던 글 그대로 큰 창으로 (이슈 #164) */}
            <button
              type="button"
              className="icon-btn expand-btn"
              aria-label={t('panel.expand')}
              title={t('panel.expandTitle')}
              onClick={expand}
            >
              <ExpandIcon />
            </button>
            {/* 할 일, 메모, 일정을 한 번에 찾기 */}
            <button
              type="button"
              className="icon-btn"
              aria-label={t('rows.find.open')}
              title={`${t('rows.find.open')} (${MOD}+K)`}
              onClick={() => setFindOpen(true)}
            >
              <SearchIcon />
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

          {/* 펫 상태는 한 줄: 배부름, 기분, 친밀도, 밥 주기 (다음 해금 문구는 풀이로. 좁으면 둘째 줄로 넘어간다) */}
          <div className="fullness">
            <span className="label">{t('panel.fullness')}</span>
            <span className={`track ${hungry ? 'low' : ''}`} aria-hidden="true">
              <span className="fill" style={{ width: `${s.fullness}%` }} />
            </span>
            <span className="value">{s.fullness}</span>
            <span className="life-vals" title={unlockHint(s.life.affection)}>
              <span title={t('panel.moodHint')}>{t('panel.mood', { n: s.life.mood })}</span>
              <span title={t('panel.affectionHint')}>{t('panel.affection', { n: s.life.affection })}</span>
            </span>
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
          {/* 가장 넓게 만든 채 더 끌면 잠깐 권한다. 저절로 바꾸지는 않는다. 눌리는 단추가 없는 이 줄에 띄워 아무것도 덮지 않는다 */}
          {hintOn && (
            <div className="life chip-only">
              <div className="expand-chip" role="status">
                <button type="button" className="expand-chip-btn" onClick={expand}>
                  <ExpandIcon />
                  {t('panel.expandHint')}
                </button>
              </div>
            </div>
          )}
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
                data-label={t(tb.label)}
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

          {mainEl}

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

          {planSheet}
          {findSheet}
          {mailOpen && <MailSheet onClose={() => setMailOpen(false)} />}

          {/* 크기 손잡이: 카드 안 오른쪽 아래. 다른 칸 위에 얹는다 */}
          <ResizeGrips onPastMax={showHint} />

          {toastStack}
        </div>
      </div>
    </SurfaceProvider>
  );
}

function toastText(toast: Toast): string {
  if (toast.kind === 'done') {
    const base = toast.coins > 0 ? t('panel.toast.done', { n: toast.coins }) : t('panel.toast.doneNoCoin');
    return toast.next ? `${base} ${toast.next}` : base;
  }
  if (toast.kind === 'focus-stopped')
    return toast.minutes > 0
      ? t('rows.toast.focusStopped', { n: toast.minutes })
      : t('rows.toast.focusStoppedNone');
  if (toast.kind === 'note-removed') return t('panel.toast.noteRemoved');
  if (toast.kind === 'event-removed') return t('panel.toast.eventRemoved');
  if (toast.kind === 'todo-removed') return t('panel.toast.todoRemoved');
  if (toast.kind === 'to-event') return t('panel.toast.toEvent');
  if (toast.kind === 'moved')
    return t(toast.to === 'tomorrow' ? 'assist.defer.moved' : 'assist.overdue.moved', {
      n: toast.moved.length,
    });
  return toast.text;
}
