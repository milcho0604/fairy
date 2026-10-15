import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { type Items, lockAccount, readItems, utcDay } from './accounts';
import { Db } from './db';
import {
  EARN_RULES,
  earnAllowed,
  HOUSE_COSTS,
  isDay,
  mondayOf,
  ownedItemOk,
  spendRule,
} from './shared/coin-rules';

// 코인 정본과 맞추기 (기획서 6절). 규칙 값은 앱과 같은 shared/coin-rules.ts 에서 온다.

/** 한 번에 받는 기록 수. 앱은 몇 분마다 보내므로 넉넉하다 */
export const SYNC_MAX_ENTRIES = 500;
/** 오프라인으로 모아 둔 기록을 받는 기간. 이보다 오래된 날짜는 거절한다 (상한 계산을 끝없이 거슬러 가지 않게) */
export const SYNC_MAX_AGE_DAYS = 30;
/** 한 기록의 양 절댓값 상한 (가장 비싼 집 단계 값) */
export const ENTRY_MAX_ABS = Math.max(...HOUSE_COSTS);
/**
 * 기존 잔액 옮기기 상한. 기획서에 값이 없어 정했다: 상점 물건을 모두 사는 값(집 6,500 + 모양 1,300 + 장난감 190 = 7,990)을
 * 조금 넘는 10,000. 하루에 실제로 버는 코인이 50~100 쯤(shop 의 집 값 주석)이라 100일 넘게 모은 양이다.
 * 앱 장부는 사용자 컴퓨터의 sqlite 라 고쳐 올릴 수 있으므로, 옮기기로 생길 수 있는 코인을 이 안으로 묶는다.
 */
export const MIGRATE_MAX_BALANCE = 10_000;

const ENTRY_ID = /^[A-Za-z0-9_-]{8,64}$/;
const REASON = /^[a-z0-9:_-]{1,40}$/;

export interface SyncEntry {
  id: string;
  reason: string;
  amount: number;
  day: string;
}

export type EntryStatus = 'ok' | 'capped' | 'rejected';

export interface EntryResult {
  id: string;
  status: EntryStatus;
  /** 실제로 반영한 양 (거절이면 0) */
  applied: number;
  /** 거절이나 상한의 까닭 */
  error?: string;
  /** 전에 이미 받은 기록이다 (처음 결과를 그대로 돌려준다) */
  duplicate?: true;
}

export interface SyncResult {
  balance: number;
  items: Items;
  results: EntryResult[];
}

/** 요청 모양 검사. 모양이 틀리면 묶음 전체를 400 으로 (앱 버그라 고쳐 보내야 한다) */
export function parseEntries(body: unknown): SyncEntry[] {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries) || entries.length > SYNC_MAX_ENTRIES)
    throw new BadRequestException({ error: 'entries' });
  return entries.map((e) => {
    const x = e as Record<string, unknown> | null;
    if (
      !x ||
      typeof x.id !== 'string' ||
      !ENTRY_ID.test(x.id) ||
      typeof x.reason !== 'string' ||
      !REASON.test(x.reason) ||
      typeof x.amount !== 'number' ||
      !Number.isInteger(x.amount) ||
      typeof x.day !== 'string'
    )
      throw new BadRequestException({
        error: 'entry',
        id: typeof x?.id === 'string' ? x.id.slice(0, 64) : null,
      });
    return { id: x.id, reason: x.reason, amount: x.amount, day: x.day };
  });
}

/** 옮기기 요청 검사 */
export function parseMigrate(body: unknown): { balance: number; items: Items } {
  const b = body as { balance?: unknown; items?: unknown } | null;
  if (!b || typeof b.balance !== 'number' || !Number.isInteger(b.balance) || b.balance < 0)
    throw new BadRequestException({ error: 'balance' });
  const raw = b.items ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new BadRequestException({ error: 'items' });
  const items: Items = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'number' || !ownedItemOk(k, v))
      throw new BadRequestException({ error: 'items', item: k });
    items[k] = v;
  }
  return { balance: b.balance, items };
}

const plusDaysUtc = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

@Injectable()
export class Coins {
  constructor(private readonly db: Db) {}

