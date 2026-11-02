// 동기화 엔진 시험 2: 합치기 규칙, 오프라인, 멈춤, 보류, 코인, 열쇠 바꾸기, 되살리기
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../../shared/db-schema.ts';
import { localDay } from '../../shared/todo-store.ts';
import { type Dev, FakeSyncServer, newDevice, pair, settle, snapshot, spin } from './harness.ts';

const DAY = 86_400_000;
const num = (db: Db, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
const uidOf = (db: Db, table: string, id: number) =>
  (db.prepare(`select uid from ${table} where id = ?`).get(id) as { uid: string }).uid;
const idOf = (db: Db, table: string, uid: string) =>
  (db.prepare(`select id from ${table} where uid = ?`).get(uid) as { id: number } | undefined)?.id;
const same = (a: Dev, b: Dev) => assert.equal(snapshot(a.db), snapshot(b.db));
const bal = (d: Dev) => d.todos.balance();

// ---- 메모 본문 충돌 ----

test('메모 충돌: 같은 본문을 서로 다르게 고치면 나중 것이 남고 진 쪽은 충돌 사본 하나로 두 기기가 수렴한다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '일기', body: '오늘은 맑음' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'note', uidOf(a.db, 'note', n.id)) as number;
  spin();
  a.notes.update(n.id, { body: '완전히 다른 A 의 글' }, Date.now());
  spin();
  b.notes.update(bid, { body: '완전히 다른 B 의 글' }, Date.now());
  // 서로 모르는 채 한 번씩 올리고 받는다 (A 가 먼저)
  await a.engine.run(true);
  await b.engine.run(true);
  await settle([a, b]);
  for (const d of [a, b]) {
    assert.equal(num(d.db, 'select count(*) as n from note'), 2, `${d.name}: 원본과 충돌 사본`);
    const orig = d.db.prepare('select body from note where uid = ?').get(uidOf(a.db, 'note', n.id)) as {
      body: string;
    };
    assert.equal(orig.body, '완전히 다른 B 의 글', '나중에 고친 쪽이 남는다');
    const copy = d.db
      .prepare('select title, body from note where uid <> ?')
      .get(uidOf(a.db, 'note', n.id)) as { title: string; body: string };
    assert.equal(copy.body, '완전히 다른 A 의 글', '진 쪽 본문이 사본으로');
    assert.match(copy.title, /일기 \(충돌 사본, A, \d{4}-\d{2}-\d{2}\)/);
  }
  same(a, b);
  assert.equal(
    (a.db.prepare('select uid from note where title like ?').get('%충돌 사본%') as { uid: string }).uid,
    (b.db.prepare('select uid from note where title like ?').get('%충돌 사본%') as { uid: string }).uid,
    '같은 사본 uid',
  );
  // 사본에는 충돌 사본 표시가 남는다
  assert.equal(num(a.db, 'select count(*) as n from sync_copy'), 1);
  assert.equal(num(b.db, 'select count(*) as n from sync_copy'), 1);
  // 더 맞춰도 사본이 늘지 않는다
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 2);
  assert.equal(num(b.db, 'select count(*) as n from note'), 2);
});

test('메모 충돌: 반대 순서(B 가 먼저 올려도)로도 같은 사본 하나로 수렴한다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '메모', body: '처음' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'note', uidOf(a.db, 'note', n.id)) as number;
  spin();
  a.notes.update(n.id, { body: '에이' }, Date.now());
  spin();
  b.notes.update(bid, { body: '비' }, Date.now());
  await b.engine.run(true);
  await a.engine.run(true);
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 2);
  same(a, b);
  const live = a.db.prepare('select body from note where uid = ?').get(uidOf(a.db, 'note', n.id)) as {
    body: string;
  };
  assert.equal(live.body, '비');
});

test('메모 충돌: 둘 다 끝에 덧붙였으면 사본 없이 합쳐진다 (mergeNoteText)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '장보기', body: '우유' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'note', uidOf(a.db, 'note', n.id)) as number;
  spin();
  a.notes.update(n.id, { body: '우유\n빵' }, Date.now());
  spin();
  b.notes.update(bid, { body: '우유\n계란' }, Date.now());
  await a.engine.run(true);
  await b.engine.run(true);
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 1, '사본이 생기지 않았다');
  assert.equal(num(b.db, 'select count(*) as n from note'), 1);
  same(a, b);
  const body = (a.db.prepare('select body from note').get() as { body: string }).body;
  assert.ok(body.includes('빵') && body.includes('계란') && body.startsWith('우유'), body);
});

