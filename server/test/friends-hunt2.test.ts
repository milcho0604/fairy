// 버그잡이 2차 재현 시험 (PR #135, #110 1부): 열기와 30일 돌려주기 경합(두 번 지급), 탈퇴 돌려주기 500개 상한, 쪽지의 보낸 사람
// 이름 스냅샷, 정리 작업과 탈퇴의 동시 실행(교착 없음), 만 18세 미만이 된 받는 사람의 이용권 돌려주기. 멈추지 않게 시험마다 기한을 둔다.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Accounts } from '../src/accounts';
import { Db } from '../src/db';
import { type FeatureKey, Features } from '../src/features';
import { Friends } from '../src/friends';
import { client, type Harness, ip, startHarness } from './helpers';

let h: Harness;
const { api, newDevice, session, balanceOf } = client(() => h);
interface User {
  id: string;
  code: string;
  token: string;
}
async function user(age: '14+' | '18+' = '18+'): Promise<User> {
  const d = await newDevice(age, `친구${Math.floor(Math.random() * 900 + 100)}`);
  return { id: d.id, code: d.code, token: await session(d.id) };
}
const call = (u: User, method: string, path: string, body?: unknown) =>
  api(method, path, { token: u.token, ip: ip(), ...(body === undefined ? {} : { body }) });
