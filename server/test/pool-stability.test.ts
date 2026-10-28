// 통합 시험: 트랜잭션 안에서 풀 연결을 하나 더 잡지 않는다 (풀이 찬 때 서로 기다려 멎는 일), 기능 판정 한 번에 묻기,
// 운영자 홈의 기능 목록이 허용 담아 둔 것을 비우지 않는다, 0018 색인. 시험용 Postgres 컨테이너를 쓴다.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { AdminAccess } from '../src/admin-access';
import type { Config } from '../src/config';
import { Db } from '../src/db';
import { Features } from '../src/features';
import { runMigrations, startPg } from './pg';

let stopPg = () => {};
let url = '';
let admin: Pool;

before(async () => {
  const pg = await startPg();
  stopPg = pg.stop;
  url = pg.databaseUrl;
  await runMigrations(url);
  admin = new Pool({ connectionString: url, max: 2 });
  await admin.query(
    `INSERT INTO account (age, code) SELECT '18+', 'F-' || upper(substr(md5(i::text), 1, 4)) || '-' || upper(substr(md5(i::text), 5, 4))
       FROM generate_series(1, 30) i`,
  );
  await admin.query(
    `INSERT INTO login (service, sub, account_id) SELECT 'google', 'sub-' || i, i FROM generate_series(1, 30) i`,
  );
});
after(async () => {
  await admin?.end().catch(() => {});
  stopPg();
});

const config = (extra: Partial<Config> = {}) => ({ adminSubs: ['sub-3'], ...extra }) as unknown as Config;

describe('트랜잭션 안에서 풀 연결을 더 잡지 않는다', () => {
  test('운영자 계정 판정: 풀 3개에 동시 트랜잭션 9개가 끝난다', async () => {
    const db = new Db(url, 3);
    try {
      const access = new AdminAccess(db, config());
      const out = await Promise.all(
        Array.from({ length: 9 }, (_, i) => db.tx((c) => access.isAdminAccount(String(1 + (i % 4)), c))),
      );
      assert.deepEqual(out, [false, false, true, false, false, false, true, false, false]);
    } finally {
      await db.pool.end();
    }
  });

  test('기능 판정: 풀 3개에 동시 트랜잭션 9개가 끝나고 값은 풀로 묻는 것과 같다', async () => {
    await admin.query(
      `INSERT INTO feature_flag (key, mode) VALUES ('friend_gift_passes', 'allowlist') ON CONFLICT (key) DO UPDATE SET mode = 'allowlist'`,
    );
    await admin.query(
      `INSERT INTO feature_allow (key, account_id) VALUES ('friend_gift_passes', 1) ON CONFLICT DO NOTHING`,
    );
    const db = new Db(url, 3);
    try {
      const f = new Features(config(), db);
      const out = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          db.tx((c) => f.featureAllowed('friend_gift_passes', String(1 + (i % 4)), c)),
        ),
      );
      // 1 은 허용 목록, 3 은 운영자 계정, 나머지는 안 됨
      assert.deepEqual(out, [true, false, true, false, true, false, true, false, true]);
    } finally {
      await db.pool.end();
    }
  });
});