test('메모 충돌: 한쪽만 고쳤으면 충돌이 아니다 (제목만 고친 쪽의 본문은 그대로)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '제목', body: '본문' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'note', uidOf(a.db, 'note', n.id)) as number;
  spin();
  a.notes.update(n.id, { body: '본문을 고침' }, Date.now());
  spin();
  b.notes.update(bid, { title: '새 제목' }, Date.now());
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 1);
  const row = a.db.prepare('select title, body from note').get() as { title: string; body: string };
  assert.deepEqual({ ...row }, { title: '새 제목', body: '본문을 고침' });
  same(a, b);
});

// ---- 지우기 ----

test('휴지통: 한쪽이 지우고 다른 쪽이 되살리면 나중 것이 이긴다 (양쪽 순서)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '운동' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  spin();
  a.todos.remove(t.id, Date.now());
  spin();
  b.todos.remove(bid, Date.now());
  spin();
  b.todos.restore(bid);
  await settle([a, b]);
  assert.ok(a.todos.get(t.id), '나중의 되살리기가 이긴다');
  spin();
  a.todos.remove(t.id, Date.now());
  await settle([a, b]);
  assert.equal(b.todos.get(bid), undefined, '나중의 지우기가 이긴다');
  same(a, b);
});

test('영구 삭제는 되살리지 않는다: 지운 쪽 표식이 다른 쪽의 뒤늦은 고침을 이긴다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '지울 메모', body: 'x' }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'note', uidOf(a.db, 'note', n.id)) as number;
  a.notes.remove(n.id, Date.now());
  await settle([a, b]);
  a.notes.purge(n.id);
  spin();
  b.notes.restore(bid);
  b.notes.update(bid, { body: '되살려 고침' }, Date.now());
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 0);
  assert.equal(num(b.db, 'select count(*) as n from note'), 0, '영구 삭제가 이긴다');
  assert.equal(num(b.db, 'select count(*) as n from sync_outbox'), 0);
});

test('영구 삭제 표식보다 늦게 같은 uid 로 다시 만든 행은 산다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '옛 메모', body: 'old' }, Date.now());
  await settle([a, b]);
  const uid = uidOf(a.db, 'note', n.id);
  a.notes.remove(n.id, Date.now());
  a.notes.purge(n.id);
  // B 는 표식을 받기 전에 같은 uid 로 다시 만든다 (표식보다 늦은 생성)
  spin(5);
  const bid = idOf(b.db, 'note', uid) as number;
  b.db.prepare('delete from note where id = ?').run(bid);
  spin(5);
  b.db
    .prepare(
      "insert into note (title, body, source, created_at, updated_at, uid) values ('다시', 'new', 'me', 1, 1, ?)",
    )
    .run(uid);
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note where uid = ?', uid), 1, 'A 도 다시 받았다');
  assert.equal(
    (a.db.prepare('select body from note where uid = ?').get(uid) as { body: string }).body,
    'new',
  );
  same(a, b);
});

// ---- 오프라인, 멈춤, 보류 ----

test('오프라인: 닿지 않으면 쌓아 두고 상태에 표시하다가 닿으면 합쳐 맞춘다, 앱은 그대로 돈다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  server.online = false;
  const n = a.notes.add({ title: '오프라인 메모' }, Date.now());
  a.todos.add({ title: '오프라인 할 일' }, Date.now());
  b.notes.add({ title: 'B 오프라인' }, Date.now());
  await a.engine.run(true);
  assert.equal(a.engine.view().offline, true);
  assert.equal(a.engine.view().pending, 2);
  assert.ok(a.engine.view().phase === 'on');
  // 앱은 지금처럼 돈다
  a.notes.update(n.id, { body: '계속 씀' }, Date.now());
  assert.equal(a.notes.get(n.id)?.body, '계속 씀');
  server.online = true;
  await settle([a, b]);
  assert.equal(a.engine.view().offline, false);
  assert.equal(a.engine.view().pending, 0);
  assert.equal(a.engine.view().lastAt !== null, true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 2);
  same(a, b);
});

test('시계가 하루 넘게 앞선 기기: 받은 칸 시각은 지금 + 1일로 잘라 쓴다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.todos.add({ title: '미래 시계' }, Date.now());
  a.db.exec("update sync_clock set t = t + 3 * 86400000 where kind = 'todo'");
  await settle([a, b]);
  const max = num(b.db, "select max(t) as n from sync_clock where kind = 'todo'");
  assert.ok(max <= b.clock.now + DAY + 5_000, `잘라 썼다 ${new Date(max).toISOString()}`);
  assert.ok(max > b.clock.now + DAY - 60_000, '그래도 하루 앞은 인정');
  assert.equal(b.todos.list(Date.now()).open[0]?.title, '미래 시계');
});

