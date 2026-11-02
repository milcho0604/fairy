import { randomInt } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lockAccount } from './accounts';
import { CLOCK } from './app.tokens';
import type { AuthInfo } from './auth.guard';
import { Db } from './db';
import { Features } from './features';

// 기기 간 동기화 서버 (docs/sync-plan.md 5절). 서버는 덩어리(blob)를 풀거나 해석하지 않는다 (종단 간 암호화).
// - 세션(로그인)만, 기능 키 sync 가 켜진 계정만. 쓰기는 계정 잠금 안의 트랜잭션.
// - 항목마다 rev: 받을 때마다 sync_head.rev 를 1 올려 그 번호를 준다. 기기는 base(자기가 아는 rev)가 서버의 지금 rev 와
//   같을 때만 받아 주고, 다르면 그 항목만 conflict 로 서버 것을 돌려준다 (낙관적 잠금).
// - 상한을 넘으면 묶음 전체를 413 sync_full 로 거절한다 (받은 것까지 반영하면 기기가 어디까지 올라갔는지 따로 맞춰야 한다).
// - 지운 항목도 줄을 남긴다 (deleted). 다른 기기가 changes 로 알아야 한다.
// - 1년 동안 어느 기기도 changes 나 push 하지 않으면 지운다. 30일 전부터 status.soon (서버 백업과 같은 규칙).
// - 탈퇴는 ON DELETE CASCADE, 계정 합치기는 accounts.ts merge 가 닫히는 쪽 사본을 지우고 남는 쪽 epoch 를 올린다.
// - epoch: 서버 사본이 통째로 바뀌면(지우기, 합치기, 열쇠 세대 gen 이 오름) 오른다. changes 와 push 는 기기가 아는 epoch 를
//   받아 다르면 409 epoch 로 돌려보낸다. 모든 응답에 epoch 와 gen 이 들어 있다.
// - 지운 항목은 90일 뒤 정리 작업이 blob 을 비운다 (uid 와 rev 는 남기고, 그때부터 항목 수와 바이트에서 뺀다).
// - 로그와 오류 응답에는 blob 도 uid 도 남기지 않는다.

export const SYNC_BLOB_MAX = 256 * 1024;
export const SYNC_MAX_ITEMS = 100_000;
export const SYNC_MAX_BYTES = 100 * 1024 * 1024;
export const SYNC_PUSH_MAX = 200;
export const SYNC_CHANGES_MAX = 500;
/** changes 한 쪽 응답의 덩어리 합 (넘으면 거기서 끊고 more). 한 항목은 늘 담는다 */
export const SYNC_CHANGES_BYTES = 4 * 1024 * 1024;
/** push 본문 상한 (app.ts 의 이 길만) */
export const SYNC_PUSH_BODY = '4mb';
export const SYNC_IDLE_DAYS = 365;
export const SYNC_NOTICE_DAYS = 30;
/** 지운 항목의 blob 을 비우는 때 (지운 뒤 이만큼) */
export const SYNC_TOMB_DAYS = 90;
/** 마지막 접근을 고치는 최소 간격 (changes 마다 쓰지 않게) */
const TOUCH_MS = 60 * 60_000;
const SWEEP_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

const UID = /^[0-9A-Za-z_.:-]{1,96}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** blob 한 개가 base64 로 가질 수 있는 가장 긴 글자 수 */
const B64_MAX = Math.ceil(SYNC_BLOB_MAX / 3) * 4;
const KEY_PARAMS_MAX = 512;

const fail = (status: HttpStatus, body: Record<string, unknown>) => new HttpException(body, status);
const bad = (error: string, extra: Record<string, unknown> = {}) =>
  fail(HttpStatus.BAD_REQUEST, { error, ...extra });

/** base64 글자를 바이트로. 모양이 틀리면 null (너무 긴 것은 풀기 전에 걸러낸다) */
function unb64(v: unknown, max: number): Buffer | null {
  if (typeof v !== 'string' || v.length > Math.ceil(max / 3) * 4 || !B64.test(v)) return null;
  const b = Buffer.from(v, 'base64');
  return b.length <= max ? b : null;
}

