import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CONFIG } from './app.tokens';
import { adminEnabled, type Config } from './config';
import { LIMITS, RateLimiter } from './rate-limit';

// 운영자 로그인 (기획서 10절, 이슈 #101). 브라우저에서 운영자 토큰(ADMIN_TOKEN)을 한 번 넣으면 짧은 세션 쿠키를 준다.
// - 토큰 비교는 sha256 끼리 상수 시간 (길이로도 새지 않게)
// - 틀린 시도는 같은 곳에서 15분 5번까지. 넘으면 맞는 토큰도 그 창 동안 받지 않는다
// - 서버 전체 합계(15분 20번)는 막지 않고 세기만 한다. 넘으면 로그에 경고를 한 번 남긴다 (여러 곳에서 틀려도 진짜 운영자가 막히지 않게)
// - 쿠키: __Host-, HttpOnly, Secure, SameSite=Strict, Path=/ (웹 화면과 /v1/admin/* 가 같이 쓴다), 30분. 세션은 메모리에만 (서버를 다시 켜면 다시 로그인)
// - 쓰기마다 세션의 CSRF 토큰을 폼에 숨겨 보내고 상수 시간으로 비교한다

/** __Host- 머리: Secure, Path=/, Domain 없음이 강제된다 (다른 하위 도메인이 덮어쓰지 못한다) */
export const ADMIN_COOKIE = '__Host-fairy_admin';
export const ADMIN_SESSION_MS = 30 * 60_000;
const MAX_SESSIONS = 20;

export interface AdminSession {
  /** 쿠키 값의 sha256 (기록의 "누가"는 앞 8자) */
  key: string;
  csrf: string;
  expires: number;
  /** 한 번 보이고 사라지는 안내 (쿠폰 코드처럼 주소에 두면 안 되는 것) */
  flash?: {
    text: string;
    error: boolean;
    /** 실패한 폼의 쓰기 이름과 대상 (features/mode 의 key, ai/revoke 의 계정 ...)과 쓴 값. 다시 그릴 때 칸을 채우고 오류를 그 폼 옆에 둔다 */
    form?: string;
    scope?: string;
    fields?: Record<string, string | string[]>;
    /** 미리보기에서 "고치기" 로 돌아온 것 (오류가 아니고 쓰던 값만 되살린다) */
    edit?: boolean;
    /** 결과 글과 함께 복사 단추로 보일 값 (쿠폰 원본 코드: 서버에는 해시만 있어 이 화면이 마지막이다) */
    copy?: string;
  };
  /**
   * 발행과 지급 흐름에서 작성을 마치고 대상 확인과 미리보기 단계에 있는 것 (쓰기 전). 새로 고쳐도 남고
   * 확정, 고치기, 30분 지남이 지운다
   */
  preview?: {
    action: 'grants/batch' | 'notices' | 'events' | 'coupons' | 'versions' | 'coins/revoke';
    fields: Record<string, string | string[]>;
    at: number;
    /** 이 미리보기를 확정하는 한 번만 쓰는 번호 (확정 폼이 싣고 오고, 쓰면 지운다) */
    nonce: string;
    /** 지급, 코인 회수 미리보기가 만들어질 때 찾은 받는 계정(남은 계정 번호, 겹침 없음). 확정 때 다시 찾은 결과와 같아야 보낸다 */
    ids?: string[];
    /** 미리보기 때 검사를 거친 지급 값(대상, 양, 사유, 만료)을 한 모양으로 만든 글. 확정 때 이것과 비교한다 */
    grant?: string;
    /** 미리보기 때 검사를 거친 값(공지, 이벤트, 쿠폰, 버전)을 한 모양으로 만든 글. 확정 때 통째 비교한다 */
    norm?: string;
    /** 미리보기 때 문서의 관련 부분 (공지는 같은 id 의 공지, 버전은 기준과 안내문). 확정이 잠근 문서와 비교한다 */
    base?: string;
  };
}

const hash = (s: string) => createHash('sha256').update(s).digest();

/** 같은 길이로 만든 뒤 상수 시간 비교 */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(hash(a), hash(b)) && a.length === b.length;
}

/** Cookie 머리에서 운영자 쿠키 값 */
export function readCookie(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === ADMIN_COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : undefined;
    }
  }
  return undefined;
}

export function sessionCookie(value: string): string {
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_MS / 1000}`;
}

export const clearCookie = (): string =>
  `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export type LoginOutcome =
  | { ok: true; cookie: string; session: AdminSession }
  | { ok: false; error: 'off' | 'rate_limited'; log?: undefined }
  /** log: 틀린 시도를 운영 기록에 한 줄 남길지 ('fail'), 많이 틀린 창의 요약 한 줄만 ('flood'), 남기지 않을지 ('none') */
  | { ok: false; error: 'bad_token'; log: 'fail' | 'flood' | 'none' };

