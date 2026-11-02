// 동기화 엔진 시험 3: 가장자리 (보류 풀기, 낡은 표식, 큰 항목, 요청 한도, 서버가 모르는 내용)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../../shared/db-schema.ts';
import { bodyHash } from '../../shared/sync-item.ts';
import { sealItem } from './crypto.ts';
import { ACCOUNT, type Dev, FakeSyncServer, pair, settle } from './harness.ts';

const num = (db: Db, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
const uidOf = (db: Db, table: string, id: number) =>
  (db.prepare(`select uid from ${table} where id = ?`).get(id) as { uid: string }).uid;

/** 다른 기기가 올린 것처럼 서버에 항목 하나를 둔다 (dev 의 열쇠로 잠가서) */
function putRemote(
  server: FakeSyncServer,
  dev: Dev,
  uid: string,
  kind: string,
  f: Record<string, unknown>,
  c: Record<string, number> = {},
  extra: Record<string, unknown> = {},
): number {
  const key = Buffer.from(dev.secret() as string, 'base64');
  const clocks = Object.fromEntries(Object.keys(f).map((k) => [k, c[k] ?? Date.now()]));
  const blob = sealItem(key, { account: ACCOUNT, gen: dev.state().gen }, uid, kind, {
    f,
    c: clocks,
    dev: 'ffffffffffffffff',
    name: '남의 기기',
    ...extra,
  });
  server.head += 1;
  server.items.set(uid, { rev: server.head, blob: blob.toString('base64'), deleted: false });
  return server.head;
}

const todoF = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  due: null,
  important: 0,
  created_at: Date.now(),
  done_at: null,
  coin_paid: 0,
  deleted_at: null,
  repeat: null,
  repeat_of: null,
  repeat_anchor: null,
  pinned_at: null,
  due_min: null,
  reminders: [],
  ...extra,
});

test('서버는 내용을 모른다: 제목, 본문, 단계가 덩어리 어디에도 글자로 없다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '비밀스러운 제목', body: '아주 은밀한 본문 내용' }, Date.now());
  const t = a.todos.add({ title: '말하기 어려운 할 일' }, Date.now());
  a.todos.addStep(t.id, '숨겨진 단계', Date.now());
  await settle([a, b]);
  assert.equal(server.items.size, 3);
  const all =
    JSON.stringify(server.key) +
    [...server.items.values()].map((i) => Buffer.from(i.blob, 'base64').toString('latin1') + i.blob).join('');
  for (const word of ['비밀스러운', '은밀한', '말하기 어려운', '숨겨진', 'title', 'todo', 'note'])
    assert.ok(!all.includes(word), word);
  // 덩어리 길이는 256바이트 단위(+ nonce 12 + 태그 16)
  for (const i of server.items.values()) assert.equal((Buffer.from(i.blob, 'base64').length - 28) % 256, 0);
});

test('보류 풀기: 앞 회차가 오래 안 오면 반복 연결만 끊고 적용한다 (10분 뒤)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  putRemote(
    server,
    a,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'todo',
    todoF('다음 회차', { repeat_of: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', repeat: 'daily' }),
  );
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from todo'), 0);
  assert.equal(b.engine.view().held, 1);
  b.clock.now += 5 * 60_000;
  await b.engine.run(true);
  assert.equal(b.engine.view().held, 1, '5분은 더 기다린다');
  b.clock.now += 6 * 60_000;
  await b.engine.run(true);
  assert.equal(b.engine.view().held, 0);
  const row = b.db.prepare('select title, repeat_of from todo').get() as {
    title: string;
    repeat_of: number | null;
  };
  assert.deepEqual({ ...row }, { title: '다음 회차', repeat_of: null });
});

test('앞 회차가 나중에 오면 연결해서 들인다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const child = 'cccccccccccccccccccccccccccccccc';
  const parent = 'dddddddddddddddddddddddddddddddd';
  putRemote(server, a, child, 'todo', todoF('둘째', { repeat_of: parent, repeat: 'daily' }));
  await b.engine.run(true);
  assert.equal(b.engine.view().held, 1);
  putRemote(server, a, parent, 'todo', todoF('첫째', { repeat: 'daily' }));
  await b.engine.run(true);
  assert.equal(b.engine.view().held, 0);
  const ids = b.db.prepare('select id, uid, repeat_of from todo order by id').all() as {
    id: number;
    uid: string;
    repeat_of: number | null;
  }[];
  assert.equal(ids.length, 2);
  const kid = ids.find((r) => r.uid === child);
  const mom = ids.find((r) => r.uid === parent);
  assert.equal(kid?.repeat_of, mom?.id);
});

