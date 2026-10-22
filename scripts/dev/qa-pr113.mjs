// PR #113 (#101) QA: 이벤트, 쿠폰, 쪽지함, 닉네임과 기기 코드, 채팅 이용권 관리, 운영자 칸(앱)과 웹 /admin, 공지와 강제 업데이트.
// 세 층(API, 화면 클릭, 화면 모양)을 경우마다 PASS/FAIL 로 본다. server-events.mjs 가 __jj 손잡이로 대신한 것
// (쪽지 열기, 나이 바꾸기, 운영자 칸의 쓰기)을 화면 요소를 눌러 다시 하고, 앱 세 개(사용자, 둘째 기기, 운영자)를 차례로 띄운다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr113.mjs
//
// - 서버는 이 프로세스 안에서 server/dist 의 createApp 으로 띄운다 (가짜 구글: 시험 RSA 키, 가짜 Anthropic, 시계 주입)
// - 홈페이지 흉내: 이 컴퓨터 http 서버가 site/ 의 events.json, notices.json 과 가짜 최신 릴리스(v0.4.4)를 내준다
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만.
//   "복사" 단추는 메인의 clipboard.writeText 를 바꿔 끼워 진짜 클립보드를 건드리지 않는다
// - 컨테이너는 jj-qa113-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeAnthropic } from '../../server/scripts/fake-anthropic.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `qa-pr113-${LANG}`));
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

const results = [];
function check(area, name, ok, extra = '') {
  results.push({ area, name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${extra ? ` (${String(extra).replace(/\n/g, ' ').slice(0, 220)})` : ''}`);
}
const Q = (ko, en) => (LANG === 'en' ? en : ko);

// ---- 시험용 Postgres ----
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pgName = `jj-qa113-pg-${randomBytes(4).toString('hex')}`;
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

// ---- 홈페이지 흉내 ----
const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.qa113-'));
const site = join(scratchAll, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'events.json'), '{"version":1,"events":[]}\n');
writeFileSync(join(site, 'notices.json'), '{"version":1,"notices":[]}\n');
const LATEST = '0.4.4';
const stat = httpServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/latest') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: `v${LATEST}`, html_url: `https://github.com/milcho0604/fairy-releases/releases/v${LATEST}`, draft: false, prerelease: false, body: '', assets: [] }));
  }
  const name = u.pathname.replace(/^\//, '');
  if (name !== 'events.json' && name !== 'notices.json') {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('content-type', 'application/json');
  res.end(readFileSync(join(site, name)));
});
const staticPort = await freePort();
await new Promise((r) => stat.listen(staticPort, '127.0.0.1', r));
const staticUrl = `http://127.0.0.1:${staticPort}`;

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
const fakeGoogle = { exchangeCode: async () => idToken(google.sub, google.nonce), fetchJwks: async () => [jwk] };

// ---- 페어리 서버 (이 프로세스 안, 시계 주입) ----
const serverReq = createRequire(join(root, 'server', 'package.json'));
const { createApp } = serverReq('./dist/app.js');
const { readConfig } = serverReq('./dist/config.js');
const fake = await startFakeAnthropic();
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const ADMIN_SUB = `qa-admin-${randomBytes(4).toString('hex')}`;
let clockShift = 0;
const env = {
  DATABASE_URL: databaseUrl,
  PORT: String(apiPort),
  PUBLIC_URL: apiUrl,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'qa-secret',
  ANTHROPIC_API_KEY: 'sk-test-fake',
  ANTHROPIC_BASE_URL: fake.url,
  GIFT_HMAC_KEY: randomBytes(32).toString('hex'),
  ADMIN_TOKEN,
  ADMIN_GOOGLE_SUBS: ADMIN_SUB,
  RELEASES_API: `${staticUrl}/latest`,
};
const seen = [];
const nest = await createApp(readConfig(env), { google: fakeGoogle, now: () => Date.now() + clockShift });
nest.use((req, _res, next) => {
  seen.push(`${req.method} ${req.path}`);
  next();
});
await nest.listen(apiPort, '127.0.0.1');

// ---- API 도우미 ----
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function api(method, path, { token, body, from = ip(), raw = false, headers = {} } = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'cf-connecting-ip': from,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
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
const verifierNew = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
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
  return { done: cb.headers.get('location') ?? '' };
}
async function apiLogin(token, sub, merge) {
  const v = verifierNew();
  const f = await browserFlow(`${apiUrl}/auth/google/start?port=5000&state=qastate${randomBytes(4).toString('hex')}&challenge=${challengeOf(v)}`, sub);
  const code = new URL(f.done).searchParams.get('code');
  return api('POST', '/v1/session', { token, body: { code, verifier: v, ...(merge ? { merge } : {}) } });
}
const newDevice = async (age = '18+', nickname) => (await api('POST', '/v1/device', { body: { age, ...(nickname ? { nickname } : {}) } })).json;
/** 로그인한 18+ 계정 (API) */
async function newUser(nickname) {
  const d = await newDevice('18+', nickname);
  const s = await apiLogin(d.token, `qa-u-${randomBytes(4).toString('hex')}`);
  return { ...d, session: s.json.session, id: d.account.id, code: d.account.code };
}
const sse = (text) =>
  (text ?? '')
    .split('\n\n')
    .filter(Boolean)
    .map((b) => {
      const ev = /event: (.*)/.exec(b)?.[1];
      const data = /data: (.*)/.exec(b)?.[1];
      return { ev, data: data ? JSON.parse(data) : undefined };
    });
const kstInput = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);

// ---- 웹 운영자 (쿠키, CSRF) ----
const web = { cookie: '', csrf: '' };
async function adminPage(q = '') {
  const r = await fetch(`${apiUrl}/admin${q}`, { headers: { cookie: web.cookie } });
  const text = await r.text();
  web.csrf = /name="csrf" value="([^"]+)"/.exec(text)?.[1] ?? web.csrf;
  return { status: r.status, text, headers: r.headers };
}
async function adminPost(path, fields, { csrf = true, origin = apiUrl } = {}) {
  const form = new URLSearchParams(csrf ? { csrf: web.csrf } : {});
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) form.append(k, String(x));
  const r = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: web.cookie, ...(origin ? { origin } : {}) },
    body: form.toString(),
  });
  const setCookie = r.headers.get('set-cookie') ?? '';
  if (r.status === 303 && path === '/admin/login') web.cookie = setCookie.split(';')[0];
  const body = await r.text();
  if (r.status !== 303) return { status: r.status, flash: '', body, setCookie };
  const page = await adminPage();
  return { status: r.status, flash: /<p class="flash( error)?( wide)?" role="(?:status|alert)"(?: id="form-error")?>([^<]*)<\/p>/.exec(page.text)?.[3] ?? '', error: /<p class="flash error"/.test(page.text), setCookie };
}
/** 운영자 JSON (쿠키 + x-csrf-token) */
const adminJson = (action, body) =>
  api('POST', `/v1/admin/${action}`, { body, headers: { cookie: web.cookie, 'x-csrf-token': web.csrf, origin: apiUrl } });
