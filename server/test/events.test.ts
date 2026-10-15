// 통합 시험 (이슈 #101): 이벤트 선물, 배수, 쿠폰, 쪽지(운영자 지급), 웹 운영자 화면(로그인, 쿠키, CSRF, 레이트리밋,
// 보안 머리), 운영 기록, 정적 파일 내보내기(앱 읽기 코드로 검사). 동시 요청에도 한 번만인지 본다.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다. 최신 릴리스는 이 컴퓨터의 가짜 서버.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, HOUR, ip, kstInput, startHarness, today } from './helpers';

const ROOT = join(__dirname, '..', '..', '..');
const ADMIN_TOKEN = 'a'.repeat(20) + randomUUID().replaceAll('-', '');
let h: Harness;
let releases: Server;
let latestTag = 'v0.4.3';
const { api, newDevice, secondDevice, session, balanceOf, ledgerSum, lastLog } = client(() => h);
const browser = () =>
  new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
let admin: AdminBrowser;

async function makeEvent(
  o: {
    id?: string;
    kind?: 'gift' | 'boost';
    coins?: number;
    reasons?: string[];
    times?: number;
    from?: number;
    until?: number;
  } = {},
): Promise<string> {
  const id = o.id ?? `ev-${randomUUID().slice(0, 8)}`;
  const kind = o.kind ?? 'gift';
  const r = await admin.act('/admin/events', {
    id,
    kind,
    title_ko: '선물 시험',
    title_en: 'Gift test',
    body_ko: '코인을 받아',
    body_en: 'Get coins',
    from: kstInput(o.from ?? Date.now() - HOUR),
    until: kstInput(o.until ?? Date.now() + 24 * HOUR),
    ...(kind === 'gift'
      ? { coins: String(o.coins ?? 30) }
      : { reasons: o.reasons ?? ['meet'], times: String(o.times ?? 2) }),
  });
  assert.ok(r.ok, r.text);
  return id;
}

async function makeCoupon(
  o: { coins?: number; tickets?: number; max?: number; from?: number; until?: number } = {},
) {
  const r = await admin.act('/admin/coupons', {
    label: '시험 쿠폰',
    coins: String(o.coins ?? 40),
    tickets: String(o.tickets ?? 0),
    max_uses: String(o.max ?? 100),
    ...(o.from !== undefined ? { from: kstInput(o.from) } : {}),
    until: kstInput(o.until ?? Date.now() + 24 * HOUR),
  });
  assert.ok(r.ok, r.text);
  const code = /코드: ([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec(r.text)?.[1];
  assert.ok(code, r.text);
  return code;
}

before(async () => {
  releases = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        tag_name: latestTag,
        html_url: 'https://github.com/milcho0604/fairy-releases/releases/x',
        draft: false,
        prerelease: false,
      }),
    );
  });
  await new Promise<void>((r) => releases.listen(0, '127.0.0.1', r));
  const raddr = releases.address();
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    releasesApi: `http://127.0.0.1:${typeof raddr === 'object' && raddr ? raddr.port : 0}/latest`,
  });
  admin = browser();
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  // 선물과 쿠폰은 기본이 로그인 계정만. 이 파일의 다른 시험은 기기 계정으로 보므로 끈다 (켠 경우는 아래 시험)
  assert.ok((await admin.act('/admin/rewards/policy', { login_only: '0' })).ok);
});

after(async () => {
  await h?.stop();
  releases?.close();
});

