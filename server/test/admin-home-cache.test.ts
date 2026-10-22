// 운영자 홈 (#152) 버그잡이 후속: 일별 추이 기억(끌 수 있다), 합친 계정 활동, 백업 상한 0
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { client, type Harness, startHarness } from './helpers';

const ADMIN_SUB = `admin-sub-${randomUUID()}`;
const DIR = mkdtempSync(join(tmpdir(), 'fairy-152c-'));
let h: Harness;
const { api, newDevice, session } = client(() => h);
let tok = '';
const today = (b: { trend: { days: Array<{ signups: number; active: number }> } }) =>
  b.trend.days[13] as { signups: number; active: number };
const overview = async () => (await api('GET', '/v1/admin/overview', { token: tok })).body;
const addAccount = async () =>
  String(
    (
      await h.pool.query(`INSERT INTO account (age, code) VALUES ('14+', $1) RETURNING id`, [
        `F-${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`,
      ])
    ).rows[0].id,
  );

before(async () => {
  h = await startHarness({
    adminSubs: [ADMIN_SUB],
    adminTrendCacheMs: 60_000,
    backup: { key: randomBytes(32), dir: DIR, totalMaxBytes: 0 },
  });
  tok = await session((await newDevice('18+', '운영')).id, ADMIN_SUB);
});
after(async () => {
  await h?.stop();
  rmSync(DIR, { recursive: true, force: true });
});

describe('추이 기억', () => {
  test('기억하는 동안은 새 가입이 추이에 안 늘고, 요약 칸(summary)은 바로 갱신된다', async () => {
    const a = await overview();
    const n = today(a).signups;
    await addAccount();
    const b = await overview();
    assert.equal(today(b).signups, n, '기억된 추이');
    assert.equal(b.summary.accounts, a.summary.accounts + 1, '다른 칸은 기억하지 않는다');
  });
  test('기억을 끄면(0) 바로 늘어난다', async () => {
    h.config.adminTrendCacheMs = 0;
    const n = today(await overview()).signups;
    await addAccount();
    assert.equal(today(await overview()).signups, n + 1);
  });
});

describe('합친 계정 활동', () => {
  test('같은 날 두 계정이 기록을 보낸 뒤 합치면 활동은 한 명', async () => {
    h.config.adminTrendCacheMs = 0;
    const before = today(await overview()).active;
    const a = await addAccount();
    const b = await addAccount();
    for (const x of [a, b])
      await h.pool.query(
        `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day) VALUES ($1, $2, 'todo', 1, 1, 'ok', current_date)`,
        [randomUUID(), x],
      );
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [a, b]);
    assert.equal(today(await overview()).active - before, 1);
  });
});

describe('백업 상한 0', () => {
  test('상한 0 은 없음이 아니라 0 이고 나쁨 카드(n -1)가 뜬다', async () => {
    const b = await overview();
    assert.equal(b.backup.maxBytes, 0);
    assert.deepEqual(
      b.todo.find((t: { kind: string }) => t.kind === 'backup'),
      { kind: 'backup', level: 'bad', n: -1, place: 'settings/backup' },
    );
  });
});
