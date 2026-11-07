import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { GCAL_ID_PREFIX, GCAL_TODO_ID_PREFIX, GcalBackoff } from '../shared/gcal.ts';
import { isFromFairy } from '../shared/gcal-pull.ts';
import { GcalStore } from '../shared/gcal-store.ts';
import { GcalTodoStore } from '../shared/gcal-todo-store.ts';
import { googleIdFromUid } from '../shared/sync-item.ts';
import { TodoStore } from '../shared/todo-store.ts';
import { type ApiResult, classifyApi } from './gcal-auth.ts';
import { pullPass } from './gcal-pull.ts';
import { type GcalApi, syncPass } from './gcal-sync.ts';
import { ensureTables, purgeRow } from './sync/rows.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;
// 서울 2026-10-10 09:00. 시간대는 늘 'Asia/Seoul' 로 넘겨 이 컴퓨터 시간대에 기대지 않는다
const NOW = Date.UTC(2026, 9, 10, 0);
const TZ = 'Asia/Seoul';
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 구글 캘린더 흉내 (gcal-sync.test.ts 와 같은 방식 + 목록 읽기) */
function fakeGoogle() {
  const cals = new Map<string, Map<string, Record<string, unknown>>>([['primary', new Map()]]);
  const calls: string[] = [];
  const forced: (ApiResult | Error)[] = [];
  const res = (status: number, json?: unknown): ApiResult => ({
    kind: classifyApi(status, json),
    status,
    json,
  });
  const api: GcalApi = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    const f = forced.shift();
    if (f instanceof Error) throw f;
    if (f) return f;
    const mv = /^\/calendars\/([^/]+)\/events\/([^/]+)\/move\?destination=(.+)$/.exec(path);
    if (mv) {
      const from = cals.get(decodeURIComponent(mv[1] ?? ''));
      const to = cals.get(decodeURIComponent(mv[3] ?? ''));
      const id = decodeURIComponent(mv[2] ?? '');
      const ev = from?.get(id);
      if (!from || !to || !ev) return res(404, {});
      from.delete(id);
      to.set(id, ev);
      return res(200, ev);
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    const cal = m && cals.get(decodeURIComponent(m[1] ?? ''));
    if (!m || !cal) return res(404, { error: { code: 404 } });
    const id = m[2] && decodeURIComponent(m[2]);
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const nid = String(b.id);
      if (cal.has(nid)) return res(409, { error: { code: 409 } });
      const ev = { ...b, iCalUID: `${nid}@google.com` };
      cal.set(nid, ev);
      return res(200, ev);
    }
    const ev = id ? cal.get(id) : undefined;
    if (!ev || !id) return res(404, {});
    if (method === 'PATCH') {
      const next: Record<string, unknown> = { ...ev };
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        const was = next[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const merged: Record<string, unknown> =
            was && typeof was === 'object' ? { ...(was as Record<string, unknown>) } : {};
          for (const [k2, v2] of Object.entries(v)) {
            if (v2 === null) delete merged[k2];
            else merged[k2] = v2;
          }
          next[k] = merged;
        } else if (v === null) delete next[k];
        else next[k] = v;
      }
      cal.set(id, next);
      return res(200, next);
    }
    if (ev.status === 'cancelled') return res(410, {});
    cal.set(id, { ...ev, status: 'cancelled' });
    return res(204);
  };
  /** 가져오기가 읽는 목록: 취소된 일정은 빠진다 */
  const listApi = async (method: 'GET', path: string): Promise<ApiResult> => {
    calls.push(`${method} ${path}`);
    const m = /^\/calendars\/([^/]+)\/events\?/.exec(path);
    const cal = m && cals.get(decodeURIComponent(m[1] ?? ''));
    if (!cal) return res(404, {});
    return res(200, { items: [...cal.values()].filter((e) => e.status !== 'cancelled') });
  };
  return { cals, calls, forced, api, listApi, res };
}

