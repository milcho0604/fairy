// 마감 칩을 누르면 먼저 나오는 작은 메뉴의 날짜 (#146): 오늘, 내일, 다음 주 월요일. 날짜 고르기는 운영체제 달력

import { plusDays, weekdayOf } from './day.ts';

export type DueChoiceKey = 'today' | 'tomorrow' | 'nextMon';

/** today 다음에 오는 월요일 (오늘이 월요일이면 7일 뒤) */
export function nextMonday(today: string): string {
  const wd = weekdayOf(today);
  return plusDays(today, (8 - wd) % 7 || 7);
}

/** 메뉴에 놓을 날. 일요일은 다음 월요일이 내일이라 겹치므로 뺀다 */
export function dueChoices(today: string): { key: DueChoiceKey; day: string }[] {
  const tomorrow = plusDays(today, 1);
  const mon = nextMonday(today);
  return [
    { key: 'today', day: today },
    { key: 'tomorrow', day: tomorrow },
    ...(mon === tomorrow ? [] : [{ key: 'nextMon' as const, day: mon }]),
  ];
}
