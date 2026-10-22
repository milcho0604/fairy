// PR #122 (#115) QA: 같은 계정의 기기끼리 구글 일정 연결 이어 주기. 사용자가 하는 순서대로 화면 단추를 눌러 본다.
// 세 층(API, 화면 클릭, 화면 모양)을 경우마다 PASS/FAIL 로 본다. __jj 는 상태 준비(코인 넣기 등)에만 쓴다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr122.mjs
//
// - 서버는 이 프로세스 안에서 server/dist 의 createApp 으로 띄운다(가짜 구글 로그인: 시험 RSA 키로 서명한 id_token,
//   운영자 토큰과 운영자 sub). FEATURE_CALENDAR_LINK_HINT 는 비워 기본 allowlist 를 본다.
// - 구글 캘린더 연결은 진짜 구글에 닿지 않는다: 앱 메인에서 shell.openExternal 을 바꿔 끼워 허락 주소를 받고,
//   기본 세션의 https 를 protocol.handle 로 가로채 토큰(oauth2.googleapis.com), 거둠, 캘린더 API 를 가짜로 답한다
//   (그 밖의 https 는 모두 503, 기록). 이 스크립트가 루프백 주소로 code 를 돌려준다(브라우저가 하는 일).
// - 웹 /admin 기능 스위치는 시험 앱 안 숨은 창(show:false, 이 창만 이동 허용)에서 폼을 눌러 바꾼다.
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만.
// - 컨테이너는 jj-qa122-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위 (사용자 앱의 9881/9882 를 쓰지 않는다).
// - QA_ONLY=api,nourl,u14,out,ab 로 일부만.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `qa-pr122-${LANG}`));
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
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${extra ? ` (${String(extra).replace(/\n/g, ' ').slice(0, 260)})` : ''}`);
}
const note = (area, text) => console.log(`NOTE [${area}] ${text}`);

// ---- 시험용 Postgres ----
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const tag = randomBytes(4).toString('hex');
const pgName = `jj-qa122-pg-${tag}`;
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

// ---- 가짜 구글 로그인 ----
const CLIENT_ID = 'qa-client.apps.googleusercontent.com';
const gkey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...gkey.publicKey.export({ format: 'jwk' }), kid: 'qa1', alg: 'RS256', use: 'sig' };
const google = { sub: '', nonce: '' };
const idToken = (sub, nonce) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'qa1', typ: 'JWT' });
  const body = enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, nonce, iat: now, exp: now + 3600 });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), gkey.privateKey).toString('base64url')}`;
};
const fakeGoogle = { exchangeCode: async () => idToken(google.sub, google.nonce), fetchJwks: async () => [jwk] };

// ---- 페어리 서버 (이 프로세스 안) ----
const serverReq = createRequire(join(root, 'server', 'package.json'));
const { createApp } = serverReq('./dist/app.js');
const { readConfig } = serverReq('./dist/config.js');
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const ADMIN_SUB = `qa-admin-${tag}`;
const nest = await createApp(
  readConfig({
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    PUBLIC_URL: apiUrl,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'qa-secret',
    ADMIN_TOKEN,
    ADMIN_GOOGLE_SUBS: ADMIN_SUB,
  }),
  { google: fakeGoogle },
);
/** 서버가 받은 요청 (경로, 본문, 토큰 종류, 상태) */
const seen = [];
const adminPosts = [];
nest.use((req, res, next) => {
  const auth = String(req.headers.authorization ?? '').slice(7, 10);
  res.on('finish', () => seen.push({ m: req.method, p: req.path, body: req.body, auth, status: res.statusCode }));
  if (req.method === 'POST' && req.path.startsWith('/admin')) adminPosts.push({ path: req.path, origin: req.headers.origin });
  next();
});
await nest.listen(apiPort, '127.0.0.1');
console.log('server', apiPort, 'pg', pgName, 'lang', LANG);
const limited = () => seen.filter((x) => x.status === 429).map((x) => x.p);
const calPatches = (from = 0) => seen.slice(from).filter((x) => x.m === 'PATCH' && x.p === '/v1/account' && x.body && 'calendarLinked' in x.body);

// ---- API 도우미 ----
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function api(method, path, { token, body, from = ip() } = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'cf-connecting-ip': from,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}
const verifierNew = () => randomBytes(32).toString('base64url');
const challengeOf = (v) => createHash('sha256').update(v).digest('base64url');
const appState = () => `qastate${randomBytes(4).toString('hex')}`;
async function googleBrowser(startUrl, sub, from = ip()) {
  const s = await fetch(startUrl, { redirect: 'manual', headers: { 'cf-connecting-ip': from } });
  if (s.status !== 302) return { error: `start ${s.status}` };
  const g = new URL(s.headers.get('location') ?? '');
  google.sub = sub;
  google.nonce = g.searchParams.get('nonce') ?? '';
  const cb = await fetch(`${apiUrl}/auth/google/callback?state=${g.searchParams.get('state')}&code=fake-code`, { redirect: 'manual', headers: { 'cf-connecting-ip': from } });
  return { done: cb.headers.get('location') ?? '' };
}
async function apiLogin(token, sub, merge) {
  const v = verifierNew();
  const f = await googleBrowser(`${apiUrl}/auth/google/start?port=5000&state=${appState()}&challenge=${challengeOf(v)}`, sub);
  const code = new URL(f.done).searchParams.get('code');
  return api('POST', '/v1/session', { token, body: { code, verifier: v, ...(merge ? { merge } : {}) } });
}
const newDevice = async () => (await api('POST', '/v1/device', { body: { age: '18+' } })).json;
async function newUser(sub = `qa-u-${randomBytes(4).toString('hex')}`) {
  const d = await newDevice();
  const s = await apiLogin(d.token, sub);
  return { device: d.token, session: s.json.session, id: String(s.json.account?.id ?? d.account.id), sub };
}
const linkedOf = (id) => Number(sql(`SELECT count(*) FROM calendar_link l JOIN device d ON d.id = l.device_id WHERE d.account_id = ${id}`));

