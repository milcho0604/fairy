// 미리 알림 저장 (db 8판 reminder 표). 일정(EventStore)과 할 일(TodoStore)이 같이 쓴다. 셈은 remind.ts.
import type { Db } from './db-schema.ts';
import { type Anchor, armReminders, nextFireAt, planReminders, type ReminderMark } from './remind.ts';

export type ReminderKind = 'event' | 'todo';

interface Row {
  ref_id: number;
  before_min: number;
  notified_at: number | null;
}

export class ReminderStore {
  #db: Db;
  #kind: ReminderKind;

  constructor(db: Db, kind: ReminderKind) {
    this.#db = db;
    this.#kind = kind;
  }

  /** 한 항목의 알림, 이른 것(큰 값)부터 */
  marks(id: number): ReminderMark[] {
    return this.many([id]).get(id) ?? [];
  }

  /** 여러 항목의 알림을 한 번에 (목록 그리기) */
  many(ids: readonly number[]): Map<number, ReminderMark[]> {
    const out = new Map<number, ReminderMark[]>();
    if (ids.length === 0) return out;
    const rows = this.#db
      .prepare(
        `select ref_id, before_min, notified_at from reminder
         where kind = ? and ref_id in (select value from json_each(?)) order by ref_id, before_min desc`,
      )
      .all(this.#kind, JSON.stringify(ids)) as Row[];
    for (const r of rows) {
      const id = Number(r.ref_id);
      const list = out.get(id) ?? [];
      list.push({
        before: Number(r.before_min),
        notifiedAt: r.notified_at === null ? null : Number(r.notified_at),
      });
      out.set(id, list);
    }
    return out;
  }

  /**
   * 알림 목록을 바꾼다. reset 이면 이미 말한 표시도 지운다(기준 시각이 바뀜). 아니면 그대로 있는 알림의 표시는 둔다.
   * now 를 주면 이미 지난 알림은 넘긴 것으로 적는다(armReminders). 안 주면 다 아직으로 (시험, 옛 호출)
   */
  set(
    id: number,
    befores: readonly number[],
    anchor: Anchor | null,
    opts: { now?: number; reset?: boolean },
  ) {
    const keep = new Map<number, number | null>();
    if (!opts.reset) for (const m of this.marks(id)) keep.set(m.before, m.notifiedAt);
    const marks =
      opts.now === undefined
        ? befores.map((before) => ({ before, notifiedAt: keep.get(before) ?? null }))
        : armReminders(anchor, befores, opts.now, keep);
    this.#db.prepare('delete from reminder where kind = ? and ref_id = ?').run(this.#kind, id);
    const ins = this.#db.prepare(
      'insert into reminder (kind, ref_id, before_min, notified_at) values (?, ?, ?, ?)',
    );
    for (const m of marks) ins.run(this.#kind, id, m.before, m.notifiedAt);
  }

  /**
   * 여러 항목 중 지금 말할 것 (marks 는 many 로 한 번에 읽은 것). 말하지 않을 항목의 쓸모없어진 알림(기준이 지나
   * 넘길 것, planReminders skip)은 그 자리에서 넘긴 것(0)으로 적는다: 적지 않으면 플래너가 15초마다 다시 골랐다
   */
  sweep(
    items: readonly { id: number; anchor: Anchor }[],
    marks: ReadonlyMap<number, readonly ReminderMark[]>,
    now: number,
  ): Set<number> {
    const speak = new Set<number>();
    let upd: ReturnType<Db['prepare']> | undefined;
    for (const { id, anchor } of items) {
      const plan = planReminders(anchor, marks.get(id) ?? [], now);
      if (plan.speak) {
        speak.add(id);
        continue;
      }
      if (plan.skip.length === 0) continue;
      upd ??= this.#db.prepare(
        'update reminder set notified_at = 0 where kind = ? and ref_id = ? and before_min = ? and notified_at is null',
      );
      for (const b of plan.skip) upd.run(this.#kind, id, b);
    }
    return speak;
  }

  /** 여러 항목 중 now 뒤로 가장 먼저 울릴 알림의 때 (marks 는 many 로 한 번에 읽은 것). 없으면 undefined */
  nextFire(
    items: readonly { id: number; anchor: Anchor }[],
    marks: ReadonlyMap<number, readonly ReminderMark[]>,
    now: number,
  ): number | undefined {
    let next: number | undefined;
    for (const { id, anchor } of items) {
      const at = nextFireAt(anchor, marks.get(id) ?? [], now);
      if (at !== undefined && (next === undefined || at < next)) next = at;
    }
    return next;
  }

  /** 말했다: 지난 알림(늦었으면 곧 올 것까지)을 말한 것으로, 쓸모없어진 것은 넘긴 것으로 적는다 */
  markNotified(id: number, anchor: Anchor, now: number): void {
    const plan = planReminders(anchor, this.marks(id), now);
    const upd = this.#db.prepare(
      'update reminder set notified_at = ? where kind = ? and ref_id = ? and before_min = ?',
    );
    for (const b of plan.mark) upd.run(now, this.#kind, id, b);
    for (const b of plan.skip) upd.run(0, this.#kind, id, b);
  }

  /** from 뒤로 실제로 말한 항목 id (하루 한 번: 오늘 알림으로 말한 할 일은 오후 마감 알림에서 빼기) */
  spokenSince(from: number): Set<number> {
    const rows = this.#db
      .prepare('select distinct ref_id from reminder where kind = ? and notified_at >= ? and notified_at > 0')
      .all(this.#kind, from) as { ref_id: number }[];
    return new Set(rows.map((r) => Number(r.ref_id)));
  }
}
