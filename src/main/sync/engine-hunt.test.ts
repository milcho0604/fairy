// 동기화 엔진 시험 4: 검토(PR 295)에서 나온 문제의 재현. 열쇠 보관 실패, 낡은 기기, 계정 바뀜, 보류
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../../shared/db-schema.ts';
import { NoteStore } from '../../shared/note-store.ts';
import { TodoStore } from '../../shared/todo-store.ts';
import { createSyncEngine } from './engine.ts';
import { ACCOUNT, FakeSyncServer, newDevice, pair, settle } from './harness.ts';

const num = (db: Db, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);

/** 열쇠 보관을 마음대로 실패시킬 수 있는 기기 */
function flakyDevice(
  server: FakeSyncServer,
  account: () => string | undefined = () => ACCOUNT,
  o: { db?: Db; stored?: unknown; secret?: string } = {},
) {
  const db = o.db ?? (new DatabaseSync(':memory:') as unknown as Db);
  if (!o.db) migrate(db);
  let stored: unknown = o.stored;
  let secret: string | undefined = o.secret;
  const f = { failSet: false, failGet: false, logs: [] as string[], server };
  const make = () =>
    createSyncEngine({
      db,
      call: async (fn) => fn(f.server.api, 'session'),
      account,
      load: () => stored,
      save: (s) => {
        stored = structuredClone(s);
      },
      key: {
        get: () => (f.failGet ? undefined : secret),
        set: (v) => {
          if (f.failSet && v) throw new Error('safeStorage 실패');
          secret = v ?? undefined;
        },
        unreadable: () => false,
      },
      secure: () => true,
      now: Date.now,
      deviceName: () => 'X',
      random: (n) => randomBytes(n),
      log: (...a) => f.logs.push(a.join(' ')),
      scrypt: { N: 1 << 10, r: 8, p: 1 },
      timers: false,
    });
  const engine = make();
  return {
    db,
    engine,
    make,
    f,
    stored: () => stored,
    notes: new NoteStore(db),
    todos: new TodoStore(db),
    secret: () => secret,
  };
}

test('K1 복구 코드 새로 만들기: 다른 기기가 서버를 지우고 새로 켠 뒤 낡은 기기가 누르면 서버 열쇠를 낡은 열쇠로 덮는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  // B 가 서버 사본을 지우고 새 열쇠로 다시 켠다
  assert.equal((await b.engine.disable(true)).ok, true);
  const again = await b.engine.enable();
  assert.ok(again.ok && again.kind === 'created');
  const codeB = again.kind === 'created' ? again.code : '';
  // A 는 아직 낡은 열쇠를 들고 있다 (한 번도 맞추지 않았다)
  await a.engine.newCode();
  // 새 기기가 B 의 코드로 열쇠를 받으면 B 의 항목을 풀 수 있어야 한다
  const c = newDevice(server, 'C');
  assert.equal((await c.engine.enable()).ok, true);
  const r = await c.engine.enterCode(codeB);
  assert.equal(r.ok, true, `B 의 복구 코드가 더 이상 안 통한다: ${JSON.stringify(r)}`);
});

test('K2 첫 기기 켜기: PUT 성공 뒤 열쇠 저장이 실패하면 서버에 아무도 코드를 모르는 열쇠가 남는다', async () => {
  const server = new FakeSyncServer();
  const x = flakyDevice(server);
  x.f.failSet = true;
  const r = await x.engine.enable();
  assert.equal(r.ok, false);
  assert.equal(
    server.key,
    null,
    '코드를 못 본 열쇠가 서버에 남았다 (다음에 켜면 복구 코드 넣기로 가서 영영 못 푼다)',
  );
});

test('K3 열쇠 바꾸기: PUT 성공 뒤 저장이 실패하면 서버 항목이 지워지고 새 코드는 사용자가 못 본다', async () => {
  const server = new FakeSyncServer();
  const x = flakyDevice(server);
  const e = await x.engine.enable();
  assert.ok(e.ok && e.kind === 'created');
  x.notes.add({ title: '메모', body: '본문' }, Date.now());
  await x.engine.run(true);
  assert.equal(server.items.size > 0, true);
  x.f.failSet = true;
  const gen0 = server.key?.gen;
  const r = await x.engine.rotateKey();
  assert.equal(r.ok, false);
  assert.equal(
    server.key?.gen,
    gen0,
    '서버는 gen 이 올라가고 항목이 지워졌는데 기기는 새 열쇠도 코드도 없다',
  );
});

