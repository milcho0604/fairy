import { join } from 'node:path';
import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  type Rectangle,
  screen,
} from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import { undoMoved } from '../shared/briefing.ts';
import { plusDays } from '../shared/day.ts';
import { dayWatch } from '../shared/day-watch.ts';
import { saveErrorText } from '../shared/download-error.ts';
import { isPanelDraftKind } from '../shared/draft-store.ts';
import { findSameEvent } from '../shared/event-dup.ts';
import { clashIds, overlapping, spanEnd } from '../shared/event-overlap.ts';
import {
  allDaySpan,
  allDayTimes,
  type CalEvent,
  dayStartMs,
  type EventStore,
  hasTimeRange,
  parseEventInput,
  parseQuickEventInfo,
} from '../shared/event-store.ts';
import { findAll } from '../shared/find-all.ts';
import { type FocusState, focusReward, isFocusMinutes } from '../shared/focus.ts';
import { isMonth, monthOf } from '../shared/focus-month.ts';
import type { GcalCalLabel, PanelGcal } from '../shared/gcal.ts';
import { fitSavedBounds } from '../shared/geometry.ts';
import { isPanelView, type PanelView } from '../shared/home-policy.ts';
import { t } from '../shared/i18n/index.ts';
import { createIdleWatch } from '../shared/idle-watch.ts';
import {
  type EventClash,
  type FocusMonthView,
  isPanelTab,
  type NoteAiKind,
  type NoteSaveResult,
  PANEL,
  type PanelAddResult,
  type PanelState,
  type PanelTab,
  type PlayKind,
} from '../shared/ipc.ts';
import {
  cleanPolished,
  createPolishJobs,
  POLISH_MAX,
  type PolishReply,
  polishRequest,
} from '../shared/note-polish.ts';
import {
  NOTE_BODY_MAX,
  type NoteStore,
  notePreview,
  noteTitle,
  searchNotes,
  staleNoteWrite,
} from '../shared/note-store.ts';
import {
  clampPanelSize,
  defaultPanelBounds,
  PANEL_DEFAULT,
  PANEL_MIN,
  panelOffsetAfterMove,
  parsePanelOffset,
  placePanel,
  resizePanelRect,
} from '../shared/panel-place.ts';
import type { DoingSet } from '../shared/pet-status.ts';
import { isPinKind } from '../shared/pin.ts';
import { hasDeadlineWord, memoBody } from '../shared/quick-add.ts';
import { quickHeight } from '../shared/quick-fit.ts';
import {
  parseTodoLine,
  remindsInput,
  remindsOf,
  splitRemind,
  type TakenRemind,
  todoPatchInput,
} from '../shared/remind-parse.ts';
import { CUSTOM_FOOD_COST, CUSTOM_FOOD_MAX, type Food, type ItemStore } from '../shared/shop.ts';
import { parseRemindIn, remindInAt } from '../shared/snooze.ts';
import { COIN, FULLNESS, localDay, STEP_MAX, type TodoStore } from '../shared/todo-store.ts';
import { emptyViewKeep } from '../shared/view-keep.ts';
import { weekSummary } from '../shared/week.ts';
import { devRendererUrl } from './dev-url.ts';
import { onDisplaysChanged } from './display-watch.ts';
import { drafts, getToasts, getView, noteKeep, setToasts, setView } from './drafts.ts';
import { focusWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { localTime, minuteOfDay, startOfDay, startOfDayAfter } from './planner.ts';
import { readJson, removeJson, writeJson } from './store.ts';
import type { SurfaceWin } from './surface.ts';
import { closesPanelFor, originOf, pickSurface } from './surface.ts';
import { saveBounds, savedBounds } from './window-bounds.ts';

/** 날이 바뀌었는지 보는 간격. 자정 뒤 이만큼 안에 패널이 새 날로 바뀐다 */
const DAY_CHECK_MS = 20_000;

/** 여러 줄 붙여 넣기는 한 번에 이만큼까지 */
const ADD_MANY_MAX = 50;
const QUICK_SIZE = { width: 480, height: 64 };
/** 사용자가 끌어 놓은 패널 자리 (펫에서 떨어진 거리) */
const OFFSET_FILE = 'panel-position';
/** 끄는 동안 'move' 가 계속 와서 멈춘 뒤에 한 번 저장한다 */
const MOVE_SAVE_MS = 400;
/** 크기 끌기 갱신 사이 최소 간격 (초당 60번을 넘지 않게) */
const RESIZE_GAP_MS = 17;
/** 크기가 멈춘 뒤 이만큼 지나면 적는다 */
const RESIZE_SAVE_MS = 400;
/** 큰 창으로 넘겨 달라고 했는데 패널이 이만큼 답이 없으면 그냥 큰 창을 연다 */
const EXPAND_ASK_MS = 1500;
/**
 * 끄는 중에 크기 소식이 이만큼 안 오면 끝 알림이 끊긴 것으로 보고 "끄는 중"을 푼다
 * (화면 새로 고침, 충돌, 포인터 유실). 손잡이는 잡고 있는 동안 이보다 짧은 간격으로 소식을 다시 보낸다 (ResizeGrips.tsx)
 */
const RESIZE_IDLE_MS = 2000;

/** 한 줄 넣기 옵션 (빠른 입력, 분류 바꾸기) */
interface AddOpts {
  quick?: boolean;
  as?: 'todo';
}

export interface PanelOptions {
  store: TodoStore;
  /** 진행 중으로 표시한 할 일 (펫 머리 위 말풍선, 이슈 #124) */
  doing: DoingSet;
  notes: NoteStore;
  events: EventStore;
  focus: () => FocusState;
  /** 집중 시작. 길이(15, 25, 50분)를 주면 그 길이로, 할 일 id 를 주면 그 할 일을 하는 집중 */
  startFocus: (minutes?: number, todoId?: number) => void;
  /** 고른 집중 길이 */
  focusMin: () => number;
  focusUndoAvailable?: () => boolean;
  stopFocus: () => { minutes: number } | undefined;
  /** 방금 그만둔 집중을 되돌린다. 되돌렸으면 true */
  resumeFocus: () => boolean;
  /** 일정이 바뀌었다 (곧 시작하는 일정이면 바로 알림) */
  onEventsChanged: () => void;
  /** 일정 줄의 구글 표식 (구글 캘린더에 연결했을 때만) */
  gcalMarks?: (ids: readonly number[]) => PanelGcal | undefined;
  /** 구글에서 읽어 온 일정의 캘린더 이름과 색 (main/gcal.ts calLabels) */
  gcalCals?: (ids: readonly number[]) => Record<number, GcalCalLabel>;
  /** 채팅 창을 열고 묻는다. 답을 기다리는 중이면 false */
  askAi: (prompt: string) => boolean;
  /** 채팅 창 없이 글만 한 번 묻는다 (메모 다듬기). 실패면 undefined */
  askOnce: (text: string, system: string) => Promise<string | undefined>;
  /** 강제 업데이트 전이라 AI 를 잠갔는지 */
  aiLocked: () => boolean;
  /** 지금 고른 AI 이름 (다듬기 단추와 진행 글에 보인다) */
  aiLabel: () => string | undefined;
  life: () => { sulk: number; mood: number; affection: number; poutWhy?: string };
  /** 상점 (v1) */
  shop: ItemStore;
  foodImage: (file: string | undefined) => string;
  /** 먹이를 줬다 (펫 반응, 기분) */
  onFedWith: (food: Food) => void;
  /** 커스텀 먹이 만들기 창 열기 */
  openFoodMaker: () => void;
  removeFoodImage: (file: string | undefined) => void;
  /** 집 단계가 바뀌었다 */
  /** 집 단계가 올랐거나(level) 모양을 바꿨다(style) */
  onHouseChanged: (what: 'level' | 'style') => void;
  /** 집을 숨겨 두었는지, 숨기기와 다시 보이기 (shared/house-stow.ts) */
  houseHidden: () => boolean;
  setHouseHidden: (on: boolean) => void;
  /** 놀이 시작 (공놀이, 산책) */
  play: (kind: PlayKind) => void;
  achieve: () => PanelState['achieve'];
  petName: () => string;
  /** 펫 자리 (패널을 그 옆에 연다) */
  petBounds: () => Rectangle;
  onCompleted: (coins: number, id: number) => void;
  onFed: () => void;
  /** 할 일이나 배부름이 바뀌었다 (펫 배고픔 표정 등) */
  onChanged: () => void;
  openChat: () => void;
  openSettings: () => void;
  /** 패널 고정 핀 (#145): 켜 두면 다른 곳을 눌러도 패널이 닫히지 않는다 */
  panelPin: () => boolean;
  setPanelPin: (on: boolean) => void;
  /** 패널 보기 (#161): 펫 클릭이 여는 것 */
  panelView: () => PanelView;
  setPanelView: (view: PanelView) => void;
  /** 친구 기능이 켜져 있다 (큰 창 사이드바 "친구") */
  friendsOn: () => boolean;
  /** 설정의 친구 칸 열기 */
  openFriends: () => void;
  /**
   * 큰 창으로 열어야 하면 열고 true (패널 보기가 큰 창이거나 큰 창이 열려 있다). false 면 패널이 연다.
   * toggle 이면 펫 누르기, 단축키처럼 "열고 닫기", 아니면 이 탭을 보여 줘
   */
  routeHome?: (req: { tab?: PanelTab; toggle: boolean }) => boolean;
  /**
   * 작은 패널의 "크게 보기" (#164): 이 탭 그대로 큰 창을 띄운다. 큰 창이 보인 뒤에 패널을 닫는 일은 큰 창이 맡는다.
   * tab 이 없으면 큰 창이 마지막으로 본 구역
   */
  promoteHome?: (tab?: PanelTab) => void;
  lookTogether: () => void;
  /** 오늘 놓친 알림 (펫이 숨어 있거나 자리에 없어 못 본 것) */
  missed: () => PanelState['missed'];
  diary: () => PanelState['diary'];
  clearMissed: () => void;
  /** 하루 기록 (이번 주 돌아보기). 없으면 이번 주 칸이 없다 */
  stats?: StatStore;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 패널(P2-02)과 빠른 입력(P2-04). 패널은 펫 옆에 뜨고 다른 곳을 누르거나 Esc 면 닫힌다.
 * 둘 다 열 때 만들고 닫으면 없앤다 (L6). 패널은 머리를 잡고 끌어 옮길 수 있고, 옮긴 자리는 펫과의 거리로 기억한다.
 */
export function createPanel(o: PanelOptions) {
  let panel: BrowserWindow | undefined;
  let quick: BrowserWindow | undefined;
  /** 큰 창 (#159). 지금은 만드는 곳이 없고, 생기면 registerHome 으로 알린다 */
  let home: SurfaceWin | undefined;
  /** 기억한 패널 자리 (펫 왼쪽 위에서 떨어진 거리). 없으면 펫 옆 기본 자리 */
  let offset = parsePanelOffset(readJson(OFFSET_FILE));
  /**
   * 우리가 만든 창 (닫히는 중인 것도). closePanel 은 panel 을 바로 비우는데 창은 그 뒤에 닫히며 메모의 남은 글을 보낸다
   * (beforeunload). panel 하고만 비교하면 그 마지막 저장이 버려졌다.
   */
  const senders = new Set<Electron.WebContents>();
  const relocating = new WeakSet<BrowserWindow>();
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) => senders.has(e.sender);
  const homeContents = () => (home && !home.isDestroyed() ? home.webContents : undefined);
  /** 지금 보이는 면: 큰 창이 있으면 큰 창, 없으면 패널 (src/main/surface.ts) */
  /** 큰 창을 숨겨 두었는가 (home.ts 가 알려 준다). 숨긴 큰 창은 보이는 면이 아니다 */
  let homeHidden: () => boolean = () => false;
  const activeSurface = () =>
    pickSurface(home, panel, (w) => !w.isDestroyed() && !(w === home && homeHidden()));
  /** 작은 패널이나 큰 창(숨겨 둔 것도)이 보낸 것인가. 요청은 두 면 모두 받는다 */
  const fromSurface = (wc: Electron.WebContents) =>
    (!!panel && !panel.isDestroyed() && panel.webContents === wc) || (!!home && homeContents() === wc);
  /** 이번에 "새 메모"로 만든 것. 패널이 닫힐 때 아직 비어 있으면 지운다 (빈 메모가 쌓이지 않게) */
  const freshNotes = new Set<number>();
  /** 메모 다듬기 (메모 id 마다 하나) */
  const polishJobs = createPolishJobs();

  /**
   * 넣기 답을 주는 IPC: 저장이 던지면(디스크 가득, 읽기 전용 폴더) 오류 글로 답한다. 예전에는 던진 채 두어 창의
   * await 가 깨지고, 적은 글은 그대로인데 아무 말도 없었다 (버그잡이 4: 디스크를 채워 실제 앱으로 확인)
   */
  function saving<A extends unknown[], R>(
    fn: (e: IpcMainInvokeEvent, ...args: A) => R,
  ): (e: IpcMainInvokeEvent, ...args: A) => R | { ok: false; error: string } {
    return (e, ...args) => {
      try {
        return fn(e, ...args);
      } catch (err) {
        o.log('panel', '저장 실패', err instanceof Error ? err.message : String(err));
        return { ok: false, error: saveErrorText(err) };
      }
    };
  }

  /** 진행 중 표시 가운데 아직 열려 있는 것만 (끝내거나 지운 할 일은 안 보이고, 되돌리면 돌아온다) */
  function openDoing(open: readonly { id: number }[]): number[] {
    const ids = new Set(open.map((todo) => todo.id));
    return o.doing.ids().filter((id) => ids.has(id));
  }

  let newNoteRequest = 0;
  let pendingNewNote = false;

  function state(): PanelState {
    const now = Date.now();
    const { open, doneToday } = o.store.list(now);
    const events = withCals(o.events.between(startOfDay(now), startOfDayAfter(now, 14)));
    const pinnedEvents = withCals(o.events.pinned(now));
    dayTurn.seen(localDay(now));
    return {
      ...(pendingNewNote ? { newNoteRequest } : {}),
      petName: o.petName(),
      today: localDay(now),
      open,
      doneToday,
      doing: openDoing(open),
      balance: o.store.balance(),
      fullness: Math.round(o.store.fullness(now)),
      hungryBelow: FULLNESS.hungry,
      foodCost: COIN.food,
      notes: o.notes.list().map((n) => ({
        id: n.id,
        title: noteTitle(n),
        preview: notePreview(n),
        source: n.source,
        updatedAt: n.updatedAt,
        pinnedAt: n.pinnedAt,
      })),
      events,
      // 안 끝난 시각 일정끼리 (어제부터 이어지는 것 포함). 일정 탭이 보이는 것과 같은 범위
      eventClash: [...clashIds(o.events.timedOverlapping(now, startOfDayAfter(now, 14)))],
      pinnedEvents,
      ...gcalOf(events, pinnedEvents),
      focus: o.focus(),
      focusMin: o.focusMin(),
      focusCoins: focusReward(o.focusMin()),
      life: o.life(),
      achieve: o.achieve(),
      missed: o.missed(),
      diary: o.diary(),
      shop: {
        ...o.shop.state(),
        foodImages: Object.fromEntries(o.shop.state().customFoods.map((f) => [f.key, o.foodImage(f.image)])),
        houseHidden: o.houseHidden(),
      },
      ...(week(now, open) ?? {}),
      trashCount: o.store.trashCount() + o.notes.trashCount() + o.events.trashCount(),
      keepOpen: o.panelPin(),
      panelView: o.panelView(),
      friendsOn: o.friendsOn(),
    };
  }

  /** 일정 줄의 구글 표식. 못 읽어도 패널은 뜨게 (표식만 빠진다) */
  /** 구글에서 읽어 온 일정에 캘린더 이름과 색을 붙인다 (일정 줄, 달력). 못 읽으면 그대로 */
  function withCals(list: CalEvent[]): CalEvent[] {
    const ids = list.filter((e) => e.source === 'google').map((e) => e.id);
    if (!o.gcalCals || ids.length === 0) return list;
    try {
      const cals = o.gcalCals(ids);
      return list.map((e) => (cals[e.id] ? { ...e, gcalCal: cals[e.id] } : e));
    } catch {
      return list;
    }
  }

  function gcalOf(events: readonly CalEvent[], pinned: readonly CalEvent[]): { gcal?: PanelGcal } {
    if (!o.gcalMarks) return {};
    try {
      const g = o.gcalMarks([...events, ...pinned].filter((e) => e.source === 'local').map((e) => e.id));
      return g ? { gcal: g } : {};
    } catch (err) {
      o.log('panel', '구글 표식 못 읽음', err instanceof Error ? err.name : 'error');
      return {};
    }
  }

  /** 이번 주 돌아보기. 기록을 못 읽어도 패널은 뜨게 */
  function week(now: number, open: readonly { due: string | null }[]) {
    const stats = o.stats;
    if (!stats) return undefined;
    try {
      return { week: weekSummary(localDay(now), (days) => stats.diaryFacts(days), open) };
    } catch (err) {
      o.log('panel', '이번 주 못 읽음', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** 새 시각 일정과 시간이 겹치는 일정 (첫 것). 앞뒤 하루 안에서만 찾는다 */
  function clashOf(ev: { startAt: number; endAt: number | null; id: number }): EventClash | undefined {
    const span = { ...ev, title: '', allDay: false };
    const hit = overlapping(o.events.timedOverlapping(ev.startAt, spanEnd(span)), span)[0];
    return hit ? { title: hit.title, startAt: hit.startAt } : undefined;
  }

  function push() {
    const s = state();
    // 숨겨 둔 큰 창에는 보내지 않는다. 다시 보일 때 home.ts 가 refresh 로 한 번 보낸다
    for (const w of [panel, home, quick]) {
      if (!w || w.isDestroyed() || (w === home && homeHidden())) continue;
      w.webContents.send(PANEL.state, s);
    }
    o.onChanged();
  }
  // 자정을 넘기면 열려 있는 패널에 새 날 것을 보낸다 (오늘 끝낸 일, 오늘 마감, 오늘 일정이 어제 것으로 남았다)
  const dayTurn = dayWatch({
    now: () => Date.now(),
    day: localDay,
    onTurn: () => {
      if ([panel, home, quick].some((w) => w && !w.isDestroyed())) push();
    },
  });
  setInterval(() => dayTurn.check(), DAY_CHECK_MS).unref();

  ipcMain.handle(PANEL.snapshot, (e) => (ours(e) ? state() : undefined));
  ipcMain.handle(
    PANEL.add,
    saving((e, text: string, rawOpts?: unknown): PanelAddResult => {
      if (!ours(e) || typeof text !== 'string') return { ok: false };
      const now = Date.now();
      const raw = (typeof rawOpts === 'object' && rawOpts !== null ? rawOpts : {}) as Record<string, unknown>;
      const opts: AddOpts = {
        quick: raw.quick === true,
        ...(raw.as === 'todo' ? { as: 'todo' as const } : {}),
      };
      // 여러 줄을 붙여 넣으면 줄마다 하나씩 (할 일이나 일정). 빈 줄은 건너뛴다
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 1) {
        if (lines.length > ADD_MANY_MAX)
          return { ok: false, error: t('panel.add.tooMany', { n: ADD_MANY_MAX }) };
        let todos = 0;
        let events = 0;
        let notes = 0;
        const items: { kind: 'todo' | 'event' | 'note'; id: number }[] = [];
        for (const line of lines) {
          const r = addLine(line, now, opts);
          if (!r.ok) continue;
          if (r.kind === 'event') events++;
          else if (r.kind === 'note') notes++;
          else todos++;
          if (r.kind === 'event' || r.kind === 'note' || r.kind === 'todo')
            items.push({ kind: r.kind, id: r.id });
        }
        if (todos + events + notes === 0) return { ok: false, error: t('panel.add.empty') };
        return { ok: true, kind: 'many', todos, events, ...(notes ? { notes } : {}), items };
      }
      return addLine(text, now, opts);
    }),
  );
  /**
   * 한 줄 넣기. 시각이 들어 있으면("내일 3시 회의") 일정으로 넣는다.
   * "3시까지", "by 5pm"은 마감이라 할 일로 둔다(시각 범위 "3시부터 5시까지"는 일정).
   * 반복 낱말이 있으면("매일 아침 7시 스트레칭") 시각이 있어도 반복 할 일이다 (반복 일정은 없다. 시각은 마감 시각)
   */
  /** 같은 제목과 시각의 일정이 이미 있으면 넣지 않고 알릴 답 (두 번 눌러 겹쳐 넣는 일이 잦다) */
  function sameEvent(title: string, startAt: number, allDay: boolean) {
    const found = findSameEvent(o.events.stored(startAt, startAt + 1), { title, startAt, allDay });
    if (!found) return undefined;
    return { ok: false as const, error: t('panel.event.duplicate', { title: found.title }) };
  }
  /** 빠른 입력의 "메모:" 머리말: 메모로 넣는다 */
  function addMemo(body: string, now: number): PanelAddResult {
    if (!body) return { ok: false, error: t('panel.add.empty') };
    const note = o.notes.add({ body, source: 'me' }, now);
    push();
    return { ok: true, kind: 'note', id: note.id };
  }
  function addLine(line: string, now: number, opts: AddOpts = {}): PanelAddResult {
    // 분류 바꾸기("할 일로"): 시각이 있어도 할 일로 넣는다
    if (opts.as === 'todo') return addTodo(line, now);
    if (opts.quick) {
      const memo = memoBody(line);
      if (memo !== undefined) return addMemo(memo, now);
    }
    // "30분 뒤 알려 줘", "in 30 minutes": 지금부터 N분 뒤에 울리는 알림 (마감 시각이 그때인 할 일, snooze.ts)
    const later = parseRemindIn(line);
    if (later) return addRemindIn(later.title || t('snooze.remindTitle'), later.minutes, now);
    // "1시간 전에 알려줘", "하루 전 알림" 같은 알림 말은 먼저 뗀다 (남기면 "1시간"을 일정 길이로 읽는다)
    const { rest: text, remind } = splitRemind(line);
    const deadline = hasDeadlineWord(text) && !hasTimeRange(text);
    // 반복 낱말이 어디에 있든("standup every weekday 9am") 시각이 있으면 시각이 있는 반복 할 일이다
    const repeat = parseTodoLine(text, localDay(now), minuteOfDay(now)).repeat !== null;
    const info = deadline || repeat ? undefined : parseQuickEventInfo(text, localDay(now), minuteOfDay(now));
    const ev = info?.ev;
    if (ev) {
      const startAt = localTime(ev.day, ev.minute);
      const dup = sameEvent(ev.title, startAt, false);
      if (dup) return dup;
      const reminds = remindsOf(remind, false, ev.minute);
      const added = o.events.add(
        {
          title: ev.title,
          startAt,
          endAt: ev.durationMin ? startAt + ev.durationMin * 60_000 : null,
          ...(reminds ? { reminds } : {}),
        },
        now,
      );
      push();
      o.onEventsChanged();
      // 어디에 언제로 넣었는지 알림에 보이고 되돌리거나 할 일로 옮길 수 있게 id 와 시각을 돌려준다
      const clash = clashOf(added);
      // 오전, 오후 없이 1~7시를 오후로 읽었다: 알림에 "(오후로 읽었어)" 와 오전으로 바꾸는 단추
      const amAt = info?.am ? localTime(info.am.day, info.am.minute) : undefined;
      const am =
        amAt === undefined
          ? undefined
          : { startAt: amAt, endAt: added.endAt === null ? null : amAt + (added.endAt - added.startAt) };
      return {
        ok: true,
        kind: 'event',
        id: added.id,
        startAt: added.startAt,
        ...(clash ? { clash } : {}),
        ...(am ? { am } : {}),
      };
    }
    return addTodo(text, now, remind);
  }
  /** N분 뒤 알림: 그 시각이 마감인 할 일에 정각 알림 하나 */
  function addRemindIn(title: string, minutes: number, now: number): PanelAddResult {
    const at = remindInAt(now, minutes);
    const todo = o.store.add({ title, due: localDay(at), dueMin: minuteOfDay(at), reminds: [0] }, now);
    push();
    return { ok: true, kind: 'todo', id: todo.id, due: todo.due, remindAt: at };
  }
  /** 한 줄을 할 일로 넣는다 (마감, 마감 시각, 중요, 반복, 알림은 글에서 읽는다) */
  function addTodo(line: string, now: number, taken?: TakenRemind): PanelAddResult {
    const split = taken === undefined ? splitRemind(line) : { rest: line, remind: taken };
    const parsed = parseTodoLine(split.rest, localDay(now), minuteOfDay(now));
    if (!parsed.title) return { ok: false, error: t('panel.add.empty') };
    const reminds = remindsOf(split.remind, parsed.dueMin === null, parsed.dueMin ?? 0);
    const todo = o.store.add({ ...parsed, ...(reminds ? { reminds } : {}) }, now);
    push();
    const past = !!todo.due && todo.due < localDay(now);
    return {
      ok: true,
      kind: 'todo',
      id: todo.id,
      due: todo.due,
      ...(past ? { past: true as const } : {}),
      ...(parsed.repeat === 'monthly' && parsed.repeatDay ? { monthly: parsed.repeatDay } : {}),
    };
  }
  // 시각이 있어 일정으로 들어간 한 줄을 할 일로 옮긴다 (알림의 "할 일로")
  ipcMain.handle(
    PANEL.eventToTodo,
    saving((e, id: unknown, text: unknown): PanelAddResult => {
      if (!ours(e) || typeof id !== 'number' || typeof text !== 'string') return { ok: false };
      const ev = o.events.get(id);
      if (!ev) return { ok: false, error: t('panel.retry') };
      const now = Date.now();
      const r = addTodo(text, now);
      if (!r.ok || r.kind !== 'todo') return r;
      // 글에서 날짜를 못 읽었으면("dentist 3pm") 일정이던 날을 마감으로 (언제 할 일인지 잃지 않게)
      const due = r.due ?? localDay(ev.startAt);
      // now 를 넘겨 이미 지난 기본 알림(어제 저녁 8시)은 말없이 넘긴다
      if (!r.due) o.store.update(r.id, { due }, now);
      o.events.remove(id, now);
      push();
      o.onEventsChanged();
      return { ...r, due };
    }),
  );
  // ---- 메모 ----
  ipcMain.handle(PANEL.noteGet, (e, id: number) => (ours(e) ? o.notes.get(id) : undefined));
  ipcMain.handle(PANEL.noteAdd, (e, text: unknown) => {
    if (!ours(e)) return undefined;
    // 찾기 칸에 적은 글로 만들 때는 그 글이 본문 첫 줄 (제목은 첫 줄에서 저절로)
    const body = typeof text === 'string' ? text.trim() : '';
    const n = o.notes.add(body ? { body } : {}, Date.now());
    freshNotes.add(n.id);
    push();
    return n;
  });
  // 찾기는 본문 전체를 본다 (목록에는 미리보기 80자만 가서 메인에서 찾는다)
  ipcMain.handle(PANEL.noteSearch, (e, query: unknown, composing: unknown) => {
    if (!ours(e) || typeof query !== 'string') return [];
    return searchNotes(o.notes.list(), query.slice(0, 200), composing === true);
  });
  // 할 일, 메모, 일정을 한 번에 (#146)
  ipcMain.handle(PANEL.findAll, (e, query: unknown, composing: unknown) => {
    if (!ours(e) || typeof query !== 'string') return findAll('', { todos: [], notes: [], events: [] }, 0);
    const now = Date.now();
    const { open, doneToday } = o.store.list(now);
    // 일정은 일정 탭 목록에 보이는 것(끝나지 않은 것)만: 찾아서 눌렀을 때 그 줄이 있어야 한다
    const today = localDay(now);
    const events = o.events
      .titles()
      .filter((ev) =>
        ev.allDay ? allDaySpan(ev).last >= today : (ev.endAt ?? ev.startAt + 30 * 60_000) >= now,
      );
    return findAll(
      query.slice(0, 200),
      { todos: [...open, ...doneToday], notes: o.notes.list(), events },
      now,
      composing === true,
    );
  });
  // 저장이 던지면(디스크 가득) 안내 글로 답한다. 메모 창은 글을 들고 있다가 다음 고침 때 다시 보낸다
  ipcMain.handle(
    PANEL.noteUpdate,
    saving((e, id: unknown, patch: unknown, base: unknown): NoteSaveResult => {
      if (!ours(e) || typeof id !== 'number' || typeof patch !== 'object' || patch === null)
        return { ok: false };
      const { title, body } = patch as { title?: unknown; body?: unknown };
      const baseObj =
        typeof base === 'object' && base !== null ? (base as { body?: unknown; at?: unknown }) : {};
      const baseBody = baseObj.body;
      const cur = o.notes.get(id);
      // 두 곳에서 같은 메모를 고쳤고 이 쓰기가 먼저 본 글에서 온 것이면 덮지 않는다 (시각이 없는 옛 호출은 지금처럼 합친다)
      if (
        cur &&
        staleNoteWrite(
          cur,
          typeof baseObj.at === 'number' ? baseObj.at : undefined,
          typeof body === 'string' ? body : undefined,
          typeof baseBody === 'string' ? baseBody : undefined,
        )
      )
        return { ok: false, stale: true, error: t('panel.note.stale') };
      // 창이 연 뒤 다른 곳(append_note 등)이 덧붙였으면 덮지 않고 합친다 (note-store.ts mergeNoteText)
      const saved = o.notes.updateFrom(
        id,
        {
          ...(typeof title === 'string' ? { title } : {}),
          ...(typeof body === 'string' ? { body } : {}),
        },
        typeof baseBody === 'string' ? { body: baseBody } : undefined,
        Date.now(),
      );
      push();
      const at = (saved ?? o.notes.get(id))?.updatedAt;
      return saved && typeof body === 'string' && saved.body !== body
        ? { ok: true, body: saved.body, ...(at !== undefined ? { updatedAt: at } : {}) }
        : { ok: true, ...(at !== undefined ? { updatedAt: at } : {}) };
    }),
  );
  ipcMain.on(PANEL.noteRemove, (e, id: number) => {
    if (!ours(e)) return;
    o.notes.remove(id, Date.now());
    push();
  });
  ipcMain.handle(PANEL.noteAi, (e, id: number, kind: NoteAiKind) => {
    const n = ours(e) ? o.notes.get(id) : undefined;
    if (!n?.body.trim()) return false;
    const ask = kind === 'summary' ? t('panel.noteAi.summary') : t('panel.noteAi.todos');
    const title = n.title.trim() ? `${t('panel.noteAi.title', { title: n.title.trim() })}\n` : '';
    if (!o.askAi(`${ask}\n\n${title}${n.body}`)) return false;
    closePanel();
    return true;
  });
  ipcMain.handle(PANEL.notePolishInfo, (e, id: unknown) => {
    if (!ours(e) || typeof id !== 'number') return { job: 'none' };
    return { ai: o.aiLabel(), job: polishJobs.state(id) };
  });
  // 메모마다 하나만 돈다. 같은 메모를 다시 누르거나 패널을 다시 열면 도는 것에 붙는다.
  // 패널이 닫혀(다른 곳을 눌러서) 받을 창이 없으면 답을 들고 있다가 그 메모를 다시 열 때 견주기로 보여 준다
  ipcMain.handle(PANEL.notePolish, async (e, id: unknown, req: unknown): Promise<PolishReply> => {
    if (!ours(e) || typeof id !== 'number') return { ok: false, error: 'none' };
    let job = polishJobs.get(id);
    if (!job) {
      const r = req as { body?: unknown; start?: unknown; end?: unknown } | undefined;
      if (!r || typeof r.body !== 'string') return { ok: false, error: 'none' };
      const body = r.body.slice(0, NOTE_BODY_MAX);
      const start = Number.isInteger(r.start) ? Math.max(0, Math.min(body.length, r.start as number)) : 0;
      const end = Number.isInteger(r.end) ? Math.max(start, Math.min(body.length, r.end as number)) : start;
      const src = start < end ? body.slice(start, end) : body;
      if (!src.trim()) return { ok: false, error: 'none' };
      if (src.length > POLISH_MAX) return { ok: false, error: 'tooLong' };
      if (o.aiLocked()) return { ok: false, error: 'locked' };
      job = polishJobs.start(id, async () => {
        const answer = await o.askOnce(
          polishRequest(t('panel.noteAi.polishAsk'), src),
          t('panel.noteAi.polishSystem'),
        );
        const text = cleanPolished(answer, src);
        return text ? { ok: true, text, body, start, end } : { ok: false, error: 'fail' };
      });
    }
    return job.done;
  });
  // 메모 화면이 답을 받아 띄웠다. 그 전에 창이 닫혔거나 목록으로 나갔으면 이 알림이 없어 답을 들고 있는다
  ipcMain.on(PANEL.notePolishTaken, (e, id: unknown) => {
    if (ours(e) && typeof id === 'number') polishJobs.taken(id);
  });
  ipcMain.on(PANEL.noteRestore, (e, id: number) => {
    if (!ours(e)) return;
    o.notes.restore(id);
    push();
  });
  // ---- 일정 ----
  ipcMain.handle(
    PANEL.eventAdd,
    saving((e, line: string, day?: unknown) => {
      if (!ours(e) || typeof line !== 'string') return { ok: false };
      const now = Date.now();
      // 달력에서 고른 날(day)이 있으면 그날을 기준으로 읽는다 ("3시 회의" 는 그날 3시, "내일" 은 그다음 날).
      // 오늘이 아닌 날은 0시로 보고 읽는다: 지금 시각보다 이른 시각을 다음 날로 미루지 않게
      const picked =
        typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && localDay(dayStartMs(day)) === day
          ? day
          : undefined;
      const base = picked ?? localDay(now);
      const minute = base === localDay(now) ? minuteOfDay(now) : 0;
      // 알림 말("1시간 전에 알려줘")은 먼저 뗀다
      const { rest: text, remind } = splitRemind(line);
      // 일정 탭에서는 날짜만 적어도 된다: "내일 제주도 여행"은 종일, "10/10-10/12 제주도"는 여러 날 종일.
      // (빠른 입력은 위 PANEL.add 처럼 시각이 있어야 일정이다. 거기서 날짜만 있으면 할 일 마감)
      const repeatTodo = parseTodoLine(text, base, minute);
      const repeat =
        repeatTodo.dueMin !== null &&
        (repeatTodo.repeat === 'daily' || repeatTodo.repeat === 'weekdays' || repeatTodo.repeat === 'weekly')
          ? repeatTodo.repeat
          : undefined;
      // 달력에서 고른 날이면 날짜도 시각도 없는 글("장보기")은 그날 종일. "오늘" 을 붙여 읽어
      // 시각처럼 보이는 말("25시 회의")은 종일로 넣지 않고 되묻는 규칙을 그대로 쓴다
      const eventText = repeat
        ? `${String(Math.floor((repeatTodo.dueMin ?? 0) / 60)).padStart(2, '0')}:${String((repeatTodo.dueMin ?? 0) % 60).padStart(2, '0')} ${repeatTodo.title}`
        : text;
      const eventBase = repeat ? (repeatTodo.due ?? base) : base;
      const ev =
        parseEventInput(eventText, eventBase, repeat ? 0 : minute) ??
        (!repeat && picked ? parseEventInput(`오늘 ${text}`, base, minute) : null);
      if (!ev || (repeat && 'allDay' in ev) || (repeatTodo.repeat && !repeat))
        return {
          ok: false,
          error: repeatTodo.repeat ? t('panel.event.noRepeat') : t('panel.event.needTime'),
          asTodo: !!repeatTodo.repeat,
        };
      let event: ReturnType<EventStore['add']>;
      if ('allDay' in ev) {
        const times = allDayTimes(ev.day, ev.lastDay);
        const dup = sameEvent(ev.title, times.startAt, true);
        if (dup) return dup;
        const reminds = remindsOf(remind, true);
        event = o.events.add(
          { title: ev.title, ...times, allDay: true, ...(reminds ? { reminds } : {}) },
          now,
        );
      } else {
        const startAt = localTime(ev.day, ev.minute);
        const dup = sameEvent(ev.title, startAt, false);
        if (dup) return dup;
        const reminds = remindsOf(remind, false, ev.minute);
        event = o.events.add(
          {
            title: ev.title,
            startAt,
            endAt: ev.durationMin ? startAt + ev.durationMin * 60_000 : null,
            ...(repeat ? { repeat } : {}),
            ...(reminds ? { reminds } : {}),
          },
          now,
        );
      }
      push();
      o.onEventsChanged();
      const clash = event.allDay ? undefined : clashOf(event);
      return { ok: true, event, ...(clash ? { clash } : {}) };
    }),
  );
  // ---- 할 일 단계 (9판) ----
  // 한 줄이나 여러 줄 (붙여 넣은 목록은 한 번에 넣고 한 번만 알린다. 줄마다 부르면 패널 상태를 줄 수만큼 다시 만들었다)
  ipcMain.handle(
    PANEL.stepAdd,
    saving((e, todoId: unknown, title: unknown) => {
      const titles = typeof title === 'string' ? [title] : Array.isArray(title) ? title : undefined;
      if (!ours(e) || typeof todoId !== 'number' || !titles || !titles.every((x) => typeof x === 'string'))
        return { ok: false };
      const todo = o.store.get(todoId);
      if (!todo || todo.doneAt !== null) return { ok: false, error: t('panel.retry') };
      const room = STEP_MAX - todo.steps.length;
      if (room <= 0) return { ok: false, error: t('assist.step.full', { n: STEP_MAX }) };
      const n = o.store.addSteps(todoId, (titles as string[]).slice(0, room), Date.now());
      if (n === 0) return { ok: false, error: t('panel.add.empty') };
      push();
      if (titles.length > room) return { ok: false, error: t('assist.step.full', { n: STEP_MAX }) };
      return { ok: true };
    }),
  );
  /** 이 단계의 할 일이 아직 열려 있는지 (끝냈거나 지운 할 일의 단계는 패널에서 바꾸지 않는다) */
  const openStep = (stepId: number) => {
    const owner = o.store.stepOwner(stepId);
    const todo = owner === undefined ? undefined : o.store.get(owner);
    return !!todo && todo.doneAt === null;
  };
  ipcMain.on(PANEL.stepToggle, (e, stepId: unknown, done: unknown) => {
    if (!ours(e) || typeof stepId !== 'number' || !openStep(stepId)) return;
    o.store.toggleStep(stepId, typeof done === 'boolean' ? done : undefined);
    push();
  });
  ipcMain.on(PANEL.stepRename, (e, stepId: unknown, title: unknown) => {
    if (!ours(e) || typeof stepId !== 'number' || typeof title !== 'string' || !openStep(stepId)) return;
    o.store.renameStep(stepId, title);
    push();
  });
  ipcMain.on(PANEL.stepRemove, (e, stepId: unknown) => {
    if (!ours(e) || typeof stepId !== 'number' || !openStep(stepId)) return;
    o.store.removeStep(stepId);
    push();
  });
  /** "지난 마감 오늘로"와 "못 한 N개 내일로"를 묶음마다 기억한다 (알림 둘이면 각자 자기 묶음만 되돌린다). 되돌리기는 메인이 지금 상태와 맞춰 한다 */
  const movedKept = new Map<number, { moved: { id: number; due: string | null }[]; day: string }>();
  let movedLast: number | undefined;
  const keepMoved = (key: number | undefined, moved: { id: number; due: string | null }[], day: string) => {
    // 0개면 기억을 덮지 않는다 (빠르게 두 번 불러 둘째가 0개여도 첫째 되돌리기가 남는다)
    if (moved.length === 0) return;
    const k = key ?? 0;
    movedKept.delete(k);
    movedKept.set(k, { moved, day });
    movedLast = k;
    // 오래된 묶음은 버린다 (알림은 몇 개 안 남는다)
    while (movedKept.size > 20) movedKept.delete(movedKept.keys().next().value as number);
  };
  ipcMain.handle(PANEL.moveOverdue, (e, to: unknown, opts: unknown) => {
    if (!ours(e)) return [];
    const now = Date.now();
    const o2 = typeof opts === 'object' && opts !== null ? (opts as Record<string, unknown>) : {};
    const key = typeof o2.key === 'number' && Number.isFinite(o2.key) ? o2.key : undefined;
    if (to === 'tomorrow') {
      // "못 한 N개 내일로": 화면이 본 오늘(today)과 본 목록(ids)을 기준으로 옮긴다 (자정이 지나 새로 오늘이 된 것은 그대로)
      // 화면이 본 날은 지금 날과 하루 차이 안에서만 받는다 (없는 날짜나 먼 날짜는 지금 날로)
      const nowDay = localDay(now);
      const near = [plusDays(nowDay, -1), nowDay, plusDays(nowDay, 1)];
      const day = typeof o2.today === 'string' && near.includes(o2.today) ? o2.today : nowDay;
      const ids = Array.isArray(o2.ids)
        ? o2.ids.filter((n): n is number => typeof n === 'number')
        : undefined;
      const tomorrow = plusDays(day, 1);
      const moved = o.store.deferTo(day, tomorrow, now, ids);
      keepMoved(key, moved, tomorrow);
      log('todo', 'defer-tomorrow', moved.length);
      push();
      return moved;
    }
    const today = localDay(now);
    // 오늘 탭 링크가 센 것(습관 빼고)만 옮긴다. 습관의 지난 회차는 습관 칸에서 체크한다
    const moved = o.store.moveOverdue(today, now, { habits: false });
    keepMoved(key, moved, today);
    log('todo', 'move-overdue', moved.length);
    push();
    return moved;
  });
  // 되돌리기: 아직 열려 있고 마감이 그대로 옮긴 날인 것만 (그사이 끝냈거나 마감을 바꾼 것은 둔다. 회고 되돌리기와 같다)
  ipcMain.on(PANEL.undoMoveOverdue, (e, key: unknown) => {
    if (!ours(e)) return;
    const k = typeof key === 'number' ? key : movedLast;
    const kept = k === undefined ? undefined : movedKept.get(k);
    if (k === undefined || !kept) return;
    movedKept.delete(k);
    const back = undoMoved(kept.moved, o.store.list(Date.now()).open, kept.day);
    const at = Date.now();
    for (const b of back) o.store.update(b.id, { due: b.due }, at);
    push();
  });
  // 달력 보기: 기간 안에 시작한 일정과, 앞에서 시작해 이어지는 여러 날 일정 (종일은 between, 시각은 timedOverlapping)
  ipcMain.handle(PANEL.eventsBetween, (e, from: unknown, to: unknown): CalEvent[] => {
    if (!ours(e) || typeof from !== 'number' || typeof to !== 'number') return [];
    // 달력 한 화면(6주)보다 넓게는 받지 않는다
    if (!(to > from) || to - from > 62 * 86_400_000) return [];
    const byId = new Map<number, CalEvent>();
    for (const ev of [...o.events.between(from, to), ...o.events.timedOverlapping(from, to)])
      byId.set(ev.id, ev);
    return withCals([...byId.values()].sort((a, b) => a.startAt - b.startAt || a.id - b.id));
  });
  ipcMain.on(PANEL.eventUpdate, (e, id: number, patch) => {
    if (!ours(e) || typeof patch !== 'object' || patch === null) return;
    const p = patch as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const reminds = remindsInput(p.reminds);
    o.events.update(
      id,
      {
        ...(typeof p.title === 'string' ? { title: p.title } : {}),
        ...(num(p.startAt) !== undefined ? { startAt: num(p.startAt) } : {}),
        ...(p.endAt === null || num(p.endAt) !== undefined
          ? { endAt: (p.endAt as number | null) ?? null }
          : {}),
        ...(num(p.remindMin) !== undefined ? { remindMin: num(p.remindMin) } : {}),
        ...(reminds ? { reminds } : {}),
        ...(typeof p.allDay === 'boolean' ? { allDay: p.allDay } : {}),
      },
      Date.now(),
    );
    push();
    o.onEventsChanged();
  });
  ipcMain.on(PANEL.eventRemove, (e, id: number) => {
    if (!ours(e)) return;
    o.events.remove(id, Date.now());
    push();
  });
  ipcMain.on(PANEL.eventRestore, (e, id: number) => {
    if (!ours(e)) return;
    o.events.restore(id);
    push();
  });
  // ---- 고정 (메모, 할 일, 일정) ----
  ipcMain.on(PANEL.pin, (e, kind: unknown, id: unknown, on: unknown) => {
    if (!ours(e) || !isPinKind(kind) || typeof id !== 'number' || typeof on !== 'boolean') return;
    const now = Date.now();
    if (kind === 'todo') o.store.pin(id, on, now);
    else if (kind === 'note') o.notes.pin(id, on, now);
    else o.events.pin(id, on, now);
    push();
  });
  // 할 일 순서 바꾸기와 반복 다음 회차 (#146)
  ipcMain.on(PANEL.place, (e, id: unknown, target: unknown, after: unknown) => {
    if (!ours(e) || typeof id !== 'number' || typeof target !== 'number') return;
    if (o.store.place(id, target, after === true, Date.now())) {
      log('todo', 'place', id);
      push();
    }
  });
  ipcMain.handle(PANEL.nextOf, (e, id: unknown) => {
    if (!ours(e) || typeof id !== 'number') return null;
    const next = o.store.nextOf(id);
    return next ? { due: next.due } : null;
  });
  // ---- 진행 중 표시 (펫 머리 위 말풍선) ----
  ipcMain.on(PANEL.doing, (e, id: unknown, on: unknown) => {
    if (!ours(e) || typeof id !== 'number' || typeof on !== 'boolean') return;
    // 열려 있는 할 일에만 켠다 (끝낸 할 일에 켜지지 않게)
    const todo = on ? o.store.get(id) : undefined;
    if (on && (!todo || todo.doneAt !== null)) return;
    o.doing.set(id, on);
    push();
  });
  // ---- 상점과 놀이 (v1) ----
  ipcMain.handle(PANEL.buyToy, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return { ok: false, error: t('panel.retry') };
    const r = o.shop.buyToy(key, Date.now());
    push();
    return r;
  });
  ipcMain.handle(PANEL.buyHouse, (e, level: unknown) => {
    if (!ours(e) || typeof level !== 'number') return { ok: false, error: t('panel.retry') };
    const r = o.shop.buyHouse(Date.now(), level);
    push();
    if (r.ok) o.onHouseChanged('level');
    return r;
  });
  ipcMain.handle(PANEL.buyHouseStyle, (e, style: unknown) => {
    if (!ours(e)) return { ok: false, error: t('panel.retry') };
    const before = o.shop.state().houseStyle;
    const r = o.shop.buyHouseStyle(style, Date.now());
    push();
    if (r.ok && o.shop.state().houseStyle !== before) o.onHouseChanged('style');
    return r;
  });
  ipcMain.on(PANEL.setHouseHidden, (e, on: unknown) => {
    if (ours(e) && typeof on === 'boolean') o.setHouseHidden(on);
  });
  ipcMain.handle(PANEL.feedWith, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return { ok: false };
    const food = o.shop.food(key);
    if (!food) return { ok: false, error: t('shop.err.noFood') };
    const r = o.store.feed(Date.now(), food);
    push();
    if (!r.ok)
      return { ok: false, error: r.full ? t('pet.full') : t('shop.err.needCoins', { n: food.cost }) };
    o.onFedWith(food);
    return { ok: true };
  });
  ipcMain.handle(PANEL.makeFood, (e) => {
    if (!ours(e)) return { ok: false, error: t('panel.retry') };
    if (o.store.balance() < CUSTOM_FOOD_COST)
      return { ok: false, error: t('shop.err.needCoins', { n: CUSTOM_FOOD_COST }) };
    if (o.shop.state().customFoods.length >= CUSTOM_FOOD_MAX)
      return { ok: false, error: t('shop.err.foodMaxShort', { n: CUSTOM_FOOD_MAX }) };
    closePanel();
    o.openFoodMaker();
    return { ok: true };
  });
  ipcMain.on(PANEL.removeFood, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return;
    o.removeFoodImage(o.shop.removeCustomFood(key));
    push();
  });
  ipcMain.on(PANEL.play, (e, kind: PlayKind) => {
    if (!ours(e) || (kind !== 'ball' && kind !== 'walk' && kind !== 'seek')) return;
    closePanel();
    o.play(kind);
  });
  // ---- 집중 타이머 ----
  ipcMain.on(PANEL.focusStart, (e, minutes: unknown, todoId: unknown) => {
    if (!ours(e)) return;
    const id = typeof todoId === 'number' && Number.isInteger(todoId) ? todoId : undefined;
    o.startFocus(isFocusMinutes(minutes) ? minutes : undefined, id);
  });
  ipcMain.handle(PANEL.focusStop, (e) => (ours(e) ? (o.stopFocus() ?? null) : null));
  ipcMain.handle(PANEL.focusResume, (e) => (ours(e) ? o.resumeFocus() : false));
  ipcMain.on(PANEL.focusUndo, (e) => {
    if (ours(e)) o.resumeFocus();
  });
  ipcMain.on(PANEL.missedClear, (e) => {
    if (ours(e)) o.clearMissed();
  });
  ipcMain.handle(PANEL.complete, (e, id: number) => {
    if (!ours(e)) return 0;
    // 이미 끝냈거나 없는 할 일(체크를 빠르게 여러 번 누름)은 다시 기뻐하지 않는다
    const coins = o.store.completeOpen(id, Date.now());
    if (coins === null) return null;
    log('todo', 'complete', id, coins);
    push();
    o.onCompleted(coins, id);
    return coins;
  });
  ipcMain.handle(PANEL.undo, (e, id: number) => {
    if (!ours(e)) return 0;
    const back = o.store.undo(id, Date.now());
    push();
    return back;
  });
  ipcMain.on(PANEL.update, (e, id: number, patch) => {
    if (!ours(e)) return;
    // 아는 칸만 (마감 시각, 알림은 8판). 지금 시각을 주어 이미 지난 알림은 넘긴다
    o.store.update(id, todoPatchInput(patch), Date.now());
    push();
  });
  ipcMain.on(PANEL.remove, (e, id: number) => {
    if (!ours(e)) return;
    o.store.remove(id, Date.now());
    push();
  });
  ipcMain.on(PANEL.restore, (e, id: number) => {
    if (!ours(e) || typeof id !== 'number') return;
    o.store.restore(id);
    push();
  });
  // 통합 휴지통: 할 일·메모·일정을 30일 보관한다.
  ipcMain.handle(PANEL.trashList, (e) => {
    if (!ours(e)) return [];
    const now = Date.now();
    const gone = o.store.purgeExpired(now) + o.notes.purgeExpired(now) + o.events.purgeExpired(now);
    if (gone > 0) {
      log('todo', '휴지통 30일 지난 항목 영구 삭제', gone);
      push();
    }
    return [
      ...o.store.trash(now).map((x) => ({ ...x, kind: 'todo' as const })),
      ...o.notes.trash(now).map((x) => ({ ...x, kind: 'note' as const })),
      ...o.events.trash(now).map((x) => ({ ...x, kind: 'event' as const })),
    ].sort((a, b) => b.deletedAt - a.deletedAt || b.id - a.id);
  });
  ipcMain.handle(PANEL.trashRestore, (e, kind: unknown, id: unknown) => {
    if (!ours(e) || typeof id !== 'number') return 'gone';
    if (kind === 'todo') {
      const res = o.store.restoreCheck(id);
      if (res === 'ok') {
        o.store.restoreFromTrash(id);
        log('todo', '휴지통에서 되살림', id);
      } else if (res === 'dup') log('todo', '같은 반복이 열려 있어 되살리지 않음', id);
      push();
      return res;
    }
    const record =
      kind === 'note'
        ? o.notes.trash(Date.now()).find((x) => x.id === id)
        : kind === 'event'
          ? o.events.trash(Date.now()).find((x) => x.id === id)
          : undefined;
    if (!record) return 'gone';
    if (kind === 'note') o.notes.restore(id);
    else o.events.restore(id);
    log(kind, '휴지통에서 되살림', id);
    push();
    return 'ok';
  });
  ipcMain.handle(PANEL.trashPurge, (e, kind: unknown, id: unknown) => {
    if (!ours(e) || typeof id !== 'number') return 0;
    const n =
      kind === 'todo'
        ? o.store.purge([id])
        : kind === 'note'
          ? o.notes.purge(id)
          : kind === 'event'
            ? o.events.purgeTrash(id)
            : 0;
    if (n > 0) log('todo', '영구 삭제', id);
    push();
    return n;
  });
  ipcMain.handle(PANEL.trashEmpty, (e) => {
    if (!ours(e)) return 0;
    const n = o.store.emptyTrash() + o.notes.purge() + o.events.purgeTrash();
    log('todo', '휴지통 비움', n);
    push();
    return n;
  });
  // 집중 월간 잔디 (#125)
  ipcMain.handle(PANEL.focusMonth, (e, month: unknown): FocusMonthView | undefined => {
    if (!ours(e) || !isMonth(month)) return undefined;
    const thisMonth = monthOf(localDay(Date.now()));
    const stats = o.stats;
    try {
      const first = stats?.firstFocusDay();
      return {
        month,
        days: stats?.focusMonth(month) ?? [],
        firstMonth: first ? monthOf(first) : thisMonth,
      };
    } catch (err) {
      log('panel', '집중 기록 못 읽음', err instanceof Error ? err.message : String(err));
      return { month, days: [], firstMonth: thisMonth };
    }
  });
  ipcMain.handle(PANEL.feed, (e) => {
    if (!ours(e)) return { ok: false };
    const r = o.store.feed(Date.now());
    push();
    if (r.ok) o.onFed();
    return { ok: r.ok };
  });
  ipcMain.on(PANEL.openSettings, (e) => {
    if (!ours(e)) return;
    if (closesPanelFor(originOf(e.sender, homeContents()))) closePanel();
    o.openSettings();
  });
  ipcMain.on(PANEL.openChat, (e) => {
    if (!ours(e)) return;
    if (closesPanelFor(originOf(e.sender, homeContents()))) closePanel();
    o.openChat();
  });
  ipcMain.on(PANEL.lookTogether, (e) => {
    if (!ours(e)) return;
    if (closesPanelFor(originOf(e.sender, homeContents()))) closePanel();
    o.lookTogether();
  });
  // 빠른 입력 창 높이를 내용에 맞춘다 (큰 글씨에서 위아래가 잘렸다). 위 가장자리는 그대로 두고 아래로 늘린다
  ipcMain.on(PANEL.quickFit, (e, contentCss: unknown) => {
    if (!quick || quick.isDestroyed() || e.sender !== quick.webContents || typeof contentCss !== 'number')
      return;
    const height = quickHeight(contentCss, quick.webContents.getZoomFactor());
    const b = quick.getBounds();
    if (b.height !== height) quick.setBounds({ ...b, height });
  });
  // 크기 손잡이 (렌더러가 끌기를 알리고 바라는 크기를 CSS px 로 보낸다)
  let resizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeLast = 0;
  let resizeWant: { width?: number; height?: number } | undefined;

  const isPanel = (e: IpcMainEvent) =>
    ours(e) && !!panel && !panel.isDestroyed() && e.sender === panel.webContents;
  /** 작은 패널이나 큰 창이 보낸 것 (되돌리기 알림, 보던 위치는 두 면이 같이 쓴다) */
  const isSurface = (e: IpcMainEvent) => isPanel(e) || (ours(e) && e.sender === homeContents());

  /** 지금 창 크기를 범위 안에서 바꾼다 (want 는 창 크기 DIP. 왼쪽 위는 그대로, 작업 영역을 넘으면 안쪽으로 민다) */
  function applyResize(want: { width?: number; height?: number }) {
    const win = panel;
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const next = resizePanelRect(b, { width: want.width ?? b.width, height: want.height ?? b.height }, area);
    if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height)
      win.setBounds(next);
    resizeLast = Date.now();
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      resizeSaveTimer = undefined;
      saveBounds(win, 'panel', false);
    }, RESIZE_SAVE_MS);
  }

  /** 모인 요청을 적용한다. 간격이 모자라면 남은 만큼 기다렸다가 */
  function scheduleResize() {
    if (resizeFlushTimer) return;
    const wait = Math.max(0, RESIZE_GAP_MS - (Date.now() - resizeLast));
    resizeFlushTimer = setTimeout(() => {
      resizeFlushTimer = undefined;
      flushResize();
    }, wait);
  }

  function flushResize() {
    clearTimeout(resizeFlushTimer);
    resizeFlushTimer = undefined;
    const want = resizeWant;
    resizeWant = undefined;
    if (want) applyResize(want);
  }

  /** "끄는 중"을 푼다 (끝 알림, 감시 기한, 창 닫힘) */
  function stopResizing() {
    resizeIdle.stop();
    resizing = false;
    if (process.platform === 'linux' && panel && !panel.isDestroyed()) panel.setResizable(false);
  }
  const resizeIdle = createIdleWatch(RESIZE_IDLE_MS, () => {
    flushResize();
    stopResizing();
  });

  ipcMain.on(PANEL.resizeStart, (e) => {
    if (!isPanel(e)) return;
    resizing = true;
    resizeIdle.poke();
    // 리눅스 일부 창 관리자는 크기 고정 창의 setBounds 를 무시한다. 끄는 동안만 푼다
    if (process.platform === 'linux') panel?.setResizable(true);
  });
  ipcMain.on(PANEL.resize, (e, width: unknown, height: unknown) => {
    if (!isPanel(e) || !resizing) return;
    resizeIdle.poke();
    // 화면은 CSS px 로 보내니 창 확대 배율(큰 글씨)을 곱해 창 크기로 바꾼다
    const zoom = panel?.webContents.getZoomFactor() ?? 1;
    const dip = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v * zoom : undefined);
    resizeWant = { width: dip(width), height: dip(height) };
    scheduleResize();
  });
  ipcMain.on(PANEL.resizeEnd, (e) => {
    if (!isPanel(e) || !resizing) return;
    flushResize();
    stopResizing();
  });
  // 처음 크기로 (손잡이 두 번 누르기)
  ipcMain.on(PANEL.resizeReset, (e) => {
    if (!isPanel(e)) return;
    applyResize(PANEL_DEFAULT);
  });

  // 쓰던 글, 보던 위치 (#145). 창이 뜨며 바로 읽으니 읽기는 동기
  ipcMain.on(PANEL.draftGet, (e, kind: unknown) => {
    e.returnValue = ours(e) && isPanelDraftKind(kind) ? drafts.text(kind) : '';
  });
  ipcMain.on(PANEL.draftSet, (e, kind: unknown, text: unknown) => {
    // 채팅 칸은 채팅 창 몫이라 패널에서는 쓰지 못한다
    if (ours(e) && isPanelDraftKind(kind)) drafts.setText(kind, text);
  });
  // 메모 편집의 보관 글 (#160): 패널 창만, 메모 id 마다
  ipcMain.on(PANEL.noteKeepGet, (e, id: unknown) => {
    e.returnValue = (ours(e) ? noteKeep.get(id, Date.now()) : undefined) ?? null;
  });
  ipcMain.on(PANEL.noteKeepSet, (e, id: unknown, value: unknown) => {
    if (ours(e)) noteKeep.set(id, value, Date.now());
  });
  ipcMain.on(PANEL.noteNewTake, (e, request: unknown) => {
    const take = isSurface(e) && pendingNewNote && request === newNoteRequest;
    if (take) pendingNewNote = false;
    e.returnValue = take;
  });
  ipcMain.on(PANEL.noteKeepLatest, (e) => {
    e.returnValue = (ours(e) ? noteKeep.latest(Date.now()) : undefined) ?? null;
  });
  ipcMain.on(PANEL.viewGet, (e) => {
    e.returnValue = ours(e) ? getView() : emptyViewKeep();
  });
  ipcMain.on(PANEL.viewSet, (e, view: unknown) => {
    if (isSurface(e)) setView(view);
  });
  ipcMain.on(PANEL.toastsGet, (e) => {
    e.returnValue = isSurface(e) ? getToasts() : [];
  });
  ipcMain.on(PANEL.toastsSet, (e, list: unknown) => {
    if (isSurface(e)) setToasts(list);
  });
  ipcMain.on(PANEL.setKeepOpen, (e, on: unknown) => {
    if (isPanel(e) && typeof on === 'boolean') o.setPanelPin(on);
  });
  // 큰 창 바닥의 "펫을 누르면 이 창으로 열기"와 사이드바 "친구"
  ipcMain.on(PANEL.setPanelView, (e, view: unknown) => {
    if (isSurface(e) && isPanelView(view)) o.setPanelView(view);
  });
  ipcMain.on(PANEL.openFriends, (e) => {
    if (!ours(e)) return;
    if (closesPanelFor(originOf(e.sender, homeContents()))) closePanel();
    o.openFriends();
  });

  // "크게 볼까요?" 칩을 마지막으로 띄운 때 (메모리에만. 패널 창이 새로 떠도 간격이 이어진다)
  let expandHintAt = 0;
  ipcMain.on(PANEL.expandHintAt, (e) => {
    // 패널이 아니면 방금 띄운 것으로 답해 칩이 안 뜨게 한다
    e.returnValue = isPanel(e) ? expandHintAt : Date.now();
  });
  ipcMain.on(PANEL.expandHintShown, (e) => {
    if (isPanel(e)) expandHintAt = Date.now();
  });

  // 크게 보기: 패널이 쓰던 글을 먼저 보낸 뒤 부른다 (같은 창에서 온 메시지는 순서대로 닿는다)
  let expandAsked = false;
  ipcMain.on(PANEL.expand, (e, tab: unknown) => {
    if (!isPanel(e) || !isPanelTab(tab)) return;
    expandAsked = true;
    o.promoteHome?.(tab);
  });

  /**
   * 패널이 열린 채 트레이, 펫 메뉴로 큰 창을 열 때: 패널에 쓰던 글을 보내고 넘겨 달라고 한다. 열려 있으면 true.
   * 패널이 답이 없으면(멈춤) 잠시 뒤 그냥 큰 창을 연다
   */
  function requestExpand(): boolean {
    const win = panel;
    if (!win || win.isDestroyed()) return false;
    expandAsked = false;
    win.webContents.send(PANEL.expandNow);
    setTimeout(() => {
      if (!expandAsked && panel === win && !win.isDestroyed()) o.promoteHome?.();
    }, EXPAND_ASK_MS);
    return true;
  }

  ipcMain.on(PANEL.close, (e) => {
    if (!ours(e)) return;
    if (panel && e.sender === panel.webContents) closePanel();
    if (quick && !quick.isDestroyed() && e.sender === quick.webContents) quick.close();
  });

  function log(...rest: unknown[]) {
    o.log(...(rest as [string, ...unknown[]]));
  }

  /** 패널에서 띄운 저장 창이 떠 있는 수. 그동안은 다른 곳을 눌러도 닫지 않는다 */
  let holding = 0;
  /** 패널 크기 손잡이를 끄는 중 */
  let resizing = false;

  function makeWindow(kind: 'panel' | 'quick', bounds: Rectangle, tab?: PanelTab) {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: [`--jj-window=${kind}`, langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    const sender = win.webContents;
    senders.add(sender);
    win.on('closed', () => senders.delete(sender));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = devRendererUrl();
    if (devUrl) win.loadURL(`${devUrl}/${kind}.html${tab ? `#${tab}` : ''}`);
    else win.loadFile(join(import.meta.dirname, `../renderer/${kind}.html`), { hash: tab });
    win.once('ready-to-show', () => focusWindow(win));
    // 다른 곳을 누르면 닫힌다 (팝오버처럼). 머리를 잡고 끄는 것은 이 창을 누른 것이라 닫히지 않는다.
    win.on('blur', () => {
      // 저장 창(주간 회고 카드)을 띄운 동안은 닫지 않는다 (hold)
      // 크기를 끄는 동안(손잡이)도 닫지 않는다
      // 패널 고정 핀(#145)이 켜져 있으면 패널은 닫지 않는다 (Esc, 펫 클릭, 단축키로만 닫힌다). 빠른 입력은 늘 닫힌다
      if (
        !win.isDestroyed() &&
        holding === 0 &&
        !(resizing && win === panel) &&
        !(kind === 'panel' && o.panelPin())
      )
        win.close();
    });
    keepFrame(win);
    return win;
  }

  /**
   * 끄는 자리(머리)를 두 번 누르면 맥은 시스템 설정(데스크톱과 Dock)에 따라 창을 확대하거나 Dock 으로 내린다.
   * 크기 고정 팝오버라 확대는 화면 끝으로 튀기만 하고 내리면 펫을 눌러도 안 보인다. 둘 다 바로 되돌린다.
   * 확대는 움직임이 여러 번 온 뒤 'unmaximize' 로 끝나서, 멈춘 지 MOVE_SAVE_MS 지난 자리를 되돌릴 자리로 둔다.
   */
  function keepFrame(win: BrowserWindow) {
    let rest = win.getBounds();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (relocating.has(win)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) rest = win.getBounds();
      }, MOVE_SAVE_MS);
    };
    win.on('move', settle);
    // 크기를 바꾼 패널의 확대 되돌리기가 옛 크기로 돌려놓지 않게
    win.on('resize', settle);
    const undoZoom = () => {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.setBounds(rest);
    };
    win.on('maximize', undoZoom);
    win.on('unmaximize', undoZoom);
    win.on('minimize', () => {
      if (!win.isDestroyed()) win.restore();
    });
  }

  /** 새로 만들고 아무것도 안 쓴 메모를 지운다. 패널 쪽(뒤로, 닫기)에서도 지우지만 창이 갑자기 닫혀도 남지 않게 한 번 더 */
  function dropEmptyNotes() {
    let dropped = false;
    for (const id of freshNotes) {
      const n = o.notes.get(id);
      if (n && !n.title.trim() && !n.body.trim()) {
        o.notes.remove(id, Date.now());
        dropped = true;
      }
    }
    freshNotes.clear();
    if (dropped) push();
  }

  function closePanel() {
    if (panel && !panel.isDestroyed()) panel.close();
    panel = undefined;
  }

  /** 패널을 열고 이 탭을 보여 준다 (이미 열려 있으면 탭만) */
  function openTab(tab: PanelTab = 'today') {
    if (o.routeHome?.({ tab, toggle: false })) return;
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send(PANEL.tab, tab);
      focusWindow(panel);
      return;
    }
    openPanel(tab);
  }

  /** 다음에 펫을 눌러 패널을 열 때 한 번만 이 탭으로 (첫 안내 직후 할 일 탭) */
  let nextTab: PanelTab | undefined;

  function togglePanel() {
    // 큰 창이 열려 있거나 패널 보기가 큰 창이면 큰 창이 맡는다 (둘을 함께 열지 않는다)
    if (!(panel && !panel.isDestroyed()) && o.routeHome) {
      const tab = nextTab;
      if (o.routeHome({ tab, toggle: true })) {
        nextTab = undefined;
        return;
      }
    }
    if (panel && !panel.isDestroyed()) {
      closePanel();
      return;
    }
    const tab = nextTab;
    nextTab = undefined;
    openPanel(tab);
  }

  /** 펫이 있는 화면의 작업 영역 */
  const petArea = () => screen.getDisplayMatching(o.petBounds()).workArea;
  /** 지금 연결된 모든 화면 (모니터를 뺐으면 빠진다) */
  const allAreas = () => screen.getAllDisplays().map((d) => d.workArea);

  onDisplaysChanged((displays) => {
    const areas = displays.map((d) => d.workArea);
    const moveIntoRange = (win: BrowserWindow, next: Rectangle) => {
      const current = win.getBounds();
      if (
        current.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
      )
        return;
      relocating.add(win);
      win.setBounds(next);
      setTimeout(() => relocating.delete(win), 800);
    };
    if (panel && !panel.isDestroyed()) {
      // 펫이 옮겨진 뒤 같은 상대 위치를 다시 계산한다. 작은 작업 영역이면 placePanel 이 패널 크기도 줄인다.
      const placed = placePanel(o.petBounds(), panelSize(), petArea(), areas, offset);
      moveIntoRange(panel, placed);
      saveBounds(panel, 'panel', false);
    }
    if (quick && !quick.isDestroyed()) {
      const fitted = fitSavedBounds(quick.getBounds(), areas, {
        width: QUICK_SIZE.width,
        height: QUICK_SIZE.height,
      });
      if (fitted?.x !== undefined && fitted.y !== undefined)
        moveIntoRange(quick, { x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height });
    }
  });

  /** 열 때 크기: 적어 둔 크기(없으면 처음 크기)를 범위 안으로. 작업 영역보다 크면 placePanel 이 한 번 더 줄인다 */
  function panelSize() {
    const saved = savedBounds('panel', PANEL_MIN);
    return clampPanelSize(saved ?? PANEL_DEFAULT, petArea());
  }

  function openPanel(tab?: PanelTab) {
    const placed = placePanel(o.petBounds(), panelSize(), petArea(), allAreas(), offset);
    const win = makeWindow('panel', placed, tab);
    panel = win;
    // 옛 창이 늦게 닫혀도 새 창 참조를 지우지 않게 (빨리 닫았다 열면 빈 패널이 남았다)
    win.on('closed', () => {
      // 끄는 중이던 것이 이 창 것일 때만 푼다 (옛 창이 늦게 닫히며 새 패널의 끌기를 지우지 않게)
      if (panel === win) {
        panel = undefined;
        stopResizing();
        resizeWant = undefined;
        clearTimeout(resizeFlushTimer);
        resizeFlushTimer = undefined;
      }
      dropEmptyNotes();
    });
    rememberMoves(win, placed);
    // 크기를 바꾸고 바로 닫으면 (적기 전에) 닫기 직전에 적는다
    win.on('close', () => {
      if (!resizeSaveTimer) return;
      clearTimeout(resizeSaveTimer);
      resizeSaveTimer = undefined;
      saveBounds(win, 'panel', false);
    });
  }

  /**
   * 사용자가 머리를 잡고 끌어 옮기면 펫과의 거리를 기억한다. 끄는 중에는 'move' 가 계속 오니 멈춘 뒤 한 번,
   * 그 전에 닫히면(다른 곳을 눌러서) 닫히기 직전에 저장한다. 연 자리 그대로면(운영체제가 다시 알린 것) 저장하지 않는다.
   */
  function rememberMoves(win: BrowserWindow, placed: Rectangle) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      if (b.x === placed.x && b.y === placed.y) return;
      const pet = o.petBounds();
      const next = panelOffsetAfterMove(b, pet, defaultPanelBounds(pet, b, petArea()));
      if (next?.x === offset?.x && next?.y === offset?.y) return;
      offset = next;
      try {
        if (next) writeJson(OFFSET_FILE, { dx: next.x, dy: next.y });
        else removeJson(OFFSET_FILE);
      } catch (err) {
        log('panel', 'save position failed', String(err));
        return;
      }
      log('panel', 'moved', next ? JSON.stringify(next) : 'default');
    };
    win.on('move', () => {
      clearTimeout(timer);
      if (relocating.has(win)) return;
      timer = setTimeout(save, MOVE_SAVE_MS);
    });
    win.on('close', () => {
      if (timer) save();
    });
  }

  function openQuick() {
    if (quick && !quick.isDestroyed()) {
      focusWindow(quick);
      return;
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    quick = makeWindow('quick', {
      ...QUICK_SIZE,
      x: Math.round(area.x + (area.width - QUICK_SIZE.width) / 2),
      y: Math.round(area.y + area.height * 0.22),
    });
    const win = quick;
    win.on('closed', () => {
      if (quick === win) quick = undefined;
    });
  }

  return {
    togglePanel,
    openTab,
    newNote: () => {
      newNoteRequest++;
      pendingNewNote = true;
      openTab('note');
      push();
    },
    /** 다음 한 번 패널을 열 때 보일 탭 */
    openNextAt: (tab: PanelTab) => {
      nextTab = tab;
    },
    closePanel,
    requestExpand,
    /** 시험용: 칩 간격 기억을 비운다 */
    resetExpandHint: () => {
      expandHintAt = 0;
    },
    openQuick,
    /** 빠른 입력 한 줄과 같게 넣는다 (jjakkung://add): 시각이 있으면 일정, 아니면 할 일 */
    addLine: (line: string): PanelAddResult => addLine(line, Date.now()),
    /** 펫 이름이나 배부름 등이 밖에서 바뀌었을 때 */
    refresh: push,
    /** 패널이나 빠른 입력 창이 보낸 것인지 (main/day-tools.ts) */
    owns: (wc: Electron.WebContents) => senders.has(wc),
    get window() {
      return panel;
    },
    activeSurface,
    fromSurface,
    /**
     * 큰 창을 면으로 알린다 (아직 만드는 곳이 없다). 이 창의 요청도 받고 상태를 같이 받는다.
     * 큰 창에서 온 설정, 채팅 열기는 패널을 먼저 닫지 않는다. 돌려주는 함수로 뗀다
     */
    registerHome(win: SurfaceWin, hidden: () => boolean = () => false): () => void {
      const sender = win.webContents;
      home = win;
      homeHidden = hidden;
      senders.add(sender);
      const off = () => {
        if (home === win) {
          home = undefined;
          homeHidden = () => false;
        }
        senders.delete(sender);
      };
      win.once('closed', off);
      return off;
    },
    get quickWindow() {
      return quick;
    },
    /** 일(저장 창)이 끝날 때까지 패널을 열어 둔다. 끝나면 패널을 다시 앞으로 */
    async hold<T>(work: () => Promise<T>): Promise<T> {
      holding++;
      try {
        return await work();
      } finally {
        holding--;
        if (panel && !panel.isDestroyed()) focusWindow(panel);
      }
    },
  };
}
