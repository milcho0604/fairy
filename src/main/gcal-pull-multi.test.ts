// 여러 캘린더 가져오기 (구글 캘린더 옵션 창): 가짜 구글로 목록 읽기, 여러 캘린더 읽기, 캘린더 빼기, 겹침
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { GCAL_PRIMARY } from '../shared/gcal.ts';
import { type ApiResult, classifyApi } from './gcal-auth.ts';
import { listCalendars, pullPass } from './gcal-pull.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 3);
const FAMILY = 'family123@group.calendar.google.com';
const FRIEND = 'friend@gmail.com';
const HOLIDAY = 'ko.south_korea#holiday@group.v.calendar.google.com';

const res = (status: number, json?: unknown): ApiResult => ({
  kind: classifyApi(status, json),
  status,
  json,
});
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (id: string, title: string, at: number, uid = `${id}@google.com`) => ({
  id,
  iCalUID: uid,
  status: 'confirmed',
  summary: title,
  start: { dateTime: iso(at) },
  end: { dateTime: iso(at + HOUR) },
});

/** 캘린더마다 일정을 따로 두는 가짜 구글. down 에 넣은 캘린더는 읽기가 실패한다 */
function fakeGoogle() {
  const cals: Record<string, Record<string, unknown>[]> = {
    [GCAL_PRIMARY]: [ev('a', '내 회의', NOW + DAY)],
    [FAMILY]: [
      ev('f1', '가족 저녁', NOW + 2 * DAY),
      ev('shared', '같이 가는 결혼식', NOW + 3 * DAY, 'wed@google.com'),
    ],
    [FRIEND]: [
      ev('shared', '같이 가는 결혼식', NOW + 3 * DAY, 'wed@google.com'),
      ev('r1', '친구 생일', NOW + 4 * DAY),
    ],
    [HOLIDAY]: [
      {
        id: 'h1',
        iCalUID: 'h1@google.com',
        status: 'confirmed',
        summary: '한글날',
        start: { date: '2026-10-09' },
        end: { date: '2026-10-10' },
      },
    ],
  };
  const down = new Map<string, ApiResult | Error>();
  const calls: string[] = [];
  let listReply: ApiResult | undefined;
  const api = async (_m: 'GET', path: string): Promise<ApiResult> => {
    calls.push(path);
    const url = new URL(`https://x${path}`);
    if (url.pathname === '/users/me/calendarList') {
      if (listReply) return listReply;
      return res(200, {
        items: [
          {
            id: 'me@gmail.com',
            summary: 'me@gmail.com',
            backgroundColor: '#9fe1e7',
            accessRole: 'owner',
            primary: true,
          },
          { id: FAMILY, summary: '가족', backgroundColor: '#f691b2', accessRole: 'writer' },
        ],
        nextPageToken: url.searchParams.get('pageToken') ? undefined : 'p2',
      });
    }
    const m = /^\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!m) return res(404, {});
    const id = decodeURIComponent(m[1] as string);
    const d = down.get(id);
    if (d instanceof Error) throw d;
    if (d) return d;
    const items = cals[id];
    return items ? res(200, { items }) : res(404, {});
  };
  return { cals, down, calls, api, setList: (r: ApiResult) => (listReply = r) };
}

function setup() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const events = new EventStore(db);
  const g = fakeGoogle();
  const pull = (calendars: string[]) =>
    pullPass({ events, api: g.api, calendars, now: () => NOW, ours: new Set(), untitled: '(제목 없음)' });
  const google = () =>
    events
      .between(NOW - 30 * DAY, NOW + 90 * DAY)
      .filter((e) => e.source === 'google')
      .map((e) => `${events.googleCalOf([e.id])[e.id]}:${e.title}`)
      .sort();
  return { events, g, pull, google };
}

test('캘린더 목록 읽기: 쪽을 다 넘겨 읽고, 기본 캘린더는 primary 로', async () => {
  const { g } = setup();
  const r = await listCalendars({ api: g.api });
  assert.ok(r.ok);
  assert.deepEqual(
    r.calendars.map((c) => [c.id, c.name, c.role]),
    [
      [GCAL_PRIMARY, 'me@gmail.com', 'owner'],
      [FAMILY, '가족', 'writer'],
    ],
  );
  assert.equal(g.calls.length, 2);
  assert.match(g.calls[0] ?? '', /^\/users\/me\/calendarList\?/);
});

