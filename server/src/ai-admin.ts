import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lockAccount } from './accounts';
import { AI_MAX_TOTAL_CHARS } from './ai-rules';
import { CLOCK, CONFIG } from './app.tokens';
import type { Config } from './config';
import { Db } from './db';
import { sendInbox } from './inbox';
import { normalizeDeviceCode } from './shared/account-profile';
import { kstDay } from './shared/site-events';

// 운영자의 AI 대화권 관리 (이슈 #101 범위 추가). 전체 켜기/끄기, 월 예산과 하루 상한, 계정별 차단, 한 번 지급과 회수,
// 정기 지급(구독처럼 매달 한 번). .env 의 AI_MONTHLY_BUDGET_USD, AI_DAILY_LIMIT 는 넘을 수 없는 상한이다.
// 정기 지급은 한국 달마다 한 번: 시간마다 전체를 돌고, 사용자가 남은 수를 물을 때 그 계정 것도 채운다.
// (정기 지급, 달) 유일 제약이 같은 달 두 번을 막는다.

const FILL_EVERY_MS = 60 * 60_000;
type Q = PoolClient | Db['pool'];

/**
 * 기능 스위치 (feature_flag, feature_allow) 에서 채팅 이용권의 키. #102 의 범용 기능 스위치(server/src/features.ts)와
 * 같은 모양이라 합칠 때 이 키를 그대로 옮긴다. 다음 기능은 kakao_login
 */
export const AI_FEATURE = 'ai_chat';
/** 운영자 화면의 "기능 스위치" 칸에 나올 기능 (이번 PR 은 ai_chat 만 움직인다) */
export const FEATURE_KEYS = ['ai_chat', 'kakao_login'] as const;
export const AI_MODES = ['off', 'allowlist', 'everyone'] as const;
export type AiMode = (typeof AI_MODES)[number];

export interface AiSettings {
  /** off: 아무도, allowlist: 허용 목록과 운영자 계정만, everyone: 만 18세 이상 로그인 모두 */
  mode: AiMode;
  /** 실제로 쓰는 값 (설정과 .env 상한 중 작은 쪽) */
  monthlyBudgetMicros: number;
  dailyLimit: number;
  /** 질문 글자 수 상한 (실제로 쓰는 값: 설정과 .env 상한 중 작은 쪽) */
  inputChars: number;
  /** .env 상한 */
  capBudgetMicros: number;
  capDailyLimit: number;
  capInputChars: number;
  /** 운영자가 넣은 값 (없으면 상한 그대로) */
  setBudgetMicros: number | null;
  setDailyLimit: number | null;
  setInputChars: number | null;
  /** 허용된 계정에 저절로 거는 정기 지급 (매달 N장까지 채우기) */
  autoMonthly: number;
  /** 정기 지급 계정 상한 (자리). 차면 대기 */
  seatLimit: number;
  /** 지금 정기 지급이 살아 있는 계정 수 */
  seatsUsed: number;
  /** 첫 로그인 선물 10장 (기본 꺼짐) */
  firstGift: boolean;
}

/** 자리를 잡는 동안 다른 요청이 끼지 않게 잡는 잠금 번호 (아무 고정 수) */
const SEAT_LOCK = 7_302_101;

export interface SubscriptionInfo {
  id: number;
  monthly: number;
  mode: 'fill' | 'add';
  startsOn: string;
  endsOn: string | null;
  /** 다음에 채우는 날 (한국 날짜). 끝났으면 null */
  nextFill: string | null;
}

