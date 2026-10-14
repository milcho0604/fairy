// 매주 반복 할 일의 요일 지키기와 코인 되받기 막기 (감사 3차)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { parseQuickTodo } from './quick-add.ts';
import { COIN, TodoStore } from './todo-store.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (d: string, h = 9) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}

test('"매주 월요일" 을 수요일에 오늘로 옮겨 끝내도 다음 회차는 다음 월요일', () => {
  const { store } = fresh();
  const q = parseQuickTodo('매주 월요일 주간 회의 준비', '2026-10-05');
  assert.deepEqual([q.repeat, q.due], ['weekly', '2026-10-05']);
  const first = store.add(q, at('2026-10-05'));
  store.complete(first.id, at('2026-10-05'));
  const late = store.list(at('2026-10-14')).open[0];
  assert.equal(late?.due, '2026-10-12');
  // 수요일 아침: 지난 마감 옮기기
  const moved = store.moveOverdue('2026-10-14', at('2026-10-14'));
  assert.deepEqual(moved, [{ id: late?.id, due: '2026-10-12' }]);
  assert.equal(store.get(late?.id ?? 0)?.due, '2026-10-14');
  store.complete(late?.id ?? 0, at('2026-10-14', 10));
  const next = store.list(at('2026-10-14', 10)).open;
  assert.deepEqual(
    next.map((x) => [x.title, x.due]),
    [['주간 회의 준비', '2026-10-19']],
  );
});

test('옮긴 것을 되돌리거나 직접 마감을 고치면 요일 기억을 버린다', () => {
  const { store } = fresh();
  const a = store.add({ title: 'A', due: '2026-10-12', repeat: 'weekly' }, at('2026-10-05'));
  store.moveOverdue('2026-10-14', at('2026-10-14'));
  // 사용자가 목요일로 바꿨다: 이제 목요일마다
  store.update(a.id, { due: '2026-10-15' }, at('2026-10-14'));
  store.complete(a.id, at('2026-10-15'));
  assert.deepEqual(
    store.list(at('2026-10-15')).open.map((x) => x.due),
    ['2026-10-22'],
  );
});

test('매일 반복은 옮긴 날부터 센다 (전과 같다)', () => {
  const { store } = fresh();
  const a = store.add({ title: '운동', due: '2026-10-12', repeat: 'daily' }, at('2026-10-12'));
  store.moveOverdue('2026-10-14', at('2026-10-14'));
  store.complete(a.id, at('2026-10-14'));
  assert.deepEqual(
    store.list(at('2026-10-14')).open.map((x) => x.due),
    ['2026-10-15'],
  );
});

test('끝내기, 코인 쓰기, 되돌리기, 다시 끝내기를 되풀이해도 코인이 늘지 않는다', () => {
  const { store } = fresh();
  const now = at('2026-10-14');
  const u = store.add({ title: 'x' }, now);
  assert.equal(store.complete(u.id, now), COIN.todo);
  assert.ok(store.spend(store.balance(), 'toy', now));
  for (let i = 0; i < 5; i++) {
    assert.equal(store.undo(u.id, now), 0, '이미 써서 되받을 것이 없다');
    assert.equal(store.complete(u.id, now), 0, '되받지 못한 몫이 있어 다시 주지 않는다');
    store.spend(store.balance(), 'toy', now);
  }
  assert.equal(store.balance(), 0);
  // 다음 날 되돌리고 다시 끝내도 같다
  store.undo(u.id, at('2026-10-15'));
  assert.equal(store.complete(u.id, at('2026-10-15')), 0);
});

test('다 되받았으면 다시 끝낼 때 다시 받고, 일부만 되받았으면 모자란 만큼만', () => {
  const { store } = fresh();
  const now = at('2026-10-14');
  const a = store.add({ title: 'a', due: '2026-10-15' }, now);
  assert.equal(store.complete(a.id, now), COIN.todo + COIN.early);
  assert.equal(store.undo(a.id, now), COIN.todo + COIN.early);
  assert.equal(store.complete(a.id, now), COIN.todo + COIN.early, '되받은 만큼 다시 준다');
  // 일부를 쓴다: 20 중 15 를 쓰면 되돌릴 때 5 만 되받는다
  store.spend(15, 'toy', now);
  assert.equal(store.undo(a.id, now), 5);
  assert.equal(store.complete(a.id, now), 5, '되받은 5 만 다시 준다');
  assert.equal(store.get(a.id)?.coins, 5);
  assert.equal(store.balance(), 5);
});

test('같은 할 일을 되돌렸다 다시 끝내도 하루 상한은 할 일 하나로 센다', () => {
  const { store } = fresh();
  const now = at('2026-10-14');
  const a = store.add({ title: 'a' }, now);
  for (let i = 0; i < COIN.dailyTodoLimit; i++) {
    store.complete(a.id, now);
    store.undo(a.id, now);
  }
  const b = store.add({ title: 'b' }, now);
  assert.equal(store.complete(b.id, now), COIN.todo);
});

test('오늘 탭 링크의 옮기기는 습관(반복)을 두고 센 것만 옮긴다', () => {
  const { store } = fresh();
  const habit = store.add({ title: '운동', due: '2026-10-12', repeat: 'daily' }, at('2026-10-12'));
  const late = store.add({ title: '보고서', due: '2026-10-12' }, at('2026-10-12'));
  const moved = store.moveOverdue('2026-10-14', at('2026-10-14'), { habits: false });
  assert.deepEqual(moved, [{ id: late.id, due: '2026-10-12' }]);
  assert.equal(store.get(habit.id)?.due, '2026-10-12');
});
