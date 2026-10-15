import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Accounts, type Items, type LockedAccount, lockAccount } from './accounts';
import { CONFIG, GOOGLE_API } from './app.tokens';
import type { Config } from './config';
import { Db } from './db';
import { GOOGLE_AUTH_URL, type GoogleApi, verifyIdToken } from './google';
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
  service: 'google';
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
  | { kind: 'session'; token: string; accountId: string; merged: boolean; linked: boolean }
  | { kind: 'confirm'; code: string; current: Summary; other: Summary }
  | { kind: 'error'; error: 'code' | 'verifier' };

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
  ) {}

  get redirectUri(): string {
    return `${this.config.publicUrl}/auth/google/callback`;
  }

  /** 대기 로그인 수 (시험용) */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** 구글 로그인 주소. 같은 곳의 대기 로그인이 PENDING_PER_IP 에 차면 undefined (429) */
  start(port: number, appState: string, challenge: string, ip: string, now = Date.now()): string | undefined {
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
    this.#pending.set(state, { port, appState, verifier, nonce, challenge, ip, exp: now + PENDING_MS });
    this.#perIp.set(ip, (this.#perIp.get(ip) ?? 0) + 1);
    const u = new URL(GOOGLE_AUTH_URL);
    u.searchParams.set('client_id', this.config.googleClientId);
    u.searchParams.set('redirect_uri', this.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid');
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('prompt', 'select_account');
    return u.toString();
  }

  /** 대기 중인 로그인을 꺼낸다 (한 번만) */
  takePending(state: unknown, now = Date.now()): Pending | undefined {
    if (typeof state !== 'string') return undefined;
    const p = this.#pending.get(state);
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
  async finish(p: Pending, googleCode: string, now = Date.now()): Promise<string> {
    const idToken = await this.google.exchangeCode({
      code: googleCode,
      codeVerifier: p.verifier,
      redirectUri: this.redirectUri,
      clientId: this.config.googleClientId,
      clientSecret: this.config.googleClientSecret,
    });
    const sub = await verifyIdToken(idToken, {
      clientId: this.config.googleClientId,
      nonce: p.nonce,
      jwks: (refresh) => this.google.fetchJwks(refresh ? { refresh: true } : undefined),
      now,
    });
    return this.issueCode(sub, p.challenge, CODE_MS, now);
  }

  private issueCode(sub: string, challenge: string, ttl: number, now: number): string {
    this.prune(now);
    const code = randomId();
    this.#codes.set(codeKey(code), { service: 'google', sub, challenge, exp: now + ttl });
    return code;
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
  ): Promise<SessionOutcome> {
    const c = this.takeCode(code, now);
    if (!c) return { kind: 'error', error: 'code' };
    if (!verifierMatches(verifier, c.challenge)) return { kind: 'error', error: 'verifier' };
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
    if (out.kind === 'confirm') return { ...out, code: this.issueCode(c.sub, c.challenge, CONFIRM_MS, now) };
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
        await this.accounts.merge(tx, me, other);
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
        await this.accounts.merge(tx, other, me);
        merged = true;
      }
    }
    await tx.query('INSERT INTO session (account_id, token_hash) VALUES ($1, $2)', [survivor, sha256(token)]);
    return { kind: 'session', token, accountId: survivor, merged, linked };
  }

  private prune(now: number) {
    for (const [k, p] of this.#pending) if (p.exp <= now) this.drop(k);
    for (const [k, c] of this.#codes) if (c.exp <= now) this.#codes.delete(k);
  }
}

// 코드는 메모리에도 해시로만 둔다
const codeKey = (code: string) => createHash('sha256').update(code).digest('base64url');