test('부모 할 일이 영구 삭제된 뒤 올라온 단계는 서버에서도 지운다 (고아가 서버에 남지 않게)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '지워질 할 일' }, Date.now());
  await settle([a, b]);
  const parent = uidOf(a.db, 'todo', t.id);
  a.todos.remove(t.id, Date.now());
  a.todos.purge([t.id]);
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from todo'), 0);
  const step = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  putRemote(server, a, step, 'todo_step', { todo_id: parent, title: '고아', done: 0, ord: 1, created_at: 1 });
  await settle([a, b]);
  assert.equal(b.engine.view().held, 0);
  assert.equal(server.items.get(step)?.deleted, true, '서버에서 지웠다');
  assert.equal(num(b.db, 'select count(*) as n from todo_step'), 0);
});

test('서버가 덩어리를 비운 삭제 표식(90일 뒤)은 종류를 몰라도 그 uid 행을 지운다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '오래된 삭제' }, Date.now());
  await settle([a, b]);
  const uid = uidOf(a.db, 'note', n.id);
  server.head += 1;
  server.items.set(uid, { rev: server.head, blob: '', deleted: true });
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 0);
});

test('덩어리가 256KB 를 넘는 항목은 그 항목만 보류하고 나머지는 보낸다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const noise = (len: number) => {
    let s = '';
    while (s.length < len)
      s += Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))).toString(
        'base64',
      );
    return s.slice(0, len);
  };
  a.db
    .prepare("insert into note (title, body, source, created_at, updated_at) values ('거대', ?, 'me', 1, 1)")
    .run(noise(420_000));
  a.notes.add({ title: '작은 메모' }, Date.now());
  await settle([a, b]);
  assert.equal(num(b.db, "select count(*) as n from note where title = '작은 메모'"), 1);
  assert.equal(num(b.db, "select count(*) as n from note where title = '거대'"), 0);
  assert.equal(a.engine.view().held, 1);
  assert.equal(a.engine.view().pending, 0, '보류한 항목은 보낼 목록에서 뺀다');
  assert.equal(a.engine.holds()[0]?.reason, 'big');
});

test('분당 요청 한도(429)를 만나면 1분을 쉬었다 이어 받는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '하나' }, Date.now());
  await a.engine.run(true);
  let hit = 0;
  server.inject = (name) =>
    name === 'changes' && hit++ === 0
      ? ({ ok: false, status: 429, error: 'rate_limited', body: {} } as never)
      : undefined;
  await b.engine.run(true);
  assert.equal(num(b.db, 'select count(*) as n from note'), 0);
  const calls = server.calls.length;
  await b.engine.run();
  assert.equal(server.calls.length, calls, '쉬는 동안 부르지 않는다');
  b.clock.now += 40_000;
  await b.engine.run();
  assert.equal(server.calls.length, calls, '40초 뒤에도 아직 쉰다');
  b.clock.now += 22_000;
  await b.engine.run();
  assert.equal(num(b.db, 'select count(*) as n from note'), 1);
  assert.equal(b.engine.view().problem, null);
});

test('로그인이 필요하면 상태에 알리고 켜진 채 기다린다, 다시 로그인하면 이어간다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  a.notes.add({ title: '로그인 전' }, Date.now());
  server.inject = () => ({ ok: false, status: 403, error: 'login', body: {} }) as never;
  await a.engine.run(true);
  assert.equal(a.engine.view().problem, 'login');
  assert.equal(a.engine.view().phase, 'on');
  assert.ok(a.secret(), '열쇠는 그대로');
  server.inject = undefined;
  await a.engine.run(true);
  assert.equal(a.engine.view().problem, null);
  assert.equal(a.engine.view().pending, 0);
});

