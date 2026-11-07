import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { EventStore, repairEventTimes } from './event-store.ts';
import { NoteStore } from './note-store.ts';
import {
  SYNC_EXCLUDED_FIELDS,
  SYNC_FIELDS,
  SYNC_KINDS,
  SYNC_META_APPLYING,
  SYNC_VIRTUAL_FIELDS,
} from './sync-fields.ts';
import { clearStaleApplying, quietly } from './sync-quiet.ts';
import { copiedStepUid, eventSlotUid, nextTodoUid, repairDerivedEventUids, sha256Hex } from './sync-uid.ts';
import { TodoStore } from './todo-store.ts';

// 24판 동기화 바탕 (docs/sync-plan.md 4절): uid, 칸 시각, 보낼 목록, 영구 삭제 표식
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 9, 0);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const mem = (): Db => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return db;
};
const n = (db: Db, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
const fields = (db: Db, kind: string, uid: string) =>
  (
    db.prepare('select field from sync_clock where kind = ? and uid = ? order by field').all(kind, uid) as {
      field: string;
    }[]
  ).map((r) => r.field);
const uidOf = (db: Db, table: string, id: number) =>
  (db.prepare(`select uid from ${table} where id = ?`).get(id) as { uid: string }).uid;
const clear = (db: Db) => db.exec('delete from sync_clock; delete from sync_outbox; delete from sync_tomb');
const outbox = (db: Db) =>
  (
    db.prepare('select kind, uid from sync_outbox order by kind, uid').all() as {
      kind: string;
      uid: string;
    }[]
  ).map((r) => `${r.kind}:${r.uid}`);

test('23판 파일(행 있음)에서 24판으로 올리면 모든 행에 uid 가 채워지고 겹치지 않는다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 23)) db.exec(sql);
  db.exec('pragma user_version = 23; commit');
  for (let i = 0; i < 50; i++) {
    db.prepare('insert into todo (title, created_at) values (?, 0)').run(`할 일 ${i}`);
    db.prepare('insert into todo_step (todo_id, title, ord, created_at) values (1, ?, ?, 0)').run(
      `단계 ${i}`,
      i,
    );
    db.prepare('insert into note (title, created_at, updated_at) values (?, 0, 0)').run(`메모 ${i}`);
    db.prepare('insert into event (title, start_at, created_at, source) values (?, 1, 0, ?)').run(
      `일정 ${i}`,
      i % 2 ? 'ics' : 'local',
    );
  }
  assert.deepEqual(migrate(db), { from: 23, to: SCHEMA_VERSION });
  assert.ok(SCHEMA_VERSION >= 24);
  for (const t of ['todo', 'todo_step', 'note', 'event']) {
    assert.equal(n(db, `select count(*) n from ${t}`), 50);
    assert.equal(
      n(db, `select count(distinct uid) n from ${t} where uid glob '[0-9a-f]*' and length(uid) = 32`),
      50,
      t,
    );
  }
  assert.throws(() => db.exec('update todo set uid = (select uid from todo where id = 2) where id = 1'));
  // 올리기만으로는 칸 시각, 보낼 목록, 삭제 표식이 생기지 않는다 (첫 동기화가 전부 올린다)
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);
  assert.equal(n(db, 'select count(*) n from sync_tomb'), 0);
  // 기기 번호는 저장 파일 안에 두지 않는다 (백업을 되살리면 복제된다)
  assert.equal(n(db, "select count(*) n from app_meta where key = 'sync_dev'"), 0);
  assert.equal(n(db, "select count(*) n from pragma_table_info('sync_clock') where name = 'dev'"), 0);
});

test('새 행의 uid 는 트리거가 채우고, 직접 준 uid 는 그대로 둔다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const t = todos.add({ title: '가' }, NOW);
  assert.match(uidOf(db, 'todo', t.id), /^[0-9a-f]{32}$/);
  db.prepare("insert into note (uid, title, created_at, updated_at) values ('abc', 'x', 0, 0)").run();
  assert.equal(n(db, "select count(*) n from note where uid = 'abc'"), 1);
  // lastInsertRowid 는 트리거 안 쓰기에 흔들리지 않는다
  const r = db.prepare('insert into note (title, created_at, updated_at) values (?, 0, 0)').run('y');
  assert.equal(uidOf(db, 'note', Number(r.lastInsertRowid)).length, 32);
});

