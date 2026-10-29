// 관리자 정보 구조 재편 시험 (이슈 #150): 웹 /admin 의 다섯 칸과 주소 해시, 발행과 지급의 공통 흐름, 결과 알림 자리, 밝은 어두운 모드,
// 앱 운영자 칸의 요약과 불러오기 상태, "웹에서 열기"를 PASS/FAIL 로 본다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/admin-ia.mjs
//
// 웹은 헤드리스 Chrome(CDP, 창 없음)으로 폭 1280 과 360, 밝은 어두운 모두. 앱은 시험 앱(JJ_NO_FOCUS=1, 빈 JJ_USER_DATA, 보이지 않는 창, 입력은 CDP 로만).
// 시험용 Postgres(jj-admin150-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다
// (Anthropic 은 주소를 닫힌 포트로 둔다). "웹에서 열기"는 JJ_TEST_BROWSER=fetch 라 브라우저를 띄우지 않고 메인이 주소를 따라간다.
//
// ONLY=web 또는 ONLY=app 으로 한쪽만. 비교 그림용으로 SERVER_ROOT, APP_ROOT 를 옛 판 폴더로 주고 TAG=before 로 돌리면 판정 없이
// 옛 화면(웹 개요 탭과 기능 스위치 탭, 앱 운영자 칸)의 그림만 찍는다. 웹 화면은 한국어만 있다 (LANG_UNDER_TEST 는 앱에만 쓴다).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const APP_ROOT = resolve(process.env.APP_ROOT ?? root);
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-ia-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const TAG = process.env.TAG === 'before' ? 'before' : 'after';
// 웹과 앱은 같은 자료(DB)를 쓰므로 따로 돌린다: ONLY=web 한 번, ONLY=app 한 번 (앱은 빈 자료에서 시작해야 빈 상태를 본다)
const ONLY = process.env.ONLY ?? 'web';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function pick() {
  for (let i = 0; i < 200; i++) {
    const port = 9800 + randomInt(200);
    const free = await new Promise((r) => {
      const s = createServer();
      s.once('error', () => r(false));
      s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) return port;
  }
  throw new Error('빈 포트 없음');
}
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pgName = `jj-admin150-pg-${randomBytes(4).toString('hex')}`;
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
execFileSync(process.execPath, [join(SERVER_ROOT, 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin150-'));
const site = join(scratch, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'events.json'), '{"version":1,"events":[]}\n');
writeFileSync(join(site, 'notices.json'), '{"version":1,"notices":[]}\n');
const staticPort = await freePort();
const stat = httpServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/latest') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: 'v0.9.0', html_url: 'https://github.com/milcho0604/fairy-releases/releases/v0.9.0', draft: false, prerelease: false }));
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => stat.listen(staticPort, '127.0.0.1', r));
const staticUrl = `http://127.0.0.1:${staticPort}`;

const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const ADMIN_SUB = `admin-sub-${randomBytes(4).toString('hex')}`;
let api;
async function startApi() {
  api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
    cwd: SERVER_ROOT,
    env: {
      PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, ADMIN_TOKEN, ADMIN_GOOGLE_SUBS: ADMIN_SUB,
      RELEASES_API: `${staticUrl}/latest`, ANTHROPIC_API_KEY: 'fake-key-for-ia-test', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      BACKUP_ENC_KEY: randomBytes(32).toString('hex'), BACKUP_DIR: join(scratch, 'backups'), BACKUP_TOTAL_MAX_GB: '0.001',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('서버가 안 떴다');
}
await startApi();

/** 운영자 웹 화면 흉내 (노드 쪽): 쿠키, CSRF, 같은 출처 */
const web = { cookie: '', csrf: '' };
async function adminPage(path = '') {
  const r = await fetch(`${apiUrl}/admin${path}`, { headers: { cookie: web.cookie } });
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
  return /<p class="flash( error)?( wide)?" role="(?:status|alert)"(?: id="form-(?:error|ok)")?>([^<]*)<\/p>/.exec(page)?.[3] ?? `HTTP ${r.status}`;
}
const kstInput = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);

const results = [];
function check(name, ok, extra = '') {
  if (TAG === 'before') return;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !extra ? '' : ` (${extra})`}`);
}
async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error(`기다림 끝: ${what}`);
}

// ---- CDP ----
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method) for (const l of listeners) l(m);
  });
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
  const once = (name, ms = 20_000) =>
    new Promise((r, j) => {
      const timer = setTimeout(() => j(new Error(`사건 없음: ${name}`)), ms);
      const l = (m) => {
        if (m.method === name) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(l), 1);
          r(m.params);
        }
      };
      listeners.push(l);
    });
  const on = (cb) => listeners.push(cb);
  return { ws, send, once, on };
}
const evalOn = (c) => async (expr) => {
  const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
};
const savePng = (name, data) => writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));

let failed = false;
let chrome;
let app;
let appExited = true;
let mainConn;
const pageErrors = [];

// =========================== 웹 ===========================
const CELLS = ['home', 'users', 'reports', 'announce', 'settings'];
/** [칸/하위 자리, 그 자리에서만 보여야 하는 선택자들] */
const PLACES = [
  ['home', ['#cell-home dl.stats']],
  ['users', ['table.users', 'form[action="/admin#users/list"]']],
  ['users/grants', ['form[action="/admin/grants/preview"]']],
  ['reports', ['#reports-list']],
  ['announce', ['.posts-find', 'form[action="/admin/rewards/policy"]']],
  ['announce/new', ['form[action="/admin/notices/preview"]']],
  ['settings', ['form[action="/admin/features/mode"]', 'form[action="/admin/ai/mode"]', 'form[action="/admin/features/allow"]']],
  ['settings/ai', ['form[action="/admin/ai/limits"]', 'form[action="/admin/ai/policy"]']],
  ['settings/log', ['table.log:not(#cell-home table)', 'form[action="/admin#settings/log"]']],
];

/** 지급 확정 폼: 확인 칸을 체크하고, 받는 사람 수를 숫자로 다시 적는다 */
const sureGrant = `(() => { const f = document.querySelector('form[action="/admin/grants/batch"]'); f.querySelector('input[type=checkbox]').checked = true; const p = f.querySelector('input[name=people]'); if (p) p.value = p.getAttribute('pattern'); return true; })()`;

/** 미리보기를 거치는 만들기 (이벤트, 쿠폰): 미리보기 뒤 확정 폼의 숨은 칸에 작성 값을 덮어 보낸다 */
async function adminConfirm(path, fields) {
  const first = await adminPost(`${path}/preview`, fields);
  const page = await adminPage();
  const m = new RegExp(`<form method="post" action="${path}"[^>]*>([\\s\\S]*?)</form>`).exec(page);
  if (!m) return first;
  const hidden = {};
  for (const x of m[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) if (x[1] !== 'csrf') hidden[x[1]] = x[2].replaceAll('&#10;', '\n');
  return adminPost(path, { ...hidden, ...fields, flow: hidden.flow ?? '' });
}

async function webPart() {
  const chromePort = await pick();
  const profile = join(scratch, 'chrome');
  mkdirSync(profile, { recursive: true });
  chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-features=MacAppCodeSignClone', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  );
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json()).find((x) => x.type === 'page');
    } catch {}
    if (!target) await sleep(250);
  }
  const c = await connect(target.webSocketDebuggerUrl);
  const ev = evalOn(c);
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !String(m.params.entry.url ?? '').includes('favicon')) pageErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const size = (width, height = 860) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const scheme = (dark) => c.send('Emulation.setEmulatedMedia', { features: dark ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [] });
  /** 같은 문서 안의 해시 이동은 load 사건이 없다: 빈 화면을 거쳐 늘 새로 연다 */
  const nav = async (url) => {
    const blank = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: 'about:blank' });
    await blank;
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url });
    await loaded;
    await sleep(150);
  };
  const shot = async (name, clip) => {
    await sleep(150);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}) });
    savePng(name, r.result.data);
  };
  /** 선택자 하나의 영역(문서 좌표)을 그림으로 */
  const shotEl = async (name, selector, pad = 8, maxH = 1500) => {
    const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y + scrollY - ${pad}), width: document.documentElement.clientWidth, height: Math.min(r.height + ${pad * 2}, ${maxH}) }; })()`);
    await shot(name, box ?? undefined);
  };
  const fill = (formSel, values) =>
    ev(`(() => { const f = document.querySelector(${JSON.stringify(formSel)}); if (!f) return false; for (const [k, v] of Object.entries(${JSON.stringify(values)})) { const els = [...f.elements].filter((e) => e.name === k); for (const el of els) { if (el.type === 'checkbox') el.checked = [].concat(v).includes(el.value); else el.value = v; } } return true; })()`);
  const submit = (formSel) => ev(`document.querySelector(${JSON.stringify(formSel)}).requestSubmit(); true`);
  const submitAndWait = async (formSel) => {
    const loaded = c.once('Page.loadEventFired');
    await submit(formSel);
    await loaded;
    await sleep(250);
  };
  const clickAndWait = async (selector) => {
    const loaded = c.once('Page.loadEventFired');
    await ev(`document.querySelector(${JSON.stringify(selector)}).requestSubmit ? document.querySelector(${JSON.stringify(selector)}).requestSubmit() : document.querySelector(${JSON.stringify(selector)}).click(); true`);
    await loaded;
    await sleep(250);
  };
  /** 지금 보이는 칸, 아래 칸, 주소 해시, 표시된 목록 */
  const where = () =>
    ev(`(() => {
      const shown = (el) => getComputedStyle(el).display !== 'none';
      return {
        hash: location.hash,
        cells: [...document.querySelectorAll('.panel')].filter(shown).map((x) => x.id.replace('cell-', '')),
        subs: [...document.querySelectorAll('.sub')].filter(shown).map((x) => x.id.replace('sub-', '')),
        navCurrent: [...document.querySelectorAll('nav.cells a[aria-current=page]')].map((x) => x.dataset.cell),
        subCurrent: [...document.querySelectorAll('.subnav a[aria-current=page]')].filter((x) => x.getClientRects().length).map((x) => x.dataset.sub),
        wide: document.documentElement.scrollWidth <= innerWidth,
      };
    })()`);
  /** 그 선택자의 첫 요소가 있고, 자신과 조상이 모두 보이는 상태인가 */
  const visible = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.getClientRects().length === 0) return false; for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false; return true; })()`);
  const nearViewport = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top) }; })()`);

  // ---- 옛 화면 그림만 (비교용) ----
  if (TAG === 'before') {
    await size(1280, 900);
    await nav(`${apiUrl}/admin`);
    await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
    await submitAndWait('form[action="/admin/login"]');
    await adminPost('/admin/login', { token: ADMIN_TOKEN });
    sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '고양이', 'F-ABCD-0001'), ('18+', '강아지', 'F-ABCD-0002')`);
    await adminPost('/admin/events', { id: 'cmp-live', kind: 'gift', title_ko: '가을 선물', title_en: 'Autumn gift', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 2 * 86_400_000), coins: 30 });
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin`);
      await shot(`web-before-home-${w}`);
      await nav(`${apiUrl}/admin/features`);
      await shot(`web-before-features-${w}`);
    }
    return;
  }

  // ---- 로그인과 자료 ----
  await size(1280);
  await nav(`${apiUrl}/admin`);
  check('로그인 전에는 운영 내용이 없다', (await ev(`!document.querySelector('.panel') && !!document.querySelector('input[name=token]')`)) === true);
  await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
  await submitAndWait('form[action="/admin/login"]');
  await adminPost('/admin/login', { token: ADMIN_TOKEN });
  sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '고양이', 'F-ABCD-0001'), ('18+', '강아지', 'F-ABCD-0002'), ('14+', '열넷이', 'F-ABCD-0003')`);
  sql(`INSERT INTO login (service, sub, account_id) SELECT 'google', 'ia-sub-1', id FROM account WHERE code = 'F-ABCD-0001'`);
  await nav(`${apiUrl}/admin`);

  // ---- 1. 다섯 칸과 왼쪽 목록 ----
  const navInfo = await ev(`(() => { const n = document.querySelector('nav.cells'); const m = document.querySelector('main'); const r = n.getBoundingClientRect(); const mr = m.getBoundingClientRect(); return { links: [...n.querySelectorAll('a')].map((a) => a.textContent), pos: getComputedStyle(n).position, left: r.left, right: r.right, mainLeft: mr.left, width: Math.round(r.width) }; })()`);
  check('왼쪽 목록에 다섯 칸 (홈, 이용자, 신고, 알리기, 설정)', JSON.stringify(navInfo.links) === JSON.stringify(['홈', '이용자', '신고', '알리기', '설정']), JSON.stringify(navInfo.links));
  check('[1280] 목록이 본문 왼쪽에 서 있다', navInfo.right <= navInfo.mainLeft + 1 && navInfo.pos === 'sticky', JSON.stringify(navInfo));
  const first = await where();
  check('주소에 해시가 없으면 홈', first.cells.join() === 'home' && first.navCurrent.join() === 'home', JSON.stringify(first));

  // ---- 2. 자리마다 보이는 것은 그곳뿐 (옛 여덟 탭의 기능이 한 군데도 안 빠졌다) ----
  const canon = (p) => ({ users: 'users/list', announce: 'announce/posts', settings: 'settings/features' })[p] ?? p;
  for (const [place, selectors] of PLACES) {
    const [cell, sub] = place.split('/');
    await nav(`${apiUrl}/admin#${place}`);
    const w = await where();
    const subOk = sub ? w.subs.join() === `${cell}-${sub}` : w.subs.length <= 1;
    check(`#${place}: 그 칸만 보이고 현재 표시가 맞다`, w.cells.join() === cell && w.navCurrent.join() === cell && subOk && (!sub || w.subCurrent.join() === place), JSON.stringify(w));
    for (const sel of selectors) check(`#${place}: ${sel} 이 보인다`, (await visible(sel)) === true);
    const hiddenSels = PLACES.filter(([p]) => canon(p) !== canon(place)).flatMap(([, sels]) => sels).filter((x) => !selectors.includes(x));
    const stillShown = [];
    for (const sel of hiddenSels) if (await visible(sel)) stillShown.push(sel);
    check(`#${place}: 다른 자리의 것은 모두 숨겨져 있다 (${hiddenSels.length}개)`, stillShown.length === 0, stillShown.join(' '));
  }
  // 아래 칸이 있는 칸을 칸 이름만으로 열면 첫 하위
  await nav(`${apiUrl}/admin#settings`);
  const settingsFirst = await where();
  check('#settings 만 적으면 첫 하위(기능 스위치)', settingsFirst.subs.join() === 'settings-features' && settingsFirst.subCurrent.join() === 'settings/features', JSON.stringify(settingsFirst));

  // ---- 3. 해시: 눌러서 이동, 새로고침, 뒤로 가기, 모르는 해시, 찾기 조건 ----
  await nav(`${apiUrl}/admin`);
  await ev(`document.querySelector('nav.cells a[data-cell=users]').click(); true`);
  await sleep(150);
  await ev(`document.querySelector('nav.cells a[data-cell=reports]').click(); true`);
  await sleep(150);
  await ev(`document.querySelector('nav.cells a[data-cell=settings]').click(); true`);
  await sleep(150);
  await ev(`document.querySelector('.subnav a[data-sub="settings/log"]').click(); true`);
  await sleep(150);
  const afterClicks = await where();
  check('칸 목록과 아래 칸 단추를 누르면 해시가 바뀌고 그 자리가 열린다', afterClicks.hash === '#settings/log' && afterClicks.subs.join() === 'settings-log', JSON.stringify(afterClicks));
  await c.send('Page.reload');
  await c.once('Page.loadEventFired');
  await sleep(200);
  const reloaded = await where();
  check('새로고침해도 같은 자리', reloaded.hash === '#settings/log' && reloaded.subs.join() === 'settings-log' && reloaded.navCurrent.join() === 'settings', JSON.stringify(reloaded));
  await ev(`history.back(); true`);
  await sleep(250);
  const back1 = await where();
  check('뒤로 가기: 직전 자리(설정)', back1.hash === '#settings' && back1.cells.join() === 'settings', JSON.stringify(back1));
  await ev(`history.back(); true`);
  await sleep(250);
  check('뒤로 가기 한 번 더: 신고', (await where()).cells.join() === 'reports');
  await ev(`history.forward(); true`);
  await sleep(250);
  check('앞으로 가기: 다시 설정', (await where()).cells.join() === 'settings');
  await nav(`${apiUrl}/admin#nope`);
  check('모르는 해시는 홈', (await where()).cells.join() === 'home');
  await nav(`${apiUrl}/admin#users/zzz`);
  const badSub = await where();
  check('모르는 아래 칸은 그 칸의 첫 하위', badSub.cells.join() === 'users' && badSub.subs.join() === 'users-list', JSON.stringify(badSub));
  await nav(`${apiUrl}/admin?q=F-ABCD`);
  check('해시 없이 ?q= 만 있으면 이용자 칸 (옛 주소)', (await where()).cells.join() === 'users');
  await nav(`${apiUrl}/admin?lu=1`);
  check('해시 없이 운영 기록 찾기 조건이면 설정의 운영 기록', (await where()).subs.join() === 'settings-log');
  // 옛 탭 주소는 새 자리로 (브라우저가 따라간다)
  await nav(`${apiUrl}/admin/features`);
  const legacy = await where();
  check('옛 주소 /admin/features 는 새 자리(설정, 기능 스위치)로 간다', legacy.hash === '#settings/features' && legacy.subs.join() === 'settings-features', JSON.stringify(legacy));
  await nav(`${apiUrl}/admin/log?user=1`);
  check('옛 주소 /admin/log?user= 도 찾기 조건과 함께', (await ev('location.search + location.hash')) === '?lu=1#settings/log');
  // 스크립트가 꺼져도 내용은 모두 있다 (모두 보인다)
  await c.send('Emulation.setScriptExecutionDisabled', { value: true });
  await nav(`${apiUrl}/admin#users`);
  const noJs = await ev(`[...document.querySelectorAll('.panel')].filter((x) => getComputedStyle(x).display !== 'none').length`);
  await c.send('Emulation.setScriptExecutionDisabled', { value: false });
  check('스크립트가 없으면 다섯 칸이 모두 보인다 (내용은 숨지 않는다)', noJs === 5, String(noJs));

  // ---- 4. 폭 360: 아래 바 ----
  await size(360, 780);
  await nav(`${apiUrl}/admin#users/grants`);
  const phone = await ev(`(() => { const n = document.querySelector('nav.cells'); const r = n.getBoundingClientRect(); const links = [...n.querySelectorAll('a')].map((a) => a.getBoundingClientRect()); const last = document.querySelector('#sub-users-grants section:last-child') ?? document.querySelector('main'); window.scrollTo(0, document.documentElement.scrollHeight); const lr = document.querySelector('main').getBoundingClientRect(); return { pos: getComputedStyle(n).position, bottom: Math.round(r.bottom), vh: innerHeight, dir: getComputedStyle(n).flexDirection, minLink: Math.round(Math.min(...links.map((x) => x.width))), minH: Math.round(Math.min(...links.map((x) => x.height))), mainBottom: Math.round(lr.bottom), navTop: Math.round(r.top) }; })()`);
  check('[360] 목록이 아래 바로 (화면 바닥에 붙고 가로로 늘어선다)', phone.pos === 'fixed' && Math.abs(phone.bottom - phone.vh) <= 1 && phone.dir === 'row', JSON.stringify(phone));
  check('[360] 아래 바 단추가 누르기 쉬운 크기 (너비 48 이상, 높이 40 이상)', phone.minLink >= 48 && phone.minH >= 40, JSON.stringify(phone));
  check('[360] 맨 아래까지 내려도 내용이 바에 가리지 않는다', phone.mainBottom <= phone.navTop + 1, JSON.stringify(phone));

  // ---- 5. 모든 자리가 두 폭, 두 모드에서 가로로 안 넘친다. 그림 ----
  const contrast = `(() => {
    const parse = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length === 3 || c[3] > 0.5)) return c; } return [255, 255, 255]; };
    const ratio = (sel) => { const el = document.querySelector(sel); if (!el) return null; const fg = parse(getComputedStyle(el).color); const a = lum(fg), b = lum(bgOf(el)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10; };
    return { body: ratio('main h1'), h2: ratio('.panel section h2'), hint: ratio('.hint'), nav: ratio('nav.cells a:not([aria-current])'), current: ratio('nav.cells a[aria-current]'), label: ratio('label'), bg: lum(bgOf(document.body)) };
  })()`;
  for (const dark of [false, true]) {
    await scheme(dark);
    for (const [w, h] of [[1280, 860], [360, 780]]) {
      await size(w, h);
      for (const [place] of PLACES) {
        await nav(`${apiUrl}/admin#${place}`);
        const st = await where();
        check(`[${w}] ${dark ? '어두움' : '밝음'} #${place}: 가로로 넘치지 않는다`, st.wide === true);
        if (['home', 'users', 'reports', 'announce', 'settings'].includes(place)) await shot(`ia-${dark ? 'dark' : 'light'}-${w}-${place}`);
      }
      if (w === 1280) {
        await nav(`${apiUrl}/admin#home`);
        const cr = await ev(contrast);
        const ok = cr.body >= 4.5 && cr.h2 >= 4.5 && cr.hint >= 4.5 && cr.nav >= 4.5 && cr.current >= 4 && cr.label >= 4.5;
        check(`[${dark ? '어두움' : '밝음'}] 글자 대비 (본문, 제목, 설명, 칸 목록, 현재 칸)`, ok && (dark ? cr.bg < 0.2 : cr.bg > 0.6), JSON.stringify(cr));
      }
    }
  }
  await scheme(false);

  // ---- 6. 신고 칸: 빈 상태와 건수, 홈의 할 일 ----
  await size(1280);
  await nav(`${apiUrl}/admin#reports`);
  check('신고 칸 빈 상태 안내', (await ev(`document.querySelector('#reports-list .empty')?.textContent ?? ''`)).includes('접수된 신고가 없어요'));
  await nav(`${apiUrl}/admin#home`);
  const todoEmpty = await ev(`document.querySelector('#cell-home section .empty')?.textContent ?? ''`);
  check('홈: 확인할 것이 없으면 빈 상태 글', todoEmpty.includes('지금 확인할 것이 없어요'), todoEmpty);
  sql(`INSERT INTO ai_report (account_id, question, answer) SELECT id, '비밀질문본문', '비밀답변본문' FROM account WHERE code = 'F-ABCD-0001'`);
  await adminConfirm('/admin/events', { id: 'ia-soon', kind: 'gift', title_ko: '곧 끝나는 선물', title_en: 'Ending soon', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 2 * 86_400_000), coins: 30 });
  await adminConfirm('/admin/coupons', { label: '곧 끝나는 쿠폰', coins: 5, tickets: 0, max_uses: 3, until: kstInput(Date.now() + 86_400_000) });
  await adminPost('/admin/notes', { account: 'F-ABCD-0001', coins: 3, chat_passes: 0, message: '기록 하나', days: 30 });
  await nav(`${apiUrl}/admin#home`);
  const todo = await ev(`[...document.querySelectorAll('#cell-home ul.todo li')].map((x) => ({ text: x.textContent, href: x.querySelector('a')?.getAttribute('href') }))`);
  check('홈 할 일 카드: 신고, 끝나는 이벤트, 끝나는 쿠폰이 각자 자리 링크와 함께', todo.some((x) => x.text.includes('신고가 1건') && x.href === '#reports') && todo.some((x) => x.text.includes('이벤트가 1개') && x.href === '#announce/posts') && todo.some((x) => x.text.includes('쿠폰이 1개') && x.href === '#announce/posts'), JSON.stringify(todo));
  await ev(`document.querySelector('#cell-home ul.todo a[href="#reports"]').click(); true`);
  await sleep(200);
  check('할 일 카드를 누르면 그 칸으로 간다', (await where()).cells.join() === 'reports');
  check('신고 칸에 건수, 대화 본문은 없다', (await ev(`document.querySelector('#reports-list').textContent`)).includes('전체 1') && (await ev(`document.documentElement.innerHTML.includes('비밀질문본문') || document.documentElement.innerHTML.includes('비밀답변본문')`)) === false);
  await shotEl('ia-home-todo-1280', '#cell-home');
  await nav(`${apiUrl}/admin#home`);
  await shotEl('ia-home-1280', '#cell-home', 8, 1100);

  // ---- 7. 지급 흐름: 작성, 대상 확인, 미리보기, 확정, 결과 확인 ----
  const grant = { accounts: 'F-ABCD-0001\nF-ABCD-0002', coins: '12', chat_passes: '2', days: '30', reason: '시험 지급' };
  for (const w of [1280, 360]) {
    await size(w, w === 360 ? 780 : 860);
    await nav(`${apiUrl}/admin#users/grants`);
    const step1 = await ev(`document.querySelector('#sub-users-grants li[aria-current=step]')?.textContent`);
    check(`[${w}] 지급 작성 화면은 1단계`, step1 === '1. 작성', step1);
    await fill('form[action="/admin/grants/preview"]', grant);
    await shotEl(`ia-flow-1-compose-${w}`, '#sub-users-grants');
    const notesBefore = sql(`SELECT count(*) FROM inbox`);
    await submitAndWait('form[action="/admin/grants/preview"]');
    const prev = await ev(`(() => { const s = document.querySelector('#sub-users-grants'); return { step: s.querySelector('li[aria-current=step]')?.textContent, rows: s.querySelectorAll('table.targets tbody tr').length, people: s.querySelector('dl.stats dd')?.textContent, btnDisabled: s.querySelector('form[action="/admin/grants/batch"] button[type=submit]').disabled, hash: location.hash, composeGone: !s.querySelector('form[action="/admin/grants/preview"]') }; })()`);
    check(`[${w}] 대상 확인: 3단계, 받는 사람 2명 표, 확정 단추 사용 가능, 칸 주소 유지`, prev.step === '3. 미리보기' && prev.rows === 2 && prev.people === '2명' && !prev.btnDisabled && prev.hash === '#users/grants' && prev.composeGone, JSON.stringify(prev));
    const cells = await ev(`[...document.querySelectorAll('#sub-users-grants table.targets tbody tr')].map((tr) => [...tr.children].map((td) => { const r = td.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: td.textContent.trim().slice(0, 20) }; }))`);
    check(`[${w}] 대상 확인 표: 대상 이름과 나이 칸이 화면 폭 안에 모두 보인다`, cells.length === 2 && cells.every((row) => row.every((c) => c.l >= 0 && c.r <= w)) && cells[0][1].t.includes('고양이'), JSON.stringify(cells));
    check(`[${w}] 대상 확인까지는 아무것도 보내지 않았다`, sql(`SELECT count(*) FROM inbox`) === notesBefore);
    await shotEl(`ia-flow-2-preview-${w}`, '#sub-users-grants');
    await c.send('Page.reload');
    await c.once('Page.loadEventFired');
    await sleep(200);
    check(`[${w}] 새로고침해도 미리보기가 남는다`, (await ev(`document.querySelector('#sub-users-grants li[aria-current=step]')?.textContent`)) === '3. 미리보기');
    // 고치기
    await submitAndWait('form[action="/admin/flow/cancel"]');
    const edited = await ev(`(() => { const f = document.querySelector('form[action="/admin/grants/preview"]'); return { accounts: f.elements.accounts.value, coins: f.elements.coins.value, reason: f.elements.reason.value, step: document.querySelector('#sub-users-grants li[aria-current=step]')?.textContent, err: !!document.querySelector('#sub-users-grants [role=alert]') }; })()`);
    check(`[${w}] 고치기: 쓰던 값이 그대로 돌아오고 오류 표시는 없다`, edited.accounts === grant.accounts && edited.coins === '12' && edited.reason === '시험 지급' && edited.step === '1. 작성' && !edited.err, JSON.stringify(edited));
    await submitAndWait('form[action="/admin/grants/preview"]');
    // 확인 칸 없이 확정하면 브라우저가 막는다
    const logBefore = sql(`SELECT count(*) FROM admin_log`);
    await ev(`document.querySelector('form[action="/admin/grants/batch"]').requestSubmit(); true`);
    await sleep(500);
    check(`[${w}] 확인 칸을 체크하지 않으면 확정되지 않는다`, sql(`SELECT count(*) FROM admin_log`) === logBefore && sql(`SELECT count(*) FROM inbox`) === notesBefore);
    await ev(sureGrant);
    // 눌린 자리 가까이 진행 표시: 제출 사건이 일어난 직후 단추 옆에 상태 글이 생긴다
    await ev(`window.__stop = (e) => e.preventDefault(); document.addEventListener('submit', window.__stop); true`);
    await submit('form[action="/admin/grants/batch"]');
    await sleep(250);
    const loading = await ev(`(() => { const f = document.querySelector('form[action="/admin/grants/batch"]'); const b = f.querySelector('button[type=submit]'); const w = f.querySelector('small.working'); return { text: b.textContent, disabled: b.disabled, note: w?.textContent ?? '', role: w?.getAttribute('role'), next: b.nextElementSibling === w }; })()`);
    await shotEl(`ia-flow-3-working-${w}`, 'form[action="/admin/grants/batch"]', 40);
    check(`[${w}] 확정을 누르면 그 단추가 막히고 바로 옆에 "처리하고 있어요"`, loading.text === '처리 중' && loading.disabled && loading.note === '처리하고 있어요' && loading.role === 'status' && loading.next, JSON.stringify(loading));
    await ev(`document.removeEventListener('submit', window.__stop); true`);
    await c.send('Page.reload');
    await c.once('Page.loadEventFired');
    await sleep(200);
    await ev(sureGrant);
    await submitAndWait('form[action="/admin/grants/batch"]');
    const res = await ev(`(() => { const s = document.querySelector('#sub-users-grants'); const ok = document.getElementById('form-ok'); const r = ok?.getBoundingClientRect(); return { step: s.querySelector('li[aria-current=step]')?.textContent, text: ok?.textContent ?? '', inSub: !!ok && s.contains(ok), inView: !!r && r.top >= 0 && r.bottom <= innerHeight, link: s.querySelector('.flow-result a')?.getAttribute('href'), topFlash: !!document.querySelector('main > p.flash'), count: document.querySelectorAll('#form-ok').length, hash: location.hash }; })()`);
    check(`[${w}] 결과 확인: 5단계, 성공 글이 폼 자리에서 보이고 한 번만 나온다`, res.step === '5. 결과 확인' && res.text.includes('2명에게 지급 쪽지') && res.inSub && res.inView && !res.topFlash && res.count === 1 && res.hash === '#users/grants', JSON.stringify(res));
    check(`[${w}] 결과 확인에 운영 기록 링크`, res.link === '/admin?la=grant.batch#settings/log', String(res.link));
    check(`[${w}] 서버에 쪽지 둘과 운영 기록이 남았다`, Number(sql(`SELECT count(*) FROM inbox`)) - Number(notesBefore) === 2 && sql(`SELECT count(*) FROM admin_log WHERE action = 'grant.batch'`) === String(w === 1280 ? 1 : 2));
    await shotEl(`ia-flow-4-result-${w}`, '#sub-users-grants');
  }
  // 미리보기가 떠 있을 때 다른 이용자의 지급 링크: 이어서, 버리고 새로
  await nav(`${apiUrl}/admin#users/grants`);
  await fill('form[action="/admin/grants/preview"]', { ...grant, accounts: 'F-ABCD-0001' });
  await submitAndWait('form[action="/admin/grants/preview"]');
  await nav(`${apiUrl}/admin?account=F-ABCD-0002#users/grants`);
  const askOther = await ev(`document.querySelector('#sub-users-grants .flash.warn')?.textContent ?? ''`);
  check('미리보기 중 다른 대상으로 오면 "이어서 / 버리고 F-ABCD-0002 로" 안내', askOther.includes('쓰던 지급이 있어요') && askOther.includes('버리고 F-ABCD-0002 로'), askOther);
  await clickAndWait('#sub-users-grants form[action="/admin/flow/cancel"]');
  const swapped = await ev(`({ val: document.querySelector('form[action="/admin/grants/preview"] textarea[name=accounts]')?.value, warn: !!document.querySelector('#sub-users-grants .flash.warn') })`);
  check('버리고 새로: 작성 칸에 새 대상, 안내와 옛 미리보기는 없다', swapped.val === 'F-ABCD-0002' && !swapped.warn, JSON.stringify(swapped));
  // 같은 미리보기를 두 탭에서 확정: 한 번만 지급
  await nav(`${apiUrl}/admin#users/grants`);
  await fill('form[action="/admin/grants/preview"]', { ...grant, accounts: 'F-ABCD-0003', chat_passes: '0' });
  await submitAndWait('form[action="/admin/grants/preview"]');
  const staleForm = await ev(`new URLSearchParams(new FormData(document.querySelector('form[action="/admin/grants/batch"]'))).toString() + '&confirm=yes'`);
  const inboxBefore = sql(`SELECT count(*) FROM inbox`);
  await ev(sureGrant);
  await submitAndWait('form[action="/admin/grants/batch"]');
  // 뒤로 가기로 되돌아온 옛 확정 폼을 그대로 다시 보낸다 (CSP 가 fetch 를 막으니 폼으로)
  await ev(`(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/admin/grants/batch'; for (const [k, v] of new URLSearchParams(${JSON.stringify(staleForm)})) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.append(i); } document.body.append(f); window.__replay = f; return true; })()`);
  await submitAndWait('form[action="/admin/grants/batch"]:last-of-type');
  const twice = await ev(`document.querySelector('#sub-users-grants #form-error')?.textContent ?? ''`);
  check('같은 미리보기의 두 번째 확정(두 탭, 뒤로 가기)은 지급하지 않고 폼 근처에 안내', Number(sql(`SELECT count(*) FROM inbox`)) - Number(inboxBefore) === 1 && twice.includes('이미 확정했거나'), twice);
  // 막힘: 찾지 못한 계정
  await size(1280);
  await nav(`${apiUrl}/admin#users/grants`);
  await fill('form[action="/admin/grants/preview"]', { ...grant, accounts: 'F-ABCD-0001\nF-NOPE-9999' });
  await submitAndWait('form[action="/admin/grants/preview"]');
  const blocked = await ev(`(() => { const s = document.querySelector('#sub-users-grants'); return { disabled: s.querySelector('form[action="/admin/grants/batch"] button[type=submit]').disabled, text: s.querySelector('[role=alert]')?.textContent ?? '', miss: s.querySelectorAll('table.targets tr.bad').length }; })()`);
  await shotEl('ia-flow-5-blocked-1280', '#sub-users-grants');
  check('찾지 못한 계정이 있으면 확정 단추가 막힌다', blocked.disabled && blocked.miss === 1 && blocked.text.includes('찾지 못한 계정'), JSON.stringify(blocked));
  await submitAndWait('form[action="/admin/flow/cancel"]');

  // 운영자 세션 요청 상한(분당 120)을 넘지 않게 한 번 쉰다
  await sleep(61_000);
  // ---- 8. 공지 흐름 + 오류와 성공이 누른 자리 가까이 ----
  const notice = { id: 'ia-notice', kind: 'important', title_ko: '점검 안내', title_en: 'Maintenance', body_ko: '내일 새벽 점검이 있어요', body_en: 'Maintenance tomorrow' };
  await nav(`${apiUrl}/admin#announce/new`);
  await fill('form[action="/admin/notices/preview"]', notice);
  await submitAndWait('form[action="/admin/notices/preview"]');
  const np = await ev(`(() => { const s = document.querySelector('#sub-announce-new'); return { step: s.querySelector('li[aria-current=step]')?.textContent, previews: s.querySelectorAll('.preview').length, same: s.textContent.includes('없음 (새로 넣어요)'), hash: location.hash }; })()`);
  await shotEl('ia-flow-6-notice-preview-1280', '#sub-announce-new');
  check('공지 미리보기: 3단계, 공지 창 모양 ko와 en 둘, 같은 id 없음, 만들기 자리 유지', np.step === '3. 미리보기' && np.previews === 2 && np.same && np.hash === '#announce/new', JSON.stringify(np));
  check('공지 미리보기까지는 저장하지 않았다', sql(`SELECT count(*) FROM site_doc WHERE name = 'notices' AND body::text LIKE '%ia-notice%'`) === '0');
  await submitAndWait('form[action="/admin/notices"]');
  const nr = await ev(`(() => { const s = document.querySelector('#sub-announce-new'); const ok = s.querySelector('#form-ok'); const r = ok?.getBoundingClientRect(); return { step: s.querySelector('li[aria-current=step]')?.textContent, text: ok?.textContent ?? '', inView: !!r && r.top >= 0 && r.bottom <= innerHeight }; })()`);
  check('공지 확정: 결과 확인 5단계와 성공 글이 폼 자리에서 보인다', nr.step === '5. 결과 확인' && nr.text.includes('ia-notice') && nr.inView, JSON.stringify(nr));
  check('공지가 서버에 저장됐다', sql(`SELECT body::text FROM site_doc WHERE name = 'notices'`).includes('ia-notice'));
  // 지우기: 게시물 목록의 지우기. 폼이 사라져도 성공 글이 그 칸에서 보인다
  await nav(`${apiUrl}/admin#announce/posts`);
  await ev(`(() => { const f = document.querySelector('form.sure input[name=id][value="ia-notice"]').form; f.querySelector('input[type=checkbox]').checked = true; return true; })()`);
  await submitAndWait('form.sure:has(input[name=id][value="ia-notice"])');
  const del = await ev(`(() => { const ok = document.getElementById('form-ok'); const r = ok?.getBoundingClientRect(); return { text: ok?.textContent ?? '', inCell: !!ok && document.getElementById('cell-announce').contains(ok), inView: !!r && r.top >= 0 && r.bottom <= innerHeight, hash: location.hash }; })()`);
  check('공지 지우기: 폼이 사라져도 성공 글이 같은 칸에서 보인다', del.text.includes('지웠어요') && del.inCell && del.inView && del.hash === '#announce/posts', JSON.stringify(del));
  // 오류가 누른 폼 안에 (쿠폰 상한 0): 미리보기 단계에서 거절된다
  await size(360, 780);
  await nav(`${apiUrl}/admin#announce/new`);
  await ev(`document.getElementById('mk-coupons').click(); true`);
  await fill('form[action="/admin/coupons/preview"]', { label: '오류 시험', coins: '0', tickets: '0', max_uses: '5', until: kstInput(Date.now() + 86_400_000) });
  await submitAndWait('form[action="/admin/coupons/preview"]');
  const errNear = await ev(`(() => { const f = document.querySelector('form[action="/admin/coupons/preview"]'); const e = f.querySelector('#form-error'); const r = e?.getBoundingClientRect(); return { inForm: !!e, text: e?.textContent ?? '', inView: !!r && r.top >= 0 && r.bottom <= innerHeight, label: f.elements.label.value }; })()`);
  await shotEl('ia-error-near-360', 'form[action="/admin/coupons/preview"]', 30);
  check('[360] 오류가 누른 폼 안에 있고 화면에 보이며 쓴 값은 그대로', errNear.inForm && errNear.inView && errNear.label === '오류 시험', JSON.stringify(errNear));
  // 성공도 누른 폼 안 (쿠폰 정책 저장, 게시물 자리)
  await size(1280);
  await nav(`${apiUrl}/admin#announce/posts`);
  await fill('form[action="/admin/rewards/policy"]', { login_only: '0' });
  await submitAndWait('form[action="/admin/rewards/policy"]');
  const okNear = await ev(`(() => { const f = document.querySelector('form[action="/admin/rewards/policy"]'); const e = f.querySelector('#form-ok'); const r = e?.getBoundingClientRect(); return { inForm: !!e, inView: !!r && r.top >= 0 && r.bottom <= innerHeight, top: !!document.querySelector('main > p.flash') }; })()`);
  check('성공 글이 누른 폼 안에서 보이고 맨 위에는 따로 없다', okNear.inForm && okNear.inView && !okNear.top, JSON.stringify(okNear));

  // ---- 9. 이용자 칸: 표의 지급 단추는 지급 자리로 (대상이 채워진다) ----
  await nav(`${apiUrl}/admin#users`);
  const payLink = await ev(`document.querySelector('table.users a.button-link[href*="users/grants"]')?.getAttribute('href') ?? ''`);
  await nav(`${apiUrl}${payLink}`);
  const prefilled = await ev(`({ place: location.hash, cells: [...document.querySelectorAll('.panel')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.id), value: document.querySelector('form[action="/admin/grants/preview"] textarea[name=accounts]').value })`);
  check('이용자 표의 지급 단추: 지급 자리가 열리고 대상 계정(계정 번호)이 채워진다', prefilled.place === '#users/grants' && /^\d+$/.test(prefilled.value) && payLink.includes(`account=${prefilled.value}`), JSON.stringify(prefilled));

  // ---- 10. 스크립트 오류 없음 ----
  check('화면 스크립트 오류와 콘솔 오류가 없다', pageErrors.length === 0, pageErrors.join(' | '));
}