describe('운영자 로그인 (웹)', () => {
  test('로그인 화면, 쿠키 속성, 보안 머리, 운영 기록', async () => {
    const anon = await api('GET', '/admin');
    assert.equal(anon.status, 200);
    assert.match(anon.text, /운영자 토큰/);
    assert.doesNotMatch(anon.text, /name="csrf"/);
    for (const [k, v] of [
      ['x-frame-options', 'DENY'],
      ['x-content-type-options', 'nosniff'],
      ['cache-control', 'no-store'],
      ['referrer-policy', 'no-referrer'],
    ] as const)
      assert.equal(anon.headers.get(k), v, k);
    const csp = anon.headers.get('content-security-policy') ?? '';
    for (const part of [
      "default-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "style-src 'self'",
    ])
      assert.ok(csp.includes(part), csp);
    assert.doesNotMatch(anon.text, /<script/);

    const a = browser();
    const r = await a.login();
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/admin');
    const cookie = r.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^__Host-fairy_admin=[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/;', 'Max-Age=1800'])
      assert.ok(cookie.includes(attr), cookie);
    const p = await a.page();
    assert.match(p.text, /페어리 운영자/);
    assert.ok(a.csrf.length >= 40);
    assert.match((await lastLog('login'))?.actor ?? '', /^admin:[0-9a-f]{8}$/);
    assert.equal((await a.post('/admin/logout', {})).status, 303);
    assert.doesNotMatch((await a.page()).text, /name="csrf"/);
  });

  test('틀린 토큰은 401 과 기록, 같은 곳에서 5번 틀리면 맞는 토큰도 429', async () => {
    const a = browser();
    for (let i = 0; i < 5; i++) {
      const r = await a.login(`${ADMIN_TOKEN}x`);
      assert.equal(r.status, 401);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    assert.equal((await a.login()).status, 429);
    const fails = await h.pool.query(`SELECT count(*)::int AS n FROM admin_log WHERE action = 'login.fail'`);
    assert.ok(fails.rows[0].n >= 5);
    assert.equal((await browser().login()).status, 303);
  });

  test('CSRF 토큰이 없거나 틀리거나 다른 출처면 403, 세션이 없으면 401', async () => {
    const before = await h.pool.query('SELECT count(*)::int AS n FROM event');
    const fields = {
      id: 'csrf-test',
      kind: 'gift',
      title_ko: 'a',
      title_en: 'a',
      body_ko: 'b',
      body_en: 'b',
      from: kstInput(Date.now()),
      until: kstInput(Date.now() + HOUR),
      coins: '5',
    };
    assert.equal((await admin.post('/admin/events', fields, false)).status, 403);
    assert.equal((await admin.post('/admin/events', { ...fields, csrf: 'x'.repeat(43) }, false)).status, 403);
    assert.equal((await admin.post('/admin/events', fields, true, 'https://evil.example')).status, 403);
    const nobody = browser();
    nobody.csrf = admin.csrf;
    assert.equal((await nobody.post('/admin/events', fields)).status, 401);
    const after = await h.pool.query('SELECT count(*)::int AS n FROM event');
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.ok(await lastLog('csrf.fail'));
  });

  test('글은 HTML 로 바뀌어 들어간다 (스크립트가 그대로 나가지 않는다)', async () => {
    const r = await admin.act('/admin/notices', {
      id: 'xss-test',
      kind: 'info',
      title_ko: '<script>alert(1)</script>',
      title_en: '"><img src=x>',
      body_ko: '본문',
      body_en: 'body',
    });
    assert.ok(r.ok, r.text);
    const p = await admin.page();
    assert.doesNotMatch(p.text, /<script>alert/);
    assert.match(p.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.ok((await admin.act('/admin/notices/delete', { id: 'xss-test' })).ok);
  });
});

describe('선물 받기', () => {
  test('동시에 10번 눌러도 한 번만, 장부와 잔액이 같다, 운영 기록', async () => {
    const id = await makeEvent({ coins: 30 });
    const log = await lastLog('event.create');
    assert.equal(log?.target, id);
    assert.equal(log?.detail?.coins, 30);
    const d = await newDevice();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => api('POST', '/v1/claim', { token: d.token, body: { event: id } })),
    );
    const ok = rs.filter((r) => r.status === 200);
    assert.equal(ok.length, 1, JSON.stringify(rs.map((r) => r.status)));
    assert.deepEqual(ok[0]?.body, { balance: 30, coins: 30, tickets: 0 });
    for (const r of rs.filter((x) => x.status !== 200))
      assert.deepEqual([r.status, r.body.error], [409, 'already_claimed']);
    assert.equal(await balanceOf(d.id), 30);
    assert.equal(await ledgerSum(d.id), 30);
  });

  test('없는 이벤트 404, 시작 전, 끝남, 배수 이벤트는 409, 모양이 틀리면 400', async () => {
    const d = await newDevice();
    assert.deepEqual((await api('POST', '/v1/claim', { token: d.token, body: { event: 'nope-1' } })).body, {
      error: 'no_event',
    });
    assert.equal((await api('POST', '/v1/claim', { token: d.token, body: { event: '../x' } })).status, 400);
    assert.equal((await api('POST', '/v1/claim', { body: { event: 'nope-1' } })).status, 401);
    const soon = await makeEvent({ from: Date.now() + 2 * HOUR, until: Date.now() + 5 * HOUR });
    assert.deepEqual((await api('POST', '/v1/claim', { token: d.token, body: { event: soon } })).body, {
      error: 'not_started',
    });
    const ended = await makeEvent();
    assert.ok((await admin.act('/admin/events/end', { id: ended })).ok);
    assert.equal((await lastLog('event.end'))?.target, ended);
    assert.deepEqual((await api('POST', '/v1/claim', { token: d.token, body: { event: ended } })).body, {
      error: 'ended',
    });
    const boost = await makeEvent({
      kind: 'boost',
      reasons: ['focus'],
      from: Date.now() + 100 * 24 * HOUR,
      until: Date.now() + 101 * 24 * HOUR,
    });
    assert.deepEqual((await api('POST', '/v1/claim', { token: d.token, body: { event: boost } })).body, {
      error: 'not_gift',
    });
    assert.match((await admin.act('/admin/events/end', { id: soon })).text, /지웠어요/);
    assert.equal((await h.pool.query('SELECT 1 FROM event WHERE id = $1', [soon])).rowCount, 0);
    assert.match((await admin.act('/admin/events/end', { id: boost })).text, /지웠어요/);
  });

  test('합쳐진 계정은 가족 전체로 한 번', async () => {
    const id = await makeEvent({ coins: 20 });
    const a = await newDevice();
    const b = await newDevice();
    assert.equal((await api('POST', '/v1/claim', { token: a.token, body: { event: id } })).status, 200);
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now(), balance = 0 WHERE id = $1', [
      a.id,
      b.id,
    ]);
    assert.equal(
      (await api('POST', '/v1/claim', { token: b.token, body: { event: id } })).body.error,
      'already_claimed',
    );
  });

  test('운영자 화면의 잘못된 값은 저장하지 않는다', async () => {
    const bad = await admin.act('/admin/events', {
      id: 'bad id!',
      kind: 'gift',
      title_ko: 'a',
      title_en: 'a',
      body_ko: 'b',
      body_en: 'b',
      from: kstInput(Date.now()),
      until: kstInput(Date.now() + HOUR),
      coins: '5000',
    });
    assert.equal(bad.ok, false);
    assert.equal((await h.pool.query(`SELECT 1 FROM event WHERE id = 'bad id!'`)).rowCount, 0);
  });
});

