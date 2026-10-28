// PR #112 (#102) QA: 서버 백업, 외장 디스크 복사 서비스, 카카오 로그인(기능 키), 코인 초기화 기능 키, 1년 정리, 로그인 직후 맞추기.
// 세 층(API, 화면 클릭, 화면 모양)을 경우마다 PASS/FAIL 로 본다. 앱은 화면 단추를 눌러 움직이고(__jj 는 상태 준비만),
// 웹 /admin 기능 스위치는 시험 앱 안 숨은 창(show:false)에 띄워 폼 요소를 눌러 바꾼다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr112.mjs
//
// - 서버는 이 프로세스 안에서 server/dist 의 createApp 으로 띄운다 (가짜 구글: 시험 RSA 키, 가짜 카카오: server/scripts/fake-kakao.mjs,
//   시계 주입, BACKUP_TOTAL_MAX_GB=0.05 로 전체 상한을 작게). 키 없는 서버(BACKUP_ENC_KEY 비움)를 하나 더 띄워 503 을 본다
// - 외장 디스크 복사: server/ops/backup-files 를 시험용 compose 파일(이름 jj-qa112-bf-<무작위>)로 띄워 서버 백업 폴더 → 시험 폴더.
//   운영 compose(docker-compose.prod.yml)와 .env.prod 는 읽지도 돌리지도 않는다
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만.
//   브라우저 열기는 메인의 shell.openExternal 을 바꿔 끼워 이 스크립트가 fetch 로 따라간다
// - 컨테이너는 jj-qa112-pg-<무작위>, jj-qa112-bf-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeKakao } from '../../server/scripts/fake-kakao.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `qa-pr112-${LANG}`));
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
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${extra ? ` (${String(extra).replace(/\n/g, ' ').slice(0, 240)})` : ''}`);
}
const note = (area, text) => console.log(`NOTE [${area}] ${text}`);
const DAY = 86_400_000;
const MB20 = 20 * 1024 * 1024;

// ---- 시험용 Postgres ----
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const tag = randomBytes(4).toString('hex');
const pgName = `jj-qa112-pg-${tag}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker('run', '-d', '--rm', '--tmpfs', '/var/lib/postgresql/data', '--name', pgName, '--log-opt', 'max-size=1m', '-e', `POSTGRES_PASSWORD=${pgPass}`,
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

// ---- 가짜 구글, 가짜 카카오 ----
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
const KAKAO_KEY = 'qa-kakao-rest-key';
const KAKAO_SECRET = randomBytes(12).toString('hex');
const kakao = await startFakeKakao({ clientId: KAKAO_KEY, clientSecret: KAKAO_SECRET });

// ---- 페어리 서버 둘 (이 프로세스 안, 시계 주입): 본 서버와 백업 키 없는 서버 ----
const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.qa112-'));
const backupDir = join(scratchAll, 'server-backups');
mkdirSync(backupDir, { recursive: true });
const serverReq = createRequire(join(root, 'server', 'package.json'));
const { createApp } = serverReq('./dist/app.js');
const { readConfig } = serverReq('./dist/config.js');
const { Backups } = serverReq('./dist/backup.js');
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const TOTAL_GB = 0.05;
const CAP = Math.round(TOTAL_GB * 1024 ** 3);
let clockShift = 0;
const baseEnv = {
  DATABASE_URL: databaseUrl,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'qa-secret',
  KAKAO_REST_API_KEY: KAKAO_KEY,
  KAKAO_CLIENT_SECRET: KAKAO_SECRET,
  KAKAO_AUTH_URL: kakao.url,
  ADMIN_TOKEN,
  ADMIN_GOOGLE_SUBS: `qa-admin-${tag}`,
};
const seen = [];
const nest = await createApp(
  readConfig({ ...baseEnv, PORT: String(apiPort), PUBLIC_URL: apiUrl, BACKUP_ENC_KEY: randomBytes(32).toString('hex'), BACKUP_DIR: backupDir, BACKUP_TOTAL_MAX_GB: String(TOTAL_GB) }),
  { google: fakeGoogle, now: () => Date.now() + clockShift },
);
/** 웹 /admin 폼이 보낸 출처 머리 (브라우저가 실제로 무엇을 보내는지) */
const adminPosts = [];
nest.use((req, _res, next) => {
  seen.push(`${req.method} ${req.path}`);
  if (req.method === 'POST' && req.path.startsWith('/admin')) adminPosts.push({ path: req.path, origin: req.headers.origin, site: req.headers['sec-fetch-site'], cookie: !!req.headers.cookie });
  next();
});
await nest.listen(apiPort, '127.0.0.1');
const backups = nest.get(Backups);
const nokeyPort = await freePort();
const nokeyUrl = `http://127.0.0.1:${nokeyPort}`;
const nokeyDir = join(scratchAll, 'nokey-backups');
mkdirSync(nokeyDir, { recursive: true });
const nest2 = await createApp(
  readConfig({ ...baseEnv, PORT: String(nokeyPort), PUBLIC_URL: nokeyUrl, BACKUP_ENC_KEY: '', BACKUP_DIR: nokeyDir }),
  { google: fakeGoogle },
);
await nest2.listen(nokeyPort, '127.0.0.1');
console.log('server', apiPort, 'nokey', nokeyPort, 'pg', pgName, 'lang', LANG, 'cap', CAP);

// ---- API 도우미 ----
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function api(method, path, { token, body, from = ip(), raw = false, headers = {}, base = apiUrl, bin } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'cf-connecting-ip': from,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(bin !== undefined ? { 'content-type': 'application/octet-stream' } : {}),
      ...headers,
    },
    body: bin !== undefined ? bin : body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    ...(bin instanceof ReadableStream ? { duplex: 'half' } : {}),
  }).catch((e) => ({ status: 0, err: e, headers: new Headers(), text: async () => String(e?.cause?.code ?? e), arrayBuffer: async () => new ArrayBuffer(0) }));
  if (raw === 'bytes') return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: raw ? text : undefined, headers: res.headers };
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
  const base = new URL(startUrl).origin;
  const cb = await fetch(`${base}/auth/google/callback?state=${g.searchParams.get('state')}&code=fake-code`, { redirect: 'manual', headers: { 'cf-connecting-ip': from } });
  return { done: cb.headers.get('location') ?? '' };
}
/** 카카오 인가 주소(가짜 카카오) → 서버 콜백 → 앱 루프백 주소 (따라가지 않고 Location 만) */
async function kakaoBrowser(authUrl, sub) {
  kakao.state.nextSub = sub;
  const a = await fetch(authUrl, { redirect: 'manual' });
  if (a.status !== 302) return { error: `authorize ${a.status}` };
  const cb = await fetch(a.headers.get('location') ?? '', { redirect: 'manual' });
  return { done: cb.headers.get('location') ?? '', status: cb.status };
}
async function apiLogin(token, sub, merge, base = apiUrl) {
  const v = verifierNew();
  const f = await googleBrowser(`${base}/auth/google/start?port=5000&state=${appState()}&challenge=${challengeOf(v)}`, sub);
  const code = new URL(f.done).searchParams.get('code');
  return api('POST', '/v1/session', { token, body: { code, verifier: v, ...(merge ? { merge } : {}) }, base });
}
const newDevice = async (base = apiUrl) => (await api('POST', '/v1/device', { body: { age: '18+' }, base })).json;
async function newUser(base = apiUrl) {
  const d = await newDevice(base);
  const sub = `qa-u-${randomBytes(4).toString('hex')}`;
  const s = await apiLogin(d.token, sub, false, base);
  return { device: d.token, session: s.json.session, id: String(d.account.id), code: d.account.code, sub };
}
/** zip 머리(PK\x03\x04)로 시작하는 n 바이트 */
const zipBytes = (n) => {
  const b = n > 4096 ? Buffer.alloc(n, 0x5a) : randomBytes(n);
  if (n > 4096) randomBytes(4096).copy(b, 4);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(b, 0);
  return b;
};
const put = (session, bin, q = '?consent=yes', base = apiUrl) => api('PUT', `/v1/backup${q}`, { token: session, bin, base });
const fbk = () => readdirSync(backupDir).filter((f) => f.endsWith('.fbk'));
const parts = () => readdirSync(backupDir).filter((f) => f.endsWith('.part'));
const totalDb = () => Number(sql('SELECT COALESCE(sum(size),0) FROM backup'));
const fileOf = (id) => sql(`SELECT file FROM backup WHERE id = ${id}`);

// ---- 웹 운영자 (쿠키, CSRF, fetch 로. 화면 클릭은 앱 안 숨은 창에서) ----
const web = { cookie: '', csrf: '' };
async function adminPage(q = '') {
  const r = await fetch(`${apiUrl}/admin${q}`, { headers: { cookie: web.cookie } });
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
  return { status: r.status, flash: /<p class="flash( error)?( wide)?" role="(?:status|alert)"(?: id="form-(?:error|ok)")?>([^<]*)<\/p>/.exec(page.text)?.[3] ?? '', error: /<p class="flash error"/.test(page.text) };
}
const setFeature = (key, mode) => adminPost('/admin/features/mode', { key, mode, confirm: 'yes' });
const allowFeature = (key, account, on = true) => adminPost('/admin/features/allow', { key, account, allowed: on ? '1' : '0' });
const CACHE = 5_300;

