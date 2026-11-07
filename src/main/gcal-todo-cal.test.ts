import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { GCAL_TODO_ID_PREFIX, GcalBackoff } from '../shared/gcal.ts';
import {
  CALLIST_FIELDS,
  canonicalFairy,
  cleanCalendars,
  extraFairy,
  FAIRY_MARKER,
  type GcalCalendar,
  hasFairyMarker,
  parseCalendarList,
} from '../shared/gcal-cals.ts';
import type { GcalTodoPrefs } from '../shared/gcal-prefs.ts';
import { GcalTodoStore } from '../shared/gcal-todo-store.ts';
import { TodoStore } from '../shared/todo-store.ts';
import { type ApiResult, classifyApi } from './gcal-auth.ts';
import { syncPass } from './gcal-sync.ts';
import {
  type AnyApi,
  accountFingerprint,
  calendarGone,
  deleteCalendar,
  ensureFairyCalendar,
  fairyCalendarBody,
  fairyState,
  listEffects,
  removeExtraFairy,
  removeSentTodos,
} from './gcal-todo-cal.ts';
import { ensureTables } from './sync/rows.ts';

const NOW = Date.UTC(2026, 9, 10, 0);
const TZ = 'Asia/Seoul';
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ME = 'me@gmail.com';

const res = (status: number, json?: unknown): ApiResult => ({
  kind: classifyApi(status, json),
  status,
  json,
});

interface FakeCal {
  summary: string;
  description?: string;
  timeZone?: string;
  role: 'owner' | 'writer';
  events: Map<string, Record<string, unknown>>;
}

/** 구글 흉내: 캘린더 목록, 만들기와 지우기, 일정 넣기, 고치기, 옮기기, 지우기 */
function fakeGoogle() {
  const cals = new Map<string, FakeCal>();
  const calls: string[] = [];
  const bodies: { path: string; body: unknown }[] = [];
  const forced: (ApiResult | Error)[] = [];
  /** 만들기 직후 부르는 것 (다른 컴퓨터가 동시에 만든 것을 흉내) */
  const hooks = { afterInsert: undefined as undefined | (() => void) };
  let nextId = 'zzz-mine@group.calendar.google.com';
  const add = (id: string, c: Partial<FakeCal> & { summary: string }) =>
    cals.set(id, { role: 'owner', events: new Map(), ...c });
  add('primary', { summary: ME });
  const fairy = (id: string) =>
    add(id, { summary: '페어리 할 일', description: `${FAIRY_MARKER}\n설명`, role: 'owner' });

  const listJson = () => ({
    items: [...cals.entries()].map(([id, c]) => ({
      id: id === 'primary' ? ME : id,
      summary: c.summary,
      ...(c.description === undefined ? {} : { description: c.description }),
      accessRole: c.role,
      ...(id === 'primary' ? { primary: true } : {}),
    })),
  });

  const api: AnyApi = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (body !== undefined) bodies.push({ path, body });
    const f = forced.shift();
    if (f instanceof Error) throw f;
    if (f) return f;
    if (method === 'GET' && path.startsWith('/users/me/calendarList?')) return res(200, listJson());
    const one = /^\/users\/me\/calendarList\/([^/?]+)/.exec(path);
    if (method === 'GET' && one) {
      const id = decodeURIComponent(one[1] ?? '');
      return cals.has(id) ? res(200, { id }) : res(404, {});
    }
    if (method === 'POST' && path === '/calendars') {
      const b = body as { summary: string; description?: string; timeZone?: string };
      const id = nextId;
      add(id, { summary: b.summary, description: b.description, timeZone: b.timeZone });
      hooks.afterInsert?.();
      return res(200, { id });
    }
    const c = /^\/calendars\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && c) {
      const id = decodeURIComponent(c[1] ?? '');
      return cals.delete(id) ? res(204) : res(404, {});
    }
    const mv = /^\/calendars\/([^/]+)\/events\/([^/]+)\/move\?destination=(.+)$/.exec(path);
    if (mv) {
      const from = cals.get(decodeURIComponent(mv[1] ?? ''));
      const to = cals.get(decodeURIComponent(mv[3] ?? ''));
      const id = decodeURIComponent(mv[2] ?? '');
      const ev = from?.events.get(id);
      if (!from || !to || !ev) return res(404, {});
      from.events.delete(id);
      to.events.set(id, ev);
      return res(200, ev);
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    const cal = m && cals.get(decodeURIComponent(m[1] ?? ''));
    if (!m || !cal) return res(404, { error: { code: 404 } });
    const id = m[2] && decodeURIComponent(m[2]);
    if (method === 'POST') {
      const b = body as Record<string, unknown>;
      const nid = String(b.id);
      if (cal.events.has(nid)) return res(409, {});
      const ev = { ...b, iCalUID: `${nid}@google.com` };
      cal.events.set(nid, ev);
      return res(200, ev);
    }
    const ev = id ? cal.events.get(id) : undefined;
    if (!ev || !id) return res(404, {});
    if (method === 'PATCH') {
      const next = { ...ev, ...(body as Record<string, unknown>) };
      cal.events.set(id, next);
      return res(200, next);
    }
    cal.events.delete(id);
    return res(204);
  };
  return {
    cals,
    calls,
    bodies,
    forced,
    hooks,
    api,
    add,
    fairy,
    setNextId: (v: string) => {
      nextId = v;
    },
  };
}

