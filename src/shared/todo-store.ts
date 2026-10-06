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
  /** 집중 타이머 한 번 (v1) */
  focus: 5,
  /** 하루에 코인을 받는 집중 횟수 */
  dailyFocusLimit: 8,
} as const;

/** 반복: 매일, 평일(월~금), 매주 같은 요일 */
export type Repeat = 'daily' | 'weekdays' | 'weekly';
export const REPEATS: readonly Repeat[] = ['daily', 'weekdays', 'weekly'];
export const REPEAT_LABEL: Record<Repeat, string> = { daily: '매일', weekdays: '평일', weekly: '매주' };

export function isRepeat(v: unknown): v is Repeat {
  return v === 'daily' || v === 'weekdays' || v === 'weekly';
}

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 일 ~ 6 토

/**
 * 반복 할 일을 끝냈을 때 다음 회차 마감일. 오늘보다 뒤인 가장 가까운 날로 간다.
 * 밀린 회차를 한꺼번에 만들지 않는다 (사흘 밀린 매일 할 일을 끝내면 다음은 내일).
 */
export function nextDue(due: string | null, repeat: Repeat, today: string): string {
  const base = due && due > today ? due : today;
  if (repeat === 'weekly') {
    let next = plusDays(due ?? today, 7);
    while (next <= today) next = plusDays(next, 7);
    return next > base ? next : plusDays(base, 7);
  }
  let next = plusDays(base, 1);
  if (repeat === 'weekdays') while (weekday(next) === 0 || weekday(next) === 6) next = plusDays(next, 1);
  return next;
}

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
  repeat: Repeat | null;
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
  repeat: string | null;
}

const toTodo = (r: Row): Todo => ({
  id: Number(r.id),
  title: r.title,
  due: r.due,
  important: r.important === 1,
  createdAt: Number(r.created_at),
  doneAt: r.done_at === null ? null : Number(r.done_at),
  coins: Number(r.coins),
  repeat: isRepeat(r.repeat) ? r.repeat : null,
});

export class TodoStore {
  #db: Db;
  #day: (ms: number) => string;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
  }

  add(
    input: { title: string; due?: string | null; important?: boolean; repeat?: Repeat | null },
    now: number,
    repeatOf: number | null = null,
  ): Todo {
    const title = input.title.trim();
    if (!title) throw new Error('할 일 제목이 비었다');
    const repeat = isRepeat(input.repeat) ? input.repeat : null;
    // 반복 할 일은 마감이 있어야 다음 회차를 셀 수 있다. 없으면 오늘.
    const due = input.due ?? (repeat ? this.#day(now) : null);
    const r = this.#db
      .prepare(
        'insert into todo (title, due, important, created_at, repeat, repeat_of) values (?, ?, ?, ?, ?, ?)',
      )
      .run(title.slice(0, 200), due, input.important ? 1 : 0, now, repeat, repeatOf);
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

  update(
    id: number,
    patch: { title?: string; due?: string | null; important?: boolean; repeat?: Repeat | null },
  ): Todo | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    const title = patch.title === undefined ? t.title : patch.title.trim().slice(0, 200) || t.title;
    const due = patch.due === undefined ? t.due : patch.due;
    const important = patch.important === undefined ? t.important : patch.important;
    const repeat = patch.repeat === undefined ? t.repeat : isRepeat(patch.repeat) ? patch.repeat : null;
    this.#db
      .prepare('update todo set title = ?, due = ?, important = ?, repeat = ? where id = ?')
      .run(title, repeat && !due ? t.due : due, important ? 1 : 0, repeat, id);
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
      if (t.repeat)
        this.add(
          { title: t.title, important: t.important, repeat: t.repeat, due: nextDue(t.due, t.repeat, day) },
          now,
          id,
        );
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
      // 끝내서 생긴 다음 회차는 걷어 낸다 (아직 손대지 않은 것만).
      this.#db
        .prepare(
          'update todo set deleted_at = ? where repeat_of = ? and done_at is null and deleted_at is null',
        )
        .run(now, id);
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

  /** 밥 주기. 코인이 모자라면 false. 먹이를 고르면(v1 상점) 그 값과 배부름. */
  feed(
    now: number,
    food: { cost: number; gain: number } = { cost: COIN.food, gain: FULLNESS.perFood },
  ): { ok: boolean; fullness: number; balance: number } {
    const current = this.fullness(now);
    if (this.balance() < food.cost) return { ok: false, fullness: current, balance: this.balance() };
    const next = Math.min(100, current + food.gain);
    this.#db.exec('begin');
    try {
      if (food.cost > 0) this.#log(-food.cost, 'food', null, now);
      this.#db.prepare('update pet_state set fullness = ?, fullness_at = ? where id = 1').run(next, now);
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return { ok: true, fullness: next, balance: this.balance() };
  }

  /** 그날 이 이유로 받은 코인 횟수 (하루 상한 셈) */
  coinCount(reason: string, day: string): number {
    return Number(
      (
        this.#db
          .prepare('select count(*) as n from coin_log where day = ? and reason = ?')
          .get(day, reason) as { n: number }
      ).n,
    );
  }

  /** 코인 쓰기 (상점). 모자라면 false 이고 아무것도 안 한다. 잔액은 음수가 되지 않는다 */
  spend(amount: number, reason: string, now: number): boolean {
    if (amount <= 0) return true;
    if (this.balance() < amount) return false;
    this.#log(-amount, reason, null, now);
    return true;
  }

  /** 그 밖의 보상 (화해 보너스, 휴식 권유 따르기). 상한은 부르는 쪽이 본다 */
  reward(amount: number, reason: string, now: number): void {
    if (amount > 0) this.#log(amount, reason, null, now);
  }

  /** 집중 타이머 한 번 끝. 받은 코인 수 (하루 상한을 넘으면 0). */
  rewardFocus(now: number): number {
    const n = Number(
      (
        this.#db
          .prepare(`select count(*) as n from coin_log where day = ? and reason = 'focus'`)
          .get(this.#day(now)) as { n: number }
      ).n,
    );
    if (n >= COIN.dailyFocusLimit) return 0;
    this.#log(COIN.focus, 'focus', null, now);
    return COIN.focus;
  }

  #log(amount: number, reason: string, refId: number | null, now: number) {
    this.#db
      .prepare('insert into coin_log (amount, reason, ref_id, day, at) values (?, ?, ?, ?, ?)')
      .run(amount, reason, refId, this.#day(now), now);
  }
}