const setMode = (mode) => adminJson('ai/mode', { mode, confirm: 'yes' });
/** Actions 와 같은 길 (이 프로세스가 서버라 따로 프로세스로, 기다리는 동안 막지 않게) */
const pullFeeds = (apiBase = apiUrl, dir = site) =>
  new Promise((r) => {
    const c = spawn(process.execPath, [join(root, 'scripts', 'site-feeds.mjs'), '--api', apiBase, '--site', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('exit', (code) => r({ code, out }));
  });

// ================= 1. API 층 =================
async function apiLayer() {
  const A = 'API';
  // 웹 로그인 (쿠키)
  {
    const login = await adminPage();
    check(A, 'GET /admin 로그인 폼 200, 보안 머리(CSP, nosniff, no-store, DENY)', login.status === 200 && /name="token"/.test(login.text) && /default-src 'none'/.test(login.headers.get('content-security-policy') ?? '') && login.headers.get('x-content-type-options') === 'nosniff' && login.headers.get('cache-control') === 'no-store' && login.headers.get('x-frame-options') === 'DENY');
    const wrong = await adminPost('/admin/login', { token: 'x'.repeat(48) }, { csrf: false });
    check(A, 'POST /admin/login 틀린 토큰 → 401', wrong.status === 401);
    const other = await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false, origin: 'https://evil.example' });
    check(A, 'POST /admin/login 다른 출처 → 403', other.status === 403);
    const ok = await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
    check(A, 'POST /admin/login → 303, __Host- 쿠키 HttpOnly Secure SameSite=Strict Path=/', ok.status === 303 && web.cookie.startsWith('__Host-fairy_admin=') && /HttpOnly/i.test(ok.setCookie) && /Secure/i.test(ok.setCookie) && /SameSite=Strict/i.test(ok.setCookie) && /Path=\//.test(ok.setCookie), ok.setCookie.replace(/=[^;]{8,}/, '=…'));
    const main = await adminPage();
    check(A, 'GET /admin 로그인 뒤 화면 + csrf 숨은 칸', main.status === 200 && web.csrf.length >= 16);
  }
  // CSRF 없는 POST
  {
    const noCsrf = await adminPost('/admin/ai/mode', { mode: 'off', confirm: 'yes' }, { csrf: false });
    check(A, '웹 POST CSRF 없음 → 403, 모드 그대로', noCsrf.status === 403 && sql(`SELECT COALESCE((SELECT mode FROM feature_flag WHERE key = 'ai_chat'), 'none')`) !== 'off', `${noCsrf.status} ${sql(`SELECT COALESCE((SELECT mode FROM feature_flag WHERE key = 'ai_chat'), 'none')`)}`);
    const badCsrf = await (async () => {
      const keep = web.csrf;
      web.csrf = 'x'.repeat(43);
      const r = await adminPost('/admin/ai/mode', { mode: 'off', confirm: 'yes' });
      web.csrf = keep;
      return r;
    })();
    check(A, '웹 POST 틀린 CSRF → 403', badCsrf.status === 403);
    const crossSite = await adminPost('/admin/ai/mode', { mode: 'off', confirm: 'yes' }, { origin: 'https://evil.example' });
    check(A, '웹 POST 다른 출처(CSRF 맞아도) → 403', crossSite.status === 403);
    const j = await api('POST', '/v1/admin/ai/mode', { body: { mode: 'off', confirm: 'yes' }, headers: { cookie: web.cookie } });
    check(A, 'JSON POST /v1/admin 쿠키만, x-csrf-token 없음 → 403 csrf', j.status === 403 && j.json?.error === 'csrf', `${j.status} ${JSON.stringify(j.json)}`);
    const none = await api('GET', '/v1/admin/overview');
    check(A, 'GET /v1/admin/overview 인증 없음 → 401 token', none.status === 401 && none.json?.error === 'token');
    const log = sql(`SELECT count(*) FROM admin_log WHERE action = 'csrf.fail'`);
    check(A, 'CSRF 실패가 운영 기록에 (csrf.fail)', Number(log) >= 3, log);
  }
  // 웹 쓰기 몇 개 (폼)
  {
    const pol = await adminPost('/admin/ai/policy', { seat_limit: '100', auto_monthly: '100' });
    check(A, '웹 POST /admin/ai/policy → 303 + 결과 글', pol.status === 303 && /정책/.test(pol.flash), pol.flash);
    const noConfirm = await adminPost('/admin/ai/mode', { mode: 'everyone' });
    check(A, '웹 위험 동작 확인 칸 없음 → 거절 글(error), 모드 그대로', noConfirm.status === 303 && noConfirm.error && /확인 칸/.test(noConfirm.flash), noConfirm.flash);
    const ev = await adminPost('/admin/events', { id: 'qa-web-ev', kind: 'gift', title_ko: '웹 선물', title_en: 'Web gift', body_ko: '웹에서 만든 선물', body_en: 'Made on the web', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), coins: 5 });
    check(A, '웹 POST /admin/events → 303 + "qa-web-ev"', ev.status === 303 && ev.flash.includes('qa-web-ev'), ev.flash);
    const xss = await adminPost('/admin/events', { id: 'qa-xss', kind: 'gift', title_ko: '<script>alert(1)</script>', title_en: '<b>x</b>', body_ko: 'x', body_en: 'x', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), coins: 1 });
    const page = (await adminPage()).text;
    check(A, '웹 화면 XSS: 제목의 <script> 는 글로 보인다', xss.status === 303 && !page.includes('<script>alert(1)</script>') && page.includes('&lt;script&gt;'));
    sql(`DELETE FROM event WHERE id = 'qa-xss'`);
  }
  // 기기 계정과 닉네임, 기기 코드
  const A1 = 'API 닉네임·코드';
  {
    const ok = await api('POST', '/v1/device', { body: { age: '18+', nickname: '  하늘  ' } });
    check(A1, 'device + nickname → 201 {token, account:{id, code, nickname}} 앞뒤 빈칸 깎음', ok.status === 201 && /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(ok.json?.account?.code ?? '') && ok.json.account.nickname === '하늘', JSON.stringify(ok.json?.account));
    const nfd = '하늘'; // 하늘 (풀어 쓴 자모)
    const n2 = await api('POST', '/v1/device', { body: { age: '18+', nickname: nfd } });
    check(A1, '닉네임 NFC 로 맞춤 (풀어 쓴 자모 → 하늘)', n2.json?.account?.nickname === '하늘' && sql(`SELECT nickname FROM account WHERE id = ${n2.json.account.id}`) === '하늘');
    for (const [nick, reason, why] of [['가', 'length', '1자'], ['가'.repeat(13), 'length', '13자'], ['a@b', 'at', '@'], ['a＠b', 'at', '전각 @'], ['x.com', 'url', '도메인'], ['https://a', 'url', '스킴'], ['a​b', 'chars', '폭 0 글자'], ['a\nb', 'chars', '줄바꿈'], [12, 'length', '숫자']]) {
      const r = await api('POST', '/v1/device', { body: { age: '18+', nickname: nick } });
      check(A1, `device 닉네임 ${why} → 400 nickname/${reason}`, r.status === 400 && r.json?.error === 'nickname' && r.json.reason === reason, `${r.status} ${JSON.stringify(r.json)}`);
    }
    const two = await api('POST', '/v1/device', { body: { age: '18+', nickname: '가나' } });
    const twelve = await api('POST', '/v1/device', { body: { age: '18+', nickname: '가'.repeat(12) } });
    check(A1, '닉네임 경계 2자, 12자 → 201', two.status === 201 && twelve.status === 201);
    const d = ok.json;
    const p = await api('PATCH', '/v1/account', { token: d.token, body: { nickname: 'Mr.Kim' } });
    check(A1, 'PATCH nickname "Mr.Kim" → 200 (점 들어간 이름은 됨)', p.status === 200 && p.json?.account?.nickname === 'Mr.Kim' && p.json.account.code === d.account.code, JSON.stringify(p.json));
    const pb = await api('PATCH', '/v1/account', { token: d.token, body: { nickname: 'www.naver' } });
    check(A1, 'PATCH nickname "www.naver" → 400 url', pb.status === 400 && pb.json?.reason === 'url');
    const me = await api('GET', '/v1/me', { token: d.token });
    check(A1, 'GET /v1/me 기기 → {account:{code, nickname}, admin:false}', me.status === 200 && me.json?.account?.code === d.account.code && me.json.account.nickname === 'Mr.Kim' && me.json.admin === false, JSON.stringify(me.json));
    const s = await api('POST', '/v1/sync', { token: d.token, body: { entries: [] } });
    check(A1, 'sync 응답에 account {id, code, nickname}, inbox 0', s.status === 200 && s.json?.account?.code === d.account.code && s.json.account.nickname === 'Mr.Kim' && s.json.inbox === 0, JSON.stringify({ a: s.json?.account, i: s.json?.inbox }));
    const codes = sql(`SELECT count(DISTINCT code) = count(*) FROM account`);
    check(A1, '기기 코드 유일', codes === 't');
    const raw = d.account.code.replace(/^F-|-/g, '');
    check(A1, '기기 코드는 토큰과 무관 (토큰 안에 코드 없음)', !d.token.toUpperCase().includes(raw));
  }
  // 선물
  const A2 = 'API 선물';
  {
    const mk = (id, extra = {}) => adminJson('events', { id, kind: 'gift', title_ko: '선물', title_en: 'Gift', body_ko: '선물 본문', body_en: 'Gift body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), coins: 10, ...extra });
    const m = await mk('qa-api-gift');
    check(A2, 'JSON POST /v1/admin/events (쿠키+csrf) → {ok, text}', m.status === 200 && m.json?.ok === true && m.json.text.includes('qa-api-gift'), JSON.stringify(m.json));
    await adminJson('events', { id: 'qa-api-boost', kind: 'boost', title_ko: '배수', title_en: 'Boost', body_ko: 'x', body_en: 'x', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), reasons: ['meet', 'focus'], times: 2 });
    await mk('qa-api-soon', { from: kstInput(Date.now() + 86_400_000), until: kstInput(Date.now() + 2 * 86_400_000) });
    await mk('qa-api-ended');
    sql(`UPDATE event SET starts_at = now() - interval '2 day', ends_at = now() - interval '1 day' WHERE id = 'qa-api-ended'`);
    const dev = await newDevice();
    const r0 = await api('POST', '/v1/claim', { token: dev.token, body: { event: 'qa-api-gift' } });
    check(A2, '기기 토큰 claim → 403 login_required (기본 로그인만)', r0.status === 403 && r0.json?.error === 'login_required', `${r0.status} ${JSON.stringify(r0.json)}`);
    const u = await newUser();
    const c = (event, token = u.session) => api('POST', '/v1/claim', { token, body: { event } });
    const ok = await c('qa-api-gift');
    check(A2, '세션 claim → 200 {coins:10, balance, tickets:0}', ok.status === 200 && ok.json?.coins === 10 && typeof ok.json.balance === 'number', JSON.stringify(ok.json));
    const again = await c('qa-api-gift');
    check(A2, '두 번째 → 409 already_claimed', again.status === 409 && again.json?.error === 'already_claimed');
    for (const [id, st, err] of [['qa-none', 404, 'no_event'], ['qa-api-boost', 409, 'not_gift'], ['qa-api-soon', 409, 'not_started'], ['qa-api-ended', 409, 'ended']]) {
      const r = await c(id);
      check(A2, `claim ${id} → ${st} ${err}`, r.status === st && r.json?.error === err, `${r.status} ${JSON.stringify(r.json)}`);
    }
    const bad = await c('../x');
    check(A2, 'claim id 모양 틀림 → 400 event', bad.status === 400 && bad.json?.error === 'event');
    const u2 = await newUser();
    const many = await Promise.all(Array.from({ length: 10 }, () => c('qa-api-gift', u2.session)));
    check(A2, '같은 계정 동시 10번 → 200 한 번, 장부 한 줄', many.filter((r) => r.status === 200).length === 1 && sql(`SELECT count(*) FROM coin_entry WHERE entry_id = 'claim:${u2.id}:qa-api-gift'`) === '1', many.map((r) => r.status).join(','));
  }
  // 쿠폰
  const A3 = 'API 쿠폰';
  {
    const labels = new Map();
    const mk = async (fields) => {
      const label = `qa-${randomBytes(4).toString('hex')}`;
      const r = await adminJson('coupons', { label, coins: 20, tickets: 0, max_uses: 10, until: kstInput(Date.now() + 86_400_000), ...fields });
      const c = /([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec(r.json?.text ?? '')?.[1];
      labels.set(c, label);
      return c;
    };
    const byCode = (c) => `label = '${labels.get(c)}'`;
    const code = await mk({});
    check(A3, '쿠폰 만들기 → 결과 글에 코드 한 번 (DB 에는 해시와 앞 4자만)', !!code && sql(`SELECT hint FROM coupon WHERE ${byCode(code)}`) === code.slice(0, 4) && !sql(`SELECT row_to_json(c)::text FROM coupon c WHERE ${byCode(code)}`).includes(code.replace(/-/g, '').slice(4)), code);
    const dev = await newDevice();
    const r0 = await api('POST', '/v1/coupon', { token: dev.token, body: { code } });
    check(A3, '기기 토큰 coupon → 403 login_required', r0.status === 403 && r0.json?.error === 'login_required');
    const u = await newUser();
    const cp = (c, token = u.session) => api('POST', '/v1/coupon', { token, body: { code: c } });
    const ok = await cp(code.toLowerCase().replace(/-/g, ' '));
    check(A3, '쿠폰 (소문자, 빈칸) → 200 {coins:20}', ok.status === 200 && ok.json?.coins === 20, JSON.stringify(ok.json));
    const again = await cp(code);
    check(A3, '같은 계정 두 번째 → 409 already_used', again.status === 409 && again.json?.error === 'already_used');
    const one = await mk({ max_uses: 1 });
    await cp(one, (await newUser()).session);
    const sold = await cp(one);
    check(A3, '상한 1 다른 계정이 씀 → 409 sold_out', sold.status === 409 && sold.json?.error === 'sold_out', JSON.stringify(sold.json));
    const old = await mk({});
    sql(`UPDATE coupon SET starts_at = now() - interval '2 day', ends_at = now() - interval '1 day' WHERE ${byCode(old)}`);
    const ended = await cp(old);
    check(A3, '기간 지남 → 409 ended', ended.status === 409 && ended.json?.error === 'ended');
    const soon = await mk({ from: kstInput(Date.now() + 86_400_000), until: kstInput(Date.now() + 2 * 86_400_000) });
    const ns = await cp(soon);
    check(A3, '시작 전 → 409 not_started', ns.status === 409 && ns.json?.error === 'not_started', JSON.stringify(ns.json));
    const shape = await cp('nope');
    check(A3, '모양 틀림 → 400 code', shape.status === 400 && shape.json?.error === 'code');
    const off = await mk({});
    const id = sql(`SELECT id FROM coupon WHERE ${byCode(off)}`);
    await adminJson('coupons/disable', { id, confirm: String(id) });
    const dis = await cp(off);
    check(A3, '꺼진 쿠폰 → 404 no_coupon', dis.status === 404 && dis.json?.error === 'no_coupon');
    const teen = await newDevice('14+');
    const ts = await apiLogin(teen.token, `qa-teen-${randomBytes(3).toString('hex')}`);
    const tk = await mk({ coins: 5, tickets: 3 });
    const teenUse = await cp(tk, ts.json.session);
    check(A3, '채팅 이용권 쿠폰을 14+ 계정 → 코인만, 이용권 0', teenUse.status === 200 && teenUse.json?.tickets === 0 && teenUse.json.coins === 5, JSON.stringify(teenUse.json));
    const lim = await newUser();
    const outs = [];
    for (let i = 0; i < 7; i++) outs.push((await cp(`ZZZZ-ZZZZ-ZZ${'23456789'[i]}${'23456789'[i]}`, lim.session)).status);
    check(A3, '틀린 코드 계정당 5번 넘음 → 429', outs.slice(0, 5).every((s) => s === 404) && outs.at(-1) === 429, outs.join(','));
    const cap = await mk({ max_uses: 3 });
    // 로그인은 차례로 (가짜 구글의 sub 칸을 같이 쓴다)
    const users = [];
    for (let i = 0; i < 8; i++) users.push(await newUser());
    const race = await Promise.all(users.map((x) => cp(cap, x.session)));
    check(A3, '상한 3에 8계정 동시 → 정확히 3, 나머지 sold_out', race.filter((r) => r.status === 200).length === 3 && race.filter((r) => r.json?.error === 'sold_out').length === 5 && sql(`SELECT used FROM coupon WHERE ${byCode(cap)}`) === '3', race.map((r) => `${r.status}:${r.json?.error ?? ''}`).join(','));
  }
  // 쪽지함
  const A4 = 'API 쪽지함';
  {
    const u = await newUser('쪽지받이');
    const send = (fields) => adminJson('notes', { account: u.code, ...fields });
    const s1 = await send({ coins: 15, chat_passes: 0, message: 'qa 쪽지', days: 30 });
    check(A4, '운영자 쪽지 (기기 코드로) → ok', s1.json?.ok === true && /쪽지 #\d+/.test(s1.json.text), JSON.stringify(s1.json));
    const bal0 = Number(sql(`SELECT balance FROM account WHERE id = ${u.id}`));
    const sy = await api('POST', '/v1/sync', { token: u.token, body: { entries: [] } });
    check(A4, 'sync inbox 1, 잔액 그대로 (열 때 준다)', sy.json?.inbox === 1 && Number(sql(`SELECT balance FROM account WHERE id = ${u.id}`)) === bal0);
    const l = await api('GET', '/v1/inbox', { token: u.token });
    const it = l.json?.items?.[0];
    check(A4, 'GET /v1/inbox → {items, next, unopened:1}', l.status === 200 && l.json.unopened === 1 && it?.coins === 15 && it.message === 'qa 쪽지' && !it.opened && 'next' in l.json, JSON.stringify(l.json).slice(0, 200));
    const other = await newUser();
    const theirs = await api('POST', `/v1/inbox/${it.id}/open`, { token: other.session });
    check(A4, '남의 쪽지 열기 → 404 no_note', theirs.status === 404 && theirs.json?.error === 'no_note');
    const d2 = await newDevice();
    const s2 = await apiLogin(d2.token, sql(`SELECT sub FROM login WHERE account_id = ${u.id}`));
    check(A4, '둘째 기기 같은 계정으로 로그인 (합쳐짐)', s2.status === 200 && s2.json?.account?.id === u.id, JSON.stringify(s2.json));
    const opens = await Promise.all(Array.from({ length: 10 }, (_, i) => api('POST', `/v1/inbox/${it.id}/open`, { token: i % 2 ? s2.json.session : u.token })));
    check(A4, '두 기기에서 동시 10번 열기 → 200 한 번, 409 나머지, 장부 한 줄', opens.filter((r) => r.status === 200).length === 1 && opens.filter((r) => r.status === 409).length === 9 && sql(`SELECT count(*) FROM coin_entry WHERE entry_id = 'inbox:${it.id}'`) === '1', opens.map((r) => r.status).join(','));
    check(A4, '열면 잔액 +15', Number(sql(`SELECT balance FROM account WHERE id = ${u.id}`)) === bal0 + 15);
    const l2 = await api('GET', '/v1/inbox', { token: s2.json.session });
    check(A4, '둘째 기기 목록: 같은 쪽지 opened {coins:15}, unopened 0', l2.json?.items?.[0]?.id === it.id && l2.json.items[0].opened?.coins === 15 && l2.json.unopened === 0, JSON.stringify(l2.json?.items?.[0]));
    const dup = await api('POST', `/v1/inbox/${it.id}/open`, { token: u.token });
    check(A4, '이미 연 쪽지 → 409 already_opened (+item)', dup.status === 409 && dup.json?.error === 'already_opened' && dup.json.item?.id === it.id);
    await send({ coins: 1, days: 1 });
    const expId = sql(`SELECT id FROM inbox WHERE account_id = ${u.id} ORDER BY id DESC LIMIT 1`);
    sql(`UPDATE inbox SET expires_at = now() - interval '1 minute' WHERE id = ${expId}`);
    const exp = await api('POST', `/v1/inbox/${expId}/open`, { token: u.token });
    check(A4, '만료 쪽지 → 410 expired', exp.status === 410 && exp.json?.error === 'expired');
    const badId = await api('POST', '/v1/inbox/abc/open', { token: u.token });
    check(A4, '쪽지 번호 모양 틀림 → 400 id', badId.status === 400 && badId.json?.error === 'id');
    const teen = await newDevice('14+');
    const tp = await adminJson('notes', { account: teen.account.code, chat_passes: 3 });
    check(A4, '14+ 계정에 채팅 이용권 쪽지 → 400 refused', tp.status === 400 && tp.json?.error === 'refused' && /18세/.test(tp.json.text), JSON.stringify(tp.json));
    const nobody = await adminJson('notes', { account: 'F-0000-0000', coins: 1 });
    check(A4, '없는 기기 코드 → 400 refused', nobody.status === 400 && /없는 계정/.test(nobody.json?.text ?? ''));
    for (let i = 0; i < 22; i++) await send({ message: `n${i}` });
    const p1 = await api('GET', '/v1/inbox', { token: u.token });
    const p2 = await api('GET', `/v1/inbox?before=${p1.json?.next}`, { token: u.token });
    check(A4, '쪽 나누기: 20개 + next → 다음 쪽', p1.json?.items?.length === 20 && typeof p1.json.next === 'number' && p2.json?.items?.length > 0 && p2.json.items[0].id < p1.json.items.at(-1).id, `${p1.json?.items?.length} next ${p1.json?.next} p2 ${p2.json?.items?.length}`);
    const bb = await api('GET', '/v1/inbox?before=-1', { token: u.token });
    check(A4, 'before 이상한 값 → 400 before', bb.status === 400 && bb.json?.error === 'before');
  }
  // 채팅 이용권 (모드, 자리, 차단, 구독, 본문, 거절)
  const A5 = 'API 채팅 이용권';
  {
    const st0 = sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`);
    check(A5, '기본 모드 allowlist, 첫 선물 끔', st0 === 'allowlist' && sql('SELECT first_gift FROM ai_setting WHERE id = 1') === 'f', `${st0}`);
    const u = await newUser(Q('이용권', 'PassUser'));
    const g = () => api('GET', '/v1/ai', { token: u.session });
    const na = await g();
    check(A5, 'allowlist + 목록에 없음 → 403 not_allowed', na.status === 403 && na.json?.error === 'not_allowed', `${na.status} ${JSON.stringify(na.json)}`);
    check(A5, '허용 안 된 계정은 구독도, 선물도 없음', sql(`SELECT count(*) FROM ai_subscription WHERE account_id = ${u.id}`) === '0' && sql(`SELECT count(*) FROM ai_ticket WHERE account_id = ${u.id}`) === '0');
    await setMode('off');
    const off = await g();
    check(A5, 'off → 503 ai_off', off.status === 503 && off.json?.error === 'ai_off');
    const modeNo = await adminJson('ai/mode', { mode: 'everyone' });
    check(A5, 'ai/mode confirm 없음 → 400 refused', modeNo.status === 400 && modeNo.json?.error === 'refused');
    await setMode('allowlist');
    const al = await adminJson('ai/allow', { account: u.code, allowed: true });
    check(A5, '허용 목록에 넣기 → ok', al.json?.ok === true, JSON.stringify(al.json));
    const ok = await g();
    check(A5, 'allowlist + 허용 → 200 {tickets, subscription {monthly:100, mode:fill, nextFill}}', ok.status === 200 && ok.json?.subscription?.monthly === 100 && ok.json.subscription.mode === 'fill' && /^\d{4}-\d{2}-01$/.test(ok.json.subscription.nextFill ?? ''), JSON.stringify(ok.json));
    const sy = await api('POST', '/v1/sync', { token: u.session, body: { entries: [] } });
    const inboxBefore = sy.json?.inbox;
    const l = await api('GET', '/v1/inbox', { token: u.session });
    const subNote = l.json?.items?.find((x) => x.kind === 'subscription');
    check(A5, '허용 계정 구독 → 이번 달 쪽지 (fillTo 100)', subNote?.fillTo === 100, JSON.stringify(l.json?.items?.[0]));
    check(A5, '구독 쪽지가 GET /v1/inbox 전에도 sync inbox 수에 보인다', inboxBefore >= 1, `GET /v1/ai 뒤 sync inbox=${inboxBefore} (쪽지는 GET /v1/inbox 나 매시 fillAll 에서 만들어짐)`);
    const op = await api('POST', `/v1/inbox/${subNote?.id}/open`, { token: u.session });
    check(A5, '구독 쪽지 열기 → 채팅 이용권 100장', op.status === 200 && Number(sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${u.id}`)) === 100, JSON.stringify(op.json?.item?.opened));
    const n0 = fake.calls.length;
    const chat = (content) => api('POST', '/v1/ai/chat', { token: u.session, body: { messages: [{ role: 'user', content }], lang: LANG }, raw: true });
    const q = await chat('hi');
    const evs = sse(q.text);
    check(A5, '질문 → done tickets 99', evs.at(-1)?.ev === 'done' && evs.at(-1).data.tickets === 99, q.text?.slice(-80));
    const body = fake.calls[n0]?.body ?? {};
    check(A5, '업스트림 본문: model claude-haiku-5-5, thinking disabled, effort low, max_tokens 600, 샘플링 값 없음', body.model === 'claude-haiku-5-5' && body.thinking?.type === 'disabled' && body.output_config?.effort === 'low' && body.max_tokens === 600 && body.stream === true && !('temperature' in body) && !('top_p' in body) && !('top_k' in body), JSON.stringify({ model: body.model, thinking: body.thinking, oc: body.output_config, max: body.max_tokens, keys: Object.keys(body) }));
    const rf = await chat('[[refusal]] x');
    const re = sse(rf.text);
    check(A5, '거절(refusal) → SSE error refusal, refunded, 99 그대로', re.at(-1)?.ev === 'error' && re.at(-1).data.error === 'refusal' && re.at(-1).data.refunded === true && Number(sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${u.id}`)) === 99, rf.text?.slice(-160));
    check(A5, '거절 사용량 줄: refunded', sql(`SELECT status FROM ai_usage WHERE account_id = ${u.id} ORDER BY id DESC LIMIT 1`) === 'refunded');
    const bl = await adminJson('ai/block', { account: u.code, blocked: true, confirm: u.code });
    const b = await g();
    check(A5, '차단 → 403 blocked', bl.json?.ok && b.status === 403 && b.json?.error === 'blocked');
    await adminJson('ai/block', { account: u.code, blocked: false });
    const used = Number(sql('SELECT count(*) FROM ai_subscription WHERE canceled_at IS NULL'));
    await adminJson('ai/policy', { seat_limit: String(used) });
    await setMode('everyone');
    const w = await newUser('대기');
    const wl = await api('GET', '/v1/ai', { token: w.session });
    check(A5, 'everyone + 자리 꽉 참 → 403 waitlisted, 대기 목록', wl.status === 403 && wl.json?.error === 'waitlisted' && sql(`SELECT count(*) FROM ai_waitlist WHERE account_id = ${w.id}`) === '1', `${wl.status} ${JSON.stringify(wl.json)}`);
    await setMode('allowlist');
    const full = await adminJson('ai/allow', { account: (await newUser()).code, allowed: true });
    check(A5, 'allowlist 에서 자리 없이 허용 → 거절 "자리가 없어요", 대기 목록에 넣음', full.status === 400 && /자리가 없어요/.test(full.json?.text ?? ''), JSON.stringify(full.json));
    const ov = await api('GET', '/v1/admin/overview', { headers: { cookie: web.cookie } });
    check(A5, 'overview 에 대기 목록 (먼저 온 순)', ov.json?.ai?.waitlist?.length >= 2 && ov.json.ai.waitlist[0].id === String(w.id), JSON.stringify(ov.json?.ai?.waitlist?.map((x) => x.id)));
    await adminJson('ai/policy', { seat_limit: '100' });
    // 정기 지급 (시계 주입, 월 경계)
    const s = await newUser('구독');
    const sub = await adminJson('ai/subscribe', { account: s.code, monthly: 5, mode: 'fill' });
    check(A5, 'ai/subscribe → ok, 이번 달 쪽지 바로', sub.json?.ok === true && sql(`SELECT count(*) FROM inbox WHERE account_id = ${s.id} AND kind = 'subscription'`) === '1', JSON.stringify(sub.json));
    const twice = await adminJson('ai/subscribe', { account: s.code, monthly: 5, mode: 'fill' });
    check(A5, '두 번 걸기 → 거절 (살아 있는 것은 하나)', twice.status === 400 && /이미/.test(twice.json?.text ?? ''));
    await Promise.all(Array.from({ length: 6 }, () => api('GET', '/v1/inbox', { token: s.session })));
    check(A5, '같은 달 동시 6번 → 쪽지 1장', sql(`SELECT count(*) FROM inbox WHERE account_id = ${s.id} AND kind = 'subscription'`) === '1');
    clockShift = 35 * 86_400_000;
    await Promise.all(Array.from({ length: 3 }, () => api('GET', '/v1/inbox', { token: s.session })));
    clockShift = 0;
    check(A5, '시계 35일 뒤 → 다음 달 쪽지 1장 더 (모두 2)', sql(`SELECT count(*) FROM inbox WHERE account_id = ${s.id} AND kind = 'subscription'`) === '2');
    const cancel = await adminJson('ai/cancel', { account: s.code, confirm: s.code });
    check(A5, 'ai/cancel → ok', cancel.json?.ok === true && sql(`SELECT count(*) FROM ai_subscription WHERE account_id = ${s.id} AND canceled_at IS NULL`) === '0');
    const rv0 = await adminJson('ai/revoke', { account: u.code, count: 1 });
    const rv = await adminJson('ai/revoke', { account: u.code, count: 1, confirm: 'yes' });
    const rvMax = await adminJson('ai/revoke', { account: u.code, count: 1000, confirm: 'yes' });
    check(A5, '회수: 확인 없음 거절, 1장 회수 98, 남은 것보다 많이 거절', rv0.status === 400 && rv.json?.ok && sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${u.id}`) === '98' && rvMax.status === 400, `${rv0.status} ${rv.json?.text} ${rvMax.json?.text}`);
    const lim = await adminJson('ai/limits', { budget_usd: '9999' });
    check(A5, '예산 .env 상한 넘음 → 거절', lim.status === 400 && /상한/.test(lim.json?.text ?? ''));
  }
  // 운영자 sub 세션 Bearer
  const A6 = 'API 운영자 세션';
  {
    const d = await newDevice();
    const notAdminDev = await api('GET', '/v1/admin/overview', { token: d.token });
    check(A6, '기기 토큰 Bearer → 403 not_admin', notAdminDev.status === 403 && notAdminDev.json?.error === 'not_admin');
    const u = await newUser();
    const nu = await api('GET', '/v1/admin/overview', { token: u.session });
    check(A6, '보통 세션 Bearer → 403 not_admin', nu.status === 403 && nu.json?.error === 'not_admin');
    const ad = await newDevice('18+', '운영자');
    const as = await apiLogin(ad.token, ADMIN_SUB);
    const me = await api('GET', '/v1/me', { token: as.json.session });
    check(A6, '운영자 sub 세션 GET /v1/me → admin true', me.json?.admin === true);
    const meDev = await api('GET', '/v1/me', { token: ad.token });
    check(A6, '같은 계정의 기기 토큰 → admin false', meDev.json?.admin === false);
    const ov = await api('GET', '/v1/admin/overview?q=쪽지받이', { token: as.json.session });
    check(A6, '운영자 세션 overview?q=닉네임 → 계정 하나 자세히', ov.status === 200 && ov.json?.account?.nickname === '쪽지받이', JSON.stringify(ov.json?.account ?? ov.json).slice(0, 160));
    const w = await api('POST', '/v1/admin/ai/policy', { token: as.json.session, body: { seat_limit: '100' } });
    check(A6, '운영자 세션 POST (csrf 없이 Bearer) → ok, 기록 actor account:<id>', w.json?.ok === true && sql(`SELECT actor FROM admin_log ORDER BY id DESC LIMIT 1`) === `account:${ad.account.id}`, JSON.stringify(w.json));
    const unknown = await api('POST', '/v1/admin/nope', { token: as.json.session, body: {} });
    check(A6, '없는 동작 → 404', unknown.status === 404);
    await api('DELETE', '/v1/session', { token: as.json.session });
    // 운영자 계정은 지운다 (앱 C 가 다시 만든다)
    sql(`DELETE FROM account WHERE id = ${ad.account.id}`);
  }
  // 정적 파일 내보내기
  const A7 = 'API 내보내기';
  {
    const n0 = await api('GET', '/v1/notices.json');
    check(A7, 'notices.json 저장 전 → 404 not_managed', n0.status === 404 && n0.json?.error === 'not_managed');
    const e = await api('GET', '/v1/events.json');
    check(A7, 'events.json → 200, Cache-Control public, max-age=60, version 1', e.status === 200 && e.headers.get('cache-control') === 'public, max-age=60' && e.json?.version === 1 && Array.isArray(e.json.events), e.headers.get('cache-control'));
    const keys = Object.keys(e.json?.events?.find((x) => x.id === 'qa-api-gift') ?? {});
    check(A7, 'events.json 에 쿠폰, 계정, 받은 수 같은 내부 값 없음', keys.length > 0 && !keys.some((k) => /claim|account|coupon|hash/i.test(k)), keys.join(','));
  }
}

