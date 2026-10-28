import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../shared/i18n/index.ts';
import type { ServerStatus } from '../shared/server-account.ts';
import { busyByDay, friendCodeFrom, inviteLink, titlesByDay } from '../shared/server-friends.ts';
import { parseJjUrl } from '../shared/url-scheme.ts';
import { friendsListOf, inboxItemOf } from './server-api.ts';
import type { ServerCore } from './server-core.ts';
import {
  type BusySource,
  busyBlocks,
  createServerFriends,
  SHARE_GOOGLE_EVENTS,
  shareableEvent,
  shareableTitle,
  titledBlocks,
} from './server-friends.ts';
import { createServerInbox, inboxLines, inboxTitle } from './server-inbox.ts';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 16, 1);

test('친구 코드: 코드 그대로, 소문자, 붙임표 없이, 초대 링크, 앱 주소에서 찾는다', () => {
  assert.equal(friendCodeFrom('F-AB12-CD34'), 'F-AB12-CD34');
  assert.equal(friendCodeFrom('  fab12cd34 '), 'F-AB12-CD34');
  assert.equal(friendCodeFrom('https://fairy.moilga.com/f/F-AB12-CD34/'), 'F-AB12-CD34');
  assert.equal(friendCodeFrom('https://fairy.moilga.com/f/F-AB12-CD34?x=1'), 'F-AB12-CD34');
  assert.equal(friendCodeFrom('fairy://friend/F-AB12-CD34'), 'F-AB12-CD34');
  assert.equal(friendCodeFrom('hello'), undefined);
  assert.equal(friendCodeFrom('x'.repeat(400)), undefined);
  assert.equal(inviteLink('F-AB12-CD34'), 'https://fairy.moilga.com/f/F-AB12-CD34/');
});

test('fairy://friend/<코드> 는 친구 동작, 다른 칸이나 틀린 코드는 거절', () => {
  assert.deepEqual(parseJjUrl('fairy://friend/F-AB12-CD34'), {
    ok: true,
    value: { action: 'friend', code: 'F-AB12-CD34' },
  });
  assert.deepEqual(parseJjUrl('fairy://friend/fab12cd34/'), {
    ok: true,
    value: { action: 'friend', code: 'F-AB12-CD34' },
  });
  assert.equal(parseJjUrl('fairy://friend/F-AB12-CD34?text=x').ok, false);
  assert.equal(parseJjUrl('fairy://friend/zzz').ok, false);
  assert.equal(parseJjUrl('fairy://friend').ok, false);
  assert.equal(parseJjUrl('fairy://friend/%E0%A4%A').ok, false);
});

test('바쁜 시간대: 14일 안으로 자르고 겹친 것은 합치며 제목은 없다, 끝이 없으면 30분', () => {
  const b = busyBlocks(
    [
      { startAt: T0 + H, endAt: T0 + 2 * H },
      { startAt: T0 + 90 * 60_000, endAt: T0 + 3 * H },
      { startAt: T0 + 5 * H, endAt: null },
      { startAt: T0 - 2 * H, endAt: T0 + 30 * 60_000 },
      { startAt: T0 + 20 * 24 * H, endAt: T0 + 20 * 24 * H + H },
    ],
    T0,
  );
  assert.deepEqual(b, [
    { start: T0, end: T0 + 30 * 60_000 },
    { start: T0 + H, end: T0 + 3 * H },
    { start: T0 + 5 * H, end: T0 + 5 * H + 30 * 60_000 },
  ]);
  for (const x of b) assert.deepEqual(Object.keys(x).sort(), ['end', 'start']);
});

test('바쁜 시간대를 날마다 나눈다 (자정을 넘는 것은 두 날에)', () => {
  const now = new Date(2026, 9, 16, 9).getTime();
  const mid = new Date(2026, 9, 16, 23).getTime();
  const days = busyByDay([{ start: mid, end: mid + 2 * H }], now, 7);
  assert.equal(days.length, 7);
  assert.deepEqual(days[0]?.spans, [{ from: 23 * 60, to: 24 * 60 }]);
  assert.deepEqual(days[1]?.spans, [{ from: 0, to: 60 }]);
  assert.deepEqual(days[2]?.spans, []);
});

