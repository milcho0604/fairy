// 구글 캘린더에 쓰기: OAuth 2.0 (설치 앱, Authorization Code + PKCE S256, 루프백 주소)와 Calendar API 부르기.
// 일렉트론 없이 돌아가는 것만 둔다 (시험에서 fetch 를 바꿔 끼운다). 토큰과 코드는 기록에 남기지 않는다.
// 흐름: 127.0.0.1 의 아무 빈 포트에 잠깐 서버를 열고 → 시스템 브라우저로 구글 허락 화면 → 구글이 그 주소로 code 를 돌려준다
// → state 를 맞춰 보고 code + code_verifier 로 토큰을 받는다 → 서버를 닫는다.
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GCAL_SCOPE } from '../shared/gcal.ts';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const API_ROOT = 'https://www.googleapis.com/calendar/v3';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type RandomBytes = (n: number) => Uint8Array;

/** 네트워크 하나에 이만큼 넘으면 그만둔다 */
export const NET_TIMEOUT_MS = 20_000;
/** 브라우저에서 허락을 기다리는 시간 */
export const CONNECT_TIMEOUT_MS = 3 * 60_000;

// ---- 클라이언트 ----

/** 빌드할 때 넣는 값 (electron.vite.config.ts define, 빌드 환경 변수 JJ_GOOGLE_CLIENT_ID). 시험에서는 없다 */
declare const __JJ_GOOGLE_CLIENT_ID__: string | undefined;
declare const __JJ_GOOGLE_CLIENT_SECRET__: string | undefined;
const BUILT_ID = typeof __JJ_GOOGLE_CLIENT_ID__ === 'string' ? __JJ_GOOGLE_CLIENT_ID__ : '';
const BUILT_SECRET = typeof __JJ_GOOGLE_CLIENT_SECRET__ === 'string' ? __JJ_GOOGLE_CLIENT_SECRET__ : '';

export interface GoogleClient {
  id: string;
  /**
   * 데스크톱 앱 클라이언트의 "비밀". 설치 앱에 들어가 누구나 꺼낼 수 있어 구글도 비밀로 보지 않는다
   * (PKCE 가 code 가로채기를 막는다). 구글 토큰 주소가 데스크톱 클라이언트에는 이 값을 요구해서 같이 보낸다
   */
  secret: string;
}

/** 클라이언트 id 모양: 숫자-글자.apps.googleusercontent.com */
export const isClientId = (v: string): boolean => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v);

/**
 * 쓸 클라이언트. 실행할 때 환경 변수(JJ_GOOGLE_CLIENT_ID, JJ_GOOGLE_CLIENT_SECRET)가 빌드에 넣은 값보다 먼저다.
 * 없거나 모양이 틀리면 undefined: 설정 창은 연결 단추 대신 안내만 보인다
 */
export function googleClient(
  env: Record<string, string | undefined> = process.env,
  built: { id: string; secret: string } = { id: BUILT_ID, secret: BUILT_SECRET },
): GoogleClient | undefined {
  const fromEnv = env.JJ_GOOGLE_CLIENT_ID?.trim();
  const id = fromEnv || built.id.trim();
  if (!id || !isClientId(id)) return undefined;
  const secret = (fromEnv ? env.JJ_GOOGLE_CLIENT_SECRET : built.secret)?.trim() ?? '';
  return { id, secret };
}

// ---- PKCE, state ----

export const base64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

/** code_challenge = BASE64URL(SHA256(code_verifier)) (RFC 7636 S256) */
export const challengeOf = (verifier: string): string =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url');

/** code_verifier 는 32 바이트 무작위 → 43자 (RFC 7636: 43~128자, 글자는 A-Z a-z 0-9 - . _ ~) */
export function makePkce(random: RandomBytes = nodeRandomBytes): { verifier: string; challenge: string } {
  const verifier = base64url(random(32));
  return { verifier, challenge: challengeOf(verifier) };
}

export const isVerifier = (v: string): boolean => /^[A-Za-z0-9\-._~]{43,128}$/.test(v);

export const newState = (random: RandomBytes = nodeRandomBytes): string => base64url(random(24));

