import { type JsonWebKey, JWKS_REFRESH_MIN_MS } from './google';

// 카카오 로그인 (기획서 5절, 6단계, #102). OIDC 로 scope 는 openid 만: id_token 의 sub(회원번호) 하나만 쓴다.
// 이메일, 닉네임, 프로필은 받지 않는다(동의항목 최소). 서명은 카카오 JWKS 로 검증하고 nonce 를 본다.
// 돌아오는 주소는 서버 고정 <PUBLIC_URL>/auth/kakao/callback 하나다. 카카오는 리디렉트 URI 가 등록 값과 완전히 같아야 한다(다르면 KOE006).
// 카카오를 부르는 두 곳(코드 교환, 공개 키)은 KakaoApi 로 묶어 시험에서 가짜로 바꾼다. 주소는 KAKAO_AUTH_URL 로 가짜 서버를 가리킬 수 있다.

export interface KakaoApi {
  /** 인가 코드를 토큰으로 바꿔 id_token 을 돌려준다 (클라이언트 시크릿은 서버에만) */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<string>;
  fetchJwks(o?: { refresh?: boolean }): Promise<JsonWebKey[]>;
}

export const kakaoAuthorizeUrl = (base: string) => `${base}/oauth/authorize`;

/** id_token 의 iss: 운영은 https://kauth.kakao.com, 가짜 카카오는 그 주소 */
export const kakaoIssuers = (base: string): ReadonlySet<string> => new Set([base]);

/** 진짜(또는 KAKAO_AUTH_URL 의) 카카오. 공개 키는 한 시간 담아 두고, kid 가 없으면 1분에 한 번까지 다시 받는다 */
export function realKakaoApi(base: string): KakaoApi {
  let cache: { at: number; keys: JsonWebKey[] } | undefined;
  return {
    async exchangeCode({ code, codeVerifier, redirectUri, clientId, clientSecret }) {
      const res = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          client_secret: clientSecret,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`카카오 토큰 교환 ${res.status}`);
      const body = (await res.json()) as { id_token?: unknown };
      // OIDC 를 켜지 않았거나 scope 에 openid 가 빠지면 id_token 이 없다
      if (typeof body.id_token !== 'string')
        throw new Error('카카오 응답에 id_token 이 없다 (OIDC 켜기 확인)');
      return body.id_token;
    },
    async fetchJwks(o) {
      const age = cache ? Date.now() - cache.at : Number.POSITIVE_INFINITY;
      if (cache && (o?.refresh ? age < JWKS_REFRESH_MIN_MS : age < 3_600_000)) return cache.keys;
      const res = await fetch(`${base}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`카카오 공개 키 ${res.status}`);
      const body = (await res.json()) as { keys?: JsonWebKey[] };
      cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
      return cache.keys;
    },
  };
}
