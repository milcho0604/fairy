// 달력 보기 (패널 일정 탭). 일정, 가져온 일정(.ics), 마감 있는 할 일, 반복 할 일의 다음 회차를 날짜 칸에 나눈다.
// 날짜는 현지 YYYY-MM-DD 글로 다룬다 (day.ts 처럼 날짜 셈은 UTC 로 해서 서머타임에 밀리지 않는다).
// 일정 시각(ms)을 날짜로 바꿀 때만 현지 시간대를 쓴다 (localDay).
import { monthEnd, plusDays, plusMonths, weekdayOf } from './day.ts';
import { allDaySpan, type CalEvent } from './event-store.ts';
import { lunarHolidays } from './lunar-holidays.ts';
import { localDay, monthAnchor, nextDue, type Todo } from './todo-store.ts';

/** 주 첫 요일: 0 일요일, 1 월요일 */
export type WeekStart = 0 | 1;

export const isWeekStart = (v: unknown): v is WeekStart => v === 0 || v === 1;

/** 달 "YYYY-MM" */
export const monthOf = (day: string): string => day.slice(0, 7);

/** 달 첫날 */
export const monthFirst = (month: string): string => `${month}-01`;

/** 그 주 첫날 (weekStart 요일) */
export function weekFirst(day: string, weekStart: WeekStart): string {
  return plusDays(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

/** 그 주 7일 */
export function weekOf(day: string, weekStart: WeekStart): string[] {
  const first = weekFirst(day, weekStart);
  return Array.from({ length: 7 }, (_, i) => plusDays(first, i));
}

/**
 * 달 보기 칸: 그 달을 덮는 주들 (앞뒤 달 날짜 포함), 주마다 7일. 4~6주.
 * 2월 1일이 주 첫 요일이고 평년이면 4주, 31일 달이 금요일이나 토요일에 시작하면 6주
 */
export function monthWeeks(month: string, weekStart: WeekStart): string[][] {
  const first = weekFirst(monthFirst(month), weekStart);
  const last = monthEnd(monthFirst(month));
  const weeks: string[][] = [];
  for (let start = first; start <= last; start = plusDays(start, 7)) weeks.push(weekOf(start, weekStart));
  return weeks;
}

/** 요일 순서 (머리 줄): 일요일 시작이면 0..6, 월요일 시작이면 1..6, 0 */
export const weekdayOrder = (weekStart: WeekStart): number[] =>
  Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);

/**
 * 달력 키보드 이동 (WAI-ARIA 날짜 고르기 방식). 왼쪽, 오른쪽 하루, 위, 아래 한 주, Home, End 주 처음과 끝,
 * PageUp, PageDown 한 달 (없는 날이면 그 달 말일, 1월 31일 다음 달은 2월 28일, 윤년 29일). 모르는 키는 undefined
 */
export function moveDay(day: string, key: string, weekStart: WeekStart): string | undefined {
  switch (key) {
    case 'ArrowLeft':
      return plusDays(day, -1);
    case 'ArrowRight':
      return plusDays(day, 1);
    case 'ArrowUp':
      return plusDays(day, -7);
    case 'ArrowDown':
      return plusDays(day, 7);
    case 'Home':
      return weekFirst(day, weekStart);
    case 'End':
      return plusDays(weekFirst(day, weekStart), 6);
    case 'PageUp':
      return plusMonths(day, -1);
    case 'PageDown':
      return plusMonths(day, 1);
    default:
      return undefined;
  }
}

/** 날짜 칸 하나에 놓이는 것 */
export interface CalItem {
  /** 화면 key (종류, id, 날짜) */
  key: string;
  /** event: 직접 넣은 일정, ics: 가져온 일정, todo: 마감 있는 할 일, repeat: 반복 할 일의 다음 회차(아직 없는 것) */
  kind: 'event' | 'ics' | 'todo' | 'repeat';
  /** 일정이나 할 일 id (repeat 은 지금 회차 할 일 id) */
  id: number;
  title: string;
  /** 그날 시작 분 (현지). 종일, 이어지는 날, 시각 없는 할 일은 null */
  minute: number | null;
  /** 종일 일정 */
  allDay: boolean;
  /** 여러 날에 걸친 것의 어느 날: one 하루짜리, first 첫날, middle 가운데, last 마지막 날 */
  part: 'one' | 'first' | 'middle' | 'last';
  /** 미리 알림이 있다 */
  remind: boolean;
  /** 중요 표시한 할 일 */
  important: boolean;
  /** 구글에서 읽어 온 일정의 캘린더 색 */
  color?: string;
}

const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * 일정이 걸친 날들 [first, last]. 시각 일정은 끝 바로 전 순간의 날까지 (밤 11시~새벽 1시면 이틀,
 * 자정에 딱 끝나면 하루). 끝이 없거나 시작보다 이르면 시작한 날 하루. 종일은 allDaySpan (끝 날은 들지 않는다)
 */
export function eventSpan(e: Pick<CalEvent, 'startAt' | 'endAt' | 'allDay'>): {
  first: string;
  last: string;
} {
  if (e.allDay) return allDaySpan(e);
  const first = localDay(e.startAt);
  if (e.endAt === null || e.endAt <= e.startAt) return { first, last: first };
  const last = localDay(e.endAt - 1);
  return { first, last: last < first ? first : last };
}

const partOf = (day: string, first: string, last: string): CalItem['part'] =>
  first === last ? 'one' : day === first ? 'first' : day === last ? 'last' : 'middle';

/** 반복 할 일 한 개가 그릴 다음 회차 수 상한 (매일 반복도 6주면 42) */
const REPEAT_CAP = 62;

/**
 * 반복 할 일의 다음 회차 마감일들 [from, to]. 지금 회차(due)를 끝내면 갈 날(nextDue, 오늘보다 뒤)부터 이어 간다.
 * 매달 반복은 마감일의 날을 기억한다 (31일 반복은 30일 달에 30일, 2월에 28일이나 29일)
 */
export function repeatDays(
  todo: Pick<Todo, 'due' | 'repeat' | 'repeatAnchor'>,
  today: string,
  from: string,
  to: string,
): string[] {
  if (!todo.repeat || !todo.due) return [];
  // 끝낼 때(TodoStore.complete)와 같은 셈: 매주는 기억한 원래 마감에서, 매달은 기억한 날("31")로
  const kept = todo.repeatAnchor ?? null;
  const anchor =
    monthAnchor(todo.repeat === 'monthly' ? kept : null, todo.due) ?? Number(todo.due.slice(8, 10));
  const out: string[] = [];
  let d = nextDue(todo.repeat === 'weekly' ? (kept ?? todo.due) : todo.due, todo.repeat, today, anchor);
  for (let i = 0; i < 2000 && d <= to && out.length < REPEAT_CAP; i++) {
    if (d >= from) out.push(d);
    d = nextDue(d, todo.repeat, d, anchor);
  }
  return out;
}

/** 칸 안 순서 놓기: 종일과 이어지는 날(긴 것부터), 시각 순, 시각 없는 할 일 */
function rank(i: CalItem): number {
  if (i.minute !== null) return 1;
  return i.kind === 'event' || i.kind === 'ics' ? 0 : 2;
}

export function compareItems(a: CalItem, b: CalItem): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  if (a.minute !== null && b.minute !== null && a.minute !== b.minute) return a.minute - b.minute;
  // 이어지는 일정(가운데, 마지막 날)이 그날 새로 시작하는 것보다 위: 칸마다 같은 줄에 머물게
  const cont =
    Number(b.part === 'middle' || b.part === 'last') - Number(a.part === 'middle' || a.part === 'last');
  if (cont !== 0) return cont;
  if (a.important !== b.important) return a.important ? -1 : 1;
  return a.id - b.id;
}

