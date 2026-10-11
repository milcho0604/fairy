import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { habitStreak, weekStartOf } from './achieve.ts';
import { type Db, migrate } from './db-schema.ts';
import {
  chainRoots,
  GRASS_WEEKS,
  grass,
  grassLevel,
  grassStart,
  HabitStore,
  thisWeekCount,
} from './habit.ts';
import { TodoStore } from './todo-store.ts';

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// 2026-10-05 월요일 09:00 UTC
const MON = Date.UTC(2026, 9, 5, 9);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, todos: new TodoStore(db, utcDay), habits: new HabitStore(db, utcDay) };
}

test('습관 연속: 매일은 날마다, 오늘 아직이면 어제까지, 빠지면 0 에서 다시', () => {
  const days = new Set(['2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(habitStreak(days, '2026-10-05', 'daily', []), 3);
  assert.equal(habitStreak(days, '2026-10-06', 'daily', []), 3); // 오늘은 아직 남았다
  assert.equal(habitStreak(days, '2026-10-07', 'daily', []), 0); // 하루 빠짐
  // 쉬는 요일은 건너뛰어도 이어진다 (수요일을 쉬는 날로)
  assert.equal(habitStreak(days, '2026-10-07', 'daily', [2]), 3);
});

test('습관 연속: 평일 습관은 주말을 건너뛴다, 매주는 주마다 한 번', () => {
  // 금(10/2), 월(10/5)
  const wk = new Set(['2026-10-01', '2026-10-02', '2026-10-05']);
  assert.equal(habitStreak(wk, '2026-10-05', 'weekdays', []), 3);
  assert.equal(habitStreak(wk, '2026-10-05', 'daily', []), 1);
  // 매주: 9/22 주, 9/29 주, 10/5 주에 한 번씩
  const weekly = new Set(['2026-09-23', '2026-10-02', '2026-10-05']);
  assert.equal(habitStreak(weekly, '2026-10-07', 'weekly', []), 3);
  // 이번 주를 아직 안 했으면 지난주까지
  assert.equal(habitStreak(new Set(['2026-09-23', '2026-10-02']), '2026-10-07', 'weekly', []), 2);
  // 한 주를 비우면 끊긴다
  assert.equal(habitStreak(new Set(['2026-09-16', '2026-10-02']), '2026-10-07', 'weekly', []), 1);
  assert.equal(weekStartOf('2026-10-11'), '2026-10-05'); // 일요일은 그 주 월요일
  assert.equal(weekStartOf('2026-10-05'), '2026-10-05');
});

test('잔디: 12주, 일요일부터, 오늘 뒤는 빈칸, 같은 날은 습관 수만큼', () => {
  const today = '2026-10-07'; // 수요일
  assert.equal(grassStart(today), '2026-07-19'); // 11주 앞 일요일
  const g = grass([['2026-10-05', '2026-10-06'], ['2026-10-06']], today, 2);
  assert.equal(g.length, GRASS_WEEKS);
  assert.ok(g.every((col) => col.length === 7));
  const last = g[GRASS_WEEKS - 1] ?? [];
  assert.equal(last[0]?.day, '2026-10-04');
  assert.equal(last[1]?.n, 1);
  assert.equal(last[2]?.n, 2);
  assert.equal(last[2]?.level, 4);
  assert.equal(last[1]?.level, 2);
  assert.equal(last[3]?.future, false); // 오늘
  assert.equal(last[4]?.future, true);
  assert.equal(grassLevel(0, 3), 0);
  assert.equal(grassLevel(1, 1), 3);
  assert.equal(grassLevel(1, 8), 1);
  assert.equal(thisWeekCount(['2026-10-04', '2026-10-05', '2026-10-07'], today), 2);
});

test('사슬 묶기: 다음 회차는 첫 회차로, 꼬인 사슬도 멈춘다', () => {
  const roots = chainRoots([
    { id: 1, repeat_of: null },
    { id: 2, repeat_of: 1 },
    { id: 5, repeat_of: 2 },
    { id: 7, repeat_of: 99 }, // 앞 회차가 목록에 없다
    { id: 8, repeat_of: 9 },
    { id: 9, repeat_of: 8 },
  ]);
  assert.equal(roots.get(5), 1);
  assert.equal(roots.get(2), 1);
  assert.equal(roots.get(7), 7);
  assert.ok(roots.has(8) && roots.has(9));
});

test('습관 목록: 반복 할 일 사슬 하나가 습관 하나, 체크하면 오늘 한 것, 되돌리면 다시 할 차례', () => {
  const { todos, habits } = fresh();
  const water = todos.add({ title: '물 마시기', repeat: 'daily' }, MON - 2 * DAY);
  todos.add({ title: '보통 할 일' }, MON);
  // 토, 일에 했다
  todos.complete(water.id, MON - 2 * DAY);
  let list = habits.list(MON - DAY, []);
  const head = list[0];
  assert.equal(list.length, 1);
  assert.ok(head);
  todos.complete(head.id, MON - DAY);
  list = habits.list(MON, []);
  assert.equal(list[0]?.status, 'todo');
  assert.equal(list[0]?.streak, 2);
  assert.equal(list[0]?.rootId, water.id);
  // 월요일 체크
  todos.complete(list[0]?.id ?? 0, MON);
  list = habits.list(MON + 3_600_000, []);
  assert.equal(list[0]?.status, 'done');
  assert.equal(list[0]?.streak, 3);
  assert.equal(list[0]?.total, 3);
  assert.deepEqual(list[0]?.days, ['2026-10-03', '2026-10-04', '2026-10-05']);
  // 되돌리면 다음 회차는 걷히고 오늘 회차가 다시 열린다
  todos.undo(list[0]?.doneTodayId ?? 0, MON + 2 * 3_600_000);
  list = habits.list(MON + 3 * 3_600_000, []);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.status, 'todo');
  assert.equal(list[0]?.streak, 2); // 오늘은 아직 남았다
  // 사흘 쉬어도 습관은 그대로 남고 연속만 0 (벌 없음)
  list = habits.list(MON + 3 * DAY, []);
  assert.equal(list[0]?.streak, 0);
  assert.equal(list[0]?.total, 2);
});

test('습관 목록: 매주 습관은 다음 차례가 뒤면 later, 반복을 끄면 습관에서 빠진다', () => {
  const { todos, habits } = fresh();
  const gym = todos.add({ title: '운동', repeat: 'weekly', due: '2026-10-09' }, MON);
  assert.equal(habits.list(MON, [])[0]?.status, 'later');
  todos.update(gym.id, { repeat: null });
  assert.equal(habits.list(MON, []).length, 0);
});
