import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { GcalBackoff } from '../shared/gcal.ts';
import { GcalStore } from '../shared/gcal-store.ts';
import { type ApiResult, classifyApi } from './gcal-auth.ts';
import { type GcalApi, GcalLost, reasonOf, syncPass } from './gcal-sync.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 10, 0);

/** 구글 캘린더 흉내: 캘린더마다 일정 (지운 것은 cancelled 로 남는다, 구글처럼) */
function fakeGoogle() {
  const cals = new Map<string, Map<string, Record<string, unknown>>>([['primary', new Map()]]);
  const calls: string[] = [];
  /** 다음 부름에 이 대답을 준다 (차례대로) */
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
      // 구글 PATCH 처럼: 안쪽 객체는 합치고(null 이면 그 칸을 지운다), 배열과 값은 바꾼다
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
      // 구글은 date 와 dateTime 이 같이 있는 시작, 끝을 받지 않는다
      for (const k of ['start', 'end']) {
        const tm = next[k] as Record<string, unknown> | undefined;
        if (tm && 'date' in tm && 'dateTime' in tm)
          return res(400, {
            error: { code: 400, errors: [{ reason: 'invalid', message: 'Invalid start time.' }] },
          });
      }
      cal.set(id, next);
      return res(200, next);
    }
    if (ev.status === 'cancelled') return res(410, {});
    cal.set(id, { ...ev, status: 'cancelled' });
    return res(204);
  };
  return { cals, calls, forced, api, res };
}

function setup() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const events = new EventStore(db);
  const store = new GcalStore(db, events);
  const g = fakeGoogle();
  const backoff = new GcalBackoff(() => 0);
  let n = 0;
  let now = NOW;
  const pass = (calendarId = 'primary') =>
    syncPass({
      store,
      backoff,
      api: g.api,
      newId: () => `jjk${String(++n).padStart(5, '0')}`,
      now: () => now,
      calendarId,
      tz: 'Asia/Seoul',
    });
  return {
    db,
    events,
    store,
    g,
    backoff,
    pass,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

test('넣고, 고치고, 지우기가 구글로 간다. 안 바뀌면 다시 안 부른다', async () => {
  const { events, g, pass, store } = setup();
  const e = events.add({ title: '회의', startAt: NOW + 2 * HOUR, reminds: [10, 60] }, NOW);
  const r1 = await pass();
  assert.deepEqual(r1, {
    pending: 0,
    sent: 1,
    waiting: 0,
    stop: null,
    again: false,
    rejected: [],
    accepted: [e.id],
  });
  const sent = g.cals.get('primary')?.get('jjk00001');
  assert.equal(sent?.summary, '회의');
  assert.deepEqual(sent?.reminders, {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 10 },
      { method: 'popup', minutes: 60 },
    ],
  });
  assert.ok(store.sentUids().has('jjk00001@google.com'));

  g.calls.length = 0;
  assert.equal((await pass()).sent, 0);
  assert.deepEqual(g.calls, []);

  events.update(e.id, { title: '회의 (3층)' }, NOW);
  await pass();
  assert.deepEqual(g.calls, ['PATCH /calendars/primary/events/jjk00001']);
  assert.equal(g.cals.get('primary')?.get('jjk00001')?.summary, '회의 (3층)');

  events.remove(e.id, NOW);
  await pass();
  assert.equal(g.cals.get('primary')?.get('jjk00001')?.status, 'cancelled');
  g.calls.length = 0;
  await pass();
  assert.deepEqual(g.calls, []);

  // 되돌리기: 같은 id 를 고쳐 되살린다
  events.restore(e.id);
  await pass();
  assert.equal(g.cals.get('primary')?.get('jjk00001')?.status, 'confirmed');
});

test('넣기 대답을 못 받았어도(끊김) 다시 보낼 때 같은 id 라 겹치지 않는다: 409 → 고치기', async () => {
  const { events, g, pass, backoff, tick } = setup();
  events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  // 구글에는 들어갔는데 대답이 오다 끊겼다
  g.forced.push(new TypeError('fetch failed'));
  const r1 = await pass();
  assert.equal(r1.stop, 'offline');
  assert.equal(r1.sent, 0);
  // 이 일정은 30초 기다린다
  assert.equal(backoff.nextAt(), NOW + 30_000);
  assert.equal((await pass()).waiting, 1);
  tick(30_000);
  // 끊긴 사이 구글에는 들어가 있었다. 이번에는 미리 적어 둔 같은 id 로 보낸다
  g.cals.get('primary')?.set('jjk00001', { summary: '회의', id: 'jjk00001' });
  g.calls.length = 0;
  const r2 = await pass();
  assert.equal(r2.sent, 1);
  assert.deepEqual(g.calls, ['POST /calendars/primary/events', 'PATCH /calendars/primary/events/jjk00001']);
  assert.equal(g.cals.get('primary')?.size, 1);
});

