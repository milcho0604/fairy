import { createPublicKey, type JsonWebKey, verify } from 'node:crypto';

// 구글 로그인 (기획서 5절). scope 는 openid 만이라 id_token 에서 sub 하나만 쓴다(이메일, 이름은 받지 않는다).
// 구글을 부르는 두 곳(코드 교환, 공개 키 받기)은 GoogleApi 로 묶어 시험에서 가짜로 바꾼다.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** 시계 차이 허용 (초) */
const SKEW_SEC = 60;

export interface GoogleApi {
  /** 인가 코드를 토큰으로 바꿔 id_token 을 돌려준다 (클라이언트 비밀은 서버에만) */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<string>;
  /** 구글 공개 키 (JWKS). refresh 면 담아 둔 것을 버리고 다시 받는다 (최소 간격은 구현이 지킨다) */
  fetchJwks(o?: { refresh?: boolean }): Promise<JsonWebKey[]>;
}

/** 다시 받기의 최소 간격: kid 를 못 찾는 토큰을 마구 보내 구글을 두드리지 못하게 */
export const JWKS_REFRESH_MIN_MS = 60_000;

/** 진짜 구글. 공개 키는 한 시간 담아 두고, 구글이 키를 바꿨으면(kid 없음) 1분에 한 번까지 다시 받는다 */
export function realGoogleApi(): GoogleApi {
  let cache: { at: number; keys: JsonWebKey[] } | undefined;
  return {
    async exchangeCode({ code, codeVerifier, redirectUri, clientId, clientSecret }) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`구글 토큰 교환 ${res.status}`);
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') throw new Error('구글 응답에 id_token 이 없다');
      return body.id_token;
    },
    async fetchJwks(o) {
      const age = cache ? Date.now() - cache.at : Number.POSITIVE_INFINITY;
      if (cache && (o?.refresh ? age < JWKS_REFRESH_MIN_MS : age < 3_600_000)) return cache.keys;
      const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`구글 공개 키 ${res.status}`);
      const body = (await res.json()) as { keys?: JsonWebKey[] };
      cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
      return cache.keys;
    },
  };
}

/**
 * id_token 을 검증하고 sub 를 돌려준다. 서명(RS256, 구글 JWKS 의 kid), aud=클라이언트 번호, iss, exp, nonce 를 본다.
 * kid 가 담아 둔 키에 없으면 구글이 키를 바꾼 것일 수 있어 한 번 다시 받는다. 하나라도 틀리면 던진다.
 */
export async function verifyIdToken(
  idToken: string,
  o: {
    clientId: string;
    nonce: string;
    jwks: (refresh?: boolean) => Promise<JsonWebKey[]>;
    now?: number;
    /** 받는 iss. 비우면 구글 (카카오는 kakao.ts 가 넘긴다) */
    issuers?: ReadonlySet<string>;
  },
): Promise<string> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token 모양');
  const [h, p, s] = parts as [string, string, string];
  const header = parseJson(h) as { alg?: unknown; kid?: unknown };
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('id_token 머리');
  const byKid = (keys: JsonWebKey[]) => keys.find((k) => (k as { kid?: unknown }).kid === header.kid);
  const jwk = byKid(await o.jwks()) ?? byKid(await o.jwks(true));
  if (!jwk) throw new Error('id_token 키를 찾지 못했다');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('id_token 서명');
  const claims = parseJson(p) as Record<string, unknown>;
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const aud = claims.aud;
  if (!(aud === o.clientId || (Array.isArray(aud) && aud.includes(o.clientId))))
    throw new Error('id_token aud');
  if (typeof claims.iss !== 'string' || !(o.issuers ?? ISSUERS).has(claims.iss))
    throw new Error('id_token iss');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SEC < now) throw new Error('id_token 만료');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_SEC > now) throw new Error('id_token iat');
  if (claims.nonce !== o.nonce) throw new Error('id_token nonce');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255)
    throw new Error('id_token sub');
  return claims.sub;
}

function parseJson(b64: string): unknown {
  try {
    const v = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (typeof v !== 'object' || v === null) throw new Error();
    return v;
  } catch {
    throw new Error('id_token 모양');
  }
}