test('다른 연결(MCP 흉내)이 같은 파일에 써도 칸 시각과 보낼 목록에 잡힌다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-sync-'));
  try {
    const file = join(dir, 'a.db');
    const a = new DatabaseSync(file);
    a.exec('pragma journal_mode = wal; pragma busy_timeout = 300;');
    migrate(a as unknown as Db);
    const b = new DatabaseSync(file);
    b.exec('pragma busy_timeout = 300;');
    const viaApp = new NoteStore(a as unknown as Db).add({ title: '앱' }, NOW);
    const viaMcp = new NoteStore(b as unknown as Db).add({ title: 'MCP' }, NOW);
    new TodoStore(b as unknown as Db, utcDay).add({ title: 'MCP 할 일' }, NOW);
    const db = a as unknown as Db;
    assert.equal(n(db, "select count(*) n from sync_outbox where kind = 'note'"), 2);
    assert.equal(n(db, "select count(*) n from sync_outbox where kind = 'todo'"), 1);
    const uid = uidOf(db, 'note', viaMcp.id);
    assert.ok(fields(db, 'note', uid).includes('title'));
    // MCP 연결이 고쳐도 앱 연결이 본다
    new NoteStore(b as unknown as Db).update(viaApp.id, { title: '고침' }, NOW + 5);
    assert.equal(
      n(db, 'select t n from sync_clock where field = ? and uid = ?', 'title', uidOf(db, 'note', viaApp.id)) >
        0,
      true,
    );
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('칸이 실제로 바뀔 때만 그 칸 시각을 적고, 같은 값 update 는 아무것도 적지 않는다', () => {
  const db = mem();
  const notes = new NoteStore(db);
  const note = notes.add({ title: '가', body: '본문' }, NOW);
  const uid = uidOf(db, 'note', note.id);
  clear(db);
  db.prepare('update note set title = title, body = ?, pinned_at = null where id = ?').run('본문', note.id);
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);
  db.prepare("update note set title = '나', body = body where id = ?").run(note.id);
  assert.deepEqual(fields(db, 'note', uid), ['title']);
  assert.deepEqual(outbox(db), [`note:${uid}`]);
  // 같은 칸을 또 바꾸면 시각이 앞으로만 간다
  const t1 = n(db, "select t n from sync_clock where field = 'title'");
  db.prepare("update note set title = '다' where id = ?").run(note.id);
  assert.ok(n(db, "select t n from sync_clock where field = 'title'") > t1);
  // 맞추지 않는 칸만 바뀌면 아무것도 적지 않는다
  const todos = new TodoStore(db, utcDay);
  const todo = todos.add({ title: '할 일' }, NOW);
  clear(db);
  db.prepare('update todo set auto_removed = 1 where id = ?').run(todo.id);
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);
  const ev = new EventStore(db).add({ title: '일정', startAt: NOW + DAY }, NOW);
  clear(db);
  db.prepare('update event set notified_at = 5, google_hash = ?, remind_min = 3 where id = ?').run(
    'h',
    ev.id,
  );
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  db.prepare('update reminder set notified_at = 9 where kind = ? and ref_id = ?').run('event', ev.id);
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
});

test('sync_applying 이 1 이면 어떤 쓰기도 칸 시각, 보낼 목록, 삭제 표식을 남기지 않는다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const ev = new EventStore(db);
  const a = todos.add({ title: '가' }, NOW);
  const e = ev.add({ title: '일정', startAt: NOW + DAY, repeat: 'daily' }, NOW);
  clear(db);
  db.exec(`insert or replace into app_meta (key, value) values ('${SYNC_META_APPLYING}', '1')`);
  todos.add({ title: '나' }, NOW);
  todos.update(a.id, { title: '고침' }, NOW);
  todos.addStep(a.id, '단계', NOW);
  db.prepare("insert into reminder (kind, ref_id, before_min) values ('todo', ?, 30)").run(a.id);
  ev.update(e.id, { title: '고침' }, NOW);
  db.prepare('insert into event_repeat_skip (series_id, start_at) values (?, 1)').run(e.id);
  new NoteStore(db).add({ title: '메모' }, NOW);
  todos.remove(a.id, NOW);
  todos.purge([a.id]);
  db.prepare('delete from todo_step').run();
  for (const t of ['sync_clock', 'sync_outbox', 'sync_tomb'])
    assert.equal(n(db, `select count(*) n from ${t}`), 0, t);
  // 새 행의 uid 는 적용 중에도 채워진다
  assert.equal(n(db, 'select count(*) n from todo where uid is null'), 0);
  db.exec(`update app_meta set value = '0' where key = '${SYNC_META_APPLYING}'`);
  todos.add({ title: '다' }, NOW);
  assert.ok(n(db, 'select count(*) n from sync_outbox') > 0);
});

