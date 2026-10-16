// 서버 친구 앱 통합 시험 (이슈 #110 1부): 시험 Postgres + 서버(이 프로세스 안, 가짜 구글) + 앱 둘(두 계정)을 CDP 로 움직여
// 화면 단추로 친구 코드 복사 → 붙여 넣기 → 신청 → (펫이 건넨 신청 쪽지 펼치기) → 수락 → 선물 보내기 → 선물 쪽지 열기 → 잔액 →
// 일정 공유 켜기 → 친구 화면에 바쁜 시간 → 끄면 바로 지워짐 → 차단까지 보고, 칸을 밝은, 어두운 모드로 찍는다 (PASS/FAIL).
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/friends.mjs
//
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만
// - 진짜 구글은 부르지 않는다: 서버 로그인은 시험 RSA 키로 서명한 id_token(가짜 구글). 일정 공유는 직접 넣은 일정만 보내므로
//   (구글 Limited Use 확인 전) 일정은 앱 일정 저장소에 넣는다
// - 브라우저 열기와 클립보드는 메인에서 바꿔 끼운다 (진짜 브라우저, 진짜 클립보드를 건드리지 않는다)
// - 홈페이지 정적 파일(events.json, notices.json, 최신 릴리스)은 이 컴퓨터의 http 서버가 내준다
// - 컨테이너는 jj-friends-pg-<무작위> 이름으로만 만들고 지운다. 포트는 모두 무작위
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
  check(F, '닉네임 넣고 서버 모드 시작', await press(p, '.server-box', L.start));
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

