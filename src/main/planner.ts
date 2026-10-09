import { powerMonitor, screen } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import {
  BRIEFING_FROM_MINUTE,
  briefingBody,
  briefingText,
  deadlineText,
  dueSlot,
  reviewText,
  undoMoved,
} from '../shared/briefing.ts';
import type { EventStore } from '../shared/event-store.ts';
import {
  type FocusState,
  focusedMinutes,
  IDLE,
  isFocusLength,
  skipGap,
  startFocus,
  tickFocus,
} from '../shared/focus.ts';
import { t } from '../shared/i18n/index.ts';
import { ActivityWatch, type IdleKey, IdleTalker, idleVars } from '../shared/idle-talk.ts';
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
  spanEnd,
} from '../shared/routine.ts';
import { farewellText, greetText, restText } from '../shared/routine-text.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { createReminders } from './reminders.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const TICK_MS = 15_000;
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

/**
 * 시간에 따라 펫이 알려 주는 것들 (v1 생산성).
 * - 일정 알림: 시작 몇 분 전(일정마다)에 말풍선. 수다 빈도와 상관없이 늘 (기획서 "일정 시작 알림")
 * - 오늘 브리핑: 그날 처음 컴퓨터 앞에 있을 때(5시 이후) 한 번. 수다 빈도 보통 이상
 * - 집중 타이머: 15, 25, 50분 집중(펫은 잠) → 분에 비례한 코인 → 5분(50분은 10분) 쉬기
 */