test('영구 삭제와 휴지통 비우기와 만료가 삭제 표식과 보낼 목록을 남긴다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const notes = new NoteStore(db);
  const events = new EventStore(db);
  // 할 일: 단계와 알림이 딸린 채 만료
  const t1 = todos.add({ title: '만료' }, NOW);
  todos.addStep(t1.id, '단계', NOW);
  const t1uid = uidOf(db, 'todo', t1.id);
  const stepUid = uidOf(
    db,
    'todo_step',
    Number((db.prepare('select id from todo_step').get() as { id: number }).id),
  );
  todos.remove(t1.id, NOW);
  const n1 = notes.add({ title: '메모 만료' }, NOW);
  const n1uid = uidOf(db, 'note', n1.id);
  notes.remove(n1.id, NOW);
  const e1 = events.add({ title: '일정 만료', startAt: NOW + DAY }, NOW);
  const e1uid = uidOf(db, 'event', e1.id);
  events.remove(e1.id, NOW);
  clear(db);
  const later = NOW + 40 * DAY;
  db.prepare('insert into daily_stat (day, on_min) values (?, 1)').run(utcDay(later));
  assert.equal(todos.purgeExpired(later), 1);
  assert.equal(notes.purgeExpired(later), 1);
  assert.equal(events.purgeExpired(later), 1);
  const tombs = db.prepare('select kind, uid, t from sync_tomb order by kind').all() as {
    kind: string;
    uid: string;
    t: number;
  }[];
  assert.deepEqual(tombs.map((r) => `${r.kind}:${r.uid}`).sort(), [
    `event:${e1uid}`,
    `note:${n1uid}`,
    `todo:${t1uid}`,
    `todo_step:${stepUid}`,
  ]);
  assert.ok(tombs.every((r) => r.t > 1_700_000_000_000));
  for (const k of [`event:${e1uid}`, `note:${n1uid}`, `todo:${t1uid}`, `todo_step:${stepUid}`])
    assert.ok(outbox(db).includes(k), k);

  // 휴지통 비우기와 단계 하나 지우기
  const t2 = todos.add({ title: '비우기' }, NOW);
  const s2 = todos.addStep(t2.id, '단계2', NOW);
  todos.removeStep(s2?.id ?? 0);
  assert.equal(n(db, "select count(*) n from sync_tomb where kind = 'todo_step'"), 2);
  todos.remove(t2.id, NOW);
  clear(db);
  assert.equal(todos.emptyTrash(), 1);
  assert.equal(n(db, "select count(*) n from sync_tomb where kind = 'todo'"), 1);
  const n2 = notes.add({ title: 'n' }, NOW);
  notes.remove(n2.id, NOW);
  notes.purge();
  assert.equal(n(db, "select count(*) n from sync_tomb where kind = 'note'"), 1);
});

test('구글과 ics 일정, 펼친 반복 회차는 기록하지 않고, user_edited 가 되는 순간 추적을 시작한다', () => {
  const db = mem();
  const events = new EventStore(db);
  db.prepare(
    "insert into event (title, start_at, created_at, source, external_id) values ('ics', 1, 0, 'ics', 'x')",
  ).run();
  db.prepare(
    "insert into event (title, start_at, created_at, source, external_id) values ('g', 1, 0, 'google', 'y')",
  ).run();
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);
  db.prepare("update event set title = 'ics2', pinned_at = 3, user_edited = 1 where source = 'ics'").run();
  db.prepare("delete from event where source = 'google'").run();
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  assert.equal(n(db, 'select count(*) n from sync_tomb'), 0);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);

  // 반복 일정: 원본은 추적, 펼친 회차는 추적하지 않는다
  const series = events.add({ title: '운동', startAt: NOW + DAY, repeat: 'daily' }, NOW);
  events.dueReminders(NOW);
  const instances = db
    .prepare('select id from event where repeat_series = ? and id <> ? order by start_at')
    .all(series.id, series.id) as { id: number }[];
  assert.ok(instances.length > 300);
  const originUid = uidOf(db, 'event', series.id);
  assert.deepEqual(outbox(db), [`event:${originUid}`]);
  assert.equal(n(db, "select count(*) n from sync_clock where kind = 'event' and uid <> ?", originUid), 0);
  assert.ok(fields(db, 'event', originUid).includes('template'));
  assert.ok(fields(db, 'event', originUid).includes('reminders'));
  assert.ok(fields(db, 'event', originUid).includes('repeat_series'));

  // 펼친 회차의 알림 시각과 건너뛰기가 아닌 변경은 기록하지 않는다
  const first = instances[0]?.id ?? 0;
  db.prepare("update reminder set before_min = 5 where kind = 'event' and ref_id = ?").run(first);
  db.prepare('update event set notified_at = 1 where id = ?').run(first);
  assert.deepEqual(outbox(db), [`event:${originUid}`]);

  // 사용자가 한 회차를 고치면(user_edited = 1) 그 순간부터 추적한다
  clear(db);
  events.update(first, { title: '특별 운동' }, NOW);
  const row = db.prepare('select user_edited u, uid from event where id = ?').get(first) as {
    u: number;
    uid: string;
  };
  assert.equal(row.u, 1);
  assert.deepEqual(outbox(db), [`event:${row.uid}`]);
  const got = fields(db, 'event', row.uid);
  for (const f of SYNC_FIELDS.event) assert.ok(got.includes(f), f);
  assert.ok(got.includes('reminders'));
  clear(db);
  events.update(first, { title: '특별 운동 2' }, NOW);
  assert.deepEqual(fields(db, 'event', row.uid), ['title']);
  // 고친 회차를 지우고 영구 삭제하면 표식이 남는다
  clear(db);
  events.remove(first, NOW);
  events.purgeTrash(first, NOW);
  assert.equal(n(db, "select count(*) n from sync_tomb where kind = 'event'"), 1);
  const plain = instances[1]?.id ?? 0;
  clear(db);
  events.remove(plain, NOW);
  events.purgeTrash(plain, NOW);
  // 휴지통으로 보낸 회차는 추적 대상이라 영구 삭제하면 표식이 남고, 건너뛰기 목록도 바뀐다
  assert.equal(n(db, "select count(*) n from sync_tomb where kind = 'event'"), 1);
  assert.deepEqual(fields(db, 'event', originUid), ['skips']);
});

