import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { familyIds, lockAccount, utcDay } from './accounts';
import { Db } from './db';
import { normalizeCoupon } from './shared/site-events';
import { sha256 } from './tokens';

// 이벤트 선물 받기, 쿠폰 쓰기, 개인 지급 (기획서 9절, 이슈 #101).
// 모두 코인 장부(coin_entry)에 서버가 만든 기록 번호로 남기고 정본 잔액을 같은 트랜잭션에서 고친다.
// 한 번만: 계정 행을 잠가(lockAccount) 같은 계정의 요청이 한 줄로 서고, 유일 제약(event_claim, coupon_use,
// coin_entry.entry_id)이 한 번 더 막는다. 쿠폰은 쿠폰 행도 잠가(FOR UPDATE) 전체 상한을 여러 계정이 함께 넘지 못한다.
// 합쳐진 계정(21절)은 남는 쪽 가족 전체로 센다: 기기마다 받고 합쳐 두 번 받지 못한다.

const fail = (status: HttpStatus, body: Record<string, unknown>) => new HttpException(body, status);

export interface RewardResult {
  /** 받은 뒤 정본 잔액 */
  balance: number;
  coins: number;
  tickets: number;
}

/** 대화권을 더한다 (ai_ticket 이 없으면 만든다) */
export async function addTickets(c: PoolClient, accountId: string, n: number): Promise<void> {
  if (n <= 0) return;
  await c.query(
    `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + EXCLUDED.remaining, updated_at = now()`,
    [accountId, n],
  );
}

/** 서버가 주는 코인 한 줄. 같은 기록 번호면 넣지 않고 false */
export async function creditCoins(
  c: PoolClient,
  o: { entryId: string; accountId: string; reason: string; coins: number; balance: number; now: number },
): Promise<boolean> {
  if (o.coins <= 0) return true;
  const r = await c.query(
    `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day)
     VALUES ($1, $2, $3, $4, $4, 'ok', $5) ON CONFLICT (entry_id) DO NOTHING RETURNING id`,
    [o.entryId, o.accountId, o.reason, o.coins, utcDay(o.now)],
  );
  if (r.rowCount === 0) return false;
  await c.query('UPDATE account SET balance = $2 WHERE id = $1', [o.accountId, o.balance + o.coins]);
  return true;
}

@Injectable()
export class Rewards {
  constructor(private readonly db: Db) {}

  /** 선물과 쿠폰을 로그인 계정만 받는지 (server_setting.rewards_login_only, 기본 켬) */
  async loginOnly(q: Pick<PoolClient, 'query'> = this.db.pool): Promise<boolean> {
    const r = await q.query<{ value: unknown }>(
      `SELECT value FROM server_setting WHERE key = 'rewards_login_only'`,
    );
    return r.rows[0]?.value !== false;
  }