test('구글에서 지운 일정을 고치면(404) 새 id 로 다시 넣는다', async () => {
  const { events, g, pass } = setup();
  const e = events.add({ title: '회의', startAt: NOW + HOUR }, NOW);
  await pass();
  g.cals.get('primary')?.delete('jjk00001');
  events.update(e.id, { title: '회의!' }, NOW);
  const r = await pass();
  assert.equal(r.again, true);
  await pass();
  assert.equal(g.cals.get('primary')?.get('jjk00002')?.summary, '회의!');
});

test('구글이 받지 않는 일정은 길게 미루고 다음 것으로, 바쁘면(503) 거기서 멈춘다', async () => {
  const { events, g, pass, backoff } = setup();
  events.add({ title: 'a', startAt: NOW + HOUR }, NOW);
  events.add({ title: 'b', startAt: NOW + 2 * HOUR }, NOW);
  events.add({ title: 'c', startAt: NOW + 3 * HOUR }, NOW);
  g.forced.push(g.res(400, { error: { code: 400 } }));
  g.forced.push(g.res(503));
  const r = await pass();
  assert.deepEqual([r.sent, r.stop, r.pending], [0, 'offline', 3]);
  assert.equal(g.calls.length, 2);
  assert.ok(backoff.nextAt() === NOW + 30_000);
  // 받지 않은 것(a)은 6시간, 바쁜 것(b)은 30초
  assert.ok(!backoff.ready('1', NOW + 60_000));
  assert.ok(backoff.ready('2', NOW + 30_000));
});