async function befriend(a: User, b: User) {
  const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
  assert.equal(r.status, 201, r.text);
  assert.equal((await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`)).status, 200);
}
const rid = () => randomUUID().replaceAll('-', '');
const inboxOf = async (u: User) => (await call(u, 'GET', '/v1/inbox')).body.items;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  h = await startHarness({
    features: { friends: 'everyone', friend_gifts: 'everyone', friend_calendar: 'everyone' },
  });
});
after(async () => {
  await h?.stop();
});

describe('돌려주기 경합', () => {
  test('기한 직전에 시작한 열기가 정리 작업 뒤에 끝나도 한 번만 (보낸 사람 + 받는 사람 = 보낸 양, 열기는 410)', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await h.pool.query('UPDATE account SET balance = 100 WHERE id = $1', [a.id]);
    const g = await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 50, requestId: rid() });
    assert.equal(g.status, 200, g.text);
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    await h.pool.query(`UPDATE inbox SET expires_at = now() + interval '700 milliseconds' WHERE id = $1`, [
      note.id,
    ]);
    // 받는 사람 계정을 참조하는 다른 트랜잭션 (운영자 쪽지 여러 장 보내기처럼 FK 로 KEY SHARE 를 쥔다)
    const hold = await h.pool.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT id FROM account WHERE id = $1 FOR KEY SHARE', [b.id]);
    const open = call(b, 'POST', `/v1/inbox/${note.id}/open`); // 트랜잭션 시작 시각 < 기한
    await sleep(1000); // 기한이 지난다
    const n = await h.app.get(Friends).sweep();
    await hold.query('COMMIT');
    hold.release();
    const o = await open;
    const total = (await balanceOf(a.id)) + (await balanceOf(b.id));
    assert.equal(
      total,
      100,
      `정리 ${n}개, 열기 ${o.status}, 보낸 사람 ${await balanceOf(a.id)}, 받는 사람 ${await balanceOf(b.id)}`,
    );
    assert.equal(o.status, 410, o.text);
    assert.equal(await balanceOf(b.id), 0);
  });
});

describe('탈퇴 돌려주기', () => {
  test('열지 않은 선물이 500개를 넘어도 탈퇴하면 모두 돌아간다 (합이 그대로)', async () => {
    const a = await user();
    const a2 = await user();
    const b = await user();
    await befriend(a, b);
    await befriend(a2, b);
    await h.pool.query('UPDATE account SET balance = 1000 WHERE id = ANY($1::bigint[])', [[a.id, a2.id]]);
    const f = h.app.get(Friends);
    const day = 86_400_000;
    // 받기 상한 하루 500: 이틀에 나눠 1코인씩 501개
    for (let i = 0; i < 300; i++)
      await f.gift(a.id, { to: b.code, coins: 1, passes: 0, requestId: rid() }, Date.now() - day);
    for (let i = 0; i < 201; i++) await f.gift(a2.id, { to: b.code, coins: 1, passes: 0, requestId: rid() });
    assert.equal(await balanceOf(a.id), 700);
    assert.equal(await balanceOf(a2.id), 799);
    assert.equal((await call(b, 'DELETE', '/v1/account')).status, 204);
    const back = (await balanceOf(a.id)) + (await balanceOf(a2.id));
    const stuck = await h.pool.query(
      'SELECT count(*)::int AS n FROM friend_gift WHERE from_account = ANY($1::bigint[]) AND returned_at IS NULL',
      [[a.id, a2.id]],
    );
    assert.equal(back, 2000, `돌아온 합 ${back}, 안 돌아간 선물 ${stuck.rows[0].n}`);
  });
});

describe('막은 뒤와 합친 뒤 쪽지', () => {
  test('나를 막은 친구가 닉네임을 바꿔도 내 쪽지함에는 새 닉네임이 보이지 않는다 (쪽지를 만들 때의 이름만)', async () => {
    const a = await user();
    const b = await user();
    await befriend(b, a); // a 쪽지함에 b 의 신청 쪽지
    assert.equal((await call(b, 'POST', '/v1/friends/blocks', { code: a.code })).status < 300, true);
    assert.equal((await call(b, 'PATCH', '/v1/account', { nickname: '김민지진짜' })).status, 200);
    const seen = (await inboxOf(a)).map(
      (i: { sender: { nickname: string | null } | null }) => i.sender?.nickname,
    );
    assert.ok(!seen.includes('김민지진짜'), `쪽지 보낸 사람 닉네임: ${seen}`);
  });

  test('합쳐진 친구의 쪽지는 만들 때의 코드를 그대로 보이고, 탈퇴하면 비운다', async () => {
    const a = await user();
    const b = await user();
    const keep = await user();
    await befriend(b, a);
    await h.app.get(Db).tx(async (c) => {
      const acc = h.app.get(Accounts);
      const [f, i] = await acc.lockPair(c, b.id, keep.id);
      await acc.merge(c, f, i);
    });
    const note = (await inboxOf(a)).find((i: { kind: string }) => i.kind === 'friend');
    assert.equal(note.sender.code, b.code, '남는 쪽 코드가 아니라 쪽지를 만들 때의 코드');
    assert.equal((await call(keep, 'DELETE', '/v1/account')).status, 204);
    const after = (await inboxOf(a)).find((i: { kind: string }) => i.kind === 'friend');
    assert.equal(after.sender.code, null);
    assert.equal(after.sender.nickname, null);
  });
});

describe('돌려주기 교착과 만 18세 미만', () => {
  const setMode = (key: FeatureKey, mode: 'everyone' | null) => h.app.get(Features).setFeatureMode(key, mode);

  test('정리 작업과 탈퇴를 동시에 돌려도 멈추지 않고 합이 그대로 (교착 없음)', async () => {
    const senders = await Promise.all(Array.from({ length: 4 }, () => user()));
    const b = await user();
    for (const a of senders) {
      await befriend(a, b);
      await h.pool.query('UPDATE account SET balance = 100 WHERE id = $1', [a.id]);
      for (let i = 0; i < 3; i++)
        await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 5, requestId: rid() });
    }
    await h.pool.query(
      `UPDATE inbox SET expires_at = now() - interval '1 minute' WHERE kind = 'gift' AND account_id = $1`,
      [b.id],
    );
    const f = h.app.get(Friends);
    const rs = await Promise.all([
      f.sweep(),
      f.sweep(),
      call(b, 'DELETE', '/v1/account'),
      ...senders.map((a) => call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 1, requestId: rid() })),
    ]);
    assert.equal((rs[2] as { status: number }).status, 204);
    let total = 0;
    for (const a of senders) total += await balanceOf(a.id);
    assert.equal(total, 400, '돌아온 합');
    const dup = await h.pool.query(
      `SELECT entry_id, count(*)::int AS n FROM coin_entry WHERE reason = 'gift_back' GROUP BY entry_id HAVING count(*) > 1`,
    );
    assert.equal(dup.rowCount, 0);
  });

  test('보낸 뒤 만 18세 미만이 된 받는 사람이 열면 코인과 이용권 모두 같은 돌려주기로 (쪽지, returned_at), 한 번만', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await h.pool.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
    await setMode('friend_gift_passes', 'everyone');
    try {
      await h.pool.query('UPDATE account SET balance = 50 WHERE id = $1', [a.id]);
      await h.pool.query(
        `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, 2) ON CONFLICT (account_id) DO UPDATE SET remaining = 2`,
        [a.id],
      );
      assert.equal(
        (await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 5, passes: 2, requestId: rid() }))
          .status,
        200,
      );
      await h.pool.query(`UPDATE account SET age = '14+' WHERE id = $1`, [b.id]);
      const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
      const rs = await Promise.all([1, 2, 3].map(() => call(b, 'POST', `/v1/inbox/${note.id}/open`)));
      assert.equal(rs.filter((r) => r.status === 200).length, 0, rs.map((r) => r.status).join(','));
      assert.equal(await balanceOf(b.id), 0);
      assert.equal(await balanceOf(a.id), 50);
      const t = await h.pool.query('SELECT remaining FROM ai_ticket WHERE account_id = $1', [a.id]);
      assert.equal(t.rows[0].remaining, 2, '이용권은 보낸 사람에게');
      const g = await h.pool.query('SELECT returned_at FROM friend_gift WHERE from_account = $1', [a.id]);
      assert.ok(g.rows[0].returned_at, 'returned_at');
      const back = (await inboxOf(a)).filter((i: { kind: string }) => i.kind === 'gift_back');
      assert.equal(back.length, 1);
      assert.equal(back[0].chatPasses, 2);
      assert.equal(back[0].coins, 5);
    } finally {
      await h.pool.query(`UPDATE feature_flag SET mode = 'allowlist' WHERE key = 'ai_chat'`);
      await setMode('friend_gift_passes', null);
    }
  });
});
