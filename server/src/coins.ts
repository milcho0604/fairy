import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { type Items, lockAccount, MIGRATE_MAX_BALANCE, readItems, utcDay } from './accounts';
import { Db } from './db';
import {
  EARN_RULES,
  earnAllowed,
  HOUSE_COSTS,
  isDay,
  mondayOf,
  ownedItemOk,
  spendRule,
  TODO_RULE,
} from './shared/coin-rules';

// 코인 정본과 맞추기 (기획서 6절). 규칙 값은 앱과 같은 shared/coin-rules.ts 에서 온다.

/** 한 번에 받는 기록 수. 앱은 몇 분마다 보내므로 넉넉하다 */
export const SYNC_MAX_ENTRIES = 500;
/** 오프라인으로 모아 둔 기록을 받는 기간. 이보다 오래된 날짜는 거절한다 (상한 계산을 끝없이 거슬러 가지 않게) */
export const SYNC_MAX_AGE_DAYS = 30;
/** 쓰는 기록(물건, 먹이) 한 줄의 양 절댓값 상한 (가장 비싼 집 단계 값). 초기화는 잔액까지라 따로 본다 */
export const ENTRY_MAX_ABS = Math.max(...HOUSE_COSTS);
/** 어떤 기록이든 이보다 큰 양은 그 기록만 거절한다 (DB 정수 범위 안에서 다루게) */
export const AMOUNT_MAX = 1_000_000;
export { MIGRATE_MAX_BALANCE };

const ENTRY_ID = /^[A-Za-z0-9_-]{8,64}$/;
const REASON = /^[a-z0-9:_-]{1,40}$/;
const REF = /^[A-Za-z0-9_-]{1,64}$/;

export interface SyncEntry {
  id: string;
  reason: string;
  amount: number;
  day: string;
  /** 할 일 기록(todo, early, undo)의 할 일 번호 */
  ref?: string;
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

/** 요청 모양 검사. 모양이 틀리면 묶음 전체를 400 으로 (앱 버그라 고쳐 보내야 한다). 양의 범위는 기록마다 본다 */
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
      typeof x.day !== 'string' ||
      (x.ref !== undefined && (typeof x.ref !== 'string' || !REF.test(x.ref)))
    )
      throw new BadRequestException({
        error: 'entry',
        id: typeof x?.id === 'string' ? x.id.slice(0, 64) : null,
      });
    return {
      id: x.id,
      reason: x.reason,
      amount: x.amount,
      day: x.day,
      ...(typeof x.ref === 'string' ? { ref: x.ref } : {}),
    };
  });
}

/** 옮기기 요청 검사. 잔액이 너무 커도 거절하지 않는다 (migrate 가 상한으로 깎고 capped 로 알린다) */
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

/** DB 의 asked 칸(정수)에 넣을 수 있게 앱이 보낸 양을 자른다 (기록용) */
const askedOf = (n: number) => Math.max(-AMOUNT_MAX - 1, Math.min(AMOUNT_MAX + 1, n));

@Injectable()
export class Coins {
  constructor(private readonly db: Db) {}