// ================= 2. 정적 파일 길 (site-feeds) =================
async function feedsLayer() {
  const F = 'site-feeds';
  const dir = join(scratchAll, 'feeds');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.json'), 'OLD-E');
  writeFileSync(join(dir, 'notices.json'), 'OLD-N');
  const r1 = await pullFeeds(apiUrl, dir);
  check(F, '공지 404 + 이벤트 → 0, events.json 만 바뀜, notices 그대로', r1.code === 0 && readFileSync(join(dir, 'notices.json'), 'utf8') === 'OLD-N' && readFileSync(join(dir, 'events.json'), 'utf8').includes('qa-api-gift'), r1.out.trim());
  // 앱 읽기 코드로 다시 (src/shared 의 parseEvents)
  const { parseEvents } = await import('../../src/shared/site-events.ts');
  const parsed = parseEvents(readFileSync(join(dir, 'events.json'), 'utf8'));
  check(F, '내보낸 events.json 을 앱 parseEvents 가 하나도 안 버림', parsed && parsed.dropped === 0 && parsed.events.some((x) => x.id === 'qa-api-gift'), JSON.stringify({ n: parsed?.events?.length, d: parsed?.dropped }));
  // 깨진 것을 내주는 가짜 서버 → 1, 아무 파일도 안 씀
  const badPort = await freePort();
  let mode = 'bad-events';
  const bad = httpServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/events.json')
      return res.end(mode === 'bad-events' ? JSON.stringify({ version: 1, events: [{ id: 'x', kind: 'gift' }] }) : JSON.stringify({ version: 1, events: [] }));
    if (req.url === '/v1/notices.json') return res.end(mode === 'bad-notices' ? JSON.stringify({ version: 1, notices: [], minVersion: 'abc' }) : JSON.stringify({ version: 1, notices: [] }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => bad.listen(badPort, '127.0.0.1', r));
  writeFileSync(join(dir, 'events.json'), 'OLD-E');
  const r2 = await pullFeeds(`http://127.0.0.1:${badPort}`, dir);
  check(F, '앱이 버릴 이벤트 → 1, 파일 그대로', r2.code === 1 && readFileSync(join(dir, 'events.json'), 'utf8') === 'OLD-E' && readFileSync(join(dir, 'notices.json'), 'utf8') === 'OLD-N', r2.out.trim());
  mode = 'bad-notices';
  const r3 = await pullFeeds(`http://127.0.0.1:${badPort}`, dir);
  check(F, '이벤트는 맞고 공지 minVersion 이 깨짐 → 1, 이벤트 파일도 안 씀', r3.code === 1 && readFileSync(join(dir, 'events.json'), 'utf8') === 'OLD-E', r3.out.trim());
  bad.close();
  const r4 = await pullFeeds(`http://127.0.0.1:${badPort}`, dir);
  check(F, '서버 꺼짐 → 0, 아무것도 안 바꿈', r4.code === 0 && readFileSync(join(dir, 'events.json'), 'utf8') === 'OLD-E', r4.out.trim());
  // 워크플로 문법과 "실패하면 커밋 안 함"
  const yml = readFileSync(join(root, '.github', 'workflows', 'site-feeds.yml'), 'utf8');
  let parsedYml;
  try {
    parsedYml = createRequire(join(root, 'package.json'))('js-yaml').load(yml);
  } catch (e) {
    parsedYml = { error: String(e.message).slice(0, 120) };
  }
  const steps = parsedYml?.jobs?.pull?.steps ?? [];
  const commit = steps.find((s) => /커밋/.test(s.name ?? ''));
  check(F, 'site-feeds.yml YAML 로 읽힘, on schedule */10, job if FAIRY_API_LIVE', !parsedYml.error && parsedYml.on?.schedule?.[0]?.cron === '*/10 * * * *' && /vars\.FAIRY_API_LIVE == 'true'/.test(parsedYml.jobs?.pull?.if ?? ''), parsedYml.error ?? '');
  check(F, '커밋 단계 if 에 always()/failure() 없음 (검사 실패면 건너뜀), changed 가 있을 때만', commit && !/always\(\)|failure\(\)|continue-on-error/.test(JSON.stringify(commit)) && /steps\.feeds\.outputs\.changed != ''/.test(commit.if ?? '') && !steps.find((s) => s.id === 'feeds')?.['continue-on-error'], commit?.if);
  check(F, '권한은 contents, pull-requests 쓰기만, 새 비밀 없음', JSON.stringify(parsedYml.permissions) === JSON.stringify({ contents: 'write', 'pull-requests': 'write' }) && !/secrets\./.test(yml));
  try {
    execFileSync('actionlint', ['-version'], { stdio: 'ignore' });
    const out = (() => {
      try {
        return execFileSync('actionlint', [join(root, '.github', 'workflows', 'site-feeds.yml')], { encoding: 'utf8' });
      } catch (e) {
        return `${e.stdout}`;
      }
    })();
    check(F, 'actionlint 통과', out.trim() === '', out.slice(0, 200));
  } catch {
    console.log('  (actionlint 없음: YAML 읽기만 봄)');
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

const apps = [];
async function launch(name) {
  const inspect = await freePort();
  const pageP = await freePort();
  const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), `.qa113-${name}-`));
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
      JJ_SERVER_URL_OVERRIDE: apiUrl,
      JJ_EVENTS_URL: `${staticUrl}/events.json`,
      JJ_NOTICES_URL: `${staticUrl}/notices.json`,
      JJ_RELEASES_API: `${staticUrl}/latest`,
    },
    stdio: 'ignore',
  });
  const h = { name, child, scratch, data, exited: false, mainConn: undefined };
  apps.push(h);
  child.on('exit', () => {
    h.exited = true;
  });
  console.log(`app ${name} pid ${child.pid} inspect ${inspect} page ${pageP}`);
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
  h.page = async (pname, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${pageP}/json`)).json();
        const p = list.find((x) => x.type === 'page' && x.url.includes(`${pname}.html`));
        if (p) {
          const c = await connect(p.webSocketDebuggerUrl);
          const ev = async (expr) => {
            const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
            return m.result?.result?.value;
          };
          return { ev, send: c.send, close: () => c.ws.close(), shots: (file, sel) => shots(c, ev, file, sel) };
        }
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${pname}`);
  };
  h.quit = async () => {
    try {
      await h.main("(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()");
    } catch {}
    h.mainConn?.ws.close();
    for (let i = 0; i < 60 && !h.exited; i++) await sleep(250);
    const left = () => {
      try {
        return execFileSync('pgrep', ['-f', scratch], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
      } catch {
        return [];
      }
    };
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      for (const pid of new Set([child.pid, ...left()])) {
        try {
          process.kill(pid, sig);
        } catch {}
      }
      await sleep(1200);
    }
    if (left().length) check('정리', `앱 ${name} 프로세스가 남음`, false, left().join(','));
    for (let i = 0; i < 3; i++) {
      await sleep(600);
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  await until(`${name} __jj`, () => h.main('typeof __jj === "object"'), 60_000);
  // 브라우저 열기와 클립보드는 바꿔 끼운다 (진짜 브라우저, 진짜 클립보드를 건드리지 않는다)
  await h.main(`(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; }; globalThis.__qaClip = []; e.clipboard.writeText = (t) => { globalThis.__qaClip.push(t); }; return true; })()`);
  h.status = async () => JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
  h.balance = () => h.main('__jj.store.balance()');
  return h;
}

/** 밝은, 어두운 모드로 찍고 넘침, 영어판 한글, 줄표, 빈 단추, 영어 단수/복수를 본다 */
async function shots(c, ev, file, sel) {
  const issues = [];
  // 칸이 창보다 길면 (설정은 안쪽 칸이 스크롤) 잠깐 창을 길게 해서 칸 전체를 찍는다
  const tall = sel
    ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const s = el?.closest('section') ?? el; return s ? { h: Math.ceil(s.getBoundingClientRect().height), w: document.documentElement.clientWidth, vh: window.innerHeight } : null; })()`)
    : null;
  const grow = tall && tall.h + 120 > tall.vh;
  if (grow) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: tall.w, height: Math.min(tall.vh + tall.h + 200, 6000), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
  }
  for (const mode of ['light', 'dark']) {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await sleep(250);
    const box = sel
      ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const s = el?.closest('section') ?? el; if (!s) return null; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4 + window.scrollY), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, 6000) }; })()`)
      : null;
    await sleep(150);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 2 }, captureBeyondViewport: true } : {}) });
    writeFileSync(join(OUT, `${file}-${LANG}-${mode}.png`), Buffer.from(r.result.data, 'base64'));
  }
  await c.send('Emulation.setEmulatedMedia', { features: [] });
  if (grow) await c.send('Emulation.clearDeviceMetricsOverride');
  const a = await ev(`(() => {
    const el = ${sel ? `document.querySelector(${JSON.stringify(sel)})?.closest('section') ?? document.querySelector(${JSON.stringify(sel)})` : 'document.body'};
    if (!el) return { missing: true };
    const over = [...el.querySelectorAll('*')].filter((x) => { const cs = getComputedStyle(x); const rr = x.getBoundingClientRect(); if (rr.width <= 1 || rr.height <= 1 || (cs.position === 'absolute' && cs.clip !== 'auto')) return false; if (/(auto|scroll)/.test(cs.overflowX) || x.tagName === 'TEXTAREA' || x.tagName === 'INPUT' || x.tagName === 'SELECT') return false; return x.scrollWidth > x.clientWidth + 1 && cs.overflowX !== 'visible' ? true : rr.right > document.documentElement.clientWidth + 1; }).map((x) => (typeof x.className === 'string' && x.className) || x.tagName).slice(0, 5);
    const text = el.innerText.replace(/안녕! (나는 AI 야\\.|나는 )?|음\\.\\.\\./g, '');
    const emptyBtn = [...el.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length;
    const plural = (text.match(/\\b1 (coins|items|notes|unopened notes|chat passes|passes|tickets|questions|accounts)\\b/g) ?? []).slice(0, 4);
    return { over, hangul: (text.match(/[\\uAC00-\\uD7A3]+/g) ?? []).slice(0, 8), emdash: text.includes('\\u2014'), emptyBtn, plural };
  })()`);
  if (a?.missing) issues.push('요소 없음');
  else {
    if (a.over.length) issues.push(`넘침 ${a.over.join(',')}`);
    if (LANG === 'en' && a.hangul.length) issues.push(`영어판 한글 ${a.hangul.join(' ')}`);
    if (a.emdash) issues.push('줄표');
    if (a.emptyBtn) issues.push(`빈 단추 ${a.emptyBtn}`);
    if (LANG === 'en' && a.plural.length) issues.push(`단수인데 복수 ${a.plural.join(' | ')}`);
  }
  check('화면', `${file} (light, dark)`, issues.length === 0, issues.join('; ') || `${OUT}/${file}-${LANG}-{light,dark}.png`);
  return issues;
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
const soft = (p) => p.catch(() => false);

