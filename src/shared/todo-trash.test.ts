import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate } from './db-schema.ts';
import { COIN, TodoStore, TRASH_DAYS, trashDaysLeft } from './todo-store.ts';

// 할 일 휴지통 30일 (#125). 지우기와 되살리기에서 코인 장부는 움직이지 않는다.
const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 2, 9, 0);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}
const ledger = (db: Db) =>
  db.prepare('select amount, reason, ref_id from coin_log order by id').all() as {
    amount: number;
    reason: string;
    ref_id: number | null;
  }[];

test('지운 할 일은 휴지통에 오고 목록에서는 빠진다, 최근 지운 것이 위', () => {
  const { store } = fresh();
  const a = store.add({ title: '가' }, T0);
  const b = store.add({ title: '나' }, T0);
  store.remove(a.id, T0 + 1000);
  store.remove(b.id, T0 + 2000);
  assert.equal(store.list(T0).open.length, 0);
  assert.deepEqual(
    store.trash(T0 + 3000).map((x) => x.title),
    ['나', '가'],
  );
  assert.equal(store.trashCount(), 2);
  assert.equal(store.trash(T0)[0]?.daysLeft, TRASH_DAYS);
});

test('남은 날: 29일 지나면 1, 30일이면 0, 시계가 지운 때보다 앞이어도 30을 넘지 않는다', () => {
  assert.equal(trashDaysLeft(T0, T0), 30);
  assert.equal(trashDaysLeft(T0, T0 + 29 * DAY), 1);
  assert.equal(trashDaysLeft(T0, T0 + 29 * DAY + 1), 1);
  assert.equal(trashDaysLeft(T0, T0 + 30 * DAY), 0);
  assert.equal(trashDaysLeft(T0, T0 + 45 * DAY), 0);
  assert.equal(trashDaysLeft(T0 + 5 * DAY, T0), 30);
});

test('30일이 지난 것만 자동 영구 삭제: 30일 직전은 남고 30일은 사라진다, 단계와 알림도 함께', () => {
  const { db, store } = fresh();
  const old = store.add({ title: '오래됨', due: '2026-10-05' }, T0);
  store.addStep(old.id, '단계', T0);
  const young = store.add({ title: '최근' }, T0);
  store.remove(old.id, T0);
  store.remove(young.id, T0 + 1 * DAY);
  assert.equal(store.purgeExpired(T0 + 30 * DAY - 1), 0);
  assert.equal(store.trashCount(), 2);
  assert.equal(store.purgeExpired(T0 + 30 * DAY), 1);
  assert.deepEqual(
    store.trash(T0 + 30 * DAY).map((x) => x.title),
    ['최근'],
  );
  assert.equal((db.prepare('select count(*) as n from todo_step').get() as { n: number }).n, 0);
  const marks = db
    .prepare("select count(*) as n from reminder where kind = 'todo' and ref_id = ?")
    .get(old.id);
  assert.equal((marks as { n: number }).n, 0);
  assert.equal(store.purgeExpired(T0 + 31 * DAY), 1);
  assert.equal(store.trashCount(), 0);
});

test('되살리기는 코인을 움직이지 않는다: 끝낸 할 일을 지우고 되살려도 장부와 잔액이 그대로', () => {
  const { db, store } = fresh();
  const a = store.add({ title: '끝낸 일', due: '2026-10-03' }, T0);
  const got = store.complete(a.id, T0);
  assert.equal(got, COIN.todo + COIN.early);
  const beforeLedger = ledger(db);
  const balance = store.balance();
  store.remove(a.id, T0 + 1000);
  assert.deepEqual(ledger(db), beforeLedger);
  assert.equal(store.balance(), balance);
  const back = store.restoreFromTrash(a.id);
  assert.equal(back?.doneAt, T0);
  assert.equal(back?.coins, got);
  assert.deepEqual(ledger(db), beforeLedger);
  assert.equal(store.balance(), balance);
  // 되살린 뒤 한 번 더 되돌려도 코인은 한 번만 회수된다
  assert.equal(store.undo(a.id, T0 + 2000), got);
  assert.equal(store.balance(), balance - got);
  assert.equal(ledger(db).filter((r) => r.reason === 'undo').length, 1);
});