test('서버 대답 읽기: 친구 목록과 친구 쪽지 (옛 앱이 모르는 모양은 버린다)', () => {
  const l = friendsListOf({
    me: { code: 'F-AB12-CD34', nickname: '나' },
    friends: [
      { code: 'F-0000-1111', nickname: '콩', since: '2026-10-16T00:00:00Z', iShare: true, theyShare: false },
      { code: 'bad', since: '2026-10-16T00:00:00Z' },
    ],
    incoming: [
      {
        id: 3,
        code: 'F-2222-3333',
        nickname: null,
        sentAt: '2026-10-16T00:00:00Z',
        expiresAt: '2026-10-30T00:00:00Z',
      },
    ],
    outgoing: [],
    blocked: [{ code: 'F-4444-5555', nickname: 'x' }],
    limits: { friends: 100 },
    today: { coins: 30 },
  });
  assert.ok(l);
  assert.equal(l.friends.length, 1);
  assert.equal(l.friends[0]?.iShare, true);
  assert.equal(l.incoming[0]?.id, 3);
  assert.equal(l.limits.giftCoinsPerDay, 500);
  assert.deepEqual(l.today, { coins: 30, passes: 0 });
  assert.equal(friendsListOf({}), undefined);

  const gift = inboxItemOf({
    id: 9,
    kind: 'gift',
    from: 'friend',
    sender: { code: 'F-0000-1111', nickname: '콩' },
    coins: 50,
    chatPasses: 1,
    sentAt: '2026-10-16T00:00:00Z',
  });
  assert.ok(gift);
  setLang('ko');
  assert.equal(inboxTitle(gift), '친구가 보낸 선물');
  assert.ok(inboxLines(gift).some((x) => x.includes('콩')));
  const left = inboxItemOf({ id: 10, kind: 'friend', sender: { code: null, nickname: null } });
  assert.ok(left);
  assert.equal(left.sender?.code, null);
  assert.ok(inboxLines(left)[0]?.includes('떠난 친구'));
  setLang('en');
  assert.ok(!/[가-힣]/.test(inboxLines(left).join(' ')), '영어판에 한글이 없다');
  setLang('ko');
  assert.equal(inboxItemOf({ id: 11, kind: 'party' }), undefined);
});

/** 서버 코어 흉내: 로그인, 기능 키, sessionCall 이 부른 경로를 적는다 */
function fakeCore(o: {
  features?: Record<string, boolean>;
  signedIn?: boolean;
  replies?: Record<string, unknown>;
}) {
  const calls: string[] = [];
  const status = {
    signedIn: o.signedIn ?? true,
    features: o.features ?? { friends: true, friend_gifts: true, friend_calendar: true },
    age: 'adult',
    ai: false,
    balance: 100,
    tickets: null,
  } as unknown as ServerStatus;
  const reply = (name: string) => o.replies?.[name];
  const api = new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        async (_token: string, ...args: unknown[]) => {
          calls.push(`${name} ${JSON.stringify(args)}`);
          const r = reply(name);
          return r === undefined ? { ok: true, status: 200, data: {} } : r;
        },
    },
  );
  const core = {
    status: () => status,
    allowed: () => true,
    sessionCall: (f: (api: unknown, s: string) => Promise<unknown>) => f(api, 'fs_x'),
    run: async () => {
      calls.push('run');
    },
    refreshTickets: async () => {
      calls.push('refreshTickets');
    },
  } as unknown as ServerCore;
  return { core, calls, status };
}

const LIST = {
  ok: true,
  status: 200,
  data: {
    me: { code: 'F-AB12-CD34', nickname: '나' },
    friends: [
      { code: 'F-0000-1111', nickname: '콩', since: '', iShare: true, theyShare: false, busyAt: null },
    ],
    incoming: [],
    outgoing: [],
    blocked: [],
    limits: { friends: 100, giftCoinsPerDay: 500, giftPassesPerDay: 5, requestDays: 14, busyDays: 14 },
    today: { coins: 0, passes: 0 },
  },
};

test('친구 기능이 꺼졌거나 로그인하지 않았으면 칸을 숨기고 아무것도 보내지 않는다', async () => {
  for (const f of [fakeCore({ features: { friends: false } }), fakeCore({ signedIn: false })]) {
    const friends = createServerFriends({
      core: () => f.core,
      events: () => [],
      now: () => T0,
      onChange: () => {},
      log: () => {},
    });
    assert.equal(friends.state().available, false);
    await friends.refresh();
    assert.equal((await friends.request('F-0000-1111')).ok, false);
    await friends.uploadBusy(true);
    assert.deepEqual(f.calls, []);
  }
});

