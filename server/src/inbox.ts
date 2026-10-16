import {
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { familyIds, lockAccount } from './accounts';
import { Db } from './db';
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
  sender: { code: string; nickname: string | null } | null;
}

// 보낸 친구는 합쳐졌으면 남는 쪽 코드와 닉네임으로 보인다
const COLUMNS = `id, kind, message, coins, chat_passes, fill_to, created_at, expires_at, opened_at, opened_coins,
  opened_passes, (expires_at IS NOT NULL AND expires_at <= now()) AS expired, from_account,
  (SELECT json_build_object('code', s.code, 'nickname', s.nickname) FROM account s
    WHERE s.id = (SELECT COALESCE(m.merged_into, m.id) FROM account m WHERE m.id = inbox.from_account)) AS sender`;

const FRIEND_KINDS: readonly InboxKind[] = ['gift', 'friend', 'gift_back'];

function item(r: Row): InboxItem {
  return {
    id: Number(r.id),
    kind: r.kind,
    message: r.message,
    from: FRIEND_KINDS.includes(r.kind) ? 'friend' : 'admin',
    sender: FRIEND_KINDS.includes(r.kind)
      ? { code: r.sender?.code ?? null, nickname: r.sender?.nickname ?? null }
      : null,
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
  const r = await c.query<{ id: string }>(
    `INSERT INTO inbox (account_id, kind, message, coins, chat_passes, fill_to, expires_at, from_account,
                        friend_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::float8 IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END,
             $8, $9)
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
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      const fam = await familyIds(c, a.id);
      const r = await c.query<Row>(
        `SELECT ${COLUMNS} FROM inbox WHERE id = $1 AND account_id = ANY($2::bigint[]) FOR UPDATE`,
        [id, fam],
      );
      const row = r.rows[0];
      if (!row) throw fail(HttpStatus.NOT_FOUND, { error: 'no_note' });
      if (row.opened_at) throw fail(HttpStatus.CONFLICT, { error: 'already_opened', item: item(row) });
      if (row.expired) throw fail(HttpStatus.GONE, { error: 'expired', item: item(row) });
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
      // 친구가 보낸 채팅 이용권 (#110): 보낸 뒤 받는 사람이 만 18세 미만으로 바꿨으면 이용권은 주지 않고 보낸 사람에게
      // 돌려준다 (이용권은 18세 이상만 쓴다). 코인은 그대로 준다
      if (row.kind === 'gift' && passes > 0) {
        const age = (await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [a.id])).rows[0]
          ?.age;
        if (age !== '18+') {
          if (row.from_account) {
            const back = await c.query<{ id: string }>(
              'SELECT COALESCE(merged_into, id) AS id FROM account WHERE id = $1',
              [row.from_account],
            );
            if (back.rows[0]) await addTickets(c, back.rows[0].id, passes);
          }
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