test('캘린더를 못 쓰면(403, 없는 캘린더) calendar 로 멈춘다. 권한이 빠지면 scope', async () => {
  const { events, pass } = setup();
  events.add({ title: 'a', startAt: NOW + HOUR }, NOW);
  assert.equal((await pass('nope@group.calendar.google.com')).stop, 'calendar');
  const s = setup();
  s.events.add({ title: 'a', startAt: NOW + HOUR }, NOW);
  s.g.forced.push(s.g.res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.equal((await s.pass()).stop, 'scope');
});

test('연결이 끝나면(GcalLost) 그대로 던진다. 가져온 일정은 보내지 않는다', async () => {
  const { events, g, pass } = setup();
  events.syncExternal(
    'ics',
    [{ uid: 'x@google.com', title: '가져옴', startAt: NOW + HOUR, endAt: null, allDay: false }],
    NOW - HOUR,
    NOW + 48 * HOUR,
    NOW,
  );
  assert.equal((await pass()).pending, 0);
  assert.deepEqual(g.calls, []);
  events.add({ title: 'a', startAt: NOW + HOUR }, NOW);
  g.forced.push(new GcalLost());
  await assert.rejects(pass(), GcalLost);
});

test('종일 일정은 날짜로 간다', async () => {
  const { events, g, pass } = setup();
  // 서울 10월 12일 0시
  events.add(
    { title: '여행', startAt: Date.UTC(2026, 9, 11, 15), endAt: Date.UTC(2026, 9, 13, 15), allDay: true },
    NOW,
  );
  await pass();
  const ev = g.cals.get('primary')?.get('jjk00001');
  assert.deepEqual([ev?.start, ev?.end], [{ date: '2026-10-12' }, { date: '2026-10-14' }]);
});

test('보낼 캘린더를 바꾸면 보낸 일정을 새 캘린더로 옮긴다. 옛 캘린더를 못 쓰면 거기 일정 지우기는 넘어간다', async () => {
  const { events, g, pass } = setup();
  g.cals.set('work@group.calendar.google.com', new Map());
  const a = events.add({ title: '회의', startAt: NOW + 2 * HOUR }, NOW);
  const b = events.add({ title: '점심', startAt: NOW + 3 * HOUR }, NOW);
  await pass();
  assert.equal(g.cals.get('primary')?.size, 2);
  const r = await pass('work@group.calendar.google.com');
  assert.equal(r.stop, null);
  assert.equal(g.cals.get('primary')?.size, 0);
  assert.equal(g.cals.get('work@group.calendar.google.com')?.size, 2);
  // 또 돌려도 옮기지 않는다
  g.calls.length = 0;
  await pass('work@group.calendar.google.com');
  assert.deepEqual(g.calls, []);
  void [a, b];
});

test('옛 캘린더에 남은 일정을 지울 때 그 캘린더를 못 쓰면(403) 지운 것으로 치고 멈추지 않는다', async () => {
  const { events, g, pass, store } = setup();
  const c = events.add({ title: '옛것', startAt: NOW + 4 * HOUR }, NOW);
  await pass('primary');
  events.remove(c.id, NOW);
  g.forced.push(g.res(403, { error: { code: 403, errors: [{ reason: 'forbidden' }] } }));
  const r = await pass('work@group.calendar.google.com');
  assert.equal(r.stop, null);
  assert.deepEqual(store.pending(NOW, 'work@group.calendar.google.com', 'Asia/Seoul'), []);
  // 지금 고른 캘린더에서 403 이면 그대로 멈춘다
  const d = events.add({ title: '새것', startAt: NOW + 5 * HOUR }, NOW);
  await pass('primary');
  events.remove(d.id, NOW);
  g.forced.push(g.res(403, { error: { code: 403, errors: [{ reason: 'forbidden' }] } }));
  assert.equal((await pass('primary')).stop, 'calendar');
});

test('종일과 시각 일정 사이를 바꿔도 구글이 받는다 (PATCH 가 옛 date, dateTime 칸을 지운다)', async () => {
  const { events, g, pass } = setup();
  const e = events.add({ title: '워크숍', startAt: NOW + 2 * HOUR }, NOW);
  await pass();
  // 패널의 종일 단추와 같은 바꾸기: 시각 → 종일
  events.update(e.id, { startAt: NOW, endAt: null, allDay: true }, NOW);
  const r1 = await pass();
  assert.deepEqual([r1.sent, r1.rejected], [1, []]);
  const allDay = g.cals.get('primary')?.get('jjk00001') as { start: Record<string, unknown> };
  assert.deepEqual(Object.keys(allDay.start), ['date']);
  // 종일 → 시각
  events.update(e.id, { startAt: NOW + 3 * HOUR, endAt: null, allDay: false }, NOW);
  const r2 = await pass();
  assert.deepEqual([r2.sent, r2.rejected], [1, []]);
  const timed = g.cals.get('primary')?.get('jjk00001') as { start: Record<string, unknown> };
  assert.deepEqual(Object.keys(timed.start).sort(), ['dateTime', 'timeZone']);
});

test('구글이 받지 않으면 그 일정과 지문을 돌려주고 기록에 상태와 까닭 이름을 남긴다 (일정 글은 남기지 않는다)', async () => {
  const { events, g, store, backoff } = setup();
  const e = events.add({ title: '비밀 회의', startAt: NOW + 2 * HOUR }, NOW);
  const lines: unknown[][] = [];
  g.forced.push(
    g.res(400, { error: { code: 400, errors: [{ reason: 'invalid', message: '비밀 회의 is bad' }] } }),
  );
  const r = await syncPass({
    store,
    backoff,
    api: g.api,
    newId: () => 'jjk00001',
    now: () => NOW,
    calendarId: 'primary',
    tz: 'Asia/Seoul',
    log: (...a) => lines.push(a),
  });
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0]?.eventId, e.id);
  assert.equal(r.rejected[0]?.hash, store.hashOf(e.id, 'Asia/Seoul'));
  assert.deepEqual(lines, [['gcal', '구글이 받지 않음', 'upsert', 400, 'invalid']]);
  assert.ok(!JSON.stringify(lines).includes('비밀'));
});

test('까닭 이름: 모양이 이상하면 - 로', () => {
  assert.equal(reasonOf({ error: { errors: [{ reason: 'timeRangeEmpty' }] } }), 'timeRangeEmpty');
  assert.equal(reasonOf({ error: { errors: [{ reason: 'a b <script>' }] } }), '-');
  assert.equal(reasonOf(undefined), '-');
  assert.equal(reasonOf('x'), '-');
});