  async setLoginOnly(c: PoolClient, on: boolean): Promise<boolean> {
    const before = await this.loginOnly(c);
    await c.query(
      `INSERT INTO server_setting (key, value) VALUES ('rewards_login_only', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(on)],
    );
    return before;
  }

  /**
   * 이벤트 선물 받기 (POST /v1/claim). 계정당 이벤트당 한 번.
   * 404 no_event, 409 not_gift(배수 이벤트), not_started, ended, already_claimed
   */
  async claim(accountId: string, eventId: string, now = Date.now()): Promise<RewardResult> {
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      const r = await c.query<{ kind: string; coins: number | null; starts: string; ends: string }>(
        `SELECT kind, coins, (extract(epoch FROM starts_at) * 1000)::bigint AS starts,
                (extract(epoch FROM ends_at) * 1000)::bigint AS ends
           FROM event WHERE id = $1 FOR SHARE`,
        [eventId],
      );
      const ev = r.rows[0];
      if (!ev) throw fail(HttpStatus.NOT_FOUND, { error: 'no_event' });
      if (ev.kind !== 'gift' || !ev.coins) throw fail(HttpStatus.CONFLICT, { error: 'not_gift' });
      if (now < Number(ev.starts)) throw fail(HttpStatus.CONFLICT, { error: 'not_started' });
      if (now >= Number(ev.ends)) throw fail(HttpStatus.CONFLICT, { error: 'ended' });
      const fam = await familyIds(c, acct.id);
      const done = await c.query(
        'SELECT 1 FROM event_claim WHERE event_id = $1 AND account_id = ANY($2::bigint[])',
        [eventId, fam],
      );
      if ((done.rowCount ?? 0) > 0)
        throw fail(HttpStatus.CONFLICT, { error: 'already_claimed', balance: acct.balance });
      const ins = await c.query(
        `INSERT INTO event_claim (event_id, account_id, coins) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING event_id`,
        [eventId, acct.id, ev.coins],
      );
      if (ins.rowCount === 0)
        throw fail(HttpStatus.CONFLICT, { error: 'already_claimed', balance: acct.balance });
      const ok = await creditCoins(c, {
        entryId: `claim:${acct.id}:${eventId}`,
        accountId: acct.id,
        reason: 'claim',
        coins: ev.coins,
        balance: acct.balance,
        now,
      });
      // 유일 제약이 막았다 (위의 잠금 때문에 사실상 없다): 트랜잭션을 되돌린다
      if (!ok) throw fail(HttpStatus.CONFLICT, { error: 'already_claimed', balance: acct.balance });
      return { balance: acct.balance + ev.coins, coins: ev.coins, tickets: 0 };
    });
  }

  /**
   * 쿠폰 쓰기 (POST /v1/coupon). 코드 모양은 부르는 쪽이 본다 (normalizeCoupon).
   * 404 no_coupon(없음, 꺼짐), 409 not_started, ended, already_used, sold_out.
   * 대화권은 만 18세 이상 계정에만 준다 (8절. 아니면 코인만, tickets 0)
   */
  async coupon(accountId: string, code: string, now = Date.now()): Promise<RewardResult> {
    const norm = normalizeCoupon(code);
    if (!norm) throw fail(HttpStatus.BAD_REQUEST, { error: 'code' });
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      const r = await c.query<{
        id: string;
        coins: number;
        tickets: number;
        starts: string;
        ends: string;
        max_uses: number;
        used: number;
        disabled: boolean;
      }>(
        `SELECT id, coins, tickets, (extract(epoch FROM starts_at) * 1000)::bigint AS starts,
                (extract(epoch FROM ends_at) * 1000)::bigint AS ends, max_uses, used,
                disabled_at IS NOT NULL AS disabled
           FROM coupon WHERE code_hash = $1 FOR UPDATE`,
        [sha256(norm)],
      );
      const cp = r.rows[0];
      if (!cp || cp.disabled) throw fail(HttpStatus.NOT_FOUND, { error: 'no_coupon' });
      if (now < Number(cp.starts)) throw fail(HttpStatus.CONFLICT, { error: 'not_started' });
      if (now >= Number(cp.ends)) throw fail(HttpStatus.CONFLICT, { error: 'ended' });
      const fam = await familyIds(c, acct.id);
      const used = await c.query(
        'SELECT 1 FROM coupon_use WHERE coupon_id = $1 AND account_id = ANY($2::bigint[])',
        [cp.id, fam],
      );
      if ((used.rowCount ?? 0) > 0) throw fail(HttpStatus.CONFLICT, { error: 'already_used' });
      if (cp.used >= cp.max_uses) throw fail(HttpStatus.CONFLICT, { error: 'sold_out' });
      const age = (await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [acct.id])).rows[0]
        ?.age;
      const tickets = age === '18+' ? cp.tickets : 0;
      const ins = await c.query(
        `INSERT INTO coupon_use (coupon_id, account_id, coins, tickets) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING coupon_id`,
        [cp.id, acct.id, cp.coins, tickets],
      );
      if (ins.rowCount === 0) throw fail(HttpStatus.CONFLICT, { error: 'already_used' });
      await c.query('UPDATE coupon SET used = used + 1 WHERE id = $1', [cp.id]);
      const ok = await creditCoins(c, {
        entryId: `coupon:${cp.id}:${acct.id}`,
        accountId: acct.id,
        reason: 'coupon',
        coins: cp.coins,
        balance: acct.balance,
        now,
      });
      if (!ok) throw fail(HttpStatus.CONFLICT, { error: 'already_used' });
      await addTickets(c, acct.id, tickets);
      return { balance: acct.balance + cp.coins, coins: cp.coins, tickets };
    });
  }
}