// ================= 흐름 =================
async function flow() {
  const [a, b] = await Promise.all([launch('a'), launch('b')]);
  try {
    const pa = await openSettings(a);
    const pb = await openSettings(b);
    const A = await signUp(a, pa, '가입 A', NICKS[0], `sub-a-${randomBytes(4).toString('hex')}`);
    const B = await signUp(b, pb, '가입 B', NICKS[1], `sub-b-${randomBytes(4).toString('hex')}`);
    // 채팅 이용권을 모두에게 열어 둬서 이번 달 정기 지급 쪽지가 먼저 와 있다: 이 시험의 쪽지(신청, 선물)만 보이게 미리 연 것으로
    sql(`UPDATE inbox SET opened_at = now(), opened_coins = 0, opened_passes = 0 WHERE opened_at IS NULL`);
    for (const h of [a, b]) await h.main('__jj.serverInbox.refresh().then(() => 1)');

    // --- 기능 키 기본(allowlist, 목록에 없음)이면 칸이 없다 → 모두로 바꾸면 보인다 ---
    {
      const F = '기능 키';
      await sleep(800);
      check(F, '기본 allowlist(목록에 없음): 친구 칸 없음', !(await pa.ev(`!!document.querySelector('.friends-box')`)));
      sql(`INSERT INTO feature_flag (key, mode) VALUES ('friends', 'everyone') ON CONFLICT (key) DO UPDATE SET mode = 'everyone'`);
      await sleep(5500);
      await clickSync(a, pa);
      await clickSync(b, pb);
      const shown = await soft(until('친구 칸', () => pa.ev(`!!document.querySelector('.friends-box .friends-code')`), 15_000));
      check(F, '모두로 바꾸고 맞추기 → 친구 칸과 내 코드', shown === true && (await boxText(pa)).includes(A.code), `${(await boxText(pa)).slice(0, 120)} 상태 ${await a.main('JSON.stringify(__jj.server.friends.state()).slice(0, 200)')}`);
      await soft(until('B 칸', () => pb.ev(`!!document.querySelector('.friends-box .friends-code')`), 15_000));
    }

    // --- 코드 복사 → 붙여 넣기 → 신청 ---
    {
      const F = '신청';
      check(F, 'A "초대 링크 복사"', await press(pa, '.friends-box', t('friends.copyLink')));
      await soft(until('클립보드', async () => (await a.clip())?.includes('/f/'), 5000));
      const link = await a.clip();
      check(F, '복사한 초대 링크 = 홈페이지 /f/<코드>/', link === `https://fairy.moilga.com/f/${A.code}/`, link);
      check(F, 'A "코드 복사"', await press(pa, '.friends-box', t('friends.copyCode')));
      await soft(until('코드', async () => (await a.clip()) === A.code, 5000));
      check(F, '복사한 코드 = 내 기기 코드', (await a.clip()) === A.code, await a.clip());
      await pa.shots('f01-a-empty', '.friends-box');
      // B 가 초대 링크를 붙여 넣는다
      check(F, 'B 칸에 초대 링크 붙여 넣기', await typeInto(pb, '.friends-input', link));
      check(F, 'B "신청" 누르기', await press(pb, '.friends-box', t('friends.send')));
      const f = await waitFlash(pb, t('friends.sent'));
      check(F, '신청 보냄 안내', f === t('friends.sent'), f);
      check(F, 'DB: B → A 신청 하나', sql(`SELECT count(*) FROM friend_request WHERE from_account = ${B.id} AND to_account = ${A.id}`) === '1');
      await soft(until('보낸 신청', async () => (await boxText(pb)).includes(t('friends.outgoing')), 8000));
      await pb.shots('f02-b-outgoing', '.friends-box');
    }

    // --- A: 펫이 신청 쪽지를 들고 옴 → 펼치면 친구 칸 → 받기 ---
    {
      const F = '수락';
      await a.main("(() => { const w = __jj.settingsWindow; const o = w.open.bind(w); globalThis.__qaSec = []; w.open = (x) => { globalThis.__qaSec.push(x); return o(x); }; return 1; })()");
      await clickSync(a, pa);
      const pet = await openPetNote(a, F);
      const said = await soft(until('신청 말풍선', async () => (await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`)).includes(NICKS[1]), 10_000));
      check(F, '펼친 쪽지에 신청한 친구 닉네임', said === true, await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`));
      await pet.shots('f03-a-pet-request');
      const focused = await soft(until('친구 칸 열림', async () => JSON.parse(await a.main('JSON.stringify(globalThis.__qaSec)')).includes('friends'), 8000));
      check(F, '신청 쪽지를 펼치면 설정의 친구 칸을 연다', focused === true);
      pet.close();
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('받은 신청', async () => (await boxText(pa)).includes(t('friends.incoming')), 10_000));
      await pa.shots('f04-a-incoming', '.friends-box');
      check(F, 'A 받은 신청 줄에서 "받기"', await rowPressWait(pa, NICKS[1], t('friends.accept')));
      const f = await waitFlash(pa, t('friends.accepted'));
      check(F, '친구가 됐어 안내', f === t('friends.accepted'), f);
      check(F, 'DB: 친구 두 줄, 신청 없음', sql(`SELECT count(*) FROM friend WHERE (account_id = ${A.id} AND friend_id = ${B.id}) OR (account_id = ${B.id} AND friend_id = ${A.id})`) === '2' && sql(`SELECT count(*) FROM friend_request`) === '0');
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('B 친구', async () => (await boxText(pb)).includes(NICKS[0]), 8000));
      check(F, 'B 친구 목록에 A', (await boxText(pb)).includes(NICKS[0]));
    }

    // --- 선물: A 가 코인 50, 채팅 이용권 1 → B 가 쪽지를 열면 받음 ---
    {
      const F = '선물';
      sql(`UPDATE account SET balance = 300 WHERE id = ${A.id}`);
      sql(`INSERT INTO ai_ticket (account_id, remaining) VALUES (${A.id}, 3) ON CONFLICT (account_id) DO UPDATE SET remaining = 3`);
      await clickSync(a, pa);
      await soft(until('A 잔액', async () => (await a.balance()) === 300, 10_000));
      const bA = await a.balance();
      const bB = await b.balance();
      check(F, 'A "선물" 누르기', await rowPressWait(pa, NICKS[1], t('friends.gift')));
      await soft(until('선물 칸', () => pa.ev(`!!document.querySelector('.friends-gift')`), 5000));
      await typeInto(pa, `.friends-gift input[aria-label="${t('friends.giftCoins')}"]`, '50');
      const passBox = await typeInto(pa, `.friends-gift input[aria-label="${t('friends.giftPasses')}"]`, '1');
      check(F, '코인 50, 채팅 이용권 1 넣기 (이용권 칸이 보인다)', passBox);
      await pa.shots('f05-a-gift', '.friends-box');
      check(F, '"보내기"', await press(pa, '.friends-gift', t('friends.giftSend')));
      const f = await waitFlash(pa, t('friends.giftOk', { coins: 50, passes: 1 }));
      check(F, '선물 보냄 안내', f === t('friends.giftOk', { coins: 50, passes: 1 }), f);
      await soft(until('A 잔액 줄어듦', async () => (await a.balance()) === bA - 50, 15_000));
      check(F, 'A 앱 잔액 -50, 서버 잔액 -50, 이용권 2', (await a.balance()) === bA - 50 && sql(`SELECT balance FROM account WHERE id = ${A.id}`) === String(bA - 50) && sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${A.id}`) === '2', `앱 ${await a.balance()}`);
      // B: 맞추기 → 펫이 선물 쪽지 → 펼치기 → 잔액
      await clickSync(b, pb);
      const pet = await openPetNote(b, F);
      await soft(until('B 잔액', async () => (await b.balance()) === bB + 50, 15_000));
      check(F, '쪽지를 열면 B 앱 잔액 +50, 서버 장부 gift_in', (await b.balance()) === bB + 50 && sql(`SELECT count(*) FROM coin_entry WHERE account_id = ${B.id} AND reason = 'gift_in' AND amount = 50`) === '1', `앱 ${await b.balance()}`);
      check(F, 'B 채팅 이용권 +1 (서버)', sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${B.id}`) === '1');
      const said = await soft(until('받은 말풍선', async () => (await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`)).includes(NICKS[0]), 8000));
      check(F, '펼친 선물 쪽지에 보낸 친구', said === true, await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`));
      await pet.shots('f06-b-pet-gift');
      pet.close();
    }

    // --- 일정 공유: A 가 B 에게 바쁜 시간 보여 주기 → B 가 봄 → 끄면 바로 지움 ---
    {
      const F = '일정';
      const secret = LANG === 'ko' ? '비밀 병원 예약' : 'Secret clinic visit';
      const day = new Date();
      day.setDate(day.getDate() + 1);
      day.setHours(10, 0, 0, 0);
      const start = day.getTime();
      await a.main(`(__jj.events.add({ title: ${JSON.stringify(secret)}, startAt: ${start}, endAt: ${start + 90 * 60_000}, reminds: [] }, Date.now()), 1)`);
      await soft(until('공유 칸', () => pa.ev(`!!document.querySelector('.friends-share input')`), 8000));
      check(F, '"내 바쁜 시간 보여 주기" 칸', await pa.ev(`!!document.querySelector('.friends-share input')`));
      check(F, '기본 꺼짐', (await pa.ev(`document.querySelector('.friends-share input')?.checked`)) === false);
      await pa.ev(`(document.querySelector('.friends-share input').click(), 1)`);
      const f = await waitFlash(pa, t('friends.shareOn'));
      check(F, '켜기 안내', f === t('friends.shareOn'), f);
      await soft(until('올림', async () => sql(`SELECT count(*) FROM busy_block WHERE account_id = ${A.id}`) === '1', 10_000));
      check(F, 'DB: 바쁜 시간대 1개 (시작, 끝)', sql(`SELECT count(*) FROM busy_block WHERE account_id = ${A.id}`) === '1');
      const dump = execFileSync('docker', ['exec', pgName, 'pg_dump', '-U', 'fairy', '-d', 'fairy', '--data-only'], { encoding: 'utf8' });
      check(F, '서버 DB 어디에도 일정 제목이 없다', !dump.includes(secret));
      await pa.shots('f07-a-share-on', '.friends-box');
      // B 가 본다
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      check(F, 'B: A 줄에 "바쁜 시간" 단추', await rowPressWait(pb, NICKS[0], t('friends.busy')));
      await soft(until('바쁜 시간 칸', () => pb.ev(`!!document.querySelector('.friends-busy li')`), 8000));
      const want = new Date(start).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' });
      const busyText = await pb.ev(`document.querySelector('.friends-busy')?.innerText ?? ''`);
      check(F, 'B 화면에 A 의 내일 10시 바쁜 시간, 제목은 없다', busyText.includes(want) && !busyText.includes(secret), busyText.replace(/\n/g, ' / ').slice(0, 200));
      await pb.shots('f08-b-busy', '.friends-box');
      // 끄면 바로 지움
      await pa.ev(`(document.querySelector('.friends-share input').click(), 1)`);
      const off = await waitFlash(pa, t('friends.shareOff'));
      check(F, '끄기 안내', off === t('friends.shareOff'), off);
      check(F, '끄면 서버에서 바로 지움 (0개)', sql(`SELECT count(*) FROM busy_block WHERE account_id = ${A.id}`) === '0');
      const r = await b.main(`__jj.server.friends.busy(${JSON.stringify(A.code)}).then((x) => JSON.stringify(x))`);
      check(F, 'B 가 다시 보면 404 (보여 주지 않음)', JSON.parse(r).error === 'not_shared', r);
    }

    // --- 차단 ---
    {
      const F = '차단';
      check(F, 'B: A 줄 "차단" 한 번 → "정말 차단"', await rowPressWait(pb, NICKS[0], t('friends.block')));
      check(F, '두 번째 누르기', await rowPressWait(pb, NICKS[0], t('friends.blockSure')));
      const f = await waitFlash(pb, t('friends.blockedOk'));
      check(F, '차단 안내', f === t('friends.blockedOk'), f);
      check(F, 'DB: 친구 없음, 차단 한 줄', sql(`SELECT count(*) FROM friend`) === '0' && sql(`SELECT count(*) FROM friend_block WHERE blocker = ${B.id} AND blocked = ${A.id}`) === '1');
      await pb.shots('f09-b-blocked', '.friends-box');
      // A 가 다시 신청하면 막힌다 (까닭은 알리지 않는다)
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await typeInto(pa, '.friends-input', B.code.toLowerCase().replace('f-', ''));
      await press(pa, '.friends-box', t('friends.send'));
      const no = await waitFlash(pa, t('friends.err.unavailable'));
      check(F, 'A 다시 신청 → "신청을 보낼 수 없어"', no === t('friends.err.unavailable'), no);
      await pa.shots('f10-a-after-block', '.friends-box');
    }
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
