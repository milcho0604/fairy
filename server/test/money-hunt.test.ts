// 통합 시험: 버그잡이로 찾은 서버 돈과 쪽지 결함의 고침.
// 요청 번호 멱등(앱 지급, 쪽지), 이용권 쪽지를 열 때 18+ 다시 보기, 친구 선물을 열 때 나이 구분과 친구 관계 다시 보기,
// 관리자 API 의 배열 칸, 시간대 없는 기간 글. 시험용 Postgres 컨테이너를 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { parseKstInput } from '../src/notice-doc';
import { AdminBrowser, client, type Harness, ip, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const E = ('every' + 'one') as 'everyone';
let h: Harness;
const { api, newDevice, session, balanceOf } = client(() => h);
let admin: AdminBrowser;

before(async () => {
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    features: { friends: E, friend_gifts: E, friend_calendar: E },
  });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
});
after(async () => {
  await h?.stop();
});

const notes = async (id: string) =>
  Number((await h.pool.query('SELECT count(*) AS n FROM inbox WHERE account_id = $1', [id])).rows[0].n);
const cj = (path: string, body: unknown) =>
  api('POST', path, { headers: { cookie: admin.cookie, origin: h.base, 'x-csrf-token': admin.csrf }, body });
const rid = () => randomUUID().replaceAll('-', '');

describe('요청 번호 멱등', () => {
  test('앱 지급: 같은 요청 번호 20개는 쪽지 한 장, 운영 기록도 한 번', async () => {
    const a = await newDevice('18+', '중복지급');
    const body = { accounts: a.code, coins: '5', days: '10', reason: 'x', confirm: 'yes', request_id: rid() };
    const rs = await Promise.all(Array.from({ length: 20 }, () => cj('/v1/admin/grants/batch', body)));
    assert.ok(
      rs.every((r) => r.status === 200),
      rs.map((r) => r.status).join(),
    );
    assert.equal(await notes(a.id), 1);
    const log = await h.pool.query(
      `SELECT count(*)::int AS n FROM admin_log WHERE action = 'note.send' AND target = $1`,
      [`account:${a.id}`],
    );
    assert.equal(log.rows[0].n, 1);
  });

  test('쪽지: 같은 요청 번호 20개는 쪽지 한 장, 다른 번호는 각각', async () => {
    const a = await newDevice('18+', '중복쪽지');
    const body = { account: a.code, coins: '5', message: 'm', request_id: rid() };
    const rs = await Promise.all(Array.from({ length: 20 }, () => cj('/v1/admin/notes', body)));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(await notes(a.id), 1);
    assert.equal((await cj('/v1/admin/notes', { ...body, request_id: rid() })).status, 200);
    assert.equal(await notes(a.id), 2);
  });

  test('웹 POST /admin/notes 도 같은 요청 번호면 한 장', async () => {
    const a = await newDevice('18+', '웹쪽지');
    const f = { account: a.code, coins: '3', message: 'w', confirm: 'yes', request_id: rid() };
    await admin.post('/admin/notes', f);
    await admin.post('/admin/notes', f);
    assert.equal(await notes(a.id), 1);
  });

  test('요청 번호가 없으면 예전처럼 매번 쓴다, 틀린 번호는 400', async () => {
    const a = await newDevice('18+', '번호없음');
    const body = { account: a.code, coins: '5', message: 'm' };
    await cj('/v1/admin/notes', body);
    await cj('/v1/admin/notes', body);
    assert.equal(await notes(a.id), 2);
    assert.equal((await cj('/v1/admin/notes', { ...body, request_id: 'a b' })).status, 400);
  });

  test('거절된 요청은 번호를 쓰지 않는다 (같은 번호로 고쳐 다시 보낼 수 있다)', async () => {
    const a = await newDevice('14+', '거절후');
    const id = rid();
    const bad = { account: a.code, chat_passes: '2', message: 'm', request_id: id };
    assert.equal((await cj('/v1/admin/notes', bad)).status, 400);
    assert.equal((await cj('/v1/admin/notes', { ...bad, chat_passes: '0', coins: '2' })).status, 200);
    assert.equal(await notes(a.id), 1);
  });
});