export interface KeyView {
  salt: string;
  params: { N: number; r: number; p: number };
  wrapped: string;
  gen: number;
  key_rev: number;
  epoch: number;
}

/** 모든 응답에 들어가는 두 값 */
export interface Epoch {
  epoch: number;
  gen: number;
}

export interface Pushed {
  uid: string;
  base: number;
  blob: Buffer;
  deleted: boolean;
}

export type PushResult =
  | { uid: string; ok: true; rev: number }
  | { uid: string; ok: false; conflict: { rev: number; blob: string; deleted: boolean } };

interface ItemRow {
  uid: string;
  rev: string;
  blob: Buffer;
  deleted: boolean;
}

type Q = Pick<PoolClient, 'query'>;

/** 지금 epoch 와 gen (동기화가 꺼져 있으면 0, 0) */
async function epochOf(q: Q, accountId: string): Promise<Epoch> {
  const r = await q.query<Epoch>(
    `SELECT COALESCE(h.epoch, 0) AS epoch, COALESCE(k.gen, 0) AS gen
       FROM (SELECT 1) one
       LEFT JOIN sync_head h ON h.account_id = $1
       LEFT JOIN sync_key k ON k.account_id = $1`,
    [accountId],
  );
  return r.rows[0] ?? { epoch: 0, gen: 0 };
}

/** 기기가 아는 epoch 가 지금과 다르면 409 */
function sameEpoch(known: number, now: Epoch): void {
  if (known !== now.epoch) throw fail(HttpStatus.CONFLICT, { error: 'epoch', ...now });
}

const PARAM_KEYS = ['N', 'r', 'p'];
const KEY_FIELDS = new Set(['salt', 'params', 'wrapped', 'gen', 'key_rev']);

/** scrypt 값은 N, r, p 세 정수만 받는다 (그 밖의 칸은 파생 열쇠나 복구 코드와 닿을 수 있어 받지 않는다) */
function scryptParams(p: unknown): { N: number; r: number; p: number } | null {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (Object.keys(o).length !== 3 || !PARAM_KEYS.every((k) => k in o)) return null;
  const { N, r, p: par } = o as Record<string, unknown>;
  const int = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max;
  if (!int(N, 1 << 22) || !int(r, 64) || !int(par, 64)) return null;
  if (((N as number) & ((N as number) - 1)) !== 0 || (N as number) < 2) return null;
  return { N: N as number, r: r as number, p: par as number };
}

