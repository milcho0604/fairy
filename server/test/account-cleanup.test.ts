// 통합 시험 (#104 처리방침): 1년 동안 안 쓴 로그인 없는 기기 계정을 서버에서 지운다 (src/account-cleanup.ts).
// 지워야 하는 것(코인 내역, 쪽지함, 백업 줄과 파일, 합쳐진 계정까지)과 지우면 안 되는 것(세션 있음, 로그인 연결 있음, 1년 안에 씀).
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AccountCleanup } from '../src/account-cleanup';
import { Accounts } from '../src/accounts';
import { client, type Harness, startHarness } from './helpers';

const DAY = 86_400_000;
let h: Harness;
let dir: string;
const { api, newDevice, session } = client(() => h);
const cleanup = () => h.app.get(AccountCleanup);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fairy-cleanup-test-'));
  h = await startHarness({ backup: { key: randomBytes(32), dir } });
});
after(async () => {
  await h?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 계정 활동을 며칠 전으로 돌린다 */
const idle = (id: string, days: number) =>
  h.pool.query('UPDATE account SET last_active_at = now() - make_interval(days => $2) WHERE id = $1', [
    id,
    days,
  ]);
const exists = async (id: string) =>
  ((await h.pool.query('SELECT 1 FROM account WHERE id = $1', [id])).rowCount ?? 0) > 0;
const count = async (sql: string, id: string) => Number((await h.pool.query(sql, [id])).rows[0]?.n);

describe('오래 안 쓴 기기 계정 정리', () => {
  test('1년 넘게 안 쓴 기기 계정은 코인 내역, 기기, 쪽지함, 백업 줄과 파일까지 지운다', async () => {
    const d = await newDevice();
    const m = await api('POST', '/v1/migrate', { token: d.token, body: { balance: 120 } });
    assert.equal(m.body.balance, 120);
    await h.pool.query("INSERT INTO inbox (account_id, kind, message) VALUES ($1, 'notice', '안녕')", [d.id]);
    const file = randomBytes(16).toString('hex');
    writeFileSync(join(dir, `${file}.fbk`), 'x');
    await h.pool.query('INSERT INTO backup (account_id, file, size, sha256) VALUES ($1, $2, 1, $3)', [
      d.id,
      file,
      randomBytes(32),
    ]);
    await idle(d.id, 366);

    assert.deepEqual(await cleanup().sweep(), { deleted: 1 });
    assert.equal(await exists(d.id), false);
    for (const t of ['coin_entry', 'device', 'inbox', 'backup'])
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${t} WHERE account_id = $1`, d.id), 0, t);
    assert.equal(existsSync(join(dir, `${file}.fbk`)), false, '백업 파일도 디스크에서 지운다');
    // 지워진 기기 토큰은 무효
    assert.equal((await api('POST', '/v1/sync', { token: d.token, body: { entries: [] } })).status, 401);
    // 이미 지운 계정은 다음 정리에서 건드리지 않는다
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
  });

  test('1년 안에 쓴 계정은 지우지 않는다 (364일 전까지)', async () => {
    const d = await newDevice();
    await idle(d.id, 364);
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
    assert.equal(await exists(d.id), true);
  });

  test('오래 안 쓴 계정이라도 요청이 오면 활동이 고쳐져 지우지 않는다', async () => {
    const d = await newDevice();
    await idle(d.id, 400);
    const r = await api('GET', '/v1/me', { token: d.token });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
    assert.equal(await exists(d.id), true);
  });

  test('세션이 있는 계정(로그인해 둔 사람)은 활동이 1년 넘게 비어도 지우지 않는다', async () => {
    const d = await newDevice();
    await session(d.id);
    await idle(d.id, 800);
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
    assert.equal(await exists(d.id), true);
  });

  test('로그인 연결만 있는 계정(로그아웃함)도 지우지 않는다: 다시 로그인하면 찾을 수 있다', async () => {
    const d = await newDevice();
    await h.pool.query("INSERT INTO login (service, sub, account_id) VALUES ('google', $1, $2)", [
      `sub-${randomBytes(6).toString('hex')}`,
      d.id,
    ]);
    await idle(d.id, 800);
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
    assert.equal(await exists(d.id), true);
  });

  test('합쳐서 닫힌 계정은 남는 쪽을 따라간다: 남는 쪽이 지워질 때 함께 지워지고, 혼자 지우지 않는다', async () => {
    const keep = await newDevice();
    const gone = await newDevice();
    // gone 을 keep 에 합친 모양 (닫힌 계정은 활동이 오래됐어도 후보가 아니다)
    await h.pool.query('UPDATE account SET closed_at = now(), merged_into = $2 WHERE id = $1', [
      gone.id,
      keep.id,
    ]);
    await idle(gone.id, 900);
    assert.deepEqual(await cleanup().sweep(), { deleted: 0 });
    assert.equal(await exists(gone.id), true);
    assert.equal(await exists(keep.id), true);
    // 남는 쪽이 1년 넘게 비면 둘 다 지운다
    await idle(keep.id, 400);
    assert.deepEqual(await cleanup().sweep(), { deleted: 1 });
    assert.equal(await exists(keep.id), false);
    assert.equal(await exists(gone.id), false);
  });

  test('계정을 잠근 뒤 다시 따진다: 그사이 세션이 생기면 지우지 않고 null', async () => {
    const d = await newDevice();
    await idle(d.id, 500);
    const accounts = h.app.get(Accounts);
    await session(d.id);
    const r = await accounts.delete(d.id, async (c, a) => {
      const s = await c.query('SELECT 1 FROM session WHERE account_id = $1', [a.id]);
      return s.rowCount === 0;
    });
    assert.equal(r, null);
    assert.equal(await exists(d.id), true);
  });

  test('여러 계정이 섞여 있어도 지울 것만 지운다', async () => {
    const old1 = await newDevice();
    const old2 = await newDevice();
    const fresh = await newDevice();
    const signed = await newDevice();
    await session(signed.id);
    await idle(old1.id, 370);
    await idle(old2.id, 1000);
    await idle(signed.id, 1000);
    assert.deepEqual(await cleanup().sweep(), { deleted: 2 });
    assert.deepEqual(
      [await exists(old1.id), await exists(old2.id), await exists(fresh.id), await exists(signed.id)],
      [false, false, true, true],
    );
  });
});