test('반복 템플릿과 건너뛰기, 알림 변경은 부모를 보낼 목록에 넣고 template, skips, reminders 칸 시각을 적는다', () => {
  const db = mem();
  const events = new EventStore(db);
  const todos = new TodoStore(db, utcDay);
  const origin = events.add({ title: '반복', startAt: NOW + DAY, repeat: 'weekly' }, NOW);
  const ouid = uidOf(db, 'event', origin.id);
  clear(db);
  db.prepare("update event_repeat_template set title = '새 제목' where series_id = ?").run(origin.id);
  assert.deepEqual(fields(db, 'event', ouid), ['template']);
  assert.deepEqual(outbox(db), [`event:${ouid}`]);
  clear(db);
  db.prepare("update event_repeat_template set title = '새 제목' where series_id = ?").run(origin.id);
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
  db.prepare('insert into event_repeat_skip (series_id, start_at) values (?, 123)').run(origin.id);
  assert.deepEqual(fields(db, 'event', ouid), ['skips']);
  clear(db);
  db.prepare('delete from event_repeat_skip where series_id = ?').run(origin.id);
  assert.deepEqual(fields(db, 'event', ouid), ['skips']);

  const t = todos.add({ title: '할 일' }, NOW);
  const tuid = uidOf(db, 'todo', t.id);
  clear(db);
  db.prepare("insert into reminder (kind, ref_id, before_min) values ('todo', ?, 77)").run(t.id);
  assert.deepEqual(fields(db, 'todo', tuid), ['reminders']);
  assert.deepEqual(outbox(db), [`todo:${tuid}`]);
  clear(db);
  db.prepare(
    "update reminder set before_min = 78 where kind = 'todo' and ref_id = ? and before_min = 77",
  ).run(t.id);
  assert.deepEqual(fields(db, 'todo', tuid), ['reminders']);
  clear(db);
  db.prepare("delete from reminder where kind = 'todo' and ref_id = ? and before_min = 78").run(t.id);
  assert.deepEqual(outbox(db), [`todo:${tuid}`]);
  // 일정 알림: 부모 일정이 구글 것이면 기록하지 않는다
  db.prepare("insert into event (title, start_at, created_at, source) values ('g', 1, 0, 'google')").run();
  const gid = Number((db.prepare("select id from event where source = 'google'").get() as { id: number }).id);
  clear(db);
  db.prepare("insert into reminder (kind, ref_id, before_min) values ('event', ?, 10)").run(gid);
  assert.equal(n(db, 'select count(*) n from sync_clock'), 0);
});

