import type { PoolClient } from 'pg';
import { sendInbox } from './inbox';

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
  // 걷는 신청의 안 연 쪽지도 지운다 (줄을 지우면 쪽지의 friend_request_id 가 비워지므로 먼저, 버그잡이 #135)
  const gone = await c.query<{ id: string }>(
    `SELECT r.id FROM friend_request r JOIN account a ON a.id = r.from_account JOIN account b ON b.id = r.to_account
      WHERE (r.from_account = ANY($1::bigint[]) OR r.to_account = ANY($1::bigint[]))
        AND (a.age <> b.age OR EXISTS (
          SELECT 1 FROM friend_block k
           WHERE (k.blocker = r.from_account AND k.blocked = r.to_account)
              OR (k.blocker = r.to_account AND k.blocked = r.from_account)))`,
    [ids],
  );
  await dropRequests(
    c,
    gone.rows.map((r) => r.id),
  );
  await dropUnsharedBusy(c);
}

/** 신청 줄을 지운다. 받는 사람이 아직 열지 않은 신청 쪽지도 함께 (열린 쪽지는 이력으로 남긴다) */
export async function dropRequests(c: PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await c.query('DELETE FROM inbox WHERE friend_request_id = ANY($1::bigint[]) AND opened_at IS NULL', [ids]);
  await c.query('DELETE FROM friend_request WHERE id = ANY($1::bigint[])', [ids]);
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
  // 신청: 줄을 옮긴다 (새로 넣으면 번호가 바뀌어 받는 사람 쪽지의 friend_request_id 가 끊긴다, 버그잡이 #135).
  // 자기 자신에게 간 것, 남는 쪽에 같은 짝이 이미 있는 것, 이미 친구가 된 사이의 것은 버린다
  const dup = await c.query<{ id: string }>(
    `SELECT r.id FROM friend_request r
      WHERE (r.from_account = $1 AND (r.to_account = $2 OR EXISTS (
               SELECT 1 FROM friend_request x WHERE x.from_account = $2 AND x.to_account = r.to_account)))
         OR (r.to_account = $1 AND (r.from_account = $2 OR EXISTS (
               SELECT 1 FROM friend_request x WHERE x.to_account = $2 AND x.from_account = r.from_account)))`,
    [from, into],
  );
  await dropRequests(
    c,
    dup.rows.map((r) => r.id),
  );
  await c.query('UPDATE friend_request SET from_account = $2 WHERE from_account = $1', [from, into]);
  await c.query('UPDATE friend_request SET to_account = $2 WHERE to_account = $1', [from, into]);
  const done = await c.query<{ id: string }>(
    `SELECT r.id FROM friend_request r WHERE (r.from_account = $1 OR r.to_account = $1)
        AND EXISTS (SELECT 1 FROM friend f WHERE f.account_id = r.from_account AND f.friend_id = r.to_account)`,
    [into],
  );
  await dropRequests(
    c,
    done.rows.map((r) => r.id),
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

/** 선물 쪽지를 열 수 있는 날 수. 지나면 보낸 사람에게 돌려준다 (사용자 결정 2026-10-16) */
export const GIFT_KEEP_DAYS = 30;

/**
 * 선물 하나를 보낸 사람에게 돌려준다 (#110, 사용자 결정 2026-10-16). 돌려주는 길은 이 함수 하나다:
 * - expired: 받는 쪽지의 기한(30일)이 지났다. Friends.sweep 이 선물마다 트랜잭션 하나로 부른다 (정리 작업 방식, 읽을 때 하지 않는다)
 * - receiver_left: 받는 사람이 탈퇴한다 (accounts.ts delete, 계정을 지우는 같은 트랜잭션)
 * - ineligible: 받는 사람이 열 때 보낸 사람과 나이 구분이 다르거나 더는 친구가 아니다 (inbox.ts open): 코인과 이용권 모두 돌려주고 쪽지는 닫는다
 *
 * 잠금 순서는 어디서나 같다 (교착 방지, 버그잡이 #135 2차): 계정(번호 작은 것부터) → 선물 줄 → 쪽지 줄.
 * 부르는 쪽이 보낸 사람 계정을 이미 잠가 두어야 한다 (lockAccountsOrdered). 선물 줄을 잠근 뒤 returned_at 과 열림을 다시 보므로
 * 정리 작업 둘, 쪽지 열기, 탈퇴가 겹쳐도 한 번만 된다. 보낸 사람 장부 'gift-back:<선물>'(까닭 gift_back)은 기록 번호가 유일하다.
 * 보낸 사람에게는 gift_back 쪽지를 남긴다 (양은 이미 넣었으니 열어도 더 주지 않는다). 보낸 사람이 탈퇴했으면 표시만 한다.
 * 돌려줬으면 true
 */
export async function returnGift(
  c: PoolClient,
  giftId: string,
  why: 'expired' | 'receiver_left' | 'ineligible',
  now = Date.now(),
): Promise<boolean> {
  const g = (
    await c.query<{
      id: string;
      from_live: string | null;
      to_account: string | null;
      coins: number;
      passes: number;
      inbox_id: string | null;
      returned: boolean;
    }>(
      `SELECT g.id, (SELECT COALESCE(a.merged_into, a.id) FROM account a WHERE a.id = g.from_account) AS from_live,
              g.to_account, g.coins, g.passes, g.inbox_id, g.returned_at IS NOT NULL AS returned
         FROM friend_gift g WHERE g.id = $1 FOR UPDATE`,
      [giftId],
    )
  ).rows[0];
  if (!g || g.returned || !g.inbox_id) return false;
  const note = (
    await c.query<{ opened: boolean; late: boolean }>(
      `SELECT opened_at IS NOT NULL AS opened, (expires_at IS NOT NULL AND expires_at <= clock_timestamp()) AS late
         FROM inbox WHERE id = $1 FOR UPDATE`,
      [g.inbox_id],
    )
  ).rows[0];
  if (!note) return false;
  // 안 연 쪽지만 (열기에서 부르는 ineligible 도 열림 표시를 하기 전이다)
  if (note.opened) return false;
  if (why === 'expired' && !note.late) return false;
  const coins = g.coins;
  await c.query('UPDATE friend_gift SET returned_at = now() WHERE id = $1', [g.id]);
  // 받는 쪽 쪽지는 더 열지 못하게 (탈퇴면 곧 함께 지워진다)
  await c.query(
    'UPDATE inbox SET expires_at = LEAST(COALESCE(expires_at, now()), clock_timestamp()) WHERE id = $1',
    [g.inbox_id],
  );
  if (!g.from_live) return true;
  if (coins > 0) {
    const ins = await c.query(
      `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day)
       VALUES ($1, $2, 'gift_back', $3, $3, 'ok', $4) ON CONFLICT (entry_id) DO NOTHING RETURNING id`,
      [`gift-back:${g.id}`, g.from_live, coins, new Date(now).toISOString().slice(0, 10)],
    );
    if ((ins.rowCount ?? 0) > 0)
      await c.query('UPDATE account SET balance = balance + $2 WHERE id = $1', [g.from_live, coins]);
  }
  if (g.passes > 0)
    await c.query(
      `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + EXCLUDED.remaining, updated_at = now()`,
      [g.from_live, g.passes],
    );
  // 받는 사람 이름은 이 쪽지를 만들 때의 것만 남긴다 (스냅샷, sendInbox). 탈퇴로 돌아온 것은 비운다 ("떠난 친구")
  const who = why === 'receiver_left' || !g.to_account ? null : g.to_account;
  await sendInbox(c, g.from_live, { kind: 'gift_back', coins, chatPasses: g.passes, fromAccount: who });
  return true;
}

/** 받는 사람 가족에게 간 아직 안 돌려준 선물 번호 (한 번에 limit 개) */
export async function unreturnedTo(c: PoolClient, toAccounts: string[], limit = 500): Promise<string[]> {
  const r = await c.query<{ id: string }>(
    `SELECT g.id FROM friend_gift g JOIN inbox i ON i.id = g.inbox_id
      WHERE g.to_account = ANY($1::bigint[]) AND g.returned_at IS NULL AND i.opened_at IS NULL ORDER BY g.id LIMIT $2`,
    [toAccounts, limit],
  );
  return r.rows.map((x) => x.id);
}

/** 기한(30일)이 지난 안 돌려준 선물 번호와 그 보낸 사람 (잠그지 않고 훑는다. 돌려줄 때 다시 본다) */
export async function expiredGifts(
  c: PoolClient,
  limit = 500,
): Promise<{ id: string; fromLive: string | null }[]> {
  const r = await c.query<{ id: string; from_live: string | null }>(
    `SELECT g.id, (SELECT COALESCE(a.merged_into, a.id) FROM account a WHERE a.id = g.from_account) AS from_live
       FROM friend_gift g JOIN inbox i ON i.id = g.inbox_id
      WHERE g.returned_at IS NULL AND i.opened_at IS NULL AND i.expires_at IS NOT NULL AND i.expires_at <= clock_timestamp()
      ORDER BY g.id LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({ id: x.id, fromLive: x.from_live }));
}
