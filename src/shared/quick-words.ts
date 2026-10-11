// 빠른 입력의 영어 낱말 (F). 할 일(quick-add.ts)과 일정(event-store.ts)이 같이 쓴다.
// 낱말은 늘 통째로만 읽는다: "sundays", "Monica", "monday-ish" 는 요일이 아니다.
import { monthEnd, plusDays, plusMonths } from './day.ts';

/** 요일 순서는 Date.getUTCDay 와 같다(일요일 0). 맨 앞이 온 이름, 나머지는 줄임말 */
const WEEKDAY_NAMES: readonly (readonly string[])[] = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tues', 'tue'],
  ['wednesday', 'wed'],
  ['thursday', 'thurs', 'thur', 'thu'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
];

/** 온 이름만 (sunday|monday|...). 제목 낱말과 헷갈릴 일이 적어 앞말 없이도 읽는다 */
export const EN_WEEKDAY_FULL = WEEKDAY_NAMES.map((n) => n[0]).join('|');

/** 온 이름과 줄임말 모두. 쓰는 쪽 정규식이 뒤에 빈칸을 요구해서 순서는 상관없다 */
export const EN_WEEKDAY_ANY = WEEKDAY_NAMES.flat().join('|');

/** "Fri", "friday" → 5. 모르는 말이면 -1 */
export function enWeekdayIndex(word: string): number {
  const w = word.toLowerCase();
  return WEEKDAY_NAMES.findIndex((names) => names.includes(w));
}

/**
 * today(YYYY-MM-DD)에서 그 요일까지 며칠 남았나.
 * next 가 아니면 이번 주기의 그 요일(오늘이면 0), next 면 다음 주(월요일 시작)의 그 요일.
 * 한국어 "다음 주 화요일" 과 같은 규칙이라 "next tuesday" 도 같은 날을 가리킨다.
 */
export function weekdayOffset(today: string, target: number, next: boolean): number {
  const cur = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (!next) return (target - cur + 7) % 7;
  const toNextMonday = (1 - cur + 7) % 7 || 7;
  return toNextMonday + ((target + 6) % 7);
}

/** 영어 수 낱말: "for three days", "in a week", "in an hour" */
export const EN_COUNT: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const EN_REL_COUNT = `\\d{1,2}|${Object.keys(EN_COUNT).join('|')}`;

/**
 * 영어 상대 날짜 (2026-10-08). 할 일 마감(quick-add.ts)과 시각 일정, 종일 일정(event-store.ts)이 같은 낱말을 같은 셈으로 읽는다.
 * 한국어 "3일 뒤", "다음 달 5일" 과 짝이다. "the day after tomorrow" 는 today, tomorrow 와 같이 따로 읽는다.
 * - "in 2 days", "within 3 days", "in a week", "in 3 weeks", "in a month", "in 2 months"
 * - "next week": 다음 주 월요일 ("next monday" 와 같은 날)
 * - "end of week", "end of the week", "end of next week": 그 주 금요일 ("friday" 처럼 오늘이 금요일이면 오늘)
 * - "end of month", "end of the month", "end of next month": 그 달 말일
 * - "this weekend", "on the weekend", "by the weekend": 다가오는 토요일 (토, 일요일이면 오늘)
 * - "next weekend": 다음 주 토요일
 * - "next month": 다음 달 1일 ("next week" 이 다음 주 첫날인 것과 같다. 말일은 "end of next month")
 * "the weekend" 는 앞말(on, over, by, until)이 있을 때만 읽는다: "weekend trip plan" 은 제목이다.
 */
export const EN_REL_DAY_WORD = [
  `(?:in|within) (?:${EN_REL_COUNT}) (?:days?|weeks?|months?)`,
  '(?:the )?end of (?:the |this |next )?(?:week|month)',
  'next weekend',
  'next week',
  'next month',
  'this weekend',
  '(?:on|over|by|until) the weekend',
].join('|');

/**
 * 상대 날짜 바로 뒤에 이 말이 오면 날짜가 아니라 문장의 일부다: "check in 2 days later", "met in 3 days of rain".
 * 정규식에서 상대 날짜와 뒤의 빈칸 다음에 붙인다
 */
export const EN_REL_DAY_GUARD = '(?!(?:later|ago|old|before|after|of|straight|running|in a row)\\b)';

/** EN_REL_DAY_WORD 로 찾은 말 → 날짜(today 기준). 날 수가 0 이면("in 0 days") null */
export function enRelDay(word: string, today: string): string | null {
  const w = word.toLowerCase().replace(/\s+/g, ' ').trim();
  const n = w.match(/^(?:in|within) (\S+) (day|week|month)s?$/);
  if (n) {
    const c = /^\d+$/.test(n[1] ?? '') ? Number(n[1]) : (EN_COUNT[n[1] ?? ''] ?? 0);
    if (c < 1) return null;
    if (n[2] === 'month') return plusMonths(today, c);
    return plusDays(today, n[2] === 'week' ? c * 7 : c);
  }
  const end = w.match(/end of (?:the |this |(next) )?(week|month)$/);
  if (end) {
    const next = end[1] === 'next';
    return end[2] === 'week' ? plusDays(today, weekdayOffset(today, 5, next)) : monthEnd(today, next ? 1 : 0);
  }
  if (w === 'next week') return weekDay(today, 1, 1);
  if (w === 'next weekend') return weekendOf(today, 1);
  if (w === 'next month') return plusDays(monthEnd(today), 1);
  if (w.endsWith('weekend')) return weekendOf(today, 0);
  return null;
}

