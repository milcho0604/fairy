// 통합 시험 (이슈 #110 1부): 친구 신청, 수락, 거절, 만료, 끊기, 차단, 나이 구분, 코드 추측 제한, 선물(동시 요청, 하루 상한,
// 잔액, 채팅 이용권 조건), 합치기와 탈퇴, 일정 공유(켜기, 끄면 바로 지움, 남의 일정 못 봄), 기능 스위치 세 모드.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Accounts } from '../src/accounts';
import { Db } from '../src/db';
import { type FeatureKey, Features } from '../src/features';
import { Friends } from '../src/friends';
import { AdminBrowser, client, type Harness, ip, startHarness } from './helpers';

const ADMIN_SUB = `admin-${randomUUID()}`;
const ADMIN_TOKEN = 'f'.repeat(20) + randomUUID().replaceAll('-', '');
let h: Harness;
const { api, newDevice, session, balanceOf } = client(() => h);

interface User {
  id: string;
  code: string;
  token: string;
  device: string;
}

/** 로그인한 계정 (기기 계정 + 가짜 구글 로그인 세션) */
async function user(age: '14+' | '18+' = '18+', sub?: string): Promise<User> {
  const d = await newDevice(age, `친구${Math.floor(Math.random() * 900 + 100)}`);
  return { id: d.id, code: d.code, token: await session(d.id, sub), device: d.token };
}

const call = (u: User, method: string, path: string, body?: unknown) =>
  api(method, path, { token: u.token, ip: ip(), ...(body === undefined ? {} : { body }) });

async function befriend(a: User, b: User): Promise<void> {
  const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
  assert.equal(r.status, 201, r.text);
  const id = r.body.request.id;
  const ok = await call(b, 'POST', `/v1/friends/requests/${id}/accept`);
  assert.equal(ok.status, 200, ok.text);
}

const setMode = (key: FeatureKey, mode: 'off' | 'allowlist' | 'everyone' | null) =>
  h.app.get(Features).setFeatureMode(key, mode);
const setBalance = (u: User, n: number) =>
  h.pool.query('UPDATE account SET balance = $2 WHERE id = $1', [u.id, n]);
const setPasses = (u: User, n: number) =>
  h.pool.query(
    `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET remaining = EXCLUDED.remaining`,
    [u.id, n],
  );
const passesOf = async (u: User) =>
  (await h.pool.query('SELECT remaining FROM ai_ticket WHERE account_id = $1', [u.id])).rows[0]?.remaining ??
  0;
const friendsOf = async (u: User) => (await call(u, 'GET', '/v1/friends')).body;
const newRequestId = () => randomUUID().replaceAll('-', '');
const gift = (a: User, b: User, o: { coins?: number; passes?: number; requestId?: string }) =>
  call(a, 'POST', '/v1/friends/gifts', {
    to: b.code,
    coins: o.coins ?? 0,
    passes: o.passes ?? 0,
    requestId: o.requestId ?? newRequestId(),
  });
const inboxOf = async (u: User) => (await call(u, 'GET', '/v1/inbox')).body.items;

before(async () => {
  h = await startHarness({
    adminSubs: [ADMIN_SUB],
    adminToken: ADMIN_TOKEN,
    features: { friends: 'everyone', friend_gifts: 'everyone', friend_calendar: 'everyone' },
  });
});

after(async () => {
  await h?.stop();
});

