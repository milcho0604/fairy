import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Accounts, type Items, type LockedAccount, lockAccount } from './accounts';
import { CONFIG, GOOGLE_API, KAKAO_API } from './app.tokens';
import { type Config, DEFAULT_KAKAO_AUTH_URL } from './config';
import { Db } from './db';
import { Features } from './features';
import { GOOGLE_AUTH_URL, type GoogleApi, verifyIdToken } from './google';
import { type KakaoApi, kakaoAuthorizeUrl, kakaoIssuers } from './kakao';
import { newToken, randomId, sha256 } from './tokens';

// 로그인 흐름 (기획서 5절, 21절).
// 1. 앱이 verifier 를 만들어 두고 /auth/google/start?port=&state=&challenge=<sha256(verifier)> 를 브라우저로 연다
//    → 서버가 구글로 보낸다 (서버와 구글 사이에도 PKCE, nonce)
// 2. 구글이 /auth/google/callback 으로 돌려보낸다 → 코드 교환, id_token 검증, sub 확인
// 3. 서버가 http://127.0.0.1:<port>/done?code=<일회용 코드>&state=<앱 state> 로 보낸다
// 4. 앱이 POST /v1/session 에 일회용 코드(1분, 한 번), verifier, 기기 토큰을 보내 세션을 받는다.
//    같은 컴퓨터의 다른 프로그램이 루프백에서 코드를 가로채도 verifier 가 없으면 쓰지 못한다(로컬 PKCE).
//    이때 계정을 붙이거나 합친다.
// 대기 중인 로그인과 일회용 코드는 메모리에만 둔다 (서버가 다시 뜨면 로그인을 다시 하면 된다).
// 카카오(6단계, #102)도 같은 흐름이다: /auth/kakao/start → 카카오 → /auth/kakao/callback → 루프백 → POST /v1/session.
// 카카오는 기능 키 kakao_login 을 따른다 (features.ts). allowlist 면 이미 로그인한 허용 계정이 POST /v1/auth/kakao/begin
// (세션 Bearer) 으로 연 로그인만 받고, 일회용 코드도 그 계정의 세션으로만 바꾼다.

export type LoginService = 'google' | 'kakao';
export const isLoginService = (v: unknown): v is LoginService => v === 'google' || v === 'kakao';

/** 앱이 여는 루프백 포트 범위. 1024 미만(특권 포트)은 받지 않는다 */
export const PORT_MIN = 1024;
export const PORT_MAX = 65535;
const APP_STATE = /^[A-Za-z0-9_-]{8,128}$/;
/** base64url(sha256(verifier)) 은 43자 */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 의 code_verifier 모양 */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** 구글 로그인 화면에 머무를 수 있는 시간 */
const PENDING_MS = 10 * 60_000;
/** 일회용 코드 (기획서: 1분, 한 번) */
export const CODE_MS = 60_000;
/** 합치기 확인을 기다리는 코드. 사람이 두 계정을 보고 고를 시간 */
export const CONFIRM_MS = 10 * 60_000;
/** 대기 로그인 전체 수. 차면 가장 오래된 것을 밀어낸다 */
export const MAX_PENDING = 10_000;
/** 한 곳(cf-connecting-ip)에서 동시에 열어 둘 수 있는 대기 로그인 수 */
export const PENDING_PER_IP = 20;

interface Pending {
  service: LoginService;
  /** allowlist 로 연 로그인의 계정 (그 계정 세션으로만 바꾼다). 그 밖은 null */
  accountId: string | null;
  port: number;
  appState: string;
  verifier: string;
  nonce: string;
  /** 앱의 로컬 PKCE */
  challenge: string;
  ip: string;
  exp: number;
}

interface Code {
  service: LoginService;
  accountId: string | null;
  sub: string;
  challenge: string;
  exp: number;
}

