// 할 일, 코인 장부, 배부름 (P2-03, P2-05, P2-06). 기획서 "게임 규칙".

import { COIN } from './coin-rules.ts';
import { cutText } from './cut-text.ts';
import { plusDays, weekdayOf as weekday } from './day.ts';
import { clockJumped, type Db } from './db-schema.ts';
import { FOCUS, focusReward } from './focus.ts';
import { t } from './i18n/index.ts';
import { pinAt } from './pin.ts';
import { type Anchor, atLocal, DEFAULT_REMINDS, normalizeReminds, REMIND_MAX_MIN } from './remind.ts';
import { ReminderStore } from './reminder-store.ts';

/** 코인 값과 하루 상한은 coin-rules.ts 한 곳에 (서버도 같은 값을 쓴다) */
export { COIN };

/** 반복: 매일, 평일(월~금), 매주 같은 요일, 매달 같은 날 (매달은 2026-10-11) */
export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export const REPEATS: readonly Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly'];
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
  get monthly() {
    return t('panel.repeat.monthly');
  },
};

export function isRepeat(v: unknown): v is Repeat {
  return v === 'daily' || v === 'weekdays' || v === 'weekly' || v === 'monthly';
}

/** 매달 반복의 날 (1~31). 아니면 undefined */
export const isMonthDay = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31;

