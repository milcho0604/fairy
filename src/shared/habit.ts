// 습관 (2026-10-11). 따로 표를 두지 않고 반복 할 일(repeat, repeat_of)을 습관으로 본다.
// 반복 할 일을 끝내면 다음 회차가 repeat_of 로 앞 회차를 가리키며 생긴다 (todo-store.ts complete). 그 사슬 하나가 습관 하나다.
// 오늘 체크 = 열린 회차 끝내기, 체크 풀기 = 오늘 끝낸 회차 되돌리기. 연속 기록은 achieve.ts habitStreak,
// 잔디 달력은 여기서 센다. 끊겨도 벌은 없다 (기획서 게임 규칙): 화면 글은 다시 시작하자고만 한다.
import { habitStreak, weekStartOf } from './achieve.ts';
import { plusDays, weekdayOf } from './day.ts';
import type { Db } from './db-schema.ts';
import { isRepeat, localDay, type Repeat } from './todo-store.ts';

/** 잔디 달력 주 수 (12주, 패널 폭 360 에 들어간다) */
export const GRASS_WEEKS = 12;

/** 오늘 습관 상태: 했음, 할 차례(오늘이거나 지난 회차), 다음 차례가 뒤(매주의 다른 요일, 평일 습관의 주말) */
export type HabitStatus = 'done' | 'todo' | 'later';

export interface Habit {
  /** 지금 열린 회차 (체크하면 이것을 끝낸다) */
  id: number;
  /** 사슬 첫 회차 id. 회차가 바뀌어도 같다 (화면에서 고른 습관을 기억할 때) */
  rootId: number;
  title: string;
  repeat: Repeat;
  /** 열린 회차 마감일 */
  due: string | null;
  status: HabitStatus;
  /** 오늘 끝낸 회차 (체크 풀기에 쓴다) */
  doneTodayId?: number;
  streak: number;
  /** 지금까지 한 날 수 */
  total: number;
  /** 잔디 달력 기간에 한 날 (오래된 것부터) */
  days: string[];
}

interface Row {
  id: number;
  title: string;
  due: string | null;
  done_at: number | null;
  deleted_at: number | null;
  repeat: string | null;
  repeat_of: number | null;
}

/** 잔디 달력이 시작하는 날: today 가 든 주(일요일 시작)에서 weeks - 1 주 앞 일요일 */
export function grassStart(today: string, weeks = GRASS_WEEKS): string {
  return plusDays(today, -weekdayOf(today) - (weeks - 1) * 7);
}

/** 사슬로 묶는다: 회차마다 첫 회차 id. 사슬이 꼬여(돌아) 있어도 멈춘다 */
export function chainRoots(rows: readonly { id: number; repeat_of: number | null }[]): Map<number, number> {
  const prev = new Map(rows.map((r) => [Number(r.id), r.repeat_of === null ? null : Number(r.repeat_of)]));
  const roots = new Map<number, number>();
  for (const r of rows) {
    let id = Number(r.id);
    const seen = new Set<number>();
    for (;;) {
      const known = roots.get(id);
      if (known !== undefined) {
        id = known;
        break;
      }
      const p = prev.get(id);
      if (p === null || p === undefined || !prev.has(p) || seen.has(p)) break;
      seen.add(id);
      id = p;
    }
    roots.set(Number(r.id), id);
  }
  return roots;
}

/** 사슬 행들로 습관 하나. 열린 반복 회차가 없으면(반복을 껐거나 지웠으면) undefined */
export function habitOf(
  chain: readonly Row[],
  rootId: number,
  today: string,
  restDays: readonly number[],
  day: (ms: number) => string,
): Habit | undefined {
  const head = chain
    .filter((r) => r.done_at === null && r.deleted_at === null && isRepeat(r.repeat))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!head) return undefined;
  const repeat = head.repeat as Repeat;
  const done = chain.filter((r) => r.done_at !== null && r.deleted_at === null);
  const doneDays = new Set(done.map((r) => day(Number(r.done_at))));
  const doneToday = done
    .filter((r) => day(Number(r.done_at)) === today)
    .sort((a, b) => Number(b.done_at) - Number(a.done_at))[0];
  const from = grassStart(today);
  const status: HabitStatus = doneToday ? 'done' : head.due === null || head.due <= today ? 'todo' : 'later';
  return {
    id: Number(head.id),
    rootId,
    title: head.title,
    repeat,
    due: head.due,
    status,
    ...(doneToday ? { doneTodayId: Number(doneToday.id) } : {}),
    streak: habitStreak(doneDays, today, repeat, restDays),
    total: doneDays.size,
    days: [...doneDays].filter((d) => d >= from && d <= today).sort(),
  };
}

/** 습관을 저장 파일에서 읽는다 (반복 할 일 사슬) */
export class HabitStore {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  list(now: number, restDays: readonly number[]): Habit[] {
    const rows = this.#db
      .prepare(
        `select id, title, due, done_at, deleted_at, repeat, repeat_of from todo
         where repeat is not null or repeat_of is not null order by id`,
      )
      .all() as Row[];
    const roots = chainRoots(rows);
    const chains = new Map<number, Row[]>();
    for (const r of rows) {
      const root = roots.get(Number(r.id)) ?? Number(r.id);
      const list = chains.get(root) ?? [];
      list.push(r);
      chains.set(root, list);
    }
    const today = this.#day(now);
    const out: Habit[] = [];
    for (const [root, chain] of chains) {
      const h = habitOf(chain, root, today, restDays, this.#day);
      if (h) out.push(h);
    }
    return out;
  }
}

export interface GrassCell {
  day: string;
  /** 그날 한 습관 수 */
  n: number;
  /** 색 단계 0~4 */
  level: number;
  /** 오늘 뒤 (빈칸) */
  future: boolean;
}

/** 잔디 색 단계. 한 습관만 보면(max 1) 했으면 3, 여럿이면 가장 많이 한 날을 4 로 나눈다 */
export function grassLevel(n: number, max: number): number {
  if (n <= 0) return 0;
  if (max <= 1) return 3;
  return Math.max(1, Math.min(4, Math.ceil((n / max) * 4)));
}

/**
 * GitHub 같은 잔디 달력: 주마다 한 줄(일요일부터 토요일), 오래된 주가 왼쪽. days 는 습관마다 한 날 목록 (같은 날은 센다).
 * max 는 고른 습관 수 (하나면 1). 오늘 뒤 칸은 future
 */
export function grass(
  days: readonly (readonly string[])[],
  today: string,
  max: number,
  weeks = GRASS_WEEKS,
): GrassCell[][] {
  const counts = new Map<string, number>();
  for (const list of days) for (const d of new Set(list)) counts.set(d, (counts.get(d) ?? 0) + 1);
  const start = grassStart(today, weeks);
  const out: GrassCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: GrassCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = plusDays(start, w * 7 + i);
      const n = counts.get(day) ?? 0;
      col.push({ day, n, level: grassLevel(n, max), future: day > today });
    }
    out.push(col);
  }
  return out;
}

/** 이번 주(월요일부터) 한 날 수 */
export function thisWeekCount(days: readonly string[], today: string): number {
  const from = weekStartOf(today);
  return days.filter((d) => d >= from && d <= today).length;
}
