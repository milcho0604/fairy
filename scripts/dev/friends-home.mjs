// 큰 창 친구 구역 앱 통합 시험: 시험 Postgres + 서버(이 프로세스 안, 가짜 구글) + 앱 둘(두 계정)을 CDP 로 움직여
// 큰 창 "친구" 구역에서 신청, 거절, 수락, 바쁜 시간과 일정 제목 공유 스위치, 끊기, 보낸 신청 거두기를 실제 IPC 로 한다 (PASS/FAIL).
// 못 쓰는 까닭(나이, 운영자가 안 엶)도 실제 상태로 보고, 여러 명과 놀러 가기 스위치는 debugFriendsView 로 모양만 본다.
// 설정 창은 서버 계정 가입에만 쓴다. 친구 기능은 모두 큰 창에서.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/friends-home.mjs
//
// 시험 창 규칙과 정리는 friends.mjs 와 같다 (JJ_NO_FOCUS, 빈 JJ_USER_DATA, 컨테이너 --tmpfs 와 rm -f -v, 포트 9900~9949).
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { setLang, t } from '../../src/shared/i18n/index.ts';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
setLang(LANG);
const OUT = resolve(process.env.OUT ?? join(tmpdir(), `friends-${LANG}`));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 시험 포트는 9900~9949 안에서 무작위로 (비어 있는 것만)
const freePort = () =>
  new Promise((r) => {
    const tryPort = () => {
      const port = 9900 + Math.floor(Math.random() * 50);
      const s = createServer();
      s.once('error', tryPort);
      s.listen(port, '127.0.0.1', () => s.close(() => r(port)));
    };
    tryPort();
  });

const results = [];
function check(area, name, ok, extra = '') {
  results.push({ area, name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${extra ? ` (${String(extra).slice(0, 200)})` : ''}`);
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

// ---- 시험용 Postgres ----
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pgName = `jj-friends-pg-${randomBytes(4).toString('hex')}`;
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
// 채팅 이용권 선물까지 보려고 채팅 이용권을 모두에게 연다 (정기 지급 자리는 시험과 상관없다)
sql(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);

// ---- 가짜 구글 (id_token 을 시험 키로 서명) ----
const CLIENT_ID = 'qa-client.apps.googleusercontent.com';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'fr1', alg: 'RS256', use: 'sig' };
const google = { sub: '', nonce: '' };
const idToken = (sub, nonce) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'fr1', typ: 'JWT' });
  const body = enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, nonce, iat: now, exp: now + 3600 });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url')}`;
};
const fakeGoogle = {
  async exchangeCode() {
    return idToken(google.sub, google.nonce);
  },
  async fetchJwks() {
    return [jwk];
  },
};

// ---- 홈페이지 흉내 (events.json, notices.json, 최신 릴리스) ----
const stat = httpServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/events.json')) return res.end('{"version":1,"events":[]}');
  if (req.url?.startsWith('/notices.json')) return res.end('{"version":1,"notices":[]}');
  if (req.url?.startsWith('/latest')) return res.end(JSON.stringify({ tag_name: 'v0.4.3', body: '', html_url: 'https://example.invalid' }));
  res.statusCode = 404;
  res.end('{}');
});
const staticPort = await freePort();
await new Promise((r) => stat.listen(staticPort, '127.0.0.1', r));
const staticUrl = `http://127.0.0.1:${staticPort}`;

