// 통합 시험 (이슈 #101 범위 추가): 앱 안 운영자(운영자 구글 sub 세션만), 운영자 API 두 인증, 채팅 이용권 접근 모드
// (off, allowlist, everyone), 허용 목록과 첫 선물, 차단, 예산 상한, 회수, 정기 지급(시계 주입, 달마다 한 번, 쪽지로),
// 닉네임과 기기 코드, 합치기 뒤 코드 찾기. 진짜 구글과 Anthropic 은 부르지 않는다 (로그인은 DB 로 흉내).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = 'b'.repeat(20) + randomUUID().replaceAll('-', '');
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
let h: Harness;
/** 시험이 고르는 지금 (정기 지급의 달) */
let clock = Date.parse('2026-10-15T12:00:00+09:00');
const { api, newDevice, session, lastLog } = client(() => h);
let adminSession = '';
let adminAccount: { token: string; id: string; code: string };

/** 운영자 API (앱이 하는 대로 Bearer) */
const adminApi = (path: string, body?: Record<string, unknown>, token = adminSession) =>
  body === undefined
    ? api('GET', `/v1/admin/${path}`, { token })
    : api('POST', `/v1/admin/${path}`, { token, body });

before(async () => {
  h = await startHarness(
    {
      adminToken: ADMIN_TOKEN,
      adminSubs: [ADMIN_SUB],
      ai: {
        apiKey: '',
        baseUrl: 'http://127.0.0.1:9',
        model: 'claude-haiku-5-5',
        monthlyBudgetMicros: 5_000_000,
        dailyLimit: 20,
        giftKey: `gift-${randomUUID()}`,
      },
    },
    { now: () => clock },
  );
  adminAccount = await newDevice('18+', '운영자');
  adminSession = await session(adminAccount.id, ADMIN_SUB);
});

after(async () => {
  await h?.stop();
});

describe('운영자 판정과 운영자 API', () => {
  test('/v1/me: 운영자 sub 의 세션만 admin true, 다른 구글 계정과 기기 토큰은 false', async () => {
    const me = await api('GET', '/v1/me', { token: adminSession });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { account: { code: adminAccount.code, nickname: '운영자' }, admin: true });
    assert.equal((await api('GET', '/v1/me', { token: adminAccount.token })).body.admin, false);
    const other = await newDevice('18+');
    const otherSession = await session(other.id);
    assert.equal((await api('GET', '/v1/me', { token: otherSession })).body.admin, false);
    // sub 는 어디에도 나가지 않는다
    assert.doesNotMatch(me.text, new RegExp(ADMIN_SUB));
  });

  test('/v1/admin/*: 운영자 세션만, 다른 계정과 기기 토큰은 403, 틀린 토큰 401, 지정을 빼면 바로 403', async () => {
    const ok = await adminApi('overview');
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.ai.mode, 'allowlist');
    const other = await newDevice('18+');
    const otherSession = await session(other.id);
    for (const token of [otherSession, adminAccount.token, other.token]) {
      assert.equal((await adminApi('overview', undefined, token)).status, 403);
      assert.equal((await adminApi('ai/mode', { mode: 'everyone', confirm: 'yes' }, token)).status, 403);
    }
    assert.equal((await adminApi('overview', undefined, `fs_${'x'.repeat(43)}`)).status, 401);
    assert.equal((await api('GET', '/v1/admin/overview')).status, 401);
    const saved = h.config.adminSubs;
    h.config.adminSubs = [];
    try {
      assert.equal((await adminApi('overview')).status, 403);
      assert.equal((await api('GET', '/v1/me', { token: adminSession })).body.admin, false);
    } finally {
      h.config.adminSubs = saved;
    }
    assert.equal((await adminApi('overview')).status, 200);
  });

  test('웹 쿠키로도 /v1/admin/* 를 쓰되 쓰기는 x-csrf-token 과 같은 출처가 있어야 한다', async () => {
    const web = new AdminBrowser(
      () => h,
      api,
      () => ADMIN_TOKEN,
    );
    assert.equal((await web.login()).status, 303);
    await web.page();
    const headers = { cookie: web.cookie, origin: h.base, 'cf-connecting-ip': web.from };
    assert.equal((await api('GET', '/v1/admin/overview', { headers })).status, 200);
    const body = { account: adminAccount.code, blocked: false };
    assert.equal((await api('POST', '/v1/admin/ai/block', { headers, body })).status, 403);
    assert.equal(
      (await api('POST', '/v1/admin/ai/block', { headers: { ...headers, 'x-csrf-token': 'nope' }, body }))
        .status,
      403,
    );
    const r = await api('POST', '/v1/admin/ai/block', {
      headers: { ...headers, 'x-csrf-token': web.csrf },
      body,
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.ok, true);
  });
});

