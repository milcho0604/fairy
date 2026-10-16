// PR #123 QA: 채팅 이용권 모델 claude-sonnet-5-5, 서버 폴백(reset), 홉별 비용, 질문 글자 수 상한(input_chars).
// 세 층(API, 화면 클릭, 화면 모양)을 PASS/FAIL 로 본다. 진짜 Anthropic 은 부르지 않는다 (server/scripts/fake-anthropic.mjs).
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr123.mjs
//
// - 서버는 이 프로세스 안에서 server/dist 의 createApp 으로 띄운다 (가짜 구글: 시험 RSA 키, 운영자 토큰과 운영자 sub)
// - 가짜 Anthropic 앞에 느린 중계를 끼워 [[fallback]] 응답만 사건마다 늦춘다 (화면의 중간 글을 보려고, QA_FALLBACK_SLOW_MS)
// - 앱 둘: A(허용된 18+ 사용자, 채팅 창 클릭, 숨은 창의 웹 /admin 클릭), C(운영자 칸)
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만
// - 컨테이너는 jj-qa123-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeAnthropic } from '../../server/scripts/fake-anthropic.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `qa-pr123-${LANG}`));
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
const pgName = `jj-qa123-pg-${randomBytes(4).toString('hex')}`;
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
const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.qa123-'));
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
// 가짜 Anthropic 앞에 끼우는 느린 중계: [[fallback]] 응답의 SSE 사건을 하나씩 늦춰 보내 화면의 중간 상태(앞부분 글 → reset)를 볼 수 있게 한다
const SLOW_MS = Number(process.env.QA_FALLBACK_SLOW_MS ?? 450);
const relay = httpServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const slow = raw.includes('[[fallback]]');
    const up = httpRequest(`${fake.url}${req.url}`, { method: req.method, headers: req.headers }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      let buf = '';
      const queue = [];
      let ended = false;
      let pumping = false;
      const pump = async () => {
        if (pumping) return;
        pumping = true;
        while (queue.length) {
          res.write(queue.shift());
          if (slow) await sleep(SLOW_MS);
        }
        pumping = false;
        if (ended) res.end();
      };
      ur.setEncoding('utf8');
      ur.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          queue.push(buf.slice(0, i + 2));
          buf = buf.slice(i + 2);
        }
        void pump();
      });
      ur.on('end', () => {
        if (buf) queue.push(buf);
        ended = true;
        void pump();
      });
      ur.on('aborted', () => res.socket?.destroy());
      ur.on('error', () => res.socket?.destroy());
    });
    up.on('error', () => res.socket?.destroy());
    up.end(raw);
  });
});
const relayPort = await freePort();
await new Promise((r) => relay.listen(relayPort, '127.0.0.1', r));
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
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${relayPort}`,
  GIFT_HMAC_KEY: randomBytes(32).toString('hex'),
  ADMIN_TOKEN,
  ADMIN_GOOGLE_SUBS: ADMIN_SUB,
  RELEASES_API: `${staticUrl}/latest`,
  AI_DAILY_LIMIT: '200',
};
const seen = [];
const nest = await createApp(readConfig(env), { google: fakeGoogle, now: () => Date.now() + clockShift });
/** 앱이 보낸 /v1/ai/chat 본문의 메시지 글자 수 (응답이 끝난 뒤 req.body 를 본다) */
const chatBodies = [];
nest.use((req, res, next) => {
  seen.push(`${req.method} ${req.path}`);
  if (req.method === 'POST' && req.path === '/v1/ai/chat')
    res.on('finish', () => {
      const m = Array.isArray(req.body?.messages) ? req.body.messages : [];
      chatBodies.push({ status: res.statusCode, n: m.length, total: m.reduce((a, x) => a + String(x?.content ?? '').length, 0), last: String(m.at(-1)?.content ?? '') });
    });
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
  return { status: r.status, flash: /<p class="flash( error)?" role="status">([^<]*)<\/p>/.exec(page.text)?.[2] ?? '', error: /<p class="flash error"/.test(page.text), setCookie };
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
  const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), `.qa123-${name}-`));
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


const note = (area, text) => console.log(`NOTE [${area}] ${text}`);
const ELECTRON = "process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron')";
const rules = serverReq('./dist/ai-rules.js');
const SONNET = 'claude-sonnet-5-5';
const BETA = 'server-side-fallback-2026-07-01';
/** 가짜 서버 숫자로 센 비용 (백만분의 1달러): Sonnet 120/30 = 540, 폴백 Sonnet 120/40 + Opus 5 120/30 = 640 + 1350 */
const COST_OK = 120 * 2 + 30 * 10;
const COST_FALLBACK = 120 * 2 + 40 * 10 + (120 * 5 + 30 * 25);
const COST_REFUSAL = 120 * 2 + 3 * 10;
const lastUsage = (id) => {
  const [status, model, input, output, cost] = sql(`SELECT status, model, input_tokens, output_tokens, cost_micros FROM ai_usage WHERE account_id = ${id} ORDER BY id DESC LIMIT 1`).split('|');
  return { status, model, input: Number(input), output: Number(output), cost: Number(cost) };
};
const usageCount = (id) => Number(sql(`SELECT count(*) FROM ai_usage WHERE account_id = ${id}`));
const tickets = (id) => Number(sql(`SELECT COALESCE((SELECT remaining FROM ai_ticket WHERE account_id = ${id}), -1)`));
const setTickets = (id, n) => sql(`INSERT INTO ai_ticket (account_id, remaining) VALUES (${id}, ${n}) ON CONFLICT (account_id) DO UPDATE SET remaining = ${n}`);
const inputCharsDb = () => sql('SELECT COALESCE(input_chars::text, \'NULL\') FROM ai_setting WHERE id = 1');
const bodyShape = (call) => {
  const b = call?.body ?? {};
  return {
    model: b.model,
    thinking: b.thinking,
    oc: b.output_config,
    fallbacks: b.fallbacks,
    beta: call?.beta,
    max: b.max_tokens,
    stream: b.stream,
    sampling: ['temperature', 'top_p', 'top_k'].filter((k) => k in b),
    violations: call?.violations,
  };
};
const shapeOk = (s) =>
  s.model === SONNET &&
  JSON.stringify(s.thinking) === '{"type":"between_tools"}' &&
  JSON.stringify(s.oc) === '{"effort":"low"}' &&
  s.fallbacks === 'default' &&
  String(s.beta ?? '').split(',').map((x) => x.trim()).includes(BETA) &&
  s.max === 600 &&
  s.stream === true &&
  s.sampling.length === 0 &&
  Array.isArray(s.violations) &&
  s.violations.length === 0;

// ================= 1. API 층 =================
async function apiLayer() {
  const A = 'API';
  await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
  await adminPage();
  check(A, '웹 /admin 로그인 (쿠키, csrf)', web.cookie.startsWith('__Host-fairy_admin=') && web.csrf.length >= 16);
  await setMode('allowlist');
  const mk = async () => {
    const u = await newUser();
    const al = await adminJson('ai/allow', { account: u.code, allowed: '1' });
    setTickets(u.id, 10);
    return { ...u, allowed: al.json?.ok === true };
  };
  const chat = (u, content, extra = {}) => api('POST', '/v1/ai/chat', { token: u.session, body: { messages: [{ role: 'user', content }], lang: LANG, ...extra }, raw: true });

  // 정상 질문: 본문 모양, 차감, 비용
  const u = await mk();
  check(A, '허용 목록에 넣기 (ai/allow) ok', u.allowed);
  {
    const n0 = fake.calls.length;
    const r = await chat(u, Q('안녕', 'hello'));
    const evs = sse(r.text);
    const texts = evs.filter((e) => e.ev === 'text').map((e) => e.data.text).join('');
    check(A, '정상 질문 → 200 SSE text 3조각 + done tickets 9', r.status === 200 && texts === '안녕! 나는 AI 야.' && evs.at(-1)?.ev === 'done' && evs.at(-1).data.tickets === 9 && evs.at(-1).data.stop === 'end_turn', `${r.status} ${r.text?.slice(-90)}`);
    check(A, '이용권 10 → 9 (DB)', tickets(u.id) === 9, tickets(u.id));
    const us = lastUsage(u.id);
    check(A, `ai_usage: ok, model ${SONNET}, 120/30, 비용 ${COST_OK} (입력 $2, 출력 $10 per 1M)`, us.status === 'ok' && us.model === SONNET && us.input === 120 && us.output === 30 && us.cost === COST_OK, JSON.stringify(us));
    const s = bodyShape(fake.calls[n0]);
    check(A, '가짜 서버가 받은 본문: model, thinking between_tools, effort low, fallbacks default, 베타 머리, max_tokens 600, stream, 샘플링 없음, 위반 0', fake.calls.length === n0 + 1 && shapeOk(s), JSON.stringify(s));
    const b = fake.calls[n0]?.body ?? {};
    check(A, '본문에 미리 채우기 없음 (마지막은 user), 날짜 붙은 모델 이름 아님, system 은 문자열', b.messages?.at(-1)?.role === 'user' && !/-\d{8}$/.test(b.model) && typeof b.system === 'string', JSON.stringify(Object.keys(b)));
  }
  // 예약금: 두 홉 최악 (Sonnet + 모르는 모델 $15/$75)
  {
    const req = { messages: [{ role: 'user', content: `[[slow]] ${Q('기다려', 'wait')}` }], lang: LANG, persona: '' };
    const ac = new AbortController();
    const p = fetch(`${apiUrl}/v1/ai/chat`, { method: 'POST', signal: ac.signal, headers: { authorization: `Bearer ${u.session}`, 'content-type': 'application/json', 'cf-connecting-ip': ip() }, body: JSON.stringify(req) }).catch(() => undefined);
    await soft(until('pending', () => lastUsage(u.id).status === 'pending', 8000));
    const pend = lastUsage(u.id);
    const want = rules.reserveMicros(SONNET, req, true);
    const single = rules.reserveMicros(SONNET, req, false);
    check(A, `질문 중 예약금 = 두 홉 최악 (${want}, 한 홉이면 ${single})`, pend.status === 'pending' && pend.cost === want && want > single, JSON.stringify(pend));
    ac.abort();
    await p;
    await soft(until('되돌림', () => lastUsage(u.id).status !== 'pending', 10_000));
    check(A, '[[slow]] 연결을 끊으면 (글 없음) 되돌림, 9 그대로', lastUsage(u.id).status === 'refunded' && tickets(u.id) === 9, JSON.stringify(lastUsage(u.id)));
  }
  // 서버 폴백
  {
    const n0 = fake.calls.length;
    const r = await chat(u, `[[fallback]] ${Q('곤란한 질문', 'tricky one')}`);
    const evs = sse(r.text);
    const order = evs.map((e) => (e.ev === 'text' ? `text:${e.data.text}` : e.ev)).join(' | ');
    const iReset = evs.findIndex((e) => e.ev === 'reset');
    const before = evs.slice(0, iReset).filter((e) => e.ev === 'text').map((e) => e.data.text).join('');
    const after = evs.slice(iReset + 1).filter((e) => e.ev === 'text').map((e) => e.data.text).join('');
    check(A, '[[fallback]] → text "[A의 앞부분] " → reset {} → text 새 답 → done', iReset > 0 && before === '[A의 앞부분] ' && JSON.stringify(evs[iReset].data) === '{}' && after === '안녕! 나는 AI 야.' && evs.at(-1)?.ev === 'done', order);
    check(A, '[[fallback]] 이용권 1장 차감 (9 → 8)', tickets(u.id) === 8 && evs.at(-1)?.data?.tickets === 8, tickets(u.id));
    const us = lastUsage(u.id);
    check(A, `[[fallback]] 장부 비용 = 홉별 합 Sonnet 640 + Opus 5 1350 = ${COST_FALLBACK}, ok`, us.status === 'ok' && us.cost === COST_FALLBACK && us.model === SONNET, JSON.stringify(us));
    check(A, '[[fallback]] 본문 모양도 같음 (위반 0)', shapeOk(bodyShape(fake.calls[n0])), JSON.stringify(bodyShape(fake.calls[n0])));
  }
  // 실패들: 되돌림
  for (const [tag, want] of [
    ['[[fail]]', (r, evs) => r.status === 502 && r.json?.error === 'upstream' && r.json.refunded === true],
    ['[[cut]]', (r, evs) => r.status === 200 && evs.at(-1)?.ev === 'error' && evs.at(-1).data.error === 'upstream' && evs.at(-1).data.refunded === true],
    ['[[sse-error]]', (r, evs) => r.status === 200 && evs.at(-1)?.ev === 'error' && evs.at(-1).data.refunded === true],
    ['[[refusal]]', (r, evs) => r.status === 200 && evs.at(-1)?.ev === 'error' && evs.at(-1).data.error === 'refusal' && evs.at(-1).data.refunded === true],
  ]) {
    const v = await mk();
    v.session = v.session;
    const t0 = tickets(v.id);
    const r = await chat(v, `${tag} x`);
    let json;
    try {
      json = JSON.parse(r.text ?? '');
    } catch {}
    const rr = { ...r, json };
    const evs = r.status === 200 ? sse(r.text) : [];
    const us = lastUsage(v.id);
    check(A, `${tag} → 되돌림 (이용권 ${t0} 그대로, ai_usage refunded)`, want(rr, evs) && tickets(v.id) === t0 && us.status === 'refunded', `${r.status} ${(r.text ?? '').slice(-140)} ${JSON.stringify(us)}`);
    if (tag === '[[refusal]]') check(A, `[[refusal]] 쓴 토큰 비용은 남김 (${COST_REFUSAL})`, us.cost === COST_REFUSAL, JSON.stringify(us));
    // refusal 은 이용권 수가 계정마다 10 이라 tickets 비교가 8 이 아닐 수 있다: 다시 본다
  }

  // 질문 글자 수 상한 (input_chars)
  const AL = 'API 글자 수';
  {
    const ov0 = await api('GET', '/v1/admin/overview', { headers: { cookie: web.cookie } });
    const ai0 = ov0.json?.ai ?? ov0.json?.view?.ai ?? {};
    check(AL, 'overview ai: inputChars 8000, capInputChars 8000, setInputChars null', ai0.inputChars === 8000 && ai0.capInputChars === 8000 && ai0.setInputChars === null, JSON.stringify({ s: ov0.status, i: ai0.inputChars, c: ai0.capInputChars, set: ai0.setInputChars }));
    const ok = await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '30' });
    check(AL, 'ai/limits input_chars 30 → ok, 결과 글 "질문 30자", DB 30', ok.json?.ok === true && /질문 30자/.test(ok.json.text) && inputCharsDb() === '30', `${ok.status} ${JSON.stringify(ok.json)} db=${inputCharsDb()}`);
    const log = sql(`SELECT detail::text FROM admin_log WHERE action = 'ai.limits' ORDER BY id DESC LIMIT 1`);
    check(AL, '운영 기록 ai.limits before/after inputChars', /"inputChars": ?30/.test(log) && /"before"/.test(log), log.slice(0, 200));
    const w = await mk();
    const n0 = fake.calls.length;
    const t0 = tickets(w.id);
    const long = await chat(w, 'x'.repeat(31));
    check(AL, '31자 질문 → 400 too_long, 업스트림 0건, 이용권 그대로, 사용량 줄 0', long.status === 400 && /too_long/.test(long.text ?? '') && fake.calls.length === n0 && tickets(w.id) === t0 && usageCount(w.id) === 0, `${long.status} ${long.text}`);
    const edge = await chat(w, 'x'.repeat(30));
    check(AL, '30자 질문 (경계) → 200 done, 차감', edge.status === 200 && sse(edge.text).at(-1)?.ev === 'done' && tickets(w.id) === t0 - 1, `${edge.status} ${(edge.text ?? '').slice(-60)}`);
    const hist = await api('POST', '/v1/ai/chat', { token: w.session, body: { messages: [{ role: 'user', content: 'x'.repeat(10) }, { role: 'assistant', content: 'y'.repeat(15) }, { role: 'user', content: 'z'.repeat(10) }], lang: LANG }, raw: true });
    check(AL, '옛 앱(question 칸 없음)은 예전처럼 메시지 전체 글자 수: 10+15+10 = 35 > 30 → 400 too_long', hist.status === 400 && /too_long/.test(hist.text ?? ''), `${hist.status} ${hist.text}`);
    // 새 앱: 사용자가 친 마지막 질문(question)만 센다. 앞에 붙은 글과 앞 문답은 안전 상한(12000)으로만 묶인다
    const lead = 'x'.repeat(200);
    const pre = [{ role: 'user', content: 'a'.repeat(100) }, { role: 'assistant', content: 'b'.repeat(100) }];
    const qOk = await api('POST', '/v1/ai/chat', { token: w.session, body: { messages: [...pre, { role: 'user', content: `${lead}${'z'.repeat(10)}` }], question: 'z'.repeat(10), lang: LANG }, raw: true });
    check(AL, 'question 10자 + 앞 문답 + 앞에 붙은 글 200자 (전체 410 > 30) → 200 done', qOk.status === 200 && sse(qOk.text).at(-1)?.ev === 'done', `${qOk.status} ${(qOk.text ?? '').slice(-60)}`);
    const qEdge = await api('POST', '/v1/ai/chat', { token: w.session, body: { messages: [{ role: 'user', content: `${lead}${'z'.repeat(30)}` }], question: 'z'.repeat(30), lang: LANG }, raw: true });
    check(AL, 'question 30자 (경계) → 200 done', qEdge.status === 200 && sse(qEdge.text).at(-1)?.ev === 'done', `${qEdge.status} ${(qEdge.text ?? '').slice(-60)}`);
    const nq = fake.calls.length;
    const qLong = await api('POST', '/v1/ai/chat', { token: w.session, body: { messages: [{ role: 'user', content: `${lead}${'z'.repeat(31)}` }], question: 'z'.repeat(31), lang: LANG }, raw: true });
    check(AL, 'question 31자 → 400 too_long, 업스트림 0건', qLong.status === 400 && /too_long/.test(qLong.text ?? '') && fake.calls.length === nq, `${qLong.status} ${qLong.text}`);
    const qHuge = await api('POST', '/v1/ai/chat', { token: w.session, body: { messages: [{ role: 'user', content: 'x'.repeat(12001) }], question: 'z', lang: LANG }, raw: true });
    check(AL, 'question 1자여도 요청 전체 12001자 → 400 too_long (안전 상한), 업스트림 0건', qHuge.status === 400 && /too_long/.test(qHuge.text ?? '') && fake.calls.length === nq, `${qHuge.status} ${qHuge.text}`);
    for (const [v, why] of [['8001', '.env 상한 넘음'], ['0', '0'], ['-5', '음수'], ['1.5', '소수'], ['abc', '글자']]) {
      const before = inputCharsDb();
      const r = await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: v });
      check(AL, `input_chars ${v} (${why}) → 400 거절, DB 그대로 ${before}`, r.status === 400 && r.json?.error === 'refused' && inputCharsDb() === before, `${r.status} ${JSON.stringify(r.json)}`);
    }
    const one = await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '1' });
    check(AL, 'input_chars 1 (최소) → ok', one.json?.ok === true && inputCharsDb() === '1');
    const max = await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '8000' });
    check(AL, 'input_chars 8000 (.env 상한과 같음) → ok', max.json?.ok === true && inputCharsDb() === '8000');
    // 웹 폼 (fetch): 넘는 값은 오류 글
    const wf = await adminPost('/admin/ai/limits', { budget_usd: '', daily_limit: '', input_chars: '9000' });
    check(AL, '웹 POST /admin/ai/limits 9000 → 303 + 오류 글, DB 그대로', wf.status === 303 && wf.error && /상한/.test(wf.flash) && inputCharsDb() === '8000', `${wf.flash} db=${inputCharsDb()}`);
    const page = (await adminPage()).text;
    check(AL, '웹 /admin 화면에 글자 수 칸 (max=8000, 값 8000) 과 "질문 8000자 이하"', /name="input_chars" type="number" min="1" max="8000" value="8000"/.test(page) && page.includes('질문 8000자 이하'), /<label>질문[^\n]*/.exec(page)?.[0]);
    // 빈 칸 → 상한
    const blank = await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '' });
    check(AL, '빈 칸 → NULL (상한 8000 그대로 씀)', blank.json?.ok === true && inputCharsDb() === 'NULL' && /질문 8000자/.test(blank.json.text), `${JSON.stringify(blank.json)} ${inputCharsDb()}`);
    // 운영자 화면을 거치지 않고 input_chars 를 빼고 보내면? (앱 운영자 칸은 이 칸을 보내지 않는다)
    await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '500' });
    const noField = await adminJson('ai/limits', { budget_usd: '', daily_limit: '' });
    check(AL, 'input_chars 칸 없이 ai/limits 저장 → 운영자 설정 500 은 그대로여야 함', noField.json?.ok === true && inputCharsDb() === '500', `${JSON.stringify(noField.json)} db=${inputCharsDb()}`);
    await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '' });
  }
  // 기동 설정 AI_MAX_INPUT_CHARS
  const AC = 'API 기동 설정';
  {
    const base = { ...env };
    const tryCfg = (v) => {
      try {
        return readConfig({ ...base, AI_MAX_INPUT_CHARS: v }).ai?.maxInputChars ?? 'none';
      } catch (e) {
        return `throw`;
      }
    };
    const got = Object.fromEntries(['', '1', '8000', '2000', '0', '8001', '0x10', '1.5', '1e3', '-1', 'abc'].map((v) => [v, tryCfg(v)]));
    check(AC, 'AI_MAX_INPUT_CHARS: 빈 값 8000, 1, 8000, 2000 은 받고 0, 8001, 0x10, 1.5, 1e3, -1, abc 는 기동 오류', got[''] === 8000 && got['1'] === 1 && got['8000'] === 8000 && got['2000'] === 2000 && ['0', '8001', '0x10', '1.5', '1e3', '-1', 'abc'].every((k) => got[k] === 'throw'), JSON.stringify(got));
    check(AC, `기본 모델 ${SONNET} (ANTHROPIC_MODEL 비움)`, readConfig({ ...base }).ai?.model === SONNET);
    const hk = rules.requestShape('claude-haiku-5-5');
    const other = rules.requestShape('claude-opus-5');
    check(AC, 'requestShape: haiku 는 disabled/low/폴백 없음, 그 밖 모델은 빈 칸', hk.thinking?.type === 'disabled' && !('fallbacks' in hk) && !hk.betas && Object.keys(other).length === 0, JSON.stringify({ hk, other }));
  }
  // env 상한을 낮춘 서버: 운영자 값이 그보다 크면 거절
  {
    const port2 = await freePort();
    const env2 = { ...env, PORT: String(port2), PUBLIC_URL: `http://127.0.0.1:${port2}`, AI_MAX_INPUT_CHARS: '100' };
    const nest2 = await createApp(readConfig(env2), { google: fakeGoogle });
    await nest2.listen(port2, '127.0.0.1');
    try {
      const login = await fetch(`http://127.0.0.1:${port2}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${port2}` }, body: `token=${ADMIN_TOKEN}` });
      const ck = (login.headers.get('set-cookie') ?? '').split(';')[0];
      const pg = await (await fetch(`http://127.0.0.1:${port2}/admin`, { headers: { cookie: ck } })).text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(pg)?.[1] ?? '';
      const post = (v) => fetch(`http://127.0.0.1:${port2}/v1/admin/ai/limits`, { method: 'POST', headers: { cookie: ck, 'x-csrf-token': csrf, origin: `http://127.0.0.1:${port2}`, 'content-type': 'application/json' }, body: JSON.stringify({ budget_usd: '', daily_limit: '', input_chars: v }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => undefined) }));
      const over = await post('101');
      const okv = await post('100');
      check(AC, 'AI_MAX_INPUT_CHARS=100 서버: 101 → 400 거절, 100 → ok, 화면 max=100', over.status === 400 && /100 이하/.test(over.json?.text ?? over.json?.message ?? JSON.stringify(over.json)) && okv.json?.ok === true && /max="100"/.test(pg), `${over.status} ${JSON.stringify(over.json)} ${JSON.stringify(okv.json)}`);
      await post('');
      // 같은 DB 를 쓰므로 본 서버의 상한(8000)으로 보면 setInputChars 는 다시 null
    } finally {
      await nest2.close().catch(() => {});
    }
  }
}