const MINE = 'zzz-mine@group.calendar.google.com';
const SMALL = 'aaa-other@group.calendar.google.com';
const BIG = 'zzzz-big@group.calendar.google.com';

const ensure = (g: ReturnType<typeof fakeGoogle>, canCreate = true, lang: 'ko' | 'en' = 'ko') =>
  ensureFairyCalendar({ api: g.api, lang, tz: TZ, canCreate });

// ---- 순수한 것 ----

test('목록 칸에 description 이 있고, 표식은 설명 첫 줄과 owner 일 때만 페어리 캘린더다', () => {
  assert.match(CALLIST_FIELDS, /\bdescription\b/);
  assert.equal(hasFairyMarker(`${FAIRY_MARKER}\n설명`), true);
  assert.equal(hasFairyMarker(`${FAIRY_MARKER}\r\n설명`), true);
  assert.equal(hasFairyMarker(FAIRY_MARKER), true);
  assert.equal(hasFairyMarker(`설명\n${FAIRY_MARKER}`), false);
  assert.equal(hasFairyMarker(`${FAIRY_MARKER}x`), false);
  assert.equal(hasFairyMarker(undefined), false);
  const list = parseCalendarList([
    { id: 'a@group.calendar.google.com', summary: '내것', accessRole: 'owner', description: FAIRY_MARKER },
    {
      id: 'b@group.calendar.google.com',
      summary: '남이 공유',
      accessRole: 'writer',
      description: FAIRY_MARKER,
    },
    { id: 'c@group.calendar.google.com', summary: '이름만', accessRole: 'owner', description: '메모' },
    { id: ME, summary: ME, accessRole: 'owner', primary: true, description: FAIRY_MARKER },
  ]);
  assert.deepEqual(
    list.filter((c) => c.fairy).map((c) => c.id),
    ['a@group.calendar.google.com'],
  );
  // 설명 글은 저장하지 않는다
  assert.ok(list.every((c) => !('description' in c)));
  // 설정 파일에 두었다가 다시 읽어도 표식이 남는다
  assert.deepEqual(cleanCalendars(JSON.parse(JSON.stringify(list))), list);
});