/** 그해 그달의 d 일. 달에 없는 날(31일, 2월 29, 30일)은 그달 끝 */
export function dayInMonth(year: number, month: number, d: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * 매달 반복 다음 회차: due 가 든 달부터 한 달씩 보며 그달의 anchorDay 일(없으면 그달 끝)이 base(오늘과 due 중 늦은 날)보다
 * 뒤인 첫날. 31일 반복은 2월에 28일(윤년 29일)로 가도 3월에는 다시 31일이다 (anchorDay 를 따로 기억한다)
 */
export function nextMonthly(due: string | null, anchorDay: number, today: string): string {
  const from = due ?? today;
  const base = due && due > today ? due : today;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let guard = 0; guard < 1200; guard++) {
    const day = dayInMonth(y, m, anchorDay);
    if (day > base) return day;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return plusDays(base, 1);
}

/** 매달 반복이 기억하는 날 (repeat_anchor 에 "31" 처럼 둔다). 없으면 마감일의 날 */
export function monthAnchor(anchor: string | null, due: string | null): number | undefined {
  const n = anchor && /^\d{1,2}$/.test(anchor) ? Number(anchor) : due ? Number(due.slice(8, 10)) : Number.NaN;
  return isMonthDay(n) ? n : undefined;
}

/**
 * 반복 할 일을 끝냈을 때 다음 회차 마감일. 오늘보다 뒤인 가장 가까운 날로 간다.
 * 밀린 회차를 한꺼번에 만들지 않는다 (사흘 밀린 매일 할 일을 끝내면 다음은 내일).
 */
export function nextDue(due: string | null, repeat: Repeat, today: string, anchorDay?: number): string {
  if (repeat === 'monthly') return nextMonthly(due, anchorDay ?? Number((due ?? today).slice(8, 10)), today);
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

/** 지운 할 일을 휴지통에 두는 날 수 (#125). 지난 것은 영구 삭제 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** 휴지통의 할 일 한 줄 */
export interface TrashItem {
  id: number;
  title: string;
  due: string | null;
  /** 끝낸 할 일이었으면 끝낸 시각 (되살려도 그대로 끝낸 채다) */
  doneAt: number | null;
  /** 지운 시각(ms) */
  deletedAt: number;
  /** 영구 삭제까지 남은 날 (0 이면 오늘 안에 지워진다) */
  daysLeft: number;
}

/** 휴지통에서 영구 삭제까지 남은 날. 시계를 되돌려 지운 때가 미래여도 TRASH_DAYS 를 넘기지 않는다 */
export function trashDaysLeft(deletedAt: number, now: number): number {
  const left = Math.ceil((deletedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS);
  return Math.max(0, Math.min(TRASH_DAYS, left));
}

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
  /** 고정한 시각 (13판, shared/pin.ts). 고정 안 했거나 값이 깨졌으면 null */
  pinnedAt: number | null;
  /**
   * 반복이 기억한 날 (repeat_anchor): 매주는 지난 마감 옮기기 전의 원래 마감, 매달은 날("31").
   * 끝내면 다음 회차가 이것을 따른다. 달력이 다음 회차를 같은 날에 그리려고 같이 준다. 없으면 빠진다
   */
  repeatAnchor?: string;
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
  deleted_at?: number | null;
  coins: number;
  repeat: string | null;
  due_min?: number | null;
  pinned_at?: unknown;
  repeat_anchor?: string | null;
  sort_ord?: number | null;
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
  pinnedAt: pinAt(r.pinned_at),
  ...(isRepeat(r.repeat) && r.repeat_anchor ? { repeatAnchor: r.repeat_anchor } : {}),
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
    const text = cutText(title.trim(), STEP_TITLE_MAX);
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
    const text = cutText(title.trim(), STEP_TITLE_MAX);
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
      /** 매달 반복의 날 ("매달 31일"). 없으면 마감일의 날. 11월에 넣은 "매달 31일" 은 마감이 30일이라 따로 받는다 */
      repeatDay?: number;
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
    // 번호는 지금 있는 가장 큰 번호나 코인 장부가 기억하는 가장 큰 번호 다음으로 정한다. 영구 삭제로 맨 끝 할 일이 사라진 뒤
    // 같은 번호가 다시 쓰이면 서버 맞추기의 ref(소금 + 번호)가 옛 할 일 것과 겹치고, 새 할 일 코인이 옛 코인만큼 깎인다 (#125)
    const r = this.#db
      .prepare(
        `insert into todo (id, title, due, important, created_at, repeat, repeat_of, due_min)
         values (
           max(
             coalesce((select max(id) from todo), 0),
             coalesce((select hi from todo_hi where id = 1), 0),
             coalesce((select max(ref_id) from coin_log where reason in ('todo', 'early', 'undo')), 0)
           ) + 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(cutText(title, 200), due, input.important ? 1 : 0, now, repeat, repeatOf, dueMin);
    const id = Number(r.lastInsertRowid);
    // 매달 반복은 날을 기억한다 (repeat_anchor 에 "31"). 2월 28일 회차를 끝내도 3월은 31일로
    const monthDay =
      repeat === 'monthly' ? (isMonthDay(input.repeatDay) ? input.repeatDay : undefined) : undefined;
    if (monthDay !== undefined && due && Number(due.slice(8, 10)) !== monthDay)
      this.#db.prepare('update todo set repeat_anchor = ? where id = ?').run(String(monthDay), id);
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
           order by sort_ord is null, sort_ord, important desc, due is null, due, due_min is not null, due_min, created_at, id`,
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
   * 고정과 풀기 (13판). 이미 고정한 것을 다시 고정하면 처음 고정한 시각(자리)을 지킨다.
   * 지운 할 일은 바꾸지 않는다. 끝낸 할 일은 바꿀 수 있다 (되돌리면 그 자리로 돌아온다). 바뀐 할 일 (없으면 undefined)
   */
  pin(id: number, on: boolean, now: number): Todo | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    if (on && t.pinnedAt !== null) return t;
    this.#db.prepare('update todo set pinned_at = ? where id = ?').run(on ? now : null, id);
    return this.get(id);
  }

  /**
   * 손으로 순서 바꾸기 (#146): id 를 target 바로 앞(after 가 거짓)이나 바로 뒤에 둔다.
   * 열린 할 일 모두의 지금 순서를 1부터 번호로 적은 뒤 옮기므로, 번호가 없던 할 일도 보이던 자리 그대로 시작한다.
   * 둘 중 하나가 열린 할 일이 아니면 아무것도 안 하고 false
   */
  place(id: number, target: number, after: boolean, now: number): boolean {
    if (id === target) return false;
    const ids = this.list(now).open.map((todo) => todo.id);
    if (!ids.includes(id) || !ids.includes(target)) return false;
    const rest = ids.filter((x) => x !== id);
    rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id);
    this.#db.exec('begin');
    try {
      const set = this.#db.prepare('update todo set sort_ord = ? where id = ?');
      rest.forEach((x, i) => {
        set.run(i + 1, x);
      });
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return true;
  }

  /** 이 할 일을 끝내면서 생긴 다음 회차 (반복이 아니거나 없으면 undefined) */
  nextOf(id: number): Todo | undefined {
    const r = this.#db
      .prepare(
        'select * from todo where repeat_of = ? and deleted_at is null and done_at is null order by id desc',
      )
      .get(id) as Row | undefined;
    return r ? this.#withReminds([r])[0] : undefined;
  }

  /** 그때부터 끝낸 할 일 제목, 최근 것부터 (주간 회고 카드에서 사용자가 고를 때만) */
  doneTitlesSince(from: number, limit = 20): string[] {
    return (
      this.#db
        .prepare(
          'select title from todo where done_at is not null and deleted_at is null and done_at >= ? order by done_at desc limit ?',
        )
        .all(from, limit) as { title: string }[]
    ).map((r) => r.title);
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
    const title = patch.title === undefined ? t.title : cutText(patch.title.trim(), 200) || t.title;
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
   * 매주 반복은 원래 마감(repeat_anchor)을 기억해 끝내면 다음 회차가 원래 요일로 간다.
   * 매달 반복은 원래 날("25")을 기억해 다음 회차가 그날로 간다
   */
  moveOverdue(
    today: string,
    now: number,
    { habits = true }: { habits?: boolean } = {},
  ): { id: number; due: string | null }[] {
    // habits false: 반복 할 일(습관)은 두고 옮긴다. 오늘 탭 링크는 습관을 빼고 세고 습관 칸에서 따로 체크한다
    const late = this.list(now).open.filter(
      (todo) => todo.due !== null && todo.due < today && (habits || !todo.repeat),
    );
    if (late.length === 0) return [];
    this.#db.exec('begin');
    try {
      for (const todo of late) {
        const kept = this.#repeatAnchor(todo.id);
        const anchor =
          todo.repeat === 'weekly'
            ? (kept ?? todo.due)
            : todo.repeat === 'monthly'
              ? String(monthAnchor(kept, todo.due) ?? '')
              : null;
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
   * 못 한 것(마감이 today 이거나 지난 안 끝난 할 일, 습관 제외)을 to 로 한 번에 옮긴다 ("못 한 N개 내일로").
   * ids 를 주면 그 가운데서만 (화면이 본 목록: 자정이 지나 새로 오늘이 된 것은 건드리지 않는다).
   * 마감 시각과 알림은 update 가 지키고, 하나라도 실패하면 아무것도 안 옮긴다. 옮긴 것과 원래 마감을 돌려준다 (되돌리기용)
   */
  deferTo(
    today: string,
    to: string,
    now: number,
    ids?: readonly number[],
  ): { id: number; due: string | null }[] {
    const pick = ids === undefined ? undefined : new Set(ids);
    const late = this.list(now).open.filter(
      (todo) => todo.due !== null && todo.due <= today && !todo.repeat && (!pick || pick.has(todo.id)),
    );
    if (late.length === 0) return [];
    this.#db.exec('begin');
    try {
      for (const todo of late) this.update(todo.id, { due: to }, now);
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
    const rows = this.#remindRows(now);
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

  /** dueReminders 가 볼 할 일 (안 끝났고 아직 말하지 않은 알림이 있는 것) */
  #remindRows(now: number): Row[] {
    return this.#db
      .prepare(
        `select * from todo t where done_at is null and deleted_at is null and due is not null
         and due >= ? and due <= ?
         and exists (select 1 from reminder r where r.kind = 'todo' and r.ref_id = t.id and r.notified_at is null)
         order by due, due_min, id`,
      )
      .all(this.#day(now - 86_400_000), this.#day(now + REMIND_MAX_MIN * 60_000 + 2 * 86_400_000)) as Row[];
  }

  /** now 뒤로 가장 먼저 울릴 할 일 알림의 때 (플래너가 그때 깬다). 없으면 undefined. dueReminders 와 같은 할 일만 본다 */
  nextReminderAt(now: number): number | undefined {
    const rows = this.#remindRows(now);
    const marks = this.#reminders.many(rows.map((r) => Number(r.id)));
    const items = this.#withReminds(rows, marks).flatMap((todo) => {
      const anchor = todoAnchor(todo);
      return anchor ? [{ id: todo.id, anchor }] : [];
    });
    return this.#reminders.nextFire(items, marks, now);
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

  /** 지운 것 되살리기 (지우고 몇 초 안에 되돌리기, 휴지통 되살리기). 코인은 건드리지 않는다 */
  restore(id: number): void {
    this.#db.prepare('update todo set deleted_at = null, auto_removed = 0 where id = ?').run(id);
  }

  /**
   * 휴지통 (#125): 사람이 지운 할 일, 최근 지운 것부터. 되돌리기가 걷어 낸 다음 회차는 보이지 않는다.
   * 코인은 지울 때도 되살릴 때도 움직이지 않는다 (받은 코인은 지운다고 회수되지 않으니 되살려도 다시 주지 않는다)
   */
  trash(now: number): TrashItem[] {
    const rows = this.#db
      .prepare(
        `select id, title, due, done_at, deleted_at from todo
         where deleted_at is not null and auto_removed = 0 order by deleted_at desc, id desc`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      due: r.due,
      doneAt: r.done_at === null ? null : Number(r.done_at),
      deletedAt: Number(r.deleted_at),
      daysLeft: trashDaysLeft(Number(r.deleted_at), now),
    }));
  }

  trashCount(): number {
    return Number(
      (
        this.#db
          .prepare('select count(*) as n from todo where deleted_at is not null and auto_removed = 0')
          .get() as { n: number }
      ).n,
    );
  }

  /**
   * 휴지통에서 되살릴 수 있는지. gone 은 휴지통에 없다(이미 되살림, 영구 삭제).
   * dup 은 반복 할 일의 다음 회차인데 앞 회차가 다시 열렸거나 같은 앞 회차의 다른 회차가 이미 열려 있다:
   * 되살리면 같은 반복이 두 벌이 되어 끝낼 때마다 둘씩 늘어난다
   */
  restoreCheck(id: number): 'ok' | 'gone' | 'dup' {
    const r = this.#db
      .prepare('select repeat_of from todo where id = ? and deleted_at is not null and auto_removed = 0')
      .get(id) as { repeat_of: number | null } | undefined;
    if (!r) return 'gone';
    if (r.repeat_of === null) return 'ok';
    const open = this.#db
      .prepare(
        `select 1 from todo where deleted_at is null and done_at is null and id != ?1
         and (id = ?2 or repeat_of = ?2)`,
      )
      .get(id, r.repeat_of);
    return open ? 'dup' : 'ok';
  }

  /** 휴지통에서 되살리기. 휴지통에 없거나(restoreCheck 가 gone) 반복이 겹치면(dup) undefined */
  restoreFromTrash(id: number): Todo | undefined {
    if (this.restoreCheck(id) !== 'ok') return undefined;
    this.restore(id);
    return this.get(id);
  }

  /** 영구 삭제 (휴지통에 있는 것만). 단계와 알림 줄도 지운다. 코인 장부는 그대로 둔다. 지운 수 */
  purge(ids: readonly number[]): number {
    let n = 0;
    this.#db.exec('begin');
    try {
      const ok = ids.filter((id) => Number.isInteger(id) && id > 0);
      if (ok.length > 0) n = this.#purgeRow(`id in (${ok.join(',')})`);
      this.#db.exec('commit');
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
    return n;
  }

  /** 휴지통 비우기. 지운 수 */
  emptyTrash(): number {
    this.#db.exec('begin');
    try {
      const n = this.#purgeRow('auto_removed = 0');
      this.#db.exec('commit');
      return n;
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }

  /** 30일이 지난 것을 영구 삭제한다 (되돌리기가 걷어 낸 다음 회차도 같은 날수). 지운 수 */
  purgeExpired(now: number): number {
    // 시계가 크게 앞서 있으면 휴지통 전체가 한 번에 지워지므로 비우지 않는다 (clockJumped)
    if (clockJumped(this.#db, now)) return 0;
    const before = now - TRASH_DAYS * DAY_MS;
    this.#db.exec('begin');
    try {
      // 지운 때가 미래(틀린 시계, 다른 컴퓨터에서 가져온 백업)면 지금으로 맞춘다
      this.#db
        .prepare('update todo set deleted_at = ? where deleted_at > ?')
        .run(Math.floor(now), Math.floor(now));
      const n = this.#purgeRow(`deleted_at <= ${Math.floor(before)}`, true);
      this.#db.exec('commit');
      return n;
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }

  /** where 는 이 파일이 만든 숫자 조건뿐이다 (사용자 글을 이어 붙이지 않는다). 지운 것만 대상 */
  #purgeRow(where: string, anyKind = false): number {
    const kind = anyKind ? '' : ' and auto_removed = 0';
    const ids = (
      this.#db.prepare(`select id from todo where deleted_at is not null${kind} and ${where}`).all() as {
        id: number;
      }[]
    ).map((r) => Number(r.id));
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const marks = part.map(() => '?').join(',');
      this.#db.prepare(`delete from todo_step where todo_id in (${marks})`).run(...part);
      this.#db.prepare(`delete from reminder where kind = 'todo' and ref_id in (${marks})`).run(...part);
      this.#db.prepare(`delete from todo where id in (${marks})`).run(...part);
    }
    return ids.length;
  }

  /** 지난 마감 옮기기가 기억한 매주 할 일의 원래 마감, 매달 할 일의 날 ("31") */
  #repeatAnchor(id: number): string | null {
    const r = this.#db.prepare('select repeat_anchor from todo where id = ?').get(id) as
      | { repeat_anchor: string | null }
      | undefined;
    return r?.repeat_anchor ?? null;
  }

  /**
   * 화면의 체크로 끝내기: 아직 안 끝낸 할 일일 때만 끝내고 받은 코인 수를, 이미 끝냈거나 없으면 null.
   * 체크를 빠르게 여러 번 누르면 뒤의 누름이 "오늘 코인은 다 받았어" 로 앞의 알림을 덮고, 펫이 다시 기뻐하며
   * 친밀도가 또 올랐다. null 이면 화면도 펫도 아무것도 하지 않는다
   */
  completeOpen(id: number, now: number): number | null {
    const t = this.get(id);
    if (!t || t.doneAt !== null) return null;
    return this.complete(id, now);
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
      // 되돌린 뒤 다시 끝내도, 이 회차에서 난 다음 회차가 (끝냈더라도) 남아 있으면 새로 만들지 않는다
      const hasNext = this.#db
        .prepare('select 1 from todo where repeat_of = ? and deleted_at is null limit 1')
        .get(id);
      if (t.repeat && !hasNext) {
        const kept = this.#repeatAnchor(id);
        const monthDay = t.repeat === 'monthly' ? monthAnchor(kept, t.due) : undefined;
        const next = this.add(
          {
            title: t.title,
            important: t.important,
            repeat: t.repeat,
            due: nextDue(t.repeat === 'weekly' ? (kept ?? t.due) : t.due, t.repeat, day, monthDay),
            dueMin: t.dueMin,
            reminds: t.reminds,
            ...(monthDay !== undefined ? { repeatDay: monthDay } : {}),
          },
          now,
          id,
        );
        // 손으로 정한 자리가 있으면 다음 회차도 그 자리에
        const ord = (
          this.#db.prepare('select sort_ord from todo where id = ?').get(id) as { sort_ord: number | null }
        ).sort_ord;
        if (ord !== null && ord !== undefined)
          this.#db.prepare('update todo set sort_ord = ? where id = ?').run(ord, next.id);
        // 고정한 반복 할 일은 다음 회차도 같은 자리에 고정한다
        if (t.pinnedAt !== null)
          this.#db.prepare('update todo set pinned_at = ? where id = ?').run(t.pinnedAt, next.id);
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
          `update todo set deleted_at = ?, auto_removed = 1 where repeat_of = ? and done_at is null and deleted_at is null
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

  /**
   * 잔액. 장부 합계를 12판부터 coin_total 한 행에 둔다 (장부에 쓸 때 트리거가 같이 고친다, db-schema.ts).
   * 행이 없으면(옛 판을 읽는 시험 등) 장부를 더한다
   */
  balance(): number {
    const r = this.#db.prepare('select total from coin_total where id = 1').get() as
      | { total: number }
      | undefined;
    if (r) return Number(r.total);
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

  /** 그 날짜와 그 뒤 날짜에 남은 그 이유의 코인 기록 수 (매주 선물: 시계를 앞 주로 되돌려도 다시 주지 않게) */
  coinCountFrom(reason: string, fromDay: string): number {
    return Number(
      (
        this.#db
          .prepare('select count(*) as n from coin_log where day >= ? and reason = ?')
          .get(fromDay, reason) as { n: number }
      ).n,
    );
  }

  /** 그날 이 이유로 받은 코인 합 (짧은 놀이처럼 코인 수로 하루 상한을 세는 것). 한 번에 여럿 받아도 한 행이다 */
  coinSum(reason: string, day: string): number {
    return Number(
      (
        this.#db
          .prepare('select coalesce(sum(amount), 0) as n from coin_log where day = ? and reason = ?')
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

  /**
   * 코인 초기화 (설정 > 데이터). 잔액만큼 빼는 'reset' 한 줄을 장부에 더해 0 으로 만든다. 장부를 지우지 않는 까닭:
   * 하루 상한(할 일 20개, 집중 40, 놀이 6 등)과 기록(업적의 집중 횟수, 베타 기록의 밥 준 횟수)이 장부를 세서,
   * 지우면 같은 날 상한이 다시 차 코인을 또 받고 기록도 사라진다.
   * 끝낸 할 일이 기억한 받은 코인(todo.coins)도 0 으로: 초기화로 이미 없어진 코인을 되돌리기가 또 회수하지 않게.
   * 그 할 일을 되돌려 다시 끝내도 예전에 받은 몫은 다시 주지 않는다 (complete 의 kept).
   * alsoInside: 같은 묶음 안에서 할 일 (산 물건 지우기). 실패하면 코인도 그대로다. 뺀 코인 수를 돌려준다
   */
  resetCoins(now: number, alsoInside?: () => void): number {
    this.#db.exec('begin immediate');
    try {
      const before = this.balance();
      if (before !== 0) this.#log(-before, 'reset', null, now);
      this.#db.prepare('update todo set coins = 0 where coins != 0').run();
      alsoInside?.();
      this.#db.exec('commit');
      return before;
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }

  /** 양 0 인 장부 줄 (산 물건 초기화 'reset-items': 서버 코인 맞추기가 서버에도 알린다) */
  mark(reason: string, now: number): void {
    this.#log(0, reason, null, now);
  }

  /** 그 밖의 보상 (화해 보너스, 휴식 권유 따르기). 상한은 부르는 쪽이 본다 */
  reward(amount: number, reason: string, now: number): void {
    if (amount > 0) this.#log(amount, reason, null, now);
  }

  /** 집중 타이머 한 번 끝. 받은 코인 수 (하루 상한을 넘으면 0). */
  /** 집중을 끝냈다. 길이에 맞는 코인(focusReward), 하루 집중 코인 상한(100)을 넘지 않게 */
  rewardFocus(now: number, minutes: number = FOCUS.focusMin): number {
    const got = Number(
      (
        this.#db
          .prepare(`select coalesce(sum(amount), 0) as n from coin_log where day = ? and reason = 'focus'`)
          .get(this.#day(now)) as { n: number }
      ).n,
    );
    const coins = Math.min(focusReward(minutes), COIN.focus * COIN.dailyFocusLimit - got);
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
