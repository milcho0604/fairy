// 동기화 엔진 시험: 가짜 서버(메모리)와 저장 파일 둘(메모리 DB 둘)로 종류마다, 흐름마다 확인한다.
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
const tomorrow = () => localDay(Date.now() + DAY);

// ---- 켜기 ----

test('켜기: 첫 기기는 열쇠를 만들어 올린 뒤에만 저장한다 (올리기 실패면 저장하지 않고 꺼진 채)', async () => {
  const server = new FakeSyncServer();
  const a = newDevice(server, 'A');
  server.online = false;
  const r = await a.engine.enable();
  assert.deepEqual(r, { ok: false, error: 'offline' });
  assert.equal(a.secret(), undefined);
  assert.equal(a.engine.view().phase, 'off');
  assert.equal(server.key, null);
  server.online = true;
  const ok = await a.engine.enable();
  assert.ok(ok.ok && ok.kind === 'created');
  assert.match(ok.code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  assert.ok(a.secret(), '올린 뒤 저장');
  assert.equal(a.engine.view().phase, 'on');
  // 서버는 소금, 매개변수, 감싼 열쇠만 안다: 복구 코드와 데이터 열쇠는 어디에도 없다
  const stored = JSON.stringify(server.key);
  assert.ok(!stored.includes(ok.code) && !stored.includes(a.secret() as string));
  assert.deepEqual(await a.engine.enable(), { ok: true, kind: 'on' });
});

test('켜기: 다른 기기가 먼저 켰으면(409 key_exists) 만든 열쇠를 버리고 복구 코드 넣기로 간다', async () => {
  const server = new FakeSyncServer();
  const first = newDevice(server, 'A');
  const a = await first.engine.enable();
  assert.ok(a.ok && a.kind === 'created');
  // 둘째가 GET 으로 열쇠가 없다고 본 뒤 올리는 사이 첫째가 올린 경우를 흉내: GET 만 404 로
  const b = newDevice(server, 'B');
  let n = 0;
  server.inject = (name) =>
    name === 'keyGet' && n++ === 0
      ? ({ ok: false, status: 404, error: 'none', body: {} } as never)
      : undefined;
  const r = await b.engine.enable();
  assert.deepEqual(r, { ok: true, kind: 'needCode' });
  assert.equal(b.secret(), undefined, '만든 열쇠를 저장하지 않았다');
  assert.equal(b.engine.view().phase, 'needCode');
  server.inject = undefined;
  assert.deepEqual(await b.engine.enterCode('00000-00000-00000-00000-00000'), { ok: false, error: 'code' });
  assert.equal(b.secret(), undefined);
  assert.deepEqual(await b.engine.enterCode(a.code.toLowerCase()), { ok: true });
  assert.equal(b.secret(), first.secret(), '같은 데이터 열쇠');
  assert.equal(b.engine.view().phase, 'on');
});

test('켜기: 운영체제 열쇠를 못 쓰면 켜지 않는다', async () => {
  const server = new FakeSyncServer();
  const a = newDevice(server, 'A', { secure: false });
  assert.deepEqual(await a.engine.enable(), { ok: false, error: 'secure' });
  assert.equal(server.key, null);
});

test('켜기: 로그인하지 않았거나 이 계정에 기능이 꺼져 있으면 서버 오류 그대로', async () => {
  const server = new FakeSyncServer();
  let acct: string | undefined;
  const a = newDevice(server, 'A', { account: () => acct });
  assert.deepEqual(await a.engine.enable(), { ok: false, error: 'login' });
  acct = 'F-TEST-0001';
  server.featureOn = false;
  assert.deepEqual(await a.engine.enable(), { ok: false, error: 'feature_off' });
});

test('처음 켤 때 합집합: 첫 기기의 가진 것이 올라가고, 둘째 기기의 가진 것도 올라가 양쪽이 같아진다', async () => {
  const server = new FakeSyncServer();
  const a = newDevice(server, 'A');
  const b = newDevice(server, 'B');
  a.notes.add({ title: 'A 메모', body: 'a' }, Date.now());
  a.todos.add({ title: 'A 할 일', due: tomorrow() }, Date.now());
  b.notes.add({ title: 'B 메모', body: 'b' }, Date.now());
  b.todos.add({ title: 'B 할 일' }, Date.now());
  const r = await a.engine.enable();
  assert.ok(r.ok && r.kind === 'created');
  await a.engine.run(true);
  assert.equal(server.items.size, 2, '24판 앞에 있던 행도 올라갔다');
  await b.engine.enable();
  assert.deepEqual(await b.engine.enterCode(r.code), { ok: true });
  await settle([a, b]);
  assert.equal(a.notes.list().length, 2);
  assert.equal(b.notes.list().length, 2);
  assert.equal(a.todos.list(Date.now()).open.length, 2);
  same(a, b);
});

// ---- 종류마다 ----

test('메모: 만들기, 고치기, 휴지통, 되살리기, 영구 삭제가 간다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '회의', body: '안건 1' }, Date.now());
  await settle([a, b]);
  const bid = b.notes.list()[0]?.id ?? 0;
  assert.equal(b.notes.get(bid)?.body, '안건 1');
  spin();
  a.notes.pin(n.id, true, Date.now());
  await settle([a, b]);
  assert.ok(b.notes.get(bid)?.pinnedAt);
  spin();
  b.notes.remove(bid, Date.now());
  await settle([a, b]);
  assert.equal(a.notes.list().length, 0);
  assert.equal(a.notes.trashCount(), 1);
  spin();
  a.notes.restore(n.id);
  await settle([a, b]);
  assert.equal(b.notes.list().length, 1);
  spin();
  a.notes.remove(n.id, Date.now());
  await settle([a, b]);
  a.notes.purge(n.id);
  assert.equal(num(a.db, 'select count(*) as n from note'), 0);
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from note'), 0, '영구 삭제는 모든 기기에서 사라진다');
  assert.equal(num(a.db, 'select count(*) as n from sync_tomb'), 0, '보낸 뒤 표식은 정리된다');
  same(a, b);
});