test('정본은 id 가 사전순으로 가장 작은 것이고 나머지는 남는 것이다', () => {
  const cal = (id: string): GcalCalendar => ({
    id,
    name: id,
    color: null,
    role: 'owner',
    primary: false,
    fairy: true,
  });
  const list = [cal('m@x.com'), cal('b@x.com'), cal('z@x.com')];
  assert.equal(canonicalFairy(list), 'b@x.com');
  assert.deepEqual(extraFairy(list), ['m@x.com', 'z@x.com']);
  assert.equal(canonicalFairy([]), null);
  assert.equal(canonicalFairy(null), null);
  assert.deepEqual(extraFairy([cal('only@x.com')]), []);
});

test('계정 지문은 기본 캘린더 id 의 sha256 이고 대소문자와 공백에 흔들리지 않는다', () => {
  const fp = accountFingerprint(ME);
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(accountFingerprint(' ME@gmail.com '), fp);
  assert.notEqual(accountFingerprint('other@gmail.com'), fp);
  assert.ok(!fp.includes('gmail'));
});

const prefsOf = (o: Partial<GcalTodoPrefs> = {}): GcalTodoPrefs => ({
  on: true,
  target: 'fairy',
  calendarId: SMALL,
  ...o,
});
const fcal = (id: string): GcalCalendar => ({
  id,
  name: id,
  color: null,
  role: 'owner',
  primary: false,
  fairy: true,
});

test('목록 효과: 지문 채우기, 같은 계정, 다른 계정', () => {
  const calendars = [fcal(SMALL)];
  const fill = listEffects({ calendars, primaryId: ME, account: null, todos: prefsOf() });
  assert.deepEqual([fill.account, fill.accountChanged], [accountFingerprint(ME), false]);
  const same = listEffects({ calendars, primaryId: ME, account: accountFingerprint(ME), todos: prefsOf() });
  assert.equal(same.accountChanged, false);
  const other = listEffects({
    calendars,
    primaryId: 'x@gmail.com',
    account: accountFingerprint(ME),
    todos: prefsOf(),
  });
  assert.deepEqual([other.accountChanged, other.account], [true, accountFingerprint('x@gmail.com')]);
  // 다른 계정이면 올릴 캘린더가 비워진 것으로 보니 옮기기나 없어짐 판정이 나오지 않는다
  assert.deepEqual([other.moveTo, other.gone], [null, false]);
  // 기본 캘린더를 못 찾으면 지금 지문을 그대로 둔다
  const keep = listEffects({ calendars, primaryId: null, account: accountFingerprint(ME), todos: prefsOf() });
  assert.deepEqual([keep.account, keep.accountChanged], [accountFingerprint(ME), false]);
});

test('목록 효과: 정본이 바뀌면 옮기기, 없어지면 gone, 기존 캘린더를 쓰면 건드리지 않는다', () => {
  const two = [fcal(BIG), fcal(SMALL)];
  const moved = listEffects({
    calendars: two,
    primaryId: ME,
    account: accountFingerprint(ME),
    todos: prefsOf({ calendarId: BIG }),
  });
  assert.deepEqual([moved.moveTo, moved.canonical, moved.extras, moved.gone], [SMALL, SMALL, [BIG], false]);
  const stay = listEffects({
    calendars: two,
    primaryId: ME,
    account: null,
    todos: prefsOf({ calendarId: SMALL }),
  });
  assert.deepEqual([stay.moveTo, stay.gone], [null, false]);
  const gone = listEffects({ calendars: [], primaryId: ME, account: null, todos: prefsOf() });
  assert.deepEqual([gone.gone, gone.moveTo], [true, null]);
  const pick = listEffects({
    calendars: two,
    primaryId: ME,
    account: null,
    todos: prefsOf({ target: 'pick', calendarId: 'primary' }),
  });
  assert.deepEqual([pick.moveTo, pick.gone], [null, false]);
  // 올릴 캘린더를 아직 안 정했으면 저절로 정하지 않는다
  const none = listEffects({
    calendars: two,
    primaryId: ME,
    account: null,
    todos: prefsOf({ calendarId: null }),
  });
  assert.deepEqual([none.moveTo, none.gone], [null, false]);
});