  /**
   * 기록 묶음을 정본에 반영한다. 계정 행을 잠가 두 기기가 동시에 보내도 한 줄로 선다.
   * - 같은 기록 번호는 한 번만 (coin_entry.entry_id 유일, ON CONFLICT DO NOTHING). 다시 오면 처음 결과를 돌려준다
   * - 버는 기록: 까닭마다 한 기록 최대와 하루, 한 주, 7일, 평생 상한을 앱과 같은 규칙으로 다시 보고 상한까지만
   * - 할 일(todo, early, undo): 할 일 번호(ref)로 센다 (TODO_RULE)
   * - 쓰는 기록: 잔액이 모자라면 그 기록만 거절. 물건은 값이 맞아야 하고 이미 가졌으면 거절
   * - 초기화(reset): 잔액까지만 뺀다
   * - 날짜: 오프라인 30일과 계정이 생긴 날(시간대 여유 하루) 중 늦은 날부터 내일까지
   */
  async sync(accountId: string, entries: SyncEntry[], now = Date.now()): Promise<SyncResult> {
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      const items = await readItems(c, acct.id);

      // 이미 받은 기록 (어느 계정이든: 합쳐진 계정의 옛 기록도 다시 반영하지 않는다)
      const ids = [...new Set(entries.map((e) => e.id))];
      const seen = new Map<string, EntryResult>();
      if (ids.length > 0) {
        const r = await c.query<StoredRow>(
          'SELECT entry_id, status, amount, error FROM coin_entry WHERE entry_id = ANY($1::text[])',
          [ids],
        );
        for (const row of r.rows) seen.set(row.entry_id, stored(row));
      }

      const today = utcDay(now);
      // 시간대 차이: 앱의 현지 날짜는 UTC 보다 하루 앞서거나 늦을 수 있다
      const latest = plusDaysUtc(today, 1);
      const born = await c.query<{ d: string | null }>(
        `SELECT to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d FROM account
          WHERE id = $1 OR merged_into = $1`,
        [acct.id],
      );
      const bornDay = plusDaysUtc(born.rows[0]?.d ?? today, -1);
      const thirty = plusDaysUtc(today, -SYNC_MAX_AGE_DAYS);
      const oldest = bornDay > thirty ? bornDay : thirty;
      const from = [mondayOf(oldest), plusDaysUtc(oldest, -6)].sort()[0] as string;
      const st: State = {
        balance: acct.balance,
        items,
        oldest,
        latest,
        sums: await this.earnedSums(c, acct.id, from, latest),
        life: await this.lifeSums(c, acct.id),
        ...(await this.todoState(c, acct.id, entries, from, latest)),
      };

      const results: EntryResult[] = [];
      for (const e of entries) {
        const prev = seen.get(e.id);
        if (prev) {
          results.push({ ...prev, duplicate: true });
          continue;
        }
        const out = this.judge(e, st);
        const inserted = await c.query(
          `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, error, day, ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (entry_id) DO NOTHING RETURNING id`,
          [
            e.id,
            acct.id,
            e.reason,
            askedOf(e.amount),
            out.applied,
            out.status,
            out.error ?? null,
            isDay(e.day) ? e.day : today,
            e.ref ?? null,
          ],
        );
        if (inserted.rowCount === 0) {
          // 다른 계정이 같은 번호를 막 넣었다 (앱이 만든 무작위 번호라 사실상 없다). 반영하지 않는다
          const r = await c.query<StoredRow>(
            'SELECT entry_id, status, amount, error FROM coin_entry WHERE entry_id = $1',
            [e.id],
          );
          const row = r.rows[0];
          const res: EntryResult = row
            ? { ...stored(row), duplicate: true }
            : { id: e.id, status: 'rejected', applied: 0, error: 'conflict' };
          seen.set(e.id, res);
          results.push(res);
          continue;
        }
        this.apply(st, e, out.applied);
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
      if (st.balance !== acct.balance)
        await c.query('UPDATE account SET balance = $2 WHERE id = $1', [acct.id, st.balance]);
      return { balance: st.balance, items, results };
    });
  }

  /** 반영한 기록을 판정 상태에 더한다 */
  private apply(st: State, e: SyncEntry, applied: number) {
    st.balance += applied;
    if (applied > 0) {
      addSum(st.sums, e.reason, e.day, applied);
      st.life.set(e.reason, (st.life.get(e.reason) ?? 0) + applied);
    }
    if (e.ref !== undefined && TODO_RULE.reasons.includes(e.reason)) {
      st.refNet.set(e.ref, (st.refNet.get(e.ref) ?? 0) + applied);
      if (e.reason === 'todo' && applied > 0) {
        const set = st.todoRefs.get(e.day) ?? new Set<string>();
        set.add(e.ref);
        st.todoRefs.set(e.day, set);
      }
    }
  }

  /** 기록 하나의 판정 (DB 를 보지 않는다) */
  private judge(e: SyncEntry, s: State): Judged {
    const reject = (error: string): Judged => ({ status: 'rejected', applied: 0, error });
    if (!isDay(e.day) || e.day > s.latest || e.day < s.oldest) return reject('day');
    if (e.amount === 0 || Math.abs(e.amount) > AMOUNT_MAX) return reject('amount');
    const result = (applied: number, why: string): Judged =>
      applied === e.amount ? { status: 'ok', applied } : { status: 'capped', applied, error: why };

    if (TODO_RULE.reasons.includes(e.reason)) {
      if (e.ref === undefined) return reject('ref');
      const net = Math.max(0, s.refNet.get(e.ref) ?? 0);
      if (e.reason === 'undo') {
        // 이 할 일로 아직 가진 만큼, 그리고 잔액까지만 되받는다 (상한에 걸려 덜 받은 할 일은 덜 뺀다)
        if (e.amount > 0) return reject('amount');
        const back = Math.min(-e.amount, net, s.balance);
        return result(back === 0 ? 0 : -back, net < -e.amount ? 'cap' : 'balance');
      }
      const rule = EARN_RULES[e.reason];
      if (!rule || e.amount < 0 || e.amount > rule.perEntry) return reject('amount');
      const counted = s.todoRefs.get(e.day) ?? new Set<string>();
      if (e.reason === 'todo' && !counted.has(e.ref) && counted.size >= TODO_RULE.refsPerDay)
        return result(0, 'cap');
      // 마감 전 보너스는 그날 코인을 받은 할 일에만 붙는다
      if (e.reason === 'early' && !counted.has(e.ref)) return result(0, 'cap');
      const room = Math.min(TODO_RULE.perRef - net, earnAllowed(rule, e.amount, this.earned(s, e)));
      return result(Math.max(0, room), 'cap');
    }

    const earn = EARN_RULES[e.reason];
    if (earn) {
      if (e.amount < 0 || e.amount > earn.perEntry) return reject('amount');
      return result(earnAllowed(earn, e.amount, this.earned(s, e)), 'cap');
    }

    const spend = spendRule(e.reason);
    if (!spend) return reject('reason');
    if (e.amount > 0) return reject('amount');
    const cost = -e.amount;
    if (spend.kind === 'takeBack') {
      const back = Math.min(cost, s.balance);
      return result(back === 0 ? 0 : -back, 'balance');
    }
    if (cost > ENTRY_MAX_ABS) return reject('amount');
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

  private earned(s: State, e: SyncEntry) {
    return {
      day: s.sums.get(sumKey(e.reason, e.day)) ?? 0,
      week: rangeSum(s.sums, e.reason, mondayOf(e.day), 7),
      days7: rangeSum(s.sums, e.reason, plusDaysUtc(e.day, -6), 7),
      life: s.life.get(e.reason) ?? 0,
    };
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

  /** 계정 평생 상한이 있는 까닭의 합 */
  private async lifeSums(c: PoolClient, accountId: string): Promise<Map<string, number>> {
    const reasons = Object.entries(EARN_RULES)
      .filter(([, r]) => r.perLife !== undefined)
      .map(([k]) => k);
    const r = await c.query<{ reason: string; s: string }>(
      `SELECT reason, SUM(amount) AS s FROM coin_entry
        WHERE account_id = $1 AND amount > 0 AND reason = ANY($2::text[]) GROUP BY reason`,
      [accountId, reasons],
    );
    return new Map(r.rows.map((row) => [row.reason, Number(row.s)]));
  }

  /** 할 일마다 지금 가진 코인(todo + early + undo 순합)과, 날마다 코인을 받은 할 일 번호 */
  private async todoState(
    c: PoolClient,
    accountId: string,
    entries: SyncEntry[],
    from: string,
    to: string,
  ): Promise<Pick<State, 'refNet' | 'todoRefs'>> {
    const refs = [...new Set(entries.flatMap((e) => (e.ref !== undefined ? [e.ref] : [])))];
    const refNet = new Map<string, number>();
    if (refs.length > 0) {
      const r = await c.query<{ ref: string; s: string }>(
        `SELECT ref, SUM(amount) AS s FROM coin_entry
          WHERE account_id = $1 AND ref = ANY($2::text[]) AND reason = ANY($3::text[]) GROUP BY ref`,
        [accountId, refs, TODO_RULE.reasons],
      );
      for (const row of r.rows) refNet.set(row.ref, Number(row.s));
    }
    const todoRefs = new Map<string, Set<string>>();
    const r = await c.query<{ day: string; ref: string }>(
      `SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day, ref FROM coin_entry
        WHERE account_id = $1 AND reason = 'todo' AND amount > 0 AND ref IS NOT NULL
          AND day BETWEEN $2 AND $3`,
      [accountId, from, to],
    );
    for (const row of r.rows) {
      const set = todoRefs.get(row.day) ?? new Set<string>();
      set.add(row.ref);
      todoRefs.set(row.day, set);
    }
    return { refNet, todoRefs };
  }

  /**
   * 기존 잔액과 산 물건을 한 번 올린다 (6절 기존 사용자 옮기기). 로그인 없는 기기 계정마다 한 번, 로그인(sub)마다
   * 한 번 (migration_done 의 키: 계정 키와 그 계정 로그인의 키를 모두 적는다). 잔액은 계정이 옮기기로 받은 합이
   * MIGRATE_MAX_BALANCE 를 넘지 않게 깎고(합쳐도 같다, Accounts.merge), 물건은 이름마다 큰 쪽으로 더한다.
   */
  async migrate(
    accountId: string,
    input: { balance: number; items: Items },
    now = Date.now(),
  ): Promise<{ balance: number; items: Items; applied: number; status: EntryStatus }> {
    return this.db.tx(async (c) => {
      const acct = await lockAccount(c, accountId);
      const logins = await c.query<{ service: string; sub: string }>(
        'SELECT service, sub FROM login WHERE account_id = $1',
        [acct.id],
      );
      const keys = [`account:${acct.id}`, ...logins.rows.map((l) => `login:${l.service}:${l.sub}`)];
      const used = await c.query('SELECT 1 FROM migration_done WHERE key = ANY($1::text[]) LIMIT 1', [keys]);
      if ((used.rowCount ?? 0) > 0) throw new ConflictException({ error: 'already_migrated' });
      const applied = Math.max(0, Math.min(input.balance, MIGRATE_MAX_BALANCE - acct.migrated));
      const status: EntryStatus = applied === input.balance ? 'ok' : 'capped';
      for (const key of keys)
        await c.query('INSERT INTO migration_done (key, account_id, amount) VALUES ($1, $2, $3)', [
          key,
          acct.id,
          applied,
        ]);
      await c.query(
        `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, error, day)
         VALUES ($1, $2, 'migrate', $3, $4, $5, $6, $7)`,
        [
          `migrate:${acct.id}`,
          acct.id,
          askedOf(input.balance),
          applied,
          status,
          status === 'capped' ? 'cap' : null,
          utcDay(now),
        ],
      );
      const balance = acct.balance + applied;
      await c.query('UPDATE account SET balance = $2, migrated = migrated + $3 WHERE id = $1', [
        acct.id,
        balance,
        applied,
      ]);
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

interface State {
  balance: number;
  items: Items;
  oldest: string;
  latest: string;
  sums: Sums;
  life: Map<string, number>;
  refNet: Map<string, number>;
  todoRefs: Map<string, Set<string>>;
}

type Judged = {
  status: EntryStatus;
  applied: number;
  error?: string;
  item?: { key: string; count: number };
};
type StoredRow = { entry_id: string; status: EntryStatus; amount: number; error: string | null };

type Sums = Map<string, number>;
const sumKey = (reason: string, day: string) => `${reason}|${day}`;
const addSum = (sums: Sums, reason: string, day: string, n: number) =>
  sums.set(sumKey(reason, day), (sums.get(sumKey(reason, day)) ?? 0) + n);

/** start 부터 n 일의 합 */
function rangeSum(sums: Sums, reason: string, start: string, n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += sums.get(sumKey(reason, plusDaysUtc(start, i))) ?? 0;
  return total;
}

function stored(row: StoredRow): EntryResult {
  return {
    id: row.entry_id,
    status: row.status,
    applied: row.amount,
    ...(row.error ? { error: row.error } : {}),
  };
}
