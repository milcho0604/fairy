// 서버 4단계 통합 점검 (이슈 #101). 시험용 Postgres 컨테이너, 페어리 서버(server/dist, 운영자 토큰과 운영자 sub 를 넣고),
// 이 컴퓨터 http 서버(홈페이지 정적 파일 흉내 site/ 와 가짜 최신 릴리스)를 띄우고 앱을 붙인다. 운영자가 웹 /admin 에서 만든
// 이벤트, 쿠폰, 쪽지, 공지가 scripts/site-feeds.mjs(Actions 와 같은 길)로 정적 파일이 되어 앱 화면에 닿는지 PASS/FAIL 로 보고,
// 칸을 찍는다: 닉네임 입력, 기기 코드, 이벤트와 쿠폰, 서버 쪽지(쪽지함, 펫 말풍선), 운영자 칸(운영자일 때만), 공지 창.
//
//   npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-events.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만.
// 컨테이너는 jj-events-test-pg-<무작위> 이름으로만 만들고 지운다 (운영 컨테이너 fairy-*, moilga-* 는 건드리지 않는다).
// 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9875, 9876).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'events-shots'));
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
const pgName = `jj-events-test-pg-${randomBytes(4).toString('hex')}`;
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
execFileSync(process.execPath, [join(root, 'server', 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});

// ---- 홈페이지 흉내 (site/ 정적 파일)와 가짜 최신 릴리스 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.events-test-'));
const site = join(scratch, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'events.json'), '{"version":1,"events":[]}\n');
writeFileSync(join(site, 'notices.json'), '{"version":1,"notices":[]}\n');
const staticPort = await freePort();
const stat = httpServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/latest') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: 'v0.4.3', html_url: 'https://github.com/milcho0604/fairy-releases/releases/v0.4.3', draft: false, prerelease: false }));
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

