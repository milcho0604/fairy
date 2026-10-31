// 같은 계정의 기기끼리 구글 일정 연결 이어 주기 통합 점검 (이슈 #115). 시험용 Postgres 컨테이너와 페어리 서버(server/dist)를
// 무작위 포트로 띄우고, 앱 둘(기기 A, 기기 B)을 같은 계정으로 붙인다. 진짜 구글은 부르지 않는다:
// - 서버는 구글 값이 비어 있다. 로그인은 DB 에 세션을 만들어 앱 메모리에 넣는다(__jj.server.debugSetSession).
//   기기 B 를 A 의 계정으로 합친 것은 DB 에서 기기 줄을 A 의 계정으로 옮기고 B 의 빈 계정을 닫아 흉내 낸다 (로그인 합치기와 같은 끝).
// - 기기 A 의 구글 일정 연결은 연결 상태만 손잡이로 흉내 낸다(__jj.server.debugCalendarLinked). 구글 토큰은 없다.
// - 기기 B 의 "구글 계정 연결" 단추는 진짜로 누른다. 브라우저 열기(shell.openExternal)만 바꿔 끼워 연 주소를 받고 바로 그만둔다.
// 보는 것: A 가 연결하면 서버 표시가 참, B 에 안내와 연결 단추, 단추를 누르면 기존 연결 흐름이 시작, B 가 연결하면 안내가 사라짐,
// 거절하면 맞추기와 설정 창을 다시 열어도 안 물음(이 기기의 상태 파일), A 에는 안내 없음, 기능 키 off 면 안내 없음,
// 마지막 기기가 끊으면 거짓. 경우마다 PASS/FAIL, 설정 칸을 찍는다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/calendar-link.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만.
// 컨테이너는 jj-callink-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위 (사용자 앱의 9881/9882 를 쓰지 않는다).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'calendar-link-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
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
const pgName = `jj-callink-pg-${randomBytes(4).toString('hex')}`;
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

// ---- 페어리 서버 (구글 값 비움, 기능 키 calendar_link_hint 는 기본 allowlist) ----
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
  },
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${apiUrl}/health`)).ok) break;
  } catch {}
  await sleep(250);
}

// ---- 앱 둘 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.calendar-link-test-'));

async function launch(name) {
  const data = join(scratch, `${name}-data`);
  const home = join(scratch, `${name}-home`);
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const inspect = await freePort();
  const pagePort = await freePort();
  const proc = spawn(electronPath, [`--inspect=${inspect}`, '.', `--remote-debugging-port=${pagePort}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_SERVER_URL_OVERRIDE: apiUrl,
      JJ_TEST_SECRETS: 'memory',
      // 설정의 구글 캘린더 칸이 보이게 하는 모양만 맞춘 가짜 클라이언트 (이 시험은 구글에 닿지 않는다)
      JJ_GOOGLE_CLIENT_ID: '1234567890-calendarlinktest.apps.googleusercontent.com',
      JJ_GOOGLE_CLIENT_SECRET: '',
    },
    stdio: 'ignore',
  });
  const h = { name, data, proc, exited: false, inspect, pagePort, conn: undefined };
  proc.on('exit', () => {
    h.exited = true;
  });
  console.log('app', name, 'pid', proc.pid, 'ports', inspect, pagePort);
  return h;
}

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
        ws.removeEventListener('message', on);
      };
      const on = (e) => {
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
      ws.addEventListener('message', on);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}
