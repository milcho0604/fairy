import { powerMonitor } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import { BRIEFING_FROM_MINUTE, briefingText, reviewText } from '../shared/briefing.ts';
import type { EventStore } from '../shared/event-store.ts';
import { timeLabel } from '../shared/event-store.ts';
import { type FocusState, focusedMinutes, IDLE, startFocus, tickFocus } from '../shared/focus.ts';
import { t } from '../shared/i18n/index.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
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
 * - 집중 타이머: 25분 집중(펫은 잠) → 코인 5개 → 5분 쉬기
 */
export function createPlanner(o: PlannerOptions) {
  let focus: FocusState = IDLE;
  const saved = readJson(STORE) as { briefedDay?: string; reviewedDay?: string } | undefined;
  let briefedDay = typeof saved?.briefedDay === 'string' ? saved.briefedDay : '';
  let reviewedDay = typeof saved?.reviewedDay === 'string' ? saved.reviewedDay : '';
  const store = () => writeJson(STORE, { briefedDay, reviewedDay });

  function remind(now: number) {
    for (const e of o.events.dueReminders(now)) {
      o.events.markNotified(e.id, now);
      const left = Math.round((e.startAt - now) / 60_000);
      const when = left <= 0 ? t('panel.remind.now') : t('panel.remind.inMin', { n: left });
      o.log('planner', '일정 알림', e.id, when);
      void o.say({
        kind: 'schedule',
        text: `${when} ${e.title} (${timeLabel(minuteOfDay(e.startAt))})`,
        buttons: [{ id: 'ok', label: t('panel.remind.ok') }],
        ttlMs: 30_000,
      });
    }
  }

  function brief(now: number) {
    const day = localDay(now);
    if (briefedDay === day || minuteOfDay(now) < BRIEFING_FROM_MINUTE) return;
    // 자리에 있을 때만 (1분 안에 입력이 있었고 화면이 잠기지 않음), 펫이 보일 때만.
    if (o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    briefedDay = day;
    store();
    const from = now;
    const to = startOfDay(now) + 24 * 3_600_000;
    const events = o.events
      .between(from, to)
      .map((e) => ({ minute: minuteOfDay(e.startAt), title: e.title }));
    const { open } = o.todos.list(now);
    const dueToday = open.filter((t) => t.due === day).length;
    const overdue = open.filter((t) => t.due !== null && t.due < day).length;
    o.log('planner', '브리핑');
    void o.say({
      kind: 'system',
      text: briefingText({ events, dueToday, overdue, nowMinute: minuteOfDay(now) }),
      ttlMs: 15_000,
    });
  }

  /** 하루 회고 (v2): 회고 시각 뒤 처음 자리에 있을 때 한 번. 오늘 마감 남은 것은 내일로 넘길지 묻는다 */
  function review(now: number) {
    const day = localDay(now);
    if (reviewedDay === day || minuteOfDay(now) < settings.get().reviewMinute) return;
    if (settings.get().chatter === 'quiet' || o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return;
    reviewedDay = day;
    store();
    const { open, doneToday } = o.todos.list(now);
    const left = open.filter((t) => t.due !== null && t.due <= day);
    o.log('planner', '회고');
    void o
      .say({
        kind: 'system',
        text: reviewText({ doneTitles: doneToday.map((t) => t.title), leftToday: left.length }),
        buttons:
          left.length > 0
            ? [
                { id: 'move', label: t('panel.review.move') },
                { id: 'keep', label: t('panel.review.keep') },
              ]
            : [],
        ttlMs: 30_000,
      })
      .then((a) => {
        if (a !== 'move') return;
        const tomorrow = localDay(startOfDay(now) + 36 * 3_600_000);
        for (const t of left) o.todos.update(t.id, { due: tomorrow });
        o.onChange();
      });
  }

  function tick() {
    const now = Date.now();
    remind(now);
    brief(now);
    review(now);
    const r = tickFocus(focus, now);
    if (r.event === 'focus-done') {
      const minutes = focusedMinutes(focus, now);
      o.stats.addFocus(now, minutes);
      const coins = o.todos.rewardFocus(now);
      if (coins > 0) o.onReward();
      void o
        .say({
          kind: 'answer',
          text: t('panel.focus.done', { minutes, coins }),
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

  function startFocusNow() {
    focus = startFocus(Date.now());
    o.log('planner', '집중 시작');
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