/** 다음 달 1일 (YYYY-MM-DD) */
export function nextMonthFirst(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** 오늘 기준 다음 채움일: 시작 전이면 시작일, 아니면 다음 달 1일. 끝을 넘으면 null */
export function nextFillDay(sub: { startsOn: string; endsOn: string | null }, today: string): string | null {
  const next = today < sub.startsOn ? sub.startsOn : nextMonthFirst(today);
  return sub.endsOn && next > sub.endsOn ? null : next;
}

const refused = (error: string, text: string) => new HttpException({ error, text }, HttpStatus.BAD_REQUEST);

/** 계정 번호(숫자)나 기기 코드(F-XXXX-XXXX)로 계정 번호를 찾는다. 합쳐진 쪽 코드도 찾는다 (잠그면 남는 쪽으로 간다) */
export async function findAccount(q: Q, ref: string): Promise<string | undefined> {
  const s = ref.trim();
  if (/^\d{1,18}$/.test(s)) {
    const r = await q.query<{ id: string }>('SELECT id FROM account WHERE id = $1', [s]);
    return r.rows[0]?.id;
  }
  const code = normalizeDeviceCode(s);
  if (!code) return undefined;
  const r = await q.query<{ id: string }>('SELECT id FROM account WHERE code = $1', [code]);
  return r.rows[0]?.id;
}

@Injectable()
export class AiAdmin implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  onModuleInit(): void {
    const run = () =>
      void this.fillAll().catch((err) => console.warn('[ai] 정기 지급 실패:', (err as Error).message));
    run();
    this.#timer = setInterval(run, FILL_EVERY_MS);
    this.#timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#timer);
  }

  async settings(q: Q = this.db.pool): Promise<AiSettings> {
    const r = await q.query<{
      mode: AiMode;
      b: string | null;
      d: number | null;
      auto: number;
      seats: number;
      used: number;
      gift: boolean;
      ic: number | null;
    }>(
      `SELECT (SELECT mode FROM feature_flag WHERE key = '${AI_FEATURE}') AS mode,
              monthly_budget_micros AS b, daily_limit AS d, auto_monthly AS auto, seat_limit AS seats,
              first_gift AS gift, input_chars AS ic, (SELECT count(*)::int FROM ai_subscription WHERE canceled_at IS NULL) AS used
         FROM ai_setting WHERE id = 1`,
    );
    const row = r.rows[0];
    const capBudget = this.config.ai?.monthlyBudgetMicros ?? 0;
    const capDaily = this.config.ai?.dailyLimit ?? 0;
    const setB = row?.b === null || row?.b === undefined ? null : Number(row.b);
    const setD = row?.d ?? null;
    const capInput = this.config.ai?.maxInputChars ?? AI_MAX_TOTAL_CHARS;
    const setI = row?.ic ?? null;
    return {
      mode: row?.mode ?? 'off',
      monthlyBudgetMicros: Math.min(capBudget, setB ?? capBudget),
      dailyLimit: Math.min(capDaily, setD ?? capDaily),
      inputChars: Math.min(capInput, setI ?? capInput),
      capBudgetMicros: capBudget,
      capDailyLimit: capDaily,
      capInputChars: capInput,
      setBudgetMicros: setB,
      setDailyLimit: setD,
      setInputChars: setI,
      autoMonthly: row?.auto ?? 100,
      seatLimit: row?.seats ?? 100,
      seatsUsed: row?.used ?? 0,
      firstGift: row?.gift === true,
    };
  }

  /**
   * 채팅 이용권 자리 (#101 정책). 정기 지급을 한 번이라도 걸었던 계정은 그대로 (운영자가 해지했으면 다시 걸지 않는다).
   * 처음이면 자리(seat_limit)가 남을 때 "매달 autoMonthly 장까지 채우기" 를 저절로 걸고, 차면 대기 목록에 넣는다.
   * 운영자 계정은 자리와 상관없이 건다. 계정 행이 잠긴 트랜잭션에서 부른다
   */
  async ensureSeat(c: PoolClient, accountId: string, admin: boolean): Promise<'ok' | 'waitlisted'> {
    const had = await c.query('SELECT 1 FROM ai_subscription WHERE account_id = $1 LIMIT 1', [accountId]);
    if ((had.rowCount ?? 0) > 0) return 'ok';
    await c.query('SELECT pg_advisory_xact_lock($1)', [SEAT_LOCK]);
    const st = await this.settings(c);
    // 대기 목록에 넣는 것은 부르는 쪽이 트랜잭션 밖에서 (거절하면 이 트랜잭션은 되돌려진다): waitlistAdd
    if (!admin && st.seatsUsed >= st.seatLimit) return 'waitlisted';
    await c.query(
      `INSERT INTO ai_subscription (account_id, monthly, mode, starts_on) VALUES ($1, $2, 'fill', $3)`,
      [accountId, st.autoMonthly, kstDay(this.now())],
    );
    await c.query('DELETE FROM ai_waitlist WHERE account_id = $1', [accountId]);
    return 'ok';
  }

  /** 대기 목록에 넣는다 (거절된 트랜잭션이 끝난 뒤 따로) */
  async waitlistAdd(accountId: string): Promise<void> {
    await this.db.pool.query('INSERT INTO ai_waitlist (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      accountId,
    ]);
  }

  /** 대기 목록 (먼저 온 순) */
  async waitlist(): Promise<Array<{ id: string; code: string; nickname: string | null; since: string }>> {
    const r = await this.db.pool.query<{ id: string; code: string; nickname: string | null; since: string }>(
      `SELECT a.id, a.code, a.nickname, w.created_at::text AS since FROM ai_waitlist w JOIN account a ON a.id = w.account_id
        ORDER BY w.created_at LIMIT 200`,
    );
    return r.rows;
  }

  /** 정책 값: 자동 정기 지급 장수, 자리 수, 첫 로그인 선물 */
  async setPolicy(
    c: PoolClient,
    o: { autoMonthly?: number; seatLimit?: number; firstGift?: boolean },
  ): Promise<{ before: AiSettings; after: AiSettings }> {
    const before = await this.settings(c);
    if (
      o.autoMonthly !== undefined &&
      (!Number.isInteger(o.autoMonthly) || o.autoMonthly < 1 || o.autoMonthly > 1000)
    )
      throw refused('auto_monthly', '매달 장수는 1~1000');
    if (
      o.seatLimit !== undefined &&
      (!Number.isInteger(o.seatLimit) || o.seatLimit < 0 || o.seatLimit > 100000)
    )
      throw refused('seat_limit', '자리 수는 0~100000');
    await c.query(
      `UPDATE ai_setting SET auto_monthly = COALESCE($1, auto_monthly), seat_limit = COALESCE($2, seat_limit),
              first_gift = COALESCE($3, first_gift), updated_at = now() WHERE id = 1`,
      [o.autoMonthly ?? null, o.seatLimit ?? null, o.firstGift ?? null],
    );
    return { before, after: await this.settings(c) };
  }

  /** 접근 모드와 예산, 하루 상한. 상한(.env)을 넘는 값은 거절한다. 바뀌기 전과 뒤를 돌려준다 (운영 기록) */
  async setSettings(
    c: PoolClient,
    o: {
      mode?: AiMode;
      monthlyBudgetMicros?: number | null;
      dailyLimit?: number | null;
      inputChars?: number | null;
    },
  ): Promise<{ before: AiSettings; after: AiSettings }> {
    if (o.mode !== undefined && !AI_MODES.includes(o.mode))
      throw refused('mode', '모드는 off, allowlist, everyone');
    const before = await this.settings(c);
    if (o.inputChars != null && (!Number.isInteger(o.inputChars) || o.inputChars < 1))
      throw refused('input_chars', '질문 글자 수는 1 이상의 정수');
    if (o.inputChars != null && o.inputChars > before.capInputChars)
      throw refused('over_cap', `질문 글자 수는 .env 상한 ${before.capInputChars} 이하만`);
    if (o.monthlyBudgetMicros != null && o.monthlyBudgetMicros > before.capBudgetMicros)
      throw refused('over_cap', `월 예산은 .env 상한 $${(before.capBudgetMicros / 1e6).toFixed(2)} 이하만`);
    if (o.dailyLimit != null && o.dailyLimit > before.capDailyLimit)
      throw refused('over_cap', `하루 상한은 .env 상한 ${before.capDailyLimit} 이하만`);
    if (o.mode !== undefined)
      await c.query(
        `INSERT INTO feature_flag (key, mode) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`,
        [AI_FEATURE, o.mode],
      );
    await c.query(
      `UPDATE ai_setting SET monthly_budget_micros = CASE WHEN $1 THEN $2::bigint ELSE monthly_budget_micros END,
              daily_limit = CASE WHEN $3 THEN $4::int ELSE daily_limit END,
              input_chars = CASE WHEN $5 THEN $6::int ELSE input_chars END, updated_at = now()
        WHERE id = 1`,
      [
        o.monthlyBudgetMicros !== undefined,
        o.monthlyBudgetMicros ?? null,
        o.dailyLimit !== undefined,
        o.dailyLimit ?? null,
        o.inputChars !== undefined,
        o.inputChars ?? null,
      ],
    );
    return { before, after: await this.settings(c) };
  }

  async allowed(q: Q, accountId: string): Promise<boolean> {
    const r = await q.query('SELECT 1 FROM feature_allow WHERE key = $1 AND account_id = $2', [
      AI_FEATURE,
      accountId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async setAllowed(c: PoolClient, accountNo: string, allowed: boolean, admin = false): Promise<string> {
    const id = await this.target(c, accountNo);
    if (allowed && (await this.ensureSeat(c, id, admin)) === 'waitlisted') {
      const st = await this.settings(c);
      throw refused(
        'no_seat',
        `자리가 없어요 (정기 지급 ${st.seatsUsed}/${st.seatLimit}). 대기 목록에 넣었어요`,
      );
    }
    if (allowed)
      await c.query('INSERT INTO feature_allow (key, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        AI_FEATURE,
        id,
      ]);
    else await c.query('DELETE FROM feature_allow WHERE key = $1 AND account_id = $2', [AI_FEATURE, id]);
    return id;
  }

  /** 허용 목록 (운영자 화면) */
  async allowList(): Promise<Array<{ id: string; code: string; nickname: string | null }>> {
    const r = await this.db.pool.query<{ id: string; code: string; nickname: string | null }>(
      `SELECT a.id, a.code, a.nickname FROM feature_allow l JOIN account a ON a.id = l.account_id
        WHERE l.key = $1 ORDER BY l.created_at LIMIT 200`,
      [AI_FEATURE],
    );
    return r.rows;
  }

  async blocked(q: Q, accountId: string): Promise<boolean> {
    return ((await q.query('SELECT 1 FROM ai_block WHERE account_id = $1', [accountId])).rowCount ?? 0) > 0;
  }

  /** 계정을 찾는다 (계정 번호나 기기 코드. 합쳐졌으면 남는 쪽). 없으면 거절 */
  private async target(c: PoolClient, ref: string): Promise<string> {
    const id = await findAccount(c, ref);
    if (!id) throw refused('no_account', '없는 계정이에요 (계정 번호나 기기 코드)');
    return (await lockAccount(c, id)).id;
  }

  async setBlocked(c: PoolClient, accountNo: string, blocked: boolean): Promise<string> {
    const id = await this.target(c, accountNo);
    if (blocked) await c.query('INSERT INTO ai_block (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    else await c.query('DELETE FROM ai_block WHERE account_id = $1', [id]);
    return id;
  }

  /** 한 번 지급(양수)과 회수(음수). 회수는 남은 수까지만 (넘으면 거절) */
  async adjustTickets(
    c: PoolClient,
    accountNo: string,
    delta: number,
  ): Promise<{ id: string; remaining: number }> {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000)
      throw refused('delta', '대화권 수는 -1000~1000 (0 말고)');
    const id = await this.target(c, accountNo);
    const cur = await c.query<{ remaining: number }>(
      'SELECT remaining FROM ai_ticket WHERE account_id = $1',
      [id],
    );
    const have = cur.rows[0]?.remaining ?? 0;
    if (delta < 0 && -delta > have)
      throw refused('over_remaining', `남은 대화권(${have})보다 많이 회수할 수 없어요`);
    const r = await c.query<{ remaining: number }>(
      `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + $3, updated_at = now()
       RETURNING remaining`,
      [id, Math.max(0, delta), delta],
    );
    return { id, remaining: r.rows[0]?.remaining ?? 0 };
  }

  /** 정기 지급 걸기. 계정마다 살아 있는 것은 하나. 시작일이 오늘 이전이면 이번 달 몫을 바로 채운다 */
  async subscribe(
    c: PoolClient,
    accountNo: string,
    o: { monthly: number; mode: 'fill' | 'add'; startsOn?: string; endsOn?: string | null },
  ): Promise<{ id: string; subscription: number }> {
    if (!Number.isInteger(o.monthly) || o.monthly < 1 || o.monthly > 1000)
      throw refused('monthly', '매달 1~1000개');
    if (o.mode !== 'fill' && o.mode !== 'add') throw refused('mode', '채우기(fill)나 더하기(add)');
    const today = kstDay(this.now());
    const starts = o.startsOn || today;
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(starts) || (o.endsOn && !day.test(o.endsOn))) throw refused('day', '날짜는 YYYY-MM-DD');
    if (o.endsOn && o.endsOn < starts) throw refused('day', '끝일이 시작일보다 앞이에요');
    const id = await this.target(c, accountNo);
    await this.needAdult(c, id);
    const live = await c.query(
      'SELECT 1 FROM ai_subscription WHERE account_id = $1 AND canceled_at IS NULL',
      [id],
    );
    if ((live.rowCount ?? 0) > 0) throw refused('live', '이미 정기 지급이 있어요. 해지하고 다시 걸어 주세요');
    const r = await c.query<{ id: string }>(
      `INSERT INTO ai_subscription (account_id, monthly, mode, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [id, o.monthly, o.mode, starts, o.endsOn || null],
    );
    await this.fillAccount(c, id);
    return { id, subscription: Number(r.rows[0]?.id) };
  }

  /** 채팅 이용권은 만 18세 이상 계정에만 (8절) */
  async needAdult(c: PoolClient, id: string): Promise<void> {
    const r = await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [id]);
    if (r.rows[0]?.age !== '18+') throw refused('age', '채팅 이용권은 만 18세 이상 계정에만 줄 수 있어요');
  }

  async cancel(c: PoolClient, accountNo: string): Promise<{ id: string; subscription: number }> {
    const id = await this.target(c, accountNo);
    const r = await c.query<{ id: string }>(
      'UPDATE ai_subscription SET canceled_at = now() WHERE account_id = $1 AND canceled_at IS NULL RETURNING id',
      [id],
    );
    if (r.rowCount === 0) throw refused('no_subscription', '걸린 정기 지급이 없어요');
    return { id, subscription: Number(r.rows[0]?.id) };
  }

  /**
   * 이 계정의 이번 달 정기 지급 쪽지를 보낸다 (계정 행을 잠근 트랜잭션 안에서). (정기 지급, 달) 기록을 먼저 넣고(유일),
   * 넣었을 때만 쪽지를 보낸다. 채팅 이용권은 쪽지를 열 때 준다: fill 은 그때 모자란 만큼(이월 없음), add 는 N장.
   * 쪽지는 다음 달 1일(한국 시간)에 만료된다. 보낸 쪽지 수
   */
  async fillAccount(c: PoolClient, accountId: string): Promise<number> {
    const today = kstDay(this.now());
    const month = today.slice(0, 7);
    const subs = await c.query<{ id: string; monthly: number; mode: 'fill' | 'add' }>(
      `SELECT id, monthly, mode FROM ai_subscription
        WHERE account_id = $1 AND canceled_at IS NULL AND starts_on <= $2::date AND (ends_on IS NULL OR ends_on >= $2::date)`,
      [accountId, today],
    );
    let sent = 0;
    for (const s of subs.rows) {
      const mark = await c.query(
        `INSERT INTO ai_subscription_fill (subscription_id, month) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING subscription_id`,
        [s.id, month],
      );
      if (mark.rowCount === 0) continue;
      const inboxId = await sendInbox(c, accountId, {
        kind: 'subscription',
        ...(s.mode === 'fill' ? { fillTo: s.monthly } : { chatPasses: s.monthly }),
        expiresAt: Date.parse(`${nextMonthFirst(today)}T00:00:00+09:00`),
      });
      await c.query(
        'UPDATE ai_subscription_fill SET inbox_id = $3 WHERE subscription_id = $1 AND month = $2',
        [s.id, month, inboxId],
      );
      sent++;
    }
    return sent;
  }

  /** 이 계정 것만 (쪽지함을 열 때) */
  async fillFor(accountId: string): Promise<number> {
    return this.db.tx(async (c) => this.fillAccount(c, (await lockAccount(c, accountId)).id));
  }

  /** 모든 정기 지급의 이번 달 몫 (시간마다). 계정마다 따로 트랜잭션 */
  async fillAll(): Promise<number> {
    const today = kstDay(this.now());
    const r = await this.db.pool.query<{ account_id: string }>(
      `SELECT DISTINCT s.account_id FROM ai_subscription s
        WHERE s.canceled_at IS NULL AND s.starts_on <= $1::date AND (s.ends_on IS NULL OR s.ends_on >= $1::date)
          AND NOT EXISTS (SELECT 1 FROM ai_subscription_fill f WHERE f.subscription_id = s.id AND f.month = $2)`,
      [today, today.slice(0, 7)],
    );
    let n = 0;
    for (const row of r.rows)
      n += await this.db.tx(async (c) => {
        const a = await lockAccount(c, row.account_id);
        return this.fillAccount(c, a.id);
      });
    return n;
  }

  /** 계정의 살아 있는 정기 지급 (앱과 운영자 화면에 보인다) */
  async subscription(q: Q, accountId: string): Promise<SubscriptionInfo | null> {
    const r = await q.query<{
      id: string;
      monthly: number;
      mode: 'fill' | 'add';
      s: string;
      e: string | null;
    }>(
      `SELECT id, monthly, mode, to_char(starts_on, 'YYYY-MM-DD') AS s, to_char(ends_on, 'YYYY-MM-DD') AS e
         FROM ai_subscription WHERE account_id = $1 AND canceled_at IS NULL`,
      [accountId],
    );
    const s = r.rows[0];
    if (!s) return null;
    const info = { startsOn: s.s, endsOn: s.e };
    return {
      id: Number(s.id),
      monthly: s.monthly,
      mode: s.mode,
      ...info,
      nextFill: nextFillDay(info, kstDay(this.now())),
    };
  }

  /** 계정의 AI 현황 (운영자 화면) */
  async accountAi(accountId: string): Promise<{
    remaining: number;
    blocked: boolean;
    monthAsks: number;
    monthCostMicros: number;
    subscription: SubscriptionInfo | null;
  }> {
    const q = this.db.pool;
    const t = await q.query<{ remaining: number }>('SELECT remaining FROM ai_ticket WHERE account_id = $1', [
      accountId,
    ]);
    const u = await q.query<{ n: string; cost: string }>(
      `SELECT count(*) FILTER (WHERE status <> 'refunded') AS n, COALESCE(sum(cost_micros), 0) AS cost FROM ai_usage
        WHERE account_id = $1 AND created_at >= date_trunc('month', now(), 'UTC')`,
      [accountId],
    );
    return {
      remaining: t.rows[0]?.remaining ?? 0,
      blocked: await this.blocked(q, accountId),
      monthAsks: Number(u.rows[0]?.n ?? 0),
      monthCostMicros: Number(u.rows[0]?.cost ?? 0),
      subscription: await this.subscription(q, accountId),
    };
  }
}