test('창에 보일 페어리 캘린더 상태', () => {
  const cals = [fcal(SMALL)];
  assert.equal(
    fairyState({ calendars: null, todos: prefsOf({ target: 'pick', calendarId: null }) }),
    'unknown',
  );
  assert.equal(fairyState({ calendars: [], todos: prefsOf({ target: 'pick', calendarId: null }) }), 'none');
  assert.equal(
    fairyState({ calendars: cals, todos: prefsOf({ target: 'pick', calendarId: null }) }),
    'ready',
  );
  assert.equal(fairyState({ calendars: cals, todos: prefsOf() }), 'ready');
  assert.equal(fairyState({ calendars: [], todos: prefsOf() }), 'gone');
  assert.equal(fairyState({ calendars: cals, todos: prefsOf({ calendarId: null, on: true }) }), 'gone');
  assert.equal(fairyState({ calendars: cals, todos: prefsOf({ calendarId: null, on: false }) }), 'none');
  assert.equal(
    fairyState({ calendars: cals, todos: prefsOf({ calendarId: null, on: false }), lost: true }),
    'gone',
  );
});

test('만들 캘린더의 몸: 앱 언어 이름, 설명 첫 줄이 표식, 이 컴퓨터 시간대', () => {
  const ko = fairyCalendarBody('ko', TZ);
  assert.equal(ko.summary, '페어리 할 일');
  assert.equal(ko.timeZone, TZ);
  assert.equal(ko.description.split('\n')[0], FAIRY_MARKER);
  assert.equal(fairyCalendarBody('en', TZ).summary, 'fairy to-dos');
});

// ---- 찾기와 만들기 ----

test('없으면 새로 만든다: POST /calendars 몸, 만든 뒤 목록을 다시 읽어 확인', async () => {
  const g = fakeGoogle();
  const r = await ensure(g);
  assert.ok(r.ok);
  assert.deepEqual([r.calendarId, r.created], [MINE, true]);
  const post = g.bodies.find((b) => b.path === '/calendars');
  assert.deepEqual(post?.body, fairyCalendarBody('ko', TZ));
  assert.equal(g.calls.filter((c) => c.startsWith('GET /users/me/calendarList?')).length, 2);
  assert.ok(r.calendars.some((c) => c.id === MINE && c.fairy));
  assert.equal(r.primaryId, ME);
  const en = fakeGoogle();
  await ensure(en, true, 'en');
  const enBody = en.bodies.find((b) => b.path === '/calendars')?.body as { summary: string } | undefined;
  assert.equal(enBody?.summary, 'fairy to-dos');
});

test('이미 있으면 만들지 않고 그것을 쓴다 (새 권한 없이도)', async () => {
  const g = fakeGoogle();
  g.fairy(BIG);
  const r = await ensure(g, false);
  assert.ok(r.ok);
  assert.deepEqual([r.calendarId, r.created], [BIG, false]);
  assert.ok(!g.calls.some((c) => c.startsWith('POST')));
});

test('남이 공유한 표식 캘린더(owner 가 아님)는 없는 것으로 본다', async () => {
  const g = fakeGoogle();
  g.add(SMALL, { summary: '공유', description: FAIRY_MARKER, role: 'writer' });
  const r = await ensure(g);
  assert.ok(r.ok && r.created);
  assert.equal(r.calendarId, MINE);
});

test('없는데 만들 권한이 아직 없으면 만들지 않고 needApp', async () => {
  const g = fakeGoogle();
  assert.deepEqual(await ensure(g, false), { ok: false, stop: 'needApp', where: 'create' });
  assert.ok(!g.calls.some((c) => c.startsWith('POST')));
});

