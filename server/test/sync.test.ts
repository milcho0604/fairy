// 통합 시험 (docs/sync-plan.md 5절): 기기 간 동기화 서버. 세션 전용, 기능 키, 열쇠 첫 저장/409/ver 로 바꾸기,
// changes 순서와 more, push 성공과 conflict, 같은 uid 동시 push, 상한 413, blob 256KB, 본문 4MB, 지운 항목 남기기,
// DELETE, 탈퇴 CASCADE, 계정 합치기, 1년 정리.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Accounts } from '../src/accounts';
import { Features } from '../src/features';
import { LIMITS } from '../src/rate-limit';
import { SYNC_BLOB_MAX, SYNC_MAX_BYTES, SYNC_MAX_ITEMS, Sync } from '../src/sync';
import { client, type Harness, ip, startHarness } from './helpers';

const DAY = 86_400_000;
let h: Harness;
const { api, newDevice, session } = client(() => h);

before(async () => {
  h = await startHarness({ features: { sync: 'everyone' } });
});
after(async () => {
  await h?.stop();
});

interface User {
  id: string;
  device: string;
  token: string;
  /** 기기가 아는 epoch (열쇠를 올릴 때 받는다) */
  epoch: number;
}

const user = async (): Promise<User> => {
  const d = await newDevice();
  return { id: d.id, device: d.token, token: await session(d.id), epoch: 0 };
};
const call = (u: User, method: string, path: string, body?: unknown) =>
  api(method, path, { token: u.token, ip: ip(), ...(body === undefined ? {} : { body }) });
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const uid = () => randomBytes(16).toString('hex');
const KEY = { salt: b64(randomBytes(16)), params: { N: 16384, r: 8, p: 1 }, wrapped: b64(randomBytes(60)) };
const withKey = async (): Promise<User> => {
  const u = await user();
  const r = await call(u, 'PUT', '/v1/sync/key', KEY);
  assert.equal(r.status, 200, r.text);
  u.epoch = r.body.epoch;
  return u;
};
const item = (id: string, base: number, text: string | Buffer = 'x', deleted = false) => ({
  uid: id,
  base,
  blob: b64(text),
  deleted,
});
const push = (u: User, items: unknown[]) => call(u, 'POST', '/v1/sync/push', { epoch: u.epoch, items });
const chg = (u: User, q = '') => call(u, 'GET', `/v1/sync/changes?epoch=${u.epoch}${q ? `&${q}` : ''}`);
const count = async (sql: string, id: string) => Number((await h.pool.query(sql, [id])).rows[0]?.n);
const rows = (id: string) => count('SELECT count(*)::int AS n FROM sync_item WHERE account_id = $1', id);

describe('문 지키기', () => {
  test('기기 토큰, 토큰 없음은 막는다 (403 login, 401)', async () => {
    const u = await user();
    for (const [m, p] of [
      ['GET', '/v1/sync/status'],
      ['GET', '/v1/sync/key'],
      ['PUT', '/v1/sync/key'],
      ['GET', '/v1/sync/changes'],
      ['POST', '/v1/sync/push'],
      ['DELETE', '/v1/sync'],
    ] as const) {
      const r = await api(m, p, { token: u.device, ip: ip(), body: m === 'GET' ? undefined : {} });
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.deepEqual(r.body, { error: 'login' });
      assert.equal((await api(m, p, { ip: ip() })).status, 401);
    }
  });

  test('기능 키가 꺼지면 403 feature_off, allowlist 는 허용 계정만', async () => {
    const f = h.app.get(Features);
    const u = await user();
    await f.setFeatureMode('sync', 'off');
    try {
      for (const [m, p] of [
        ['GET', '/v1/sync/status'],
        ['POST', '/v1/sync/push'],
      ] as const) {
        const r = await call(u, m, p, m === 'GET' ? undefined : { items: [] });
        assert.equal(r.status, 403);
        assert.deepEqual(r.body, { error: 'feature_off', feature: 'sync' });
      }
      await f.setFeatureMode('sync', 'allowlist');
      assert.equal((await call(u, 'GET', '/v1/sync/status')).status, 403);
      await f.allowAccount('sync', u.id);
      assert.equal((await call(u, 'GET', '/v1/sync/status')).status, 200);
    } finally {
      await f.setFeatureMode('sync', 'everyone');
    }
  });
});

