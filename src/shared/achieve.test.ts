import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ACHIEVEMENTS, AchievementStore, streak } from './achieve.ts';
import { type Db, migrate } from './db-schema.ts';
import { TodoStore } from './todo-store.ts';

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const FRI = Date.UTC(2026, 9, 2, 10); // 2026-10-02 금요일

test('연속 기록: 오늘 안 했으면 어제까지, 쉬는 날은 건너뛴다, 빠진 평일에서 끊긴다', () => {
  const days = new Set(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(streak(days, '2026-10-02', []), 4);
  assert.equal(streak(days, '2026-10-03', []), 4); // 토요일 아직 안 함
  assert.equal(streak(days, '2026-10-05', [0, 6]), 4); // 월요일, 주말 건너뜀
  assert.equal(streak(days, '2026-10-05', []), 0); // 주말이 쉬는 날이 아니면 끊김
  assert.equal(streak(new Set(), '2026-10-02', []), 0);
});

test('업적: 조건을 넘으면 한 번만 받는다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const todos = new TodoStore(db, utcDay);
  const ach = new AchievementStore(db, utcDay);
  for (let d = 0; d < 3; d++)
    todos.complete(todos.add({ title: `일 ${d}` }, FRI + d * DAY).id, FRI + d * DAY);
  const now = FRI + 2 * DAY;
  const facts = ach.facts(now, [], { affection: 0, houseLevel: 0 });
  assert.equal(facts.todosDone, 3);
  assert.equal(facts.streak, 3);
  assert.deepEqual(
    ach.check(facts, now).map((a) => a.key),
    ['todo-1', 'streak-3'],
  );
  assert.deepEqual(ach.check(facts, now), []);
  assert.deepEqual([...ach.got().keys()].sort(), ['streak-3', 'todo-1']);
  assert.ok(ACHIEVEMENTS.length >= 10);
});