// =========================== 앱 ===========================
async function appPart() {
  const { dicts } = await import(join(root, 'src', 'shared', 'i18n', 'index.ts'));
  const D = dicts[LANG];
  const tx = (key, vars) => (typeof D[key] === 'function' ? D[key](vars) : D[key]);
  const INSPECT = await pick();
  const PAGE = await pick();
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const electronPath = (await import('electron')).default;
  app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: APP_ROOT,
    env: {
      HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_SERVER_URL_OVERRIDE: apiUrl,
      JJ_EVENTS_URL: `${staticUrl}/events.json`, JJ_NOTICES_URL: `${staticUrl}/notices.json`, JJ_RELEASES_API: `${staticUrl}/latest`, JJ_TEST_SECRETS: 'memory',
      JJ_TEST_BROWSER: 'fetch',
    },
    stdio: 'ignore',
  });
  appExited = false;
  app.on('exit', () => {
    appExited = true;
  });
  console.log('app pid', app.pid, 'server', apiPort, 'pg', pgName, 'lang', LANG, 'tag', TAG);

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
    return evalOn(mainConn)(expr);
  }
  async function page(name) {
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
        const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
        if (p) {
          const c = await connect(p.webSocketDebuggerUrl);
          const ev = evalOn(c);
          await c.send('Page.enable');
          return {
            ev,
            send: c.send,
            once: c.once,
            shot: async (file, selector, maxH = 1800) => {
              const box = selector
                ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y + scrollY - 8), width: document.documentElement.clientWidth, height: Math.min(r.height + 16, ${maxH}) }; })()`)
                : null;
              await sleep(250);
              const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 1 }, captureBeyondViewport: true } : {}) });
              savePng(`${file}-${LANG}`, r.result.data);
            },
            close: () => c.ws.close(),
          };
        }
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${name}`);
  }
  const press = (p, scope, text) =>
    p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  const typeInto = (p, selector, value) =>
    p.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const reload = async (p) => {
    const loaded = p.once('Page.loadEventFired');
    await p.send('Page.reload');
    await loaded;
    await sleep(300);
  };
  const box = (p) =>
    p.ev(`(() => { const b = document.querySelector('.admin-box'); if (!b) return null; return { text: b.innerText, buttons: [...b.querySelectorAll('button')].map((x) => ({ t: x.textContent.trim(), disabled: x.disabled })), inputs: b.querySelectorAll('input, select, textarea').length, alerts: [...b.querySelectorAll('[role=alert]')].map((x) => x.textContent.trim()), statuses: [...b.querySelectorAll('[role=status]')].map((x) => x.textContent.trim()), todo: [...b.querySelectorAll('.admin-group:nth-of-type(1) li')].map((x) => x.innerText.trim()), height: b.getBoundingClientRect().height }; })()`);

  await until('__jj', async () => {
    try {
      return (await main('typeof __jj === "object"')) === true;
    } catch {
      return false;
    }
  }, 60_000);
  await main("__jj.settingsWindow.open('restore')");
  const p = await page('settings');
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  const adultLabel = LANG === 'ko' ? '만 18세 이상' : '18 or older';
  const startLabel = LANG === 'ko' ? '서버 계정 시작' : 'Start server account';
  const NICK = LANG === 'ko' ? '운영고양이' : 'OpCat';
  await press(p, '.server-box', adultLabel);
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`));
  await typeInto(p, '.server-nickname-step input', NICK);
  await press(p, '.server-box', startLabel);
  await until('기기 계정', async () => {
    const s = JSON.parse(await main('JSON.stringify(__jj.server.core.status())'));
    return s.device && s.code && !s.syncing;
  });
  const id = sql('SELECT id FROM account ORDER BY id DESC LIMIT 1');
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', '${ADMIN_SUB}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`);
  await until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box')`), 30_000);

  if (TAG === 'before') {
    await until('옛 운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 30_000);
    await sleep(500);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await p.shot('app-before-admin', '.admin-box', 2800);
  } else {
    await until('요약', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 30_000);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);

    // ---- 1. 처음 요약: 빈 상태 (확인할 것 없음, 기록 없음) ----
    let b = await box(p);
    await p.shot('app-ia-1-empty', '.admin-box');
    check('요약에 계정, 코인, 비용 한 줄과 확인할 것, 신고 대기 개수', b.text.includes('$90.00') && b.text.includes(tx('admin.counts', { todo: 0, reports: 0 })), b.text);
    check('확인할 것이 없으면 빈 상태 글, 기록이 없어도 빈 상태 글', b.text.includes(tx('admin.todo.none')) && b.text.includes(tx('admin.recent.empty')), b.text);
    check('앱 운영자 칸에는 입력이 하나도 없다 (28개 → 0개)', b.inputs === 0, String(b.inputs));
    check('단추는 새로 보기와 웹에서 열기 둘뿐', JSON.stringify(b.buttons.map((x) => x.t)) === JSON.stringify([tx('admin.refresh'), tx('admin.web.open')]), JSON.stringify(b.buttons));
    check('칸 높이가 크게 줄었다 (2543px → 600px 아래)', b.height < 600, String(b.height));
    // #152: 오늘 숫자 한 줄, 백업 줄(이 서버는 백업 키가 없어 꺼짐), 기준이 없으니 잠기는 줄은 없다
    check('요약에 오늘 숫자 한 줄과 서버 백업 없음 줄이 있고 잠기는 줄은 없다 (#152)', b.text.includes(tx('admin.today', { signups: 0, active: 0, asks: 0, cost: '$0.00' }).split('0')[0]) && b.text.includes(tx('admin.backup.none')) && !b.text.includes(tx('admin.locked', { force: 0, restricted: 0 }).split('0')[0]), b.text);

    // ---- 2. 자료가 쌓인 요약 ----
    await adminPost('/admin/login', { token: ADMIN_TOKEN });
    sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '신고자', 'F-ABCD-0009')`);
    sql(`INSERT INTO ai_report (account_id, question, answer) SELECT id, '질문', '답' FROM account WHERE code = 'F-ABCD-0009'`);
    await adminConfirm('/admin/events', { id: 'ia-soon', kind: 'gift', title_ko: '곧 끝나는 선물', title_en: 'Ending soon', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 2 * 86_400_000), coins: 30 });
    await adminConfirm('/admin/coupons', { label: '곧 끝나는 쿠폰', coins: 5, tickets: 0, max_uses: 3, until: kstInput(Date.now() + 86_400_000) });
    await adminPost('/admin/notes', { account: 'F-ABCD-0009', coins: 3, chat_passes: 0, message: '기록', days: 30 });
    // #152: 백업 여섯(상한 0.001GB 의 81%), 최소 0.5.0 과 기능 제한 0.5.1, 판이 다른 계정
    mkdirSync(join(scratch, 'backups'), { recursive: true });
    sql(`INSERT INTO account (age, nickname, code, app_version) SELECT '18+', 'v' || g, 'F-ABCD-1' || lpad(g::text, 3, '0'), CASE WHEN g <= 2 THEN '0.4.0' ELSE '0.5.0' END FROM generate_series(1, 4) g`);
    sql(`INSERT INTO backup (account_id, file, size, sha256, created_at) SELECT (SELECT max(id) FROM account) - (g % 4), md5(g::text), 145000, decode(md5(g::text) || md5(g::text), 'hex'), now() - g * interval '9 hours' FROM generate_series(1, 6) g`);
    sql(`INSERT INTO site_doc (name, body) VALUES ('notices', '{"minVersion":"0.5.0","restrictVersion":"0.5.1"}'::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`);
    await press(p, '.admin-box', tx('admin.refresh'));
    await until('요약이 바뀜', async () => (await box(p)).text.includes(tx('admin.todo.reports', { n: 1 })), 15_000);
    b = await box(p);
    await p.shot('app-ia-2-filled', '.admin-box');
    check('확인할 것: 신고 1건, 끝나는 이벤트 1개, 끝나는 쿠폰 1개, 개수 3', b.text.includes(tx('admin.todo.endingEvents', { n: 1 })) && b.text.includes(tx('admin.todo.endingCoupons', { n: 1 })) && b.text.includes(tx('admin.counts', { todo: 4, reports: 1 })), b.text);
    const lines = (txt) => ({
      today: txt.includes(tx('admin.today', { signups: 0, active: 0, asks: 0, cost: '$0.00' }).split('0')[0]),
      backup: txt.includes(tx('admin.backup.last', { at: 'X', files: 6 }).split('X')[0]),
      unknown: txt.includes(tx('admin.backup.unknown')),
      locked: txt.includes(tx('admin.locked', { force: 0, restricted: 0 }).split('0')[0]),
      card: txt.includes(tx('admin.todo.backup', { n: 81 })),
    });
    check('요약 새 줄: 오늘 숫자, 백업 마지막 올라온 때와 파일 수, 서버가 모르는 것 안내, 잠기는 계정, 백업 81% 카드 (#152)', Object.values(lines(b.text)).every(Boolean), JSON.stringify(lines(b.text)) + b.text);
    check('최근 운영 기록 줄에 웹 운영자 이름과 동작 이름', b.text.includes(tx('admin.log.web')) && b.text.includes(tx('admin.act.note.send')), b.text);
    check('세션 토큰이 화면에 없다', !(await p.ev(`document.body.innerHTML.includes(${JSON.stringify(session)})`)));
    check('새로 보기가 끝나면 진행 표시는 사라진다', b.statuses.length === 0 && b.alerts.length === 0, JSON.stringify(b.statuses));

    // 신고를 조치로 바꾸면 신고 대기와 확인할 것에서 빠지고, 되돌리면 다시 (#151)
    sql(`UPDATE ai_report SET status = 'done'`);
    await press(p, '.admin-box', tx('admin.refresh'));
    await until('신고 처리 반영', async () => (await box(p)).text.includes(tx('admin.counts', { todo: 3, reports: 0 })), 15_000);
    b = await box(p);
    check('신고를 조치로 바꾸면 신고 대기 0, 확인할 것에서 신고 줄이 빠진다', !b.text.includes(tx('admin.todo.reports', { n: 1 })) && b.text.includes(tx('admin.counts', { todo: 3, reports: 0 })), b.text);
    sql(`UPDATE ai_report SET status = 'pending'`);
    await press(p, '.admin-box', tx('admin.refresh'));
    await until('신고 되돌림 반영', async () => (await box(p)).text.includes(tx('admin.todo.reports', { n: 1 })), 15_000);

    // ---- 3. 웹에서 열기: 설정된 서버 주소에서 만든 주소, 자리는 목록에 있는 것만 ----
    await main(`globalThis.__opened = []; const f = globalThis.fetch; globalThis.fetch = (u, i) => { if (String(u).includes('/admin')) globalThis.__opened.push(String(u)); return f(u, i); }; true`);
    await press(p, '.admin-box', tx('admin.web.open'));
    await press(p, '.admin-box', tx('admin.web.openThis'));
    await until('열림', async () => JSON.parse(await main('JSON.stringify(globalThis.__opened)')).length >= 2, 10_000);
    const opened = JSON.parse(await main('JSON.stringify(globalThis.__opened)'));
    check('"웹에서 열기"는 서버 주소의 /admin#home, 확인할 것의 "열기"는 그 자리', opened[0] === `${apiUrl}/admin#home` && opened[1] === `${apiUrl}/admin#reports`, JSON.stringify(opened));
    const bad = await p.ev(`Promise.all([window.jjakkungServer.adminOpenWeb('../etc'), window.jjakkungServer.adminOpenWeb('home#x'), window.jjakkungServer.adminOpenWeb(undefined), window.jjakkungServer.adminOpenWeb('reports')])`);
    check('모르는 자리와 이상한 값은 열지 않는다 (주소를 돌려주지 않는다)', bad[0] == null && bad[1] == null && bad[2] == null && bad[3] === `${apiUrl}/admin#reports`, JSON.stringify(bad));
    check('열기 뒤에도 오류 글이 없다', (await box(p)).alerts.length === 0);

    // ---- 4. 불러오는 중, 실패와 다시 시도, 지난 내용 ----
    // 서버를 멈춰 둔 채 화면을 다시 열면 불러오는 중
    process.kill(api.pid, 'SIGSTOP');
    const reloaded = p.once('Page.loadEventFired');
    await p.send('Page.reload');
    await reloaded;
    await until('불러오는 중', async () => (await box(p))?.statuses.includes(tx('admin.loading')), 20_000);
    await p.shot('app-ia-3-loading', '.admin-box');
    b = await box(p);
    check('불러오는 중: 상태 글(알림 역할)만 보이고 오류는 없다', b.statuses.includes(tx('admin.loading')) && b.alerts.length === 0, JSON.stringify(b));
    process.kill(api.pid, 'SIGCONT');
    await until('요약 도착', async () => (await box(p))?.text.includes(tx('admin.todo.title')), 20_000);
    // 서버를 끄면 처음부터 못 받은 화면은 실패와 다시 시도
    process.kill(api.pid, 'SIGKILL');
    await sleep(500);
    await reload(p);
    await until('실패', async () => (await box(p))?.alerts.includes(tx('admin.failed')), 20_000);
    await p.shot('app-ia-4-failed', '.admin-box');
    b = await box(p);
    check('실패: 이유 글(알림 역할)과 다시 시도 단추, 로딩 글은 없다', b.alerts.includes(tx('admin.failed')) && b.buttons.some((x) => x.t === tx('admin.retry')) && !b.statuses.includes(tx('admin.loading')), JSON.stringify(b));
    await press(p, '.admin-box', tx('admin.retry'));
    await sleep(600);
    b = await box(p);
    check('서버가 아직 꺼져 있으면 다시 시도해도 실패 화면 그대로 (단추는 다시 누를 수 있다)', b.alerts.includes(tx('admin.failed')) && b.buttons.some((x) => x.t === tx('admin.retry') && !x.disabled), JSON.stringify(b));
    await startApi();
    await press(p, '.admin-box', tx('admin.retry'));
    await until('다시 시도 성공', async () => (await box(p))?.text.includes(tx('admin.todo.title')), 20_000);
    check('서버가 돌아온 뒤 다시 시도하면 요약이 뜬다', (await box(p)).alerts.length === 0);
    // 받은 뒤에 서버가 사라지면 지난 내용을 두고 알린다
    process.kill(api.pid, 'SIGKILL');
    await sleep(500);
    await press(p, '.admin-box', tx('admin.refresh'));
    await until('지난 내용 안내', async () => (await box(p))?.alerts.includes(tx('admin.stale')), 20_000);
    b = await box(p);
    await p.shot('app-ia-5-stale', '.admin-box');
    check('받은 뒤 못 받으면: 지난 요약은 그대로, 못 받았다는 안내와 새로 보기 단추', b.alerts.includes(tx('admin.stale')) && b.text.includes(tx('admin.todo.title')) && b.buttons.some((x) => x.t === tx('admin.refresh') && !x.disabled), JSON.stringify(b));
    await startApi();
    await press(p, '.admin-box', tx('admin.refresh'));
    await until('안내 사라짐', async () => !(await box(p))?.alerts.includes(tx('admin.stale')), 20_000);
    check('다시 받으면 안내가 사라진다', (await box(p)).alerts.length === 0);

    // ---- 5. 폭 320 과 넓은 폭 ----
    await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    check('[320] 운영자 칸이 가로로 넘치지 않는다', (await p.ev(`document.documentElement.scrollWidth <= innerWidth + 1`)) === true);
    await p.shot('app-ia-6-320', '.admin-box');
    check('[320] 새 줄이 모두 보이고 줄이 상자 밖으로 나가지 않는다 (#152)', Object.values(lines((await box(p)).text)).every(Boolean) && (await p.ev(`[...document.querySelectorAll('.admin-box small')].every((x) => x.getBoundingClientRect().right <= document.querySelector('.admin-box').getBoundingClientRect().right + 1)`)) === true);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    check('[960] 운영자 칸이 가로로 넘치지 않는다', (await p.ev(`document.documentElement.scrollWidth <= innerWidth + 1`)) === true);
    // 어두운 모드
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    await p.shot('app-ia-7-dark', '.admin-box');
    check('[960] 새 줄이 모두 보인다 (#152)', Object.values(lines((await box(p)).text)).every(Boolean));
    await p.send('Emulation.setEmulatedMedia', { features: [] });
    await p.send('Emulation.clearDeviceMetricsOverride');
  }
  p.close();

  const how = await main("(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()");
  if (how !== 'quit') throw new Error('끝내기 못 함');
  mainConn.ws.close();
  await until('앱 끝남', () => appExited, 15_000);
}

try {
  if (ONLY.includes('web')) await webPart();
  if (ONLY.includes('app')) await appPart();
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

if (chrome?.pid) chrome.kill('SIGTERM');
if (app && !appExited) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
}
try {
  process.kill(api.pid, 'SIGCONT');
} catch {}
api.kill('SIGTERM');
stat.close();
dropPg();
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
if (TAG === 'before') console.log('그림만 찍음 (옛 판)');
else console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