const T = {
  ko: {
    adult: '만 18세 이상', teen: '만 14세 이상 18세 미만', change: '나이 바꾸기', syncNow: '지금 맞추기', login: '구글로 로그인', logout: '로그아웃',
    start: '서버 모드 시작', nickChange: '닉네임 바꾸기', nickSave: '저장', copy: '복사', copied: '기기 코드를 복사했어.', nickSaved: '닉네임을 바꿨어.',
    errLength: '2자에서 12자 사이로 써 줘.', errAt: '@ 는 쓸 수 없어.', errUrl: '주소는 닉네임으로 쓸 수 없어.', errChars: '줄바꿈이나 보이지 않는 글자는 쓸 수 없어.',
    claim: '선물 받기', claimed: '받았어', couponUse: '쿠폰 쓰기', loginReq: '로그인하면 받을 수 있어', claimOk: '선물 코인 30개를 받았어!',
    cpShape: '코드 모양이 맞지 않아', cpNone: '없거나 꺼진 쿠폰이야.', cpUsed: '이미 쓴 쿠폰이야.', cpSold: '다 쓰인 쿠폰이야.', cpEnded: '기한이 지난 쿠폰이야.', cpOk: '쿠폰을 썼어!',
    ticket: '채팅 이용권', agree: '알겠어, 채팅 이용권 쓰기', send: '보내기', refusal: '답하지 않기로 했어', rules: '페어리 규칙', oldRules: '짝꿍 규칙',
    count: (n) => `채팅 이용권 ${n}장 남음`, waitlisted: '채팅 이용권 자리가 다 찼어', sub: '구독 중: 매달 100장',
    from: '운영자', openNow: '펼쳐 보기', got: '받았어: 코인 15개', inboxLine: '열지 않은 운영자 쪽지 1통', newBadge: '새 쪽지',
    mergeYes: '합치기', mergeOne: ['코인 1,', '산 물건 1개'],
    sure: '정말 할까? 한 번 더 눌러', modeSave: '모드 바꾸기', findGo: '찾기', subscribe: '정기 지급 걸기', cancelSub: '정기 지급 해지', revoke: '채팅 이용권 회수',
    noteSend: '쪽지 보내기', blockOn: '채팅 이용권 막기', blockOff: '막기 풀기', noticeSave: '공지 저장', saveVersions: '버전 저장', allowOn: '허용 목록에 넣기',
    gFeat: '기능 스위치: 채팅 이용권', gFind: '계정 찾기 (번호, 기기 코드, 닉네임)', gNotice: '공지와 업데이트', gLog: '운영 기록',
    lMonthly: '매달 장수', lCount: '회수 장수', lMsg: '쪽지 글 (200자)', lCoins: '코인', lMin: '최소 버전 (낮으면 잠금)', lRec: '권장 버전', lId: 'id', lTko: '제목 ko', lTen: '제목 en', lBko: '본문 ko', lBen: '본문 en', lKind: '종류',
  },
  en: {
    adult: '18 or older', teen: '14 to 17', change: 'Change age', syncNow: 'Sync now', login: 'Sign in with Google', logout: 'Sign out',
    start: 'Start server mode', nickChange: 'Change nickname', nickSave: 'Save', copy: 'Copy', copied: 'Device code copied.', nickSaved: 'Nickname changed.',
    errLength: 'Use 2 to 12 characters.', errAt: "@ isn't allowed.", errUrl: "Web addresses can't be nicknames.", errChars: "Line breaks and invisible characters aren't allowed.",
    claim: 'Get gift', claimed: 'Received', couponUse: 'Use coupon', loginReq: 'Sign in to get gifts', claimOk: 'You got 30 gift coins!',
    cpShape: "That code doesn't look right", cpNone: 'No such coupon, or it was turned off.', cpUsed: 'You already used this coupon.', cpSold: 'This coupon has run out.', cpEnded: 'This coupon has expired.', cpOk: 'Coupon used!',
    ticket: 'Chat pass', agree: 'Got it, use chat passes', send: 'Send', refusal: 'chose not to answer', rules: "Your fairy's rules", oldRules: 'jjakkung',
    count: (n) => `${n} ${n === 1 ? 'chat pass' : 'chat passes'} left`, waitlisted: 'All chat pass seats are taken', sub: 'Subscribed: 100 a month',
    from: 'Operator', openNow: 'Open', got: 'Received: 15 coins', inboxLine: '1 unopened note from the operator', newBadge: 'New',
    mergeYes: 'Merge', mergeOne: ['1 coin,', '1 item'],
    sure: 'Sure? Press again', modeSave: 'Change mode', findGo: 'Find', subscribe: 'Start subscription', cancelSub: 'Cancel subscription', revoke: 'Take back chat passes',
    noteSend: 'Send note', blockOn: 'Block chat passes', blockOff: 'Unblock', noticeSave: 'Save notice', saveVersions: 'Save versions', allowOn: 'Add to allowlist',
    gFeat: 'Feature switches: Chat passes', gFind: 'Find account (number, device code, nickname)', gNotice: 'Notices and updates', gLog: 'Operator log',
    lMonthly: 'Passes a month', lCount: 'How many', lMsg: 'Note text (200)', lCoins: 'Coins', lMin: 'Minimum version (lower is locked)', lRec: 'Recommended version', lId: 'id', lTko: 'Title ko', lTen: 'Title en', lBko: 'Body ko', lBen: 'Body en', lKind: 'Kind',
  },
}[LANG];

