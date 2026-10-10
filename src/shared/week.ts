// 이번 주 돌아보기 (2026-10-10). 오늘 탭 "이번 주" 와 금요일 회고 한 줄, MCP today_overview 가 쓴다.
// 주는 월요일에 시작한다. 지난주와는 같은 요일까지만 견준다 (수요일이면 지난주 월~수와).
import { plusDays, weekdayOf } from './day.ts';

export interface WeekDay {
  day: string;
  done: number;
  focusMin: number;
  /** 아직 안 온 날 (막대를 비워 그린다) */
  future: boolean;
}

export interface WeekSummary {
  /** 이번 주 월~일 */
  days: WeekDay[];
  done: number;
  focusMin: number;
  /** 지난주 같은 요일까지 끝낸 수 */
  lastDone: number;
  /** 내일부터 7일 안에 마감인 안 끝낸 할 일 수 */
  dueSoon: number;
}

/** 그 주 월요일 */
export function weekStart(day: string): string {
  return plusDays(day, -((weekdayOf(day) + 6) % 7));
}

/** 이번 주와 지난주 같은 요일까지의 날짜들 (기록을 한 번에 읽으려고) */
export function weekDays(today: string): { thisWeek: string[]; lastWeek: string[] } {
  const mon = weekStart(today);
  const upTo = (weekdayOf(today) + 6) % 7;
  return {
    thisWeek: Array.from({ length: 7 }, (_, i) => plusDays(mon, i)),
    lastWeek: Array.from({ length: upTo + 1 }, (_, i) => plusDays(mon, i - 7)),
  };
}

export function weekSummary(
  today: string,
  facts: (days: readonly string[]) => readonly { day: string; done: number; focusMin: number }[],
  open: readonly { due: string | null }[],
): WeekSummary {
  const { thisWeek, lastWeek } = weekDays(today);
  const past = thisWeek.filter((d) => d <= today);
  const got = new Map(facts([...past, ...lastWeek]).map((f) => [f.day, f]));
  const days = thisWeek.map((day) => ({
    day,
    done: got.get(day)?.done ?? 0,
    focusMin: got.get(day)?.focusMin ?? 0,
    future: day > today,
  }));
  const until = plusDays(today, 7);
  return {
    days,
    done: days.reduce((s, d) => s + d.done, 0),
    focusMin: days.reduce((s, d) => s + d.focusMin, 0),
    lastDone: lastWeek.reduce((s, d) => s + (got.get(d)?.done ?? 0), 0),
    dueSoon: open.filter((t) => t.due !== null && t.due > today && t.due <= until).length,
  };
}