test('sync-fields.ts 의 칸 목록이 트리거가 실제로 적는 칸과 같다', () => {
  for (const kind of SYNC_KINDS) {
    const db = mem();
    const make = (): number => {
      if (kind === 'todo')
        return Number(
          db.prepare("insert into todo (title, created_at) values ('a', 0)").run().lastInsertRowid,
        );
      if (kind === 'todo_step')
        return Number(
          db.prepare("insert into todo_step (todo_id, title, ord, created_at) values (1, 'a', 0, 0)").run()
            .lastInsertRowid,
        );
      if (kind === 'note')
        return Number(
          db.prepare("insert into note (title, created_at, updated_at) values ('a', 0, 0)").run()
            .lastInsertRowid,
        );
      return Number(
        db.prepare("insert into event (title, start_at, created_at) values ('a', 1, 0)").run()
          .lastInsertRowid,
      );
    };
    const cols = (db.prepare(`pragma table_info(${kind})`).all() as { name: string }[]).map((c) => c.name);
    const known = new Set([...SYNC_FIELDS[kind], ...SYNC_EXCLUDED_FIELDS[kind], 'uid']);
    assert.deepEqual(
      cols.filter((c) => !known.has(c)),
      [],
      `${kind}: 목록에 없는 칸`,
    );
    assert.deepEqual(
      SYNC_FIELDS[kind].filter((f) => !cols.includes(f)),
      [],
      `${kind}: 없는 칸`,
    );
    const id = make();
    const uid = uidOf(db, kind, id);
    // 새 행은 모든 칸 시각을 적는다
    assert.deepEqual(
      fields(db, kind, uid),
      [...SYNC_FIELDS[kind], ...(kind === 'event' ? ['reminders'] : [])].sort(),
    );
    for (const f of SYNC_FIELDS[kind]) {
      clear(db);
      db.prepare(
        `update ${kind} set ${f} = case when typeof(${f}) = 'text' then ${f} || 'x' else coalesce(${f}, 0) + 1 end where id = ?`,
      ).run(id);
      assert.deepEqual(fields(db, kind, uid), [f], `${kind}.${f}`);
    }
    for (const f of SYNC_EXCLUDED_FIELDS[kind]) {
      if (f === 'id') continue;
      clear(db);
      db.prepare(
        `update ${kind} set ${f} = case when typeof(${f}) = 'text' then ${f} || 'x' else coalesce(${f}, 0) + 1 end where id = ?`,
      ).run(id);
      assert.deepEqual(fields(db, kind, uid), [], `${kind}.${f} 는 맞추지 않는다`);
    }
    assert.ok(SYNC_VIRTUAL_FIELDS[kind].every((f) => typeof f === 'string'));
  }
});

test('1년치 반복 회차를 만들어도 칸 시각은 늘지 않고 시간도 크게 늘지 않는다', () => {
  const run = (triggers: boolean) => {
    const db = mem();
    if (!triggers) {
      const names = db
        .prepare("select name from sqlite_master where type = 'trigger' and name like 'sync_%'")
        .all() as { name: string }[];
      for (const r of names) db.exec(`drop trigger ${r.name}`);
    }
    const events = new EventStore(db);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) events.add({ title: `반복 ${i}`, startAt: NOW + DAY, repeat: 'daily' }, NOW);
    events.dueReminders(NOW);
    return { ms: performance.now() - t0, rows: n(db, 'select count(*) n from event'), db };
  };
  const before = run(false);
  const after = run(true);
  assert.equal(before.rows, after.rows);
  assert.ok(after.rows > 20 * 360);
  assert.equal(n(after.db, "select count(*) n from sync_clock where kind = 'event'") < 20 * 30, true);
  console.log(
    `반복 20개 x 1년(${after.rows}행): 트리거 없이 ${before.ms.toFixed(0)}ms, 있으면 ${after.ms.toFixed(0)}ms`,
  );
  assert.ok(after.ms < before.ms * 8 + 300);
});

test('SHA-256 과 결정적 uid: node:crypto 와 같은 값, 32자리', () => {
  for (const text of [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    '한글:next',
    'x'.repeat(1000),
  ])
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), text.slice(0, 8));
  assert.equal(nextTodoUid('abc'), createHash('sha256').update('abc:next').digest('hex').slice(0, 32));
  assert.equal(eventSlotUid('s', 5), createHash('sha256').update('s:5').digest('hex').slice(0, 32));
  assert.equal(copiedStepUid('n', 'o'), createHash('sha256').update('n:o').digest('hex').slice(0, 32));
});