test('예전 연결(목록 권한 없음)이면 목록 읽기가 scope 로 끝난다 (다시 연결 안내)', async () => {
  const { g } = setup();
  g.setList(res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.deepEqual(await listCalendars({ api: g.api }), { ok: false, stop: 'scope' });
  g.setList(res(500, {}));
  assert.deepEqual(await listCalendars({ api: g.api }), { ok: false, stop: 'offline' });
});

test('고른 캘린더 여러 개에서 모두 가져오고, 일정마다 어느 캘린더인지 적는다', async () => {
  const { pull, google } = setup();
  const r = await pull([GCAL_PRIMARY, FAMILY, HOLIDAY]);
  assert.ok(r.ok);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(google(), [
    `${FAMILY}:가족 저녁`,
    `${FAMILY}:같이 가는 결혼식`,
    `${HOLIDAY}:한글날`,
    'primary:내 회의',
  ]);
});

test('같은 일정이 두 캘린더에 있으면(같은 iCalUID) 한 번만', async () => {
  const { pull, google } = setup();
  await pull([GCAL_PRIMARY, FAMILY, FRIEND]);
  assert.deepEqual(google(), [
    `${FAMILY}:가족 저녁`,
    `${FAMILY}:같이 가는 결혼식`,
    `${FRIEND}:친구 생일`,
    'primary:내 회의',
  ]);
  // 앞 캘린더를 빼면 남은 캘린더에서 보인다 (사라지지 않는다)
  await pull([GCAL_PRIMARY, FRIEND]);
  assert.deepEqual(google(), [`${FRIEND}:같이 가는 결혼식`, `${FRIEND}:친구 생일`, 'primary:내 회의']);
});

test('다 못 읽은 캘린더는 그 캘린더 것만 그대로 두고, 나머지는 맞춘다', async () => {
  const { g, pull, google } = setup();
  await pull([GCAL_PRIMARY, FAMILY]);
  g.down.set(FAMILY, new Error('offline'));
  g.cals[GCAL_PRIMARY] = [ev('b', '새 회의', NOW + DAY)];
  g.cals[FAMILY] = [];
  const r = await pull([GCAL_PRIMARY, FAMILY]);
  assert.ok(r.ok);
  assert.deepEqual(r.failed, [{ id: FAMILY, stop: 'offline' }]);
  assert.deepEqual(google(), [`${FAMILY}:가족 저녁`, `${FAMILY}:같이 가는 결혼식`, 'primary:새 회의']);
  // 다 실패하면 아무것도 바꾸지 않고 실패
  g.down.set(GCAL_PRIMARY, res(404, {}));
  const all = await pull([GCAL_PRIMARY, FAMILY]);
  assert.equal(all.ok, false);
  assert.deepEqual(google(), [`${FAMILY}:가족 저녁`, `${FAMILY}:같이 가는 결혼식`, 'primary:새 회의']);
});

test('캘린더를 빼면 그 캘린더 일정은 걷고, 다시 넣으면 되살린다', async () => {
  const { events, pull, google } = setup();
  await pull([GCAL_PRIMARY, FAMILY]);
  assert.equal(events.dropGoogleCals([GCAL_PRIMARY], NOW), 2);
  assert.deepEqual(google(), ['primary:내 회의']);
  // 다음 읽기도 뺀 캘린더는 부르지 않는다
  await pull([GCAL_PRIMARY]);
  assert.deepEqual(google(), ['primary:내 회의']);
  await pull([GCAL_PRIMARY, FAMILY]);
  assert.deepEqual(google(), [`${FAMILY}:가족 저녁`, `${FAMILY}:같이 가는 결혼식`, 'primary:내 회의']);
});

test('예전 판(캘린더 하나)에서 가져온 일정은 그 캘린더 것으로 이어받는다 (다시 넣지 않고 알림 그대로)', async () => {
  const { events, pull, google } = setup();
  // 예전 판처럼 캘린더 없이 넣어 둔 줄
  events.syncExternal(
    'google',
    [
      {
        uid: 'a',
        icalUid: 'a@google.com',
        title: '내 회의',
        startAt: NOW + DAY,
        endAt: NOW + DAY + HOUR,
        allDay: false,
      },
    ],
    NOW - 7 * DAY,
    NOW + 60 * DAY,
    NOW,
  );
  const before = events.between(NOW, NOW + 90 * DAY).find((e) => e.source === 'google');
  assert.ok(before);
  events.update(before.id, { reminds: [30] }, NOW);
  assert.equal(events.claimGoogleRows(GCAL_PRIMARY), 1);
  await pull([GCAL_PRIMARY]);
  assert.deepEqual(google(), ['primary:내 회의']);
  const after = events.between(NOW, NOW + 90 * DAY).find((e) => e.source === 'google');
  assert.equal(after?.id, before.id);
});
