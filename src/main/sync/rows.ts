// 기기 간 동기화가 저장 파일을 읽고 쓰는 곳 (docs/sync-plan.md 4, 6절). 항목(SyncItem)과 표 행을 오간다.
// 다른 기기 변경을 적용하는 쓰기는 모두 quietly 안에서 하고 (트리거가 시각과 보낼 목록을 적지 않는다),
// 칸 시각(sync_clock)은 합친 결과 그대로 직접 적는다. Electron 없이 돈다.
import type { Db } from '../../shared/db-schema.ts';
import { eventAnchor } from '../../shared/event-store.ts';
import { tombRows } from '../../shared/gcal-tomb.ts';
import { noteFormatOf } from '../../shared/note-store.ts';
import { type Anchor, fireAt } from '../../shared/remind.ts';
import { SYNC_KINDS, type SyncKind } from '../../shared/sync-fields.ts';
import type { Json, SyncItem } from '../../shared/sync-item.ts';
import { quietly } from '../../shared/sync-quiet.ts';
import { NEXT_TODO_ID, todoAnchor } from '../../shared/todo-store.ts';

/** 동기화가 따로 두는 표. 트리거 대상이 아닌 기계적 표라 저장 파일 안에 둔다 (백업을 되살려도 커서를 0 으로 돌려 다시 받는다) */
const TABLES = `
  create table if not exists sync_seen (
    uid text primary key,
    kind text not null,
    rev integer not null,
    body_hash text,
    base_body text
  );
  create table if not exists sync_hold (
    uid text primary key,
    kind text,
    rev integer not null,
    reason text not null,
    blob text not null,
    at integer not null
  );
  create table if not exists sync_copy (
    uid text primary key,
    orig text not null,
    at integer not null
  );
  -- 부모가 없어 끊고 쓴 반복 연결의 원래 부모 uid. 부모가 적용되면 다시 잇는다 (끊은 것은 칸 시각을 올리지 않는다)
  create table if not exists sync_link (
    kind text not null,
    uid text not null,
    field text not null,
    target text not null,
    primary key (kind, uid, field)
  ) without rowid;
  -- 반복 연결이 가리키는 행의 번호와 uid (부모를 영구 삭제해도 자식의 연결이 가리키던 uid 를 알려고. 번호는 기기마다 다르다)
  create table if not exists sync_idmap (
    kind text not null,
    id integer not null,
    uid text not null,
    primary key (kind, id)
  ) without rowid;
  -- 다른 계정의 것이라 이 계정에 올리지 않기로 한 항목 (처음 보낼 때 빼고, 보낸 뒤나 새로 고친 뒤에는 풀린다)
  create table if not exists sync_skip (
    kind text not null,
    uid text not null,
    at integer not null,
    primary key (kind, uid)
  ) without rowid;
`;

