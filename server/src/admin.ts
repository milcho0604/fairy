import { AsyncLocalStorage } from 'node:async_hooks';
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
import { lockAccount, lockAccountsOrdered } from './accounts';
import { AdminAccess } from './admin-access';
import { AdminAuth, type AdminSession, actorOf, clearCookie } from './admin-auth';
import {
  type AdminTab,
  type AdminUsersPage,
  type AdminView,
  adminCss,
  adminJs,
  loginPage,
  mainPage,
} from './admin-page';
import { AI_MODES, AiAdmin, type AiMode, type AiSettings, findAccount } from './ai-admin';
import { CONFIG } from './app.tokens';
import { AuthGuard } from './auth.guard';
import type { Config } from './config';
import { Db } from './db';
import { type FeatureKey, Features, isFeatureKey } from './features';
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
import { normalizeDeviceCode } from './shared/account-profile';
import { COUPON_ALPHABET, COUPON_LENGTH, formatCoupon, kstIso, parseEvent } from './shared/site-events';
import { levelsOrder, normalVersion } from './shared/update-levels';
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
  'grants/batch',
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
  // 기능 스위치 (#102): kakao_login, coin_reset 의 모드와 허용 계정 (ai_chat 은 ai/mode, ai/allow)
  'features/mode',
  'features/allow',
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

const USER_PAGE_SIZE = 50;
const LOG_PAGE_SIZE = 50;
const GRANT_MAX_RECIPIENTS = 20;

/** 운영 기록 찾기 칸 (웹 /admin/log 와 앱의 /v1/admin/overview) */
export interface LogOptions {
  user?: string | undefined;
  action?: string | undefined;
  text?: string | undefined;
  page?: string | undefined;
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

export interface GrantInput {
  refs: string[];
  coins: number;
  passes: number;
  reason: string;
  days: number;
}

/** DB 작업과 분리한 지급 폼 검사. 웹과 단위 시험이 같은 상한을 쓴다. */
export function grantInput(f: FormFields): GrantInput {
  if (f.confirm !== 'yes') throw new Refused('확인 칸을 체크해 주세요 (지급)', 'confirm');
  const raw = (f.accounts ?? f.account ?? '').trim();
  const refs = raw
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (refs.length === 0) throw new Refused('받을 계정 번호나 기기 코드를 넣어 주세요');
  if (refs.length > GRANT_MAX_RECIPIENTS)
    throw new Refused(`한 번에 ${GRANT_MAX_RECIPIENTS}명까지만 지급할 수 있어요`, 'over_cap');
  const coins = int(f.coins, 0, 10000, '코인');
  const passes = int(f.chat_passes, 0, 1000, '채팅 이용권');
  if (coins + passes === 0) throw new Refused('코인이나 채팅 이용권 중 하나는 넣어 주세요');
  const reason = cleanText(f.reason ?? f.message);
  if (!reason) throw new Refused('지급 사유를 넣어 주세요');
  if (reason.length > 200) throw new Refused('지급 사유는 200자까지');
  const days = int(f.days, 1, 365, '만료 날수') || 30;
  return { refs, coins, passes, reason, days };
}

export function newCouponCode(): string {
  let s = '';
  for (let i = 0; i < COUPON_LENGTH; i++) s += COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)];
  return s;
}

/** 운영 기록의 "누가" 이름: 웹 세션은 "웹 운영자", 앱 운영자는 닉네임과 계정 번호. 모르면 null (옛 기록처럼 actor 를 보인다) */
export async function actorName(c: PoolClient | Db['pool'], actor: string): Promise<string | null> {
  if (actor.startsWith('admin:')) return '웹 운영자';
  const m = /^account:(\d{1,18})$/.exec(actor);
  if (!m) return null;
  const r = await c.query<{ nickname: string | null }>('SELECT nickname FROM account WHERE id = $1', [m[1]]);
  return `${r.rows[0]?.nickname ?? '닉네임 없음'} #${m[1]}`.slice(0, 80);
}

