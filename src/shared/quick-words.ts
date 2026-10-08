// 빠른 입력의 영어 낱말 (F). 할 일(quick-add.ts)과 일정(event-store.ts)이 같이 쓴다.
// 낱말은 늘 통째로만 읽는다: "sundays", "Monica", "monday-ish" 는 요일이 아니다.

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