export function ensureTables(db: Db): void {
  db.exec(TABLES);
  // 보류 다시 하기 간격: 처음 만든 표에는 칸이 없으니 더한다
  const cols = (db.prepare('pragma table_info(sync_hold)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('tries')) db.exec('alter table sync_hold add column tries integer not null default 0');
  if (!cols.includes('next')) db.exec('alter table sync_hold add column next integer not null default 0');
}

type Row = Record<string, unknown>;
const one = (db: Db, sql: string, ...a: unknown[]): Row | undefined =>
  db.prepare(sql).get(...a) as Row | undefined;
const all = (db: Db, sql: string, ...a: unknown[]): Row[] => db.prepare(sql).all(...a) as Row[];
const run = (db: Db, sql: string, ...a: unknown[]) => db.prepare(sql).run(...a);

const num = (v: unknown, d: number | null = null): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const txt = (v: unknown, d: string | null = null): string | null => (typeof v === 'string' ? v : d);
const int = (v: unknown): number => (v === 1 || v === true ? 1 : 0);

const isKind = (v: unknown): v is SyncKind => (SYNC_KINDS as readonly unknown[]).includes(v);

export { isKind };

// ---- 읽기: 표 행을 항목으로 ----

/** 연결이 가리키는 행의 uid. 행이 영구 삭제됐으면 지우기 전에 적어 둔 uid (자식이 보내는 값이 기기마다 같도록) */
const uidOf = (db: Db, table: string, id: unknown): string | null => {
  if (id === null || id === undefined) return null;
  const r = one(db, `select uid from ${table} where id = ?`, id as number);
  if (r && typeof r.uid === 'string') return r.uid;
  const m = one(db, 'select uid from sync_idmap where kind = ? and id = ?', table, id as number);
  return m ? String(m.uid) : null;
};

/** 부모가 될 수 있는 행(모든 할 일, 반복 일정 원본)의 번호와 uid 를 적어 둔다 */
const idmapPut = (db: Db, kind: SyncKind, id: number, uid: string): void => {
  run(db, 'insert or replace into sync_idmap (kind, id, uid) values (?, ?, ?)', kind, id, uid);
};

const idOf = (db: Db, table: string, uid: string): number | undefined => {
  const r = one(db, `select id from ${table} where uid = ?`, uid);
  return r ? Number(r.id) : undefined;
};

const hasClock = (db: Db, kind: SyncKind, uid: string): boolean =>
  !!one(db, 'select 1 as x from sync_clock where kind = ? and uid = ? limit 1', kind, uid);

export const rowId = (db: Db, kind: SyncKind, uid: string): number | undefined => idOf(db, kind, uid);

/** 이 일정 행을 동기화가 추적하나 (24판 트리거와 같은 조건) */
const eventTracked = (r: Row): boolean =>
  r.source === 'local' &&
  (r.repeat_series === null ||
    r.repeat_series === r.id ||
    Number(r.user_edited) === 1 ||
    Number(r.track) === 1 ||
    r.deleted_at !== null);

const remindersOf = (db: Db, kind: 'todo' | 'event', id: number): number[] =>
  all(
    db,
    'select before_min from reminder where kind = ? and ref_id = ? order by before_min desc',
    kind,
    id,
  ).map((r) => Number(r.before_min));

function clocksOf(db: Db, kind: SyncKind, uid: string, keys: string[]): Record<string, number> {
  const have = new Map(
    all(db, 'select field, t from sync_clock where kind = ? and uid = ?', kind, uid).map((r) => [
      String(r.field),
      Number(r.t),
    ]),
  );
  const c: Record<string, number> = {};
  for (const k of keys) c[k] = have.get(k) ?? 0;
  return c;
}

/**
 * 이 기기의 항목 하나를 보낼 모양으로. 행이 없거나 추적하지 않는 일정이면 undefined.
 * 부모가 없는 단계도 undefined (보낼 수 없다)
 */
export function readItem(db: Db, kind: SyncKind, uid: string, dev: { id: string }): SyncItem | undefined {
  const r = one(db, `select * from ${kind} where uid = ?`, uid);
  if (!r) return undefined;
  const id = Number(r.id);
  let f: Record<string, Json>;
  if (kind === 'todo' || (kind === 'event' && r.repeat_series === r.id)) idmapPut(db, kind, id, uid);
  if (kind === 'todo') {
    f = {
      title: r.title as string,
      due: (r.due as string | null) ?? null,
      important: Number(r.important),
      created_at: Number(r.created_at),
      done_at: (r.done_at as number | null) ?? null,
      coin_paid: Number(r.coin_paid),
      deleted_at: (r.deleted_at as number | null) ?? null,
      repeat: (r.repeat as string | null) ?? null,
      repeat_of: uidOf(db, 'todo', r.repeat_of) ?? linkOf(db, 'todo', uid, 'repeat_of'),
      repeat_anchor: (r.repeat_anchor as string | null) ?? null,
      pinned_at: (r.pinned_at as number | null) ?? null,
      due_min: (r.due_min as number | null) ?? null,
      // 되돌리기가 걷어 낸 다음 회차(1)인지, 사람이 지운 것(0)인지. 칸 시각은 deleted_at 과 같이 움직인다 (아래)
      auto_removed: Number(r.auto_removed),
      reminders: remindersOf(db, 'todo', id),
    };
  } else if (kind === 'todo_step') {
    const parent = uidOf(db, 'todo', r.todo_id);
    if (!parent) return undefined;
    f = {
      todo_id: parent,
      title: r.title as string,
      done: Number(r.done),
      ord: Number(r.ord),
      created_at: Number(r.created_at),
    };
  } else if (kind === 'note') {
    f = {
      title: r.title as string,
      body: r.body as string,
      source: r.source as string,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      deleted_at: (r.deleted_at as number | null) ?? null,
      pinned_at: (r.pinned_at as number | null) ?? null,
      format: noteFormatOf(r.format),
    };
  } else {
    // 추적하지 않는 펼친 회차라도 서버가 아는 것(보낸 적이나 받은 적이 있다)이거나 칸 시각이 남아 있으면(한 번 추적했다) 보낸다:
    // 지웠다 되살린 회차는 다시 추적 대상이 아니지만 지운 쪽이 서버나 다른 기기에 있어 되살린 것을 알려야 한다
    if (!eventTracked(r) && !getSeen(db, uid) && !hasClock(db, 'event', uid)) return undefined;
    const series =
      r.repeat_series === null
        ? linkOf(db, 'event', uid, 'repeat_series')
        : r.repeat_series === r.id
          ? uid
          : uidOf(db, 'event', r.repeat_series);
    f = {
      title: r.title as string,
      start_at: Number(r.start_at),
      end_at: (r.end_at as number | null) ?? null,
      created_at: Number(r.created_at),
      deleted_at: (r.deleted_at as number | null) ?? null,
      all_day: Number(r.all_day),
      pinned_at: (r.pinned_at as number | null) ?? null,
      repeat_kind: (r.repeat_kind as string | null) ?? null,
      repeat_series: series,
      repeat_clock: (r.repeat_clock as number | null) ?? null,
      slot: (r.slot as number | null) ?? null,
      user_edited: Number(r.user_edited),
      removed_by: (r.removed_by as string | null) ?? null,
      reminders: remindersOf(db, 'event', id),
    };
    if (r.repeat_series === r.id) {
      const t = one(db, 'select * from event_repeat_template where series_id = ?', id);
      f.template = t
        ? {
            start_at: Number(t.start_at),
            repeat_kind: String(t.repeat_kind),
            title: String(t.title),
            duration_ms: (t.duration_ms as number | null) ?? null,
            repeat_clock: Number(t.repeat_clock),
            reminders: String(t.reminders),
            remind_min: Number(t.remind_min),
            created_at: Number(t.created_at),
          }
        : null;
      f.skips = all(
        db,
        'select start_at from event_repeat_skip where series_id = ? order by start_at',
        id,
      ).map((s) => Number(s.start_at));
    }
  }
  const c = clocksOf(db, kind, uid, Object.keys(f));
  if (kind === 'todo') c.auto_removed = c.deleted_at ?? 0;
  return { kind, uid, f, c, dev: dev.id };
}

// ---- 쓰기: 항목을 표 행으로 ----

/**
 * ok: 썼다. parent: 부모가 아직 안 왔다(보류). orphan: 부모가 영구 삭제된 것이 확인된 단계(쓸 수 없다)
 */
export type ApplyResult = 'ok' | 'parent' | 'orphan';

const asList = (v: Json | undefined): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];

/**
 * 합친 항목을 표에 쓴다 (트리거 기록 없이). 부모(할 일, 반복 시리즈)가 아직 없으면 'parent' 로 돌려 쓰지 않는다.
 * degrade 면 반복 연결(repeat_of, repeat_series)이 없는 부모는 끊고 쓴다
 */
export function applyItem(db: Db, item: SyncItem, o: { now: number; degrade?: boolean }): ApplyResult {
  return quietly(db, () => write(db, item, o));
}

function write(db: Db, item: SyncItem, o: { now: number; degrade?: boolean }): ApplyResult {
  const { kind, uid, f } = item;
  const have = one(db, `select * from ${kind} where uid = ?`, uid);
  let id: number;
  if (kind === 'todo') {
    let repeatOf: number | null = null;
    if (typeof f.repeat_of === 'string') {
      const target = f.repeat_of === uid ? undefined : idOf(db, 'todo', f.repeat_of);
      // 앞 회차가 이 기기에 없어도, 서버가 아는 항목인데 행이 없으면 영구 삭제된 것이니 연결만 끊고 쓴다
      if (target === undefined && !o.degrade && !getSeen(db, f.repeat_of)) return 'parent';
      repeatOf = target ?? null;
      linkNote(db, 'todo', uid, 'repeat_of', target === undefined ? f.repeat_of : null);
    } else linkNote(db, 'todo', uid, 'repeat_of', null);
    const vals = [
      txt(f.title, ''),
      txt(f.due),
      int(f.important),
      num(f.created_at, 0),
      num(f.done_at),
      int(f.coin_paid),
      num(f.deleted_at),
      txt(f.repeat),
      repeatOf,
      txt(f.repeat_anchor),
      num(f.pinned_at),
      num(f.due_min),
    ];
    if (have) {
      id = Number(have.id);
      run(
        db,
        `update todo set title = ?, due = ?, important = ?, created_at = ?, done_at = ?, coin_paid = ?, deleted_at = ?,
         repeat = ?, repeat_of = ?, repeat_anchor = ?, pinned_at = ?, due_min = ?, auto_removed = ? where id = ?`,
        ...vals,
        int(f.auto_removed),
        id,
      );
    } else {
      // 받은 할 일의 번호는 새로 만들 때와 같은 규칙 (코인 장부 번호와 겹치지 않게). 코인은 0: 다른 기기가 받은 코인이다
      const r = run(
        db,
        `insert into todo (id, title, due, important, created_at, done_at, coins, coin_paid, deleted_at, repeat,
           repeat_of, repeat_anchor, pinned_at, due_min, auto_removed, uid)
         values (${NEXT_TODO_ID}, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...vals,
        int(f.auto_removed),
        uid,
      );
      id = Number(r.lastInsertRowid);
    }
    const moved = !have || have.due !== txt(f.due) || (have.due_min ?? null) !== num(f.due_min);
    setReminders(
      db,
      'todo',
      id,
      asList(f.reminders),
      todoAnchor({ due: txt(f.due), dueMin: num(f.due_min) }),
      o.now,
      moved,
    );
  } else if (kind === 'todo_step') {
    const parent = typeof f.todo_id === 'string' ? idOf(db, 'todo', f.todo_id) : undefined;
    if (parent === undefined)
      return typeof f.todo_id === 'string' && getSeen(db, f.todo_id) ? 'orphan' : 'parent';
    const vals = [parent, txt(f.title, ''), int(f.done), num(f.ord, 0), num(f.created_at, 0)];
    if (have) {
      id = Number(have.id);
      run(
        db,
        'update todo_step set todo_id = ?, title = ?, done = ?, ord = ?, created_at = ? where id = ?',
        ...vals,
        id,
      );
    } else {
      id = Number(
        run(
          db,
          'insert into todo_step (todo_id, title, done, ord, created_at, uid) values (?, ?, ?, ?, ?, ?)',
          ...vals,
          uid,
        ).lastInsertRowid,
      );
    }
  } else if (kind === 'note') {
    const vals = [
      txt(f.title, ''),
      txt(f.body, ''),
      f.source === 'ai' ? 'ai' : 'me',
      num(f.created_at, 0),
      num(f.updated_at, 0),
      num(f.deleted_at),
      num(f.pinned_at),
      // 형식 칸이 없는 항목(26판 앞의 앱이 보낸 것)은 새 메모면 txt, 있던 메모면 가진 그대로
      'format' in f ? noteFormatOf(f.format) : noteFormatOf(have?.format),
    ];
    if (have) {
      id = Number(have.id);
      run(
        db,
        'update note set title = ?, body = ?, source = ?, created_at = ?, updated_at = ?, deleted_at = ?, pinned_at = ?, format = ? where id = ?',
        ...vals,
        id,
      );
    } else {
      id = Number(
        run(
          db,
          'insert into note (title, body, source, created_at, updated_at, deleted_at, pinned_at, format, uid) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ...vals,
          uid,
        ).lastInsertRowid,
      );
    }
  } else {
    id = writeEvent(db, item, have, o);
    if (id < 0) return 'parent';
  }
  if (kind === 'todo' || (kind === 'event' && item.f.repeat_series === uid)) idmapPut(db, kind, id, uid);
  // 칸 시각은 합친 결과 그대로
  const put = db.prepare('insert or replace into sync_clock (kind, uid, field, t) values (?, ?, ?, ?)');
  for (const k of Object.keys(f)) put.run(kind, uid, k, item.c[k] ?? 0);
  run(db, 'delete from sync_tomb where kind = ? and uid = ?', kind, uid);
  relink(db, kind, uid, id);
  return 'ok';
}

/** 끊고 쓴 연결의 원래 부모 uid 를 적어 둔다 (target 이 null 이면 지운다) */
function linkNote(db: Db, kind: SyncKind, uid: string, field: string, target: string | null): void {
  if (target === null)
    run(db, 'delete from sync_link where kind = ? and uid = ? and field = ?', kind, uid, field);
  else
    run(
      db,
      'insert or replace into sync_link (kind, uid, field, target) values (?, ?, ?, ?)',
      kind,
      uid,
      field,
      target,
    );
}

const linkOf = (db: Db, kind: SyncKind, uid: string, field: string): string | null => {
  const r = one(
    db,
    'select target from sync_link where kind = ? and uid = ? and field = ?',
    kind,
    uid,
    field,
  );
  return r ? String(r.target) : null;
};

/** 방금 쓴 행이 부모를 기다리던 자식의 부모면 다시 잇는다 (칸 시각은 그대로) */
function relink(db: Db, kind: SyncKind, uid: string, id: number): void {
  if (kind !== 'todo' && kind !== 'event') return;
  for (const l of all(db, 'select kind, uid, field from sync_link where target = ?', uid)) {
    if (l.kind !== kind) continue;
    const col = l.field === 'repeat_of' ? 'repeat_of' : 'repeat_series';
    run(db, `update ${kind} set ${col} = ? where uid = ?`, id, String(l.uid));
    run(
      db,
      'delete from sync_link where kind = ? and uid = ? and field = ?',
      kind,
      String(l.uid),
      String(l.field),
    );
  }
}

/** 일정 한 행(과 반복 시리즈의 딸린 표)을 쓴다. 시리즈가 아직 없으면 -1 */
function writeEvent(
  db: Db,
  item: SyncItem,
  have: Row | undefined,
  o: { now: number; degrade?: boolean },
): number {
  const { uid, f } = item;
  let series: number | null = null;
  const selfSeries = typeof f.repeat_series === 'string' && f.repeat_series === uid;
  if (typeof f.repeat_series === 'string' && !selfSeries) {
    const target = idOf(db, 'event', f.repeat_series);
    if (target === undefined && !o.degrade && !getSeen(db, f.repeat_series)) return -1;
    series = target ?? null;
    linkNote(db, 'event', uid, 'repeat_series', target === undefined ? f.repeat_series : null);
  } else linkNote(db, 'event', uid, 'repeat_series', null);
  const reminds = asList(f.reminders);
  const start = num(f.start_at, 0) as number;
  const vals = [
    txt(f.title, ''),
    start,
    num(f.end_at),
    reminds.length ? Math.min(...reminds) : 0,
    num(f.created_at, 0),
    num(f.deleted_at),
    int(f.all_day),
    num(f.pinned_at),
    txt(f.repeat_kind),
    series,
    num(f.repeat_clock),
    num(f.slot),
    int(f.user_edited),
    txt(f.removed_by),
  ];
  // 같은 반복의 같은 시각에 손대지 않은 펼친 회차가 다른 uid 로 있으면 그 행을 받은 행으로 갈아끼운다 (유일 색인이 막는 자리)
  if (series !== null && num(f.deleted_at) === null) {
    const clash = all(
      db,
      `select id from event where repeat_series = ? and start_at = ? and deleted_at is null and uid is not ?
         and repeat_series <> id and user_edited = 0 and track = 0 and pinned_at is null`,
      series,
      start,
      uid,
    );
    for (const c of clash) {
      // 구글로 보낸 회차면 지우기 전에 무덤에 옮긴다 (안 그러면 구글 일정이 남는다)
      tombRows(db, 'event', "id = ? and source = 'local'", o.now, Number(c.id));
      run(db, "delete from reminder where kind = 'event' and ref_id = ?", Number(c.id));
      run(db, 'delete from event where id = ?', Number(c.id));
    }
  }
  let id: number;
  if (have) {
    id = Number(have.id);
    run(
      db,
      `update event set title = ?, start_at = ?, end_at = ?, remind_min = ?, created_at = ?, deleted_at = ?, all_day = ?,
       pinned_at = ?, repeat_kind = ?, repeat_series = ?, repeat_clock = ?, slot = ?, user_edited = ?, removed_by = ?,
       track = case when ? then 1 else track end where id = ?`,
      ...vals,
      f.repeat_series !== null && !selfSeries ? 1 : 0,
      id,
    );
  } else {
    id = Number(
      run(
        db,
        `insert into event (title, start_at, end_at, remind_min, created_at, deleted_at, all_day, pinned_at, repeat_kind,
           repeat_series, repeat_clock, slot, user_edited, removed_by, track, source, uid)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?)`,
        ...vals,
        f.repeat_series !== null && !selfSeries ? 1 : 0,
        uid,
      ).lastInsertRowid,
    );
  }
  if (selfSeries) run(db, 'update event set repeat_series = id where id = ?', id);
  const moved = !have || Number(have.start_at) !== start || Number(have.all_day) !== int(f.all_day);
  setReminders(
    db,
    'event',
    id,
    reminds,
    eventAnchor({ startAt: start, allDay: int(f.all_day) === 1 }),
    o.now,
    moved,
  );
  if (selfSeries) {
    if ('template' in f) {
      const t = f.template;
      if (t === null || typeof t !== 'object' || Array.isArray(t)) {
        run(db, 'delete from event_repeat_template where series_id = ?', id);
      } else {
        const x = t as Record<string, Json>;
        run(
          db,
          `insert or replace into event_repeat_template (series_id, start_at, repeat_kind, title, duration_ms, repeat_clock,
             reminders, remind_min, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          num(x.start_at, 0),
          txt(x.repeat_kind, 'daily'),
          txt(x.title, ''),
          num(x.duration_ms),
          num(x.repeat_clock, 0),
          txt(x.reminders, '[]'),
          num(x.remind_min, 0),
          num(x.created_at, 0),
        );
      }
    }
    if ('skips' in f) {
      run(db, 'delete from event_repeat_skip where series_id = ?', id);
      for (const s of asList(f.skips))
        run(db, 'insert or ignore into event_repeat_skip (series_id, start_at) values (?, ?)', id, s);
    }
  }
  return id;
}

