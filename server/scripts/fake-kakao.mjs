// 시험용 가짜 카카오 인증 서버 (OIDC). 진짜 카카오를 부르지 않으려고 쓴다 (#102).
// 서버 통합 시험(server/test/backup-kakao.test.ts)과 앱 통합 시험(scripts/dev/server-backup.mjs)이 같이 쓴다.
// 서버는 KAKAO_AUTH_URL 로 이 주소를 가리킨다.
//   GET  /oauth/authorize       로그인 화면 대신 바로 redirect_uri?code=&state= 로 보낸다 (sub 는 fake.nextSub)
//   POST /oauth/token           client_id, client_secret, redirect_uri(인가 때와 완전히 같아야, 다르면 KOE006), PKCE 를 보고 id_token
//   GET  /.well-known/jwks.json 공개 키
// id_token 은 RS256, iss = 이 서버 주소, aud = client_id, nonce 는 인가 때 값.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';

/** @param {{ clientId: string; clientSecret: string }} o */
export async function startFakeKakao(o) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'kakao-test-1', alg: 'RS256', use: 'sig' };
  /** 인가 코드 → 인가 요청 */
  const codes = new Map();
  const state = {
    url: '',
    /** 다음 로그인의 회원번호 */
    nextSub: '1000001',
    /** 받은 인가 요청의 scope (시험이 openid 만인지 본다) */
    scopes: [],
    /** 토큰 요청 실패 수 (KOE006 등) */
    errors: [],
  };
  const sockets = new Set();
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const idToken = (claims) => {
    const data = `${enc({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${enc(claims)}`;
    return `${data}.${sign('RSA-SHA256', Buffer.from(data), key.privateKey).toString('base64url')}`;
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', state.url);
    if (req.method === 'GET' && u.pathname === '/oauth/authorize') {
      const q = u.searchParams;
      if (q.get('client_id') !== o.clientId)
        return json(res, 400, { error: 'invalid_client', error_code: 'KOE101' });
      state.scopes.push(q.get('scope') ?? '');
      const code = randomBytes(16).toString('hex');
      codes.set(code, {
        sub: state.nextSub,
        nonce: q.get('nonce'),
        redirectUri: q.get('redirect_uri'),
        challenge: q.get('code_challenge'),
      });
      const back = new URL(q.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === 'POST' && u.pathname === '/oauth/token') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        const c = codes.get(f.get('code') ?? '');
        codes.delete(f.get('code') ?? '');
        const bad = (code) => {
          state.errors.push(code);
          json(res, 400, { error: 'invalid_grant', error_code: code });
        };
        if (f.get('grant_type') !== 'authorization_code' || !c) return bad('KOE320');
        if (f.get('client_id') !== o.clientId || f.get('client_secret') !== o.clientSecret)
          return bad('KOE010');
        if (f.get('redirect_uri') !== c.redirectUri) return bad('KOE006');
        const v = f.get('code_verifier') ?? '';
        if (createHash('sha256').update(v).digest('base64url') !== c.challenge) return bad('KOE303');
        const now = Math.floor(Date.now() / 1000);
        json(res, 200, {
          token_type: 'bearer',
          access_token: randomBytes(16).toString('hex'),
          expires_in: 21599,
          scope: 'openid',
          id_token: idToken({
            iss: state.url,
            aud: o.clientId,
            sub: c.sub,
            nonce: c.nonce,
            iat: now,
            exp: now + 3600,
            auth_time: now,
          }),
        });
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/.well-known/jwks.json')
      return json(res, 200, { keys: [jwk] });
    json(res, 404, { error: 'not_found' });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  state.url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    get url() {
      return state.url;
    },
    state,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r(undefined));
      }),
  };
}
