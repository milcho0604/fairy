// 오늘 브리핑 (v1). 그날 처음 컴퓨터 앞에 앉았을 때(아침 5시 이후) 한 번, 펫이 말풍선으로 알려 준다.
// 수다 빈도 "조용히"면 하지 않는다 (기획서 "수다 빈도" 표).

import type { ChatterLevel } from './chatter.ts';
import { timeLabel } from './event-store.ts';
import { t } from './i18n/index.ts';
import { voiced, voicedPick } from './persona-voice.ts';
import { localDay } from './todo-store.ts';

/** 이 시각(현지, 분) 전에는 브리핑하지 않는다. 새벽에 켠 컴퓨터에 "좋은 아침"을 하지 않게. */
export const BRIEFING_FROM_MINUTE = 5 * 60;

// ---- 다음 할 일 ("뭐부터 하지?") ----

/** 이만큼 안에 시작하는 일정이 있으면 그 준비가 다음 할 일이다 */
export const PREPARE_MS = 30 * 60_000;

export interface NextUpTodo {
  id: number;
  title: string;
  due: string | null;
  dueMin?: number | null;
  important: boolean;
  createdAt: number;
  doneAt?: number | null;
  /** 반복 할 일(습관)이면 반복 종류. 습관은 맨 뒤에 고른다 */
  repeat?: string | null;
}

export interface NextUpEvent {
  id: number;
  title: string;
  startAt: number;
  allDay: boolean;
}

export type NextUp =
  | { kind: 'event'; id: number; title: string; startAt: number }
  | {
      kind: 'todo';
      id: number;
      title: string;
      /** 고른 까닭: 마감 지남, 오늘 중요, 중요, 오늘 마감, 습관 */
      why: 'overdue' | 'today-important' | 'today' | 'important' | 'habit';
    };

/** 마감이 이른 것, 같으면 시각이 이른 것(시각 없으면 뒤), 그다음 먼저 넣은 것 */
const byDue = (a: NextUpTodo, b: NextUpTodo) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
  (a.dueMin ?? 1440) - (b.dueMin ?? 1440) ||
  a.createdAt - b.createdAt;

/**
 * 지금 먼저 할 일 하나. 30분 안에 시작하는 일정(준비) → 마감 지난 할 일(중요 먼저) → 중요(오늘 마감 먼저) →
 * 오늘 마감 → 습관(반복 할 일) 순. 습관은 오늘 탭 습관 칸에서 체크하니 맨 뒤다. 없으면 undefined
 */
export function nextUp(o: {
  todos: readonly NextUpTodo[];
  events: readonly NextUpEvent[];
  now: number;
}): NextUp | undefined {
  const soon = o.events
    .filter((e) => !e.allDay && e.startAt > o.now && e.startAt <= o.now + PREPARE_MS)
    .sort((a, b) => a.startAt - b.startAt)[0];
  if (soon) return { kind: 'event', id: soon.id, title: soon.title, startAt: soon.startAt };
  const today = localDay(o.now);
  const open = o.todos.filter((todo) => todo.doneAt === null || todo.doneAt === undefined);
  const tasks = open.filter((todo) => !todo.repeat);
  const pick = (
    why: Extract<NextUp, { kind: 'todo' }>['why'],
    list: readonly NextUpTodo[],
    test: (todo: NextUpTodo) => boolean,
    order: (a: NextUpTodo, b: NextUpTodo) => number = byDue,
  ) => {
    const todo = list.filter(test).sort(order)[0];
    return todo ? ({ kind: 'todo', id: todo.id, title: todo.title, why } as const) : undefined;
  };
  const isToday = (x: NextUpTodo) => x.due === today;
  return (
    pick(
      'overdue',
      tasks,
      (x) => x.due !== null && x.due < today,
      (a, b) => +b.important - +a.important || byDue(a, b),
    ) ??
    pick('today-important', tasks, (x) => x.important && isToday(x)) ??
    pick(
      'important',
      tasks,
      (x) => x.important,
      (a, b) => a.createdAt - b.createdAt,
    ) ??
    pick('today', tasks, isToday) ??
    pick('habit', open, (x) => !!x.repeat && x.due !== null && x.due <= today)
  );
}

export interface BriefingInput {
  /** 오늘 남은 일정 (시작 분, 제목), 이른 것부터. 종일 일정(allDay)은 시각 없이 "오늘 종일: ..." 로 먼저 말한다 */
  events: { minute: number; title: string; allDay?: boolean }[];
  /** 마감이 오늘인 안 끝낸 할 일 수 */
  dueToday: number;
  /** 마감이 지난 안 끝낸 할 일 수 */
  overdue: number;
  /** 하루 중 지금 분 (인사말용) */
  nowMinute: number;
  /** 먼저 할 일 제목 (nextUp). 있으면 끝에 "먼저 '...'부터 해 볼까?" */
  next?: string;
}

function greeting(minute: number): string {
  // 인사는 고른 성격 말투로 (shared/persona-voice.ts). 인사를 모두 안 쓰기로 했으면 빈 글
  const base =
    minute < 11 * 60 ? 'briefing.hi.morning' : minute < 17 * 60 ? 'briefing.hi.day' : 'briefing.hi.evening';
  return voicedPick(base) ?? '';
}

export function briefingText(b: BriefingInput): string {
  return `${greeting(b.nowMinute)} ${briefingBody(b)}`.trim();
}

/**
 * 인사 없는 브리핑 (만나는 시간의 맞이 인사 뒤에 붙인다). 아무것도 없으면 empty 글
 * (기본은 "일정도 마감도 없어", 쉬는 날 한마디처럼 덧붙일 것이 없으면 빈 글을 넘긴다)
 */