describe('선물과 쿠폰은 로그인 계정만 (rewards_login_only, 버그잡이 #113)', () => {
  test('켜면 기기 토큰은 403 login_required, 세션은 된다. 운영자 쪽지는 기기 계정에도 간다', async () => {
    assert.ok((await admin.act('/admin/rewards/policy', { login_only: '1' })).ok);
    assert.deepEqual((await lastLog('rewards.policy'))?.detail, { before: false, after: true });
    try {
      const id = await makeEvent({ coins: 7 });
      const code = await makeCoupon({ coins: 9 });
      const d = await newDevice('18+');
      for (const [path, body] of [
        ['/v1/claim', { event: id }],
        ['/v1/coupon', { code }],
      ] as const) {
        const r = await api('POST', path, { token: d.token, body });
        assert.deepEqual([r.status, r.body], [403, { error: 'login_required' }], path);
      }
      const s = await session(d.id);
      assert.equal((await api('POST', '/v1/claim', { token: s, body: { event: id } })).status, 200);
      assert.equal((await api('POST', '/v1/coupon', { token: s, body: { code } })).status, 200);
      assert.equal(await balanceOf(d.id), 16);
      assert.ok((await admin.act('/admin/notes', { account: d.code, coins: '1' })).ok);
    } finally {
      assert.ok((await admin.act('/admin/rewards/policy', { login_only: '0' })).ok);
    }
  });
});

