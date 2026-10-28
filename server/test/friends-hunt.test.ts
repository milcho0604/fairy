// 버그잡이 재현 시험 (PR #135, #110 1부): 거절 뒤 거두고 다시 보내기, 차단 응답의 닉네임, 없는 코드 제한 우회,
// 기기 토큰의 모두 지우기(허용), 선물 동시성, 합치기와 나이 바꾸기의 신청 쪽지, 로그아웃 뒤 바쁜 시간, 0006 이 0007, 0008 뒤에,
// 선물 양 검사와 쪽지 열기. 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { Accounts } from '../src/accounts';
import { Db } from '../src/db';
import { client, type Harness, ip, startHarness } from './helpers';
import { runMigrations, startPg } from './pg';

let h: Harness;
const { api, newDevice, session, balanceOf } = client(() => h);
interface User {
  id: string;
  code: string;
  token: string;
  device: string;
}
async function user(age: '14+' | '18+' = '18+', nickname?: string): Promise<User> {
  const d = await newDevice(age, nickname ?? `친구${Math.floor(Math.random() * 900 + 100)}`);
  return { id: d.id, code: d.code, token: await session(d.id), device: d.token };
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

before(async () => {
  h = await startHarness({
    features: { friends: 'everyone', friend_gifts: 'everyone', friend_calendar: 'everyone' },
  });
});
after(async () => {
  await h?.stop();
});

describe('신청', () => {
  test('거절된 신청은 보낸 쪽이 거둬도 만료까지 남아 다시 보내지 못한다', async () => {
    const a = await user();
    const b = await user();
    const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    const id = r.body.request.id;
    assert.equal((await call(b, 'POST', `/v1/friends/requests/${id}/decline`)).status, 204);
    const out = (await call(a, 'GET', '/v1/friends')).body.outgoing;
    assert.equal(out[0].id, id, '보낸 쪽은 거절된 신청 번호를 안다');
    const c = await call(a, 'DELETE', `/v1/friends/requests/${id}`);
    const again = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    const notes = (await inboxOf(b)).filter(
      (i: { kind: string; openedAt: string | null }) => i.kind === 'friend' && !i.openedAt,
    );
    assert.equal(
      again.status,
      409,
      `거두기 ${c.status} 뒤 다시 신청 ${again.status}, 안 연 신청 쪽지 ${notes.length}`,
    );
  });

  test('차단 응답에 상대 닉네임이 없다 (친구가 아니고 나이 구분이 달라도 닉네임을 읽지 못한다)', async () => {
    const adult = await user('18+');
    const teen = await user('14+', '김민지진짜이름');
    const req = await call(adult, 'POST', '/v1/friends/requests', { code: teen.code });
    assert.equal(req.body.error, 'unavailable');
    const r = await call(adult, 'POST', '/v1/friends/blocks', { code: teen.code });
    assert.equal(r.body?.blocked?.nickname ?? null, null, `차단 응답: ${r.text}`);
  });

  test('코드를 받는 다른 경로(차단 풀기)도 없는 코드 제한을 함께 센다', async () => {
    const a = await user();
    const real = await user();
    const fake = () =>
      `F-${'ZZZZ'}-${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()
        .replace(/[ILOU]/g, '9')
        .padEnd(4, '9')}`;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) seen.push((await call(a, 'DELETE', `/v1/friends/blocks/${fake()}`)).status);
    const hit = (await call(a, 'DELETE', `/v1/friends/blocks/${real.code}`)).status;
    assert.ok(seen.includes(429), `없는 코드 30번: ${[...new Set(seen)]} / 있는 코드: ${hit}`);
  });

  test('기기 토큰으로도 DELETE /v1/friends/calendar 는 된다 (자기 것 지우기라 일부러 허용, 계약에 적음)', async () => {
    const a = await user();
    const r = await api('DELETE', '/v1/friends/calendar', { token: a.device, ip: ip() });
    assert.equal(r.status, 204, `기기 토큰 ${r.status}`);
  });
});

