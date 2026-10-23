// 서버 백업과 카카오 연결 통합 점검 (이슈 #102). 시험용 Postgres 컨테이너, 가짜 카카오(server/scripts/fake-kakao.mjs),
// 페어리 서버(server/dist, BACKUP_ENC_KEY 와 임시 BACKUP_DIR)를 무작위 포트로 띄우고 앱을 붙인다(JJ_SERVER_URL_OVERRIDE).
// 진짜 구글과 카카오는 부르지 않는다. 시스템 브라우저도 열지 않는다: JJ_TEST_BROWSER=fetch 로 메인이 주소를 따라간다.
// 보는 것: 카카오 기능 키 allowlist 에서 허용 전에는 "카카오도 연결"이 없고 허용하면 생긴다, 연결하면 한 계정에 구글과 카카오,
// 서버 백업은 따로 동의 전에는 올리기 단추가 꺼져 있다, 올리면 목록과 디스크(암호문), 받으면 되살리기 확인 칸,
// 기능 키 off 면 단추가 사라진다, 탈퇴하면 백업 파일까지 지운다. 경우마다 PASS/FAIL, 설정 칸을 찍는다.
//
//   npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-backup.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만.
// 컨테이너는 jj-server-test-pg-<무작위> 이름으로만 만들고 지운다 (운영 컨테이너 fairy-*, moilga-* 는 건드리지 않는다).
// 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9875, 9876).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeKakao } from '../../server/scripts/fake-kakao.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'server-backup-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9875);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9876);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

// ---- 시험용 Postgres ----
const pgName = `jj-server-test-pg-${randomBytes(4).toString('hex')}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker(
  'run',
  '-d',
  '--rm',
  '--tmpfs',
  '/var/lib/postgresql/data',
  '--name',
  pgName,
  '--log-opt',
  'max-size=1m',
  '-e',
  `POSTGRES_PASSWORD=${pgPass}`,
  '-e',
  'POSTGRES_USER=fairy',
  '-e',
  'POSTGRES_DB=fairy',
  '-p',
  '127.0.0.1::5432',
  'postgres:16-alpine',
);
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
execFileSync(process.execPath, [join(root, 'server', 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});

// ---- 가짜 카카오와 페어리 서버 (구글 값 비움, 카카오는 allowlist) ----
const KAKAO_KEY = 'test-kakao-rest-key';
const KAKAO_SECRET = randomBytes(12).toString('hex');
const kakao = await startFakeKakao({ clientId: KAKAO_KEY, clientSecret: KAKAO_SECRET });
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.server-backup-test-'));
const backupDir = join(scratch, 'server-backups');
mkdirSync(backupDir, { recursive: true });
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const api = spawn(process.execPath, [join(root, 'server', 'dist', 'main.js')], {
  cwd: join(root, 'server'),
  env: {
    PATH: process.env.PATH,
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    PUBLIC_URL: apiUrl,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    KAKAO_REST_API_KEY: KAKAO_KEY,
    KAKAO_CLIENT_SECRET: KAKAO_SECRET,
    KAKAO_AUTH_URL: kakao.url,
    FEATURE_KAKAO_LOGIN: 'allowlist',
    BACKUP_ENC_KEY: randomBytes(32).toString('hex'),
    BACKUP_DIR: backupDir,
  },
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${apiUrl}/health`)).ok) break;
  } catch {}
  await sleep(250);
}

// ---- 앱 ----
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_SERVER_URL_OVERRIDE: apiUrl,
    JJ_TEST_SECRETS: 'memory',
    JJ_TEST_BROWSER: 'fetch',
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'server', apiPort, 'pg', pgName, 'lang', LANG);
let appExited = false;
app.on('exit', () => {
  appExited = true;
});

