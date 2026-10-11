// 빠른 입력과 패널이 넘긴 값에서 미리 알림, 할 일 마감 시각 읽기 (8판).
// 알림 말 떼기는 remind.ts takeRemind, 시각 읽기는 일정 한 줄과 같은 parseQuickEvent 를 쓴다.
import { plusDays } from './day.ts';
import { KO_WINDOW, normalizeQuick, parseQuickEvent } from './event-store.ts';
import { hasDeadlineWord, parseQuickTodo, type QuickTodo } from './quick-add.ts';
import { EN_WEEKDAY_ANY, enWeekdayIndex, weekdayOffset } from './quick-words.ts';
import { MAX_REMINDS, type RemindSpec, resolveSpecs, takeRemind } from './remind.ts';
import { isDueMin, isRepeat, type Repeat } from './todo-store.ts';

export interface QuickTodoTimed extends QuickTodo {
  /** 마감 시각 (하루 안의 분). "3시까지 보고서", "report by 5pm" */
  dueMin: number | null;
}

/** 영어 마감 낱말이 제목 끝에 남으면 뗀다 ("report by 5pm" 의 시각을 읽고 남은 "report by") */
const EN_DEADLINE_TAIL = /\s+(?:by|until|due|before)$/i;
const MIDNIGHT = /자정|\bmidnight\b/i;

// 반복 낱말은 줄 어디에 있어도 된다 (시각이 같이 있을 때만 여기서 읽는다): "standup every weekday 9am",
// "gym daily 7am", "weekly review fri 4pm", "every monday 10am team sync", "매일 아침 7시 운동".
// 한국어 요일은 parseQuickTodo 와 같이 온 이름만, 영어는 every 뒤 요일 이름(줄임말도)
const KO_WD = '일월화수목금토';
const REPEAT_ANYWHERE: [RegExp, Repeat][] = [
  [/(?:^|\s)(?:매주 ([일월화수목금토])요일(?:마다)?|([일월화수목금토])요일마다)(?=\s|$)/, 'weekly'],
  [new RegExp(`\\bevery (${EN_WEEKDAY_ANY})\\b`, 'i'), 'weekly'],
  [/(?:^|\s)매일(?:마다)?(?=\s|$)|\b(?:every ?day|daily)\b/i, 'daily'],
  [/(?:^|\s)평일(?:마다|에|엔)?(?=\s|$)|\b(?:every weekday|on weekdays|weekdays)\b/i, 'weekdays'],
  [/(?:^|\s)매주(?=\s|$)|\b(?:every week|weekly)\b/i, 'weekly'],
];

/**
 * 반복 낱말과 시각이 같이 있는 줄 → 시각이 있는 반복 할 일. 첫 마감은 그 시각이 아직 안 지난 첫 회차.
 * 시각이 없거나 반복 낱말이 없으면 null (아래 parseTodoLine 의 다른 규칙으로)
 */