test('동시에 만들어 둘이 되면: 내 것이 더 크면 방금 만든 내 것을 지우고 작은 쪽을 쓴다', async () => {
  const g = fakeGoogle();
  g.hooks.afterInsert = () => g.fairy(SMALL);
  const r = await ensure(g);
  assert.ok(r.ok);
  assert.deepEqual([r.calendarId, r.created], [SMALL, false]);
  assert.ok(g.calls.includes(`DELETE /calendars/${encodeURIComponent(MINE)}`));
  assert.ok(!g.cals.has(MINE));
  assert.ok(!r.calendars.some((c) => c.id === MINE));
  assert.deepEqual(extraFairy(r.calendars), []);
});

test('동시에 만들었어도 내 것이 더 작으면 내 것을 지키고 상대 것은 건드리지 않는다', async () => {
  const g = fakeGoogle();
  g.setNextId(SMALL);
  g.hooks.afterInsert = () => g.fairy(BIG);
  const r = await ensure(g);
  assert.ok(r.ok);
  assert.deepEqual([r.calendarId, r.created], [SMALL, true]);
  assert.ok(g.cals.has(BIG));
  assert.ok(!g.calls.some((c) => c.startsWith('DELETE')));
  assert.deepEqual(extraFairy(r.calendars), [BIG]);
});

test('만든 뒤 다시 읽기가 안 되면 실패로 끝내고, 다음에 만든 것을 있는 것으로 찾는다 (겹쳐 만들지 않는다)', async () => {
  const g = fakeGoogle();
  g.hooks.afterInsert = () => {
    g.forced.push(res(503, {}));
  };
  const r = await ensure(g);
  assert.deepEqual(r, { ok: false, stop: 'offline', where: 'list' });
  assert.ok(g.cals.has(MINE));
  g.calls.length = 0;
  const again = await ensure(g);
  assert.ok(again.ok && !again.created);
  assert.equal(again.calendarId, MINE);
  assert.ok(!g.calls.some((c) => c.startsWith('POST')));
});

test('만들기가 거절되면 까닭을 구분한다: 권한, 인터넷, 그 밖', async () => {
  const g = fakeGoogle();
  g.forced.push(
    res(200, { items: [] }),
    res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }),
  );
  assert.deepEqual(await ensure(g), { ok: false, stop: 'scope', where: 'create' });
  g.forced.push(res(200, { items: [] }), new Error('net'));
  assert.deepEqual(await ensure(g), { ok: false, stop: 'offline', where: 'create' });
  g.forced.push(res(200, { items: [] }), res(400, {}));
  assert.deepEqual(await ensure(g), { ok: false, stop: 'failed', where: 'create' });
  // 목록 권한이 없으면 list 쪽 scope
  g.forced.push(res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.deepEqual(await ensure(g), { ok: false, stop: 'scope', where: 'list' });
});

// ---- 남는 것 지우기, 없어짐 ----

test('남는 것 지우기: 정본은 두고 나머지 표식 캘린더만 지운다', async () => {
  const g = fakeGoogle();
  g.fairy(SMALL);
  g.fairy(MINE);
  g.fairy(BIG);
  g.add('family@group.calendar.google.com', { summary: '가족' });
  const list = await ensure(g, false);
  assert.ok(list.ok);
  const r = await removeExtraFairy({ api: g.api, calendars: list.calendars });
  assert.deepEqual(r, { deleted: [MINE, BIG], stop: null });
  assert.deepEqual([...g.cals.keys()].sort(), [SMALL, 'family@group.calendar.google.com', 'primary']);
});

