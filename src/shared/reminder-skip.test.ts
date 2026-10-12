// 때가 지나 쓸모없어진 알림은 넘긴 것으로 적어 15초마다 다시 고르지 않는다. 알릴 것 찾기는 질의 수가 항목 수와 상관없다 (감사 3차)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { EventStore } from './event-store.ts';
import { localDay, TodoStore } from './todo-store.ts';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 14, 9, 0);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** prepare 를 센다 */
function counted() {
  const raw = new DatabaseSync(':memory:') as unknown as Db;
  migrate(raw);
  const c = { n: 0 };
  const db: Db = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      c.n++;
      return raw.prepare(sql);
    },
  };
  return { db, c };
}

const pending = (db: Db, kind: string) =>
  Number(
    (
      db.prepare('select count(*) as n from reminder where kind = ? and notified_at is null').get(kind) as {
        n: number;
      }
    ).n,
  );

test('일정: 시작이 지나 쓸모없어진 알림은 처음 볼 때 넘긴 것으로 적는다', () => {
  const { db } = counted();
  const events = new EventStore(db);
  // 컴퓨터가 꺼져 있던 사이 시작한 일정 (알림을 아직 안 했다)
  const e = events.add({ title: '회의', startAt: NOW - 30 * MIN }, NOW - 2 * 60 * MIN);
  assert.equal(pending(db, 'event'), 1);
  assert.deepEqual(events.dueReminders(NOW), []);
  assert.equal(pending(db, 'event'), 0, '넘긴 것으로 적었다');
  assert.equal(events.get(e.id)?.notifiedAt, null, '말한 것은 아니다');
});

test('할 일: 마감일이 지난 날짜 알림도 넘긴 것으로 적는다', () => {
  const { db } = counted();
  const todos = new TodoStore(db, localDay);
  // 어제 마감 (현지 날짜. utcDay 면 서쪽 시간대에서 오늘이 되어 알림이 정말 울린다)
  todos.add({ title: '보고서', due: localDay(NOW - 86_400_000), reminds: [240] }, NOW - 3 * 86_400_000);
  assert.equal(pending(db, 'todo'), 1);
  assert.deepEqual(todos.dueReminders(NOW), []);
  assert.equal(pending(db, 'todo'), 0);
});

test('아직 울릴 때가 아닌 알림은 그대로 두고, 울릴 것은 고른다', () => {
  const { db } = counted();
  const events = new EventStore(db);
  const soon = events.add({ title: '곧', startAt: NOW + 5 * MIN }, NOW - 60 * MIN);
  events.add({ title: '나중', startAt: NOW + 3 * 60 * MIN }, NOW - 60 * MIN);
  assert.deepEqual(
    events.dueReminders(NOW).map((e) => e.id),
    [soon.id],
  );
  assert.equal(pending(db, 'event'), 2, '고르기만 하고 말한 것으로는 적지 않는다');
});

test('알릴 것 찾기는 항목이 많아도 질의 수가 같다', () => {
  const soon = NOW + 5 * MIN;
  const soonMin = new Date(soon).getHours() * 60 + new Date(soon).getMinutes();
  const run = (n: number) => {
    const { db, c } = counted();
    const events = new EventStore(db);
    const todos = new TodoStore(db, utcDay);
    for (let i = 0; i < n; i++) {
      events.add({ title: `e${i}`, startAt: NOW + 5 * MIN + i }, NOW - 60 * MIN);
      // 마감 시각은 현지 시각이다 (시간대를 타지 않게 5분 뒤를 현지로 적는다)
      todos.add({ title: `t${i}`, due: localDay(soon), dueMin: soonMin }, NOW - 60 * MIN);
    }
    c.n = 0;
    assert.equal(events.dueReminders(NOW).length, n);
    assert.equal(todos.dueReminders(NOW).length, n);
    return c.n;
  };
  assert.equal(run(30), run(3));
});