test('epoch 가 바뀌면(다른 곳에서 서버 사본을 지움) 맞추기를 멈추고 열쇠와 커서를 지운다, 코드를 다시 넣으면 합집합으로 이어간다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '함께' }, Date.now());
  await settle([a, b]);
  assert.ok(a.state().cursor > 0);
  // B 가 서버 사본을 지운다
  assert.deepEqual(await b.engine.disable(true), { ok: true });
  assert.equal(b.engine.view().phase, 'off');
  a.notes.add({ title: '멈춘 뒤 메모' }, Date.now());
  await a.engine.run(true);
  const v = a.engine.view();
  assert.equal(v.phase, 'needCode');
  assert.equal(v.problem, 'epoch');
  assert.equal(a.secret(), undefined, '열쇠를 지웠다');
  assert.equal(a.state().cursor, 0);
  assert.equal(num(a.db, 'select count(*) as n from note'), 2, '이 기기의 데이터는 그대로');
  const calls = server.calls.length;
  await a.engine.run(true);
  assert.equal(server.calls.length, calls, '멈춘 동안 서버를 부르지 않는다');
  // B 가 새로 켜고 A 가 새 코드를 넣는다
  const r = await b.engine.enable();
  assert.ok(r.ok && r.kind === 'created');
  assert.deepEqual(await a.engine.enterCode(r.code), { ok: true });
  await settle([a, b]);
  assert.equal(a.engine.view().problem, null);
  assert.equal(num(b.db, 'select count(*) as n from note'), 2, 'A 의 데이터가 새 사본으로 올라갔다');
  same(a, b);
});

test('gen 이 서버와 다르면(다른 기기가 열쇠를 바꿈) 멈춘다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  (server.key as { gen: number }).gen += 1;
  await a.engine.run(true);
  assert.equal(a.engine.view().problem, 'gen');
  assert.equal(a.secret(), undefined);
});

test('로그아웃, 탈퇴: 열쇠와 커서를 지우고 끈다, 다른 계정으로 바뀌면 앞사람 열쇠를 지운다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '앞사람 메모' }, Date.now());
  await settle([a, b]);
  a.engine.onAccountEnd('logout');
  assert.equal(a.secret(), undefined);
  assert.equal(a.state().on, false);
  assert.equal(a.state().cursor, 0);
  assert.equal(a.engine.view().phase, 'off');
  assert.equal(num(a.db, 'select count(*) as n from note'), 1);
  // 계정 코드가 바뀐 채 도는 기기: 지우고 멈춘다
  let acct = 'F-OLD-0001';
  const c = newDevice(server, 'C', { account: () => acct });
  server.key = null;
  server.hasHead = false;
  const r = await c.engine.enable();
  assert.ok(r.ok && r.kind === 'created');
  acct = 'F-NEW-0002';
  await c.engine.run(true);
  assert.equal(c.secret(), undefined);
  assert.equal(c.state().on, false);
  assert.equal(c.engine.view().problem, 'account');
});

test('보류: 풀리지 않는 항목, 적용에 실패하는 항목은 그 항목만 두고 나머지는 계속한다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  // 서버에 깨진 덩어리 하나, 그 뒤에 정상 항목
  server.head += 1;
  server.items.set('bad-blob', {
    rev: server.head,
    blob: Buffer.alloc(300, 7).toString('base64'),
    deleted: false,
  });
  a.notes.add({ title: '정상 1' }, Date.now());
  b.db.exec(
    "create trigger boom before insert on note when new.title = '폭발' begin select raise(abort, 'boom'); end",
  );
  a.notes.add({ title: '폭발' }, Date.now());
  a.notes.add({ title: '정상 2' }, Date.now());
  await a.engine.run(true);
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 2, '나머지는 들어왔다');
  assert.equal(b.engine.view().held, 2, '깨진 것 하나, 적용 실패 하나');
  assert.deepEqual(
    b.engine
      .holds()
      .map((h) => h.reason)
      .sort(),
    ['apply', 'decrypt'],
  );
  assert.ok(b.state().cursor >= server.head, '커서는 지나갔다');
  // 보류 때문에 보내기가 막히지 않는다
  b.notes.add({ title: 'B 에서 새로' }, Date.now());
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note where title = ?', 'B 에서 새로'), 1);
  // 문제가 사라지면(트리거 제거) 다시 적용 시도로 들어온다
  b.db.exec('drop trigger boom');
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 4);
  assert.equal(b.engine.view().held, 1);
});

