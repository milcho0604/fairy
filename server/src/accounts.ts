import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Db } from './db';
import { newToken, sha256 } from './tokens';

// 계정: 이름 없는 기기 계정 만들기, 계정 잠금, 합치기(21절), 탈퇴.

export type Age = '14+' | '18+';
export const isAge = (v: unknown): v is Age => v === '14+' || v === '18+';

export type Items = Record<string, number>;

export interface LockedAccount {
  id: string;
  balance: number;
}

/**
 * 계정 행을 잠근다(SELECT ... FOR UPDATE). 같은 계정의 맞추기, 옮기기, 합치기가 한 줄로 선다.
 * 그사이 다른 계정에 합쳐져 닫혔으면 남는 쪽을 잠근다. 계정이 없으면(탈퇴) 401.
 */
export async function lockAccount(c: PoolClient, id: string): Promise<LockedAccount> {
  let cur = id;
  for (let hop = 0; hop < 10; hop++) {
    const r = await c.query<{ id: string; balance: string; merged_into: string | null }>(
      'SELECT id, balance, merged_into FROM account WHERE id = $1 FOR UPDATE',
      [cur],
    );
    const row = r.rows[0];
    if (!row) throw new HttpException({ error: 'token' }, HttpStatus.UNAUTHORIZED);
    if (row.merged_into === null) return { id: row.id, balance: Number(row.balance) };
    cur = row.merged_into;
  }
  throw new Error(`계정 ${id} 의 합치기 사슬이 너무 길다`);
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

/** 오늘 날짜 (UTC, YYYY-MM-DD). 서버가 만드는 줄(합치기, 옮기기)의 날짜 */
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

@Injectable()
export class Accounts {
  constructor(private readonly db: Db) {}

  /** 기기 계정과 기기 토큰. 토큰은 여기서만 한 번 나간다 */
  async createDevice(age: Age): Promise<{ token: string; accountId: string }> {
    const token = newToken('device');
    const accountId = await this.db.tx(async (c) => {
      const a = await c.query<{ id: string }>('INSERT INTO account (age) VALUES ($1) RETURNING id', [age]);
      const id = a.rows[0]?.id as string;
      await c.query('INSERT INTO device (account_id, token_hash) VALUES ($1, $2)', [id, sha256(token)]);
      return id;
    });
    return { token, accountId };
  }

  /** 탈퇴: 계정과 코인 내역, 기기, 로그인, 세션, 산 물건, 이 계정에 합쳐진 닫힌 계정까지 바로 지운다 */
  async delete(accountId: string): Promise<void> {
    await this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      await c.query('DELETE FROM account WHERE id = $1', [a.id]);
    });
  }

  /** 계정의 잔액과 산 물건 (합치기 확인 화면) */
  async summary(c: PoolClient, accountId: string): Promise<{ balance: number; items: Items }> {
    const r = await c.query<{ balance: string }>('SELECT balance FROM account WHERE id = $1', [accountId]);
    return { balance: Number(r.rows[0]?.balance ?? 0), items: await readItems(c, accountId) };
  }

  /**
   * from 계정을 into 계정에 합친다 (21절). 두 계정은 이미 잠겨 있어야 한다.
   * - 코인: 더한다. from 의 잔액을 'merge' 한 줄로 into 에 적는다
   * - 산 물건: 집 단계는 큰 쪽, 집 모양은 합친 모음, 장난감은 종류마다 큰 쪽 (모두 이름마다 큰 쪽이라 한 규칙)
   * - 로그인, 기기 토큰, 세션: into 를 가리키게 바꾼다
   * - from 은 닫고(closed_at, merged_into) 장부는 남긴다: 다른 기기가 옛 기록을 다시 보내도 한 번만 반영된다
   * - 하루 상한: 합친 날은 두 계정 몫을 넘어도 그대로 둔다 (장부를 옮기지 않으므로 저절로 그렇다)
   */
  async merge(c: PoolClient, from: LockedAccount, into: LockedAccount): Promise<number> {
    if (from.id === into.id) return into.balance;
    if (from.balance > 0) {
      await c.query(
        `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day)
         VALUES ($1, $2, 'merge', $3, $3, 'ok', $4)`,
        [`merge:${from.id}`, into.id, from.balance, utcDay()],
      );
    }
    const balance = into.balance + from.balance;
    await c.query('UPDATE account SET balance = $2 WHERE id = $1', [into.id, balance]);
    await c.query(
      `INSERT INTO owned_item (account_id, item, count)
       SELECT $2, item, count FROM owned_item WHERE account_id = $1
       ON CONFLICT (account_id, item) DO UPDATE SET count = GREATEST(owned_item.count, EXCLUDED.count)`,
      [from.id, into.id],
    );
    await c.query('DELETE FROM owned_item WHERE account_id = $1', [from.id]);
    for (const table of ['login', 'device', 'session'])
      await c.query(`UPDATE ${table} SET account_id = $2 WHERE account_id = $1`, [from.id, into.id]);
    // 앞서 from 에 합쳐진 계정들도 남는 쪽을 따라가게 (탈퇴하면 함께 지워진다)
    await c.query('UPDATE account SET merged_into = $2 WHERE merged_into = $1', [from.id, into.id]);
    await c.query('UPDATE account SET balance = 0, closed_at = now(), merged_into = $2 WHERE id = $1', [
      from.id,
      into.id,
    ]);
    return balance;
  }

  /** 두 계정을 번호 순으로 잠근다 (서로 다른 순서로 잠가 막히지 않게) */
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