test('K4 로그아웃 뒤 다른 계정으로 켜면 앞사람의 메모를 자동으로 올리지 않고 묻는다', async () => {
  const server = new FakeSyncServer();
  let acct = 'F-AAAA-0001';
  const x = flakyDevice(server, () => acct);
  assert.ok((await x.engine.enable()).ok);
  x.notes.add({ title: '앞사람 비밀', body: '앞사람 메모' }, Date.now());
  await x.engine.run(true);
  assert.equal(server.items.size, 1);
  x.engine.onAccountEnd('logout');
  assert.equal(x.engine.view().phase, 'off');
  // 다른 사람의 계정 (서버는 계정마다 따로이므로 새 서버)
  const server2 = new FakeSyncServer();
  x.f.server = server2;
  acct = 'F-BBBB-0002';
  const e = await x.engine.enable();
  assert.ok(e.ok && e.kind === 'created');
  assert.equal(x.engine.view().phase, 'askUpload');
  await x.engine.run(true);
  assert.equal(server2.items.size, 0, '앞사람 데이터가 새 계정으로 올라갔다');
  // 옛 계정으로 다시 켜면 묻지 않는다
  x.engine.onAccountEnd('logout');
  x.f.server = server;
  acct = 'F-AAAA-0001';
  const again = await x.engine.enable();
  assert.ok(again.ok);
});

test('K4 선택 1: uploadLocal 은 이 컴퓨터의 항목을 새 계정에 올린다', async () => {
  const server = new FakeSyncServer();
  let acct = 'F-AAAA-0001';
  const x = flakyDevice(server, () => acct);
  assert.ok((await x.engine.enable()).ok);
  x.notes.add({ title: '내 메모' }, Date.now());
  x.engine.onAccountEnd('logout');
  const server2 = new FakeSyncServer();
  x.f.server = server2;
  acct = 'F-BBBB-0002';
  assert.ok((await x.engine.enable()).ok);
  assert.equal(x.engine.uploadLocal().ok, true);
  assert.equal(x.engine.view().phase, 'on');
  await x.engine.run(true);
  assert.equal(server2.items.size, 1);
  assert.equal(x.engine.uploadLocal().ok, false, '이미 골랐다');
});

test('K4 선택 2: downloadOnly 는 기존 항목을 올리지 않고 서버 것만 받는다, 새로 고친 것은 올라간다', async () => {
  const server = new FakeSyncServer();
  let acct = 'F-AAAA-0001';
  const x = flakyDevice(server, () => acct);
  assert.ok((await x.engine.enable()).ok);
  const keep = x.notes.add({ title: '앞사람 메모' }, Date.now());
  const edit = x.notes.add({ title: '나중에 고칠 메모' }, Date.now());
  x.engine.onAccountEnd('logout');
  const server2 = new FakeSyncServer();
  x.f.server = server2;
  acct = 'F-BBBB-0002';
  const e = await x.engine.enable();
  assert.ok(e.ok && e.kind === 'created');
  assert.equal(x.engine.downloadOnly().ok, true);
  await x.engine.run(true);
  assert.equal(server2.items.size, 0);
  assert.equal(x.engine.view().pending, 0);
  // 열쇠를 바꿔 모두 다시 올려도 올리지 않기로 한 항목은 올리지 않는다
  const r = await x.engine.rotateKey();
  assert.ok(r.ok);
  await x.engine.run(true);
  assert.equal(server2.items.size, 0, '표시한 항목은 다시 올리지 않는다');
  await new Promise((r2) => setTimeout(r2, 3));
  x.notes.update(edit.id, { title: '고쳤다' }, Date.now());
  await x.engine.run(true);
  assert.equal(server2.items.size, 1, '새로 고친 항목은 올라간다');
  void keep;
});

test('K5 켜는 도중(키 올리는 중) 로그아웃하면 켜진 채 열쇠가 저장된다', async () => {
  const server = new FakeSyncServer();
  const x = flakyDevice(server);
  const orig = server.api.syncKeyPut;
  let release: () => void = () => {};
  const gate = new Promise<void>((res) => {
    release = res;
  });
  (server.api as { syncKeyPut: typeof orig }).syncKeyPut = async (t, b) => {
    await gate;
    return orig(t, b);
  };
  const p = x.engine.enable();
  await new Promise((r) => setTimeout(r, 20));
  x.engine.onAccountEnd('logout');
  release();
  await p;
  assert.equal(x.engine.isOn(), false, '로그아웃했는데 동기화가 켜진 채다');
  assert.equal(x.secret(), undefined, '로그아웃했는데 열쇠가 저장돼 있다');
});

