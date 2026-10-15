import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lockAccount } from './accounts';
import { AdminAccess } from './admin-access';
import { AdminAuth, type AdminSession, actorOf, clearCookie } from './admin-auth';
import { type AdminView, adminCss, loginPage, mainPage } from './admin-page';
import { AI_MODES, AiAdmin, type AiMode, type AiSettings, findAccount } from './ai-admin';
import { CONFIG } from './app.tokens';
import { AuthGuard } from './auth.guard';
import type { Config } from './config';
import { Db } from './db';
import { EVENT_COLUMNS, type EventRow, Feeds } from './feeds';
import { sendInbox } from './inbox';
import {
  checkDoc,
  cleanText,
  compareVersion,
  emptyDoc,
  type FormFields,
  type NoticeDoc,
  noticeFromForm,
  parseKstInput,
  readDoc,
  VERSION,
} from './notice-doc';
import { ipKey, LIMITS, RateLimiter } from './rate-limit';
import { Rewards } from './rewards';
import { COUPON_ALPHABET, COUPON_LENGTH, formatCoupon, kstIso, parseEvent } from './shared/site-events';
import { sha256 } from './tokens';

// 운영자 화면 /admin (기획서 10, 23절, 이슈 #101). 서버가 그리는 HTML 한 장(외부 CDN 없음, 스크립트 없음)과 폼 POST.
// 이벤트, 쿠폰, 개인 지급, 공지와 최소/권장 버전, 계정 찾기, 사용량. 모든 쓰기는 같은 트랜잭션에서 admin_log 에 남긴다.
// 쓰기는 POST → 303 → GET (새로 고침해도 두 번 쓰지 않게). 결과 글은 세션에 한 번만 담는다 (쿠폰 코드를 주소에 두지 않게).

/** 운영 기록 보관 (13절: 1년) */
const LOG_KEEP_DAYS = 365;
const SWEEP_MS = 6 * 3_600_000;

export interface AdminReq {
  method?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined };
  body?: unknown;
}
export interface AdminRes {
  status(code: number): AdminRes;
  setHeader(name: string, value: string | string[]): void;
  send(body: string): void;
  redirect(status: number, url: string): void;
}

/** 운영자에게 보일 까닭. 트랜잭션을 되돌리고 화면에 빨갛게 보인다 */
export class Refused extends Error {
  /** 앱이 글로 바꿀 까닭 코드 (confirm, no_account, over_cap, over_remaining, no_seat, age, live, ...). 없으면 invalid */
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message);
  }
}

/** 쓰기 하나의 결과: 운영자 화면 글(한국어), 앱이 말에 맞게 바꿀 코드(운영 기록의 행동 이름), 덧붙일 값 */
export interface AdminDone {
  text: string;
  code: string;
  data?: Record<string, string | number>;
}

/** ai-admin.ts 가 던진 400 { text } 를 Refused 로 */
function refusedFrom(err: unknown): Error {
  if (err instanceof HttpException) {
    const r = err.getResponse() as { text?: unknown; error?: unknown };
    if (typeof r.text === 'string')
      return new Refused(r.text, typeof r.error === 'string' ? r.error : 'invalid');
  }
  return err as Error;
}

/** 쓰기 이름 (웹 POST /admin/<이름>, 앱 POST /v1/admin/<이름>) */
export const ADMIN_ACTIONS = [
  'events',
  'events/end',
  'coupons',
  'coupons/disable',
  'notes',
  'notices',
  'notices/delete',
  'versions',
  'ai/mode',
  'ai/limits',
  'ai/revoke',
  'ai/subscribe',
  'ai/cancel',
  'ai/block',
  'ai/allow',
  'ai/policy',
  'rewards/policy',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export const isAdminAction = (v: string): v is AdminAction =>
  (ADMIN_ACTIONS as readonly string[]).includes(v);

interface AccountRow {
  id: string;
  code: string;
  nickname: string | null;
  age: string;
  balance: string;
  merged_into: string | null;
}

/** 쓰기의 결과 글과 운영 기록 (행동, 대상, 자세히) */
interface Written {
  text: string;
  log: [string, string | null, Record<string, unknown>?];
  /** 앱에 넘길 값 (쿠폰 코드) */
  data?: Record<string, string | number>;
}

/** 정수 칸 (빈 칸은 0) */
function int(v: string | undefined, min: number, max: number, what: string): number {
  const s = (v ?? '').trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new Refused(`${what}: ${min}~${max}`);
  return n;
}

export function newCouponCode(): string {
  let s = '';
  for (let i = 0; i < COUPON_LENGTH; i++) s += COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)];
  return s;
}

/** 운영 기록 한 줄 */
export async function adminLog(
  c: PoolClient | Db['pool'],
  actor: string,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await c.query('INSERT INTO admin_log (actor, action, target, detail) VALUES ($1, $2, $3, $4)', [
    actor,
    action,
    target?.slice(0, 120) ?? null,
    detail ? JSON.stringify(detail) : null,
  ]);
}

