import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { gcalHash } from './gcal.ts';
import { cleanChoice } from './gcal-cals.ts';
import { cleanTodoPrefs, parseGcalPrefs } from './gcal-prefs.ts';
import { todoToGoogle } from './gcal-todo.ts';
import { GcalTodoStore } from './gcal-todo-store.ts';
import { TodoStore } from './todo-store.ts';

const TZ = 'Asia/Seoul';
const TODAY = '2026-10-10';
const NOW = Date.UTC(2026, 9, 10, 0);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test('바꾸기 표: 날짜만은 종일, 시각이 있으면 30분, 밤 11시 50분은 다음 날로 넘어간다', () => {
  const o = { tz: TZ, today: TODAY };
  const day = todoToGoogle({ title: '청소', due: '2026-10-31', dueMin: null }, o);
  assert.deepEqual([day.start, day.end], [{ date: '2026-10-31' }, { date: '2026-11-01' }]);
  const timed = todoToGoogle({ title: '회의', due: '2026-10-12', dueMin: 9 * 60 }, o);
  assert.deepEqual(
    [timed.start, timed.end],
    [
      { dateTime: '2026-10-12T09:00:00', timeZone: TZ },
      { dateTime: '2026-10-12T09:30:00', timeZone: TZ },
    ],
  );
  const late = todoToGoogle({ title: '야식', due: '2026-12-31', dueMin: 23 * 60 + 50 }, o);
  assert.deepEqual(
    [late.start, late.end],
    [
      { dateTime: '2026-12-31T23:50:00', timeZone: TZ },
      { dateTime: '2027-01-01T00:20:00', timeZone: TZ },
    ],
  );
  // 오늘 마감은 밀린 것이 아니다
  const today = todoToGoogle({ title: '오늘', due: TODAY, dueMin: 600 }, o);
  assert.deepEqual(today.start, { dateTime: '2026-10-10T10:00:00', timeZone: TZ });
});

test('바꾸기 표: 알림은 넣지 않고(useDefault false, 빈 목록), 표식 jjakkung 과 fairyKind 가 붙고, 제목은 그대로', () => {
  const b = todoToGoogle({ title: '제목 그대로', due: '2026-10-12', dueMin: null }, { tz: TZ, today: TODAY });
  assert.equal(b.summary, '제목 그대로');
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [] });
  assert.equal(b.status, 'confirmed');
  assert.deepEqual(b.extendedProperties, { private: { jjakkung: '1', fairyKind: 'todo' } });
});

test('바꾸기 표: 밀린 할 일은 시각이 있어도 오늘 종일이고, 지문에 오늘이 들어 날마다 바뀐다. 앞으로 할 일의 지문은 안 바뀐다', () => {
  const late = { title: '밀림', due: '2026-10-05', dueMin: 600 };
  const a = todoToGoogle(late, { tz: TZ, today: '2026-10-10' });
  const b = todoToGoogle(late, { tz: TZ, today: '2026-10-11' });
  assert.deepEqual([a.start, a.end], [{ date: '2026-10-10' }, { date: '2026-10-11' }]);
  assert.notEqual(gcalHash(a), gcalHash(b));
  const future = { title: '나중', due: '2026-10-20', dueMin: 600 };
  assert.equal(
    gcalHash(todoToGoogle(future, { tz: TZ, today: '2026-10-10' })),
    gcalHash(todoToGoogle(future, { tz: TZ, today: '2026-10-11' })),
  );
  // 시간대가 다르면 지문이 다르다 (시각 일정)
  assert.notEqual(
    gcalHash(todoToGoogle(future, { tz: 'Asia/Seoul', today: TODAY })),
    gcalHash(todoToGoogle(future, { tz: 'America/New_York', today: TODAY })),
  );
});

test('25판: 24판 파일에 구글 칸 네 개와 무덤 표를 더하고 있던 할 일은 그대로', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 24)) db.exec(sql);
  db.exec("insert into todo (title, created_at) values ('옛 할 일', 1)");
  db.exec('pragma user_version = 24; commit');
  assert.deepEqual(migrate(db), { from: 24, to: SCHEMA_VERSION });
  const row = db
    .prepare('select title, google_id, google_cal, google_hash, google_uid from todo')
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    { title: '옛 할 일', google_id: null, google_cal: null, google_hash: null, google_uid: null },
  );
  assert.equal((db.prepare('select count(*) as n from gcal_tomb').get() as { n: number }).n, 0);
});

