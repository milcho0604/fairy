// 서버 기능 전체 QA 훑기 (#99 계정과 코인, #100 AI 대화권). server-account.mjs, server-ai.mjs 가 __jj 손잡이로 대신한
// 동작(나이 답, 지금 맞추기, 나이 바꾸기, 구글 로그인, 합치기, 로그아웃, 탈퇴, 서버 모드 켜기, 산 물건 초기화, 백업 바꾸기,
// AI 고르기, 질문 보내기)을 화면 요소를 눌러 다시 보고, API 는 경로마다 정상, 경계, 오류를 직접 부른다. 경우마다 PASS/FAIL.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-server-sweep.mjs
//
// - 서버는 이 프로세스 안에서 server/dist 의 createApp 으로 띄운다: 가짜 구글(시험이 만든 RSA 키로 서명한 id_token)을 끼우려고.
//   진짜 구글, 진짜 Anthropic 은 부르지 않는다 (가짜 Anthropic: server/scripts/fake-anthropic.mjs)
// - 앱의 "구글로 로그인" 단추는 진짜로 누른다. 브라우저 열기(shell.openExternal)만 메인에서 바꿔 끼워 주소를 받고,
//   브라우저가 할 일(서버 start → 가짜 구글 → callback → 앱 루프백)을 이 스크립트가 fetch 로 한다
// - 서버가 받은 요청을 모두 센다 (만 14세 미만 요청 0건 확인)
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만
// - 컨테이너는 jj-qa-sweep-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위
//   (QA_INSPECT_PORT, QA_PAGE_PORT, QA_NOURL_INSPECT_PORT, QA_NOURL_PAGE_PORT 로 바꿀 수 있다)
// - 화면은 밝은, 어두운 모드로 찍고(OUT/<이름>-<언어>-<light|dark>.png) 넘침, 영어판 한글, 줄표(—), 빈 단추를 본다
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeAnthropic } from '../../server/scripts/fake-anthropic.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `qa-server-sweep-${LANG}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
const portOf = async (name) => (process.env[name] ? Number(process.env[name]) : await freePort());

const results = [];
function check(area, name, ok, extra = '') {
  results.push({ area, name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${extra ? ` (${String(extra).slice(0, 200)})` : ''}`);
}

// ---- 시험용 Postgres ----
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pgName = `jj-qa-sweep-pg-${randomBytes(4).toString('hex')}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker('run', '-d', '--rm', '--name', pgName, '--log-opt', 'max-size=1m', '-e', `POSTGRES_PASSWORD=${pgPass}`,
  '-e', 'POSTGRES_USER=fairy', '-e', 'POSTGRES_DB=fairy', '-p', '127.0.0.1::5432', 'postgres:16-alpine');
const pgPort = docker('port', pgName, '5432/tcp').split('\n')[0]?.split(':').pop();
for (let i = 0; i < 240; i++) {
  try {
    docker('exec', pgName, 'pg_isready', '-U', 'fairy', '-d', 'fairy', '-h', '127.0.0.1');
    break;
  } catch {
    await sleep(250);
  }
}
const databaseUrl = `postgres://fairy:${pgPass}@127.0.0.1:${pgPort}/fairy`;
const sql = (q) => docker('exec', pgName, 'psql', '-U', 'fairy', '-d', 'fairy', '-At', '-c', q);
for (let i = 0; i < 20; i++) {
  try {
    execFileSync(process.execPath, [join(root, 'server', 'scripts', 'migrate.mjs')], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    break;
  } catch {
    await sleep(500);
  }
}

// #101 (PR #113): 채팅 이용권 기본 allowlist, 첫 로그인 선물 기본 꺼짐. 이 훑기는 #99/#100 흐름(모두, 선물 10)을 본다
sql(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
sql('UPDATE ai_setting SET first_gift = true');

// ---- 가짜 구글 ----
const CLIENT_ID = 'qa-client.apps.googleusercontent.com';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'qa1', alg: 'RS256', use: 'sig' };
const google = { sub: '', nonce: '' };
const idToken = (sub, nonce) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'qa1', typ: 'JWT' });
  const body = enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, nonce, iat: now, exp: now + 3600 });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url')}`;
};
const fakeGoogle = {
  async exchangeCode() {
    return idToken(google.sub, google.nonce);
  },
  async fetchJwks() {
    return [jwk];
  },
};

// ---- 페어리 서버 (이 프로세스 안) ----
const serverReq = createRequire(join(root, 'server', 'package.json'));
const { createApp } = serverReq('./dist/app.js');
const { readConfig } = serverReq('./dist/config.js');
const fake = await startFakeAnthropic();
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const baseEnv = {
  DATABASE_URL: databaseUrl,
  PORT: String(apiPort),
  PUBLIC_URL: apiUrl,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'qa-secret',
  ANTHROPIC_API_KEY: 'sk-test-fake',
  ANTHROPIC_BASE_URL: fake.url,
  GIFT_HMAC_KEY: randomBytes(32).toString('hex'),
  // 코인 초기화는 기능 키 coin_reset (기본 off, #102). 이 훑기는 초기화까지 보므로 켠다
  FEATURE_COIN_RESET: 'everyone',
};
/** 서버가 받은 요청 (방법 경로) */
const seen = [];
let nest;
async function startApi(env = baseEnv, port = apiPort) {
  const app = await createApp(readConfig(env), { google: fakeGoogle });
  app.use((req, _res, next) => {
    seen.push(`${req.method} ${req.path}`);
    next();
  });
  await app.listen(port, '127.0.0.1');
  return app;
}
async function stopApi() {
  if (nest) await nest.close().catch(() => {});
  nest = undefined;
}
nest = await startApi();

// ---- API 도우미 ----
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function api(method, path, { token, body, base = apiUrl, from = ip(), raw = false } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'cf-connecting-ip': from,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: raw ? text : undefined, headers: res.headers };
}
const today = () => new Date().toISOString().slice(0, 10);
const eid = () => `qa${randomBytes(8).toString('hex')}`;
const verifierNew = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
/** 브라우저 흉내: start 주소 → 가짜 구글 → callback. 돌아갈 루프백 주소를 돌려준다 */
async function browserFlow(startUrl, sub, from = ip()) {
  const s = await fetch(startUrl, { redirect: 'manual', headers: { 'cf-connecting-ip': from } });
  if (s.status !== 302) return { error: `start ${s.status}` };
  const g = new URL(s.headers.get('location') ?? '');
  google.sub = sub;
  google.nonce = g.searchParams.get('nonce') ?? '';
  const cb = await fetch(`${apiUrl}/auth/google/callback?state=${g.searchParams.get('state')}&code=fake-code`, {
    redirect: 'manual',
    headers: { 'cf-connecting-ip': from },
  });
  return { done: cb.headers.get('location') ?? '', google: g };
}
/** API 만으로 로그인: 기기 토큰과 sub 로 세션 */
async function apiLogin(token, sub, merge) {
  const v = verifierNew();
  const f = await browserFlow(`${apiUrl}/auth/google/start?port=5000&state=qastate${randomBytes(4).toString('hex')}&challenge=${challengeOf(v)}`, sub);
  const code = new URL(f.done).searchParams.get('code');
  return api('POST', '/v1/session', { token, body: { code, verifier: v, ...(merge ? { merge } : {}) } });
}
const newDevice = async (age = '18+') => (await api('POST', '/v1/device', { body: { age } })).json;
/** SSE 글을 사건 목록으로 */
const sse = (text) =>
  (text ?? '')
    .split('\n\n')
    .filter(Boolean)
    .map((b) => {
      const ev = /event: (.*)/.exec(b)?.[1];
      const data = /data: (.*)/.exec(b)?.[1];
      return { ev, data: data ? JSON.parse(data) : undefined };
    });
