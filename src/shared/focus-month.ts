// 집중 월간 잔디 (#125). 패널 기록 영역에서 달 하나를 날마다 집중한 양으로 칠한다.
// 총 분은 daily_stat.focus_min 에서, 가장 길게 이어 간 집중은 focus_session 에서 읽는다 (shared/beta-stats.ts).
// 계산만 여기에 둔다: 단계, 달 넘기기, 달력 칸 만들기.
import { plusDays, weekdayOf } from './day.ts';

/** 그날의 집중 기록 */
export interface FocusDay {
  day: string;
  /** 그날 집중한 분 합 */
  min: number;
  /** 한 번에 가장 길게 이어 간 집중(분). 기록이 없는 옛 날은 0 */
  longest: number;
}

/**
 * 단계 문턱(분). 1단계 1분부터, 2단계 25분(집중 한 번), 3단계 60분, 4단계 120분.
 * 색만으로 구분하지 않게 칸에 분 숫자와 툴팁을 같이 둔다 (panel/FocusMonth.tsx)
 */
export const FOCUS_STEPS = [1, 25, 60, 120] as const;
export type FocusLevel = 0 | 1 | 2 | 3 | 4;

export function focusLevel(min: number): FocusLevel {
  let level: FocusLevel = 0;
  FOCUS_STEPS.forEach((from, i) => {
    if (min >= from) level = (i + 1) as FocusLevel;
  });
  return level;
}

/** "YYYY-MM" 모양인지 (메인이 받는 값 검사) */
export const isMonth = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export const monthOf = (day: string): string => day.slice(0, 7);

/** 달 넘기기. delta 는 음수도 된다 */
export function shiftMonth(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
}

/** 그 달의 날 수 */
export function daysInMonth(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

export interface MonthCell {
  /** 그리는 쪽 키: 날짜, 빈 칸이면 pad-번호 */
  key: string;
  /** 칸의 날짜. 그 달 밖(앞뒤 빈 칸)이면 null */
  day: string | null;
  min: number;
  longest: number;
  level: FocusLevel;
  /** 아직 안 온 날 */
  future: boolean;
}

/**
 * 달력 칸. 한 줄 7칸, 월요일에 시작하고 (이번 주 칸과 같다) 그 달 밖은 day 가 null 인 빈 칸이다.
 * 긴 집중 기록이 총 분보다 길 수 없으니 longest 는 min 을 넘지 않게 맞춘다
 */
export function monthCells(ym: string, data: readonly FocusDay[], today: string): MonthCell[][] {
  const got = new Map(data.map((d) => [d.day, d]));
  const first = `${ym}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const count = daysInMonth(ym);
  const cells: MonthCell[] = [];
  for (let i = 0; i < lead; i++)
    cells.push({ key: `pad-${i}`, day: null, min: 0, longest: 0, level: 0, future: false });
  for (let i = 0; i < count; i++) {
    const day = plusDays(first, i);
    const r = got.get(day);
    const min = Math.max(0, Math.round(r?.min ?? 0));
    cells.push({
      key: day,
      day,
      min,
      longest: Math.min(min, Math.max(0, Math.round(r?.longest ?? 0))),
      level: focusLevel(min),
      future: day > today,
    });
  }
  while (cells.length % 7 !== 0)
    cells.push({ key: `pad-${cells.length}`, day: null, min: 0, longest: 0, level: 0, future: false });
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 그 달 합계 (분)와 집중한 날 수 */
export function monthTotals(data: readonly FocusDay[]): { min: number; days: number } {
  return { min: data.reduce((s, d) => s + d.min, 0), days: data.filter((d) => d.min > 0).length };
}
