// 통합 시험: 운영자의 기능 스위치 바꾸기는 트랜잭션 안에서 풀 연결을 하나 더 잡지 않는다.
// 풀(20) 중 19개를 쥐어 두면 트랜잭션 하나가 마지막 연결을 쓰고, 안에서 풀을 또 부르면 2초 뒤 500 이 난다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { Db } from '../src/db';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
let h: Harness;
const { api } = client(() => h);

before(async () => {
  h = await startHarness({ adminToken: ADMIN_TOKEN });
});
after(async () => {
  await h?.stop();
});

test('풀이 거의 찼을 때도 기능 스위치를 바꾼다 (담아 둔 모드가 비었을 때)', async () => {
  const admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  // 담아 둔 모드(5초)가 비게 기다린다
  await new Promise((r) => setTimeout(r, 5300));
  const pool = h.app.get(Db).pool;
  const held: PoolClient[] = [];
  try {
    for (let i = 0; i < 19; i++) held.push(await pool.connect());
    const done = await admin.act('/admin/features/mode', {
      key: 'calendar_link_hint',
      mode: 'off',
      from: 'allowlist',
      confirm: 'yes',
    });
    assert.ok(done.ok, done.text);
  } finally {
    for (const c of held) c.release();
  }
  const row = await h.pool.query(`SELECT mode FROM feature_flag WHERE key = 'calendar_link_hint'`);
  assert.equal(row.rows[0]?.mode, 'off');
});