test('K6 덩어리가 너무 커서 생긴 big 보류가 줄여도 안 풀려 보류 수가 영원히 남는다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  const huge = randomBytes(400_000).toString('base64'); // 압축 안 되는 큰 글
  const n = a.notes.add({ title: '큰 메모', body: 'x' }, Date.now());
  a.db.prepare('update note set body = ? where id = ?').run(huge, n.id);
  await a.engine.run(true);
  assert.equal(a.engine.view().held, 1, '큰 항목은 보류');
  a.db.prepare('update note set body = ? where id = ?').run('작아졌다', n.id);
  await a.engine.run(true);
  assert.equal(a.engine.view().pending, 0);
  assert.equal(a.engine.view().held, 0, '작아져서 올라갔는데 보류 수가 남는다');
});

test('K8 받은 영구 삭제 표식 적용이 실패하면 영영 다시 시도하지 않는다 (tomb 보류는 retryHolds 대상 아님)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: 't', body: 'b' }, Date.now());
  await settle([a, b]);
  a.notes.remove(n.id, Date.now());
  a.notes.purge(n.id);
  // B 가 표식을 적용하다 실패하게 만든다: purge 가 쓰는 표에 막는 트리거
  b.db.exec(`create trigger boom before delete on note begin select raise(abort, 'boom'); end;`);
  await a.engine.run(true);
  await b.engine.run(true);
  assert.equal(
    b.engine.holds().some((h) => h.reason === 'tomb'),
    true,
    '표식 보류가 생겼다',
  );
  assert.equal(b.engine.holds().find((h) => h.reason === 'tomb')?.kind, 'note', '표식 보류에 종류를 남긴다');
  const logs = b.engine.holds().length;
  await b.engine.run(true);
  assert.equal(b.engine.holds().length, logs);
  b.db.exec('drop trigger boom');
  b.clock.now += 2 * 60_000; // 다시 하기 간격(1분)이 지난 뒤
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from note'), 0, '막힘이 풀렸는데도 삭제가 영영 안 된다');
});

test('K10 시작할 때 운영체제 열쇠를 잠깐 못 읽으면 열쇠 없음이 굳어 앱을 다시 켜기 전에는 맞추지 않는다', async () => {
  const server = new FakeSyncServer();
  const x = flakyDevice(server);
  assert.ok((await x.engine.enable()).ok);
  const e2 = x.make(); // 앱 다시 시작: 같은 상태 파일, 같은 열쇠 보관
  x.f.failGet = true;
  assert.equal(e2.view().phase, 'needCode'); // 처음 읽을 때 못 읽음
  x.f.failGet = false; // 곧 읽을 수 있게 됨
  x.notes.add({ title: '시작 뒤 메모', body: 'b' }, Date.now());
  await e2.run(true);
  assert.equal(e2.view().phase, 'on', '열쇠를 다시 읽을 수 있는데도 계속 복구 코드 넣기 상태다');
});

test('K9 부모가 10분 넘게 안 와서 끊은 반복 연결은 부모가 뒤늦게 와도 이어지지 않아 기기끼리 달라진다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t1 = a.todos.add({ title: '반복', repeat: 'daily', due: '2026-11-03' }, Date.now());
  a.todos.complete(t1.id, Date.now());
  const uids = a.db.prepare('select id, uid, repeat_of from todo order by id').all() as {
    id: number;
    uid: string;
    repeat_of: number | null;
  }[];
  const parent = uids[0] as { uid: string };
  const child = uids[1] as { uid: string };
  // 부모를 잠깐 보류해 자식이 먼저 올라가게 한다
  a.db.prepare('delete from sync_outbox where uid = ?').run(parent.uid);
  await a.engine.run(true);
  await b.engine.run(true);
  assert.equal(
    b.engine.holds().some((h) => h.reason === 'parent'),
    true,
  );
  b.clock.now += 11 * 60_000; // 10분 넘게 지남
  await b.engine.run(true);
  // 이제 부모가 온다
  a.db.prepare("insert or ignore into sync_outbox (kind, uid) values ('todo', ?)").run(parent.uid);
  await settle([a, b]);
  const link = (d: typeof a) =>
    (
      d.db
        .prepare('select p.uid as u from todo c left join todo p on p.id = c.repeat_of where c.uid = ?')
        .get(child.uid) as { u: string | null }
    ).u;
  assert.equal(link(b), link(a), '부모가 온 뒤에도 B 의 반복 연결이 끊긴 채다');
});