// ================= 1. API 층 =================
async function apiLayer() {
  const A = 'API 백업';
  const u = await newUser();
  // 형식과 권한
  check(A, 'PUT 기기 토큰 → 403 login', ((r) => r.status === 403 && r.json?.error === 'login')(await put(u.device, zipBytes(100))));
  check(A, 'PUT consent 없음 → 400 consent', ((r) => r.status === 400 && r.json?.error === 'consent')(await put(u.session, zipBytes(100), '')));
  const j = await api('PUT', '/v1/backup?consent=yes', { token: u.session, body: { a: 1 } });
  check(A, 'PUT application/json → 415', j.status === 415, `${j.status} ${JSON.stringify(j.json)}`);
  check(A, 'PUT 빈 본문 → 400 empty', ((r) => r.status === 400 && r.json?.error === 'empty')(await put(u.session, Buffer.alloc(0))));
  check(A, 'PUT zip 아님 → 400 format', ((r) => r.status === 400 && r.json?.error === 'format')(await put(u.session, randomBytes(64).fill(0x41, 0, 4))));
  // 20MB 경계
  const exact = zipBytes(MB20);
  const ok20 = await put(u.session, exact);
  check(A, '정확히 20MB(20971520) → 201', ok20.status === 201 && ok20.json?.backup?.size === MB20, `${ok20.status} ${ok20.json?.backup?.size}`);
  const over = await put(u.session, zipBytes(MB20 + 1));
  check(A, '20MB + 1 바이트 (content-length) → 413 too_big', over.status === 413 && over.json?.error === 'too_big', `${over.status} ${JSON.stringify(over.json)}`);
  const big = zipBytes(MB20 + 1);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20)));
      c.close();
    },
  });
  const overS = await put(u.session, stream);
  check(A, '20MB + 1 바이트 (흘려 보냄, 길이 없음) → 413 too_big', overS.status === 413 && overS.json?.error === 'too_big', `${overS.status} ${JSON.stringify(overS.json)}`);
  await sleep(300);
  check(A, '413 뒤 쓰다 만 파일(.part)이 남지 않음', parts().length === 0, parts().join(','));
  // 목록 모양
  const list = await api('GET', '/v1/backup', { token: u.session });
  const it = list.json?.backups?.[0];
  check(A, 'GET 목록 모양 { backups:[{id,size,sha256,createdAt,lastAccessAt,expiresAt,soon}], keep:2, maxBytes }',
    list.status === 200 && list.json.keep === 2 && list.json.maxBytes === MB20 && it && ['id', 'size', 'sha256', 'createdAt', 'lastAccessAt', 'expiresAt', 'soon'].every((k) => k in it) && it.soon === false && it.sha256 === createHash('sha256').update(exact).digest('hex'),
    JSON.stringify(list.json).slice(0, 200));
  check(A, 'GET 목록 기기 토큰 → 403', (await api('GET', '/v1/backup', { token: u.device })).status === 403);
  // 디스크 = 암호문, DB = 메타
  const file = fileOf(it.id);
  const disk = readFileSync(join(backupDir, `${file}.fbk`));
  check(A, '디스크 파일: "FBK1" + iv + 암호문 + tag (크기 = 원본 + 32), 평문 아님', disk.subarray(0, 4).toString() === 'FBK1' && disk.length === MB20 + 32 && !disk.subarray(16, 4096).equals(exact.subarray(0, 4080)), `${disk.length}`);
  // 받기
  const access0 = sql(`SELECT last_access_at FROM backup WHERE id = ${it.id}`);
  const head = await api('HEAD', `/v1/backup/${it.id}`, { token: u.session });
  check(A, 'HEAD /v1/backup/:id → 405, 마지막 접근 그대로', head.status === 405 && sql(`SELECT last_access_at FROM backup WHERE id = ${it.id}`) === access0, `${head.status}`);
  const got = await api('GET', `/v1/backup/${it.id}`, { token: u.session, raw: 'bytes' });
  check(A, 'GET /v1/backup/:id → 평문 그대로, x-backup-sha256 일치', got.status === 200 && got.bytes.equals(exact) && got.headers.get('x-backup-sha256') === it.sha256 && got.headers.get('cache-control') === 'no-store', `${got.status} ${got.bytes.length}`);
  check(A, '받으면 last_access_at 이 고쳐짐', sql(`SELECT last_access_at FROM backup WHERE id = ${it.id}`) !== access0);
  // 다른 계정
  const other = await newUser();
  const og = await api('GET', `/v1/backup/${it.id}`, { token: other.session });
  const od = await api('DELETE', `/v1/backup/${it.id}`, { token: other.session });
  check(A, '다른 계정의 백업 GET/DELETE → 404 not_found, 줄은 남음', og.status === 404 && og.json?.error === 'not_found' && od.status === 404 && sql(`SELECT count(*) FROM backup WHERE id = ${it.id}`) === '1');
  check(A, '숫자 아닌 id → 404', (await api('GET', '/v1/backup/abc', { token: u.session })).status === 404);
  const del = await api('DELETE', `/v1/backup/${it.id}`, { token: u.session });
  check(A, 'DELETE → 204, 줄과 디스크 파일 지움', del.status === 204 && sql(`SELECT count(*) FROM backup WHERE id = ${it.id}`) === '0' && !existsSync(join(backupDir, `${file}.fbk`)));
  // 최근 2개 (올리기는 계정마다 한 시간 10번이라 새 계정으로)
  const u2 = await newUser();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    await sleep(20);
    ids.push((await put(u2.session, zipBytes(2000 + i))).json?.backup?.id);
    if (i === 0) var firstFile = fileOf(ids[0]);
  }
  const after = (await api('GET', '/v1/backup', { token: u2.session })).json?.backups?.map((x) => x.id) ?? [];
  check(A, '세 개 올리면 최근 2개만 (가장 오래된 것 사라짐, DB와 디스크)', after.length === 2 && after[0] === ids[2] && after[1] === ids[1] && sql(`SELECT count(*) FROM backup WHERE account_id = ${u2.id}`) === '2' && sql(`SELECT count(*) FROM backup WHERE id = ${ids[0]}`) === "0" && !existsSync(join(backupDir, `${firstFile}.fbk`)), `${after} / ${ids}`);

  // 전체 상한 (BACKUP_TOTAL_MAX_GB=0.05)
  const C = 'API 전체 상한';
  const fillers = [];
  const fillTo = async (target) => {
    for (let n = 0; n < 6; n++) {
      const room = target - totalDb();
      if (room <= 0) return;
      const f = await newUser();
      const r = await put(f.session, zipBytes(Math.min(room, MB20)));
      if (r.status !== 201) return note(C, `채우기 실패 ${r.status} ${JSON.stringify(r.json)}`);
      fillers.push(f);
    }
  };
  await fillTo(CAP - 10);
  check(C, `서버 합계를 상한 - 10 바이트로 채움 (상한 ${CAP})`, totalDb() === CAP - 10, `${totalDb()}`);
  const t1 = await newUser();
  const n0 = fbk().length;
  const over11 = await put(t1.session, zipBytes(11));
  check(C, '상한을 1바이트 넘는 올리기 → 507 storage_full, 파일 안 남음', over11.status === 507 && over11.json?.error === 'storage_full' && fbk().length === n0 && parts().length === 0, `${over11.status} ${JSON.stringify(over11.json)}`);
  const at10 = await put(t1.session, zipBytes(10));
  check(C, '상한에 딱 맞는 올리기(합계 = 상한) → 201', at10.status === 201 && totalDb() === CAP, `${at10.status} ${totalDb()}`);
  const full = await put(t1.session, zipBytes(10));
  check(C, '꽉 찬 뒤 올리기 → 507 (미리 검사)', full.status === 507 && full.json?.error === 'storage_full');
  // 남의 것을 밀어내 자리를 만들지 않는다: 같은 계정은 가장 오래된 것을 지운 뒤 다시 잰다
  await api('DELETE', `/v1/backup/${at10.json.backup.id}`, { token: t1.session });
  for (const f of fillers) for (const b of (await api('GET', '/v1/backup', { token: f.session })).json.backups) await api('DELETE', `/v1/backup/${b.id}`, { token: f.session });
  check(C, '채운 것 지우면 합계가 돌아옴', totalDb() < CAP - MB20, `${totalDb()}`);

  // 키 없는 서버
  const K = 'API 키 없음';
  const nk = await newUser(nokeyUrl);
  const nl = await api('GET', '/v1/backup', { token: nk.session, base: nokeyUrl });
  const np = await put(nk.session, zipBytes(100), '?consent=yes', nokeyUrl);
  check(K, 'BACKUP_ENC_KEY 비면 GET/PUT → 503 backup_off', nl.status === 503 && nl.json?.error === 'backup_off' && np.status === 503 && np.json?.error === 'backup_off', `${nl.status} ${np.status}`);

  // 탈퇴: 줄과 디스크 파일
  const D = 'API 탈퇴';
  const d1 = await newUser();
  await put(d1.session, zipBytes(3000));
  await put(d1.session, zipBytes(3001));
  const mine = sql(`SELECT string_agg(file, ',') FROM backup WHERE account_id = ${d1.id}`).split(',');
  const rm = await api('DELETE', '/v1/account', { token: d1.session });
  check(D, '탈퇴 → 204, 백업 줄 0, 디스크 파일 0', rm.status === 204 && sql(`SELECT count(*) FROM backup WHERE account_id = ${d1.id}`) === '0' && mine.every((f) => !existsSync(join(backupDir, `${f}.fbk`))), mine.join(','));
  // 합친 직후 탈퇴
  const x = await newUser();
  const y = await newUser();
  for (const n of [1, 2]) await put(x.session, zipBytes(4000 + n));
  for (const n of [1, 2]) await put(y.session, zipBytes(5000 + n));
  const fourFiles = sql(`SELECT string_agg(file, ',') FROM backup WHERE account_id IN (${x.id}, ${y.id})`).split(',');
  const m1 = await apiLogin(y.session, x.sub);
  const m2 = m1.status === 409 ? await apiLogin(y.session, x.sub, true) : m1;
  const onDisk = fourFiles.filter((f) => existsSync(join(backupDir, `${f}.fbk`)));
  check(D, '두 계정 백업 2+2 를 합치면 최근 2개만, 빠진 파일은 바로 디스크에서도 지움', m1.status === 409 && m2.status === 200 && onDisk.length === 2 && sql(`SELECT count(*) FROM backup WHERE account_id IN (${x.id}, ${y.id})`) === '2', `${m1.status} ${m2.status} 디스크 ${onDisk.length}`);
  const rm2 = await api('DELETE', '/v1/account', { token: m2.json?.session });
  check(D, '합친 직후 탈퇴 → 네 파일 모두 디스크에 없음, 줄 0', rm2.status === 204 && fourFiles.every((f) => !existsSync(join(backupDir, `${f}.fbk`))) && sql(`SELECT count(*) FROM backup WHERE account_id IN (${x.id}, ${y.id})`) === '0');

  // 1년 정리 (계정 활동 기준, 시계 주입)
  const Y = 'API 1년 정리';
  const z = await newUser();
  const zb = (await put(z.session, zipBytes(6000))).json.backup;
  const zf = fileOf(zb.id);
  sql(`UPDATE account SET last_active_at = now() - interval '2 days' WHERE id = ${z.id}`);
  await api('GET', '/v1/me', { token: z.device });
  check(Y, '토큰 든 요청(기기 토큰)이 오면 계정 활동이 고쳐짐 (하루 넘었을 때)', sql(`SELECT last_active_at > now() - interval '1 minute' FROM account WHERE id = ${z.id}`) === 't');
  sql(`UPDATE account SET last_active_at = now() - interval '1 hour' WHERE id = ${z.id}`);
  const active = new Date(sql(`SELECT to_char(last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM account WHERE id = ${z.id}`)).getTime();
  const at = async (t) => {
    clockShift = t - Date.now();
    const r = (await api('GET', '/v1/backup', { token: z.session })).json?.backups?.[0];
    clockShift = 0;
    return r;
  };
  const b1 = await at(active + 335 * DAY - 60_000);
  const b2 = await at(active + 335 * DAY + 60_000);
  check(Y, '지우기 30일 + 1분 전: soon=false, expiresAt = 활동 + 365일', b1?.soon === false && new Date(b1.expiresAt).getTime() === active + 365 * DAY, JSON.stringify(b1));
  check(Y, '지우기 30일 - 1분 전: soon=true', b2?.soon === true, JSON.stringify(b2));
  const s1 = await backups.sweep(active + 365 * DAY - 60_000);
  check(Y, '정리(활동 + 365일 - 1분): 그대로', sql(`SELECT count(*) FROM backup WHERE id = ${zb.id}`) === '1' && existsSync(join(backupDir, `${zf}.fbk`)), JSON.stringify(s1));
  const s2 = await backups.sweep(active + 365 * DAY + 60_000);
  check(Y, '정리(활동 + 365일 + 1분): 줄과 파일 지움', sql(`SELECT count(*) FROM backup WHERE id = ${zb.id}`) === '0' && !existsSync(join(backupDir, `${zf}.fbk`)) && s2.expired >= 1, JSON.stringify(s2));
  // 받기(last_access)는 기준이 아니다: 계정 활동만
  const w = await newUser();
  const wb = (await put(w.session, zipBytes(6100))).json.backup;
  sql(`UPDATE account SET last_active_at = now() - interval '366 days' WHERE id = ${w.id}`);
  sql(`UPDATE backup SET last_access_at = now() WHERE id = ${wb.id}`);
  await backups.sweep();
  check(Y, '마지막 접근이 최근이어도 계정 활동이 1년 넘으면 지움 (기준 = 계정 활동)', sql(`SELECT count(*) FROM backup WHERE id = ${wb.id}`) === '0');
  // 줄 없는 파일, 쓰다 만 파일 (10분 유예)
  const orphan = join(backupDir, `${randomBytes(16).toString('hex')}.fbk`);
  const part = join(backupDir, `${randomBytes(16).toString('hex')}.part`);
  writeFileSync(orphan, 'x');
  writeFileSync(part, 'x');
  await backups.sweep();
  const keptFresh = existsSync(orphan) && existsSync(part);
  await backups.sweep(Date.now() + 11 * 60_000);
  check(Y, '줄 없는 파일과 .part: 10분 안이면 남기고 넘으면 지움', keptFresh && !existsSync(orphan) && !existsSync(part));

  // ---- 카카오 (기능 키) ----
  const KK = 'API 카카오';
  const login0 = await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
  check(KK, '웹 /admin 로그인 (fetch)', login0.status === 303 && !!web.cookie);
  const pv = await api('GET', '/v1/auth/providers');
  check(KK, 'off(기본): providers login=[google], 카카오 없음', JSON.stringify(pv.json) === '{"login":["google"],"link":[]}', JSON.stringify(pv.json));
  const st0 = await api('GET', `/auth/kakao/start?port=5000&state=${appState()}&challenge=${challengeOf(verifierNew())}`);
  check(KK, 'off: /auth/kakao/start → 503 feature_off', st0.status === 503 && st0.json?.error === 'feature_off');
  const ka = await newUser();
  const kb = await newUser();
  const begin = (token) => api('POST', '/v1/auth/kakao/begin', { token, body: { port: '5000', state: appState(), challenge: challengeOf(verifierNew()) } });
  check(KK, 'off: begin(세션) → 503 feature_off', ((r) => r.status === 503 && r.json?.error === 'feature_off')(await begin(ka.session)));
  // 친구 기능 키(#110)가 같은 목록에 더해졌다: 이 둘만 본다 (#115 의 calendar_link_hint 도 있다)
  const offFeatures = (await api('GET', '/v1/features', { token: ka.session })).json?.features ?? {};
  check(KK, 'off: GET /v1/features → kakao_login false, coin_reset false', offFeatures.kakao_login === false && offFeatures.coin_reset === false, JSON.stringify(offFeatures));
  // allowlist (운영자 폼)
  const fm = await setFeature('kakao_login', 'allowlist');
  const fa = await allowFeature('kakao_login', ka.id);
  check(KK, '운영자 폼: kakao_login allowlist, 계정 넣기', fm.status === 303 && !fm.error && fa.status === 303 && !fa.error && sql(`SELECT account_id FROM feature_allow WHERE key = 'kakao_login'`) === ka.id, `${fm.flash} / ${fa.flash}`);
  const st1 = await api('GET', `/auth/kakao/start?port=5000&state=${appState()}&challenge=${challengeOf(verifierNew())}`);
  check(KK, 'allowlist: 브라우저 /auth/kakao/start → 403 login (로그인 전 가입 막힘)', st1.status === 403 && st1.json?.error === 'login', `${st1.status} ${JSON.stringify(st1.json)}`);
  check(KK, 'allowlist: begin(기기 토큰) → 403 login', ((r) => r.status === 403 && r.json?.error === 'login')(await begin(ka.device)));
  const bOther = await begin(kb.session);
  check(KK, 'allowlist: 허용 안 된 세션 begin → 403', bOther.status === 403, `${bOther.status} ${JSON.stringify(bOther.json)}`);
  check(KK, 'allowlist: providers link 는 허용 계정에만 kakao', JSON.stringify((await api('GET', '/v1/auth/providers', { token: ka.session })).json.link) === '["google","kakao"]' && JSON.stringify((await api('GET', '/v1/auth/providers', { token: kb.session })).json.link) === '["google"]');
  const v = verifierNew();
  const bOk = await api('POST', '/v1/auth/kakao/begin', { token: ka.session, body: { port: '5000', state: appState(), challenge: challengeOf(v) } });
  const kf = bOk.status === 200 ? await kakaoBrowser(bOk.json.url, `7${Date.now()}`) : { error: bOk.status };
  const kcode = kf.done ? new URL(kf.done).searchParams.get('code') : null;
  const stolen = await api('POST', '/v1/session', { token: kb.session, body: { code: kcode, verifier: v } });
  check(KK, '허용 계정의 카카오 코드를 다른 세션이 쓰면 403', stolen.status === 403, `${stolen.status} ${JSON.stringify(stolen.json)} begin ${bOk.status} ${JSON.stringify(bOk.json)} flow ${JSON.stringify(kf)}`);
  // 코드는 한 번만: 다시 받는다
  const v2 = verifierNew();
  const bk2 = await api('POST', '/v1/auth/kakao/begin', { token: ka.session, body: { port: '5000', state: appState(), challenge: challengeOf(v2) } });
  const kf2 = await kakaoBrowser(bk2.json.url, `7${Date.now()}`);
  const s = await api('POST', '/v1/session', { token: ka.session, body: { code: new URL(kf2.done).searchParams.get('code'), verifier: v2 } });
  check(KK, '허용 계정 연결 → logins [google, kakao], DB 한 계정에 두 줄', s.status === 200 && JSON.stringify(s.json.logins) === '["google","kakao"]' && sql(`SELECT string_agg(service, ',' ORDER BY service) FROM login WHERE account_id = ${ka.id}`) === 'google,kakao', `${s.status} ${JSON.stringify(s.json)}`);
  check(KK, '카카오 인가 요청 scope 는 openid 만', kakao.state.scopes.length > 0 && kakao.state.scopes.every((x) => x === 'openid'), kakao.state.scopes.join(','));
  // everyone
  await setFeature('kakao_login', 'everyone');
  await sleep(CACHE);
  const st2 = await fetch(`${apiUrl}/auth/kakao/start?port=5000&state=${appState()}&challenge=${challengeOf(verifierNew())}`, { redirect: 'manual' });
  const loc = new URL(st2.headers.get('location') ?? 'http://x/');
  check(KK, 'everyone: /auth/kakao/start → 302 가짜 카카오 (scope=openid, PKCE S256, nonce, 고정 콜백)', st2.status === 302 && loc.origin === kakao.url && loc.searchParams.get('scope') === 'openid' && loc.searchParams.get('code_challenge_method') === 'S256' && !!loc.searchParams.get('nonce') && loc.searchParams.get('redirect_uri') === `${apiUrl}/auth/kakao/callback`, loc.toString().slice(0, 200));
  check(KK, 'everyone: providers login = [google, kakao] (토큰 없이)', JSON.stringify((await api('GET', '/v1/auth/providers')).json.login) === '["google","kakao"]');
  // 다시 off 로 (앱 단계는 off 부터)
  await setFeature('kakao_login', 'off');
  await adminPost('/admin/features/allow', { key: 'kakao_login', account: ka.id, allowed: '0' });

  // ---- 코인 초기화 기능 키 ----
  const CR = 'API coin_reset';
  const day = new Date().toISOString().slice(0, 10);
  const entries = () => [
    { id: crypto.randomUUID(), reason: 'meet', amount: 10, day },
    { id: crypto.randomUUID(), reason: 'reset', amount: -10, day },
    { id: crypto.randomUUID(), reason: 'reset-items', amount: 0, day },
  ];
  const dv = await newDevice();
  const r0 = await api('POST', '/v1/sync', { token: dv.token, body: { entries: entries() } });
  check(CR, 'off(기본): 직접 보낸 reset, reset-items → rejected feature_off, 묶음은 200', r0.status === 200 && JSON.stringify(r0.json.results.map((x) => [x.status, x.error ?? null])) === '[["ok",null],["rejected","feature_off"],["rejected","feature_off"]]' && r0.json.balance === 10, JSON.stringify(r0.json?.results));
  await setFeature('coin_reset', 'allowlist');
  await allowFeature('coin_reset', String(dv.account.id));
  const dv2 = await newDevice();
  const r1 = await api('POST', '/v1/sync', { token: dv.token, body: { entries: entries() } });
  const r2 = await api('POST', '/v1/sync', { token: dv2.token, body: { entries: entries() } });
  check(CR, 'allowlist: 허용 계정은 ok, 다른 계정은 feature_off', r1.json?.results?.[1]?.status === 'ok' && r2.json?.results?.[1]?.error === 'feature_off');
  await setFeature('coin_reset', 'off');
  sql(`DELETE FROM feature_flag WHERE key IN ('coin_reset', 'kakao_login')`);
  await adminPage();
}