// ---- 웹 운영자 (쿠키, CSRF) ----
const web = { cookie: '', csrf: '' };
async function adminPage() {
  const r = await fetch(`${apiUrl}/admin`, { headers: { cookie: web.cookie } });
  const text = await r.text();
  web.csrf = /name="csrf" value="([^"]+)"/.exec(text)?.[1] ?? web.csrf;
  return { status: r.status, text };
}
async function adminPost(path, fields, { csrf = true } = {}) {
  const form = new URLSearchParams(csrf ? { csrf: web.csrf } : {});
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const r = await fetch(`${apiUrl}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: web.cookie, origin: apiUrl }, body: form.toString() });
  if (r.status === 303 && path === '/admin/login') web.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  await r.text();
  if (r.status !== 303) return { status: r.status, flash: '' };
  const page = await adminPage();
  return { status: r.status, flash: /<p class="flash( error)?( wide)?" role="(?:status|alert)"(?: id="form-(?:error|ok)")?>([^<]*)<\/p>/.exec(page.text)?.[3] ?? '' };
}
const setFeature = (key, mode) => adminPost('/admin/features/mode', { key, mode, confirm: 'yes' });
const allowFeature = (key, account, on = true) => adminPost('/admin/features/allow', { key, account, allowed: on ? '1' : '0' });
const CACHE = 5_300;
const KEY = 'calendar_link_hint';

// ================= 1. API 층 =================
async function apiLayer() {
  const F = 'API';
  await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
  // 기본값 (env 비움 → allowlist)
  const u = await newUser();
  const feats = await api('GET', '/v1/features', { token: u.session });
  check(F, 'GET /v1/features 에 calendar_link_hint, 기본 allowlist 라 허용 안 된 계정은 false', feats.status === 200 && feats.json?.features?.calendar_link_hint === false, JSON.stringify(feats.json));
  const anon = await api('GET', '/v1/features');
  check(F, '토큰 없는 /v1/features → calendar_link_hint false', anon.json?.features?.calendar_link_hint === false);
  const me0 = await api('GET', '/v1/me', { token: u.session });
  check(F, '허용 안 된 계정의 /v1/me calendar = null', me0.status === 200 && me0.json && 'calendar' in me0.json && me0.json.calendar === null, JSON.stringify(me0.json));
  const on0 = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: true } });
  check(F, '기능 꺼진(allowlist 밖) 계정의 켜기 → 403 feature_off', on0.status === 403 && on0.json?.error === 'feature_off', JSON.stringify(on0));
  const off0 = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: false } });
  check(F, '기능 꺼진 계정의 끄기 → 200, calendar null', off0.status === 200 && off0.json?.calendar === null, JSON.stringify(off0.json));
  const pg = await adminPage();
  check(F, '웹 /admin 기능 스위치 표에 "다른 기기의 구글 일정 연결 안내", 허용 목록(서버 설정 기본값)', pg.text.includes('다른 기기의 구글 일정 연결 안내') && /<code>calendar_link_hint<\/code><\/td><td>[^<]*\(서버 설정 기본값\)/.test(pg.text));

  // 허용 목록에 넣기
  const a = await allowFeature(KEY, u.id);
  check(F, '운영자 폼으로 허용 목록에 넣기', a.status === 303 && !/error/.test(a.flash), a.flash);
  await sleep(CACHE);
  check(F, '허용 뒤 /v1/features → true', (await api('GET', '/v1/features', { token: u.session })).json?.features?.calendar_link_hint === true);
  const me1 = await api('GET', '/v1/me', { token: u.device });
  check(F, '허용 뒤 /v1/me calendar = {linked:false, devices:0}', JSON.stringify(me1.json?.calendar) === '{"linked":false,"devices":0}', JSON.stringify(me1.json?.calendar));
  const on1 = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: true } });
  check(F, 'PATCH calendarLinked:true (기기 토큰) → 200 {account, calendar:{linked:true,devices:1}}', on1.status === 200 && JSON.stringify(on1.json?.calendar) === '{"linked":true,"devices":1}' && typeof on1.json?.account?.code === 'string', JSON.stringify(on1.json));
  check(F, 'DB calendar_link 1줄 (device_id, linked_at 만)', linkedOf(u.id) === 1 && sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'calendar_link'`) === 'device_id,linked_at');
  const again = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: true } });
  check(F, '같은 값 다시 → 200, 여전히 1', again.status === 200 && again.json?.calendar?.devices === 1 && linkedOf(u.id) === 1);
  const sess = await api('PATCH', '/v1/account', { token: u.session, body: { calendarLinked: true } });
  check(F, '세션 토큰 → 400 device_token', sess.status === 400 && sess.json?.error === 'device_token', JSON.stringify(sess.json));
  const sessOff = await api('PATCH', '/v1/account', { token: u.session, body: { calendarLinked: false } });
  check(F, '세션 토큰 끄기도 → 400 device_token (표시 그대로)', sessOff.status === 400 && sessOff.json?.error === 'device_token' && linkedOf(u.id) === 1);
  for (const bad of ['yes', 1, null, {}]) {
    const r = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: bad } });
    check(F, `calendarLinked=${JSON.stringify(bad)} → 400 calendar`, r.status === 400 && r.json?.error === 'calendar', `${r.status} ${JSON.stringify(r.json)}`);
  }
  const noTok = await api('PATCH', '/v1/account', { body: { calendarLinked: true } });
  check(F, '토큰 없음 → 401', noTok.status === 401, String(noTok.status));
  const badNick = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: false, nickname: 'a@b' } });
  check(F, '닉네임이 틀린 묶음 요청 → 400 nickname, 연결 표시는 안 바뀜', badNick.status === 400 && badNick.json?.error === 'nickname' && linkedOf(u.id) === 1, JSON.stringify(badNick.json));
  const empty = await api('PATCH', '/v1/account', { token: u.device, body: {} });
  check(F, '빈 본문 → 400 age (전과 같음)', empty.status === 400 && empty.json?.error === 'age');

  // 같은 계정 둘째 기기
  const d2 = await newDevice();
  const s2 = await apiLogin(d2.token, u.sub);
  check(F, '둘째 기기 같은 sub 로그인 → 같은 계정', String(s2.json?.account?.id) === u.id, JSON.stringify(s2.json).slice(0, 120));
  const me2 = await api('GET', '/v1/me', { token: s2.json.session });
  check(F, '둘째 기기 세션 /v1/me → {linked:true, devices:1}', JSON.stringify(me2.json?.calendar) === '{"linked":true,"devices":1}', JSON.stringify(me2.json?.calendar));
  await api('PATCH', '/v1/account', { token: d2.token, body: { calendarLinked: true } });
  check(F, '둘째 기기도 켜기 → devices 2', (await api('GET', '/v1/me', { token: u.session })).json?.calendar?.devices === 2);
  await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: false } });
  check(F, '첫 기기 끄기 → {linked:true, devices:1}', JSON.stringify((await api('GET', '/v1/me', { token: u.session })).json?.calendar) === '{"linked":true,"devices":1}');

  // 기능 off: 켜기 403, 끄기 200, /v1/me null
  const m = await setFeature(KEY, 'off');
  check(F, '운영자 폼으로 off', m.status === 303 && !/error/.test(m.flash), m.flash);
  await sleep(CACHE);
  check(F, 'off: /v1/me calendar null, /v1/features false', (await api('GET', '/v1/me', { token: u.session })).json?.calendar === null && (await api('GET', '/v1/features', { token: u.session })).json?.features?.calendar_link_hint === false);
  const offOn = await api('PATCH', '/v1/account', { token: u.device, body: { calendarLinked: true } });
  check(F, 'off: 켜기 → 403 feature_off (DB 그대로)', offOn.status === 403 && offOn.json?.error === 'feature_off' && linkedOf(u.id) === 1);
  const offOff = await api('PATCH', '/v1/account', { token: d2.token, body: { calendarLinked: false } });
  check(F, 'off: 끄기는 항상 → 200 calendar null, DB 0', offOff.status === 200 && offOff.json?.calendar === null && linkedOf(u.id) === 0, JSON.stringify(offOff.json));
  // everyone: 허용 목록 밖 계정도 켜짐
  await setFeature(KEY, 'everyone');
  await sleep(CACHE);
  const other = await newUser();
  check(F, 'everyone: 허용 목록 밖 계정도 /v1/me calendar 객체, 켜기 200', (await api('GET', '/v1/me', { token: other.session })).json?.calendar?.devices === 0 && (await api('PATCH', '/v1/account', { token: other.device, body: { calendarLinked: true } })).status === 200);
  check(F, '계정끼리 섞이지 않음 (other 1, u 0)', linkedOf(other.id) === 1 && linkedOf(u.id) === 0);
  // allowlist 로 돌리고, 운영자 sub 계정은 허용 목록 없이 켜짐
  await setFeature(KEY, 'allowlist');
  await sleep(CACHE);
  const adm = await newUser(ADMIN_SUB);
  check(F, 'allowlist: 운영자 계정은 허용 목록 없이 true', (await api('GET', '/v1/features', { token: adm.session })).json?.features?.calendar_link_hint === true && (await api('GET', '/v1/me', { token: adm.session })).json?.calendar?.devices === 0);
  check(F, 'allowlist: 허용 목록 밖 other 는 켜기 403', (await api('PATCH', '/v1/account', { token: other.device, body: { calendarLinked: true } })).status === 403);
  // 허용 빼기
  const rm = await allowFeature(KEY, u.id, false);
  await sleep(CACHE);
  check(F, '허용 빼기 → u 의 /v1/me calendar null', rm.status === 303 && (await api('GET', '/v1/me', { token: u.session })).json?.calendar === null);
  // 탈퇴하면 함께 지움
  const delId = other.id;
  const del = await api('DELETE', '/v1/account', { token: other.session });
  check(F, '탈퇴 → calendar_link 줄도 지움', (del.status === 200 || del.status === 204) && Number(sql(`SELECT count(*) FROM calendar_link l LEFT JOIN device d ON d.id = l.device_id WHERE d.id IS NULL OR d.account_id = ${delId}`)) === 0, String(del.status));
  // 합치기: 기기 줄을 따라 남는 쪽으로
  await setFeature(KEY, 'everyone');
  await sleep(CACHE);
  const p = await newUser();
  await api('PATCH', '/v1/account', { token: p.device, body: { calendarLinked: true } });
  // 코인 있는 새 기기 → p 의 sub 로 로그인하면 합치기 묻기 → 합치기
  const q = await newDevice();
  await api('POST', '/v1/sync', { token: q.token, body: { entries: [{ id: crypto.randomUUID(), reason: 'meet', amount: 10, day: new Date().toISOString().slice(0, 10) }] } });
  await api('POST', '/v1/sync', { token: p.device, body: { entries: [{ id: crypto.randomUUID(), reason: 'meet', amount: 10, day: new Date().toISOString().slice(0, 10) }] } });
  const ask = await apiLogin(q.token, p.sub);
  let into = String(ask.json?.account?.id ?? '');
  if (ask.status === 409) {
    const ok = await apiLogin(q.token, p.sub, ask.json.code);
    into = String(ok.json?.account?.id);
  }
  check(F, '합친 뒤 연결 표시가 남는 계정으로 따라감 (devices 1)', linkedOf(into) === 1 && (await api('GET', '/v1/me', { token: q.token })).json?.calendar?.devices === 1, `409=${ask.status === 409} into=${into} p=${p.id}`);
  await setFeature(KEY, 'allowlist');
  await sleep(CACHE);
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
const ELECTRON = "process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron')";
const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.qa122-'));
const live = new Set();

