// 마감을 옮기거나 일정을 할 일로 바꿀 때 이미 지난 알림을 다시 말하지 않는지 (검토 2026-10-09).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate } from './db-schema.ts';
import { atLocal } from './remind.ts';
import { TodoStore } from './todo-store.ts';

const store = () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new TodoStore(db);
};

test('회고에서 내일로 넘기고 되돌려도 지난 저녁 알림을 다시 말하지 않는다', () => {
  const s = store();
  const todo = s.add({ title: '보고서', due: '2026-10-09' }, atLocal('2026-10-08', 10 * 60));
  const eve = atLocal('2026-10-08', 20 * 60);
  assert.equal(s.dueReminders(eve).length, 1);
  s.markNotified(todo.id, eve);
  // 다음 날 저녁 9시 회고: 내일로 (내일 마감의 전날 저녁 8시도 이미 지났다)
  const now = atLocal('2026-10-09', 21 * 60);
  s.update(todo.id, { due: '2026-10-10' }, now);
  assert.equal(s.dueReminders(now + 15_000).length, 0, '넘기자마자 알렸다');
  // 되돌리기
  s.update(todo.id, { due: '2026-10-09' }, now + 20_000);
  assert.equal(s.dueReminders(now + 30_000).length, 0, '되돌리자마자 알렸다');
  // 앞으로 올 알림은 그대로 남는다
  s.update(todo.id, { due: '2026-10-12' }, now + 40_000);
  assert.equal(s.dueReminders(atLocal('2026-10-11', 20 * 60)).length, 1);
});

test('일정을 할 일로 바꿔 마감을 오늘로 정해도 어제 저녁 알림은 넘긴다', () => {
  const s = store();
  const now = atLocal('2026-10-09', 14 * 60);
  const r = s.add({ title: '치과 3시' }, now);
  s.update(r.id, { due: '2026-10-09' }, now);
  assert.equal(s.dueReminders(now + 15_000).length, 0);
});

test('8판으로 올릴 때 이미 지난 전날 저녁 알림은 넘긴 것으로 둔다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  for (let v = 0; v < 7; v++) db.exec(MIGRATIONS[v] ?? '');
  db.exec('pragma user_version = 7');
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  db.exec(
    `insert into todo (title, due, created_at) values ('내일', '${day(1)}', 0), ('모레', '${day(2)}', 0)`,
  );
  migrate(db);
  const rows = (db as unknown as DatabaseSync)
    .prepare(
      "select t.title, r.notified_at from reminder r join todo t on t.id = r.ref_id where r.kind = 'todo'",
    )
    .all() as { title: string; notified_at: number | null }[];
  const of = (title: string) => rows.find((r) => r.title === title)?.notified_at;
  // 내일 마감의 알림은 오늘 저녁 8시: 지났으면 넘김(0), 아니면 아직(null)
  const passed = new Date().getHours() >= 20;
  assert.equal(of('내일'), passed ? 0 : null);
  assert.equal(of('모레'), null);
});