/**
 * 받은 알림 목록을 건다. 이미 울릴 때가 지난 알림은 지금 말한 것으로 적어 울리지 않게 하고 (오래된 알림이 한꺼번에 울리지 않게),
 * 이미 말한 알림의 표시는 둔다 (기준이 옮겨졌으면 reset 으로 지우고 다시 센다)
 */
function setReminders(
  db: Db,
  kind: 'todo' | 'event',
  id: number,
  befores: number[],
  anchor: Anchor | null,
  now: number,
  reset: boolean,
): void {
  const have = new Map(
    all(db, 'select before_min, notified_at from reminder where kind = ? and ref_id = ?', kind, id).map(
      (r) => [Number(r.before_min), (r.notified_at as number | null) ?? null],
    ),
  );
  const want = new Set(befores);
  for (const b of have.keys())
    if (!want.has(b))
      run(db, 'delete from reminder where kind = ? and ref_id = ? and before_min = ?', kind, id, b);
  for (const b of want) {
    const old = reset ? undefined : have.get(b);
    const mark = old !== undefined ? old : anchor && fireAt(anchor, b) <= now ? now : null;
    run(
      db,
      'insert or replace into reminder (kind, ref_id, before_min, notified_at) values (?, ?, ?, ?)',
      kind,
      id,
      b,
      mark,
    );
  }
}