export function createPlanner(o: PlannerOptions) {
  let focus: FocusState = IDLE;
  const saved = readJson(STORE) as
    | { briefedDay?: string; reviewedDay?: string; dueSaid?: unknown; routine?: unknown }
    | undefined;
  let briefedDay = typeof saved?.briefedDay === 'string' ? saved.briefedDay : '';
  let reviewedDay = typeof saved?.reviewedDay === 'string' ? saved.reviewedDay : '';
  /** 오늘 마감 알림을 한 칸 ("2026-10-07:pm") */
  let dueSaid: string[] = Array.isArray(saved?.dueSaid)
    ? saved.dueSaid.filter((v): v is string => typeof v === 'string').slice(-4)
    : [];
  /** 만나는 시간의 하루 한 번 기록 (맞이, 헤어짐, 쉬는 날, 연속 기록) */
  let memo = parseMemo(saved?.routine);
  const store = () => writeJson(STORE, { briefedDay, reviewedDay, dueSaid, routine: memo });

  /** 일정과 할 일의 미리 알림 (8판, reminders.ts). 미루기도 그쪽이 들고 있다 */
  const reminders = createReminders({
    events: o.events,
    todos: o.todos,
    say: o.say,
    openUrl: o.openUrl,
    openToday: o.openToday,
    log: o.log,
  });
  const remind = (now: number) => reminders.tick(now);

  /** 오늘 마감 알림: 보통은 오후 한 번, 수다쟁이는 오전과 오후. 자리에 있고 펫이 보일 때만 */
  let dueAsking = false;
  function dueAlert(now: number) {
    const day = localDay(now);
    const s = settings.get();
    // 만나는 날은 헤어지는 시간까지 (헤어지는 인사가 남은 마감을 묻는다)
    const slot = dueSlot(minuteOfDay(now), s.chatter, dueUntil(s.routine, day, s.reviewMinute));
    if (!slot || dueSaid.includes(`${day}:${slot}`)) return;
    if (focus.phase === 'focus' || o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    // 남은 게 없으면 칸을 쓰지 않는다 (나중에 오늘 마감을 넣으면 그 칸에 알리게)
    // 오늘 미리 알림으로 이미 말한 할 일은 빼고 (하루 한 번)
    const said = o.todos.remindedSince(startOfDay(now));
    const left = o.todos
      .list(now)
      .open.filter((todo) => todo.due !== null && todo.due === day && !said.has(todo.id));
    if (left.length === 0 || dueAsking) return;
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
  }

  /** 오늘 브리핑에 넣을 것. 오늘 0시부터 본다: 종일 일정은 0시에 시작해 이미 지났지만 오늘 일정이다. 시각 일정은 남은 것만 */
  function todayFacts(now: number) {
    const day = localDay(now);
    const to = startOfDay(now) + 24 * 3_600_000;
    const events = o.events
      .between(startOfDay(now), to)
      .filter((e) => e.allDay || e.startAt >= now)
      .map((e) => ({ minute: minuteOfDay(e.startAt), title: e.title, allDay: e.allDay }));
    const { open } = o.todos.list(now);
    const dueToday = open.filter((t) => t.due === day).length;
    const overdue = open.filter((t) => t.due !== null && t.due < day).length;
    return { events, dueToday, overdue };
  }

  let briefing = false;
  function brief(now: number) {
    const day = localDay(now);
    if (briefedDay === day || minuteOfDay(now) < BRIEFING_FROM_MINUTE) return;
    // 만나는 시간을 정해 두었으면 맞이 인사(쉬는 날은 한마디)가 브리핑을 맡는다
    if (coversBriefing(settings.get().routine, memo, day, minuteOfDay(now))) return;
    // 자리에 있을 때만 (1분 안에 입력이 있었고 화면이 잠기지 않음), 펫이 보일 때만.
    if (o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    briefedDay = day;
    store();
    const { events, dueToday, overdue } = todayFacts(now);
    o.log('planner', '브리핑');
    // 브리핑이 떠 있는 동안은 회고, 마감 알림, 혼잣말이 덮지 않게 기다린다
    briefing = true;
    void o
      .say({
        kind: 'system',
        text: briefingText({ events, dueToday, overdue, nowMinute: minuteOfDay(now) }),
        ttlMs: 15_000,
      })
      .then(() => {
        briefing = false;
      });
  }

  /**
   * 하루 회고 (v2): 회고 시각 뒤 처음 자리에 있을 때 한 번. 오늘 마감 남은 것은 내일로 넘길지 묻는다.
   * 수다 빈도와 따로 켜고 끈다(설정 review). 켜 두었으면 조용히에서도 온다 (그래서 'schedule' 종류: 조용히에서도 말하고 시간당 상한에 안 센다).
   * 숨어 있으면 모아 두었다가 나올 때, 못 보고 지나가면 놓친 알림에 남긴다 (hold). 그날이 지나면 꺼내지 않는다
   */
  function review(now: number) {
    const day = localDay(now);
    const s = settings.get();
    if (!s.review || reviewedDay === day || minuteOfDay(now) < s.reviewMinute) return;
    // 만나는 날 만났으면 헤어지는 인사가 회고를 같이 한다
    if (coversReview(s.routine, memo, day)) return;
    if (powerMonitor.getSystemIdleTime() > 60) return;
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
        text: reviewText({ doneTitles: doneToday.map((t) => t.title), leftToday: left.length }),
        buttons:
          left.length > 0
            ? [
                { id: 'move', label: t('panel.review.move') },
                { id: 'keep', label: t('panel.review.keep') },
              ]
            : [],
        ttlMs: 30_000,
        hold: {
          staleAt: startOfDay(now) + 24 * 3_600_000 - 1,
          missedLines: [t('briefing.review.missed', { done: doneToday.length, left: left.length })],
          missedMsgs: [
            { key: 'briefing.review.missed', vars: { done: doneToday.length, left: left.length } },
          ],
          onAction: act,
        },
      })
      .then(act);
  }

  // ---- 만나는 시간 (shared/routine.ts): 맞이, 시작 한마디, 헤어지는 인사, 쉬는 날 한마디. 하루 한 번씩 ----
  // 자리에 있을 때만 (1분 안에 입력, 화면 안 잠김). 맞이와 헤어짐은 'schedule' 이라 조용히에서도 오지만 한 줄로 줄이고,
  // 숨어 있으면 모아 두었다가 나올 때, 집에서 쉬는 중이면 나와서 말한다(일정 알림과 같다). 집중 중(펫이 잠)에는 끝날 때까지 기다린다
  function meet(now: number) {
    const s = settings.get();
    const due = routineDue(s.routine, memo, localDay(now), minuteOfDay(now));
    if (!due || briefing) return;
    if (powerMonitor.getSystemIdleTime() > 60 || powerMonitor.getSystemIdleState(60) === 'locked') return;
    const quiet = s.chatter === 'quiet';
    if (due.what === 'greet') {
      // 처음 자리에 있던 때를 적어 둔다 (집중으로 미뤄도 "일찍 왔네"가 맞게)
      if (memo.arrival?.day !== due.day) {
        memo = { ...memo, arrival: { day: due.day, clock: due.clock } };
        store();
      }
      if (focus.phase !== 'focus') greet(now, due, quiet);
    } else if (due.what === 'farewell') {
      if (focus.phase !== 'focus') farewell(now, due, quiet);
    } else if (due.what === 'cue') {
      memo = { ...memo, cued: due.day };
      store();
      if (s.chatter !== 'chatty' || focus.phase === 'focus' || o.petHidden()) return;
      o.log('planner', '시작 한마디');
      void o.say({ kind: 'idle-talk', text: t('routine.cue'), ttlMs: 8000 });
    } else {
      // 쉬는 날: 예전 브리핑처럼 펫이 보일 때 한 번. 일정만 붙이고 마감은 말하지 않는다 ('system': 조용히면 없다)
      if (o.petHidden()) return;
      const day = localDay(now);
      memo = { ...memo, restSaid: due.day };
      briefedDay = day;
      store();
      o.log('planner', '쉬는 날');
      briefing = true;
      const { events } = todayFacts(now);
      void o
        .say({
          kind: 'system',
          text: restText(day, briefingBody({ events, dueToday: 0, overdue: 0 }, '')),
          ttlMs: 10_000,
        })
        .then(() => {
          briefing = false;
        });
    }
  }

  /** 맞이: 연속 기록과 만난 날 코인(하루 한 번), 오늘 브리핑을 같이 */
  function greet(now: number, due: Extract<RoutineDue, { what: 'greet' }>, quiet: boolean) {
    const routine = settings.get().routine;
    const day = localDay(now);
    const first = !memo.streak;
    const streak = nextStreak(routine, memo.streak, due.day);
    const coins = meetCoins(streak, o.todos.coinCount('meet', day));
    // 오늘 예전 브리핑을 이미 했으면(오늘 처음 켠 설정) 인사만
    const withBriefing = !quiet && briefedDay !== day;
    memo = { ...memo, greeted: due.day, streak: { day: streak.day, n: streak.n } };
    briefedDay = day;
    store();
    if (coins > 0) {
      o.todos.reward(coins, 'meet', now);
      o.onReward();
      o.onChange();
    }
    o.log('planner', '맞이', due.arrival, streak.n, coins);
    briefing = true;
    void o
      .say({
        kind: 'schedule',
        text: greetText({
          day: due.day,
          arrival: due.arrival,
          first,
          streak: streak.n,
          coins,
          briefing: withBriefing ? briefingBody(todayFacts(now)) : '',
          quiet,
        }),
        ttlMs: withBriefing ? 15_000 : 9000,
        // 헤어질 때가 지나도록 못 보면 버린다 (놓친 알림에는 남기지 않는다: 인사는 지나면 쓸모가 없다)
        hold: { staleAt: localTime(due.day, spanEnd(due.meet)), missedLines: [] },
      })
      .then(() => {
        briefing = false;
      });
  }

  /** 헤어지는 인사: 수고했어, 오늘 끝낸 일, 다음 만남 미리 보기. 회고가 켜져 있으면 남은 마감을 내일로 넘길지 묻는다 */
  function farewell(now: number, due: Extract<RoutineDue, { what: 'farewell' }>, quiet: boolean) {
    const s = settings.get();
    const asks = s.review && reviewedDay !== due.day;
    memo = { ...memo, farewelled: due.day };
    if (asks) reviewedDay = due.day;
    store();
    const { open, doneToday } = o.todos.list(now);
    const left = asks ? open.filter((t) => t.due !== null && t.due <= due.day) : [];
    // 밤 근무는 아침에 헤어져 "내일"이 맞지 않아 미리 보기 없이 "푹 쉬어"
    const next = overnight(due.meet) ? undefined : nextMeet(s.routine, due.day);
    const from = localTime(due.day, 24 * 60);
    const tomorrow =
      next?.inDays === 1
        ? o.events
            .between(from, from + 24 * 3_600_000)
            .map((e) => ({ minute: minuteOfDay(e.startAt), title: e.title, allDay: e.allDay }))
        : [];
    const act = (a: string | undefined) => {
      if (a === 'move') moveToTomorrow(due.day);
    };
    o.log('planner', '헤어짐', doneToday.length, left.length);
    void o
      .say({
        kind: 'schedule',
        text: farewellText({
          day: due.day,
          doneTitles: doneToday.map((todo) => todo.title),
          ...(next ? { next } : {}),
          tomorrow,
          leftToday: left.length,
          quiet,
        }),
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

  /** 회고 "내일로 넘기기". 누른 때 남은 것을 다시 읽어 넘기고, 잠깐 되돌리기 단추를 보인다 */
  function moveToTomorrow(day: string) {
    const tomorrow = localDay(localTime(day, 0) + 36 * 3_600_000);
    const left = o.todos.list(Date.now()).open.filter((t) => t.due !== null && t.due <= day);
    if (left.length === 0) return;
    const moved = left.map((t) => ({ id: t.id, due: t.due }));
    for (const t of left) o.todos.update(t.id, { due: tomorrow });
    o.onChange();
    o.log('planner', '회고 내일로', moved.length);
    void o
      .say({
        kind: 'answer',
        text: t('panel.review.moved', { n: moved.length }),
        buttons: [{ id: 'undo', label: t('panel.review.undo') }],
        ttlMs: 10_000,
      })
      .then((a) => {
        if (a !== 'undo') return;
        const back = undoMoved(moved, o.todos.list(Date.now()).open, tomorrow);
        for (const b of back) o.todos.update(b.id, { due: b.due });
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
  const activity = new ActivityWatch();
  let talking = false;
  function talk(now: number) {
    const idleSec = powerMonitor.getSystemIdleTime();
    activity.observe(now, idleSec, screen.getCursorScreenPoint());
    if (talking) return;
    const pet = o.talkFacts?.() ?? {};
    const r = talker.due(
      now,
      {
        chatty: settings.get().chatter === 'chatty',
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
          .between(now, startOfDay(now) + 24 * 3_600_000)
          .filter((e) => !e.allDay && e.startAt > now);
        const next = timed.reduce<number | undefined>(
          (m, e) => (m === undefined ? e.startAt : Math.min(m, e.startAt)),
          undefined,
        );
        const lastDone = doneToday.reduce((m, t) => Math.max(m, t.doneAt ?? 0), 0);
        return {
          now,
          doneToday: doneToday.length,
          ...(lastDone > 0 ? { lastDoneAt: lastDone } : {}),
          openToday: open.filter((t) => t.due !== null && t.due <= day).length,
          ...(next !== undefined ? { nextEventMin: (next - now) / 60_000 } : {}),
          eventsLeftToday: timed.length,
          workedMin: activity.workedMin(now),
          ...(activity.backAt !== undefined ? { backAt: activity.backAt } : {}),
          mouseBusy: activity.mouseBusy(),
          ...(pet.mood !== undefined ? { mood: pet.mood } : {}),
          ...(pet.affection !== undefined ? { affection: pet.affection } : {}),
          ...(pet.hungry !== undefined ? { hungry: pet.hungry } : {}),
          ...(pet.more ? { more: pet.more } : {}),
        };
      },
    );
    if (!('key' in r)) return;
    o.log('planner', '혼잣말', r.key);
    talking = true;
    void o
      .say({ kind: 'idle-talk', text: t(r.key, { name: o.petName(), ...idleVars(r.facts) }), ttlMs: 8000 })
      .then((a) => {
        talking = false;
        talker.shown(Date.now(), a !== undefined);
      });
  }

  let lastTick = 0;
  function tick() {
    const now = Date.now();
    // 잠자기나 시계 바꾸기로 시간이 튀면 그 사이는 집중으로 치지 않는다
    focus = skipGap(focus, lastTick, now, TICK_MS);
    lastTick = now;
    remind(now);
    meet(now);
    brief(now);
    if (!briefing) {
      review(now);
      dueAlert(now);
      talk(now);
    }
    const r = tickFocus(focus, now);
    if (r.event === 'focus-done') {
      const minutes = focusedMinutes(focus, now);
      o.stats.addFocus(now, minutes);
      const coins = o.todos.rewardFocus(now, minutes);
      if (coins > 0) o.onReward();
      void o
        .say({
          kind: 'answer',
          text: t('panel.focus.done', {
            minutes,
            coins,
            breakMin: Math.round((r.state.endsAt - r.state.startedAt) / 60_000),
          }),
          buttons: [{ id: 'stop', label: t('panel.focus.stop') }],
          ttlMs: 20_000,
        })
        .then((a) => {
          if (a === 'stop') stopFocus();
        });
    } else if (r.event === 'break-done') {
      void o
        .say({
          kind: 'answer',
          text: t('panel.focus.breakDone'),
          buttons: [
            { id: 'again', label: t('panel.focus.again') },
            { id: 'no', label: t('panel.focus.enough') },
          ],
          ttlMs: 30_000,
        })
        .then((a) => {
          if (a === 'again') startFocusNow();
        });
    }
    if (r.state !== focus) {
      focus = r.state;
      o.onChange();
    }
  }

  /** 집중 시작. 길이를 주면 그 길이로 하고 다음에도 그 길이 (설정 focusMin) */
  function startFocusNow(minutes?: number) {
    if (isFocusLength(minutes) && minutes !== settings.get().focusMin) settings.set({ focusMin: minutes });
    const length = settings.get().focusMin;
    focus = startFocus(Date.now(), length);
    o.log('planner', '집중 시작', length);
    o.onChange();
  }

  function stopFocus() {
    const now = Date.now();
    const minutes = focusedMinutes(focus, now);
    if (minutes > 0) o.stats.addFocus(now, minutes);
    focus = IDLE;
    o.log('planner', '집중 그만', minutes);
    o.onChange();
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  // 켜자마자 한 번 (켜 둔 사이 지난 알림, 아침 브리핑). 펫이 자리를 잡을 시간을 준다.
  setTimeout(tick, 4000).unref();

  return {
    get focus() {
      return focus;
    },
    startFocus: startFocusNow,
    stopFocus,
    /** 일정이 바뀌었을 때 바로 한 번 본다 (곧 시작하는 일정을 넣은 경우) */
    check: tick,
    stop: () => clearInterval(timer),
  };
}