/** weeks 주 뒤(0 이번 주, 1 다음 주, 2 다다음 주)의 그 요일. 이번 주면 다가오는 그 요일(오늘이면 오늘) */
function weekDay(today: string, target: number, weeks: number): string {
  if (weeks === 0) return plusDays(today, weekdayOffset(today, target, false));
  return plusDays(today, weekdayOffset(today, target, true) + (weeks - 1) * 7);
}

/** 주말(토요일). 이번 주말이면 다가오는 토요일, 토, 일요일이면 오늘 */
function weekendOf(today: string, weeks: number): string {
  if (weeks > 0) return weekDay(today, 6, weeks);
  const cur = new Date(`${today}T00:00:00Z`).getUTCDay();
  return cur === 0 ? today : plusDays(today, 6 - cur);
}

// ---- 한국어 상대 날짜 (2026-10-08). 영어와 같은 셈: 그냥 "다음 주"는 그 주 첫날(월요일), "까지", "안에"는 그 주 금요일 ----

const KO_NUM: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};
const KO_DAYS: Record<string, number> = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4 };
const KO_COUNT = `\\d{1,2}|${Object.keys(KO_NUM).join('|')}`;
const KO_BY = '(?:까지|안에|중에?|내로?)';

/**
 * 한국어 상대 날짜. 할 일 마감(맨 앞이나 맨 끝), 시각 일정, 종일 일정이 같이 쓴다. "3일 뒤", "다음 달 5일", 요일은 따로 읽는다.
 * - "이틀 뒤", "일주일 뒤", "2주 뒤", "한 달 뒤", "3개월 후"
 * - "이번 주까지", "이번 주 안에", "다음 주까지", "다다음 주까지": 그 주 금요일 (오늘이 금요일이면 이번 주는 오늘)
 * - "주말", "이번 주말", "주말에": 다가오는 토요일 (토, 일요일이면 오늘). "다음 주말", "다다음 주말"
 * - "다음 주", "다다음 주": 그 주 월요일 ("다음 주 월요일"은 요일로 읽는다)
 * - "월말", "이달 말", "이번 달 말", "이번 달까지", "이번 달 안에": 이달 말일. "다음 달 말", "다음 달까지": 다음 달 말일
 * - "다음 달": 다음 달 1일 ("다음 달 5일"은 날짜로 읽는다)
 * 그냥 "이번 주", "이번 달"은 언제인지 모호해서 읽지 않는다. 할 일 맨 앞의 그냥 "주말"은 제목일 수 있어 quick 쪽이 거른다.
 */
export const KO_REL_DAY_WORD = [
  '(?:하루|이틀|사흘|나흘) ?(?:뒤|후)',
  '일주일 ?(?:뒤|후)',
  `(?:${KO_COUNT}) ?(?:주|달|개월) ?(?:뒤|후)`,
  `(?:다다음|다음|이번) ?주 ?${KO_BY}`,
  '(?:(?:다다음|다음|이번) ?)?주말',
  // 뒤에 요일이 오면 그 요일이 읽는다 ("다음 주 금요일", 한 글자 "다음 주 금", "다음 주 일 3시")
  '(?:다다음|다음) ?주(?! ?(?:[일월화수목금토]요일|[월화수목금토](?:에|엔|까지)?(?:\\s|$)|일(?:에|엔)? (?:(?:오전|오후|아침|저녁|밤|새벽|낮) ?)?\\d{1,2}(?:시|:\\d{2})))',
  '(?:이번 ?달|이달|다음 ?달) ?말일?|월말',
  `(?:이번 ?달|이달|다음 ?달) ?${KO_BY}`,
  '다음 ?달(?! ?\\d{1,2}일)',
].join('|');

/** KO_REL_DAY_WORD 로 찾은 말 → 날짜. 수가 0 이면 null */
export function koRelDay(word: string, today: string): string | null {
  const w = word.replace(/\s+/g, '');
  const days = w.match(/^(하루|이틀|사흘|나흘)(?:뒤|후)$/);
  if (days) return plusDays(today, KO_DAYS[days[1] ?? ''] ?? 0);
  if (/^일주일(?:뒤|후)$/.test(w)) return plusDays(today, 7);
  const n = w.match(/^(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)(주|달|개월)(?:뒤|후)$/);
  if (n) {
    const c = /^\d+$/.test(n[1] ?? '') ? Number(n[1]) : (KO_NUM[n[1] ?? ''] ?? 0);
    if (c < 1) return null;
    return n[2] === '주' ? plusDays(today, c * 7) : plusMonths(today, c);
  }
  const weeks = (lead: string | undefined) => (lead === '다다음' ? 2 : lead === '다음' ? 1 : 0);
  const byWeek = w.match(/^(다다음|다음|이번)주(?:까지|안에|중에?|내로?)$/);
  if (byWeek) return weekDay(today, 5, weeks(byWeek[1]));
  const weekend = w.match(/^(다다음|다음|이번)?주말$/);
  if (weekend) return weekendOf(today, weeks(weekend[1]));
  const week = w.match(/^(다다음|다음)주$/);
  if (week) return weekDay(today, 1, weeks(week[1]));
  if (w === '월말') return monthEnd(today);
  const month = w.match(/^(이번달|이달|다음달)(말일?|까지|안에|중에?|내로?)?$/);
  if (month) {
    const next = month[1] === '다음달';
    if (!month[2]) return next ? plusDays(monthEnd(today), 1) : null;
    return monthEnd(today, next ? 1 : 0);
  }
  return null;
}