describe('친구 맺기', () => {
  test('로그인하지 않은 기기 토큰은 403 login_required', async () => {
    const d = await newDevice('18+');
    const r = await api('GET', '/v1/friends', { token: d.token });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'login_required');
  });

  test('신청, 쪽지함 알림, 수락: 두 사람 목록에 서로 보인다', async () => {
    const a = await user();
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', {
      code: b.code.toLowerCase().replaceAll('-', ''),
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.accepted, false);
    assert.equal(r.body.request.code, b.code);
    const inB = await friendsOf(b);
    assert.equal(inB.incoming.length, 1);
    assert.equal(inB.incoming[0].code, a.code);
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'friend');
    assert.ok(note, '친구 신청 쪽지가 있다');
    assert.equal(note.from, 'friend');
    assert.equal(note.sender.code, a.code);
    assert.equal(note.openedAt, null);
    assert.equal((await friendsOf(a)).outgoing[0].code, b.code);
    const ok = await call(b, 'POST', `/v1/friends/requests/${inB.incoming[0].id}/accept`);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.friend.code, a.code);
    assert.deepEqual(
      (await friendsOf(a)).friends.map((f: { code: string }) => f.code),
      [b.code],
    );
    const bl = await friendsOf(b);
    assert.deepEqual(
      bl.friends.map((f: { code: string }) => f.code),
      [a.code],
    );
    assert.equal(bl.incoming.length, 0);
    assert.equal(bl.friends[0].iShare, false, '바쁜 시간 공유는 기본 꺼짐');
    const after = (await inboxOf(b)).find((i: { id: number }) => i.id === note.id);
    assert.ok(after.openedAt, '수락하면 신청 쪽지는 열림');
    // 다시 신청하면 이미 친구
    const again = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_friends');
  });

  test('자기 자신, 모양이 틀린 코드, 없는 코드', async () => {
    const a = await user();
    assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: a.code })).body.error, 'self');
    assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: 'hello' })).status, 404);
  });

  test('서로 신청하면 바로 친구', async () => {
    const a = await user();
    const b = await user();
    assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: b.code })).status, 201);
    const r = await call(b, 'POST', '/v1/friends/requests', { code: a.code });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.accepted, true);
    assert.equal((await friendsOf(a)).friends.length, 1);
    assert.equal((await friendsOf(a)).outgoing.length, 0);
  });

  test('거절: 보낸 쪽에는 기다리는 중으로 보이고, 만료 전 다시 보내기는 409 already_requested', async () => {
    const a = await user();
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    const no = await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/decline`);
    assert.equal(no.status, 204, no.text);
    assert.equal((await friendsOf(b)).incoming.length, 0);
    assert.equal((await friendsOf(a)).outgoing.length, 1);
    const again = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_requested');
    // 거절한 것을 수락하려 하면 404
    assert.equal((await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`)).status, 404);
  });

  test('남의 신청은 수락, 거절하지 못한다 (404)', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal((await call(c, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`)).status, 404);
    assert.equal((await call(c, 'POST', `/v1/friends/requests/${r.body.request.id}/decline`)).status, 404);
    assert.equal((await call(c, 'DELETE', `/v1/friends/requests/${r.body.request.id}`)).status, 404);
  });

  test('보낸 신청 거두기: 상대의 열지 않은 신청 쪽지도 사라진다', async () => {
    const a = await user();
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal((await call(a, 'DELETE', `/v1/friends/requests/${r.body.request.id}`)).status, 204);
    assert.equal((await friendsOf(b)).incoming.length, 0);
    assert.equal((await inboxOf(b)).filter((i: { kind: string }) => i.kind === 'friend').length, 0);
  });

  test('만료: 14일 지난 신청은 410 expired, 그 뒤 다시 보낼 수 있다', async () => {
    const a = await user();
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    const exp = new Date(r.body.request.expiresAt).getTime() - new Date(r.body.request.sentAt).getTime();
    assert.ok(Math.abs(exp - 14 * 86_400_000) < 5000, '14일');
    await h.pool.query(`UPDATE friend_request SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      r.body.request.id,
    ]);
    const late = await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`);
    assert.equal(late.status, 410);
    assert.equal(late.body.error, 'expired');
    assert.equal((await friendsOf(b)).incoming.length, 0);
    assert.equal((await friendsOf(a)).outgoing.length, 0);
    assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: b.code })).status, 201);
  });

  test('끊기: 두 쪽 모두에서 사라지고 다시 끊으면 404', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    assert.equal((await call(a, 'DELETE', `/v1/friends/${b.code}`)).status, 204);
    assert.equal((await friendsOf(a)).friends.length, 0);
    assert.equal((await friendsOf(b)).friends.length, 0);
    assert.equal((await call(b, 'DELETE', `/v1/friends/${a.code}`)).status, 404);
  });

  test('차단: 친구가 끊기고, 서로 신청이 안 되고(막힌 쪽은 까닭을 모른다), 풀면 다시 된다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    const r = await call(a, 'POST', '/v1/friends/blocks', { code: b.code });
    assert.equal(r.status, 201, r.text);
    assert.equal((await friendsOf(a)).friends.length, 0);
    assert.equal((await friendsOf(b)).friends.length, 0);
    assert.deepEqual(
      (await friendsOf(a)).blocked.map((x: { code: string }) => x.code),
      [b.code],
    );
    const fromB = await call(b, 'POST', '/v1/friends/requests', { code: a.code });
    assert.equal(fromB.status, 409);
    assert.equal(fromB.body.error, 'unavailable');
    const fromA = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal(fromA.body.error, 'blocked_by_you');
    // 선물도 안 된다
    await setBalance(b, 100);
    assert.equal((await gift(b, a, { coins: 10 })).status, 404);
    assert.equal((await call(a, 'DELETE', `/v1/friends/blocks/${b.code}`)).status, 204);
    assert.equal((await call(b, 'POST', '/v1/friends/requests', { code: a.code })).status, 201);
  });

  test('차단하면 그 사람이 보낸 열지 않은 신청 쪽지도 지운다', async () => {
    const a = await user();
    const b = await user();
    await call(b, 'POST', '/v1/friends/requests', { code: a.code });
    await call(a, 'POST', '/v1/friends/blocks', { code: b.code });
    assert.equal((await inboxOf(a)).filter((i: { kind: string }) => i.kind === 'friend').length, 0);
    assert.equal((await friendsOf(a)).incoming.length, 0);
  });

  test('나이 구분이 다르면 409 unavailable (상대 나이를 알리지 않는다)', async () => {
    const adult = await user('18+');
    const teen = await user('14+');
    const r = await call(adult, 'POST', '/v1/friends/requests', { code: teen.code });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'unavailable');
    assert.equal(
      (await call(teen, 'POST', '/v1/friends/requests', { code: adult.code })).body.error,
      'unavailable',
    );
    // 만 14~17세끼리는 된다
    const teen2 = await user('14+');
    await befriend(teen, teen2);
    // 한쪽이 나이 구분을 바꾸면 그 관계는 걷힌다
    const p = await call(teen2, 'PATCH', '/v1/account', { age: '18+' });
    assert.equal(p.status, 200, p.text);
    assert.equal((await friendsOf(teen)).friends.length, 0);
    assert.equal((await friendsOf(teen2)).friends.length, 0);
  });

  test('로그인하지 않은 계정의 코드로는 신청이 안 된다 (unavailable)', async () => {
    const a = await user();
    const d = await newDevice('18+');
    const r = await call(a, 'POST', '/v1/friends/requests', { code: d.code });
    assert.equal(r.body.error, 'unavailable');
  });

  test('코드 추측 제한: 없는 코드 5번 뒤에는 맞는 코드도 429', async () => {
    const a = await user();
    const b = await user();
    for (let i = 0; i < 5; i++) {
      const r = await call(a, 'POST', '/v1/friends/requests', { code: `F-ZZZ${i}-ZZZZ` });
      assert.equal(r.status, 404, r.text);
    }
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal(r.status, 429);
    // 다른 계정은 그대로
    const c = await user();
    assert.equal((await call(c, 'POST', '/v1/friends/requests', { code: b.code })).status, 201);
  });

  test('친구 수 상한 100 (보낸 신청 포함)', async () => {
    const a = await user();
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push((await newDevice('18+')).id);
    await h.pool.query(
      `INSERT INTO friend (account_id, friend_id) SELECT $1, unnest($2::bigint[])
       UNION ALL SELECT unnest($2::bigint[]), $1`,
      [a.id, ids],
    );
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'limit');
    // 상대가 꽉 찼으면 상대 쪽은 unavailable
    const back = await call(b, 'POST', '/v1/friends/requests', { code: a.code });
    assert.equal(back.status, 201);
    const ok = await call(a, 'POST', `/v1/friends/requests/${back.body.request.id}/accept`);
    assert.equal(ok.body.error, 'limit');
  });
});

describe('친구 선물', () => {
  test('코인: 보낸 사람에서 빠지고 쪽지로 간다. 열면 한 번만 받고 양쪽 장부에 남는다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 1000);
    const r = await gift(a, b, { coins: 120 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.balance, 880);
    assert.equal(r.body.today.coins, 120);
    assert.equal(await balanceOf(a.id), 880);
    const out = await h.pool.query(`SELECT amount, reason FROM coin_entry WHERE entry_id = $1`, [
      `gift-out:${r.body.gift.id}`,
    ]);
    assert.deepEqual(out.rows[0], { amount: -120, reason: 'gift_out' });
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    assert.equal(note.coins, 120);
    assert.equal(note.sender.code, a.code);
    assert.equal(await balanceOf(b.id), 0, '열기 전에는 받지 않는다');
    const opens = await Promise.all([1, 2, 3].map(() => call(b, 'POST', `/v1/inbox/${note.id}/open`)));
    assert.equal(opens.filter((x) => x.status === 200).length, 1);
    assert.equal(await balanceOf(b.id), 120);
    const got = await h.pool.query(`SELECT amount, reason FROM coin_entry WHERE entry_id = $1`, [
      `inbox:${note.id}`,
    ]);
    assert.deepEqual(got.rows[0], { amount: 120, reason: 'gift_in' });
  });

  test('같은 요청 번호를 동시에 다섯 번: 한 번만 빠진다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 500);
    const requestId = newRequestId();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => gift(a, b, { coins: 50, requestId })));
    assert.ok(
      rs.every((x) => x.status === 200),
      rs.map((x) => x.text).join('\n'),
    );
    assert.equal(rs.filter((x) => x.body.duplicate).length, 4);
    assert.equal(await balanceOf(a.id), 450);
    const n = await h.pool.query('SELECT count(*)::int AS n FROM friend_gift WHERE from_account = $1', [
      a.id,
    ]);
    assert.equal(n.rows[0].n, 1);
    assert.equal((await inboxOf(b)).filter((i: { kind: string }) => i.kind === 'gift').length, 1);
  });

  test('다른 요청 번호를 동시에: 하루 보내기 상한 500 을 넘지 않는다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 5000);
    const rs = await Promise.all(Array.from({ length: 8 }, () => gift(a, b, { coins: 100 })));
    assert.equal(rs.filter((x) => x.status === 200).length, 5);
    assert.ok(rs.filter((x) => x.status === 409).every((x) => x.body.error === 'daily_send_limit'));
    assert.equal(await balanceOf(a.id), 4500);
  });

  test('하루 상한: 보내기 남은 양을 알려 주고, 받기는 여러 친구에게서 합쳐 센다', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    await befriend(a, b);
    await befriend(c, b);
    await setBalance(a, 2000);
    await setBalance(c, 2000);
    assert.equal((await gift(a, b, { coins: 400 })).status, 200);
    const over = await gift(a, b, { coins: 200 });
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'daily_send_limit');
    assert.deepEqual(over.body.left, { coins: 100, passes: 5 });
    const recv = await gift(c, b, { coins: 150 });
    assert.equal(recv.status, 409);
    assert.equal(recv.body.error, 'daily_receive_limit');
    assert.equal(recv.body.left.coins, 100);
    assert.equal((await gift(c, b, { coins: 100 })).status, 200);
    assert.equal(await balanceOf(c.id), 1900);
  });

  test('잔액 부족, 친구 아님, 양이 틀림', async () => {
    const a = await user();
    const b = await user();
    const stranger = await user();
    await befriend(a, b);
    await setBalance(a, 30);
    const r = await gift(a, b, { coins: 31 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'balance');
    assert.equal(await balanceOf(a.id), 30);
    assert.equal((await gift(a, stranger, { coins: 1 })).body.error, 'not_friend');
    assert.equal((await gift(a, b, { coins: 0 })).body.error, 'amount');
    assert.equal((await gift(a, b, { coins: 501 })).body.error, 'amount');
    assert.equal((await gift(a, b, { coins: 1.5 })).body.error, 'amount');
    assert.equal((await gift(a, b, { passes: 6 })).body.error, 'amount');
    assert.equal(
      (await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 1, requestId: 'x' })).body.error,
      'request_id',
    );
  });

  test('채팅 이용권: 18+ 끼리, 둘 다 채팅 이용권 허용, 둘 다 이용권 선물 스위치 허용, 남은 수', async () => {
    const t1 = await user('14+');
    const t2 = await user('14+');
    await befriend(t1, t2);
    await setPasses(t1, 3);
    assert.equal((await gift(t1, t2, { passes: 1 })).body.error, 'passes_age');

    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setPasses(a, 3);
    // ai_chat 은 처음에 allowlist: 둘 다 목록에 없으면 안 된다
    assert.equal((await gift(a, b, { passes: 1 })).body.error, 'passes_not_allowed');
    await h.pool.query(`INSERT INTO feature_allow (key, account_id) VALUES ('ai_chat', $1)`, [a.id]);
    assert.equal(
      (await gift(a, b, { passes: 1 })).body.error,
      'passes_not_allowed',
      '받는 사람도 허용돼야 한다',
    );
    await h.pool.query(`INSERT INTO feature_allow (key, account_id) VALUES ('ai_chat', $1)`, [b.id]);
    // 이용권 선물 스위치 friend_gift_passes 는 기본 allowlist: 보내는 사람, 받는 사람 모두 목록에 있어야 한다
    assert.equal((await gift(a, b, { passes: 1 })).body.error, 'passes_not_allowed');
    await h.app.get(Features).allowAccount('friend_gift_passes', a.id);
    assert.equal(
      (await gift(a, b, { passes: 1 })).body.error,
      'passes_not_allowed',
      '받는 사람도 스위치 허용',
    );
    await h.app.get(Features).allowAccount('friend_gift_passes', b.id);
    try {
      assert.equal((await gift(a, b, { passes: 4 })).body.error, 'no_passes');
      const r = await gift(a, b, { passes: 2, coins: 0 });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.chatPasses, 1);
      assert.equal(await passesOf(a), 1);
      // 막힌 받는 사람에게는 안 된다
      await h.pool.query('INSERT INTO ai_block (account_id) VALUES ($1)', [b.id]);
      assert.equal((await gift(a, b, { passes: 1 })).body.error, 'passes_not_allowed');
      await h.pool.query('DELETE FROM ai_block WHERE account_id = $1', [b.id]);
      const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
      assert.equal(note.chatPasses, 2);
      const o = await call(b, 'POST', `/v1/inbox/${note.id}/open`);
      assert.equal(o.status, 200, o.text);
      assert.equal(await passesOf(b), 2);
      // 하루 이용권 상한 5
      await setPasses(a, 10);
      assert.equal((await gift(a, b, { passes: 3 })).status, 200);
      assert.equal((await gift(a, b, { passes: 1 })).body.error, 'daily_send_limit');
    } finally {
      await setMode('friend_gift_passes', null);
    }
  });

  test('보낸 뒤 받는 사람이 만 18세 미만으로 바꾸면 선물은 열 수 없고 코인과 이용권 모두 보낸 사람에게 돌아간다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await h.pool.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
    await setMode('friend_gift_passes', 'everyone');
    try {
      await setPasses(a, 2);
      await setBalance(a, 10);
      assert.equal((await gift(a, b, { passes: 2, coins: 5 })).status, 200);
      assert.equal(await passesOf(a), 0);
      // 나이 구분을 바꾸면 친구는 걷히지만 이미 보낸 쪽지는 남는다
      await h.pool.query(`UPDATE account SET age = '14+' WHERE id = $1`, [b.id]);
      const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
      const o = await call(b, 'POST', `/v1/inbox/${note.id}/open`);
      assert.equal(o.status, 410, o.text);
      assert.equal(await passesOf(b), 0);
      assert.equal(await passesOf(a), 2);
      assert.equal(await balanceOf(b.id), 0);
      assert.equal(await balanceOf(a.id), 10);
    } finally {
      await h.pool.query(`UPDATE feature_flag SET mode = 'allowlist' WHERE key = 'ai_chat'`);
      await setMode('friend_gift_passes', null);
    }
  });
});

describe('열지 않은 선물 돌려주기 (30일, 받는 사람 탈퇴)', () => {
  const sweep = () => h.app.get(Friends).sweep();
  const expire = (noteId: number) =>
    h.pool.query(`UPDATE inbox SET expires_at = now() - interval '1 minute' WHERE id = $1`, [noteId]);

  test('선물 쪽지 기한은 30일', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 10);
    assert.equal((await gift(a, b, { coins: 3 })).status, 200);
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    const days = (new Date(note.expiresAt).getTime() - new Date(note.sentAt).getTime()) / 86_400_000;
    assert.ok(Math.abs(days - 30) < 0.01, String(days));
  });

  test('30일 지나면 정리 작업이 보낸 사람에게 돌려주고 쪽지로 알린다. 두 번 돌려도, 동시에 돌려도 한 번', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 100);
    await setPasses(a, 0);
    await h.pool.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
    await setMode('friend_gift_passes', 'everyone');
    try {
      await setPasses(a, 2);
      assert.equal((await gift(a, b, { coins: 40, passes: 2 })).status, 200);
      assert.equal(await balanceOf(a.id), 60);
      const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
      await expire(note.id);
      const n = await Promise.all([sweep(), sweep(), sweep()]);
      assert.ok(n.reduce((x, y) => x + y, 0) >= 1, String(n));
      await sweep();
      assert.equal(await balanceOf(a.id), 100);
      assert.equal(await passesOf(a), 2);
      const back = await h.pool.query(
        `SELECT count(*)::int AS n, sum(amount)::int AS s FROM coin_entry WHERE account_id = $1 AND reason = 'gift_back'`,
        [a.id],
      );
      assert.deepEqual(back.rows[0], { n: 1, s: 40 });
      const notes = (await inboxOf(a)).filter((i: { kind: string }) => i.kind === 'gift_back');
      assert.equal(notes.length, 1);
      assert.equal(notes[0].coins, 40);
      assert.equal(notes[0].chatPasses, 2);
      assert.equal(notes[0].sender.code, b.code);
      // 알림 쪽지는 열어도 더 주지 않는다
      const o = await call(a, 'POST', `/v1/inbox/${notes[0].id}/open`);
      assert.equal(o.status, 200, o.text);
      assert.equal(await balanceOf(a.id), 100);
      assert.equal(await passesOf(a), 2);
      // 받는 사람은 이제 열 수 없다
      assert.equal((await call(b, 'POST', `/v1/inbox/${note.id}/open`)).status, 410);
      assert.equal(await balanceOf(b.id), 0);
    } finally {
      await h.pool.query(`UPDATE feature_flag SET mode = 'allowlist' WHERE key = 'ai_chat'`);
      await setMode('friend_gift_passes', null);
    }
  });

  test('연 선물은 돌려주지 않는다 (열기와 정리가 겹쳐도 한쪽만)', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 50);
    assert.equal((await gift(a, b, { coins: 20 })).status, 200);
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    const [o] = await Promise.all([call(b, 'POST', `/v1/inbox/${note.id}/open`), sweep()]);
    assert.equal(o.status, 200, o.text);
    await expire(note.id);
    await sweep();
    assert.equal(await balanceOf(b.id), 20);
    assert.equal(await balanceOf(a.id), 30);
  });

  test('받는 사람이 탈퇴하면 열지 않은 선물은 보낸 사람에게 돌아간다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 100);
    assert.equal((await gift(a, b, { coins: 25 })).status, 200);
    assert.equal((await gift(a, b, { coins: 5 })).status, 200);
    const first = (await inboxOf(b)).find(
      (i: { kind: string; coins: number }) => i.kind === 'gift' && i.coins === 5,
    );
    assert.equal((await call(b, 'POST', `/v1/inbox/${first.id}/open`)).status, 200);
    assert.equal((await call(b, 'DELETE', '/v1/account')).status, 204);
    assert.equal(await balanceOf(a.id), 95, '열지 않은 25 만 돌아온다');
    const notes = (await inboxOf(a)).filter((i: { kind: string }) => i.kind === 'gift_back');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].sender.code, null, '떠난 친구');
  });
});

describe('합치기와 탈퇴', () => {
  const merge = (from: User, into: User) =>
    h.app.get(Db).tx(async (c) => {
      const accounts = h.app.get(Accounts);
      const [f, i] = await accounts.lockPair(c, from.id, into.id);
      await accounts.merge(c, f, i);
    });

  test('합치면 친구, 신청, 차단이 남는 쪽으로 옮겨진다. 서로 친구였던 두 계정은 자기 자신이 되지 않는다', async () => {
    const x = await user();
    const keep = await user();
    const y = await user();
    const z = await user();
    const w = await user();
    await befriend(x, y);
    await befriend(x, keep);
    await befriend(keep, y);
    await call(z, 'POST', '/v1/friends/requests', { code: x.code });
    await call(x, 'POST', '/v1/friends/blocks', { code: w.code });
    await merge(x, keep);
    const k = await friendsOf(keep);
    assert.deepEqual(
      k.friends.map((f: { code: string }) => f.code),
      [y.code],
    );
    assert.deepEqual(
      k.incoming.map((f: { code: string }) => f.code),
      [z.code],
    );
    assert.deepEqual(
      k.blocked.map((f: { code: string }) => f.code),
      [w.code],
    );
    assert.deepEqual(
      (await friendsOf(y)).friends.map((f: { code: string }) => f.code),
      [keep.code],
    );
    const self = await h.pool.query('SELECT count(*)::int AS n FROM friend WHERE account_id = friend_id');
    assert.equal(self.rows[0].n, 0);
    // 닫힌 계정의 옛 코드로 신청하면 남는 쪽으로 간다 (이미 친구)
    assert.equal(
      (await call(y, 'POST', '/v1/friends/requests', { code: x.code })).body.error,
      'already_friends',
    );
    // 옛 세션은 남는 쪽을 따라간다
    assert.equal((await friendsOf(x)).me.code, keep.code);
  });

  test('합친 계정의 하루 선물 상한은 가족 전체로 센다', async () => {
    const a = await user();
    const a2 = await user();
    const b = await user();
    await befriend(a, b);
    await befriend(a2, b);
    await setBalance(a, 1000);
    await setBalance(a2, 1000);
    assert.equal((await gift(a, b, { coins: 300 })).status, 200);
    await merge(a, a2);
    const r = await gift(a2, b, { coins: 300 });
    assert.equal(r.body.error, 'daily_send_limit');
    assert.equal(r.body.left.coins, 200);
  });

  test('탈퇴: 친구 목록에서 사라지고, 보낸 선물 쪽지는 받는 사람이 열 수 있다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await setBalance(a, 100);
    assert.equal((await gift(a, b, { coins: 40 })).status, 200);
    assert.equal((await call(a, 'DELETE', '/v1/account')).status, 204);
    assert.equal((await friendsOf(b)).friends.length, 0);
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    assert.equal(note.sender.code, null, '떠난 친구');
    assert.equal((await call(b, 'POST', `/v1/inbox/${note.id}/open`)).status, 200);
    assert.equal(await balanceOf(b.id), 40);
    const left = await h.pool.query(
      'SELECT count(*)::int AS n FROM friend WHERE account_id = $1 OR friend_id = $1',
      [a.id],
    );
    assert.equal(left.rows[0].n, 0);
  });
});

describe('일정 공유 1차 (바쁜 시간대)', () => {
  const H = 3_600_000;
  const blocks = () => {
    const t = Date.now();
    return [
      { start: t + H, end: t + 2 * H, title: '치과' },
      { start: t + 90 * 60_000, end: t + 3 * H },
      { start: t + 30 * H, end: t + 31 * H },
      // 14일 넘는 것은 잘린다
      { start: t + 20 * 24 * H, end: t + 20 * 24 * H + H },
    ];
  };
  const busyRows = async (u: User) =>
    (await h.pool.query('SELECT count(*)::int AS n FROM busy_block WHERE account_id = $1', [u.id])).rows[0].n;

  test('기본 꺼짐: 올리면 409 not_sharing. 켜면 친구가 보고, 다른 사람은 못 본다 (404)', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const stranger = await user();
    await befriend(a, b);
    await befriend(a, c);
    const no = await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: blocks() });
    assert.equal(no.status, 409);
    assert.equal(no.body.error, 'not_sharing');
    assert.equal((await call(b, 'GET', `/v1/friends/${a.code}/busy`)).status, 404);
    const on = await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.body.sharing, 1);
    const up = await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: blocks() });
    assert.equal(up.status, 200, up.text);
    assert.equal(up.body.stored, 2, '겹친 것은 합치고 14일 밖은 버린다');
    const seen = await call(b, 'GET', `/v1/friends/${a.code}/busy`);
    assert.equal(seen.status, 200, seen.text);
    assert.equal(seen.body.blocks.length, 2);
    assert.deepEqual(Object.keys(seen.body.blocks[0]).sort(), ['end', 'start'], '제목은 없다');
    assert.ok(!seen.text.includes('치과'));
    assert.ok(seen.body.updatedAt);
    assert.equal((await friendsOf(b)).friends[0].theyShare, true);
    // 켜지 않은 친구, 친구 아닌 사람, 내 것인 척(남의 코드)은 못 본다
    assert.equal((await call(c, 'GET', `/v1/friends/${a.code}/busy`)).status, 404);
    assert.equal((await call(stranger, 'GET', `/v1/friends/${a.code}/busy`)).status, 404);
    assert.equal((await call(a, 'GET', `/v1/friends/${b.code}/busy`)).status, 404);
    // 친구가 아니면 켤 수 없다
    assert.equal(
      (await call(stranger, 'PUT', `/v1/friends/${a.code}/calendar`, { share: true })).status,
      404,
    );
    // 끄면 바로 지운다
    const off = await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: false });
    assert.equal(off.status, 200);
    assert.equal(await busyRows(a), 0);
    assert.equal((await call(b, 'GET', `/v1/friends/${a.code}/busy`)).status, 404);
  });

  test('끊거나 막거나 모두 끄기를 하면 올린 일정이 바로 지워진다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true });
    await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: blocks() });
    assert.ok((await busyRows(a)) > 0);
    await call(a, 'DELETE', `/v1/friends/${b.code}`);
    assert.equal(await busyRows(a), 0);

    await befriend(a, b);
    await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true });
    await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: blocks() });
    await call(b, 'POST', '/v1/friends/blocks', { code: a.code });
    assert.equal(await busyRows(a), 0);
    await call(b, 'DELETE', `/v1/friends/blocks/${a.code}`);

    await befriend(a, b);
    await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true });
    await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: blocks() });
    assert.equal((await call(a, 'DELETE', '/v1/friends/calendar')).status, 204);
    assert.equal(await busyRows(a), 0);
    assert.equal((await friendsOf(a)).friends[0].iShare, false);
  });

  test('모양이 틀린 시간대는 400', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true });
    for (const bad of [
      { blocks: 'x' },
      { blocks: [{ start: 5, end: 1 }] },
      { blocks: Array(401).fill({ start: 1, end: 2 }) },
    ])
      assert.equal((await call(a, 'PUT', '/v1/friends/calendar/busy', bad)).status, 400);
  });
});

describe('기능 스위치 세 모드', () => {
  test('off, allowlist(허용 계정과 운영자 계정), everyone', async () => {
    const a = await user();
    const b = await user();
    const admin = await user('18+', ADMIN_SUB);
    try {
      await setMode('friends', 'off');
      const off = await call(a, 'GET', '/v1/friends');
      assert.equal(off.status, 403);
      assert.equal(off.body.error, 'feature_off');
      assert.equal((await call(a, 'GET', '/v1/features')).body.features.friends, false);

      await setMode('friends', 'allowlist');
      assert.equal((await call(a, 'GET', '/v1/friends')).status, 403);
      assert.equal((await call(admin, 'GET', '/v1/friends')).status, 200, '운영자 계정은 목록에 없어도 된다');
      assert.equal((await call(admin, 'GET', '/v1/features')).body.features.friends, true);
      await h.app.get(Features).allowAccount('friends', a.id);
      assert.equal((await call(a, 'GET', '/v1/friends')).status, 200);
      assert.equal((await call(a, 'GET', '/v1/features')).body.features.friends, true);
      // 받는 사람도 친구 기능을 써야 한다
      assert.equal(
        (await call(a, 'POST', '/v1/friends/requests', { code: b.code })).body.error,
        'unavailable',
      );
      assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: admin.code })).status, 201);

      await setMode('friends', 'everyone');
      assert.equal((await call(b, 'GET', '/v1/friends')).status, 200);

      // 선물과 일정도 따로 꺼진다
      await befriend(b, a);
      await setBalance(b, 10);
      await setMode('friend_gifts', 'off');
      assert.equal((await gift(b, a, { coins: 1 })).body.error, 'feature_off');
      await setMode('friend_calendar', 'off');
      assert.equal(
        (await call(b, 'PUT', `/v1/friends/${a.code}/calendar`, { share: true })).body.error,
        'feature_off',
      );
      // 끄기와 지우기는 기능 키와 상관없이 된다
      assert.equal((await call(b, 'PUT', `/v1/friends/${a.code}/calendar`, { share: false })).status, 200);
      assert.equal((await call(b, 'DELETE', '/v1/friends/calendar')).status, 204);
    } finally {
      await setMode('friends', null);
      await setMode('friend_gifts', null);
      await setMode('friend_calendar', null);
    }
  });

  test('운영자 화면 기능 스위치 칸에 친구 기능 넷이 나오고 모드를 바꿀 수 있다', async () => {
    const browser = new AdminBrowser(
      () => h,
      api,
      () => ADMIN_TOKEN,
    );
    assert.equal((await browser.login()).status, 303);
    const page = await browser.page('/features');
    for (const key of ['friends', 'friend_gifts', 'friend_calendar', 'friend_visit', 'friend_gift_passes'])
      assert.ok(page.text.includes(`<code>${key}</code>`), key);
    const r = await browser.act('/admin/features/mode', { key: 'friend_gifts', mode: 'off', confirm: 'yes' });
    assert.ok(r.ok, r.text);
    assert.equal(await h.app.get(Features).featureMode('friend_gifts'), 'off');
    await setMode('friend_gifts', null);
  });
});