/** 앱 하나. data 를 주면 그 데이터 폴더로 다시 켠다 (앱 다시 켜기) */
async function launch(name, { server = apiUrl, data } = {}) {
  const inspect = await freePort();
  const pageP = await freePort();
  const scratch = data ? dirname(data) : mkdtempSync(join(scratchAll, `${name}-`));
  const dataDir = data ?? join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  if (!data) {
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
    writeFileSync(join(dataDir, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  }
  const env = {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: dataDir,
    JJ_TEST_SECRETS: 'memory',
    // 구글 캘린더 칸이 보이게 하는 모양만 맞춘 가짜 클라이언트 (구글에는 닿지 않는다: https 를 가로챈다)
    JJ_GOOGLE_CLIENT_ID: '1234567890-qa122.apps.googleusercontent.com',
    JJ_GOOGLE_CLIENT_SECRET: '',
  };
  if (server) env.JJ_SERVER_URL_OVERRIDE = server;
  const child = spawn(electronPath, [`--inspect=${inspect}`, '.', `--remote-debugging-port=${pageP}`], { cwd: root, env, stdio: 'ignore' });
  const h = { name, child, scratch, data: dataDir, exited: false, mainConn: undefined };
  live.add(h);
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
        if (p) return pageHandle(await connect(p.webSocketDebuggerUrl));
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${pname}`);
  };
  h.target = async (match, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${pageP}/json`)).json();
        const p = list.find((x) => x.type === 'page' && match(x.url));
        if (p) return pageHandle(await connect(p.webSocketDebuggerUrl));
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${match}`);
  };
  /** 끄기. keep 이면 데이터 폴더를 남긴다 (다시 켜기) */
  h.quit = async (keep = false) => {
    try {
      await h.main(`(() => { const e = ${ELECTRON}; setTimeout(() => e.app.quit(), 100); return 'quit'; })()`);
    } catch {}
    h.mainConn?.ws.close();
    for (let i = 0; i < 60 && !h.exited; i++) await sleep(250);
    const left = () => {
      try {
        return execFileSync('pgrep', ['-f', dataDir], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
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
      await sleep(1000);
    }
    if (left().length) check('정리', `앱 ${name} 프로세스가 남음`, false, left().join(','));
    live.delete(h);
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  };
  await until(`${name} __jj`, () => h.main('typeof __jj === "object"'), 60_000);
  await fakeGoogleCalendar(h);
  h.status = async () => JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
  h.gcal = async () => JSON.parse(await h.main('JSON.stringify(__jj.gcal.status())'));
  return h;
}
function pageHandle(c) {
  const ev = async (expr) => {
    const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  return { ev, send: c.send, close: () => c.ws.close(), shots: (file, sel) => shots(c, ev, file, sel) };
}

/**
 * 진짜 구글 대신: 브라우저 열기는 주소만 받고, 기본 세션의 https 는 가로채 가짜로 답한다.
 * 토큰 교환, 거둠, 캘린더 목록과 일정은 가짜. 그 밖의 https 는 503 (나간 곳은 globalThis.__qaHttps 에 적는다)
 */
const fakeGoogleCalendar = (h) =>
  h.main(`(() => {
    const e = ${ELECTRON};
    e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; };
    globalThis.__qaHttps = [];
    // 기기마다 다른 곳에서 붙은 것처럼 (서버의 곳별 상한이 시험 앱 여럿을 한 곳으로 세지 않게)
    const where = ${JSON.stringify(`10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`)};
    e.session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [${JSON.stringify(`${apiUrl}/*`)}] }, (d, cb) => cb({ requestHeaders: { ...d.requestHeaders, 'cf-connecting-ip': where } }));
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    e.protocol.handle('https', async (req) => {
      const u = new URL(req.url);
      globalThis.__qaHttps.push(req.method + ' ' + u.host + u.pathname);
      if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token')
        return json({ access_token: 'qa-at-' + Date.now(), refresh_token: 'qa-rt', expires_in: 3600, token_type: 'Bearer' });
      if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') return json({});
      if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/calendar/v3/users/me/calendarList'))
        return json({ items: [{ id: 'qa@example.com', summary: 'QA', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' }] });
      if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/calendar/v3/')) {
        if (req.method === 'GET') return json({ items: [], nextSyncToken: 'qa-sync' });
        return json({ id: 'qa' + Math.random().toString(36).slice(2), status: 'confirmed' });
      }
      return new Response('', { status: 503 });
    });
    return true;
  })()`);
/** 구글 허락 화면에서 계속을 누른 것처럼: 앱이 연 허락 주소의 redirect_uri 로 code 를 돌려준다 */
async function googleConsent(h) {
  let u;
  await soft(until('구글 허락 주소', async () => (u = await h.main('globalThis.__qaOpened ?? null')) && u.startsWith('https://accounts.google.com'), 10_000));
  if (!u) return { ok: false, why: 'no consent url' };
  const g = new URL(u);
  const back = `${g.searchParams.get('redirect_uri')}/?state=${encodeURIComponent(g.searchParams.get('state') ?? '')}&code=qa-code`;
  const r = await fetch(back).catch((e) => ({ status: String(e) }));
  return { ok: r.status === 200, url: u, status: r.status };
}

/** 밝은, 어두운 모드로 찍고 넘침, 영어판 한글, 줄표, 빈 단추를 본다 */
async function shots(c, ev, file, sel) {
  const issues = [];
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
  const a = await ev(`(() => {
    const el = ${sel ? `document.querySelector(${JSON.stringify(sel)})?.closest('section') ?? document.querySelector(${JSON.stringify(sel)})` : 'document.body'};
    if (!el) return { missing: true };
    const over = [...el.querySelectorAll('*')].filter((x) => { const cs = getComputedStyle(x); const rr = x.getBoundingClientRect(); if (rr.width <= 1 || rr.height <= 1 || (cs.position === 'absolute' && cs.clip !== 'auto')) return false; if (/(auto|scroll)/.test(cs.overflowX) || x.tagName === 'TEXTAREA' || x.tagName === 'INPUT' || x.tagName === 'SELECT') return false; return x.scrollWidth > x.clientWidth + 1 && cs.overflowX !== 'visible' ? true : rr.right > document.documentElement.clientWidth + 1; }).map((x) => (typeof x.className === 'string' && x.className) || x.tagName).slice(0, 5);
    const clipped = [...el.querySelectorAll('button, small, span, h2')].filter((x) => x.scrollHeight > x.clientHeight + 2 && getComputedStyle(x).overflowY === 'hidden').map((x) => x.className || x.tagName).slice(0, 5);
    const text = el.innerText;
    const emptyBtn = [...el.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length;
    return { over, clipped, hangul: (text.match(/[\\uAC00-\\uD7A3]+/g) ?? []).slice(0, 8), emdash: text.includes('\\u2014'), emptyBtn };
  })()`);
  if (a?.missing) issues.push('요소 없음');
  else {
    if (a.over.length) issues.push(`넘침 ${a.over.join(',')}`);
    if (a.clipped.length) issues.push(`잘림 ${a.clipped.join(',')}`);
    if (LANG === 'en' && a.hangul.length && !file.includes('admin')) issues.push(`영어판 한글 ${a.hangul.join(' ')}`);
    if (a.emdash) issues.push('줄표');
    if (a.emptyBtn) issues.push(`빈 단추 ${a.emptyBtn}`);
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
    under14: '만 14세 미만', adult: '만 18세 이상', start: '서버 모드 시작', syncNow: '지금 맞추기', login: '구글로 로그인', logout: '로그아웃', mergeYes: '합치기',
    gTitle: '구글 캘린더', connect: '구글 계정 연결', disconnect: '연결 끊기', cancel: '그만두기', done: '다 됐어',
    hint: '다른 기기에서 구글 일정을 연결했어. 이 기기도 연결할까?', no: '괜찮아, 다시 묻지 마',
  },
  en: {
    under14: 'Under 14', adult: '18 or older', start: 'Start server mode', syncNow: 'Sync now', login: 'Sign in with Google', logout: 'Sign out', mergeYes: 'Merge',
    gTitle: 'Google Calendar', connect: 'Connect Google account', disconnect: 'Disconnect', cancel: 'Cancel', done: 'Done',
    hint: 'You connected Google Calendar on another device. Connect this one too?', no: "No thanks, don't ask again",
  },
}[LANG];

// ---- 화면 도우미 ----
const press1 = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
const press = async (p, scope, text, ms = 5000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await press1(p, scope, text)) return true;
    await sleep(250);
  }
  return false;
};
const typeInto = (p, sel, value) =>
  p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const has = (p, sel) => p.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const GSEC = '[data-qa="gcal"]';
/** 구글 캘린더 칸 표시 (찍기와 단추 범위용 속성만 단다) */
const markGcal = (p) =>
  p.ev(`(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.trim() === ${JSON.stringify(T.gTitle)}); const s = h?.closest('section'); if (!s) return false; s.setAttribute('data-qa', 'gcal'); return true; })()`);
const hintShown = (p) => has(p, '.gcal-link-hint');
const gcalText = (p) => p.ev(`document.querySelector('${GSEC}')?.innerText ?? ''`);
async function openSettings(h) {
  await h.main("__jj.settingsWindow.open('restore')");
  const p = await h.page('settings');
  await until('설정', () => p.ev(`!!document.querySelector('.settings')`));
  return p;
}
/** 탭 단추를 눌러 옮긴다 */
const tab = async (p, id) => {
  await until(`탭 ${id}`, () => p.ev(`(() => { const b = document.querySelector('#tab-${id}'); if (!b) return false; b.click(); return true; })()`), 10_000);
  await sleep(300);
};
async function gotoGcal(p) {
  await tab(p, 'assist');
  await until('구글 캘린더 칸', () => markGcal(p), 10_000);
  await p.ev(`document.querySelector('${GSEC}').scrollIntoView({ block: 'start' }); 1`);
}
/** 처음 켜기: 나이 → 닉네임 → 기기 계정 (화면 단추) */
async function firstRun(h, p, F, nick) {
  await tab(p, 'data');
  await until('서버 칸', () => has(p, '.server-box'));
  await sleep(300);
  check(F, `"${T.adult}" 누르기`, await press(p, '.server-box', T.adult));
  await until('닉네임 칸', () => has(p, '.server-nickname-step input'), 10_000);
  await typeInto(p, '.server-nickname-step input', nick);
  check(F, `닉네임 넣고 "${T.start}" 누르기`, await press(p, '.server-box', T.start));
  await until('기기 계정', async () => {
    const s = await h.status();
    return s.device && s.code && !s.syncing && s.providers !== null;
  }, 30_000);
  return sql(`SELECT id FROM account WHERE code = '${(await h.status()).code}'`);
}
/** 서버 칸의 구글 로그인 단추 → (브라우저 일은 이 스크립트가) → 루프백 */
async function clickLogin(h, p, sub) {
  await tab(p, 'data');
  await h.main('globalThis.__qaOpened = null');
  if (!(await press(p, '.server-box', T.login))) return 'no button';
  let u;
  await soft(until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000));
  if (!u) return 'not opened';
  const f = await googleBrowser(u, sub);
  const r = await fetch(f.done).catch((e) => ({ status: String(e) }));
  return r.status === 200 ? 'ok' : `done ${r.status}`;
}
async function clickSync(h, p) {
  await tab(p, 'data');
  const before = (await h.status()).lastSyncAt;
  await press(p, '.server-box', T.syncNow, 10_000);
  await soft(until('맞추기 끝', async () => {
    const s = await h.status();
    return !s.syncing && (s.lastSyncAt !== before || s.problem);
  }, 20_000));
  await sleep(400);
}
/** 구글 캘린더 칸에서 연결 단추 → 허락 → 연결됨 → 고르기 창 닫기 */
async function clickConnectGcal(h, p) {
  await gotoGcal(p);
  await h.main('globalThis.__qaOpened = null');
  if (!(await press(p, GSEC, T.connect))) return 'no button';
  const c = await googleConsent(h);
  if (!c.ok) return `consent ${c.why ?? c.status}`;
  await soft(until('연결됨', async () => (await h.gcal()).connected, 10_000));
  // 연결 직후 캘린더 고르기 창이 열린다: "다 됐어"나 닫기
  await soft(until('고르기 창', () => has(p, '.gcal-sheet'), 5_000));
  if (await has(p, '.gcal-sheet')) {
    if (!(await press1(p, '.gcal-sheet', T.done))) await p.ev(`document.querySelector('.gcal-sheet-head button')?.click()`);
  }
  await sleep(500);
  return (await h.gcal()).connected ? 'ok' : 'not connected';
}
async function clickDisconnectGcal(h, p) {
  await gotoGcal(p);
  if (!(await press(p, GSEC, T.disconnect))) return 'no button';
  await soft(until('끊김', async () => !(await h.gcal()).connected, 10_000));
  return (await h.gcal()).connected ? 'still connected' : 'ok';
}

// ---- 웹 /admin 을 시험 앱 안 숨은 창에서 눌러 바꾼다 ----
async function openAdminWindow(h) {
  await h.main(`(() => { const e = ${ELECTRON}; const w = new e.BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { partition: 'qa-admin-${tag}' } }); globalThis.__qaAdmin = w; w.webContents.removeAllListeners('will-navigate'); w.loadURL(${JSON.stringify(`${apiUrl}/admin`)}); return true; })()`);
  const w = await h.target((u) => u.startsWith(`${apiUrl}/admin`));
  await until('운영자 로그인 폼', () => w.ev(`!!document.querySelector('input[name=token]')`), 15_000);
  await typeInto(w, 'input[name=token]', ADMIN_TOKEN);
  await w.ev(`(window.__qaNav = 1, document.querySelector('form[action="/admin/login"] button[type=submit]').click(), 1)`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  const ok = await soft(until('운영자 화면', () => w.ev(`!!document.querySelector('form[action="/admin/features/mode"]')`), 15_000));
  check('웹 /admin', '숨은 창에서 토큰 넣고 "로그인" 누르면 운영자 화면', ok);
  if (!ok) throw new Error('운영자 화면 안 열림');
  return w;
}
const featForm = (key, action, extra = '') => `[...document.querySelectorAll('form[action="${action}"]')].find((f) => f.querySelector('input[name=key]')?.value === '${key}'${extra})`;
async function adminClickMode(w, key, mode) {
  const ok = await w.ev(`(() => { const f = ${featForm(key, '/admin/features/mode')}; if (!f) return false; const s = f.querySelector('select[name=mode]'); s.value = '${mode}'; s.dispatchEvent(new Event('change', { bubbles: true })); f.querySelector('input[name=confirm]').click(); window.__qaNav = 1; f.querySelector('button[type=submit]').click(); return true; })()`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  return { ok, flash: await w.ev(`document.querySelector('.flash')?.textContent ?? ''`) };
}
async function adminClickAllow(w, key, account) {
  const ok = await w.ev(`(() => { const f = ${featForm(key, '/admin/features/allow', " && f.querySelector('input[name=allowed]')?.value === '1'")}; if (!f) return false; const i = f.querySelector('input[name=account]'); i.value = '${account}'; window.__qaNav = 1; f.querySelector('button[type=submit]').click(); return true; })()`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  return { ok, flash: await w.ev(`document.querySelector('.flash')?.textContent ?? ''`) };
}
async function adminClickRemove(w, key, account) {
  const ok = await w.ev(`(() => { const f = ${featForm(key, '/admin/features/allow', ` && f.querySelector('input[name=allowed]')?.value === '0' && f.querySelector('input[name=account]')?.value === '${account}'`)}; if (!f) return false; window.__qaNav = 1; f.querySelector('button[type=submit]').click(); return true; })()`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  return { ok, flash: await w.ev(`document.querySelector('.flash')?.textContent ?? ''`) };
}
const tableMode = (w, key) => w.ev(`[...document.querySelectorAll('table tr')].find((r) => r.querySelector('code')?.textContent === '${key}')?.lastElementChild?.textContent ?? ''`);

// ================= 2. 서버 주소 없음, 만 14세 미만, 로그인 안 함 =================
async function appNoUrl() {
  const F = '주소 없음';
  const h = await launch('nourl', { server: '' });
  try {
    const n0 = seen.length;
    const p = await openSettings(h);
    await gotoGcal(p);
    check(F, '서버 칸 없음, 구글 캘린더 칸은 있음, 안내 줄 없음', !(await has(p, '.server-box')) && (await has(p, GSEC)) && !(await hintShown(p)));
    check(F, '구글 캘린더 연결(가짜 구글) 누르기', (await clickConnectGcal(h, p)) === 'ok');
    await sleep(1500);
    check(F, '연결 뒤에도 서버 요청 0, 안내 없음, calendarHint false', seen.length === n0 && !(await hintShown(p)) && (await h.status()).calendarHint === false, seen.slice(n0).map((x) => `${x.m} ${x.p}`).join(','));
    await p.shots('n-01-gcal-connected-nourl', GSEC);
    check(F, '구글 쪽 https 는 가짜만 (진짜로 나간 것 없음)', (await h.main('JSON.stringify(globalThis.__qaHttps)')).includes('oauth2.googleapis.com/token'));
    p.close();
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    await h.quit();
  }
}
async function appUnder14() {
  const F = '만 14세 미만';
  const h = await launch('u14');
  try {
    const p = await openSettings(h);
    await tab(p, 'data');
    await until('서버 칸', () => has(p, '.server-box'), 15_000);
    await sleep(500);
    const n0 = seen.length;
    check(F, `"${T.under14}" 누르기`, await press(p, '.server-box', T.under14));
    await gotoGcal(p);
    check(F, '구글 캘린더 연결(가짜 구글) 누르기', (await clickConnectGcal(h, p)) === 'ok');
    await sleep(6000);
    check(F, '나이 답부터 연결 뒤까지 서버 요청 0건, 안내 없음', seen.length === n0 && !(await hintShown(p)) && (await h.status()).calendarHint === false, seen.slice(n0).map((x) => `${x.m} ${x.p}`).join(','));
    await p.shots('u-01-gcal-u14', GSEC);
    p.close();
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    await h.quit();
  }
}
/** 로그인 안 한 기기 계정: 구글 일정을 연결해도 연결 표시를 올리지 않는다. 그 뒤 로그인하면 올린다 */
async function appSignedOut(acct) {
  const F = '로그인 안 함';
  const h = await launch('out');
  try {
    const p = await openSettings(h);
    const id = await firstRun(h, p, F, 'qaOut');
    const n0 = seen.length;
    check(F, '구글 캘린더 연결(가짜 구글) 누르기', (await clickConnectGcal(h, p)) === 'ok');
    await clickSync(h, p);
    await sleep(1000);
    check(F, '연결하고 맞춰도 calendarLinked PATCH 0, DB 0, 안내 없음', calPatches(n0).length === 0 && linkedOf(id) === 0 && (await h.status()).calendarHint === false && !(await (gotoGcal(p).then(() => hintShown(p)))), JSON.stringify(calPatches(n0)));
    return { h, p, id };
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
    await h.quit();
    return null;
  }
}

// ================= 3. 같은 계정 두 기기 =================
const SUB_A = `qa-a-${tag}`;
async function appsAB() {
  const A = await launch('A');
  let pa;
  let pb;
  let B;
  let w;
  let accountId;
  try {
    // ---- 기기 A: 처음 켜기, 구글 로그인 ----
    let F = 'A 처음 켜기와 로그인';
    pa = await openSettings(A);
    await firstRun(A, pa, F, 'qaA');
    await A.main(`(__jj.store.reward(10, 'meet', Date.now()), 1)`);
    await clickSync(A, pa);
    check(F, `"${T.login}" 누르기 → 로그인`, (await clickLogin(A, pa, SUB_A)) === 'ok');
    await soft(until('로그인', async () => (await A.status()).signedIn && !(await A.status()).syncing, 15_000));
    accountId = sql(`SELECT account_id FROM login WHERE sub = '${SUB_A}'`);
    check(F, '로그인됨, 기본 allowlist 라 기능 키 false, 안내 없음', (await A.status()).signedIn && (await A.status()).features?.calendar_link_hint === false && (await A.status()).calendarHint === false, `계정 ${accountId}`);

    // ---- 웹 /admin: 허용 목록에 넣기 (클릭) ----
    F = '웹 /admin 허용';
    w = await openAdminWindow(A);
    // API 층이 먼저 돌았으면 모드를 폼으로 바꾼 뒤라 DB 값, 아니면 env 기본값
    const fresh = sql(`SELECT count(*) FROM feature_flag WHERE key = '${KEY}'`) === '0';
    check(F, `기능 스위치 표에 calendar_link_hint (허용 목록${fresh ? ', 서버 설정 기본값' : ''})`, /허용 목록/.test(await tableMode(w, KEY)) && (!fresh || /서버 설정 기본값/.test(await tableMode(w, KEY))), await tableMode(w, KEY));
    const al = await adminClickAllow(w, KEY, accountId);
    check(F, `허용할 계정 번호 넣고 "허용 목록에 넣기" 누르기`, al.ok && sql(`SELECT count(*) FROM feature_allow WHERE key = '${KEY}' AND account_id = ${accountId}`) === '1', al.flash);
    await w.shots('w-01-admin-features', `form[action="/admin/features/mode"] input[value="${KEY}"]`);

    // ---- A: 구글 캘린더 연결 ----
    F = 'A 구글 캘린더 연결';
    await sleep(CACHE);
    await clickSync(A, pa);
    check(F, '허용 뒤 맞추기 → 기능 키 true', (await A.status()).features?.calendar_link_hint === true);
    const n0 = seen.length;
    check(F, `"${T.connect}" 누르기 → 가짜 구글 허락 → 연결됨`, (await clickConnectGcal(A, pa)) === 'ok');
    await soft(until('표시 올림', async () => linkedOf(accountId) === 1, 10_000));
    const ps = calPatches(n0);
    check(F, '연결하면 바로 PATCH {calendarLinked:true} 를 기기 토큰으로, DB 1줄', ps.length === 1 && ps[0].body.calendarLinked === true && ps[0].auth === 'fd_' && ps[0].status === 200 && linkedOf(accountId) === 1, JSON.stringify(ps.map((x) => ({ b: x.body, a: x.auth, s: x.status }))));
    check(F, 'PATCH 본문은 calendarLinked 하나 (토큰 같은 것 안 보냄)', ps.every((x) => JSON.stringify(Object.keys(x.body)) === '["calendarLinked"]'));
    await gotoGcal(pa);
    check(F, 'A 자신에게는 안내 없음', !(await hintShown(pa)) && (await A.status()).calendarHint === false);
    await pa.shots('a-01-gcal-connected', GSEC);

    // ---- 기기 B: 처음 켜기, 코인, 같은 계정으로 로그인 → 합치기 확인 → 합치기 ----
    F = 'B 처음 켜기와 합치기';
    B = await launch('B');
    pb = await openSettings(B);
    await firstRun(B, pb, F, 'qaB');
    await B.main(`(__jj.store.reward(10, 'meet', Date.now()), 1)`);
    await clickSync(B, pb);
    await gotoGcal(pb);
    check(F, '로그인 전 B: 안내 없음', !(await hintShown(pb)) && (await B.status()).calendarHint === false);
    check(F, `"${T.login}" 누르기`, (await clickLogin(B, pb, SUB_A)) === 'ok');
    const merged = await soft(until('합치기 창', () => has(pb, '.server-merge'), 10_000));
    if (merged) {
      await pb.shots('b-01-merge', '.server-merge');
      check(F, `합치기 확인 창 → "${T.mergeYes}" 누르기`, await press(pb, '.server-merge', T.mergeYes));
    } else note(F, '합치기 확인 창 없이 로그인됨');
    await soft(until('B 로그인', async () => (await B.status()).signedIn && !(await B.status()).syncing, 15_000));
    const acctB = sql(`SELECT account_id FROM login WHERE sub = '${SUB_A}'`);
    check(F, 'B 로그인, A 와 같은 계정 (A 의 기기 줄도 같은 계정)', (await B.status()).signedIn && sql(`SELECT count(DISTINCT account_id) FROM device WHERE account_id = ${acctB}`) === '1' && Number(sql(`SELECT count(*) FROM device WHERE account_id = ${acctB}`)) >= 2, `계정 A ${accountId} → ${acctB}`);
    if (acctB !== accountId) note(F, `합치기로 남은 계정이 B 쪽 (${accountId} → ${acctB}). 허용 목록과 연결 표시가 따라왔는지 본다`);
    accountId = acctB;
    check(F, '합친 뒤 연결 표시가 남는 계정에 1, 허용 목록도 따라옴', linkedOf(accountId) === 1 && sql(`SELECT count(*) FROM feature_allow WHERE key = '${KEY}' AND account_id = ${accountId}`) === '1');

    // ---- B: 맞추기 → 안내 ----
    F = 'B 안내';
    await sleep(CACHE);
    await clickSync(B, pb);
    await gotoGcal(pb);
    await soft(until('안내 줄', () => hintShown(pb), 10_000));
    const hint = await pb.ev(`document.querySelector('.gcal-link-hint')?.textContent ?? ''`);
    check(F, '설정 > 구글 캘린더 칸에 안내 줄', hint === T.hint, hint);
    const btns = await pb.ev(`[...document.querySelectorAll('${GSEC} button')].map((b) => b.textContent.trim())`);
    check(F, `"${T.connect}" 와 "${T.no}" 단추`, btns.includes(T.connect) && btns.includes(T.no), btns.join(' | '));
    const order = await pb.ev(`(() => { const h = document.querySelector('.gcal-link-hint'); const b = [...document.querySelectorAll('${GSEC} button')].find((x) => x.textContent.trim() === ${JSON.stringify(T.connect)}); return h && b ? h.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1 : false; })()`);
    check(F, '안내 줄은 연결 단추 위', order);
    await pb.shots('b-02-hint', GSEC);

    // ---- B: 연결 단추 → 기존 연결 흐름 시작 → 그만두기 ----
    F = 'B 연결 단추';
    await B.main('globalThis.__qaOpened = null');
    check(F, `"${T.connect}" 누르기`, await press(pb, GSEC, T.connect));
    let opened;
    await soft(until('허락 주소', async () => (opened = await B.main('globalThis.__qaOpened ?? null')), 10_000));
    const u = opened ? new URL(opened) : null;
    check(F, '기존 구글 연결 흐름 (accounts.google.com, 127.0.0.1 루프백, PKCE S256, 캘린더 범위)', u?.origin === 'https://accounts.google.com' && /^http:\/\/127\.0\.0\.1:\d+$/.test(u.searchParams.get('redirect_uri') ?? '') && u.searchParams.get('code_challenge_method') === 'S256' && /calendar/.test(u.searchParams.get('scope') ?? ''), String(opened).slice(0, 90));
    await soft(until('기다림', async () => (await B.gcal()).connecting, 5_000));
    const during = await pb.ev(`[...document.querySelectorAll('${GSEC} button')].map((b) => b.textContent.trim() + (b.disabled ? '(꺼짐)' : ''))`);
    check(F, `기다리는 동안 "${T.no}" 숨김, "${T.cancel}" 보임, 안내 줄은 그대로`, !during.some((x) => x.startsWith(T.no)) && during.includes(T.cancel) && (await hintShown(pb)), during.join(' | '));
    await pb.shots('b-03-connecting', GSEC);
    check(F, `"${T.cancel}" 누르기`, await press(pb, GSEC, T.cancel));
    await soft(until('그만둠', async () => !(await B.gcal()).connecting, 10_000));
    check(F, '그만두면 연결 안 됨, 안내와 거절 단추 다시', !(await B.gcal()).connected && (await hintShown(pb)) && (await pb.ev(`[...document.querySelectorAll('${GSEC} button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.no)})`)));

    // ---- 기능 스위치 off / allowlist / everyone (웹 /admin 클릭) ----
    F = '기능 스위치';
    const flip = async (mode) => {
      const r = await adminClickMode(w, KEY, mode);
      await sleep(CACHE);
      await clickSync(B, pb);
      await gotoGcal(pb);
      await sleep(500);
      return r;
    };
    let r = await flip('off');
    check(F, '"꺼짐" 고르고 확인 → "모드 바꾸기" 누르기', r.ok && sql(`SELECT mode FROM feature_flag WHERE key = '${KEY}'`) === 'off', r.flash);
    check(F, 'off: B 지금 맞추기 → 기능 키 false, 안내 줄 없음', (await B.status()).features?.calendar_link_hint === false && !(await hintShown(pb)));
    r = await flip('allowlist');
    check(F, 'allowlist(허용 목록에 계정 있음) → 안내 다시', r.ok && (await B.status()).features?.calendar_link_hint === true && (await hintShown(pb)));
    const rm = await adminClickRemove(w, KEY, accountId);
    await sleep(CACHE);
    await clickSync(B, pb);
    await gotoGcal(pb);
    check(F, '허용 목록에서 "빼기" 누르기 → 안내 없음', rm.ok && sql(`SELECT count(*) FROM feature_allow WHERE key = '${KEY}' AND account_id = ${accountId}`) === '0' && !(await hintShown(pb)) && (await B.status()).features?.calendar_link_hint === false, rm.flash);
    r = await flip('everyone');
    check(F, 'everyone → 허용 목록 없이도 안내', r.ok && (await B.status()).features?.calendar_link_hint === true && (await hintShown(pb)));
    await w.shots('w-02-admin-features-everyone', `form[action="/admin/features/mode"] input[value="${KEY}"]`);

    // ---- A 끊기 → B 안내 사라짐 ----
    F = 'A 끊기';
    const n1 = seen.length;
    check(F, `A "${T.disconnect}" 누르기`, (await clickDisconnectGcal(A, pa)) === 'ok');
    await soft(until('표시 내림', async () => linkedOf(accountId) === 0, 10_000));
    check(F, 'A 끊으면 바로 PATCH false, DB 0', calPatches(n1).some((x) => x.body.calendarLinked === false && x.status === 200) && linkedOf(accountId) === 0);
    await gotoGcal(pb);
    await sleep(800);
    const staleBeforeSync = await hintShown(pb);
    note(F, `B 는 맞추기 전에는 안내가 남아 있음: ${staleBeforeSync} (다음 맞추기 3분 주기 또는 지금 맞추기에서 사라짐)`);
    await clickSync(B, pb);
    await gotoGcal(pb);
    await soft(until('안내 사라짐', async () => !(await hintShown(pb)), 5_000));
    check(F, 'B "지금 맞추기" 뒤 안내 사라짐', !(await hintShown(pb)) && (await B.status()).calendarHint === false);
    await pb.shots('b-04-after-a-disconnect', GSEC);
    // A 다시 연결 → B 다시
    check(F, 'A 다시 연결', (await clickConnectGcal(A, pa)) === 'ok');
    await soft(until('표시', async () => linkedOf(accountId) === 1, 10_000));
    await clickSync(B, pb);
    await gotoGcal(pb);
    check(F, 'A 다시 연결 → B 맞추기 뒤 안내 다시', await soft(until('안내', () => hintShown(pb), 5_000)));

    // ---- A 로그아웃한 뒤 끊으면 (탐색) ----
    F = 'A 로그아웃 뒤 끊기';
    await tab(pa, 'data');
    check(F, `A "${T.logout}" 누르기`, await press(pa, '.server-box', T.logout));
    await soft(until('로그아웃', async () => !(await A.status()).signedIn, 10_000));
    const n2 = seen.length;
    check(F, 'A 로그아웃 상태에서 연결 끊기', (await clickDisconnectGcal(A, pa)) === 'ok');
    await sleep(2000);
    await clickSync(A, pa);
    const staleRow = linkedOf(accountId);
    await clickSync(B, pb);
    await gotoGcal(pb);
    const staleHint = await hintShown(pb);
    check(F, '로그아웃한 기기가 끊어도 서버 표시가 내려가 B 안내가 사라짐', staleRow === 0 && !staleHint, `DB ${staleRow}, B 안내 ${staleHint}, A 의 calendarLinked PATCH ${JSON.stringify(calPatches(n2).map((x) => x.body))}`);
    if (staleRow) {
      check(F, `A 다시 로그인하면 거짓을 올려 고침`, (await clickLogin(A, pa, SUB_A)) === 'ok' && (await soft(until('고침', async () => linkedOf(accountId) === 0, 15_000))));
      await clickSync(B, pb);
      await gotoGcal(pb);
      check(F, 'A 다시 로그인 뒤 B 맞추기 → 안내 사라짐', !(await hintShown(pb)));
    }
    // 다시 A 연결 상태로 (B 의 거절 흐름을 위해)
    if ((await A.status()).signedIn === false) await clickLogin(A, pa, SUB_A);
    await soft(until('A 로그인', async () => (await A.status()).signedIn, 10_000));
    await clickConnectGcal(A, pa);
    await soft(until('표시', async () => linkedOf(accountId) === 1, 10_000));

    // ---- B 다시 켜기 → 안내 → 거절 → 다시 켜도 안 물음 ----
    F = 'B 거절';
    pb.close();
    pb = undefined;
    await B.quit(true);
    const relogin = async (label) => {
      const B2 = await launch(label, { data: B.data });
      const p2 = await openSettings(B2);
      await tab(p2, 'data');
      await soft(until('기기 계정', async () => (await B2.status()).device && !(await B2.status()).syncing, 30_000));
      const lr = await clickLogin(B2, p2, SUB_A);
      if (await soft(until('합치기 창', () => has(p2, '.server-merge'), 6_000))) await press(p2, '.server-merge', T.mergeYes);
      await soft(until('로그인', async () => (await B2.status()).signedIn && !(await B2.status()).syncing, 15_000));
      accountId = sql(`SELECT account_id FROM login WHERE sub = '${SUB_A}'`);
      await sleep(CACHE);
      await clickSync(B2, p2);
      await gotoGcal(p2);
      return { B2, p2, lr };
    };
    let { B2, p2, lr } = await relogin('B2');
    check(F, `다시 켠 B: "${T.login}" 누르기 → 로그인`, lr === 'ok' && (await B2.status()).signedIn);
    await soft(until('안내', () => hintShown(p2), 8_000));
    check(F, '다시 켠 B 에 안내', await hintShown(p2));
    check(F, `"${T.no}" 누르기`, await press(p2, GSEC, T.no));
    await soft(until('닫힘', async () => !(await hintShown(p2)), 5_000));
    check(F, '거절하면 안내 줄과 거절 단추가 바로 사라지고 연결 단추는 남음', !(await hintShown(p2)) && !(await p2.ev(`[...document.querySelectorAll('${GSEC} button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.no)})`)) && (await p2.ev(`[...document.querySelectorAll('${GSEC} button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.connect)})`)));
    check(F, '거절은 이 기기 server-state.json 에만 (서버 요청 없음)', JSON.parse(readFileSync(join(B.data, 'server-state.json'), 'utf8')).calendarHintNo === true);
    await p2.shots('b-05-declined', GSEC);
    p2.close();
    await B2.quit(true);
    ({ B2, p2, lr } = await relogin('B3'));
    await sleep(1500);
    check(F, '앱 다시 켜고 다시 로그인해도 안 물음 (서버는 여전히 연결 1)', (await B2.status()).signedIn && linkedOf(accountId) === 1 && !(await hintShown(p2)) && (await B2.status()).calendarHint === false, `로그인 ${lr}`);
    p2.close();
    await B2.quit();
    B = undefined;
  } catch (err) {
    check('A/B', '중단', false, err instanceof Error ? err.stack : String(err));
  } finally {
    pa?.close();
    pb?.close();
    w?.close();
    await A.quit();
    if (B) await B.quit();
  }
  return accountId;
}