function parseRepeatTimed(text: string, today: string, nowMinute: number): QuickTodoTimed | null {
  const norm = normalizeQuick(text);
  for (const [re, repeat] of REPEAT_ANYWHERE) {
    const m = norm.match(re);
    if (!m || m.index === undefined) continue;
    const rest = `${norm.slice(0, m.index)} ${norm.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim();
    const ev = parseQuickEvent(rest, today, nowMinute);
    if (!ev) return null;
    const inner = parseQuickTodo(ev.title, today);
    if (!inner.title) return null;
    const wdWord = m[1] ?? m[2];
    const wd = wdWord ? (/[가-힣]/.test(wdWord) ? KO_WD.indexOf(wdWord) : enWeekdayIndex(wdWord)) : -1;
    let due: string;
    if (wd >= 0) {
      // 매주 그 요일: 오늘이 그 요일이고 시각이 지났으면 다음 주
      due = plusDays(today, weekdayOffset(today, wd, false));
      if (due === today && ev.minute <= nowMinute) due = plusDays(today, 7);
    } else {
      // 날짜 낱말("fri", "내일")이 있으면 그날, 없으면 시각이 안 지난 오늘이나 내일 (일정 한 줄과 같은 셈)
      due = ev.day;
      if (repeat === 'weekdays')
        while ([0, 6].includes(new Date(`${due}T00:00:00Z`).getUTCDay())) due = plusDays(due, 1);
    }
    return {
      title: inner.title,
      due,
      important: inner.important || /!$|^!/.test(norm),
      repeat,
      dueMin: ev.minute,
    };
  }
  return null;
}

/**
 * 할 일 한 줄. parseQuickTodo 에 더해 마감 시각("내일 3시까지 보고서", "보고서 오후 5시까지", "report by 5pm")을 읽는다.
 * 시각은 마감 낱말(까지, by, until, due)이 있을 때만: "3시 회의"는 일정이다. 반복 낱말이 있으면("gym daily 7am")
 * 시각은 반복 할 일의 마감 시각이다 (반복 일정은 없다)
 */
export function parseTodoLine(text: string, today: string, nowMinute: number): QuickTodoTimed {
  const timed = parseRepeatTimed(text, today, nowMinute);
  if (timed) return timed;
  const parsed = parseQuickTodo(text, today);
  // 매달 반복에 시각이 있으면("매달 25일 오전 9시 월세") 그 시각이 마감 시각이다
  if (parsed.repeat === 'monthly') {
    const ev = parseQuickEvent(parsed.title, today, nowMinute);
    return ev?.title && ev.durationMin === null
      ? { ...parsed, title: ev.title, dueMin: ev.minute }
      : { ...parsed, dueMin: null };
  }
  if (parsed.repeat || !hasDeadlineWord(text)) return { ...parsed, dueMin: null };
  const ev = parseQuickEvent(text, today, nowMinute);
  // "오전 중", "오후 중" 은 시간대라 길이가 있다: 마감은 그 끝 (낮 12시, 오후 6시)
  const window = KO_WINDOW.test(` ${normalizeQuick(text)} `);
  if (!ev || (ev.durationMin !== null && !window)) return { ...parsed, dueMin: null };
  const inner = parseQuickTodo(ev.title.replace(EN_DEADLINE_TAIL, ''), today);
  if (!inner.title) return { ...parsed, dueMin: null };
  // "자정까지", "by midnight" 는 그날 밤 11시 59분 (다음 날 0시로 두면 마감이 "내일 오전 12:00" 으로 보였다)
  const midnight = ev.minute === 0 && MIDNIGHT.test(text);
  // 일정 읽기가 날짜 낱말을 못 떼고 제목에 남겼으면("내일까지 3시 보고서" → "내일까지 보고서") 그 날짜가 마감이다.
  // 일정 쪽 날짜는 낱말이 없을 때 고른 오늘이나 내일이라 버린다
  const due = inner.due ?? (midnight ? plusDays(ev.day, -1) : ev.day);
  return {
    title: inner.title,
    due,
    important: parsed.important || inner.important,
    repeat: null,
    dueMin: midnight ? 24 * 60 - 1 : ev.minute + (window ? (ev.durationMin ?? 0) : 0),
  };
}

/** 한 줄에서 뗀 알림 말 */
export type TakenRemind = { specs: RemindSpec[]; none: boolean } | null;

/** 한 줄에서 알림 말을 뗀다. 남은 글(rest)로 일정이나 할 일을 읽는다 */
export function splitRemind(text: string): { rest: string; remind: TakenRemind } {
  const r = takeRemind(text);
  return r ? { rest: r.rest, remind: { specs: r.specs, none: r.none } } : { rest: text, remind: null };
}

/**
 * 뗀 알림 말을 알림 목록으로. 알림 말이 없었으면 undefined (기본 알림).
 * "알림 없이"는 빈 목록. 뜻이 없는 말만 있었으면(마감일만 있는 할 일의 "1시간 전") 기본으로
 */
export function remindsOf(remind: TakenRemind, dateOnly: boolean, minute = 0): number[] | undefined {
  if (!remind) return undefined;
  if (remind.none) return [];
  const list = resolveSpecs(remind.specs, dateOnly, minute);
  return list.length ? list : undefined;
}

/** 화면이 보낸 알림 목록: 숫자 배열만 (값 범위는 저장할 때 다듬는다) */
export function remindsInput(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_REMINDS * 2) return undefined;
  return v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : undefined;
}

/** 화면이 보낸 할 일 고치기를 아는 칸만 남긴다 */
export function todoPatchInput(p: unknown): {
  title?: string;
  due?: string | null;
  important?: boolean;
  repeat?: Repeat | null;
  dueMin?: number | null;
  reminds?: number[];
} {
  if (typeof p !== 'object' || p === null) return {};
  const v = p as Record<string, unknown>;
  const reminds = remindsInput(v.reminds);
  return {
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(v.due === null || (typeof v.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.due))
      ? { due: v.due as string | null }
      : {}),
    ...(typeof v.important === 'boolean' ? { important: v.important } : {}),
    ...(v.repeat === null || isRepeat(v.repeat) ? { repeat: v.repeat as Repeat | null } : {}),
    ...(v.dueMin === null || isDueMin(v.dueMin) ? { dueMin: v.dueMin as number | null } : {}),
    ...(reminds ? { reminds } : {}),
  };
}