async function main(h, expr) {
  for (let i = 0; i < 120 && !h.conn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${h.inspect}/json/list`)).json();
      h.conn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  const m = await h.conn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
async function page(h, name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${h.pagePort}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        return {
          ev: async (expr) =>
            (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
              ?.result?.value,
          shot: async (file) => {
            await sleep(300);
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          close: () => c.ws.close(),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`${h.name}: ${name} 화면 없음`);
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
const status = async (h) => JSON.parse(await main(h, 'JSON.stringify(__jj.server.core.status())'));
const linkedRows = (id) =>
  Number(
    sql(`SELECT count(*) FROM calendar_link l JOIN device d ON d.id = l.device_id WHERE d.account_id = ${id}`),
  );
const T = {
  ko: { hint: '다른 기기에서 구글 일정을 연결했어. 이 기기도 연결할까?', connect: '구글 계정 연결', no: '괜찮아, 다시 묻지 마' },
  en: { hint: 'You connected Google Calendar on another device. Connect this one too?', connect: 'Connect Google account', no: "No thanks, don't ask again" },
}[LANG];

/** 큰 창을 비서 구역으로 열고 구글 캘린더 칸까지 내린다 (설정에서 꺼낸 구역) */
async function openAssist(h) {
  await main(h, "__jj.home.open('assist'); 1");
  const s = await page(h, 'home');
  await until('큰 창 화면', () => s.ev(`!!document.querySelector('#ptab-assist')`));
  await s.ev(`document.querySelector('#ptab-assist').click(); 1`);
  await until('구글 캘린더 칸', () =>
    s.ev(`[...document.querySelectorAll('h2')].some((x) => /구글 캘린더|Google Calendar/.test(x.textContent))`),
  );
  await s.ev(
    `[...document.querySelectorAll('h2')].find((x) => /구글 캘린더|Google Calendar/.test(x.textContent)).scrollIntoView({ block: 'start' }); 1`,
  );
  return s;
}
const hintShown = (s) => s.ev(`!!document.querySelector('.gcal-link-hint')`);
const closeSettings = (h) =>
  main(h, '(() => { const w = __jj.home.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');

/** 서버 모드(만 18세 이상) → 기기 계정이 생길 때까지 */
async function serverOn(h) {
  await until(`${h.name} __jj`, () => main(h, 'typeof __jj === "object"'), 60_000);
  await main(h, `__jj.server.core.setAge('adult')`);
  await until(`${h.name} 기기 계정`, async () => {
    const s = await status(h);
    return s.device && s.balance !== null && !s.syncing;
  });
  return sql('SELECT id FROM account WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
}
/** DB 에 세션을 만들어 앱에 넣는다 (구글 로그인 흉내) */
async function signIn(h, accountId) {
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${accountId}, sha256('${session}'::bytea))`);
  return main(h, `__jj.server.debugSetSession(${JSON.stringify(session)})`);
}
const syncNow = (h) => main(h, '__jj.server.core.run().then(() => 1)');