describe('열쇠', () => {
  test('없으면 404 none, 첫 저장은 그대로 돌려받고, 두 번째는 409', async () => {
    const u = await user();
    const none = await call(u, 'GET', '/v1/sync/key');
    assert.equal(none.status, 404);
    assert.deepEqual(none.body, { error: 'none' });
    const put = await call(u, 'PUT', '/v1/sync/key', KEY);
    assert.equal(put.status, 200);
    assert.deepEqual({ ...put.body, epoch: 0 }, { epoch: 0, gen: 1, key_rev: 1, created: true });
    assert.ok(put.body.epoch >= 1);
    const got = await call(u, 'GET', '/v1/sync/key');
    assert.deepEqual(got.body, { ...KEY, gen: 1, key_rev: 1, epoch: put.body.epoch });
    const again = await call(u, 'PUT', '/v1/sync/key', { ...KEY, wrapped: b64(randomBytes(60)) });
    assert.equal(again.status, 409);
    assert.deepEqual(again.body, { error: 'key_exists', epoch: put.body.epoch, gen: 1, key_rev: 1 });
    assert.deepEqual(
      (await call(u, 'GET', '/v1/sync/key')).body.wrapped,
      KEY.wrapped,
      '409 는 아무것도 바꾸지 않는다',
    );
  });

  test('복구 코드 새로 만들기: gen 은 그대로, key_rev 가 같을 때만 다시 감싸고 key_rev+1. 항목은 그대로', async () => {
    const u = await withKey();
    await push(u, [item(uid(), 0)]);
    const next = {
      salt: b64(randomBytes(16)),
      params: { N: 32768, r: 8, p: 1 },
      wrapped: b64(randomBytes(60)),
    };
    const r = await call(u, 'PUT', '/v1/sync/key', { ...next, gen: 1, key_rev: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { epoch: u.epoch, gen: 1, key_rev: 2, created: false });
    assert.deepEqual((await call(u, 'GET', '/v1/sync/key')).body, {
      ...next,
      gen: 1,
      key_rev: 2,
      epoch: u.epoch,
    });
    const stale = await call(u, 'PUT', '/v1/sync/key', { ...KEY, gen: 1, key_rev: 1 });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: 'key_rev', epoch: u.epoch, gen: 1, key_rev: 2 });
    assert.equal(await rows(u.id), 1, '항목은 지우지 않는다');
  });

  test('같은 key_rev 로 동시에 덮어쓰면 하나만 된다', async () => {
    const u = await withKey();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(u, 'PUT', '/v1/sync/key', { ...KEY, wrapped: b64(randomBytes(60)), gen: 1, key_rev: 1 }),
      ),
    );
    assert.equal(rs.filter((r) => r.status === 200).length, 1);
    assert.equal(rs.filter((r) => r.status === 409).length, 4);
    assert.equal((await call(u, 'GET', '/v1/sync/key')).body.key_rev, 2);
  });

  test('열쇠 바꾸기(gen+1): 항목을 모두 지우고 epoch+1, key_rev+1. gen 은 한 번에 1만 오른다', async () => {
    const u = await withKey();
    await push(u, [item(uid(), 0, 'old'), item(uid(), 0, 'old')]);
    const skip = await call(u, 'PUT', '/v1/sync/key', { ...KEY, gen: 3, key_rev: 1 });
    assert.equal(skip.status, 400);
    assert.equal(await rows(u.id), 2);
    const r = await call(u, 'PUT', '/v1/sync/key', { ...KEY, gen: 2, key_rev: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { epoch: u.epoch + 1, gen: 2, key_rev: 2, created: false });
    assert.equal(await rows(u.id), 0);
    const st = await status(u);
    assert.deepEqual([st.items, st.bytes, st.epoch, st.gen], [0, 0, u.epoch + 1, 2]);
    // 옛 epoch 를 든 기기는 409, 새 epoch 로는 다시 올릴 수 있다
    const stale = await push(u, [item(uid(), 0)]);
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: 'epoch', epoch: u.epoch + 1, gen: 2 });
    u.epoch += 1;
    assert.equal((await push(u, [item(uid(), 0)])).status, 200);
  });

  test('scrypt 값은 N, r, p 만 받는다 (다른 칸, 다른 최상위 칸은 400), 모양이 틀려도 400', async () => {
    const u = await user();
    for (const bad of [
      { ...KEY, salt: 'zz' },
      { ...KEY, salt: b64('abc') },
      { ...KEY, wrapped: '' },
      { ...KEY, params: 'N=1' },
      { ...KEY, params: { N: 16384, r: 8, p: 1, key: b64(randomBytes(32)) } },
      { ...KEY, params: { N: 16384, r: 8 } },
      { ...KEY, params: { N: 1000, r: 8, p: 1 } },
      { ...KEY, params: { N: '16384', r: 8, p: 1 } },
      { ...KEY, recovery: 'ABCDE' },
      { ...KEY, derived: b64(randomBytes(32)) },
      { ...KEY, key_rev: 'one' },
      { ...KEY, gen: 2 },
    ])
      assert.equal((await call(u, 'PUT', '/v1/sync/key', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    assert.equal((await call(u, 'GET', '/v1/sync/key')).status, 404);
  });

  test('열쇠 없이 push 하면 409 no_key', async () => {
    const u = await user();
    const r = await push(u, [item(uid(), 0)]);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'no_key' });
  });
});

