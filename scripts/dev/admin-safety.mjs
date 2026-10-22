// 운영자 실수 방지와 피드백 시험 (이슈 #155): 웹 /admin(헤드리스 Chrome, CDP)과 앱 운영자 칸(시험 앱, CDP)을 PASS/FAIL 로 본다.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/admin-safety.mjs
//
// 웹: 실패한 제출(허용 안 되는 링크)의 입력 보존과 오류 자리, 느린 응답에서 단추 막기와 진행 표시, 끊긴 네트워크 뒤 되살리기,
//     대상 이름이 적힌 확인 칸(웹은 확인이 없거나 다른 대상이면 서버가 거절), 운영 기록의 누가와 대상, 동작, 글 찾기. 폭 320 과 1100, 밝은 어두운.
//     웹 화면은 한국어만 있다 (LANG_UNDER_TEST 는 앱에만 쓴다). 다섯 칸 구조(#150)에서 칸은 주소 해시(#announce/events 등)로 연다.
// 앱: 관리 작업은 웹으로 옮겼으므로(#150) 앱 운영자 칸에는 쓰기 입력이 없고 요약과 "웹에서 열기"만 있다. 운영자 칸의 요약,
//     불러오기 실패와 다시 시도, 웹 열기는 scripts/dev/admin-ia.mjs 가 본다. 서버(server/dist)와 시험용 Postgres(jj-admin155-pg-<무작위>)는 이 프로세스가 띄우고 지운다.
//
// ONLY=web 또는 ONLY=app 으로 한쪽만. SERVER_ROOT=<server 폴더> 로 다른 판의 서버를 띄운다(TAG=before 면 옛 서버의 그림만 찍고
// 판정하지 않는다. 비교 그림용). 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다. 브라우저는 헤드리스라 창이 없다.
// 앱은 CLAUDE.md 시험 창 규칙대로 JJ_NO_FOCUS=1, 빈 JJ_USER_DATA, 입력은 CDP 로만. 끝나면 컨테이너와 폴더를 지운다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-safety-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const TAG = process.env.TAG === 'before' ? 'before' : 'after';
const ONLY = process.env.ONLY ?? 'web,app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

