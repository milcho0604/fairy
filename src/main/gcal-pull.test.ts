import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { aiSafeEvent, dayStartMs, EventStore } from '../shared/event-store.ts';
import { GcalBackoff } from '../shared/gcal.ts';
import { fromGoogle, isFromFairy, listPath, PULL_MAX_PAGES } from '../shared/gcal-pull.ts';
import { GcalStore } from '../shared/gcal-store.ts';
import { type ApiResult, classifyApi } from './gcal-auth.ts';
import { pullPass } from './gcal-pull.ts';
import { type GcalApi, GcalLost, syncPass } from './gcal-sync.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 3);

const res = (status: number, json?: unknown): ApiResult => ({
  kind: classifyApi(status, json),
  status,
  json,
});

/**
 * 가짜 구글 캘린더 (net.fetch 대신 api 를 바꾼다, gcal-sync.test.ts 와 같은 방식).
 * GET 목록은 page 개씩 나눠 nextPageToken 을 준다. 보내기(POST)도 받아 같은 캘린더에 쌓는다
 */
function fakeGoogle(page = 2) {
  const items: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const forced: (ApiResult | Error)[] = [];
  const api = async (method: string, path: string, body?: unknown): Promise<ApiResult> => {
    calls.push(`${method} ${path}`);
    const f = forced.shift();
    if (f instanceof Error) throw f;
    if (f) return f;
    if (method === 'GET') {
      const url = new URL(`https://x${path}`);
      if (!/^\/calendars\/[^/]+\/events$/.test(url.pathname)) return res(404, {});
      const from = Number(url.searchParams.get('pageToken') ?? 0);
      const list = items.filter(
        (i) => i.status !== 'cancelled' || url.searchParams.get('showDeleted') === 'true',
      );
      const next = from + page < list.length ? String(from + page) : undefined;
      return res(200, { items: list.slice(from, from + page), ...(next ? { nextPageToken: next } : {}) });
    }
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const ev = { ...b, iCalUID: `${String(b.id)}@google.com` };
      items.push(ev);
      return res(200, ev);
    }
    return res(400, {});
  };
  return { items, calls, forced, api };
}

