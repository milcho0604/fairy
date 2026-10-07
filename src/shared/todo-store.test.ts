import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate, SCHEMA_VERSION, schemaVersion } from './db-schema.ts';
import { COIN, FULLNESS, nextDue, TodoStore } from './todo-store.ts';

const HOUR = 3_600_000;
// 시험은 시간대와 상관없게 날짜를 UTC 로 자른다.
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 2, 9, 0); // 2026-10-02 09:00

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}

test('빈 저장 파일에서 최신 판까지 올라가고, 두 번 해도 그대로', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  assert.deepEqual(migrate(db), { from: 0, to: SCHEMA_VERSION });
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
});

test('앱보다 새 판 저장 파일은 거부한다 (덮어쓰지 않게)', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec(`pragma user_version = ${SCHEMA_VERSION + 1}`);
  assert.throws(() => migrate(db), /새 판/);
});

test('할 일 하나 끝내면 10코인, 마감 전이면 15코인, 두 번 끝내도 한 번만', () => {
  const { store } = fresh();
  const a = store.add({ title: '보고서' }, T0);
  const b = store.add({ title: '마감 있는 일', due: '2026-10-02' }, T0);
  const late = store.add({ title: '늦은 일', due: '2026-10-01' }, T0);
  assert.equal(store.complete(a.id, T0), COIN.todo);
  assert.equal(store.complete(a.id, T0), 0);
  assert.equal(store.complete(b.id, T0), COIN.todo + COIN.early);
  assert.equal(store.complete(late.id, T0), COIN.todo);
  assert.equal(store.balance(), 35);
});

test(`하루 ${COIN.dailyTodoLimit}개까지만 코인, 다음 날 다시`, () => {
  const { store } = fresh();
  let earned = 0;
  for (let i = 0; i < COIN.dailyTodoLimit + 3; i++)
    earned += store.complete(store.add({ title: `일${i}` }, T0).id, T0);
  assert.equal(earned, COIN.dailyTodoLimit * COIN.todo);
  assert.equal(store.complete(store.add({ title: '다음 날' }, T0).id, T0 + 24 * HOUR), COIN.todo);
});

test('되돌리면 받은 코인을 회수하고, 이미 썼으면 0 에서 멈춘다', () => {
  const { store } = fresh();
  const a = store.add({ title: 'a', due: '2026-10-05' }, T0);
  store.complete(a.id, T0); // +15
  assert.equal(store.undo(a.id, T0), 15);
  assert.equal(store.balance(), 0);
  assert.equal(store.get(a.id)?.doneAt, null);
  assert.equal(store.undo(a.id, T0), 0); // 안 끝난 것은 그대로

  store.complete(a.id, T0); // +15
  store.feed(T0);
  store.feed(T0 + 24 * HOUR); // 배가 꺼진 뒤 한 번 더. -10 → 잔액 5
  assert.equal(store.undo(a.id, T0), 5);
  assert.equal(store.balance(), 0);
});

test('되돌린 할 일을 다시 끝내도 하루 상한을 두 번 세지 않게 장부로 센다', () => {
  const { store } = fresh();
  const a = store.add({ title: 'a' }, T0);
  store.complete(a.id, T0);
  store.undo(a.id, T0);
  assert.equal(store.complete(a.id, T0), COIN.todo);
  assert.equal(store.balance(), COIN.todo);
});

test('목록: 중요 먼저, 마감 빠른 순, 마감 없는 것은 뒤. 오늘 끝낸 것은 따로', () => {
  const { store } = fresh();
  const plain = store.add({ title: '그냥' }, T0);
  const later = store.add({ title: '나중 마감', due: '2026-10-09' }, T0 + 1);
  const soon = store.add({ title: '곧 마감', due: '2026-10-03' }, T0 + 2);
  const star = store.add({ title: '중요', important: true }, T0 + 3);
  const done = store.add({ title: '끝냄' }, T0 + 4);
  store.complete(done.id, T0 + 5);
  const { open, doneToday } = store.list(T0 + 6);
  assert.deepEqual(
    open.map((t) => t.id),
    [star.id, soon.id, later.id, plain.id],
  );
  assert.deepEqual(
    doneToday.map((t) => t.id),
    [done.id],
  );
  assert.equal(store.list(T0 + 24 * HOUR).doneToday.length, 0);
});

test('지우면 목록에서 빠지지만 받은 코인은 그대로', () => {
  const { store } = fresh();
  const a = store.add({ title: 'a' }, T0);
  store.complete(a.id, T0);
  store.remove(a.id, T0);
  assert.equal(store.get(a.id), undefined);
  assert.equal(store.balance(), COIN.todo);
});