test('K11 백업을 되살리면 그 뒤 다른 기기가 영구 삭제한 메모가 되살아나지 않는다', async () => {
  const server = new FakeSyncServer();
  const a = flakyDevice(server);
  const e = await a.engine.enable();
  assert.ok(e.ok && e.kind === 'created');
  const b = flakyDevice(server);
  await b.engine.enable();
  assert.ok((await b.engine.enterCode(e.kind === 'created' ? e.code : '')).ok);
  const n = a.notes.add({ title: '지울 메모', body: '비밀' }, Date.now());
  for (const d of [a, b, a]) await d.engine.run(true);
  const path = `${process.env.TMPDIR ?? '/tmp'}/hunt-295-backup-${process.pid}.db`;
  a.db.exec(`vacuum into '${path}'`);
  try {
    const bid = (b.db.prepare('select id from note').get() as { id: number }).id;
    await new Promise((r) => setTimeout(r, 5));
    b.notes.remove(bid, Date.now());
    b.notes.purge(bid);
    for (const d of [b, a]) await d.engine.run(true);
    assert.equal(num(a.db, 'select count(*) as n from note'), 0);
    // A 가 옛 백업을 되살린다 (앱을 다시 켠 것처럼 같은 상태 파일, 새 엔진)
    const restored = new DatabaseSync(path) as unknown as Db;
    const a2 = flakyDevice(server, () => ACCOUNT, { db: restored, stored: a.stored(), secret: a.secret() });
    a2.engine.afterRestore();
    for (const d of [a2, b, a2]) await d.engine.run(true);
    assert.equal(num(a2.db, 'select count(*) as n from note'), 0, '되살린 A 에 지운 메모가 남았다');
    assert.equal(num(b.db, 'select count(*) as n from note'), 0, 'B 에 지운 메모가 되살아났다');
    void n;
  } finally {
    (await import('node:fs')).rmSync(path, { force: true });
  }
});

test('K12 코인: 두 기기를 번갈아 끝내기와 되돌리기를 해도 한 할 일의 순 지급이 한 번을 넘지 않는다 (맞춘 사이)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '코인', due: '2099-01-01' }, Date.now());
  const uid = (a.db.prepare('select uid from todo where id = ?').get(t.id) as { uid: string }).uid;
  await settle([a, b]);
  const idOn = (d: typeof a) =>
    (d.db.prepare('select id from todo where uid = ?').get(uid) as { id: number }).id;
  const net = (d: typeof a) =>
    num(
      d.db,
      "select coalesce(sum(amount), 0) as n from coin_log where ref_id = ? and reason in ('todo','early','undo')",
      idOn(d),
    );
  const seq = [a, b, b, a, a, b, a, b, b, a, a, b];
  let i = 0;
  for (const d of seq) {
    const row = d.db.prepare('select done_at from todo where uid = ?').get(uid) as { done_at: number | null };
    if (row.done_at === null) d.todos.complete(idOn(d), Date.now() + i);
    else d.todos.undo(idOn(d), Date.now() + i);
    i += 1;
    await new Promise((r) => setTimeout(r, 3));
    await settle([a, b], 3);
    const total = net(a) + net(b);
    assert.ok(total >= 0 && total <= 20, `${i}번째 뒤 순 지급 ${total}`);
  }
  assert.ok(a.todos.balance() >= 0 && b.todos.balance() >= 0);
});

test('K13 기능 키가 꺼져 403 이 오면 늦추지 않아 글을 쓸 때마다(3초 모음) 서버를 다시 부른다', async () => {
  const server = new FakeSyncServer();
  const { a } = await pair(server);
  server.featureOn = false;
  server.calls.length = 0;
  await a.engine.run(); // 첫 실패
  await a.engine.run(); // 바로 이어서 (글을 또 쓴 뒤 3초)
  await a.engine.run();
  assert.equal(server.calls.length, 1, `403 뒤에도 ${server.calls.length}번 불렀다 (backoff 없음)`);
});

test('K14 다른 기기가 열쇠를 바꾸면 낡은 기기는 멈추고 낡은 열쇠로 아무것도 올리지 않으며 데이터는 남는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '내 메모', body: 'b' }, Date.now());
  await settle([a, b]);
  const r = await b.engine.rotateKey();
  assert.ok(r.ok);
  await settle([b]);
  a.notes.add({ title: '낡은 열쇠로 쓴 메모', body: 'c' }, Date.now());
  const before = server.head;
  await a.engine.run(true);
  assert.equal(server.head, before, '낡은 기기가 올렸다');
  assert.equal(a.engine.view().problem, 'epoch');
  assert.equal(num(a.db, 'select count(*) as n from note'), 2, '데이터 유지');
  const c = await a.engine.enterCode(r.ok ? r.code : '');
  assert.ok(c.ok);
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from note'), 2, 'B 가 A 의 메모를 받았다');
});