describe('채팅 이용권 접근 모드', () => {
  test('기본 allowlist: 운영자 계정만, 목록에 넣으면 그때 첫 선물 10장 한 번, 운영 기록', async () => {
    // 첫 로그인 선물은 기본 꺼짐: 켜고 본다
    assert.equal((await adminApi('overview')).body.ai.firstGift, false);
    assert.equal((await adminApi('ai/policy', { first_gift: true })).status, 200);
    const st = await api('GET', '/v1/ai', { token: adminSession });
    assert.equal(st.status, 200, st.text);
    assert.equal(st.body.tickets, 10);
    const u = await newDevice('18+', '친구');
    const us = await session(u.id);
    assert.deepEqual((await api('GET', '/v1/ai', { token: us })).body, { error: 'not_allowed' });
    const r = await adminApi('ai/allow', { account: u.code, allowed: true });
    assert.equal(r.status, 200, r.text);
    assert.equal((await lastLog('ai.allow'))?.target, `account:${u.id}`);
    assert.equal((await api('GET', '/v1/ai', { token: us })).body.tickets, 10);
    assert.equal((await api('GET', '/v1/ai', { token: us })).body.tickets, 10);
    await adminApi('ai/allow', { account: u.code, allowed: false });
    assert.equal((await api('GET', '/v1/ai', { token: us })).body.error, 'not_allowed');
  });

  test('모드 바꾸기는 확인이 있어야 하고, off 는 503 ai_off, everyone 은 모두, 기록', async () => {
    const u = await newDevice('18+');
    const us = await session(u.id);
    const no = await adminApi('ai/mode', { mode: 'everyone' });
    assert.deepEqual([no.status, no.body.error], [400, 'refused']);
    assert.match(no.body.text, /확인/);
    assert.equal((await adminApi('ai/mode', { mode: 'everyone', confirm: 'yes' })).status, 200);
    assert.deepEqual((await lastLog('ai.mode'))?.detail, { before: 'allowlist', after: 'everyone' });
    assert.equal((await api('GET', '/v1/ai', { token: us })).status, 200);
    assert.equal((await adminApi('ai/mode', { mode: 'off', confirm: 'yes' })).status, 200);
    assert.deepEqual((await api('GET', '/v1/ai', { token: us })).body, { error: 'ai_off' });
    assert.equal((await api('GET', '/v1/ai', { token: adminSession })).body.error, 'ai_off');
    assert.equal((await adminApi('ai/mode', { mode: 'allowlist', confirm: 'yes' })).status, 200);
  });

  test('계정 차단, 예산과 하루 상한은 .env 상한 이하만, 회수는 남은 장수까지와 확인', async () => {
    assert.equal((await adminApi('ai/block', { account: adminAccount.code, blocked: true })).status, 200);
    assert.deepEqual((await api('GET', '/v1/ai', { token: adminSession })).body, { error: 'blocked' });
    assert.equal((await adminApi('ai/block', { account: adminAccount.code, blocked: false })).status, 200);
    assert.equal((await api('GET', '/v1/ai', { token: adminSession })).status, 200);

    const over = await adminApi('ai/limits', { budget_usd: '6', daily_limit: '5' });
    assert.equal(over.status, 400);
    assert.match(over.body.text, /상한/);
    assert.equal((await adminApi('ai/limits', { budget_usd: '1.5', daily_limit: '3' })).status, 200);
    const o = await adminApi('overview');
    assert.equal(o.body.ai.monthlyBudgetMicros, 1_500_000);
    assert.equal(o.body.ai.dailyLimit, 3);
    assert.equal((await api('GET', '/v1/ai', { token: adminSession })).body.dailyLimit, 3);
    assert.equal((await adminApi('ai/limits', { budget_usd: '', daily_limit: '' })).status, 200);

    const left = (await api('GET', '/v1/ai', { token: adminSession })).body.tickets;
    assert.equal((await adminApi('ai/revoke', { account: adminAccount.code, count: 1 })).status, 400);
    const tooMany = await adminApi('ai/revoke', {
      account: adminAccount.code,
      count: left + 1,
      confirm: 'yes',
    });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.text, /남은/);
    assert.equal(
      (await adminApi('ai/revoke', { account: adminAccount.code, count: 2, confirm: 'yes' })).status,
      200,
    );
    assert.equal((await api('GET', '/v1/ai', { token: adminSession })).body.tickets, left - 2);
    assert.deepEqual((await lastLog('ai.revoke'))?.detail, { count: 2, remaining: left - 2 });
  });
});