/** 시간이 새지 않게 맞춰 본다 */
export function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** 구글 허락 화면 주소 */
export function authUrl(o: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GCAL_SCOPE,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    // 새로 받는 토큰(refresh token)이 있어야 앱을 다시 켜도 이어진다. prompt=consent 라야 다시 연결할 때도 준다
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${q}`;
}

// ---- 돌아온 주소 ----

export type RedirectResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string }
  /** state 가 틀림 (다른 곳에서 온 요청): 받지 않고 기다린다 */
  | { kind: 'badState' }
  /** 우리 것이 아님 (favicon 등) */
  | { kind: 'ignore' };

/** 루프백 서버로 온 요청 주소 (경로와 물음표 뒤) 읽기 */
export function parseRedirect(
  method: string | undefined,
  rawUrl: string | undefined,
  state: string,
): RedirectResult {
  if (method !== 'GET' || !rawUrl) return { kind: 'ignore' };
  let u: URL;
  try {
    u = new URL(rawUrl, 'http://127.0.0.1');
  } catch {
    return { kind: 'ignore' };
  }
  if (u.pathname !== '/') return { kind: 'ignore' };
  const got = u.searchParams.get('state');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (!got && !code && !error) return { kind: 'ignore' };
  if (!got || !sameState(got, state)) return { kind: 'badState' };
  if (error) return { kind: 'error', error: error.slice(0, 64) };
  if (!code || code.length > 2048) return { kind: 'error', error: 'no_code' };
  return { kind: 'code', code };
}

// ---- 토큰 ----

export interface Tokens {
  accessToken: string;
  /** 이때부터는 새로 받는다 (만료 1분 전) */
  expiresAt: number;
  /** 처음 받을 때만 온다. 새로 받을 때는 대개 없다 */
  refreshToken?: string;
  /** 허락받은 권한에 캘린더 일정이 있는지 (허락 화면에서 체크를 풀 수 있다) */
  scopeOk: boolean;
}

export type TokenResult =
  | { ok: true; tokens: Tokens }
  /** invalid_grant: 연결이 끝남 (거둠, 만료). 그 밖은 error 글 */
  | { ok: false; error: string; status: number };

/** 토큰 주소의 대답 읽기 */
export function parseTokenResponse(status: number, json: unknown, now: number): TokenResult {
  const j = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  if (status < 200 || status >= 300 || typeof j.error === 'string') {
    const error = typeof j.error === 'string' ? j.error.slice(0, 64) : `http_${status}`;
    return { ok: false, error, status };
  }
  const access = j.access_token;
  if (typeof access !== 'string' || !access || access.length > 4096)
    return { ok: false, error: 'no_access_token', status };
  const expiresIn = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 3600;
  const scope = typeof j.scope === 'string' ? j.scope.split(/\s+/) : [];
  const refresh = j.refresh_token;
  return {
    ok: true,
    tokens: {
      accessToken: access,
      expiresAt: now + Math.max(0, expiresIn - 60) * 1000,
      ...(typeof refresh === 'string' && refresh && refresh.length <= 4096 ? { refreshToken: refresh } : {}),
      // scope 가 없으면 구글이 요청한 그대로 준 것
      scopeOk: scope.length === 0 || scope.includes(GCAL_SCOPE),
    },
  };
}

async function timed<T>(
  f: FetchLike,
  url: string,
  init: RequestInit,
  use: (r: Response) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NET_TIMEOUT_MS);
  try {
    const res = await f(url, { ...init, signal: ac.signal });
    return await use(res);
  } finally {
    clearTimeout(timer);
  }
}

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: new URLSearchParams(o).toString(),
});

const readJson = async (r: Response): Promise<unknown> => {
  const text = await r.text();
  if (text.length > 1_000_000) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** code 를 토큰으로 바꾼다. 네트워크가 안 되면 던진다 */
export function exchangeCode(
  f: FetchLike,
  o: { client: GoogleClient; code: string; verifier: string; redirectUri: string; now: () => number },
): Promise<TokenResult> {
  return timed(
    f,
    TOKEN_URL,
    form({
      client_id: o.client.id,
      ...(o.client.secret ? { client_secret: o.client.secret } : {}),
      code: o.code,
      code_verifier: o.verifier,
      grant_type: 'authorization_code',
      redirect_uri: o.redirectUri,
    }),
    async (r) => parseTokenResponse(r.status, await readJson(r), o.now()),
  );
}

/** 새 access token. invalid_grant 면 연결이 끝난 것 */
export function refreshAccess(
  f: FetchLike,
  o: { client: GoogleClient; refreshToken: string; now: () => number },
): Promise<TokenResult> {
  return timed(
    f,
    TOKEN_URL,
    form({
      client_id: o.client.id,
      ...(o.client.secret ? { client_secret: o.client.secret } : {}),
      grant_type: 'refresh_token',
      refresh_token: o.refreshToken,
    }),
    async (r) => parseTokenResponse(r.status, await readJson(r), o.now()),
  );
}

/** 연결 끊기: 구글에서도 권한을 거둔다. 이미 끝난 토큰(400)도 끊긴 것으로 본다 */
export function revokeToken(f: FetchLike, token: string): Promise<boolean> {
  return timed(f, REVOKE_URL, form({ token }), async (r) => r.ok || r.status === 400);
}

// ---- Calendar API ----

/**
 * API 대답의 뜻
 * - ok, notFound(404, 410: 그 일정이나 캘린더가 없음), conflict(409: 그 id 가 이미 있음)
 * - auth(401: 토큰을 새로 받아 한 번 더), scope(403 권한 부족), forbidden(403: 그 캘린더에 못 씀)
 * - retry(429, 403 사용량 초과, 5xx: 기다렸다 다시), bad(400 등: 이 일정은 받지 않는다)
 */
export type ApiKind = 'ok' | 'notFound' | 'conflict' | 'auth' | 'scope' | 'forbidden' | 'retry' | 'bad';

export function classifyApi(status: number, json: unknown): ApiKind {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404 || status === 410) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 401) return 'auth';
  if (status === 429 || status >= 500) return 'retry';
  if (status === 403) {
    const err = (json as { error?: { errors?: { reason?: unknown }[]; status?: unknown } } | undefined)
      ?.error;
    const reasons = (err?.errors ?? []).map((e) => String(e?.reason ?? ''));
    if (reasons.some((r) => /rateLimit|quotaExceeded/i.test(r))) return 'retry';
    if (reasons.includes('insufficientPermissions')) return 'scope';
    return 'forbidden';
  }
  return 'bad';
}

export interface ApiResult {
  kind: ApiKind;
  status: number;
  json: unknown;
}

/** Calendar API 한 번 부르기. 네트워크가 안 되면 던진다 */
export function callApi(
  f: FetchLike,
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  return timed(
    f,
    `${API_ROOT}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    async (r) => {
      const json = r.status === 204 ? undefined : await readJson(r);
      return { kind: classifyApi(r.status, json), status: r.status, json };
    },
  );
}