// ---- 영구 삭제 ----

/** 행을 영구 삭제한다 (단계, 알림, 시리즈 딸린 표 포함). 있었으면 true */
export function purgeRow(db: Db, kind: SyncKind, uid: string, now = Date.now()): boolean {
  return quietly(db, () => {
    const r = one(db, `select * from ${kind} where uid = ?`, uid);
    if (r) {
      const id = Number(r.id);
      if (kind === 'todo') {
        // 단계도 함께 지운다. 이 기기가 모르던 새 단계가 서버에 살아 있을 수 있어, 단계마다 삭제 표식을 남겨 서버에서도 지운다
        for (const s of all(db, 'select uid from todo_step where todo_id = ?', id)) {
          clean(db, 'todo_step', String(s.uid));
          run(
            db,
            "insert or replace into sync_tomb (kind, uid, t) values ('todo_step', ?, ?)",
            String(s.uid),
            now,
          );
          outboxAdd(db, 'todo_step', String(s.uid));
        }
        run(db, 'delete from todo_step where todo_id = ?', id);
        run(db, "delete from reminder where kind = 'todo' and ref_id = ?", id);
      } else if (kind === 'event') {
        run(db, "delete from reminder where kind = 'event' and ref_id = ?", id);
      }
      // 구글 캘린더에 올라간 행이면 일정을 나중에 지울 수 있게 무덤에 옮긴다 (할 일, 그리고 페어리가 넣은 일정)
      if (kind === 'todo') tombRows(db, 'todo', 'id = ?', now, id);
      else if (kind === 'event') tombRows(db, 'event', "id = ? and source = 'local'", now, id);
      run(db, `delete from ${kind} where id = ?`, id);
      if (kind === 'event') {
        const seriesId = r.repeat_series === null ? id : Number(r.repeat_series);
        const remains = one(
          db,
          'select 1 as x from event where id = ? or repeat_series = ? limit 1',
          seriesId,
          seriesId,
        );
        if (!remains) {
          run(db, 'delete from event_repeat_skip where series_id = ?', seriesId);
          run(db, 'delete from event_repeat_template where series_id = ?', seriesId);
        }
      }
    }
    clean(db, kind, uid);
    return !!r;
  });
}