/** 웹 운영자 화면 흉내 (쿠키, CSRF, 같은 출처) */
const web = { cookie: '', csrf: '' };
async function adminPage(q = '') {
  const r = await fetch(`${apiUrl}/admin${q}`, { headers: { cookie: web.cookie } });
  const text = await r.text();
  web.csrf = /name="csrf" value="([^"]+)"/.exec(text)?.[1] ?? web.csrf;
  return text;
}
async function adminPost(path, fields) {
  const form = new URLSearchParams({ csrf: web.csrf });
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) form.append(k, String(x));
  const r = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: web.cookie, origin: apiUrl },
    body: form.toString(),
  });
  if (r.status === 303 && path === '/admin/login') web.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const page = await adminPage();
  return /<p class="flash( error)?" role="status">([^<]*)<\/p>/.exec(page)?.[2] ?? `HTTP ${r.status}`;
}
const kstInput = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);
/** Actions 와 같은 길: 서버의 /v1/*.json 을 검사해 site/ 에 쓴다 */
const pullFeeds = () =>
  execFileSync(process.execPath, [join(root, 'scripts', 'site-feeds.mjs'), '--api', apiUrl, '--site', site], { encoding: 'utf8' });

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
          /** 고른 것을 품은 칸(section, 없으면 그것)을 찍는다 */
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
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const status = async () => JSON.parse(await main('JSON.stringify(__jj.server.core.status())'));
const localBalance = () => main('__jj.store.balance()');
const syncNow = () => main('__jj.server.core.run().then(() => true)');
/** 글로 단추를 찾아 누른다 (CDP, 진짜 마우스 없이) */
const press = (p, scope, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
/** React 입력 칸에 값 넣기 (네이티브 setter + input 사건) */
const typeInto = (p, selector, value) =>
  p.ev(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
const T = {
  ko: { ticket: '채팅 이용권 Claude', adult: '만 18세 이상', start: '서버 모드 시작', claim: '선물 받기', coupon: '쿠폰 쓰기', from: '운영자', admin: '운영자' },
  en: { ticket: 'Chat pass AI', adult: '18 or older', start: 'Start server mode', claim: 'Get gift', coupon: 'Use coupon', from: 'Operator', admin: 'Operator' },
}[LANG];
const NICK = LANG === 'ko' ? '시험친구' : 'Tester';

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));
  check('운영자 웹 로그인', (await adminPost('/admin/login', { token: ADMIN_TOKEN })) !== 'HTTP 401' && web.cookie.startsWith('__Host-fairy_admin='));

  await main("__jj.settingsWindow.open('restore')");
  const p = await page('settings');
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  // 나이 → 닉네임
  check('나이 누르기', await press(p, '.server-box', T.adult));
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`));
  await p.shot('events-1-nickname', '.server-nickname-step');
  await typeInto(p, '.server-nickname-step input', NICK);
  check('서버 모드 시작', await press(p, '.server-box', T.start));
  await until('기기 계정', async () => {
    const s = await status();
    return s.device && s.code && !s.syncing;
  });
  const st = await status();
  check('닉네임이 서버에 간다', sql('SELECT nickname FROM account ORDER BY id DESC LIMIT 1') === NICK, st.nickname);
  const code = sql('SELECT code FROM account ORDER BY id DESC LIMIT 1');
  check('기기 코드 F-XXXX-XXXX, 칸에 보인다', /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(code) && (await p.ev(`document.querySelector('.server-code')?.textContent ?? ''`)).includes(code), code);
  check('운영자 칸이 DOM 에 없다 (운영자 아님)', (await p.ev(`document.querySelector('.admin-box') === null`)) === true);
  await p.shot('events-2-profile', '.server-code');

  // 이벤트: 웹에서 만들고 정적 파일로 → 앱 목록 → 선물 받기
  const evId = `gift-${randomBytes(3).toString('hex')}`;
  const made = await adminPost('/admin/events', {
    id: evId,
    kind: 'gift',
    title_ko: '가을 선물',
    title_en: 'Autumn gift',
    body_ko: '코인 30개를 선물로 줄게.',
    body_en: 'Here are 30 coins as a gift.',
    from: kstInput(Date.now() - 3_600_000),
    until: kstInput(Date.now() + 3 * 86_400_000),
    coins: 30,
  });
  check('웹에서 이벤트 만들기', made.includes(evId), made);
  pullFeeds();
  await main('__jj.siteEvents.refresh()');
  await until('이벤트 목록', () => p.ev(`!!document.querySelector('.event-item')`));
  // 기본은 로그인 계정만 (버그잡이 #113): 기기 계정은 login_required 와 안내. 이 뒤로는 운영자가 꺼 둔다
  check('로그인 전에는 선물 403 login_required', (await main(`__jj.server.core.claim(${JSON.stringify(evId)}).then((r) => r.error)`)) === 'login_required');
  check('로그인 계정만 끄기 (운영자)', (await adminPost('/admin/rewards/policy', { login_only: 0 })).includes('기기 계정도'));
  const before = await localBalance();
  check('선물 받기 누르기', await press(p, '.events-box', T.claim));
  await until('선물 반영', async () => (await localBalance()) === before + 30);
  check('선물 30 코인이 앱 잔액에', (await localBalance()) === before + 30);
  check('두 번째는 받았어로', (await p.ev(`[...document.querySelectorAll('.event-item button')].every((b) => b.disabled)`)) === true);

  // 쿠폰
  const cmsg = await adminPost('/admin/coupons', { label: '시험', coins: 20, tickets: 0, max_uses: 10, until: kstInput(Date.now() + 86_400_000) });
  const coupon = /([2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4})/.exec(cmsg)?.[1] ?? '';
  check('쿠폰 만들기 (코드 한 번 보임)', !!coupon, cmsg);
  await typeInto(p, '.coupon-input', coupon.toLowerCase());
  const b2 = await localBalance();
  check('쿠폰 쓰기 누르기', await press(p, '.events-box', T.coupon));
  await until('쿠폰 반영', async () => (await localBalance()) === b2 + 20);
  check('쿠폰 20 코인', (await localBalance()) === b2 + 20);
  await p.shot('events-3-events', '.events-box');

  // 쪽지: 운영자가 기기 코드로 보낸다 → 맞추기 → 쪽지함 (운영자 표) → 열면 코인
  const nmsg = await adminPost('/admin/notes', { account: code, coins: 15, chat_passes: 0, message: LANG === 'ko' ? '고마워, 운영자가' : 'Thanks, from the operator', days: 30 });
  check('쪽지 보내기', /쪽지 #\d+/.test(nmsg), nmsg);
  const b3 = await localBalance();
  await syncNow();
  await until('쪽지 받음', async () => (await main('__jj.serverInbox.items.length')) > 0);
  check('보낼 때는 잔액이 그대로', (await localBalance()) === b3);
  await main(`__jj.panel.openTab ? __jj.panel.openTab('today') : __jj.panel.togglePanel(); 1`);
  const panel = await page('panel');
  await until('쪽지함 운영자 표', () => panel.ev(`!!document.querySelector('.note-from')`), 15_000).catch(() => false);
  check('패널 쪽지함에 운영자 쪽지 (출처 표)', (await panel.ev(`document.querySelector('.note-from')?.textContent ?? ''`)) === T.from);
  await panel.shot('events-4-notebox', '.note-box');
  const key = await main('__jj.serverInbox.views()[0].day');
  await main(`__jj.serverInbox.open(${JSON.stringify(key)}).then(() => 1)`);
  await until('쪽지 코인', async () => (await localBalance()) === b3 + 15);
  check('쪽지를 열면 코인 15', (await localBalance()) === b3 + 15);
  check('서버에도 열림 기록', sql(`SELECT opened_coins FROM inbox WHERE opened_at IS NOT NULL ORDER BY id DESC LIMIT 1`) === '15');
  const pet = await page('pet');
  await pet.shot('events-5-pet-note');
  pet.close();
  panel.close();

  // 운영자 계정: DB 에 운영자 sub 로그인과 세션을 만들고 앱에 넣는다 → 운영자 칸이 보인다
  const id = sql('SELECT id FROM account ORDER BY id DESC LIMIT 1');
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', '${ADMIN_SUB}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  check('세션 넣기', (await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`)) === true);
  await until('운영자', async () => (await status()).admin === true);
  await until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 20_000);
  check('운영자 칸이 보인다', (await p.ev(`document.querySelector('.admin-box') !== null`)) === true);
  check('운영자 칸에 세션 토큰이 없다', (await p.ev(`document.body.innerHTML.includes(${JSON.stringify(session)})`)) === false);
  await p.shot('events-6-admin', '.admin-box');

  // 채팅 창을 연 채 나이를 14~17 로 바꾸면 채팅 이용권 항목이 목록에서 사라진다 (QA, #101)
  await until('채팅 이용권 열림', async () => (await status()).ai === true, 20_000);
  await main(`__jj.chat.open(__jj.pet.bounds()); 1`);
  const c = await page('chat');
  await until('채팅 화면', () => c.ev(`!!document.querySelector('.picker-button')`));
  const menuHas = async () => {
    await c.ev(`(() => { if (!document.querySelector('.picker-menu')) document.querySelector('.picker-button').click(); })()`);
    await sleep(200);
    const has = await c.ev(`[...document.querySelectorAll('.picker-menu .name')].some((x) => x.textContent === ${JSON.stringify(T.ticket)})`);
    await c.ev(`document.querySelector('.picker-button').click()`);
    return has;
  };
  check('채팅 이용권 항목이 목록에 있다 (운영자 계정, 허용)', await menuHas());
  await c.ev(`window.jjakkungChat.setProvider('fairy-ticket'); 1`);
  await main(`__jj.server.core.setAge('teen'); 1`);
  await until('항목 사라짐', async () => !(await menuHas()), 15_000).catch(() => false);
  check('14~17 로 바꾸면 열린 채팅 창 목록에서도 사라진다', !(await menuHas()));
  check('골라 둔 것은 내 컴퓨터 AI 로 돌아간다', (await main(`__jj.chat.debugState.provider`)) !== 'fairy-ticket');
  c.close();

  // 공지: 웹에서 고친 공지가 정적 파일로 → 앱 공지 창
  const nid = `n-${randomBytes(3).toString('hex')}`;
  const ntext = await adminPost('/admin/notices', {
    id: nid,
    kind: 'info',
    title_ko: '운영자 화면에서 쓴 공지',
    title_en: 'Notice from the operator screen',
    body_ko: '이 공지는 운영자 화면에서 고쳐 홈페이지 파일로 나갔어.',
    body_en: 'This notice was edited on the operator screen and shipped as a site file.',
  });
  check('웹에서 공지 저장', ntext.includes(nid), ntext);
  const out = pullFeeds();
  check('공지가 정적 파일로', out.includes('notices.json') && readFileSync(join(site, 'notices.json'), 'utf8').includes(nid));
  await main('__jj.notices.debugForget(); __jj.notices.refresh().then(() => 1)');
  const np = await page('notice');
  await until('공지 창', () => np.ev(`!!document.querySelector('h1')`), 20_000);
  check('앱 공지 창에 뜬다', (await np.ev(`document.querySelector('h1')?.textContent ?? ''`)) === (LANG === 'ko' ? '운영자 화면에서 쓴 공지' : 'Notice from the operator screen'));
  await np.shot('events-7-notice');
  np.close();
  check('운영 기록이 남는다', Number(sql(`SELECT count(*) FROM admin_log WHERE action IN ('event.create','coupon.create','note.send','notice.create')`)) >= 4);
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
stat.close();
dropPg();
if (failed || results.some((r) => !r.ok)) {
  try {
    const lines = readFileSync(join(data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => /server|inbox|events|notice/.test(l)).slice(-30).join('\n')}`);
  } catch {}
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