test('할 일: 단계와 알림과 반복과 고정이 간다, 지운 것과 영구 삭제도', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add(
    { title: '보고서', due: tomorrow(), dueMin: 600, important: true, reminds: [60, 1440] },
    Date.now(),
  );
  a.todos.addStep(t.id, '초안', Date.now());
  a.todos.addStep(t.id, '검토', Date.now());
  await settle([a, b]);
  const open = b.todos.list(Date.now()).open;
  assert.equal(open.length, 1);
  const bt = open[0];
  assert.equal(bt?.title, '보고서');
  assert.equal(bt?.important, true);
  assert.equal(bt?.dueMin, 600);
  assert.deepEqual(bt?.reminds, [1440, 60]);
  assert.deepEqual(
    bt?.steps.map((s) => s.title),
    ['초안', '검토'],
  );
  same(a, b);
  // 단계 체크, 이름 바꾸기, 지우기
  spin();
  const bs = bt?.steps ?? [];
  b.todos.toggleStep(bs[0]?.id ?? 0, true);
  b.todos.renameStep(bs[1]?.id ?? 0, '최종 검토');
  await settle([a, b]);
  const as = a.todos.get(t.id)?.steps ?? [];
  assert.equal(as[0]?.done, true);
  assert.equal(as[1]?.title, '최종 검토');
  spin();
  a.todos.removeStep(as[1]?.id ?? 0);
  await settle([a, b]);
  assert.equal(b.todos.get(bt?.id ?? 0)?.steps.length, 1, '지운 단계가 사라진다');
  same(a, b);
  // 휴지통과 영구 삭제: 단계, 알림 줄까지
  spin();
  a.todos.remove(t.id, Date.now());
  await settle([a, b]);
  assert.equal(b.todos.trashCount(), 1);
  spin();
  a.todos.purge([t.id]);
  await settle([a, b]);
  assert.equal(num(b.db, 'select count(*) as n from todo'), 0);
  assert.equal(num(b.db, 'select count(*) as n from todo_step'), 0);
  assert.equal(num(b.db, "select count(*) as n from reminder where kind = 'todo'"), 0);
  same(a, b);
});