const apps = [];
let failed = false;
try {
  // ---- 기기 A: 처음 로그인한 기기 ----
  const A = await launch('A');
  apps.push(A);
  const id = await serverOn(A);
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'test-sub-${randomBytes(4).toString('hex')}', ${id})`);
  // 기능 키는 기본 allowlist: 이 계정을 허용 목록에 넣는다 (운영자 화면의 "허용 목록에 넣기"와 같은 줄)
  sql(`INSERT INTO feature_flag (key, mode) VALUES ('calendar_link_hint', 'allowlist') ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO feature_allow (key, account_id) VALUES ('calendar_link_hint', ${id})`);
  check('A 세션 넣기', (await signIn(A, id)) === true);
  // 서버는 기능 키를 5초 담아 둔다: 넣기 전에 물었던 값이 풀리면 다시 묻는다
  await until(
    'A 기능 키',
    async () => {
      await main(A, '__jj.server.core.refreshProviders(true).then(() => 1)');
      return (await status(A)).features?.calendar_link_hint === true;
    },
    20_000,
  );
  await syncNow(A);
  check('A 는 아직 연결 전: 서버 표시 없음, 안내 없음', linkedRows(id) === 0 && (await status(A)).calendarHint === false);
  // A 에서 구글 일정 연결 (상태만 흉내)
  check('A 연결 흉내', (await main(A, '__jj.server.debugCalendarLinked(true)')) === true);
  check('A 가 연결하면 서버에 표시가 하나 (토큰 없이)', linkedRows(id) === 1);
  check(
    '서버에 구글 토큰 같은 것은 없다 (calendar_link 는 기기 번호와 때만)',
    sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'calendar_link'`) ===
      'device_id,linked_at',
  );
  check('A 자신에게는 안내가 없다', (await status(A)).calendarHint === false);

  // ---- 기기 B: 같은 계정으로 새로 로그인한 기기 ----
  const B = await launch('B');
  apps.push(B);
  const idB = await serverOn(B);
  // 로그인 합치기 흉내: B 의 기기 줄을 A 의 계정으로 옮기고 B 의 빈 계정은 닫는다 (accounts.ts merge 의 끝과 같다)
  sql(`UPDATE device SET account_id = ${id} WHERE account_id = ${idB}`);
  sql(`UPDATE account SET closed_at = now(), merged_into = ${id} WHERE id = ${idB}`);
  check('B 세션 넣기 (같은 계정)', (await signIn(B, id)) === true);
  await until(
    'B 기능 키',
    async () => {
      await main(B, '__jj.server.core.refreshProviders(true).then(() => 1)');
      return (await status(B)).features?.calendar_link_hint === true;
    },
    20_000,
  );
  await syncNow(B);
  await until('B 안내', async () => (await status(B)).calendarHint === true, 15_000).catch(() => {});
  check('B: 다른 기기에서 연결했고 이 기기는 아직이라 안내', (await status(B)).calendarHint === true);

  const s = await openAssist(B);
  await until('안내 줄', () => hintShown(s), 10_000).catch(() => {});
  const hintText = await s.ev(`document.querySelector('.gcal-link-hint')?.textContent ?? ''`);
  check('설정 캘린더 칸에 안내 줄', hintText === T.hint, hintText);
  check('줄표(—) 없음', !(await s.ev(`document.querySelector('.card .gcal-link-hint')?.closest('section')?.innerText ?? ''`)).includes('—'));
  const buttons = await s.ev(
    `[...document.querySelector('.gcal-link-hint').closest('section').querySelectorAll('button')].map((b) => b.textContent.trim())`,
  );
  check('연결 단추와 거절 단추', buttons.includes(T.connect) && buttons.includes(T.no), buttons.join(' | '));
  if (LANG === 'en')
    check('영어판에 한글 없음', !/[가-힣]/.test(await s.ev(`document.querySelector('.gcal-link-hint').closest('section').innerText`)));
  await s.shot('calendar-link-1-hint');

  // 연결 단추: 기존 구글 연결 흐름이 시작한다 (브라우저 열기만 바꿔 끼운다. 구글에는 닿지 않는다)
  await main(
    B,
    `(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; }; return 1; })()`,
  );
  await s.ev(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(T.connect)}).click(); 1`,
  );
  await until('연결 흐름 시작', () => main(B, 'typeof globalThis.__qaOpened === "string"'), 10_000).catch(() => {});
  const opened = await main(B, 'globalThis.__qaOpened ?? ""');
  const u = opened ? new URL(opened) : null;
  check(
    '단추를 누르면 기존 구글 연결 흐름 (구글 허락 주소, 이 컴퓨터 루프백, PKCE)',
    u?.origin === 'https://accounts.google.com' &&
      /^http:\/\/127\.0\.0\.1:\d+/.test(u.searchParams.get('redirect_uri') ?? '') &&
      u.searchParams.get('code_challenge_method') === 'S256',
    opened.slice(0, 60),
  );
  check('연결 기다리는 중으로 보인다', (await main(B, '__jj.gcal.status().connecting')) === true);
  await s.shot('calendar-link-2-connecting');
  // 그만두기 (진짜로 허락하지 않는다)
  await s.ev(`[...document.querySelectorAll('.card button.link')].find((b) => /그만두기|Cancel/.test(b.textContent)).click(); 1`);
  await until('그만둠', async () => (await main(B, '__jj.gcal.status().connecting')) === false, 10_000).catch(() => {});
  check('그만두면 연결 안 됨, 안내는 그대로', (await main(B, '__jj.gcal.status().connected')) === false && (await hintShown(s)));

  // B 도 연결하면 안내가 사라지고 서버는 두 기기를 센다
  await main(B, '__jj.server.debugCalendarLinked(true)');
  check('B 가 연결하면 서버 표시 둘', linkedRows(id) === 2);
  check('B 가 연결하면 안내가 사라진다', (await status(B)).calendarHint === false);
  // B 가 다시 끊으면 (A 는 그대로) 안내가 다시
  await main(B, '__jj.server.debugCalendarLinked(false)');
  check('B 가 끊으면 서버 표시 하나 (A 몫)', linkedRows(id) === 1);
  await until('안내 다시', () => hintShown(s), 10_000).catch(() => {});
  check('B 가 끊으면 안내가 다시 보인다', await hintShown(s));

  // 기능 키 off 면 거절하지 않은 기기에도 안내가 없다. 다시 켜면 돌아온다
  const setMode = async (mode) => {
    sql(`UPDATE feature_flag SET mode = '${mode}' WHERE key = 'calendar_link_hint'`);
    await sleep(5_300); // 서버가 담아 둔 기능 키 (5초)
    await main(B, '__jj.server.core.run().then(() => __jj.server.core.refreshProviders(true)).then(() => 1)');
  };
  await setMode('off');
  check('기능 키 off: B 에 안내 없음', (await status(B)).calendarHint === false);
  await until('안내 숨김', async () => !(await hintShown(s)), 10_000).catch(() => {});
  check('기능 키 off: 칸에서도 안내 줄이 없다', !(await hintShown(s)));
  await setMode('allowlist');
  await until('안내 다시', () => hintShown(s), 10_000).catch(() => {});
  check('기능 키를 다시 켜면 안내가 돌아온다', (await status(B)).calendarHint === true && (await hintShown(s)));

  // 거절: 이 기기에서는 다시 묻지 않는다
  await s.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(T.no)}).click(); 1`);
  await until('안내 닫힘', async () => !(await hintShown(s)), 10_000).catch(() => {});
  check('거절하면 안내가 사라진다', !(await hintShown(s)) && (await status(B)).calendarHint === false);
  await s.shot('calendar-link-3-declined');
  s.close();
  await closeSettings(B);
  await syncNow(B);
  const s2 = await openAssist(B);
  await sleep(800);
  check('맞추기 뒤 설정 창을 다시 열어도 묻지 않는다', !(await hintShown(s2)) && (await status(B)).calendarHint === false);
  const saved = JSON.parse(readFileSync(join(B.data, 'server-state.json'), 'utf8'));
  check('거절은 이 기기의 상태 파일에 (서버에는 보내지 않는다)', saved.calendarHintNo === true);
  s2.close();
  await closeSettings(B);
  check('A 의 표시는 그대로', linkedRows(id) === 1);

  // 기능 키 off: 앱이 꺼짐으로 본다
  sql(`UPDATE feature_flag SET mode = 'off' WHERE key = 'calendar_link_hint'`);
  await sleep(5_300); // 서버가 담아 둔 기능 키 (5초)
  await main(A, '__jj.server.core.refreshProviders(true).then(() => 1)');
  check('기능 키 off: A 도 기능 키 꺼짐으로 본다', (await status(A)).features?.calendar_link_hint === false);
  // 꺼져 있어도 끊은 것은 올린다 (마지막 기기가 끊으면 거짓)
  await main(A, '__jj.server.debugCalendarLinked(false)');
  check('마지막 기기가 끊으면 서버 표시 없음 (기능 키가 꺼져 있어도)', linkedRows(id) === 0);
  sql(`UPDATE feature_flag SET mode = 'allowlist' WHERE key = 'calendar_link_hint'`);

  for (const h of apps) {
    await main(
      h,
      "(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()",
    ).catch(() => {});
    h.conn?.ws.close();
    await until(`${h.name} 끝남`, () => h.exited, 15_000).catch(() => {});
  }
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

for (const h of apps) {
  if (h.exited) continue;
  h.proc.kill('SIGTERM');
  for (let i = 0; i < 20 && !h.exited; i++) await sleep(250);
  if (!h.exited) h.proc.kill('SIGKILL');
}
api.kill('SIGTERM');
dropPg();
if (failed || results.some((r) => !r.ok)) {
  for (const h of apps) {
    try {
      const lines = readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
      console.log(`---- ${h.name} 앱 기록 끝 ----\n${lines.filter((l) => /server|gcal/.test(l)).slice(-20).join('\n')}`);
    } catch {}
  }
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
