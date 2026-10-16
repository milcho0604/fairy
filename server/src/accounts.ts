import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { backupFilesOf, keepRecent } from './backup';
import { Db } from './db';
import { mergeFriends, pruneFriends, returnGift, unreturnedTo } from './friend-links';
import { deviceCodeFrom } from './shared/account-profile';
import { newToken, sha256 } from './tokens';

// 계정: 이름 없는 기기 계정 만들기, 계정 잠금, 합치기(21절), 탈퇴.

export type Age = '14+' | '18+';
export const isAge = (v: unknown): v is Age => v === '14+' || v === '18+';

export type Items = Record<string, number>;

export interface LockedAccount {
  id: string;
  balance: number;
  /** 기존 잔액 옮기기로 받은 합 (합친 계정 몫 포함) */
  migrated: number;
}

/**
 * 기존 잔액 옮기기 상한 (계정마다, 합쳐도). 기획서에 값이 없어 정했다: 상점 물건을 모두 사는 값
 * (집 6,500 + 모양 1,300 + 장난감 190 = 7,990)을 조금 넘는 10,000. 하루에 실제로 버는 코인이 50~100 쯤
 * (shop 의 집 값 주석)이라 100일 넘게 모은 양이다. 앱 장부는 사용자 컴퓨터의 sqlite 라 고쳐 올릴 수 있으므로,
 * 옮기기로 생길 수 있는 코인을 이 안으로 묶는다.
 */
export const MIGRATE_MAX_BALANCE = 10_000;

/**
 * 계정 행을 잠근다(SELECT ... FOR UPDATE). 같은 계정의 맞추기, 옮기기, 합치기가 한 줄로 선다.
 * 그사이 다른 계정에 합쳐져 닫혔으면 남는 쪽을 잠근다. 계정이 없으면(탈퇴) 401.
 */
export async function lockAccount(c: PoolClient, id: string): Promise<LockedAccount> {
  let cur = id;
  for (let hop = 0; hop < 10; hop++) {
    const r = await c.query<{ id: string; balance: string; migrated: number; merged_into: string | null }>(
      'SELECT id, balance, migrated, merged_into FROM account WHERE id = $1 FOR UPDATE',
      [cur],
    );
    const row = r.rows[0];
    if (!row) throw new HttpException({ error: 'token' }, HttpStatus.UNAUTHORIZED);
    if (row.merged_into === null) return { id: row.id, balance: Number(row.balance), migrated: row.migrated };
    cur = row.merged_into;
  }
  throw new Error(`계정 ${id} 의 합치기 사슬이 너무 길다`);
}

/**
 * 계정 여럿을 번호 작은 것부터 잠근다. 두 계정 이상을 잠글 때는 어디서나 이 순서를 쓴다 (서로 다른 순서로 잠가 막히지 않게).
 * 합쳐져 닫혔으면 남는 쪽을 잠그므로 같은 계정이 겹쳐도 된다 (이미 잠근 것은 그대로 지나간다)
 */
export async function lockAccountsOrdered(c: PoolClient, ids: string[]): Promise<LockedAccount[]> {
  const sorted = [...new Set(ids)].sort((x, y) =>
    BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0,
  );
  const out: LockedAccount[] = [];
  for (const id of sorted) out.push(await lockAccount(c, id));
  return out;
}

export async function readItems(c: PoolClient | Db['pool'], accountId: string): Promise<Items> {
  const r = await c.query<{ item: string; count: number }>(
    'SELECT item, count FROM owned_item WHERE account_id = $1 ORDER BY item',
    [accountId],
  );
  const out: Items = {};
  for (const row of r.rows) out[row.item] = row.count;
  return out;
}

/** 계정과, 그 계정에 직접이든 사슬로든 합쳐진 모든 계정의 번호 */
export async function familyIds(c: PoolClient, id: string): Promise<string[]> {
  const r = await c.query<{ id: string }>(
    `WITH RECURSIVE fam(id) AS (
       SELECT $1::bigint
       UNION SELECT a.id FROM account a JOIN fam ON a.merged_into = fam.id
     ) SELECT id FROM fam`,
    [id],
  );
  return r.rows.map((row) => row.id);
}

/** 오늘 날짜 (UTC, YYYY-MM-DD). 서버가 만드는 줄(합치기, 옮기기)의 날짜 */
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

@Injectable()
export class Accounts {
  constructor(private readonly db: Db) {}