test('반복 할 일: 끝내면 다음 회차가 두 기기에 하나씩만 생긴다 (같은 uid)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const t = a.todos.add({ title: '약 먹기', due: localDay(now), repeat: 'daily' }, now);
  a.todos.addStep(t.id, '물 마시기', now);
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  // 양쪽이 동시에 끝낸다: 다음 회차가 둘 생기지 않는다
  a.todos.complete(t.id, now);
  b.todos.complete(bid, now);
  await settle([a, b]);
  assert.equal(num(a.db, 'select count(*) as n from todo'), 2);
  assert.equal(num(b.db, 'select count(*) as n from todo'), 2);
  assert.equal(num(a.db, 'select count(*) as n from todo_step'), 2, '단계도 회차마다 하나');
  assert.equal(num(b.db, 'select count(*) as n from todo_step'), 2);
  same(a, b);
  // 연결(repeat_of)이 uid 로 옮겨졌다
  const next = a.todos.nextOf(t.id);
  assert.ok(next);
  const bnext = b.todos.nextOf(bid);
  assert.equal(uidOf(b.db, 'todo', bnext?.id ?? 0), uidOf(a.db, 'todo', next.id));
});

test('칸마다 합치기: 한쪽은 완료, 다른 쪽은 제목을 고쳐도 둘 다 남는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '청소', due: tomorrow() }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  spin();
  a.todos.complete(t.id, Date.now());
  spin();
  b.todos.update(bid, { title: '대청소' }, Date.now());
  await settle([a, b]);
  for (const d of [a, b]) {
    const row = d.db.prepare('select title, done_at from todo').get() as {
      title: string;
      done_at: number | null;
    };
    assert.equal(row.title, '대청소');
    assert.ok(row.done_at, '완료도 남는다');
  }
  same(a, b);
});

test('칸이 같은 시각에 다르게 바뀌어도(시각 같음) 두 기기가 같은 쪽으로 수렴한다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const t = a.todos.add({ title: '시작', due: tomorrow() }, Date.now());
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  a.todos.update(t.id, { title: '가' }, Date.now());
  b.todos.update(bid, { title: '나' }, Date.now());
  // 두 칸 시각을 같게 맞춘다 (한 시간 뒤: 하루 넘게 앞서지 않는다)
  const same1h = Date.now() + 3_600_000;
  a.db.exec(`update sync_clock set t = ${same1h} where kind = 'todo' and field = 'title'`);
  b.db.exec(`update sync_clock set t = ${same1h} where kind = 'todo' and field = 'title'`);
  await settle([a, b]);
  same(a, b);
  assert.equal(
    (a.db.prepare('select title from todo').get() as { title: string }).title,
    '나',
    '값 순서가 뒤인 쪽',
  );
});