test('구글 칸 네 개만 바뀐 할 일은 sync_outbox 와 칸 시각에 들어가지 않는다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, utcDay);
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
  assert.ok(n('select count(*) as n from sync_outbox') > 0);
  db.exec('delete from sync_outbox; delete from sync_clock');
  db.prepare(
    "update todo set google_id = 'jjtabcde', google_cal = 'primary', google_hash = 'h', google_uid = 'u' where id = ?",
  ).run(t.id);
  db.prepare("update todo set google_hash = 'deleted', google_uid = null where id = ?").run(t.id);
  assert.equal(n('select count(*) as n from sync_outbox'), 0);
  assert.equal(n('select count(*) as n from sync_clock'), 0);
  // 맞추는 칸이 바뀌면 들어간다 (기준 확인)
  todos.update(t.id, { title: '일 (고침)' }, NOW);
  assert.ok(n('select count(*) as n from sync_outbox') > 0);
});

test('설정: todos 와 account 가 저장했다 다시 읽어도 남는다. 깨진 값은 꺼진 기본값', () => {
  const hash = 'a'.repeat(64);
  const saved = parseGcalPrefs({
    push: true,
    pull: true,
    calendarId: 'work@group.calendar.google.com',
    todos: { on: true, target: 'pick', calendarId: 'todo@group.calendar.google.com' },
    account: hash,
  });
  // 저장(JSON)했다 다시 읽는다: 알지 못하는 칸이라 사라지는 일이 없다
  const again = parseGcalPrefs(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(again, saved);
  assert.deepEqual(again.todos, { on: true, target: 'pick', calendarId: 'todo@group.calendar.google.com' });
  assert.equal(again.account, hash);
  assert.equal(again.calendarId, 'work@group.calendar.google.com');
  // 예전 파일(칸 없음)
  const old = parseGcalPrefs({ push: true });
  assert.deepEqual(old.todos, { on: false, target: 'pick', calendarId: null });
  assert.equal(old.account, null);
  assert.deepEqual(old.pullCals, ['primary']);
  // 깨진 값
  assert.deepEqual(cleanTodoPrefs({ on: 'yes', target: 'x', calendarId: '남의 글 ../' }), {
    on: false,
    target: 'pick',
    calendarId: null,
  });
  assert.equal(parseGcalPrefs({ account: '메일@주소.com' }).account, null);
  assert.deepEqual(parseGcalPrefs(undefined).todos, defaultOff());
  assert.deepEqual(cleanTodoPrefs({ target: 'fairy', calendarId: 'primary' }).calendarId, 'primary');
});

const defaultOff = () => ({ on: false, target: 'pick', calendarId: null });

test('페어리가 만든 할 일 캘린더는 가져오기와 보내기 고르기에서 빠진다', () => {
  const x = 'todos@group.calendar.google.com';
  assert.deepEqual(cleanChoice({ pull: ['primary', x], push: 'primary' }, null, x), {
    pull: ['primary'],
    push: 'primary',
  });
  assert.equal(cleanChoice({ pull: ['primary'], push: x }, null, x), undefined);
  // 빼지 않으면 그대로
  assert.deepEqual(cleanChoice({ pull: [x], push: x }, null)?.pull, [x]);
});

test('보낼 것 고르기: 올릴 것, 지울 것, 이미 지운 것', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, utcDay);
  const store = new GcalTodoStore(db);
  const fresh = todos.add({ title: '새 할 일', due: '2026-10-12' }, NOW);
  todos.add({ title: '날짜 없음' }, NOW);
  todos.add({ title: '아주 옛날', due: '2026-08-01' }, NOW);
  const ops = store.pending(NOW, 'primary', TZ);
  assert.deepEqual(
    ops.map((o) => [o.kind, o.eventId]),
    [['upsert', fresh.id]],
  );
  // 올린 적 있는 옛 할 일은 범위와 상관없이 따라간다, 끝낸 것은 지우기, 이미 지운 것은 없음
  const old = (db.prepare("select id from todo where title = '아주 옛날'").get() as { id: number }).id;
  store.assignId(old, 'jjtold00', 'primary');
  store.markSent(old, 'h', 'jjtold00@google.com');
  assert.ok(store.pending(NOW, 'primary', TZ).some((o) => o.eventId === old && o.kind === 'upsert'));
  todos.complete(old, NOW);
  assert.ok(store.pending(NOW, 'primary', TZ).some((o) => o.eventId === old && o.kind === 'delete'));
  store.markDeleted(old);
  assert.ok(!store.pending(NOW, 'primary', TZ).some((o) => o.eventId === old));
});