/** 운영 기록 한 줄 */
export async function adminLog(
  c: PoolClient | Db['pool'],
  actor: string,
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await c.query(
    'INSERT INTO admin_log (actor, actor_name, action, target, detail) VALUES ($1, $2, $3, $4, $5)',
    [
      actor,
      await actorName(c, actor),
      action,
      target?.slice(0, 120) ?? null,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}

/** 되돌릴 수 없는 동작은 확인 칸이 있어야 한다 (웹은 대상 이름이 적힌 체크 칸, 앱은 두 번 누르기). 이름은 거절 글에 붙는다 */
const confirmCtx = new AsyncLocalStorage<{ unconfirmed: boolean; legacyOk: boolean }>();

/**
 * 새 확인 (이벤트 끝내기, 쿠폰 끄기, 공지 지우기, 정기 지급 해지, 막기): 확인 칸 값이 대상 이름(id 나 계정)과 맞아야 한다.
 * 확인이 아예 없는 요청은 앱 Bearer 경로(운영자 계정 주체 account:)에서만 옛 앱(0.5.0)이라 예전처럼 받고 운영 기록에
 * "확인 없이(옛 앱)" 를 남긴다. 웹 폼과 쿠키 JSON 경로(주체 admin:)는 확인이 없으면 거절한다. 계정은 기기 코드 표기 차이를 맞춰 비교한다
 */
function softConfirm(f: FormFields, what: string, target: string): void {
  const c = (f.confirm ?? '').trim();
  if (!c) {
    const ctx = confirmCtx.getStore();
    if (!ctx?.legacyOk) throw new Refused(`확인 칸을 체크해 주세요 (${what})`, 'confirm');
    ctx.unconfirmed = true;
    return;
  }
  const t = target.trim();
  const same =
    c === t || (normalizeDeviceCode(c) !== undefined && normalizeDeviceCode(c) === normalizeDeviceCode(t));
  if (!same) throw new Refused(`확인한 대상이 달라요 (${what})`, 'confirm');
}

function needConfirm(f: FormFields, what: string): void {
  if (f.confirm !== 'yes') throw new Refused(`확인 칸을 체크해 주세요 (${what})`, 'confirm');
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
    private readonly features: Features,
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
  async view(
    query: string | undefined,
    tab: AdminTab = 'overview',
    userOptions: { page?: string; sort?: string; direction?: string } = {},
    logOptions: LogOptions = {},
  ): Promise<Omit<AdminView, 'csrf' | 'flash'>> {
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
    // 앱 판 분포 (이슈 #120): 최근 30일 활동 계정. 판을 모르는 계정은 따로 센다 (앱이 머리를 보낸 적이 없는 옛 앱)
    const dist = await q.query<{ v: string | null; n: string }>(
      `SELECT app_version AS v, count(*) AS n FROM account
        WHERE closed_at IS NULL AND merged_into IS NULL AND last_active_at > now() - interval '30 days'
        GROUP BY app_version`,
    );
    const log = await this.logs(logOptions);
    return {
      tab,
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
      users: await this.users(query, userOptions),
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
      logPage: log.page,
      rewardsLoginOnly: await this.rewards.loginOnly(),
      features: await this.features.listFeatures(),
      versions: versionStats(dist.rows),
    };
  }

  /** 찾는 말로 계정 번호들 (번호, 기기 코드, 닉네임 일부). 합쳐진 계정이면 남은 계정 번호도 */
  private async accountIds(ref: string): Promise<string[]> {
    const ids = new Set<string>();
    const exact = await findAccount(this.db.pool, ref);
    if (exact) {
      ids.add(exact);
      const m = await this.db.pool.query<{ merged_into: string | null }>(
        'SELECT merged_into FROM account WHERE id = $1',
        [exact],
      );
      if (m.rows[0]?.merged_into) ids.add(m.rows[0].merged_into);
    }
    const byName = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM account WHERE nickname ILIKE '%' || $1 || '%' ESCAPE '\\' ORDER BY id DESC LIMIT 20`,
      [ref.replace(/[\\%_]/g, '\\$&')],
    );
    for (const r of byName.rows) ids.add(r.id);
    return [...ids];
  }

  /** 운영 기록 한 쪽: 대상 이용자, 동작 종류, 글 검색으로 걸러 50건씩 (옛 기록은 actor_name 이 비어 있다) */
  private async logs(o: LogOptions): Promise<{ rows: AdminView['log']; page: AdminView['logPage'] }> {
    const user = (o.user ?? '').trim().slice(0, 40);
    const action = (o.action ?? '').trim().slice(0, 40);
    const text = (o.text ?? '').trim().slice(0, 60);
    const ids = user ? await this.accountIds(user) : undefined;
    const targets = ids ? ids.map((id) => `account:${id}`) : null;
    const like = text.replace(/[\\%_]/g, '\\$&');
    const pageRaw = Number(o.page ?? '1');
    const want = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100_000) : 1;
    const join = `FROM admin_log l LEFT JOIN account ac
        ON ac.id = CASE WHEN l.target ~ '^account:[0-9]{1,18}$' THEN substr(l.target, 9)::bigint END`;
    const where = `WHERE ($1::text[] IS NULL OR l.target = ANY($1::text[]))
        AND ($2 = '' OR l.action = $2)
        AND ($3 = '' OR l.actor_name ILIKE '%' || $4 || '%' ESCAPE '\\' OR l.actor ILIKE '%' || $4 || '%' ESCAPE '\\'
          OR l.action ILIKE '%' || $4 || '%' ESCAPE '\\' OR l.target ILIKE '%' || $4 || '%' ESCAPE '\\'
          OR ac.nickname ILIKE '%' || $4 || '%' ESCAPE '\\' OR l.detail::text ILIKE '%' || $4 || '%' ESCAPE '\\')`;
    const args = [targets, action, text, like];
    const count = await this.db.pool.query<{ n: string }>(`SELECT count(*) AS n ${join} ${where}`, args);
    const total = Number(count.rows[0]?.n ?? 0);
    const pages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
    const page = Math.min(want, pages);
    const rows = await this.db.pool.query<AdminView['log'][number]>(
      `SELECT (extract(epoch FROM l.at) * 1000)::bigint AS at, l.actor, l.actor_name AS "actorName", l.action, l.target,
              CASE WHEN ac.id IS NULL THEN NULL ELSE COALESCE(ac.nickname, '닉네임 없음') || ' #' || ac.id END AS "targetName",
              l.detail
         ${join} ${where} ORDER BY l.id DESC LIMIT $5 OFFSET $6`,
      [...args, LOG_PAGE_SIZE, (page - 1) * LOG_PAGE_SIZE],
    );
    const actions = await this.db.pool.query<{ action: string }>(
      'SELECT DISTINCT action FROM admin_log ORDER BY action',
    );
    return {
      rows: rows.rows,
      page: {
        total,
        page,
        pages,
        user,
        action,
        text,
        actions: actions.rows.map((x) => x.action),
        userMissing: ids !== undefined && ids.length === 0,
      },
    };
  }

  /** 개인정보와 비밀값을 고르지 않는 운영자용 이용자 목록 */
  private async users(
    query: string | undefined,
    options: { page?: string; sort?: string; direction?: string },
  ): Promise<AdminUsersPage> {
    const text = (query ?? '').trim().slice(0, 40);
    const pageRaw = Number(options.page ?? '1');
    const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100_000) : 1;
    const sort = ['active', 'coins', 'created'].includes(options.sort ?? '')
      ? (options.sort as AdminUsersPage['sort'])
      : 'active';
    const direction: AdminUsersPage['direction'] = options.direction === 'asc' ? 'asc' : 'desc';
    const order = {
      active: 'a.last_active_at',
      coins: 'a.balance',
      created: 'a.created_at',
    }[sort];
    const escaped = text.replace(/[\\%_]/g, '\\$&');
    const where = `a.closed_at IS NULL AND a.merged_into IS NULL
      AND ($1 = '' OR a.id::text = $1 OR a.nickname ILIKE '%' || $2 || '%' ESCAPE '\\'
        OR a.code ILIKE '%' || $2 || '%' ESCAPE '\\')`;
    const count = await this.db.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM account a WHERE ${where}`,
      [text, escaped],
    );
    const total = Number(count.rows[0]?.n ?? 0);
    const pages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
    const current = Math.min(page, pages);
    const rows = await this.db.pool.query<{
      id: string;
      code: string;
      nickname: string | null;
      logins: string[] | null;
      age: string;
      balance: string;
      tickets: number;
      last_active: string;
      created: string;
      app_version: string | null;
    }>(
      `SELECT a.id, a.code, a.nickname, a.age, a.balance::text AS balance,
              COALESCE(t.remaining, 0) AS tickets,
              (extract(epoch FROM a.last_active_at) * 1000)::bigint AS last_active,
              (extract(epoch FROM a.created_at) * 1000)::bigint AS created,
              a.app_version,
              (SELECT array_agg(DISTINCT l.service ORDER BY l.service) FROM login l WHERE l.account_id = a.id) AS logins
         FROM account a LEFT JOIN ai_ticket t ON t.account_id = a.id
        WHERE ${where}
        ORDER BY ${order} ${direction === 'asc' ? 'ASC' : 'DESC'}, a.id DESC
        LIMIT $3 OFFSET $4`,
      [text, escaped, USER_PAGE_SIZE, (current - 1) * USER_PAGE_SIZE],
    );
    return {
      rows: rows.rows.map((x) => ({
        id: x.id,
        code: x.code,
        nickname: x.nickname,
        logins: x.logins ?? [],
        age: x.age,
        balance: Number(x.balance),
        tickets: x.tickets,
        lastActive: Number(x.last_active),
        created: Number(x.created),
        appVersion: x.app_version,
      })),
      total,
      page: current,
      pages,
      query: text,
      sort,
      direction,
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
      const old = confirmCtx.getStore()?.unconfirmed;
      await adminLog(
        c,
        actor,
        out.log[0],
        out.log[1],
        old ? { ...out.log[2], confirm: '확인 없이(옛 앱)' } : out.log[2],
      );
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
  async endEvent(actor: string, id: string, f: FormFields): Promise<AdminDone> {
    softConfirm(f, `이벤트 ${id} 끝내기`, id);
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

  async disableCoupon(actor: string, id: string, f: FormFields): Promise<AdminDone> {
    if (!/^\d{1,18}$/.test(id)) throw new Refused('쿠폰 번호가 이상해요');
    softConfirm(f, `쿠폰 #${id} 끄기`, id);
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

  /** 여러 기기 코드에 같은 지급 쪽지를 보낸다. 전부 확인된 뒤 한 트랜잭션에서 넣는다. */
  async sendGrantBatch(actor: string, f: FormFields): Promise<AdminDone> {
    const { refs, coins, passes, reason, days } = grantInput(f);

    return this.db.tx(async (c) => {
      const found: string[] = [];
      for (const ref of refs) {
        const id = await findAccount(c, ref);
        if (!id) throw new Refused(`없는 계정이에요: ${ref}`, 'no_account');
        found.push(id);
      }
      const locked = await lockAccountsOrdered(c, found);
      const accounts = [...new Set(locked.map((x) => x.id))];
      if (passes > 0) {
        const ages = await c.query<{ id: string; age: string }>(
          'SELECT id, age FROM account WHERE id = ANY($1::bigint[])',
          [accounts],
        );
        const under = ages.rows.find((x) => x.age !== '18+');
        if (under)
          throw new Refused(`계정 #${under.id} 는 만 18세 이상이 아니라 채팅 이용권을 줄 수 없어요`, 'age');
      }
      const noteIds: number[] = [];
      for (const accountId of accounts) {
        const noteId = await sendInbox(c, accountId, {
          kind: 'grant',
          message: reason,
          coins,
          chatPasses: passes,
          expiresAt: Date.now() + days * 86_400_000,
        });
        noteIds.push(Number(noteId));
        await adminLog(c, actor, 'note.send', `account:${accountId}`, {
          note: Number(noteId),
          coins,
          chatPasses: passes,
          days,
          message: reason,
          batch: true,
        });
      }
      await adminLog(c, actor, 'grant.batch', null, {
        recipients: accounts.length,
        coins,
        chatPasses: passes,
        days,
        notes: noteIds,
      });
      return {
        text: `${accounts.length}명에게 지급 쪽지를 보냈어요 (코인 ${coins}, 채팅 이용권 ${passes}장). 사용자가 열 때 받아요`,
        code: 'grant.batch',
        data: { recipients: accounts.length },
      };
    });
  }

  // ---- 채팅 이용권 (AI 대화권) 관리 ----

  /** 접근 모드 (off, allowlist, everyone). 바꾸기는 확인 칸이 있어야 한다 */
  async aiMode(actor: string, f: FormFields): Promise<AdminDone> {
    needConfirm(f, '접근 설정 바꾸기');
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

  // ---- 기능 스위치 (#102): kakao_login, coin_reset ----

  private featureKey(f: FormFields): FeatureKey {
    const key = (f.key ?? '').trim();
    if (!isFeatureKey(key)) throw new Refused('모르는 기능이에요');
    return key;
  }

  /** 기능 모드 (off, allowlist, everyone). 바꾸기는 확인 칸이 있어야 한다 */
  async featureMode(actor: string, f: FormFields): Promise<AdminDone> {
    needConfirm(f, '접근 설정 바꾸기');
    const key = this.featureKey(f);
    const mode = (f.mode ?? '') as AiMode;
    if (!AI_MODES.includes(mode)) throw new Refused('모드는 off, allowlist, everyone');
    const before = await this.features.featureMode(key);
    return this.write(actor, async (c) => {
      await this.features.setFeatureMode(key, mode, c);
      return {
        text: `${key} 모드: ${before} → ${mode}`,
        log: ['feature.mode', null, { key, before, after: mode }],
      };
    });
  }

  /** 기능 허용 목록에 계정 넣기, 빼기 (allowlist 모드에서 쓴다) */
  async featureAllow(actor: string, f: FormFields): Promise<AdminDone> {
    const key = this.featureKey(f);
    const on = f.allowed === '1' || f.allowed === 'true';
    return this.write(actor, async (c) => {
      const id = await findAccount(c, (f.account ?? '').trim());
      if (!id) throw new Refused('없는 계정이에요 (계정 번호나 기기 코드)');
      const live = (await lockAccount(c, id)).id;
      if (on) await this.features.allowAccount(key, live, c);
      else await this.features.disallowAccount(key, live, c);
      return {
        text: `계정 #${live} 를 ${key} 허용 목록에 ${on ? '넣었어요' : '뺐어요'}`,
        log: [on ? 'feature.allow' : 'feature.disallow', `account:${live}`, { key }],
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

  /**
   * 월 예산(달러), 하루 상한, 질문 글자 수 상한. 빈 칸은 .env 상한으로 되돌리고(NULL),
   * 칸이 아예 없으면(undefined) 저장된 값을 그대로 둔다 (앱 운영자 칸이 일부 칸만 보내도 나머지를 지우지 않게)
   */
  async aiLimits(actor: string, f: FormFields): Promise<AdminDone> {
    const usd = this.limitField(f.budget_usd, '월 예산은 0 이상의 달러 (보통 숫자만)', true);
    const daily = this.limitField(f.daily_limit, '하루 상한은 0 이상의 정수 (보통 숫자만)');
    const chars = this.limitField(f.input_chars, '질문 글자 수는 1 이상의 정수 (보통 숫자만)');
    if (chars != null && chars < 1) throw new Refused('질문 글자 수는 1 이상의 정수');
    return this.write(actor, async (c) => {
      let r: Awaited<ReturnType<AiAdmin['setSettings']>>;
      try {
        r = await this.aiAdmin.setSettings(c, {
          monthlyBudgetMicros: usd == null ? usd : Math.round(usd * 1_000_000),
          dailyLimit: daily,
          inputChars: chars,
        });
      } catch (err) {
        throw refusedFrom(err);
      }
      return {
        text: `월 예산 $${(r.after.monthlyBudgetMicros / 1e6).toFixed(2)}, 하루 ${r.after.dailyLimit}번, 질문 ${r.after.inputChars}자로 저장했어요`,
        log: [
          'ai.limits',
          null,
          {
            before: {
              budget: r.before.setBudgetMicros,
              daily: r.before.setDailyLimit,
              inputChars: r.before.setInputChars,
            },
            after: {
              budget: r.after.setBudgetMicros,
              daily: r.after.setDailyLimit,
              inputChars: r.after.setInputChars,
            },
          },
        ],
      };
    });
  }

  /** 한도 칸 하나: 없으면 undefined(그대로), 빈 칸이면 null(상한으로), 아니면 숫자 */
  private limitField(raw: string | undefined, what: string, decimal = false): number | null | undefined {
    if (raw === undefined) return undefined;
    const v = raw.trim();
    if (v === '') return null;
    // 보통 10진수만 (Number 는 0x10, 1e2, 공백 섞인 값도 받아 준다)
    if (!(decimal ? /^[0-9]+(\.[0-9]+)?$/ : /^[0-9]+$/).test(v)) throw new Refused(what);
    return Number(v);
  }

  /** 채팅 이용권 회수 (남은 장수까지만). 확인 칸이 있어야 한다. 주기는 쪽지로 (sendNote) */
  async aiRevoke(actor: string, f: FormFields): Promise<AdminDone> {
    needConfirm(f, '회수');
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
    softConfirm(f, '정기 지급 해지', f.account ?? '');
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
    if (on) softConfirm(f, '채팅 이용권 막기', f.account ?? '');
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
    // 칸은 글자 하나만 받는다 (같은 이름을 두 번 보내 배열이 되면 거절)
    for (const k of ['id', 'account', 'key', 'confirm'])
      if (typeof (f as Record<string, unknown>)[k] !== 'undefined' && typeof f[k] !== 'string')
        return Promise.reject(new Refused(`${k} 칸은 값 하나만 받아요`));
    return confirmCtx.run({ unconfirmed: false, legacyOk: actor.startsWith('account:') }, () =>
      this.dispatch(action, actor, f),
    );
  }

  private dispatch(action: AdminAction, actor: string, f: FormFields): Promise<AdminDone> {
    const id = () => (f.id ?? '').trim();
    switch (action) {
      case 'events':
        return this.createEvent(actor, f);
      case 'events/end':
        return this.endEvent(actor, id(), f);
      case 'coupons':
        return this.createCoupon(actor, f);
      case 'coupons/disable':
        return this.disableCoupon(actor, id(), f);
      case 'notes':
        return this.sendNote(actor, f);
      case 'grants/batch':
        return this.sendGrantBatch(actor, f);
      case 'notices':
        return this.saveNotice(actor, f);
      case 'notices/delete':
        return this.deleteNotice(actor, id(), f);
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
      case 'features/mode':
        return this.featureMode(actor, f);
      case 'features/allow':
        return this.featureAllow(actor, f);
    }
  }

  /** 공지 문서를 잠그고 고친다 (처음이면 빈 문서에서) */
  private async editDoc(
    actor: string,
    fn: (
      doc: NoticeDoc,
    ) => Promise<{ text: string; action: string; target: string | null; detail: Record<string, unknown> }>,
  ): Promise<AdminDone> {
    // 쓰고 나면 업데이트 기준 담아 두기를 비운다 (관문이 바로 새 값을 본다, feeds.ts levels)
    const done = await this.write(actor, async (c) => {
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
    this.feeds.forgetLevels();
    return done;
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

  async deleteNotice(actor: string, id: string, f: FormFields): Promise<AdminDone> {
    softConfirm(f, `공지 ${id} 지우기`, id);
    return this.editDoc(actor, async (doc) => {
      const before = doc.notices.length;
      doc.notices = doc.notices.filter((x) => x.id !== id);
      if (doc.notices.length === before) throw new Refused('없는 공지예요');
      return { text: `공지 ${id} 를 지웠어요`, action: 'notice.delete', target: id, detail: {} };
    });
  }

  /**
   * 업데이트 세 기준: 강제(최소), 기능 제한, 권장. 빈 칸은 지운다. 올릴 때는 지금 최신 릴리스 이하여야 한다 (23절: 없는 버전을
   * 요구하면 앱이 풀 수 없다). 최신 릴리스를 못 읽으면 올리기를 막는다 (내리기와 지우기는 된다). 강제와 기능 제한을 올릴 때는
   * 확인 칸을 체크해야 한다 (낮은 앱이 잠기거나 서버 기능이 막힌다). 세 값의 순서는 강제 ≤ 기능 제한 ≤ 권장 (issue #120)
   */
  async saveVersions(actor: string, f: FormFields): Promise<AdminDone> {
    // 판은 숫자로 맞춘다 (0000.0005.0000 → 0.5.0). 기능 제한 칸이 아예 없으면(undefined) 그 값을 그대로 둔다
    // (옛 폼은 이 칸이 없었다). 칸이 있고 비었으면 지운다
    const norm = (raw: string | undefined, name: string): string => {
      const v = (raw ?? '').trim();
      if (!v) return '';
      if (!VERSION.test(v)) throw new Refused(`${name}은 0.4.3 처럼`);
      return normalVersion(v);
    };
    const min = norm(f.minVersion, '최소 버전');
    const restrictGiven =
      f.restrictVersion === undefined ? undefined : norm(f.restrictVersion, '기능 제한 버전');
    const rec = norm(f.recommendVersion, '권장 버전');
    const latest = await this.feeds.latestRelease();
    return this.editDoc(actor, async (doc) => {
      const restrict = restrictGiven ?? doc.restrictVersion ?? '';
      // 순서는 실제로 저장될 세 값으로 본다 (기능 제한을 그대로 둔 때도)
      const order = levelsOrder({ min, restrict, recommend: rec });
      if (order) throw new Refused(order, 'order');
      const raises = (next: string, prev: string | undefined) =>
        !!next && (!prev || compareVersion(next, prev) > 0);
      for (const [next, prev, name, sure] of [
        [min, doc.minVersion, '최소 버전', true],
        [restrict, doc.restrictVersion, '기능 제한 버전', true],
        [rec, doc.recommendVersion, '권장 버전', false],
      ] as const) {
        if (!raises(next, prev)) continue;
        if (sure && f.confirm !== 'yes')
          throw new Refused(
            `확인 칸을 체크해 주세요 (${name} 올리기: ${name === '최소 버전' ? '낮은 앱이 잠겨요' : '낮은 앱의 서버 기능이 막혀요'})`,
            'confirm',
          );
        if (!latest)
          throw new Refused(`최신 릴리스를 읽지 못해 ${name}을 올리지 않았어요. 잠시 뒤 다시`, 'no_latest');
        if (compareVersion(next, latest) > 0)
          throw new Refused(
            `${name} ${next} 는 최신 릴리스 ${latest} 보다 높아요 (앱이 풀 수 없어요)`,
            'too_high',
          );
      }
      const before = {
        minVersion: doc.minVersion ?? null,
        restrictVersion: doc.restrictVersion ?? null,
        recommendVersion: doc.recommendVersion ?? null,
      };
      if (min) doc.minVersion = min;
      else delete doc.minVersion;
      if (restrict) doc.restrictVersion = restrict;
      else delete doc.restrictVersion;
      if (rec) doc.recommendVersion = rec;
      else delete doc.recommendVersion;
      return {
        text: `강제 ${min || '없음'}, 기능 제한 ${restrict || '없음'}, 권장 ${rec || '없음'} 으로 저장했어요`,
        action: 'versions',
        target: null,
        detail: {
          before,
          after: {
            minVersion: min || null,
            restrictVersion: restrict || null,
            recommendVersion: rec || null,
          },
          latest: latest ?? null,
        },
      };
    });
  }
}

/** 앱 판 분포 (최근 30일 활동 계정). 판은 높은 순, 모르는 계정은 unknown */
export function versionStats(rows: { v: string | null; n: string }[]): AdminView['versions'] {
  let active = 0;
  let unknown = 0;
  const list: { version: string; count: number }[] = [];
  for (const r of rows) {
    const n = Number(r.n);
    active += n;
    if (r.v === null) unknown += n;
    else list.push({ version: r.v, count: n });
  }
  list.sort((a, b) => compareVersion(b.version, a.version));
  return { active, unknown, rows: list };
}

/** 운영자 화면 응답의 보안 머리 */
function secure(res: AdminRes) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // no-referrer 면 Chromium 이 같은 곳의 폼 POST 에도 Origin: null 을 보내 로그인이 막혔다 (QA #112). 같은 곳에만 보낸다
  res.setHeader('Referrer-Policy', 'same-origin');
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

const TAB_PATHS: Record<AdminTab, string> = {
  overview: '/admin',
  users: '/admin/users',
  grants: '/admin/grants',
  notices: '/admin/notices',
  events: '/admin/events',
  features: '/admin/features',
  ai: '/admin/ai',
  log: '/admin/log',
};

export function tabFromPath(path: string | undefined): AdminTab | undefined {
  const found = (Object.entries(TAB_PATHS) as Array<[AdminTab, string]>).find(([, value]) => value === path);
  return found?.[0];
}

const ACTION_TABS: Record<AdminAction, AdminTab> = {
  events: 'events',
  'events/end': 'events',
  coupons: 'events',
  'coupons/disable': 'events',
  notes: 'grants',
  'grants/batch': 'grants',
  notices: 'notices',
  'notices/delete': 'notices',
  versions: 'notices',
  'ai/mode': 'ai',
  'ai/limits': 'ai',
  'ai/revoke': 'users',
  'ai/subscribe': 'users',
  'ai/cancel': 'users',
  'ai/block': 'users',
  'ai/allow': 'ai',
  'ai/policy': 'ai',
  'rewards/policy': 'events',
  'features/mode': 'features',
  'features/allow': 'features',
};

/**
 * 다른 사이트에서 온 요청은 받지 않는다 (SameSite 쿠키와 CSRF 토큰 위에 한 겹 더. CSRF 토큰은 따로 늘 본다).
 * - Origin 이 있으면 그것이 이 서버여야 한다
 * - Origin 이 "null" 이면(브라우저가 출처를 숨김) Sec-Fetch-Site 가 same-origin 이어야 한다
 * - Origin 이 없으면(브라우저 밖 도구) Sec-Fetch-Site 가 없거나 same-origin, none 이어야 한다
 */
export function sameOrigin(req: AdminReq, publicUrl: string): boolean {
  const origin = header(req, 'origin');
  const site = header(req, 'sec-fetch-site');
  if (origin === 'null') return site === 'same-origin';
  if (origin !== undefined && origin !== new URL(publicUrl).origin) return false;
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

/** 실패한 폼을 다시 그릴 때 채울 값: 확인 칸과 비밀값 칸은 빼고, 칸 수와 길이를 자른다 */
export function draftOf(f: FormFields): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (k === 'csrf' || k === 'confirm' || k === 'token' || Object.keys(out).length >= 40) continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, 200));
    else if (typeof v === 'string') out[k] = v.slice(0, 2000);
  }
  return out;
}

/** 실패한 폼이 어느 대상의 것인지 (기능 키, 계정, id). 같은 모양의 폼이 여럿일 때 맞는 것만 채우려고 */
export const scopeOf = (f: FormFields): string => {
  const v = [f.key, f.account, f.id].find((x) => typeof x === 'string');
  return typeof v === 'string' ? v.trim().slice(0, 40) : '';
};

/** 운영 기록 탭 주소의 찾기 칸 */
function logOptionsOf(query: Record<string, unknown>): LogOptions {
  const text = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : undefined);
  return { user: text('user'), action: text('action'), text: text('text'), page: text('page') };
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

  /** 제출 중 단추 막기와 끊긴 제출 되살리기 (바깥 스크립트 한 장, 인라인 스크립트 없음) */
  @Get('admin.js')
  js(@Res() res: AdminRes) {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(adminJs);
  }

  @Get(['', 'users', 'grants', 'notices', 'events', 'features', 'ai', 'log'])
  async page(@Req() req: AdminReq, @Res() res: AdminRes, @Query() query: Record<string, unknown>) {
    if (this.off(res)) return;
    const s = this.auth.session(req.headers.cookie);
    if (!s) return html(res, 200, loginPage({}));
    this.limiter.check(`admin:${s.key}`, LIMITS.adminBySession);
    const flash = s.flash;
    s.flash = undefined;
    const legacyQuery = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined;
    const tab = req.path === '/admin' && legacyQuery ? 'users' : (tabFromPath(req.path) ?? 'overview');
    const selected = tab === 'grants' && typeof query.account === 'string' ? query.account : legacyQuery;
    const view = await this.admin.view(
      selected,
      tab,
      {
        page: typeof query.page === 'string' ? query.page : undefined,
        sort: typeof query.sort === 'string' ? query.sort : undefined,
        direction: typeof query.direction === 'string' ? query.direction : undefined,
      },
      tab === 'log' ? logOptionsOf(query) : {},
    );
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
      (f) => {
        const base = TAB_PATHS[ACTION_TABS[name]];
        return ACTION_TABS[name] === 'users' && f.account
          ? `${base}?q=${encodeURIComponent(f.account.trim())}`
          : base;
      },
      name,
    );
  }

  /** 같은 운영자 화면에서 제출한 폼이면 그 탭과 안전한 조회 문자열로 돌아간다. */
  private returnTo(req: AdminReq, fallback: string): string {
    const referer = header(req, 'referer');
    if (!referer) return fallback;
    try {
      const url = new URL(referer, this.config.publicUrl);
      if (url.origin !== new URL(this.config.publicUrl).origin || !tabFromPath(url.pathname)) return fallback;
      return `${url.pathname}${url.search}`.slice(0, 300);
    } catch {
      return fallback;
    }
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
    form?: string,
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
    const to = this.returnTo(req, back(f));
    try {
      const text = await fn(s, f);
      if (text !== undefined) s.flash = { text, error: false };
    } catch (err) {
      // 실패하면 쓴 값을 세션에 한 번만 담아 두었다가 같은 폼을 채워 다시 그린다 (비밀값 칸과 확인 칸은 빼고)
      const keep = form ? { form, scope: scopeOf(f), fields: draftOf(f) } : {};
      if (err instanceof Refused) s.flash = { text: err.message, error: true, ...keep };
      else {
        console.warn('[admin] 쓰기 실패:', (err as Error).message);
        s.flash = { text: '서버 오류로 저장하지 못했어요', error: true, ...keep };
      }
    }
    secure(res);
    res.redirect(303, s.flash?.error ? `${to}#form-error` : to);
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
  async overview(@Req() req: AdminReq, @Query() query: Record<string, unknown>) {
    await this.who(req, false);
    const q = query.q;
    return this.admin.view(
      typeof q === 'string' && q.trim() ? q.trim() : undefined,
      'overview',
      {},
      logOptionsOf(query),
    );
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