test('서버가 범위 밖 scrypt 매개변수를 주면 복구 코드를 넣어도 풀지 않는다', async () => {
  const server = new FakeSyncServer();
  const { code } = await pair(server);
  (server.key as { params: unknown }).params = { N: 1 << 20, r: 8, p: 1 };
  const { newDevice } = await import('./harness.ts');
  const c = newDevice(server, 'C');
  await c.engine.enable();
  assert.deepEqual(await c.engine.enterCode(code), { ok: false, error: 'params' });
  assert.equal(c.secret(), undefined);
});

test('곧 지워짐: 서버가 알리면 상태에 실린다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  const real = server.api.syncStatus;
  server.api.syncStatus = async (t) => {
    const r = await real(t);
    return r.ok ? { ...r, data: { ...r.data, soon: true } } : r;
  };
  await a.engine.refreshUsage(true);
  assert.equal(a.engine.view().soon, true);
  assert.ok(a.engine.view().usage);
});

test('백업 되살리기: 동기화가 꺼져 있으면 아무것도 바꾸지 않는다', async () => {
  const server = new FakeSyncServer();
  const { newDevice } = await import('./harness.ts');
  const a = newDevice(server, 'A');
  const dev = a.state().dev;
  a.engine.afterRestore();
  assert.equal(a.state().dev, dev);
});

test('같은 메모를 두 기기가 서로 모르게 만든 것처럼 같은 uid 로 올려도(백업을 같이 되살린 경우) 하나로 합쳐진다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const uid = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
  for (const d of [a, b])
    d.db
      .prepare(
        "insert into note (title, body, source, created_at, updated_at, uid) values ('같은 메모', '같은 글', 'me', 5, 5, ?)",
      )
      .run(uid);
  // 트리거가 uid 를 다시 채우지 않는 insert (uid 있음)이라 보낼 목록에는 들어간다
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from note'), 1);
  assert.equal(num(b.db, 'select count(*) as n from note'), 1);
  assert.equal(bodyHash('같은 글').length, 32);
});

test('되돌리기가 걷어 낸 다음 회차는 다른 기기의 휴지통에 보이지 않는다 (auto_removed 도 함께 간다)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const t = a.todos.add(
    { title: '매일 영양제', due: new Date(now).toISOString().slice(0, 10), repeat: 'daily' },
    now,
  );
  await settle([a, b]);
  a.todos.complete(t.id, now);
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from todo'), 2, '다음 회차가 생겼다');
  a.todos.undo(t.id, now);
  await settle([a, b]);
  assert.equal(
    num(a.db, 'select count(*) as n from todo where deleted_at is not null and auto_removed = 1'),
    1,
  );
  assert.equal(
    num(b.db, 'select count(*) as n from todo where deleted_at is not null and auto_removed = 1'),
    1,
  );
  assert.equal(b.todos.trashCount(), 0, '걷어 낸 회차는 휴지통에 보이지 않는다');
  assert.equal(a.todos.trashCount(), 0);
});

test('같은 시각에 다른 uid 로 이미 펼쳐진 손대지 않은 회차는 받은 고친 회차로 갈아끼운다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const e = a.events.add({ title: '주간', startAt: now + 86_400_000, repeat: 'weekly' }, now);
  await settle([a, b]);
  b.events.dueReminders(now); // 둘째 기기도 회차를 펼친다
  const occ = a.db
    .prepare(
      'select id, uid, start_at from event where repeat_series = ? and id <> ? order by start_at limit 1',
    )
    .get(e.id, e.id) as {
    id: number;
    uid: string;
    start_at: number;
  };
  // B 의 같은 자리 행의 uid 를 다른 값으로 (24판 uid 정리가 못 한 경우)
  b.db.prepare('update event set uid = ? where uid = ?').run('99999999999999999999999999999999', occ.uid);
  a.events.update(occ.id, { title: '이번만' }, now);
  await settle([a, b]);
  const rows = b.db
    .prepare('select uid, title from event where start_at = ? and deleted_at is null')
    .all(occ.start_at) as { uid: string; title: string }[];
  assert.equal(rows.length, 1, '자리에 한 행만');
  assert.equal(rows[0]?.uid, occ.uid);
  assert.equal(rows[0]?.title, '이번만');
  assert.equal(b.engine.view().held, 0);
});