describe('epoch', () => {
  test('모든 응답에 epoch 와 gen 이 들어 있다', async () => {
    const u = await withKey();
    const st = await status(u);
    assert.deepEqual([st.epoch, st.gen], [u.epoch, 1]);
    assert.deepEqual([(await chg(u)).body.epoch, (await chg(u)).body.gen], [u.epoch, 1]);
    const p = await push(u, [item(uid(), 0)]);
    assert.deepEqual([p.body.epoch, p.body.gen], [u.epoch, 1]);
    assert.equal((await call(u, 'GET', '/v1/sync/key')).body.epoch, u.epoch);
    const off = await user();
    assert.deepEqual([(await status(off)).epoch, (await status(off)).gen], [0, 0], '꺼진 계정은 0, 0');
  });

  test('changes 와 push 는 epoch 가 다르면 409 { epoch, gen }, 없으면 400', async () => {
    const u = await withKey();
    await push(u, [item(uid(), 0)]);
    const wrong = u.epoch + 5;
    const c = await call(u, 'GET', `/v1/sync/changes?epoch=${wrong}`);
    assert.equal(c.status, 409);
    assert.deepEqual(c.body, { error: 'epoch', epoch: u.epoch, gen: 1 });
    const p = await call(u, 'POST', '/v1/sync/push', { epoch: wrong, items: [item(uid(), 0)] });
    assert.equal(p.status, 409);
    assert.deepEqual(p.body, { error: 'epoch', epoch: u.epoch, gen: 1 });
    assert.equal(await rows(u.id), 1, '409 는 아무것도 쓰지 않는다');
    assert.equal((await call(u, 'GET', '/v1/sync/changes')).status, 400);
    assert.equal((await call(u, 'POST', '/v1/sync/push', { items: [] })).status, 400);
  });

  test('DELETE 는 epoch 를 올려 다른 기기가 알게 한다 (rev 는 이어진다)', async () => {
    const u = await withKey();
    await push(u, [item(uid(), 0), item(uid(), 0)]);
    const old = u.epoch;
    const r = await call(u, 'DELETE', '/v1/sync');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { epoch: old + 1, gen: 0 });
    const c = await chg(u);
    assert.equal(c.status, 409);
    assert.deepEqual(c.body, { error: 'epoch', epoch: old + 1, gen: 0 });
    // 다시 켜면 같은 head 줄을 쓰므로 epoch 는 그대로 이어진다
    const again = await call(u, 'PUT', '/v1/sync/key', KEY);
    assert.equal(again.body.epoch, old + 1);
  });
});

