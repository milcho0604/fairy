// 연속 기록과 업적 (v2). 끊겨도 잃는 것은 없다 (기획서 게임 규칙). 업적은 한 번 받으면 끝.
import { plusDays, weekdayOf as weekday } from './day.ts';
import type { Db } from './db-schema.ts';
import { type I18nKey, t } from './i18n/index.ts';
import { localDay } from './todo-store.ts';

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

/** 이름과 힌트는 지금 말로 읽는다 (getter). 화면과 메뉴는 setLang 뒤에 읽는다 */
function ach(key: string, name: I18nKey, hint: I18nKey, test: (f: Facts) => boolean): Achievement {
  return {
    key,
    get name() {
      return t(name);
    },
    get hint() {
      return t(hint);
    },
    test,
  };
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  ach('todo-1', 'achieve.todo1.name', 'achieve.todo1.hint', (f) => f.todosDone >= 1),
  ach('todo-10', 'achieve.todo10.name', 'achieve.todo10.hint', (f) => f.todosDone >= 10),
  ach('todo-100', 'achieve.todo100.name', 'achieve.todo100.hint', (f) => f.todosDone >= 100),
  ach('todo-500', 'achieve.todo500.name', 'achieve.todo500.hint', (f) => f.todosDone >= 500),
  ach('streak-3', 'achieve.streak3.name', 'achieve.streak3.hint', (f) => f.streak >= 3),
  ach('streak-7', 'achieve.streak7.name', 'achieve.streak7.hint', (f) => f.streak >= 7),
  ach('streak-30', 'achieve.streak30.name', 'achieve.streak30.hint', (f) => f.streak >= 30),
  ach('focus-10', 'achieve.focus10.name', 'achieve.focus10.hint', (f) => f.focusSessions >= 10),
  ach('walk-60', 'achieve.walk60.name', 'achieve.walk60.hint', (f) => f.walkMin >= 60),
  ach('friend-100', 'achieve.friend100.name', 'achieve.friend100.hint', (f) => f.affection >= 100),
  ach('friend-600', 'achieve.friend600.name', 'achieve.friend600.hint', (f) => f.affection >= 600),
  ach('house-3', 'achieve.house3.name', 'achieve.house3.hint', (f) => f.houseLevel >= 3),
  ach('chef', 'achieve.chef.name', 'achieve.chef.hint', (f) => f.customFoods >= 1),
  ach('notes-10', 'achieve.notes10.name', 'achieve.notes10.hint', (f) => f.notes >= 10),
  ach('look-10', 'achieve.look10.name', 'achieve.look10.hint', (f) => f.looks >= 10),
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
