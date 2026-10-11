// 할 일, 코인 장부, 배부름 (P2-03, P2-05, P2-06). 기획서 "게임 규칙".
import { plusDays, weekdayOf as weekday } from './day.ts';
import type { Db } from './db-schema.ts';
import { FOCUS, focusCoins } from './focus.ts';
import { t } from './i18n/index.ts';
import { type Anchor, atLocal, DEFAULT_REMINDS, normalizeReminds, REMIND_MAX_MIN } from './remind.ts';
import { ReminderStore } from './reminder-store.ts';

export const COIN = {
  /** 할 일 하나 */
  todo: 10,
  /** 마감 전(마감일 당일 포함)에 끝냄 */
  early: 5,
  /** 하루에 코인을 받는 할 일 수 */
  dailyTodoLimit: 20,
  /** 기본 먹이 */
  food: 5,
  /** 집중 타이머 한 번 (v1, 25분 기준. 길이를 고르면 분에 비례: focusCoins) */
  focus: 5,
  /** 하루에 코인을 받는 집중 횟수 (25분 기준). 하루 집중 코인 상한 = focus x 이 값 = 40 */
  dailyFocusLimit: 8,
} as const;

/** 반복: 매일, 평일(월~금), 매주 같은 요일 */
export type Repeat = 'daily' | 'weekdays' | 'weekly';
export const REPEATS: readonly Repeat[] = ['daily', 'weekdays', 'weekly'];
/** 지금 말로 읽는다 (getter) */
export const REPEAT_LABEL: Readonly<Record<Repeat, string>> = {
  get daily() {
    return t('panel.repeat.daily');
  },
  get weekdays() {
    return t('panel.repeat.weekdays');
  },
  get weekly() {
    return t('panel.repeat.weekly');
  },
};

export function isRepeat(v: unknown): v is Repeat {
  return v === 'daily' || v === 'weekdays' || v === 'weekly';
}

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
  /** 마감 시각 (하루 안의 분, 현지). 없으면 마감일만 (8판) */
  dueMin: number | null;
  /**
   * 미리 알림 (8판), 이른 것부터. 마감 시각이 있으면 그 시각 몇 분 전, 없으면 마감일 0시 몇 분 전
   * (240 = 전날 저녁 8시, -540 = 당일 아침 9시). 마감일이 없으면 울리지 않는다
   */
  reminds: number[];
  /** 단계 (9판 체크리스트), 위에서부터. 없으면 빈 목록 */
  steps: TodoStep[];
}

/** 할 일 단계 하나 (9판) */
export interface TodoStep {
  id: number;
  title: string;
  done: boolean;
}

/** 할 일 하나에 넣을 수 있는 단계 수 */
export const STEP_MAX = 30;
/** 단계 제목 길이 */
export const STEP_TITLE_MAX = 200;

/** 단계 진행: 끝낸 수와 전체 수. 단계가 없으면 undefined */
export function stepProgress(steps: readonly TodoStep[]): { done: number; total: number } | undefined {
  if (steps.length === 0) return undefined;
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** 하루 안의 분으로 쓸 수 있는 값인지 (0~1439) */
export const isDueMin = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60;

/** 할 일의 알림 기준: 마감일이 없으면 없음, 시각이 있으면 그 시각, 없으면 마감일 */
export function todoAnchor(todo: { due: string | null; dueMin: number | null }): Anchor | null {
  if (!todo.due) return null;
  return todo.dueMin === null
    ? { kind: 'day', day: todo.due }
    : { kind: 'time', at: atLocal(todo.due, todo.dueMin) };
}

const defaultTodoReminds = (dueMin: number | null): number[] => [
  ...(dueMin === null ? DEFAULT_REMINDS.todo : DEFAULT_REMINDS.todoTimed),
];

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
  due_min?: number | null;
}

interface StepRow {
  id: number;
  todo_id: number;
  title: string;
  done: number;
}

const toTodo = (r: Row, reminds: number[] = [], steps: TodoStep[] = []): Todo => ({
  id: Number(r.id),
  title: r.title,
  due: r.due,
  important: r.important === 1,
  createdAt: Number(r.created_at),
  doneAt: r.done_at === null ? null : Number(r.done_at),
  coins: Number(r.coins),
  repeat: isRepeat(r.repeat) ? r.repeat : null,
  dueMin: r.due && isDueMin(Number(r.due_min ?? Number.NaN)) ? Number(r.due_min) : null,
  reminds,
  steps,
});

