import { powerMonitor } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import { BRIEFING_FROM_MINUTE, briefingText, deadlineText, dueSlot, reviewText } from '../shared/briefing.ts';
import { bundleText, canSnooze, SCHEDULE_STALE_MS, SNOOZE_MS } from '../shared/bubble-queue.ts';
import type { EventStore } from '../shared/event-store.ts';
import { timeLabel } from '../shared/event-store.ts';
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
import { IDLE_TALK_MS, IdleTalk } from '../shared/idle-talk.ts';
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
  /** 패널 오늘 탭 열기 (마감 알림 "볼게") */
  openToday: () => void;
  /** 지금 펫 이름 (혼잣말에 넣는다) */
  petName: () => string;
  log: (tag: string, ...rest: unknown[]) => void;
}

export const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** 일정 알림 한 줄: "5분 뒤 회의 (오후 3:00)" */
function remindLine(e: { title: string; startAt: number }, now: number): string {
  const left = Math.round((e.startAt - now) / 60_000);
  const when = left <= 0 ? t('panel.remind.now') : t('panel.remind.inMin', { n: left });
  return `${when} ${e.title} (${timeLabel(minuteOfDay(e.startAt))})`;
}

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
    | { briefedDay?: string; reviewedDay?: string; dueSaid?: unknown }
    | undefined;
  let briefedDay = typeof saved?.briefedDay === 'string' ? saved.briefedDay : '';
  let reviewedDay = typeof saved?.reviewedDay === 'string' ? saved.reviewedDay : '';
  /** 오늘 마감 알림을 한 칸 ("2026-10-07:pm") */
  let dueSaid: string[] = Array.isArray(saved?.dueSaid)
    ? saved.dueSaid.filter((v): v is string => typeof v === 'string').slice(-4)
    : [];
  const store = () => writeJson(STORE, { briefedDay, reviewedDay, dueSaid });

  /** 미룬 일정 알림 (메모리에만). at 에 다시 말한다 */
  let snoozed: { at: number; ids: number[] }[] = [];

  function remind(now: number) {
    // 같은 때 알릴 일정이 여럿이면 말풍선 하나로 묶는다 (따로 띄우면 뒤 것이 앞 것을 밀어낸다).
    // 펫이 숨어 있으면 펫이 모아 두었다가 나올 때 말하고, 시작이 한참 지났으면 놓친 알림에만 둔다 (hold).
    const due = o.events.dueReminders(now);
    for (const e of due) {
      o.events.markNotified(e.id, now);
      o.log('planner', '일정 알림', e.id);
    }
    const ready = snoozed.filter((s) => s.at <= now);
    snoozed = snoozed.filter((s) => s.at > now);
    // 미룬 일정은 다시 읽는다: 그사이 지웠으면 빼고, 고쳤으면 고친 제목과 시각으로
    const again = [...new Set(ready.flatMap((s) => s.ids))]
      .filter((id) => !due.some((e) => e.id === id))
      .map((id) => o.events.get(id))
      .filter((e) => e !== undefined);
    const list = [...due, ...again];
    if (list.length === 0) return;
    const earliest = Math.min(...list.map((e) => e.startAt));
    const lines = list.map((e) => remindLine(e, now));
    const buttons = [{ id: 'ok', label: t('panel.remind.ok') }];
    if (canSnooze(now, earliest)) buttons.push({ id: 'snooze', label: t('panel.remind.snooze') });
    void o
      .say({
        kind: 'schedule',
        text: bundleText([{ text: '', lines, at: now }]),
        buttons,
        ttlMs: 30_000,
        hold: {
          staleAt: earliest + SCHEDULE_STALE_MS,
          lines,
          // 숨어 있다 늦게 꺼내도 "몇 분 뒤"가 맞게, 놓친 알림에는 제목과 시각만
          render: (at) => list.map((e) => remindLine(e, at)),
          missedLines: list.map((e) => `${e.title} (${timeLabel(minuteOfDay(e.startAt))})`),
        },
      })
      .then((a) => {
        if (a !== 'snooze') return;
        o.log('planner', '일정 알림 미룸', list.length);
        snoozed.push({ at: Date.now() + SNOOZE_MS, ids: list.map((e) => e.id) });
      });
  }

  /** 오늘 마감 알림: 보통은 오후 한 번, 수다쟁이는 오전과 오후. 자리에 있고 펫이 보일 때만 */
  function dueAlert(now: number) {
    const day = localDay(now);
    const s = settings.get();
    const slot = dueSlot(minuteOfDay(now), s.chatter, s.reviewMinute);
    if (!slot || dueSaid.includes(`${day}:${slot}`)) return;
    if (focus.phase === 'focus' || o.petHidden() || powerMonitor.getSystemIdleTime() > 60) return;
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    // 남은 게 없으면 칸을 쓰지 않는다 (나중에 오늘 마감을 넣으면 그 칸에 알리게)
    const left = o.todos.list(now).open.filter((todo) => todo.due !== null && todo.due === day);
    if (left.length === 0) return;
    dueSaid = [...dueSaid.filter((k) => k.startsWith(day)), `${day}:${slot}`];
    store();
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
        if (a === 'open') o.openToday();
      });
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

  /** 혼잣말과 칭찬 (수다쟁이만, 30분마다). 잠(입력 없음), 집중, 숨김, 발표 중에는 하지 않는다 */
  const idleTalk = new IdleTalk();
  let talkedAt = Date.now();
  function talk(now: number) {
    if (now - talkedAt < IDLE_TALK_MS || settings.get().chatter !== 'chatty') return;
    if (focus.phase === 'focus' || o.petHidden()) return;
    if (powerMonitor.getSystemIdleTime() > 60 || powerMonitor.getSystemIdleState(60) === 'locked') return;
    talkedAt = now;
    const key = idleTalk.pick({ now, doneToday: o.todos.list(now).doneToday.length });
    if (!key) return;
    o.log('planner', '혼잣말', key);
    void o.say({ kind: 'idle-talk', text: t(key, { name: o.petName() }), ttlMs: 8000 });
  }

  let lastTick = 0;
  function tick() {
    const now = Date.now();
    // 잠자기나 시계 바꾸기로 시간이 튀면 그 사이는 집중으로 치지 않는다
    focus = skipGap(focus, lastTick, now, TICK_MS);
    lastTick = now;
    remind(now);
    brief(now);
    review(now);
    dueAlert(now);
    talk(now);
    const r = tickFocus(focus, now);
    if (r.event === 'focus-done') {
      const minutes = focusedMinutes(focus, now);
      o.stats.addFocus(now, minutes);
      const coins = o.todos.rewardFocus(now, minutes);
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