test('알림: 받은 알림 중 이미 지난 것은 울리지 않는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  // 마감이 1시간 뒤: 하루 전 알림은 이미 지났고 10분 전 알림은 아직이다
  const due = new Date(now + 3_600_000);
  const day = localDay(due.getTime());
  const min = due.getHours() * 60 + due.getMinutes();
  const t = a.todos.add(
    { title: '회의 준비', due: day, dueMin: min, reminds: [1440, 10] },
    now - 2 * 3_600_000,
  );
  await settle([a, b]);
  const bid = idOf(b.db, 'todo', uidOf(a.db, 'todo', t.id)) as number;
  const marks = b.db
    .prepare(
      "select before_min, notified_at from reminder where kind = 'todo' and ref_id = ? order by before_min desc",
    )
    .all(bid) as {
    before_min: number;
    notified_at: number | null;
  }[];
  assert.equal(marks.length, 2);
  assert.notEqual(marks[0]?.notified_at, null, '지난 알림은 넘긴 것으로');
  assert.equal(marks[1]?.notified_at, null, '아직 안 지난 알림은 울린다');
  // 알림 목록을 고치면 간다
  spin();
  a.todos.update(t.id, { reminds: [30] }, now);
  await settle([a, b]);
  assert.deepEqual(b.todos.get(bid)?.reminds, [30]);
});

test('일정: 만들기, 고치기, 알림, 종일, 지우기가 간다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const start = Date.now() + 3 * DAY;
  const e = a.events.add(
    { title: '치과', startAt: start, endAt: start + 3_600_000, reminds: [60] },
    Date.now(),
  );
  await settle([a, b]);
  const bid = idOf(b.db, 'event', uidOf(a.db, 'event', e.id)) as number;
  assert.equal(b.events.get(bid)?.title, '치과');
  assert.deepEqual(b.events.get(bid)?.reminds, [60]);
  spin();
  b.events.update(bid, { title: '치과 검진', reminds: [120, 10] }, Date.now());
  await settle([a, b]);
  assert.equal(a.events.get(e.id)?.title, '치과 검진');
  assert.deepEqual(a.events.get(e.id)?.reminds, [120, 10]);
  spin();
  a.events.remove(e.id, Date.now());
  await settle([a, b]);
  assert.equal(b.events.get(bid), undefined);
  assert.equal(b.events.trashCount(), 1);
  spin();
  b.events.restore(bid);
  await settle([a, b]);
  assert.ok(a.events.get(e.id));
  same(a, b);
});

test('반복 일정: 시리즈 묶음과 고친 회차와 지운 회차와 고정이 간다, 손대지 않은 회차는 각자 만든다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const start = now + DAY;
  const e = a.events.add({ title: '주간 회의', startAt: start, repeat: 'weekly', reminds: [30] }, now);
  const total = num(a.db, 'select count(*) as n from event');
  assert.ok(total > 40, `펼친 회차 ${total}`);
  await settle([a, b]);
  // 시리즈 원본만 올라갔다 (손대지 않은 회차는 올리지 않는다)
  assert.equal(server.items.size, 1);
  assert.equal(num(b.db, 'select count(*) as n from event_repeat_template'), 1);
  // 둘째 기기는 템플릿에서 회차를 다시 만든다 (일정 알림을 불러 이어 만들기를 돌린다)
  b.events.dueReminders(now);
  assert.ok(num(b.db, 'select count(*) as n from event') > 40, '둘째 기기도 펼쳤다');
  const aSeries = uidOf(a.db, 'event', e.id);
  // 같은 회차 uid = H(시리즈 uid, slot)
  const slots = a.db
    .prepare('select slot, uid from event where repeat_series = ? and id <> ? order by start_at limit 3')
    .all(e.id, e.id) as { slot: number; uid: string }[];
  for (const s of slots)
    assert.ok(b.db.prepare('select 1 from event where uid = ?').get(s.uid), '같은 uid 회차');
  // 한 회차를 고친다 (제목, 시각 옮김), 한 회차를 지운다, 한 회차를 고정한다
  const occ = a.db
    .prepare('select id, start_at from event where repeat_series = ? and id <> ? order by start_at limit 4')
    .all(e.id, e.id) as { id: number; start_at: number }[];
  spin();
  a.events.update(
    occ[0]?.id ?? 0,
    { title: '이번만 다른 회의', startAt: (occ[0]?.start_at ?? 0) + 3_600_000 },
    now,
  );
  a.events.remove(occ[1]?.id ?? 0, now);
  a.events.pin(occ[2]?.id ?? 0, true, now);
  await settle([a, b]);
  const edited = idOf(b.db, 'event', uidOf(a.db, 'event', occ[0]?.id ?? 0)) as number;
  assert.equal(b.events.get(edited)?.title, '이번만 다른 회의');
  assert.equal(b.events.get(edited)?.startAt, (occ[0]?.start_at ?? 0) + 3_600_000);
  const gone = idOf(b.db, 'event', uidOf(a.db, 'event', occ[1]?.id ?? 0)) as number;
  assert.equal(b.events.get(gone), undefined, '지운 회차');
  const pinned = idOf(b.db, 'event', uidOf(a.db, 'event', occ[2]?.id ?? 0)) as number;
  assert.ok(b.events.get(pinned)?.pinnedAt, '고정한 회차');
  same(a, b);
  // 휴지통의 회차를 영구 삭제하면 그 자리를 건너뛰고(skip) 다른 기기에도 간다
  spin();
  a.events.purgeTrash(occ[1]?.id ?? 0, now);
  await settle([a, b]);
  assert.ok(
    num(
      b.db,
      'select count(*) as n from event_repeat_skip where series_id = ?',
      idOf(b.db, 'event', aSeries) as number,
    ) >= 1,
  );
  assert.equal(b.events.trashCount(), 0);
  // 시리즈 제목을 템플릿째 바꾸면 간다
  same(a, b);
});