/** 항목의 칸 시각, 보낼 목록, 삭제 표식, 본 번호를 지운다 */
function clean(db: Db, kind: SyncKind, uid: string): void {
  run(db, 'delete from sync_clock where kind = ? and uid = ?', kind, uid);
  run(db, 'delete from sync_outbox where kind = ? and uid = ?', kind, uid);
  run(db, 'delete from sync_tomb where kind = ? and uid = ?', kind, uid);
  run(db, 'delete from sync_link where kind = ? and uid = ?', kind, uid);
}

export const cleanKey = clean;

/** 어떤 종류인지 모르는 항목(서버가 덩어리를 비운 삭제 표식)을 모든 표에서 지운다 */
export function purgeAnyKind(db: Db, uid: string, now = Date.now()): void {
  for (const k of SYNC_KINDS) purgeRow(db, k, uid, now);
}

// ---- 본 번호, 보류, 사본 ----

export interface Seen {
  rev: number;
  hash: string | null;
  body: string | null;
}

export function getSeen(db: Db, uid: string): (Seen & { kind: string }) | undefined {
  const r = one(db, 'select kind, rev, body_hash, base_body from sync_seen where uid = ?', uid);
  return r
    ? {
        kind: String(r.kind),
        rev: Number(r.rev),
        hash: (r.body_hash as string | null) ?? null,
        body: (r.base_body as string | null) ?? null,
      }
    : undefined;
}