  /**
   * 기록 묶음을 정본에 반영한다. 계정 행을 잠가 두 기기가 동시에 보내도 한 줄로 선다.
   * - 같은 기록 번호는 한 번만 (coin_entry.entry_id 유일, ON CONFLICT DO NOTHING). 다시 오면 처음 결과를 돌려준다
   * - 버는 기록: 까닭마다 한 기록 최대와 하루(매주 선물은 한 주) 상한을 앱과 같은 규칙으로 다시 보고 상한까지만
   * - 쓰는 기록: 잔액이 모자라면 그 기록만 거절. 물건은 값이 맞아야 하고 이미 가졌으면 거절
   * - 되돌리기(undo)와 초기화(reset): 잔액까지만 뺀다
   */
  async sync(accountId: string, entries: SyncEntry[], now = Date.now()): Promise<SyncResult> {
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      let balance = acct.balance;
      const items = await readItems(c, acct.id);

      // 이미 받은 기록 (어느 계정이든: 합쳐진 계정의 옛 기록도 다시 반영하지 않는다)
      const ids = [...new Set(entries.map((e) => e.id))];
      const seen = new Map<string, EntryResult>();
      if (ids.length > 0) {
        const r = await c.query<{
          entry_id: string;
          status: EntryStatus;
          amount: number;
          error: string | null;
        }>('SELECT entry_id, status, amount, error FROM coin_entry WHERE entry_id = ANY($1::text[])', [ids]);
        for (const row of r.rows) seen.set(row.entry_id, stored(row));
      }

      const today = utcDay(now);
      // 시간대 차이: 앱의 현지 날짜는 UTC 보다 하루 앞설 수 있다 (UTC+14 까지)
      const latest = plusDaysUtc(today, 1);
      const oldest = plusDaysUtc(today, -SYNC_MAX_AGE_DAYS);
      const sums = await this.earnedSums(c, acct.id, mondayOf(oldest), latest);

      const results: EntryResult[] = [];
      for (const e of entries) {
        const prev = seen.get(e.id);
        if (prev) {
          results.push({ ...prev, duplicate: true });
          continue;
        }
        const out = this.judge(e, { balance, items, sums, oldest, latest });
        const inserted = await c.query(
          `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, error, day)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (entry_id) DO NOTHING RETURNING id`,
          [
            e.id,
            acct.id,
            e.reason,
            e.amount,
            out.applied,
            out.status,
            out.error ?? null,
            isDay(e.day) ? e.day : today,
          ],
        );
        if (inserted.rowCount === 0) {
          // 다른 계정이 같은 번호를 막 넣었다 (앱이 만든 무작위 번호라 사실상 없다). 반영하지 않는다
          const r = await c.query<{
            status: EntryStatus;
            amount: number;
            error: string | null;
            entry_id: string;
          }>('SELECT entry_id, status, amount, error FROM coin_entry WHERE entry_id = $1', [e.id]);
          const row = r.rows[0];
          const res: EntryResult = row
            ? { ...stored(row), duplicate: true }
            : { id: e.id, status: 'rejected', applied: 0, error: 'conflict' };
          seen.set(e.id, res);
          results.push(res);
          continue;
        }
        balance += out.applied;
        if (out.applied > 0) addSum(sums, e.reason, e.day, out.applied);
        if (out.item) {
          items[out.item.key] = out.item.count;
          await c.query(
            `INSERT INTO owned_item (account_id, item, count) VALUES ($1, $2, $3)
             ON CONFLICT (account_id, item) DO UPDATE SET count = GREATEST(owned_item.count, EXCLUDED.count)`,
            [acct.id, out.item.key, out.item.count],
          );
        }
        const res: EntryResult = {
          id: e.id,
          status: out.status,
          applied: out.applied,
          ...(out.error ? { error: out.error } : {}),
        };
        seen.set(e.id, res);
        results.push(res);
      }
      if (balance !== acct.balance)
        await c.query('UPDATE account SET balance = $2 WHERE id = $1', [acct.id, balance]);
      return { balance, items, results };
    });
  }

  /** 기록 하나의 판정 (DB 를 보지 않는다) */
  private judge(
    e: SyncEntry,
    s: { balance: number; items: Items; sums: Sums; oldest: string; latest: string },
  ): { status: EntryStatus; applied: number; error?: string; item?: { key: string; count: number } } {
    const reject = (error: string) => ({ status: 'rejected' as const, applied: 0, error });
    if (!isDay(e.day) || e.day > s.latest || e.day < s.oldest) return reject('day');
    if (e.amount === 0 || Math.abs(e.amount) > ENTRY_MAX_ABS) return reject('amount');

    const earn = EARN_RULES[e.reason];
    if (earn) {
      if (e.amount < 0 || e.amount > earn.perEntry) return reject('amount');
      const day = s.sums.get(sumKey(e.reason, e.day)) ?? 0;
      const week = earn.perWeek !== undefined ? weekSum(s.sums, e.reason, e.day) : 0;
      const applied = earnAllowed(earn, e.amount, day, week);
      return applied === e.amount ? { status: 'ok', applied } : { status: 'capped', applied, error: 'cap' };
    }

    const spend = spendRule(e.reason);
    if (!spend) return reject('reason');
    if (e.amount > 0) return reject('amount');
    const cost = -e.amount;
    if (spend.kind === 'takeBack') {
      const applied = -Math.min(cost, s.balance);
      return applied === e.amount
        ? { status: 'ok', applied }
        : { status: 'capped', applied, error: 'balance' };
    }
    if (spend.kind === 'spend') {
      if (spend.price !== undefined && cost !== spend.price) return reject('price');
      if (cost > s.balance) return reject('insufficient');
      return { status: 'ok', applied: e.amount };
    }
    if (cost !== spend.price) return reject('price');
    const have = s.items[spend.item] ?? 0;
    if (spend.level !== undefined ? spend.level !== have + 1 : have > 0) return reject('owned');
    if (cost > s.balance) return reject('insufficient');
    return { status: 'ok', applied: e.amount, item: { key: spend.item, count: spend.level ?? 1 } };
  }

  /** 그날 그 까닭으로 이미 반영한 버는 코인 합 (from ~ to) */
  private async earnedSums(c: PoolClient, accountId: string, from: string, to: string): Promise<Sums> {
    const r = await c.query<{ reason: string; day: string; s: string }>(
      `SELECT reason, to_char(day, 'YYYY-MM-DD') AS day, SUM(amount) AS s FROM coin_entry
        WHERE account_id = $1 AND day BETWEEN $2 AND $3 AND amount > 0 AND reason = ANY($4::text[])
        GROUP BY reason, day`,
      [accountId, from, to, Object.keys(EARN_RULES)],
    );
    const sums: Sums = new Map();
    for (const row of r.rows) sums.set(sumKey(row.reason, row.day), Number(row.s));
    return sums;
  }

  /**
   * 기존 잔액과 산 물건을 한 번 올린다 (6절 기존 사용자 옮기기). 기기 토큰마다 한 번만(migration_done).
   * 잔액은 MIGRATE_MAX_BALANCE 까지만 반영하고, 물건은 이름마다 큰 쪽으로 더한다.
   */
  async migrate(
    accountId: string,
    deviceId: string,
    input: { balance: number; items: Items },
    now = Date.now(),
  ): Promise<{ balance: number; items: Items; applied: number; status: EntryStatus }> {
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      const applied = Math.min(input.balance, MIGRATE_MAX_BALANCE);
      const done = await c.query(
        'INSERT INTO migration_done (device_id, balance) VALUES ($1, $2) ON CONFLICT (device_id) DO NOTHING RETURNING device_id',
        [deviceId, applied],
      );
      if (done.rowCount === 0) throw new ConflictException({ error: 'already_migrated' });
      const status: EntryStatus = applied === input.balance ? 'ok' : 'capped';
      await c.query(
        `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, error, day)
         VALUES ($1, $2, 'migrate', $3, $4, $5, $6, $7)`,
        [
          `migrate:${deviceId}`,
          acct.id,
          input.balance,
          applied,
          status,
          status === 'capped' ? 'cap' : null,
          utcDay(now),
        ],
      );
      const balance = acct.balance + applied;
      await c.query('UPDATE account SET balance = $2 WHERE id = $1', [acct.id, balance]);
      for (const [item, count] of Object.entries(input.items)) {
        await c.query(
          `INSERT INTO owned_item (account_id, item, count) VALUES ($1, $2, $3)
           ON CONFLICT (account_id, item) DO UPDATE SET count = GREATEST(owned_item.count, EXCLUDED.count)`,
          [acct.id, item, count],
        );
      }
      return { balance, items: await readItems(c, acct.id), applied, status };
    });
  }
}

type Sums = Map<string, number>;
const sumKey = (reason: string, day: string) => `${reason}|${day}`;
const addSum = (sums: Sums, reason: string, day: string, n: number) =>
  sums.set(sumKey(reason, day), (sums.get(sumKey(reason, day)) ?? 0) + n);

function weekSum(sums: Sums, reason: string, day: string): number {
  let total = 0;
  const mon = mondayOf(day);
  for (let i = 0; i < 7; i++) total += sums.get(sumKey(reason, plusDaysUtc(mon, i))) ?? 0;
  return total;
}

function stored(row: {
  entry_id: string;
  status: EntryStatus;
  amount: number;
  error: string | null;
}): EntryResult {
  return {
    id: row.entry_id,
    status: row.status,
    applied: row.amount,
    ...(row.error ? { error: row.error } : {}),
  };
}