/** 로그인 안 한 채 연결해 둔 기기가 같은 계정으로 로그인하면 그때 올린다 */
async function signedOutThenLogin(o, accountId) {
  const F = '로그인 안 함 → 로그인';
  if (!o) return;
  const { h, p } = o;
  try {
    const before = accountId ? linkedOf(accountId) : 0;
    const n0 = seen.length;
    check(F, `"${T.login}" 누르기 (A 와 같은 계정)`, (await clickLogin(h, p, SUB_A)) === 'ok');
    if (await soft(until('합치기 창', () => has(p, '.server-merge'), 6_000))) await press(p, '.server-merge', T.mergeYes);
    await soft(until('로그인', async () => (await h.status()).signedIn && !(await h.status()).syncing, 15_000));
    const acct = sql(`SELECT account_id FROM login WHERE sub = '${SUB_A}'`);
    await soft(until('올림', async () => calPatches(n0).some((x) => x.body.calendarLinked === true), 10_000));
    check(F, '로그인하면 이미 연결된 이 기기 표시를 올림 (기기 수 +1)', calPatches(n0).some((x) => x.body.calendarLinked === true && x.status === 200) && linkedOf(acct) === before + 1, `${before} → ${linkedOf(acct)}`);
    if (linkedOf(acct) !== before + 1) {
      note(F, `gcal ${JSON.stringify(await h.gcal()).slice(0, 200)} / status features ${JSON.stringify((await h.status()).features)} / state calendarSent ${JSON.parse(await h.main('JSON.stringify(__jj.server.core.state())')).calendarSent}`);
      note(F, readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => /server|gcal/.test(l)).slice(-15).join(' || '));
    }
    await gotoGcal(p);
    check(F, '연결된 기기라 안내 없음', !(await hintShown(p)));
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    p.close();
    await h.quit();
  }
}

