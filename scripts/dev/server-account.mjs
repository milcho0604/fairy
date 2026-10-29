// 서버 계정 통합 점검 (이슈 #99). 시험용 Postgres 컨테이너와 페어리 서버(server/dist)를 무작위 포트로 띄우고(구글 값 비움),
// 앱을 그 서버에 붙여(JJ_SERVER_URL_OVERRIDE) 나이 확인 → 기기 계정 → 코인 벌기 → 맞추기 → 서버 잔액 일치,
// 서버 끔/켬, 거절된 구매 되돌리기, 만 14세 미만 전환, 탈퇴를 보고 설정 칸을 찍는다. 경우마다 PASS/FAIL.
//
//   npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-account.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 맥북 화면, 입력은 CDP 로만.
// 진짜 AI CLI 가 잡히지 않게 환경 변수는 비우고 PATH 는 /usr/bin:/bin 과 node 만 둔다. 로그인 단추는 누르지 않는다(진짜 브라우저가 열린다).
// 컨테이너는 jj-server-test-pg-<무작위> 이름으로만 만들고 지운다 (운영 컨테이너 fairy-*, moilga-* 는 건드리지 않는다).
// 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9871, 9872).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'server-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9871);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9872);
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

// ---- 페어리 서버 (구글 값 비움: 로그인 경로는 503) ----
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
let api;
async function startApi() {
  api = spawn(process.execPath, [join(root, 'server', 'dist', 'main.js')], {
    cwd: join(root, 'server'),
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      PUBLIC_URL: apiUrl,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      // 산 물건 초기화 시험이 있어 코인 초기화 기능 키를 켠다 (기본 off, #102)
      FEATURE_COIN_RESET: 'everyone',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('서버가 뜨지 않음');
}
async function stopApi() {
  if (!api || api.exitCode !== null) return;
  const gone = new Promise((r) => api.once('exit', r));
  api.kill('SIGTERM');
  await gone;
}
await startApi();

// ---- 앱 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.server-test-'));
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
    // 진짜 키체인을 건드리지 않는다: 서버 토큰은 메모리에만, Chromium 은 가짜 열쇠고리 (test-keychain.ts)
    JJ_TEST_SECRETS: 'memory',
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
          /** 서버 칸만 찍는다 (칸을 화면에 맞춰 내리고 그 상자 크기로) */
          shot: async (file) => {
            const box = await (async () => {
              const v = await c.send('Runtime.evaluate', {
                expression: `(() => { const h = [...document.querySelectorAll('section h2')].find((x) => x.closest('section')?.querySelector('.server-box')); const s = h?.closest('section'); if (!s) return null; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); const w = document.documentElement.clientWidth; return { x: 0, y: Math.max(0, r.y - 4), width: w, height: Math.min(r.height + 8, 2000) }; })()`,
                returnByValue: true,
              });
              return v.result?.result?.value;
            })();
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
const localBalance = () => main('__jj.store.balance()');
const serverBalance = () => Number(sql('SELECT balance FROM account WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1') || 'NaN');
const syncNow = () => main('__jj.server.core.run().then(() => true)');
/** 칸 안 단추를 글로 찾아 누른다 (CDP, 진짜 마우스 없이) */
const press = (p, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll('.server-box button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
const T = {
  ko: { nick: '계정시험', start: '서버 계정 시작', adult: '만 18세 이상', under14: '만 14세 미만', change: '나이 바꾸기', remove: '서버 계정 지우기', sure: '정말 지우기' },
  en: { nick: 'Tester', start: 'Start server account', adult: '18 or older', under14: 'Under 14', change: 'Change age', remove: 'Delete server account', sure: 'Really delete' },
}[LANG];

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));
  await main("__jj.settingsWindow.open('restore')");
  const p = await page('settings');
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  await sleep(400);
  await p.shot('server-1-ask-age');
  check('나이 묻기 칸이 뜬다, 아직 아무 요청도 없다', (await status()).age === null && sql('SELECT count(*) FROM account') === '0');

  // 처음 코인 (앱 안 모드에서 모은 것)과 산 물건 → 옮기기로 간다
  await main(`(__jj.store.reward(10, 'meet', Date.now()), __jj.store.reward(200, 'weekly', Date.now()), __jj.shop.buyToy('ball', Date.now()))`);
  const before = await localBalance();
  check('누르기', await press(p, T.adult));
  // #101: 만 14세 이상은 닉네임부터 정하고 서버 모드를 시작한다
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`));
  await p.ev(
    `(() => { const el = document.querySelector('.server-nickname-step input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(T.nick)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  check('서버 계정 시작', await press(p, T.start));
  await until('기기 계정과 첫 맞추기', async () => {
    const s = await status();
    return s.device && s.balance !== null && !s.syncing;
  });
  check(
    '나이 답 → 기기 계정 → 옮기기 (서버 잔액 = 앱 잔액, 산 물건)',
    serverBalance() === before && (await localBalance()) === before && sql(`SELECT item FROM owned_item`) === 'toy:ball',
    `앱 ${before}, 서버 ${serverBalance()}`,
  );
  check('서버 나이 구분 18+', sql('SELECT age FROM account WHERE closed_at IS NULL') === '18+');

  // 코인 벌기 → 맞추기
  await main(
    `(() => { const t = __jj.store.add({ title: 'server test' }, Date.now()); __jj.store.complete(t.id, Date.now()); __jj.store.rewardFocus(Date.now(), 25); })()`,
  );
  await syncNow();
  const earned = await localBalance();
  check('코인 벌기 → 맞추기 → 서버 잔액 일치', serverBalance() === earned && (await status()).pending === 0, `앱 ${earned}, 서버 ${serverBalance()}`);
  {
    const ref = sql(`SELECT ref FROM coin_entry WHERE reason = 'todo'`);
    check('할 일 기록에 ref 지문, 원래 번호는 안 감', /^[0-9a-f]{16}$/.test(ref), ref);
  }
  await p.shot('server-2-synced');

  // 서버 끔: 앱은 사본으로 계속, 대기열에 쌓인다
  await stopApi();
  await main(`(__jj.store.reward(3, 'rest', Date.now()), __jj.store.reward(3, 'rest', Date.now()))`);
  await syncNow();
  const off = await status();
  check('서버 끔: 문제 offline, 대기열 2, 앱 잔액은 늘었다', off.problem === 'offline' && off.pending === 2 && (await localBalance()) === earned + 6, JSON.stringify({ p: off.problem, n: off.pending }));
  await p.shot('server-3-offline');
  // 서버 켬: 대기열을 보내고 맞춘다
  await startApi();
  await syncNow();
  const on = await status();
  check('서버 켬: 대기열을 보내 서버 잔액 일치', on.problem === null && on.pending === 0 && serverBalance() === earned + 6, `서버 ${serverBalance()}`);

  // 다른 기기가 먼저 써서 서버 잔액이 모자랐다 → 구매 거절 → 물건 회수, 코인 돌려받음
  sql('UPDATE account SET balance = 20 WHERE closed_at IS NULL');
  const bought = await main(`__jj.shop.buyToy('cushion', Date.now()).ok`);
  await syncNow();
  check(
    '거절된 구매: 쿠션 회수, 앱 잔액 = 서버 잔액',
    bought === true && (await main(`__jj.shop.owns('cushion')`)) === false && (await localBalance()) === 20 && serverBalance() === 20,
    `앱 ${await localBalance()}`,
  );

  // 산 물건 초기화도 서버로 (reset-items): 다음 맞추기에서 돌아오지 않는다
  await main(`__jj.shop.buyToy('ball', Date.now()).ok || __jj.shop.ownedItems()['toy:ball'] === 1`);
  await syncNow();
  const hadItems = Number(sql('SELECT count(*) FROM owned_item'));
  await main(`__jj.shop.resetCoins('all', Date.now()).ok`);
  await syncNow();
  await syncNow();
  check(
    '산 물건 초기화: 서버 물건도 비고 앱에 돌아오지 않는다',
    hadItems > 0 &&
      sql('SELECT count(*) FROM owned_item') === '0' &&
      (await main(`Object.keys(__jj.shop.ownedItems()).length`)) === 0,
    `전 ${hadItems}`,
  );

  // 나이 구분을 바꾸면 서버에도 (PATCH /v1/account)
  await main(`__jj.server.core.setAge('teen')`);
  await syncNow();
  check('나이 구분 바꾸기: 서버도 14+', sql('SELECT age FROM account WHERE closed_at IS NULL') === '14+');

  // 만 14세 미만으로 바꾸면: 서버 모드 끔, 탈퇴 안내, 요청 없음
  check('나이 바꾸기', await press(p, T.change));
  await sleep(200);
  check('만 14세 미만', await press(p, T.under14));
  await until('앱 안 모드', async () => (await status()).on === false);
  const n0 = sql('SELECT count(*) FROM coin_entry');
  await main(`__jj.store.reward(10, 'meet', Date.now() + 86400000)`);
  await syncNow();
  check('만 14세 미만: 맞추기를 보내지 않는다', sql('SELECT count(*) FROM coin_entry') === n0 && (await status()).leftover === true);
  await sleep(300);
  await p.shot('server-4-under14');

  // 탈퇴 (두 번 눌러)
  await press(p, T.remove);
  await sleep(100);
  await press(p, T.sure);
  await until('탈퇴', async () => !(await status()).device);
  check('탈퇴: 서버 계정 지움, 앱 코인은 남는다', sql('SELECT count(*) FROM account') === '0' && (await localBalance()) > 0);
  await sleep(300);
  await p.shot('server-5-removed');
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
await stopApi();
dropPg();
if (failed || results.some((r) => !r.ok)) {
  try {
    const lines = readFileSync(join(data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => l.includes('server')).slice(-30).join('\n')}`);
  } catch {}
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