// ---- 화면 도우미 (CDP 로 요소를 찾아 누른다) ----
const press1 = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const press = async (p, scope, text, ms = 5000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await press1(p, scope, text)) return true;
    await sleep(250);
  }
  return false;
};
const pressSel = (p, sel) => p.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
/** React 입력 칸에 값 (네이티브 setter + input 사건) */
const typeInto = (p, sel, value) =>
  p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const boxText = (p) => p.ev(`document.querySelector('.server-box')?.innerText ?? ''`);
/** 설정 창 위쪽에 잠깐 뜨는 결과 글을 모두 모은다 */
const watchFlash = (p) =>
  p.ev(`(() => { window.__qaFlash = []; const grab = () => { const t = document.querySelector('header .saved')?.textContent?.trim(); if (t && window.__qaFlash.at(-1) !== t) window.__qaFlash.push(t); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`);
const flashes = (p) => p.ev('JSON.stringify(window.__qaFlash ?? [])').then((x) => JSON.parse(x));
const clearFlash = (p) => p.ev('(window.__qaFlash = [], 1)');
async function waitFlash(p, needle, ms = 10_000) {
  let got = [];
  await soft(until(`결과 글 ${needle}`, async () => (got = await flashes(p)).some((x) => x.includes(needle)), ms));
  return got.some((x) => x.includes(needle)) ? got.find((x) => x.includes(needle)) : `없음: ${got.join(' / ')}`;
}
/** 운영자 칸 묶음 안 */
const G = (title) => `[...document.querySelectorAll('.admin-group')].find((g) => g.querySelector(':scope > strong')?.textContent === ${JSON.stringify(title)})`;
const adminType = (p, group, label, value) =>
  p.ev(`(() => { const g = ${G(group)}; const l = [...(g?.querySelectorAll('label.admin-field') ?? [])].find((x) => x.querySelector('span')?.textContent === ${JSON.stringify(label)}); const el = l?.querySelector('input, select'); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
const adminPress1 = (p, group, text) =>
  p.ev(`(() => { const g = ${G(group)}; const b = [...(g?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const adminPress = async (p, group, text) => {
  for (let i = 0; i < 30; i++) {
    if (await adminPress1(p, group, text)) return true;
    await sleep(250);
  }
  return false;
};
/** 두 번 눌러야 하는 단추: 한 번 → "정말" 글로 바뀌고 서버는 그대로인지 → 한 번 더 */
async function adminSure(p, group, text, unchanged) {
  const first = await adminPress(p, group, text);
  await sleep(300);
  const armed = await p.ev(`(() => { const g = ${G(group)}; return [...(g?.querySelectorAll('button') ?? [])].some((x) => x.textContent.trim() === ${JSON.stringify(T.sure)}); })()`);
  const still = unchanged ? unchanged() : true;
  const second = armed && (await adminPress(p, group, T.sure));
  return { first, armed, still, second };
}

/** 구글 로그인 단추를 눌러 sub 로 들어간다 (브라우저 일은 이 스크립트가 fetch 로) */
async function clickLogin(h, p, sub) {
  await h.main('globalThis.__qaOpened = null');
  if (!(await press(p, '.server-box', T.login))) return false;
  let u;
  await until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000);
  const f = await browserFlow(u, sub);
  const r = await fetch(f.done).catch((e) => ({ status: String(e) }));
  return r.status === 200;
}
async function clickSync(h, p) {
  const before = (await h.status()).lastSyncAt;
  await press(p, '.server-box', T.syncNow, 10_000);
  await soft(until('맞추기 끝', async () => {
    const s = await h.status();
    return !s.syncing && (s.lastSyncAt !== before || s.problem);
  }, 20_000));
  await sleep(400);
}
/** 처음 켜기: 나이 → 닉네임 → 기기 계정 (모두 화면 단추) */
async function firstRun(h, p, F, nick, shotName) {
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  await sleep(300);
  const n0 = seen.length;
  check(F, '"만 18세 이상" 누르기', await press(p, '.server-box', T.adult));
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`), 10_000);
  check(F, '나이 답 뒤 닉네임 칸, 서버 요청 아직 0건', seen.length === n0 && seen.slice(n0).every((x) => !x.includes('/v1/device')), seen.slice(n0).join(','));
  if (shotName) await p.shots(shotName, '.server-nickname-step');
  await typeInto(p, '.server-nickname-step input', nick);
  check(F, '닉네임 넣고 "서버 모드 시작" 누르기', await press(p, '.server-box', T.start));
  await until('기기 계정', async () => {
    const s = await h.status();
    return s.device && s.code && !s.syncing;
  }, 30_000);
  const st = await h.status();
  const id = sql(`SELECT id FROM account WHERE code = '${st.code}'`);
  check(F, '기기 계정: DB 닉네임 = 넣은 것, 코드 = 앱 코드', !!id && sql(`SELECT nickname FROM account WHERE id = ${id}`) === nick, `${st.code} ${st.nickname}`);
  return id;
}
async function openSettings(h) {
  await h.main("__jj.settingsWindow.open('restore')");
  const p = await h.page('settings');
  await until('설정', () => p.ev(`!!document.querySelector('.settings')`));
  await watchFlash(p);
  return p;
}
async function openChat(h) {
  await h.main('__jj.chat.open(__jj.pet.bounds()); 1');
  const c = await h.page('chat');
  await until('채팅', () => c.ev(`!!document.querySelector('.picker-button')`));
  return c;
}
async function pickerItems(c) {
  await c.ev(`(() => { if (!document.querySelector('.picker-menu')) document.querySelector('.picker-button').click(); return 1; })()`);
  await sleep(300);
  const items = await c.ev(`[...document.querySelectorAll('.picker-menu [role=menuitemradio]')].map((b) => b.innerText.trim().replace(/\\n/g, ' '))`);
  await c.ev(`(() => { if (document.querySelector('.picker-menu')) document.querySelector('.picker-button').click(); return 1; })()`);
  await sleep(150);
  return items ?? [];
}
const hasTicket = async (c) => (await pickerItems(c)).some((x) => x.includes(T.ticket));
async function openPanel(h) {
  await h.main(`(__jj.panel.openTab ? __jj.panel.openTab('today') : __jj.panel.togglePanel(), 1)`);
  const panel = await h.page('panel');
  await soft(h.main(`(__jj.panel.window?.removeAllListeners?.('blur'), 1)`));
  await until('쪽지함', () => panel.ev(`!!document.querySelector('.note-box')`), 15_000);
  return panel;
}

// ================= 3. 앱 A: 사용자 =================
const USER_SUB = `qa-user-${randomBytes(4).toString('hex')}`;
let acctA;
async function appA() {
  const h = await launch('A');
  const NICK = Q('시험친구', 'Tester');
  try {
    const p = await openSettings(h);
    // --- 처음 켜기 + 닉네임 경계 (닉네임 단계에서) ---
    {
      const F = '처음 켜기';
      await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
      const seen0 = seen.length;
      await press(p, '.server-box', T.adult);
      await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`), 10_000);
      const warn = () => p.ev(`document.querySelector('.server-nickname-step .warn')?.textContent ?? ''`);
      for (const [v, want, why] of [['가', T.errLength, '1자'], ['가'.repeat(13), T.errLength, '13자'], ['a@b', T.errAt, '@'], ['abc.com', T.errUrl, '주소'], ['a​b', T.errChars, '폭 0 글자']]) {
        await typeInto(p, '.server-nickname-step input', v);
        await press(p, '.server-box', T.start);
        await sleep(200);
        check(F, `닉네임 ${why}: "서버 모드 시작" → 안내 "${want}", 서버 요청 없음`, (await warn()) === want && seen.length === seen0, `${await warn()} 요청 ${seen.slice(seen0).join(',')}`);
      }
      await p.shots('a01-nickname-error', '.server-nickname-step');
      check(F, '"나이 다시 고르기" 누르면 나이 답으로', (await press(p, '.server-box', Q('나이 다시 고르기', 'Pick age again'))) && (await soft(until('나이 답', () => p.ev(`!!document.querySelector('.server-ages')`), 5000))));
      acctA = await firstRun(h, p, F, NICK, 'a02-nickname');
      check(F, '요청: device(닉네임 같이) → migrate → sync', seen.includes('POST /v1/device') && seen.includes('POST /v1/migrate'), seen.slice(0, 6).join(','));
    }
    // --- 내 기기 코드와 복사 ---
    {
      const F = '기기 코드';
      const st = await h.status();
      const line = await p.ev(`document.querySelector('.server-code')?.textContent ?? ''`);
      check(F, '설정에 "내 기기 코드: F-XXXX-XXXX" (DB 코드)', line.includes(st.code) && line.includes(sql(`SELECT code FROM account WHERE id = ${acctA}`)), line);
      await clearFlash(p);
      const ok = await p.ev(`(() => { const b = document.querySelector('.server-code')?.parentElement?.querySelector('button'); if (!b) return false; b.click(); return b.textContent.trim(); })()`);
      await sleep(400);
      const clip = JSON.parse(await h.main('JSON.stringify(globalThis.__qaClip)'));
      check(F, `"${T.copy}" 누름 → 클립보드에 코드(바꿔 낀 것), 안내 글`, ok === T.copy && clip.at(-1) === st.code && (await waitFlash(p, T.copied)) === T.copied, `${ok} ${clip.at(-1)}`);
      await p.shots('a03-profile', '.server-code');
    }
    // --- 닉네임 바꾸기 (경계) ---
    {
      const F = '닉네임 바꾸기';
      check(F, `"${T.nickChange}" 누름 → 입력 칸`, (await press(p, '.server-profile', T.nickChange)) && (await soft(until('칸', () => p.ev(`!!document.querySelector('.server-profile input')`), 3000))));
      const warn = () => p.ev(`document.querySelector('.server-profile .warn')?.textContent ?? ''`);
      for (const [v, want, why] of [['가', T.errLength, '1자'], ['가'.repeat(13), T.errLength, '13자'], ['x@y', T.errAt, '@']]) {
        await typeInto(p, '.server-profile input', v);
        await press(p, '.server-profile', T.nickSave);
        await sleep(250);
        check(F, `${why} 저장 → "${want}", DB 그대로`, (await warn()) === want && sql(`SELECT nickname FROM account WHERE id = ${acctA}`) === NICK, await warn());
      }
      await p.shots('a04-nickname-change-error', '.server-profile');
      for (const v of ['가나', 'ABCDEFGHIJKL', NICK]) {
        if (!(await p.ev(`!!document.querySelector('.server-profile input')`))) await press(p, '.server-profile', T.nickChange);
        await clearFlash(p);
        await typeInto(p, '.server-profile input', v);
        await press(p, '.server-profile', T.nickSave);
        await soft(until('저장', async () => sql(`SELECT nickname FROM account WHERE id = ${acctA}`) === v, 8000));
        check(F, `"${v}" (${[...v].length}자) 저장 → DB, 줄 글, 안내`, sql(`SELECT nickname FROM account WHERE id = ${acctA}`) === v && (await soft(until('줄', async () => (await p.ev(`document.querySelector('.server-nick-line')?.textContent ?? ''`)).includes(v), 5000))) && (await waitFlash(p, T.nickSaved)) === T.nickSaved);
      }
    }
    // --- 기기 계정의 선물, 쿠폰 ---
    let gift, coupon1;
    {
      const F = '선물·쿠폰 (기기 계정)';
      gift = `gift-${randomBytes(3).toString('hex')}`;
      const made = await adminPost('/admin/events', { id: gift, kind: 'gift', title_ko: '가을 선물', title_en: 'Autumn gift', body_ko: '코인 30개를 선물로 줄게.', body_en: 'Here are 30 coins as a gift.', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 3 * 86_400_000), coins: 30 });
      check(F, '웹에서 선물 이벤트 만들기 → site-feeds → 앱 목록', made.flash.includes(gift) && (await pullFeeds()).code === 0);
      await h.main('__jj.siteEvents.refresh()');
      await until('이벤트 목록', () => p.ev(`[...document.querySelectorAll('.event-item')].some((x) => x.innerText.includes(${JSON.stringify(Q('가을 선물', 'Autumn gift'))}))`), 15_000);
      await clearFlash(p);
      const n0 = sql(`SELECT count(*) FROM event_claim WHERE account_id = ${acctA}`);
      check(F, `"${T.claim}" 누르기`, await p.ev(`(() => { const it = [...document.querySelectorAll('.event-item')].find((x) => x.innerText.includes(${JSON.stringify(Q('가을 선물', 'Autumn gift'))})); const b = [...(it?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(T.claim)}); if (!b) return false; b.click(); return true; })()`));
      const f = await waitFlash(p, T.loginReq);
      check(F, '기기 계정: "로그인하면 받을 수 있어" 안내, 받은 기록 없음', f.includes(T.loginReq) && sql(`SELECT count(*) FROM event_claim WHERE account_id = ${acctA}`) === n0, f);
      const c = await adminJson('coupons', { label: 'qa-app', coins: 20, tickets: 0, max_uses: 10, until: kstInput(Date.now() + 86_400_000) });
      coupon1 = /([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec(c.json?.text ?? '')?.[1];
      await sleep(2700); // 앞 결과 글(같은 글)이 사라진 뒤에 (같은 글이면 바뀜이 없어 못 잡는다)
      await clearFlash(p);
      await pressSel(p, '.coupon-input');
      await typeInto(p, '.coupon-input', coupon1);
      await press(p, '.events-box', T.couponUse);
      const f2 = await waitFlash(p, T.loginReq);
      check(F, '쿠폰 칸 누르고 입력 → "쿠폰 쓰기": 기기 계정 안내', f2.includes(T.loginReq) && sql(`SELECT count(*) FROM coupon_use WHERE account_id = ${acctA}`) === '0', f2);
      await p.shots('a05-events-device', '.events-box');
    }
    // --- 쪽지함: 운영자 지급 → 맞추기 → 펫이 건넴 → 펼쳐 보기 ---
    {
      const F = '쪽지함';
      const code = (await h.status()).code;
      const s = await adminPost('/admin/notes', { account: code, coins: 15, chat_passes: 0, message: Q('고마워, 운영자가', 'Thanks, from the operator'), days: 30 });
      check(F, '웹에서 쪽지 (코인 15, 기기 코드로)', /쪽지 #\d+/.test(s.flash), s.flash);
      const b0 = await h.balance();
      await clickSync(h, p);
      await soft(until('쪽지 수', async () => (await h.status()).inbox === 1, 10_000));
      const line = await p.ev(`document.querySelector('.server-inbox')?.textContent ?? ''`);
      check(F, '"지금 맞추기" → 설정에 안 연 쪽지 1통 안내, 잔액 그대로', line.includes(T.inboxLine) && (await h.balance()) === b0, line);
      await p.shots('a06-inbox-line', '.server-inbox');
      // 펫 말풍선
      const pet = await h.page('pet');
      const bubble = await soft(until('펫 쪽지 말풍선', () => pet.ev(`(() => { const b = document.getElementById('bubble'); return !b.hidden && [...b.querySelectorAll('.actions button')].some((x) => x.textContent.trim() === ${JSON.stringify(T.openNow)}); })()`), 30_000));
      const held = await h.main('__jj.dailyNotes.holding()');
      check(F, '펫이 쪽지를 들고 와 "펼쳐 보기" 말풍선', bubble === true && held === true, `말풍선 ${bubble} 듦 ${held} 글 ${await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`)}`);
      await pet.shots('a07-pet-bring');
      const noteId = sql(`SELECT id FROM inbox WHERE account_id = ${acctA} ORDER BY id DESC LIMIT 1`);
      if (bubble === true) {
        check(F, `말풍선 "${T.openNow}" 누르기`, await pet.ev(`(() => { const b = [...document.querySelectorAll('#bubble .actions button')].find((x) => x.textContent.trim() === ${JSON.stringify(T.openNow)}); if (!b) return false; b.click(); return true; })()`));
      } else {
        // 말풍선이 없으면 펫(캔버스)을 CDP 마우스로 누른다
        const pt = await pet.ev(`(() => { const c = document.getElementById('pet'); const g = c.getContext('2d'); const r = c.getBoundingClientRect(); const d = g.getImageData(0, 0, c.width, c.height).data; for (let y = c.height / 2 | 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 200) return { x: r.left + x * r.width / c.width, y: r.top + y * r.height / c.height }; return null; })()`);
        if (pt) {
          await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
          await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        }
        check(F, '펫 누르기 (CDP 마우스)', !!pt);
      }
      await soft(until('코인', async () => (await h.balance()) === b0 + 15, 15_000));
      check(F, '펼치면 코인 +15 (앱, 서버 열림 기록)', (await h.balance()) === b0 + 15 && sql(`SELECT opened_coins FROM inbox WHERE id = ${noteId}`) === '15', `앱 ${await h.balance()} 전 ${b0}`);
      const said = await soft(until('받은 말풍선', async () => (await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`)).includes(T.got), 8000));
      check(F, `펫 말풍선에 "${T.got}"`, said === true, await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`));
      await pet.shots('a08-pet-opened');
      pet.close();
      // 패널 쪽지함: 매일 쪽지와 섞임, 출처 표
      await h.main('__jj.dailyNotes.debugBring(); 1');
      const s2 = await adminJson('notes', { account: code, coins: 4, message: Q('두 번째 쪽지', 'Second note') });
      await clickSync(h, p);
      const panel = await openPanel(h);
      await soft(until('두 쪽지', () => panel.ev(`document.querySelectorAll('.note-item').length >= 3`), 15_000));
      await soft(panel.ev(`(() => { const b = document.querySelector('.note-more'); if (b) b.click(); return 1; })()`));
      await sleep(300);
      const items = JSON.parse(await panel.ev(`JSON.stringify([...document.querySelectorAll('.note-item')].map((li) => ({ title: li.querySelector('.note-title')?.textContent, from: li.querySelector('.note-from')?.textContent ?? null, fresh: !!li.querySelector('.note-new') })))`));
      const server = items.filter((x) => x.from === T.from);
      const daily = items.filter((x) => x.from === null);
      check(F, '패널 쪽지함: 운영자 쪽지 2(출처 표), 매일 쪽지(표 없음) 섞임', s2.json?.ok && server.length === 2 && daily.length >= 1, JSON.stringify(items));
      await panel.shots('a09-notebox', '.note-box');
      const second = sql(`SELECT id FROM inbox WHERE account_id = ${acctA} ORDER BY id DESC LIMIT 1`);
      const b1 = await h.balance();
      check(F, '두 번째 운영자 쪽지 머리 누르기', await panel.ev(`(() => { const li = [...document.querySelectorAll('.note-item')].find((x) => x.querySelector('.note-from') && x.querySelector('.note-new')); const b = li?.querySelector('.note-head'); if (!b) return false; b.click(); return true; })()`));
      await soft(until('코인 4', async () => (await h.balance()) === b1 + 4, 15_000));
      check(F, '쪽지함에서 열면 코인 +4, 서버 열림', (await h.balance()) === b1 + 4 && sql(`SELECT opened_coins FROM inbox WHERE id = ${second}`) === '4', `${await h.balance()} ${b1}`);
      // 다시 눌러도 두 번 안 준다
      await panel.ev(`(() => { const li = [...document.querySelectorAll('.note-item')].find((x) => x.querySelector('.note-from')); li?.querySelector('.note-head')?.click(); li?.querySelector('.note-head')?.click(); return 1; })()`);
      await h.main(`__jj.serverInbox.open('inbox:${second}').then(() => 1)`);
      await sleep(1500);
      check(F, '같은 쪽지 다시 열기 → 코인 그대로 (한 번만)', (await h.balance()) === b1 + 4 && sql(`SELECT count(*) FROM coin_entry WHERE entry_id = 'inbox:${second}'`) === '1');
      await soft(until('열림 줄', () => panel.ev(`[...document.querySelectorAll('.note-paper p')].some((x) => x.textContent.includes(${JSON.stringify(Q('받았어: 코인 4개', 'Received: 4 coins'))}))`), 8000));
      const read = JSON.parse(await panel.ev(`JSON.stringify([...document.querySelectorAll('.note-item')].filter((li) => li.querySelector('.note-from')).map((li) => !li.querySelector('.note-new')))`));
      check(F, '연 운영자 쪽지 둘 다 "새 쪽지" 표 없음, 받은 것 줄', read.length === 2 && read.every(Boolean), JSON.stringify(read));
      await panel.shots('a10-notebox-opened', '.note-box');
      panel.close();
    }
    // --- 로그인 계정의 선물과 쿠폰 ---
    {
      const F = '선물·쿠폰 (로그인)';
      check(F, '"구글로 로그인" 누름', await clickLogin(h, p, USER_SUB));
      await soft(until('로그인', async () => (await h.status()).signedIn, 15_000));
      check(F, '로그인됨 (같은 계정)', (await h.status()).signedIn && sql(`SELECT account_id FROM login WHERE sub = '${USER_SUB}'`) === acctA);
      const b0 = await h.balance();
      await clearFlash(p);
      const pressGift = () => p.ev(`(() => { const it = [...document.querySelectorAll('.event-item')].find((x) => x.innerText.includes(${JSON.stringify(Q('가을 선물', 'Autumn gift'))})); const b = [...(it?.querySelectorAll('button') ?? [])][0]; if (!b) return 'none'; if (b.disabled) return 'disabled:' + b.textContent.trim(); b.click(); return 'clicked'; })()`);
      check(F, `"${T.claim}" 누르기`, (await pressGift()) === 'clicked');
      await soft(until('선물', async () => (await h.balance()) === b0 + 30, 15_000));
      check(F, '선물 30 코인 (앱, 서버 기록), 안내 글', (await h.balance()) === b0 + 30 && sql(`SELECT coins FROM event_claim WHERE account_id = ${acctA} AND event_id = '${gift}'`) === '30' && (await waitFlash(p, T.claimOk)) === T.claimOk);
      await sleep(500);
      const again = await pressGift();
      check(F, `단추가 "${T.claimed}"(꺼짐)로, 두 번째 누르기 불가`, again === `disabled:${T.claimed}`, again);
      const tries = async (codeText, want) => {
        await clearFlash(p);
        await pressSel(p, '.coupon-input');
        await typeInto(p, '.coupon-input', codeText);
        await press(p, '.events-box', T.couponUse);
        return waitFlash(p, want);
      };
      check(F, '쿠폰 모양 틀림 → 안내', (await tries('abc', T.cpShape)).includes(T.cpShape));
      check(F, '없는 쿠폰 → "없거나 꺼진 쿠폰"', (await tries('ZZZZ-ZZZZ-ZZZZ', T.cpNone)) === T.cpNone);
      const b1 = await h.balance();
      const okText = await tries(coupon1.toLowerCase(), T.cpOk);
      await soft(until('쿠폰 코인', async () => (await h.balance()) === b1 + 20, 10_000));
      check(F, '쿠폰 (소문자로 입력) → 받은 글, 코인 +20, 칸 비움', okText.includes(T.cpOk) && (await h.balance()) === b1 + 20 && (await p.ev(`document.querySelector('.coupon-input').value`)) === '', okText);
      check(F, '같은 쿠폰 다시 → "이미 쓴 쿠폰"', (await tries(coupon1, T.cpUsed)) === T.cpUsed);
      const one = /([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec((await adminJson('coupons', { label: 'qa-one', coins: 3, max_uses: 1, until: kstInput(Date.now() + 86_400_000) })).json?.text ?? '')?.[1];
      await api('POST', '/v1/coupon', { token: (await newUser()).session, body: { code: one } });
      check(F, '다 쓰인 쿠폰 → "다 쓰인 쿠폰"', (await tries(one, T.cpSold)) === T.cpSold);
      const old = /([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec((await adminJson('coupons', { label: 'qa-old', coins: 3, max_uses: 5, until: kstInput(Date.now() + 86_400_000) })).json?.text ?? '')?.[1];
      sql(`UPDATE coupon SET starts_at = now() - interval '2 day', ends_at = now() - interval '1 day' WHERE label = 'qa-old'`);
      check(F, '기간 지난 쿠폰 → "기한이 지난 쿠폰"', (await tries(old, T.cpEnded)) === T.cpEnded);
      await p.shots('a11-events-signed-in', '.events-box');
    }
    // --- 채팅 이용권: 모드별 목록, 구독 쪽지, 차감, 거절, 본문, 14~17 ---
    {
      const F = '채팅 이용권';
      const c = await openChat(h);
      await setMode('allowlist');
      await clickSync(h, p);
      check(F, 'allowlist + 허용 안 됨: 앱 목록에 없음, 설정에 이용권 글 없음', !(await hasTicket(c)) && (await h.status()).ai === false);
      await setMode('off');
      await clickSync(h, p);
      check(F, 'off: 앱 목록에 없음', !(await hasTicket(c)) && (await h.status()).ai === false);
      await adminJson('ai/allow', { account: (await h.status()).code, allowed: true });
      await setMode('allowlist');
      await clickSync(h, p);
      await soft(until('목록', () => hasTicket(c), 10_000));
      check(F, 'allowlist + 허용: 앱 목록에 "채팅 이용권"', await hasTicket(c));
      // 구독 쪽지 (허용하면 매달 100장까지 채우기가 저절로)
      const subId = await soft(until('구독 쪽지', async () => sql(`SELECT id FROM inbox WHERE account_id = ${acctA} AND kind = 'subscription'`) !== '', 5000));
      const appGot = await soft(until('앱 쪽지 수', async () => (await h.status()).inbox >= 1, 8000));
      check(F, '허용된 뒤 구독 쪽지가 "지금 맞추기" 한 번으로 앱에 닿는다', subId === true && appGot === true, `DB 쪽지 ${sql(`SELECT count(*) FROM inbox WHERE account_id = ${acctA} AND kind = 'subscription'`)} 앱 inbox ${(await h.status()).inbox}`);
      if (appGot !== true) {
        await clickSync(h, p);
        const second = await soft(until('앱 쪽지 수 2', async () => (await h.status()).inbox >= 1, 8000));
        console.log(`  참고: "지금 맞추기" 두 번째에 앱 inbox ${(await h.status()).inbox} (${second === true ? '닿음' : '안 닿음'})`);
      }
      if (appGot !== true) {
        // 쪽지함 받기(GET /v1/inbox)가 쪽지를 만든다: 앱의 쪽지함 받기를 한 번 부른다 (상태 준비)
        await h.main('__jj.serverInbox.refresh().then(() => 1)');
        await h.main('__jj.dailyNotes.changed(); 1');
      }
      const panel = await openPanel(h);
      await soft(until('구독 쪽지 칸', () => panel.ev(`[...document.querySelectorAll('.note-item')].some((x) => x.innerText.includes(${JSON.stringify(Q('이번 달 채팅 이용권', "This month's chat passes"))}))`), 15_000));
      check(F, '구독 쪽지 (이번 달 채팅 이용권) 머리 누르기', await panel.ev(`(() => { const li = [...document.querySelectorAll('.note-item')].find((x) => x.innerText.includes(${JSON.stringify(Q('이번 달 채팅 이용권', "This month's chat passes"))})); const b = li?.querySelector('.note-head'); if (!b) return false; b.click(); return true; })()`));
      await soft(until('100장', async () => sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${acctA}`) === '100', 15_000));
      check(F, '구독 쪽지 열기 → 채팅 이용권 100장 (서버)', sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${acctA}`) === '100');
      await panel.shots('a12-sub-note', '.note-box');
      panel.close();
      await clickSync(h, p);
      await soft(until('구독 줄', async () => (await boxText(p)).includes(T.sub), 8000));
      check(F, `설정에 "${T.sub}" 줄`, (await boxText(p)).includes(T.sub), (await boxText(p)).slice(0, 300));
      await p.shots('a13-server-box-sub', '.server-box');
      await setMode('everyone');
      await clickSync(h, p);
      check(F, 'everyone: 앱 목록에 "채팅 이용권"', await hasTicket(c));
      // 질문
      const pick = async () => {
        await pressSel(c, '.picker-button');
        await sleep(300);
        return c.ev(`(() => { const b = [...document.querySelectorAll('.picker-menu [role=menuitemradio]')].find((x) => x.innerText.includes(${JSON.stringify(T.ticket)})); if (!b) return false; b.click(); return true; })()`);
      };
      check(F, `AI 고르기 → "${T.ticket}"`, await pick());
      await until('이용권 줄', () => c.ev(`!!document.querySelector('.ticket-bar')`));
      const notice = await c.ev(`document.querySelector('.ticket-notice')?.innerText ?? ''`);
      check(F, `국외 이전 안내에 "${T.rules}", 옛 이름 없음`, notice.includes(T.rules) && !notice.includes(T.oldRules) && !notice.includes('짝꿍'), notice.slice(0, 160));
      await c.shots('a14-ticket-notice');
      await press(c, '.ticket-notice', T.agree);
      await until('안내 닫힘', async () => !(await c.ev(`!!document.querySelector('.ticket-notice')`)));
      const type = (text) => c.ev(`(() => { const ta = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      const sendQ = async (text) => {
        await type(text);
        await sleep(150);
        const ok = await press(c, '.composer', T.send);
        await soft(until('답 끝', async () => {
          const st = JSON.parse(await h.main('JSON.stringify(__jj.chat.debugState)'));
          return ok && !st.pendingId && ['done', 'error'].includes(st.messages.at(-1)?.status);
        }, 40_000));
        await sleep(500);
        return ok;
      };
      const lastMsg = () => c.ev(`[...document.querySelectorAll('.msg')].at(-1)?.innerText ?? ''`);
      const remain = () => Number(sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${acctA}`));
      const n0 = fake.calls.length;
      check(F, '질문 쓰고 "보내기" 누름', await sendQ(Q('안녕', 'hello')));
      check(F, '답 화면, 차감 99 (DB, 줄)', (await lastMsg()).includes('안녕! 나는 AI 야.') && remain() === 99 && (await c.ev(`document.querySelector('.ticket-count')?.innerText ?? ''`)).includes(T.count(99)), `${remain()} ${await c.ev(`document.querySelector('.ticket-count')?.innerText ?? ''`)}`);
      const body = fake.calls[n0]?.body ?? {};
      check(F, '앱 질문이 서버를 거쳐 간 본문: model claude-haiku-5-5, thinking disabled, effort low', body.model === 'claude-haiku-5-5' && body.thinking?.type === 'disabled' && body.output_config?.effort === 'low' && !('temperature' in body), JSON.stringify({ m: body.model, t: body.thinking, o: body.output_config }));
      await sendQ(`[[refusal]] ${Q('이상한 질문', 'odd question')}`);
      const rmsg = await lastMsg();
      check(F, '거절: 안내 글, 이용권 되돌림 (99)', rmsg.includes(T.refusal) && remain() === 99, rmsg.slice(-120));
      await c.shots('a15-ticket-refusal');
      // en 단수: 2장 → 질문 → 1장
      sql(`UPDATE ai_ticket SET remaining = 2 WHERE account_id = ${acctA}`);
      await clickSync(h, p);
      await sendQ(Q('하나 남기기', 'leave one'));
      const cnt = await c.ev(`document.querySelector('.ticket-count')?.innerText ?? ''`);
      check(F, `남은 1장 줄 "${T.count(1)}"`, remain() === 1 && cnt.includes(T.count(1)), cnt);
      await c.shots('a16-ticket-one');
      // 설정 chat pass 묶음의 장수는 한 줄 (#121): 줄 전체가 단수 글이어야 한다 (1 chat passes 는 안 됨)
      const oneLine = (txt) => txt.split('\n').some((x) => x.trim() === Q('AI 채팅 이용권 1장', '1 chat pass'));
      await soft(until('설정 1장', async () => oneLine(await boxText(p)), 8000));
      check(F, '설정 이용권 글도 1장 (en 단수)', oneLine(await boxText(p)), (await boxText(p)).slice(0, 400));
      // 차단 → 목록에서 사라짐
      await adminJson('ai/block', { account: (await h.status()).code, blocked: true, confirm: (await h.status()).code });
      await clickSync(h, p);
      await soft(until('사라짐', async () => !(await hasTicket(c)), 10_000));
      check(F, '운영자가 막음: 열린 창 목록에서 사라지고 골라 둔 것은 기본 AI 로', !(await hasTicket(c)) && (await h.main('__jj.chat.debugState.provider')) !== 'fairy-ticket', await h.main('__jj.chat.debugState.provider'));
      await adminJson('ai/block', { account: (await h.status()).code, blocked: false });
      sql(`UPDATE ai_ticket SET remaining = 50 WHERE account_id = ${acctA}`);
      await clickSync(h, p);
      await soft(until('돌아옴', () => hasTicket(c), 10_000));
      check(F, '풀면 다시 목록에', await hasTicket(c));
      await pick();
      await sleep(500);
      // 14~17: 설정에서 눌러 바꾼다 (열린 채팅 창)
      check(F, '설정 "나이 바꾸기" → "만 14세 이상 18세 미만"', (await press(p, '.server-box', T.change)) && (await sleep(200), await press(p, '.server-box', T.teen)));
      await soft(until('숨김', async () => (await h.status()).ai === false, 15_000));
      await soft(until('서버 14+', async () => sql(`SELECT age FROM account WHERE id = ${acctA}`) === '14+', 15_000));
      await soft(until('목록에서 빠짐', async () => !(await hasTicket(c)), 10_000));
      const items = await pickerItems(c);
      check(F, '14~17: 열린 채팅 창의 목록에서 사라짐 (앞선 FAIL 고침)', !items.some((x) => x.includes(T.ticket)) && !(await c.ev(`!!document.querySelector('.ticket-bar')`)), items.join(' | '));
      check(F, '14~17: 골라 둔 것은 기본 AI 로', (await h.main('__jj.chat.debugState.provider')) !== 'fairy-ticket', await h.main('__jj.chat.debugState.provider'));
      await c.shots('a17-teen-chat');
      await press(p, '.server-box', T.change);
      await sleep(200);
      await press(p, '.server-box', T.adult);
      await soft(until('다시 18+', async () => (await h.status()).ai === true, 20_000));
      check(F, '다시 18+ → 목록에 돌아옴', (await h.status()).ai === true && (await soft(until('목록', () => hasTicket(c), 10_000))) === true);
      c.close();
    }
    check('운영자 칸', '앱 A(운영자 아님): 설정에 운영자 칸 DOM 없음', (await p.ev(`document.querySelector('.admin-box') === null && ![...document.querySelectorAll('section h2, section h3')].some((x) => x.textContent === ${JSON.stringify(Q('운영자', 'Operator'))})`)) === true && (await h.status()).admin === false);
    await p.shots('a18-data-tab', '.events-box');
    p.close();
  } catch (err) {
    check('앱 A', '중단', false, err instanceof Error ? err.message : String(err));
    try {
      console.log(readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').slice(-30).join('\n'));
    } catch {}
  } finally {
    await h.quit();
  }
}

// ================= 4. 앱 B: 둘째 기기 (대기, 합치기, 열림 표시) =================
async function appB() {
  const h = await launch('B');
  try {
    const p = await openSettings(h);
    const F = '둘째 기기';
    const idB = await firstRun(h, p, F, Q('둘째기기', 'Second'), undefined);
    // 대기: everyone, 자리 꽉 참, 처음 로그인
    const used = Number(sql('SELECT count(*) FROM ai_subscription WHERE canceled_at IS NULL'));
    await adminJson('ai/policy', { seat_limit: String(used) });
    await setMode('everyone');
    const sub2 = `qa-b-${randomBytes(4).toString('hex')}`;
    check(F, '"구글로 로그인" (새 구글 계정)', await clickLogin(h, p, sub2));
    await soft(until('대기', async () => (await h.status()).aiWaitlisted === true, 15_000));
    await soft(until('대기 글', async () => (await boxText(p)).includes(T.waitlisted), 8000));
    check(F, '자리 꽉 참: 설정에 대기 안내, 대기 목록 DB', (await boxText(p)).includes(T.waitlisted) && sql(`SELECT count(*) FROM ai_waitlist WHERE account_id = ${idB}`) === '1', (await boxText(p)).slice(0, 300));
    await p.shots('b01-waitlisted', '.server-box');
    await adminJson('ai/policy', { seat_limit: '100' });
    // 로그아웃 → 코인 1, 물건 1 → 사용자 구글 계정 → 합치기 확인 (en 단수)
    await press(p, '.server-box', T.logout);
    await soft(until('로그아웃', async () => !(await h.status()).signedIn, 10_000));
    sql(`UPDATE account SET balance = 1 WHERE id = ${idB}`);
    sql(`DELETE FROM owned_item WHERE account_id = ${idB}`);
    sql(`INSERT INTO owned_item (account_id, item, count) VALUES (${idB}, 'toy:ball', 1)`);
    await clickLogin(h, p, USER_SUB);
    await soft(until('합치기 창', () => p.ev(`!!document.querySelector('.server-merge')`), 15_000));
    const ask = await p.ev(`document.querySelector('.server-merge')?.innerText ?? ''`);
    check(F, `합치기 확인: 지금 계정 "${T.mergeOne.join(' ')}" (단수)`, T.mergeOne.every((x) => ask.includes(x)), ask.replace(/\n/g, ' / ').slice(0, 240));
    await p.shots('b02-merge', '.server-box');
    check(F, `"${T.mergeYes}" 누름`, await press(p, '.server-merge', T.mergeYes));
    await soft(until('합침', async () => (await h.status()).signedIn, 15_000));
    await clickSync(h, p);
    check(F, '합침: 사용자 계정과 한 가족 (둘째 기기에서 같은 쪽지함)', sql(`SELECT count(*) FROM account WHERE id = ${acctA} AND merged_into = ${idB}`) === '1' || sql(`SELECT count(*) FROM account WHERE id = ${idB} AND merged_into = ${acctA}`) === '1');
    // 쪽지함: 앱 A 에서 연 쪽지가 "열림"으로
    await h.main('__jj.serverInbox.refresh().then(() => 1)');
    const panel = await openPanel(h);
    await soft(until('운영자 쪽지', () => panel.ev(`[...document.querySelectorAll('.note-item')].filter((li) => li.querySelector('.note-from')).length >= 2`), 20_000));
    await soft(panel.ev(`(() => { const b = document.querySelector('.note-more'); if (b) b.click(); return 1; })()`));
    await sleep(300);
    const rows = JSON.parse(await panel.ev(`JSON.stringify([...document.querySelectorAll('.note-item')].filter((li) => li.querySelector('.note-from')).map((li) => ({ t: li.querySelector('.note-title')?.textContent, fresh: !!li.querySelector('.note-new') })))`));
    const opened = rows.filter((r) => !r.fresh);
    check(F, '둘째 기기 쪽지함: 앱 A 에서 연 운영자 쪽지 3통이 "새 쪽지" 표 없이 (열림)', opened.length >= 3, JSON.stringify(rows));
    const b0 = await h.balance();
    await panel.ev(`(() => { const li = [...document.querySelectorAll('.note-item')].find((x) => x.querySelector('.note-from') && !x.querySelector('.note-new')); li?.querySelector('.note-head')?.click(); return 1; })()`);
    await sleep(600);
    const paper = await panel.ev(`document.querySelector('.note-paper')?.innerText ?? ''`);
    await sleep(1500);
    check(F, '연 쪽지를 눌러 펼치면 받은 것 줄, 코인 다시 안 줌', /받았어|Received/.test(paper) && (await h.balance()) === b0, `${paper.replace(/\n/g, ' / ')} ${b0}→${await h.balance()}`);
    await panel.shots('b03-notebox-opened', '.note-box');
    panel.close();
    check('운영자 칸', '앱 B(운영자 아님): 운영자 칸 DOM 없음', (await p.ev(`document.querySelector('.admin-box') === null`)) === true);
    p.close();
  } catch (err) {
    check('앱 B', '중단', false, err instanceof Error ? err.message : String(err));
    try {
      console.log(readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').slice(-30).join('\n'));
    } catch {}
  } finally {
    await h.quit();
  }
}

// ================= 5. 앱 C: 운영자 =================
async function appC() {
  const h = await launch('C');
  try {
    const p = await openSettings(h);
    const F = '운영자 칸';
    const idC = await firstRun(h, p, F, Q('운영자', 'Admin'), undefined);
    check(F, '로그인 전: 운영자 칸 DOM 없음', (await p.ev(`document.querySelector('.admin-box') === null`)) === true);
    check(F, '"구글로 로그인" (운영자 sub)', await clickLogin(h, p, ADMIN_SUB));
    await soft(until('운영자', async () => (await h.status()).admin === true, 20_000));
    await soft(until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 20_000));
    check(F, '운영자 계정: 설정에 운영자 칸', (await p.ev(`!!document.querySelector('.admin-box .admin-group')`)) === true);
    check(F, '운영자 칸에 세션 토큰 없음', !(await p.ev(`/fs_[A-Za-z0-9_-]{43}|fd_[A-Za-z0-9_-]{43}/.test(document.body.innerHTML)`)));
    await p.shots('c01-admin', '.admin-box');
    const flashOf = async (needle) => waitFlash(p, needle, 10_000);
    // 기능 스위치: 모드 바꾸기 (두 번)
    {
      await setMode('allowlist');
      await pressSel(p, '.admin-box .action-row button');
      await soft(until('모드 allowlist', () => p.ev(`${G(T.gFeat)}?.querySelector('select')?.value === 'allowlist'`), 8000));
      await clearFlash(p);
      check(F, '접근 모드 고르기 everyone', await adminType(p, T.gFeat, `${Q('접근 모드', 'Access mode')} (ai_chat)`, 'everyone'));
      const r = await adminSure(p, T.gFeat, T.modeSave, () => sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`) === 'allowlist');
      check(F, '"모드 바꾸기" 한 번 → "정말" 글, 서버 그대로', r.first && r.armed && r.still, JSON.stringify(r));
      await soft(until('모드', async () => sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`) === 'everyone', 8000));
      check(F, '한 번 더 → 서버 모드 everyone, 결과 글, 운영 기록 ai.mode', sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`) === 'everyone' && (await flashOf('allowlist → everyone')).includes('everyone') && sql(`SELECT actor FROM admin_log WHERE action = 'ai.mode' ORDER BY id DESC LIMIT 1`) === `account:${idC}`);
      for (const m of ['off', 'allowlist']) {
        await adminType(p, T.gFeat, `${Q('접근 모드', 'Access mode')} (ai_chat)`, m);
        await adminSure(p, T.gFeat, T.modeSave);
        await soft(until(`모드 ${m}`, async () => sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`) === m, 8000));
        check(F, `모드 ${m} 로 (두 번 눌러)`, sql(`SELECT mode FROM feature_flag WHERE key = 'ai_chat'`) === m);
      }
    }
    // 계정 찾기: 닉네임, 기기 코드
    const target = await newUser(Q('찾을사람', 'FindMe'));
    {
      await typeInto(p, '.admin-q', Q('찾을사', 'findm'));
      await adminPress(p, T.gFind, T.findGo);
      await soft(until('찾음', async () => (await p.ev(`document.querySelector('.admin-acct')?.textContent ?? ''`)).includes(target.code), 8000));
      check(F, '닉네임 일부(대소문자 무시)로 찾기 → 계정 줄 (기기 코드, 18+)', (await p.ev(`document.querySelector('.admin-acct')?.textContent ?? ''`)).includes(target.code), await p.ev(`document.querySelector('.admin-acct')?.textContent ?? ''`));
      await typeInto(p, '.admin-q', target.code.toLowerCase().replace('f-', ''));
      await adminPress(p, T.gFind, T.findGo);
      await sleep(800);
      check(F, '기기 코드(소문자, F- 없이)로 찾기', (await p.ev(`document.querySelector('.admin-acct')?.textContent ?? ''`)).includes(target.code));
      await typeInto(p, '.admin-q', 'zz-no-such-zz');
      await adminPress(p, T.gFind, T.findGo);
      await soft(until('없음', () => p.ev(`!!document.querySelector('.admin-box .warn')`), 5000));
      check(F, '없는 것 찾기 → "찾는 계정이 없어"', (await p.ev(`document.querySelector('.admin-box .warn')?.textContent ?? ''`)) === Q('찾는 계정이 없어.', 'No such account.'));
      await typeInto(p, '.admin-q', target.code);
      await adminPress(p, T.gFind, T.findGo);
      await soft(until('찾음', async () => (await p.ev(`document.querySelector('.admin-acct')?.textContent ?? ''`)).includes(target.code), 8000));
      await p.shots('c02-admin-found', '.admin-acct');
    }
    // 허용, 구독 걸기·해지, 지급(쪽지)·회수, 차단
    {
      await clearFlash(p);
      check(F, `"${T.allowOn}" 누르기`, await adminPress(p, T.gFind, T.allowOn));
      await soft(until('허용', async () => sql(`SELECT count(*) FROM feature_allow WHERE account_id = ${target.id}`) === '1', 8000));
      check(F, '허용 목록에 (DB)', sql(`SELECT count(*) FROM feature_allow WHERE account_id = ${target.id}`) === '1');
      // 허용하면 구독이 저절로 걸린다 → 해지(두 번) → 걸기
      await soft(until('구독 줄', async () => (await p.ev(`document.querySelector('.admin-box')?.innerText ?? ''`)).includes(Q('정기 지급 매달 100장', 'Subscription 100 a month')), 8000));
      const r = await adminSure(p, T.gFind, T.cancelSub, () => sql(`SELECT count(*) FROM ai_subscription WHERE account_id = ${target.id} AND canceled_at IS NULL`) === '1');
      await soft(until('해지', async () => sql(`SELECT count(*) FROM ai_subscription WHERE account_id = ${target.id} AND canceled_at IS NULL`) === '0', 8000));
      check(F, '"정기 지급 해지" 두 번 → 해지 (한 번은 그대로)', r.armed && r.still && sql(`SELECT count(*) FROM ai_subscription WHERE account_id = ${target.id} AND canceled_at IS NULL`) === '0', JSON.stringify(r));
      await soft(until('걸기 칸', async () => !!(await adminType(p, T.gFind, T.lMonthly, '7')), 8000));
      check(F, '매달 장수 7 → "정기 지급 걸기"', await adminPress(p, T.gFind, T.subscribe));
      await soft(until('구독', async () => sql(`SELECT monthly FROM ai_subscription WHERE account_id = ${target.id} AND canceled_at IS NULL`) === '7', 8000));
      check(F, '구독 걸림 (매달 7, 이번 달 쪽지)', sql(`SELECT monthly FROM ai_subscription WHERE account_id = ${target.id} AND canceled_at IS NULL`) === '7' && Number(sql(`SELECT count(*) FROM inbox WHERE account_id = ${target.id} AND kind = 'subscription'`)) >= 1);
      // 지급 (쪽지)
      await adminType(p, T.gFind, T.lMsg, Q('운영자 칸에서 보냄', 'Sent from the operator box'));
      await adminType(p, T.gFind, T.lCoins, '9');
      const n0 = sql(`SELECT count(*) FROM inbox WHERE account_id = ${target.id}`);
      check(F, '"쪽지 보내기" (코인 9)', await adminPress(p, T.gFind, T.noteSend));
      await soft(until('쪽지', async () => sql(`SELECT count(*) FROM inbox WHERE account_id = ${target.id}`) !== n0, 8000));
      check(F, '지급 쪽지 DB (코인 9, 글)', sql(`SELECT coins || ':' || message FROM inbox WHERE account_id = ${target.id} ORDER BY id DESC LIMIT 1`) === `9:${Q('운영자 칸에서 보냄', 'Sent from the operator box')}`);
      // 회수: 이용권 3장 준비 → 1장 회수 (두 번)
      sql(`INSERT INTO ai_ticket (account_id, remaining) VALUES (${target.id}, 3) ON CONFLICT (account_id) DO UPDATE SET remaining = 3`);
      await adminType(p, T.gFind, T.lCount, '1');
      const rv = await adminSure(p, T.gFind, T.revoke, () => sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${target.id}`) === '3');
      await soft(until('회수', async () => sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${target.id}`) === '2', 8000));
      check(F, '"채팅 이용권 회수" 두 번 → 3 → 2 (한 번은 그대로)', rv.armed && rv.still && sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${target.id}`) === '2', JSON.stringify(rv));
      // 차단
      check(F, `"${T.blockOn}" 누르기`, await adminPress(p, T.gFind, T.blockOn));
      await soft(until('막힘', async () => sql(`SELECT count(*) FROM ai_block WHERE account_id = ${target.id}`) === '1', 8000));
      const g = await api('GET', '/v1/ai', { token: target.session });
      check(F, '차단 DB + 그 계정 GET /v1/ai 403 blocked', sql(`SELECT count(*) FROM ai_block WHERE account_id = ${target.id}`) === '1' && g.json?.error === 'blocked', JSON.stringify(g.json));
      await soft(until('풀기 단추', () => adminPress1(p, T.gFind, T.blockOff), 8000));
      await soft(until('풀림', async () => sql(`SELECT count(*) FROM ai_block WHERE account_id = ${target.id}`) === '0', 8000));
      check(F, `"${T.blockOff}" → 풀림`, sql(`SELECT count(*) FROM ai_block WHERE account_id = ${target.id}`) === '0');
      await p.shots('c03-admin-account', '.admin-acct');
    }
    // 공지 편집 → 앱 공지 창, 최소, 권장 버전, 강제
    {
      const nid = `qa-n-${randomBytes(3).toString('hex')}`;
      await adminType(p, T.gNotice, T.lKind, 'info');
      await adminType(p, T.gNotice, T.lId, nid);
      await adminType(p, T.gNotice, T.lTko, '운영자 칸에서 쓴 공지');
      await adminType(p, T.gNotice, T.lTen, 'Notice from the operator box');
      await adminType(p, T.gNotice, T.lBko, '앱 운영자 칸에서 고쳐 홈페이지 파일로 나간 공지야.');
      await adminType(p, T.gNotice, T.lBen, 'Edited in the app operator box and shipped as a site file.');
      check(F, '"공지 저장" (info)', await adminPress(p, T.gNotice, T.noticeSave));
      await soft(until('공지', async () => sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(nid), 8000));
      check(F, '공지 서버 문서에', sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(nid));
      const pf = await pullFeeds();
      check(F, 'site-feeds 로 notices.json 바뀜 (앱 읽기 코드 통과)', pf.code === 0 && readFileSync(join(site, 'notices.json'), 'utf8').includes(nid), pf.out.trim());
      await h.main('__jj.notices.debugForget(); __jj.notices.refresh().then(() => 1)');
      const np = await h.page('notice', 120);
      await soft(until('공지 창', async () => (await np.ev(`document.querySelector('h1')?.textContent ?? ''`)) !== '', 20_000));
      check(F, '앱 공지 창에 운영자 칸에서 쓴 공지', (await np.ev(`document.querySelector('h1')?.textContent ?? ''`)) === Q('운영자 칸에서 쓴 공지', 'Notice from the operator box'));
      await np.shots('c04-notice-info');
      await soft(np.ev(`(() => { const b = document.querySelector('button.primary') ?? document.querySelector('button'); b?.click(); return 1; })()`));
      np.close();
      await sleep(800);
      // 권장 버전, 최소 버전: 최신 릴리스보다 높은 값은 거절
      await adminType(p, T.gNotice, T.lMin, '9.9.9');
      await clearFlash(p);
      await adminSure(p, T.gNotice, T.saveVersions);
      const tooHigh = await flashOf('9.9.9');
      check(F, '최소 버전 9.9.9 → 거절 글 (최신 릴리스보다 높음)', /최신 릴리스|latest release/i.test(tooHigh) && !sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes('9.9.9'), tooHigh);
      await adminType(p, T.gNotice, T.lMin, LATEST);
      await adminType(p, T.gNotice, T.lRec, LATEST);
      const r = await adminSure(p, T.gNotice, T.saveVersions, () => !sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(`"minVersion": "${LATEST}"`) && !sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(`"minVersion":"${LATEST}"`));
      await soft(until('버전', async () => /"minVersion": ?"0\.4\.4"/.test(sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`)), 8000));
      check(F, `"버전 저장" 두 번 → 최소 ${LATEST}, 권장 ${LATEST} (한 번은 그대로)`, r.armed && r.still && /"minVersion": ?"0\.4\.4"/.test(sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`)) && /"recommendVersion": ?"0\.4\.4"/.test(sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`)), JSON.stringify(r));
      // 강제 업데이트 글 (두 번)
      const fid = `qa-force-${randomBytes(3).toString('hex')}`;
      await adminType(p, T.gNotice, T.lKind, 'force');
      await sleep(200);
      await adminType(p, T.gNotice, T.lId, fid);
      await adminType(p, T.gNotice, T.lTko, '꼭 업데이트해 줘');
      await adminType(p, T.gNotice, T.lTen, 'Please update now');
      await adminType(p, T.gNotice, T.lBko, '이 판은 더 쓸 수 없어. 새 판으로 바꿔 줘.');
      await adminType(p, T.gNotice, T.lBen, 'This version can no longer be used. Please update.');
      const fr = await adminSure(p, T.gNotice, T.noticeSave, () => !sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(fid));
      await soft(until('강제 글', async () => sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(fid), 8000));
      check(F, '강제 업데이트 글 "공지 저장" 두 번 (한 번은 그대로)', fr.armed && fr.still && sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes(fid), JSON.stringify(fr));
      const pf2 = await pullFeeds();
      const file = JSON.parse(readFileSync(join(site, 'notices.json'), 'utf8'));
      check(F, 'notices.json: minVersion, recommendVersion, force 글', pf2.code === 0 && file.minVersion === LATEST && file.recommendVersion === LATEST && file.notices.some((n) => n.id === fid && n.kind === 'force'), pf2.out.trim());
      // 운영 기록 보기 (강제 창이 뜨기 전에 찍는다)
      await pressSel(p, '.admin-box .action-row button');
      await soft(until('기록', async () => (await p.ev(`${G(T.gLog)}?.innerText ?? ''`)).includes('notice.create'), 8000));
      const log = await p.ev(`${G(T.gLog)}?.innerText ?? ''`);
      check(F, '운영 기록 칸: ai.mode, ai.cancel, ai.subscribe, note.send, ai.revoke, ai.block, notice.create, versions', ['ai.mode', 'ai.cancel', 'ai.subscribe', 'note.send', 'ai.revoke', 'ai.block', 'notice.create', 'versions'].every((x) => log.includes(x)), log.replace(/\n/g, ' / ').slice(0, 300));
      await p.shots('c05-admin-log', '.admin-box');
      // 앱(0.4.3)이 최소 0.4.4 를 받으면 강제 창
      // 서버가 (최소 판을 저장하기 전에) 받아 둔 "없음"이 공지 파일 값을 덮는다 (update.ts effectiveMin: 서버 값 우선).
      // 계정을 다시 맞춰 서버의 새 기준을 받은 뒤 공지 파일을 받는다
      await soft(h.main('__jj.server.core.run().then(() => 1)'));
      await h.main('__jj.notices.refresh().then(() => 1)');
      const fp = await soft(h.page('notice', 160));
      let ftitle = '';
      if (fp) {
        await soft(until('강제 창', async () => (ftitle = await fp.ev(`document.querySelector('h1')?.textContent ?? ''`)) === Q('꼭 업데이트해 줘', 'Please update now'), 40_000));
        await fp.shots('c06-notice-force');
        fp.close();
      }
      check(F, '앱(0.4.3) 최소 0.4.4 → 강제 창에 운영자가 쓴 강제 글', ftitle === Q('꼭 업데이트해 줘', 'Please update now'), ftitle || '창 없음');
    }
    p.close();
  } catch (err) {
    check('앱 C', '중단', false, err instanceof Error ? err.message : String(err));
    try {
      console.log(readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').slice(-30).join('\n'));
    } catch {}
  } finally {
    await h.quit();
  }
}

let crashed = false;
try {
  await apiLayer();
  await feedsLayer();
  // 앱 시험은 깨끗한 정책에서 (API 층이 바꾼 자리 수, 모드)
  await adminJson('ai/policy', { seat_limit: '100' });
  await setMode('allowlist');
  // 정적 파일을 처음 상태로
  writeFileSync(join(site, 'events.json'), '{"version":1,"events":[]}\n');
  await appA();
  await appB();
  await appC();
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
for (const a of apps) if (!a.exited) await a.quit().catch(() => {});
await nest.close().catch(() => {});
await fake.close();
stat.close();
dropPg();
for (let i = 0; i < 3; i++) {
  await sleep(500);
  rmSync(scratchAll, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS${crashed ? ', 중단됨' : ''}  화면: ${OUT}`);
for (const r of bad) console.log(`  FAIL [${r.area}] ${r.name} (${r.extra})`);
process.exit(bad.length || crashed ? 1 : 0);