const findAnywhere = (needle) =>
  sql("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    .split('\n')
    .filter(Boolean)
    .filter((t) => sql(`SELECT count(*) FROM "${t}" x WHERE x::text LIKE '%${needle}%'`) !== '0');

// ================= 1. API 층 =================
async function apiLayer() {
  const A = 'API';
  check(A, 'GET /health 200', (await api('GET', '/health')).status === 200);
  // POST /v1/device
  {
    const ok = await api('POST', '/v1/device', { body: { age: '18+' } });
    check(A, 'device 18+ → 201 {token, account.id}', ok.status === 201 && /^fd_[A-Za-z0-9_-]{43}$/.test(ok.json?.token ?? '') && Number.isInteger(ok.json?.account?.id), JSON.stringify(ok.json).slice(0, 60));
    const teen = await api('POST', '/v1/device', { body: { age: '14+' } });
    check(A, 'device 14+ → 201, DB 나이 14+', teen.status === 201 && sql(`SELECT age FROM account WHERE id = ${teen.json.account.id}`) === '14+');
    for (const [b, why] of [[{ age: 'under14' }, 'under14'], [{}, '빈 본문'], [{ age: 18 }, '숫자'], ['nope', 'JSON 아님']]) {
      const r = await api('POST', '/v1/device', { body: b });
      check(A, `device ${why} → 400`, r.status === 400 && (why === 'JSON 아님' || r.json?.error === 'age'), `${r.status} ${JSON.stringify(r.json)}`);
    }
    // 같은 곳에서 한 시간 20개 상한
    const from = ip();
    let last;
    for (let i = 0; i < 21; i++) last = await api('POST', '/v1/device', { body: { age: '18+' }, from });
    check(A, 'device 같은 IP 21번째 → 429 rate_limited', last.status === 429 && last.json?.error === 'rate_limited', `${last.status}`);
  }
  // 인증
  {
    const r = await api('POST', '/v1/sync', { body: { entries: [] } });
    check(A, '토큰 없이 sync → 401 token', r.status === 401 && r.json?.error === 'token');
    const bad = await api('POST', '/v1/sync', { token: `fd_${'A'.repeat(43)}`, body: { entries: [] } });
    check(A, '모르는 토큰 → 401 token', bad.status === 401 && bad.json?.error === 'token', `${bad.status}`);
  }
  // PATCH /v1/account
  {
    const d = await newDevice();
    const r = await api('PATCH', '/v1/account', { token: d.token, body: { age: '14+' } });
    check(A, 'PATCH account 14+ → 200 {account:{id,age}}', r.status === 200 && r.json?.account?.age === '14+' && r.json.account.id === d.account.id);
    const back = await api('PATCH', '/v1/account', { token: d.token, body: { age: '18+' } });
    check(A, 'PATCH account 18+ 로 다시 → 200', back.status === 200 && back.json?.account?.age === '18+');
    const bad = await api('PATCH', '/v1/account', { token: d.token, body: { age: 'under14' } });
    check(A, 'PATCH account under14 → 400 age', bad.status === 400 && bad.json?.error === 'age');
  }
  // POST /v1/migrate
  {
    const d = await newDevice();
    const neg = await api('POST', '/v1/migrate', { token: d.token, body: { balance: -1 } });
    check(A, 'migrate 음수 → 400 balance', neg.status === 400 && neg.json?.error === 'balance');
    const items = await api('POST', '/v1/migrate', { token: d.token, body: { balance: 1, items: { 'toy:nope': 1 } } });
    check(A, 'migrate 모르는 물건 → 400 items', items.status === 400 && items.json?.error === 'items', JSON.stringify(items.json));
    const ok = await api('POST', '/v1/migrate', { token: d.token, body: { balance: 150, items: { 'toy:ball': 1 } } });
    check(A, 'migrate 150 + 공 → 200 잔액 150', ok.status === 200 && ok.json?.balance === 150 && ok.json?.items?.['toy:ball'] === 1, JSON.stringify(ok.json));
    const again = await api('POST', '/v1/migrate', { token: d.token, body: { balance: 999, items: {} } });
    check(A, 'migrate 두 번째: 다시 더하지 않는다', again.json?.balance === 150 || again.status === 409, `${again.status} ${JSON.stringify(again.json)}`);
    const big = await newDevice();
    const capped = await api('POST', '/v1/migrate', { token: big.token, body: { balance: 50_000 } });
    check(A, 'migrate 50,000 → 10,000 으로 깎임(capped)', capped.status === 200 && capped.json?.balance === 10_000, JSON.stringify(capped.json));
  }
  // POST /v1/sync
  {
    const d = await newDevice();
    await api('POST', '/v1/migrate', { token: d.token, body: { balance: 30 } });
    const s = (entries) => api('POST', '/v1/sync', { token: d.token, body: { entries } });
    const id1 = eid();
    const ok = await s([{ id: id1, reason: 'rest', amount: 3, day: today() }]);
    check(A, 'sync 버는 기록 → ok, 잔액 33', ok.status === 200 && ok.json?.results?.[0]?.status === 'ok' && ok.json.balance === 33, JSON.stringify(ok.json?.results));
    const dup = await s([{ id: id1, reason: 'rest', amount: 3, day: today() }]);
    check(A, 'sync 같은 기록 번호 → duplicate, 잔액 그대로', dup.json?.results?.[0]?.duplicate === true && dup.json.balance === 33);
    const cap = await s([{ id: eid(), reason: 'rest', amount: 999, day: today() }]);
    check(A, 'sync 한 기록 최대 넘음 → capped/rejected', ['capped', 'rejected'].includes(cap.json?.results?.[0]?.status) && cap.json.balance <= 36, JSON.stringify(cap.json?.results));
    const huge = await s([{ id: eid(), reason: 'rest', amount: 2_000_000, day: today() }]);
    check(A, 'sync 1,000,000 넘는 양 → rejected amount', huge.json?.results?.[0]?.status === 'rejected' && huge.json.results[0].error === 'amount', JSON.stringify(huge.json?.results));
    const poor = await s([{ id: eid(), reason: 'toy:cushion', amount: -9999, day: today() }]);
    check(A, 'sync 잔액 모자란 구매 → rejected', poor.json?.results?.[0]?.status === 'rejected', JSON.stringify(poor.json?.results));
    const noRef = await s([{ id: eid(), reason: 'todo', amount: 1, day: today() }]);
    check(A, 'sync 할 일 기록 ref 없음 → rejected ref', noRef.json?.results?.[0]?.status === 'rejected' && noRef.json.results[0].error === 'ref', JSON.stringify(noRef.json?.results));
    const old = await s([{ id: eid(), reason: 'rest', amount: 3, day: '2020-01-01' }]);
    check(A, 'sync 30일 넘은 날짜 → rejected', old.json?.results?.[0]?.status === 'rejected', JSON.stringify(old.json?.results));
    const reset = await s([{ id: eid(), reason: 'reset-items', amount: 0, day: today() }]);
    check(A, 'sync reset-items → ok applied 0, items {}', reset.json?.results?.[0]?.status === 'ok' && reset.json.results[0].applied === 0 && JSON.stringify(reset.json.items) === '{}');
    const shape = await api('POST', '/v1/sync', { token: d.token, body: { entries: 'x' } });
    check(A, 'sync entries 가 배열 아님 → 400 entries', shape.status === 400 && shape.json?.error === 'entries');
    const many = await api('POST', '/v1/sync', { token: d.token, body: { entries: Array.from({ length: 501 }, () => ({ id: eid(), reason: 'rest', amount: 0, day: today() })) } });
    check(A, 'sync 501개 → 400 entries', many.status === 400 && many.json?.error === 'entries');
    const badEntry = await s([{ id: 'x', reason: 'rest', amount: 1, day: today() }]);
    check(A, 'sync 기록 번호 모양 틀림 → 400 entry', badEntry.status === 400 && badEntry.json?.error === 'entry');
    const frac = await s([{ id: eid(), reason: 'rest', amount: 1.5, day: today() }]);
    check(A, 'sync 소수 양 → 400 entry', frac.status === 400 && frac.json?.error === 'entry');
  }
  // 구글 로그인 경로
  {
    const v = verifierNew();
    const noCh = await api('GET', '/auth/google/start?port=5000&state=abcdefgh');
    check(A, 'google start challenge 없음 → 400 challenge', noCh.status === 400 && noCh.json?.error === 'challenge');
    const badPort = await api('GET', `/auth/google/start?port=80&state=abcdefgh&challenge=${challengeOf(v)}`);
    check(A, 'google start port 80 → 400 port', badPort.status === 400 && badPort.json?.error === 'port');
    const badState = await api('GET', `/auth/google/start?port=5000&state=ab&challenge=${challengeOf(v)}`);
    check(A, 'google start state 짧음 → 400 state', badState.status === 400 && badState.json?.error === 'state');
    const ok = await api('GET', `/auth/google/start?port=5000&state=abcdefgh&challenge=${challengeOf(v)}`);
    const loc = new URL(ok.headers.get('location') ?? 'http://x');
    check(A, 'google start → 302 구글, scope openid, PKCE S256', ok.status === 302 && loc.origin === 'https://accounts.google.com' && loc.searchParams.get('scope') === 'openid' && loc.searchParams.get('code_challenge_method') === 'S256');
    const unknown = await api('GET', '/auth/google/callback?state=nope&code=x');
    check(A, 'google callback 모르는 state → 400 state', unknown.status === 400 && unknown.json?.error === 'state');
    const denied = await api('GET', `/auth/google/callback?state=${loc.searchParams.get('state')}&error=access_denied`);
    const back = new URL(denied.headers.get('location') ?? 'http://x');
    check(A, 'google callback 거절 → 루프백 error=denied, 앱 state 그대로', denied.status === 302 && back.origin === 'http://127.0.0.1:5000' && back.searchParams.get('error') === 'denied' && back.searchParams.get('state') === 'abcdefgh');
  }
  // POST /v1/session, DELETE /v1/session
  {
    const d = await newDevice();
    const v = verifierNew();
    const f = await browserFlow(`${apiUrl}/auth/google/start?port=5000&state=qastate01&challenge=${challengeOf(v)}`, `api-sub-${randomBytes(3).toString('hex')}`);
    const code = new URL(f.done).searchParams.get('code');
    const wrong = await api('POST', '/v1/session', { token: d.token, body: { code, verifier: verifierNew() } });
    check(A, 'session verifier 틀림 → 400 verifier', wrong.status === 400 && wrong.json?.error === 'verifier');
    const reuse = await api('POST', '/v1/session', { token: d.token, body: { code, verifier: v } });
    check(A, 'session 틀린 뒤 같은 코드 → 400 code (코드도 버림)', reuse.status === 400 && reuse.json?.error === 'code');
    const sub = `api-sub-${randomBytes(3).toString('hex')}`;
    const ok = await apiLogin(d.token, sub);
    check(A, 'session 정상 → 200 {session, account, linked}', ok.status === 200 && /^fs_/.test(ok.json?.session ?? '') && ok.json.account.id === d.account.id && ok.json.linked === true, JSON.stringify(ok.json).slice(0, 120));
    const noTok = await api('POST', '/v1/session', { body: { code: 'x', verifier: v } });
    check(A, 'session 토큰 없음 → 401', noTok.status === 401);
    const dev = await api('DELETE', '/v1/session', { token: d.token });
    check(A, 'DELETE session 기기 토큰 → 400 session_token', dev.status === 400 && dev.json?.error === 'session_token');
    const out = await api('DELETE', '/v1/session', { token: ok.json.session });
    check(A, 'DELETE session → 204', out.status === 204);
    const after = await api('GET', '/v1/ai', { token: ok.json.session });
    check(A, '로그아웃한 세션 → 401', after.status === 401);
    // 합치기 409
    const other = await newDevice();
    await api('POST', '/v1/migrate', { token: other.token, body: { balance: 40 } });
    const subB = `api-subB-${randomBytes(3).toString('hex')}`;
    await apiLogin(other.token, subB);
    const me = await apiLogin(d.token, sub); // 다시 로그인 (sub 붙은 계정)
    const conflict = await apiLogin(me.json.session, subB);
    check(A, '다른 계정의 로그인 → 409 merge_needed {code,current,other}', conflict.status === 409 && conflict.json?.error === 'merge_needed' && typeof conflict.json.code === 'string' && conflict.json.other?.balance === 40, JSON.stringify(conflict.json).slice(0, 140));
  }
  // DELETE /v1/account
  {
    const d = await newDevice();
    const sub = `api-del-${randomBytes(3).toString('hex')}`;
    const s = await apiLogin(d.token, sub);
    const r = await api('DELETE', '/v1/account', { token: s.json.session });
    check(A, 'DELETE account → 204, 계정과 로그인, 세션, 기기 모두 지움', r.status === 204 && sql(`SELECT count(*) FROM account WHERE id = ${d.account.id}`) === '0' && sql(`SELECT count(*) FROM login WHERE sub = '${sub}'`) === '0' && sql(`SELECT count(*) FROM device WHERE account_id = ${d.account.id}`) === '0');
    const after = await api('POST', '/v1/sync', { token: d.token, body: { entries: [] } });
    check(A, '탈퇴한 기기 토큰 → 401', after.status === 401);
  }
  // AI 대화권
  {
    const d = await newDevice();
    const devAi = await api('GET', '/v1/ai', { token: d.token });
    check(A, 'GET /v1/ai 기기 토큰 → 403 login', devAi.status === 403 && devAi.json?.error === 'login');
    const s = (await apiLogin(d.token, `api-ai-${randomBytes(3).toString('hex')}`)).json.session;
    const st = await api('GET', '/v1/ai', { token: s });
    check(A, 'GET /v1/ai 첫 로그인 → {tickets:10, dailyLimit:20, usedToday:0}', st.status === 200 && st.json?.tickets === 10 && st.json.dailyLimit === 20 && st.json.usedToday === 0, JSON.stringify(st.json));
    const st2 = await api('GET', '/v1/ai', { token: s });
    check(A, 'GET /v1/ai 다시 → 선물 두 번 안 줌 (10)', st2.json?.tickets === 10);
    const chat = (body) => api('POST', '/v1/ai/chat', { token: s, body, raw: true });
    const marker = `apiq${randomBytes(4).toString('hex')}`;
    const ok = await chat({ messages: [{ role: 'user', content: `안녕 ${marker}` }], lang: LANG, persona: '콩이, 다정한 말투' });
    const evs = sse(ok.text);
    check(A, 'chat 정상 → SSE text 조각들 + done{tickets:9}', ok.status === 200 && evs.filter((e) => e.ev === 'text').map((e) => e.data.text).join('') === '안녕! 나는 AI 야.' && evs.at(-1)?.ev === 'done' && evs.at(-1).data.tickets === 9, ok.text?.slice(0, 120));
    check(A, 'chat 내용 미저장 (표 전체에 질문, 답 없음)', findAnywhere(marker).length === 0 && findAnywhere('나는 AI').length === 0);
    check(A, 'chat 사용량 줄: status ok, 토큰 120/30', sql(`SELECT status || ':' || input_tokens || ':' || output_tokens FROM ai_usage ORDER BY id DESC LIMIT 1`) === 'ok:120:30');
    const fail = await chat({ messages: [{ role: 'user', content: '[[fail]] x' }], lang: LANG });
    check(A, 'chat 업스트림 500 → 502 {error:upstream, refunded, tickets:9}', fail.status === 502 && fail.json?.error === 'upstream' && fail.json.refunded === true && fail.json.tickets === 9, `${fail.status} ${fail.text?.slice(0, 80)}`);
    const sseErr = await chat({ messages: [{ role: 'user', content: '[[sse-error]] x' }], lang: LANG });
    const se = sse(sseErr.text);
    check(A, 'chat 중간 SSE 오류 → event error refunded, 9 그대로', se.at(-1)?.ev === 'error' && se.at(-1).data.refunded === true && (await api('GET', '/v1/ai', { token: s })).json.tickets === 9, sseErr.text?.slice(0, 160));
    const cut = await chat({ messages: [{ role: 'user', content: '[[cut]] x' }], lang: LANG });
    const ce = sse(cut.text);
    const afterCut = (await api('GET', '/v1/ai', { token: s })).json.tickets;
    check(A, 'chat 업스트림 끊김 → error 사건, 되돌림(9)', ce.at(-1)?.ev === 'error' && afterCut === 9, `${cut.text?.slice(0, 160)} 남은 ${afterCut}`);
    for (const [b, err, why] of [
      [{ messages: [] }, 'messages', '빈 messages'],
      [{ messages: [{ role: 'assistant', content: 'x' }] }, 'messages', '끝이 assistant'],
      [{ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, 'too_long', '4001자'],
      [{ messages: Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) }, 'messages', '13개'],
      [{ messages: [{ role: 'system', content: 'x' }] }, 'messages', 'role system'],
    ]) {
      const r = await chat(b);
      check(A, `chat ${why} → 400 ${err}`, r.status === 400 && r.json?.error === err, `${r.status} ${JSON.stringify(r.json)}`);
    }
    const rep0 = await api('POST', '/v1/ai/report', { token: s, body: { question: 'q', answer: 'a' } });
    check(A, 'report consent 없음 → 400 consent', rep0.status === 400 && rep0.json?.error === 'consent');
  }
  // 하루 상한, 다 씀, 월 상한, 레이트리밋 (새 계정마다)
  {
    const d = await newDevice();
    const s = (await apiLogin(d.token, `api-lim-${randomBytes(3).toString('hex')}`)).json.session;
    await api('GET', '/v1/ai', { token: s });
    const q = () => api('POST', '/v1/ai/chat', { token: s, body: { messages: [{ role: 'user', content: 'hi' }], lang: LANG }, raw: true });
    await q();
    // 오늘 쓴 줄을 모두 20 으로 (끝나면 1 로 되돌린다)
    sql(`UPDATE ai_daily SET used = 20 WHERE used >= 1`);
    const daily = await q();
    check(A, '하루 20번 → 429 daily_limit {tickets}', daily.status === 429 && daily.json?.error === 'daily_limit' && typeof daily.json.tickets === 'number', `${daily.status} ${daily.text?.slice(0, 80)}`);
    sql(`UPDATE ai_daily SET used = 1`);
    sql(`UPDATE ai_ticket SET remaining = 0 WHERE account_id = ${d.account.id}`);
    const none = await q();
    check(A, '다 씀 → 409 no_tickets {tickets:0}', none.status === 409 && none.json?.error === 'no_tickets' && none.json.tickets === 0, `${none.status} ${none.text?.slice(0, 80)}`);
    sql(`UPDATE ai_ticket SET remaining = 5 WHERE account_id = ${d.account.id}`);
    const big = sql(`INSERT INTO ai_usage (account_id, day, model, status, cost_micros) VALUES (${d.account.id}, current_date, 'claude-haiku-4-5', 'ok', 80000000) RETURNING id`).split('\n')[0];
    const budget = await q();
    check(A, '월 80달러 넘음 → 503 budget, 대화권 안 뺌', budget.status === 503 && budget.json?.error === 'budget' && sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${d.account.id}`) === '5', `${budget.status} ${budget.text?.slice(0, 80)}`);
    sql(`DELETE FROM ai_usage WHERE id = ${big}`);
    await api('PATCH', '/v1/account', { token: s, body: { age: '14+' } });
    const teen = await q();
    check(A, '14+ 계정 chat → 403 age', teen.status === 403 && teen.json?.error === 'age', `${teen.status}`);
    const teenSt = await api('GET', '/v1/ai', { token: s });
    check(A, '14+ 계정 GET /v1/ai → 403 age', teenSt.status === 403 && teenSt.json?.error === 'age');
    await api('PATCH', '/v1/account', { token: s, body: { age: '18+' } });
    let last;
    for (let i = 0; i < 11; i++) last = await api('POST', '/v1/ai/report', { token: s, body: { consent: true, question: 'q', answer: 'a' } });
    check(A, 'AI 경로 1분 10번 넘음 → 429 rate_limited', last.status === 429 && last.json?.error === 'rate_limited', `${last.status}`);
  }
  // 구글 값과 AI 키가 빈 서버: 로그인 503 login_off, AI 503 ai_off
  {
    const port = await freePort();
    const off = await startApi({ ...baseEnv, PORT: String(port), GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', ANTHROPIC_API_KEY: '' }, port);
    const base = `http://127.0.0.1:${port}`;
    const v = verifierNew();
    const lo = await api('GET', `/auth/google/start?port=5000&state=abcdefgh&challenge=${challengeOf(v)}`, { base });
    check(A, '구글 값 비움 → start 503 login_off', lo.status === 503 && lo.json?.error === 'login_off');
    // 세션을 DB 에 만들어 ai_off 를 본다
    const d = (await api('POST', '/v1/device', { base, body: { age: '18+' } })).json;
    const tok = `fs_${randomBytes(32).toString('base64url')}`;
    sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'off-${randomBytes(3).toString('hex')}', ${d.account.id})`);
    sql(`INSERT INTO session (account_id, token_hash) VALUES (${d.account.id}, sha256('${tok}'::bytea))`);
    const ao = await api('POST', '/v1/ai/chat', { base, token: tok, body: { messages: [{ role: 'user', content: 'hi' }] } });
    check(A, 'AI 키 비움 → chat 503 ai_off', ao.status === 503 && ao.json?.error === 'ai_off', `${ao.status}`);
    await off.close();
  }
}

// ================= 앱과 CDP =================
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}, ms = 60_000) =>
    new Promise((r, j) => {
      const i = ++id;
      const done = () => {
        clearTimeout(timer);
        ws.removeEventListener('message', h);
      };
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          done();
          r(m);
        }
      };
      const timer = setTimeout(() => {
        done();
        j(new Error(`CDP 답 없음: ${method}`));
      }, ms);
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}

function launch({ scratchName, inspect, pageP, serverUrl }) {
  const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), scratchName));
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const child = spawn(electronPath, [`--inspect=${inspect}`, '.', `--remote-debugging-port=${pageP}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
      ...(serverUrl ? { JJ_SERVER_URL_OVERRIDE: serverUrl } : {}),
    },
    stdio: 'ignore',
  });
  const h = { child, scratch, data, inspect, pageP, exited: false, mainConn: undefined, pids: new Set([child.pid]) };
  child.on('exit', () => {
    h.exited = true;
  });
  h.main = async (expr) => {
    if (!h.mainConn || h.mainConn.ws.readyState !== 1) {
      h.mainConn = undefined;
      for (let i = 0; i < 120 && !h.mainConn; i++) {
        try {
          const [t] = await (await fetch(`http://127.0.0.1:${inspect}/json/list`)).json();
          h.mainConn = await connect(t.webSocketDebuggerUrl);
        } catch {
          await sleep(250);
        }
      }
    }
    const m = await h.mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  h.page = async (name) => {
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${pageP}/json`)).json();
        const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
        if (p) {
          const c = await connect(p.webSocketDebuggerUrl);
          const ev = async (expr) => {
            const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
            return m.result?.result?.value;
          };
          return {
            ev,
            send: c.send,
            close: () => c.ws.close(),
            /** 고른 요소(없으면 창 전체)를 밝은, 어두운 모드로 찍고 화면 검사 결과를 돌려준다 */
            shots: async (file, sel) => {
              const issues = [];
              for (const mode of ['light', 'dark']) {
                await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
                await sleep(250);
                const box = sel
                  ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const s = el?.closest('section') ?? el; if (!s) return null; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4 + window.scrollY), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, 2400) }; })()`)
                  : null;
                await sleep(150);
                const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 2 }, captureBeyondViewport: true } : {}) });
                writeFileSync(join(OUT, `${file}-${LANG}-${mode}.png`), Buffer.from(r.result.data, 'base64'));
              }
              await c.send('Emulation.setEmulatedMedia', { features: [] });
              const a = await ev(`(() => {
                const el = ${sel ? `document.querySelector(${JSON.stringify(sel)})?.closest('section') ?? document.querySelector(${JSON.stringify(sel)})` : 'document.body'};
                if (!el) return { missing: true };
                const over = [...el.querySelectorAll('*')].filter((x) => { const cs = getComputedStyle(x); const rr = x.getBoundingClientRect(); if (rr.width <= 1 || rr.height <= 1 || cs.position === 'absolute' && cs.clip !== 'auto') return false; if (/(auto|scroll)/.test(cs.overflowX) || x.tagName === 'TEXTAREA') return false; return x.scrollWidth > x.clientWidth + 1 && cs.overflowX !== 'visible' ? true : x.getBoundingClientRect().right > document.documentElement.clientWidth + 1; }).map((x) => x.className || x.tagName).slice(0, 5);
                const text = el.innerText.replace(/안녕! (나는 AI 야\.|나는 )?/g, ''); /* 가짜 Anthropic 답(고정 한국어)은 시험 자료라 뺀다 */
                const emptyBtn = [...el.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length;
                return { over, hangul: (text.match(/[\\uAC00-\\uD7A3]+/g) ?? []).slice(0, 8), emdash: text.includes('\\u2014'), emptyBtn };
              })()`);
              if (a?.missing) issues.push('요소 없음');
              else {
                if (a.over.length) issues.push(`넘침 ${a.over.join(',')}`);
                if (LANG === 'en' && a.hangul.length) issues.push(`영어판 한글 ${a.hangul.join(' ')}`);
                if (a.emdash) issues.push('줄표');
                if (a.emptyBtn) issues.push(`빈 단추 ${a.emptyBtn}`);
              }
              check('화면', `${file} (light, dark)`, issues.length === 0, issues.join('; ') || `${file}-${LANG}-{light,dark}.png`);
              return issues;
            },
          };
        }
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${name}`);
  };
  h.quit = async () => {
    try {
      await h.main("(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()");
    } catch {}
    h.mainConn?.ws.close();
    for (let i = 0; i < 60 && !h.exited; i++) await sleep(250);
    // 다시 켜기(백업 바꾸기)로 뜬 앱은 이 스크립트의 자식이 아니다: 데이터 폴더 경로로 찾아 모두 끈다
    const left = () => {
      try {
        return execFileSync('pgrep', ['-f', scratch], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
      } catch {
        return [];
      }
    };
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      for (const pid of new Set([...h.pids, ...left()])) {
        try {
          process.kill(pid, sig);
        } catch {}
      }
      await sleep(1500);
    }
    if (left().length) check('정리', '시험 앱 프로세스가 남음', false, left().join(','));
    for (let i = 0; i < 3; i++) {
      await sleep(800);
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  return h;
}
async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(250);
  }
  throw new Error(`기다림 끝: ${what}`);
}
const T = {
  ko: {
    adult: '만 18세 이상', teen: '만 14세 이상 18세 미만', under14: '만 14세 미만', change: '나이 바꾸기', syncNow: '지금 맞추기',
    login: '구글로 로그인', logout: '로그아웃', remove: '서버 계정 지우기', sure: '정말 지우기', turnOn: '서버 모드 켜기',
    mergeYes: '합치기', mergeNo: '합치지 않기', ticket: '채팅 이용권', agree: '알겠어, 채팅 이용권 쓰기', send: '보내기',
    report: '신고', offline: '서버에 닿지 않아', signedIn: '구글로 로그인했어', tickets10: 'AI 채팅 이용권 10장', ticketsWord: 'AI 채팅 이용권', appMode: '앱 안 모드야',
    daily: '오늘 채팅 이용권 질문은 여기까지야', budget: '이번 달 채팅 이용권 AI가 쉬는 중이야', empty: '채팅 이용권을 다 썼어', failed: '채팅 이용권은 돌려놓았어',
    count: (n) => `채팅 이용권 ${n}장 남음`, restoreServer: '코인과 산 물건은 서버 것을 따라', serverTitle: '서버 계정과 코인', reverted: '되돌렸어', resetStart: '코인 초기화하기', resetSure: '초기화할게',
  },
  en: {
    adult: '18 or older', teen: '14 to 17', under14: 'Under 14', change: 'Change age', syncNow: 'Sync now',
    login: 'Sign in with Google', logout: 'Sign out', remove: 'Delete server account', sure: 'Really delete', turnOn: 'Turn on server mode',
    mergeYes: 'Merge', mergeNo: "Don't merge", ticket: 'Chat pass', agree: 'Got it, use chat passes', send: 'Send',
    report: 'Report', offline: "Can't reach the server", signedIn: 'Signed in with Google', tickets10: '10 chat passes', ticketsWord: 'Pick "Chat pass"', appMode: 'App-only mode',
    daily: "That's all the chat pass questions for today", budget: 'Chat pass AI is resting', empty: 'used all your chat passes', failed: 'Your chat pass is back',
    count: (n) => `${n} ${n === 1 ? 'chat pass' : 'chat passes'} left`, restoreServer: 'Coins and items follow the server', serverTitle: 'Server account and coins', reverted: 'undone', resetStart: 'Reset coins', resetSure: 'Reset now',
  },
}[LANG];

/** 안에서 글이 꼭 맞는 단추를 찾아 누른다 (CDP, 진짜 마우스 없이) */
/** 시험 질문 (영어판 화면에 한글이 섞이지 않게) */
const Q = (ko, en) => (LANG === 'en' ? en : ko);
const press1 = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
/** 단추가 꺼져 있으면(앞 동작이 아직 도는 중) 5초까지 기다렸다 누른다 */
const press = async (p, scope, text) => {
  for (let i = 0; i < 20; i++) {
    if (await press1(p, scope, text)) return true;
    await sleep(250);
  }
  return false;
};
const pressSel = (p, sel) => p.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const boxText = (p) => p.ev(`document.querySelector('.server-box')?.innerText ?? ''`);
/** #101: 나이 답 다음 닉네임 단계가 뜨면 닉네임을 넣고 "서버 모드 시작" */
async function nicknameStep(p) {
  const shown = await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`), 5000).catch(() => false);
  if (!shown) return false;
  await p.ev(`(() => { const el = document.querySelector('.server-nickname-step input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(LANG === 'en' ? 'Sweeper' : '훑기')}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  return press(p, '.server-nickname-step', LANG === 'en' ? 'Start server mode' : '서버 모드 시작');
}

// ================= 2. 서버 주소 없음 =================
async function noUrlPhase() {
  const F = '서버 주소 없음';
  const h = launch({ scratchName: '.qa-sweep-nourl-', inspect: await portOf('QA_NOURL_INSPECT_PORT'), pageP: await portOf('QA_NOURL_PAGE_PORT') });
  try {
    await until('__jj', () => h.main('typeof __jj === "object"'), 60_000);
    const st = JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
    check(F, '메인 상태 enabled=false, 대화권 없음', st.enabled === false && st.ai === false && st.tickets === null);
    await h.main("__jj.settingsWindow.open('restore')");
    const p = await h.page('settings');
    await until('데이터 칸', () => p.ev(`!!document.querySelector('.restore-undo, section .card')`));
    await sleep(500);
    // 서버 주소가 없으면 기능 키를 알 수 없어 코인 초기화 칸은 숨는다 (#102, 앱 기본 off)
    check(F, '코인 초기화 칸 없음 (기능 키 기본 off)', !(await p.ev(`!!document.querySelector('.coin-reset')`)));
    const dom = await p.ev(`({ box: !!document.querySelector('.server-box, .server-ask, .server-merge'), title: document.body.innerText.includes(${JSON.stringify(T.serverTitle)}), login: document.body.innerText.includes(${JSON.stringify(T.login)}) })`);
    check(F, '설정 > 데이터에 서버 칸, 제목, 로그인 단추 없음', !dom.box && !dom.title && !dom.login, JSON.stringify(dom));
    await p.shots('nourl-1-data', 'section .card');
    await h.main('__jj.chat.open(__jj.pet.bounds()); 1');
    const c = await h.page('chat');
    await until('채팅', () => c.ev(`!!document.querySelector('.picker-button')`));
    await pressSel(c, '.picker-button');
    await sleep(300);
    const items = await c.ev(`[...document.querySelectorAll('.picker-menu [role=menuitemradio]')].map((b) => b.innerText.trim())`);
    check(F, '채팅 AI 고르기 목록에 대화권 없음, 대화권 줄 없음', Array.isArray(items) && items.length > 0 && !items.some((x) => x.includes(T.ticket)) && !(await c.ev(`!!document.querySelector('.ticket-bar')`)), items?.join(' | '));
    await pressSel(c, '.picker-button');
    await c.shots('nourl-2-chat');
    check(F, '서버로 간 요청 0건', seen.length === 0, seen.join(','));
    p.close();
    c.close();
  } catch (err) {
    check(F, '중단', false, err.message);
  } finally {
    await h.quit();
  }
}

// ================= 3. 앱 흐름 (서버 있음) =================
async function appPhase() {
  const h = launch({ scratchName: '.qa-sweep-app-', inspect: await portOf('QA_INSPECT_PORT'), pageP: await portOf('QA_PAGE_PORT'), serverUrl: apiUrl });
  console.log('app pid', h.child.pid, 'server', apiPort, 'pg', pgName, 'lang', LANG);
  const status = async () => JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
  const localBalance = () => h.main('__jj.store.balance()');
  const myId = () => sql('SELECT id FROM account WHERE closed_at IS NULL AND merged_into IS NULL ORDER BY id DESC LIMIT 1');
  let acct; // 앱 계정 번호
  const srvBalance = () => Number(sql(`SELECT balance FROM account WHERE id = ${acct}`) || 'NaN');
  let p;
  /** "지금 맞추기" 단추를 누르고 끝날 때까지 */
  const clickSync = async () => {
    const before = (await status()).lastSyncAt;
    await until('맞추기 단추', () => press(p, '.server-box', T.syncNow), 10_000);
    await until('맞추기 끝', async () => {
      const s = await status();
      return !s.syncing && (s.lastSyncAt !== before || s.problem);
    }, 20_000).catch(() => {});
    await sleep(300);
  };
  /** 앱이 연 브라우저 주소 (바꿔 끼운 openExternal) */
  const opened = async () => {
    let u;
    await until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000);
    await h.main('globalThis.__qaOpened = null');
    return u;
  };
  /** "구글로 로그인"을 눌러 sub 로 들어간다 */
  const clickLogin = async (sub) => {
    const ok = await press(p, '.server-box', T.login);
    if (!ok) return false;
    const url = await opened();
    const f = await browserFlow(url, sub);
    const r = await fetch(f.done).catch((e) => ({ status: String(e) }));
    return r.status === 200;
  };
  try {
    await until('__jj', () => h.main('typeof __jj === "object"'), 60_000);
    // 브라우저 대신 주소만 받는다 (진짜 브라우저를 열지 않는다)
    await h.main(`(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; }; return true; })()`);
    await h.main("__jj.settingsWindow.open('restore')");
    p = await h.page('settings');
    await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
    await sleep(400);

    // --- 나이 확인 (세 답) ---
    {
      const F = '나이 확인';
      const btns = await p.ev(`[...document.querySelectorAll('.server-ages button')].map((b) => b.textContent.trim())`);
      check(F, '처음: 세 답 단추, 서버 요청 0건', JSON.stringify(btns) === JSON.stringify([T.under14, T.teen, T.adult]) && seen.length === 0, btns?.join(' | '));
      await p.shots('app-01-ask-age', '.server-box');
    }
    // --- 만 14세 미만: 요청 0건 ---
    {
      const F = '만 14세 미만';
      const accounts0 = sql('SELECT count(*) FROM account');
      check(F, '"만 14세 미만" 누르기', await press(p, '.server-box', T.under14));
      await until('앱 안 모드', async () => (await boxText(p)).includes(T.appMode));
      await h.main(`(__jj.store.reward(10, 'meet', Date.now()), __jj.store.reward(200, 'weekly', Date.now()), __jj.shop.buyToy('ball', Date.now()), 1)`);
      await h.main('__jj.server.core.run().then(() => 1)');
      await sleep(16_000); // 장부 쓰기 뒤 15초 맞추기 타이머까지
      const s = await status();
      check(F, '앱 안 모드 글, 코인 벌어도 서버 요청 0건, 계정 0', s.on === false && seen.length === 0 && sql('SELECT count(*) FROM account') === accounts0, `요청 ${seen.length}`);
      await p.shots('app-02-under14', '.server-box');
    }
    // --- 18+ 로 바꾸기 → 기기 계정 → 옮기기 ---
    {
      const F = '기기 계정·옮기기';
      check(F, '"나이 바꾸기" 누르기', await press(p, '.server-box', T.change));
      await sleep(200);
      check(F, '"만 18세 이상" 누르기', await press(p, '.server-box', T.adult));
      check(F, '(#101) 닉네임 넣고 "서버 모드 시작"', await nicknameStep(p));
      await until('기기 계정과 첫 맞추기', async () => {
        const s = await status();
        return s.device && s.balance !== null && !s.syncing;
      });
      acct = myId();
      const local = await localBalance();
      check(F, '서버 잔액 = 앱 잔액, 산 공 옮김, 나이 18+', srvBalance() === local && sql(`SELECT item FROM owned_item WHERE account_id = ${acct}`) === 'toy:ball' && sql(`SELECT age FROM account WHERE id = ${acct}`) === '18+', `앱 ${local} 서버 ${srvBalance()}`);
      check(F, '요청: device → migrate → sync', seen.includes('POST /v1/device') && seen.includes('POST /v1/migrate'), seen.slice(0, 6).join(','));
      check(F, '칸 글: 서버 코인 N, 로그인 단추', (await boxText(p)).includes(String(local)) && (await p.ev(`[...document.querySelectorAll('.server-box button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.login)})`)));
      await p.shots('app-03-server', '.server-box');
    }
    // --- 코인 벌기 → 지금 맞추기 단추 ---
    {
      const F = '코인 맞추기';
      await h.main(`(() => { const t = __jj.store.add({ title: 'qa sweep' }, Date.now()); __jj.store.complete(t.id, Date.now()); __jj.store.rewardFocus(Date.now(), 25); return 1; })()`);
      await clickSync();
      const local = await localBalance();
      const s = await status();
      check(F, '"지금 맞추기" 누름 → 서버 잔액 = 앱, 대기 0', srvBalance() === local && s.pending === 0, `앱 ${local} 서버 ${srvBalance()}`);
      check(F, '칸에 서버 코인 숫자 갱신', (await boxText(p)).includes(String(local)));
    }
    // --- 오프라인 → 복구 ---
    {
      const F = '오프라인→복구';
      await stopApi();
      await h.main(`(__jj.store.reward(3, 'rest', Date.now()), __jj.store.reward(3, 'rest', Date.now()), 1)`);
      await clickSync();
      await until('오프라인 글', async () => (await boxText(p)).includes(T.offline), 10_000).catch(() => {});
      const s = await status();
      check(F, '서버 끔 + "지금 맞추기": 오프라인 안내 글, 대기 2', (await boxText(p)).includes(T.offline) && s.pending === 2, JSON.stringify({ p: s.problem, n: s.pending }));
      await p.shots('app-04-offline', '.server-box');
      nest = await startApi();
      await clickSync();
      const s2 = await status();
      check(F, '서버 켬 + "지금 맞추기": 안내 사라짐, 서버 = 앱', !(await boxText(p)).includes(T.offline) && s2.pending === 0 && srvBalance() === (await localBalance()), `서버 ${srvBalance()}`);
    }
    // --- 거절된 구매 되돌리기 ---
    {
      const F = '거절 되돌리기';
      sql(`UPDATE account SET balance = 20 WHERE id = ${acct}`);
      const bought = await h.main(`__jj.shop.buyToy('cushion', Date.now()).ok`);
      await clickSync();
      check(F, '다른 기기가 먼저 씀 → 쿠션 회수, 앱 = 서버 = 20', bought === true && (await h.main(`__jj.shop.owns('cushion')`)) === false && (await localBalance()) === 20 && srvBalance() === 20, `앱 ${await localBalance()}`);
    }
    // --- 두 기기 같은 계정 (둘째 기기는 API) ---
    let subA = `qa-A-${randomBytes(3).toString('hex')}`;
    {
      const F = '구글 로그인';
      const n0 = seen.length;
      check(F, '"구글로 로그인" 누름 → 루프백 200', await clickLogin(subA));
      await until('로그인', async () => (await status()).signedIn, 15_000).catch(() => {});
      const s = await status();
      check(F, '로그인됨: DB 에 login(sub), 세션 1, 같은 계정', s.signedIn && sql(`SELECT account_id FROM login WHERE sub = '${subA}'`) === acct && sql(`SELECT count(*) FROM session WHERE account_id = ${acct}`) === '1');
      check(F, '요청에 start, callback, session', seen.slice(n0).some((x) => x.startsWith('GET /auth/google/start')) && seen.slice(n0).includes('POST /v1/session'));
      await until('대화권 줄', async () => (await boxText(p)).includes(T.tickets10), 15_000).catch(() => {});
      const txt = await boxText(p);
      check(F, '칸 글: 로그인했어, 대화권 10개, 로그아웃 단추', txt.includes(T.signedIn) && txt.includes(T.tickets10) && txt.includes(T.logout), txt.slice(0, 200));
      await p.shots('app-05-signed-in', '.server-box');
    }
    {
      const F = '두 기기 같은 계정';
      const d2 = await newDevice();
      const s2 = await apiLogin(d2.token, subA);
      check(F, '둘째 기기 로그인 → 앱 계정으로 합쳐짐 (묻지 않음)', s2.status === 200 && String(s2.json?.account?.id) === acct && s2.json.merged === true, JSON.stringify(s2.json).slice(0, 120));
      const before = await localBalance();
      const r = await api('POST', '/v1/sync', { token: s2.json.session, body: { entries: [{ id: eid(), reason: 'hide-seek', amount: 3, day: today() }] } });
      const applied = r.json?.results?.[0]?.applied ?? 0;
      await clickSync();
      check(F, '둘째 기기에서 번 코인이 앱 "지금 맞추기"로 들어옴', applied > 0 && (await localBalance()) === before + applied && srvBalance() === before + applied, `+${applied} 앱 ${await localBalance()}`);
      await api('DELETE', '/v1/session', { token: s2.json.session });
    }
    // --- 채팅 대화권 ---
    {
      const F = '대화권';
      await h.main('__jj.chat.open(__jj.pet.bounds()); 1');
      const c = await h.page('chat');
      await until('채팅', () => c.ev(`!!document.querySelector('.picker-button')`));
      const pick = async () => {
        await pressSel(c, '.picker-button');
        await sleep(300);
        return c.ev(`(() => { const b = [...document.querySelectorAll('.picker-menu [role=menuitemradio]')].find((x) => x.innerText.includes(${JSON.stringify(T.ticket)})); if (!b) return false; b.click(); return true; })()`);
      };
      check(F, 'AI 고르기 → "대화권 Claude" 누르기', await pick());
      await until('대화권 줄', () => c.ev(`!!document.querySelector('.ticket-bar')`));
      const bar = await c.ev(`document.querySelector('.ticket-bar').innerText`);
      check(F, '국외 이전 안내(Anthropic, 미국/USA, 30일)와 AI 고지, 10개', bar.includes('Anthropic') && /미국|USA/.test(bar) && bar.includes('30') && bar.includes(T.count(10)), bar.slice(0, 100));
      const type = (text) => c.ev(`(() => { const ta = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await type(Q('미리 보내기', 'send early'));
      await sleep(200);
      const disabled = await c.ev(`[...document.querySelectorAll('.composer button.primary')].find((b) => b.textContent.trim() === ${JSON.stringify(T.send)})?.disabled`);
      check(F, '"알겠어" 전: 보내기 단추 꺼짐, 서버 chat 요청 0', disabled === true && !seen.includes('POST /v1/ai/chat'));
      await c.shots('app-06-ticket-notice');
      check(F, '"알겠어" 누르기', await press(c, '.ticket-notice', T.agree));
      await until('안내 닫힘', async () => !(await c.ev(`!!document.querySelector('.ticket-notice')`)));
      const sendQ = async (text) => {
        await type(text);
        await sleep(150);
        const ok = await press(c, '.composer', T.send);
        await until('답 끝', async () => {
          const st = JSON.parse(await h.main('JSON.stringify(__jj.chat.debugState)'));
          return ok && !st.pendingId && ['done', 'error'].includes(st.messages.at(-1)?.status);
        }, 40_000).catch(() => {});
        await sleep(400);
        return ok;
      };
      const lastMsg = () => c.ev(`[...document.querySelectorAll('.msg')].at(-1)?.innerText ?? ''`);
      const remain = () => Number(sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${acct}`));
      const marker = `qaq${randomBytes(4).toString('hex')}`;
      check(F, '질문 쓰고 "보내기" 누름', await sendQ(`${Q('안녕', 'hello')} ${marker}`));
      check(F, '답 "안녕! 나는 AI 야." 화면, 차감 9 (DB, 줄)', (await lastMsg()).includes('안녕! 나는 AI 야.') && remain() === 9 && (await c.ev(`document.querySelector('.ticket-count').innerText`)).includes(T.count(9)), `${remain()}`);
      await c.shots('app-07-ticket-answer');
      await sendQ(`[[fail]] ${Q('다시', 'again')}`);
      check(F, '업스트림 실패: 되돌림 안내 글, 9 그대로', (await lastMsg()).includes(T.failed) && remain() === 9, (await lastMsg()).slice(-80));
      await sendQ(`[[sse-error]] ${Q('다시', 'again')}`);
      check(F, '중간 SSE 오류: 9 그대로', remain() === 9, (await lastMsg()).slice(-80));
      // 신고 (첫 답)
      await pressSel(c, '.ticket-report-open');
      await sleep(200);
      await c.shots('app-08-report-ask');
      check(F, '신고 → "보내기"', await press(c, '.ticket-report', T.send));
      await until('신고 끝', () => c.ev(`!!document.querySelector('.ticket-report-done.sent')`), 10_000).catch(() => {});
      check(F, '신고: 그 대화만 ai_report 에', sql(`SELECT count(*) FROM ai_report WHERE account_id = ${acct}`) === '1' && findAnywhere(marker).join(',') === 'ai_report');
      sql(`DELETE FROM ai_report WHERE account_id = ${acct}`);
      check(F, '내용 미저장: 신고 지우면 질문, 답이 DB 어디에도 없다', findAnywhere(marker).length === 0 && findAnywhere('나는 AI').length === 0);
      // 하루 상한
      sql(`UPDATE ai_daily SET used = 20 WHERE used > 0`);
      await sendQ(Q('하루 상한', 'daily cap'));
      check(F, '하루 20번: 오늘은 여기까지 안내, 대화권 그대로', (await lastMsg()).includes(T.daily) && remain() === 9, (await lastMsg()).slice(-80));
      sql(`UPDATE ai_daily SET used = 1 WHERE used > 0`);
      // 월 상한
      const big = sql(`INSERT INTO ai_usage (account_id, day, model, status, cost_micros) VALUES (${acct}, current_date, 'claude-haiku-4-5', 'ok', 80000000) RETURNING id`).split('\n')[0];
      await sendQ(Q('월 상한', 'monthly cap'));
      check(F, '월 상한: 쉬는 중 안내, 대화권 그대로', (await lastMsg()).includes(T.budget) && remain() === 9, (await lastMsg()).slice(-80));
      sql(`DELETE FROM ai_usage WHERE id = ${big}`);
      // 다 씀
      sql(`UPDATE ai_ticket SET remaining = 0 WHERE account_id = ${acct}`);
      await sendQ(Q('하나 더', 'one more'));
      const alt = await c.ev(`[...document.querySelectorAll('.msg')].at(-1)?.querySelectorAll('.retry button').length ?? 0`);
      check(F, '다 씀: 안내와 "내 컴퓨터 AI 로 다시 묻기" 단추, 0개 표시', (await lastMsg()).includes(T.empty) && alt > 0 && (await c.ev(`document.querySelector('.ticket-count').innerText`)).includes(T.count(0)), (await lastMsg()).slice(-80));
      await c.shots('app-09-ticket-empty');
      sql(`UPDATE ai_ticket SET remaining = 5 WHERE account_id = ${acct}`);
      // 14~17: 설정에서 눌러 바꾼다
      check(F, '설정 "나이 바꾸기" → "만 14세 이상 18세 미만"', (await press(p, '.server-box', T.change)) && (await sleep(200), await press(p, '.server-box', T.teen)));
      await until('숨김', async () => (await status()).ai === false);
      await until('서버 14+', async () => sql(`SELECT age FROM account WHERE id = ${acct}`) === '14+', 20_000).catch(() => {});
      await sleep(500);
      await pressSel(c, '.picker-button');
      await sleep(300);
      const items = await c.ev(`[...document.querySelectorAll('.picker-menu [role=menuitemradio]')].map((b) => b.innerText.trim())`);
      await pressSel(c, '.picker-button');
      check(F, '14~17: 대화권 줄, 설정의 대화권 글 없음, 서버 나이 14+', !(await c.ev(`!!document.querySelector('.ticket-bar')`)) && !(await boxText(p)).includes(T.ticketsWord) && sql(`SELECT age FROM account WHERE id = ${acct}`) === '14+');
      const listed = items.some((x) => x.includes(T.ticket));
      check(F, '14~17: 열려 있던 채팅 창의 AI 고르기 목록에서도 대화권이 빠진다', !listed, items.join(' | ').replace(/\n/g, ' '));
      if (listed) {
        await pick();
        await sleep(500);
        const st = JSON.parse(await h.main('JSON.stringify(__jj.chat.debugState)'));
        check(F, '14~17: 남은 "대화권 Claude" 항목을 눌러도 대화권으로 바뀌지 않는다 (메인이 막음)', st.provider !== 'fairy-ticket' && !(await c.ev(`!!document.querySelector('.ticket-bar')`)), st.provider);
      }
      await c.shots('app-10-teen-chat');
      // 다시 18+
      await press(p, '.server-box', T.change);
      await sleep(200);
      await press(p, '.server-box', T.adult);
      await until('다시 대화권', async () => (await status()).ai === true && sql(`SELECT age FROM account WHERE id = ${acct}`) === '18+', 20_000).catch(() => {});
      const back = await status();
      check('나이 바꾸기', '14+ → 18+ 다시 누름: 서버 18+, 대화권 돌아옴', sql(`SELECT age FROM account WHERE id = ${acct}`) === '18+' && back.ai === true, `서버 ${sql(`SELECT age FROM account WHERE id = ${acct}`)} 앱 ${JSON.stringify({ age: back.age, ai: back.ai, signedIn: back.signedIn, problem: back.problem, tickets: back.tickets })}`);
      c.close();
    }
    // --- 로그아웃 ---
    {
      const F = '로그아웃';
      const sessions0 = sql(`SELECT count(*) FROM session WHERE account_id = ${acct}`);
      check(F, '"로그아웃" 누름', await press(p, '.server-box', T.logout));
      await until('로그아웃', async () => !(await status()).signedIn, 10_000).catch(() => {});
      await sleep(300);
      check(F, '서버 세션 지움, 기기 토큰 그대로, 로그인 단추 다시', sessions0 === '1' && sql(`SELECT count(*) FROM session WHERE account_id = ${acct}`) === '0' && (await status()).device && (await boxText(p)).includes(T.login) && seen.includes('DELETE /v1/session'));
    }
    // --- 합치기 확인 창 ---
    {
      const F = '합치기';
      // 다른 계정: 코인 40, 구글 sub B
      const other = await newDevice();
      await api('POST', '/v1/migrate', { token: other.token, body: { balance: 40 } });
      const subB = `qa-B-${randomBytes(3).toString('hex')}`;
      await apiLogin(other.token, subB);
      // 앱은 sub A 로 다시 로그인한 뒤 sub B 로
      await clickLogin(subA);
      await until('로그인', async () => (await status()).signedIn, 10_000).catch(() => {});
      await press(p, '.server-box', T.logout);
      await until('로그아웃', async () => !(await status()).signedIn, 10_000).catch(() => {});
      // 지금 계정에는 로그인 A 가 붙어 있다 → B 는 다른 계정 것 → 묻는다
      const lb = await clickLogin(subB);
      await until('합치기 창', () => p.ev(`!!document.querySelector('.server-merge')`), 10_000).catch(() => {});
      console.log('  합치기 로그인 루프백', lb, JSON.stringify(await status()).slice(0, 300));
      const ask = await p.ev(`document.querySelector('.server-merge')?.innerText ?? ''`);
      const focus = await p.ev(`document.activeElement?.textContent?.trim()`);
      check(F, '합치기 확인 창: 두 계정 코인, 되돌릴 수 없음, 초점은 "합치지 않기"', ask.includes('40') && ask.includes(String(await localBalance())) && focus === T.mergeNo, `${ask.slice(0, 160)} / 초점 ${focus}`);
      await p.shots('app-11-merge', '.server-box');
      check(F, '"합치지 않기" 누름', await press(p, '.server-merge', T.mergeNo));
      await sleep(800);
      check(F, '안 합침: 두 계정 그대로', sql(`SELECT count(*) FROM account WHERE id = ${other.account.id} AND merged_into IS NULL AND closed_at IS NULL`) === '1' && !(await status()).signedIn);
      const before = await localBalance();
      await clickLogin(subB);
      await until('합치기 창', () => p.ev(`!!document.querySelector('.server-merge')`), 10_000).catch(() => {});
      check(F, '다시 로그인 → "합치기" 누름', await press(p, '.server-merge', T.mergeYes));
      await until('합침', async () => (await status()).signedIn, 10_000).catch(() => {});
      await clickSync();
      check(F, '합침: 다른 계정이 지금 계정으로, 코인 더함 (+40)', sql(`SELECT merged_into FROM account WHERE id = ${other.account.id}`) === acct && (await localBalance()) === before + 40 && srvBalance() === before + 40, `앱 ${await localBalance()} 전 ${before}`);
    }
    // --- 산 물건 초기화 (설정 단추) ---
    {
      const F = '산 물건 초기화';
      await h.main(`__jj.shop.buyToy('ball', Date.now()).ok || true`);
      await clickSync();
      const had = Number(sql(`SELECT count(*) FROM owned_item WHERE account_id = ${acct}`));
      await p.ev(`window.dispatchEvent(new Event('focus')), 1`);
      await sleep(400);
      const ok1 = await p.ev(`(() => { const b = document.querySelectorAll('.coin-reset .segmented button')[1]; b.click(); return true; })()`);
      await sleep(200);
      const ok2 = await press(p, '.coin-reset .action-row', T.resetStart);
      await sleep(300);
      await p.shots('app-12-coin-reset', '.coin-reset');
      const ok3 = await press(p, '.coin-ask', T.resetSure);
      await sleep(500);
      await clickSync();
      await clickSync();
      check(F, '"산 물건도 함께" → "코인 초기화하기" → 확인: 서버 물건, 코인 0 이고 돌아오지 않음', ok1 && ok2 && ok3 && had > 0 && sql(`SELECT count(*) FROM owned_item WHERE account_id = ${acct}`) === '0' && (await h.main(`Object.keys(__jj.shop.ownedItems()).length`)) === 0 && (await localBalance()) === 0 && srvBalance() === 0, `누름 ${ok1}/${ok2}/${ok3} 전 ${had} 앱 ${await localBalance()} 서버 ${srvBalance()}`);
    }
    // --- 탈퇴 → 서버 모드 켜기 ---
    {
      const F = '탈퇴';
      await h.main(`(__jj.store.reward(10, 'meet', Date.now() + 86400000), 1)`);
      const local0 = await localBalance();
      check(F, '"서버 계정 지우기" 누름 → "정말 지우기" 로 바뀜', (await press(p, '.server-box', T.remove)) && (await sleep(150), await p.ev(`[...document.querySelectorAll('.server-box button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.sure)})`)));
      await press(p, '.server-box', T.sure);
      await until('탈퇴', async () => !(await status()).device, 10_000).catch(() => {});
      await sleep(400);
      check(F, '서버: 계정, 로그인 A/B, 세션, 기기, 합쳐진 계정 모두 지움. 앱 코인 그대로', sql(`SELECT count(*) FROM account WHERE id = ${acct} OR merged_into = ${acct}`) === '0' && sql(`SELECT count(*) FROM login WHERE sub IN ('${subA}')`) === '0' && (await localBalance()) === local0, `앱 ${await localBalance()}`);
      check(F, '칸: 서버 모드 꺼짐 글과 "서버 모드 켜기" 단추', (await boxText(p)).includes(T.turnOn));
      await p.shots('app-13-removed', '.server-box');
      check(F, '"서버 모드 켜기" 누름', await press(p, '.server-box', T.turnOn));
      await until('새 기기 계정', async () => {
        const s = await status();
        return s.device && s.balance !== null && !s.syncing;
      }, 20_000).catch(() => {});
      acct = myId();
      check(F, '켜기: 새 기기 계정, 지금 코인 다시 옮김', srvBalance() === (await localBalance()), `앱 ${await localBalance()} 서버 ${srvBalance()}`);
    }
    // --- 백업 되살리기: 코인은 서버 것 ---
    {
      const F = '백업 복원 코인';
      const file = join(h.scratch, 'qa.fairybackup');
      await h.main(`__jj.backup.exportFile(${JSON.stringify(file)}).then(() => 1)`);
      const backupBalance = await localBalance();
      await h.main(`(__jj.store.reward(3, 'rest', Date.now()), __jj.store.reward(3, 'rest', Date.now()), 1)`);
      await clickSync();
      const serverNow = srvBalance();
      check(F, '백업 뒤 번 코인이 서버에', serverNow === backupBalance + 6, `백업 ${backupBalance} 서버 ${serverNow}`);
      await h.main(`__jj.openBackupFile(${JSON.stringify(file)}).then(() => 1)`);
      await until('복원 확인 칸', () => p.ev(`!!document.querySelector('.restore-ask')`), 15_000);
      const ask = await p.ev(`document.querySelector('.restore-ask').innerText`);
      check(F, '확인 칸에 "코인과 산 물건은 서버 것을 따라" 안내', ask.includes(T.restoreServer), ask.slice(0, 160));
      await p.shots('app-14-restore-ask', '.restore-ask');
      const oldPid = h.child.pid;
      // 메인 디버거를 붙인 채 끝나면 node 가 디버거가 떨어지기를 기다리며 멈춘다: 누르기 전에 뗀다
      h.mainConn?.ws.close();
      h.mainConn = undefined;
      await sleep(300);
      check(F, '"바꾸기" 누름', await pressSel(p, '.restore-ask button.danger'));
      p.close();
      const gone = await until('앱 다시 켜짐(옛 프로세스 끝남)', () => { try { process.kill(oldPid, 0); return false; } catch { return true; } }, 60_000).catch(() => false);
      if (!gone) {
        h.mainConn = undefined;
        const alive = await Promise.race([h.main('JSON.stringify({ pid: process.pid, wins: process.getBuiltinModule("module").createRequire(process.cwd() + "/")("electron").BrowserWindow.getAllWindows().length })'), sleep(5000).then(() => 'no answer')]).catch((e) => String(e));
        throw new Error(`바꾸기 뒤 60초 동안 앱이 꺼지지 않음 (옛 pid ${oldPid}, 메인 ${alive})`);
      }
      h.mainConn = undefined;
      await until('새 __jj', async () => (await h.main('typeof __jj === "object"')) && (await h.main('process.pid')) !== oldPid, 60_000);
      h.pids.add(await h.main('process.pid'));
      const after = await localBalance();
      check(F, '다시 켠 뒤 앱 코인 = 서버 사본 (백업의 옛 코인 아님)', after === serverNow && after !== backupBalance, `앱 ${after}, 서버 ${serverNow}, 백업 ${backupBalance}`);
    }
  } catch (err) {
    check('앱', '중단', false, err instanceof Error ? err.message : String(err));
    try {
      const lines = readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
      console.log(`---- 앱 기록 끝 ----\n${lines.slice(-40).join('\n')}`);
    } catch {}
  } finally {
    await h.quit();
  }
}

let crashed = false;
try {
  await apiLayer();
  seen.length = 0;
  await noUrlPhase();
  seen.length = 0;
  await appPhase();
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
await stopApi();
await fake.close();
dropPg();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS${crashed ? ', 중단됨' : ''}  화면: ${OUT}`);
for (const r of bad) console.log(`  FAIL [${r.area}] ${r.name} (${r.extra})`);
process.exit(bad.length || crashed ? 1 : 0);