describe('관리자 API 배열 칸', () => {
  test('문자열 칸에 배열이나 객체를 보내면 500 이 아니라 400', async () => {
    const a = await newDevice('18+', '배열');
    const base = { accounts: a.code, coins: '5', days: '10', reason: 'x', confirm: 'yes' };
    for (const k of ['accounts', 'coins', 'chat_passes', 'reason', 'days', 'people', 'request_id']) {
      for (const v of [['1', '2']]) {
        const r = await cj('/v1/admin/grants/batch', { ...base, [k]: v });
        assert.equal(r.status, 400, `${k} ${JSON.stringify(v)} -> ${r.status} ${r.text.slice(0, 80)}`);
      }
    }
    for (const k of ['account', 'coins', 'chat_passes', 'message', 'days']) {
      const r = await cj('/v1/admin/notes', { account: a.code, coins: '5', message: 'm', [k]: ['5', '6'] });
      assert.equal(r.status, 400, `notes ${k} -> ${r.status}`);
    }
    const ev = {
      id: 'arr-ev',
      kind: 'gift',
      title_ko: 't',
      title_en: 't',
      body_ko: 'b',
      body_en: 'b',
      coins: '5',
      from: '2030-01-01T00:00',
      until: '2030-02-01T00:00',
    };
    for (const k of ['title_ko', 'body_en', 'id', 'kind', 'coins', 'from', 'until']) {
      const r = await cj('/v1/admin/events', { ...ev, [k]: ['x'] });
      assert.equal(r.status, 400, `events ${k} -> ${r.status}`);
    }
    for (const k of ['title', 'body']) {
      const r = await cj('/v1/admin/notices', {
        id: 'arr-n',
        kind: 'info',
        title: 't',
        body: 'b',
        [k]: ['x'],
      });
      assert.equal(r.status, 400, `notices ${k} -> ${r.status}`);
    }
    assert.equal(await notes(a.id), 0);
  });

  test('이벤트 reasons 는 여전히 배열을 받는다', async () => {
    const r = await cj('/v1/admin/events', {
      id: 'boost-ok',
      kind: 'boost',
      title_ko: 't',
      title_en: 't',
      body_ko: 'b',
      body_en: 'b',
      reasons: ['meet', 'focus'],
      times: '2',
      from: '2030-01-01T00:00',
      until: '2030-02-01T00:00',
    });
    assert.equal(r.status, 200, r.text);
  });
});

describe('이용권 쪽지를 열 때 18+ 다시 보기', () => {
  async function opened(kind: 'grant' | 'subscription', teen: boolean) {
    const a = await newDevice('18+', kind === 'grant' ? '나이지급' : '나이정기');
    if (kind === 'grant') {
      const r = await cj('/v1/admin/notes', { account: a.code, coins: '4', chat_passes: '3', message: 'p' });
      assert.equal(r.status, 200, r.text);
    } else {
      await h.pool.query(
        `INSERT INTO inbox (account_id, kind, coins, chat_passes, fill_to, expires_at) VALUES ($1, 'subscription', 0, 5, 5, now() + interval '1 day')`,
        [a.id],
      );
    }
    if (teen)
      assert.equal((await api('PATCH', '/v1/account', { token: a.token, body: { age: '14+' } })).status, 200);
    const box = await api('GET', '/v1/inbox', { token: a.token });
    const o = await api('POST', `/v1/inbox/${box.body.items[0].id}/open`, { token: a.token });
    return { a, o };
  }

  test('운영자 지급: 보낸 뒤 14+ 로 바꾸면 이용권 0, 코인은 준다, 운영 기록에 남는다', async () => {
    const { a, o } = await opened('grant', true);
    assert.equal(o.status, 200, o.text);
    assert.equal(o.body.chatPasses, 0);
    assert.equal(o.body.item.opened.chatPasses, 0);
    assert.equal(o.body.item.opened.coins, 4);
    assert.equal(await balanceOf(a.id), 4);
    const log = await h.pool.query(
      `SELECT detail FROM admin_log WHERE action = 'note.passes_skipped' AND target = $1`,
      [`account:${a.id}`],
    );
    assert.equal(log.rowCount, 1);
    assert.equal(log.rows[0].detail.passes, 3);
  });

  test('정기 지급(subscription): 14+ 이면 이용권 0', async () => {
    const { o } = await opened('subscription', true);
    assert.equal(o.status, 200, o.text);
    assert.equal(o.body.chatPasses, 0);
  });

  test('18+ 그대로면 이용권을 준다 (운영 기록 없음)', async () => {
    const { a, o } = await opened('grant', false);
    assert.equal(o.body.chatPasses, 3);
    const log = await h.pool.query(
      `SELECT 1 FROM admin_log WHERE action = 'note.passes_skipped' AND target = $1`,
      [`account:${a.id}`],
    );
    assert.equal(log.rowCount, 0);
  });
});