export function setSeen(
  db: Db,
  kind: SyncKind,
  uid: string,
  rev: number,
  body?: string,
  hash?: string,
): void {
  run(
    db,
    'insert or replace into sync_seen (uid, kind, rev, body_hash, base_body) values (?, ?, ?, ?, ?)',
    uid,
    kind,
    rev,
    kind === 'note' && hash !== undefined ? hash : null,
    kind === 'note' && body !== undefined ? body : null,
  );
}

export function addHold(
  db: Db,
  uid: string,
  kind: string | null,
  rev: number,
  reason: string,
  blob: string,
  now: number,
): void {
  // 같은 항목을 다시 보류해도 처음 보류한 때를 둔다 (부모가 오래 안 오는지 재는 데 쓴다).
  // 다시 하기는 간격을 늘려 간다 (1분, 2분, ... 30분): 계속 실패하는 항목이 로그와 일을 반복해 만들지 않게
  run(
    db,
    `insert or replace into sync_hold (uid, kind, rev, reason, blob, at, tries, next)
     values (?1, coalesce(?2, (select kind from sync_hold where uid = ?1)), ?3, ?4, ?5,
       coalesce((select at from sync_hold where uid = ?1), ?6),
       coalesce((select tries from sync_hold where uid = ?1), -1) + 1,
       ?6 + min(1800000, 60000 * (1 << min(coalesce((select tries from sync_hold where uid = ?1), -1) + 1, 10))))`,
    uid,
    kind,
    rev,
    reason,
    blob,
    now,
  );
}