/** 운영자 토큰이 약해 보이는 까닭 (값은 돌려주지 않는다). 간단한 추정이라 경고에만 쓴다 */
export function weakTokenReason(token: string): string | undefined {
  const chars = [...token];
  const uniq = new Set(chars);
  if (uniq.size < 10) return `서로 다른 글자가 ${uniq.size}종뿐이에요`;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(token)).length;
  if (classes < 2) return '글자 종류(소문자, 대문자, 숫자, 기호)가 한 가지뿐이에요';
  const counts = new Map<string, number>();
  for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= n * Math.log2(n / chars.length);
  if (bits < 100) return `글자 분포로 본 무작위성이 낮아요 (약 ${Math.round(bits)}비트)`;
  if (/(.)\1{5,}/u.test(token)) return '같은 글자가 여섯 번 넘게 이어져요';
  return undefined;
}

@Injectable()
export class AdminAuth implements OnModuleInit {
  #sessions = new Map<string, AdminSession>();
  #warnedAt = 0;
  readonly #log = new Logger('AdminAuth');

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly limiter: RateLimiter,
    private readonly now: () => number = Date.now,
  ) {}

  /** 서버를 켤 때 토큰이 약해 보이면 경고만 남긴다 (막지 않고, 토큰 값은 적지 않는다) */
  onModuleInit(): void {
    if (!this.enabled) return;
    const why = weakTokenReason(this.config.adminToken ?? '');
    if (why) this.#log.warn(`ADMIN_TOKEN 이 약해 보여요: ${why}. 길고 무작위인 값으로 바꾸는 걸 권해요`);
  }

  get enabled(): boolean {
    return adminEnabled(this.config);
  }

  login(token: unknown, ip: string): LoginOutcome {
    if (!this.enabled) return { ok: false, error: 'off' };
    const ipKey = `admin-fail:${ip}`;
    if (this.limiter.over(ipKey, LIMITS.adminFailByIp)) return { ok: false, error: 'rate_limited' };
    const given = typeof token === 'string' ? token.trim() : '';
    if (given.length > 200 || !sameSecret(given, this.config.adminToken ?? '')) {
      this.limiter.take(ipKey, LIMITS.adminFailByIp);
      const flooding = !this.limiter.take('admin-fail:all', LIMITS.adminFailAll);
      const log = flooding ? (this.warnFloods() ? 'flood' : 'none') : 'fail';
      return { ok: false, error: 'bad_token', log };
    }
    this.sweep();
    while (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
    const value = randomBytes(32).toString('base64url');
    const session: AdminSession = {
      key: hash(value).toString('hex'),
      csrf: randomBytes(32).toString('base64url'),
      expires: this.now() + ADMIN_SESSION_MS,
    };
    this.#sessions.set(session.key, session);
    return { ok: true, cookie: sessionCookie(value), session };
  }

  /** 서버 전체 틀린 로그인이 한도를 넘었다: 막지 않고 창마다 한 번 경고만 남긴다 (토큰과 주소는 적지 않는다) */
  private warnFloods(): boolean {
    const now = this.now();
    if (now - this.#warnedAt < LIMITS.adminFailAll.windowMs) return false;
    this.#warnedAt = now;
    this.#log.warn(
      `운영자 로그인 실패가 15분에 ${LIMITS.adminFailAll.max}번을 넘었어요 (여러 곳에서 토큰을 찍어 보는 중일 수 있어요). 곳마다 5번 한도는 그대로 지켜요`,
    );
    return true;
  }

  /** 쿠키로 세션을 찾는다. 끝났으면 지우고 undefined */
  session(cookieHeader: string | string[] | undefined): AdminSession | undefined {
    if (!this.enabled) return undefined;
    const v = readCookie(cookieHeader);
    if (!v) return undefined;
    const key = hash(v).toString('hex');
    const s = this.#sessions.get(key);
    if (!s) return undefined;
    if (s.expires <= this.now()) {
      this.#sessions.delete(key);
      return undefined;
    }
    return s;
  }

  csrfOk(s: AdminSession, given: unknown): boolean {
    return typeof given === 'string' && given.length < 100 && sameSecret(given, s.csrf);
  }

  logout(s: AdminSession): void {
    this.#sessions.delete(s.key);
  }

  private sweep() {
    const now = this.now();
    for (const [k, s] of this.#sessions) if (s.expires <= now) this.#sessions.delete(k);
  }
}

/** 기록에 남길 "누가" */
export const actorOf = (s: AdminSession | undefined): string => (s ? `admin:${s.key.slice(0, 8)}` : 'anon');