describe('배수 이벤트', () => {
  test('출석 x2: 기간 안 날짜만, 상한은 원래 양으로, 까닭이 다르면 그대로', async () => {
    await makeEvent({
      kind: 'boost',
      reasons: ['meet'],
      times: 2,
      from: Date.now() - 2 * HOUR,
      until: Date.now() + 48 * HOUR,
    });
    const d = await newDevice();
    const meet = { id: randomUUID(), reason: 'meet', amount: 10, day: today() };
    const rest = { id: randomUUID(), reason: 'rest', amount: 3, day: today() };
    const r = await api('POST', '/v1/sync', { token: d.token, body: { entries: [meet, rest] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.results[0].applied, 10);
    assert.equal(r.body.results[0].bonus, 10);
    assert.equal(r.body.results[1].bonus, undefined);
    assert.equal(r.body.balance, 23);
    assert.equal(r.body.account.id, Number(d.id));
    assert.equal(r.body.account.code, d.code);
    assert.equal(r.body.inbox, 0);
    const again = { id: randomUUID(), reason: 'meet', amount: 60, day: today() };
    const r2 = await api('POST', '/v1/sync', { token: d.token, body: { entries: [again, meet] } });
    assert.equal(r2.body.results[0].applied, 50);
    assert.equal(r2.body.results[0].bonus, 50);
    assert.equal(r2.body.results[1].duplicate, true);
    assert.equal(r2.body.balance, 23 + 100);
    assert.equal(await ledgerSum(d.id), await balanceOf(d.id));
  });
});

describe('쿠폰', () => {
  test('같은 계정이 동시에 10번 써도 한 번만', async () => {
    const code = await makeCoupon({ coins: 40 });
    assert.equal((await lastLog('coupon.create'))?.detail?.hint, code.slice(0, 4));
    const d = await newDevice();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        api('POST', '/v1/coupon', { token: d.token, body: { code: code.toLowerCase() } }),
      ),
    );
    assert.equal(
      rs.filter((r) => r.status === 200).length,
      1,
      JSON.stringify(rs.map((r) => [r.status, r.body?.error])),
    );
    assert.equal(await balanceOf(d.id), 40);
    assert.equal(await ledgerSum(d.id), 40);
    for (const r of rs.filter((x) => x.status !== 200)) assert.equal(r.body.error, 'already_used');
  });

  test('전체 상한 3: 8 계정이 동시에 써도 정확히 3', async () => {
    const code = await makeCoupon({ coins: 10, max: 3 });
    const ds = await Promise.all(Array.from({ length: 8 }, () => newDevice()));
    const rs = await Promise.all(
      ds.map((d) => api('POST', '/v1/coupon', { token: d.token, body: { code } })),
    );
    assert.equal(rs.filter((r) => r.status === 200).length, 3);
    assert.equal(rs.filter((r) => r.body?.error === 'sold_out').length, 5);
    const c = await h.pool.query('SELECT used, max_uses FROM coupon WHERE hint = $1', [code.slice(0, 4)]);
    assert.deepEqual(c.rows[0], { used: 3, max_uses: 3 });
  });

  test('기간, 끄기, 채팅 이용권은 만 18세 이상만, 코드 원문은 저장하지 않는다', async () => {
    const d = await newDevice('14+');
    const soon = await makeCoupon({ from: Date.now() + HOUR, until: Date.now() + 2 * HOUR });
    assert.equal(
      (await api('POST', '/v1/coupon', { token: d.token, body: { code: soon } })).body.error,
      'not_started',
    );
    const off = await makeCoupon();
    const id = (await h.pool.query('SELECT id FROM coupon WHERE hint = $1', [off.slice(0, 4)])).rows[0].id;
    assert.ok((await admin.act('/admin/coupons/disable', { id: String(id) })).ok);
    assert.equal((await lastLog('coupon.disable'))?.target, `#${id}`);
    assert.equal(
      (await api('POST', '/v1/coupon', { token: d.token, body: { code: off } })).body.error,
      'no_coupon',
    );
    const both = await makeCoupon({ coins: 5, tickets: 3 });
    assert.deepEqual((await api('POST', '/v1/coupon', { token: d.token, body: { code: both } })).body, {
      balance: 5,
      coins: 5,
      tickets: 0,
    });
    const adult = await newDevice('18+');
    assert.deepEqual((await api('POST', '/v1/coupon', { token: adult.token, body: { code: both } })).body, {
      balance: 5,
      coins: 5,
      tickets: 3,
    });
    await h.pool.query(
      `UPDATE coupon SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE hint = $1`,
      [both.slice(0, 4)],
    );
    const late = await newDevice();
    assert.equal(
      (await api('POST', '/v1/coupon', { token: late.token, body: { code: both } })).body.error,
      'ended',
    );
    const dump = await h.pool.query('SELECT code_hash, hint, label FROM coupon');
    assert.ok(!JSON.stringify(dump.rows).includes(both.replaceAll('-', '')));
  });

  test('틀린 코드 5번이면 그 계정은 한 시간 동안 429 (맞는 코드도)', async () => {
    const good = await makeCoupon();
    const d = await newDevice();
    for (let i = 0; i < 4; i++)
      assert.equal(
        (await api('POST', '/v1/coupon', { token: d.token, body: { code: 'ZZZZ-ZZZZ-ZZZZ' } })).body.error,
        'no_coupon',
      );
    assert.equal((await api('POST', '/v1/coupon', { token: d.token, body: { code: 'short' } })).status, 400);
    assert.equal((await api('POST', '/v1/coupon', { token: d.token, body: { code: good } })).status, 429);
    const other = await newDevice();
    assert.equal(
      (await api('POST', '/v1/coupon', { token: other.token, body: { code: good }, ip: ip() })).status,
      200,
    );
  });
});