test('남는 것 지우기가 권한 때문에 막히면 거기서 멈추고 그 전에 지운 것만 알린다', async () => {
  const g = fakeGoogle();
  g.fairy(SMALL);
  g.fairy(MINE);
  g.fairy(BIG);
  const list = await ensure(g, false);
  assert.ok(list.ok);
  g.forced.push(res(204), res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  const r = await removeExtraFairy({ api: g.api, calendars: list.calendars });
  assert.deepEqual(r, { deleted: [MINE], stop: 'scope' });
  assert.ok(g.cals.has(BIG));
});

test('캘린더가 구글에서 없어졌는지는 calendarList.get 이 404 일 때만 없어진 것이다', async () => {
  const g = fakeGoogle();
  g.fairy(SMALL);
  assert.equal(await calendarGone(g.api, SMALL), false);
  g.cals.delete(SMALL);
  assert.equal(await calendarGone(g.api, SMALL), true);
  g.forced.push(res(500, {}));
  assert.equal(await calendarGone(g.api, SMALL), false);
  g.forced.push(new Error('net'));
  assert.equal(await calendarGone(g.api, SMALL), false);
});

// ---- 저장 파일과 같이 ----

function setup() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  ensureTables(db);
  const todos = new TodoStore(db, utcDay);
  const store = new GcalTodoStore(db);
  const g = fakeGoogle();
  const backoff = new GcalBackoff(() => 0);
  let n = 0;
  const pass = (calendarId: string) =>
    syncPass({
      store,
      backoff,
      api: g.api,
      newId: () => `${GCAL_TODO_ID_PREFIX}${String(++n).padStart(5, '0')}`,
      now: () => NOW,
      calendarId,
      tz: TZ,
    });
  return { db, todos, store, g, pass, backoff };
}

test('정본이 바뀌면 이미 올린 할 일이 events.move 로 새 정본으로 옮겨진다', async () => {
  const { todos, g, pass, db } = setup();
  g.fairy(BIG);
  g.fairy(SMALL);
  const a = todos.add({ title: '가', due: '2026-10-12' }, NOW);
  const b = todos.add({ title: '나', due: '2026-10-13', dueMin: 600 }, NOW);
  assert.equal((await pass(BIG)).sent, 2);
  assert.equal(g.cals.get(BIG)?.events.size, 2);
  // 목록을 다시 읽었더니 정본이 SMALL 이다
  const list = await ensure(g, false);
  assert.ok(list.ok);
  const eff = listEffects({
    calendars: list.calendars,
    primaryId: ME,
    account: null,
    todos: prefsOf({ calendarId: BIG }),
  });
  assert.equal(eff.moveTo, SMALL);
  g.calls.length = 0;
  const r = await pass(eff.moveTo ?? '');
  assert.deepEqual([r.sent, r.stop], [2, null]);
  assert.equal(g.cals.get(BIG)?.events.size, 0);
  assert.equal(g.cals.get(SMALL)?.events.size, 2);
  assert.equal(g.calls.filter((c) => c.includes('/move?destination=')).length, 2);
  const cal = (id: number) =>
    (db.prepare('select google_cal from todo where id = ?').get(id) as { google_cal: string }).google_cal;
  assert.deepEqual([cal(a.id), cal(b.id)], [SMALL, SMALL]);
});

test('페어리 캘린더가 구글에서 지워졌으면: 보내기는 calendar 로 멈추고 없어짐을 알 수 있다. 저절로 만들지 않는다', async () => {
  const { todos, g, pass, store } = setup();
  g.fairy(SMALL);
  todos.add({ title: '가', due: '2026-10-12' }, NOW);
  assert.equal((await pass(SMALL)).sent, 1);
  g.cals.delete(SMALL);
  todos.add({ title: '나', due: '2026-10-13' }, NOW);
  g.calls.length = 0;
  const r = await pass(SMALL);
  assert.equal(r.stop, 'calendar');
  assert.equal(await calendarGone(g.api, SMALL), true);
  assert.ok(!g.calls.some((c) => c.startsWith('POST /calendars ') || c === 'POST /calendars'));
  // 보낸 기록 되돌리기 (gcal.ts 가 부른다): 올린 수가 0 으로
  store.resetSent();
  assert.equal(store.sentCount(), 0);
  // 목록으로 보면 없어진 것으로 판정
  const list = await ensure(g, false).catch(() => null);
  assert.ok(list);
  const eff = listEffects({ calendars: [], primaryId: ME, account: null, todos: prefsOf() });
  assert.equal(eff.gone, true);
});