/** 무작위 9800~9999 중 비어 있는 포트 */
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
const pgName = `jj-admin155-pg-${randomBytes(4).toString('hex')}`;
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
// MIGRATE_ROOT: 이전만 새 판으로 하고 옛 서버를 띄워 호환을 본다 (0010 은 더하기만이라 옛 코드가 새 스키마에서 돌아야 한다)
execFileSync(process.execPath, [join(resolve(process.env.MIGRATE_ROOT ?? SERVER_ROOT), 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin155-'));
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
const api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
  cwd: SERVER_ROOT,
  env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, ADMIN_TOKEN, ADMIN_GOOGLE_SUBS: ADMIN_SUB, RELEASES_API: `${staticUrl}/latest` },
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${apiUrl}/health`)).ok) break;
  } catch {}
  await sleep(250);
}

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
/** 지급과 공지의 확정은 미리보기를 거친 것만 받는다 (#150): 미리보기를 만들고 확정 폼의 숨은 칸(번호)을 실어 보낸다 */
async function adminFlow(path, fields) {
  const preview = path === '/admin/grants/batch' ? '/admin/grants/preview' : '/admin/notices/preview';
  await adminPost(preview, fields);
  const page = await adminPage();
  const m = new RegExp(`<form method="post" action="${path}"[^>]*>([\\s\\S]*?)</form>`).exec(page);
  if (!m) return adminPost(preview, fields);
  const hidden = {};
  for (const x of m[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) if (x[1] !== 'csrf') hidden[x[1]] = x[2].replaceAll('&#10;', '\n');
  return adminPost(path, { ...hidden, ...fields, flow: hidden.flow ?? '' });
}
const kstInput = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);

const results = [];
function check(name, ok, extra = '') {
  if (TAG === 'before') return;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
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

// =========================== 웹 ===========================
async function webPart() {
  const chromePort = await pick();
  const profile = join(scratch, 'chrome');
  mkdirSync(profile, { recursive: true });
  chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
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
  // 화면의 스크립트 오류와 콘솔 오류는 그대로 보인다 (운영자 스크립트가 깨지면 바로 안다)
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') console.log('PAGE 오류', m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('PAGE console.error', JSON.stringify(m.params.args?.map((x) => x.value ?? x.description)));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.log('PAGE 로그', m.params.entry.text, m.params.entry.url ?? '');
  });
  await c.send('Log.enable');
  const size = (width, height = 900) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const nav = async (url) => {
    // 같은 문서 안의 해시 이동은 load 사건이 없다: 빈 화면을 거쳐 늘 새로 연다
    const blank = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: 'about:blank' });
    await blank;
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url });
    await loaded;
    await sleep(150);
  };
  /** 칸 주소: 다섯 칸 판은 /admin#<자리>, 옛 판(TAG=before)은 옛 탭 경로 */
  const U = (legacy, place) => (TAG === 'before' ? `${apiUrl}/admin${legacy}` : `${apiUrl}/admin#${place}`);
  /** 그림에 찍을 칸 (옛 판은 첫 section) */
  const S = (id) => (TAG === 'before' ? 'section' : `#sub-${id} section`);
  const shot = async (name, clipSelector) => {
    let clip;
    if (clipSelector) {
      const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(clipSelector)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 8), width: document.documentElement.clientWidth, height: Math.min(r.height + 16, 1200) }; })()`);
      if (box) clip = { ...box, scale: 1 };
    }
    await sleep(150);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    savePng(`${name}`, r.result.data);
  };
  /** 이름으로 폼 칸 채우기 (CDP, 진짜 입력 없음) */
  const fill = (formSel, values) =>
    ev(`(() => { const f = document.querySelector(${JSON.stringify(formSel)}); if (!f) return false; for (const [k, v] of Object.entries(${JSON.stringify(values)})) { const els = [...f.elements].filter((e) => e.name === k); for (const el of els) { if (el.type === 'checkbox') el.checked = [].concat(v).includes(el.value); else el.value = v; } } return true; })()`);
  const submit = (formSel) => ev(`document.querySelector(${JSON.stringify(formSel)}).requestSubmit(); true`);
  const submitAndWait = async (formSel) => {
    const loaded = c.once('Page.loadEventFired');
    await submit(formSel);
    await loaded;
    await sleep(200);
  };

  // 로그인
  await size(1100);
  await nav(`${apiUrl}/admin`);
  await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
  await submitAndWait('form[action="/admin/login"]');
  await adminPost('/admin/login', { token: ADMIN_TOKEN });
  check('웹 로그인', (await ev(`!!document.querySelector('nav.cells')`)) === true);

  // ---- 1. 실패한 제출의 입력 보존 ----
  const noticeValues = { id: 'keep-me', kind: 'important', title_ko: '보존될 제목', title_en: 'Kept title', body_ko: '한국어 본문\n두 번째 줄', body_en: 'English body', link: 'https://evil.example.com/x' };
  for (const width of [1100, 320]) {
    await size(width);
    await nav(U('/notices', 'announce/notices'));
    const noticeForm = TAG === 'before' ? 'form[action="/admin/notices"]' : 'form[action="/admin/notices/preview"]';
    await fill(noticeForm, noticeValues);
    await submitAndWait(noticeForm);
    const st = await ev(`(() => {
      const f = document.querySelector(${JSON.stringify(noticeForm)});
      const err = document.getElementById('form-error');
      const r = err?.getBoundingClientRect();
      return { hash: location.hash, id: f.elements.id.value, kind: f.elements.kind.value, ko: f.elements.title_ko.value, en: f.elements.title_en.value, body: f.elements.body_ko.value, link: f.elements.link.value,
        errInForm: !!err && f.contains(err), errText: err?.textContent ?? '', visible: !!r && r.top >= 0 && r.bottom <= innerHeight, topFlash: !!document.querySelector('main > p.flash, .panel > p.flash'), wide: document.documentElement.scrollWidth <= innerWidth };
    })()`);
    await shot(`web-${TAG}-1-notice-error-${width}`);
    if (TAG === 'before') {
      continue;
    }
    check(`[${width}] 실패한 공지 폼: 쓴 글이 그대로 (id, 종류, 제목 둘, 본문, 링크)`, st.id === 'keep-me' && st.kind === 'important' && st.ko === '보존될 제목' && st.en === 'Kept title' && st.body === '한국어 본문\n두 번째 줄' && st.link === noticeValues.link, JSON.stringify(st));
    check(`[${width}] 오류가 그 폼 안에 있고 화면에 보인다 (칸 주소는 그대로)`, st.errInForm && st.visible && st.hash === '#announce/notices' && st.errText.includes('링크는'), `${st.hash} ${st.errText}`);
    check(`[${width}] 맨 위 알림 줄에는 오류가 없다, 가로로 넘치지 않는다`, !st.topFlash && st.wide);
    // 새로 고치면 사라진다 (한 번만)
    await nav(U('/notices', 'announce/notices'));
    check(`[${width}] 다시 열면 채워진 값이 없다`, (await ev(`document.querySelector(${JSON.stringify(noticeForm)}).elements.title_ko.value`)) === '');
  }
  if (TAG === 'before') {
    // 비교 그림용: 확인 칸 없는 이벤트 끝내기 한 줄
    await size(1100);
    await adminPost('/admin/events', { id: 'cmp-live', kind: 'gift', title_ko: '가을 선물', title_en: 'Autumn gift', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), coins: 30 });
    await nav(U('/events', 'announce/events'));
    await shot(`web-${TAG}-2-events`, S('announce-events'));
    if (process.env.MIGRATE_ROOT) {
      await nav(U('/log', 'settings/log'));
      console.log('옛 코드 + 새 스키마: 기록', sql('SELECT count(*) FROM admin_log'), '이름 칸 비어 있음', sql('SELECT count(*) FROM admin_log WHERE actor_name IS NULL'), '기록 탭', (await ev(`document.querySelectorAll('table tbody tr').length`)) > 0 ? '열림' : '비어 있음');
    }
    return;
  }

  // ---- 2. 되돌릴 수 없는 동작: 대상 이름이 적힌 확인 칸 ----
  await size(1100);
  await adminPost('/admin/events', { id: 'sure-live', kind: 'gift', title_ko: '가을 선물', title_en: 'Autumn gift', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() - 3_600_000), until: kstInput(Date.now() + 86_400_000), coins: 30 });
  await adminPost('/admin/events', { id: 'sure-soon', kind: 'gift', title_ko: '내일 선물', title_en: 'Tomorrow', body_ko: '본문', body_en: 'Body', from: kstInput(Date.now() + 86_400_000), until: kstInput(Date.now() + 2 * 86_400_000), coins: 10 });
  await adminPost('/admin/coupons', { label: '시험 쿠폰', coins: 5, tickets: 0, max_uses: 3, until: kstInput(Date.now() + 86_400_000) });
  await adminFlow('/admin/notices', { id: 'sure-notice', kind: 'info', title_ko: '지울 공지', title_en: 'Old notice', body_ko: '본문', body_en: 'Body' });
  await nav(U('/events', 'announce/events'));
  await shot(`web-${TAG}-2-events`, S('announce-events'));
  const rowForm = (id) => `form.sure input[name=id][value="${id}"]`;
  const label = await ev(`document.querySelector(${JSON.stringify(rowForm('sure-live'))}).form.querySelector('label.confirm').textContent.trim()`);
  check('이벤트 끝내기: 확인 칸에 대상 이름(제목과 id)이 있다', label.includes('가을 선물') && label.includes('sure-live') && label.includes('끝낼게요'), label);
  check('시작 전 이벤트는 지우기 문구', (await ev(`document.querySelector(${JSON.stringify(rowForm('sure-soon'))}).form.querySelector('label.confirm').textContent`)).includes('지울게요'));
  // 체크 없이 누르면 브라우저가 막는다 (required) → 서버에 닿지 않는다
  const before = Number(sql(`SELECT count(*) FROM admin_log WHERE action IN ('event.end', 'event.delete')`));
  await ev(`document.querySelector(${JSON.stringify(rowForm('sure-live'))}).form.requestSubmit(); true`);
  await sleep(500);
  check('체크 없이 누르면 제출되지 않는다', Number(sql(`SELECT count(*) FROM admin_log WHERE action IN ('event.end', 'event.delete')`)) === before && (await ev(`location.hash`)) === '#announce/events');
  // 서버도 웹에서 확인 없는 요청과 다른 대상 확인을 거절한다 (브라우저 검사를 우회해도)
  const noConfirm = await adminPost('/admin/events/end', { id: 'sure-live' });
  check('서버도 웹에서 확인 없는 끝내기를 거절한다', noConfirm.includes('확인 칸을 체크해 주세요') && sql(`SELECT ends_at > now() FROM event WHERE id = 'sure-live'`) === 't', noConfirm);
  const refused = await adminPost('/admin/events/end', { id: 'sure-live', confirm: 'other' });
  check('서버도 다른 대상으로 확인한 끝내기를 거절한다', refused.includes('확인한 대상이 달라요') && sql(`SELECT ends_at > now() FROM event WHERE id = 'sure-live'`) === 't', refused);
  // 체크하고 누르면 된다
  await ev(`(() => { const f = document.querySelector(${JSON.stringify(rowForm('sure-live'))}).form; f.querySelector('input[type=checkbox]').checked = true; return true; })()`);
  await shot(`web-${TAG}-2-events-checked`, S('announce-events'));
  const loaded = c.once('Page.loadEventFired');
  await ev(`document.querySelector(${JSON.stringify(rowForm('sure-live'))}).form.requestSubmit(); true`);
  await loaded;
  await sleep(200);
  check('체크하고 누르면 끝난다', sql(`SELECT ends_at <= now() FROM event WHERE id = 'sure-live'`) === 't' && (await ev(`document.getElementById('form-ok')?.textContent ?? ''`)).includes('끝냈어요'));
  // 쿠폰 끄기, 공지 지우기, 정기 지급 해지, 막기도 같은 모양
  await nav(U('/events', 'announce/coupons'));
  const couponLabel = await ev(`document.querySelector('form.sure input[name=id]:not([value^="sure"])')?.form.querySelector('label.confirm').textContent.trim() ?? ''`);
  check('쿠폰 끄기: 확인 칸에 쿠폰 번호와 메모', couponLabel.includes('시험 쿠폰') && couponLabel.includes('끌게요'), couponLabel);
  await nav(U('/notices', 'announce/notices'));
  const noticeLabel = await ev(`document.querySelector('form.sure label.confirm')?.textContent.trim() ?? ''`);
  check('공지 지우기: 확인 칸에 제목과 id', noticeLabel.includes('지울 공지') && noticeLabel.includes('sure-notice'), noticeLabel);
  await shot(`web-${TAG}-2-notice-delete`, 'article.notice');
  await size(320);
  await nav(U('/events', 'announce/events'));
  check('[320] 이벤트 자리가 가로로 넘치지 않는다', (await ev(`document.documentElement.scrollWidth <= innerWidth`)) === true);
  await shot(`web-${TAG}-2-events-320`, S('announce-events'));
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await size(1100);
  await nav(U('/events', 'announce/events'));
  await shot(`web-${TAG}-2-events-dark`, S('announce-events'));
  await c.send('Emulation.setEmulatedMedia', { features: [] });

  // ---- 3. 처리 중: 제출하면 단추가 막히고 진행 표시가 뜨고, 두 번째 제출은 막힌다 ----
  // 응답이 올 때까지 기다리는 화면을 그대로 보려고, 운영자 스크립트 뒤에 붙인 시험용 듣개가 이동을 멈춘다
  await size(1100);
  await nav(U('/events', 'announce/coupons'));
  await ev(`window.__submits = []; document.addEventListener('submit', (e) => { window.__submits.push(e.defaultPrevented ? 'blocked' : 'sent'); e.preventDefault(); }); true`);
  await fill('form[action="/admin/rewards/policy"]', { login_only: '0' });
  await submit('form[action="/admin/rewards/policy"]');
  await sleep(300);
  const busy = await ev(`(() => { const f = document.querySelector('form[action="/admin/rewards/policy"]'); const b = f.querySelector('button[type=submit]'); return { cls: f.classList.contains('busy'), aria: f.getAttribute('aria-busy'), disabled: b.disabled, text: b.textContent, spin: getComputedStyle(b, '::after').content }; })()`);
  await shot(`web-${TAG}-3-busy`, 'form[action="/admin/rewards/policy"]');
  await submit('form[action="/admin/rewards/policy"]'); // 두 번째 시도
  check('제출 중: 단추가 막히고 "처리 중", 진행 표시가 있다', busy.cls && busy.aria === 'true' && busy.disabled && busy.text === '처리 중' && busy.spin !== 'none', JSON.stringify(busy));
  check('두 번째 제출은 막힌다 (한 번만 나간다)', JSON.stringify(await ev('window.__submits')) === '["sent","blocked"]');
  // 뒤로 오면(pageshow) 풀린다
  await ev(`window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); true`);
  check('뒤로 와서 다시 보이면 단추가 풀린다', (await ev(`(() => { const f = document.querySelector('form[action="/admin/rewards/policy"]'); return !f.classList.contains('busy') && !f.querySelector('button').disabled && f.querySelector('button').textContent === '저장'; })()`)) === true);
  // 진짜 제출은 끝까지 간다 (단추 막힘이 제출을 취소하지 않는다)
  await nav(U('/events', 'announce/coupons'));
  await fill('form[action="/admin/rewards/policy"]', { login_only: '0' });
  const policyBefore = Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'rewards.policy'`));
  await submitAndWait('form[action="/admin/rewards/policy"]');
  check('막힌 단추로도 제출은 한 번 서버에 닿는다', Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'rewards.policy'`)) === policyBefore + 1 && (await ev(`document.getElementById('form-ok')?.textContent ?? ''`)).includes('기기 계정도'));

  // ---- 4. 네트워크가 끊긴 제출 ----
  await nav(U('/events', 'announce/coupons'));
  await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await fill('form[action="/admin/coupons"]', { label: '끊김 시험', coins: '7', tickets: '0', max_uses: '5', until: kstInput(Date.now() + 86_400_000) });
  await submit('form[action="/admin/coupons"]');
  await sleep(1500);
  const errPage = await ev('location.href');
  await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // 사용자가 그 화면을 다시 연다 (뒤로 가기가 bfcache 로 옛 화면을 그대로 살리는 경우는 값이 원래 남아 있다)
  await nav(U('/events', 'announce/coupons'));
  await sleep(300);
  const restored = await ev(`(() => { const f = document.querySelector('form[action="/admin/coupons"]'); return { label: f.elements.label.value, coins: f.elements.coins.value, max: f.elements.max_uses.value, note: document.querySelector('p.flash.warn')?.textContent ?? '', confirm: [...document.querySelectorAll('input[name=confirm]')].some((x) => x.checked) }; })()`);
  await shot(`web-${TAG}-4-offline-restored`, 'form[action="/admin/coupons"]');
  check('끊긴 제출: 브라우저가 오류 화면으로 갔다', errPage.startsWith('chrome-error'), errPage);
  check('돌아오면 쓰던 글이 되살아나고 안내가 뜬다', restored.label === '끊김 시험' && restored.coins === '7' && restored.max === '5' && restored.note.includes('확인하지 못했어요'), JSON.stringify(restored));
  check('끊긴 제출은 서버에 닿지 않았다', sql(`SELECT count(*) FROM coupon WHERE label = '끊김 시험'`) === '0');

  // ---- 5. 운영 기록: 누가, 대상, 동작, 글 ----
  const findId = sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '찾는사람', 'F-ABCD-0001') RETURNING id`).split('\n')[0];
  await adminPost('/admin/notes', { account: 'F-ABCD-0001', coins: 3, chat_passes: 0, message: '가나다 보상', days: 30 });
  await adminPost('/admin/notes', { account: 'F-ABCD-0001', coins: 4, chat_passes: 0, message: '라마바', days: 30 });
  sql(`INSERT INTO admin_log (actor, action, target) VALUES ('admin:deadbeef', 'event.end', 'old-event')`);
  await size(1100);
  await nav(U('/log', 'settings/log'));
  await shot(`web-${TAG}-5-log`, S('settings-log'));
  const LOGT = TAG === 'before' ? 'table.log' : '#sub-settings-log table.log';
  const logAll = await ev(`document.querySelector(${JSON.stringify(`${LOGT} tbody`)}).innerText`);
  check('운영 기록에 "웹 운영자" 이름과 세션 표시', logAll.includes('웹 운영자') && logAll.includes('admin:'));
  check('옛 기록(이름 없음)은 세션 표시만으로 그려진다', logAll.includes('admin:deadbeef'));
  await nav(`${apiUrl}/admin?lu=${encodeURIComponent('찾는사')}&la=note.send#settings/log`);
  const filtered = await ev(`({ rows: document.querySelectorAll('#sub-settings-log table.log tbody tr').length, text: document.querySelector('#sub-settings-log table.log tbody').innerText, sel: document.querySelector('select[name=la]').value, user: document.querySelector('input[name=lu]').value })`);
  await shot(`web-${TAG}-5-log-filtered`, S('settings-log'));
  check('대상 이용자(닉네임 일부)와 동작 종류로 거른다', filtered.rows === 2 && filtered.text.includes(`#${findId}`) && filtered.sel === 'note.send' && filtered.user === '찾는사', JSON.stringify(filtered));
  await nav(`${apiUrl}/admin?lt=${encodeURIComponent('라마바')}#settings/log`);
  check('글 검색(자세히 안의 말)', (await ev(`document.querySelectorAll('#sub-settings-log table.log tbody tr').length`)) === 1);
  await size(320);
  await nav(U('/log', 'settings/log'));
  check('[320] 운영 기록 자리가 가로로 넘치지 않는다', (await ev(`document.documentElement.scrollWidth <= innerWidth`)) === true);
  await shot(`web-${TAG}-5-log-320`, S('settings-log'));
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
    cwd: root,
    env: {
      HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_SERVER_URL_OVERRIDE: apiUrl,
      JJ_EVENTS_URL: `${staticUrl}/events.json`, JJ_NOTICES_URL: `${staticUrl}/notices.json`, JJ_RELEASES_API: `${staticUrl}/latest`, JJ_TEST_SECRETS: 'memory',
    },
    stdio: 'ignore',
  });
  appExited = false;
  app.on('exit', () => {
    appExited = true;
  });
  console.log('app pid', app.pid, 'server', apiPort, 'pg', pgName, 'lang', LANG);

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
          return {
            ev,
            send: c.send,
            shot: async (file, selector) => {
              const box = selector
                ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 8), width: document.documentElement.clientWidth, height: Math.min(r.height + 16, 1800) }; })()`)
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
  /** 운영자 칸의 묶음(이름으로)과 그 안의 칸(이름으로)에 값을 넣는다 */
  const setField = (p, group, labelText, value) =>
    p.ev(`(() => {
      const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(group)}));
      const l = g && [...g.querySelectorAll('label.admin-field')].find((x) => x.querySelector('.admin-field-name')?.textContent.trim() === ${JSON.stringify(labelText)});
      const el = l?.querySelector('input, select'); if (!el) return false;
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  const getField = (p, group, labelText) =>
    p.ev(`(() => { const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(group)})); const l = g && [...g.querySelectorAll('label.admin-field')].find((x) => x.querySelector('.admin-field-name')?.textContent.trim() === ${JSON.stringify(labelText)}); return l?.querySelector('input, select')?.value ?? null; })()`);
  const groupText = (p, group, sel) =>
    p.ev(`(() => { const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(group)})); return [...(g?.querySelectorAll(${JSON.stringify(sel)}) ?? [])].map((x) => x.textContent.trim()); })()`);
  const pressIn = (p, group, text) =>
    p.ev(`(() => { const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(group)})); const b = [...(g?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  const shotGroup = async (file, title) => {
    await p.ev(`(() => { for (const g of document.querySelectorAll('.admin-group')) g.removeAttribute('data-shot'); const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(title)})); g?.setAttribute('data-shot', '1'); return !!g; })()`);
    await p.shot(file, '[data-shot]');
  };
  const buttonText = (p, group) =>
    p.ev(`(() => { const g = [...document.querySelectorAll('.admin-group')].find((x) => x.querySelector('strong')?.textContent.startsWith(${JSON.stringify(group)})); return [...(g?.querySelectorAll('button') ?? [])].map((x) => x.textContent.trim()); })()`);

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
  const startLabel = LANG === 'ko' ? '서버 모드 시작' : 'Start server mode';
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
  const myCode = sql('SELECT code FROM account ORDER BY id DESC LIMIT 1');
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', '${ADMIN_SUB}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`);
  await until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 30_000);
  // 관리 작업은 웹으로 옮겼다 (#150): 앱 운영자 칸에는 쓰기 입력이 없고 요약과 "웹에서 열기" 뿐이다.
  // 실패한 제출의 입력 보존, 확인 두 번 누르기, 운영 기록 찾기는 위의 웹 시험이 본다. 요약과 실패 상태는 admin-ia.mjs
  const shape = await p.ev(`(() => { const b = document.querySelector('.admin-box'); return { inputs: b.querySelectorAll('input, select, textarea').length, buttons: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()), leakSession: document.body.innerHTML.includes(${JSON.stringify(session)}) }; })()`);
  check('앱 운영자 칸에는 쓰기 입력이 없다 (입력 0개)', shape.inputs === 0, JSON.stringify(shape));
  check('"웹에서 열기" 단추가 있다', shape.buttons.includes(tx('admin.web.open')), JSON.stringify(shape.buttons));
  check('세션 토큰이 화면에 없다', shape.leakSession === false);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check('[320] 운영자 칸이 가로로 넘치지 않는다', (await p.ev(`document.documentElement.scrollWidth <= innerWidth + 1`)) === true);
  await p.send('Emulation.clearDeviceMetricsOverride');
  p.close();

  const how = await main("(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()");
  if (how !== 'quit') throw new Error('끝내기 못 함');
  mainConn.ws.close();
  await until('앱 끝남', () => appExited, 15_000);
}

try {
  if (ONLY.includes('web')) await webPart();
  if (ONLY.includes('app') && TAG === 'after') await appPart();
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
if (failed || results.some((r) => !r.ok)) {
  try {
    const lines = readFileSync(join(scratch, 'data', 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => /server|admin/.test(l)).slice(-20).join('\n')}`);
  } catch {}
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
if (TAG === 'before') console.log('그림만 찍음 (옛 서버)');
else console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