describe('선물 동시성', () => {
  test('다른 requestId 20개 동시: 잔액 음수 없음, 상한 500, 장부 양쪽 맞음', async () => {
    const a = await user();
    const bs = await Promise.all(Array.from({ length: 4 }, () => user()));
    for (const b of bs) await befriend(a, b);
    await h.pool.query('UPDATE account SET balance = 300 WHERE id = $1', [a.id]);
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(a, 'POST', '/v1/friends/gifts', { to: bs[i % 4]?.code, coins: 40, requestId: rid() }),
      ),
    );
    const ok = rs.filter((r) => r.status === 200).length;
    assert.ok(
      rs.every((r) => r.status === 200 || r.status === 409),
      rs.map((r) => r.status).join(','),
    );
    assert.equal(await balanceOf(a.id), 300 - 40 * ok);
    assert.equal(ok, 7);
    const led = await h.pool.query(
      `SELECT COALESCE(sum(amount),0)::int AS s FROM coin_entry WHERE account_id=$1 AND reason='gift_out'`,
      [a.id],
    );
    assert.equal(led.rows[0].s, -40 * ok);
  });

  test('같은 requestId 20개 동시 (다른 받는 사람 섞음): 한 번만', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    await befriend(a, b);
    await befriend(a, c);
    await h.pool.query('UPDATE account SET balance = 1000 WHERE id = $1', [a.id]);
    const id = rid();
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(a, 'POST', '/v1/friends/gifts', { to: (i % 2 ? b : c).code, coins: 10, requestId: id }),
      ),
    );
    assert.ok(
      rs.every((r) => r.status === 200),
      rs.map((r) => r.status).join(','),
    );
    assert.equal(await balanceOf(a.id), 990);
  });
});

describe('합치기와 나이', () => {
  const merge = (from: User, into: User) =>
    h.app.get(Db).tx(async (c) => {
      const accounts = h.app.get(Accounts);
      const [f, i] = await accounts.lockPair(c, from.id, into.id);
      await accounts.merge(c, f, i);
    });

  test('합쳐서 옮겨진 신청을 수락하면 그 신청 쪽지도 열린다', async () => {
    const z = await user();
    const x = await user();
    const keep = await user();
    await call(z, 'POST', '/v1/friends/requests', { code: x.code });
    await merge(x, keep);
    const inc = (await call(keep, 'GET', '/v1/friends')).body.incoming;
    assert.equal((await call(keep, 'POST', `/v1/friends/requests/${inc[0].id}/accept`)).status, 200);
    const left = (await inboxOf(keep)).filter(
      (i: { kind: string; openedAt: string | null }) => i.kind === 'friend' && !i.openedAt,
    );
    assert.equal(left.length, 0, '수락했는데 신청 쪽지가 안 열림');
  });

  test('나이를 바꿔 신청이 걷히면 상대의 안 연 신청 쪽지도 지운다', async () => {
    const a = await user('18+');
    const b = await user('18+');
    await call(a, 'POST', '/v1/friends/requests', { code: b.code });
    const r = await api('PATCH', '/v1/account', { token: a.token, body: { age: '14+' }, ip: ip() });
    assert.equal(r.status, 200, r.text);
    assert.equal((await call(b, 'GET', '/v1/friends')).body.incoming.length, 0);
    const left = (await inboxOf(b)).filter(
      (i: { kind: string; openedAt: string | null }) => i.kind === 'friend' && !i.openedAt,
    );
    assert.equal(left.length, 0, '나이 다른 사람의 신청 쪽지가 남음');
  });

  test('로그아웃하면 친구가 바쁜 시간을 더는 못 본다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    assert.equal((await call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share: true })).status, 200);
    const t = Date.now();
    assert.equal(
      (
        await call(a, 'PUT', '/v1/friends/calendar/busy', {
          blocks: [{ start: t + 3600e3, end: t + 7200e3 }],
        })
      ).status,
      200,
    );
    const out = await api('DELETE', '/v1/session', { token: a.token, ip: ip() });
    const seen = await call(b, 'GET', `/v1/friends/${a.code}/busy`);
    assert.equal(seen.status, 404, `로그아웃 ${out.status} 뒤 친구 보기 ${seen.status} ${seen.text}`);
  });
});