// ---- 페어리 서버 (이 프로세스 안) ----
const serverReq = createRequire(join(root, 'server', 'package.json'));
const { createApp } = serverReq('./dist/app.js');
const { readConfig } = serverReq('./dist/config.js');
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const nest = await createApp(
  readConfig({
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    PUBLIC_URL: apiUrl,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'qa-secret',
    // 친구 기능은 기본 allowlist 그대로 두고 시험 중에 모두로 바꾼다 (기본이면 칸이 숨는지 본다).
    // 선물과 일정, 이용권 선물은 처음부터 모두 (이용권 선물 칸까지 보려고)
    FEATURE_FRIEND_GIFTS: 'everyone',
    FEATURE_FRIEND_CALENDAR: 'everyone',
    FEATURE_FRIEND_GIFT_PASSES: 'everyone',
  }),
  { google: fakeGoogle },
);
await nest.listen(apiPort, '127.0.0.1');
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function browserFlow(startUrl, sub) {
  const from = ip();
  const s = await fetch(startUrl, { redirect: 'manual', headers: { 'cf-connecting-ip': from } });
  const g = new URL(s.headers.get('location') ?? '');
  google.sub = sub;
  google.nonce = g.searchParams.get('nonce') ?? '';
  const cb = await fetch(`${apiUrl}/auth/google/callback?state=${g.searchParams.get('state')}&code=fake-code`, {
    redirect: 'manual',
    headers: { 'cf-connecting-ip': from },
  });
  return cb.headers.get('location') ?? '';
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

const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.friends-'));
const apps = [];
async function launch(name) {
  const inspect = await freePort();
  const pageP = await freePort();
  const scratch = mkdtempSync(join(scratchAll, `${name}-`));
  const data = join(scratch, 'data');
  const home = join(scratch, 'home');
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, panelView: 'window' }));
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
          const [x] = await (await fetch(`http://127.0.0.1:${inspect}/json/list`)).json();
          h.mainConn = await connect(x.webSocketDebuggerUrl);
        } catch {
          await sleep(250);
        }
      }
    }
    const m = await h.mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails)
      throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  h.page = async (pname, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${pageP}/json`)).json();
        const p = list.find((x) => x.type === 'page' && x.url.includes(`${pname}.html`));
        if (p) {
          const c = await connect(p.webSocketDebuggerUrl);
          const ev = async (expr) => {
            const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (m.result?.exceptionDetails)
              throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
            return m.result?.result?.value;
          };
          return { ev, send: c.send, close: () => c.ws.close(), shots: (file, sel) => shots(c, ev, file, sel) };
        }
      } catch {}
      await sleep(250);
    }
    throw new Error(`no page ${pname}`);
  };
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
  await h.main(`(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); e.shell.openExternal = async (u) => { globalThis.__qaOpened = u; }; globalThis.__qaClip = []; e.clipboard.writeText = (x) => { globalThis.__qaClip.push(x); }; return true; })()`);
  h.status = async () => JSON.parse(await h.main('JSON.stringify(__jj.server.core.status())'));
  h.balance = () => h.main('__jj.store.balance()');
  h.clip = async () => JSON.parse(await h.main('JSON.stringify(globalThis.__qaClip)')).at(-1);
  return h;
}

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
      ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4 + window.scrollY), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, 6000) }; })()`)
      : null;
    await sleep(150);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 2 }, captureBeyondViewport: true } : {}) });
    writeFileSync(join(OUT, `${file}-${LANG}-${mode}.png`), Buffer.from(r.result.data, 'base64'));
  }
  await c.send('Emulation.setEmulatedMedia', { features: [] });
  if (grow) await c.send('Emulation.clearDeviceMetricsOverride');
  const a = await ev(`(() => {
    const el = ${sel ? `document.querySelector(${JSON.stringify(sel)})` : 'document.body'};
    if (!el) return { missing: true };
    const over = [...el.querySelectorAll('*')].filter((x) => { const cs = getComputedStyle(x); const rr = x.getBoundingClientRect(); if (rr.width <= 1 || rr.height <= 1 || (cs.position === 'absolute' && cs.clip !== 'auto')) return false; if (/(auto|scroll)/.test(cs.overflowX) || x.tagName === 'INPUT') return false; return x.scrollWidth > x.clientWidth + 1 && cs.overflowX !== 'visible' ? true : rr.right > document.documentElement.clientWidth + 1; }).map((x) => (typeof x.className === 'string' && x.className) || x.tagName).slice(0, 5);
    const text = el.innerText;
    const emptyBtn = [...el.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length;
    return { over, hangul: (text.match(/[\\uAC00-\\uD7A3]+/g) ?? []).slice(0, 8), emdash: text.includes('\\u2014'), emptyBtn };
  })()`);
  if (a?.missing) issues.push('요소 없음');
  else {
    if (a.over.length) issues.push(`넘침 ${a.over.join(',')}`);
    // 영어판 한글: 닉네임(시험이 넣은 한글)은 빼고 본다
    const hangul = a.hangul.filter((w) => !NICKS.some((n) => n.includes(w)));
    if (LANG === 'en' && hangul.length) issues.push(`영어판 한글 ${hangul.join(' ')}`);
    if (a.emdash) issues.push('줄표');
    if (a.emptyBtn) issues.push(`빈 단추 ${a.emptyBtn}`);
  }
  check('화면', `${file} (light, dark)`, issues.length === 0, issues.join('; ') || `${OUT}/${file}-${LANG}-{light,dark}.png`);
}