test('24판 올리기: coin_paid 는 코인을 받은 할 일만 1, slot 은 펼친 회차만', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 23)) db.exec(sql);
  db.exec('pragma user_version = 23; commit');
  db.prepare(
    "insert into todo (id, title, created_at, coins) values (1, '코인', 0, 10), (2, '장부', 0, 0), (3, '없음', 0, 0)",
  ).run();
  db.prepare("insert into todo (id, title, created_at, coins) values (4, '환불', 0, 0)").run();
  db.prepare(
    "insert into coin_log (amount, reason, ref_id, day, at) values (10, 'todo', 1, '2026-01-01', 0), (10, 'todo', 2, '2026-01-01', 0), (5, 'todo', 4, '2026-01-01', 0), (-5, 'undo', 4, '2026-01-01', 1)",
  ).run();
  db.prepare(
    "insert into event (id, title, start_at, created_at, repeat_series) values (1, '원본', 100, 0, 1), (2, '회차', 200, 0, 1), (3, '단발', 300, 0, null)",
  ).run();
  migrate(db);
  const paid = db.prepare('select id, coin_paid p from todo order by id').all() as {
    id: number;
    p: number;
  }[];
  assert.deepEqual(
    paid.map((r) => r.p),
    [1, 1, 0, 0],
  );
  const slots = db.prepare('select id, slot from event order by id').all() as {
    id: number;
    slot: number | null;
  }[];
  assert.deepEqual(
    slots.map((r) => r.slot),
    [null, 200, null],
  );
  // 낡은 무작위 uid 를 시리즈 uid + slot 의 값으로 바꾼다 (한 번만)
  const origin = uidOf(db, 'event', 1);
  assert.equal(repairDerivedEventUids(db), 1);
  assert.equal(uidOf(db, 'event', 2), eventSlotUid(origin, 200));
  assert.equal(repairDerivedEventUids(db), 0);
});

test('coin_paid 는 맞추는 칸이다: 끝내서 코인을 받으면 1 이 되고 칸 시각이 적힌다. 환불하면 0 이다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const t = todos.add({ title: '가', due: utcDay(NOW) }, NOW);
  clear(db);
  assert.ok(todos.complete(t.id, NOW) > 0);
  assert.equal(n(db, 'select coin_paid n from todo where id = ?', t.id), 1);
  assert.ok(fields(db, 'todo', uidOf(db, 'todo', t.id)).includes('coin_paid'));
  assert.ok(!fields(db, 'todo', uidOf(db, 'todo', t.id)).includes('coins'));
  todos.undo(t.id, NOW);
  assert.equal(n(db, 'select coin_paid n from todo where id = ?', t.id), 0);
});

test('반복 할 일: 끝냄, 되돌림, 다시 끝냄에서 다음 회차는 하나, uid 는 이전 회차에서 정해진다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const t = todos.add({ title: '매일', due: utcDay(NOW), repeat: 'daily' }, NOW);
  todos.addStep(t.id, '단계 하나', NOW);
  todos.addStep(t.id, '단계 둘', NOW);
  const uid = uidOf(db, 'todo', t.id);
  todos.complete(t.id, NOW);
  assert.equal(n(db, 'select count(*) n from todo'), 2);
  const next = Number((db.prepare('select id from todo where repeat_of = ?').get(t.id) as { id: number }).id);
  assert.equal(uidOf(db, 'todo', next), nextTodoUid(uid));
  const stepUids = (id: number) =>
    (db.prepare('select uid from todo_step where todo_id = ? order by ord').all(id) as { uid: string }[]).map(
      (r) => r.uid,
    );
  const src = stepUids(t.id);
  assert.deepEqual(
    stepUids(next),
    src.map((u) => copiedStepUid(nextTodoUid(uid), u)),
  );
  for (let i = 0; i < 3; i++) {
    todos.undo(t.id, NOW + 1);
    assert.equal(n(db, 'select count(*) n from todo where deleted_at is not null'), 1);
    todos.complete(t.id, NOW + 2);
    assert.equal(n(db, 'select count(*) n from todo'), 2, `${i}번째`);
    assert.equal(n(db, 'select count(*) n from todo where deleted_at is null and done_at is null'), 1);
    assert.equal(n(db, 'select count(*) n from todo_step'), 4);
  }
  // 사람이 지운 다음 회차도 다시 끝내면 되살린다
  todos.undo(t.id, NOW + 3);
  db.prepare('update todo set auto_removed = 0 where id = ?').run(next);
  todos.complete(t.id, NOW + 4);
  assert.equal(n(db, 'select count(*) n from todo'), 2);
  assert.equal(n(db, 'select count(*) n from todo where deleted_at is null'), 2);
});

