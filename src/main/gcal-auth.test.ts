import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { GCAL_LIST_SCOPE, GCAL_SCOPE } from '../shared/gcal.ts';
import {
  AUTH_URL,
  authUrl,
  callApi,
  challengeOf,
  classifyApi,
  exchangeCode,
  type FetchLike,
  googleClient,
  isVerifier,
  makePkce,
  newState,
  pageHtml,
  parseRedirect,
  parseTokenResponse,
  REVOKE_URL,
  refreshAccess,
  revokeToken,
  sameState,
  startLoopback,
  TOKEN_URL,
} from './gcal-auth.ts';

const CLIENT = { id: '1234567890-abcdefghij.apps.googleusercontent.com', secret: 'GOCSPX-not-really-secret' };

/** 부른 것을 적어 두고 정해 둔 대답을 주는 fetch */
function mockFetch(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return reply(url, init);
  };
  return { f, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('PKCE: RFC 7636 부록 B 의 예와 같은 challenge', () => {
  assert.equal(
    challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  const p = makePkce();
  assert.ok(isVerifier(p.verifier));
  assert.equal(p.verifier.length, 43);
  assert.equal(p.challenge, challengeOf(p.verifier));
  assert.notEqual(makePkce().verifier, p.verifier);
  // 정해 둔 무작위로 같은 값
  const fixed = makePkce((n) => new Uint8Array(n).fill(7));
  assert.equal(fixed.verifier, makePkce((n) => new Uint8Array(n).fill(7)).verifier);
  assert.ok(!isVerifier('short'));
  assert.ok(!isVerifier(`${'a'.repeat(43)}+`));
});

test('state: 길이 32 의 무작위, 시간이 새지 않게 맞춰 본다', () => {
  const s = newState();
  assert.match(s, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(sameState(s, s));
  assert.ok(!sameState(s, `${s.slice(0, -1)}${s.endsWith('x') ? 'y' : 'x'}`));
  assert.ok(!sameState(s, s.slice(1)));
  assert.ok(!sameState('', ''));
});

test('허락 주소: 일정 권한과 캘린더 목록 보기 권한, S256, offline, consent, 루프백 주소', () => {
  const u = new URL(
    authUrl({ clientId: CLIENT.id, redirectUri: 'http://127.0.0.1:53111', challenge: 'CH', state: 'ST' }),
  );
  assert.equal(`${u.origin}${u.pathname}`, AUTH_URL);
  const q = Object.fromEntries(u.searchParams);
  assert.deepEqual(q, {
    client_id: CLIENT.id,
    redirect_uri: 'http://127.0.0.1:53111',
    response_type: 'code',
    scope: `${GCAL_SCOPE} ${GCAL_LIST_SCOPE}`,
    code_challenge: 'CH',
    code_challenge_method: 'S256',
    state: 'ST',
    access_type: 'offline',
    prompt: 'consent',
  });
});

test('돌아온 요청 읽기: state 가 맞아야 code, 틀리면 받지 않는다', () => {
  assert.deepEqual(parseRedirect('GET', '/?code=4/abc&state=ST&scope=x', 'ST'), {
    kind: 'code',
    code: '4/abc',
  });
  assert.deepEqual(parseRedirect('GET', '/?code=4/abc&state=WRONG', 'ST'), { kind: 'badState' });
  assert.deepEqual(parseRedirect('GET', '/?code=4/abc', 'ST'), { kind: 'badState' });
  assert.deepEqual(parseRedirect('GET', '/?error=access_denied&state=ST', 'ST'), {
    kind: 'error',
    error: 'access_denied',
  });
  // 오류도 state 가 맞아야 (다른 페이지가 연결을 끊게 하지 못한다)
  assert.deepEqual(parseRedirect('GET', '/?error=access_denied&state=x', 'ST'), { kind: 'badState' });
  assert.deepEqual(parseRedirect('GET', '/?state=ST', 'ST'), { kind: 'error', error: 'no_code' });
  assert.deepEqual(parseRedirect('GET', '/favicon.ico', 'ST'), { kind: 'ignore' });
  assert.deepEqual(parseRedirect('POST', '/?code=a&state=ST', 'ST'), { kind: 'ignore' });
  assert.deepEqual(parseRedirect('GET', '/', 'ST'), { kind: 'ignore' });
  assert.deepEqual(parseRedirect('GET', undefined, 'ST'), { kind: 'ignore' });
});

test('토큰 대답 읽기: 만료 1분 전, refresh token, 권한 확인, 오류', () => {
  const now = 1_000_000;
  const ok = parseTokenResponse(
    200,
    {
      access_token: 'ya29.A',
      expires_in: 3599,
      refresh_token: '1//R',
      scope: `${GCAL_SCOPE} ${GCAL_LIST_SCOPE}`,
      token_type: 'Bearer',
    },
    now,
  );
  assert.deepEqual(ok, {
    ok: true,
    tokens: {
      accessToken: 'ya29.A',
      expiresAt: now + 3539_000,
      refreshToken: '1//R',
      scopeOk: true,
      listScope: true,
    },
  });
  // 예전 연결(일정 권한만): 일정은 되지만 캘린더 목록은 못 본다. 다시 연결해 달라고 한다
  const old = parseTokenResponse(200, { access_token: 'A', expires_in: 3600, scope: GCAL_SCOPE }, now);
  assert.ok(old.ok && old.tokens.scopeOk && !old.tokens.listScope);
  // 허락 화면에서 캘린더 칸을 풀면 다른 권한만 온다
  const noCal = parseTokenResponse(200, { access_token: 'A', expires_in: 3600, scope: 'openid' }, now);
  assert.ok(noCal.ok && !noCal.tokens.scopeOk && noCal.tokens.refreshToken === undefined);
  assert.deepEqual(parseTokenResponse(400, { error: 'invalid_grant', error_description: 'Bad' }, now), {
    ok: false,
    error: 'invalid_grant',
    status: 400,
  });
  assert.deepEqual(parseTokenResponse(500, undefined, now), { ok: false, error: 'http_500', status: 500 });
  assert.deepEqual(parseTokenResponse(200, { expires_in: 5 }, now), {
    ok: false,
    error: 'no_access_token',
    status: 200,
  });
});

test('code 바꾸기: 폼으로 client, code, verifier, redirect_uri 를 보낸다', async () => {
  const { f, calls } = mockFetch(() =>
    json(200, { access_token: 'A', expires_in: 3600, refresh_token: 'R' }),
  );
  const r = await exchangeCode(f, {
    client: CLIENT,
    code: '4/xyz',
    verifier: 'v'.repeat(43),
    redirectUri: 'http://127.0.0.1:5000',
    now: () => 0,
  });
  assert.ok(r.ok && r.tokens.refreshToken === 'R');
  assert.equal(calls[0]?.url, TOKEN_URL);
  assert.equal(calls[0]?.init.method, 'POST');
  assert.ok(calls[0]?.init.signal instanceof AbortSignal);
  const body = Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)));
  assert.deepEqual(body, {
    client_id: CLIENT.id,
    client_secret: CLIENT.secret,
    code: '4/xyz',
    code_verifier: 'v'.repeat(43),
    grant_type: 'authorization_code',
    redirect_uri: 'http://127.0.0.1:5000',
  });
});