export const holdTries = (db: Db, uid: string): number | undefined => {
  const r = one(db, 'select tries from sync_hold where uid = ?', uid);
  return r ? Number(r.tries) : undefined;
};

export function dropHold(db: Db, uid: string): void {
  run(db, 'delete from sync_hold where uid = ?', uid);
}

export interface Hold {
  uid: string;
  kind: string | null;
  rev: number;
  reason: string;
  blob: string;
  at: number;
  /** 다시 해 봐도 되는 때 */
  next: number;
}

export function holds(db: Db, reason?: string): Hold[] {
  return all(
    db,
    `select uid, kind, rev, reason, blob, at, next from sync_hold ${reason ? 'where reason = ?' : ''} order by rev`,
    ...(reason ? [reason] : []),
  ).map((r) => ({
    uid: String(r.uid),
    kind: (r.kind as string | null) ?? null,
    rev: Number(r.rev),
    reason: String(r.reason),
    blob: String(r.blob),
    at: Number(r.at),
    next: Number(r.next),
  }));
}

export const holdCount = (db: Db): number => Number(one(db, 'select count(*) as n from sync_hold')?.n ?? 0);

export function noteCopy(db: Db, uid: string, orig: string, now: number): void {
  run(db, 'insert or ignore into sync_copy (uid, orig, at) values (?, ?, ?)', uid, orig, now);
}

/** 이 메모가 충돌 사본이면 원본 uid (메모 목록의 "충돌 사본" 표시) */
export function copyOrigin(db: Db, uid: string): string | undefined {
  const r = one(db, 'select orig from sync_copy where uid = ?', uid);
  return r ? String(r.orig) : undefined;
}

/** 충돌 사본인 메모의 번호들 (메모 목록의 "충돌 사본" 표시). 동기화 표가 아직 없는 저장 파일이면 빈 집합 */
export function copyNoteIds(db: Db): Set<number> {
  try {
    return new Set(
      all(
        db,
        'select n.id as id from note n join sync_copy c on c.uid = n.uid where n.deleted_at is null',
      ).map((r) => Number(r.id)),
    );
  } catch {
    return new Set();
  }
}

