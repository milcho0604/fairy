// 업데이트 세 단계 통합 점검 (이슈 #120). 시험용 Postgres 컨테이너, 페어리 서버(server/dist, 운영자 토큰과 운영자 sub),
// 이 컴퓨터 http 서버(홈페이지 정적 파일 흉내와 가짜 최신 릴리스 0.5.0)를 띄우고 앱(판 0.4.3)을 붙인다.
// 흐름: 서버 모드를 켜고, 운영자 칸에서 기능 제한 판(0.4.4)을 저장 → 앱 맞추기 → 서버가 426 으로 막아 서버 칸에
// "업데이트하면 다시 쓸 수 있어" 와 업데이트 단추 → 앱 자체 기능(할 일 넣기)은 그대로 → 운영자 칸에서 강제 판(0.4.5)을
// 저장 → 맞추기가 서버 최소 판을 업데이트 확인에 넘기고 강제 잠금이 걸린다 (main.log 의 잠금 줄). PASS/FAIL 로 본다.
//
//   npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/update-levels.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만.
// 컨테이너는 jj-updlv-test-pg-<무작위> 이름으로만 만들고 지운다 (운영 컨테이너 fairy-*, moilga-* 는 건드리지 않는다).
// 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9877, 9878). 앱 판을 낮추는 손잡이는 없다: 0.4.3 이 기준 0.4.4 보다 낮은 옛 판이다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'update-levels-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9877);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9878);
/** 가짜 최신 릴리스 (앱 판보다 높아야 업데이트 확인이 강제를 본다) */
const LATEST = '0.5.0';
/** 이 앱의 판 (package.json). 서버 기준은 이보다 높게 정한다 */
const APP_VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const RESTRICT = '0.4.4';
const FORCE = '0.4.5';
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
const pgName = `jj-updlv-test-pg-${randomBytes(4).toString('hex')}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker(
  'run', '-d', '--rm', '--tmpfs', '/var/lib/postgresql/data', '--name', pgName, '--log-opt', 'max-size=1m', '-e', `POSTGRES_PASSWORD=${pgPass}`,
  '-e', 'POSTGRES_USER=fairy', '-e', 'POSTGRES_DB=fairy', '-p', '127.0.0.1::5432', 'postgres:16-alpine',
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

// ---- 홈페이지 흉내 (정적 파일)와 가짜 최신 릴리스 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.updlv-test-'));
const site = join(scratch, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'events.json'), '{"version":1,"events":[]}\n');
writeFileSync(join(site, 'notices.json'), '{"version":1,"notices":[]}\n');
const staticPort = await freePort();
const stat = httpServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/latest') {
    res.setHeader('content-type', 'application/json');
    return res.end(
      JSON.stringify({
        tag_name: `v${LATEST}`,
        html_url: `https://github.com/milcho0604/fairy-releases/releases/v${LATEST}`,
        draft: false,
        prerelease: false,
      }),
    );
  }
  const name = u.pathname.replace(/^\//, '');
  if (name !== 'events.json' && name !== 'notices.json') {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('content-type', 'application/json');
  res.end(readFileSync(join(site, name)));
});
await new Promise((r) => stat.listen(staticPort, '127.0.0.1', r));
const staticUrl = `http://127.0.0.1:${staticPort}`;