function setup(page = 2) {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const events = new EventStore(db);
  const store = new GcalStore(db, events);
  const g = fakeGoogle(page);
  let now = NOW;
  const pull = (o: { current?: () => boolean } = {}) =>
    pullPass({
      events,
      api: (m, p) => g.api(m, p),
      calendarId: 'primary',
      now: () => now,
      ours: store.sentUids(),
      untitled: '(제목 없음)',
      ...o,
    });
  const google = () => events.between(now - 30 * DAY, now + 90 * DAY).filter((e) => e.source === 'google');
  return {
    db,
    events,
    store,
    g,
    pull,
    google,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const timed = (id: string, start: string, end: string, more: Record<string, unknown> = {}) => ({
  id,
  iCalUID: `${id}@google.com`,
  status: 'confirmed',
  summary: id,
  start: { dateTime: start },
  end: { dateTime: end },
  ...more,
});

test('목록 경로: 범위, 회차 펼치기, 지운 것 빼기, 받을 칸만', () => {
  const p = listPath('me@gmail.com', { from: NOW - 7 * DAY, to: NOW + 60 * DAY }, 'tok');
  const u = new URL(`https://x${p}`);
  assert.equal(u.pathname, '/calendars/me%40gmail.com/events');
  assert.equal(u.searchParams.get('singleEvents'), 'true');
  assert.equal(u.searchParams.get('showDeleted'), 'false');
  assert.equal(u.searchParams.get('timeMin'), new Date(NOW - 7 * DAY).toISOString());
  assert.equal(u.searchParams.get('timeMax'), new Date(NOW + 60 * DAY).toISOString());
  assert.equal(u.searchParams.get('pageToken'), 'tok');
  // 설명, 장소, 참석자는 받지 않는다
  const fields = u.searchParams.get('fields') ?? '';
  assert.match(fields, /summary/);
  assert.doesNotMatch(fields, /description|location|attendees/);
});

test('목록을 쪽마다 다 읽어 페어리 일정으로 넣는다 (쪽 넘기기)', async () => {
  const { g, pull, google, events } = setup(2);
  for (let i = 0; i < 5; i++)
    g.items.push(
      timed(
        `ev${i}`,
        new Date(NOW + (i + 1) * HOUR).toISOString(),
        new Date(NOW + (i + 2) * HOUR).toISOString(),
      ),
    );
  const r = await pull();
  assert.deepEqual(r, { ok: true, count: 5, added: 5, updated: 0, removed: 0, hidden: 0, failed: [] });
  assert.equal(g.calls.length, 3);
  assert.match(g.calls[1] ?? '', /pageToken=2/);
  const got = google();
  assert.deepEqual(
    got.map((e) => e.title),
    ['ev0', 'ev1', 'ev2', 'ev3', 'ev4'],
  );
  // 시각 일정은 기본 알림(10분 전)
  assert.deepEqual(got[0]?.reminds, [10]);
  // 다시 읽어도 안 바뀌면 그대로
  const again = await pull();
  assert.deepEqual(again, { ok: true, count: 5, added: 0, updated: 0, removed: 0, hidden: 0, failed: [] });
  assert.equal(events.googleUids().size, 5);
});

test('구글에서 지우거나 취소한 일정은 페어리에서도 사라지고, 고친 것은 따라온다', async () => {
  const { g, pull, google } = setup(10);
  g.items.push(timed('a', '2026-10-11T10:00:00+09:00', '2026-10-11T11:00:00+09:00'));
  g.items.push(timed('b', '2026-10-12T10:00:00+09:00', '2026-10-12T11:00:00+09:00'));
  g.items.push(timed('c', '2026-10-13T10:00:00+09:00', '2026-10-13T11:00:00+09:00'));
  await pull();
  assert.equal(google().length, 3);
  // a 는 지움 (목록에서 빠짐), b 는 취소됨 (showDeleted 가 아니면 안 오지만 와도 거른다), c 는 제목을 고침
  g.items.splice(0, 1);
  (g.items[0] as Record<string, unknown>).status = 'cancelled';
  (g.items[1] as Record<string, unknown>).summary = '고친 제목';
  const r = await pull();
  assert.deepEqual(r, { ok: true, count: 1, added: 0, updated: 1, removed: 2, hidden: 0, failed: [] });
  assert.deepEqual(
    google().map((e) => e.title),
    ['고친 제목'],
  );
  // 취소된 것을 그대로 받아도 넣지 않는다
  assert.equal(
    fromGoogle({ ...timed('z', '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z'), status: 'cancelled' }, '-'),
    undefined,
  );
});

test('페어리가 보낸 일정은 다시 가져오지 않는다 (짝꿍 표시, 보낸 iCalUID)', async () => {
  const { g, pull, google, store, events } = setup(10);
  // 페어리에서 넣고 구글로 보낸다 → 같은 캘린더를 읽으면 되돌아온다
  const mine = events.add({ title: '내 일정', startAt: NOW + 3 * HOUR }, NOW);
  await syncPass({
    store,
    backoff: new GcalBackoff(() => 0),
    api: g.api as GcalApi,
    newId: () => 'jjk00001',
    now: () => NOW,
    calendarId: 'primary',
    tz: 'Asia/Seoul',
  });
  assert.equal(g.items.length, 1);
  // 짝꿍 표시가 지워진 채 돌아와도(다른 앱이 고침) 보낸 기록으로 거른다
  g.items.push(
    timed('jjk00002', '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z', { iCalUID: 'jjk00002@google.com' }),
  );
  store.assignId(mine.id, 'jjk00002', 'primary');
  g.items.push(timed('other', '2026-10-11T12:00:00Z', '2026-10-11T13:00:00Z'));
  const r = await pull();
  assert.equal(r.ok && r.count, 1);
  assert.deepEqual(
    google().map((e) => e.title),
    ['other'],
  );
  assert.equal(isFromFairy({ id: 'x', extendedProperties: { private: { jjakkung: '1' } } }), true);
  assert.equal(isFromFairy({ id: 'x' }), false);
});

test('종일 일정: 하루짜리는 끝 없음, 여러 날은 끝 날 다음 날 0시, 알림 없음', async () => {
  const { g, pull, google } = setup(10);
  g.items.push({ id: 'one', summary: '휴가', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } });
  g.items.push({ id: 'trip', summary: '여행', start: { date: '2026-10-14' }, end: { date: '2026-10-17' } });
  await pull();
  const [one, trip] = google();
  assert.equal(one?.allDay, true);
  assert.equal(one?.startAt, dayStartMs('2026-10-12'));
  assert.equal(one?.endAt, null);
  assert.deepEqual(one?.reminds, []);
  assert.equal(trip?.startAt, dayStartMs('2026-10-14'));
  assert.equal(trip?.endAt, dayStartMs('2026-10-17'));
  // 구글에서 종일을 시각 일정으로 바꾸면 따라온다
  g.items[0] = timed('one', '2026-10-12T09:00:00+09:00', '2026-10-12T10:00:00+09:00');
  await pull();
  const moved = google().find((e) => e.title === 'one');
  assert.equal(moved?.allDay, false);
  assert.equal(moved?.startAt, Date.UTC(2026, 9, 12, 0));
  assert.deepEqual(moved?.reminds, [10]);
});

test('시간대: 구글 dateTime 의 시간대 차를 그대로 지킨다', () => {
  const seoul = fromGoogle(timed('s', '2026-10-12T09:00:00+09:00', '2026-10-12T10:30:00+09:00'), '-');
  assert.equal(seoul?.startAt, Date.UTC(2026, 9, 12, 0));
  assert.equal(seoul?.endAt, Date.UTC(2026, 9, 12, 1, 30));
  const la = fromGoogle(timed('l', '2026-10-12T09:00:00-07:00', '2026-10-12T09:00:00-07:00'), '-');
  assert.equal(la?.startAt, Date.UTC(2026, 9, 12, 16));
  // 끝이 시작과 같으면 끝 없음
  assert.equal(la?.endAt, null);
  const utc = fromGoogle(timed('u', '2026-10-12T00:00:00Z', '2026-10-12T01:00:00Z'), '-');
  assert.equal(utc?.startAt, Date.UTC(2026, 9, 12, 0));
  // 제목이 없으면(비공개 일정) 대신 이름
  assert.equal(
    fromGoogle({ id: 'p', start: { dateTime: '2026-10-12T00:00:00Z' } }, '(제목 없음)')?.title,
    '(제목 없음)',
  );
  // 시각이 틀리면 버린다
  assert.equal(fromGoogle({ id: 'bad', start: { dateTime: 'nope' } }, '-'), undefined);
  assert.equal(fromGoogle({ id: 'bad', start: { date: '2026/10/12' } }, '-'), undefined);
});

test('다 못 읽으면(인터넷, 권한, 캘린더 없음, 끔) 아무것도 지우지 않는다', async () => {
  const { g, pull, google } = setup(1);
  g.items.push(timed('a', '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z'));
  g.items.push(timed('b', '2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z'));
  await pull();
  assert.equal(google().length, 2);
  g.items.splice(1, 1);
  // 첫 쪽은 받고 둘째 쪽에서 끊김 → 지우지 않는다
  g.items.push(timed('c', '2026-10-13T10:00:00Z', '2026-10-13T11:00:00Z'));
  g.forced.push(res(200, { items: [g.items[0]], nextPageToken: '1' }), new Error('net'));
  assert.deepEqual(await pull(), { ok: false, stop: 'offline' });
  assert.equal(google().length, 2);
  g.forced.push(res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.deepEqual(await pull(), { ok: false, stop: 'scope' });
  g.forced.push(res(404, {}));
  assert.deepEqual(await pull(), { ok: false, stop: 'calendar' });
  g.forced.push(res(503, {}));
  assert.deepEqual(await pull(), { ok: false, stop: 'offline' });
  // 연결이 끝났으면(invalid_grant) 삼키지 않고 던진다
  g.forced.push(new GcalLost());
  await assert.rejects(pull(), GcalLost);
  // 읽는 사이 끄거나 캘린더를 바꿨다
  assert.deepEqual(await pull({ current: () => false }), { ok: false, stop: 'stale' });
  assert.equal(google().length, 2);
  // 쪽이 끝없이 이어지면 그만둔다
  for (let i = 0; i < PULL_MAX_PAGES + 1; i++)
    g.items.push(timed(`m${i}`, '2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z'));
  assert.deepEqual(await pull(), { ok: false, stop: 'failed' });
  assert.equal(google().length, 2);
});

test('캘린더 가져오기(.ics)로 같은 일정이 들어와 있으면 하나만 남긴다', async () => {
  const { g, pull, events, google } = setup(10);
  const at = Date.UTC(2026, 9, 11, 1);
  events.syncExternal(
    'ics',
    [
      { uid: 'same@google.com', title: '같은 일정', startAt: at, endAt: at + HOUR, allDay: false },
      {
        uid: 'rep@google.com',
        recurrenceId: '20261012',
        title: '반복 회차',
        startAt: at + DAY,
        endAt: null,
        allDay: false,
      },
      { uid: 'ics-only', title: 'ics 에만', startAt: at, endAt: null, allDay: false },
    ],
    NOW - DAY,
    NOW + 60 * DAY,
    NOW,
  );
  g.items.push(timed('same', new Date(at).toISOString(), new Date(at + HOUR).toISOString()));
  g.items.push(
    timed('rep_20261012', new Date(at + DAY).toISOString(), new Date(at + DAY + HOUR).toISOString(), {
      iCalUID: 'rep@google.com',
    }),
  );
  const r = await pull();
  assert.equal(r.ok && r.hidden, 2);
  const all = events.between(NOW - 30 * DAY, NOW + 90 * DAY);
  assert.deepEqual(all.map((e) => `${e.source}:${e.title}`).sort(), [
    'google:rep_20261012',
    'google:same',
    'ics:ics 에만',
  ]);
  assert.equal(google().length, 2);
  // 다음 .ics 가져오기가 거를 UID
  assert.deepEqual([...events.googleUids()].sort(), ['rep@google.com', 'same@google.com']);
});

test('가져온 일정은 읽기 전용: 제목, 시각, 종일은 안 바뀌고 알림만 바뀐다. 숨기면 다시 안 나온다', async () => {
  const { g, pull, events, google } = setup(10);
  g.items.push(timed('a', '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z'));
  await pull();
  const e = google()[0];
  assert.ok(e);
  // 구글 사용자 데이터라 AI 로 보내지 않는다
  assert.equal(aiSafeEvent(e), false);
  assert.equal(aiSafeEvent({ source: 'ics' }), true);
  const after = events.update(
    e.id,
    { title: '바꿈', startAt: e.startAt + HOUR, allDay: true, reminds: [30] },
    NOW,
  );
  assert.equal(after?.title, 'a');
  assert.equal(after?.startAt, e.startAt);
  assert.equal(after?.allDay, false);
  assert.deepEqual(after?.reminds, [30]);
  // 다음 읽기가 알림을 덮지 않는다
  await pull();
  assert.deepEqual(google()[0]?.reminds, [30]);
  events.remove(e.id, NOW);
  await pull();
  assert.equal(google().length, 0);
});

test('읽어 오기를 끄면 가져온 일정을 다 걷고, 다시 켜면 되살린다', async () => {
  const { g, pull, events, google } = setup(10);
  g.items.push(timed('a', '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z'));
  g.items.push({
    id: 'past',
    summary: '지난 일',
    start: { date: '2026-10-05' },
    end: { date: '2026-10-06' },
  });
  await pull();
  assert.equal(google().length, 2);
  assert.equal(events.dropExternal('google', NOW, { all: true }), 2);
  assert.equal(google().length, 0);
  const r = await pull();
  assert.equal(r.ok && r.updated, 2);
  assert.equal(google().length, 2);
});