@Injectable()
export class AdminService {
  #sweep?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly feeds: Feeds,
    private readonly rewards: Rewards,
    private readonly aiAdmin: AiAdmin,
    private readonly access: AdminAccess,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    const run = () =>
      void this.db.pool
        .query(`DELETE FROM admin_log WHERE at < now() - make_interval(days => $1)`, [LOG_KEEP_DAYS])
        .catch((err) => console.warn('[admin] 기록 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  /** 화면에 그릴 것 모두 */
  async view(query: string | undefined): Promise<Omit<AdminView, 'csrf' | 'flash'>> {
    const q = this.db.pool;
    const sum = await q.query<{ accounts: string; coins: string; tickets: string }>(
      `SELECT (SELECT count(*) FROM account WHERE closed_at IS NULL) AS accounts,
              (SELECT COALESCE(sum(balance), 0) FROM account WHERE closed_at IS NULL) AS coins,
              (SELECT COALESCE(sum(remaining), 0) FROM ai_ticket) AS tickets`,
    );
    const day = await q.query<{ earned: string; spent: string }>(
      `SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0), 0) AS earned,
              COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0) AS spent
         FROM coin_entry WHERE created_at > now() - interval '1 day'`,
    );
    const ai = await q.query<{ cost: string; asks: string }>(
      `SELECT COALESCE(sum(cost_micros), 0) AS cost, count(*) AS asks FROM ai_usage
        WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    const events = await q.query<EventRow & { claims: string }>(
      `SELECT ${EVENT_COLUMNS}, (SELECT count(*) FROM event_claim c WHERE c.event_id = event.id) AS claims
         FROM event ORDER BY starts_at DESC LIMIT 50`,
    );
    const coupons = await q.query<{
      id: string;
      hint: string;
      label: string;
      coins: number;
      tickets: number;
      starts: string;
      ends: string;
      max_uses: number;
      used: number;
      disabled: boolean;
    }>(
      `SELECT id, hint, label, coins, tickets, (extract(epoch FROM starts_at) * 1000)::bigint AS starts,
              (extract(epoch FROM ends_at) * 1000)::bigint AS ends, max_uses, used, disabled_at IS NOT NULL AS disabled
         FROM coupon ORDER BY id DESC LIMIT 50`,
    );
    const doc = await q.query<{ body: unknown; updated: string }>(
      `SELECT body, (extract(epoch FROM updated_at) * 1000)::bigint AS updated FROM site_doc WHERE name = 'notices'`,
    );
    const log = await q.query<{
      at: string;
      actor: string;
      action: string;
      target: string | null;
      detail: unknown;
    }>(
      `SELECT (extract(epoch FROM at) * 1000)::bigint AS at, actor, action, target, detail FROM admin_log
        ORDER BY id DESC LIMIT 50`,
    );
    return {
      summary: {
        accounts: Number(sum.rows[0]?.accounts ?? 0),
        coins: Number(sum.rows[0]?.coins ?? 0),
        tickets: Number(sum.rows[0]?.tickets ?? 0),
        earnedDay: Number(day.rows[0]?.earned ?? 0),
        spentDay: Number(day.rows[0]?.spent ?? 0),
        aiCostMicros: Number(ai.rows[0]?.cost ?? 0),
        aiAsks: Number(ai.rows[0]?.asks ?? 0),
        aiBudgetMicros: this.config.ai?.monthlyBudgetMicros ?? 0,
      },
      ...(await this.search(query)),
      query,
      ai: {
        ...(await this.aiAdmin.settings()),
        allow: await this.aiAdmin.allowList(),
        waitlist: await this.aiAdmin.waitlist(),
      },
      events: events.rows.map((r) => ({ ...r, claims: Number(r.claims) })),
      coupons: coupons.rows,
      notices: doc.rows[0] ? readDoc(doc.rows[0].body) : undefined,
      noticesUpdated: doc.rows[0] ? Number(doc.rows[0].updated) : undefined,
      latest: await this.feeds.latestRelease(),
      log: log.rows,
      rewardsLoginOnly: await this.rewards.loginOnly(),
    };
  }

  /**
   * 계정 찾기: 계정 번호, 기기 코드(합쳐진 쪽 코드도), 닉네임(일부, 대소문자 무시). 하나면 자세히(채팅 이용권 현황 포함),
   * 여럿이면 목록 (20개까지)
   */
  private async search(query: string | undefined): Promise<Pick<AdminView, 'accounts' | 'account'>> {
    const q = (query ?? '').trim().slice(0, 40);
    if (!q) return { accounts: [], account: undefined };
    const exact = await findAccount(this.db.pool, q);
    const r = await this.db.pool.query<AccountRow>(
      `SELECT a.id, a.code, a.nickname, a.age, a.balance::text AS balance, a.merged_into
         FROM account a
        WHERE ($1::bigint IS NOT NULL AND a.id = $1::bigint)
           OR ($1::bigint IS NULL AND a.nickname IS NOT NULL AND lower(a.nickname) LIKE '%' || lower($2) || '%')
        ORDER BY a.id DESC LIMIT 20`,
      [exact ?? null, q.replace(/[%_\\]/g, '')],
    );
    const accounts = r.rows.map((x) => ({ ...x, balance: Number(x.balance) }));
    if (accounts.length !== 1) return { accounts, account: accounts.length === 0 ? null : undefined };
    const one = accounts[0] as AdminView['accounts'][number];
    const live = one.merged_into ?? one.id;
    const d = await this.db.pool.query<{
      created: string;
      logins: string[] | null;
      claims: string;
      coupons: string;
      notes: string;
    }>(
      `SELECT (extract(epoch FROM a.created_at) * 1000)::bigint AS created,
              (SELECT array_agg(service) FROM login l WHERE l.account_id = a.id) AS logins,
              (SELECT count(*) FROM event_claim WHERE account_id = a.id) AS claims,
              (SELECT count(*) FROM coupon_use WHERE account_id = a.id) AS coupons,
              (SELECT count(*) FROM inbox WHERE account_id = a.id) AS notes
         FROM account a WHERE a.id = $1`,
      [live],
    );
    const x = d.rows[0];
    return {
      accounts,
      account: {
        ...one,
        created: Number(x?.created ?? 0),
        logins: x?.logins ?? [],
        claims: Number(x?.claims ?? 0),
        coupons: Number(x?.coupons ?? 0),
        notes: Number(x?.notes ?? 0),
        admin: await this.access.isAdminAccount(live),
        ai: {
          ...(await this.aiAdmin.accountAi(live)),
          allowed: await this.aiAdmin.allowed(this.db.pool, live),
        },
      },
    };
  }

  /** 쓰기 하나: 트랜잭션 안에서 일하고 운영 기록을 남긴다. 운영자에게 보일 결과 글을 돌려준다 */
  private write(actor: string, fn: (c: PoolClient) => Promise<Written>): Promise<AdminDone> {
    return this.db.tx(async (c) => {
      const out = await fn(c);
      await adminLog(c, actor, out.log[0], out.log[1], out.log[2]);
      return { text: out.text, code: out.log[0], ...(out.data ? { data: out.data } : {}) };
    });
  }

  async createEvent(actor: string, f: FormFields, now = Date.now()): Promise<AdminDone> {
    const from = parseKstInput(f.from);
    const until = parseKstInput(f.until);
    if (from === undefined || until === undefined || Number.isNaN(from) || Number.isNaN(until))
      throw new Refused('시작과 끝을 넣어 주세요');
    if (until <= now) throw new Refused('끝이 지금보다 뒤여야 해요');
    const reasons = ([] as string[]).concat(f.reasons ?? []).filter(Boolean);
    const raw = {
      id: (f.id ?? '').trim(),
      kind: f.kind,
      title: { ko: f.title_ko, en: f.title_en },
      body: { ko: f.body_ko, en: f.body_en },
      from: kstIso(from),
      until: kstIso(until),
      ...(f.kind === 'gift' ? { coins: Number(f.coins) } : { boost: { reasons, times: Number(f.times) } }),
    };
    const e = parseEvent(raw);
    if (!e)
      throw new Refused(
        'id(영문, 숫자, ., _, - 40자), 제목(60자), 본문(300자) ko/en, 선물 코인(1~1000) 또는 배수(까닭 하나 이상, 2배나 3배)를 확인해 주세요',
      );
    return this.write(actor, async (c) => {
      const r = await c.query(
        `INSERT INTO event (id, kind, title_ko, title_en, body_ko, body_en, starts_at, ends_at, coins, boost_reasons, boost_times)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0), $9, $10, $11)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          e.id,
          e.kind,
          e.title.ko,
          e.title.en,
          e.body.ko,
          e.body.en,
          e.from,
          e.until,
          e.coins ?? null,
          e.boost?.reasons ?? null,
          e.boost?.times ?? null,
        ],
      );
      if (r.rowCount === 0) throw new Refused(`같은 id 의 이벤트가 있어요: ${e.id}`);
      return {
        text: `이벤트 ${e.id} 를 만들었어요. 홈페이지에는 10분 안쪽에 올라가요`,
        log: [
          'event.create',
          e.id,
          { kind: e.kind, coins: e.coins, boost: e.boost, from: raw.from, until: raw.until },
        ],
      };
    });
  }

  /** 이벤트 끝내기: 시작했으면 지금 끝내고, 시작 전이면 지운다 (받은 사람이 없다) */
  async endEvent(actor: string, id: string): Promise<AdminDone> {
    return this.write(actor, async (c) => {
      const r = await c.query<{ started: boolean; ended: boolean }>(
        'SELECT starts_at <= now() AS started, ends_at <= now() AS ended FROM event WHERE id = $1 FOR UPDATE',
        [id],
      );
      const e = r.rows[0];
      if (!e) throw new Refused('없는 이벤트예요');
      if (e.ended) throw new Refused('이미 끝난 이벤트예요');
      if (e.started) {
        await c.query('UPDATE event SET ends_at = now() WHERE id = $1', [id]);
        return { text: `이벤트 ${id} 를 끝냈어요`, log: ['event.end', id, {}] };
      }
      await c.query('DELETE FROM event WHERE id = $1', [id]);
      return { text: `시작 전이라 이벤트 ${id} 를 지웠어요`, log: ['event.delete', id, {}] };
    });
  }

  async createCoupon(actor: string, f: FormFields): Promise<AdminDone> {
    const label = cleanText(f.label);
    if (!label || label.length > 80) throw new Refused('메모는 80자까지');
    const coins = int(f.coins, 0, 1000, '코인');
    const tickets = int(f.tickets, 0, 50, '대화권');
    if (coins + tickets === 0) throw new Refused('코인이나 대화권 중 하나는 넣어 주세요');
    const maxUses = int(f.max_uses, 1, 100000, '전체 사용 상한');
    if (maxUses === 0) throw new Refused('전체 사용 상한을 넣어 주세요');
    const from = parseKstInput(f.from) ?? Date.now();
    const until = parseKstInput(f.until);
    if (Number.isNaN(from) || until === undefined || Number.isNaN(until) || until <= from)
      throw new Refused('기간을 확인해 주세요 (끝이 시작보다 뒤)');
    const code = newCouponCode();
    return this.write(actor, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO coupon (code_hash, hint, label, coins, tickets, starts_at, ends_at, max_uses)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8) RETURNING id`,
        [sha256(code), code.slice(0, 4), label, coins, tickets, from, until, maxUses],
      );
      const id = r.rows[0]?.id as string;
      return {
        // 코드는 여기서 한 번만 보인다 (서버는 해시만 둔다). 기록에도 앞 4자만
        text: `쿠폰 #${id} 코드: ${formatCoupon(code)} (지금만 보여요. 따로 적어 두세요)`,
        data: { coupon: formatCoupon(code) },
        log: [
          'coupon.create',
          `#${id}`,
          {
            hint: code.slice(0, 4),
            label,
            coins,
            tickets,
            maxUses,
            from: kstIso(from),
            until: kstIso(until),
          },
        ],
      };
    });
  }

  async disableCoupon(actor: string, id: string): Promise<AdminDone> {
    if (!/^\d{1,18}$/.test(id)) throw new Refused('쿠폰 번호가 이상해요');
    return this.write(actor, async (c) => {
      const r = await c.query(
        'UPDATE coupon SET disabled_at = now() WHERE id = $1 AND disabled_at IS NULL RETURNING id',
        [id],
      );
      if (r.rowCount === 0) throw new Refused('없거나 이미 끈 쿠폰이에요');
      return { text: `쿠폰 #${id} 를 껐어요`, log: ['coupon.disable', `#${id}`, {}] };
    });
  }

  /**
   * 쪽지 보내기 (개인 지급, 알림). 코인과 채팅 이용권은 바로 주지 않고 쪽지에 붙여, 사용자가 열 때 준다.
   * 채팅 이용권은 만 18세 이상 계정에만. 만료는 1~365일 (기본 30일)
   */
  async sendNote(actor: string, f: FormFields): Promise<AdminDone> {
    const ref = (f.account ?? '').trim();
    const coins = int(f.coins, 0, 10000, '코인');
    const passes = int(f.chat_passes, 0, 1000, '채팅 이용권');
    const message = cleanText(f.message);
    if (message.length > 200) throw new Refused('쪽지 글은 200자까지');
    if (coins + passes === 0 && !message) throw new Refused('글이나 코인, 채팅 이용권 중 하나는 넣어 주세요');
    const days = int(f.days, 1, 365, '만료 날수') || 30;
    return this.write(actor, async (c) => {
      const id = await findAccount(c, ref);
      if (!id) throw new Refused('없는 계정이에요 (계정 번호나 기기 코드)', 'no_account');
      const a = await lockAccount(c, id);
      if (passes > 0) {
        const age = await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [a.id]);
        if (age.rows[0]?.age !== '18+')
          throw new Refused('채팅 이용권은 만 18세 이상 계정에만 줄 수 있어요', 'age');
      }
      const noteId = await sendInbox(c, a.id, {
        kind: coins + passes > 0 ? 'grant' : 'notice',
        message: message || null,
        coins,
        chatPasses: passes,
        expiresAt: Date.now() + days * 86_400_000,
      });
      return {
        text: `쪽지 #${noteId} 를 보냈어요 (코인 ${coins}, 채팅 이용권 ${passes}장). 사용자가 열 때 받아요`,
        log: [
          'note.send',
          `account:${a.id}`,
          { note: Number(noteId), coins, chatPasses: passes, days, message: message || undefined },
        ],
      };
    });
  }

  // ---- 채팅 이용권 (AI 대화권) 관리 ----

  /** 접근 모드 (off, allowlist, everyone). 바꾸기는 확인 칸이 있어야 한다 */
  async aiMode(actor: string, f: FormFields): Promise<AdminDone> {
    if (f.confirm !== 'yes') throw new Refused('확인 칸을 체크해 주세요 (모드 바꾸기)', 'confirm');
    const mode = (f.mode ?? '') as AiMode;
    if (!AI_MODES.includes(mode)) throw new Refused('모드는 off, allowlist, everyone');
    return this.write(actor, async (c) => {
      const r = await this.aiAdmin.setSettings(c, { mode });
      return {
        text: `채팅 이용권 접근 모드: ${r.before.mode} → ${mode}`,
        log: ['ai.mode', null, { before: r.before.mode, after: mode }],
        data: { mode: `${r.before.mode} → ${mode}` },
      };
    });
  }

  /** 선물과 쿠폰을 로그인 계정만 받기 (기본 켬) */
  async rewardsPolicy(actor: string, f: FormFields): Promise<AdminDone> {
    const on = f.login_only === '1' || f.login_only === 'true';
    return this.write(actor, async (c) => {
      const before = await this.rewards.setLoginOnly(c, on);
      return {
        text: `선물과 쿠폰: ${on ? '로그인 계정만' : '기기 계정도'} 받아요`,
        log: ['rewards.policy', null, { before, after: on }],
      };
    });
  }

  /** 정책: 자동 정기 지급 장수(매달 N장까지), 자리 수(정기 지급 계정 상한), 첫 로그인 선물 켜기 */
  async aiPolicy(actor: string, f: FormFields): Promise<AdminDone> {
    const autoMonthly = (f.auto_monthly ?? '').trim() === '' ? undefined : Number(f.auto_monthly);
    const seatLimit = (f.seat_limit ?? '').trim() === '' ? undefined : Number(f.seat_limit);
    const firstGift =
      f.first_gift === undefined ? undefined : f.first_gift === '1' || f.first_gift === 'true';
    return this.write(actor, async (c) => {
      let r: Awaited<ReturnType<AiAdmin['setPolicy']>>;
      try {
        r = await this.aiAdmin.setPolicy(c, {
          ...(autoMonthly !== undefined ? { autoMonthly } : {}),
          ...(seatLimit !== undefined ? { seatLimit } : {}),
          ...(firstGift !== undefined ? { firstGift } : {}),
        });
      } catch (err) {
        throw refusedFrom(err);
      }
      const pick = (x: AiSettings) => ({
        autoMonthly: x.autoMonthly,
        seatLimit: x.seatLimit,
        firstGift: x.firstGift,
      });
      return {
        text: `정책: 매달 ${r.after.autoMonthly}장까지, 자리 ${r.after.seatLimit}, 첫 선물 ${r.after.firstGift ? '켬' : '끔'}`,
        log: ['ai.policy', null, { before: pick(r.before), after: pick(r.after) }],
      };
    });
  }

  /** 월 예산(달러)과 하루 상한. 빈 칸은 .env 상한 그대로 */
  async aiLimits(actor: string, f: FormFields): Promise<AdminDone> {
    const b = (f.budget_usd ?? '').trim();
    const d = (f.daily_limit ?? '').trim();
    const usd = b === '' ? null : Number(b);
    if (usd !== null && (!Number.isFinite(usd) || usd < 0)) throw new Refused('월 예산은 0 이상의 달러');
    const daily = d === '' ? null : Number(d);
    if (daily !== null && (!Number.isInteger(daily) || daily < 0))
      throw new Refused('하루 상한은 0 이상의 정수');
    return this.write(actor, async (c) => {
      let r: Awaited<ReturnType<AiAdmin['setSettings']>>;
      try {
        r = await this.aiAdmin.setSettings(c, {
          monthlyBudgetMicros: usd === null ? null : Math.round(usd * 1_000_000),
          dailyLimit: daily,
        });
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `월 예산 $${(r.after.monthlyBudgetMicros / 1e6).toFixed(2)}, 하루 ${r.after.dailyLimit}번으로 저장했어요`,
        log: [
          'ai.limits',
          null,
          {
            before: { budget: r.before.setBudgetMicros, daily: r.before.setDailyLimit },
            after: { budget: r.after.setBudgetMicros, daily: r.after.setDailyLimit },
          },
        ],
      };
    });
  }

  /** 채팅 이용권 회수 (남은 장수까지만). 확인 칸이 있어야 한다. 주기는 쪽지로 (sendNote) */
  async aiRevoke(actor: string, f: FormFields): Promise<AdminDone> {
    if (f.confirm !== 'yes') throw new Refused('확인 칸을 체크해 주세요 (회수)', 'confirm');
    const n = int(f.count, 1, 1000, '회수 장수');
    if (n === 0) throw new Refused('회수할 장수를 넣어 주세요');
    return this.write(actor, async (c) => {
      let r: { id: string; remaining: number };
      try {
        r = await this.aiAdmin.adjustTickets(c, (f.account ?? '').trim(), -n);
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `계정 #${r.id} 의 채팅 이용권 ${n}장을 회수했어요 (남은 ${r.remaining}장)`,
        log: ['ai.revoke', `account:${r.id}`, { count: n, remaining: r.remaining }],
      };
    });
  }

  async aiSubscribe(actor: string, f: FormFields): Promise<AdminDone> {
    const monthly = int(f.monthly, 1, 1000, '매달 장수');
    const mode = f.mode === 'add' ? 'add' : 'fill';
    return this.write(actor, async (c) => {
      let r: { id: string; subscription: number };
      try {
        r = await this.aiAdmin.subscribe(c, (f.account ?? '').trim(), {
          monthly,
          mode,
          startsOn: (f.starts_on ?? '').trim(),
          endsOn: (f.ends_on ?? '').trim() || null,
        });
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `계정 #${r.id} 에 매달 채팅 이용권 ${monthly}장(${mode === 'fill' ? '까지 채우기' : '더하기'})을 걸었어요. 달마다 쪽지로 가요`,
        log: [
          'ai.subscribe',
          `account:${r.id}`,
          {
            subscription: r.subscription,
            monthly,
            mode,
            startsOn: f.starts_on || null,
            endsOn: f.ends_on || null,
          },
        ],
      };
    });
  }

  async aiCancel(actor: string, f: FormFields): Promise<AdminDone> {
    return this.write(actor, async (c) => {
      let r: { id: string; subscription: number };
      try {
        r = await this.aiAdmin.cancel(c, (f.account ?? '').trim());
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `계정 #${r.id} 의 정기 지급을 해지했어요`,
        log: ['ai.cancel', `account:${r.id}`, { subscription: r.subscription }],
      };
    });
  }

  async aiBlock(actor: string, f: FormFields): Promise<AdminDone> {
    const on = f.blocked === '1' || f.blocked === 'true';
    return this.write(actor, async (c) => {
      let id: string;
      try {
        id = await this.aiAdmin.setBlocked(c, (f.account ?? '').trim(), on);
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `계정 #${id} 의 채팅 이용권 사용을 ${on ? '막았어요' : '풀었어요'}`,
        log: [on ? 'ai.block' : 'ai.unblock', `account:${id}`, {}],
      };
    });
  }

  async aiAllow(actor: string, f: FormFields): Promise<AdminDone> {
    const on = f.allowed === '1' || f.allowed === 'true';
    try {
      return await this.aiAllowTx(actor, f, on);
    } catch (err) {
      // 자리가 없어 거절되면 대기 목록에 (되돌려진 트랜잭션 밖에서)
      if (err instanceof Refused && /자리가 없어요/.test(err.message)) {
        const id = await findAccount(this.db.pool, (f.account ?? '').trim());
        if (id) await this.aiAdmin.waitlistAdd(id);
      }
      throw err;
    }
  }

  private async aiAllowTx(actor: string, f: FormFields, on: boolean): Promise<AdminDone> {
    return this.write(actor, async (c) => {
      let id: string;
      try {
        const ref = (f.account ?? '').trim();
        const found = await findAccount(c, ref);
        id = await this.aiAdmin.setAllowed(c, ref, on, !!found && (await this.access.isAdminAccount(found)));
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `계정 #${id} 를 채팅 이용권 허용 목록에 ${on ? '넣었어요' : '뺐어요'}`,
        log: [on ? 'ai.allow' : 'ai.disallow', `account:${id}`, {}],
      };
    });
  }

  /** 쓰기 하나를 이름으로 (웹 폼과 앱의 /v1/admin/* 가 같이 쓴다) */
  run(action: AdminAction, actor: string, f: FormFields): Promise<AdminDone> {
    const id = () => (f.id ?? '').trim();
    switch (action) {
      case 'events':
        return this.createEvent(actor, f);
      case 'events/end':
        return this.endEvent(actor, id());
      case 'coupons':
        return this.createCoupon(actor, f);
      case 'coupons/disable':
        return this.disableCoupon(actor, id());
      case 'notes':
        return this.sendNote(actor, f);
      case 'notices':
        return this.saveNotice(actor, f);
      case 'notices/delete':
        return this.deleteNotice(actor, id());
      case 'versions':
        return this.saveVersions(actor, f);
      case 'ai/mode':
        return this.aiMode(actor, f);
      case 'ai/limits':
        return this.aiLimits(actor, f);
      case 'ai/revoke':
        return this.aiRevoke(actor, f);
      case 'ai/subscribe':
        return this.aiSubscribe(actor, f);
      case 'ai/cancel':
        return this.aiCancel(actor, f);
      case 'ai/block':
        return this.aiBlock(actor, f);
      case 'ai/allow':
        return this.aiAllow(actor, f);
      case 'ai/policy':
        return this.aiPolicy(actor, f);
      case 'rewards/policy':
        return this.rewardsPolicy(actor, f);
    }
  }

  /** 공지 문서를 잠그고 고친다 (처음이면 빈 문서에서) */
  private async editDoc(
    actor: string,
    fn: (
      doc: NoticeDoc,
    ) => Promise<{ text: string; action: string; target: string | null; detail: Record<string, unknown> }>,
  ): Promise<AdminDone> {
    return this.write(actor, async (c) => {
      await c.query(
        `INSERT INTO site_doc (name, body) VALUES ('notices', $1) ON CONFLICT (name) DO NOTHING`,
        [JSON.stringify(emptyDoc())],
      );
      const r = await c.query<{ body: unknown }>(
        `SELECT body FROM site_doc WHERE name = 'notices' FOR UPDATE`,
      );
      const doc = readDoc(r.rows[0]?.body);
      const out = await fn(doc);
      const bad = checkDoc(doc);
      if (bad) throw new Refused(bad);
      await c.query(`UPDATE site_doc SET body = $1, updated_at = now() WHERE name = 'notices'`, [
        JSON.stringify(doc),
      ]);
      return {
        text: `${out.text}. 홈페이지에는 10분 안쪽에 올라가요`,
        log: [out.action, out.target, out.detail],
      };
    });
  }

  /** 공지 넣기. 같은 id 가 있으면 바꾼다 (이미 닫은 알림은 다시 안 뜨므로 정정은 새 id 로) */
  async saveNotice(actor: string, f: FormFields): Promise<AdminDone> {
    const n = noticeFromForm(f);
    if (typeof n === 'string') throw new Refused(n);
    if (n.kind === 'force' && f.confirm !== 'yes')
      throw new Refused('확인 칸을 체크해 주세요 (강제 업데이트 글)', 'confirm');
    return this.editDoc(actor, async (doc) => {
      const i = doc.notices.findIndex((x) => x.id === n.id);
      if (i >= 0) doc.notices[i] = n;
      else doc.notices.push(n);
      return {
        text: `공지 ${n.id} 를 ${i >= 0 ? '바꿨어요' : '넣었어요'}`,
        action: i >= 0 ? 'notice.update' : 'notice.create',
        target: n.id,
        detail: {
          kind: n.kind,
          title: n.title.ko,
          from: n.from,
          until: n.until,
          versions: n.versions,
          platforms: n.platforms,
        },
      };
    });
  }

  async deleteNotice(actor: string, id: string): Promise<AdminDone> {
    return this.editDoc(actor, async (doc) => {
      const before = doc.notices.length;
      doc.notices = doc.notices.filter((x) => x.id !== id);
      if (doc.notices.length === before) throw new Refused('없는 공지예요');
      return { text: `공지 ${id} 를 지웠어요`, action: 'notice.delete', target: id, detail: {} };
    });
  }

  /**
   * 최소 버전과 권장 버전. 빈 칸은 지운다. 올릴 때는 지금 최신 릴리스 이하여야 한다 (23절: 없는 버전을 요구하면
   * 앱이 풀 수 없다). 최신 릴리스를 못 읽으면 올리기를 막는다 (내리기와 지우기는 된다)
   */
  async saveVersions(actor: string, f: FormFields): Promise<AdminDone> {
    const min = (f.minVersion ?? '').trim();
    const rec = (f.recommendVersion ?? '').trim();
    for (const [v, name] of [
      [min, '최소 버전'],
      [rec, '권장 버전'],
    ] as const)
      if (v && !VERSION.test(v)) throw new Refused(`${name}은 0.4.3 처럼`);
    const latest = await this.feeds.latestRelease();
    return this.editDoc(actor, async (doc) => {
      const raises = (next: string, prev: string | undefined) =>
        !!next && (!prev || compareVersion(next, prev) > 0);
      for (const [next, prev, name] of [
        [min, doc.minVersion, '최소 버전'],
        [rec, doc.recommendVersion, '권장 버전'],
      ] as const) {
        if (!raises(next, prev)) continue;
        if (name === '최소 버전' && f.confirm !== 'yes')
          throw new Refused('확인 칸을 체크해 주세요 (최소 버전 올리기: 낮은 앱이 잠겨요)', 'confirm');
        if (!latest)
          throw new Refused(`최신 릴리스를 읽지 못해 ${name}을 올리지 않았어요. 잠시 뒤 다시`, 'no_latest');
        if (compareVersion(next, latest) > 0)
          throw new Refused(
            `${name} ${next} 는 최신 릴리스 ${latest} 보다 높아요 (앱이 풀 수 없어요)`,
            'too_high',
          );
      }
      const before = { minVersion: doc.minVersion ?? null, recommendVersion: doc.recommendVersion ?? null };
      if (min) doc.minVersion = min;
      else delete doc.minVersion;
      if (rec) doc.recommendVersion = rec;
      else delete doc.recommendVersion;
      return {
        text: `최소 버전 ${min || '없음'}, 권장 버전 ${rec || '없음'} 으로 저장했어요`,
        action: 'versions',
        target: null,
        detail: {
          before,
          after: { minVersion: min || null, recommendVersion: rec || null },
          latest: latest ?? null,
        },
      };
    });
  }
}