test('기계적 고침은 칸 시각을 올리지 않는다: 시계 점프 보정, 반복 기준 시각, 일정 시각 고침', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const events = new EventStore(db);
  const t = todos.add({ title: '가' }, NOW);
  todos.remove(t.id, NOW + 10 * DAY); // 미래에 지운 것으로 적힌 행
  const e = events.add({ title: '매일', startAt: NOW + DAY, repeat: 'daily' }, NOW);
  db.prepare('update event set repeat_clock = null where repeat_series = ?').run(e.id);
  db.prepare("insert into event (title, start_at, created_at) values ('이상', 99999999999999999, 0)").run();
  clear(db);
  todos.purgeExpired(NOW);
  events.dueReminders(NOW);
  repairEventTimes(db, NOW);
  assert.equal(
    n(
      db,
      "select count(*) n from sync_clock where kind = 'event' and field in ('repeat_clock', 'deleted_at', 'end_at')",
    ),
    0,
  );
  assert.equal(n(db, "select count(*) n from sync_clock where kind = 'todo'"), 0);
  assert.ok(n(db, 'select deleted_at n from todo where id = ?', t.id) <= NOW);
});

test('quietly: 표식은 같은 묶음 안에서만 켜지고, 실패하면 되돌아가며, 낡은 표식은 지운다', () => {
  const db = mem();
  const notes = new NoteStore(db);
  assert.throws(() =>
    quietly(db, () => {
      notes.add({ title: '조용' }, NOW);
      throw new Error('실패');
    }),
  );
  assert.equal(n(db, 'select count(*) n from note'), 0);
  assert.equal(n(db, "select count(*) n from app_meta where key = 'sync_applying'"), 0);
  quietly(db, () => {
    notes.add({ title: '조용' }, NOW);
    quietly(db, () => notes.add({ title: '안쪽' }, NOW));
    notes.add({ title: '바깥' }, NOW); // 안쪽이 끝나도 아직 조용하다
  });
  assert.equal(n(db, 'select count(*) n from note'), 3);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 0);
  assert.equal(n(db, "select count(*) n from app_meta where key = 'sync_applying'"), 0);
  db.exec("insert into app_meta (key, value) values ('sync_applying', '1')");
  assert.equal(clearStaleApplying(db), true);
  assert.equal(clearStaleApplying(db), false);
  notes.add({ title: '다시 기록' }, NOW);
  assert.equal(n(db, 'select count(*) n from sync_outbox'), 1);
});

test('23판에서 휴지통 회차와 옮긴 회차가 같은 시각이어도 uid 보정이 끝까지 간다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 23)) db.exec(sql);
  db.exec('pragma user_version = 23; commit');
  const ie = db.prepare(
    "insert into event (title, start_at, created_at, repeat_kind, repeat_series, repeat_clock, user_edited, deleted_at, removed_by) values (?, ?, 0, 'daily', ?, 0, ?, ?, ?)",
  );
  const o = Number(ie.run('r', NOW, null, 0, null, null).lastInsertRowid);
  db.prepare('update event set repeat_series = ? where id = ?').run(o, o);
  ie.run('r', NOW + 2 * DAY, o, 0, NOW, 'user');
  ie.run('r', NOW + 2 * DAY, o, 1, null, null);
  ie.run('r', NOW + 3 * DAY, o, 0, NOW, 'user');
  ie.run('r', NOW + 3 * DAY, o, 0, NOW, 'user');
  migrate(db);
  // 산 행이 slot 을 갖고, 같은 자리의 휴지통 행 중에는 하나만 갖는다
  assert.equal(n(db, 'select count(*) n from event where slot = ? and deleted_at is null', NOW + 2 * DAY), 1);
  assert.equal(n(db, 'select count(*) n from event where slot = ?', NOW + 2 * DAY), 1);
  assert.equal(n(db, 'select count(*) n from event where slot = ?', NOW + 3 * DAY), 1);
  assert.equal(repairDerivedEventUids(db), 2);
  assert.equal(n(db, "select count(*) n from app_meta where key = 'event_uid_derived'"), 1);
});

test('uid 보정은 uid 가 겹치는 한 줄이 있어도 나머지를 끝까지 하고 표식을 세운다', () => {
  const db = mem();
  const events = new EventStore(db);
  const s = events.add({ title: '매일', startAt: NOW + DAY, repeat: 'daily' }, NOW);
  events.dueReminders(NOW);
  const ids = db
    .prepare('select id, slot from event where repeat_series = ? and id <> ? order by id limit 3')
    .all(s.id, s.id) as { id: number; slot: number }[];
  const origin = uidOf(db, 'event', s.id);
  db.prepare('update event set uid = ? where id = ?').run('zz', ids[0]?.id);
  db.prepare('update event set uid = ? where id = ?').run(
    eventSlotUid(origin, ids[0]?.slot ?? 0),
    ids[1]?.id,
  );
  db.exec("delete from app_meta where key = 'event_uid_derived'");
  assert.doesNotThrow(() => repairDerivedEventUids(db));
  assert.equal(n(db, "select count(*) n from app_meta where key = 'event_uid_derived'"), 1);
  assert.equal(uidOf(db, 'event', ids[2]?.id ?? 0), eventSlotUid(origin, ids[2]?.slot ?? 0));
});