describe('정기 지급 (구독처럼)', () => {
  test('달마다 한 번 쪽지, 같은 달 두 번 없음 (동시 요청도), 채우기와 더하기, 해지', async () => {
    const fill = await newDevice('18+');
    const add = await newDevice('18+');
    const teen = await newDevice('14+');
    assert.equal((await adminApi('ai/subscribe', { account: teen.code, monthly: 5 })).status, 400);
    assert.equal(
      (await adminApi('ai/subscribe', { account: fill.code, monthly: 5, mode: 'fill' })).status,
      200,
    );
    assert.equal(
      (await adminApi('ai/subscribe', { account: add.code, monthly: 3, mode: 'add' })).status,
      200,
    );
    assert.equal((await adminApi('ai/subscribe', { account: add.code, monthly: 3 })).status, 400);
    assert.ok(await lastLog('ai.subscribe'));
    // 걸 때 이번 달 몫이 이미 갔다. 동시에 여러 번 물어도 그대로 한 장
    await Promise.all(Array.from({ length: 6 }, () => api('GET', '/v1/inbox', { token: fill.token })));
    const box = await api('GET', '/v1/inbox', { token: fill.token });
    const subs = box.body.items.filter((x: { kind: string }) => x.kind === 'subscription');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].fillTo, 5);
    assert.equal(subs[0].expiresAt, new Date('2026-11-01T00:00:00+09:00').toISOString());
    // 열면 5장까지 채운다
    const o = await api('POST', `/v1/inbox/${subs[0].id}/open`, { token: fill.token });
    assert.equal(o.status, 200, o.text);
    assert.equal(o.body.chatPasses, 5);
    // 다음 달: 새 쪽지 한 장. 남은 5장이면 채울 것이 없다 (이월 없음)
    clock = Date.parse('2026-11-01T00:30:00+09:00');
    await Promise.all(Array.from({ length: 6 }, () => api('GET', '/v1/inbox', { token: fill.token })));
    const nov = (await api('GET', '/v1/inbox', { token: fill.token })).body.items.filter(
      (x: { kind: string }) => x.kind === 'subscription',
    );
    assert.equal(nov.length, 2);
    const o2 = await api('POST', `/v1/inbox/${nov[0].id}/open`, { token: fill.token });
    assert.deepEqual([o2.body.chatPasses, o2.body.item.opened.chatPasses], [5, 0]);
    // 더하기: 10월, 11월 몫을 열면 3 + 3
    const addBox = (await api('GET', '/v1/inbox', { token: add.token })).body.items;
    assert.equal(addBox.length, 2);
    for (const n of addBox)
      assert.equal((await api('POST', `/v1/inbox/${n.id}/open`, { token: add.token })).status, 200);
    assert.equal(
      (await h.pool.query('SELECT remaining FROM ai_ticket WHERE account_id = $1', [add.id])).rows[0]
        .remaining,
      6,
    );
    const ov = await adminApi(`overview?q=${add.code}`);
    assert.equal(ov.body.account.ai.subscription.nextFill, '2026-12-01');
    // 해지하면 다음 달은 없다
    assert.equal((await adminApi('ai/cancel', { account: add.code })).status, 200);
    clock = Date.parse('2026-12-02T09:00:00+09:00');
    assert.equal((await api('GET', '/v1/inbox', { token: add.token })).body.items.length, 2);
    const fills = await h.pool.query(
      `SELECT count(*)::int AS n FROM ai_subscription_fill f JOIN ai_subscription s ON s.id = f.subscription_id
        WHERE s.account_id = ANY($1::bigint[])`,
      [[fill.id, add.id]],
    );
    assert.equal(fills.rows[0].n, 4);
  });
});