// ---- 루프백 서버 ----

export type LoopbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

/**
 * 127.0.0.1 의 빈 포트에 잠깐 서버를 연다. 맞는 state 로 code 나 error 가 오면 끝나고 서버를 닫는다.
 * 시간이 지나거나 cancel 해도 닫는다. page 는 브라우저에 보일 글 (토큰, code 는 넣지 않는다)
 */
export async function startLoopback(o: {
  state: string;
  timeoutMs?: number;
  page: (ok: boolean) => { title: string; body: string };
}): Promise<{ redirectUri: string; result: Promise<LoopbackResult>; cancel: () => void }> {
  let finish: (r: LoopbackResult) => void = () => {};
  const result = new Promise<LoopbackResult>((resolve) => {
    finish = resolve;
  });
  let done = false;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = done ? ({ kind: 'ignore' } as const) : parseRedirect(req.method, req.url, o.state);
    if (r.kind === 'ignore' || r.kind === 'badState') {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      });
      res.end('');
      return;
    }
    const ok = r.kind === 'code';
    const p = o.page(ok);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      connection: 'close',
    });
    res.end(pageHtml(p.title, p.body));
    end(r.kind === 'code' ? { kind: 'code', code: r.code } : { kind: 'error', error: r.error });
  });
  const end = (r: LoopbackResult) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    finish(r);
    // 대답을 다 보낸 뒤 닫는다
    server.close();
    setTimeout(() => server.closeAllConnections?.(), 1000).unref();
  };
  const timer = setTimeout(() => end({ kind: 'timeout' }), o.timeoutMs ?? CONNECT_TIMEOUT_MS);
  timer.unref?.();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return { redirectUri: `http://127.0.0.1:${port}`, result, cancel: () => end({ kind: 'cancelled' }) };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function pageHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1.25rem;color:#18181b;background:#fafaf9}h1{font-size:1.25rem}p{color:#52525b;line-height:1.5}@media(prefers-color-scheme:dark){body{background:#09090b;color:#f4f4f5}p{color:#a1a1aa}}</style></head><body><h1>${esc(title)}</h1><p>${esc(body)}</p></body></html>`;
}
