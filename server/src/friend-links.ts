import type { PoolClient } from 'pg';

// 친구 관계를 계정 변화에 맞추기 (#110). accounts.ts 의 합치기와 나이 바꾸기가 같은 트랜잭션에서 부른다.
// 이 파일은 accounts.ts 를 가져오지 않는다 (서로 가져오지 않게).

/**
 * 규칙에 안 맞게 된 관계를 걷는다: 나이 구분이 다른 친구, 차단이 걸린 친구, 그런 사이의 신청.
 * 친구 줄이 빠져 보여 줄 사람이 없어진 일정도 지운다. ids 는 바뀐 계정들 (남는 쪽)
 */
export async function pruneFriends(c: PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // 나이 구분이 다르거나 차단이 걸린 친구 (두 방향 줄을 함께)
  await c.query(
    `DELETE FROM friend f USING account a, account b
      WHERE a.id = f.account_id AND b.id = f.friend_id
        AND (f.account_id = ANY($1::bigint[]) OR f.friend_id = ANY($1::bigint[]))
        AND (a.age <> b.age OR EXISTS (
          SELECT 1 FROM friend_block k
           WHERE (k.blocker = f.account_id AND k.blocked = f.friend_id)
              OR (k.blocker = f.friend_id AND k.blocked = f.account_id)))`,
    [ids],
  );
  await c.query(
    `DELETE FROM friend_request r USING account a, account b
      WHERE a.id = r.from_account AND b.id = r.to_account
        AND (r.from_account = ANY($1::bigint[]) OR r.to_account = ANY($1::bigint[]))
        AND (a.age <> b.age OR EXISTS (
          SELECT 1 FROM friend_block k
           WHERE (k.blocker = r.from_account AND k.blocked = r.to_account)
              OR (k.blocker = r.to_account AND k.blocked = r.from_account)))`,
    [ids],
  );
  await dropUnsharedBusy(c);
}

/** 바쁜 시간을 보여 줄 친구가 하나도 없는 계정의 일정을 지운다 (공유를 끄면 바로 지운다) */
export async function dropUnsharedBusy(c: PoolClient, accountId?: string): Promise<void> {
  const only = accountId === undefined ? '' : 'AND b.account_id = $1';
  const args = accountId === undefined ? [] : [accountId];
  await c.query(
    `DELETE FROM busy_block b WHERE NOT EXISTS (
       SELECT 1 FROM friend f WHERE f.account_id = b.account_id AND f.share_busy) ${only}`,
    args,
  );
  await c.query(
    `DELETE FROM busy_upload b WHERE NOT EXISTS (
       SELECT 1 FROM friend f WHERE f.account_id = b.account_id AND f.share_busy) ${only}`,
    args,
  );
}

/**
 * from 계정을 into 에 합칠 때 (21절, accounts.ts merge). 두 계정은 이미 잠겨 있다.
 * - 친구: into 쪽으로 옮긴다. 둘 다 같은 친구가 있으면 하나로 (바쁜 시간 공유는 어느 쪽이든 켰으면 켬)
 * - 서로 친구였던 두 계정을 합치면 자기 자신과의 관계가 되어 지운다
 * - 신청, 차단도 옮긴다 (겹치면 하나). 선물 기록은 그대로 두고 하루 상한은 가족 전체로 센다 (friends.ts)
 * - from 이 올린 일정은 지운다 (into 의 앱이 다시 올린다)
 * - 옮긴 뒤 나이 구분이 다르거나 차단이 걸린 관계는 걷는다 (into 의 나이를 따른다)
 */
export async function mergeFriends(c: PoolClient, from: string, into: string): Promise<void> {
  // 친구 (내 쪽 줄)
  await c.query(
    `INSERT INTO friend (account_id, friend_id, share_busy, created_at)
     SELECT $2, friend_id, share_busy, created_at FROM friend WHERE account_id = $1 AND friend_id <> $2
     ON CONFLICT (account_id, friend_id) DO UPDATE
       SET share_busy = friend.share_busy OR EXCLUDED.share_busy,
           created_at = LEAST(friend.created_at, EXCLUDED.created_at)`,
    [from, into],
  );
  // 친구 (상대 쪽 줄)
  await c.query(
    `INSERT INTO friend (account_id, friend_id, share_busy, created_at)
     SELECT account_id, $2, share_busy, created_at FROM friend WHERE friend_id = $1 AND account_id <> $2
     ON CONFLICT (account_id, friend_id) DO UPDATE
       SET share_busy = friend.share_busy OR EXCLUDED.share_busy,
           created_at = LEAST(friend.created_at, EXCLUDED.created_at)`,
    [from, into],
  );
  await c.query('DELETE FROM friend WHERE account_id = $1 OR friend_id = $1', [from]);
  // 신청: 이미 친구가 된 사이의 것과 자기 자신에게 간 것은 버린다
  await c.query(
    `INSERT INTO friend_request (from_account, to_account, status, created_at, expires_at)
     SELECT $2, to_account, status, created_at, expires_at FROM friend_request
      WHERE from_account = $1 AND to_account <> $2
     ON CONFLICT (from_account, to_account) DO NOTHING`,
    [from, into],
  );
  await c.query(
    `INSERT INTO friend_request (from_account, to_account, status, created_at, expires_at)
     SELECT from_account, $2, status, created_at, expires_at FROM friend_request
      WHERE to_account = $1 AND from_account <> $2
     ON CONFLICT (from_account, to_account) DO NOTHING`,
    [from, into],
  );
  await c.query('DELETE FROM friend_request WHERE from_account = $1 OR to_account = $1', [from]);
  await c.query(
    `DELETE FROM friend_request r WHERE (r.from_account = $1 OR r.to_account = $1)
        AND EXISTS (SELECT 1 FROM friend f WHERE f.account_id = r.from_account AND f.friend_id = r.to_account)`,
    [into],
  );
  // 차단
  await c.query(
    `INSERT INTO friend_block (blocker, blocked, created_at)
     SELECT $2, blocked, created_at FROM friend_block WHERE blocker = $1 AND blocked <> $2
     ON CONFLICT DO NOTHING`,
    [from, into],
  );
  await c.query(
    `INSERT INTO friend_block (blocker, blocked, created_at)
     SELECT blocker, $2, created_at FROM friend_block WHERE blocked = $1 AND blocker <> $2
     ON CONFLICT DO NOTHING`,
    [from, into],
  );
  await c.query('DELETE FROM friend_block WHERE blocker = $1 OR blocked = $1', [from]);
  // 일정
  await c.query('DELETE FROM busy_block WHERE account_id = $1', [from]);
  await c.query('DELETE FROM busy_upload WHERE account_id = $1', [from]);
  await pruneFriends(c, [into]);
}