describe('정책: 자동 정기 지급과 자리 수 (#101)', () => {
  test('허용된 계정에는 "매달 100장까지 채우기" 가 저절로 걸려 쪽지로 온다. 해지하면 다시 걸리지 않는다', async () => {
    clock = Date.parse('2027-01-10T12:00:00+09:00');
    const u = await newDevice('18+', '자동');
    const us = await session(u.id);
    assert.equal((await adminApi('ai/allow', { account: u.code, allowed: true })).status, 200);
    const sub = await h.pool.query('SELECT monthly, mode FROM ai_subscription WHERE account_id = $1', [u.id]);
    assert.deepEqual(sub.rows, [{ monthly: 100, mode: 'fill' }]);
    const st = await api('GET', '/v1/ai', { token: us });
    assert.deepEqual(st.body.subscription, { monthly: 100, mode: 'fill', nextFill: '2027-02-01' });
    const note = (await api('GET', '/v1/inbox', { token: us })).body.items[0];
    assert.equal(note.fillTo, 100);
    const o = await api('POST', `/v1/inbox/${note.id}/open`, { token: us });
    assert.equal(o.body.chatPasses, (st.body.tickets as number) + Math.max(0, 100 - st.body.tickets));
    assert.equal((await adminApi('ai/cancel', { account: u.code })).status, 200);
    await api('GET', '/v1/ai', { token: us });
    const live = await h.pool.query(
      'SELECT count(*)::int AS n FROM ai_subscription WHERE account_id = $1 AND canceled_at IS NULL',
      [u.id],
    );
    assert.equal(live.rows[0].n, 0);
  });

  test('자리가 차면 everyone 의 새 사용자는 403 waitlisted 와 대기 목록, 허용 목록 넣기도 거절', async () => {
    const used = (await adminApi('overview')).body.ai.seatsUsed as number;
    assert.equal((await adminApi('ai/policy', { seat_limit: used })).status, 200);
    assert.deepEqual((await lastLog('ai.policy'))?.detail?.after?.seatLimit, used);
    assert.equal((await adminApi('ai/mode', { mode: 'everyone', confirm: 'yes' })).status, 200);
    const late = await newDevice('18+', '늦은이');
    const ls = await session(late.id);
    assert.deepEqual((await api('GET', '/v1/ai', { token: ls })).body, { error: 'waitlisted' });
    const ov = await adminApi('overview');
    assert.ok(ov.body.ai.waitlist.some((x: { code: string }) => x.code === late.code));
    const no = await adminApi('ai/allow', { account: late.code, allowed: true });
    assert.equal(no.status, 400);
    assert.match(no.body.text, /자리가 없어요/);
    // 자리를 늘리면 다음에 물을 때 들어간다
    assert.equal((await adminApi('ai/policy', { seat_limit: used + 1 })).status, 200);
    assert.equal((await api('GET', '/v1/ai', { token: ls })).status, 200);
    assert.equal((await adminApi('overview')).body.ai.waitlist.length, 0);
    assert.equal((await adminApi('ai/mode', { mode: 'allowlist', confirm: 'yes' })).status, 200);
    await adminApi('ai/policy', { seat_limit: 100 });
  });
});