/**
 * 날짜별로 나눈다 [from, to]. events 는 기간과 겹치는 일정, todos 는 안 끝낸 할 일 (마감 없는 것은 빠진다).
 * 지난 반복 회차는 만들지 않는다 (끝내면 오늘 뒤로 가니까). 칸 안은 compareItems 순서
 */
export function calendarDays(
  events: readonly CalEvent[],
  todos: readonly Todo[],
  from: string,
  to: string,
  today: string,
): Map<string, CalItem[]> {
  const days = new Map<string, CalItem[]>();
  const put = (day: string, item: CalItem) => {
    const list = days.get(day);
    if (list) list.push(item);
    else days.set(day, [item]);
  };
  for (const e of events) {
    const { first, last } = eventSpan(e);
    if (last < from || first > to) continue;
    // 바깥에서 가져온 일정(ics, 구글에서 읽어 옴)은 같은 모양으로
    const kind = e.source === 'local' ? 'event' : 'ics';
    const end = last < to ? last : to;
    for (let day = first < from ? from : first; day <= end; day = plusDays(day, 1)) {
      put(day, {
        key: `${kind}:${e.id}:${day}`,
        kind,
        id: e.id,
        title: e.title,
        minute: !e.allDay && day === first ? minuteOf(e.startAt) : null,
        allDay: e.allDay,
        part: partOf(day, first, last),
        remind: e.reminds.length > 0,
        important: false,
        ...(e.gcalCal?.color ? { color: e.gcalCal.color } : {}),
      });
    }
  }
  for (const todo of todos) {
    if (!todo.due || todo.doneAt !== null) continue;
    const base = {
      id: todo.id,
      title: todo.title,
      minute: todo.dueMin,
      allDay: false,
      part: 'one' as const,
      remind: todo.reminds.length > 0,
      important: todo.important,
    };
    if (todo.due >= from && todo.due <= to)
      put(todo.due, { ...base, key: `todo:${todo.id}:${todo.due}`, kind: 'todo' });
    for (const day of repeatDays(todo, today, from, to))
      if (day !== todo.due) put(day, { ...base, key: `repeat:${todo.id}:${day}`, kind: 'repeat' });
  }
  for (const list of days.values()) list.sort(compareItems);
  return days;
}