// ================= 2. 외장 디스크 복사 서비스 (시험용 compose) =================
async function copyService() {
  const F = '외장 복사';
  const u = await newUser();
  const b1 = (await put(u.session, zipBytes(7000))).json.backup;
  const b2 = (await put(u.session, zipBytes(7001))).json.backup;
  const part = join(backupDir, `${randomBytes(16).toString('hex')}.part`);
  writeFileSync(part, 'writing');
  const dst = join(scratchAll, 'external');
  mkdirSync(dst, { recursive: true });
  const name = `jj-qa112-bf-${tag}`;
  const soon = (Math.floor(Date.now() / 1000) + 40) % 86400;
  const compose = join(scratchAll, 'compose.backup-files.yml');
  writeFileSync(compose, `services:
  backup-files:
    build:
      context: ${JSON.stringify(join(root, 'server', 'ops', 'backup-files'))}
    image: ${name}
    container_name: ${name}
    environment:
      SYNC_ON_START: "1"
      SYNC_AT_UTC_SEC: "${soon}"
    volumes:
      - ${JSON.stringify(`${backupDir}:/src:ro`)}
      - ${JSON.stringify(`${dst}:/dst`)}
`);
  const dc = (...a) => execFileSync('docker', ['compose', '-p', name, '-f', compose, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const same = () => {
    const src = fbk().sort();
    const out = existsSync(join(dst, 'files')) ? readdirSync(join(dst, 'files')).sort() : [];
    const bytes = out.every((f) => existsSync(join(backupDir, f)) && readFileSync(join(backupDir, f)).equals(readFileSync(join(dst, 'files', f))));
    return { src, out, ok: JSON.stringify(src) === JSON.stringify(out) && bytes };
  };
  try {
    dc('up', '-d', '--build');
    await until('첫 맞춤', async () => same().ok, 60_000).catch(() => {});
    const a = same();
    check(F, '시작 맞춤: 암호문 파일이 바이트 그대로 files/ 로, .part 는 안 옮김', a.ok && !a.out.some((f) => f.endsWith('.part')) && a.out.includes(`${fileOf(b1.id)}.fbk`), `src ${a.src.length} dst ${a.out.length}`);
    // 서버에서 지운 것, 새로 올린 것
    const gone = `${fileOf(b1.id)}.fbk`;
    await api('DELETE', `/v1/backup/${b1.id}`, { token: u.session });
    const b3 = (await put(u.session, zipBytes(7002))).json.backup;
    const wait = ((soon - (Math.floor(Date.now() / 1000) % 86400) + 86400) % 86400) * 1000 + 8000;
    await until('정한 시각 맞춤', async () => {
      const s = same();
      return s.ok && !s.out.includes(gone);
    }, Math.min(wait + 20_000, 90_000)).catch(() => {});
    const b = same();
    check(F, '정한 시각(SYNC_AT_UTC_SEC) 맞춤: 서버에서 지운 파일은 사본에서도 지움(--delete), 새 파일 들어옴, .part 계속 제외',
      b.ok && !b.out.includes(gone) && b.out.includes(`${fileOf(b3.id)}.fbk`) && !b.out.some((f) => f.endsWith('.part')), `dst ${b.out.length}`);
    const logs = execFileSync('docker', ['logs', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    check(F, '맞춤 기록 두 번, 실패 없음', (logs.match(/맞춤:/g) ?? []).length >= 2 && !logs.includes('실패'), logs.trim().split('\n').slice(-2).join(' | '));
    const key = readdirSync(join(dst, 'files')).map((f) => readFileSync(join(dst, 'files', f))).some((x) => x.subarray(0, 4).toString() !== 'FBK1');
    check(F, '사본은 모두 FBK1 암호문 (키는 사본에 없음)', !key);
    void b2;
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? (err.stderr?.toString() ?? err.message).slice(0, 300) : String(err));
  } finally {
    try {
      dc('down', '--rmi', 'local', '-v', '--remove-orphans');
    } catch {}
    try {
      execFileSync('docker', ['rmi', '-f', name], { stdio: 'ignore' });
    } catch {}
    rmSync(part, { force: true });
    const leftC = execFileSync('docker', ['ps', '-a', '--filter', `name=${name}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
    check(F, '시험 컨테이너, 이미지 정리', leftC === '', leftC);
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
const ELECTRON = "process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron')";
async function launch(name, { server = apiUrl } = {}) {
  const inspect = await freePort();
  const pageP = await freePort();
  const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), `.qa112-${name}-`));
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const env = { HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' };
  if (server) env.JJ_SERVER_URL_OVERRIDE = server;
  const child = spawn(electronPath, [`--inspect=${inspect}`, '.', `--remote-debugging-port=${pageP}`], { cwd: root, env, stdio: 'ignore' });
  const h = { name, child, scratch, data, exited: false, mainConn: undefined, pids: new Set([child.pid]) };
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
  h.target = async (match, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${pageP}/json`)).json();
        const p = list.find((x) => x.type === 'page' && match(x.url));
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
    throw new Error(`no page ${match}`);
  };
  h.page = (pname, tries) => h.target((u) => u.includes(`${pname}.html`), tries);
  h.quit = async () => {
    try {
      await h.main(`(() => { const e = ${ELECTRON}; setTimeout(() => e.app.quit(), 100); return 'quit'; })()`);
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
      for (const pid of new Set([...h.pids, ...left()])) {
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
  await swapBrowser(h);
  h.status = async () => JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
  h.balance = () => h.main('__jj.store.balance()');
  return h;
}
/** 브라우저 열기는 바꿔 끼운다 (진짜 브라우저를 열지 않는다. 열려던 주소를 이 스크립트가 따라간다) */
const swapBrowser = (h) => h.main(`(() => { const e = ${ELECTRON}; e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; }; return true; })()`);

/** 밝은, 어두운 모드로 찍고 넘침, 영어판 한글, 줄표, 빈 단추를 본다 */
async function shots(c, ev, file, sel) {
  const issues = [];
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
    const text = el.innerText;
    const emptyBtn = [...el.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length;
    return { over, hangul: (text.match(/[\\uAC00-\\uD7A3]+/g) ?? []).slice(0, 8), emdash: text.includes('\\u2014'), emptyBtn };
  })()`);
  if (a?.missing) issues.push('요소 없음');
  else {
    if (a.over.length) issues.push(`넘침 ${a.over.join(',')}`);
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
    under14: '만 14세 미만', adult: '만 18세 이상', start: '서버 계정 시작', syncNow: '코인 동기화', login: '구글로 로그인', kakaoLogin: '카카오로 로그인', link: '카카오도 연결', logout: '로그아웃',
    via2: '구글, 카카오로 로그인했어', via1: '구글로 로그인했어',
    upload: '서버에 백업 올리기', download: '받아서 되살리기', del: '지우기', consent: '서버 백업에 따로 동의', uploaded: '서버에 백업을 올렸어.', uploading: '올리는 중이야.', downloading: '받는 중이야.', deleted: '서버 백업을 지웠어.', downloaded: '받았어.',
    full: '저장 공간이 꽉 찼어', off: '서버가 아직 서버 백업을 열지 않았어.', soon: '에 지워져.', none: '서버에 올린 백업이 없어.',
    remove: '서버 계정 지우기', sure: '정말 지우기', resetStart: '코인 초기화하기', resetSure: '초기화할게', restoreServer: '코인과 산 물건은 서버 것을 따라',
  },
  en: {
    under14: 'Under 14', adult: '18 or older', start: 'Start server account', syncNow: 'Sync coins', login: 'Sign in with Google', kakaoLogin: 'Sign in with Kakao', link: 'Also link Kakao', logout: 'Sign out',
    via2: 'Signed in with Google and Kakao', via1: 'Signed in with Google',
    upload: 'Upload backup to server', download: 'Download and restore', del: 'Delete', consent: 'Separate consent for server backup', uploaded: 'Uploaded a backup to the server.', uploading: 'Uploading.', downloading: 'Downloading.', deleted: 'Deleted the server backup.', downloaded: 'Downloaded.',
    full: 'storage is full', off: "The server hasn't opened server backups yet.", soon: 'Will be deleted', none: 'No server backups yet.',
    remove: 'Delete server account', sure: 'Really delete', resetStart: 'Reset coins', resetSure: 'Reset now', restoreServer: 'Coins and items follow the server',
  },
}[LANG];

// ---- 화면 도우미 ----
const btnInfo = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)}); return b ? { disabled: b.disabled, checked: b.getAttribute('aria-checked') } : null; })()`);
const press1 = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
const press = async (p, scope, text, ms = 5000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await press1(p, scope, text)) return true;
    await sleep(250);
  }
  return false;
};
const pressSel = (p, sel) => p.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const typeInto = (p, sel, value) =>
  p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const boxText = (p) => p.ev(`document.querySelector('.server-box')?.innerText ?? ''`);
const watchFlash = (p) =>
  p.ev(`(() => { window.__qaFlash = []; const grab = () => { const t = document.querySelector('header .saved')?.textContent?.trim(); if (t && window.__qaFlash.at(-1) !== t) window.__qaFlash.push(t); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`);
const flashes = (p) => p.ev('JSON.stringify(window.__qaFlash ?? [])').then((x) => JSON.parse(x));
const clearFlash = (p) => p.ev('(window.__qaFlash = [], 1)');
async function waitFlash(p, needle, ms = 10_000) {
  let got = [];
  await soft(until(`결과 글 ${needle}`, async () => (got = await flashes(p)).some((x) => x.includes(needle)), ms));
  return got.find((x) => x.includes(needle)) ?? null;
}
const has = (p, sel) => p.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const listIds = async (h) => ((await h.status()).backup?.list ?? []).map((x) => x.id);
/**
 * 올리기, 받기가 끝난 뒤 칸이 다시 켜졌는가 (메인 busy 와 화면 둘 다). 화면이 "올리는 중이야."에 멈춰 있으면 FAIL 로 적고
 * 설정 창을 다시 그려(창을 다시 연 것과 같다) 다음 단계를 이어 간다
 */
async function settled(h, p, area, label) {
  await sleep(2500);
  const main = (await h.status()).backup?.busy ?? null;
  const dom = await p.ev(`(() => { const box = document.querySelector('.server-backup'); if (!box) return null; const t = box.innerText; return { busyText: t.includes(${JSON.stringify(T.uploading)}) || t.includes(${JSON.stringify(T.downloading)}), disabled: [...box.querySelectorAll('button')].filter((b) => b.disabled).length }; })()`);
  const ok = main === null && dom && !dom.busyText && dom.disabled === 0;
  check(area, `${label} 끝난 뒤 칸이 다시 켜짐 (화면에 "${T.uploading}" 없음, 단추 켜짐)`, ok, `메인 busy ${main}, 화면 ${JSON.stringify(dom)}`);
  if (!ok) {
    // 메인이 상태를 한 번 더 보내면(목록 다시 받기) 풀리는지
    await h.main('__jj.server.core.backupList()');
    await sleep(800);
    const again = await p.ev(`[...document.querySelectorAll('.server-backup button')].filter((b) => b.disabled).length`);
    note(area, `${label}: 다음 상태 알림(목록 다시 받기) 뒤 꺼진 단추 ${again}개`);
  }
  return ok;
}

async function openSettings(h) {
  await h.main("__jj.settingsWindow.open('restore')");
  const p = await h.page('settings');
  await until('설정', () => p.ev(`!!document.querySelector('.settings')`));
  await watchFlash(p);
  return p;
}
/** 처음 켜기: 나이 → 닉네임 → 기기 계정 (화면 단추) */
async function firstRun(h, p, F, nick) {
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  await sleep(300);
  check(F, `"${T.adult}" 누르기`, await press(p, '.server-box', T.adult));
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`), 10_000);
  await typeInto(p, '.server-nickname-step input', nick);
  check(F, `닉네임 넣고 "${T.start}" 누르기`, await press(p, '.server-box', T.start));
  await until('기기 계정', async () => {
    const s = await h.status();
    return s.device && s.code && !s.syncing && s.providers !== null;
  }, 30_000);
  return sql(`SELECT id FROM account WHERE code = '${(await h.status()).code}'`);
}
/** 구글 로그인 단추를 눌러 sub 로 들어간다 (브라우저 일은 이 스크립트가 fetch 로) */
async function clickGoogle(h, p, sub) {
  await h.main('globalThis.__qaOpened = null');
  if (!(await press(p, '.server-box', T.login))) return false;
  let u;
  await until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000);
  const f = await googleBrowser(u, sub);
  const r = await fetch(f.done).catch((e) => ({ status: String(e) }));
  return r.status === 200;
}
/** 카카오 단추(로그인 또는 연결)를 눌러 sub 로 */
async function clickKakao(h, p, text, sub) {
  await h.main('globalThis.__qaOpened = null');
  if (!(await press(p, '.server-box', text))) return 'no button';
  let u;
  await soft(until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000));
  if (!u) return 'not opened';
  const f = await kakaoBrowser(u, sub);
  if (!f.done) return `flow ${f.error ?? f.status}`;
  const r = await fetch(f.done).catch((e) => ({ status: String(e) }));
  return r.status === 200 ? 'ok' : `done ${r.status}`;
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
/** 할 일을 넣고 끝내 코인을 번다 (15개씩, 상태 준비) */
const earnTodos = (h, n) => h.main(`(() => { for (let i = 0; i < ${n}; i++) { const t = __jj.store.add({ title: 'qa112 ' + i + ' ' + Math.random() }, Date.now()); __jj.store.complete(t.id, Date.now()); } return 1; })()`);
const srvBalance = (id) => Number(sql(`SELECT balance FROM account WHERE id = ${id}`));

// ---- 웹 /admin 을 시험 앱 안 숨은 창에서 눌러 바꾼다 ----
async function openAdminWindow(h) {
  // 앱은 모든 창의 이동(will-navigate)을 막는다(index.ts): 이 시험 창만 풀어 폼 제출이 되게 한다
  await h.main(`(() => { const e = ${ELECTRON}; const w = new e.BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { partition: 'qa-admin-${tag}' } }); globalThis.__qaAdmin = w; w.webContents.removeAllListeners('will-navigate'); w.loadURL(${JSON.stringify(`${apiUrl}/admin`)}); return true; })()`);
  const w = await h.target((u) => u.startsWith(`${apiUrl}/admin`));
  await until('운영자 로그인 폼', () => w.ev(`!!document.querySelector('input[name=token]')`), 15_000);
  await typeInto(w, 'input[name=token]', ADMIN_TOKEN);
  const n0 = adminPosts.length;
  await w.ev(`(window.__qaNav = 1, document.querySelector('form[action="/admin/login"] button[type=submit]').click(), 1)`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  const viaForm = await w.ev(`!!document.querySelector('form[action="/admin/features/mode"]')`);
  const sent = adminPosts.slice(n0);
  const page = await w.ev('document.body.innerText.slice(0, 120)');
  check('웹 /admin', '진짜 브라우저 창에서 토큰 넣고 "로그인" 누르면 운영자 화면이 열림', viaForm, `브라우저가 보낸 머리 ${JSON.stringify(sent)}, 화면 "${page.replace(/\s+/g, ' ')}"`);
  if (!viaForm) {
    // 이후 기능 스위치 클릭을 이어 보려고: 브라우저가 Origin: null 을 보내면 시험 서버 주소로, 쿠키가 없으면 fetch 로 받은 쿠키를 붙인다
    if (!web.cookie) await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
    note('웹 /admin', '이후 /admin 클릭은 시험 창 요청에 Origin(null 이면 서버 주소)과 쿠키를 고쳐 넣고 이어 간다');
    await h.main(`(() => { const e = ${ELECTRON}; e.session.fromPartition('qa-admin-${tag}').webRequest.onBeforeSendHeaders({ urls: [${JSON.stringify(`${apiUrl}/*`)}] }, (d, cb) => { const hd = d.requestHeaders; if (!hd.Cookie) hd.Cookie = ${JSON.stringify(web.cookie)}; if (hd.Origin === 'null') hd.Origin = ${JSON.stringify(apiUrl)}; cb({ requestHeaders: hd }); }); globalThis.__qaAdmin.loadURL(${JSON.stringify(`${apiUrl}/admin`)}); return true; })()`);
  }
  const ok = await soft(until('운영자 화면', () => w.ev(`!!document.querySelector('form[action="/admin/features/mode"]')`), 15_000));
  if (!ok) throw new Error(`운영자 화면 안 열림: ${await w.ev('location.href + " " + document.body.innerText.slice(0, 200)')}`);
  return w;
}
const featForm = (key, action, extra = '') => `[...document.querySelectorAll('form[action="${action}"]')].find((f) => f.querySelector('input[name=key]')?.value === '${key}'${extra})`;
/** 기능 칸에서 모드 고르기 → 확인 칸 누르기 → "모드 바꾸기" 누르기 → 다시 그려진 화면의 결과 글 */
async function adminClickMode(w, key, mode) {
  const ok = await w.ev(`(() => { const f = ${featForm(key, '/admin/features/mode')}; if (!f) return false; const s = f.querySelector('select[name=mode]'); s.value = '${mode}'; s.dispatchEvent(new Event('change', { bubbles: true })); f.querySelector('input[name=confirm]').click(); window.__qaNav = 1; f.querySelector('button[type=submit]').click(); return true; })()`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  const flash = await w.ev(`document.querySelector('.flash')?.textContent ?? ''`);
  if (!flash) note('웹 /admin', `모드 누른 뒤 결과 글 없음: ${ok} ${await w.ev('location.href + " | " + document.documentElement.outerHTML.length + " | " + document.documentElement.outerHTML.slice(0, 900)')} | 기록 ${sql("SELECT string_agg(action, ',') FROM admin_log")}`);
  return { ok, flash };
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

// ================= 3. 앱 N: 서버 주소 없음, 앱 U: 만 14세 미만 =================
async function appNoUrl() {
  const F = '주소 없음';
  const h = await launch('nourl', { server: '' });
  try {
    const p = await openSettings(h);
    await until('데이터 칸', () => has(p, 'section .card'), 15_000);
    await sleep(800);
    check(F, '코인 초기화 칸 DOM 없음, 서버 칸 없음', !(await has(p, '.coin-reset')) && !(await has(p, '.server-box')) && !(await has(p, '.server-backup')));
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
    await until('서버 칸', () => has(p, '.server-box'), 15_000);
    await sleep(500);
    const n0 = seen.length;
    check(F, `"${T.under14}" 누르기`, await press(p, '.server-box', T.under14));
    await sleep(4000);
    check(F, '요청 0건, 코인 초기화 칸 DOM 없음, 서버 백업 칸 없음, 카카오 단추 없음', seen.length === n0 && !(await has(p, '.coin-reset')) && !(await has(p, '.server-backup')) && !(await boxText(p)).includes(T.kakaoLogin), seen.slice(n0).join(','));
    p.close();
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    await h.quit();
  }
}

// ================= 4. 앱 A: 사용자 (백업, 카카오, 코인 초기화, 되살리기) =================
const SUB_A = `qa-a-${tag}`;
const KSUB_A = `8${Date.now()}`;
async function appA() {
  const h = await launch('a');
  let p;
  let w;
  try {
    p = await openSettings(h);
    let F = 'A 처음';
    const id = await firstRun(h, p, F, 'qaA');
    check(F, '로그인 전: 서버 백업 칸 없음, 카카오 단추 없음(off), 코인 초기화 칸 없음(off)', !(await has(p, '.server-backup')) && !(await boxText(p)).includes(T.kakaoLogin) && !(await has(p, '.coin-reset')));
    await p.shots('a-01-before-login', '.server-box');

    // ---- 로그인 → 맞추기 바로 (runAgain) ----
    F = 'A 로그인 직후 맞추기';
    await h.main(`(__jj.store.reward(10, 'meet', Date.now()), __jj.store.reward(50, 'weekly', Date.now()), 1)`);
    await clickSync(h, p);
    // 같은 sub 로 서버에 이미 코인이 있는 계정을 만들어 두면, 로그인 때 기기 계정이 그쪽으로 합쳐진다 (서버 잔액이 바뀐다)
    const pre = await newDevice();
    await apiLogin(pre.token, SUB_A);
    await api('POST', '/v1/sync', { token: pre.token, body: { entries: [{ id: crypto.randomUUID(), reason: 'meet', amount: 10, day: new Date().toISOString().slice(0, 10) }] } });
    const preId = String(pre.account.id);
    const t0 = Date.now();
    check(F, `"${T.login}" 누르기 → 로그인`, await clickGoogle(h, p, SUB_A));
    let st;
    await soft(until('로그인 + 합친 잔액', async () => {
      st = await h.status();
      return st.signedIn && !st.syncing && st.balance === srvBalance(preId) && (await h.balance()) === srvBalance(preId);
    }, 15_000));
    const dt = Date.now() - t0;
    check(F, '로그인(합치기) 직후 앱 잔액 = 서버 합친 잔액 (3분 주기 기다리지 않음)', st?.signedIn && st.balance === srvBalance(preId) && (await h.balance()) === srvBalance(preId) && dt < 15_000, `${dt}ms 앱 ${await h.balance()} 서버 ${srvBalance(preId)} 이전 계정 ${id}`);
    const acct = preId;
    await until('백업 칸', () => has(p, '.server-backup'), 10_000);

    // ---- 서버 백업 ----
    F = 'A 서버 백업';
    check(F, '로그인하면 서버 백업 칸이 보임', true);
    const up0 = await btnInfo(p, '.server-backup', T.upload);
    const cs0 = await btnInfo(p, '.server-backup', T.consent);
    check(F, '따로 동의 전: 올리기 단추 꺼짐, 동의 스위치 꺼짐', up0?.disabled === true && cs0?.checked === 'false', JSON.stringify({ up0, cs0 }));
    await soft(until('목록', async () => (await boxText(p)).includes(T.none), 5_000));
    await p.shots('a-02-backup-before-consent', '.server-backup');
    check(F, '동의 스위치 누르기', await press(p, '.server-backup', T.consent));
    await until('켜짐', async () => (await btnInfo(p, '.server-backup', T.upload))?.disabled === false, 5_000);
    check(F, '동의하면 올리기 단추 켜짐', true);
    const coins0 = await h.balance();
    await clearFlash(p);
    check(F, `"${T.upload}" 누르기`, await press(p, '.server-backup', T.upload));
    await soft(until('올림', async () => (await listIds(h)).length === 1, 30_000));
    check(F, '올린 뒤 목록 1개, 결과 글, DB 줄 1, 디스크 FBK1', (await listIds(h)).length === 1 && !!(await waitFlash(p, T.uploaded)) && sql(`SELECT count(*) FROM backup WHERE account_id = ${acct}`) === '1' && readFileSync(join(backupDir, `${sql(`SELECT file FROM backup WHERE account_id = ${acct}`)}.fbk`)).subarray(0, 4).toString() === 'FBK1');
    await sleep(300);
    await p.shots('a-03-backup-one', '.server-backup');
    await settled(h, p, F, '올리기 성공');
    const firstId = (await listIds(h))[0];
    for (let i = 0; i < 2; i++) {
      await sleep(300);
      if (!(await press(p, '.server-backup', T.upload))) note(F, `올리기 ${i + 2} 단추를 못 누름 (꺼져 있음)`);
      const n = i + 2;
      await soft(until('올림', async () => (await h.status()).backup?.busy === null && sql(`SELECT count(*) FROM backup WHERE account_id = ${acct}`) === String(Math.min(n, 2)) && (await listIds(h)).length === Math.min(n, 2) && (n < 3 || !(await listIds(h)).includes(firstId)), 30_000));
    }
    const ids = await listIds(h);
    const domItems = await p.ev(`document.querySelectorAll('.server-backup-list li').length`);
    check(F, '세 번 올리면 목록 2개, 가장 오래된 것 사라짐 (화면, DB, 디스크)', ids.length === 2 && !ids.includes(firstId) && domItems === 2 && sql(`SELECT count(*) FROM backup WHERE account_id = ${acct}`) === '2' && fbk().filter((f) => sql(`SELECT count(*) FROM backup WHERE file = '${f.slice(0, 32)}'`) === '1').length >= 2, `${ids} / 첫 ${firstId} / 화면 ${domItems}`);
    await p.shots('a-04-backup-two', '.server-backup');

    // ---- 곧 지워짐 (시계 주입) ----
    F = 'A 곧 지워짐';
    sql(`UPDATE account SET last_active_at = now() - interval '1 hour' WHERE id = ${acct}`);
    const active = new Date(sql(`SELECT to_char(last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM account WHERE id = ${acct}`)).getTime();
    clockShift = active + 340 * DAY - Date.now();
    await h.main('__jj.server.core.backupList()');
    clockShift = 0;
    await soft(until('곧 지워짐 글', async () => (await p.ev(`document.querySelectorAll('.server-backup-list .warn').length`)) === 2, 5_000));
    const warn = await p.ev(`document.querySelector('.server-backup-list .warn')?.textContent ?? ''`);
    check(F, '활동 + 340일: 목록마다 "곧 지워짐" 글 (지울 날짜 포함)', warn.includes(T.soon) && /\d/.test(warn), warn);
    await p.shots('a-05-backup-soon', '.server-backup');
    await h.main('__jj.server.core.backupList()');
    await soft(until('곧 지워짐 풀림', async () => (await p.ev(`document.querySelectorAll('.server-backup-list .warn').length`)) === 0, 5_000));
    check(F, '지금 시계로 다시 받으면 글이 사라짐', (await p.ev(`document.querySelectorAll('.server-backup-list .warn').length`)) === 0);

    // ---- 전체 상한 507 → 앱 안내 ----
    F = 'A 저장 공간 꽉 참';
    const fillers = [];
    for (let n = 0; n < 6 && totalDb() < CAP; n++) {
      const f = await newUser();
      await put(f.session, zipBytes(Math.min(CAP - totalDb(), MB20)));
      fillers.push(f);
    }
    check(F, '서버 합계 = 상한', totalDb() === CAP, `${totalDb()} / ${CAP}`);
    await clearFlash(p);
    await press(p, '.server-backup', T.upload);
    const fullMsg = await waitFlash(p, T.full);
    check(F, '올리기 누르면 507 → "저장 공간이 꽉 찼어" (빨간 글), 목록 그대로', !!fullMsg && (await p.ev(`!!document.querySelector('header .saved.error')`)) === true && JSON.stringify(await listIds(h)) === JSON.stringify(ids), fullMsg ?? (await flashes(p)).join('/'));
    await p.shots('a-06-backup-full', '.server-backup');
    await settled(h, p, F, '올리기 실패(507)');
    for (const f of fillers) for (const b of (await api('GET', '/v1/backup', { token: f.session })).json.backups) await api('DELETE', `/v1/backup/${b.id}`, { token: f.session });

    // ---- 받기 → 되살리기 확인 칸 (그만두기) ----
    F = 'A 받기';
    await clearFlash(p);
    check(F, `"${T.download}" 누르기`, await press(p, '.server-backup-list li', T.download));
    await until('되살리기 확인 칸', () => has(p, '.restore-ask'), 30_000);
    const ask = await p.ev(`document.querySelector('.restore-ask').innerText`);
    check(F, '되살리기 확인 칸이 열림, "코인과 산 물건은 서버 것을 따라" 안내, 받았어 글', ask.includes(T.restoreServer) && !!(await waitFlash(p, T.downloaded)), ask.slice(0, 120));
    check(F, '받은 임시 파일이 데이터 폴더에 남지 않음', readdirSync(h.data).filter((f) => f.startsWith('server-backup-')).length === 0);
    await p.shots('a-07-restore-ask', '.restore-ask');
    await settled(h, p, F, '받기');
    await until('되살리기 확인 칸', () => has(p, '.restore-ask'), 10_000);
    await p.ev(`[...document.querySelectorAll('.restore-ask button')].find((b) => !b.classList.contains('danger'))?.click()`);
    await soft(until('확인 칸 닫힘', async () => !(await has(p, '.restore-ask')), 10_000));

    // ---- 지우기 (화면) ----
    F = 'A 지우기';
    const delId = (await listIds(h)).at(-1);
    const delFile = fileOf(delId);
    await clearFlash(p);
    await p.ev(`(() => { const li = [...document.querySelectorAll('.server-backup-list li')].at(-1); [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(T.del)}).click(); return 1; })()`);
    await soft(until('지움', async () => !(await listIds(h)).includes(delId), 10_000));
    check(F, '"지우기" 누르면 목록, DB, 디스크에서 사라짐, 결과 글', !(await listIds(h)).includes(delId) && sql(`SELECT count(*) FROM backup WHERE id = ${delId}`) === '0' && !existsSync(join(backupDir, `${delFile}.fbk`)) && !!(await waitFlash(p, T.deleted)), `${delId} 목록 ${await listIds(h)} 글 ${(await flashes(p)).join('/')} 단추 ${await p.ev(`JSON.stringify([...document.querySelectorAll('.server-backup-list li button')].map((b) => b.textContent + (b.disabled ? '(꺼짐)' : '')))`)}`);

    // ---- 웹 /admin 클릭: kakao_login allowlist, 허용 넣기 ----
    F = 'A 카카오 allowlist';
    w = await openAdminWindow(h);
    const m1 = await adminClickMode(w, 'kakao_login', 'allowlist');
    check(F, '/admin: kakao_login 모드를 "허용 목록만"으로 누름 → 결과 글, 표, DB', m1.ok && m1.flash.includes('off → allowlist') && (await tableMode(w, 'kakao_login')) === '허용 목록만' && sql(`SELECT mode FROM feature_flag WHERE key = 'kakao_login'`) === 'allowlist', `${m1.flash} | ${await tableMode(w, 'kakao_login')}`);
    await w.shots('a-08-admin-kakao-allowlist', 'form[action="/admin/features/mode"]');
    await sleep(CACHE);
    await clickSync(h, p);
    check(F, '허용 목록에 없는 로그인 계정: "카카오도 연결" DOM 없음', (await btnInfo(p, '.server-box', T.link)) === null);
    const a1 = await adminClickAllow(w, 'kakao_login', acct);
    check(F, '/admin: 계정 번호 넣고 "허용 목록에 넣기" 누름 → DB feature_allow', a1.ok && a1.flash.includes(`#${acct}`) && sql(`SELECT account_id FROM feature_allow WHERE key = 'kakao_login'`) === acct, a1.flash);
    await sleep(CACHE);
    await clickSync(h, p);
    const shownBySync = (await btnInfo(p, '.server-box', T.link)) !== null;
    // 앱은 로그인 서비스와 기능 키를 30분에 한 번만 다시 묻는다 (PROVIDERS_EVERY_MS). 코인 동기화로는 안 바뀐다
    check(F, '참고: 운영자가 바꾼 뒤 5초 + "코인 동기화"로 앱 단추가 바뀌는가', true, shownBySync ? '바로 바뀜' : '안 바뀜: 앱은 30분 주기(PROVIDERS_EVERY_MS) 또는 로그인/로그아웃 때만 다시 묻는다');
    // 상태 준비: 30분 주기를 당겨 다시 묻게 하고(메인), 화면은 "코인 동기화"를 눌러 새 상태를 받는다
    await h.main('__jj.server.core.refreshProviders(true)');
    await clickSync(h, p);
    await soft(until('카카오 단추', async () => (await btnInfo(p, '.server-box', T.link)) !== null, 5_000));
    check(F, '앱이 다시 물으면 허용 계정에 "카카오도 연결" 단추가 생김', (await btnInfo(p, '.server-box', T.link)) !== null);
    await p.shots('a-09-link-kakao', '.server-box');
    const lk = await clickKakao(h, p, T.link, KSUB_A);
    await soft(until('연결', async () => (await h.status()).logins.includes('kakao'), 15_000));
    check(F, '"카카오도 연결" 누름 → 한 계정에 구글+카카오 (DB), 단추 사라짐, "구글, 카카오로 로그인했어"', lk === 'ok' && sql(`SELECT string_agg(service, ',' ORDER BY service) FROM login WHERE account_id = ${acct}`) === 'google,kakao' && (await btnInfo(p, '.server-box', T.link)) === null && (await soft(until('글', async () => (await boxText(p)).includes(T.via2), 5_000))) === true, `${lk} ${sql(`SELECT string_agg(service, ',') FROM login WHERE account_id = ${acct}`)}`);
    await p.shots('a-10-linked', '.server-box');
    const r1 = await adminClickRemove(w, 'kakao_login', acct);
    check(F, '/admin: 허용 계정 "빼기" 누름 → DB 에서 빠짐', r1.ok && sql(`SELECT count(*) FROM feature_allow WHERE key = 'kakao_login'`) === '0', r1.flash);

    // ---- everyone: 로그아웃 → 로그인 화면에 카카오, 동의 다시 묻기 ----
    F = 'A 카카오 everyone';
    const m2 = await adminClickMode(w, 'kakao_login', 'everyone');
    check(F, '/admin: 모드를 "모두"로 누름', m2.ok && sql(`SELECT mode FROM feature_flag WHERE key = 'kakao_login'`) === 'everyone', m2.flash);
    await sleep(CACHE);
    check(F, `"${T.logout}" 누르기`, await press(p, '.server-box', T.logout));
    await soft(until('로그아웃', async () => !(await h.status()).signedIn, 10_000));
    await soft(until('카카오 로그인 단추', async () => (await btnInfo(p, '.server-box', T.kakaoLogin)) !== null, 10_000));
    check(F, '로그아웃 뒤 로그인 화면: 구글, 카카오 로그인 단추 둘 다, 서버 백업 칸 없음', (await btnInfo(p, '.server-box', T.login)) !== null && (await btnInfo(p, '.server-box', T.kakaoLogin)) !== null && !(await has(p, '.server-backup')));
    await p.shots('a-11-login-everyone', '.server-box');
    const kl = await clickKakao(h, p, T.kakaoLogin, KSUB_A);
    await soft(until('카카오 로그인', async () => (await h.status()).signedIn && !(await h.status()).syncing, 15_000));
    const s2 = await h.status();
    check(F, '"카카오로 로그인" 누름 → 같은 계정으로 로그인 (logins google,kakao)', kl === 'ok' && s2.signedIn && JSON.stringify([...s2.logins].sort()) === '["google","kakao"]' && sql(`SELECT count(*) FROM session WHERE account_id = ${acct}`) !== '0', `${kl} ${JSON.stringify(s2.logins)}`);
    await until('백업 칸', () => has(p, '.server-backup'), 10_000);
    const cs1 = await btnInfo(p, '.server-backup', T.consent);
    check(F, '로그아웃 뒤 다시 로그인하면 서버 백업 동의를 다시 물음 (스위치 꺼짐, 올리기 꺼짐)', cs1?.checked === 'false' && (await btnInfo(p, '.server-backup', T.upload))?.disabled === true, JSON.stringify(cs1));

    // ---- coin_reset: /admin 에서 켜면 앱에 나타나고 동작 ----
    F = 'A coin_reset';
    check(F, 'off(기본): 서버 붙은 로그인 앱에도 코인 초기화 칸 DOM 없음', !(await has(p, '.coin-reset')));
    const m3 = await adminClickMode(w, 'coin_reset', 'everyone');
    check(F, '/admin: coin_reset 모드를 "모두"로 누름', m3.ok && sql(`SELECT mode FROM feature_flag WHERE key = 'coin_reset'`) === 'everyone', m3.flash);
    await sleep(CACHE);
    // 상태 준비: 30분 주기를 당겨 다시 묻게 하고(메인), 화면은 "코인 동기화"를 눌러 새 상태를 받는다
    await h.main('__jj.server.core.refreshProviders(true)');
    await clickSync(h, p);
    await soft(until('초기화 칸', () => has(p, '.coin-reset'), 8_000));
    check(F, '앱이 다시 물으면 코인 초기화 칸이 나타남', await has(p, '.coin-reset'));
    await p.shots('a-12-coin-reset', '.coin-reset');
    await h.main(`(__jj.store.reward(3, 'rest', Date.now()), 1)`);
    await clickSync(h, p);
    const before = srvBalance(acct);
    await press(p, '.coin-reset .action-row', T.resetStart);
    await sleep(300);
    const okR = await press(p, '.coin-ask', T.resetSure);
    await sleep(500);
    await clickSync(h, p);
    check(F, '"코인 초기화하기" → 확인: 앱 0, 서버 0 (서버가 받아들임)', okR && before > 0 && (await h.balance()) === 0 && srvBalance(acct) === 0, `전 ${before} 앱 ${await h.balance()} 서버 ${srvBalance(acct)}`);
    // 운영자가 끈 뒤 앱이 아직 모를 때 누르면?
    await h.main(`(__jj.store.reward(3, 'rest', Date.now()), __jj.store.reward(3, 'rest', Date.now()), 1)`);
    await clickSync(h, p);
    const mid = srvBalance(acct);
    const m4 = await adminClickMode(w, 'coin_reset', 'off');
    await sleep(CACHE);
    const stillShown = await has(p, '.coin-reset');
    await press(p, '.coin-reset .action-row', T.resetStart);
    await sleep(300);
    await press(p, '.coin-ask', T.resetSure);
    await sleep(500);
    await clickSync(h, p);
    await clickSync(h, p);
    check(F, '운영자가 off 로 바꾼 뒤(앱은 아직 모름) 초기화를 누르면 서버가 거절, 앱 잔액은 서버 것으로 돌아옴', m4.ok && srvBalance(acct) === mid && (await h.balance()) === mid, `칸 남음 ${stillShown}, 서버 ${srvBalance(acct)} 앱 ${await h.balance()} (전 ${mid})`);
    // 상태 준비: 30분 주기를 당겨 다시 묻게 하고(메인), 화면은 "코인 동기화"를 눌러 새 상태를 받는다
    await h.main('__jj.server.core.refreshProviders(true)');
    await clickSync(h, p);
    await soft(until('칸 숨음', async () => !(await has(p, '.coin-reset')), 8_000));
    check(F, '앱이 다시 물으면 코인 초기화 칸이 사라짐', !(await has(p, '.coin-reset')));
    w.close();
    await h.main('(globalThis.__qaAdmin?.destroy(), 1)');

    // ---- 되살리기: 코인과 산 물건은 서버 값 ----
    F = 'A 되살리기';
    await press(p, '.server-backup', T.consent);
    await until('켜짐', async () => (await btnInfo(p, '.server-backup', T.upload))?.disabled === false, 5_000);
    await earnTodos(h, 2);
    await clickSync(h, p);
    const nBefore = (await listIds(h)).length;
    await press(p, '.server-backup', T.upload);
    await soft(until('올림', async () => (await h.status()).backup?.busy === null && (await listIds(h)).length >= Math.min(nBefore + 1, 2) && (await listIds(h))[0] !== ids[0], 30_000));
    const backupCoins = await h.balance();
    const backupItems = await h.main('JSON.stringify(__jj.shop.ownedItems())');
    // 올린 뒤 서버 쪽이 바뀐다: 더 벌고 물건을 산다
    await earnTodos(h, 3);
    const bought = await h.main(`__jj.shop.buyToy('ball', Date.now()).ok`);
    await clickSync(h, p);
    const serverNow = srvBalance(acct);
    const serverItems = sql(`SELECT count(*) FROM owned_item WHERE account_id = ${acct}`);
    check(F, '올린 뒤 번 코인과 산 물건이 서버에', serverNow !== backupCoins && bought, `백업 ${backupCoins} 서버 ${serverNow} 물건 ${serverItems}`);
    await press(p, '.server-backup-list li', T.download);
    await until('되살리기 확인 칸', () => has(p, '.restore-ask'), 30_000);
    const oldPid = await h.main('process.pid');
    h.mainConn?.ws.close();
    h.mainConn = undefined;
    await sleep(300);
    check(F, '확인 칸의 "바꾸기" 누르기', await pressSel(p, '.restore-ask button.danger'));
    p.close();
    p = undefined;
    const gone = await soft(until('앱 다시 켜짐', () => { try { process.kill(oldPid, 0); return false; } catch { return true; } }, 60_000));
    if (!gone) throw new Error('바꾸기 뒤 앱이 꺼지지 않음');
    await until('새 __jj', async () => (await h.main('typeof __jj === "object"')) && (await h.main('process.pid')) !== oldPid, 60_000);
    h.pids.add(await h.main('process.pid'));
    await swapBrowser(h);
    const after = await h.balance();
    const itemsAfter = await h.main('JSON.stringify(__jj.shop.ownedItems())');
    check(F, '다시 켠 뒤 앱 코인 = 서버 값 (백업의 옛 코인 아님), 산 물건도 서버 것', after === serverNow && after !== backupCoins && itemsAfter !== backupItems && itemsAfter.includes('ball'), `앱 ${after} 서버 ${serverNow} 백업 ${backupCoins} 물건 ${itemsAfter}`);
  } catch (err) {
    check('앱 A', '중단', false, err instanceof Error ? err.message : String(err));
    try {
      const lines = readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
      console.log(`---- 앱 A 기록 끝 ----\n${lines.slice(-30).join('\n')}`);
    } catch {}
  } finally {
    try {
      const lines = readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').filter((l) => l.includes('못') || l.includes('실패'));
      if (lines.length) console.log(`---- 앱 A 기록 (못, 실패) ----\n${lines.slice(-15).join('\n')}`);
    } catch {}
    p?.close();
    await h.quit();
  }
}