describe('친구 선물을 열 때 나이 구분과 친구 관계 다시 보기', () => {
  async function pair() {
    const mk = async () => {
      const d = await newDevice('18+', `친구${Math.floor(Math.random() * 900 + 100)}`);
      return { id: d.id, code: d.code, token: await session(d.id) };
    };
    const a = await mk();
    const b = await mk();
    const r = await api('POST', '/v1/friends/requests', { token: a.token, ip: ip(), body: { code: b.code } });
    assert.equal(r.status, 201, r.text);
    const ok = await api('POST', `/v1/friends/requests/${r.body.request.id}/accept`, {
      token: b.token,
      ip: ip(),
    });
    assert.equal(ok.status, 200);
    await h.pool.query('UPDATE account SET balance = 100 WHERE id = $1', [a.id]);
    const g = await api('POST', '/v1/friends/gifts', {
      token: a.token,
      ip: ip(),
      body: { to: b.code, coins: 7, passes: 0, requestId: rid() },
    });
    assert.equal(g.status, 200, g.text);
    const box = await api('GET', '/v1/inbox', { token: b.token });
    return { a, b, noteId: box.body.items.find((i: { kind: string }) => i.kind === 'gift').id as number };
  }

  test('받는 사람이 나이 구분을 바꾸면 열 수 없고 코인은 보낸 사람에게 돌아간다', async () => {
    const { a, b, noteId } = await pair();
    await h.pool.query(`UPDATE account SET age = '14+' WHERE id = $1`, [b.id]);
    const rs = await Promise.all(
      [1, 2, 3].map(() => api('POST', `/v1/inbox/${noteId}/open`, { token: b.token })),
    );
    assert.ok(
      rs.every((r) => r.status === 410),
      rs.map((r) => r.status).join(),
    );
    assert.equal(await balanceOf(b.id), 0);
    assert.equal(await balanceOf(a.id), 100);
    const back = (await api('GET', '/v1/inbox', { token: a.token })).body.items.filter(
      (i: { kind: string }) => i.kind === 'gift_back',
    );
    assert.equal(back.length, 1);
    assert.equal(back[0].coins, 7);
  });

  test('더는 친구가 아니면(끊김) 열 수 없고 돌아간다', async () => {
    const { a, b, noteId } = await pair();
    await h.pool.query(
      'DELETE FROM friend WHERE (account_id = $1 AND friend_id = $2) OR (account_id = $2 AND friend_id = $1)',
      [a.id, b.id],
    );
    const o = await api('POST', `/v1/inbox/${noteId}/open`, { token: b.token });
    assert.equal(o.status, 410, o.text);
    assert.equal(await balanceOf(b.id), 0);
    assert.equal(await balanceOf(a.id), 100);
  });

  test('나이 구분이 같고 친구면 그대로 받는다', async () => {
    const { a, b, noteId } = await pair();
    const o = await api('POST', `/v1/inbox/${noteId}/open`, { token: b.token });
    assert.equal(o.status, 200, o.text);
    assert.equal(await balanceOf(b.id), 7);
    assert.equal(await balanceOf(a.id), 93);
  });
});

describe('시간대 없는 기간 글은 한국 시간', () => {
  test('parseKstInput 은 서버 시간대와 상관없이 +09:00 으로 읽는다', () => {
    const was = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Seoul']) {
        process.env.TZ = tz;
        const want = Date.parse('2030-12-31T23:59:00+09:00');
        assert.equal(parseKstInput('2030-12-31 23:59'), want, tz);
        assert.equal(parseKstInput('2030-12-31T23:59'), want, tz);
        assert.equal(parseKstInput('2030-12-31T23:59:00'), want, tz);
        assert.equal(parseKstInput('2030-12-31'), Date.parse('2030-12-31T00:00:00+09:00'), tz);
        assert.equal(parseKstInput('2030-12-31T23:59:00Z'), Date.parse('2030-12-31T23:59:00Z'), tz);
        assert.equal(parseKstInput('2030-12-31T23:59:00+01:00'), Date.parse('2030-12-31T23:59:00+01:00'), tz);
        assert.ok(Number.isNaN(parseKstInput('아무말') as number));
      }
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });

  test('쿠폰 until 공백 모양도 KST', async () => {
    const r = await cj('/v1/admin/coupons', {
      label: 'tz',
      coins: '5',
      max_uses: '5',
      from: '2030-01-01 00:00',
      until: '2030-12-31 23:59',
    });
    assert.equal(r.status, 200, r.text);
    const row = (await h.pool.query('SELECT ends_at FROM coupon ORDER BY id DESC LIMIT 1')).rows[0];
    assert.equal(new Date(row.ends_at).toISOString(), '2030-12-31T14:59:00.000Z');
  });
});