test('되살린 안 끝낸 할 일은 목록에 돌아오고, 두 번 되살리거나 없는 번호는 undefined', () => {
  const { store } = fresh();
  const a = store.add({ title: '열린 일' }, T0);
  store.remove(a.id, T0);
  assert.equal(store.restoreFromTrash(a.id)?.title, '열린 일');
  assert.equal(store.list(T0).open.length, 1);
  assert.equal(store.restoreFromTrash(a.id), undefined);
  assert.equal(store.restoreFromTrash(9999), undefined);
  assert.equal(store.trashCount(), 0);
});

test('되돌리기가 걷어 낸 다음 회차는 휴지통에 보이지 않지만 30일 뒤에는 정리된다', () => {
  const { store } = fresh();
  const a = store.add({ title: '매일', repeat: 'daily', due: '2026-10-02' }, T0);
  store.complete(a.id, T0);
  assert.equal(store.list(T0).open.length, 1);
  store.undo(a.id, T0 + 1000);
  assert.equal(store.trashCount(), 0);
  assert.deepEqual(store.trash(T0), []);
  assert.equal(store.purgeExpired(T0 + 1000 + 30 * DAY), 1);
});

test('영구 삭제: 고른 것만, 장부는 그대로, 맨 끝 번호를 지워도 새 할 일이 같은 번호를 받지 않는다', () => {
  const { db, store } = fresh();
  const a = store.add({ title: '가' }, T0);
  const b = store.add({ title: '나' }, T0);
  store.complete(b.id, T0);
  store.remove(a.id, T0);
  store.remove(b.id, T0);
  const ledgerBefore = ledger(db);
  assert.equal(store.purge([b.id]), 1);
  assert.deepEqual(ledger(db), ledgerBefore);
  assert.equal(store.trashCount(), 1);
  // 휴지통에 없는(지우지 않은) 할 일은 영구 삭제하지 않는다
  const c = store.add({ title: '다' }, T0);
  assert.equal(store.purge([c.id, 0, -1, Number.NaN]), 0);
  assert.equal(store.get(c.id)?.title, '다');
  // b 번호는 장부가 기억하니 c 는 b 보다 큰 번호
  assert.ok(c.id > b.id);
  // 새 할 일을 끝내면 옛 b 코인에 깎이지 않는다
  assert.equal(store.complete(c.id, T0 + 5), COIN.todo);
});

test('휴지통 비우기는 휴지통에 있는 것만 지우고 열린 할 일은 건드리지 않는다', () => {
  const { store } = fresh();
  const keep = store.add({ title: '남김' }, T0);
  for (const title of ['하나', '둘', '셋']) store.remove(store.add({ title }, T0).id, T0);
  assert.equal(store.emptyTrash(), 3);
  assert.equal(store.trashCount(), 0);
  assert.equal(store.get(keep.id)?.title, '남김');
});

// ---- 버그잡이 (#133) ----

test('손으로 지운 다음 회차를 되돌리기 뒤 되살리면 반복이 두 벌이 되지 않는다', () => {
  const { store } = fresh();
  const a = store.add({ title: '매일', repeat: 'daily', due: utcDay(T0) }, T0);
  store.complete(a.id, T0);
  const b = store.list(T0).open.find((t) => t.title === '매일');
  assert.ok(b);
  store.remove(b.id, T0 + 1000);
  store.undo(a.id, T0 + 2000);
  assert.equal(store.restoreCheck(b.id), 'dup');
  assert.equal(store.restoreFromTrash(b.id), undefined);
  assert.equal(store.list(T0 + 3000).open.filter((t) => t.title === '매일').length, 1);
  // 앞 회차를 다시 끝내면(다음 회차가 생김) 옛 것은 되살릴 수 없는 채로 남고, 앞 회차가 끝났을 때는 되살릴 수 있다
  assert.equal(store.trashCount(), 1);
});