export function parsePort(v: unknown): number | undefined {
  if (typeof v !== 'string' || !/^\d{1,5}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= PORT_MIN && n <= PORT_MAX ? n : undefined;
}

export const parseAppState = (v: unknown): string | undefined =>
  typeof v === 'string' && APP_STATE.test(v) ? v : undefined;

export const parseChallenge = (v: unknown): string | undefined =>
  typeof v === 'string' && CHALLENGE.test(v) ? v : undefined;

/** verifier 의 sha256 이 challenge 와 같은지 (상수 시간 비교) */
export function verifierMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 돌려보낼 곳은 언제나 127.0.0.1 의 /done 이다. 호스트와 경로를 받지 않아 다른 곳으로 보낼 수 없다 */
export function doneUrl(port: number, params: Record<string, string>): string {
  const u = new URL(`http://127.0.0.1:${port}/done`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export type SessionOutcome =
  | {
      kind: 'session';
      token: string;
      accountId: string;
      merged: boolean;
      linked: boolean;
      /** 남는 계정에 붙은 로그인 서비스 */
      logins: LoginService[];
      /** 합치며 최근 2개 밖으로 빠진 서버 백업 파일 (커밋 뒤 바로 지운다) */
      dropped: string[];
    }
  | { kind: 'confirm'; code: string; current: Summary; other: Summary }
  | { kind: 'error'; error: 'code' | 'verifier' }
  | { kind: 'denied'; status: 403 | 503; error: 'feature_off' | 'login' };

export type KakaoGate =
  | { ok: true; accountId: string | null }
  | { ok: false; status: 403 | 503; error: 'feature_off' | 'login' };

type Summary = { balance: number; items: Items };

/** 잠근 뒤 보니 로그인 주인이 바뀌었다: 트랜잭션을 처음부터 다시 */
class Retry extends Error {}
const RETRIES = 5;

@Injectable()
export class Login {
  #pending = new Map<string, Pending>();
  #perIp = new Map<string, number>();
  #codes = new Map<string, Code>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(GOOGLE_API) private readonly google: GoogleApi,
    private readonly db: Db,
    private readonly accounts: Accounts,
    @Optional() @Inject(KAKAO_API) private readonly kakao?: KakaoApi,
    @Optional() private readonly features?: Features,
  ) {}

  get redirectUri(): string {
    return this.redirectFor('google');
  }

  /** 서비스마다 고정 돌아오는 주소 (카카오는 등록 값과 완전히 같아야 한다, KOE006) */
  redirectFor(service: LoginService): string {
    return `${this.config.publicUrl}/auth/${service}/callback`;
  }

  private get kakaoBase(): string {
    return this.config.kakaoAuthUrl ?? DEFAULT_KAKAO_AUTH_URL;
  }

  /** 대기 로그인 수 (시험용) */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** 구글 로그인 주소. 같은 곳의 대기 로그인이 PENDING_PER_IP 에 차면 undefined (429) */
  start(port: number, appState: string, challenge: string, ip: string, now = Date.now()): string | undefined {
    return this.startWith('google', null, port, appState, challenge, ip, now);
  }

  /** 서비스를 골라 로그인 주소를 만든다. accountId 는 allowlist 로 연 로그인의 계정 */
  startWith(
    service: LoginService,
    accountId: string | null,
    port: number,
    appState: string,
    challenge: string,
    ip: string,
    now = Date.now(),
  ): string | undefined {
    this.prune(now);
    if ((this.#perIp.get(ip) ?? 0) >= PENDING_PER_IP) return undefined;
    // 다 차면 가장 오래된 것부터 밀어낸다 (Map 은 넣은 순서를 지킨다)
    while (this.#pending.size >= MAX_PENDING) {
      const oldest = this.#pending.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    const state = randomId();
    const verifier = randomId(48);
    const nonce = randomId();
    this.#pending.set(state, {
      service,
      accountId,
      port,
      appState,
      verifier,
      nonce,
      challenge,
      ip,
      exp: now + PENDING_MS,
    });
    this.#perIp.set(ip, (this.#perIp.get(ip) ?? 0) + 1);
    const google = service === 'google';
    const u = new URL(google ? GOOGLE_AUTH_URL : kakaoAuthorizeUrl(this.kakaoBase));
    u.searchParams.set(
      'client_id',
      google ? this.config.googleClientId : (this.config.kakaoRestApiKey ?? ''),
    );
    u.searchParams.set('redirect_uri', this.redirectFor(service));
    u.searchParams.set('response_type', 'code');
    // 둘 다 openid 만 (이메일, 이름, 프로필은 받지 않는다)
    u.searchParams.set('scope', 'openid');
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    u.searchParams.set('code_challenge_method', 'S256');
    if (google) u.searchParams.set('prompt', 'select_account');
    return u.toString();
  }

  /** 대기 중인 로그인을 꺼낸다 (한 번만) */
  takePending(state: unknown, now = Date.now(), service: LoginService = 'google'): Pending | undefined {
    if (typeof state !== 'string') return undefined;
    const p = this.#pending.get(state);
    // 다른 서비스의 돌아오는 곳으로 온 state 는 받지 않는다 (지우지도 않는다)
    if (p && p.service !== service) return undefined;
    if (p) this.drop(state);
    return p && p.exp > now ? p : undefined;
  }

  private drop(state: string) {
    const p = this.#pending.get(state);
    if (!p) return;
    this.#pending.delete(state);
    const n = (this.#perIp.get(p.ip) ?? 1) - 1;
    if (n > 0) this.#perIp.set(p.ip, n);
    else this.#perIp.delete(p.ip);
  }

  /** 구글 코드를 sub 로 바꾸고 앱에 줄 일회용 코드를 만든다 */
  async finish(p: Pending, providerCode: string, now = Date.now()): Promise<string> {
    const google = p.service === 'google';
    const api: GoogleApi | KakaoApi | undefined = google ? this.google : this.kakao;
    if (!api) throw new Error(`${p.service} 연결이 없다`);
    const clientId = google ? this.config.googleClientId : (this.config.kakaoRestApiKey ?? '');
    const idToken = await api.exchangeCode({
      code: providerCode,
      codeVerifier: p.verifier,
      redirectUri: this.redirectFor(p.service),
      clientId,
      clientSecret: google ? this.config.googleClientSecret : (this.config.kakaoClientSecret ?? ''),
    });
    const sub = await verifyIdToken(idToken, {
      clientId,
      nonce: p.nonce,
      jwks: (refresh) => api.fetchJwks(refresh ? { refresh: true } : undefined),
      now,
      ...(google ? {} : { issuers: kakaoIssuers(this.kakaoBase) }),
    });
    return this.issueCode(
      { service: p.service, accountId: p.accountId, sub, challenge: p.challenge },
      CODE_MS,
      now,
    );
  }

  private issueCode(c: Omit<Code, 'exp'>, ttl: number, now: number): string {
    this.prune(now);
    const code = randomId();
    this.#codes.set(codeKey(code), { ...c, exp: now + ttl });
    return code;
  }

  /**
   * 카카오 기능 키 확인 (#102). off 면 503, everyone 이면 누구나.
   * allowlist 면 세션(이미 로그인)이고 그 계정이 허용됐고, 로그인을 연 계정과 같아야 한다
   */
  async kakaoGate(
    auth: { accountId: string; via: 'device' | 'session' } | null,
    boundAccount?: string | null,
  ): Promise<KakaoGate> {
    const mode = (await this.features?.featureMode('kakao_login')) ?? 'off';
    if (mode === 'off') return { ok: false, status: 503, error: 'feature_off' };
    if (mode === 'everyone') return { ok: true, accountId: null };
    if (auth?.via !== 'session') return { ok: false, status: 403, error: 'login' };
    if (!(await this.features?.featureAllowed('kakao_login', auth.accountId)))
      return { ok: false, status: 403, error: 'feature_off' };
    if (boundAccount !== undefined && boundAccount !== null && boundAccount !== auth.accountId)
      return { ok: false, status: 403, error: 'login' };
    return { ok: true, accountId: auth.accountId };
  }

  /** 일회용 코드를 꺼낸다 (맞든 틀리든 한 번 쓰면 없어진다) */
  private takeCode(code: unknown, now: number): Code | undefined {
    if (typeof code !== 'string' || code.length > 128) return undefined;
    const k = codeKey(code);
    const c = this.#codes.get(k);
    this.#codes.delete(k);
    return c && c.exp > now ? c : undefined;
  }

  /**
   * 일회용 코드를 세션으로 바꾼다. verifier 가 start 때의 challenge 와 맞아야 하고, 틀리면 코드도 버린다.
   * 지금 계정(토큰의 계정)과 로그인 계정을 21절대로 잇는다.
   * - 지금 계정에 로그인이 없다(기기 계정):
   *   - 처음 보는 로그인이면 지금 계정에 붙인다
   *   - 이미 있는 계정의 로그인이면 묻지 않고 지금 계정을 그 계정에 합친다 (남는 쪽: 로그인한 계정)
   * - 지금 계정에 이미 로그인이 있다:
   *   - 같은 계정이면 세션만 새로
   *   - 처음 보는 로그인이면 지금 계정에 하나 더 붙인다 (다른 서비스 연결과 같다)
   *   - 다른 계정의 로그인이면 두 계정을 보여 주고 묻는다(409 + 확인 코드). merge=true 로 다시 오면 그 계정을 지금 계정에 합친다
   */
  async exchange(
    code: unknown,
    verifier: unknown,
    accountId: string,
    merge: boolean,
    now = Date.now(),
    via: 'device' | 'session' = 'device',
  ): Promise<SessionOutcome> {
    const c = this.takeCode(code, now);
    if (!c) return { kind: 'error', error: 'code' };
    if (!verifierMatches(verifier, c.challenge)) return { kind: 'error', error: 'verifier' };
    if (c.service === 'kakao') {
      // 기능 키가 그사이 꺼졌거나, allowlist 로 연 로그인을 다른 계정(또는 기기 토큰)이 바꾸려 한다
      const g = await this.kakaoGate({ accountId, via }, c.accountId);
      if (!g.ok) return { kind: 'denied', status: g.status, error: g.error };
    }
    const token = newToken('session');
    let out: SessionOutcome | undefined;
    for (let i = 0; i < RETRIES && !out; i++) {
      try {
        out = await this.db.tx((tx) => this.link(tx, c, accountId, merge, token));
      } catch (err) {
        // Retry: 로그인 주인이 바뀌었다. 40P01: 그래도 교착이 나면(합치기 사슬) 다시
        if (!(err instanceof Retry) && (err as { code?: string }).code !== '40P01') throw err;
      }
    }
    if (!out) throw new Error('로그인 연결을 여러 번 다시 해도 끝나지 않았다');
    // 확인을 기다리는 동안 같은 로그인으로 다시 올 수 있게 새 코드를 준다 (처음 코드는 이미 썼다)
    if (out.kind === 'confirm')
      return {
        ...out,
        code: this.issueCode(
          { service: c.service, accountId: c.accountId, sub: c.sub, challenge: c.challenge },
          CONFIRM_MS,
          now,
        ),
      };
    return out;
  }

  /**
   * 한 트랜잭션 안의 연결. 로그인 주인을 먼저 읽고, 지금 계정과 그 주인을 처음부터 번호 순으로 잠근다
   * (한쪽을 잠근 채 다른 쪽을 기다리면 서로 반대로 합칠 때 교착이 난다). 잠근 뒤 주인이 바뀌었으면 다시.
   */
  private async link(
    tx: PoolClient,
    c: Code,
    accountId: string,
    merge: boolean,
    token: string,
  ): Promise<SessionOutcome> {
    const ownerOf = async () =>
      (
        await tx.query<{ account_id: string }>(
          'SELECT account_id FROM login WHERE service = $1 AND sub = $2',
          [c.service, c.sub],
        )
      ).rows[0]?.account_id;
    const before = await ownerOf();
    let me: LockedAccount;
    let other: LockedAccount | undefined;
    if (before === undefined) me = await lockAccount(tx, accountId);
    else [me, other] = await this.accounts.lockPair(tx, accountId, before);
    if ((await ownerOf()) !== other?.id) throw new Retry();

    const myLogins = Number(
      (await tx.query<{ n: string }>('SELECT count(*) AS n FROM login WHERE account_id = $1', [me.id]))
        .rows[0]?.n ?? 0,
    );
    let survivor = me.id;
    let merged = false;
    let linked = false;
    const dropped: string[] = [];
    if (!other) {
      const ins = await tx.query(
        'INSERT INTO login (service, sub, account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING sub',
        [c.service, c.sub, me.id],
      );
      // 다른 기기가 같은 sub 를 막 붙였다: 다시 읽어 합치기로
      if (ins.rowCount === 0) throw new Retry();
      linked = true;
    } else if (other.id !== me.id) {
      if (myLogins === 0) {
        await this.accounts.merge(tx, me, other, dropped);
        survivor = other.id;
        merged = true;
      } else if (!merge) {
        return {
          kind: 'confirm',
          code: '',
          current: await this.accounts.summary(tx, me.id),
          other: await this.accounts.summary(tx, other.id),
        };
      } else {
        await this.accounts.merge(tx, other, me, dropped);
        merged = true;
      }
    }
    await tx.query('INSERT INTO session (account_id, token_hash) VALUES ($1, $2)', [survivor, sha256(token)]);
    const logins = (
      await tx.query<{ service: string }>(
        'SELECT DISTINCT service FROM login WHERE account_id = $1 ORDER BY service',
        [survivor],
      )
    ).rows
      .map((r) => r.service)
      .filter(isLoginService);
    return { kind: 'session', token, accountId: survivor, merged, linked, logins, dropped };
  }

  private prune(now: number) {
    for (const [k, p] of this.#pending) if (p.exp <= now) this.drop(k);
    for (const [k, c] of this.#codes) if (c.exp <= now) this.#codes.delete(k);
  }
}

// 코드는 메모리에도 해시로만 둔다
const codeKey = (code: string) => createHash('sha256').update(code).digest('base64url');
