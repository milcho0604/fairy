// 할 일, 코인 장부, 배부름 (P2-03, P2-05, P2-06). 기획서 "게임 규칙".
import type { Db } from './db-schema.ts';

export const COIN = {
  /** 할 일 하나 */
  todo: 10,
  /** 마감 전(마감일 당일 포함)에 끝냄 */
  early: 5,
  /** 하루에 코인을 받는 할 일 수 */
  dailyTodoLimit: 20,
  /** 기본 먹이 */
  food: 5,
} as const;

export const FULLNESS = {
  start: 80,
  perFood: 20,
  /** 한 시간에 줄어드는 양 */
  perHour: 2,
  /** 이보다 낮으면 배고픈 표정 */
  hungry: 30,
} as const;

export interface Todo {
  id: number;
  title: string;
  due: string | null;
  important: boolean;
  createdAt: number;
  doneAt: number | null;
  coins: number;
}

/** ms 시각의 현지 날짜 YYYY-MM-DD. 하루 상한, 마감 판단에 쓴다. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Row {
  id: number;
  title: string;
  due: string | null;
  important: number;
  created_at: number;
  done_at: number | null;
  coins: number;
}

const toTodo = (r: Row): Todo => ({
  id: Number(r.id),
  title: r.title,
  due: r.due,
  important: r.important === 1,
  createdAt: Number(r.created_at),
  doneAt: r.done_at === null ? null : Number(r.done_at),
  coins: Number(r.coins),
});

export class TodoStore {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  add(input: { title: string; due?: string | null; important?: boolean }, now: number): Todo {
    const title = input.title.trim();
    if (!title) throw new Error('할 일 제목이 비었다');
    const r = this.#db
      .prepare('insert into todo (title, due, important, created_at) values (?, ?, ?, ?)')
      .run(title.slice(0, 200), input.due ?? null, input.important ? 1 : 0, now);
    return this.get(Number(r.lastInsertRowid)) as Todo;
  }

  get(id: number): Todo | undefined {
    const r = this.#db.prepare('select * from todo where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? toTodo(r) : undefined;
  }

  /**
   * 화면에 보일 목록: 안 끝난 것(중요 먼저, 마감 빠른 순, 마감 없는 것은 뒤, 오래된 순)과 오늘 끝낸 것.
   */
  list(now: number): { open: Todo[]; doneToday: Todo[] } {
    const open = (
      this.#db
        .prepare(
          `select * from todo where done_at is null and deleted_at is null
           order by important desc, due is null, due, created_at`,
        )
        .all() as Row[]
    ).map(toTodo);
    const today = this.#day(now);
    const done = (
      this.#db
        .prepare('select * from todo where done_at is not null and deleted_at is null order by done_at desc')
        .all() as Row[]
    )
      .map(toTodo)
      .filter((t) => t.doneAt !== null && this.#day(t.doneAt) === today);
    return { open, doneToday: done };
  }

  update(id: number, patch: { title?: string; due?: string | null; important?: boolean }): Todo | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    const title = patch.title === undefined ? t.title : patch.title.trim().slice(0, 200) || t.title;
    const due = patch.due === undefined ? t.due : patch.due;
    const important = patch.important === undefined ? t.important : patch.important;
    this.#db
      .prepare('update todo set title = ?, due = ?, important = ? where id = ?')
      .run(title, due, important ? 1 : 0, id);
    return this.get(id);
  }

  /** 지운 할 일은 목록에서만 빠진다. 받은 코인은 그대로 둔다 (지우기는 되돌리기가 아니다). */
  remove(id: number, now: number): void {
    this.#db.prepare('update todo set deleted_at = ? where id = ?').run(now, id);
  }

  /** 끝내기. 받은 코인 수를 돌려준다 (이미 끝났으면 0). */
  complete(id: number, now: number): number {
    const t = this.get(id);
    if (!t || t.doneAt !== null) return 0;
    const day = this.#day(now);
    const rewardedToday = Number(
      (
        this.#db.prepare(`select count(*) as n from coin_log where day = ? and reason = 'todo'`).get(day) as {
          n: number;
        }
      ).n,
    );
    let coins = 0;
    this.#db.exec('begin');
    try {
      if (rewardedToday < COIN.dailyTodoLimit) {
        this.#log(COIN.todo, 'todo', id, now);
        coins += COIN.todo;
        if (t.due && day <= t.due) {
          this.#log(COIN.early, 'early', id, now);
          coins += COIN.early;
        }
      }
      this.#db.prepare('update todo set done_at = ?, coins = ? where id = ?').run(now, coins, id);
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return coins;
  }

  /** 끝낸 것 되돌리기. 받은 코인을 회수하되 이미 써서 모자라면 0 에서 멈춘다. 회수한 코인 수를 돌려준다. */
  undo(id: number, now: number): number {
    const t = this.get(id);
    if (!t || t.doneAt === null) return 0;
    const back = Math.min(t.coins, this.balance());
    this.#db.exec('begin');
    try {
      if (back > 0) this.#log(-back, 'undo', id, now);
      this.#db.prepare('update todo set done_at = null, coins = 0 where id = ?').run(id);
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return back;
  }

  /** 잔액은 장부 합계로만 계산한다 (따로 적어 두면 어긋날 수 있다). */
  balance(): number {
    return Number(
      (this.#db.prepare('select coalesce(sum(amount), 0) as s from coin_log').get() as { s: number }).s,
    );
  }

  /** 지금 배부름 (0~100). 마지막으로 적은 값에서 흐른 시간만큼 줄인다. */
  fullness(now: number): number {
    const r = this.#db.prepare('select fullness, fullness_at from pet_state where id = 1').get() as
      | { fullness: number; fullness_at: number }
      | undefined;
    if (!r) {
      this.#db
        .prepare('insert into pet_state (id, fullness, fullness_at) values (1, ?, ?)')
        .run(FULLNESS.start, now);
      return FULLNESS.start;
    }
    const hours = Math.max(0, now - Number(r.fullness_at)) / 3_600_000;
    return Math.max(0, Math.min(100, r.fullness - hours * FULLNESS.perHour));
  }

  /** 밥 주기. 코인이 모자라면 false. */
  feed(now: number): { ok: boolean; fullness: number; balance: number } {
    const current = this.fullness(now);
    if (this.balance() < COIN.food) return { ok: false, fullness: current, balance: this.balance() };
    const next = Math.min(100, current + FULLNESS.perFood);
    this.#db.exec('begin');
    try {
      this.#log(-COIN.food, 'food', null, now);
      this.#db.prepare('update pet_state set fullness = ?, fullness_at = ? where id = 1').run(next, now);
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return { ok: true, fullness: next, balance: this.balance() };
  }

  #log(amount: number, reason: string, refId: number | null, now: number) {
    this.#db
      .prepare('insert into coin_log (amount, reason, ref_id, day, at) values (?, ?, ?, ?, ?)')
      .run(amount, reason, refId, this.#day(now), now);
  }
}
