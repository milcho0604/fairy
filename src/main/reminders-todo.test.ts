// 할 일 마감 임박 알림: 한 번만, 끝낸 것과 지운 것은 안 알림, 꺼져 있던 사이 지난 것은 안 몰아 알림, 설정으로 끄기
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { atLocal } from '../shared/remind.ts';
import { localDay, TodoStore } from '../shared/todo-store.ts';
import { createReminders } from './reminders.ts';

const MIN = 60_000;
const T0 = atLocal('2026-11-02', 8 * 60);

function setup(alert = true) {
  const raw = new DatabaseSync(':memory:') as unknown as Db;
  migrate(raw);
  const events = new EventStore(raw);
  const todos = new TodoStore(raw, localDay);
  const said: string[] = [];
  const r = createReminders({
    events,
    todos,
    say: async (o) => {
      said.push(o.text ?? '');
      return undefined;
    },
    openUrl: () => {},
    openToday: () => {},
    todoAlert: () => alert,
    log: () => {},
  });
  return { todos, said, r };
}

test('시각 마감: 1시간 전에 한 번만 말한다', () => {
  const { todos, said, r } = setup();
  todos.add({ title: '보고서', due: '2026-11-02', dueMin: 15 * 60, reminds: [60] }, T0);
  r.tick(atLocal('2026-11-02', 13 * 60 + 59));
  assert.equal(said.length, 0);
  r.tick(atLocal('2026-11-02', 14 * 60));
  assert.equal(said.length, 1);
  r.tick(atLocal('2026-11-02', 14 * 60 + 1));
  r.tick(atLocal('2026-11-02', 14 * 60 + 30));
  assert.equal(said.length, 1, '다시 말하지 않는다');
});

test('끝낸 할 일과 지운 할 일은 말하지 않는다', () => {
  const { todos, said, r } = setup();
  const a = todos.add({ title: '끝낸 것', due: '2026-11-02', dueMin: 15 * 60, reminds: [60] }, T0);
  const b = todos.add({ title: '지운 것', due: '2026-11-02', dueMin: 15 * 60, reminds: [60] }, T0);
  todos.complete(a.id, T0 + MIN);
  todos.remove(b.id, T0 + MIN);
  r.tick(atLocal('2026-11-02', 14 * 60 + 1));
  assert.equal(said.length, 0);
});

test('앱이 꺼져 있던 사이 마감이 지난 것은 말하지 않는다', () => {
  const { todos, said, r } = setup();
  todos.add({ title: '지난 것', due: '2026-11-02', dueMin: 15 * 60, reminds: [60] }, T0);
  r.tick(atLocal('2026-11-02', 17 * 60));
  assert.equal(said.length, 0);
});

test('설정을 끄면 말없이 넘기고, 다시 켜도 지난 것을 몰아 말하지 않는다', () => {
  let on = false;
  const raw = new DatabaseSync(':memory:') as unknown as Db;
  migrate(raw);
  const todos = new TodoStore(raw, localDay);
  const said: string[] = [];
  const r = createReminders({
    events: new EventStore(raw),
    todos,
    say: async (o) => {
      said.push(o.text ?? '');
      return undefined;
    },
    openUrl: () => {},
    openToday: () => {},
    todoAlert: () => on,
    log: () => {},
  });
  todos.add({ title: '보고서', due: '2026-11-02', dueMin: 15 * 60, reminds: [60] }, T0);
  r.tick(atLocal('2026-11-02', 14 * 60));
  assert.equal(said.length, 0);
  on = true;
  r.tick(atLocal('2026-11-02', 14 * 60 + 2));
  assert.equal(said.length, 0);
});