// ---- 화면 도우미 ----
const NICKS = LANG === 'ko' ? ['하늘', '바다'] : ['Sky', 'Sea'];
const L = {
  adult: t('server.age.adult'),
  start: t('server.nickname.start'),
  login: t('server.login'),
  syncNow: t('server.syncNow'),
  openNow: t('note.openNow'),
};
const press1 = (p, scope, text) =>
  p.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const press = async (p, scope, text, ms = 6000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await press1(p, scope, text)) return true;
    await sleep(250);
  }
  return false;
};
const typeInto = (p, sel, value) =>
  p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const watchFlash = (p) =>
  p.ev(`(() => { window.__qaFlash = []; const grab = () => { const x = document.querySelector('header .saved')?.textContent?.trim(); if (x && window.__qaFlash.at(-1) !== x) window.__qaFlash.push(x); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`);
const flashes = (p) => p.ev('JSON.stringify(window.__qaFlash ?? [])').then((x) => JSON.parse(x));
async function waitFlash(p, needle, ms = 12_000) {
  let got = [];
  await soft(until(`결과 글 ${needle}`, async () => (got = await flashes(p)).some((x) => x.includes(needle)), ms));
  return got.find((x) => x.includes(needle)) ?? `없음: ${got.join(' / ')}`;
}
/** 친구 칸 안에서 이름이 든 줄의 단추 */
const rowPress = (p, name, text) =>
  p.ev(`(() => { const li = [...document.querySelectorAll('.friends-list > li')].find((x) => x.querySelector('.friends-name')?.textContent === ${JSON.stringify(name)}); const b = [...(li?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const rowPressWait = async (p, name, text, ms = 8000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await rowPress(p, name, text)) return true;
    await sleep(250);
  }
  return false;
};
const boxText = (p) => p.ev(`document.querySelector('.friends-box')?.innerText ?? ''`);

async function openSettings(h) {
  await h.main("__jj.settingsWindow.open('friends')");
  const p = await h.page('settings');
  await until('설정', () => p.ev(`!!document.querySelector('.settings')`));
  await watchFlash(p);
  return p;
}
async function clickSync(h, p) {
  const before = (await h.status()).lastSyncAt;
  await press(p, '.server-box', L.syncNow, 10_000);
  await soft(until('맞추기 끝', async () => {
    const s = await h.status();
    return !s.syncing && (s.lastSyncAt !== before || s.problem);
  }, 20_000));
  await sleep(400);
}
/** 처음 켜기 (나이, 닉네임, 기기 계정) → 구글로 로그인 (모두 화면 단추) */
async function signUp(h, p, F, nick, sub) {
  await until('서버 칸', () => p.ev(`!!document.querySelector('.server-box')`));
  check(F, '"만 18세 이상" 누르기', await press(p, '.server-box', L.adult));
  await until('닉네임 칸', () => p.ev(`!!document.querySelector('.server-nickname-step input')`), 10_000);
  await typeInto(p, '.server-nickname-step input', nick);
  check(F, '닉네임 넣고 서버 계정 시작', await press(p, '.server-box', L.start));
  await until('기기 계정', async () => {
    const s = await h.status();
    return s.device && s.code && !s.syncing;
  }, 30_000);
  await h.main('globalThis.__qaOpened = null');
  check(F, '"구글로 로그인" 누르기', await press(p, '.server-box', L.login));
  let u;
  await until('브라우저 열기', async () => (u = await h.main('globalThis.__qaOpened ?? null')), 15_000);
  const done = await browserFlow(u, sub);
  await fetch(done).catch(() => undefined);
  await until('로그인', async () => (await h.status()).signedIn, 20_000);
  const s = await h.status();
  check(F, '로그인 세션', s.signedIn && !!s.code, s.code);
  return { code: s.code, id: sql(`SELECT id FROM account WHERE code = '${s.code}'`) };
}


/**
 * 펫이 든 쪽지 펼치기: "펼쳐 보기" 말풍선이 있으면 그 단추, 없으면(말을 걸 때가 아니라 들고만 있으면) 펫을 CDP 마우스로 누른다
 */
async function openPetNote(h, F) {
  const pet = await h.page('pet');
  const bubble = await soft(
    until('펫 쪽지 말풍선', () => pet.ev(`(() => { const x = document.getElementById('bubble'); return !x.hidden && [...x.querySelectorAll('.actions button')].some((y) => y.textContent.trim() === ${JSON.stringify(L.openNow)}); })()`), 20_000),
  );
  const held = await h.main('__jj.dailyNotes.holding()');
  check(F, '펫이 쪽지를 들고 옴 (말풍선이나 손에 든 쪽지)', bubble === true || held === true, `말풍선 ${bubble} 듦 ${held}`);
  if (bubble === true) {
    check(F, `말풍선 "${L.openNow}" 누르기`, await pet.ev(`(() => { const y = [...document.querySelectorAll('#bubble .actions button')].find((x) => x.textContent.trim() === ${JSON.stringify(L.openNow)}); if (!y) return false; y.click(); return true; })()`));
  } else {
    const pt = await pet.ev(`(() => { const c = document.getElementById('pet'); const g = c.getContext('2d'); const r = c.getBoundingClientRect(); const d = g.getImageData(0, 0, c.width, c.height).data; for (let y = c.height / 2 | 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 200) return { x: r.left + x * r.width / c.width, y: r.top + y * r.height / c.height }; return null; })()`);
    if (pt) {
      await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      check(F, '쪽지를 든 펫 누르기 (CDP 마우스)', true);
    } else {
      // 펫이 쉬는 중이면(컴퓨터가 바쁨: 시험 컨테이너와 앱 둘) 그림이 비어 누를 곳이 없다. 펫을 눌렀을 때 부르는 것을 그대로 부른다
      console.log('  (펫 그림이 비어 펫 누르기 손잡이로 펼침: __jj.serverInbox.openNext)');
      await h.main('__jj.serverInbox.openNext().then(() => 1)');
    }
  }
  return pet;
}

// ================= 큰 창 도우미 =================
const watchFlashHome = (p) =>
  p.ev(`(() => { window.__qaFlash = []; const grab = () => { const x = document.querySelector('.fp-flash')?.textContent?.trim(); if (x && window.__qaFlash.at(-1) !== x) window.__qaFlash.push(x); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`);
const fp = (p) => p.ev(`document.querySelector('.fp')?.dataset.state ?? null`);
const reasonOf = (p) => p.ev(`document.querySelector('.fp-off')?.dataset.reason ?? null`);
async function openHome(h) {
  await h.main(`__jj.panel.openTab('friends'); 1`);
  await until('큰 창', () => h.main('!!__jj.home?.window && !__jj.home.window.isDestroyed()'), 20_000);
  await sleep(800);
  await h.main('__jj.home.window.setSize(1100, 780); 1');
  const p = await h.page('home');
  await until('친구 구역', () => p.ev(`!!document.querySelector('.fp')`), 15_000);
  await watchFlashHome(p);
  return p;
}
const setWidth = async (h, w) => {
  await h.main(`__jj.home.window.setSize(${w}, 780); 1`);
  await sleep(500);
};
/** 좁은(760)과 넓은(1440) x 밝음과 어두움으로 찍고 가로 넘침을 센다 */
async function homeShots(h, p, name) {
  const issues = [];
  for (const [w, label] of [[760, 'narrow'], [1440, 'wide']]) {
    await setWidth(h, w);
    for (const mode of ['light', 'dark']) {
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
      await sleep(250);
      const over = await p.ev(`[...document.querySelectorAll('.fp, .fp *')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 1 && r.right > innerWidth + 1 && !(cs.position === 'absolute' && cs.clip !== 'auto'); }).length`);
      if (over) issues.push(`${label} ${mode} 넘침 ${over}`);
      const r = await p.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `friends-home-${name}-${LANG}-${label}-${mode}.png`), Buffer.from(r.result.data, 'base64'));
    }
    await p.send('Emulation.setEmulatedMedia', { features: [] });
  }
  await setWidth(h, 1100);
  const text = await p.ev(`document.querySelector('.fp')?.innerText ?? ''`);
  if (LANG === 'en') {
    const hangul = (text.match(/[가-힣]+/g) ?? []).filter((x) => !NICKS.some((n) => n.includes(x)));
    if (hangul.length) issues.push(`영어판 한글 ${hangul.slice(0, 4).join(' ')}`);
  }
  if (text.includes('\u2014')) issues.push('줄표');
  check('화면', `${name} (좁음, 넓음 x 밝음, 어두움)`, issues.length === 0, issues.join('; ') || `${OUT}/friends-home-${name}-${LANG}-*.png`);
}
const flashHome = async (p, needle, ms = 12_000) => {
  let got = [];
  await soft(until(`결과 글 ${needle}`, async () => (got = JSON.parse(await p.ev('JSON.stringify(window.__qaFlash ?? [])'))).some((x) => x.includes(needle)), ms));
  return got.find((x) => x.includes(needle)) ?? `없음: ${got.join(' / ')}`;
};
const homeLi = (p, name) => p.ev(`[...document.querySelectorAll('.friends-list > li')].some((x) => x.querySelector('.friends-name')?.textContent === ${JSON.stringify(name)})`);

// ================= 흐름 =================
async function flow() {
  const [a, b] = await Promise.all([launch('a'), launch('b')]);
  try {
    // --- 가입 전: 큰 창 친구 구역은 까닭을 보인다 (실제 상태) ---
    const ha = await openHome(a);
    const hb = await openHome(b);
    {
      const F = '못 쓸 때';
      check(F, '가입 전: 친구 구역이 보이고 까닭은 age', (await fp(ha)) === 'off' && (await reasonOf(ha)) === 'age', `${await fp(ha)} ${await reasonOf(ha)}`);
      check(F, '"설정 열기" 단추가 앱 단추(.ghost)다', await ha.ev(`document.querySelector('.fp-off button')?.classList.contains('ghost') === true && getComputedStyle(document.querySelector('.fp-off button')).borderTopWidth === '1px'`));
      await homeShots(a, ha, 'off-age');
    }
    const pa = await openSettings(a);
    const pb = await openSettings(b);
    const A = await signUp(a, pa, '가입 A', NICKS[0], `sub-a-${randomBytes(4).toString('hex')}`);
    const B = await signUp(b, pb, '가입 B', NICKS[1], `sub-b-${randomBytes(4).toString('hex')}`);
    sql(`UPDATE inbox SET opened_at = now(), opened_coins = 0, opened_passes = 0 WHERE opened_at IS NULL`);
    for (const h of [a, b]) await h.main('__jj.serverInbox.refresh().then(() => 1)');
    {
      const F = '못 쓸 때';
      await soft(until('featureOff', async () => (await reasonOf(ha)) === 'featureOff', 10_000));
      check(F, '로그인했지만 운영자가 안 열었다: featureOff', (await reasonOf(ha)) === 'featureOff', await reasonOf(ha));
      await homeShots(a, ha, 'off-feature');
    }
    // --- 운영자가 연다 -> 친구 구역이 칸으로 바뀐다 ---
    {
      const F = '열림';
      sql(`INSERT INTO feature_flag (key, mode) VALUES ('friends', 'everyone') ON CONFLICT (key) DO UPDATE SET mode = 'everyone'`);
      await sleep(5500);
      await clickSync(a, pa);
      await clickSync(b, pb);
      for (const [h, p, who] of [[a, ha, 'A'], [b, hb, 'B']])
        check(F, `${who} 큰 창 친구 구역에 내 코드가 보인다`, (await soft(until('칸', () => p.ev(`!!document.querySelector('.fp .friends-box .friends-code')`), 20_000))) === true);
      check(F, '친구가 0명이면 안내 글', (await ha.ev(`document.querySelector('.fp .friends-box')?.innerText ?? ''`)).includes(t('friends.none')));
      check(F, '읽기 전용 안내와 "설정에서 관리" 단추가 없다', !(await ha.ev(`document.querySelector('.fp')?.innerText ?? ''`)).includes(LANG === 'ko' ? '설정에서 관리' : 'Manage in Settings') && (await ha.ev(`!document.querySelector('.fp-manage')`)));
      check(F, '놀러 가기 스위치는 운영자가 안 열었으니 없다', await ha.ev(`!document.querySelector('.friends-visit')`));
      await homeShots(a, ha, 'empty');
    }
    // --- 신청 (큰 창에서 코드 붙여 넣기) ---
    {
      const F = '신청';
      check(F, 'B 큰 창: 초대 링크 복사 단추', await press(hb, '.fp .friends-box', t('friends.copyLink')));
      await soft(until('클립보드', async () => (await b.clip())?.includes('/f/'), 5000));
      check(F, '복사한 링크에 내 코드', (await b.clip()) === `https://fairy.moilga.com/f/${B.code}/`, await b.clip());
      check(F, 'B 큰 창에서 A 코드 붙여 넣기', await typeInto(hb, '.fp .friends-input', A.code));
      check(F, 'B "신청" 누르기', await press(hb, '.fp .friends-box', t('friends.send')));
      const f = await flashHome(hb, t('friends.sent'));
      check(F, '큰 창에 결과 글(신청을 보냈어)', f === t('friends.sent'), f);
      check(F, 'DB: B -> A 신청 하나', sql(`SELECT count(*) FROM friend_request WHERE from_account = ${B.id} AND to_account = ${A.id}`) === '1');
      await soft(until('보낸 신청', async () => (await hb.ev(`document.querySelector('.fp')?.innerText ?? ''`)).includes(t('friends.outgoing')), 8000));
      await homeShots(b, hb, 'outgoing');
    }
    // --- 거절 ---
    {
      const F = '거절';
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('받은 신청', () => homeLi(ha, NICKS[1]), 10_000));
      await homeShots(a, ha, 'incoming');
      check(F, 'A 큰 창 받은 신청 줄에서 "거절"', await rowPressWait(ha, NICKS[1], t('friends.decline')));
      const f = await flashHome(ha, t('friends.declined'));
      check(F, '거절 안내', f === t('friends.declined'), f);
      check(F, 'DB: 거절됨 한 줄(서버는 다시 보내기를 막으려고 남김), 친구 없음', sql(`SELECT count(*) FROM friend_request WHERE status = 'declined'`) === '1' && sql(`SELECT count(*) FROM friend`) === '0');
    }
    // --- A 가 B 에게 신청, B 가 큰 창에서 수락 ---
    {
      const F = '수락';
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await typeInto(ha, '.fp .friends-input', B.code);
      check(F, 'A 큰 창에서 "신청"', await press(ha, '.fp .friends-box', t('friends.send')));
      await flashHome(ha, t('friends.sent'));
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('받은 신청', () => homeLi(hb, NICKS[0]), 10_000));
      check(F, 'B 큰 창에서 "받기"', await rowPressWait(hb, NICKS[0], t('friends.accept')));
      const f = await flashHome(hb, t('friends.accepted'));
      check(F, '친구가 됐어 안내', f === t('friends.accepted'), f);
      check(F, 'DB: 친구 두 줄, 대기 신청 없음', sql(`SELECT count(*) FROM friend`) === '2' && sql(`SELECT count(*) FROM friend_request WHERE status <> 'declined'`) === '0');
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('A 친구 줄', () => homeLi(ha, NICKS[1]), 10_000));
      check(F, 'A 큰 창 친구 목록에도 B', await homeLi(ha, NICKS[1]));
    }
    // --- 스위치: 바쁜 시간, 일정 제목 ---
    {
      const F = '스위치';
      check(F, '바쁜 시간 스위치 (켜기)', await ha.ev(`(() => { const x = document.querySelector('.fp .friends-share input'); if (!x || x.checked) return false; x.click(); return true; })()`));
      const on = await flashHome(ha, t('friends.shareOn'));
      check(F, '켬 안내', on === t('friends.shareOn'), on);
      check(F, 'DB: A -> B share_busy', sql(`SELECT count(*) FROM friend WHERE account_id = ${A.id} AND share_busy`) === '1');
      await soft(until('제목 스위치', () => ha.ev(`!!document.querySelector('.fp .friends-titleshare input')`), 8000));
      check(F, '일정 제목 스위치 (켜기)', await ha.ev(`(() => { const x = document.querySelector('.fp .friends-titleshare input'); if (!x || x.checked) return false; x.click(); return true; })()`));
      const tt = await flashHome(ha, t('friends.shareTitleOn'));
      check(F, '제목 켬 안내', tt === t('friends.shareTitleOn'), tt);
      check(F, 'DB: share_title', sql(`SELECT count(*) FROM friend WHERE account_id = ${A.id} AND share_title`) === '1');
      await homeShots(a, ha, 'friend-switches');
      check(F, '바쁜 시간 스위치 끄기 -> 제목도 함께 꺼짐', await ha.ev(`(() => { const x = document.querySelector('.fp .friends-share input'); if (!x || !x.checked) return false; x.click(); return true; })()`));
      const off = await flashHome(ha, t('friends.shareOff'));
      check(F, '끔 안내', off === t('friends.shareOff'), off);
      check(F, 'DB: 둘 다 꺼짐', sql(`SELECT count(*) FROM friend WHERE account_id = ${A.id} AND (share_busy OR share_title)`) === '0');
    }
    // --- 끊기 ---
    {
      const F = '끊기';
      check(F, 'A 큰 창: "끊기" 한 번 -> "정말 끊기"', await rowPressWait(ha, NICKS[1], t('friends.remove')));
      check(F, '두 번째 누르기', await rowPressWait(ha, NICKS[1], t('friends.removeSure')));
      const f = await flashHome(ha, t('friends.removed'));
      check(F, '끊음 안내', f === t('friends.removed'), f);
      check(F, 'DB: 친구 없음', sql(`SELECT count(*) FROM friend`) === '0');
    }
    // --- 보낸 신청 거두기 ---
    {
      const F = '거두기';
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await typeInto(ha, '.fp .friends-input', B.code);
      await press(ha, '.fp .friends-box', t('friends.send'));
      await soft(until('보낸 신청 줄', () => homeLi(ha, NICKS[1]), 10_000));
      check(F, 'A 큰 창 보낸 신청 줄에서 "거두기"', await rowPressWait(ha, NICKS[1], t('friends.cancel')));
      await soft(until('거둠', async () => sql(`SELECT count(*) FROM friend_request WHERE from_account = ${A.id}`) === '0', 8000));
      check(F, 'DB: A 가 보낸 신청 없음', sql(`SELECT count(*) FROM friend_request WHERE from_account = ${A.id}`) === '0');
    }
    // --- 여러 명과 놀러 가기 스위치 (모양만 흉내 낸 상태) ---
    {
      const F = '여러 명';
      const person = (n, nick) => ({ code: `F-${String(n).padStart(4, '0')}-ABCD`, nickname: nick });
      const fr = (n, nick, o = {}) => ({ ...person(n, nick), since: new Date(Date.now() - n * 9 * 86_400_000).toISOString(), iShare: false, theyShare: false, busyAt: null, iVisit: false, theyVisit: false, canTitle: true, iTitle: false, theyTitle: false, ...o });
      const many = {
        available: true, off: null, problem: null, gifts: true, passGifts: false, calendar: true, visit: true, visitCustom: false, balance: 100, passes: 0, prefill: null,
        list: { me: person(1, 'me'), friends: [fr(2, NICKS[0], { iShare: true, theyShare: true, iVisit: true, iTitle: true }), fr(3, LANG === 'ko' ? '아주 아주 긴 이름을 가진 친구 펫 주인 님' : 'A friend with a really very long display name here'), fr(4, null, { theyShare: true, theyVisit: true }), fr(5, NICKS[1])], incoming: [{ id: 1, ...person(20, 'Mo'), sentAt: '', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }], outgoing: [{ id: 2, ...person(21, 'Out'), sentAt: '', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }], blocked: [], limits: { friends: 30, giftCoinsPerDay: 100, giftPassesPerDay: 1, requestDays: 7, busyDays: 14 }, today: { coins: 0, passes: 0 } },
      };
      await a.main(`__jj.server.debugFriendsView(${JSON.stringify(many)})`);
      await sleep(600);
      check(F, '친구 네 줄과 받은 신청 한 줄과 보낸 신청 한 줄', (await ha.ev(`document.querySelectorAll('.fp .friends-list > li').length`)) === 6);
      check(F, '운영자가 열었으면 놀러 가기 스위치가 줄마다 (4개)', (await ha.ev(`document.querySelectorAll('.fp .friends-visit input').length`)) === 4);
      await sleep(4500); // 앞 단추의 결과 글이 사라진 뒤에 찍는다
      await homeShots(a, ha, 'many');
      await a.main('__jj.server.debugFriendsView(null)');
    }
    // --- 떠났다 돌아오기와 단축키 ---
    {
      const F = '구역';
      await ha.ev(`document.getElementById('ptab-records').click()`);
      await sleep(300);
      check(F, '다른 구역으로 가면 친구 본문이 없다', (await fp(ha)) === null);
      await ha.ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '8', code: 'Digit8', metaKey: ${process.platform === 'darwin'}, ctrlKey: ${process.platform !== 'darwin'} })); return true; })()`);
      await sleep(400);
      check(F, 'Cmd/Ctrl+8 로 친구 구역 (설정 창과 별개)', (await fp(ha)) === 'box', await fp(ha));
    }
    ha.close();
    hb.close();
    pa.close();
    pb.close();
  } catch (err) {
    check('흐름', '중단', false, err instanceof Error ? err.stack : String(err));
    for (const h of [a, b])
      try {
        console.log(readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n').slice(-20).join('\n'));
      } catch {}
  } finally {
    await a.quit();
    await b.quit();
  }
}

let crashed = false;
try {
  await flow();
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.stack : String(err));
  crashed = true;
}
for (const x of apps) if (!x.exited) await x.quit().catch(() => {});
await nest.close().catch(() => {});
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