@Injectable()
export class Sync implements OnModuleInit, OnModuleDestroy {
  #sweep: NodeJS.Timeout | undefined;
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    private readonly features: Features,
    @Optional() @Inject(CLOCK) clock?: () => number,
  ) {
    this.clock = clock ?? Date.now;
  }

  onModuleInit(): void {
    const run = () =>
      void this.sweep().catch((err) => console.warn('[sync] 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  /** 로그인 세션이고 기능 키 sync 가 켜진 계정인가 */
  async gate(auth: AuthInfo): Promise<void> {
    if (auth.via !== 'session') throw fail(HttpStatus.FORBIDDEN, { error: 'login' });
    if (!(await this.features.featureAllowed('sync', auth.accountId)))
      throw fail(HttpStatus.FORBIDDEN, { error: 'feature_off', feature: 'sync' });
  }

  // ---------------------------------------------------------------- 열쇠

  async getKey(accountId: string): Promise<KeyView> {
    const r = await this.db.pool.query<{
      salt: Buffer;
      params: KeyView['params'];
      wrapped: Buffer;
      gen: number;
      key_rev: number;
      epoch: number;
    }>(
      `SELECT k.salt, k.params, k.wrapped, k.gen, k.key_rev, COALESCE(h.epoch, 0) AS epoch
         FROM sync_key k LEFT JOIN sync_head h ON h.account_id = k.account_id WHERE k.account_id = $1`,
      [accountId],
    );
    const k = r.rows[0];
    if (!k) throw fail(HttpStatus.NOT_FOUND, { error: 'none' });
    return {
      salt: k.salt.toString('base64'),
      params: k.params,
      wrapped: k.wrapped.toString('base64'),
      gen: k.gen,
      key_rev: k.key_rev,
      epoch: k.epoch,
    };
  }

  /**
   * 감싼 열쇠 올리기. 본문: { salt, params: {N, r, p}, wrapped, gen?, key_rev? }
   * - 처음이면 저장한다 (gen 1, key_rev 1).
   * - 이미 있으면 key_rev 가 지금 것과 같을 때만 덮어쓴다 (아니면 409). 덮어쓰면 key_rev+1.
   *   gen 이 지금과 같으면 "복구 코드 새로 만들기"(같은 열쇠를 다시 감쌈), 지금+1 이면 "열쇠 바꾸기"(새 데이터 열쇠):
   *   그 계정의 항목을 모두 지우고 epoch+1.
   */
  async putKey(accountId: string, body: unknown): Promise<Epoch & { key_rev: number; created: boolean }> {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || body === null || Object.keys(b).some((k) => !KEY_FIELDS.has(k)))
      throw bad('fields');
    const salt = unb64(b.salt, 64);
    const wrapped = unb64(b.wrapped, 512);
    if (!salt || salt.length < 8) throw bad('salt');
    if (!wrapped || wrapped.length < 16) throw bad('wrapped');
    const params = scryptParams(b.params);
    if (!params) throw bad('params');
    const posInt = (v: unknown) =>
      v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1);
    if (!posInt(b.gen)) throw bad('gen');
    if (!posInt(b.key_rev)) throw bad('key_rev');
    const gen = b.gen as number | undefined;
    const keyRev = b.key_rev as number | undefined;
    const now = new Date(this.clock());
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      const cur = await c.query<{ gen: number; key_rev: number }>(
        'SELECT gen, key_rev FROM sync_key WHERE account_id = $1 FOR UPDATE',
        [a.id],
      );
      const have = cur.rows[0];
      if (!have) {
        if ((gen ?? 1) !== 1 || (keyRev ?? 1) !== 1) throw bad('gen');
        await c.query(
          `INSERT INTO sync_key (account_id, salt, params, wrapped, gen, key_rev, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, 1, 1, $5, $5)`,
          [a.id, salt, JSON.stringify(params), wrapped, now],
        );
        const h = await c.query<{ epoch: number }>(
          `INSERT INTO sync_head (account_id, epoch, last_access_at) VALUES ($1, $2, $3)
           ON CONFLICT (account_id) DO UPDATE SET last_access_at = EXCLUDED.last_access_at RETURNING epoch`,
          [a.id, randomInt(1, 1_000_000_000), now],
        );
        return { epoch: h.rows[0]?.epoch ?? 0, gen: 1, key_rev: 1, created: true };
      }
      const head = await epochOf(c, a.id);
      if (keyRev === undefined)
        throw fail(HttpStatus.CONFLICT, { error: 'key_exists', ...head, key_rev: have.key_rev });
      if (keyRev !== have.key_rev)
        throw fail(HttpStatus.CONFLICT, { error: 'key_rev', ...head, key_rev: have.key_rev });
      const nextGen = gen ?? have.gen;
      if (nextGen !== have.gen && nextGen !== have.gen + 1) throw bad('gen');
      await c.query(
        `UPDATE sync_key SET salt = $2, params = $3::jsonb, wrapped = $4, gen = $5, key_rev = key_rev + 1, updated_at = $6
          WHERE account_id = $1`,
        [a.id, salt, JSON.stringify(params), wrapped, nextGen, now],
      );
      let epoch = head.epoch;
      if (nextGen !== have.gen) {
        // 새 데이터 열쇠: 옛 열쇠로 잠근 항목은 쓸모가 없다. 기기가 새 열쇠로 다시 올린다
        await c.query('DELETE FROM sync_item WHERE account_id = $1', [a.id]);
        const h = await c.query<{ epoch: number }>(
          `UPDATE sync_head SET epoch = epoch + 1, items = 0, bytes = 0, last_access_at = $2
            WHERE account_id = $1 RETURNING epoch`,
          [a.id, now],
        );
        epoch = h.rows[0]?.epoch ?? epoch;
      }
      return { epoch, gen: nextGen, key_rev: have.key_rev + 1, created: false };
    });
  }

  // ---------------------------------------------------------------- 상태

  async status(accountId: string) {
    const r = await this.db.pool.query<{
      on: boolean;
      items: number;
      bytes: string;
      last: Date | null;
      epoch: number;
      gen: number;
    }>(
      `SELECT k.account_id IS NOT NULL AS on, COALESCE(h.items, 0) AS items, COALESCE(h.bytes, 0) AS bytes,
              h.last_access_at AS last, COALESCE(h.epoch, 0) AS epoch, COALESCE(k.gen, 0) AS gen
         FROM (SELECT 1) one
         LEFT JOIN sync_head h ON h.account_id = $1
         LEFT JOIN sync_key k ON k.account_id = $1`,
      [accountId],
    );
    const row = r.rows[0];
    const expires = row?.last ? row.last.getTime() + SYNC_IDLE_DAYS * DAY_MS : null;
    return {
      on: row?.on === true,
      items: row?.items ?? 0,
      bytes: Number(row?.bytes ?? 0),
      maxItems: SYNC_MAX_ITEMS,
      maxBytes: SYNC_MAX_BYTES,
      soon: row?.on === true && expires !== null && expires - this.clock() <= SYNC_NOTICE_DAYS * DAY_MS,
      epoch: row?.epoch ?? 0,
      gen: row?.gen ?? 0,
    };
  }

  // ---------------------------------------------------------------- 받기

  /** 마지막 접근을 고친다 (한 시간 안에 이미 고쳤으면 쓰지 않는다) */
  private async touch(accountId: string): Promise<void> {
    const now = this.clock();
    await this.db.pool.query(
      'UPDATE sync_head SET last_access_at = $2 WHERE account_id = $1 AND last_access_at < $3',
      [accountId, new Date(now), new Date(now - TOUCH_MS)],
    );
  }

  /**
   * rev 가 since 보다 큰 항목을 rev 순으로. 한 쪽은 limit 개와 덩어리 합 SYNC_CHANGES_BYTES 까지.
   * epoch 는 기기가 아는 값: 지금과 다르면 409 (항목은 주지 않는다)
   */
  async changes(accountId: string, since: number, limit: number, epoch: number) {
    const out = await this.db.tx(async (c) => {
      // 목록과 head 를 같은 시점에서 읽는다
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const now = await epochOf(c, accountId);
      sameEpoch(epoch, now);
      const head = await c.query<{ rev: string }>('SELECT rev FROM sync_head WHERE account_id = $1', [
        accountId,
      ]);
      const meta = await c.query<{ rev: string; len: number }>(
        `SELECT rev, octet_length(blob) AS len FROM sync_item WHERE account_id = $1 AND rev > $2
          ORDER BY rev LIMIT $3`,
        [accountId, since, limit + 1],
      );
      let take = 0;
      let sum = 0;
      for (const m of meta.rows.slice(0, limit)) {
        if (take > 0 && sum + m.len > SYNC_CHANGES_BYTES) break;
        sum += m.len;
        take++;
      }
      const revs = meta.rows.slice(0, take).map((m) => m.rev);
      const rows = revs.length
        ? (
            await c.query<ItemRow>(
              `SELECT uid, rev, blob, deleted FROM sync_item WHERE account_id = $1 AND rev = ANY($2::bigint[])
                ORDER BY rev`,
              [accountId, revs],
            )
          ).rows
        : [];
      return {
        items: rows.map((r) => ({
          uid: r.uid,
          rev: Number(r.rev),
          blob: r.blob.toString('base64'),
          deleted: r.deleted,
        })),
        head: Number(head.rows[0]?.rev ?? 0),
        more: meta.rows.length > take,
        ...now,
      };
    });
    await this.touch(accountId);
    return out;
  }

  // ---------------------------------------------------------------- 보내기

  /** push 본문을 검사한다. 하나라도 틀리면 묶음 전체를 거절한다 */
  parsePush(body: unknown): { items: Pushed[]; epoch: number } {
    const o = (body ?? {}) as { items?: unknown; epoch?: unknown };
    const items = o.items;
    if (typeof o.epoch !== 'number' || !Number.isSafeInteger(o.epoch) || o.epoch < 0) throw bad('epoch');
    if (!Array.isArray(items)) throw bad('items');
    if (items.length > SYNC_PUSH_MAX) throw bad('too_many', { max: SYNC_PUSH_MAX });
    const seen = new Set<string>();
    const out: Pushed[] = [];
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>;
      const uid = it.uid;
      if (typeof uid !== 'string' || !UID.test(uid)) throw bad('uid');
      if (seen.has(uid)) throw bad('dup_uid');
      seen.add(uid);
      const base = it.base;
      if (typeof base !== 'number' || !Number.isSafeInteger(base) || base < 0) throw bad('base');
      const deleted = it.deleted === undefined ? false : it.deleted;
      if (typeof deleted !== 'boolean') throw bad('deleted');
      if (typeof it.blob === 'string' && it.blob.length > B64_MAX)
        throw fail(HttpStatus.PAYLOAD_TOO_LARGE, { error: 'blob_too_big' });
      const blob = unb64(it.blob, SYNC_BLOB_MAX);
      if (!blob) {
        // 글자 수는 맞는데 풀어 보니 큰 것도 too_big
        if (typeof it.blob === 'string' && B64.test(it.blob))
          throw fail(HttpStatus.PAYLOAD_TOO_LARGE, { error: 'blob_too_big' });
        throw bad('blob');
      }
      if (blob.length === 0 && !deleted) throw bad('blob');
      out.push({ uid, base, blob, deleted });
    }
    return { items: out, epoch: o.epoch };
  }

  async push(accountId: string, body: unknown): Promise<{ results: PushResult[]; head: number } & Epoch> {
    const { items, epoch } = this.parsePush(body);
    const now = new Date(this.clock());
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      const has = await c.query('SELECT 1 FROM sync_key WHERE account_id = $1', [a.id]);
      if ((has.rowCount ?? 0) === 0) throw fail(HttpStatus.CONFLICT, { error: 'no_key' });
      const state = await epochOf(c, a.id);
      sameEpoch(epoch, state);
      const h = await c.query<{ rev: string; items: number; bytes: string }>(
        'SELECT rev, items, bytes FROM sync_head WHERE account_id = $1',
        [a.id],
      );
      let rev = Number(h.rows[0]?.rev ?? 0);
      let count = h.rows[0]?.items ?? 0;
      let bytes = Number(h.rows[0]?.bytes ?? 0);
      const cur = new Map<string, { rev: number; len: number; purged: boolean }>();
      if (items.length) {
        const r = await c.query<{ uid: string; rev: string; len: number; purged: boolean }>(
          `SELECT uid, rev, octet_length(blob) AS len, purged_at IS NOT NULL AS purged FROM sync_item WHERE account_id = $1 AND uid = ANY($2::text[])`,
          [a.id, items.map((i) => i.uid)],
        );
        for (const row of r.rows)
          cur.set(row.uid, { rev: Number(row.rev), len: row.len, purged: row.purged });
      }
      const results: PushResult[] = [];
      const lost: string[] = [];
      for (const it of items) {
        const have = cur.get(it.uid);
        if (it.base !== (have?.rev ?? 0)) {
          lost.push(it.uid);
          results.push({ uid: it.uid, ok: false, conflict: { rev: 0, blob: '', deleted: false } });
          continue;
        }
        rev += 1;
        // 비운 줄은 세지 않고 있었으니, 다시 쓰면 센다
        if (!have || have.purged) count += 1;
        bytes += it.blob.length - (have?.len ?? 0);
        await c.query(
          `INSERT INTO sync_item (account_id, uid, rev, blob, deleted, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (account_id, uid) DO UPDATE
             SET rev = EXCLUDED.rev, blob = EXCLUDED.blob, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at,
                 purged_at = NULL`,
          [a.id, it.uid, rev, it.blob, it.deleted, now],
        );
        results.push({ uid: it.uid, ok: true, rev });
      }
      // 한 항목이라도 상한을 넘기면 묶음 전체를 거절한다 (트랜잭션이 되돌려진다)
      if (count > SYNC_MAX_ITEMS || bytes > SYNC_MAX_BYTES)
        throw fail(HttpStatus.PAYLOAD_TOO_LARGE, { error: 'sync_full' });
      await c.query(
        `UPDATE sync_head SET rev = $2, items = $3, bytes = $4, last_access_at = $5 WHERE account_id = $1`,
        [a.id, rev, count, bytes, now],
      );
      if (lost.length) {
        const now2 = await c.query<ItemRow>(
          'SELECT uid, rev, blob, deleted FROM sync_item WHERE account_id = $1 AND uid = ANY($2::text[])',
          [a.id, lost],
        );
        const by = new Map(now2.rows.map((r) => [r.uid, r]));
        for (const r of results) {
          if (r.ok) continue;
          const row = by.get(r.uid);
          if (row)
            r.conflict = { rev: Number(row.rev), blob: row.blob.toString('base64'), deleted: row.deleted };
        }
      }
      return { results, head: rev, ...state };
    });
  }

  // ---------------------------------------------------------------- 지우기와 정리

  /**
   * 서버 사본과 열쇠를 모두 지운다. head 줄은 남겨 epoch 를 올린다 (다른 기기가 다음 요청에서 409 epoch 로 알게).
   * rev 는 그대로 이어진다. 1년 정리가 head 줄도 지운다
   */
  async removeAll(accountId: string): Promise<Epoch> {
    return this.db.tx(async (c) => {
      const a = await lockAccount(c, accountId);
      for (const table of ['sync_item', 'sync_key'])
        await c.query(`DELETE FROM ${table} WHERE account_id = $1`, [a.id]);
      const h = await c.query<{ epoch: number }>(
        'UPDATE sync_head SET epoch = epoch + 1, items = 0, bytes = 0 WHERE account_id = $1 RETURNING epoch',
        [a.id],
      );
      return { epoch: h.rows[0]?.epoch ?? 0, gen: 0 };
    });
  }

  /**
   * 정리 둘. (1) 1년 동안 어느 기기도 changes 나 push 하지 않은 계정의 사본과 열쇠를 지운다.
   * (2) 지운 지 90일이 지난 항목의 blob 을 비우고 항목 수와 바이트에서 뺀다 (uid 와 rev 는 남는다).
   * 시험은 now 를 넘겨 먼 뒤를 흉내 낸다
   */
  async sweep(now = this.clock()): Promise<{ expired: number; purged: number }> {
    const r = await this.db.pool.query(
      `WITH old AS (DELETE FROM sync_head WHERE last_access_at < $1 RETURNING account_id),
            k AS (DELETE FROM sync_key WHERE account_id IN (SELECT account_id FROM old)),
            i AS (DELETE FROM sync_item WHERE account_id IN (SELECT account_id FROM old))
       SELECT account_id FROM old`,
      [new Date(now - SYNC_IDLE_DAYS * DAY_MS)],
    );
    return { expired: r.rowCount ?? 0, purged: await this.purge(now) };
  }

  /** 지운 항목의 blob 비우기 (계정마다 잠금 안에서, 한 번에 계정 100개까지) */
  async purge(now = this.clock()): Promise<number> {
    const cutoff = new Date(now - SYNC_TOMB_DAYS * DAY_MS);
    const cand = await this.db.pool.query<{ account_id: string }>(
      `SELECT DISTINCT account_id FROM sync_item WHERE deleted AND purged_at IS NULL AND updated_at < $1 LIMIT 100`,
      [cutoff],
    );
    let n = 0;
    for (const { account_id } of cand.rows) {
      n += await this.db.tx(async (c) => {
        const a = await lockAccount(c, account_id);
        const r = await c.query<{ n: number; b: string }>(
          `WITH t AS (
             SELECT uid, octet_length(blob) AS len FROM sync_item
              WHERE account_id = $1 AND deleted AND purged_at IS NULL AND updated_at < $2 FOR UPDATE),
           u AS (
             UPDATE sync_item i SET blob = ''::bytea, purged_at = $3
               FROM t WHERE i.account_id = $1 AND i.uid = t.uid)
           SELECT count(*)::int AS n, COALESCE(sum(len), 0) AS b FROM t`,
          [a.id, cutoff, new Date(now)],
        );
        const row = r.rows[0];
        if (!row || row.n === 0) return 0;
        await c.query('UPDATE sync_head SET items = items - $2, bytes = bytes - $3 WHERE account_id = $1', [
          a.id,
          row.n,
          row.b,
        ]);
        return row.n;
      });
    }
    return n;
  }
}