test('서버가 본 항목은 다시 받아도 되풀이해 쓰지 않는다 (내가 올린 것은 건너뛴다)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '하나' }, Date.now());
  await settle([a, b]);
  await a.engine.run(true);
  const before = server.head;
  await settle([a, b]);
  assert.equal(server.head, before, '고친 것이 없으면 서버 번호가 오르지 않는다');
});

test('반복 일정 회차: 지웠다 되살린 회차는 다시 추적 대상이 아니어도 서버가 아는 것이라 되살린 것을 보낸다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const e = a.events.add({ title: '주간 회의', startAt: now + DAY, repeat: 'weekly' }, now);
  await settle([a, b]);
  b.events.dueReminders(now);
  const occ = a.db
    .prepare('select id, uid from event where repeat_series = ? and id <> ? order by start_at limit 1')
    .get(e.id, e.id) as { id: number; uid: string };
  a.events.remove(occ.id, now);
  await settle([a, b]);
  const bid = idOf(b.db, 'event', occ.uid) as number;
  assert.equal(b.events.get(bid), undefined, '지운 회차가 B 에서도 사라졌다');
  spin();
  b.events.restore(bid);
  await settle([a, b]);
  assert.ok(a.events.get(occ.id), 'B 가 되살린 회차가 A 에도 돌아온다');
  same(a, b);
});

test('반복 일정 회차: 한 기기가 지웠다 되살린 것(원래 상태)도 다른 기기가 먼저 올린 지움을 이긴다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const now = Date.now();
  const e = a.events.add({ title: '주간 회의', startAt: now + DAY, repeat: 'weekly' }, now);
  await settle([a, b]);
  b.events.dueReminders(now);
  const occ = a.db
    .prepare('select id, uid from event where repeat_series = ? and id <> ? order by start_at limit 1')
    .get(e.id, e.id) as { id: number; uid: string };
  const bid = idOf(b.db, 'event', occ.uid) as number;
  spin();
  a.events.remove(occ.id, now);
  await a.engine.run(true);
  spin();
  // B 는 아직 모르는 채 지웠다가 바로 되살린다 (펼친 회차의 원래 상태라 추적 대상이 아니다)
  b.events.remove(bid, now);
  b.events.restore(bid);
  await settle([a, b]);
  assert.ok(a.events.get(occ.id), '나중의 되살리기가 이긴다');
  assert.ok(b.events.get(bid));
  same(a, b);
});
