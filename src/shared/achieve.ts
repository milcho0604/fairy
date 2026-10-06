// 연속 기록과 업적 (v2). 끊겨도 잃는 것은 없다 (기획서 게임 규칙). 업적은 한 번 받으면 끝.
import type { Db } from './db-schema.ts';
import { localDay } from './todo-store.ts';

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * 연속 기록: 할 일을 하나 이상 끝낸 날이 이어진 날 수. 쉬는 날은 건너뛰어도 끊기지 않는다.
 * 오늘 아직 안 끝냈으면 어제까지로 센다 (오늘 하루가 남았으니).
 */
export function streak(doneDays: ReadonlySet<string>, today: string, restDays: readonly number[]): number {
  let day = doneDays.has(today) ? today : plusDays(today, -1);
  let n = 0;
  for (let guard = 0; guard < 3660; guard++) {
    if (doneDays.has(day)) n++;
    else if (!restDays.includes(weekday(day))) break;
    day = plusDays(day, -1);
  }
  return n;
}

export interface Facts {
  todosDone: number;
  streak: number;
  focusSessions: number;
  walkMin: number;
  affection: number;
  houseLevel: number;
  customFoods: number;
  notes: number;
  looks: number;
}

export interface Achievement {
  key: string;
  name: string;
  hint: string;
  test: (f: Facts) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { key: 'todo-1', name: '첫 걸음', hint: '할 일 하나 끝내기', test: (f) => f.todosDone >= 1 },
  { key: 'todo-10', name: '열 개째', hint: '할 일 10개 끝내기', test: (f) => f.todosDone >= 10 },
  { key: 'todo-100', name: '백 개째', hint: '할 일 100개 끝내기', test: (f) => f.todosDone >= 100 },
  { key: 'todo-500', name: '할 일 장인', hint: '할 일 500개 끝내기', test: (f) => f.todosDone >= 500 },
  { key: 'streak-3', name: '사흘 연속', hint: '3일 이어서 할 일 끝내기', test: (f) => f.streak >= 3 },
  { key: 'streak-7', name: '일주일 연속', hint: '7일 이어서 할 일 끝내기', test: (f) => f.streak >= 7 },
  { key: 'streak-30', name: '한 달 연속', hint: '30일 이어서 할 일 끝내기', test: (f) => f.streak >= 30 },
  { key: 'focus-10', name: '집중력', hint: '집중 타이머 10번', test: (f) => f.focusSessions >= 10 },
  { key: 'walk-60', name: '산책 친구', hint: '산책 60분', test: (f) => f.walkMin >= 60 },
  { key: 'friend-100', name: '친해졌다', hint: '친밀도 100', test: (f) => f.affection >= 100 },
  { key: 'friend-600', name: '단짝', hint: '친밀도 600', test: (f) => f.affection >= 600 },
  { key: 'house-3', name: '마당 있는 집', hint: '집 3단계', test: (f) => f.houseLevel >= 3 },
  { key: 'chef', name: '요리사', hint: '커스텀 먹이 만들기', test: (f) => f.customFoods >= 1 },
  { key: 'notes-10', name: '메모광', hint: '메모 10개', test: (f) => f.notes >= 10 },
  { key: 'look-10', name: '같이 보는 사이', hint: '같이 보기 10번', test: (f) => f.looks >= 10 },
];

export class AchievementStore {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  /** 할 일을 끝낸 날들 (되돌린 것, 지운 것 빼고) */
  doneDays(): Set<string> {
    const rows = this.#db
      .prepare('select done_at from todo where done_at is not null and deleted_at is null')
      .all() as { done_at: number }[];
    return new Set(rows.map((r) => this.#day(Number(r.done_at))));
  }

  /** 업적 판단에 쓰는 사실들 중 저장 파일에서 셀 수 있는 것 (친밀도, 집은 부르는 쪽이 넣는다) */
  facts(now: number, restDays: readonly number[], extra: Pick<Facts, 'affection' | 'houseLevel'>): Facts {
    const one = (sql: string) => Number((this.#db.prepare(sql).get() as { n: number | null }).n ?? 0);
    return {
      todosDone: one('select count(*) as n from todo where done_at is not null and deleted_at is null'),
      streak: streak(this.doneDays(), this.#day(now), restDays),
      focusSessions: one(`select count(*) as n from coin_log where reason = 'focus'`),
      walkMin: one('select sum(walk_min) as n from daily_stat'),
      customFoods: one(`select count(*) as n from coin_log where reason = 'custom-food'`),
      notes: one('select count(*) as n from note where deleted_at is null'),
      looks: one('select sum(look_count) as n from daily_stat'),
      ...extra,
    };
  }

  got(): Map<string, number> {
    const rows = this.#db.prepare('select key, at from achievement').all() as { key: string; at: number }[];
    return new Map(rows.map((r) => [r.key, Number(r.at)]));
  }

  /** 새로 받은 업적을 적고 돌려준다 */
  check(facts: Facts, now: number): Achievement[] {
    const have = this.got();
    const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.key) && a.test(facts));
    for (const a of fresh)
      this.#db.prepare('insert or ignore into achievement (key, at) values (?, ?)').run(a.key, now);
    return fresh;
  }
}