test('앞 회차가 끝난 채이고 열린 회차가 없으면 지운 다음 회차를 되살릴 수 있다', () => {
  const { store } = fresh();
  const a = store.add({ title: '매일', repeat: 'daily', due: utcDay(T0) }, T0);
  store.complete(a.id, T0);
  const b = store.list(T0).open.find((t) => t.title === '매일');
  assert.ok(b);
  store.remove(b.id, T0 + 1000);
  assert.equal(store.restoreCheck(b.id), 'ok');
  assert.equal(store.restoreFromTrash(b.id)?.id, b.id);
  assert.equal(store.restoreCheck(b.id), 'gone');
});

test('13판에서 올릴 때 되돌리기가 걷어 낸 옛 다음 회차는 휴지통에 보이지 않는다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  for (let v = 0; v < 13; v++) db.exec(MIGRATIONS[v] ?? '');
  db.exec('pragma user_version = 13');
  const add = db.prepare(
    "insert into todo (id, title, due, important, created_at, repeat, repeat_of, done_at, deleted_at) values (?, ?, ?, 0, ?, 'daily', ?, ?, ?)",
  );
  add.run(1, '매일', '2026-10-02', T0, null, null, null);
  add.run(2, '매일', '2026-10-03', T0, 1, null, T0 + 5000);
  // 앞 회차를 끝낸 채 손으로 지운 다음 회차는 그대로 휴지통
  add.run(3, '주간', '2026-10-02', T0, null, T0, null);
  add.run(4, '주간', '2026-10-09', T0, 3, null, T0 + 6000);
  migrate(db);
  const store = new TodoStore(db, utcDay);
  assert.deepEqual(
    store.trash(T0 + 7000).map((x) => x.id),
    [4],
  );
});

test('영구 삭제한 번호는 장부에 없어도 다시 쓰지 않는다', () => {
  const { store } = fresh();
  store.add({ title: '남김' }, T0);
  const x = store.add({ title: '집중 대상' }, T0);
  store.remove(x.id, T0);
  store.emptyTrash();
  const y = store.add({ title: '새것' }, T0);
  assert.ok(y.id > x.id);
  // 열린 번호 가운데 맨 끝을 영구 삭제해도 마찬가지
  store.remove(y.id, T0);
  store.purge([y.id]);
  assert.ok(store.add({ title: '또 새것' }, T0).id > y.id);
});

test('켜질 때 시계가 크게 앞서 있으면 휴지통을 비우지 않는다, 미래 지운 때는 지금으로 맞춘다', () => {
  const { db, store } = fresh();
  const a = store.add({ title: '어제 지움' }, T0);
  store.remove(a.id, T0);
  // 가장 최근 기록 날이 T0 인데 시계가 1년 앞
  db.prepare("insert into daily_stat (day, on_min) values ('2026-10-02', 5)").run();
  assert.equal(store.purgeExpired(T0 + 365 * DAY), 0);
  assert.equal(store.trashCount(), 1);
  // 기록이 이어진 평범한 경우는 지금처럼 지운다
  db.prepare("insert into daily_stat (day, on_min) values ('2026-11-10', 5)").run();
  assert.equal(store.purgeExpired(T0 + 40 * DAY), 1);
  // 지운 때가 미래(시계가 틀렸거나 가져온 백업)면 지금으로 맞춘다
  const b = store.add({ title: '미래 지움' }, T0);
  store.remove(b.id, T0 + 400 * DAY);
  store.purgeExpired(T0 + 41 * DAY);
  assert.equal(store.trash(T0 + 41 * DAY)[0]?.deletedAt, T0 + 41 * DAY);
});