test('새로 받기와 거두기: invalid_grant 를 그대로 알리고, 거두기는 이미 끝난 것(400)도 성공', async () => {
  const { f, calls } = mockFetch((url) =>
    url === TOKEN_URL ? json(400, { error: 'invalid_grant' }) : new Response('', { status: 400 }),
  );
  const r = await refreshAccess(f, {
    client: { id: CLIENT.id, secret: '' },
    refreshToken: 'R',
    now: () => 0,
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_grant', status: 400 });
  const body = Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)));
  // 비밀이 없으면 보내지 않는다
  assert.deepEqual(body, { client_id: CLIENT.id, grant_type: 'refresh_token', refresh_token: 'R' });
  assert.equal(await revokeToken(f, 'R'), true);
  assert.equal(calls[1]?.url, REVOKE_URL);
  assert.equal(String(calls[1]?.init.body), 'token=R');
  const down = mockFetch(() => new Response('', { status: 503 }));
  assert.equal(await revokeToken(down.f, 'R'), false);
  // 네트워크가 안 되면 던진다 (부르는 쪽이 인터넷 끊김으로 본다)
  const off: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(refreshAccess(off, { client: CLIENT, refreshToken: 'R', now: () => 0 }), TypeError);
});

test('API 대답 나누기', () => {
  assert.equal(classifyApi(200, {}), 'ok');
  assert.equal(classifyApi(204, undefined), 'ok');
  assert.equal(classifyApi(404, {}), 'notFound');
  assert.equal(classifyApi(410, {}), 'notFound');
  assert.equal(classifyApi(409, {}), 'conflict');
  assert.equal(classifyApi(401, {}), 'auth');
  assert.equal(classifyApi(429, {}), 'retry');
  assert.equal(classifyApi(503, {}), 'retry');
  assert.equal(classifyApi(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }), 'retry');
  assert.equal(classifyApi(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), 'retry');
  assert.equal(classifyApi(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }), 'scope');
  assert.equal(classifyApi(403, { error: { errors: [{ reason: 'requiredAccessLevel' }] } }), 'forbidden');
  assert.equal(classifyApi(403, undefined), 'forbidden');
  assert.equal(classifyApi(400, {}), 'bad');
});