describe('allowedAmong', () => {
  test('계정마다 featureAllowed 를 부른 것과 같은 계정들을 한 번에 돌려준다', async () => {
    await admin.query(
      `INSERT INTO feature_flag (key, mode) VALUES ('friends', 'allowlist'), ('friend_visit', 'allowlist') ON CONFLICT (key) DO UPDATE SET mode = 'allowlist'`,
    );
    await admin.query(`DELETE FROM feature_allow WHERE key IN ('friends', 'friend_visit')`);
    await admin.query(
      `INSERT INTO feature_allow (key, account_id) SELECT 'friends', i FROM generate_series(1, 10) i`,
    );
    await admin.query(
      `INSERT INTO feature_allow (key, account_id) SELECT 'friend_visit', i FROM generate_series(5, 14) i`,
    );
    const db = new Db(url, 3);
    try {
      const f = new Features(config(), db);
      const ids = Array.from({ length: 20 }, (_, i) => String(1 + i));
      const want: string[] = [];
      for (const id of ids)
        if ((await f.featureAllowed('friends', id)) && (await f.featureAllowed('friend_visit', id)))
          want.push(id);
      const got = await f.allowedAmong(['friends', 'friend_visit'], ids);
      assert.deepEqual([...got].sort(), want.sort());
      // 5~10 과 운영자 계정 3 은 friends 쪽에서는 이미 든다. friend_visit 는 5~14 와 운영자 3
      assert.deepEqual(
        [...got].map(Number).sort((a, b) => a - b),
        [3, 5, 6, 7, 8, 9, 10],
      );
      // 질의 수: 모드 하나 + 허용 목록과 운영자 로그인 키마다 둘 (계정 수와 무관)
      let n = 0;
      const orig = db.pool.query.bind(db.pool) as (...a: unknown[]) => unknown;
      (db.pool as unknown as { query: unknown }).query = (...a: unknown[]) => {
        n++;
        return orig(...a);
      };
      await new Features(config(), db).allowedAmong(['friends', 'friend_visit'], ids);
      assert.ok(n <= 5, `질의 ${n}개`);
    } finally {
      await db.pool.end();
    }
  });

  test('꺼진 기능이 하나라도 있으면 비고, 모두 켜진 기능은 걸러내지 않는다', async () => {
    const db = new Db(url, 3);
    try {
      await admin.query(`UPDATE feature_flag SET mode = 'off' WHERE key = 'friend_visit'`);
      assert.equal(
        (await new Features(config(), db).allowedAmong(['friends', 'friend_visit'], ['1', '2'])).size,
        0,
      );
      await admin.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'friend_visit'`);
      const got = await new Features(config(), db).allowedAmong(['friend_visit'], ['1', '2']);
      assert.deepEqual([...got].sort(), ['1', '2']);
    } finally {
      await db.pool.end();
    }
  });
});

describe('운영자 홈의 기능 목록', () => {
  test('모드만 새로 읽고 허용 판정 담아 둔 것은 비우지 않는다', async () => {
    await admin.query(
      `INSERT INTO feature_flag (key, mode) VALUES ('friend_calendar', 'allowlist') ON CONFLICT (key) DO UPDATE SET mode = 'allowlist'`,
    );
    await admin.query(
      `INSERT INTO feature_allow (key, account_id) VALUES ('friend_calendar', 7) ON CONFLICT DO NOTHING`,
    );
    const db = new Db(url, 3);
    try {
      let now = 1_000_000;
      const f = new Features(config(), db, () => now);
      assert.equal(await f.featureAllowed('friend_calendar', '7'), true);
      // 판정을 담은 뒤 DB 에서 직접 뺀다: 목록을 읽어도 담아 둔 판정은 5초 안에는 그대로다
      await admin.query(`DELETE FROM feature_allow WHERE key = 'friend_calendar' AND account_id = 7`);
      const list = await f.listFeatures();
      assert.deepEqual(list.find((x) => x.key === 'friend_calendar')?.accounts, []);
      assert.equal(await f.featureAllowed('friend_calendar', '7'), true);
      // 모드는 목록을 읽을 때마다 새로 읽는다
      await admin.query(`UPDATE feature_flag SET mode = 'off' WHERE key = 'friend_calendar'`);
      assert.equal((await f.listFeatures()).find((x) => x.key === 'friend_calendar')?.mode, 'off');
      now += 6000;
      assert.equal(await f.featureAllowed('friend_calendar', '7'), false);
    } finally {
      await db.pool.end();
    }
  });
});

describe('0018 색인', () => {
  test('색인 여섯 개가 있고 옛 ai_usage_created 는 없다', async () => {
    const r = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
      [
        [
          'inbox_friend_request',
          'friend_gift_inbox',
          'ai_subscription_fill_inbox',
          'inbox_account_id',
          'coin_entry_created_brin',
          'ai_usage_created_cost',
          'ai_usage_created',
        ],
      ],
    );
    assert.deepEqual(r.rows.map((x) => x.indexname).sort(), [
      'ai_subscription_fill_inbox',
      'ai_usage_created_cost',
      'coin_entry_created_brin',
      'friend_gift_inbox',
      'inbox_account_id',
      'inbox_friend_request',
    ]);
  });

  test('쪽지 15만 줄에서 지우기: 색인이 없을 때보다 눈에 띄게 빠르다', async () => {
    await admin.query(
      `INSERT INTO inbox (account_id, kind, message, coins, created_at) SELECT 1 + (i % 30), 'grant', 'm', 1, now() FROM generate_series(1, 150000) i`,
    );
    // 쪽지를 가리키는 줄: 선물 2만, 정기 지급 줄 (구독 1개, 달마다 1줄이 원칙이라 적게)
    await admin.query(
      `INSERT INTO friend_gift (from_account, to_account, request_id, coins, passes, day, inbox_id)
       SELECT 1, 2, 'request-' || id, 1, 0, current_date, id FROM inbox WHERE id % 7 = 0 LIMIT 20000`,
    );
    await admin.query('ANALYZE');
    const time = async (): Promise<number> => {
      const t0 = performance.now();
      const del = await admin.query(
        `DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE id % 11 = 0 LIMIT 400)`,
      );
      assert.equal(del.rowCount, 400);
      return performance.now() - t0;
    };
    await admin.query('DROP INDEX friend_gift_inbox');
    const before = await time();
    await admin.query('CREATE INDEX friend_gift_inbox ON friend_gift (inbox_id) WHERE inbox_id IS NOT NULL');
    const after = await time();
    console.log(
      '[pool-stability] 쪽지 400줄 삭제: 색인 없이',
      Math.round(before),
      'ms, 색인 있이',
      Math.round(after),
      'ms',
    );
    assert.ok(after * 3 < before, `색인 없이 ${Math.round(before)}ms, 있이 ${Math.round(after)}ms`);
  });
});
