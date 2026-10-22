import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate } from './db-schema.ts';
import { TodoStore } from './todo-store.ts';

const NOW = Date.UTC(2026, 9, 12, 3, 0);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fresh = () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, todos: new TodoStore(db, utcDay) };
};
const titles = (s: TodoStore) => s.list(NOW).open.map((t) => t.title);

test('순서 바꾸기: 번호가 없으면 마감 없는 새 할 일은 맨 끝', () => {
  const { todos } = fresh();
  todos.add({ title: 'a' }, NOW);
  todos.add({ title: 'b' }, NOW + 1);
  todos.add({ title: 'c' }, NOW + 2);
  assert.deepEqual(titles(todos), ['a', 'b', 'c']);
});

test('순서 바꾸기: 맨 위로, 맨 아래로, 한 칸 위아래', () => {
  const { todos } = fresh();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((title, i) => todos.add({ title }, NOW + i));
  assert.ok(a && b && c && d);
  assert.equal(todos.place(d.id, a.id, false, NOW), true);
  assert.deepEqual(titles(todos), ['d', 'a', 'b', 'c']);
  assert.equal(todos.place(d.id, c.id, true, NOW), true);
  assert.deepEqual(titles(todos), ['a', 'b', 'c', 'd']);
  assert.equal(todos.place(c.id, b.id, false, NOW), true);
  assert.deepEqual(titles(todos), ['a', 'c', 'b', 'd']);
});

test('순서 바꾸기: 옮긴 뒤 새로 넣은 할 일은 맨 끝, 다음 회차는 같은 자리', () => {
  const { todos } = fresh();
  const a = todos.add({ title: 'a' }, NOW);
  const b = todos.add({ title: 'b', repeat: 'daily', due: utcDay(NOW) }, NOW + 1);
  const c = todos.add({ title: 'c' }, NOW + 2);
  todos.place(c.id, a.id, false, NOW);
  todos.place(b.id, c.id, false, NOW);
  const before = titles(todos);
  assert.deepEqual(before, ['b', 'c', 'a']);
  todos.add({ title: 'new' }, NOW + 3);
  assert.deepEqual(titles(todos), [...before, 'new']);
  todos.complete(b.id, NOW + 10);
  assert.deepEqual(titles(todos), ['b', 'c', 'a', 'new']);
  assert.equal(todos.nextOf(b.id)?.title, 'b');
});

test('순서 바꾸기: 없는 id, 같은 id, 끝낸 할 일은 안 바꾼다', () => {
  const { todos } = fresh();
  const a = todos.add({ title: 'a' }, NOW);
  const b = todos.add({ title: 'b' }, NOW + 1);
  assert.equal(todos.place(a.id, a.id, true, NOW), false);
  assert.equal(todos.place(a.id, 999, true, NOW), false);
  todos.complete(b.id, NOW + 5);
  assert.equal(todos.place(a.id, b.id, true, NOW + 6), false);
  assert.deepEqual(titles(todos), ['a']);
});

test('순서 칸 이전 판 데이터: 14판 파일에 15판을 올려도 순서가 그대로', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 14)) db.exec(sql);
  db.exec('pragma user_version = 14; commit');
  const old = new TodoStore(db, utcDay);
  old.add({ title: 'x', important: true }, NOW);
  old.add({ title: 'y' }, NOW + 1);
  assert.equal(migrate(db).to, MIGRATIONS.length);
  assert.deepEqual(titles(new TodoStore(db, utcDay)), ['x', 'y']);
});