/** 서버 사본이 바뀌었다(지움, 열쇠 바꿈, 계정 바뀜): 본 번호와 보류를 모두 버린다 */
export function resetSeen(db: Db): void {
  db.exec('delete from sync_seen; delete from sync_hold;');
}

// ---- 보낼 목록 ----

export function outboxList(db: Db): { kind: SyncKind; uid: string }[] {
  return all(db, 'select kind, uid from sync_outbox').flatMap((r) =>
    isKind(r.kind) ? [{ kind: r.kind, uid: String(r.uid) }] : [],
  );
}

/** 반복 일정 시리즈의 원본 일정 uid (보낼 때 이것을 회차보다 먼저 보낸다) */
export function eventOrigins(db: Db): Set<string> {
  return new Set(
    all(db, 'select uid from event where repeat_series = id and uid is not null').map((r) => String(r.uid)),
  );
}

export const outboxCount = (db: Db): number =>
  Number(one(db, 'select count(*) as n from sync_outbox')?.n ?? 0);

export function outboxAdd(db: Db, kind: SyncKind, uid: string): void {
  run(db, 'insert or ignore into sync_outbox (kind, uid) values (?, ?)', kind, uid);
}

export function outboxDrop(db: Db, kind: SyncKind, uid: string): void {
  run(db, 'delete from sync_outbox where kind = ? and uid = ?', kind, uid);
}

export function tombOf(db: Db, kind: SyncKind, uid: string): number | undefined {
  const r = one(db, 'select t from sync_tomb where kind = ? and uid = ?', kind, uid);
  return r ? Number(r.t) : undefined;
}

/** 영구 삭제 표식을 남기고 보낼 목록에 넣는다 (서버에도 지우려고) */
export function tombAdd(db: Db, kind: SyncKind, uid: string, t: number): void {
  run(db, 'insert or replace into sync_tomb (kind, uid, t) values (?, ?, ?)', kind, uid, t);
  outboxAdd(db, kind, uid);
}

export function tombDrop(db: Db, kind: SyncKind, uid: string): void {
  run(db, 'delete from sync_tomb where kind = ? and uid = ?', kind, uid);
}

/** 이 기기의 행이 만들어진 시각 (created_at 칸 시각, 모르면 0): 영구 삭제 표식과 견준다 */
export function createdClock(db: Db, kind: SyncKind, uid: string): number {
  const r = one(
    db,
    "select t from sync_clock where kind = ? and uid = ? and field = 'created_at'",
    kind,
    uid,
  );
  return r ? Number(r.t) : 0;
}

/** 이 기기의 모든 항목을 보낼 목록에 넣는다 (처음 켤 때와 서버 사본이 바뀐 뒤 다시 올릴 때: 합집합). 넣은 줄 수 */
export function enqueueAll(db: Db): number {
  const before = outboxCount(db);
  db.exec(`
    insert or ignore into sync_outbox (kind, uid) select 'todo', uid from todo where uid is not null;
    insert or ignore into sync_outbox (kind, uid) select 'todo_step', uid from todo_step where uid is not null;
    insert or ignore into sync_outbox (kind, uid) select 'note', uid from note where uid is not null;
    insert or ignore into sync_outbox (kind, uid)
      select 'event', uid from event
        where uid is not null and source = 'local'
          and (repeat_series is null or repeat_series = id or user_edited = 1 or track = 1 or deleted_at is not null);
    delete from sync_outbox where (kind, uid) in (
      select s.kind, s.uid from sync_skip s
        where not exists (select 1 from sync_clock c where c.kind = s.kind and c.uid = s.uid and c.t > s.at));
  `);
  return outboxCount(db) - before;
}

/** 이 컴퓨터의 모든 항목을 이 계정에 올리지 않기로 한다: 보낼 목록을 비우고 표시를 남긴다 (이후 새로 고친 항목은 올라간다) */
export function skipAll(db: Db, now: number): void {
  db.exec('delete from sync_outbox');
  for (const [kind, where] of [
    ['todo', 'uid is not null'],
    ['todo_step', 'uid is not null'],
    ['note', 'uid is not null'],
    ['event', "uid is not null and source = 'local'"],
  ] as const)
    run(
      db,
      `insert or replace into sync_skip (kind, uid, at) select '${kind}', uid, ? from ${kind} where ${where}`,
      now,
    );
}

export const skipDrop = (db: Db, kind: SyncKind, uid: string): void => {
  run(db, 'delete from sync_skip where kind = ? and uid = ?', kind, uid);
};