describe('push 와 changes', () => {
  test('받으면 head+1 을 항목마다 rev 로 준다, 그대로 돌려받는다 (순서, more)', async () => {
    const u = await withKey();
    const ids = [uid(), uid(), uid(), uid(), uid()];
    const r = await push(
      u,
      ids.map((id, i) => item(id, 0, `v${i}`)),
    );
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, {
      results: ids.map((id, i) => ({ uid: id, ok: true, rev: i + 1 })),
      head: 5,
      epoch: u.epoch,
      gen: 1,
    });
    const all = await chg(u);
    assert.equal(all.status, 200);
    assert.deepEqual(
      all.body.items.map((x: { rev: number }) => x.rev),
      [1, 2, 3, 4, 5],
    );
    assert.equal(all.body.head, 5);
    assert.equal(all.body.more, false);
    assert.equal(Buffer.from(all.body.items[2].blob, 'base64').toString(), 'v2');
    // 쪽 나누기
    const p1 = await chg(u, 'since=0&limit=2');
    assert.deepEqual(
      p1.body.items.map((x: { rev: number }) => x.rev),
      [1, 2],
    );
    assert.equal(p1.body.more, true);
    const p3 = await chg(u, 'since=4&limit=2');
    assert.deepEqual(
      p3.body.items.map((x: { rev: number }) => x.rev),
      [5],
    );
    assert.equal(p3.body.more, false);
    // 고친 항목은 새 rev 로 뒤에 선다
    const fix = await push(u, [item(ids[1] as string, 2, 'v1b')]);
    assert.deepEqual(fix.body, {
      results: [{ uid: ids[1], ok: true, rev: 6 }],
      head: 6,
      epoch: u.epoch,
      gen: 1,
    });
    const tail = await chg(u, 'since=5');
    assert.deepEqual(
      tail.body.items.map((x: { uid: string; rev: number }) => [x.uid, x.rev]),
      [[ids[1], 6]],
    );
  });

  test('changes 쿼리 검사: limit 는 500 으로 깎고, 모양이 틀리면 400', async () => {
    const u = await withKey();
    assert.equal((await chg(u, 'limit=9999')).status, 200);
    for (const q of ['since=-1', 'since=a', 'limit=0', 'limit=x'])
      assert.equal((await chg(u, q)).status, 400, q);
  });

  test('base 가 다르면 그 항목만 conflict 로 지금 것을 돌려주고 나머지는 받는다', async () => {
    const u = await withKey();
    const [a, b, c] = [uid(), uid(), uid()];
    await push(u, [item(a, 0, 'A1'), item(b, 0, 'B1')]);
    // a: 옛 base(0) -> conflict, b: 맞는 base(2) -> ok, c: 새 항목 base 0 -> ok, 새 항목에 base 7 -> conflict(서버에 없음 rev 0)
    const r = await push(u, [item(a, 0, 'A2'), item(b, 2, 'B2'), item(c, 0, 'C1')]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results[0], {
      uid: a,
      ok: false,
      conflict: { rev: 1, blob: b64('A1'), deleted: false },
    });
    assert.deepEqual(r.body.results[1], { uid: b, ok: true, rev: 3 });
    assert.deepEqual(r.body.results[2], { uid: c, ok: true, rev: 4 });
    assert.equal(r.body.head, 4);
    const ghost = await push(u, [item(uid(), 7)]);
    assert.deepEqual(ghost.body.results[0].conflict, { rev: 0, blob: '', deleted: false });
    assert.equal(ghost.body.head, 4, 'conflict 는 번호를 쓰지 않는다');
    const ch = await chg(u);
    assert.equal(ch.body.items.find((x: { uid: string }) => x.uid === a).blob, b64('A1'), '졌으니 그대로');
  });

  test('같은 uid 를 같은 base 로 동시에 두 번 보내면 하나만 성공한다', async () => {
    const u = await withKey();
    const id = uid();
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => push(u, [item(id, 0, `w${i}`)])));
    const oks = rs.filter((r) => r.body.results[0].ok === true);
    const lost = rs.filter((r) => r.body.results[0].ok === false);
    assert.equal(oks.length, 1);
    assert.equal(lost.length, 5);
    const winner = Buffer.from((await chg(u)).body.items[0].blob, 'base64').toString();
    for (const r of lost)
      assert.equal(r.body.results[0].conflict.blob, b64(winner), '진 쪽은 이긴 것을 받는다');
    assert.equal(await rows(u.id), 1);
  });

  test('지운 항목도 줄을 남기고 changes 에 deleted 로 나온다, 합계에 센다', async () => {
    const u = await withKey();
    const id = uid();
    await push(u, [item(id, 0, 'hello world')]);
    const del = await push(u, [{ uid: id, base: 1, blob: '', deleted: true }]);
    assert.deepEqual(del.body.results[0], { uid: id, ok: true, rev: 2 });
    assert.equal(await rows(u.id), 1);
    const ch = await chg(u, 'since=1');
    assert.deepEqual(ch.body.items, [{ uid: id, rev: 2, blob: '', deleted: true }]);
    assert.deepEqual(await status(u), {
      on: true,
      items: 1,
      bytes: 0,
      maxItems: SYNC_MAX_ITEMS,
      maxBytes: SYNC_MAX_BYTES,
      soon: false,
      epoch: u.epoch,
      gen: 1,
    });
    // 지운 뒤 같은 uid 를 되살릴 수도 있다
    assert.equal((await push(u, [item(id, 2, 'back')])).body.results[0].ok, true);
  });

  test('한 계정의 항목은 다른 계정에 안 보인다', async () => {
    const a = await withKey();
    const b = await withKey();
    const id = uid();
    await push(a, [item(id, 0)]);
    assert.deepEqual((await chg(b)).body, { items: [], head: 0, more: false, epoch: b.epoch, gen: 1 });
    const mine = await push(b, [item(id, 0, 'b')]);
    assert.equal(mine.body.results[0].ok, true, '남의 uid 와 겹쳐도 내 base 는 0');
  });
});