test('신청은 모양이 맞는 코드만 보내고, 일정은 공유하는 친구가 있을 때 직접 넣은 일정의 시작과 끝만 올린다', async () => {
  const f = fakeCore({ replies: { friends: LIST } });
  const list: BusySource[] = [
    { startAt: T0 + H, endAt: T0 + 2 * H, source: 'local' },
    // 구글에서 읽어 온 일정과 캘린더 주소로 가져온 일정은 보내지 않는다 (Limited Use 확인 전)
    { startAt: T0 + 5 * H, endAt: T0 + 6 * H, source: 'google' },
    { startAt: T0 + 8 * H, endAt: T0 + 9 * H, source: 'ics' },
  ];
  const friends = createServerFriends({
    core: () => f.core,
    events: () => list,
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  assert.deepEqual(await friends.request('nope'), { ok: false, error: 'code' });
  await friends.refresh();
  assert.equal(friends.state().list?.friends.length, 1);
  await friends.uploadBusy();
  const up = f.calls.find((c) => c.startsWith('busyUpload'));
  assert.ok(up, f.calls.join('\n'));
  assert.ok(up.includes(`"start":${T0 + H}`));
  assert.ok(!up.includes(`${T0 + 5 * H}`), '구글 일정은 빠진다');
  assert.ok(!up.includes(`${T0 + 8 * H}`), '가져온 일정은 빠진다');
  assert.ok(!/title/.test(up));
  // 같은 내용이면 다시 올리지 않는다
  const n = f.calls.length;
  await friends.uploadBusy();
  assert.equal(f.calls.length, n);
  // 구글 일정만 바뀌면 보낼 것이 같아 다시 올리지 않는다
  list.push({ startAt: T0 + 10 * H, endAt: T0 + 11 * H, source: 'google' });
  await friends.uploadBusy();
  assert.equal(f.calls.length, n);
  assert.equal(SHARE_GOOGLE_EVENTS, false);
  assert.equal(shareableEvent({ source: 'google' }, true), true, '나중에 따로 켜는 설정이 생기면');
});

test('선물: 끊겨 답을 못 받으면 같은 요청 번호로 한 번 더, 되면 맞추기', async () => {
  let n = 0;
  const f = fakeCore({ replies: { friends: LIST } });
  const core = f.core as unknown as {
    sessionCall: (fn: (api: unknown, s: string) => Promise<unknown>) => unknown;
  };
  const ids: string[] = [];
  core.sessionCall = async (fn) =>
    fn(
      {
        friendGift: async (_t: string, o: { requestId: string }) => {
          ids.push(o.requestId);
          n++;
          return n === 1
            ? { ok: false, status: 0, error: 'offline', body: {} }
            : { ok: true, status: 200, data: { balance: 50, chatPasses: 0, coins: 50, passes: 0 } };
        },
        friends: async () => LIST,
      },
      'fs_x',
    );
  const friends = createServerFriends({
    core: () => f.core,
    events: () => [],
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  const r = await friends.gift('F-0000-1111', 50, 0);
  assert.deepEqual(r, { ok: true, data: { coins: 50, passes: 0 } });
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.ok(f.calls.includes('run'));
});

test('칸이 숨은 때 받기가 바로 끝나도 다음 받기는 돈다 (끝난 약속이 남지 않는다)', async () => {
  const f = fakeCore({ features: { friends: false }, replies: { friends: LIST } });
  const friends = createServerFriends({
    core: () => f.core,
    events: () => [],
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  await friends.refresh();
  (f.status as unknown as { features: Record<string, boolean> }).features = { friends: true };
  await friends.refresh();
  assert.equal(friends.state().list?.friends.length, 1);

  // 쪽지함도 같다: 서버 모드가 아닐 때 한 번 불린 뒤에도 켜면 받는다
  let allowed = false;
  let calls = 0;
  const inbox = createServerInbox({
    core: () =>
      ({
        allowed: () => allowed,
        inbox: async () => {
          calls++;
          return { items: [], next: null, unopened: 0 };
        },
      }) as unknown as ServerCore,
    say: async () => undefined,
    react: () => {},
    canTalk: () => false,
    onChange: () => {},
    onGot: () => {},
    log: () => {},
  });
  await inbox.refresh();
  allowed = true;
  await inbox.refresh();
  assert.equal(calls, 1);
});

test('쪽지를 열 때 410 이 받을 수 없게 된 것이면 돌려줬다고 말하고, 기한 만료면 기한 문구', async () => {
  const said: string[] = [];
  let error = 'ineligible';
  const inbox = createServerInbox({
    core: () =>
      ({
        allowed: () => true,
        inbox: async () => ({ items: [], next: null, unopened: 0 }),
        openInbox: async () => ({ ok: false, status: 410, error, body: {} }),
      }) as unknown as ServerCore,
    say: async (s) => {
      said.push(s.text ?? '');
      return undefined;
    },
    react: () => {},
    canTalk: () => false,
    onChange: () => {},
    onGot: () => {},
    log: () => {},
  });
  await inbox.open('inbox:7');
  error = 'expired';
  await inbox.open('inbox:7');
  assert.ok(said[0]?.includes('돌려줬어'), String(said[0]));
  assert.ok(said[1]?.includes('기한'), String(said[1]));
});

const TITLE_LIST = (iTitle: boolean) => ({
  ...LIST,
  data: {
    ...LIST.data,
    friends: [
      {
        code: 'F-0000-1111',
        nickname: '콩',
        since: '2026-10-16T00:00:00Z',
        iShare: true,
        theyShare: false,
        busyAt: null,
        canTitle: true,
        iTitle,
        theyTitle: false,
      },
    ],
  },
});

test('제목을 보내도 되는 일정: 직접 넣은 것만, 비공개 표시와 구글, 가져온 일정과 빈 제목은 뺀다', () => {
  const ok = { source: 'local' as const, title: '치과' };
  assert.equal(shareableTitle(ok), true);
  assert.equal(shareableTitle({ ...ok, private: true }), false, '비공개 일정은 제목 없이 바쁨만');
  assert.equal(shareableTitle({ ...ok, title: '  ' }), false);
  assert.equal(shareableTitle({ source: 'google', title: '치과' }), false, '구글 일정은 제목을 막아 둔다');
  assert.equal(shareableTitle({ source: 'ics', title: '치과' }), false);
});

test('제목 있는 일정: 14일 안으로 자르고 합치지 않으며 한 줄로 다듬어 80자까지', () => {
  const b = titledBlocks(
    [
      { startAt: T0 + H, endAt: T0 + 2 * H, source: 'local', title: '치과 진료' },
      { startAt: T0 + 90 * 60_000, endAt: T0 + 3 * H, source: 'local', title: '줄\n바꿈' },
      { startAt: T0 + 4 * H, endAt: null, source: 'local', title: '가'.repeat(120) },
      { startAt: T0 + 5 * H, endAt: T0 + 6 * H, source: 'local', title: '비공개', private: true },
      { startAt: T0 + 6 * H, endAt: T0 + 7 * H, source: 'google', title: '구글' },
      { startAt: T0 + 20 * 24 * H, endAt: T0 + 20 * 24 * H + H, source: 'local', title: '먼 일정' },
    ],
    T0,
  );
  assert.deepEqual(
    b.map((x) => x.title),
    ['치과 진료', '줄 바꿈', '가'.repeat(80)],
  );
  assert.equal(b[0]?.end, T0 + 2 * H);
  assert.equal(b[1]?.start, T0 + 90 * 60_000, '겹쳐도 합치지 않는다');
  assert.equal(b[2]?.end, T0 + 4 * H + 30 * 60_000, '끝이 없으면 30분');
});

test('제목을 켠 친구가 없으면 제목은 서버로 나가지 않고(키 자체가 없다), 켠 친구가 있으면 제목과 함께 올린다', async () => {
  const list: BusySource[] = [
    { startAt: T0 + H, endAt: T0 + 2 * H, source: 'local', title: '치과 진료' },
    { startAt: T0 + 3 * H, endAt: T0 + 4 * H, source: 'local', title: '개인 약속', private: true },
  ];
  const off = fakeCore({ replies: { friends: TITLE_LIST(false) } });
  const a = createServerFriends({
    core: () => off.core,
    events: () => list,
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  await a.refresh();
  await a.uploadBusy();
  const up = off.calls.find((c) => c.startsWith('busyUpload')) ?? '';
  assert.ok(up.includes(`"start":${T0 + H}`), up);
  assert.ok(!up.includes('치과') && !up.includes('개인'), '제목이 나가지 않는다');
  assert.ok(up.endsWith(',null]'), `items 없음: ${up}`);

  const on = fakeCore({ replies: { friends: TITLE_LIST(true) } });
  const b = createServerFriends({
    core: () => on.core,
    events: () => list,
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  await b.refresh();
  await b.uploadBusy();
  const up2 = on.calls.find((c) => c.startsWith('busyUpload')) ?? '';
  assert.ok(up2.includes('"title":"치과 진료"'), up2);
  assert.ok(!up2.includes('개인 약속'), '비공개 일정의 제목은 나가지 않는다');
  // 비공개 일정의 시간은 바쁨으로 들어간다
  assert.ok(up2.includes(`"start":${T0 + 3 * H}`), up2);
});

test('일정 제목 켜기와 끄기: 서버 호출 뒤 목록을 받고 올린다. 모양이 틀린 제목 대답은 버린다', async () => {
  const f = fakeCore({ replies: { friends: TITLE_LIST(true) } });
  const friends = createServerFriends({
    core: () => f.core,
    events: () => [{ startAt: T0 + H, endAt: T0 + 2 * H, source: 'local', title: '치과 진료' }],
    now: () => T0,
    onChange: () => {},
    log: () => {},
  });
  assert.deepEqual(await friends.shareTitle('F-0000-1111', true), { ok: true, data: undefined });
  assert.ok(
    f.calls.some((c) => c.startsWith('friendShareTitle ["F-0000-1111",true]')),
    f.calls.join('\n'),
  );
  assert.ok(f.calls.some((c) => c.startsWith('busyUpload') && c.includes('치과 진료')));
  const l = friendsListOf(TITLE_LIST(true).data as unknown as Record<string, unknown>);
  assert.equal(l?.friends[0]?.iTitle, true);
  assert.equal(l?.friends[0]?.canTitle, true);
  // 옛 서버(칸이 없음)는 못 켜는 것으로 읽는다
  const old = friendsListOf({
    ...LIST.data,
    friends: [{ code: 'F-0000-1111', since: '2026-10-16T00:00:00Z' }],
  });
  assert.equal(old?.friends[0]?.canTitle, false);
  assert.equal(old?.friends[0]?.iTitle, false);
});

test('제목 있는 일정을 날마다 나눈다 (자정을 넘으면 두 날에)', () => {
  const now = new Date(2026, 9, 16, 9).getTime();
  const mid = new Date(2026, 9, 16, 23).getTime();
  const days = titlesByDay([{ start: mid, end: mid + 2 * H, title: '야식' }], now, 3);
  assert.deepEqual(days[0]?.items, [{ from: 23 * 60, to: 24 * 60, title: '야식' }]);
  assert.deepEqual(days[1]?.items, [{ from: 0, to: 60, title: '야식' }]);
  assert.deepEqual(days[2]?.items, []);
});

// ---- 펫 놀러 가기 (#141) ----

const VISIT_LIST = (iVisit: boolean, theyVisit = false) => ({
  ok: true,
  status: 200,
  data: {
    ...LIST.data,
    friends: [
      {
        code: 'F-0000-1111',
        nickname: '콩',
        since: '2026-10-16T00:00:00Z',
        iShare: false,
        theyShare: false,
        iVisit,
        theyVisit,
        busyAt: null,
      },
    ],
  },
});

const CARD = { species: 'kind:cat', name: '나비', stand: false } as const;
const visitDeps = (core: ServerCore, now: () => number) => ({
  core: () => core,
  events: () => [],
  now,
  card: () => CARD,
  onChange: () => {},
  log: () => {},
});

test('펫 카드: 놀러 갈 친구가 없으면 아무것도 올리지 않고, 켠 친구가 있으면 종류와 이름만 올리고, 내용이 같으면 6시간 뒤에야 다시 올린다', async () => {
  const none = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: { friends: VISIT_LIST(false) },
  });
  let now = T0;
  const a = createServerFriends(visitDeps(none.core, () => now));
  await a.refresh();
  await a.uploadCard();
  assert.equal(none.calls.filter((c) => c.startsWith('visitCard')).length, 0);

  const f = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: { friends: VISIT_LIST(true) },
  });
  const friends = createServerFriends(visitDeps(f.core, () => now));
  await friends.refresh();
  assert.equal(friends.state().visit, true);
  await friends.uploadCard();
  const ups = () => f.calls.filter((c) => c.startsWith('visitCard'));
  assert.equal(ups().length, 1);
  assert.equal(ups()[0], `visitCard [${JSON.stringify(CARD)}]`);
  assert.ok(!/data:|\.png|image/i.test(ups()[0] ?? ''));
  await friends.uploadCard();
  assert.equal(ups().length, 1, '같은 내용이라 다시 올리지 않는다');
  now += 6 * 3600_000 + 1;
  await friends.uploadCard();
  assert.equal(ups().length, 2);
});

test('놀러 가기 켜기: 서버 호출 뒤 목록을 받고 카드를 바로 올린다. 끄면 카드는 올리지 않는다', async () => {
  const f = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: { friends: VISIT_LIST(true) },
  });
  const friends = createServerFriends(visitDeps(f.core, () => T0));
  assert.deepEqual(await friends.visit('F-0000-1111', true), { ok: true, data: undefined });
  assert.ok(
    f.calls.some((c) => c === 'friendVisit ["F-0000-1111",true]'),
    f.calls.join('\n'),
  );
  assert.equal(f.calls.filter((c) => c.startsWith('visitCard')).length, 1);
  const off = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: { friends: VISIT_LIST(false) },
  });
  const g = createServerFriends(visitDeps(off.core, () => T0));
  await g.visit('F-0000-1111', false);
  assert.ok(off.calls.some((c) => c === 'friendVisit ["F-0000-1111",false]'));
  assert.equal(off.calls.filter((c) => c.startsWith('visitCard')).length, 0);
});

test('기능 키(friend_visit)가 꺼졌으면 스위치를 숨기고 카드도 손님 목록도 부르지 않는다', async () => {
  const f = fakeCore({ features: { friends: true }, replies: { friends: VISIT_LIST(true, true) } });
  const friends = createServerFriends(visitDeps(f.core, () => T0));
  await friends.refresh();
  assert.equal(friends.state().visit, false);
  await friends.uploadCard(true);
  assert.equal(await friends.visitors(), undefined);
  assert.deepEqual(
    f.calls.filter((c) => !c.startsWith('friends')),
    [],
  );
});

test('서버가 꺼졌거나(offline) 업데이트 관문(update)에 막혔으면 조용히 쉰다: 손님 목록을 부르지 않는다', async () => {
  for (const problem of ['offline', 'update', 'server']) {
    const f = fakeCore({
      features: { friends: true, friend_visit: true },
      replies: { friends: VISIT_LIST(true, true) },
    });
    const friends = createServerFriends(visitDeps(f.core, () => T0));
    await friends.refresh();
    assert.equal(friends.visitQuiet(), false);
    (f.status as { problem: string | null }).problem = problem;
    assert.equal(friends.visitQuiet(), true, problem);
    assert.equal(await friends.visitors(), undefined, problem);
    assert.equal(f.calls.filter((c) => c.startsWith('visits')).length, 0, problem);
  }
});

test('손님 목록: 모양이 틀린 카드(모르는 종류 모양, 긴 이름)는 버리고, 아는 모양은 받는다. 서로 켠 친구가 없으면 mutualVisit 가 거짓', async () => {
  const f = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: {
      friends: VISIT_LIST(true, true),
      visits: {
        ok: true,
        status: 200,
        data: [
          { code: 'F-0000-1111', nickname: '콩', pet: { species: 'kind:cat', name: '나비', stand: false } },
          { code: 'F-0000-2222', nickname: '둘', pet: { species: 'starter:milk', name: null, stand: true } },
        ],
      },
    },
  });
  const friends = createServerFriends(visitDeps(f.core, () => T0));
  await friends.refresh();
  assert.equal(friends.mutualVisit(), true);
  assert.equal((await friends.visitors())?.length, 2);
  const one = friendsListOf(VISIT_LIST(true, false).data as unknown as Record<string, unknown>);
  assert.equal(one?.friends[0]?.theyVisit, false);
  const old = friendsListOf({
    ...LIST.data,
    friends: [{ code: 'F-0000-1111', since: '2026-10-16T00:00:00Z' }],
  });
  assert.equal(old?.friends[0]?.iVisit, false, '옛 서버는 칸이 없으니 꺼짐');
});

test('로그아웃 전 stopVisit 는 서버의 카드를 지우는 호출을 하고 다음 올리기를 다시 시작하게 한다', async () => {
  const f = fakeCore({
    features: { friends: true, friend_visit: true },
    replies: { friends: VISIT_LIST(true) },
  });
  const friends = createServerFriends(visitDeps(f.core, () => T0));
  await friends.refresh();
  await friends.stopVisit();
  assert.ok(f.calls.some((c) => c.startsWith('visitStop')));
});