test('보류: 부모보다 단계가 먼저 와도(번호 순서가 뒤집힘) 부모가 오면 단계가 들어온다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '부모' }, Date.now());
  a.todos.addStep(t.id, '자식', Date.now());
  await a.engine.run(true);
  // 서버 번호를 뒤집어 단계가 먼저 온다
  const entries = [...server.items.entries()];
  const [x, y] = [entries[0], entries[1]];
  assert.ok(x && y);
  const rx = x[1].rev;
  x[1].rev = y[1].rev;
  y[1].rev = rx;
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from todo_step'), 1);
  assert.equal(b.engine.view().held, 0);
  same(a, b);
});

// ---- 코인 ----

test('코인: 다른 기기에서 받은 완료는 코인 0, 되돌리고 다시 끝내도 0', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const t = a.todos.add({ title: '코인 시험', due: localDay(now) }, now);
  await settle([a, b]);
  const got = a.todos.complete(t.id, now);
  assert.ok(got > 0);
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  assert.ok(b.todos.get(bid)?.doneAt, 'B 에도 완료로 보인다');
  assert.equal(bal(b), 0, '받은 완료는 코인 없음');
  assert.equal(num(b.db, 'select coins as n from todo'), 0, '받은 할 일의 코인 칸은 0');
  assert.equal(num(b.db, 'select count(*) as n from coin_log'), 0);
  assert.equal(b.todos.undo(bid, now), 0);
  assert.equal(b.todos.complete(bid, now), 0, '되돌리고 다시 끝내도 코인 0');
  assert.equal(num(b.db, 'select count(*) as n from coin_log'), 0);
  await settle([a, b]);
  assert.equal(bal(a), got, 'A 의 코인은 그대로');
});

test('코인: A 에서 환불한 뒤 B 가 끝내면 받는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const t = a.todos.add({ title: '환불 뒤', due: localDay(now) }, now);
  const got = a.todos.complete(t.id, now);
  assert.ok(got > 0);
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  spin();
  assert.equal(a.todos.undo(t.id, now), got, 'A 가 환불');
  assert.equal(bal(a), 0);
  await settle([a, b]);
  assert.equal(b.todos.get(bid)?.doneAt, null);
  assert.equal(
    b.db.prepare('select coin_paid from todo').get() &&
      Number((b.db.prepare('select coin_paid from todo').get() as { coin_paid: number }).coin_paid),
    0,
    '환불로 coin_paid 가 0',
  );
  spin();
  const bgot = b.todos.complete(bid, now);
  assert.ok(bgot > 0, 'B 는 받는다');
  assert.equal(bal(b), bgot);
  await settle([a, b]);
  assert.equal(
    Number((a.db.prepare('select coin_paid from todo').get() as { coin_paid: number }).coin_paid),
    1,
  );
  same(a, b);
});

// ---- 열쇠 ----

test('복구 코드 새로 만들기: 새 코드로 다른 기기를 켤 수 있고 옛 코드는 더 이상 안 된다', async () => {
  const server = new FakeSyncServer();
  const { a, code } = await pair(server);
  const r = await a.engine.newCode();
  assert.ok(r.ok);
  assert.notEqual(r.code, code);
  const c = newDevice(server, 'C');
  await c.engine.enable();
  assert.deepEqual(await c.engine.enterCode(code), { ok: false, error: 'code' });
  assert.deepEqual(await c.engine.enterCode(r.code), { ok: true });
  assert.equal(c.secret(), a.secret(), '같은 데이터 열쇠');
  assert.equal(server.key?.keyRev, 2);
  assert.equal(server.key?.gen, 1);
});

test('열쇠 바꾸기: 새 열쇠로 다시 올리고, 다른 기기는 멈춘 뒤 새 코드를 넣으면 이어간다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '열쇠 바꾸기 전' }, Date.now());
  b.todos.add({ title: 'B 할 일' }, Date.now());
  await settle([a, b]);
  const oldKey = a.secret();
  const r = await a.engine.rotateKey();
  assert.ok(r.ok);
  assert.notEqual(a.secret(), oldKey);
  assert.equal(server.key?.gen, 2);
  assert.equal(server.items.size, 0, '서버는 옛 열쇠로 잠근 항목을 모두 지웠다');
  await a.engine.run(true);
  assert.equal(server.items.size, 2, '이 기기가 새 열쇠로 다시 올렸다 (받아 둔 B 의 할 일까지)');
  await b.engine.run(true);
  assert.equal(b.engine.view().phase, 'needCode');
  assert.equal(b.secret(), undefined);
  assert.deepEqual(await b.engine.enterCode(r.code), { ok: true });
  await settle([a, b]);
  assert.equal(server.items.size, 2);
  assert.equal(num(a.db, 'select count(*) as n from todo'), 1, 'B 의 할 일이 A 에도');
  same(a, b);
});