const status = async (u: User) => (await call(u, 'GET', '/v1/sync/status')).body;

describe('검사와 상한', () => {
  test('uid, base, blob, 개수 모양을 검사해 묶음 전체를 거절한다 (400)', async () => {
    const u = await withKey();
    const ok = item(uid(), 0);
    for (const [name, items] of [
      ['uid 글자', [{ ...ok, uid: 'a b' }]],
      ['uid 빈 것', [{ ...ok, uid: '' }]],
      ['uid 긴 것', [{ ...ok, uid: 'a'.repeat(97) }]],
      ['base 소수', [{ ...ok, base: 1.5 }]],
      ['base 음수', [{ ...ok, base: -1 }]],
      ['base 글자', [{ ...ok, base: '0' }]],
      ['blob 아님', [{ ...ok, blob: '***' }]],
      ['blob 빈 것', [{ ...ok, blob: '' }]],
      ['deleted 글자', [{ ...ok, deleted: 'yes' }]],
      ['uid 중복', [ok, ok]],
      ['201개', Array.from({ length: 201 }, () => item(uid(), 0))],
    ] as const) {
      const r = await push(u, [...items, item(uid(), 0)]);
      assert.equal(r.status, 400, name);
    }
    assert.equal((await call(u, 'POST', '/v1/sync/push', { items: 'x' })).status, 400);
    assert.equal(await rows(u.id), 0, '거절한 묶음은 아무것도 남기지 않는다');
    // 200개는 된다
    assert.equal(
      (
        await push(
          u,
          Array.from({ length: 200 }, () => item(uid(), 0)),
        )
      ).status,
      200,
    );
    assert.equal(await rows(u.id), 200);
  });

  test('blob 은 디코드 후 256KB 까지, 넘으면 413 blob_too_big 이고 묶음 전체를 거절', async () => {
    const u = await withKey();
    const edge = await push(u, [item(uid(), 0, 'x'.repeat(SYNC_BLOB_MAX))]);
    assert.equal(edge.status, 200, '정확히 256KB 는 된다');
    const id = uid();
    const r = await push(u, [item(uid(), 0), item(id, 0, 'x'.repeat(SYNC_BLOB_MAX + 1))]);
    assert.equal(r.status, 413);
    assert.deepEqual(r.body, { error: 'blob_too_big' });
    assert.equal(await rows(u.id), 1);
  });

  test('push 본문은 4MB 까지 (이 길만), 넘으면 413. 다른 길은 256KB 그대로', async () => {
    const u = await withKey();
    // 4MB 아래의 큰 본문: 덩어리 12개 x 256KB(base64 약 350KB) = 약 4.2MB 는 넘는다. 10개 약 3.5MB
    const big = Array.from({ length: 10 }, () => item(uid(), 0, randomBytes(SYNC_BLOB_MAX)));
    const body = JSON.stringify({ epoch: u.epoch, items: big });
    assert.ok(body.length > 3_000_000 && body.length < 4 * 1024 * 1024, String(body.length));
    const ok = await api('POST', '/v1/sync/push', {
      token: u.token,
      ip: ip(),
      body,
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    assert.equal(await rows(u.id), 10);
    const over = JSON.stringify({
      epoch: u.epoch,
      items: Array.from({ length: 13 }, () => item(uid(), 0, 'y'.repeat(SYNC_BLOB_MAX))),
    });
    assert.ok(over.length > 4 * 1024 * 1024);
    const r = await api('POST', '/v1/sync/push', {
      token: u.token,
      ip: ip(),
      body: over,
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(r.status, 413);
    assert.equal(await rows(u.id), 10);
    // 다른 길의 JSON 상한 256KB 는 그대로
    const small = await api('PUT', '/v1/sync/key', {
      token: u.token,
      ip: ip(),
      body: JSON.stringify({ pad: 'z'.repeat(300_000) }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(small.status, 413);
  });

  test('항목 수 상한: 넘기는 묶음은 413 sync_full 로 전체 거절, 이미 있는 항목 고치기는 된다', async () => {
    const u = await withKey();
    await push(u, [item('seed', 0)]);
    // head 를 상한 직전으로 맞춘다 (10만 줄을 실제로 넣지 않고 셈표를 바꾼다)
    await h.pool.query('UPDATE sync_head SET items = $2 WHERE account_id = $1', [u.id, SYNC_MAX_ITEMS - 1]);
    const a = uid();
    const b = uid();
    const full = await push(u, [item(a, 0), item(b, 0)]);
    assert.equal(full.status, 413);
    assert.deepEqual(full.body, { error: 'sync_full' });
    assert.equal(
      await count("SELECT count(*)::int AS n FROM sync_item WHERE account_id = $1 AND uid <> 'seed'", u.id),
      0,
      '묶음 전체 거절',
    );
    assert.equal((await status(u)).items, SYNC_MAX_ITEMS - 1);
    assert.equal((await push(u, [item(a, 0)])).status, 200, '딱 상한까지는 된다');
    assert.equal((await status(u)).items, SYNC_MAX_ITEMS);
    assert.equal((await push(u, [item('seed', 1, 'edit')])).status, 200, '있는 항목 고치기는 된다');
    assert.equal((await push(u, [item(b, 0)])).status, 413);
  });

  test('바이트 합계 상한: 넘기는 한 바이트는 413', async () => {
    const u = await withKey();
    const id = uid();
    await push(u, [item(id, 0, 'abc')]);
    await h.pool.query('UPDATE sync_head SET bytes = $2 WHERE account_id = $1', [u.id, SYNC_MAX_BYTES - 1]);
    assert.equal((await push(u, [item(uid(), 0, 'ab')])).status, 413);
    assert.equal((await push(u, [item(uid(), 0, 'a')])).status, 200);
    assert.equal((await status(u)).bytes, SYNC_MAX_BYTES);
    // 지우면 줄어든다 (작은 blob 을 남겨도 합계는 내려간다)
    assert.equal((await push(u, [{ uid: id, base: 1, blob: '', deleted: true }])).status, 200);
    assert.equal((await status(u)).bytes, SYNC_MAX_BYTES - 3);
  });

  test('status 는 기능이 켜졌고 열쇠가 없으면 on false', async () => {
    const u = await user();
    assert.deepEqual(await status(u), {
      on: false,
      items: 0,
      bytes: 0,
      maxItems: SYNC_MAX_ITEMS,
      maxBytes: SYNC_MAX_BYTES,
      soon: false,
      epoch: 0,
      gen: 0,
    });
    u.epoch = (await call(u, 'PUT', '/v1/sync/key', KEY)).body.epoch;
    await push(u, [item(uid(), 0, 'abcd'), item(uid(), 0, 'ef')]);
    const s = await status(u);
    assert.deepEqual([s.on, s.items, s.bytes, s.soon], [true, 2, 6, false]);
  });
});

describe('레이트리밋', () => {
  test('쓰기는 계정마다 1분 LIMITS.syncWrite.max 번까지, 읽기와 따로 센다', async () => {
    const u = await withKey();
    let limited = 0;
    // 열쇠 올리기 1번이 이미 셌다
    for (let i = 1; i < LIMITS.syncWrite.max + 5; i++) {
      const r = await push(u, []);
      if (r.status === 429) limited++;
      else assert.equal(r.status, 200);
    }
    assert.ok(limited >= 4, `limited=${limited}`);
    const read = await call(u, 'GET', '/v1/sync/status');
    assert.ok(read.status === 200 || read.status === 429);
  });
});

describe('지우기, 탈퇴, 합치기, 1년 정리', () => {
  test('DELETE /v1/sync 는 항목과 열쇠를 지우고 head 는 epoch+1 로 남긴다, 다른 계정은 그대로', async () => {
    const u = await withKey();
    const other = await withKey();
    await push(u, [item(uid(), 0), item(uid(), 0)]);
    await push(other, [item(uid(), 0)]);
    const r = await call(u, 'DELETE', '/v1/sync');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { epoch: u.epoch + 1, gen: 0 });
    for (const t of ['sync_item', 'sync_key'])
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${t} WHERE account_id = $1`, u.id), 0, t);
    assert.deepEqual(
      (await h.pool.query('SELECT epoch, items, bytes FROM sync_head WHERE account_id = $1', [u.id])).rows,
      [{ epoch: u.epoch + 1, items: 0, bytes: '0' }],
    );
    assert.equal((await call(u, 'GET', '/v1/sync/key')).status, 404);
    u.epoch += 1;
    assert.deepEqual((await push(u, [item(uid(), 0)])).body, { error: 'no_key' });
    assert.equal(await rows(other.id), 1);
    // 다시 켤 수 있다
    assert.equal((await call(u, 'PUT', '/v1/sync/key', KEY)).status, 200);
    assert.equal((await push(u, [item(uid(), 0)])).status, 200);
  });

  test('탈퇴하면 CASCADE 로 모두 지워진다', async () => {
    const u = await withKey();
    await push(u, [item(uid(), 0), item(uid(), 0)]);
    await h.app.get(Accounts).delete(u.id);
    for (const t of ['sync_item', 'sync_key', 'sync_head'])
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${t} WHERE account_id = $1`, u.id), 0, t);
  });

  test('계정 합치기: 닫히는 계정의 사본은 지우고 남는 계정 것만 둔다', async () => {
    const from = await withKey();
    const into = await withKey();
    await push(from, [item(uid(), 0, 'from')]);
    const keep = uid();
    await push(into, [item(keep, 0, 'into')]);
    const accounts = h.app.get(Accounts);
    const epochBefore = into.epoch;
    await h.app.get(Accounts)['db'].tx(async (c) => {
      const [f, i] = await accounts.lockPair(c, from.id, into.id);
      await accounts.merge(c, f as never, i as never);
    });
    for (const t of ['sync_item', 'sync_key', 'sync_head'])
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${t} WHERE account_id = $1`, from.id), 0, t);
    // 남는 쪽 epoch 가 올랐다: 옛 epoch 를 든 기기는 409, 새 epoch 로는 남는 쪽 사본이 보인다
    const dbEpoch = Number(
      (await h.pool.query('SELECT epoch FROM sync_head WHERE account_id = $1', [into.id])).rows[0]?.epoch,
    );
    assert.equal(dbEpoch, epochBefore + 1);
    assert.equal((await chg(into)).status, 409);
    assert.equal((await chg(from)).status, 409, '옛 세션은 남는 쪽으로 따라가 같은 판정');
    from.epoch = dbEpoch;
    const ch = await chg(from);
    assert.deepEqual(
      ch.body.items.map((x: { uid: string }) => x.uid),
      [keep],
    );
    assert.equal(await rows(into.id), 1);
  });

  test('1년 동안 changes 도 push 도 없으면 지우고, 있으면 남긴다. 30일 전부터 soon', async () => {
    const stale = await withKey();
    const fresh = await withKey();
    const touched = await withKey();
    for (const u of [stale, fresh, touched]) await push(u, [item(uid(), 0)]);
    const setAccess = (u: User, days: number) =>
      h.pool.query(
        'UPDATE sync_head SET last_access_at = now() - make_interval(days => $2) WHERE account_id = $1',
        [u.id, days],
      );
    await setAccess(stale, 366);
    await setAccess(fresh, 364);
    await setAccess(touched, 366);
    // soon: 336일 전부터 (남은 30일)
    assert.equal((await status(fresh)).soon, true);
    await setAccess(fresh, 300);
    assert.equal((await status(fresh)).soon, false);
    await setAccess(fresh, 364);
    // 오래 만에 changes 를 받으면 되살아난다 (지우기 전에 한 번이라도 맞추면 1년이 새로 시작)
    assert.equal((await chg(touched)).status, 200);
    assert.equal((await h.app.get(Sync).sweep()).expired, 1);
    assert.equal(await rows(stale.id), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM sync_key WHERE account_id = $1', stale.id), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM sync_head WHERE account_id = $1', stale.id), 0);
    assert.equal(await rows(fresh.id), 1);
    assert.equal(await rows(touched.id), 1);
    // push 도 되살린다
    await setAccess(fresh, 366);
    assert.equal((await push(fresh, [item(uid(), 0)])).status, 200);
    assert.equal((await h.app.get(Sync).sweep()).expired, 0);
    // sweep(now) 로 1년 뒤를 흉내 내면 모두 지워진다
    const far = await h.app.get(Sync).sweep(Date.now() + 366 * DAY);
    assert.ok(far.expired >= 2);
    assert.equal(await rows(fresh.id), 0);
  });

  test('지운 항목은 90일 뒤 blob 을 비우고 항목 수와 바이트에서 뺀다 (uid 와 rev 는 남는다)', async () => {
    const u = await withKey();
    const [live, gone, young] = [uid(), uid(), uid()];
    await push(u, [item(live, 0, 'keep!'), item(gone, 0, 'secret-body'), item(young, 0, 'young')]);
    await push(u, [
      { uid: gone, base: 2, blob: b64('tomb'), deleted: true },
      { uid: young, base: 3, blob: b64('tomb'), deleted: true },
    ]);
    let st = await status(u);
    assert.deepEqual([st.items, st.bytes], [3, 5 + 4 + 4]);
    await h.pool.query(
      "UPDATE sync_item SET updated_at = now() - interval '91 days' WHERE account_id = $1 AND uid = $2",
      [u.id, gone],
    );
    await h.pool.query(
      "UPDATE sync_item SET updated_at = now() - interval '89 days' WHERE account_id = $1 AND uid = $2",
      [u.id, young],
    );
    assert.equal((await h.app.get(Sync).sweep()).purged, 1);
    st = await status(u);
    assert.deepEqual([st.items, st.bytes], [2, 5 + 4], '비운 줄은 세지 않는다');
    assert.equal(await rows(u.id), 3, '줄은 남는다');
    const ch = await chg(u, 'since=0');
    const g = ch.body.items.find((x: { uid: string }) => x.uid === gone);
    assert.deepEqual(g, { uid: gone, rev: 4, blob: '', deleted: true });
    assert.equal((await h.app.get(Sync).sweep()).purged, 0, '두 번째는 할 일이 없다');
    // 비운 줄의 uid 를 다시 쓰면(base 는 rev) 다시 센다
    assert.equal((await push(u, [item(gone, 4, 'again')])).body.results[0].ok, true);
    st = await status(u);
    assert.deepEqual([st.items, st.bytes], [3, 5 + 4 + 5]);
  });
});