/** 칸에 다 못 그리면 앞의 max-1 개와 "+N". max 개 이하면 다 */
export function fitItems<T>(items: readonly T[], max: number): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: [...items], more: 0 };
  const keep = Math.max(0, max - 1);
  return { shown: items.slice(0, keep), more: items.length - keep };
}

/** 한국 공휴일 이름 키 (대체공휴일과 부처님오신날은 아직 없다) */
export type HolidayKey =
  | 'cal.holiday.newYear'
  | 'cal.holiday.seollal'
  | 'cal.holiday.samil'
  | 'cal.holiday.children'
  | 'cal.holiday.memorial'
  | 'cal.holiday.liberation'
  | 'cal.holiday.chuseok'
  | 'cal.holiday.foundation'
  | 'cal.holiday.hangul'
  | 'cal.holiday.christmas';

const SOLAR: [string, HolidayKey][] = [
  ['01-01', 'cal.holiday.newYear'],
  ['03-01', 'cal.holiday.samil'],
  ['05-05', 'cal.holiday.children'],
  ['06-06', 'cal.holiday.memorial'],
  ['08-15', 'cal.holiday.liberation'],
  ['10-03', 'cal.holiday.foundation'],
  ['10-09', 'cal.holiday.hangul'],
  ['12-25', 'cal.holiday.christmas'],
];

/**
 * 그해 한국 공휴일: 양력 고정 여덟 날과 설날, 추석 연휴(앞뒤 하루). 음력 표(lunar-holidays.ts) 밖의 해는 양력만.
 * 같은 날 둘이면(추석 연휴와 개천절) 양력 이름
 */
export function koreanHolidays(year: number): Map<string, HolidayKey> {
  const out = new Map<string, HolidayKey>();
  const lunar = lunarHolidays(year);
  if (lunar) {
    for (const n of [-1, 0, 1]) {
      out.set(plusDays(lunar.seollal, n), 'cal.holiday.seollal');
      out.set(plusDays(lunar.chuseok, n), 'cal.holiday.chuseok');
    }
  }
  for (const [md, key] of SOLAR) out.set(`${year}-${md}`, key);
  return out;
}

/** 기간 [from, to] 의 공휴일 (해를 넘는 달력 칸도) */
export function holidaysBetween(from: string, to: string): Map<string, HolidayKey> {
  const out = new Map<string, HolidayKey>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (const [day, key] of koreanHolidays(y)) if (day >= from && day <= to) out.set(day, key);
  return out;
}