describe('닉네임과 기기 코드', () => {
  test('닉네임 검사 (2~12자, NFC, 제어 문자, 보이지 않는 글자, @, 주소 금지)', async () => {
    const d = await newDevice('14+');
    for (const bad of [
      'a',
      'abcdefghijklm',
      'me@home',
      'go www.x',
      'https://a',
      'a\nb',
      'a​b',
      'shop.com',
      '  ',
    ])
      assert.equal(
        (await api('PATCH', '/v1/account', { token: d.token, body: { nickname: bad } })).body.error,
        'nickname',
        bad,
      );
    const decomposed = '한글'; // "한글" 을 풀어 쓴 것
    const r = await api('PATCH', '/v1/account', { token: d.token, body: { nickname: `  ${decomposed}  ` } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.account.nickname, '한글');
    assert.equal(
      (await api('PATCH', '/v1/account', { token: d.token, body: { nickname: 'Mr.Kim' } })).status,
      200,
    );
    assert.equal((await api('POST', '/v1/device', { body: { age: '14+', nickname: 'x' } })).status, 400);
  });

  test('기기 코드: 모양, 계정마다 다름, 토큰과 무관, 합쳐진 쪽 코드로도 운영자가 찾는다', async () => {
    const ds = await Promise.all(Array.from({ length: 30 }, () => newDevice()));
    const codes = new Set(ds.map((d) => d.code));
    assert.equal(codes.size, 30);
    for (const d of ds) {
      assert.match(d.code, /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      assert.ok(!d.token.includes(d.code.replaceAll('-', '').slice(1)));
    }
    const [a, b] = ds as [(typeof ds)[0], (typeof ds)[0]];
    await h.pool.query('UPDATE account SET nickname = $2 WHERE id = $1', [b.id, '찾을이름']);
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [a.id, b.id]);
    const byOld = await adminApi(`overview?q=${a.code.toLowerCase()}`);
    assert.equal(byOld.body.account.id, a.id);
    assert.equal(byOld.body.account.merged_into, b.id);
    // 합쳐진 쪽 코드로 보내면 남는 쪽에 간다
    const note = await adminApi('notes', { account: a.code, message: '합쳐진 계정에게' });
    assert.equal(note.status, 200, note.text);
    assert.equal(
      (await api('GET', '/v1/inbox', { token: b.token })).body.items[0].message,
      '합쳐진 계정에게',
    );
    const byName = await adminApi(`overview?q=${encodeURIComponent('찾을')}`);
    assert.equal(byName.body.account.code, b.code);
    const me = await api('GET', '/v1/me', { token: b.token });
    assert.deepEqual(me.body.account, { code: b.code, nickname: '찾을이름' });
  });
});

describe('기능 스위치 kakao_login, coin_reset (#102)', () => {
  test('운영자가 모드와 허용 계정을 바꾸면 GET /v1/features 가 그 계정에만 켜진다, 기록과 확인 칸', async () => {
    const u = await newDevice('14+', '초기화');
    const other = await newDevice('14+', '다른');
    const features = async (token: string) => (await api('GET', '/v1/features', { token })).body.features;
    assert.equal((await features(u.token)).coin_reset, false);
    assert.equal((await adminApi('features/mode', { key: 'coin_reset', mode: 'allowlist' })).status, 400);
    assert.equal(
      (await adminApi('features/mode', { key: 'nope', mode: 'allowlist', confirm: 'yes' })).status,
      400,
    );
    const m = await adminApi('features/mode', { key: 'coin_reset', mode: 'allowlist', confirm: 'yes' });
    assert.equal(m.status, 200, m.text);
    assert.ok(await lastLog('feature.mode'));
    const a = await adminApi('features/allow', { key: 'coin_reset', account: u.code, allowed: true });
    assert.equal(a.status, 200, a.text);
    assert.equal((await lastLog('feature.allow'))?.target, `account:${u.id}`);
    assert.equal((await features(u.token)).coin_reset, true);
    assert.equal((await features(other.token)).coin_reset, false);
    await adminApi('features/allow', { key: 'coin_reset', account: u.code, allowed: false });
    assert.equal((await features(u.token)).coin_reset, false);
    await adminApi('features/mode', { key: 'coin_reset', mode: 'everyone', confirm: 'yes' });
    assert.equal((await features(other.token)).coin_reset, true);
    await adminApi('features/mode', { key: 'coin_reset', mode: 'off', confirm: 'yes' });
    assert.equal((await features(other.token)).coin_reset, false);
    // 카카오도 같은 칸에서 (키가 없어 실제 로그인은 꺼져 있다)
    assert.equal(
      (await adminApi('features/mode', { key: 'kakao_login', mode: 'allowlist', confirm: 'yes' })).status,
      200,
    );
    assert.equal(
      (await adminApi('features/allow', { key: 'kakao_login', account: u.code, allowed: true })).status,
      200,
    );
    assert.equal((await features(u.token)).kakao_login, true);
  });
});