// ================= 5. 앱 B: 둘째 사용자 (합치기 직후 맞추기, 탈퇴 때 파일 삭제, 동의 거둠) =================
async function appB() {
  const h = await launch('b');
  let p;
  try {
    p = await openSettings(h);
    let F = 'B 합치기 직후 맞추기';
    await firstRun(h, p, F, 'qaB');
    await h.main(`(__jj.store.reward(10, 'meet', Date.now()), 1)`);
    await clickSync(h, p);
    // 이미 로그인한 다른 계정(코인 있음)으로 로그인 → 기기 계정이 그쪽으로 합쳐짐
    const sub = `qa-b-${tag}`;
    const other = await newDevice();
    await apiLogin(other.token, sub);
    await api('POST', '/v1/sync', { token: other.token, body: { entries: [{ id: crypto.randomUUID(), reason: 'meet', amount: 10, day: new Date().toISOString().slice(0, 10) }, { id: crypto.randomUUID(), reason: 'weekly', amount: 50, day: new Date().toISOString().slice(0, 10) }] } });
    const into = String(other.account.id);
    const t0 = Date.now();
    check(F, `"${T.login}" 누르기`, await clickGoogle(h, p, sub));
    await soft(until('합친 잔액', async () => {
      const s = await h.status();
      return s.signedIn && !s.syncing && (await h.balance()) === srvBalance(into) && s.balance === srvBalance(into);
    }, 15_000));
    const dt = Date.now() - t0;
    check(F, '합친 직후 앱 잔액 = 서버 합친 잔액', (await h.balance()) === srvBalance(into) && dt < 15_000, `${dt}ms 앱 ${await h.balance()} 서버 ${srvBalance(into)}`);

    F = 'B 탈퇴';
    await until('백업 칸', () => has(p, '.server-backup'), 10_000);
    await press(p, '.server-backup', T.consent);
    await until('켜짐', async () => (await btnInfo(p, '.server-backup', T.upload))?.disabled === false, 5_000);
    await press(p, '.server-backup', T.upload);
    await soft(until('올림', async () => (await listIds(h)).length === 1, 30_000));
    await sleep(300);
    await press(p, '.server-backup', T.upload);
    await soft(until('올림 2', async () => (await listIds(h)).length === 2, 30_000));
    const files = sql(`SELECT string_agg(file, ',') FROM backup WHERE account_id = ${into}`).split(',').filter(Boolean);
    check(F, '올린 백업 2개 (DB, 디스크)', files.length === 2 && files.every((f) => existsSync(join(backupDir, `${f}.fbk`))));
    check(F, `"${T.remove}" → "${T.sure}" 누르기`, (await press(p, '.server-box', T.remove)) && (await sleep(200), await press(p, '.server-box', T.sure)));
    await soft(until('탈퇴', async () => !(await h.status()).device, 15_000));
    check(F, '탈퇴: 계정 줄, 백업 줄, 디스크 파일 모두 없음', sql(`SELECT count(*) FROM account WHERE id = ${into}`) === '0' && sql(`SELECT count(*) FROM backup WHERE account_id = ${into}`) === '0' && files.every((f) => !existsSync(join(backupDir, `${f}.fbk`))));
    const st = await h.main('JSON.stringify(__jj.server.core.state())');
    check(F, '탈퇴하면 서버 백업 동의도 거둠 (저장 상태 backupAgreed=false)', JSON.parse(st).backupAgreed === false);
  } catch (err) {
    check('앱 B', '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    p?.close();
    await h.quit();
  }
}

// ================= 6. 앱 K: 백업 키 없는 서버 =================
async function appNoKey() {
  const F = '키 없는 서버';
  const h = await launch('nokey', { server: nokeyUrl });
  let p;
  try {
    p = await openSettings(h);
    await firstRun(h, p, F, 'qaNokey');
    check(F, `"${T.login}" 누르기`, await clickGoogle(h, p, `qa-k-${tag}`));
    await soft(until('로그인', async () => (await h.status()).signedIn, 15_000));
    await until('백업 칸', () => has(p, '.server-backup'), 10_000);
    await soft(until('안내', async () => (await p.ev(`document.querySelector('.server-backup')?.innerText ?? ''`)).includes(T.off), 8_000));
    const txt = await p.ev(`document.querySelector('.server-backup')?.innerText ?? ''`);
    check(F, '503 backup_off → "서버가 아직 서버 백업을 열지 않았어", 올리기 단추 없음', txt.includes(T.off) && (await btnInfo(p, '.server-backup', T.upload)) === null, txt.slice(0, 120));
    await p.shots('k-01-backup-off', '.server-backup');
  } catch (err) {
    check(F, '중단', false, err instanceof Error ? err.message : String(err));
  } finally {
    p?.close();
    await h.quit();
  }
}

let crashed = false;
try {
  // QA_ONLY=api,copy,nourl,u14,a,b,nokey 로 일부만
  const only = (process.env.QA_ONLY ?? "").split(",").filter(Boolean);
  const want = (k) => only.length === 0 || only.includes(k);
  if (want("api")) await apiLayer();
  if (want("copy")) await copyService();
  if (want("nourl")) await appNoUrl();
  if (want("u14")) await appUnder14();
  if (want("a")) await appA();
  if (want("b")) await appB();
  if (want("nokey")) await appNoKey();

} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
await nest.close().catch(() => {});
await nest2.close().catch(() => {});
await kakao.close();
dropPg();
for (let i = 0; i < 3; i++) {
  await sleep(500);
  rmSync(scratchAll, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS${crashed ? ', 중단됨' : ''}  화면: ${OUT}`);
for (const r of bad) console.log(`  FAIL [${r.area}] ${r.name} (${r.extra})`);
process.exit(bad.length || crashed ? 1 : 0);