  /**
   * 기기 계정과 기기 토큰. 토큰은 여기서만 한 번 나간다. 기기 코드(F-XXXX-XXXX)는 무작위로 만들고, 드물게 겹치면
   * 다시 뽑는다 (유일 제약). 닉네임은 검사한 값만 (없어도 된다)
   */
  async createDevice(
    age: Age,
    nickname: string | null = null,
  ): Promise<{ token: string; accountId: string; code: string }> {
    const token = newToken('device');
    for (let attempt = 0; ; attempt++) {
      const code = deviceCodeFrom(randomBytes(8));
      try {
        const accountId = await this.db.tx(async (c) => {
          const a = await c.query<{ id: string }>(
            'INSERT INTO account (age, code, nickname) VALUES ($1, $2, $3) RETURNING id',
            [age, code, nickname],
          );
          const id = a.rows[0]?.id as string;
          await c.query('INSERT INTO device (account_id, token_hash) VALUES ($1, $2)', [id, sha256(token)]);
          return id;
        });
        return { token, accountId, code };
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (attempt < 5 && pg.code === '23505' && pg.constraint === 'account_code_key') continue;
        throw err;
      }
    }
  }

  /** 닉네임 바꾸기 (검사한 값) */
  async setNickname(accountId: string, nickname: string): Promise<void> {
    await this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      await c.query('UPDATE account SET nickname = $2 WHERE id = $1', [a.id, nickname]);
    });
  }

  /** 앱에 보이는 계정 정보: 기기 코드와 닉네임 (계정 번호는 보이지 않는다) */
  async profile(accountId: string): Promise<{ code: string; nickname: string | null }> {
    const r = await this.db.pool.query<{ code: string; nickname: string | null }>(
      'SELECT code, nickname FROM account WHERE id = $1',
      [accountId],
    );
    const row = r.rows[0];
    if (!row) throw new HttpException({ error: 'token' }, HttpStatus.UNAUTHORIZED);
    return row;
  }

  /**
   * 이 기기가 구글 일정을 연결했는지 적는다 (#115). 토큰은 받지 않는다: 표시만. 같은 값을 다시 보내도 된다
   */
  async setCalendarLinked(deviceId: string, linked: boolean): Promise<void> {
    if (linked)
      await this.db.pool.query(
        'INSERT INTO calendar_link (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING',
        [deviceId],
      );
    else await this.db.pool.query('DELETE FROM calendar_link WHERE device_id = $1', [deviceId]);
  }

  /**
   * 계정의 구글 일정 연결 표시 (#115): 연결한 기기 수와 하나라도 있는가. 합쳐진 닫힌 계정의 기기는 이미 남는 쪽으로
   * 옮겨 왔으므로 이 계정의 기기만 센다
   */
  async calendarOf(accountId: string): Promise<{ linked: boolean; devices: number }> {
    const r = await this.db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM calendar_link l JOIN device d ON d.id = l.device_id WHERE d.account_id = $1`,
      [accountId],
    );
    const devices = r.rows[0]?.n ?? 0;
    return { linked: devices > 0, devices };
  }

  /**
   * 탈퇴: 계정과 코인 내역, 기기, 로그인, 세션, 산 물건, 서버 백업 줄, 이 계정에 합쳐진 닫힌 계정까지 바로 지운다.
   * 지운 백업의 파일 이름을 돌려준다 (부르는 쪽이 디스크에서 바로 지운다, backup.ts removeFiles)
   */
  async delete(accountId: string): Promise<string[]>;
  /**
   * onlyIf 가 false 를 돌려주면 지우지 않고 null (오래 안 쓴 계정 정리, account-cleanup.ts). 계정을 잠근 뒤에 다시 따져 보므로,
   * 후보를 읽은 뒤 그 계정이 로그인하거나 요청을 보냈으면 지우지 않는다
   */
  async delete(
    accountId: string,
    onlyIf: (c: PoolClient, a: LockedAccount) => Promise<boolean>,
  ): Promise<string[] | null>;
  async delete(
    accountId: string,
    onlyIf?: (c: PoolClient, a: LockedAccount) => Promise<boolean>,
  ): Promise<string[] | null> {
    return this.db.tx(async (c) => {
      // 아직 열지 않은 친구 선물은 보낸 사람에게 돌려준다 (#110, 사용자 결정 2026-10-16). 받는 사람과 그 보낸 사람들을
      // 번호 순으로 먼저 잠근다 (정리 작업, 쪽지 열기와 같은 순서: 계정 → 선물 줄 → 쪽지 줄)
      const peek = await familyIds(c, accountId);
      const senders = await c.query<{ id: string }>(
        `SELECT DISTINCT COALESCE(s.merged_into, s.id) AS id FROM friend_gift g JOIN inbox i ON i.id = g.inbox_id
           JOIN account s ON s.id = g.from_account
          WHERE g.to_account = ANY($1::bigint[]) AND g.returned_at IS NULL AND i.opened_at IS NULL`,
        [peek],
      );
      await lockAccountsOrdered(c, [accountId, ...senders.rows.map((r) => r.id)]);
      const a = await lockAccount(c, accountId);
      if (onlyIf && !(await onlyIf(c, a))) return null;
      const files = await backupFilesOf(c, a.id);
      const fam = await familyIds(c, a.id);
      // 500개씩 끝날 때까지 (하루 받기 상한 500 이라도 이틀이면 500개를 넘는다: 남기면 계정과 함께 사라진다)
      for (;;) {
        const ids = await unreturnedTo(c, fam);
        if (ids.length === 0) break;
        for (const id of ids) await returnGift(c, id, 'receiver_left');
      }
      // 이 계정 이름이 담긴 쪽지의 보낸 사람 표시는 비운다 (탈퇴하면 "떠난 친구")
      await c.query(
        'UPDATE inbox SET sender_code = NULL, sender_nickname = NULL WHERE from_account = ANY($1::bigint[])',
        [fam],
      );
      await c.query('DELETE FROM account WHERE id = $1', [a.id]);
      return files;
    });
  }

  /** 나이 구분 바꾸기 (내리기도 된다: 대화권은 18+ 만) */
  async setAge(accountId: string, age: Age): Promise<{ id: string; age: Age }> {
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      await c.query('UPDATE account SET age = $2 WHERE id = $1', [a.id, age]);
      // 친구는 같은 나이 구분끼리만 (#110): 바뀐 구분과 다른 친구, 신청은 걷는다
      await pruneFriends(c, [a.id]);
      return { id: a.id, age };
    });
  }

  /** 세션 하나만 지운다 (로그아웃) */
  async deleteSession(sessionId: string): Promise<void> {
    await this.db.pool.query('DELETE FROM session WHERE id = $1', [sessionId]);
  }

  /** 계정의 잔액과 산 물건 (합치기 확인 화면) */
  async summary(c: PoolClient, accountId: string): Promise<{ balance: number; items: Items }> {
    const r = await c.query<{ balance: string }>('SELECT balance FROM account WHERE id = $1', [accountId]);
    return { balance: Number(r.rows[0]?.balance ?? 0), items: await readItems(c, accountId) };
  }

  /**
   * from 계정을 into 계정에 합친다 (21절). 두 계정은 이미 잠겨 있어야 한다.
   * - 코인: 더한다. from 의 잔액을 'merge' 한 줄로 into 에 적는다. 다만 두 계정이 옮기기로 받은 합이
   *   MIGRATE_MAX_BALANCE 를 넘으면 넘는 만큼은 버린다(기기마다 옮겨 합쳐 코인을 찍어 내지 못하게)
   * - 산 물건: 집 단계는 큰 쪽, 집 모양은 합친 모음, 장난감은 종류마다 큰 쪽 (모두 이름마다 큰 쪽이라 한 규칙)
   * - AI 대화권: 더한다
   * - 로그인, 기기 토큰, 세션: into 를 가리키게 바꾼다
   * - from 은 닫고(closed_at, merged_into) 장부는 남긴다: 다른 기기가 옛 기록을 다시 보내도 한 번만 반영된다
   * - 하루 상한: 합친 날은 두 계정 몫을 넘어도 그대로 둔다 (장부를 옮기지 않으므로 저절로 그렇다)
   * - 친구 (#110): 남는 쪽으로 옮긴다 (friend-links.ts mergeFriends)
   */
  async merge(
    c: PoolClient,
    from: LockedAccount,
    into: LockedAccount,
    /** 최근 2개 밖으로 빠진 서버 백업 파일 이름을 여기 담는다 (커밋 뒤 부르는 쪽이 바로 지운다) */
    dropped: string[] = [],
  ): Promise<number> {
    if (from.id === into.id) return into.balance;
    const over = Math.max(0, from.migrated + into.migrated - MIGRATE_MAX_BALANCE);
    const drop = Math.min(from.balance, over);
    const moved = from.balance - drop;
    if (from.balance > 0) {
      await c.query(
        `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, error, day)
         VALUES ($1, $2, 'merge', $3, $4, $5, $6, $7)`,
        [
          `merge:${from.id}`,
          into.id,
          from.balance,
          moved,
          drop > 0 ? 'capped' : 'ok',
          drop > 0 ? 'migrate_cap' : null,
          utcDay(),
        ],
      );
    }
    const balance = into.balance + moved;
    const migrated = Math.min(MIGRATE_MAX_BALANCE, from.migrated + into.migrated);
    await c.query('UPDATE account SET balance = $2, migrated = $3 WHERE id = $1', [
      into.id,
      balance,
      migrated,
    ]);
    await c.query(
      `INSERT INTO owned_item (account_id, item, count)
       SELECT $2, item, count FROM owned_item WHERE account_id = $1
       ON CONFLICT (account_id, item) DO UPDATE SET count = GREATEST(owned_item.count, EXCLUDED.count)`,
      [from.id, into.id],
    );
    await c.query('DELETE FROM owned_item WHERE account_id = $1', [from.id]);
    // AI 대화권은 더한다 (21절). 선물 기록(ai_gift_seen)은 계정에 묶이지 않아 같은 로그인으로 다시 받지 못한다
    await c.query(
      `INSERT INTO ai_ticket (account_id, remaining)
       SELECT $2, remaining FROM ai_ticket WHERE account_id = $1
       ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + EXCLUDED.remaining, updated_at = now()`,
      [from.id, into.id],
    );
    await c.query('DELETE FROM ai_ticket WHERE account_id = $1', [from.id]);
    // 운영자의 AI 차단, 허용 목록, 정기 지급 (#101): 어느 한쪽이라도 막혔거나 허용됐으면 남는 쪽도 그렇다. 정기 지급은 남는 쪽에
    // 살아 있는 것이 없을 때만 옮기고, 있으면 옮겨 오는 쪽 것을 해지한다 (계정마다 하나)
    await c.query(
      `INSERT INTO ai_block (account_id) SELECT $2 FROM ai_block WHERE account_id = $1 ON CONFLICT DO NOTHING`,
      [from.id, into.id],
    );
    await c.query(
      `INSERT INTO feature_allow (key, account_id) SELECT key, $2 FROM feature_allow WHERE account_id = $1
       ON CONFLICT DO NOTHING`,
      [from.id, into.id],
    );
    await c.query(
      `UPDATE ai_subscription SET canceled_at = now() WHERE account_id = $1 AND canceled_at IS NULL
          AND EXISTS (SELECT 1 FROM ai_subscription WHERE account_id = $2 AND canceled_at IS NULL)`,
      [from.id, into.id],
    );
    await c.query('UPDATE ai_subscription SET account_id = $2 WHERE account_id = $1', [from.id, into.id]);
    for (const table of ['login', 'device', 'session'])
      await c.query(`UPDATE ${table} SET account_id = $2 WHERE account_id = $1`, [from.id, into.id]);
    // 서버 백업은 남는 쪽으로 옮기고 두 계정 것 중 최근 2개만 (21절). 빠진 파일 이름은 dropped 로 돌려준다
    await c.query('UPDATE backup SET account_id = $2 WHERE account_id = $1', [from.id, into.id]);
    // 계정 활동은 둘 중 늦은 쪽 (1년 정리 기준)
    await c.query(
      `UPDATE account SET last_active_at = GREATEST(last_active_at, (SELECT last_active_at FROM account WHERE id = $1))
        WHERE id = $2`,
      [from.id, into.id],
    );
    dropped.push(...(await keepRecent(c, into.id)));
    // 친구, 신청, 차단은 남는 쪽으로 (#110, friend-links.ts). 서로 친구였으면 그 관계는 없어진다
    await mergeFriends(c, from.id, into.id);
    // 앞서 from 에 합쳐진 계정들도 남는 쪽을 따라가게 (탈퇴하면 함께 지워진다)
    await c.query('UPDATE account SET merged_into = $2 WHERE merged_into = $1', [from.id, into.id]);
    await c.query('UPDATE account SET balance = 0, closed_at = now(), merged_into = $2 WHERE id = $1', [
      from.id,
      into.id,
    ]);
    return balance;
  }

  /**
   * 두 계정을 번호 순으로 잠근다 (서로 다른 순서로 잠가 막히지 않게). 둘 중 어느 것도 이 트랜잭션에서
   * 먼저 잠겨 있으면 안 된다. 그사이 합쳐졌으면 두 결과의 id 가 같을 수 있다
   */
  async lockPair(c: PoolClient, a: string, b: string): Promise<[LockedAccount, LockedAccount]> {
    if (BigInt(a) < BigInt(b)) {
      const la = await lockAccount(c, a);
      const lb = await lockAccount(c, b);
      return [la, lb];
    }
    const lb = await lockAccount(c, b);
    const la = await lockAccount(c, a);
    return [la, lb];
  }
}