export class TodoStore {
  #db: Db;
  #day: (ms: number) => string;
  #reminders: ReminderStore;

  constructor(db: Db, day: (ms: number) => string = localDay) {
    this.#db = db;
    this.#day = day;
    this.#reminders = new ReminderStore(db, 'todo');
  }

  #withReminds(rows: readonly Row[], marks = this.#reminders.many(rows.map((r) => Number(r.id)))): Todo[] {
    const steps = this.#stepsOf(rows.map((r) => Number(r.id)));
    return rows.map((r) =>
      toTodo(
        r,
        (marks.get(Number(r.id)) ?? []).map((m) => m.before),
        steps.get(Number(r.id)) ?? [],
      ),
    );
  }

  /** 할 일 id 들의 단계를 한 번에 읽는다 */
  #stepsOf(ids: readonly number[]): Map<number, TodoStep[]> {
    const out = new Map<number, TodoStep[]>();
    if (ids.length === 0) return out;
    // SQLite 인자 상한(999 등)에 걸리지 않게 나눠 읽는다
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const rows = this.#db
        .prepare(
          `select id, todo_id, title, done from todo_step where todo_id in (${part.map(() => '?').join(',')})
           order by todo_id, ord, id`,
        )
        .all(...part) as StepRow[];
      for (const r of rows) {
        const list = out.get(Number(r.todo_id)) ?? [];
        list.push({ id: Number(r.id), title: r.title, done: Number(r.done) === 1 });
        out.set(Number(r.todo_id), list);
      }
    }
    return out;
  }

  /** 단계 더하기 (맨 아래). 할 일이 없거나 끝났거나 단계가 꽉 찼거나 제목이 비면 undefined */
  addStep(todoId: number, title: string, now: number): TodoStep | undefined {
    const text = title.trim().slice(0, STEP_TITLE_MAX);
    const todo = this.get(todoId);
    if (!text || !todo || todo.doneAt !== null || todo.steps.length >= STEP_MAX) return undefined;
    const ord =
      Number(
        (
          this.#db
            .prepare('select coalesce(max(ord), 0) as m from todo_step where todo_id = ?')
            .get(todoId) as {
            m: number;
          }
        ).m,
      ) + 1;
    const r = this.#db
      .prepare('insert into todo_step (todo_id, title, done, ord, created_at) values (?, ?, 0, ?, ?)')
      .run(todoId, text, ord, now);
    return { id: Number(r.lastInsertRowid), title: text, done: false };
  }

  /** 여러 단계를 한 번에 (AI 가 쪼갠 단계, 반복 다음 회차). 넣은 수 */
  addSteps(todoId: number, titles: readonly string[], now: number): number {
    let n = 0;
    for (const title of titles) if (this.addStep(todoId, title, now)) n++;
    return n;
  }

  /** 단계 체크와 해제. done 을 안 주면 뒤집는다. 바뀐 단계 (없으면 undefined) */
  toggleStep(stepId: number, done?: boolean): TodoStep | undefined {
    const r = this.#db.prepare('select id, todo_id, title, done from todo_step where id = ?').get(stepId) as
      | StepRow
      | undefined;
    if (!r) return undefined;
    const next = done === undefined ? Number(r.done) !== 1 : done;
    this.#db.prepare('update todo_step set done = ? where id = ?').run(next ? 1 : 0, stepId);
    return { id: Number(r.id), title: r.title, done: next };
  }

  /** 단계 제목 고치기. 비우면 그대로 둔다 */
  renameStep(stepId: number, title: string): void {
    const text = title.trim().slice(0, STEP_TITLE_MAX);
    if (text) this.#db.prepare('update todo_step set title = ? where id = ?').run(text, stepId);
  }

  removeStep(stepId: number): void {
    this.#db.prepare('delete from todo_step where id = ?').run(stepId);
  }

  /** 단계가 속한 할 일 id */
  stepOwner(stepId: number): number | undefined {
    const r = this.#db.prepare('select todo_id from todo_step where id = ?').get(stepId) as
      | { todo_id: number }
      | undefined;
    return r ? Number(r.todo_id) : undefined;
  }

  add(
    input: {
      title: string;
      due?: string | null;
      important?: boolean;
      repeat?: Repeat | null;
      /** 마감 시각 (하루 안의 분). 마감일이 없으면 버린다 */
      dueMin?: number | null;
      /** 미리 알림. 없으면 기본 (마감일만: 전날 저녁 8시, 시각까지: 하루 전과 1시간 전) */
      reminds?: readonly number[];
    },
    now: number,
    repeatOf: number | null = null,
  ): Todo {
    const title = input.title.trim();
    if (!title) throw new Error('할 일 제목이 비었다');
    const repeat = isRepeat(input.repeat) ? input.repeat : null;
    // 반복 할 일은 마감이 있어야 다음 회차를 셀 수 있다. 없으면 오늘.
    const due = input.due ?? (repeat ? this.#day(now) : null);
    const dueMin = due && isDueMin(input.dueMin) ? input.dueMin : null;
    const r = this.#db
      .prepare(
        'insert into todo (title, due, important, created_at, repeat, repeat_of, due_min) values (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(title.slice(0, 200), due, input.important ? 1 : 0, now, repeat, repeatOf, dueMin);
    const id = Number(r.lastInsertRowid);
    const reminds = input.reminds
      ? normalizeReminds(input.reminds, dueMin === null)
      : defaultTodoReminds(dueMin);
    this.#reminders.set(id, reminds, todoAnchor({ due, dueMin }), { now, reset: true });
    return this.get(id) as Todo;
  }

  get(id: number): Todo | undefined {
    const r = this.#db.prepare('select * from todo where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? this.#withReminds([r])[0] : undefined;
  }

  /**
   * 화면에 보일 목록: 안 끝난 것(중요 먼저, 마감 빠른 순, 마감 없는 것은 뒤, 오래된 순)과 오늘 끝낸 것.
   */
  list(now: number): { open: Todo[]; doneToday: Todo[] } {
    const open = this.#withReminds(
      this.#db
        .prepare(
          `select * from todo where done_at is null and deleted_at is null
           order by important desc, due is null, due, due_min is not null, due_min, created_at`,
        )
        .all() as Row[],
    );
    const today = this.#day(now);
    // 오늘 끝낸 것만 고른 뒤에 단계를 붙인다 (끝낸 할 일이 수천 개여도 단계는 오늘 것만 읽게)
    const doneRows = (
      this.#db
        .prepare(
          'select * from todo where done_at is not null and deleted_at is null and done_at >= ? order by done_at desc',
        )
        .all(now - 36 * 3_600_000) as Row[]
    ).filter((r) => r.done_at !== null && this.#day(Number(r.done_at)) === today);
    const steps = this.#stepsOf(doneRows.map((r) => Number(r.id)));
    const done = doneRows.map((r) => toTodo(r, [], steps.get(Number(r.id)) ?? []));
    return { open, doneToday: done };
  }

  /**
   * 고치기. 마감일이나 마감 시각을 바꾸면 알림 표시를 지워 다시 알린다. 마감 시각을 새로 넣거나 빼면(날짜만과 시각 사이)
   * 알림을 주지 않았을 때 그쪽 기본으로 (날짜 기준 "전날 저녁 8시" 240 은 시각 기준에서 "4시간 전"이 된다).
   * now 를 주면(패널) 새로 건 알림 중 이미 지난 것은 넘긴 것으로 적는다
   */
  update(
    id: number,
    patch: {
      title?: string;
      due?: string | null;
      important?: boolean;
      repeat?: Repeat | null;
      dueMin?: number | null;
      reminds?: readonly number[];
    },
    now?: number,
  ): Todo | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    const title = patch.title === undefined ? t.title : patch.title.trim().slice(0, 200) || t.title;
    const important = patch.important === undefined ? t.important : patch.important;
    const repeat = patch.repeat === undefined ? t.repeat : isRepeat(patch.repeat) ? patch.repeat : null;
    const asked = patch.due === undefined ? t.due : patch.due;
    const due = repeat && !asked ? t.due : asked;
    // 마감일을 지우면 시각도 지운다
    const wantMin = patch.dueMin === undefined ? t.dueMin : isDueMin(patch.dueMin) ? patch.dueMin : null;
    const dueMin = due ? wantMin : null;
    // 마감을 바꾸면 매주 요일 기억(repeat_anchor)을 버린다: 사용자가 고른 날이 새 요일이다
    this.#db
      .prepare(
        `update todo set title = ?, due = ?, important = ?, repeat = ?, due_min = ?,
         repeat_anchor = case when ? then null else repeat_anchor end where id = ?`,
      )
      .run(title, due, important ? 1 : 0, repeat, dueMin, due !== t.due || repeat !== t.repeat ? 1 : 0, id);
    const flipped = (dueMin === null) !== (t.dueMin === null);
    const reminds = patch.reminds
      ? normalizeReminds(patch.reminds, dueMin === null)
      : flipped
        ? defaultTodoReminds(dueMin)
        : t.reminds;
    const moved = due !== t.due || dueMin !== t.dueMin;
    if (moved || reminds.join() !== t.reminds.join())
      this.#reminders.set(id, reminds, todoAnchor({ due, dueMin }), {
        ...(now === undefined ? {} : { now }),
        reset: moved,
      });
    return this.get(id);
  }

  /**
   * 지난 마감(today 전)인 안 끝낸 할 일을 today 로 옮긴다. 옮긴 것과 원래 마감을 돌려준다 (되돌리기용).
   * now 를 넘겨 옮긴 뒤 이미 지난 알림(전날 저녁 8시)은 말없이 넘긴다.
   * 매주 반복은 원래 마감(repeat_anchor)을 기억해 끝내면 다음 회차가 원래 요일로 간다
   */
  moveOverdue(today: string, now: number): { id: number; due: string | null }[] {
    const late = this.list(now).open.filter((todo) => todo.due !== null && todo.due < today);
    if (late.length === 0) return [];
    this.#db.exec('begin');
    try {
      for (const todo of late) {
        const anchor = todo.repeat === 'weekly' ? (this.#repeatAnchor(todo.id) ?? todo.due) : null;
        this.update(todo.id, { due: today }, now);
        if (anchor) this.#db.prepare('update todo set repeat_anchor = ? where id = ?').run(anchor, todo.id);
      }
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return late.map((todo) => ({ id: todo.id, due: todo.due }));
  }

  /**
   * 지금 알릴 할 일: 안 끝났고 마감일이 있으며 알림 하나가 울릴 때가 된 것.
   * 마감일만 있으면 마감일이 끝나기 전까지, 시각이 있으면 시각 5분 뒤까지 (지난 마감은 알리지 않는다)
   */
  dueReminders(now: number): Todo[] {
    const rows = this.#db
      .prepare(
        `select * from todo t where done_at is null and deleted_at is null and due is not null
         and due >= ? and due <= ?
         and exists (select 1 from reminder r where r.kind = 'todo' and r.ref_id = t.id and r.notified_at is null)
         order by due, due_min, id`,
      )
      .all(this.#day(now - 86_400_000), this.#day(now + REMIND_MAX_MIN * 60_000 + 2 * 86_400_000)) as Row[];
    // 알림 표시는 한 번에 읽는다 (예전에는 할 일마다 다시 읽었다). 쓸모없어진 알림은 넘긴 것으로 적는다 (sweep)
    const marks = this.#reminders.many(rows.map((r) => Number(r.id)));
    const list = this.#withReminds(rows, marks);
    const items = list.flatMap((todo) => {
      const anchor = todoAnchor(todo);
      return anchor ? [{ id: todo.id, anchor }] : [];
    });
    const speak = this.#reminders.sweep(items, marks, now);
    return list.filter((todo) => speak.has(todo.id));
  }

  /** 알렸다: 울릴 때가 지난 알림을 다 알린 것으로 (늦었으면 곧 올 것까지) */
  markNotified(id: number, now: number): void {
    const todo = this.get(id);
    const anchor = todo ? todoAnchor(todo) : null;
    if (anchor) this.#reminders.markNotified(id, anchor, now);
  }

  /** from 뒤로 미리 알림을 말한 할 일 id (오늘 알림으로 말한 것은 오후 마감 알림에서 뺀다) */
  remindedSince(from: number): Set<number> {
    return this.#reminders.spokenSince(from);
  }

  /** 지운 할 일은 목록에서만 빠진다. 받은 코인은 그대로 둔다 (지우기는 되돌리기가 아니다). */
  remove(id: number, now: number): void {
    this.#db.prepare('update todo set deleted_at = ? where id = ?').run(now, id);
  }

  /** 지운 것 되살리기 (지우고 몇 초 안에 되돌리기) */
  restore(id: number): void {
    this.#db.prepare('update todo set deleted_at = null where id = ?').run(id);
  }

  /** 지난 마감 옮기기가 기억한 매주 할 일의 원래 마감 */
  #repeatAnchor(id: number): string | null {
    const r = this.#db.prepare('select repeat_anchor from todo where id = ?').get(id) as
      | { repeat_anchor: string | null }
      | undefined;
    return r?.repeat_anchor ?? null;
  }

  /**
   * 끝내기. 받은 코인 수를 돌려준다 (이미 끝났으면 0).
   * 전에 끝내고 받은 코인을 되돌리기로 다 되받지 못했으면(그사이 써서) 그만큼 덜 준다: 끝내기, 쓰기, 되돌리기, 끝내기를
   * 되풀이해 코인을 찍어 내지 못하게. 하루 상한은 코인을 받은 할 일 수로 센다 (같은 할 일을 다시 끝내도 하나)
   */
  complete(id: number, now: number): number {
    const t = this.get(id);
    if (!t || t.doneAt !== null) return 0;
    const day = this.#day(now);
    const rewardedToday = Number(
      (
        this.#db
          .prepare(
            `select count(distinct ref_id) as n from coin_log where day = ? and reason = 'todo' and ref_id is not ? `,
          )
          .get(day, id) as { n: number }
      ).n,
    );
    // 이 할 일로 받고 아직 되받지 않은 코인 (받은 것 - 되돌리기로 되받은 것)
    const kept = Number(
      (
        this.#db
          .prepare(
            `select coalesce(sum(amount), 0) as s from coin_log where ref_id = ? and reason in ('todo', 'early', 'undo')`,
          )
          .get(id) as { s: number }
      ).s,
    );
    let coins = 0;
    this.#db.exec('begin');
    try {
      if (rewardedToday < COIN.dailyTodoLimit) {
        const early = t.due !== null && day <= t.due ? COIN.early : 0;
        let owed = Math.max(0, COIN.todo + early - Math.max(0, kept));
        const base = Math.min(owed, COIN.todo);
        if (base > 0) this.#log(base, 'todo', id, now);
        owed -= base;
        if (owed > 0) this.#log(owed, 'early', id, now);
        coins = base + owed;
      }
      this.#db.prepare('update todo set done_at = ?, coins = ? where id = ?').run(now, coins, id);
      // 다음 회차도 같은 마감 시각과 같은 알림 (지난 알림은 넘긴다)
      if (t.repeat) {
        const next = this.add(
          {
            title: t.title,
            important: t.important,
            repeat: t.repeat,
            due: nextDue(t.repeat === 'weekly' ? (this.#repeatAnchor(id) ?? t.due) : t.due, t.repeat, day),
            dueMin: t.dueMin,
            reminds: t.reminds,
          },
          now,
          id,
        );
        // 단계도 안 한 채로 옮겨 적는다 (매일 아침 루틴 체크리스트)
        this.addSteps(
          next.id,
          t.steps.map((st) => st.title),
          now,
        );
      }
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
      // 끝내서 생긴 다음 회차는 걷어 낸다 (아직 손대지 않은 것만. 단계를 하나라도 체크했으면 손댄 것이라 둔다).
      this.#db
        .prepare(
          `update todo set deleted_at = ? where repeat_of = ? and done_at is null and deleted_at is null
           and not exists (select 1 from todo_step where todo_step.todo_id = todo.id and todo_step.done = 1)`,
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
  ): { ok: boolean; fullness: number; balance: number; full?: boolean } {
    const current = this.fullness(now);
    // 배가 꽉 찼으면 코인만 받고 아무것도 안 되니 주지 않는다
    if (current >= 99.5) return { ok: false, full: true, fullness: current, balance: this.balance() };
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
  /** 집중을 끝냈다. 분에 비례한 코인, 하루 집중 코인 상한(40)을 넘지 않게 */
  rewardFocus(now: number, minutes: number = FOCUS.focusMin): number {
    const got = Number(
      (
        this.#db
          .prepare(`select coalesce(sum(amount), 0) as n from coin_log where day = ? and reason = 'focus'`)
          .get(this.#day(now)) as { n: number }
      ).n,
    );
    const coins = Math.min(focusCoins(minutes), COIN.focus * COIN.dailyFocusLimit - got);
    if (coins <= 0) return 0;
    this.#log(coins, 'focus', null, now);
    return coins;
  }

  #log(amount: number, reason: string, refId: number | null, now: number) {
    this.#db
      .prepare('insert into coin_log (amount, reason, ref_id, day, at) values (?, ?, ?, ?, ?)')
      .run(amount, reason, refId, this.#day(now), now);
  }
}