test('끄기: 이 컴퓨터만 끄면 서버 사본은 남고, 서버 사본도 지우면 열쇠까지 사라진다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '남는 메모' }, Date.now());
  await settle([a, b]);
  assert.deepEqual(await a.engine.disable(false), { ok: true });
  assert.equal(a.engine.view().phase, 'off');
  assert.equal(a.secret(), undefined);
  assert.equal(server.items.size, 1);
  assert.ok(server.key);
  assert.equal(num(a.db, 'select count(*) as n from note'), 1, '데이터는 그대로');
  assert.deepEqual(await b.engine.disable(true), { ok: true });
  assert.equal(server.items.size, 0);
  assert.equal(server.key, null);
});

// ---- 상태, 나누기, 상한 ----

test('보내기는 묶음 200개로 나눈다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  for (let i = 0; i < 450; i++) a.notes.add({ title: `메모 ${i}`, body: 'x'.repeat(10) }, Date.now());
  const before = server.calls.filter((c) => c === 'push').length;
  await a.engine.run(true);
  assert.equal(server.calls.filter((c) => c === 'push').length - before, 3, '200, 200, 50');
  assert.equal(server.items.size, 450);
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 450);
});

test('받기는 서버가 more 를 주는 동안 계속한다 (한 쪽 500개)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  for (let i = 0; i < 520; i++) a.notes.add({ title: `n${i}` }, Date.now());
  await a.engine.run(true);
  const before = server.calls.filter((c) => c === 'changes').length;
  await b.engine.run(true);
  assert.equal(server.calls.filter((c) => c === 'changes').length - before, 2);
  assert.equal(num(b.db, 'select count(*) as n from note'), 520);
});

test('서버 공간이 차면(413 sync_full) 멈추지 않고 보낼 것으로 남기며 상태에 알린다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  server.maxItems = 1;
  a.notes.add({ title: '1' }, Date.now());
  a.notes.add({ title: '2' }, Date.now());
  await a.engine.run(true);
  assert.equal(a.engine.view().problem, 'full');
  assert.equal(a.engine.view().pending, 2);
  assert.equal(a.engine.view().phase, 'on');
  server.maxItems = 100;
  await a.engine.run(true);
  assert.equal(a.engine.view().pending, 0);
  assert.equal(a.engine.view().problem, null);
});

test('상태: 켜짐, 마지막 시각, 보낼 것 수, 보류 수, 서버 사용량', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  assert.equal(a.engine.view().phase, 'on');
  a.notes.add({ title: '상태' }, Date.now());
  assert.equal(a.engine.view().pending, 1);
  await a.engine.run(true);
  const v = a.engine.view();
  assert.equal(v.pending, 0);
  assert.equal(v.held, 0);
  assert.ok(v.lastAt);
  assert.ok(v.usage && v.usage.items >= 1 && v.usage.maxItems === 100_000);
  assert.equal(v.soon, false);
});

// ---- 백업 되살리기 ----

test('백업을 되살린 뒤: 기기 번호가 새로 만들어지고 커서가 0 이 되어 전부 다시 받으며 겹치지 않는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '백업 전' }, Date.now());
  a.todos.add({ title: '할 일' }, Date.now());
  await settle([a, b]);
  const dev = a.state().dev;
  assert.ok(a.state().cursor > 0);
  a.engine.afterRestore();
  assert.notEqual(a.state().dev, dev);
  assert.equal(a.state().cursor, 0);
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 1);
  assert.equal(num(b.db, 'select count(*) as n from note'), 1);
  assert.equal(num(a.db, 'select count(*) as n from todo'), 1);
  same(a, b);
});

test('쓰기 알림: 보낼 것이 생길 만한 문장만 모은다', async () => {
  const server = new FakeSyncServer();
  const a = newDevice(server, 'A');
  const ok = (sql: string) =>
    /\b(?:insert|update|delete|replace)\b[\s\S]*\b(?:todo|todo_step|note|event|reminder)/i.test(sql);
  assert.ok(ok('update todo set title = ? where id = ?'));
  assert.ok(ok('insert into note (title) values (?)'));
  assert.ok(!ok('update pet_state set mood = 1'));
  a.engine.notifyWrite('update pet_state set mood = 1');
});