test('제목: 빈 제목은 안 받고, 앞뒤 공백을 지운다', () => {
  const { store } = fresh();
  assert.throws(() => store.add({ title: '   ' }, T0));
  assert.equal(store.add({ title: '  보고서  ' }, T0).title, '보고서');
  const t = store.add({ title: 'x' }, T0);
  assert.equal(store.update(t.id, { title: '  ', important: true })?.title, 'x');
  assert.equal(store.get(t.id)?.important, true);
});

test('배부름: 시작 80, 한 시간에 2씩 줄고 0 밑으로 안 간다', () => {
  const { store } = fresh();
  assert.equal(store.fullness(T0), FULLNESS.start);
  assert.equal(store.fullness(T0 + 10 * HOUR), 60);
  assert.equal(store.fullness(T0 + 100 * HOUR), 0);
});

test('밥 주기: 5코인에 20, 100 을 안 넘고, 코인이 모자라면 안 준다', () => {
  const { store } = fresh();
  store.fullness(T0);
  assert.deepEqual(store.feed(T0), { ok: false, fullness: 80, balance: 0 });
  store.complete(store.add({ title: 'a' }, T0).id, T0);
  assert.deepEqual(store.feed(T0), { ok: true, fullness: 100, balance: 5 });
  assert.equal(store.feed(T0 + 5 * HOUR).fullness, 100); // 90 + 20 → 100
  assert.equal(store.balance(), 0);
});

test('다음 회차 마감: 매일은 내일, 평일은 주말을 건너뛰고, 매주는 같은 요일. 밀린 것은 한 번만', () => {
  // 2026-10-02 금요일
  assert.equal(nextDue('2026-10-02', 'daily', '2026-10-02'), '2026-10-03');
  assert.equal(nextDue('2026-09-28', 'daily', '2026-10-02'), '2026-10-03');
  assert.equal(nextDue('2026-10-02', 'weekdays', '2026-10-02'), '2026-10-05');
  assert.equal(nextDue('2026-10-02', 'weekly', '2026-10-02'), '2026-10-09');
  assert.equal(nextDue('2026-09-18', 'weekly', '2026-10-02'), '2026-10-09');
  assert.equal(nextDue('2026-10-05', 'daily', '2026-10-02'), '2026-10-06');
  assert.equal(nextDue(null, 'daily', '2026-10-02'), '2026-10-03');
});

test('반복 할 일을 끝내면 다음 회차가 생기고, 되돌리면 그 회차가 사라진다', () => {
  const { store } = fresh();
  const t = store.add({ title: '운동', repeat: 'daily' }, T0);
  assert.equal(t.due, '2026-10-02');
  store.complete(t.id, T0);
  let open = store.list(T0).open;
  assert.equal(open.length, 1);
  assert.deepEqual([open[0]?.title, open[0]?.due, open[0]?.repeat], ['운동', '2026-10-03', 'daily']);
  store.undo(t.id, T0);
  open = store.list(T0).open;
  assert.deepEqual(
    open.map((x) => x.id),
    [t.id],
  );
});

test('집중 보상은 한 번에 5코인, 하루 8번까지', () => {
  const { store } = fresh();
  let total = 0;
  for (let i = 0; i < 10; i++) total += store.rewardFocus(T0 + i);
  assert.equal(total, COIN.focus * COIN.dailyFocusLimit);
  assert.equal(store.rewardFocus(T0 + 24 * HOUR), COIN.focus);
});

test('집중 길이를 고르면 코인은 분에 비례하고, 하루 집중 코인 상한(40)은 그대로', () => {
  const { store } = fresh();
  assert.equal(store.rewardFocus(T0, 15), 3);
  assert.equal(store.rewardFocus(T0 + 1, 50), 10);
  assert.equal(store.rewardFocus(T0 + 2, 50), 10);
  assert.equal(store.rewardFocus(T0 + 3, 50), 10);
  // 지금 33. 남은 7 만 준다
  assert.equal(store.rewardFocus(T0 + 4, 50), 7);
  assert.equal(store.rewardFocus(T0 + 5, 15), 0);
  assert.equal(store.balance(), COIN.focus * COIN.dailyFocusLimit);
});

test('배가 꽉 차면 밥을 주지 않고 코인도 안 가져간다', () => {
  const { store } = fresh();
  const a = store.add({ title: '일' }, T0);
  for (let i = 0; i < 6; i++) store.complete(store.add({ title: `일${i}` }, T0).id, T0);
  store.complete(a.id, T0);
  let r = store.feed(T0);
  while (r.ok) r = store.feed(T0);
  const before = store.balance();
  assert.equal(r.full, true);
  assert.equal(store.feed(T0).ok, false);
  assert.equal(store.balance(), before);
});
