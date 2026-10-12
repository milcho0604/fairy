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
import { findSameEvent } from '../shared/event-dup.ts';
import { clashIds, overlapping, spanEnd } from '../shared/event-overlap.ts';
import {
  allDayTimes,
  type CalEvent,
  dayStartMs,
  type EventStore,
  hasTimeRange,
  parseEventInput,
  parseQuickEventInfo,
} from '../shared/event-store.ts';
import { type FocusState, focusCoins, isFocusLength } from '../shared/focus.ts';
import { t } from '../shared/i18n/index.ts';
import {
  type EventClash,
  type NoteAiKind,
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
import { NOTE_BODY_MAX, type NoteStore, notePreview, noteTitle, searchNotes } from '../shared/note-store.ts';
import {
  defaultPanelBounds,
  panelOffsetAfterMove,
  parsePanelOffset,
  placePanel,
} from '../shared/panel-place.ts';
import { isPinKind } from '../shared/pin.ts';
import { hasDeadlineWord } from '../shared/quick-add.ts';
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
import { weekSummary } from '../shared/week.ts';
import { devRendererUrl } from './dev-url.ts';
import { focusWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { localTime, minuteOfDay, startOfDay, startOfDayAfter } from './planner.ts';
import { readJson, removeJson, writeJson } from './store.ts';

const PANEL_SIZE = { width: 360, height: 540 };
/** 여러 줄 붙여 넣기는 한 번에 이만큼까지 */
const ADD_MANY_MAX = 50;
const QUICK_SIZE = { width: 480, height: 64 };
/** 사용자가 끌어 놓은 패널 자리 (펫에서 떨어진 거리) */
const OFFSET_FILE = 'panel-position';
/** 끄는 동안 'move' 가 계속 와서 멈춘 뒤에 한 번 저장한다 */
const MOVE_SAVE_MS = 400;

export interface PanelOptions {
  store: TodoStore;
  notes: NoteStore;
  events: EventStore;
  focus: () => FocusState;
  /** 집중 시작. 길이(15, 25, 50분)를 주면 그 길이로, 할 일 id 를 주면 그 할 일을 하는 집중 */
  startFocus: (minutes?: number, todoId?: number) => void;
  /** 고른 집중 길이 */
  focusMin: () => number;
  stopFocus: () => void;
  /** 일정이 바뀌었다 (곧 시작하는 일정이면 바로 알림) */
  onEventsChanged: () => void;
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
  /** 기억한 패널 자리 (펫 왼쪽 위에서 떨어진 거리). 없으면 펫 옆 기본 자리 */
  let offset = parsePanelOffset(readJson(OFFSET_FILE));
  /**
   * 우리가 만든 창 (닫히는 중인 것도). closePanel 은 panel 을 바로 비우는데 창은 그 뒤에 닫히며 메모의 남은 글을 보낸다
   * (beforeunload). panel 하고만 비교하면 그 마지막 저장이 버려졌다.
   */
  const senders = new Set<Electron.WebContents>();
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) => senders.has(e.sender);
  /** 이번에 "새 메모"로 만든 것. 패널이 닫힐 때 아직 비어 있으면 지운다 (빈 메모가 쌓이지 않게) */
  const freshNotes = new Set<number>();
  /** 메모 다듬기 (메모 id 마다 하나) */
  const polishJobs = createPolishJobs();

  function state(): PanelState {
    const now = Date.now();
    const { open, doneToday } = o.store.list(now);
    return {
      petName: o.petName(),
      today: localDay(now),
      open,
      doneToday,
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
      events: o.events.between(startOfDay(now), startOfDayAfter(now, 14)),
      // 안 끝난 시각 일정끼리 (어제부터 이어지는 것 포함). 일정 탭이 보이는 것과 같은 범위
      eventClash: [...clashIds(o.events.timedOverlapping(now, startOfDayAfter(now, 14)))],
      pinnedEvents: o.events.pinned(now),
      focus: o.focus(),
      focusMin: o.focusMin(),
      focusCoins: focusCoins(o.focusMin()),
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
    };
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
    for (const w of [panel, quick]) if (w && !w.isDestroyed()) w.webContents.send(PANEL.state, s);
    o.onChanged();
  }

  ipcMain.handle(PANEL.snapshot, (e) => (ours(e) ? state() : undefined));
  ipcMain.handle(PANEL.add, (e, text: string): PanelAddResult => {
    if (!ours(e) || typeof text !== 'string') return { ok: false };
    const now = Date.now();
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
      for (const line of lines) {
        const r = addLine(line, now);
        if (r.ok && r.kind === 'event') events++;
        else if (r.ok) todos++;
      }
      if (todos + events === 0) return { ok: false, error: t('panel.add.empty') };
      return { ok: true, kind: 'many', todos, events };
    }
    return addLine(text, now);
  });
  /**
   * 한 줄 넣기. 시각이 들어 있으면("내일 3시 회의") 일정으로 넣는다.
   * "3시까지", "by 5pm"은 마감이라 할 일로 둔다(시각 범위 "3시부터 5시까지"는 일정).
   * 반복 낱말이 있으면("매일 아침 7시 스트레칭") 시각이 있어도 반복 할 일이다 (반복 일정은 없다. 시각은 마감 시각)
   */
  /** 같은 제목과 시각의 일정이 이미 있으면 넣지 않고 알릴 답 (두 번 눌러 겹쳐 넣는 일이 잦다) */
  function sameEvent(title: string, startAt: number, allDay: boolean) {
    const found = findSameEvent(o.events.between(startAt, startAt + 1), { title, startAt, allDay });
    if (!found) return undefined;
    return { ok: false as const, error: t('panel.event.duplicate', { title: found.title }) };
  }
  function addLine(line: string, now: number): PanelAddResult {
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
  ipcMain.handle(PANEL.eventToTodo, (e, id: unknown, text: unknown): PanelAddResult => {
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
  });
  // ---- 메모 ----
  ipcMain.handle(PANEL.noteGet, (e, id: number) => (ours(e) ? o.notes.get(id) : undefined));
  ipcMain.handle(PANEL.noteAdd, (e) => {
    if (!ours(e)) return undefined;
    const n = o.notes.add({}, Date.now());
    freshNotes.add(n.id);
    push();
    return n;
  });
  // 찾기는 본문 전체를 본다 (목록에는 미리보기 80자만 가서 메인에서 찾는다)
  ipcMain.handle(PANEL.noteSearch, (e, query: unknown, composing: unknown) => {
    if (!ours(e) || typeof query !== 'string') return [];
    return searchNotes(o.notes.list(), query.slice(0, 200), composing === true);
  });
  ipcMain.on(PANEL.noteUpdate, (e, id: number, patch) => {
    if (!ours(e) || typeof patch !== 'object' || patch === null) return;
    const { title, body } = patch as { title?: unknown; body?: unknown };
    o.notes.update(
      id,
      {
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof body === 'string' ? { body } : {}),
      },
      Date.now(),
    );
    push();
  });
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
  ipcMain.handle(PANEL.eventAdd, (e, line: string, day?: unknown) => {
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
    // 반복 일정은 아직 없다: 한 번짜리로 넣지 않고 할 일 탭으로 안내한다
    if (parseTodoLine(text, base, minute).repeat) return { ok: false, error: t('panel.event.noRepeat') };
    // 달력에서 고른 날이면 날짜도 시각도 없는 글("장보기")은 그날 종일. "오늘" 을 붙여 읽어
    // 시각처럼 보이는 말("25시 회의")은 종일로 넣지 않고 되묻는 규칙을 그대로 쓴다
    const ev =
      parseEventInput(text, base, minute) ?? (picked ? parseEventInput(`오늘 ${text}`, base, minute) : null);
    if (!ev) return { ok: false, error: t('panel.event.needTime') };
    let event: ReturnType<EventStore['add']>;
    if ('allDay' in ev) {
      const times = allDayTimes(ev.day, ev.lastDay);
      const dup = sameEvent(ev.title, times.startAt, true);
      if (dup) return dup;
      const reminds = remindsOf(remind, true);
      event = o.events.add({ title: ev.title, ...times, allDay: true, ...(reminds ? { reminds } : {}) }, now);
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
          ...(reminds ? { reminds } : {}),
        },
        now,
      );
    }
    push();
    o.onEventsChanged();
    const clash = event.allDay ? undefined : clashOf(event);
    return { ok: true, event, ...(clash ? { clash } : {}) };
  });
  // ---- 할 일 단계 (9판) ----
  // 한 줄이나 여러 줄 (붙여 넣은 목록은 한 번에 넣고 한 번만 알린다. 줄마다 부르면 패널 상태를 줄 수만큼 다시 만들었다)
  ipcMain.handle(PANEL.stepAdd, (e, todoId: unknown, title: unknown) => {
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
  });
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
  /** 마지막 "지난 마감 오늘로" (되돌리기는 메인이 지금 상태와 맞춰 한다) */
  let lastMoved: { moved: { id: number; due: string | null }[]; today: string } | undefined;
  ipcMain.handle(PANEL.moveOverdue, (e) => {
    if (!ours(e)) return [];
    const now = Date.now();
    const today = localDay(now);
    // 오늘 탭 링크가 센 것(습관 빼고)만 옮긴다. 습관의 지난 회차는 습관 칸에서 체크한다
    const moved = o.store.moveOverdue(today, now, { habits: false });
    lastMoved = { moved, today };
    log('todo', 'move-overdue', moved.length);
    push();
    return moved;
  });
  // 되돌리기: 아직 열려 있고 마감이 그대로 오늘인 것만 (그사이 끝냈거나 마감을 바꾼 것은 둔다. 회고 되돌리기와 같다)
  ipcMain.on(PANEL.undoMoveOverdue, (e) => {
    if (!ours(e) || !lastMoved) return;
    const back = undoMoved(lastMoved.moved, o.store.list(Date.now()).open, lastMoved.today);
    lastMoved = undefined;
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
    return [...byId.values()].sort((a, b) => a.startAt - b.startAt || a.id - b.id);
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
    o.startFocus(isFocusLength(minutes) ? minutes : undefined, id);
  });
  ipcMain.on(PANEL.focusStop, (e) => {
    if (ours(e)) o.stopFocus();
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
  ipcMain.handle(PANEL.feed, (e) => {
    if (!ours(e)) return { ok: false };
    const r = o.store.feed(Date.now());
    push();
    if (r.ok) o.onFed();
    return { ok: r.ok };
  });
  ipcMain.on(PANEL.openSettings, (e) => {
    if (!ours(e)) return;
    closePanel();
    o.openSettings();
  });
  ipcMain.on(PANEL.openChat, (e) => {
    if (!ours(e)) return;
    closePanel();
    o.openChat();
  });
  ipcMain.on(PANEL.lookTogether, (e) => {
    if (!ours(e)) return;
    closePanel();
    o.lookTogether();
  });
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
    win.once('ready-to-show', () => {
      stealFocus();
      focusWindow(win);
    });
    // 다른 곳을 누르면 닫힌다 (팝오버처럼). 머리를 잡고 끄는 것은 이 창을 누른 것이라 닫히지 않는다.
    win.on('blur', () => {
      // 저장 창(주간 회고 카드)을 띄운 동안은 닫지 않는다 (hold)
      if (!win.isDestroyed() && holding === 0) win.close();
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
    win.on('move', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) rest = win.getBounds();
      }, MOVE_SAVE_MS);
    });
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
  function openTab(tab: PanelTab) {
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

  function openPanel(tab?: PanelTab) {
    const placed = placePanel(o.petBounds(), PANEL_SIZE, petArea(), allAreas(), offset);
    const win = makeWindow('panel', placed, tab);
    panel = win;
    // 옛 창이 늦게 닫혀도 새 창 참조를 지우지 않게 (빨리 닫았다 열면 빈 패널이 남았다)
    win.on('closed', () => {
      if (panel === win) panel = undefined;
      dropEmptyNotes();
    });
    rememberMoves(win, placed);
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
      const next = panelOffsetAfterMove(b, pet, defaultPanelBounds(pet, PANEL_SIZE, petArea()));
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
    /** 다음 한 번 패널을 열 때 보일 탭 */
    openNextAt: (tab: PanelTab) => {
      nextTab = tab;
    },
    closePanel,
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
