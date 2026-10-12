import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION, schemaVersion } from './db-schema.ts';
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

test('화면 체크로 끝내기: 안 끝낸 할 일만 코인, 이미 끝냈거나 없으면 null (빠르게 여러 번 누름)', () => {
  const { store } = fresh();
  const a = store.add({ title: '빠른 클릭' }, T0);
  assert.equal(store.completeOpen(a.id, T0), COIN.todo);
  assert.equal(store.completeOpen(a.id, T0), null);
  assert.equal(store.completeOpen(a.id, T0 + 10), null);
  assert.equal(store.completeOpen(9999, T0), null);
  assert.equal(store.balance(), COIN.todo);
  // 되돌린 뒤에는 다시 끝낼 수 있다
  store.undo(a.id, T0 + 20);
  assert.equal(typeof store.completeOpen(a.id, T0 + 30), 'number');
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

test('지운 할 일을 되살리면 마감, 중요, 반복까지 그대로 목록에 돌아온다', () => {
  const { store } = fresh();
  const a = store.add({ title: '보고서', due: '2026-10-03', important: true, repeat: 'weekly' }, T0);
  store.add({ title: '다른 일' }, T0);
  store.remove(a.id, T0);
  assert.deepEqual(
    store.list(T0).open.map((t) => t.title),
    ['다른 일'],
  );
  store.restore(a.id);
  assert.deepEqual(store.get(a.id), a);
  assert.equal(store.list(T0).open.length, 2);
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
  // "매주 월요일 회의" 를 금요일에 넣으면 첫 마감은 10-05(월). 미리 끝내도 다음은 그 다음 월요일 (요일이 밀리지 않는다)
  assert.equal(nextDue('2026-10-05', 'weekly', '2026-10-02'), '2026-10-12');
  assert.equal(nextDue('2026-10-05', 'weekly', '2026-10-05'), '2026-10-12');
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

test('잔액은 coin_total 한 행: 끝내기, 되돌리기, 밥, 되돌린 묶음, 장부 합계와 늘 같다', () => {
  const { db, store } = fresh();
  const sum = () =>
    Number((db.prepare('select coalesce(sum(amount), 0) as s from coin_log').get() as { s: number }).s);
  const a = store.add({ title: '보고서' }, T0);
  store.complete(a.id, T0);
  store.reward(4, 'play', T0);
  assert.equal(store.balance(), COIN.todo + 4);
  store.undo(a.id, T0 + 1000);
  store.feed(T0 + 2 * HOUR);
  assert.equal(store.balance(), sum());
  // 되돌린 묶음은 잔액도 되돌린다 (트리거가 같은 묶음 안)
  db.exec('begin');
  store.reward(50, 'play', T0);
  db.exec('rollback');
  assert.equal(store.balance(), sum());
  // 다른 연결(펫 MCP 서버)이 장부에 바로 써도 맞다
  db.prepare('insert into coin_log (amount, reason, ref_id, day, at) values (7, ?, null, ?, ?)').run(
    'meet',
    '2026-10-02',
    T0,
  );
  db.prepare('delete from coin_log where reason = ?').run('food');
  assert.equal(store.balance(), sum());
});

test('11판 장부를 12판으로 올리면 잔액이 장부 합계로 시작한다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  for (let v = 0; v < 11; v++) db.exec(MIGRATIONS[v] ?? '');
  db.exec('pragma user_version = 11');
  for (const n of [10, 5, -3, 1, 1, 1])
    db.prepare("insert into coin_log (amount, reason, day, at) values (?, 'todo', '2026-10-01', 0)").run(n);
  migrate(db);
  assert.equal(new TodoStore(db, utcDay).balance(), 15);
});

test('놀이 코인은 한 행에 여럿, 하루 합은 옛 기록(한 행에 1)과 섞여도 코인 수', () => {
  const { db, store } = fresh();
  store.reward(1, 'play', T0);
  store.reward(1, 'play', T0);
  store.reward(3, 'play', T0);
  assert.equal(store.coinSum('play', '2026-10-02'), 5);
  assert.equal(store.coinSum('play', '2026-10-03'), 0);
  assert.equal(
    Number((db.prepare("select count(*) as n from coin_log where reason = 'play'").get() as { n: number }).n),
    3,
  );
});
