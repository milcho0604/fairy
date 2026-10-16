import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Accounts, familyIds, lockAccount, lockAccountsOrdered, utcDay } from './accounts';
import { AdminAccess } from './admin-access';
import { AiAdmin } from './ai-admin';
import { Auth, AuthGuard, type AuthInfo, type HttpReq } from './auth.guard';
import { Db } from './db';
import { type FeatureKey, Features } from './features';
import { dropUnsharedBusy, expiredGifts, GIFT_KEEP_DAYS, returnGift } from './friend-links';
import { sendInbox } from './inbox';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';
import { normalizeDeviceCode } from './shared/account-profile';
import { kstDay } from './shared/site-events';

// 친구 (이슈 #110 1부): 친구 맺기, 친구 선물, 일정 공유 1차(바쁜 시간대만). 펫 놀러 가기(2부)는 여기 없다.
// - 로그인(구글, 카카오 세션) 계정만. 기기 토큰은 403 login_required. 만 14세 미만은 서버 계정이 없다
// - 친구는 같은 나이 구분끼리만 (만 14~17세끼리, 성인끼리). 검색은 없다: 상대의 기기 코드(설정, 초대 링크)로 신청하고 상대가 수락
// - 막혔거나, 나이 구분이 다르거나, 상대가 친구 기능을 못 쓰면 모두 409 unavailable 하나로 답한다 (상대의 나이와 차단을 알리지 않는다)
// - 선물: 보낸 사람 잔액(코인, 채팅 이용권)에서 빼고 받는 사람 쪽지함에 쪽지로 (열 때 준다, inbox.ts). 하루 상한은 한국 날짜로
//   보내기와 받기 각각, 합쳐진 계정은 가족 전체로 센다. 두 계정을 번호 순으로 잠가 동시 요청도 한 줄로 선다
// - 일정: 앱이 앞으로 14일의 바쁜 시간대(시작, 끝)만 올린다. 보여 줄 친구가 없어지면 바로 지운다. 남의 일정은 그 친구가 나에게
//   켠 것만 (아니면 404)

/** 친구 수 상한 (보낸 신청 포함) */
export const FRIEND_MAX = 100;
/** 신청은 이만큼 뒤 만료 */
export const REQUEST_DAYS = 14;
/** 한 사람이 받아 둘 수 있는 신청 수 (쪽지함이 넘치지 않게) */
export const INCOMING_MAX = 100;
/** 하루 선물 상한 (보내기, 받기 각각, 한국 날짜) */
export const GIFT_DAY_COINS = 500;
export const GIFT_DAY_PASSES = 5;
/** 일정: 앞으로 이만큼만 받고 보인다 */
export const BUSY_DAYS = 14;
/** 한 번에 올리는 바쁜 시간대 수 */
export const BUSY_MAX = 400;
const SWEEP_MS = 60 * 60_000;
const DAY = 86_400_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const fail = (status: HttpStatus, body: Record<string, unknown>) => new HttpException(body, status);

export interface Person {
  code: string;
  nickname: string | null;
}

export interface FriendView extends Person {
  since: string;
  /** 내가 이 친구에게 바쁜 시간을 보여 준다 */
  iShare: boolean;
  /** 이 친구가 나에게 바쁜 시간을 보여 준다 */
  theyShare: boolean;
  /** 이 친구가 마지막으로 일정을 올린 때 (보여 줄 때만) */
  busyAt: string | null;
}

export interface RequestView extends Person {
  id: number;
  sentAt: string;
  expiresAt: string;
}

export interface GiftResult {
  gift: { id: number; to: Person; coins: number; passes: number; sentAt: string };
  /** 보낸 뒤 내 코인 잔액과 남은 채팅 이용권 */
  balance: number;
  chatPasses: number;
  /** 오늘 보낸 합 (이번 것 포함) */
  today: { coins: number; passes: number };
  duplicate?: true;
}

/** 기기 코드를 계정 번호로 (합쳐진 쪽 코드면 남는 쪽). 없으면 undefined */
async function findByCode(q: Pick<PoolClient, 'query'>, raw: unknown): Promise<string | undefined> {
  const code = normalizeDeviceCode(raw);
  if (!code) return undefined;
  const r = await q.query<{ id: string }>(
    'SELECT COALESCE(merged_into, id) AS id FROM account WHERE code = $1',
    [code],
  );
  return r.rows[0]?.id;
}

async function person(c: PoolClient, id: string): Promise<Person> {
  const r = await c.query<Person>('SELECT code, nickname FROM account WHERE id = $1', [id]);
  return r.rows[0] ?? { code: '', nickname: null };
}

const isFriend = async (c: PoolClient, a: string, b: string): Promise<boolean> =>
  ((await c.query('SELECT 1 FROM friend WHERE account_id = $1 AND friend_id = $2', [a, b])).rowCount ?? 0) >
  0;

const blockedEither = async (c: PoolClient, a: string, b: string): Promise<'me' | 'them' | null> => {
  const r = await c.query<{ blocker: string }>(
    `SELECT blocker FROM friend_block WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)`,
    [a, b],
  );
  if (r.rows.some((x) => x.blocker === a)) return 'me';
  return r.rows.length > 0 ? 'them' : null;
};