let crashed = false;
try {
  const only = (process.env.QA_ONLY ?? '').split(',').filter(Boolean);
  const want = (k) => only.length === 0 || only.includes(k);
  if (want('api')) await apiLayer();
  if (want('nourl')) await appNoUrl();
  if (want('u14')) await appUnder14();
  if (process.env.QA_FEATURE) {
    await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
    await setFeature(KEY, process.env.QA_FEATURE);
    await sleep(CACHE);
  }
  if (process.env.QA_PRE) await newUser(SUB_A);
  const out = want('out') ? await appSignedOut() : null;
  let acct;
  if (want('ab')) acct = await appsAB();
  if (out) await signedOutThenLogin(out, acct);
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
for (const h of [...live]) await h.quit();
await nest.close().catch(() => {});
dropPg();
for (let i = 0; i < 3; i++) {
  await sleep(500);
  rmSync(scratchAll, { recursive: true, force: true });
}
if (limited().length) note('서버', `429 받은 요청: ${[...new Set(limited())].join(', ')} (${limited().length}건)`);
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS${crashed ? ', 중단됨' : ''}  화면: ${OUT}`);
for (const r of bad) console.log(`  FAIL [${r.area}] ${r.name} (${r.extra})`);
process.exit(bad.length || crashed ? 1 : 0);