export function briefingBody(
  b: Omit<BriefingInput, 'nowMinute'>,
  empty = voiced('briefing.nothing'),
): string {
  // 먼저 할 일이 있으면 "일정도 마감도 없어" 대신 그 한 문장만
  const body = briefingFacts(b, b.next ? '' : empty);
  return b.next ? `${body} ${voiced('briefing.next', { title: b.next })}`.trim() : body;
}

function briefingFacts(b: Omit<BriefingInput, 'nowMinute'>, empty: string): string {
  const parts: string[] = [];
  const allDay = b.events.filter((e) => e.allDay);
  if (allDay.length > 0) {
    // 둘까지 이름을 말하고 나머지는 수로 ("오늘 종일: 제주도 여행, 엄마 생일 외 1개.")
    const more = allDay.length - 2;
    const list =
      allDay
        .slice(0, 2)
        .map((e) => e.title)
        .join(', ') + (more > 0 ? t('briefing.due.more', { n: more }) : '');
    parts.push(voiced('briefing.allDay', { list }));
  }
  const timed = b.events.filter((e) => !e.allDay);
  const first = timed[0];
  if (first) {
    parts.push(
      timed.length === 1
        ? voiced('briefing.oneEvent', { time: timeLabel(first.minute), title: first.title })
        : voiced('briefing.events', { n: timed.length, time: timeLabel(first.minute), title: first.title }),
    );
  }
  if (b.dueToday > 0 || b.overdue > 0) {
    const due = b.dueToday > 0 ? t('briefing.dueToday', { n: b.dueToday }) : '';
    const late = b.overdue > 0 ? t('briefing.overdue', { n: b.overdue }) : '';
    parts.push(voiced('briefing.todos', { list: [due, late].filter(Boolean).join(', ') }));
  }
  return parts.length === 0 ? empty : parts.join(' ');
}

// ---- 하루 회고 (v2) ----

export interface ReviewInput {
  doneTitles: readonly string[];
  /** 오늘 마감인데 안 끝낸 할 일 수 */
  leftToday: number;
}

/** 퇴근 때 말풍선. 끝낸 일을 칭찬하고, 남은 오늘 마감이 있으면 내일로 넘길지 묻는다 */
export function reviewText(r: ReviewInput): string {
  const n = r.doneTitles.length;
  const done =
    n === 0
      ? voiced('briefing.review.none')
      : n === 1
        ? voiced('briefing.review.one', { title: r.doneTitles[0] ?? '' })
        : voiced('briefing.review.many', { n });
  return r.leftToday > 0 ? `${done} ${voiced('briefing.review.left', { n: r.leftToday })}` : done;
}

/**
 * 회고 "내일로 넘기기" 되돌리기: 넘긴 할 일 중 아직 열려 있고 마감이 그대로 내일인 것만 원래 마감으로.
 * 그사이 끝냈거나, 지웠거나, 손으로 마감을 바꾼 것은 둔다
 */
export function undoMoved(
  moved: readonly { id: number; due: string | null }[],
  open: readonly { id: number; due: string | null }[],
  tomorrow: string,
): { id: number; due: string | null }[] {
  const now = new Map(open.map((t) => [t.id, t.due]));
  return moved.filter((m) => now.get(m.id) === tomorrow);
}

/**
 * 오늘 탭 "못 한 N개 내일로"가 넘길 것: 안 끝났고 마감이 오늘이거나 지난 할 일.
 * 반복 할 일(습관)은 습관 칸에서 체크하므로 뺀다 (지난 마감 오늘로와 같다)
 */
export function leftForTomorrow<T extends { due: string | null; repeat?: unknown }>(
  open: readonly T[],
  today: string,
): T[] {
  return open.filter((t) => t.due !== null && t.due <= today && !t.repeat);
}

// ---- 오늘 마감 알림 (기획서 "수다 빈도" 마감 알림: 보통은 마감 당일 한 번, 수다쟁이는 오전과 오후) ----

export type DueSlot = 'am' | 'pm';

/** 오전 알림은 이 시각부터 오후 알림 전까지 (수다쟁이만) */
export const DUE_AM_FROM = 10 * 60;
/** 오후 알림. 보통은 14시, 수다쟁이는 15시부터. 하루 회고 시각 전까지만 (회고가 남은 마감을 묻는다) */
export const DUE_PM_FROM: Record<Exclude<ChatterLevel, 'quiet'>, number> = {
  normal: 14 * 60,
  sometimes: 14 * 60,
  chatty: 15 * 60,
};

/** 지금 분에 해당하는 마감 알림 칸. 조용히거나 칸 밖이면 undefined */
export function dueSlot(minute: number, level: ChatterLevel, reviewMinute: number): DueSlot | undefined {
  if (level === 'quiet' || minute >= reviewMinute) return undefined;
  if (minute >= DUE_PM_FROM[level]) return 'pm';
  if (level === 'chatty' && minute >= DUE_AM_FROM) return 'am';
  return undefined;
}

/** 오늘 마감 남은 할 일 말풍선. 제목은 셋까지 */
export function deadlineText(titles: readonly string[]): string {
  const shown = titles.slice(0, 3).map((title) => `"${title}"`);
  const more = titles.length - shown.length;
  return voiced('briefing.due.left', {
    n: titles.length,
    list: shown.join(', ') + (more > 0 ? t('briefing.due.more', { n: more }) : ''),
  });
}
