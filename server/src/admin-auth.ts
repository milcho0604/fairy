import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from './app.tokens';
import { adminEnabled, type Config } from './config';
import { LIMITS, RateLimiter } from './rate-limit';

// 운영자 로그인 (기획서 10절, 이슈 #101). 브라우저에서 운영자 토큰(ADMIN_TOKEN)을 한 번 넣으면 짧은 세션 쿠키를 준다.
// - 토큰 비교는 sha256 끼리 상수 시간 (길이로도 새지 않게)
// - 틀린 시도는 같은 곳에서 15분 5번, 서버 전체 15분 20번까지. 넘으면 맞는 토큰도 그 창 동안 받지 않는다
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
  flash?: { text: string; error: boolean };
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
  | { ok: false; error: 'off' | 'rate_limited' | 'bad_token' };

@Injectable()
export class AdminAuth {
  #sessions = new Map<string, AdminSession>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly limiter: RateLimiter,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return adminEnabled(this.config);
  }

  login(token: unknown, ip: string): LoginOutcome {
    if (!this.enabled) return { ok: false, error: 'off' };
    const ipKey = `admin-fail:${ip}`;
    if (
      this.limiter.over(ipKey, LIMITS.adminFailByIp) ||
      this.limiter.over('admin-fail:all', LIMITS.adminFailAll)
    )
      return { ok: false, error: 'rate_limited' };
    const given = typeof token === 'string' ? token.trim() : '';
    if (given.length > 200 || !sameSecret(given, this.config.adminToken ?? '')) {
      this.limiter.take(ipKey, LIMITS.adminFailByIp);
      this.limiter.take('admin-fail:all', LIMITS.adminFailAll);
      return { ok: false, error: 'bad_token' };
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
