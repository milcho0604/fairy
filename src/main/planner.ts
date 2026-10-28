import { powerMonitor, screen } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import {
  BRIEFING_FROM_MINUTE,
  briefingBody,
  briefingText,
  DUE_AM_FROM,
  DUE_PM_FROM,
  deadlineText,
  dueSlot,
  isInstallDay,
  nextUp,
  reviewText,
  undoMoved,
} from '../shared/briefing.ts';
import { talksToSelf } from '../shared/chatter.ts';
import { plusDays, weekdayOf } from '../shared/day.ts';
import type { EventStore } from '../shared/event-store.ts';
import {
  type FocusState,
  focusDoneAction,
  focusDoneButtons,
  focusedMinutes,
  focusTodoToAsk,
  IDLE,
  isFocusLength,
  skipGap,
  startFocus,
  tickFocus,
} from '../shared/focus.ts';
import { t } from '../shared/i18n/index.ts';
import {
  ActivityWatch,
  IDLE_GAP_MS,
  type IdleFacts,
  type IdleKey,
  IdleTalker,
  idleVars,
  SOMETIMES_GAP_MS,
} from '../shared/idle-talk.ts';
import { voiced } from '../shared/persona-voice.ts';
import { nextMinuteTurn, onTick, PLAN_TICK_MS, wakeDelay, wakeNow, zoneKey } from '../shared/planner-wake.ts';
import { isQuietNow } from '../shared/quiet-hours.ts';
import {
  coversBriefing,
  coversReview,
  dueUntil,
  farewellUntil,
  meetCoins,
  nextMeet,
  nextStreak,
  overnight,
  parseMemo,
  type RoutineDue,
  routineDue,
  routineTurns,
  spanEnd,
  weeklyCoins,
} from '../shared/routine.ts';
import { farewellNext, farewellText, greetText, restText } from '../shared/routine-text.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { weekStart, weekSummary } from '../shared/week.ts';
import type { SayOptions } from './pet-window.ts';
import { createReminders } from './reminders.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const TICK_MS = PLAN_TICK_MS;
const STORE = 'planner';

export interface PlannerOptions {
  todos: TodoStore;
  events: EventStore;
  stats: StatStore;
  say: (o: SayOptions) => Promise<string | undefined>;
  /** 펫이 숨어 있는지 (숨은 동안 말풍선은 펫이 모아 둔다. 브리핑은 나올 때까지 미룬다) */
  petHidden: () => boolean;
  /** 코인을 받았다 (펫 신남) */
  onReward: () => void;
  /** 할 일을 끝냈다 (집중 끝에 "끝냈어"). 패널에서 끝낸 것과 같은 반응 */
  onCompleted?: (coins: number, id: number) => void;
  /** 집중 상태나 일정이 바뀌었다 (패널, 펫 표정 다시 그리기) */
  onChange: () => void;
  /** 패널 오늘 탭 열기 (마감 알림 "볼게") */
  openToday: () => void;
  /** 일정 제목 속 회의 주소를 기본 브라우저로 (http, https 만. 메인이 다시 본다) */
  openUrl: (url: string) => void;
  /** 지금 펫 이름 (혼잣말에 넣는다) */
  petName: () => string;
  /** 혼잣말에 쓰는 펫 상태 (기분, 친밀도, 배고픔, 삐짐, 놀이 중, 다른 쪽이 넣는 상황 대사). 없으면 시각과 할 일, 일정만 본다 */
  talkFacts?: () => {
    mood?: number;
    affection?: number;
    hungry?: boolean;
    sulk?: number;
    busy?: boolean;
    more?: readonly IdleKey[];
    /** 기억 (어제 일, 연속 기록, 이번 주, 집중, 함께한 날. main/companion.ts). 대사를 고를 때만 부른다 */
    memory?: () => Partial<IdleFacts>;
  };
  /** 최근 혼잣말 저장 (다시 켜도 되풀이하지 않게, main/companion.ts) */
  talkRecent?: {
    load: () => readonly string[];
    known: (k: string) => k is IdleKey;
    save: (keys: readonly IdleKey[]) => void;
  };
  log: (tag: string, ...rest: unknown[]) => void;
}

export const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** 현지 날짜와 하루 안의 분으로 ms 시각 */
export function localTime(day: string, minute: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, Math.floor(minute / 60), minute % 60).getTime();
}

/** 현지 날짜의 0시 ms */
export const startOfDay = (ms: number) => localTime(localDay(ms), 0);

/** n 일 뒤 현지 날짜의 0시 ms. 0시 + 24시간은 서머타임이 바뀌는 날(23, 25시간) 다음 날 0시가 아니다 */
export const startOfDayAfter = (ms: number, n: number) => localTime(plusDays(localDay(ms), n), 0);