// ---- 페어리 서버 ----
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const ADMIN_SUB = `admin-sub-${randomBytes(4).toString('hex')}`;
const api = spawn(process.execPath, [join(root, 'server', 'dist', 'main.js')], {
  cwd: join(root, 'server'),
  env: {
    PATH: process.env.PATH,
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    PUBLIC_URL: apiUrl,
    ADMIN_TOKEN,
    ADMIN_GOOGLE_SUBS: ADMIN_SUB,
    RELEASES_API: `${staticUrl}/latest`,
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
    JJ_EVENTS_URL: `${staticUrl}/events.json`,
    JJ_NOTICES_URL: `${staticUrl}/notices.json`,
    JJ_RELEASES_API: `${staticUrl}/latest`,
    JJ_TEST_SECRETS: 'memory',
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'app', APP_VERSION, 'server', apiPort, 'pg', pgName, 'lang', LANG);

// ---- CDP (server-events.mjs 와 같은 방식) ----
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
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        const ev = async (expr) =>
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
            ?.value;
        return {
          ev,
          shot: async (file, selector) => {
            const box = selector
              ? await ev(
                  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const s = el?.closest('section') ?? el; if (!s) return null; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, window.innerHeight) }; })()`,
                )
              : null;
            await sleep(250);
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
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const status = async () => JSON.parse(await main('JSON.stringify(__jj.server.core.status())'));
const syncNow = () => main('__jj.server.core.run().then(() => true)');
/** 글로 단추를 찾아 누른다 (CDP, 진짜 마우스 없이) */
const press = (p, scope, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
/** 글로 단추를 찾아 누른다. 확인 단추(두 번 누르기)는 이 함수를 두 번 부른다 */
const pressTwice = async (p, scope, text) => {
  const first = await press(p, scope, text);
  await sleep(300);
  // 한 번 누르면 단추 글이 "정말 할까?" 로 바뀐다 (AdminBox Sure)
  return first && (await press(p, scope, T.sure));
};
/** React 입력 칸에 값 넣기 (네이티브 setter + input 사건) */
const typeInto = (p, selector, value) =>
  p.ev(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
/** 운영자 칸의 칸을 이름표(앞글자)로 찾아 넣는다 (admin-field 는 이름 속성이 없다) */
const typeByLabel = (p, prefix, value) =>
  p.ev(
    `(() => { const l = [...document.querySelectorAll('.admin-box label.admin-field')].find((x) => (x.querySelector('span')?.textContent ?? '').startsWith(${JSON.stringify(prefix)})); const el = l?.querySelector('input'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
const T = {
  ko: {
    adult: '만 18세 이상',
    start: '서버 모드 시작',
    save: '버전 저장',
    sure: '정말 할까? 한 번 더 눌러',
    update: '업데이트',
    problem: '업데이트하면 다시 쓸 수 있어',
    restrictLabel: '기능 제한 버전',
    minLabel: '최소 버전',
  },
  en: {
    adult: '18 or older',
    start: 'Start server mode',
    save: 'Save versions',
    sure: 'Sure? Press again',
    update: 'Update',
    problem: 'Update the app to use this again',
    restrictLabel: 'Restricted version',
    minLabel: 'Minimum version',
  },
}[LANG];
const NICK = LANG === 'ko' ? '시험친구' : 'Tester';
/** 파일의 로그 줄 (앱이 쓴 main.log) */
const logText = () => {
  try {
    return readFileSync(join(data, 'logs', 'main.log'), 'utf8');
  } catch {
    return '';
  }
};

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));
  await main("__jj.settingsWindow.open('restore')");
  const p = await page('settings');
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));

  // 서버 모드를 켠다 (나이, 닉네임, 시작)
  check('나이 누르기', await press(p, '.server-box', T.adult));
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`));
  await typeInto(p, '.server-nickname-step input', NICK);
  check('서버 모드 시작', await press(p, '.server-box', T.start));
  await until('기기 계정', async () => {
    const s = await status();
    return s.device && s.code && !s.syncing;
  }, 40_000);

  // 운영자 계정: DB 에 운영자 sub 로그인과 세션을 만들고 앱에 넣는다 → 운영자 칸이 보인다
  const id = sql('SELECT id FROM account ORDER BY id DESC LIMIT 1');
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', '${ADMIN_SUB}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  check('세션 넣기', (await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`)) === true);
  await until('운영자', async () => (await status()).admin === true);
  await until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 20_000);

  // 1단계: 기능 제한 판 0.4.4 저장 (운영자 칸, 두 번 누르기)
  check('기능 제한 칸 넣기', await typeByLabel(p, T.restrictLabel, RESTRICT));
  check('버전 저장 (두 번 누르기)', await pressTwice(p, '.admin-box', T.save));
  await until('저장 반영', async () => sql(`SELECT body->>'restrictVersion' FROM site_doc WHERE name = 'notices'`) === RESTRICT, 10_000);
  check('서버에 기능 제한 판이 저장됨', sql(`SELECT body->>'restrictVersion' FROM site_doc WHERE name = 'notices'`) === RESTRICT);
  const gated = await fetch(`${apiUrl}/v1/features`, { headers: { 'x-fairy-version': APP_VERSION } });
  const gatedBody = await gated.json();
  check(
    '옛 판 머리는 서버 기능이 426 으로 막힌다',
    gated.status === 426 && gatedBody.level === 'restrict' && gatedBody.need === RESTRICT,
    `${gated.status} ${JSON.stringify(gatedBody)}`,
  );
  check('공지 파일도 같은 기능 제한 판을 준다', (await (await fetch(`${apiUrl}/v1/notices.json`)).json()).restrictVersion === RESTRICT);

  // 앱 맞추기 → 서버 칸 안내와 업데이트 단추
  await syncNow();
  await until('업데이트 안내', async () => (await status()).problem === 'update', 20_000);
  check('맞추기 뒤 서버 칸이 업데이트 안내', (await status()).problem === 'update');
  await until('서버 칸 안내 글', () => p.ev(`document.querySelector('.server-box')?.textContent.includes(${JSON.stringify(T.problem)})`), 15_000);
  check('서버 칸 안내 글이 보인다', await p.ev(`document.querySelector('.server-box')?.textContent.includes(${JSON.stringify(T.problem)})`));
  check('업데이트 단추가 있다', await p.ev(`[...document.querySelectorAll('.server-box button')].some((b) => b.textContent.trim() === ${JSON.stringify(T.update)})`));
  await p.shot('updlv-1-restrict', '.server-box');

  // 앱 자체 기능은 그대로 (서버 기능만 멈춘다): 할 일 넣기
  const made = await main(`__jj.store.add({ title: ${JSON.stringify(LANG === 'ko' ? '업데이트 시험 할 일' : 'Update test todo')} }, Date.now()).id`);
  check('할 일 넣기는 동작한다 (앱 자체 기능)', typeof made === 'number' && made > 0, `id ${made}`);
  check('로컬 장부는 그대로 있다', typeof (await main('__jj.store.balance()')) === 'number');

  // 2단계: 강제 판 0.4.5 저장 → 맞추기 → 강제 잠금 (확인은 두 번 받아 같아야 한다, 10초 뒤 다시 확인)
  // 순서는 강제 ≤ 기능 제한 이므로 두 칸을 같이 올린다 (따로 올리면 서버가 순서 거절)
  check('기능 제한 칸도 같이 올리기', await typeByLabel(p, T.restrictLabel, FORCE));
  check('강제 칸 넣기', await typeByLabel(p, T.minLabel, FORCE));
  check('버전 저장 (강제, 두 번 누르기)', await pressTwice(p, '.admin-box', T.save));
  await until('강제 저장 반영', async () => sql(`SELECT body->>'minVersion' FROM site_doc WHERE name = 'notices'`) === FORCE, 10_000);
  await syncNow();
  const forced = await fetch(`${apiUrl}/v1/features`, { headers: { 'x-fairy-version': APP_VERSION } });
  const forcedBody = await forced.json();
  check('강제 판이면 서버가 force 로 막는다', forced.status === 426 && forcedBody.level === 'force' && forcedBody.need === FORCE, JSON.stringify(forcedBody));
  check('강제 판을 서버가 앱에 알린다 (/v1/me)', (await fetch(`${apiUrl}/v1/me`, { headers: { authorization: `Bearer ${session}` } })).status === 200);
  await until('강제 잠금 줄', async () => logText().includes('강제 업데이트로 잠금'), 45_000).catch(() => {});
  check('업데이트 확인이 강제 잠금을 건다 (서버 최소 판)', logText().includes('강제 업데이트로 잠금') && logText().includes(FORCE), FORCE);
  await p.shot('updlv-2-force', '.server-box');
  await p.shot('updlv-3-admin', '.admin-box');
  p.close();
} catch (err) {
  failed = true;
  console.log(`중단: ${err instanceof Error ? err.message : String(err)}`);
}

app.kill();
api.kill();
dropPg();
if (failed || results.some((r) => !r.ok)) {
  try {
    const lines = logText().trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => /update|server|강제|업데이트/.test(l)).slice(-30).join('\n')}`);
  } catch {}
}
await sleep(1000);
for (let i = 0; i < 3; i++) {
  try {
    rmSync(scratch, { recursive: true, force: true });
    break;
  } catch {
    await sleep(1000);
  }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