// ---- CDP ----
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
let mainConn;
async function main(expr) {
  if (!mainConn) {
    for (let i = 0; i < 80 && !mainConn; i++) {
      try {
        const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
        mainConn = await connect(t.webSocketDebuggerUrl);
      } catch {
        await sleep(250);
      }
    }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
async function page(name) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        return {
          ev: async (expr) =>
            (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
              ?.result?.value,
          /** 고른 칸만 찍는다 (화면에 맞춰 내리고 그 상자 크기로) */
          shot: async (file, selector = '.server-box', own = false) => {
            const v = await c.send('Runtime.evaluate', {
              expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const s = ${own} ? el : (el?.closest('section') ?? el); if (!s) return null; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); const w = document.documentElement.clientWidth; return { x: 0, y: Math.max(0, r.y - 4), width: w, height: Math.min(r.height + 8, 2400) }; })()`,
              returnByValue: true,
            });
            const box = v.result?.result?.value;
            await sleep(200);
            const r = await c.send('Page.captureScreenshot', {
              format: 'png',
              ...(box ? { clip: { ...box, scale: 2 }, captureBeyondViewport: true } : {}),
            });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          close: () => c.ws.close(),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  throw new Error(`기다림 끝: ${what}`);
}
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const status = async () => JSON.parse(await main('JSON.stringify(__jj.server.core.status())'));
const accountId = () => sql('SELECT id FROM account WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
const T = {
  ko: {
    link: '카카오도 연결',
    upload: '서버에 백업 올리기',
    download: '받아서 되살리기',
    consent: '서버 백업에 따로 동의',
    via: '구글, 카카오로 로그인했어',
    remove: '서버 계정 지우기',
    sure: '정말 지우기',
  },
  en: {
    link: 'Also link Kakao',
    upload: 'Upload backup to server',
    download: 'Download and restore',
    consent: 'Separate consent for server backup',
    via: 'Signed in with Google and Kakao',
    remove: 'Delete server account',
    sure: 'Really delete',
  },
}[LANG];
/** 칸 안 단추를 글로 찾는다: 없으면 null, 있으면 { disabled } */
const button = (p, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll('.server-box button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); return b ? { disabled: b.disabled } : null; })()`,
  );
const press = (p, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll('.server-box button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
  );
const boxText = (p) => p.ev(`document.querySelector('.server-box')?.innerText ?? ''`);

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));
  // 만 18세 이상, 기기 계정 → DB 에 구글 로그인과 세션을 만들고 앱에 넣는다 (시험 서버는 구글 값이 비어 있다)
  await main(`__jj.server.core.setAge('adult')`);
  await until('기기 계정', async () => {
    const s = await status();
    return s.device && s.balance !== null && !s.syncing;
  });
  const id = accountId();
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'test-g-${randomBytes(4).toString('hex')}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  check('세션 넣기', (await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`)) === true);
  await until('로그인 상태', async () => {
    const s = await status();
    return s.signedIn && s.providers !== null && !s.syncing;
  });
  await main("__jj.settingsWindow.open('restore')");
  const p = await page('settings');
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-backup')`));
  await sleep(500);

  // ---- 코인 초기화 기능 키 (기본 off): 단추 DOM 이 없다, 켜면 생긴다 ----
  const coinResetShown = () => p.ev(`!!document.querySelector('.coin-reset')`);
  check('coin_reset off: 설정에 코인 초기화 칸이 없다', (await coinResetShown()) === false);
  sql(`INSERT INTO feature_flag (key, mode) VALUES ('coin_reset', 'everyone')`);
  await sleep(5_300);
  await main('__jj.server.core.refreshProviders(true).then(() => __jj.server.core.run())');
  await until('코인 초기화 칸', coinResetShown, 10_000).catch(() => false);
  check('coin_reset on: 코인 초기화 칸이 생긴다', (await coinResetShown()) === true);
  sql(`DELETE FROM feature_flag WHERE key = 'coin_reset'`);

  // ---- 카카오: allowlist 인데 허용 전 ----
  check('허용 전에는 "카카오도 연결"이 없다', (await button(p, T.link)) === null);
  // 0004 의 feature_allow 는 feature_flag 줄을 가리킨다: 운영자 화면처럼 모드 줄(allowlist)부터
  sql(`INSERT INTO feature_flag (key, mode) VALUES ('kakao_login', 'allowlist') ON CONFLICT (key) DO NOTHING`);
  sql(`INSERT INTO feature_allow (key, account_id) VALUES ('kakao_login', ${id})`);
  await sleep(5_300); // 서버가 담아 둔 기능 키 (5초)
  await main('__jj.server.core.refreshProviders(true).then(() => __jj.server.core.run())');
  await until('카카오 단추', async () => (await button(p, T.link)) !== null, 10_000);
  check('허용한 계정에는 "카카오도 연결"이 생긴다', true);
  await p.shot('backup-1-before');
  kakao.state.nextSub = `9${Date.now()}`;
  check('카카오도 연결 누르기', await press(p, T.link));
  await until('카카오 연결', async () => (await status()).logins.includes('kakao'), 20_000);
  check(
    '한 계정에 구글과 카카오 (DB login 두 줄, 같은 계정)',
    sql(`SELECT string_agg(service, ',' ORDER BY service) FROM login WHERE account_id = ${id}`) === 'google,kakao',
  );
  check('카카오는 openid 만 요청', kakao.state.scopes.length > 0 && kakao.state.scopes.every((x) => x === 'openid'));
  await until('연결 글', async () => (await boxText(p)).includes(T.via), 5_000).catch(() => false);
  check('칸에 두 서비스로 로그인했다고 보인다', (await boxText(p)).includes(T.via));
  check('연결한 뒤에는 "카카오도 연결"이 없다', (await button(p, T.link)) === null);

  // ---- 서버 백업 ----
  check('동의 전에는 올리기 단추가 꺼져 있다', (await button(p, T.upload))?.disabled === true);
  check('따로 동의 켜기', await press(p, T.consent));
  await until('동의', async () => (await button(p, T.upload))?.disabled === false, 5_000);
  check('동의하면 올리기 단추가 켜진다', true);
  check('올리기', await press(p, T.upload));
  await until('올림', async () => (await status()).backup?.list?.length === 1, 30_000);
  const files = () => readdirSync(backupDir).filter((f) => f.endsWith('.fbk'));
  const disk = readFileSync(join(backupDir, files()[0] ?? 'none'));
  check(
    '서버 디스크에는 암호문만 (zip 머리, 파일 이름이 보이지 않는다)',
    files().length === 1 &&
      disk.subarray(0, 4).toString() === 'FBK1' &&
      !disk.includes(Buffer.from('jjakkung.db')) &&
      !disk.includes(Buffer.from('fairy-backup.json')),
  );
  check(
    'DB 에는 메타만 (계정, 크기, sha256)',
    sql(`SELECT count(*) FROM backup WHERE account_id = ${id} AND size > 0 AND octet_length(sha256) = 32`) === '1',
  );
  await sleep(400);
  await p.shot('backup-2-uploaded', '.server-backup', true);
  check('받아서 되살리기', await press(p, T.download));
  await until('되살리기 확인 칸', () => p.ev(`!!document.querySelector('.restore-ask')`), 30_000);
  check('받으면 되살리기 확인 칸이 열린다', true);
  await p.shot('backup-3-restore-ask', '.restore-ask');
  // 바꾸지 않고 그만둔다 (바꾸면 앱이 다시 켜진다)
  await p.ev(`[...document.querySelectorAll('.restore-ask button')].find((b) => !b.classList.contains('danger'))?.click()`);
  await until('확인 칸 닫힘', async () => !(await p.ev(`!!document.querySelector('.restore-ask')`)), 10_000);
  check(
    '받은 임시 파일은 남지 않는다',
    readdirSync(data).filter((f) => f.startsWith('server-backup-')).length === 0,
  );

  // ---- 기능 키 off: 카카오 단추가 사라지고 연결도 막힌다 ----
  sql(`UPDATE feature_flag SET mode = 'off' WHERE key = 'kakao_login'`);
  sql(`DELETE FROM login WHERE account_id = ${id} AND service = 'kakao'`);
  await sleep(5_300);
  await main('__jj.server.core.refreshProviders(true)');
  const prov = (await status()).providers;
  check('기능 키 off: 서버가 카카오를 알려 주지 않는다', !prov?.link.includes('kakao') && !prov?.login.includes('kakao'));
  const r = await fetch(`${apiUrl}/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`, {
    redirect: 'manual',
  });
  check('기능 키 off: /auth/kakao/start 는 503 feature_off', r.status === 503 && (await r.json()).error === 'feature_off');

  // ---- 탈퇴: 백업 파일까지 ----
  await press(p, T.remove);
  await sleep(100);
  await press(p, T.sure);
  await until('탈퇴', async () => !(await status()).device);
  check('탈퇴: 서버 백업 줄과 파일을 바로 지운다', sql('SELECT count(*) FROM backup') === '0' && files().length === 0);
  p.close();

  const how = await main(
    "(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()",
  );
  if (how !== 'quit') throw new Error('끝내기 못 함');
  mainConn.ws.close();
  await until('앱 끝남', () => appExited, 15_000);
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

if (!appExited) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
}
api.kill('SIGTERM');
await kakao.close();
dropPg();
if (failed || results.some((x) => !x.ok)) {
  try {
    const lines = readFileSync(join(data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => l.includes('server') || l.includes('backup')).slice(-30).join('\n')}`);
  } catch {}
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((x) => !x.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