/**
 * 시간에 따라 펫이 알려 주는 것들 (v1 생산성).
 * - 일정 알림: 시작 몇 분 전(일정마다)에 말풍선. 수다 빈도와 상관없이 늘 (기획서 "일정 시작 알림")
 * - 오늘 브리핑: 그날 처음 컴퓨터 앞에 있을 때(5시 이후) 한 번. 수다 빈도 보통 이상
 * - 집중 타이머: 15, 25, 50분 집중(펫은 잠) → 분에 비례한 코인 → 5분(50분은 10분) 쉬기
 */
export function createPlanner(o: PlannerOptions) {
  let focus: FocusState = IDLE;
  let stoppedFocus: { before: FocusState; at: number; minutes: number } | undefined;
  const saved = readJson(STORE) as
    | { briefedDay?: string; reviewedDay?: string; dueSaid?: unknown; routine?: unknown; snoozed?: unknown }
    | undefined;
  let briefedDay = typeof saved?.briefedDay === 'string' ? saved.briefedDay : '';
  let reviewedDay = typeof saved?.reviewedDay === 'string' ? saved.reviewedDay : '';
  /** 오늘 마감 알림을 한 칸 ("2026-10-07:pm") */
  let dueSaid: string[] = Array.isArray(saved?.dueSaid)
    ? saved.dueSaid.filter((v): v is string => typeof v === 'string').slice(-4)
    : [];
  /** 만나는 시간의 하루 한 번 기록 (맞이, 헤어짐, 쉬는 날, 연속 기록) */
  let memo = parseMemo(saved?.routine);
  const store = () =>
    writeJson(STORE, { briefedDay, reviewedDay, dueSaid, routine: memo, snoozed: reminders.snoozed });

  /** 일정과 할 일의 미리 알림 (8판, reminders.ts). 미루기도 그쪽이 들고 있고, 저장은 이 파일에 같이 */
  const reminders = createReminders({
    events: o.events,
    todos: o.todos,
    say: o.say,
    openUrl: o.openUrl,
    openToday: o.openToday,
    saved: saved?.snoozed,
    onSnoozedChange: () => {
      store();
      soon();
    },
    log: o.log,
  });
  const remind = (now: number) => reminders.tick(now);

  /**
   * 오늘 마감 알림: 보통은 오후 한 번, 수다쟁이는 오전과 오후. 자리에 있고 펫이 보일 때만.
   * 아직 할 일이 남아 기다리는 중(자리 비움, 숨음, 묻는 중)이면 true (플래너가 15초마다 다시 본다)
   */
  let dueAsking = false;
  function dueAlert(now: number): boolean {
    const day = localDay(now);
    const s = settings.get();
    // 만나는 날은 헤어지는 시간까지 (헤어지는 인사가 남은 마감을 묻는다)
    const slot = dueSlot(minuteOfDay(now), s.chatter, dueUntil(s.routine, day, s.reviewMinute));
    if (!slot || dueSaid.includes(`${day}:${slot}`)) return false;
    if (focus.phase === 'focus' || o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return true;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return true;
    // 남은 게 없으면 칸을 쓰지 않는다 (나중에 오늘 마감을 넣으면 그 칸에 알리게. 할 일이 바뀌면 플래너가 다시 본다)
    // 오늘 미리 알림으로 이미 말한 할 일은 빼고 (하루 한 번)
    const said = o.todos.remindedSince(startOfDay(now));
    const left = o.todos
      .list(now)
      .open.filter((todo) => todo.due !== null && todo.due === day && !said.has(todo.id));
    if (left.length === 0) return false;
    if (dueAsking) return true;
    // 말풍선이 실제로 떴을 때만 그 칸을 한 것으로 적는다 (시간당 상한에 막히면 다음 틱에 다시)
    dueAsking = true;
    o.log('planner', '마감 알림', slot, left.length);
    void o
      .say({
        kind: 'system',
        text: deadlineText(left.map((todo) => todo.title)),
        buttons: [
          { id: 'open', label: t('briefing.due.open') },
          { id: 'later', label: t('pet.life.later') },
        ],
        ttlMs: 20_000,
      })
      .then((a) => {
        dueAsking = false;
        if (a === undefined) return;
        dueSaid = [...dueSaid.filter((k) => k.startsWith(day)), `${day}:${slot}`];
        store();
        if (a === 'open') o.openToday();
      });
    return true;
  }

  /** 오늘 브리핑에 넣을 것. 오늘 0시부터 본다: 종일 일정은 0시에 시작해 이미 지났지만 오늘 일정이다. 시각 일정은 남은 것만 */
  function todayFacts(now: number) {
    const day = localDay(now);
    const to = startOfDayAfter(now, 1);
    const events = o.events
      .between(startOfDay(now), to)
      .filter((e) => e.allDay || e.startAt >= now)
      .map((e) => ({ minute: minuteOfDay(e.startAt), title: e.title, allDay: e.allDay }));
    const { open } = o.todos.list(now);
    const dueToday = open.filter((t) => t.due === day).length;
    const overdue = open.filter((t) => t.due !== null && t.due < day).length;
    // 먼저 할 일 (곧 시작하는 일정은 미리 알림이 말하니 할 일만 본다)
    const next = nextUp({ todos: open, events: [], now });
    return { events, dueToday, overdue, ...(next ? { next: next.title } : {}) };
  }

  let briefing = false;
  /** 오늘 브리핑. 할 때가 됐는데 자리 비움이나 숨음으로 기다리면 true */
  function brief(now: number): boolean {
    const day = localDay(now);
    if (briefedDay === day || minuteOfDay(now) < BRIEFING_FROM_MINUTE) return false;
    // 만나는 시간을 정해 두었으면 맞이 인사(쉬는 날은 한마디)가 브리핑을 맡는다
    if (coversBriefing(settings.get().routine, memo, day, minuteOfDay(now))) return false;
    // 자리에 있을 때만 (1분 안에 입력이 있었고 화면이 잠기지 않음), 펫이 보일 때만.
    if (o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return true;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return true;
    briefedDay = day;
    store();
    const facts = todayFacts(now);
    o.log('planner', '브리핑');
    // 브리핑이 떠 있는 동안은 회고, 마감 알림, 혼잣말이 덮지 않게 기다린다
    briefing = true;
    void o
      .say({
        kind: 'system',
        text: briefingText({ ...facts, nowMinute: minuteOfDay(now) }),
        // 지난 마감이 있으면 오늘로 옮길 수 있게 (하루를 정리하고 시작)
        ...(facts.overdue > 0 ? { buttons: [{ id: 'overdue', label: t('assist.overdue.brief') }] } : {}),
        ttlMs: facts.overdue > 0 ? 20_000 : 15_000,
      })
      .then((a) => {
        briefing = false;
        if (a === 'overdue') moveOverdue();
      });
    return false;
  }

  /** 지난 마감을 오늘로 (아침 브리핑 단추). 잠깐 되돌리기 단추를 보인다 */
  function moveOverdue() {
    const at = Date.now();
    const today = localDay(at);
    const moved = o.todos.moveOverdue(today, at);
    if (moved.length === 0) return;
    o.onChange();
    o.log('planner', '지난 마감 오늘로', moved.length);
    void o
      .say({
        kind: 'answer',
        text: voiced('assist.overdue.moved', { n: moved.length }),
        buttons: [{ id: 'undo', label: t('panel.review.undo') }],
        ttlMs: 10_000,
      })
      .then((a) => {
        if (a !== 'undo') return;
        const back = undoMoved(moved, o.todos.list(Date.now()).open, today);
        const at2 = Date.now();
        for (const b of back) o.todos.update(b.id, { due: b.due }, at2);
        o.onChange();
      });
  }

  /** 금요일 회고에 붙일 이번 주 한 줄 (끝낸 게 없으면 빈 글) */
  function fridayLine(day: string, now: number): string {
    if (weekdayOf(day) !== 5) return '';
    const week = weekSummary(day, (days) => o.stats.diaryFacts(days), o.todos.list(now).open);
    return week.done > 0 ? ` ${voiced('assist.week.friday', { n: week.done })}` : '';
  }

  /**
   * 하루 회고 (v2): 회고 시각 뒤 처음 자리에 있을 때 한 번. 오늘 마감 남은 것은 내일로 넘길지 묻는다.
   * 수다 빈도와 따로 켜고 끈다(설정 review). 켜 두었으면 조용히에서도 온다 (그래서 'schedule' 종류: 조용히에서도 말하고 시간당 상한에 안 센다).
   * 숨어 있으면 모아 두었다가 나올 때, 못 보고 지나가면 놓친 알림에 남긴다 (hold). 그날이 지나면 꺼내지 않는다
   */
  function review(now: number): boolean {
    const day = localDay(now);
    const s = settings.get();
    if (!s.review || reviewedDay === day || minuteOfDay(now) < s.reviewMinute) return false;
    // 만나는 날 만났으면 헤어지는 인사가 회고를 같이 한다
    if (coversReview(s.routine, memo, day)) return false;
    // 설치 첫날은 회고하지 않는다 (끝낸 할 일 0개를 말풍선이나 놓친 알림으로 남기지 않게)
    if (isInstallDay(o.stats.firstDay(), day, o.todos.list(now).doneToday.length)) {
      reviewedDay = day;
      store();
      return false;
    }
    if (powerMonitor.getSystemIdleTime() > 60) return true;
    reviewedDay = day;
    store();
    const { open, doneToday } = o.todos.list(now);
    const left = open.filter((t) => t.due !== null && t.due <= day);
    o.log('planner', '회고');
    const act = (a: string | undefined) => {
      if (a === 'move') moveToTomorrow(day);
    };
    void o
      .say({
        kind: 'schedule',
        text:
          reviewText({ doneTitles: doneToday.map((t) => t.title), leftToday: left.length }) +
          (left.length === 0 ? fridayLine(day, now) : ''),
        buttons:
          left.length > 0
            ? [
                { id: 'move', label: t('panel.review.move') },
                { id: 'keep', label: t('panel.review.keep') },
              ]
            : [],
        ttlMs: 30_000,
        hold: {
          staleAt: startOfDayAfter(now, 1) - 1,
          missedLines: [t('briefing.review.missed', { done: doneToday.length, left: left.length })],
          missedMsgs: [
            { key: 'briefing.review.missed', vars: { done: doneToday.length, left: left.length } },
          ],
          onAction: act,
        },
      })
      .then(act);
    return false;
  }

  // ---- 만나는 시간 (shared/routine.ts): 맞이, 시작 한마디, 헤어지는 인사, 쉬는 날 한마디. 하루 한 번씩 ----
  // 자리에 있을 때만 (1분 안에 입력, 화면 안 잠김). 맞이와 헤어짐은 'schedule' 이라 조용히에서도 오지만 한 줄로 줄이고,
  // 숨어 있으면 모아 두었다가 나올 때, 집에서 쉬는 중이면 나와서 말한다(일정 알림과 같다). 집중 중(펫이 잠)에는 끝날 때까지 기다린다
  /** 만나는 시간. 할 때가 됐는데 기다리면(자리 비움, 브리핑 중, 집중 중, 숨음) true */
  function meet(now: number): boolean {
    const s = settings.get();
    const due = routineDue(s.routine, memo, localDay(now), minuteOfDay(now));
    if (!due) return false;
    if (briefing) return true;
    if (powerMonitor.getSystemIdleTime() > 60 || powerMonitor.getSystemIdleState(60) === 'locked')
      return true;
    const quiet = s.chatter === 'quiet';
    if (due.what === 'greet') {
      // 처음 자리에 있던 때를 적어 둔다 (집중으로 미뤄도 "일찍 왔네"가 맞게)
      if (memo.arrival?.day !== due.day) {
        memo = { ...memo, arrival: { day: due.day, clock: due.clock } };
        store();
      }
      if (focus.phase === 'focus') return true;
      greet(now, due, quiet);
    } else if (due.what === 'farewell') {
      if (focus.phase === 'focus') return true;
      farewell(now, due, quiet);
    } else if (due.what === 'cue') {
      memo = { ...memo, cued: due.day };
      store();
      if (s.chatter !== 'chatty' || focus.phase === 'focus' || o.petHidden()) return false;
      o.log('planner', '시작 한마디');
      void o.say({ kind: 'idle-talk', text: voiced('routine.cue'), ttlMs: 8000 });
    } else {
      // 쉬는 날: 예전 브리핑처럼 펫이 보일 때 한 번. 일정만 붙이고 마감은 말하지 않는다 ('system': 조용히면 없다)
      if (o.petHidden()) return true;
      const day = localDay(now);
      memo = { ...memo, restSaid: due.day };
      briefedDay = day;
      store();
      o.log('planner', '쉬는 날');
      briefing = true;
      const { events } = todayFacts(now);
      const rest = restText(day, briefingBody({ events, dueToday: 0, overdue: 0 }, ''));
      // 쉬는 날 말을 모두 안 쓰기로 했고 일정도 없으면 말하지 않는다
      if (!rest) {
        briefing = false;
        return false;
      }
      void o
        .say({
          kind: 'system',
          text: rest,
          ttlMs: 10_000,
        })
        .then(() => {
          briefing = false;
        });
    }
    return false;
  }

  /** 맞이: 연속 기록과 만난 날 코인(하루 한 번), 오늘 브리핑을 같이 */
  function greet(now: number, due: Extract<RoutineDue, { what: 'greet' }>, quiet: boolean) {
    const routine = settings.get().routine;
    const day = localDay(now);
    const first = !memo.streak;
    const streak = nextStreak(routine, memo.streak, due.day);
    const coins = meetCoins(streak, o.todos.coinCount('meet', day));
    // 매주 선물: 그 주(월요일 시작) 첫 출석 때 한 번. 장부로 판정해 껐다 켜기, 시계 되돌리기에도 한 주 한 번
    const weekly = weeklyCoins(coins, o.todos.coinCountFrom('weekly', weekStart(day)));
    // 오늘 예전 브리핑을 이미 했으면(오늘 처음 켠 설정) 인사만
    const withBriefing = !quiet && briefedDay !== day;
    memo = { ...memo, greeted: due.day, streak: { day: streak.day, n: streak.n } };
    briefedDay = day;
    store();
    if (coins > 0) {
      o.todos.reward(coins, 'meet', now);
      o.todos.reward(weekly, 'weekly', now);
      o.onReward();
      o.onChange();
    }
    o.log('planner', '맞이', due.arrival, streak.n, coins, weekly);
    const greeting = greetText({
      day: due.day,
      arrival: due.arrival,
      first,
      streak: streak.n,
      coins,
      weekly,
      briefing: withBriefing ? briefingBody(todayFacts(now)) : '',
      quiet,
    });
    // 맞이하는 말을 모두 안 쓰기로 했고 덧붙일 말도 없으면 말하지 않는다
    if (!greeting) return;
    briefing = true;
    void o
      .say({
        kind: 'schedule',
        text: greeting,
        ttlMs: withBriefing ? 15_000 : 9000,
        // 헤어질 때가 지나도록 못 보면 버린다 (놓친 알림에는 남기지 않는다: 인사는 지나면 쓸모가 없다)
        hold: { staleAt: localTime(due.day, spanEnd(due.meet)), missedLines: [] },
      })
      .then(() => {
        briefing = false;
      });
  }

  /**
   * 헤어지는 인사 (두 문장까지): 수고했어(끝낸 일과 같이), 다음 만남 미리 보기. 회고가 켜져 있고 남은 마감이 있으면
   * 미리 보기 대신 내일로 넘길지 묻고, 미리 보기는 답(넘기기, 그대로)을 누른 뒤 말한다
   */
  function farewell(now: number, due: Extract<RoutineDue, { what: 'farewell' }>, quiet: boolean) {
    const s = settings.get();
    const asks =
      s.review &&
      reviewedDay !== due.day &&
      !isInstallDay(o.stats.firstDay(), due.day, o.todos.list(now).doneToday.length);
    memo = { ...memo, farewelled: due.day };
    if (asks) reviewedDay = due.day;
    store();
    const { open, doneToday } = o.todos.list(now);
    const left = asks ? open.filter((t) => t.due !== null && t.due <= due.day) : [];
    // 밤 근무는 아침에 헤어져 "내일"이 맞지 않아 미리 보기 없이 "푹 쉬어"
    const next = overnight(due.meet) ? undefined : nextMeet(s.routine, due.day);
    const from = localTime(plusDays(due.day, 1), 0);
    const tomorrow =
      next?.inDays === 1
        ? o.events
            .between(from, localTime(plusDays(due.day, 2), 0))
            .map((e) => ({ minute: minuteOfDay(e.startAt), title: e.title, allDay: e.allDay }))
        : [];
    // 묻느라 못 한 미리 보기 (조용히면 없다)
    const after = left.length > 0 && !quiet ? farewellNext({ ...(next ? { next } : {}), tomorrow }) : '';
    const act = (a: string | undefined) => {
      if (a === 'move') moveToTomorrow(due.day, after);
      else if (a === 'keep' && after) void o.say({ kind: 'answer', text: after, ttlMs: 8000 });
    };
    o.log('planner', '헤어짐', doneToday.length, left.length);
    const farewellMsg = farewellText({
      day: due.day,
      doneTitles: doneToday.map((todo) => todo.title),
      ...(next ? { next } : {}),
      tomorrow,
      leftToday: left.length,
      quiet,
    });
    // 헤어지는 말을 모두 안 쓰기로 했으면 말하지 않는다
    if (!farewellMsg) return;
    void o
      .say({
        kind: 'schedule',
        text: farewellMsg,
        buttons:
          left.length > 0
            ? [
                { id: 'move', label: t('panel.review.move') },
                { id: 'keep', label: t('panel.review.keep') },
              ]
            : [],
        ttlMs: left.length > 0 ? 30_000 : 15_000,
        hold: {
          staleAt: localTime(due.day, farewellUntil(due.meet)),
          missedLines: asks
            ? [t('briefing.review.missed', { done: doneToday.length, left: left.length })]
            : [],
          missedMsgs: asks
            ? [{ key: 'briefing.review.missed', vars: { done: doneToday.length, left: left.length } }]
            : [],
          onAction: act,
        },
      })
      .then(act);
  }

  /** 회고 "내일로 넘기기". 누른 때 남은 것을 다시 읽어 넘기고, 잠깐 되돌리기 단추를 보인다. tail 은 뒤에 붙일 한 문장 (헤어짐 미리 보기) */
  function moveToTomorrow(day: string, tail = '') {
    const tomorrow = plusDays(day, 1);
    const left = o.todos.list(Date.now()).open.filter((t) => t.due !== null && t.due <= day);
    if (left.length === 0) {
      // 그새 다 끝냈다: 넘길 것은 없고 미리 보기만
      if (tail) void o.say({ kind: 'answer', text: tail, ttlMs: 8000 });
      return;
    }
    const moved = left.map((t) => ({ id: t.id, due: t.due }));
    // now 를 넘겨야 마감을 옮긴 뒤 이미 지난 알림(전날 저녁 8시 등)을 말없이 넘긴다 (안 넘기면 바로 다시 알렸다)
    const at = Date.now();
    for (const t of left) o.todos.update(t.id, { due: tomorrow }, at);
    o.onChange();
    o.log('planner', '회고 내일로', moved.length);
    void o
      .say({
        kind: 'answer',
        text: tail
          ? `${voiced('panel.review.moved', { n: moved.length })} ${tail}`
          : voiced('panel.review.moved', { n: moved.length }),
        buttons: [{ id: 'undo', label: t('panel.review.undo') }],
        ttlMs: tail ? 12_000 : 10_000,
      })
      .then((a) => {
        if (a !== 'undo') return;
        const back = undoMoved(moved, o.todos.list(Date.now()).open, tomorrow);
        const at2 = Date.now();
        for (const b of back) o.todos.update(b.id, { due: b.due }, at2);
        o.onChange();
        o.log('planner', '회고 내일로 되돌림', back.length);
      });
  }

  /**
   * 혼잣말과 칭찬 (수다쟁이만, 4~6분마다. shared/idle-talk.ts).
   * 브리핑, 집중, 숨김(사용자, 발표, 집에서 쉬기), 화면 잠금, 잠(1분 넘게 입력 없음), 놀이, 삐진 날에는 하지 않고,
   * 타이핑이나 마우스질 중이면 손이 2초 넘게 쉴 때까지 기다린다. 시간당 상한과 다른 말풍선 뒤 2분은 ChatterGate 가 본다
   */
  const talker = new IdleTalker(Date.now());
  if (o.talkRecent) talker.talk.restore(o.talkRecent.load(), o.talkRecent.known);
  let activity = new ActivityWatch();
  let talking = false;
  /** 일정을 쓰는 사람인지 (보름 앞뒤에 일정이 하나라도). 반 시간마다만 다시 센다 */
  let eventsUsedAt = Number.NEGATIVE_INFINITY;
  let eventsUsedNow = false;
  function eventsUsed(now: number): boolean {
    if (now - eventsUsedAt >= 30 * 60_000) {
      const span = 14 * 24 * 3_600_000;
      eventsUsedNow = o.events.between(now - span, now + span).length > 0;
      eventsUsedAt = now;
    }
    return eventsUsedNow;
  }
  function talk(now: number) {
    const idleSec = powerMonitor.getSystemIdleTime();
    activity.observe(now, idleSec, screen.getCursorScreenPoint());
    if (talking) return;
    const pet = o.talkFacts?.() ?? {};
    talker.setGap(settings.get().chatter === 'sometimes' ? SOMETIMES_GAP_MS : IDLE_GAP_MS);
    const r = talker.due(
      now,
      {
        chatty: talksToSelf(settings.get().chatter),
        quiet: isQuietNow(settings.get().quietHours, now),
        briefing,
        focusing: focus.phase === 'focus',
        hidden: o.petHidden(),
        locked: powerMonitor.getSystemIdleState(60) === 'locked',
        idleSec,
        busy: pet.busy,
        sulk: pet.sulk,
      },
      () => {
        const day = localDay(now);
        const { open, doneToday } = o.todos.list(now);
        const timed = o.events
          .between(now, startOfDayAfter(now, 1))
          .filter((e) => !e.allDay && e.startAt > now);
        const next = timed.reduce<number | undefined>(
          (m, e) => (m === undefined ? e.startAt : Math.min(m, e.startAt)),
          undefined,
        );
        const firstOpen = open.find((t) => t.due !== null && t.due <= day);
        const lastDone = doneToday.reduce((m, t) => Math.max(m, t.doneAt ?? 0), 0);
        return {
          now,
          doneToday: doneToday.length,
          ...(lastDone > 0 ? { lastDoneAt: lastDone } : {}),
          openToday: open.filter((t) => t.due !== null && t.due <= day).length,
          overdue: open.filter((t) => t.due !== null && t.due < day).length,
          ...(firstOpen ? { todoTitle: firstOpen.title } : {}),
          eventsUsed: eventsUsed(now),
          ...(next !== undefined ? { nextEventMin: (next - now) / 60_000 } : {}),
          eventsLeftToday: timed.length,
          workedMin: activity.workedMin(now),
          ...(activity.backAt !== undefined ? { backAt: activity.backAt } : {}),
          mouseBusy: activity.mouseBusy(),
          ...(pet.mood !== undefined ? { mood: pet.mood } : {}),
          ...(pet.affection !== undefined ? { affection: pet.affection } : {}),
          ...(pet.hungry !== undefined ? { hungry: pet.hungry } : {}),
          ...(pet.more ? { more: pet.more } : {}),
          ...(pet.memory?.() ?? {}),
        };
      },
    );
    if (!('key' in r)) return;
    o.log('planner', '혼잣말', r.key);
    talking = true;
    void o
      .say({
        kind: 'idle-talk',
        text: voiced(r.key, { name: o.petName(), ...idleVars(r.facts) }),
        ttlMs: 8000,
      })
      .then((a) => {
        talking = false;
        talker.shown(Date.now(), a !== undefined);
        if (a !== undefined) o.talkRecent?.save(talker.talk.recent);
      });
  }

  let lastTick = 0;
  /** 이번 틱에서 기다리는 것이 있었는지 (있으면 다음 틱도 15초 뒤) */
  let waiting = false;
  let ticking = false;
  function tick() {
    const now = Date.now();
    origin ||= now;
    ticking = true;
    try {
      tickAt(now);
    } finally {
      ticking = false;
      schedule();
    }
  }
  function tickAt(now: number) {
    // 잠자기나 시계 바꾸기로 시간이 튀면 그 사이는 집중으로 치지 않는다 (집중 중에는 15초마다 깬다)
    focus = skipGap(focus, lastTick, now, TICK_MS);
    lastTick = now;
    remind(now);
    waiting = meet(now);
    waiting = brief(now) || waiting;
    if (!briefing) {
      waiting = review(now) || waiting;
      waiting = dueAlert(now) || waiting;
      talk(now);
    } else waiting = true;
    const r = tickFocus(focus, now);
    if (r.event === 'focus-done') {
      const minutes = focusedMinutes(focus, now);
      o.stats.addFocus(now, minutes);
      const coins = o.todos.rewardFocus(now, minutes);
      if (coins > 0) o.onReward();
      const done = voiced('panel.focus.done', {
        minutes,
        coins,
        breakMin: Math.round((r.state.endsAt - r.state.startedAt) / 60_000),
      });
      // 할 일을 걸고 시작했으면 끝냈는지 묻는다 ("끝냈어"면 패널에서 끝낸 것처럼 코인과 반응)
      const todoId = focusTodoToAsk(focus, o.todos.list(now).open);
      const todo = todoId === undefined ? undefined : o.todos.get(todoId);
      lastTodoId = todo?.id;
      const label = {
        finished: t('panel.focus.todoDone'),
        more: t('panel.focus.todoMore'),
        stop: t('panel.focus.stop'),
      };
      void o
        .say({
          kind: 'answer',
          text: todo ? `${done} ${voiced('panel.focus.todoAsk', { title: todo.title })}` : done,
          buttons: focusDoneButtons(!!todo).map((id) => ({ id, label: label[id] })),
          ttlMs: todo ? 30_000 : 20_000,
        })
        .then((a) => {
          const act = focusDoneAction(a, !!todo);
          if (act === 'stop') stopFocus();
          else if (act === 'finish' && todo) finishTodo(todo.id);
          // 조금 더: 쉬지 않고 같은 할 일로 집중을 다시 시작한다
          else if (act === 'again' && todo) startFocusNow(undefined, todo.id);
        });
    } else if (r.event === 'break-done') {
      void o
        .say({
          kind: 'answer',
          text: voiced('panel.focus.breakDone'),
          buttons: [
            { id: 'again', label: t('panel.focus.again') },
            { id: 'no', label: t('panel.focus.enough') },
          ],
          ttlMs: 30_000,
        })
        .then((a) => {
          // 할 일을 걸고 했으면 한 번 더도 그 할 일로 (아직 열려 있으면)
          if (a === 'again') startFocusNow(undefined, lastTodoId);
        });
    }
    if (r.state !== focus) {
      focus = r.state;
      o.onChange();
    }
  }

  /** 마지막 집중에 건 할 일 ("한 번 더"도 그 할 일로) */
  let lastTodoId: number | undefined;

  /**
   * 집중 시작. 길이를 주면 그 길이로 하고 다음에도 그 길이 (설정 focusMin).
   * todoId 를 주면 그 할 일을 하는 집중 (끝나면 끝냈는지 묻는다). 이미 끝냈거나 없는 할 일이면 그냥 집중
   */
  function startFocusNow(minutes?: number, todoId?: number) {
    stoppedFocus = undefined;
    if (isFocusLength(minutes) && minutes !== settings.get().focusMin) settings.set({ focusMin: minutes });
    const length = settings.get().focusMin;
    const todo = todoId === undefined ? undefined : o.todos.get(todoId);
    focus = startFocus(Date.now(), length, todo && todo.doneAt === null ? todo.id : undefined);
    lastTodoId = focus.todoId;
    o.log('planner', '집중 시작', length, focus.todoId ? '할 일' : '');
    o.onChange();
    // 집중 중에는 15초마다 깬다. 마지막 틱이 오래전이어도 그 사이를 잠으로 치지 않게 지금부터 센다 (skipGap)
    lastTick = Date.now();
    schedule();
  }

  /** 집중 끝 "끝냈어": 패널에서 끝낸 것과 같다 (코인, 반복이면 다음 것) */
  function finishTodo(id: number) {
    const todo = o.todos.get(id);
    if (!todo || todo.doneAt !== null) return;
    const coins = o.todos.complete(id, Date.now());
    lastTodoId = undefined;
    o.log('planner', '집중 끝 할 일 끝냄', id, coins);
    o.onCompleted?.(coins, id);
    o.onChange();
  }

  function stopFocus(): { minutes: number } | undefined {
    const now = Date.now();
    const before = focus;
    const minutes = focusedMinutes(focus, now);
    if (minutes > 0) o.stats.addFocus(now, minutes);
    stoppedFocus = minutes > 0 && focus.phase === 'focus' ? { before: focus, at: now, minutes } : undefined;
    if (stoppedFocus)
      setTimeout(() => {
        if (stoppedFocus?.at === now) {
          stoppedFocus = undefined;
          o.onChange();
        }
      }, 8000);
    focus = IDLE;
    o.log('planner', '집중 그만', minutes);
    o.onChange();
    schedule();
    return before.phase === 'idle' ? undefined : { minutes: before.phase === 'focus' ? minutes : 0 };
  }

  function undoStopFocus(): boolean {
    const stopped = stoppedFocus;
    if (!stopped || Date.now() - stopped.at > 8000) return false;
    stoppedFocus = undefined;
    o.stats.undoFocus(stopped.at, stopped.minutes);
    const paused = Math.max(0, Date.now() - stopped.at);
    focus = {
      ...stopped.before,
      startedAt: stopped.before.startedAt + paused,
      endsAt: stopped.before.endsAt + paused,
    };
    o.log('planner', '집중 중단 되돌림', stopped.minutes);
    o.onChange();
    lastTick = Date.now();
    schedule();
    return true;
  }

  // ---- 다음에 깰 때 (shared/planner-wake.ts) ----
  // 예전에는 15초마다 깨어 모든 것을 물었다. 이제 다음 알림이나 하루 일의 다음 문턱까지 잔다 (길어도 1분, 깰 때마다 시계를 본다).
  // 기다리는 것이 있거나, 집중 중이거나, 수다쟁이(혼잣말이 입력과 커서를 15초마다 본다)면 예전처럼 15초마다.
  // 저장 파일, 설정, 미루기가 바뀌거나(soon) 잠에서 깨면 바로 다시 본다
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 첫 틱 때. 다음 때는 여기서 15초씩 떨어진 예전 틱 자리로 올린다 (onTick) */
  let origin = 0;
  /** 다음 틱을 할 벽시계 때 */
  let dueAt = 0;
  /** 잠들 때의 벽시계와 단조 시계 (깨서 시계가 튀었는지 본다) */
  let armed = { wall: 0, mono: 0, zone: '' };
  let stopped = false;
  function nextAt(now: number): number | undefined {
    const s = settings.get();
    const day = localDay(now);
    const turn = nextMinuteTurn(now, [
      BRIEFING_FROM_MINUTE,
      s.reviewMinute,
      DUE_AM_FROM,
      DUE_PM_FROM.normal,
      DUE_PM_FROM.chatty,
      dueUntil(s.routine, day, s.reviewMinute),
      ...routineTurns(s.routine, day),
    ]);
    const remindAt = reminders.nextAt(now);
    return remindAt === undefined ? turn : Math.min(turn, remindAt);
  }
  function schedule() {
    if (stopped) return;
    const now = Date.now();
    const poll = waiting || focus.phase !== 'idle' || talksToSelf(settings.get().chatter);
    const at = poll ? undefined : nextAt(now);
    dueAt = at === undefined ? (poll ? now + TICK_MS : Number.POSITIVE_INFINITY) : onTick(at, origin || now);
    armed = { wall: now, mono: performance.now(), zone: zoneKey(now) };
    arm(wakeDelay(now, poll, at === undefined ? undefined : dueAt));
  }
  function arm(ms: number) {
    clearTimeout(timer);
    timer = setTimeout(wake, ms);
    timer.unref();
  }
  function wake() {
    const now = Date.now();
    // 잠자기, 시계 바꾸기, 시간대 바꾸기면 바로 틱
    if (wakeNow({ now, mono: performance.now(), zone: zoneKey(now), dueAt, armed })) tick();
    // 아직이면 같은 때를 향해 다시 잔다 (할 일, 일정, 설정이 바뀌면 soon 이 다시 잡는다)
    else arm(wakeDelay(now, false, dueAt));
  }
  /** 할 일, 일정, 설정, 미루기가 바뀌었다: 조금 뒤 한 번 본다 (연달아 바뀌면 한 번만). 틱 안에서 바꾼 것은 그 틱이 끝나고 다시 잡는다 */
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  function soon() {
    if (ticking || stopped || soonTimer) return;
    soonTimer = setTimeout(() => {
      soonTimer = undefined;
      tick();
    }, 300);
    soonTimer.unref();
  }
  const stopSettings = settings.onChange((next, prev) => {
    // 수다쟁이로 바꾸면 입력과 커서를 다시 15초마다 본다. 드문드문 본 기록은 버린다 (자리를 비웠다 온 것으로 잘못 보지 않게)
    if (talksToSelf(next.chatter) && !talksToSelf(prev.chatter)) activity = new ActivityWatch();
    soon();
  });
  const onResume = () => soon();
  powerMonitor.on('resume', onResume);
  // 켜자마자 한 번 (켜 둔 사이 지난 알림, 아침 브리핑). 펫이 자리를 잡을 시간을 준다.
  timer = setTimeout(tick, 4000);
  timer.unref();

  return {
    get focus() {
      return focus;
    },
    startFocus: startFocusNow,
    stopFocus,
    undoStopFocus,
    focusUndoAvailable: () => !!stoppedFocus && Date.now() - stoppedFocus.at <= 8000,
    /** 일정이 바뀌었을 때 바로 한 번 본다 (곧 시작하는 일정을 넣은 경우) */
    check: tick,
    /** 저장 파일(할 일, 일정, 알림)이 바뀌었다: 조금 뒤 한 번 본다 */
    soon,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(soonTimer);
      stopSettings();
      powerMonitor.off('resume', onResume);
    },
    /** 미리 알림 (방금 울린 알림 미루기, main/day-tools.ts) */
    reminders,
  };
}