test('API 부르기: Bearer 토큰, JSON 본문, 204 는 본문 없이', async () => {
  const { f, calls } = mockFetch((_u, init) =>
    init.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : json(200, { id: 'x', iCalUID: 'x@google.com' }),
  );
  const r = await callApi(f, 'TOKEN', 'POST', '/calendars/primary/events', { summary: 'a' });
  assert.deepEqual(r, { kind: 'ok', status: 200, json: { id: 'x', iCalUID: 'x@google.com' } });
  assert.equal(calls[0]?.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
  const h = calls[0]?.init.headers as Record<string, string>;
  assert.equal(h.authorization, 'Bearer TOKEN');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(calls[0]?.init.body, '{"summary":"a"}');
  const d = await callApi(f, 'TOKEN', 'DELETE', '/calendars/primary/events/x');
  assert.deepEqual(d, { kind: 'ok', status: 204, json: undefined });
  assert.equal(calls[1]?.init.body, undefined);
});

test('클라이언트: 실행 환경 변수가 먼저, 모양이 틀리면 없음 (기능이 숨는다)', () => {
  assert.equal(googleClient({}, { id: '', secret: '' }), undefined);
  assert.deepEqual(googleClient({}, { id: CLIENT.id, secret: 'S' }), { id: CLIENT.id, secret: 'S' });
  assert.deepEqual(
    googleClient(
      { JJ_GOOGLE_CLIENT_ID: ` ${CLIENT.id} `, JJ_GOOGLE_CLIENT_SECRET: 'E' },
      { id: 'x', secret: 'S' },
    ),
    { id: CLIENT.id, secret: 'E' },
  );
  // 환경 변수로 id 만 주면 빌드의 비밀을 섞지 않는다
  assert.deepEqual(googleClient({ JJ_GOOGLE_CLIENT_ID: CLIENT.id }, { id: 'x', secret: 'S' }), {
    id: CLIENT.id,
    secret: '',
  });
  assert.equal(googleClient({ JJ_GOOGLE_CLIENT_ID: 'not-a-client' }, { id: '', secret: '' }), undefined);
});

/** 루프백 서버에 GET */
function get(url: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    request(url, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    })
      .on('error', reject)
      .end();
  });
}

test('루프백 서버: 127.0.0.1 에만, 틀린 state 는 무시하고 맞는 code 로 끝난 뒤 닫힌다', async () => {
  const lb = await startLoopback({
    state: 'ST',
    page: (ok) => ({ title: ok ? '됐어 <b>' : '안 됨', body: 'b' }),
  });
  assert.match(lb.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  const bad = await get(`${lb.redirectUri}/?code=EVIL&state=nope`);
  assert.equal(bad.status, 404);
  const fav = await get(`${lb.redirectUri}/favicon.ico`);
  assert.equal(fav.status, 404);
  const ok = await get(`${lb.redirectUri}/?code=GOOD&state=ST`);
  assert.equal(ok.status, 200);
  // 페이지에 code 를 비추지 않고, 글은 HTML 로 막는다
  assert.ok(!ok.body.includes('GOOD'));
  assert.ok(ok.body.includes('됐어 &lt;b&gt;'));
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.match(String(ok.headers['content-security-policy']), /default-src 'none'/);
  assert.deepEqual(await lb.result, { kind: 'code', code: 'GOOD' });
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(get(`${lb.redirectUri}/?code=AGAIN&state=ST`));
});

test('루프백 서버: 시간이 지나면, 그만두면 끝난다. 거절도 받는다', async () => {
  const page = () => ({ title: 't', body: 'b' });
  const slow = await startLoopback({ state: 'S', timeoutMs: 30, page });
  assert.deepEqual(await slow.result, { kind: 'timeout' });
  const gone = await startLoopback({ state: 'S', page });
  gone.cancel();
  assert.deepEqual(await gone.result, { kind: 'cancelled' });
  const no = await startLoopback({ state: 'S', page });
  const r = await get(`${no.redirectUri}/?error=access_denied&state=S`);
  assert.equal(r.status, 200);
  assert.deepEqual(await no.result, { kind: 'error', error: 'access_denied' });
  assert.ok(pageHtml('<x>', '"y"').includes('&lt;x&gt;'));
});

test('돌아오는 경로를 정할 수 있다 (페어리 서버 로그인은 /done)', () => {
  assert.deepEqual(parseRedirect('GET', '/done?code=c1&state=s1', 's1', '/done'), {
    kind: 'code',
    code: 'c1',
  });
  assert.deepEqual(parseRedirect('GET', '/?code=c1&state=s1', 's1', '/done'), { kind: 'ignore' });
  assert.deepEqual(parseRedirect('GET', '/done?code=c1&state=zz', 's1', '/done'), { kind: 'badState' });
});