test('영구 삭제한 다음 회차를 다시 만들면 같은 uid 의 삭제 표식이 사라진다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const a = todos.add({ title: 'a', repeat: 'daily', due: '2026-11-02' }, NOW);
  todos.complete(a.id, NOW);
  const nextId = () =>
    Number((db.prepare('select id from todo where repeat_of = ?').get(a.id) as { id: number }).id);
  const uid = uidOf(db, 'todo', nextId());
  todos.remove(nextId(), NOW);
  todos.purge([nextId()]);
  assert.equal(n(db, 'select count(*) n from sync_tomb where uid = ?', uid), 1);
  todos.undo(a.id, NOW + 1);
  todos.complete(a.id, NOW + 2);
  assert.equal(uidOf(db, 'todo', nextId()), uid);
  assert.equal(n(db, 'select count(*) n from sync_tomb where uid = ?', uid), 0);
  // 다른 기기 변경을 적용하는 중의 insert 는 표식을 건드리지 않는다
  db.prepare('insert into sync_tomb (kind, uid, t) values (?, ?, 1)').run('note', 'ff');
  quietly(db, () =>
    db.prepare("insert into note (uid, title, created_at, updated_at) values ('ff', 'x', 0, 0)").run(),
  );
  assert.equal(n(db, "select count(*) n from sync_tomb where uid = 'ff'"), 1);
});

test('펼친 회차를 고정하거나 알림만 바꿔도 그 회차를 추적하기 시작한다 (track)', () => {
  const db = mem();
  const events = new EventStore(db);
  const s = events.add({ title: '매일', startAt: NOW + DAY, repeat: 'daily' }, NOW);
  events.dueReminders(NOW);
  const occ = db
    .prepare('select id from event where repeat_series = ? and id <> ? order by start_at limit 3')
    .all(s.id, s.id) as { id: number }[];
  const [a, b, c] = [occ[0]?.id ?? 0, occ[1]?.id ?? 0, occ[2]?.id ?? 0];
  clear(db);
  events.pin(a, true, NOW);
  const auid = uidOf(db, 'event', a);
  assert.deepEqual(outbox(db), [`event:${auid}`]);
  for (const f of SYNC_FIELDS.event) assert.ok(fields(db, 'event', auid).includes(f), f);
  clear(db);
  events.update(b, { reminds: [30] }, NOW);
  const buid = uidOf(db, 'event', b);
  assert.deepEqual(outbox(db), [`event:${buid}`]);
  assert.ok(fields(db, 'event', buid).includes('reminders'));
  assert.equal(n(db, 'select count(*) n from sync_clock where uid = ?', uidOf(db, 'event', c)), 0);
  assert.equal(n(db, 'select track n from event where id = ?', c), 0);
});

test('되살릴 때는 사람이 휴지통에 넣은 다음 회차도 마감과 알림을 새로 센다', () => {
  const db = mem();
  const todos = new TodoStore(db, utcDay);
  const a = todos.add({ title: 'a', repeat: 'daily', due: '2026-11-02', dueMin: 600, reminds: [10] }, NOW);
  todos.complete(a.id, NOW);
  const next = Number((db.prepare('select id from todo where repeat_of = ?').get(a.id) as { id: number }).id);
  todos.remove(next, NOW + 1);
  todos.undo(a.id, NOW + 2);
  todos.complete(a.id, NOW + 3 * DAY);
  const row = db.prepare('select due, deleted_at d from todo where id = ?').get(next) as {
    due: string;
    d: number | null;
  };
  assert.equal(row.d, null);
  assert.equal(row.due, utcDay(NOW + 4 * DAY));
  assert.equal(n(db, 'select count(*) n from todo'), 2);
});

test('읽기 경로(dueReminders, between)는 반복 회차가 다 만들어진 뒤 아무것도 쓰지 않는다', () => {
  const db = mem();
  const events = new EventStore(db);
  for (let i = 0; i < 3; i++)
    events.add({ title: `매일 ${i}`, startAt: NOW + DAY + i * 3600_000, repeat: 'daily' }, NOW);
  events.dueReminders(NOW);
  events.between(NOW, NOW + 400 * DAY);
  const before = n(db, 'select total_changes() n');
  for (let i = 0; i < 5; i++) {
    events.dueReminders(NOW + i * 1000);
    events.between(NOW, NOW + 30 * DAY);
  }
  assert.equal(n(db, 'select total_changes() n') - before, 0);
});