function setup() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  ensureTables(db);
  const todos = new TodoStore(db, utcDay);
  const events = new EventStore(db);
  const evStore = new GcalStore(db, events);
  const store = new GcalTodoStore(db);
  const g = fakeGoogle();
  const backoff = new GcalBackoff(() => 0);
  let n = 0;
  let now = NOW;
  const pass = (calendarId = 'primary') =>
    syncPass({
      store,
      backoff,
      api: g.api,
      newId: () => `${GCAL_TODO_ID_PREFIX}${String(++n).padStart(5, '0')}`,
      now: () => now,
      calendarId,
      tz: TZ,
    });
  const evPass = () =>
    syncPass({
      store: evStore,
      backoff: new GcalBackoff(() => 0),
      api: g.api,
      newId: () => `${GCAL_ID_PREFIX}${String(++n).padStart(5, '0')}`,
      now: () => now,
      calendarId: 'primary',
      tz: TZ,
    });
  const idOf = (todoId: number) =>
    googleIdFromUid(
      (db.prepare('select uid from todo where id = ?').get(todoId) as { uid: string }).uid,
      GCAL_TODO_ID_PREFIX,
    );
  return {
    db,
    todos,
    events,
    evStore,
    store,
    g,
    backoff,
    pass,
    evPass,
    idOf,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const count = (db: Db, sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);

const sent = (g: ReturnType<typeof fakeGoogle>, id: string, cal = 'primary') => g.cals.get(cal)?.get(id);

test('날짜 있는 할 일이 jjt 머리 id 로 올라가고, 표식과 알림 없음이 붙는다. 안 바뀌면 다시 안 부른다', async () => {
  const { todos, g, pass, idOf, store, db } = setup();
  const t = todos.add({ title: '보고서', due: '2026-10-12', dueMin: 14 * 60 + 30 }, NOW);
  const r = await pass();
  assert.deepEqual([r.sent, r.stop, r.pending], [1, null, 0]);
  const id = idOf(t.id);
  assert.match(id, /^jjt[0-9a-v]{26}$/);
  const ev = sent(g, id);
  assert.equal(ev?.summary, '보고서');
  assert.deepEqual(ev?.start, { dateTime: '2026-10-12T14:30:00', timeZone: TZ });
  assert.deepEqual(ev?.end, { dateTime: '2026-10-12T15:00:00', timeZone: TZ });
  assert.deepEqual(ev?.reminders, { useDefault: false, overrides: [] });
  assert.deepEqual(ev?.extendedProperties, { private: { jjakkung: '1', fairyKind: 'todo' } });
  assert.equal(store.sentCount(), 1);
  assert.equal(
    (db.prepare('select google_cal from todo where id = ?').get(t.id) as { google_cal: string }).google_cal,
    'primary',
  );
  g.calls.length = 0;
  assert.equal((await pass()).sent, 0);
  assert.deepEqual(g.calls, []);
});

test('날짜만 있으면 종일 일정 (끝은 다음 날), 고치면 고치기', async () => {
  const { todos, g, pass, idOf } = setup();
  const t = todos.add({ title: '청소', due: '2026-10-31' }, NOW);
  await pass();
  const id = idOf(t.id);
  assert.deepEqual([sent(g, id)?.start, sent(g, id)?.end], [{ date: '2026-10-31' }, { date: '2026-11-01' }]);
  todos.update(t.id, { title: '대청소' }, NOW);
  g.calls.length = 0;
  await pass();
  assert.deepEqual(g.calls, [`PATCH /calendars/primary/events/${id}`]);
  assert.equal(sent(g, id)?.summary, '대청소');
});

test('밀린 열린 할 일은 오늘 종일 일정으로 옮겨지고, 날이 바뀌면 하루에 한 번 따라 옮긴다', async () => {
  const { todos, g, pass, idOf, tick } = setup();
  const t = todos.add({ title: '밀림', due: '2026-10-08', dueMin: 600 }, NOW);
  await pass();
  const id = idOf(t.id);
  assert.deepEqual([sent(g, id)?.start, sent(g, id)?.end], [{ date: '2026-10-10' }, { date: '2026-10-11' }]);
  // 같은 날에는 다시 안 부른다
  g.calls.length = 0;
  tick(2 * HOUR);
  await pass();
  assert.deepEqual(g.calls, []);
  // 다음 날 (서울 10-11)
  tick(DAY);
  await pass();
  assert.deepEqual(g.calls, [`PATCH /calendars/primary/events/${id}`]);
  assert.deepEqual([sent(g, id)?.start, sent(g, id)?.end], [{ date: '2026-10-11' }, { date: '2026-10-12' }]);
});

test('끝내면 구글에서 지우고, 되돌리면 PATCH 로 status confirmed 를 실어 되살린다 (넣기부터 하지 않는다)', async () => {
  const { todos, g, pass, idOf, db } = setup();
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const id = idOf(t.id);
  todos.complete(t.id, NOW);
  await pass();
  assert.equal(sent(g, id)?.status, 'cancelled');
  assert.deepEqual(
    { ...(db.prepare('select google_id, google_hash from todo where id = ?').get(t.id) as object) },
    { google_id: id, google_hash: 'deleted' },
  );
  g.calls.length = 0;
  await pass();
  assert.deepEqual(g.calls, []);
  // 되돌리기
  todos.undo(t.id, NOW);
  g.calls.length = 0;
  await pass();
  assert.deepEqual(g.calls, [`PATCH /calendars/primary/events/${id}`]);
  assert.equal(sent(g, id)?.status, 'confirmed');
  assert.equal(g.cals.get('primary')?.size, 1);
});

test('되돌릴 때 구글이 404 를 주면 무작위 새 id 로 새로 넣는다', async () => {
  const { todos, g, pass, idOf } = setup();
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const id = idOf(t.id);
  todos.complete(t.id, NOW);
  await pass();
  g.cals.get('primary')?.delete(id);
  todos.undo(t.id, NOW);
  assert.equal((await pass()).again, true);
  await pass();
  assert.equal(g.cals.get('primary')?.size, 1);
  assert.ok(sent(g, 'jjt00001'));
});

test('지우면 구글에서 지우고, 날짜를 빼도 지운다. 날짜를 다시 주면 되살린다', async () => {
  const { todos, g, pass, idOf } = setup();
  const a = todos.add({ title: '가', due: '2026-10-12' }, NOW);
  const b = todos.add({ title: '나', due: '2026-10-13' }, NOW);
  await pass();
  todos.remove(a.id, NOW);
  todos.update(b.id, { due: null }, NOW);
  await pass();
  assert.equal(sent(g, idOf(a.id))?.status, 'cancelled');
  assert.equal(sent(g, idOf(b.id))?.status, 'cancelled');
  todos.update(b.id, { due: '2026-10-14' }, NOW);
  await pass();
  assert.equal(sent(g, idOf(b.id))?.status, 'confirmed');
  assert.deepEqual(sent(g, idOf(b.id))?.start, { date: '2026-10-14' });
});

test('올리는 범위: 처음 켤 때 30일 넘게 밀린 것은 안 올라가고, 한 번 올린 것은 30일이 지나도 남는다', async () => {
  const { todos, g, pass, idOf, tick } = setup();
  todos.add({ title: '아주 옛날', due: '2026-08-01' }, NOW);
  const recent = todos.add({ title: '지난주', due: '2026-10-03' }, NOW);
  const r = await pass();
  assert.equal(r.sent, 1);
  assert.equal(g.cals.get('primary')?.size, 1);
  assert.ok(sent(g, idOf(recent.id)));
  // 40일 뒤에도 구글에서 빼지 않는다 (오늘 종일 일정으로 옮겨질 뿐)
  tick(40 * DAY);
  await pass();
  assert.equal(sent(g, idOf(recent.id))?.status, 'confirmed');
  assert.deepEqual(sent(g, idOf(recent.id))?.start, { date: '2026-11-19' });
});

test('반복 할 일은 열린 회차 하나만: 끝내면 그 회차가 빠지고 새 회차가 올라간다', async () => {
  const { todos, g, pass, idOf, db } = setup();
  const t = todos.add({ title: '매일 약', due: '2026-10-10', repeat: 'daily' }, NOW);
  await pass();
  assert.equal(g.cals.get('primary')?.size, 1);
  todos.complete(t.id, NOW);
  await pass();
  const open = db.prepare('select id from todo where done_at is null and deleted_at is null').all() as {
    id: number;
  }[];
  assert.equal(open.length, 1);
  const next = Number(open[0]?.id);
  assert.notEqual(next, t.id);
  assert.equal(sent(g, idOf(t.id))?.status, 'cancelled');
  assert.equal(sent(g, idOf(next))?.status, 'confirmed');
  assert.notEqual(idOf(next), idOf(t.id));
});

test('보낸 기록 되돌리기: 확인 전으로 되돌려 같은 id 로 넣기부터 하고(409 다음 고치기), 지웠다는 표시는 둔다', async () => {
  const { todos, g, pass, idOf, store, db } = setup();
  const a = todos.add({ title: '가', due: '2026-10-12' }, NOW);
  const b = todos.add({ title: '나', due: '2026-10-13' }, NOW);
  await pass();
  todos.complete(b.id, NOW);
  await pass();
  store.resetSent();
  const rows = db.prepare('select id, google_hash, google_uid from todo order by id').all() as {
    id: number;
    google_hash: string | null;
    google_uid: string | null;
  }[];
  assert.deepEqual(
    rows.map((r) => [r.id, r.google_hash, r.google_uid]),
    [
      [a.id, null, null],
      [b.id, 'deleted', null],
    ],
  );
  g.calls.length = 0;
  await pass();
  assert.deepEqual(g.calls, [
    'POST /calendars/primary/events',
    `PATCH /calendars/primary/events/${idOf(a.id)}`,
  ]);
  assert.equal(g.cals.get('primary')?.size, 2);
});

test('올릴 캘린더를 바꾸면 올린 할 일을 새 캘린더로 옮긴다', async () => {
  const { todos, g, pass, idOf } = setup();
  g.cals.set('todo@group.calendar.google.com', new Map());
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const r = await pass('todo@group.calendar.google.com');
  assert.equal(r.stop, null);
  assert.equal(g.cals.get('primary')?.size, 0);
  assert.ok(sent(g, idOf(t.id), 'todo@group.calendar.google.com'));
  g.calls.length = 0;
  await pass('todo@group.calendar.google.com');
  assert.deepEqual(g.calls, []);
});

test('구글이 받지 않는 할 일 하나(400)는 미루고 다음 것으로, 인터넷이 끊기면 멈춘다', async () => {
  const { todos, g, pass, backoff } = setup();
  todos.add({ title: 'a', due: '2026-10-12' }, NOW);
  todos.add({ title: 'b', due: '2026-10-13' }, NOW);
  g.forced.push(g.res(400, { error: { code: 400 } }));
  g.forced.push(new TypeError('fetch failed'));
  const r = await pass();
  assert.equal(r.rejected.length, 1);
  assert.equal(r.stop, 'offline');
  assert.ok(backoff.nextAt() !== undefined);
});

// ---- 무덤 ----

const purgeAndCount = (db: Db) =>
  Number((db.prepare("select count(*) as n from gcal_tomb where kind = 'todo'").get() as { n: number }).n);

test('영구 삭제(purge) 뒤 무덤 줄이 생기고, 보내기가 구글 일정을 지우고 줄을 뺀다', async () => {
  const { todos, g, pass, idOf, db } = setup();
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const id = idOf(t.id);
  todos.remove(t.id, NOW);
  todos.purge([t.id]);
  assert.equal(db.prepare('select 1 from todo where id = ?').get(t.id), undefined);
  assert.equal(purgeAndCount(db), 1);
  const r = await pass();
  assert.equal(r.sent, 1);
  assert.equal(sent(g, id)?.status, 'cancelled');
  assert.equal(purgeAndCount(db), 0);
});

test('영구 삭제(휴지통 비우기, 30일 자동 정리, 동기화 purgeRow)도 무덤을 거친다', async () => {
  const { todos, g, pass, idOf, db } = setup();
  const a = todos.add({ title: 'a', due: '2026-10-12' }, NOW);
  const b = todos.add({ title: 'b', due: '2026-10-13' }, NOW);
  const c = todos.add({ title: 'c', due: '2026-10-14' }, NOW);
  await pass();
  const ids = [a, b, c].map((x) => idOf(x.id));
  const cUid = (db.prepare('select uid from todo where id = ?').get(c.id) as { uid: string }).uid;
  todos.remove(a.id, NOW);
  todos.emptyTrash();
  assert.equal(purgeAndCount(db), 1);
  // 30일 자동 정리
  todos.remove(b.id, NOW - 31 * DAY);
  assert.equal(todos.purgeExpired(NOW), 1);
  assert.equal(purgeAndCount(db), 2);
  // 다른 기기의 지움이 와서 이 기기가 행을 지운다
  assert.equal(purgeRow(db, 'todo', cUid), true);
  assert.equal(purgeAndCount(db), 3);
  const r = await pass();
  assert.equal(r.sent, 3);
  for (const id of ids) assert.equal(sent(g, id)?.status, 'cancelled');
  assert.equal(purgeAndCount(db), 0);
});

test('무덤: 이미 구글에서 지운 것과 구글에 안 올린 것은 옮기지 않는다. 구글에 이미 없으면(404) 지운 것으로 줄을 뺀다', async () => {
  const { todos, g, pass, idOf, db } = setup();
  const done = todos.add({ title: '끝냄', due: '2026-10-12' }, NOW);
  const never = todos.add({ title: '안 올림', due: '2026-08-01' }, NOW);
  const lost = todos.add({ title: '사라짐', due: '2026-10-13' }, NOW);
  await pass();
  todos.complete(done.id, NOW);
  await pass();
  g.cals.get('primary')?.delete(idOf(lost.id));
  for (const t of [done, never, lost]) todos.remove(t.id, NOW);
  todos.purge([done.id, never.id, lost.id]);
  // 끝내서 이미 지운 것과 올린 적 없는 것은 무덤에 없다
  assert.equal(purgeAndCount(db), 1);
  const r = await pass();
  assert.equal(r.sent, 1);
  assert.equal(purgeAndCount(db), 0);
});

test('무덤: 인터넷이 끊기면 줄이 남아 다음 차례에 지운다. 연결을 끊으면 비운다', async () => {
  const { todos, g, pass, idOf, db, store } = setup();
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const id = idOf(t.id);
  todos.remove(t.id, NOW);
  todos.purge([t.id]);
  g.forced.push(new TypeError('fetch failed'));
  assert.equal((await pass()).stop, 'offline');
  assert.equal(purgeAndCount(db), 1);
  store.clearTomb();
  assert.equal(purgeAndCount(db), 0);
  assert.equal(sent(g, id)?.status, 'confirmed');
});

test('일정도 영구 삭제하면(이슈 #302) 구글 일정이 무덤으로 가서 지워진다. 가져온 일정과 안 보낸 일정은 안 간다', async () => {
  const { events, g, evPass, db, evStore } = setup();
  const e = events.add({ title: '회의', startAt: NOW + 2 * HOUR }, NOW);
  const old = events.add({ title: '옛날', startAt: NOW - 90 * DAY }, NOW);
  await evPass();
  const gid = (db.prepare('select google_id from event where id = ?').get(e.id) as { google_id: string })
    .google_id;
  assert.ok(sent(g, gid));
  events.remove(e.id, NOW);
  events.remove(old.id, NOW);
  assert.equal(events.purgeTrash(undefined, NOW), 2);
  assert.equal(db.prepare('select 1 from event where id = ?').get(e.id), undefined);
  assert.deepEqual(
    db
      .prepare('select kind, google_id from gcal_tomb')
      .all()
      .map((r) => ({ ...(r as object) })),
    [{ kind: 'event', google_id: gid }],
  );
  const r = await evPass();
  assert.equal(r.sent, 1);
  assert.equal(sent(g, gid)?.status, 'cancelled');
  assert.equal(count(db, 'select count(*) as n from gcal_tomb'), 0);
  assert.deepEqual(evStore.pending(NOW, 'primary', TZ), []);
});

test('일정의 동기화 purgeRow 도 구글에 올라간 페어리 일정을 무덤으로 옮긴다', async () => {
  const { events, evPass, db } = setup();
  const e = events.add({ title: '회의', startAt: NOW + 2 * HOUR }, NOW);
  await evPass();
  const uid = (db.prepare('select uid from event where id = ?').get(e.id) as { uid: string }).uid;
  assert.equal(purgeRow(db, 'event', uid), true);
  assert.equal(count(db, "select count(*) as n from gcal_tomb where kind = 'event'"), 1);
});

// ---- 가져오기와 겹침 ----

test('할 일을 올린 캘린더를 가져와도 일정이 하나도 생기지 않는다 (표식이 지워진 jjt 일정도)', async () => {
  const { todos, events, g, pass, store, evStore, idOf, db } = setup();
  const t = todos.add({ title: '올린 할 일', due: '2026-10-12' }, NOW);
  await pass();
  const readEvents = () =>
    events.between(NOW - 30 * DAY, NOW + 90 * DAY).filter((e) => e.source === 'google');
  const pull = () =>
    pullPass({
      events,
      api: g.listApi,
      calendars: ['primary'],
      now: () => NOW,
      ours: evStore.sentUids(),
      untitled: '(제목 없음)',
    });
  // 표식이 있는 채로
  let r = await pull();
  assert.equal(r.ok && r.count, 0);
  assert.deepEqual(readEvents(), []);
  // 다른 앱이 표식과 iCalUID 를 지웠다: id 머리와 보낸 기록(google_id)으로 걸린다
  const id = idOf(t.id);
  const ev = sent(g, id) as Record<string, unknown>;
  g.cals.get('primary')?.set(id, { ...ev, extendedProperties: undefined, iCalUID: undefined });
  r = await pull();
  assert.equal(r.ok && r.count, 0);
  // 보내는 중 대답을 못 받아 google_uid 도 없는 상태 (google_id 만 있음)
  db.prepare('update todo set google_uid = null, google_hash = null where id = ?').run(t.id);
  r = await pull();
  assert.equal(r.ok && r.count, 0);
  assert.deepEqual(readEvents(), []);
  void store;
});

test('isFromFairy: 머리 목록(jjk, jjt)과 보낸 기록. 모르는 머리나 기록에 없는 id 는 거르지 않는다', () => {
  const ours = new Set([
    'jjt0000000000000000000000000a@google.com',
    'jjk0000000000000000000000000b@google.com',
  ]);
  assert.equal(isFromFairy({ id: 'jjt0000000000000000000000000a' }, ours), true);
  assert.equal(isFromFairy({ id: 'jjk0000000000000000000000000b' }, ours), true);
  assert.equal(isFromFairy({ id: 'jjt0000000000000000000000000c' }, ours), false);
  assert.equal(
    isFromFairy(
      { id: 'zzz0000000000000000000000000a' },
      new Set(['zzz0000000000000000000000000a@google.com']),
    ),
    false,
  );
});

test('sentUids 는 할 일의 구글 id 와 무덤 줄의 id 도 담는다 (가져오기가 거를 근거)', async () => {
  const { todos, pass, evStore, idOf, db } = setup();
  const t = todos.add({ title: '일', due: '2026-10-12' }, NOW);
  await pass();
  const id = idOf(t.id);
  assert.ok(evStore.sentUids().has(`${id}@google.com`));
  todos.remove(t.id, NOW);
  todos.purge([t.id]);
  assert.ok(evStore.sentUids().has(`${id}@google.com`));
  void db;
});
