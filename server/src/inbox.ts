import {
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { familyIds, lockAccount, lockAccountsOrdered } from './accounts';
import { Db } from './db';
import { returnGift } from './friend-links';
import { addTickets, creditCoins } from './rewards';

// 쪽지함 (이슈 #101 범위 추가 4). 운영자가 보내는 쪽지(개인 지급, 알림)와 정기 지급의 달마다 쪽지를 서버 DB 에 둔다.
// - 첨부(코인, 채팅 이용권)는 사용자가 열 때 준다. 계정 행과 쪽지 행을 잠그고 opened_at 을 보므로 동시에 열어도 한 번,
//   코인은 장부 기록 번호 'inbox:<id>' 가 한 번 더 막는다
// - 연 쪽지도 지우지 않고 이력으로 남긴다 (열린 때, 받은 첨부). 1년 지나면 정리, 탈퇴하면 함께 지워진다
// - 같은 계정(같은 구글 로그인, 합쳐진 계정 포함)의 모든 기기가 같은 쪽지함을 본다

/** 한 번에 돌려주는 쪽지 수 */
export const INBOX_PAGE = 20;
const KEEP_OPENED_DAYS = 365;
const SWEEP_MS = 6 * 3_600_000;

/**
 * gift: 친구 선물 (#110, 첨부는 열 때, 30일 기한), friend: 친구 신청 알림 (첨부 없음, 수락과 거절은 친구 칸에서),
 * gift_back: 열지 않은 선물이 돌아왔다는 알림 (coins, chatPasses 는 돌려준 양. 돌려줄 때 넣었으니 열어도 더 주지 않는다)
 */
export type InboxKind = 'grant' | 'notice' | 'subscription' | 'gift' | 'friend' | 'gift_back';

export interface InboxItem {
  id: number;
  kind: InboxKind;
  /** 운영자가 쓴 글 (정기 지급은 없음: 앱이 "이번 달 채팅 이용권" 글을 쓴다) */
  message: string | null;
  /** 보낸 쪽: 운영자, 또는 친구 (#110) */
  from: 'admin' | 'friend';
  /** 보낸 친구의 기기 코드와 닉네임. 운영자 쪽지는 null, 친구가 탈퇴했으면 code 도 null */
  sender: { code: string | null; nickname: string | null } | null;
  coins: number;
  chatPasses: number;
  /** 정기 지급 "N장까지 채우기" */
  fillTo: number | null;
  sentAt: string;
  expiresAt: string | null;
  openedAt: string | null;
  /** 열 때 실제로 받은 것 */
  opened: { coins: number; chatPasses: number } | null;
  expired: boolean;
}

interface Row {
  id: string;
  kind: InboxKind;
  message: string | null;
  coins: number;
  chat_passes: number;
  fill_to: number | null;
  created_at: Date;
  expires_at: Date | null;
  opened_at: Date | null;
  opened_coins: number | null;
  opened_passes: number | null;
  expired: boolean;
  from_account: string | null;
  sender_code: string | null;
  sender_nickname: string | null;
  /** 열 때 지금 시각(clock_timestamp)으로 본 만료 (트랜잭션 시작 시각이 아니라, 기한 직전에 시작한 열기가 정리 작업 뒤에 통과하지 않게) */
  expired_now?: boolean;
}

// 보낸 친구의 코드와 닉네임은 쪽지를 만들 때 담아 둔 것 (스냅샷)
const COLUMNS = `id, kind, message, coins, chat_passes, fill_to, created_at, expires_at, opened_at, opened_coins,
  opened_passes, (expires_at IS NOT NULL AND expires_at <= now()) AS expired, from_account, sender_code, sender_nickname`;

/** 열기를 보낸 사람 계정도 잠그고 다시 하라는 신호 (트랜잭션은 되돌려진다) */
const NEED_SENDER = Symbol('need-sender');

const FRIEND_KINDS: readonly InboxKind[] = ['gift', 'friend', 'gift_back'];

/** 보낸 친구의 코드와 닉네임을 그때 것으로 (없으면 null) */
async function snapshot(
  c: PoolClient,
  accountId: string | null | undefined,
): Promise<{ code: string | null; nickname: string | null }> {
  if (!accountId) return { code: null, nickname: null };
  const r = await c.query<{ code: string; nickname: string | null }>(
    'SELECT code, nickname FROM account WHERE id = $1',
    [accountId],
  );
  return { code: r.rows[0]?.code ?? null, nickname: r.rows[0]?.nickname ?? null };
}

function item(r: Row): InboxItem {
  return {
    id: Number(r.id),
    kind: r.kind,
    message: r.message,
    from: FRIEND_KINDS.includes(r.kind) ? 'friend' : 'admin',
    sender: FRIEND_KINDS.includes(r.kind) ? { code: r.sender_code, nickname: r.sender_nickname } : null,
    coins: r.coins,
    chatPasses: r.chat_passes,
    fillTo: r.fill_to,
    sentAt: r.created_at.toISOString(),
    expiresAt: r.expires_at?.toISOString() ?? null,
    openedAt: r.opened_at?.toISOString() ?? null,
    opened: r.opened_at ? { coins: r.opened_coins ?? 0, chatPasses: r.opened_passes ?? 0 } : null,
    expired: r.expired && !r.opened_at,
  };
}

const fail = (status: HttpStatus, body: Record<string, unknown>) => new HttpException(body, status);

/** 쪽지 한 장 넣기 (운영자 지급, 정기 지급). 받는 계정은 이미 잠겨 있어야 한다 */
export async function sendInbox(
  c: PoolClient,
  accountId: string,
  o: {
    kind: InboxKind;
    message?: string | null;
    coins?: number;
    chatPasses?: number;
    fillTo?: number | null;
    expiresAt?: number | null;
    /** 보낸 친구 (#110 선물과 친구 신청) */
    fromAccount?: string | null;
    friendRequestId?: string | null;
  },
): Promise<string> {
  const who = await snapshot(c, o.fromAccount);
  const r = await c.query<{ id: string }>(
    `INSERT INTO inbox (account_id, kind, message, coins, chat_passes, fill_to, expires_at, from_account,
                        friend_request_id, sender_code, sender_nickname)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::float8 IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END,
             $8, $9, $10, $11)
     RETURNING id`,
    [
      accountId,
      o.kind,
      o.message ?? null,
      o.coins ?? 0,
      o.chatPasses ?? 0,
      o.fillTo ?? null,
      o.expiresAt ?? null,
      o.fromAccount ?? null,
      o.friendRequestId ?? null,
      who.code,
      who.nickname,
    ],
  );
  return r.rows[0]?.id as string;
}

@Injectable()
export class Inbox implements OnModuleInit, OnModuleDestroy {
  #sweep: NodeJS.Timeout | undefined;

  constructor(private readonly db: Db) {}

  onModuleInit(): void {
    const run = () =>
      void this.db.pool
        .query(`DELETE FROM inbox WHERE opened_at < now() - make_interval(days => $1)`, [KEEP_OPENED_DAYS])
        .catch((err) => console.warn('[inbox] 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  /** 쪽지함 한 쪽 (최근 것부터). before 를 주면 그 번호보다 앞의 것. next 가 있으면 더 있다 */
  async list(
    accountId: string,
    before?: number,
  ): Promise<{ items: InboxItem[]; next: number | null; unopened: number }> {
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      const fam = await familyIds(c, a.id);
      const r = await c.query<Row>(
        `SELECT ${COLUMNS} FROM inbox WHERE account_id = ANY($1::bigint[]) AND ($2::bigint IS NULL OR id < $2)
          ORDER BY id DESC LIMIT $3`,
        [fam, before ?? null, INBOX_PAGE + 1],
      );
      const rows = r.rows.slice(0, INBOX_PAGE);
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM inbox WHERE account_id = ANY($1::bigint[]) AND opened_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())`,
        [fam],
      );
      return {
        items: rows.map(item),
        next: r.rows.length > INBOX_PAGE ? Number(rows[rows.length - 1]?.id) : null,
        unopened: n.rows[0]?.n ?? 0,
      };
    });
  }

  /**
   * 쪽지 열기. 남의 쪽지는 404, 이미 열었으면 409 already_opened(그때 받은 것), 만료면 410 expired.
   * 첨부를 정본에 더하고 연 때와 받은 것을 적는다
   */
  async open(
    accountId: string,
    id: number,
    now = Date.now(),
  ): Promise<{ item: InboxItem; balance: number; chatPasses: number }> {
    let r: Awaited<ReturnType<Inbox['openOnce']>>;
    try {
      r = await this.openOnce(accountId, id, now, false);
    } catch (err) {
      // 받는 사람 계정만 잠그고 시작했는데 선물을 돌려줘야 해서 보낸 사람 계정도 필요해졌다: 순서대로 다시
      if (err !== NEED_SENDER) throw err;
      r = await this.openOnce(accountId, id, now, true);
    }
    // 돌려주기는 트랜잭션 안에서 끝내고 (던지면 되돌려지므로) 밖에서 410 으로 알린다
    if ('gone' in r) throw fail(HttpStatus.GONE, { error: 'ineligible', reason: 'ineligible', item: r.gone });
    return r;
  }

  private async openOnce(
    accountId: string,
    id: number,
    now: number,
    withSender: boolean,
  ): Promise<{ item: InboxItem; balance: number; chatPasses: number } | { gone: InboxItem }> {
    return this.db.tx(async (c) => {
      // 잠금 순서: 계정(번호 작은 것부터) → 선물 줄 → 쪽지 줄. 정리 작업, 탈퇴와 같다 (friend-links.ts returnGift).
      // 보낸 사람 계정은 돌려줄 때만 잠근다 (나이 구분과 친구 관계는 잠그지 않고 읽는다). 보통은 받는 사람 계정만이라
      // 정리 작업(보낸 사람 계정만 잠금)과 서로 기다리지 않는다
      const peek = await c.query<{ gid: string; from_live: string | null }>(
        `SELECT g.id AS gid, (SELECT COALESCE(s.merged_into, s.id) FROM account s WHERE s.id = g.from_account) AS from_live
           FROM friend_gift g WHERE g.inbox_id = $1`,
        [id],
      );
      const gift = peek.rows[0];
      await lockAccountsOrdered(c, [accountId, ...(withSender && gift?.from_live ? [gift.from_live] : [])]);
      const a = await lockAccount(c, accountId);
      const fam = await familyIds(c, a.id);
      const mine = await c.query('SELECT 1 FROM inbox WHERE id = $1 AND account_id = ANY($2::bigint[])', [
        id,
        fam,
      ]);
      if ((mine.rowCount ?? 0) === 0) throw fail(HttpStatus.NOT_FOUND, { error: 'no_note' });
      // 선물 줄을 쪽지 줄보다 먼저 잠그고 이미 돌려줬으면 410: 기한 직전에 시작한 열기가 정리 작업 뒤에 통과해 두 번 주지 않게
      if (gift) {
        const g = await c.query<{ returned: boolean }>(
          'SELECT returned_at IS NOT NULL AS returned FROM friend_gift WHERE id = $1 FOR UPDATE',
          [gift.gid],
        );
        // 이용권만 돌려주고 열린 쪽지는 돌려줬어도 이미 연 것이라 아래에서 409
        const opened = await c.query('SELECT 1 FROM inbox WHERE id = $1 AND opened_at IS NOT NULL', [id]);
        if (g.rows[0]?.returned && (opened.rowCount ?? 0) === 0) {
          const gone = await c.query<Row>(`SELECT ${COLUMNS} FROM inbox WHERE id = $1`, [id]);
          throw fail(HttpStatus.GONE, {
            error: 'expired',
            reason: 'expired',
            item: item(gone.rows[0] as Row),
          });
        }
      }
      const r = await c.query<Row>(
        `SELECT ${COLUMNS}, (expires_at IS NOT NULL AND expires_at <= clock_timestamp()) AS expired_now
           FROM inbox WHERE id = $1 AND account_id = ANY($2::bigint[]) FOR UPDATE`,
        [id, fam],
      );
      const row = r.rows[0];
      if (!row) throw fail(HttpStatus.NOT_FOUND, { error: 'no_note' });
      if (row.opened_at) throw fail(HttpStatus.CONFLICT, { error: 'already_opened', item: item(row) });
      if (row.expired || row.expired_now)
        throw fail(HttpStatus.GONE, { error: 'expired', reason: 'expired', item: item(row) });
      // 친구 선물은 열 때 보낸 사람과 나이 구분이 같고 아직 친구인지 다시 본다: 아니면 코인과 이용권 모두 보낸 사람에게
      if (row.kind === 'gift' && gift?.from_live) {
        const ok = await c.query(
          `SELECT 1 FROM account s, account r
            WHERE s.id = $1 AND r.id = $2 AND s.age = r.age
              AND EXISTS (SELECT 1 FROM friend WHERE account_id = r.id AND friend_id = s.id)`,
          [gift.from_live, a.id],
        );
        if ((ok.rowCount ?? 0) === 0) {
          if (!withSender) throw NEED_SENDER;
          await returnGift(c, gift.gid, 'ineligible', now);
          const gone = await c.query<Row>(`SELECT ${COLUMNS} FROM inbox WHERE id = $1`, [id]);
          return { gone: item(gone.rows[0] as Row) };
        }
      }
      // 알림만 있는 쪽지: 친구 신청, 돌아온 선물 (양은 돌려줄 때 이미 넣었다)
      if (row.kind === 'friend' || row.kind === 'gift_back') {
        const u = await c.query<Row>(
          `UPDATE inbox SET opened_at = now(), opened_coins = 0, opened_passes = 0 WHERE id = $1 RETURNING ${COLUMNS}`,
          [row.id],
        );
        const t = await c.query<{ remaining: number }>(
          'SELECT remaining FROM ai_ticket WHERE account_id = $1',
          [a.id],
        );
        return { item: item(u.rows[0] as Row), balance: a.balance, chatPasses: t.rows[0]?.remaining ?? 0 };
      }
      const have = await c.query<{ remaining: number }>(
        'SELECT remaining FROM ai_ticket WHERE account_id = $1',
        [a.id],
      );
      const remaining = have.rows[0]?.remaining ?? 0;
      let passes = row.fill_to !== null ? Math.max(0, row.fill_to - remaining) : row.chat_passes;
      // 이용권이 든 쪽지(운영자 지급, 정기 지급, 친구 선물 모두)는 열 때 만 18세 이상인지 다시 본다: 아니면 이용권은 주지 않고
      // (이용권은 18세 이상만 쓴다) 코인만 준다. 보낸 뒤 나이를 바꾼 경우라 운영 기록에 남긴다
      if (passes > 0) {
        const age = (await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [a.id])).rows[0]
          ?.age;
        if (age !== '18+') {
          // 친구 선물이면 건너뛴 이용권은 보낸 사람에게 (코인은 받는 사람이 받는다). 운영자 지급은 기록만
          if (row.kind === 'gift' && gift?.from_live) {
            if (!withSender) throw NEED_SENDER;
            await returnGift(c, gift.gid, 'passes_only', now);
          }
          await c.query(
            `INSERT INTO admin_log (actor, action, target, detail) VALUES ('system', 'note.passes_skipped', $1, $2)`,
            [`account:${a.id}`, JSON.stringify({ note: Number(row.id), kind: row.kind, passes, age })],
          );
          passes = 0;
        }
      }
      if (row.coins > 0) {
        const ok = await creditCoins(c, {
          entryId: `inbox:${row.id}`,
          accountId: a.id,
          reason: row.kind === 'gift' ? 'gift_in' : 'inbox',
          coins: row.coins,
          balance: a.balance,
          now,
        });
        if (!ok) throw fail(HttpStatus.CONFLICT, { error: 'already_opened' });
      }
      await addTickets(c, a.id, passes);
      const u = await c.query<Row>(
        `UPDATE inbox SET opened_at = now(), opened_coins = $2, opened_passes = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
        [row.id, row.coins, passes],
      );
      return {
        item: item(u.rows[0] as Row),
        balance: a.balance + row.coins,
        chatPasses: remaining + passes,
      };
    });
  }
}