describe('쪽지 (운영자 지급)', () => {
  test('보낼 때는 잔액이 그대로, 열 때 한 번만 받는다 (동시 열기), 두 기기가 같은 쪽지함, 운영 기록', async () => {
    const d = await newDevice('18+', '쪽지받이');
    const other = await secondDevice(d.id);
    const r = await admin.act('/admin/notes', {
      account: d.code,
      coins: '120',
      chat_passes: '2',
      message: '버그 찾아 줘서 고마워',
    });
    assert.ok(r.ok, r.text);
    assert.equal(await balanceOf(d.id), 0);
    const log = await lastLog('note.send');
    assert.equal(log?.target, `account:${d.id}`);
    assert.deepEqual([log?.detail?.coins, log?.detail?.chatPasses], [120, 2]);
    assert.equal((await api('POST', '/v1/sync', { token: d.token, body: { entries: [] } })).body.inbox, 1);
    const list = await api('GET', '/v1/inbox', { token: d.token });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.unopened, 1);
    const note = list.body.items[0];
    assert.deepEqual(
      {
        kind: note.kind,
        from: note.from,
        message: note.message,
        coins: note.coins,
        chatPasses: note.chatPasses,
        opened: note.opened,
      },
      {
        kind: 'grant',
        from: 'admin',
        message: '버그 찾아 줘서 고마워',
        coins: 120,
        chatPasses: 2,
        opened: null,
      },
    );
    const rs = await Promise.all([
      ...Array.from({ length: 5 }, () => api('POST', `/v1/inbox/${note.id}/open`, { token: d.token })),
      ...Array.from({ length: 5 }, () => api('POST', `/v1/inbox/${note.id}/open`, { token: other })),
    ]);
    const ok = rs.filter((x) => x.status === 200);
    assert.equal(ok.length, 1, JSON.stringify(rs.map((x) => [x.status, x.body?.error])));
    assert.equal(ok[0]?.body.balance, 120);
    assert.equal(ok[0]?.body.chatPasses, 2);
    for (const x of rs.filter((y) => y.status !== 200)) assert.equal(x.body.error, 'already_opened');
    assert.equal(await balanceOf(d.id), 120);
    assert.equal(await ledgerSum(d.id), 120);
    assert.equal(
      (await h.pool.query('SELECT remaining FROM ai_ticket WHERE account_id = $1', [d.id])).rows[0].remaining,
      2,
    );
    const seen = await api('GET', '/v1/inbox', { token: other });
    assert.equal(seen.body.items[0].id, note.id);
    assert.deepEqual(seen.body.items[0].opened, { coins: 120, chatPasses: 2 });
    assert.equal(seen.body.unopened, 0);
  });

  test('남의 쪽지는 404, 만료는 410, 글만 있는 쪽지, 채팅 이용권은 만 18세 이상에게만, 페이지 나누기', async () => {
    const a = await newDevice('14+');
    const b = await newDevice('18+');
    assert.equal((await admin.act('/admin/notes', { account: a.code, chat_passes: '1' })).ok, false);
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '안녕, 운영자야' })).ok);
    const n = (await api('GET', '/v1/inbox', { token: a.token })).body.items[0];
    assert.equal(n.kind, 'notice');
    assert.equal((await api('POST', `/v1/inbox/${n.id}/open`, { token: b.token })).status, 404);
    assert.equal((await api('POST', `/v1/inbox/${n.id}/open`, { token: a.token })).status, 200);
    assert.ok((await admin.act('/admin/notes', { account: a.code, coins: '5', days: '1' })).ok);
    const late = (await api('GET', '/v1/inbox', { token: a.token })).body.items[0];
    await h.pool.query(`UPDATE inbox SET expires_at = now() - interval '1 minute' WHERE id = $1`, [late.id]);
    const ex = await api('POST', `/v1/inbox/${late.id}/open`, { token: a.token });
    assert.deepEqual([ex.status, ex.body.error], [410, 'expired']);
    assert.equal(await balanceOf(a.id), 0);
    for (let i = 0; i < 23; i++)
      await h.pool.query(`INSERT INTO inbox (account_id, kind, message) VALUES ($1, 'notice', $2)`, [
        a.id,
        `n${i}`,
      ]);
    const p1 = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(p1.body.items.length, 20);
    assert.ok(p1.body.next);
    const p2 = await api('GET', `/v1/inbox?before=${p1.body.next}`, { token: a.token });
    assert.equal(p2.body.items.length, 5);
    assert.equal(p2.body.next, null);
    assert.ok(p2.body.items.every((x: { id: number }) => x.id < p1.body.next));
  });
});

