// "못 한 N개 내일로" (이슈 #162, 큰 창 오늘 탭): TodoStore.deferTo
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { TodoStore } from './todo-store.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 2, 9, 0); // 2026-10-02 (금) 09:00
const TODAY = '2026-10-02';
const TOMORROW = '2026-10-03';

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}

test('내일로: 오늘 마감과 지난 마감만 옮기고 마감 시각은 지킨다', () => {
  const { store } = fresh();
  const late = store.add({ title: '지난 일', due: '2026-09-28', dueMin: 15 * 60 }, T0);
  const today = store.add({ title: '오늘 일', due: TODAY }, T0);
  const later = store.add({ title: '모레 일', due: '2026-10-04' }, T0);
  const none = store.add({ title: '마감 없음' }, T0);
  const habit = store.add({ title: '습관', due: TODAY, repeat: 'daily' }, T0);
  const moved = store.deferTo(TODAY, TOMORROW, T0);
  assert.deepEqual(moved.map((m) => m.id).sort(), [late.id, today.id].sort());
  assert.equal(store.get(late.id)?.due, TOMORROW);
  assert.equal(store.get(late.id)?.dueMin, 15 * 60);
  assert.equal(store.get(today.id)?.due, TOMORROW);
  assert.equal(store.get(later.id)?.due, '2026-10-04');
  assert.equal(store.get(none.id)?.due, null);
  assert.equal(store.get(habit.id)?.due, TODAY);
  // 원래 마감을 돌려준다 (되돌리기용)
  assert.equal(moved.find((m) => m.id === late.id)?.due, '2026-09-28');
});

test('내일로: 옮길 것이 없으면 빈 목록이고, 두 번째 호출도 빈 목록', () => {
  const { store } = fresh();
  store.add({ title: '모레 일', due: '2026-10-04' }, T0);
  assert.deepEqual(store.deferTo(TODAY, TOMORROW, T0), []);
  store.add({ title: '오늘 일', due: TODAY }, T0);
  assert.equal(store.deferTo(TODAY, TOMORROW, T0).length, 1);
  assert.deepEqual(store.deferTo(TODAY, TOMORROW, T0), []);
});

test('내일로: 화면이 본 오늘과 목록(ids) 기준이라 자정이 지나 새로 오늘이 된 것은 그대로', () => {
  const { store } = fresh();
  const seen = store.add({ title: '화면에 있던 오늘 마감', due: TODAY }, T0);
  const newer = store.add({ title: '새로 오늘이 된 것', due: TOMORROW }, T0);
  // 누른 때는 자정 뒤지만 화면의 오늘은 TODAY 다
  const moved = store.deferTo(TODAY, TOMORROW, T0 + 86_400_000, [seen.id]);
  assert.deepEqual(
    moved.map((m) => m.id),
    [seen.id],
  );
  assert.equal(store.get(newer.id)?.due, TOMORROW);
  // 목록에 없던 지난 마감은 ids 밖이라 안 옮긴다
  const stray = store.add({ title: '목록에 없던 지난 일', due: '2026-09-30' }, T0);
  assert.deepEqual(store.deferTo(TODAY, TOMORROW, T0, [seen.id]), []);
  assert.equal(store.get(stray.id)?.due, '2026-09-30');
});

test('내일로: 묶음마다 자기 원래 마감을 돌려준다 (알림 둘이 서로 섞이지 않는다)', () => {
  const { store } = fresh();
  const a = store.add({ title: 'A', due: TODAY }, T0);
  const first = store.deferTo(TODAY, TOMORROW, T0);
  const b = store.add({ title: 'B', due: TODAY }, T0);
  const second = store.deferTo(TODAY, TOMORROW, T0);
  assert.deepEqual(first, [{ id: a.id, due: TODAY }]);
  assert.deepEqual(second, [{ id: b.id, due: TODAY }]);
});

test('내일로: 하나라도 실패하면 아무것도 안 옮긴다 (한 거래)', () => {
  const { store } = fresh();
  const a = store.add({ title: 'A', due: TODAY }, T0);
  const b = store.add({ title: 'B', due: TODAY, dueMin: 600 }, T0);
  const c = store.add({ title: 'C', due: '2026-09-30' }, T0);
  const real = store.update.bind(store);
  let calls = 0;
  (store as unknown as { update: unknown }).update = (...args: Parameters<typeof real>) => {
    if (++calls === 2) throw new Error('디스크 오류');
    return real(...args);
  };
  assert.throws(() => store.deferTo(TODAY, TOMORROW, T0), /디스크 오류/);
  (store as unknown as { update: unknown }).update = real;
  assert.equal(store.get(a.id)?.due, TODAY);
  assert.equal(store.get(b.id)?.due, TODAY);
  assert.equal(store.get(b.id)?.dueMin, 600);
  assert.equal(store.get(c.id)?.due, '2026-09-30');
  // 실패 뒤에도 다시 할 수 있다 (거래가 열린 채 남지 않았다)
  assert.equal(store.deferTo(TODAY, TOMORROW, T0).length, 3);
});