// 앱이 부르는 운영자 손잡이 도우미
async function openAdminWindow(h) {
  await h.main(`(() => { const e = ${ELECTRON}; const w = new e.BrowserWindow({ show: false, width: 1100, height: 1600, webPreferences: { partition: 'qa-admin-123' } }); globalThis.__qaAdmin = w; w.webContents.removeAllListeners('will-navigate'); w.loadURL(${JSON.stringify(`${apiUrl}/admin`)}); return true; })()`);
  const w = await h.target((u) => u.startsWith(`${apiUrl}/admin`));
  await until('운영자 로그인 폼', () => w.ev(`!!document.querySelector('input[name=token]')`), 15_000);
  await typeInto(w, 'input[name=token]', ADMIN_TOKEN);
  await w.ev(`(window.__qaNav = 1, document.querySelector('form[action="/admin/login"] button[type=submit]').click(), 1)`);
  await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  let viaForm = await soft(until('운영자 화면', () => w.ev(`!!document.querySelector('form[action="/admin/ai/limits"]')`), 5000));
  if (!viaForm) {
    note('웹 /admin', '숨은 창 로그인 폼으로 안 열림: 쿠키, Origin 을 고쳐 넣고 이어 간다');
    if (!web.cookie) await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
    await h.main(`(() => { const e = ${ELECTRON}; e.session.fromPartition('qa-admin-123').webRequest.onBeforeSendHeaders({ urls: [${JSON.stringify(`${apiUrl}/*`)}] }, (d, cb) => { const hd = d.requestHeaders; if (!hd.Cookie) hd.Cookie = ${JSON.stringify(web.cookie)}; if (hd.Origin === 'null') hd.Origin = ${JSON.stringify(apiUrl)}; cb({ requestHeaders: hd }); }); globalThis.__qaAdmin.loadURL(${JSON.stringify(`${apiUrl}/admin`)}); return true; })()`);
    viaForm = await soft(until('운영자 화면', () => w.ev(`!!document.querySelector('form[action="/admin/ai/limits"]')`), 15_000));
  }
  check('웹 /admin 클릭', '숨은 창에서 토큰 넣고 "로그인" → 운영자 화면 (채팅 이용권 예산 폼)', !!viaForm);
  return w;
}
/** 웹 /admin 예산 폼에서 글자 수 칸을 바꾸고 "예산 저장" 누르기. valid 는 브라우저 폼 검사 결과 */
async function webSetInputChars(w, value) {
  const r = await w.ev(`(() => { const f = document.querySelector('form[action="/admin/ai/limits"]'); if (!f) return { ok: false }; const i = f.querySelector('input[name=input_chars]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); const valid = f.checkValidity(); window.__qaNav = 1; f.querySelector('button[type=submit]').click(); return { ok: true, valid, msg: i.validationMessage }; })()`);
  if (r.valid) await soft(until('다시 그림', async () => (await w.ev('window.__qaNav === undefined && document.readyState === "complete"')) === true, 10_000));
  else await sleep(800);
  const flash = await w.ev(`document.querySelector('.flash')?.textContent ?? ''`);
  const hint = await w.ev(`[...document.querySelectorAll('p.hint')].map((p) => p.textContent).find((t) => t.includes('지금 쓰는 값')) ?? ''`);
  return { ...r, flash, hint };
}

// ================= 2. 앱 A: 허용된 18+ 사용자 =================
async function appA() {
  const h = await launch('A');
  const F = '앱 채팅';
  try {
    const p = await openSettings(h);
    const id0 = await firstRun(h, p, F, Q('질문러', 'Asker'));
    const subA = `qa-a-${randomBytes(4).toString('hex')}`;
    check(F, '"구글로 로그인" 누르기 (가짜 구글)', await clickLogin(h, p, subA));
    await soft(until('로그인', async () => (await h.status()).signedIn, 20_000));
    const id = sql(`SELECT id FROM account WHERE code = '${(await h.status()).code}'`);
    check(F, '로그인 뒤 계정 (앱 코드 = DB)', !!id && (await h.status()).signedIn, `${id0} → ${id}`);
    const al = await adminJson('ai/allow', { account: (await h.status()).code, allowed: '1' });
    check(F, '운영자가 허용 목록에 넣음', al.json?.ok === true, JSON.stringify(al.json));
    setTickets(id, 5);
    await clickSync(h, p);
    const c = await openChat(h);
    // 이용권 고르기 (클릭)
    await pressSel(c, '.picker-button');
    await sleep(300);
    const picked = await c.ev(`(() => { const b = [...document.querySelectorAll('.picker-menu [role=menuitemradio]')].find((x) => x.innerText.includes(${JSON.stringify(T.ticket)})); if (!b) return false; b.click(); return true; })()`);
    check(F, `AI 고르기 → "${T.ticket}" 클릭`, picked);
    await until('이용권 줄', () => c.ev(`!!document.querySelector('.ticket-bar')`));
    await c.shots('a01-ticket-notice');
    check(F, `국외 이전 안내 "${T.agree}" 누르기`, await press(c, '.ticket-notice', T.agree));
    await until('안내 닫힘', async () => !(await c.ev(`!!document.querySelector('.ticket-notice')`)));
    // 마지막 펫 말풍선 글을 바뀔 때마다 모은다 (중간 상태)
    await c.ev(`(() => { window.__qaSeq = []; const grab = () => { const m = [...document.querySelectorAll('.msg.pet')].at(-1); const t = m?.innerText ?? ''; if (window.__qaSeq.at(-1) !== t) window.__qaSeq.push(t); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`);
    const seq = async () => JSON.parse(await c.ev('JSON.stringify(window.__qaSeq)'));
    const type = (text) => c.ev(`(() => { const ta = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const sent = [];
    const sendQ = async (text, onStream) => {
      // 계정마다 1분 10번 (rate limit): 9번을 넘기면 기다린다
      const now = Date.now();
      const recent = sent.filter((t) => now - t < 62_000);
      if (recent.length >= 9) await sleep(62_000 - (now - recent[0]));
      sent.push(Date.now());
      await c.ev('(window.__qaSeq = [], 1)');
      await type(text);
      await sleep(150);
      const ok = await press(c, '.composer', T.send);
      if (onStream) await onStream();
      await soft(until('답 끝', async () => {
        const st = JSON.parse(await h.main('JSON.stringify(__jj.chat.debugState)'));
        return ok && !st.pendingId && ['done', 'error'].includes(st.messages.at(-1)?.status);
      }, 40_000));
      await sleep(500);
      return ok;
    };
    const lastMsg = () => c.ev(`[...document.querySelectorAll('.msg')].at(-1)?.innerText ?? ''`);
    const count = () => c.ev(`document.querySelector('.ticket-count')?.innerText ?? ''`);
    // 1) 정상
    {
      const n0 = fake.calls.length;
      check(F, '질문 쓰고 "보내기" 클릭', await sendQ(Q('안녕, 반가워', 'Hello there')));
      const m = await lastMsg();
      await soft(until('줄 4', async () => (await count()).includes(T.count(4)), 5000));
      check(F, '답 "안녕! 나는 AI 야." 화면, 남은 장수 5 → 4 (DB, 이용권 줄)', m.includes('안녕! 나는 AI 야.') && tickets(id) === 4 && (await count()).includes(T.count(4)), `${tickets(id)} ${await count()} | ${m.slice(0, 80)}`);
      const us = lastUsage(id);
      check(F, `ai_usage 비용 ${COST_OK} (Sonnet $2/$10, 120/30)`, us.status === 'ok' && us.model === SONNET && us.cost === COST_OK, JSON.stringify(us));
      const s = bodyShape(fake.calls[n0]);
      check(F, '앱 질문이 서버를 거쳐 간 본문 모양 (가짜 서버 위반 0)', shapeOk(s), JSON.stringify(s));
      await c.shots('a02-ticket-answer');
    }
    // 2) 서버 폴백: 중간 글 → reset → 새 답
    {
      let midShot = false;
      let midText = '';
      const ok = await sendQ(`[[fallback]] ${Q('이거 대답해 줄래?', 'Will you answer this?')}`, async () => {
        await soft(until('앞부분 글', async () => (midText = (await seq()).find((t) => t.includes('[A의 앞부분]')) ?? '') !== '', 8000));
        if (midText) {
          // 아직 지워지기 전이면 찍는다
          const now = await c.ev(`[...document.querySelectorAll('.msg.pet')].at(-1)?.innerText ?? ''`);
          if (now.includes('[A의 앞부분]')) {
            await c.shots('a03-fallback-mid');
            midShot = true;
          }
        }
      });
      check(F, '[[fallback]] 질문 보내기 클릭', ok);
      const all = await seq();
      const iMid = all.findIndex((t) => t.includes('[A의 앞부분]'));
      const iAfter = all.findIndex((t, i) => i > iMid && !t.includes('[A의 앞부분]'));
      const final = await lastMsg();
      check(F, '중간 상태: 앞부분 글 "[A의 앞부분]" 이 잠깐 보임', iMid >= 0, JSON.stringify(all).slice(0, 300));
      check(F, '중간 상태: reset 뒤 앞부분이 지워지고 새 답이 앞에 아무것도 없이 이어짐', iAfter > iMid && all.slice(iAfter).every((t) => !t.includes('[A의 앞부분]')) && all.slice(iAfter).some((t) => t.includes('안녕!')) && !all[iAfter].includes('안녕!'), JSON.stringify(all).slice(0, 400));
      check(F, '최종 화면: 새 답만 "안녕! 나는 AI 야.", 앞부분 없음', final.includes('안녕! 나는 AI 야.') && !final.includes('[A의'), final.slice(0, 100));
      const st = JSON.parse(await h.main('JSON.stringify(__jj.chat.debugState)'));
      const lastPet = st.messages.at(-1);
      check(F, '저장되는 대화 상태도 새 답만 (status done)', lastPet?.status === 'done' && lastPet.text === '안녕! 나는 AI 야.', JSON.stringify({ s: lastPet?.status, t: lastPet?.text }));
      await soft(until('줄 3', async () => (await count()).includes(T.count(3)), 5000));
      check(F, '[[fallback]] 이용권 1장 차감 (4 → 3, DB와 줄)', tickets(id) === 3 && (await count()).includes(T.count(3)), `${tickets(id)} ${await count()}`);
      const us = lastUsage(id);
      check(F, `[[fallback]] 장부 비용 홉별 합 ${COST_FALLBACK}`, us.status === 'ok' && us.cost === COST_FALLBACK, JSON.stringify(us));
      if (!midShot) note(F, '중간 상태 스크린샷은 못 찍음 (너무 빨리 지나감)');
      await c.shots('a04-fallback-final');
    }
    // 3) 실패들
    const fails = [
      ['[[fail]]', 'failed'],
      ['[[cut]]', 'failed'],
      ['[[sse-error]]', 'failed'],
      ['[[refusal]]', 'refusal'],
    ];
    const MSG = {
      failed: Q('채팅 이용권은 돌려놓았어', 'Your chat pass is back'),
      cut: Q('받은 데까지만 보여 줄게', 'Showing what arrived'),
      refusal: Q('답하지 않기로 했어', 'chose not to answer'),
    };
    for (const [tag, kind] of fails) {
      const t0 = tickets(id);
      await sendQ(`${tag} ${Q('질문', 'question')}`);
      const m = await lastMsg();
      const us = lastUsage(id);
      await sleep(400);
      check(F, `${tag}: 안내 "${MSG[kind]}", 이용권 ${t0} 그대로 (DB, 줄), ai_usage refunded`, m.includes(MSG[kind]) && tickets(id) === t0 && (await count()).includes(T.count(t0)) && us.status === 'refunded', `${tickets(id)} ${await count()} ${us.status} | ${m.replace(/\n/g, ' ').slice(0, 160)}`);
      await c.shots(`a05-${tag.replace(/\W/g, '')}`);
    }
    // 4) 웹 /admin 에서 글자 수 상한 클릭으로 바꾸기
    const W = '웹 /admin 클릭';
    const w = await openAdminWindow(h);
    {
      const r = await webSetInputChars(w, '30');
      check(W, '글자 수 칸 30 → "예산 저장" 클릭 → 결과 글 "질문 30자", DB 30, 안내 줄 "질문 30자 이하"', r.ok && r.valid && /질문 30자/.test(r.flash) && inputCharsDb() === '30' && r.hint.includes('질문 30자 이하'), JSON.stringify(r));
      const big = await webSetInputChars(w, '8001');
      check(W, '8001 → 브라우저 폼 검사가 막음 (보내지 않음), DB 30 그대로', big.ok && big.valid === false && inputCharsDb() === '30', JSON.stringify(big));
      const shot = await w.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(OUT, `w01-admin-limits-${LANG}.png`), Buffer.from(shot.result.data, 'base64'));
      await w.ev(`document.querySelector('form[action="/admin/ai/limits"]').scrollIntoView(), 1`);
      const clip = await w.ev(`(() => { const r = document.querySelector('form[action="/admin/ai/limits"]').getBoundingClientRect(); return { x: 0, y: r.y + window.scrollY - 40, width: 1100, height: r.height + 120, scale: 1 }; })()`);
      const s2 = await w.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
      writeFileSync(join(OUT, `w02-admin-limits-form-${LANG}.png`), Buffer.from(s2.result.data, 'base64'));
      const overflow = await w.ev(`(() => { const f = document.querySelector('form[action="/admin/ai/limits"]'); return [...f.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length; })()`);
      check('화면', 'w02 웹 /admin 예산 폼: 넘침 없음, 줄표 없음', overflow === 0 && !(await w.ev(`document.querySelector('form[action="/admin/ai/limits"]').innerText.includes('\\u2014')`)), `${OUT}/w02-admin-limits-form-${LANG}.png`);
    }
    // 5) 앱에서 긴 질문 → too_long, 이용권 그대로
    {
      // 새 대화 (기록 없음) 에서 앱이 질문에 덧붙이는 글(지금 시각 줄, 머리) 길이를 잰다
      check(F, '"새 대화" 누르기', await pressSel(c, '.new-chat'));
      await soft(until('비움', async () => (await c.ev(`document.querySelectorAll('.msg').length`)) === 0, 5000));
      await webSetInputChars(w, '');
      const q0 = Q('하나둘셋넷다섯', 'onetwothree');
      await sendQ(q0);
      const b0 = chatBodies.at(-1);
      const overhead = (b0?.total ?? 0) - q0.length;
      note(F, `앱이 보낸 첫 질문: 메시지 ${b0?.n}개, 글자 ${b0?.total} (사용자 글 ${q0.length}, 덧붙인 글 ${overhead}: ${JSON.stringify(b0?.last.slice(0, 80))})`);
      check(F, '앱은 질문 앞에 지금 시각 줄과 머리를 붙여 보낸다 (상한은 이 글을 세지 않는다)', overhead > 0, overhead);
      check(F, '"새 대화" 누르기 (둘째)', await pressSel(c, '.new-chat'));
      await soft(until('비움', async () => (await c.ev(`document.querySelectorAll('.msg').length`)) === 0, 5000));
      // 상한은 사용자가 친 글만 센다: 앱이 덧붙인 글(overhead)은 세지 않는다
      const cap = 30;
      const r = await webSetInputChars(w, String(cap));
      check(W, `웹 /admin 글자 수 ${cap} 클릭 저장 (덧붙인 글 ${overhead}자보다 작다)`, inputCharsDb() === String(cap), JSON.stringify(r));
      const t0 = tickets(id);
      const n0 = fake.calls.length;
      await sendQ(Q('가', 'a').repeat(31));
      const m = await lastMsg();
      check(F, `상한 ${cap}, 사용자 글 31자 → "질문이 너무 길어" 안내, 이용권 그대로, 업스트림 0건, 서버 400`, m.includes(Q('질문이 너무 길어', 'too long')) && tickets(id) === t0 && fake.calls.length === n0 && chatBodies.at(-1)?.status === 400, `${tickets(id)} ${JSON.stringify(chatBodies.at(-1))} | ${m.replace(/\n/g, ' ').slice(0, 120)}`);
      await c.shots('a06-too-long');
      await sendQ(Q('가', 'a').repeat(30));
      const m2 = await lastMsg();
      check(F, '같은 창 사용자 글 30자 (경계) → 답, 1장 차감', m2.includes('안녕! 나는 AI 야.') && tickets(id) === t0 - 1, `${tickets(id)} ${JSON.stringify(chatBodies.at(-1))} | ${m2.slice(0, 80)}`);
      const t1 = tickets(id);
      await sendQ(Q('나', 'b').repeat(10));
      const m3 = await lastMsg();
      const tooLong3 = m3.includes(Q('질문이 너무 길어', 'too long'));
      check(F, `상한 ${cap}, 사용자 글 10자 + 앞 문답 2개 + 덧붙인 글 → 질문은 상한 안이니 답해야 함`, !tooLong3 && m3.includes('안녕! 나는 AI 야.'), `${tooLong3 ? '실제: "질문이 너무 길어" 안내' : 'ok'}, 서버가 받은 ${JSON.stringify({ n: chatBodies.at(-1)?.n, total: chatBodies.at(-1)?.total, status: chatBodies.at(-1)?.status })}, 이용권 ${t1} → ${tickets(id)}`);
      await c.shots('a07-too-long-history');
      const r2 = await webSetInputChars(w, '');
      check(W, '빈 칸 → "예산 저장" 클릭 → DB NULL, 안내 줄 "질문 8000자 이하"', inputCharsDb() === 'NULL' && r2.hint.includes('질문 8000자 이하'), JSON.stringify(r2));
    }
    await h.main('globalThis.__qaAdmin?.destroy(); 1');
    c.close();
    p.close();
  } catch (err) {
    check('앱 A', '중단', false, err instanceof Error ? err.stack : String(err));
    try {
      console.log(readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').slice(-30).join('\n'));
    } catch {}
  } finally {
    await h.quit();
  }
}

// ================= 3. 앱 C: 운영자 칸 =================
async function appC() {
  const h = await launch('C');
  const F = '앱 운영자 칸';
  try {
    const p = await openSettings(h);
    await firstRun(h, p, F, Q('운영자', 'Admin'));
    check(F, '"구글로 로그인" (운영자 sub)', await clickLogin(h, p, ADMIN_SUB));
    await soft(until('운영자 칸', () => p.ev(`!!document.querySelector('.admin-box .admin-group')`), 20_000));
    const labels = await p.ev(`(() => { const g = ${G(T.gFeat)}; return [...(g?.querySelectorAll('label') ?? [])].map((l) => l.innerText.trim().replace(/\\n/g, ' ')); })()`);
    const hasField = labels.some((x) => /글자|characters|chars/i.test(x));
    check(F, '채팅 이용권 묶음에 "질문 글자 수" 칸이 있어 클릭으로 바꿀 수 있음', hasField, `칸: ${JSON.stringify(labels)}`);
    await p.shots('c01-admin-ai', '.admin-box');
    // 운영자가 웹에서 500 으로 정해 둔 뒤 앱 칸에서 예산만 저장하면?
    await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '500' });
    await clearFlash(p);
    check(F, '앱 칸 "예산 저장" 클릭 (월 예산 칸 50)', (await adminType(p, T.gFeat, Q('월 예산 달러 (상한 $80.00)', 'Monthly budget USD (cap $80.00)'), '50')) && (await adminPress(p, T.gFeat, Q('예산 저장', 'Save budget'))));
    const fl = await waitFlash(p, Q('저장', 'saved'));
    await soft(until('예산', () => sql('SELECT COALESCE(monthly_budget_micros::text, \'NULL\') FROM ai_setting WHERE id = 1') === '50000000', 8000));
    check(F, '앱 칸 예산 저장: 월 예산 50 (DB), 운영자가 정한 글자 수 500 은 그대로여야 함', sql('SELECT monthly_budget_micros FROM ai_setting WHERE id = 1') === '50000000' && inputCharsDb() === '500', `budget=${sql('SELECT COALESCE(monthly_budget_micros::text, \'NULL\') FROM ai_setting WHERE id = 1')} input_chars=${inputCharsDb()} 결과 글 "${fl}"`);
    await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '' });
    p.close();
  } catch (err) {
    check('앱 C', '중단', false, err instanceof Error ? err.stack : String(err));
  } finally {
    await h.quit();
  }
}

let crashed = false;
const only = new Set((process.env.QA_ONLY ?? 'api,a,c').split(','));
try {
  if (only.has('api')) await apiLayer();
  else {
    await adminPost('/admin/login', { token: ADMIN_TOKEN }, { csrf: false });
    await adminPage();
  }
  await setMode('allowlist');
  await adminJson('ai/limits', { budget_usd: '', daily_limit: '', input_chars: '' });
  if (only.has('a')) await appA();
  if (only.has('c')) await appC();
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
for (const a of apps) if (!a.exited) await a.quit().catch(() => {});
await nest.close().catch(() => {});
relay.close();
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