/** 운영자 화면 응답의 보안 머리 */
function secure(res: AdminRes) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function html(res: AdminRes, status: number, body: string) {
  secure(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(status).send(body);
}

const header = (req: AdminReq, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** 다른 사이트에서 온 요청은 받지 않는다 (SameSite 쿠키와 CSRF 토큰 위에 한 겹 더) */
function sameOrigin(req: AdminReq, publicUrl: string): boolean {
  const origin = header(req, 'origin');
  if (origin !== undefined && origin !== new URL(publicUrl).origin) return false;
  const site = header(req, 'sec-fetch-site');
  return site === undefined || site === 'same-origin' || site === 'none';
}

/** 폼이나 JSON 본문을 글자 칸으로 (배열은 그대로, 나머지는 글로) */
export function fieldsOf(body: unknown): FormFields {
  const out: Record<string, string | undefined> = {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(v)) (out as Record<string, unknown>)[k] = v.map(String);
    else if (v !== undefined && v !== null)
      out[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  }
  return out;
}

/** 운영자 화면 (웹): 로그인 폼, 화면, 폼 POST */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuth,
    private readonly admin: AdminService,
    private readonly db: Db,
    private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private off(res: AdminRes): boolean {
    if (this.auth.enabled) return false;
    html(
      res,
      503,
      loginPage({ error: '운영자 화면이 꺼져 있어요 (ADMIN_TOKEN 이 없거나 32자보다 짧음)', off: true }),
    );
    return true;
  }

  @Get('admin.css')
  css(@Res() res: AdminRes) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(adminCss);
  }

  @Get()
  async page(@Req() req: AdminReq, @Res() res: AdminRes, @Query('q') q?: string) {
    if (this.off(res)) return;
    const s = this.auth.session(req.headers.cookie);
    if (!s) return html(res, 200, loginPage({}));
    this.limiter.check(`admin:${s.key}`, LIMITS.adminBySession);
    const flash = s.flash;
    s.flash = undefined;
    const view = await this.admin.view(typeof q === 'string' && q.trim() ? q.trim() : undefined);
    html(res, 200, mainPage({ ...view, csrf: s.csrf, flash }));
  }

  @Post('login')
  async login(@Req() req: AdminReq, @Res() res: AdminRes) {
    if (this.off(res)) return;
    if (!sameOrigin(req, this.config.publicUrl))
      return html(res, 403, loginPage({ error: '다른 곳에서 온 요청이에요' }));
    const token = (req.body as FormFields | undefined)?.token;
    const out = this.auth.login(token, ipKey(req));
    if (!out.ok) {
      if (out.error === 'bad_token')
        await adminLog(this.db.pool, 'anon', 'login.fail', null).catch(() => undefined);
      return html(
        res,
        out.error === 'rate_limited' ? 429 : 401,
        loginPage({
          error:
            out.error === 'rate_limited'
              ? '틀린 시도가 많아 잠시 막았어요. 15분 뒤 다시'
              : '토큰이 맞지 않아요',
        }),
      );
    }
    await adminLog(this.db.pool, actorOf(out.session), 'login', null);
    res.setHeader('Set-Cookie', out.cookie);
    secure(res);
    res.redirect(303, '/admin');
  }

  @Post('logout')
  async logout(@Req() req: AdminReq, @Res() res: AdminRes) {
    await this.guarded(req, res, async (s) => {
      this.auth.logout(s);
      await adminLog(this.db.pool, actorOf(s), 'logout', null);
      res.setHeader('Set-Cookie', clearCookie());
      return undefined;
    });
  }

  /** 쓰기 (ADMIN_ACTIONS). 결과 글을 세션에 담아 화면으로 돌려보낸다 (303) */
  @Post([...ADMIN_ACTIONS])
  async action(@Req() req: AdminReq, @Res() res: AdminRes) {
    const name = (req.path ?? '').replace(/^\/admin\//, '');
    if (!isAdminAction(name)) return html(res, 404, loginPage({ error: '없는 동작이에요' }));
    await this.guarded(
      req,
      res,
      async (s, f) => (await this.admin.run(name, actorOf(s), f)).text,
      (f) => (f.account ? `/admin?q=${encodeURIComponent(f.account.trim())}` : '/admin'),
    );
  }

  /**
   * 쓰기 하나: 세션, 출처, CSRF 를 보고 일한 뒤 결과 글을 세션에 담아 화면으로 돌려보낸다 (303).
   * 세션이 없으면 401 로그인 화면, CSRF 가 틀리면 403
   */
  private async guarded(
    req: AdminReq,
    res: AdminRes,
    fn: (s: AdminSession, f: FormFields) => Promise<string | undefined>,
    back: (f: FormFields) => string = () => '/admin',
  ): Promise<void> {
    if (this.off(res)) return;
    const s = this.auth.session(req.headers.cookie);
    if (!s) return html(res, 401, loginPage({ error: '로그인이 끝났어요. 다시 로그인해 주세요' }));
    this.limiter.check(`admin:${s.key}`, LIMITS.adminBySession);
    const f = fieldsOf(req.body);
    if (!sameOrigin(req, this.config.publicUrl) || !this.auth.csrfOk(s, f.csrf)) {
      await adminLog(this.db.pool, actorOf(s), 'csrf.fail', null).catch(() => undefined);
      return html(res, 403, loginPage({ error: '요청을 확인하지 못했어요 (CSRF). 화면을 다시 열어 주세요' }));
    }
    let to = '/admin';
    try {
      const text = await fn(s, f);
      if (text !== undefined) s.flash = { text, error: false };
      to = back(f);
    } catch (err) {
      if (err instanceof Refused) s.flash = { text: err.message, error: true };
      else {
        console.warn('[admin] 쓰기 실패:', (err as Error).message);
        s.flash = { text: '서버 오류로 저장하지 못했어요', error: true };
      }
    }
    secure(res);
    res.redirect(303, to);
  }
}

/**
 * 운영자 API (JSON, 앱 안 운영자 화면): GET /v1/admin/overview, POST /v1/admin/<ADMIN_ACTIONS>.
 * 두 인증 중 하나만 받는다 (요청마다 다시 본다, 캐시 없음):
 * (a) 웹 운영자 쿠키 세션 (ADMIN_TOKEN 로그인) + 쓰기에는 x-csrf-token 머리와 같은 출처
 * (b) 운영자 계정의 세션 Bearer (ADMIN_GOOGLE_SUBS 의 구글 로그인이 붙은 계정의 fs_ 토큰). 기기 토큰은 언제나 403
 * 결과는 { ok: true, text } 이거나 400 { error: 'refused', text }
 */
@Controller('v1/admin')
export class AdminApiController {
  constructor(
    private readonly auth: AdminAuth,
    private readonly admin: AdminService,
    private readonly guard: AuthGuard,
    private readonly access: AdminAccess,
    private readonly db: Db,
    private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** 누구인가. 아니면 401 / 403 을 던진다 */
  private async who(req: AdminReq, write: boolean): Promise<string> {
    const raw = header(req, 'authorization');
    if (raw?.startsWith('Bearer ')) {
      const auth = await this.guard.resolve(raw.slice(7).trim());
      if (!auth) {
        this.limiter.check(`bad:${ipKey(req)}`, LIMITS.badTokenByIp);
        throw new UnauthorizedException({ error: 'token' });
      }
      if (!(await this.access.isAdmin(auth))) throw new ForbiddenException({ error: 'not_admin' });
      this.limiter.check(`admin-acct:${auth.accountId}`, LIMITS.adminBySession);
      return `account:${auth.accountId}`;
    }
    const s = this.auth.session(req.headers.cookie);
    if (!s) throw new UnauthorizedException({ error: 'token' });
    this.limiter.check(`admin:${s.key}`, LIMITS.adminBySession);
    if (
      write &&
      (!sameOrigin(req, this.config.publicUrl) || !this.auth.csrfOk(s, header(req, 'x-csrf-token')))
    ) {
      await adminLog(this.db.pool, actorOf(s), 'csrf.fail', null).catch(() => undefined);
      throw new ForbiddenException({ error: 'csrf' });
    }
    return actorOf(s);
  }

  @Get('overview')
  async overview(@Req() req: AdminReq, @Query('q') q?: string) {
    await this.who(req, false);
    return this.admin.view(typeof q === 'string' && q.trim() ? q.trim() : undefined);
  }

  @Post([...ADMIN_ACTIONS])
  @HttpCode(200)
  async action(@Req() req: AdminReq) {
    const actor = await this.who(req, true);
    const name = (req.path ?? '').replace(/^\/v1\/admin\//, '');
    if (!isAdminAction(name)) throw new NotFoundException({ error: 'action' });
    try {
      return { ok: true, ...(await this.admin.run(name, actor, fieldsOf(req.body))) };
    } catch (err) {
      if (err instanceof Refused)
        throw new BadRequestException({ error: 'refused', code: err.code, text: err.message });
      throw err;
    }
  }
}