describe('마이그레이션 0006 이 0007, 0008 뒤에', () => {
  test('운영 순서(0001~0005, 0007, 0008 적용)에서 migrate 가 0006 을 적용한다', async () => {
    const p = await startPg();
    try {
      const dir = join(__dirname, '..', '..', 'db', 'migrations');
      const c = new pg.Client({ connectionString: p.databaseUrl });
      await c.connect();
      await c.query(
        'CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
        // 0016, 0017, 0018 은 0006 의 표와 칸에 기대므로 0006 과 함께 migrate 가 적용한다
        if (['0006', '0016', '0017', '0018'].some((n) => f.startsWith(n))) continue;
        await c.query(await readFile(join(dir, f), 'utf8'));
        await c.query('INSERT INTO _migrations (name) VALUES ($1)', [f]);
      }
      await runMigrations(p.databaseUrl);
      const r = await c.query(`SELECT name FROM _migrations WHERE name LIKE '0006%'`);
      assert.equal(r.rowCount, 1);
      const later = await c.query(`SELECT name FROM _migrations WHERE name LIKE '0016%'`);
      assert.equal(later.rowCount, 1);
      const visit = await c.query(`SELECT name FROM _migrations WHERE name LIKE '0017%'`);
      assert.equal(visit.rowCount, 1);
      const idx = await c.query(`SELECT name FROM _migrations WHERE name LIKE '0018%'`);
      assert.equal(idx.rowCount, 1);
      const t = await c.query(
        `SELECT to_regclass('friend') AS t, to_regclass('busy_block') AS b, to_regclass('busy_title') AS bt`,
      );
      assert.ok(t.rows[0].t && t.rows[0].b && t.rows[0].bt);
      await c.end();
    } finally {
      p.stop();
    }
  });
});

describe('선물 입력과 열기', () => {
  test('양 검사: 음수, 소수, 문자열, 큰 값, 0+0, -0', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await h.pool.query('UPDATE account SET balance = 1000 WHERE id = $1', [a.id]);
    const bad: unknown[] = [
      -1,
      1.5,
      '10',
      501,
      1e300,
      Number.MAX_SAFE_INTEGER + 2,
      null,
      true,
      [5],
      { n: 1 },
    ];
    for (const coins of bad) {
      const r = await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins, requestId: rid() });
      assert.equal(r.status, 400, `coins=${JSON.stringify(coins)} → ${r.status}`);
    }
    for (const passes of [-1, 0.5, 6, '1']) {
      const r = await call(a, 'POST', '/v1/friends/gifts', {
        to: b.code,
        coins: 1,
        passes,
        requestId: rid(),
      });
      assert.equal(r.status, 400, `passes=${JSON.stringify(passes)} → ${r.status}`);
    }
    const z = await call(a, 'POST', '/v1/friends/gifts', {
      to: b.code,
      coins: 0,
      passes: 0,
      requestId: rid(),
    });
    assert.equal(z.status, 400);
    const neg0 = await api('POST', '/v1/friends/gifts', {
      token: a.token,
      ip: ip(),
      body: `{"to":"${b.code}","coins":-0,"requestId":"${rid()}"}`,
    });
    assert.equal(neg0.status, 400, neg0.text);
    assert.equal(await balanceOf(a.id), 1000);
  });

  test('선물 쪽지를 동시에 20번 열기: 한 번만', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await h.pool.query('UPDATE account SET balance = 100 WHERE id = $1', [a.id]);
    assert.equal(
      (await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 70, requestId: rid() })).status,
      200,
    );
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => call(b, 'POST', `/v1/inbox/${note.id}/open`)),
    );
    assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join(','));
    assert.equal(await balanceOf(b.id), 70);
  });

  test('남의 선물 쪽지 열기 404', async () => {
    const a = await user();
    const b = await user();
    const m = await user();
    await befriend(a, b);
    await h.pool.query('UPDATE account SET balance = 100 WHERE id = $1', [a.id]);
    await call(a, 'POST', '/v1/friends/gifts', { to: b.code, coins: 5, requestId: rid() });
    const note = (await inboxOf(b)).find((i: { kind: string }) => i.kind === 'gift');
    assert.equal((await call(m, 'POST', `/v1/inbox/${note.id}/open`)).status, 404);
    assert.equal((await call(a, 'POST', `/v1/inbox/${note.id}/open`)).status, 404);
  });
});