const friendCount = async (c: PoolClient, id: string): Promise<number> =>
  (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM friend WHERE account_id = $1', [id])).rows[0]
    ?.n ?? 0;

@Injectable()
export class Friends implements OnModuleInit, OnModuleDestroy {
  #sweep: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Db,
    private readonly accounts: Accounts,
    private readonly features: Features,
    private readonly access: AdminAccess,
    private readonly aiAdmin: AiAdmin,
  ) {}

  onModuleInit(): void {
    const run = () =>
      void this.sweep().catch((err) => console.warn('[friends] 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  /**
   * 정리 작업 (시간마다): 만료된 신청, 끝난 바쁜 시간대, 기한(30일)이 지난 안 연 선물 돌려주기. 선물 돌려주기는 읽을 때가 아니라
   * 이 작업이 한다 (쪽지함을 열지 않는 사람의 선물도 제때 돌아가게). 한 번에 500개씩, 남으면 다음 차례에 이어서
   */
  async sweep(): Promise<number> {
    await this.db.pool.query('DELETE FROM friend_request WHERE expires_at <= now()');
    await this.db.pool.query('DELETE FROM busy_block WHERE ends_at <= now()');
    // 선물마다 트랜잭션 하나: 보낸 사람 계정 → 선물 줄 → 쪽지 줄 순으로 잠근다 (쪽지 열기, 탈퇴와 같은 순서, 교착 없음).
    // 받는 사람 계정은 잠그지 않는다: 열기와는 선물 줄 잠금이 막아 준다 (돌려준 선물은 열기가 410)
    let n = 0;
    for (const g of await this.db.tx((c) => expiredGifts(c)))
      n += await this.db.tx(async (c) => {
        if (g.fromLive) await lockAccountsOrdered(c, [g.fromLive]);
        return (await returnGift(c, g.id, 'expired')) ? 1 : 0;
      });
    return n;
  }

  /** 로그인 세션이고 기능을 쓸 수 있는가 (친구 기능은 늘 함께 본다) */
  async gate(auth: AuthInfo, ...keys: FeatureKey[]): Promise<void> {
    if (auth.via !== 'session') throw fail(HttpStatus.FORBIDDEN, { error: 'login_required' });
    for (const key of ['friends' as const, ...keys])
      if (!(await this.features.featureAllowed(key, auth.accountId)))
        throw fail(HttpStatus.FORBIDDEN, { error: 'feature_off', feature: key });
  }

  /** 상대가 나와 친구가 될 수 있나: 로그인 계정, 같은 나이 구분, 친구 기능 */
  private async eligible(c: PoolClient, me: string, other: string): Promise<boolean> {
    const r = await c.query<{ same: boolean; login: boolean }>(
      `SELECT a.age = b.age AS same, EXISTS (SELECT 1 FROM login WHERE account_id = b.id) AS login
         FROM account a, account b WHERE a.id = $1 AND b.id = $2`,
      [me, other],
    );
    const row = r.rows[0];
    return !!row?.same && !!row.login && (await this.features.featureAllowed('friends', other));
  }

  /** 상대의 기기 코드를 잠긴 계정 둘로 (내 쪽, 상대 쪽). 코드가 없으면 404 no_user, 자기 자신이면 409 self */
  private async pairByCode(c: PoolClient, me: string, code: unknown): Promise<[string, string]> {
    const other = await findByCode(c, code);
    if (!other) throw fail(HttpStatus.NOT_FOUND, { error: 'no_user' });
    const [a, b] = await this.accounts.lockPair(c, me, other);
    if (a.id === b.id) throw fail(HttpStatus.CONFLICT, { error: 'self' });
    return [a.id, b.id];
  }

  // ---- 목록 ----

  async list(accountId: string) {
    return this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      const p = await person(c, me.id);
      const friends = await c.query<{
        code: string;
        nickname: string | null;
        since: Date;
        i_share: boolean;
        they_share: boolean;
        busy_at: Date | null;
      }>(
        `SELECT a.code, a.nickname, f.created_at AS since, f.share_busy AS i_share,
                COALESCE(g.share_busy, false) AS they_share,
                CASE WHEN g.share_busy THEN (SELECT updated_at FROM busy_upload u WHERE u.account_id = f.friend_id) END
                  AS busy_at
           FROM friend f JOIN account a ON a.id = f.friend_id
           LEFT JOIN friend g ON g.account_id = f.friend_id AND g.friend_id = f.account_id
          WHERE f.account_id = $1 ORDER BY f.created_at, a.code`,
        [me.id],
      );
      const req = async (sql: string) =>
        (
          await c.query<{
            id: string;
            code: string;
            nickname: string | null;
            created_at: Date;
            expires_at: Date;
          }>(sql, [me.id])
        ).rows.map(
          (r): RequestView => ({
            id: Number(r.id),
            code: r.code,
            nickname: r.nickname,
            sentAt: r.created_at.toISOString(),
            expiresAt: r.expires_at.toISOString(),
          }),
        );
      const incoming = await req(
        `SELECT r.id, a.code, a.nickname, r.created_at, r.expires_at FROM friend_request r
           JOIN account a ON a.id = r.from_account
          WHERE r.to_account = $1 AND r.status = 'pending' AND r.expires_at > now() ORDER BY r.id DESC`,
      );
      // 거절된 신청도 보낸 쪽에는 "기다리는 중"으로 보인다 (거절을 알리지 않는다)
      const outgoing = await req(
        `SELECT r.id, a.code, a.nickname, r.created_at, r.expires_at FROM friend_request r
           JOIN account a ON a.id = r.to_account
          WHERE r.from_account = $1 AND r.expires_at > now() AND NOT r.withdrawn ORDER BY r.id DESC`,
      );
      const blocked = await c.query<Person>(
        `SELECT a.code, a.nickname FROM friend_block k JOIN account a ON a.id = k.blocked
          WHERE k.blocker = $1 ORDER BY k.created_at DESC`,
        [me.id],
      );
      return {
        me: p,
        friends: friends.rows.map(
          (r): FriendView => ({
            code: r.code,
            nickname: r.nickname,
            since: r.since.toISOString(),
            iShare: r.i_share,
            theyShare: r.they_share,
            busyAt: r.busy_at?.toISOString() ?? null,
          }),
        ),
        incoming,
        outgoing,
        blocked: blocked.rows,
        limits: {
          friends: FRIEND_MAX,
          giftCoinsPerDay: GIFT_DAY_COINS,
          giftPassesPerDay: GIFT_DAY_PASSES,
          requestDays: REQUEST_DAYS,
          busyDays: BUSY_DAYS,
        },
        today: await this.sentToday(c, await familyIds(c, me.id), Date.now()),
      };
    });
  }

  private async sentToday(c: PoolClient, fam: string[], now: number) {
    const r = await c.query<{ coins: number; passes: number }>(
      `SELECT COALESCE(sum(coins), 0)::int AS coins, COALESCE(sum(passes), 0)::int AS passes FROM friend_gift
        WHERE from_account = ANY($1::bigint[]) AND day = $2`,
      [fam, kstDay(now)],
    );
    return { coins: r.rows[0]?.coins ?? 0, passes: r.rows[0]?.passes ?? 0 };
  }

  private async receivedToday(c: PoolClient, fam: string[], now: number) {
    const r = await c.query<{ coins: number; passes: number }>(
      `SELECT COALESCE(sum(coins), 0)::int AS coins, COALESCE(sum(passes), 0)::int AS passes FROM friend_gift
        WHERE to_account = ANY($1::bigint[]) AND day = $2`,
      [fam, kstDay(now)],
    );
    return { coins: r.rows[0]?.coins ?? 0, passes: r.rows[0]?.passes ?? 0 };
  }

  // ---- 신청, 수락, 거절 ----

  /** 두 사람을 친구로 (두 줄). 둘 사이의 신청은 지우고 그 쪽지는 연 것으로 */
  private async link(c: PoolClient, a: string, b: string): Promise<void> {
    await c.query(
      `INSERT INTO friend (account_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
      [a, b],
    );
    // 쪽지를 먼저 닫는다 (신청 줄을 지우면 쪽지의 friend_request_id 가 비워진다)
    await this.closeNotes(c, await this.between(c, a, b));
    await c.query(
      `DELETE FROM friend_request WHERE (from_account = $1 AND to_account = $2) OR (from_account = $2 AND to_account = $1)`,
      [a, b],
    );
  }

  /** 두 사람 사이의 신청 번호 (어느 쪽이 보냈든) */
  private async between(c: PoolClient, a: string, b: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM friend_request WHERE (from_account = $1 AND to_account = $2) OR (from_account = $2 AND to_account = $1)`,
      [a, b],
    );
    return r.rows.map((x) => x.id);
  }

  /** 신청 쪽지를 "열림"으로 (수락, 거절했다) */
  private async closeNotes(c: PoolClient, requestIds: string[]): Promise<void> {
    if (requestIds.length === 0) return;
    await c.query(
      `UPDATE inbox SET opened_at = now(), opened_coins = 0, opened_passes = 0
        WHERE friend_request_id = ANY($1::bigint[]) AND opened_at IS NULL`,
      [requestIds],
    );
  }

  /**
   * 친구 신청 (기기 코드로). 상대가 이미 나에게 신청해 두었으면 바로 친구가 된다 (accepted: true).
   * 404 no_user, 409 self, already_friends, already_requested, blocked_by_you, unavailable, limit
   */
  async request(accountId: string, code: unknown, now = Date.now()) {
    return this.db.tx(async (c) => {
      const [me, other] = await this.pairByCode(c, accountId, code);
      if (await isFriend(c, me, other)) throw fail(HttpStatus.CONFLICT, { error: 'already_friends' });
      const block = await blockedEither(c, me, other);
      if (block === 'me') throw fail(HttpStatus.CONFLICT, { error: 'blocked_by_you' });
      if (block || !(await this.eligible(c, me, other)))
        throw fail(HttpStatus.CONFLICT, { error: 'unavailable' });
      const theirs = await c.query(
        `SELECT 1 FROM friend_request WHERE from_account = $1 AND to_account = $2 AND status = 'pending'
            AND expires_at > now()`,
        [other, me],
      );
      if ((theirs.rowCount ?? 0) > 0) {
        if ((await friendCount(c, me)) >= FRIEND_MAX) throw fail(HttpStatus.CONFLICT, { error: 'limit' });
        if ((await friendCount(c, other)) >= FRIEND_MAX)
          throw fail(HttpStatus.CONFLICT, { error: 'unavailable' });
        await this.link(c, me, other);
        return { accepted: true, friend: await person(c, other) };
      }
      const mine = await c.query<{ live: boolean }>(
        'SELECT expires_at > now() AS live FROM friend_request WHERE from_account = $1 AND to_account = $2',
        [me, other],
      );
      if (mine.rows[0]?.live) throw fail(HttpStatus.CONFLICT, { error: 'already_requested' });
      if (mine.rows[0])
        await c.query('DELETE FROM friend_request WHERE from_account = $1 AND to_account = $2', [me, other]);
      const used = await c.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM friend WHERE account_id = $1)
              + (SELECT count(*) FROM friend_request WHERE from_account = $1 AND expires_at > now()) AS n`,
        [me],
      );
      if (Number(used.rows[0]?.n ?? 0) >= FRIEND_MAX) throw fail(HttpStatus.CONFLICT, { error: 'limit' });
      const waiting = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM friend_request WHERE to_account = $1 AND status = 'pending' AND expires_at > now()`,
        [other],
      );
      if ((waiting.rows[0]?.n ?? 0) >= INCOMING_MAX)
        throw fail(HttpStatus.CONFLICT, { error: 'unavailable' });
      const expires = now + REQUEST_DAYS * DAY;
      const ins = await c.query<{ id: string; created_at: Date; expires_at: Date }>(
        `INSERT INTO friend_request (from_account, to_account, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
         RETURNING id, created_at, expires_at`,
        [me, other, expires],
      );
      const row = ins.rows[0] as { id: string; created_at: Date; expires_at: Date };
      await sendInbox(c, other, {
        kind: 'friend',
        fromAccount: me,
        friendRequestId: row.id,
        expiresAt: expires,
      });
      const p = await person(c, other);
      return {
        accepted: false,
        request: {
          id: Number(row.id),
          ...p,
          sentAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
        } satisfies RequestView,
      };
    });
  }

  /** 받은 신청 하나 (내게 온 것만, 잠그기 전에 보낸 사람을 안다) */
  private async incoming(c: PoolClient, me: string, id: number) {
    const fam = await familyIds(c, me);
    const r = await c.query<{ from_account: string; status: string; live: boolean }>(
      `SELECT from_account, status, expires_at > now() AS live FROM friend_request
        WHERE id = $1 AND to_account = ANY($2::bigint[])`,
      [id, fam],
    );
    const row = r.rows[0];
    const pending = row?.status === 'pending';
    if (!row || !pending) throw fail(HttpStatus.NOT_FOUND, { error: 'no_request' });
    if (!row.live) throw fail(HttpStatus.GONE, { error: 'expired' });
    return row.from_account;
  }

  /** 수락. 404 no_request, 410 expired, 409 unavailable(그사이 막힘, 나이 구분이 바뀜), limit */
  async accept(accountId: string, id: number) {
    return this.db.tx(async (c) => {
      const from = await this.incoming(c, accountId, id);
      const [me, other] = await this.accounts.lockPair(c, accountId, from);
      if (me.id === other.id) throw fail(HttpStatus.NOT_FOUND, { error: 'no_request' });
      // 잠근 뒤 다시 본다 (그사이 취소, 거절)
      await this.incoming(c, me.id, id);
      if ((await blockedEither(c, me.id, other.id)) || !(await this.eligible(c, me.id, other.id)))
        throw fail(HttpStatus.CONFLICT, { error: 'unavailable' });
      if ((await friendCount(c, me.id)) >= FRIEND_MAX) throw fail(HttpStatus.CONFLICT, { error: 'limit' });
      if ((await friendCount(c, other.id)) >= FRIEND_MAX)
        throw fail(HttpStatus.CONFLICT, { error: 'unavailable' });
      await this.link(c, me.id, other.id);
      return { friend: await person(c, other.id) };
    });
  }

  /** 거절. 보낸 쪽에는 알리지 않고 만료까지 다시 보내지 못하게 남긴다 */
  async decline(accountId: string, id: number): Promise<void> {
    await this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      await this.incoming(c, me.id, id);
      await c.query(`UPDATE friend_request SET status = 'declined' WHERE id = $1`, [id]);
      await this.closeNotes(c, [String(id)]);
    });
  }

  /**
   * 보낸 신청 거두기. 상대가 아직 열지 않은 신청 쪽지도 지운다. 이미 거절된 신청은 지우지 않고 보낸 목록에서만 뺀다:
   * 지우면 바로 다시 보내 쪽지함을 채울 수 있었다 (버그잡이 #135). 만료까지 남아 다시 보내기를 막는다
   */
  async cancel(accountId: string, id: number): Promise<void> {
    await this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      const fam = await familyIds(c, me.id);
      const r = await c.query<{ status: string }>(
        'SELECT status FROM friend_request WHERE id = $1 AND from_account = ANY($2::bigint[]) AND NOT withdrawn FOR UPDATE',
        [id, fam],
      );
      const row = r.rows[0];
      if (!row) throw fail(HttpStatus.NOT_FOUND, { error: 'no_request' });
      if (row.status === 'declined') {
        await c.query('UPDATE friend_request SET withdrawn = true WHERE id = $1', [id]);
        return;
      }
      await c.query('DELETE FROM inbox WHERE friend_request_id = $1 AND opened_at IS NULL', [id]);
      await c.query('DELETE FROM friend_request WHERE id = $1', [id]);
    });
  }

  /** 친구 끊기 (두 줄 모두, 바쁜 시간 공유도 함께) */
  async unfriend(accountId: string, code: unknown): Promise<void> {
    await this.db.tx(async (c) => {
      const [me, other] = await this.pairByCode(c, accountId, code);
      const r = await c.query(
        `DELETE FROM friend WHERE (account_id = $1 AND friend_id = $2) OR (account_id = $2 AND friend_id = $1)`,
        [me, other],
      );
      if ((r.rowCount ?? 0) === 0) throw fail(HttpStatus.NOT_FOUND, { error: 'not_friend' });
      await dropUnsharedBusy(c, me);
      await dropUnsharedBusy(c, other);
    });
  }

  /**
   * 차단: 친구면 끊고, 둘 사이 신청과 그 쪽지를 지운다. 막힌 쪽에는 알리지 않는다. 대답은 코드만: 닉네임을 돌려주면
   * 친구가 아니고 나이 구분이 달라도 아무 코드의 닉네임을 읽을 수 있었다 (버그잡이 #135)
   */
  async block(accountId: string, code: unknown): Promise<{ code: string }> {
    return this.db.tx(async (c) => {
      const [me, other] = await this.pairByCode(c, accountId, code);
      await c.query('INSERT INTO friend_block (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        me,
        other,
      ]);
      await c.query(
        `DELETE FROM friend WHERE (account_id = $1 AND friend_id = $2) OR (account_id = $2 AND friend_id = $1)`,
        [me, other],
      );
      const gone = await this.between(c, me, other);
      if (gone.length > 0)
        await c.query('DELETE FROM inbox WHERE friend_request_id = ANY($1::bigint[]) AND opened_at IS NULL', [
          gone,
        ]);
      await c.query(
        `DELETE FROM friend_request WHERE (from_account = $1 AND to_account = $2) OR (from_account = $2 AND to_account = $1)`,
        [me, other],
      );
      await dropUnsharedBusy(c, me);
      await dropUnsharedBusy(c, other);
      return { code: (await person(c, other)).code };
    });
  }

  async unblock(accountId: string, code: unknown): Promise<void> {
    await this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      const other = await findByCode(c, code);
      if (!other) throw fail(HttpStatus.NOT_FOUND, { error: 'no_user' });
      await c.query('DELETE FROM friend_block WHERE blocker = $1 AND blocked = $2', [me.id, other]);
    });
  }

  // ---- 선물 ----

  /** 채팅 이용권을 쓸 수 있는 계정인가 (운영자 스위치, 허용 목록, 운영자 계정, 차단. ai.ts gate 와 같은 판정) */
  private async aiUsable(c: PoolClient, id: string): Promise<boolean> {
    const mode = (await this.aiAdmin.settings(c)).mode;
    if (mode === 'off') return false;
    if (
      mode === 'allowlist' &&
      !(await this.aiAdmin.allowed(c, id)) &&
      !(await this.access.isAdminAccount(id))
    )
      return false;
    return !(await this.aiAdmin.blocked(c, id));
  }

  /**
   * 친구에게 선물 (코인 0~500, 채팅 이용권 0~5, 둘 중 하나는 있어야). requestId 가 같으면 처음 결과를 돌려준다.
   * 404 no_user, not_friend / 409 balance, no_passes, passes_age, passes_not_allowed, passes_not_giftable,
   * daily_send_limit, daily_receive_limit (left 에 남은 양)
   */
  async gift(
    accountId: string,
    o: { to: unknown; coins: number; passes: number; requestId: string },
    now = Date.now(),
  ): Promise<GiftResult> {
    return this.db.tx(async (c) => {
      const [me, other] = await this.pairByCode(c, accountId, o.to);
      const fam = await familyIds(c, me);
      const balance = async () =>
        Number(
          (await c.query<{ b: string }>('SELECT balance AS b FROM account WHERE id = $1', [me])).rows[0]?.b ??
            0,
        );
      const passesLeft = async () =>
        (await c.query<{ n: number }>('SELECT remaining AS n FROM ai_ticket WHERE account_id = $1', [me]))
          .rows[0]?.n ?? 0;
      const prev = await c.query<{
        id: string;
        to_account: string | null;
        coins: number;
        passes: number;
        created_at: Date;
      }>(
        `SELECT id, to_account, coins, passes, created_at FROM friend_gift
          WHERE from_account = ANY($1::bigint[]) AND request_id = $2`,
        [fam, o.requestId],
      );
      const old = prev.rows[0];
      if (old)
        return {
          gift: {
            id: Number(old.id),
            to: old.to_account ? await person(c, old.to_account) : { code: '', nickname: null },
            coins: old.coins,
            passes: old.passes,
            sentAt: old.created_at.toISOString(),
          },
          balance: await balance(),
          chatPasses: await passesLeft(),
          today: await this.sentToday(c, fam, now),
          duplicate: true,
        };
      if (!(await isFriend(c, me, other))) throw fail(HttpStatus.NOT_FOUND, { error: 'not_friend' });
      if (o.passes > 0) {
        const age = await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [other]);
        if (age.rows[0]?.age !== '18+') throw fail(HttpStatus.CONFLICT, { error: 'passes_age' });
        // 이용권 선물 스위치는 보내는 사람과 받는 사람 모두 (사용자 결정 2026-10-16). 지금 이용권은 모두 운영자
        // 지급분이라 이 스위치가 운영자 지급분 선물 여부까지 맡는다. 두 사람 모두 채팅 이용권도 쓸 수 있어야 한다
        if (
          !(await this.features.featureAllowed('friend_gift_passes', me)) ||
          !(await this.features.featureAllowed('friend_gift_passes', other)) ||
          !(await this.aiUsable(c, me)) ||
          !(await this.aiUsable(c, other))
        )
          throw fail(HttpStatus.CONFLICT, { error: 'passes_not_allowed' });
        if ((await passesLeft()) < o.passes) throw fail(HttpStatus.CONFLICT, { error: 'no_passes' });
      }
      const have = await balance();
      if (have < o.coins) throw fail(HttpStatus.CONFLICT, { error: 'balance', balance: have });
      const sent = await this.sentToday(c, fam, now);
      if (sent.coins + o.coins > GIFT_DAY_COINS || sent.passes + o.passes > GIFT_DAY_PASSES)
        throw fail(HttpStatus.CONFLICT, {
          error: 'daily_send_limit',
          left: { coins: GIFT_DAY_COINS - sent.coins, passes: GIFT_DAY_PASSES - sent.passes },
        });
      const got = await this.receivedToday(c, await familyIds(c, other), now);
      if (got.coins + o.coins > GIFT_DAY_COINS || got.passes + o.passes > GIFT_DAY_PASSES)
        throw fail(HttpStatus.CONFLICT, {
          error: 'daily_receive_limit',
          left: { coins: GIFT_DAY_COINS - got.coins, passes: GIFT_DAY_PASSES - got.passes },
        });
      const ins = await c.query<{ id: string; created_at: Date }>(
        `INSERT INTO friend_gift (from_account, to_account, request_id, coins, passes, day)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [me, other, o.requestId, o.coins, o.passes, kstDay(now)],
      );
      const g = ins.rows[0] as { id: string; created_at: Date };
      if (o.coins > 0) {
        // 보낸 쪽 장부: 서버가 만든 기록 번호 'gift-out:<선물>' (받는 쪽은 쪽지를 열 때 'inbox:<쪽지>')
        await c.query(
          `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day)
           VALUES ($1, $2, 'gift_out', $3, $3, 'ok', $4)`,
          [`gift-out:${g.id}`, me, -o.coins, utcDay(now)],
        );
        await c.query('UPDATE account SET balance = balance - $2 WHERE id = $1', [me, o.coins]);
      }
      if (o.passes > 0)
        await c.query(
          'UPDATE ai_ticket SET remaining = remaining - $2, updated_at = now() WHERE account_id = $1',
          [me, o.passes],
        );
      const note = await sendInbox(c, other, {
        kind: 'gift',
        coins: o.coins,
        chatPasses: o.passes,
        fromAccount: me,
        // 30일 안에 열지 않으면 정리 작업이 보낸 사람에게 돌려준다 (friend-links.ts returnGifts)
        expiresAt: now + GIFT_KEEP_DAYS * DAY,
      });
      await c.query('UPDATE friend_gift SET inbox_id = $2 WHERE id = $1', [g.id, note]);
      return {
        gift: {
          id: Number(g.id),
          to: await person(c, other),
          coins: o.coins,
          passes: o.passes,
          sentAt: g.created_at.toISOString(),
        },
        balance: await balance(),
        chatPasses: await passesLeft(),
        today: { coins: sent.coins + o.coins, passes: sent.passes + o.passes },
      };
    });
  }

  // ---- 일정 공유 1차 (바쁜 시간대만) ----

  /** 이 친구에게 바쁜 시간 보여 주기 켜고 끄기. 끄고 나서 보여 줄 친구가 없으면 올린 일정을 바로 지운다 */
  async share(accountId: string, code: unknown, on: boolean): Promise<{ share: boolean; sharing: number }> {
    return this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      const other = await findByCode(c, code);
      if (!other) throw fail(HttpStatus.NOT_FOUND, { error: 'no_user' });
      const r = await c.query('UPDATE friend SET share_busy = $3 WHERE account_id = $1 AND friend_id = $2', [
        me.id,
        other,
        on,
      ]);
      if ((r.rowCount ?? 0) === 0) throw fail(HttpStatus.NOT_FOUND, { error: 'not_friend' });
      if (!on) await dropUnsharedBusy(c, me.id);
      return { share: on, sharing: await this.sharingCount(c, me.id) };
    });
  }

  private async sharingCount(c: PoolClient, id: string): Promise<number> {
    return (
      (
        await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM friend WHERE account_id = $1 AND share_busy',
          [id],
        )
      ).rows[0]?.n ?? 0
    );
  }

  /** 모든 친구에게 보여 주기를 끄고 올린 일정을 지운다 (구글 일정 연결을 끊었을 때) */
  async stopSharing(accountId: string): Promise<void> {
    await this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      await c.query('UPDATE friend SET share_busy = false WHERE account_id = $1', [me.id]);
      await dropUnsharedBusy(c, me.id);
    });
  }

  /**
   * 바쁜 시간대 올리기 (전체를 바꾼다). 지금부터 BUSY_DAYS 일 안으로 자르고 겹친 것은 합친다.
   * 보여 줄 친구가 없으면 409 not_sharing (그리고 남은 것을 지운다)
   */
  async upload(accountId: string, blocks: { start: number; end: number }[], now = Date.now()) {
    return this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      if ((await this.sharingCount(c, me.id)) === 0) {
        await dropUnsharedBusy(c, me.id);
        throw fail(HttpStatus.CONFLICT, { error: 'not_sharing' });
      }
      const merged = mergeBlocks(blocks, now - 60 * 60_000, now + BUSY_DAYS * DAY);
      await c.query('DELETE FROM busy_block WHERE account_id = $1', [me.id]);
      if (merged.length > 0)
        await c.query(
          `INSERT INTO busy_block (account_id, starts_at, ends_at)
           SELECT $1, to_timestamp(s / 1000.0), to_timestamp(e / 1000.0)
             FROM unnest($2::float8[], $3::float8[]) AS t(s, e)`,
          [me.id, merged.map((b) => b.start), merged.map((b) => b.end)],
        );
      await c.query(
        `INSERT INTO busy_upload (account_id) VALUES ($1)
         ON CONFLICT (account_id) DO UPDATE SET updated_at = now()`,
        [me.id],
      );
      return { stored: merged.length };
    });
  }

  /** 친구의 바쁜 시간대 (그 친구가 나에게 켰을 때만, 아니면 404 not_shared) */
  async busy(accountId: string, code: unknown, now = Date.now()) {
    return this.db.tx(async (c) => {
      const me = await lockAccount(c, accountId);
      const other = await findByCode(c, code);
      if (!other) throw fail(HttpStatus.NOT_FOUND, { error: 'not_shared' });
      const r = await c.query(
        'SELECT 1 FROM friend WHERE account_id = $1 AND friend_id = $2 AND share_busy',
        [other, me.id],
      );
      if ((r.rowCount ?? 0) === 0 || !(await this.features.featureAllowed('friend_calendar', other)))
        throw fail(HttpStatus.NOT_FOUND, { error: 'not_shared' });
      const rows = await c.query<{ s: string; e: string }>(
        `SELECT (extract(epoch FROM starts_at) * 1000)::bigint AS s, (extract(epoch FROM ends_at) * 1000)::bigint AS e
           FROM busy_block WHERE account_id = $1 AND ends_at > to_timestamp($2 / 1000.0)
            AND starts_at < to_timestamp($3 / 1000.0) ORDER BY starts_at`,
        [other, now, now + BUSY_DAYS * DAY],
      );
      const at = await c.query<{ at: Date }>(
        'SELECT updated_at AS at FROM busy_upload WHERE account_id = $1',
        [other],
      );
      return {
        friend: await person(c, other),
        blocks: rows.rows.map((x) => ({ start: Number(x.s), end: Number(x.e) })),
        updatedAt: at.rows[0]?.at.toISOString() ?? null,
      };
    });
  }
}

/** 바쁜 시간대를 [from, to) 로 자르고 시작 순으로 겹치거나 맞닿은 것을 합친다 */
export function mergeBlocks(
  blocks: { start: number; end: number }[],
  from: number,
  to: number,
): { start: number; end: number }[] {
  const cut = blocks
    .map((b) => ({ start: Math.max(from, b.start), end: Math.min(to, b.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const b of cut) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

/** 올린 바쁜 시간대 검사. 모양이 틀리면 400 blocks (앱 버그) */
export function parseBlocks(body: unknown): { start: number; end: number }[] {
  const raw = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(raw) || raw.length > BUSY_MAX) throw fail(HttpStatus.BAD_REQUEST, { error: 'blocks' });
  return raw.map((x) => {
    const b = x as { start?: unknown; end?: unknown } | null;
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
    if (!b || !ok(b.start) || !ok(b.end) || b.end <= b.start)
      throw fail(HttpStatus.BAD_REQUEST, { error: 'blocks' });
    return { start: b.start, end: b.end };
  });
}

/** 선물 요청 검사: 코인 0~500, 이용권 0~5 정수, 둘 중 하나는 0 보다 크게, 요청 번호 */
export function parseGift(body: unknown): { to: unknown; coins: number; passes: number; requestId: string } {
  const b = (body ?? {}) as { to?: unknown; coins?: unknown; passes?: unknown; requestId?: unknown };
  const n = (v: unknown, max: number) =>
    v === undefined ? 0 : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : -1;
  const coins = n(b.coins, GIFT_DAY_COINS);
  const passes = n(b.passes, GIFT_DAY_PASSES);
  if (coins < 0 || passes < 0 || coins + passes === 0)
    throw fail(HttpStatus.BAD_REQUEST, { error: 'amount' });
  if (typeof b.requestId !== 'string' || !REQUEST_ID.test(b.requestId))
    throw fail(HttpStatus.BAD_REQUEST, { error: 'request_id' });
  return { to: b.to, coins, passes, requestId: b.requestId };
}

const idOf = (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw fail(HttpStatus.BAD_REQUEST, { error: 'id' });
  return n;
};

/** 친구 API (#110). 모두 로그인 세션과 기능 키(friends, 그리고 선물은 friend_gifts, 일정은 friend_calendar) */
@Controller('v1/friends')
@UseGuards(AuthGuard)
export class FriendsController {
  constructor(
    private readonly friends: Friends,
    private readonly limiter: RateLimiter,
  ) {}

  /** 내 코드, 친구, 받은 신청, 보낸 신청, 차단, 상한, 오늘 보낸 선물 */
  @Get()
  async list(@Auth() auth: AuthInfo) {
    await this.friends.gate(auth);
    return this.friends.list(auth.accountId);
  }

  /**
   * 신청: { code: 'F-XXXX-XXXX' }. 코드 추측을 막는다: 계정마다 10분 10번, 같은 곳에서 한 시간 60번,
   * 없는 코드는 계정마다 한 시간 5번까지 (넘으면 그 시간 동안 신청을 받지 않는다)
   */
  @Post('requests')
  @HttpCode(201)
  async request(@Auth() auth: AuthInfo, @Body() body: unknown, @Req() req: HttpReq) {
    const missKey = `friend-miss:${auth.accountId}`;
    if (this.limiter.over(missKey, LIMITS.friendMissByAccount))
      throw new HttpException({ error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    this.limiter.check(`friend:${auth.accountId}`, LIMITS.friendByAccount);
    this.limiter.check(`friend:${ipKey(req)}`, LIMITS.friendByIp);
    await this.friends.gate(auth);
    const code = (body as { code?: unknown } | null)?.code;
    try {
      return await this.friends.request(auth.accountId, code);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND)
        this.limiter.take(missKey, LIMITS.friendMissByAccount);
      throw err;
    }
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  async accept(@Auth() auth: AuthInfo, @Param('id') id: string) {
    await this.friends.gate(auth);
    return this.friends.accept(auth.accountId, idOf(id));
  }

  @Post('requests/:id/decline')
  @HttpCode(204)
  async decline(@Auth() auth: AuthInfo, @Param('id') id: string): Promise<void> {
    await this.friends.gate(auth);
    await this.friends.decline(auth.accountId, idOf(id));
  }

  /** 보낸 신청 거두기 */
  @Delete('requests/:id')
  @HttpCode(204)
  async cancel(@Auth() auth: AuthInfo, @Param('id') id: string): Promise<void> {
    await this.friends.gate(auth);
    await this.friends.cancel(auth.accountId, idOf(id));
  }

  @Post('blocks')
  @HttpCode(201)
  async block(@Auth() auth: AuthInfo, @Body() body: unknown) {
    this.limiter.check(`friend:${auth.accountId}`, LIMITS.friendByAccount);
    await this.friends.gate(auth);
    const code = (body as { code?: unknown } | null)?.code;
    return { blocked: await this.coded(auth, () => this.friends.block(auth.accountId, code)) };
  }

  @Delete('blocks/:code')
  @HttpCode(204)
  async unblock(@Auth() auth: AuthInfo, @Param('code') code: string): Promise<void> {
    await this.friends.gate(auth);
    await this.coded(auth, () => this.friends.unblock(auth.accountId, code));
  }

  /** 선물: { to, coins, passes, requestId } */
  @Post('gifts')
  @HttpCode(200)
  async gift(@Auth() auth: AuthInfo, @Body() body: unknown) {
    this.limiter.check(`gift:${auth.accountId}`, LIMITS.giftByAccount);
    await this.friends.gate(auth, 'friend_gifts');
    const g = parseGift(body);
    return this.coded(auth, () => this.friends.gift(auth.accountId, g));
  }

  /** 바쁜 시간대 올리기: { blocks: [{ start, end }] } (ms). 제목은 받지 않는다 */
  @Put('calendar/busy')
  @HttpCode(200)
  async upload(@Auth() auth: AuthInfo, @Body() body: unknown) {
    this.limiter.check(`busy:${auth.accountId}`, LIMITS.busyByAccount);
    await this.friends.gate(auth, 'friend_calendar');
    return this.friends.upload(auth.accountId, parseBlocks(body));
  }

  /**
   * 모두에게 보여 주기 끄고 올린 것 지우기. 기능 키, 로그인과 상관없이 언제나 된다: 기기 토큰도 일부러 받는다
   * (자기 것을 지우는 길이라 막지 않는다. calendar_link 끄기와 같다, 버그잡이 #135 7번)
   */
  @Delete('calendar')
  @HttpCode(204)
  async stop(@Auth() auth: AuthInfo): Promise<void> {
    await this.friends.stopSharing(auth.accountId);
  }

  /**
   * 이 친구에게 바쁜 시간 보여 주기: { share: true | false }. 켜기는 friends 와 friend_calendar, 끄기는 friends 기능 키를 본다.
   * 기능 키가 꺼졌을 때 지우는 길은 DELETE /v1/friends/calendar (늘 된다)
   */
  @Put(':code/calendar')
  @HttpCode(200)
  async share(@Auth() auth: AuthInfo, @Param('code') code: string, @Body() body: unknown) {
    const on = (body as { share?: unknown } | null)?.share;
    if (typeof on !== 'boolean') throw fail(HttpStatus.BAD_REQUEST, { error: 'share' });
    if (on) await this.friends.gate(auth, 'friend_calendar');
    else await this.friends.gate(auth);
    return this.coded(auth, () => this.friends.share(auth.accountId, code, on));
  }

  /** 친구의 바쁜 시간대 (그 친구가 나에게 켰을 때만) */
  @Get(':code/busy')
  async busy(@Auth() auth: AuthInfo, @Param('code') code: string) {
    await this.friends.gate(auth, 'friend_calendar');
    return this.coded(auth, () => this.friends.busy(auth.accountId, code));
  }

  /** 친구 끊기 */
  @Delete(':code')
  @HttpCode(204)
  async unfriend(@Auth() auth: AuthInfo, @Param('code') code: string): Promise<void> {
    await this.friends.gate(auth);
    await this.coded(auth, () => this.friends.unfriend(auth.accountId, code));
  }

  /**
   * 기기 코드를 받는 경로 하나. 없는 코드(404 no_user)는 신청과 같은 "없는 코드" 제한(계정마다 한 시간 5번)으로 센다:
   * 차단, 차단 풀기, 끊기, 공유, 선물, 일정 보기로 코드가 있는지 가려 신청 제한을 우회하지 못하게 (버그잡이 #135)
   */
  private async coded<T>(auth: AuthInfo, fn: () => Promise<T>): Promise<T> {
    const missKey = `friend-miss:${auth.accountId}`;
    if (this.limiter.over(missKey, LIMITS.friendMissByAccount))
      throw new HttpException({ error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.NOT_FOUND &&
        (err.getResponse() as { error?: string }).error === 'no_user'
      )
        this.limiter.take(missKey, LIMITS.friendMissByAccount);
      throw err;
    }
  }
}