test('기존 캘린더 쪽 올린 할 일 지우기: 올린 일정만 지우고 기록을 비운다. 다시 켜면 새로 올라간다', async () => {
  const { todos, g, pass, store, db } = setup();
  g.add('family@group.calendar.google.com', { summary: '가족' });
  const a = todos.add({ title: '가', due: '2026-10-12' }, NOW);
  todos.add({ title: '나', due: '2026-10-13' }, NOW);
  assert.equal((await pass('primary')).sent, 2);
  // 사용자가 직접 넣은 일정은 건드리지 않는다
  g.cals.get('primary')?.events.set('mine-own', { summary: '내 일정' });
  const r = await removeSentTodos({ store, api: g.api, fallbackCal: 'primary', now: () => NOW });
  assert.deepEqual(r, { removed: 2, left: 0, stop: null });
  assert.deepEqual([...(g.cals.get('primary')?.events.keys() ?? [])], ['mine-own']);
  assert.equal(store.sentCount(), 0);
  assert.equal(count(db, 'select count(*) as n from todo where google_id is not null'), 0);
  assert.equal(count(db, 'select count(*) as n from gcal_tomb'), 0);
  // 할 일 자체는 그대로, 다시 켜면 다시 올라간다
  assert.equal(count(db, 'select count(*) as n from todo where deleted_at is null'), 2);
  const again = await pass('primary');
  assert.equal(again.sent, 2);
  assert.equal(todos.get(a.id)?.title, '가');
});

const count = (db: Db, sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);

test('올린 할 일 지우기가 인터넷 때문에 멈추면 무덤에 남아 다음에 이어서 지운다', async () => {
  const { todos, g, pass, store, db } = setup();
  for (const d of ['10', '11', '12']) todos.add({ title: `할${d}`, due: `2026-10-${d}` }, NOW);
  assert.equal((await pass('primary')).sent, 3);
  g.forced.push(res(204), res(503, {}));
  const first = await removeSentTodos({ store, api: g.api, fallbackCal: 'primary', now: () => NOW });
  assert.deepEqual([first.removed, first.left, first.stop], [1, 2, 'offline']);
  assert.equal(count(db, 'select count(*) as n from gcal_tomb'), 2);
  const second = await removeSentTodos({ store, api: g.api, fallbackCal: 'primary', now: () => NOW });
  assert.deepEqual(second, { removed: 2, left: 0, stop: null });
});

test('그 캘린더에 쓸 수 없는 줄은 건너뛰고 나머지를 지운다', async () => {
  const { todos, g, pass, store } = setup();
  for (const d of ['10', '11']) todos.add({ title: `할${d}`, due: `2026-10-${d}` }, NOW);
  await pass('primary');
  g.forced.push(res(403, { error: { errors: [{ reason: 'forbidden' }] } }));
  const r = await removeSentTodos({ store, api: g.api, fallbackCal: 'primary', now: () => NOW });
  assert.deepEqual([r.removed, r.left, r.stop], [1, 1, null]);
});

test('페어리 캘린더 지우기: 캘린더째 지우고, 이미 없어도 지운 것으로, 권한이 없으면 scope', async () => {
  const g = fakeGoogle();
  g.fairy(SMALL);
  g.cals.get(SMALL)?.events.set('jjt1', { summary: 'x' });
  assert.deepEqual(await deleteCalendar(g.api, SMALL), { ok: true });
  assert.ok(!g.cals.has(SMALL));
  assert.deepEqual(await deleteCalendar(g.api, SMALL), { ok: true });
  g.forced.push(res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.deepEqual(await deleteCalendar(g.api, SMALL), { ok: false, stop: 'scope' });
  g.forced.push(new Error('net'));
  assert.deepEqual(await deleteCalendar(g.api, SMALL), { ok: false, stop: 'offline' });
});