describe('정적 파일 내보내기', () => {
  test('events.json 과 notices.json 을 앱의 읽기 코드가 하나도 버리지 않는다 (scripts/site-feeds.mjs)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-feeds-'));
    const run = () =>
      new Promise<{ status: number; stdout: string; stderr: string }>((resolve) =>
        execFile(
          process.execPath,
          [join(ROOT, 'scripts', 'site-feeds.mjs'), '--api', h.base, '--site', dir],
          { encoding: 'utf8' },
          (err, stdout, stderr) => resolve({ status: err ? Number(err.code ?? 1) : 0, stdout, stderr }),
        ),
      );
    try {
      writeFileSync(join(dir, 'notices.json'), '{"version":1,"notices":[]}\n');
      const ev = await api('GET', '/v1/events.json', { ip: ip() });
      assert.equal(ev.status, 200);
      assert.equal(ev.headers.get('cache-control'), 'public, max-age=60');
      assert.equal(ev.body.version, 1);
      assert.ok(ev.body.events.length > 0);
      await h.pool.query(`DELETE FROM site_doc`);
      assert.equal((await api('GET', '/v1/notices.json', { ip: ip() })).status, 404);
      let out = await run();
      assert.equal(out.status, 0, out.stderr + out.stdout);
      assert.match(out.stdout, /바뀜: site\/events.json/);
      assert.match(out.stdout, /notices: 서버가 관리하지 않음/);
      assert.equal(readFileSync(join(dir, 'notices.json'), 'utf8'), '{"version":1,"notices":[]}\n');

      const n = await admin.act('/admin/notices', {
        id: '2026-10-event-1',
        kind: 'important',
        title_ko: '점검 안내',
        title_en: 'Maintenance',
        body_ko: '오늘 밤 잠깐 서버를 쉬어.\n코인은 그대로야.',
        body_en: 'The server rests tonight.',
        link: 'https://fairy.moilga.com/news/1',
        from: kstInput(Date.now() - HOUR),
        until: kstInput(Date.now() + 48 * HOUR),
        versions: '<0.9.0',
        platforms: 'darwin,win32',
      });
      assert.ok(n.ok, n.text);
      assert.equal((await lastLog('notice.create'))?.target, '2026-10-event-1');
      const force = {
        id: 'force-1',
        kind: 'force',
        title_ko: 'a',
        title_en: 'a',
        body_ko: 'b',
        body_en: 'b',
      };
      assert.match((await admin.act('/admin/notices', force)).text, /확인 칸/);
      assert.ok((await admin.act('/admin/notices', { ...force, confirm: 'yes' })).ok);
      assert.ok((await admin.act('/admin/notices/delete', { id: 'force-1' })).ok);
      assert.match(
        (await admin.act('/admin/versions', { minVersion: '0.4.2', recommendVersion: '' })).text,
        /확인 칸/,
      );
      const tooHigh = await admin.act('/admin/versions', {
        minVersion: '0.5.0',
        recommendVersion: '',
        confirm: 'yes',
      });
      assert.equal(tooHigh.ok, false);
      assert.match(tooHigh.text, /최신 릴리스 0\.4\.3/);
      const v = await admin.act('/admin/versions', {
        minVersion: '0.4.2',
        recommendVersion: '0.4.3',
        confirm: 'yes',
      });
      assert.ok(v.ok, v.text);
      assert.deepEqual((await lastLog('versions'))?.detail?.after, {
        minVersion: '0.4.2',
        recommendVersion: '0.4.3',
      });
      const link = await admin.act('/admin/notices', {
        id: 'bad-link',
        kind: 'info',
        title_ko: 'a',
        title_en: 'a',
        body_ko: 'b',
        body_en: 'b',
        link: 'https://evil.example/x',
      });
      assert.equal(link.ok, false);

      out = await run();
      assert.equal(out.status, 0, out.stderr + out.stdout);
      assert.match(out.stdout, /바뀜: site\/notices.json/);
      const notices = JSON.parse(readFileSync(join(dir, 'notices.json'), 'utf8'));
      assert.equal(notices.minVersion, '0.4.2');
      assert.equal(notices.recommendVersion, '0.4.3');
      assert.equal(notices.notices[0].from.endsWith('+09:00'), true);
      assert.deepEqual(notices.notices[0].platforms, ['darwin', 'win32']);
      out = await run();
      assert.match(out.stdout, /바뀐 것 없음/);

      // 앱이 버릴 것이 섞이면 아무 파일도 쓰지 않고 실패 (DB 를 직접 망가뜨려 흉내)
      await h.pool.query(
        `UPDATE site_doc SET body = jsonb_set(body, '{notices}', body->'notices' || '[{"id":"x","kind":"weird","title":{"ko":"a","en":"a"},"body":{"ko":"b","en":"b"}}]')`,
      );
      await h.pool.query(`UPDATE site_doc SET body = jsonb_set(body, '{minVersion}', '"0.4.1"')`);
      out = await run();
      assert.equal(out.status, 1, out.stdout);
      assert.match(out.stderr, /검사 실패/);
      assert.equal(JSON.parse(readFileSync(join(dir, 'notices.json'), 'utf8')).minVersion, '0.4.2');
    } finally {
      latestTag = 'v0.4.3';
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('운영자 화면 꺼짐', () => {
  test('ADMIN_TOKEN 이 짧으면 503, 로그인 폼도 없다', async () => {
    const saved = h.config.adminToken;
    h.config.adminToken = 'short';
    try {
      const r = await api('GET', '/admin');
      assert.equal(r.status, 503);
      assert.doesNotMatch(r.text, /<form/);
      assert.equal((await browser().login('short')).status, 503);
    } finally {
      h.config.adminToken = saved;
    }
  });
});
