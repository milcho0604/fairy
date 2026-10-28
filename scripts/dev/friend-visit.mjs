// 친구 펫 놀러 가기 앱 통합 시험 (이슈 #141): 시험 Postgres + 서버(이 프로세스 안, 가짜 구글) + 앱 둘(두 계정)을 CDP 로 움직여
// 설정 친구 줄의 "펫 놀러 가기" 스위치(기능 키가 꺼지면 숨김) → 서로 켜면 카드가 서버에 올라감 → 한쪽 앱이 손님 펫 창을 띄움
// (창 개수, 포커스, 투명, 자리 파일 없음, 모습) → 상대가 끄면 1분 안에 돌아감 → 미룸 표(오늘은 그만, 하루 상한, 쿨다운, 같은 친구,
// 숨김, 일정, 이미 와 있음) → 사진 펫은 대역, 모르는 종류는 대역 → 기능 키 끔, 서버 꺼짐이면 조용히 미룸을 본다 (PASS/FAIL).
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/friend-visit.mjs
//   COMPARE_OUT=<파일.png> 를 주면 전후 비교 그림(친구 줄 스위치 전후, 손님이 와 있는 장면)을 합쳐 쓴다 (python3 + Pillow)
//
// - CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 입력은 CDP 로만, 포트는 9800~9999 무작위
// - 진짜 구글은 부르지 않는다 (시험 RSA 키로 서명한 id_token). 시간은 기다리지 않는다: 메인 손잡이 __jj.visitors (tick(force), state, setState,
//   away, pause, dismiss, windows) 로 차례를 당기고 상태를 만든다
// - 친구 맺기 흐름은 friends.mjs 가 본다. 여기서는 로그인한 두 계정을 DB 에서 바로 친구로 만든다
// - 컨테이너는 jj-visit-pg-<무작위> 이름으로만 만들고 지운다 (--tmpfs, docker rm -f -v)
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// 시험 포트는 9800~9999 안에서 무작위로 (비어 있는 것만)
const freePort = () =>
  new Promise((r) => {
    const tryPort = () => {
      const port = 9800 + Math.floor(Math.random() * 200);
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
const pgName = `jj-visit-pg-${randomBytes(4).toString('hex')}`;
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
    // 친구와 펫 놀러 가기는 기본 allowlist 그대로 두고 시험 중에 모두로 바꾼다 (기본이면 스위치가 숨는지 본다)
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

const scratchAll = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.visit-'));
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
  const h = { name, child, scratch, data, pagePort: pageP, exited: false, mainConn: undefined };
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

/** 밝은, 어두운 화면으로 찍고 넘침, 영어판 한글, 줄표, 빈 단추를 본다 */
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
  check(F, '닉네임 넣고 시작', await press(p, '.server-box', L.start));
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



// ================= 화면 도우미 (놀러 가기) =================
const rowOf = (name) =>
  `(() => [...document.querySelectorAll('.friends-list > li')].find((x) => x.querySelector('.friends-name')?.textContent === ${JSON.stringify(name)}))()`;
const hasSwitch = (p, name) => p.ev(`!!(${rowOf(name)})?.querySelector('.friends-visit input')`);
const switchOn = (p, name) => p.ev(`!!(${rowOf(name)})?.querySelector('.friends-visit input')?.checked`);
const clickSwitch = (p, name) =>
  p.ev(`(() => { const i = (${rowOf(name)})?.querySelector('.friends-visit input'); if (!i || i.disabled) return false; i.click(); return true; })()`);
const jjv = (h, expr) =>
  h.main(`Promise.resolve(${expr}).then((x) => JSON.stringify(x === undefined ? null : x))`).then((x) => (x ? JSON.parse(x) : undefined));
const tick = (h, force = true) => jjv(h, `__jj.visitors.tick(${force})`);
/** 펫이 걷는 중이면 busy 로 미루니, 다른 까닭을 보려면 busy 가 아닐 때까지 몇 번 더 본다 */
async function tickReason(h, tries = 30) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await tick(h, true);
    if (r?.reason !== 'busy') return r;
    await sleep(1000);
  }
  return r;
}
const vstate = (h) => jjv(h, '__jj.visitors.state()');
const todayStr = (h) =>
  h.main("(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()");

/** 요소 하나를 PNG 로 (밝은 화면). 창이 작으면 요소가 다 들어가게 잠깐 키워서 찍는다 */
async function grab(p, sel, file) {
  const size = await p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; return { h: Math.ceil(el.getBoundingClientRect().height), w: document.documentElement.clientWidth, vh: window.innerHeight }; })()`);
  if (!size) return false;
  const grow = size.h + 120 > size.vh;
  if (grow) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: Math.min(size.vh + size.h + 200, 6000), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
  }
  const box = await p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4 + window.scrollY), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, 6000) }; })()`);
  await sleep(150);
  const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  if (grow) await p.send('Emulation.clearDeviceMetricsOverride');
  return true;
}

/** 앱의 펫 화면들 (pet.html). visitor 면 놀러 온 손님 창 (window.open 으로 열려 이름이 jj-friend-...) */
async function petPages(h) {
  const port = h.pagePort;
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const out = [];
  for (const x of list.filter((y) => y.type === 'page' && y.url.includes('pet.html'))) {
    const c = await connect(x.webSocketDebuggerUrl);
    const ev = async (expr) => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
    out.push({ c, ev, name: await ev('window.name'), url: x.url });
  }
  return out;
}
async function shotPet(h, visitor, file) {
  const pages = await petPages(h);
  try {
    const p = pages.find((x) => (x.name.startsWith('jj-friend-') ? visitor : !visitor && !x.name));
    if (!p) return false;
    await p.ev('window.__pet?.setInputs({ systemBusy: false, userIdleMs: 0 })');
    await sleep(400);
    const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return true;
  } finally {
    for (const x of pages) x.c.ws.close();
  }
}
/** 손님이 올 때까지 차례를 당긴다 (펫이 걷는 중이면 busy 라 몇 번 더 시도) */
async function callVisitor(h, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await tick(h, true);
    if (last?.went) return last;
    await sleep(1500);
  }
  return last;
}
const windowsOf = (h) => h.main('__jj.visitors.windows()');

// ================= 흐름 =================
async function flow() {
  const [a, b] = await Promise.all([launch('a'), launch('b')]);
  try {
    const pa = await openSettings(a);
    const pb = await openSettings(b);
    const A = await signUp(a, pa, '가입 A', NICKS[0], `sub-a-${randomBytes(4).toString('hex')}`);
    const B = await signUp(b, pb, '가입 B', NICKS[1], `sub-b-${randomBytes(4).toString('hex')}`);
    sql(`UPDATE inbox SET opened_at = now(), opened_coins = 0, opened_passes = 0 WHERE opened_at IS NULL`);
    for (const h of [a, b]) {
      // 시험 컴퓨터의 진짜 입력 시간과 상관없이 사용자가 자리에 있는 것으로 (안 그러면 펫 화면이 졸아서 걷지 않는다. pet-moves.mjs 와 같다)
      await h.main("(process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron').powerMonitor.getSystemIdleTime = () => 0, 1)");
      await h.main('(__jj.visitors.away(0), __jj.visitors.calm(true), 1)');
    }
    // 친구 두 줄 (신청 흐름은 friends.mjs 가 본다) + 친구 기능은 모두에게
    sql(`INSERT INTO friend (account_id, friend_id) VALUES (${A.id}, ${B.id}), (${B.id}, ${A.id})`);
    sql(`INSERT INTO feature_flag (key, mode) VALUES ('friends', 'everyone') ON CONFLICT (key) DO UPDATE SET mode = 'everyone'`);
    await sleep(5500);
    await clickSync(a, pa);
    await clickSync(b, pb);
    const files = {
      before: join(OUT, `v01-before-${LANG}.png`),
      after: join(OUT, `v03-after-${LANG}.png`),
      main: join(OUT, `v04-main-${LANG}.png`),
      guest: join(OUT, `v05-visitor-${LANG}.png`),
    };

    // --- 기능 키: 꺼진(기본 allowlist) 동안 스위치가 없다 → 모두로 바꾸면 보인다 ---
    {
      const F = '기능 키';
      await soft(until('친구 줄', () => pa.ev(`!!(${rowOf(NICKS[1])})`), 20_000));
      check(F, '친구 줄은 있고 "펫 놀러 가기" 스위치는 없음 (friend_visit 기본 allowlist, 목록에 없음)', (await pa.ev(`!!(${rowOf(NICKS[1])})`)) && !(await hasSwitch(pa, NICKS[1])));
      check(F, '머리말 줄("오늘은 그만")도 없음', !(await pa.ev(`!!document.querySelector('.friends-visitbar')`)));
      await grab(pa, '.friends-box', files.before);
      await pa.shots('v01-a-before', '.friends-box');
      sql(`INSERT INTO feature_flag (key, mode) VALUES ('friend_visit', 'everyone') ON CONFLICT (key) DO UPDATE SET mode = 'everyone'`);
      await sleep(5500);
      await clickSync(a, pa);
      await clickSync(b, pb);
      const shown = await soft(until('스위치', () => hasSwitch(pa, NICKS[1]), 20_000));
      check(F, '모두로 바꾸고 맞추기 → 스위치가 보임, 기본 꺼짐', shown === true && !(await switchOn(pa, NICKS[1])));
      await soft(until('B 스위치', () => hasSwitch(pb, NICKS[0]), 20_000));
      check(F, '머리말 줄: 오늘 0/6 과 "오늘은 놀러 오기 그만"', (await boxText(pa)).includes(t('friends.visitToday', { n: 0, max: 6 })) && (await boxText(pa)).includes(t('friends.visitPause')), (await boxText(pa)).slice(-200));
      check(F, '회의, 화면 공유 안내 한 줄', (await boxText(pa)).includes(t('friends.visitMeeting')));
      await pa.shots('v02-a-switch-off', '.friends-box');
    }

    // --- 스위치: A 가 켜면 카드가 올라가고, 친구가 켜기 전까지 손님은 없다. B 도 켜면 서로 ---
    {
      const F = '스위치';
      check(F, 'A "펫 놀러 가기" 켜기', await clickSwitch(pa, NICKS[1]));
      const f = await waitFlash(pa, t('friends.visitOn'));
      check(F, '켬 안내', f === t('friends.visitOn'), f);
      check(F, 'DB: A → B visit_on', sql(`SELECT visit_on FROM friend WHERE account_id = ${A.id} AND friend_id = ${B.id}`) === 't');
      await soft(until('A 카드', () => sql(`SELECT count(*) FROM pet_card WHERE account_id = ${A.id}`) === '1', 10_000));
      const petA = await a.main('JSON.stringify({ kind: __jj.settings.get().petKind, name: __jj.settings.get().petName })').then(JSON.parse);
      const rowA = sql(`SELECT species || '|' || coalesce(name, '') || '|' || stand FROM pet_card WHERE account_id = ${A.id}`);
      check(F, 'DB: 카드는 종류 id 와 이름뿐 (사진 없음)', rowA === `kind:${petA.kind}|${petA.name}|false`, rowA);
      check(F, '친구가 켜기 전: "친구도 켜면 시작돼" 안내', (await boxText(pa)).includes(t('friends.visitWaiting')));
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await a.main('(__jj.visitors.setState({ lastAt: 0 }), 1)');
      const none = await tickReason(a);
      check(F, '한쪽만 켠 동안 A 앱은 손님을 부르지 않음 (서로 켠 친구 없음)', none?.went === false && none.reason === 'friend', JSON.stringify(none));
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      await soft(until('B 에 켠 표시', async () => (await boxText(pb)).includes(t('friends.theyVisit')), 10_000));
      check(F, 'B 줄에 "내 화면에 놀러 올 수 있어" 표시', (await boxText(pb)).includes(t('friends.theyVisit')));
      check(F, 'B "펫 놀러 가기" 켜기', await clickSwitch(pb, NICKS[0]));
      await waitFlash(pb, t('friends.visitOn'));
      await soft(until('B 카드', () => sql(`SELECT count(*) FROM pet_card WHERE account_id = ${B.id}`) === '1', 10_000));
      check(F, 'DB: 서로 켬, 카드 둘', sql(`SELECT count(*) FROM friend WHERE visit_on`) === '2' && sql(`SELECT count(*) FROM pet_card`) === '2');
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      await sleep(600);
      await grab(pa, '.friends-box', files.after);
      await pa.shots('v03-a-switch-on', '.friends-box');
      await pb.shots('v03-b-switch-on', '.friends-box');
    }

    // --- 손님이 온다 ---
    {
      const F = '손님';
      const dock0 = await jjv(a, '__jj.dock.stats()');
      const winsBefore = await a.main("(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); return e.BrowserWindow.getAllWindows().length; })()");
      const r = await callVisitor(a);
      check(F, 'A 앱이 서로 켠 친구 B 의 펫을 손님으로 부름', r?.went === true, JSON.stringify(r));
      await soft(until('손님 창', async () => (await windowsOf(a)) === 1, 20_000));
      check(F, '손님 창 1개', (await windowsOf(a)) === 1);
      const again = await tick(a, true);
      check(F, '손님이 있는 동안 또 부르지 않음 (present)', again?.went === false && again.reason === 'present', JSON.stringify(again));
      const info = await a.main(`JSON.stringify((() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); const all = e.BrowserWindow.getAllWindows(); const wa = e.screen.getPrimaryDisplay().workArea; return { n: all.length, focused: all.filter((w) => w.isFocused()).length, focusable: all.filter((w) => w.isFocusable()).length, opacity: all.map((w) => w.getOpacity()), inside: all.every((w) => { const b = w.getBounds(); return b.x >= wa.x - 400 && b.x <= wa.x + wa.width && b.y >= wa.y - 400 && b.y <= wa.y + wa.height; }), internalOnly: e.screen.getAllDisplays().length === 1 }; })())`).then(JSON.parse);
      check(F, '창이 하나 늘었고 아무 창도 포커스를 받지 않음', info.n === winsBefore + 1 && info.focused === 0, JSON.stringify(info));
      check(F, '시험 인스턴스라 모든 창이 투명 (보이지 않음)', info.opacity.every((x) => x === 0), JSON.stringify(info.opacity));
      check(F, '내장 화면 하나만 보고 창이 그 안에 있음', info.internalOnly && info.inside, JSON.stringify(info));
      const dock1 = await jjv(a, '__jj.dock.stats()');
      check(F, 'app.dock.show 를 부르지 않음 (shows 0)', dock1.shows === 0 && dock0.shows === 0, JSON.stringify(dock1));
      await soft(until('손님이 와서 한 번 센다', async () => (await vstate(a)).count === 1, 40_000));
      const st = await vstate(a);
      const petB = await b.main('JSON.stringify({ kind: __jj.settings.get().petKind, name: __jj.settings.get().petName })').then(JSON.parse);
      check(F, '손님 모습 = B 의 펫 종류와 이름 (앱에 든 그림으로)', st.look?.species === `kind:${petB.kind}` && st.look.name === petB.name && st.look.known === true, JSON.stringify(st.look));
      check(F, '오늘 1번 센 상태 파일', st.count === 1 && st.last[B.code] > 0, JSON.stringify({ count: st.count, last: st.last }));
      const leftovers = readdirSync(a.data).filter((x) => x.startsWith('pet-position-v-'));
      check(F, '손님의 자리 파일(pet-position-v-*)을 만들지 않음', leftovers.length === 0, leftovers.join(','));
      check(F, '설정의 친구 페어리 목록에 손님이 없음', (await a.main('__jj.settings.get().friends.length')) === 0);
      check(F, '손님 창 화면이 뜸', await shotPet(a, true, files.guest));
      await shotPet(a, false, files.main);
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await sleep(1500);
      await pa.shots('v04-a-visited-box', '.friends-box');
      check(F, '설정 머리말: 오늘 1/6', (await boxText(pa)).includes(t('friends.visitToday', { n: 1, max: 6 })), (await boxText(pa)).slice(0, 200));
    }

    visitLog(a);
    if (process.env.STOP_AFTER === 'guest') return;

    // --- B 가 끄면 1분 안에 돌아간다 ---
    {
      const F = '끊김';
      const t0 = Date.now();
      check(F, 'B 스위치 끄기', await clickSwitch(pb, NICKS[0]));
      const f = await waitFlash(pb, t('friends.visitOff'));
      check(F, '끔 안내', f === t('friends.visitOff'), f);
      check(F, 'DB: B 카드 지워짐 (켠 친구 없음)', sql(`SELECT count(*) FROM pet_card WHERE account_id = ${B.id}`) === '0');
      const left = await soft(until('손님 돌아감', async () => (await windowsOf(a)) === 0, 80_000));
      const sec = Math.round((Date.now() - t0) / 1000);
      check(F, '친구가 끈 뒤 손님이 1분 안에 돌아감', left === true && sec <= 75, `${sec}초`);
    }

    // --- 미룸 표 (A 앱) ---
    {
      const F = '미룸';
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      check(F, 'B 다시 켜기', await clickSwitch(pb, NICKS[0]) || (await switchOn(pb, NICKS[0])));
      await soft(until('B 카드', () => sql(`SELECT count(*) FROM pet_card WHERE account_id = ${B.id}`) === '1', 10_000));
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      const today = await todayStr(a);
      const clear = () => a.main('(__jj.visitors.setState({ lastAt: 0, count: 0, last: {}, pausedDay: null }), 1)');
      const row = async (name, setup, want, undo) => {
        await clear();
        await setup?.();
        const r = await tickReason(a);
        check(F, `${name} → ${want}`, r?.went === false && r.reason === want && (await windowsOf(a)) === 0, JSON.stringify(r));
        await undo?.();
      };
      await row('오늘은 그만', () => a.main('(__jj.visitors.pause(true), 1)'), 'paused', () => a.main('(__jj.visitors.pause(false), 1)'));
      await row('하루 상한 6번', () => a.main(`(__jj.visitors.setState({ day: ${JSON.stringify(today)}, count: 6 }), 1)`), 'dayMax');
      await row('쿨다운 20분', () => a.main('(__jj.visitors.setState({ lastAt: Date.now() - 60000 }), 1)'), 'cooldown');
      await row('같은 친구 3시간', () => a.main(`(__jj.visitors.setState({ last: { ${JSON.stringify(B.code)}: Date.now() - 3600000 } }), 1)`), 'friend');
      await row('펫 숨김', () => a.main("(__jj.pet.setHidden('user', true), 1)"), 'hidden', () => a.main("(__jj.pet.setHidden('user', false), 1)"));
      await clear();
      const ok = await callVisitor(a);
      check(F, '막는 것이 없으면 다시 온다 (미룸 해제 뒤)', ok?.went === true, JSON.stringify(ok));
      // 오늘은 그만을 누르면 와 있는 손님도 돌아간다
      await soft(until('손님', async () => (await windowsOf(a)) === 1, 15_000));
      await a.main('(__jj.visitors.pause(true), 1)');
      check(F, '"오늘은 그만" → 와 있던 손님이 바로 돌아감', await soft(until('돌아감', async () => (await windowsOf(a)) === 0, 8000)));
      await a.main('(__jj.visitors.pause(false), 1)');
      // 설정 칸의 버튼도 같은 일을 한다
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await sleep(800);
      check(F, '설정 "오늘은 놀러 오기 그만" 버튼', await press(pa, '.friends-box', t('friends.visitPause')));
      await soft(until('멈춤 표시', async () => (await boxText(pa)).includes(t('friends.visitPaused')), 8000));
      check(F, '멈춘 날: 안내와 "다시 받기" 버튼', (await boxText(pa)).includes(t('friends.visitPaused')) && (await boxText(pa)).includes(t('friends.visitResume')));
      await pa.shots('v05-a-paused', '.friends-box');
      check(F, '메인: paused 상태', (await vstate(a)).pausedDay === today);
      check(F, '"다시 받기" 버튼', await press(pa, '.friends-box', t('friends.visitResume')));
      await soft(until('다시 받음', async () => (await vstate(a)).pausedDay === null, 8000));
    }

    if (process.env.STOP_AFTER === 'defer') return;

    // --- 대역: 사진 펫, 모르는 종류, 밀크 ---
    {
      const F = '대역';
      await clearAll(a);
      // A 가 직접 가져온 그림(사진 펫)을 쓰면 카드에는 종류와 이름만 (사진 없음) → B 화면에는 기본 모습 대역
      await a.main("(__jj.settings.set({ petImage: 'pet-1700000000000.png', petName: '사진펫' }), 1)");
      await a.main('__jj.server.friends.uploadCard(true).then(() => 1)');
      await soft(until('사진 펫 카드', () => sql(`SELECT name FROM pet_card WHERE account_id = ${A.id}`) === '사진펫', 10_000));
      const row = sql(`SELECT species || '|' || coalesce(name, '') || '|' || stand FROM pet_card WHERE account_id = ${A.id}`);
      const kindA = await a.main('__jj.settings.get().petKind');
      check(F, '사진 펫의 카드: 기본 펫 종류 + 이름, 네 발 서기 없음, 그림 이름이 없음', row === `kind:${kindA}|사진펫|false` && !row.includes('pet-'), row);
      await a.main('__jj.server.friends.refresh().then(() => 1)');
      await sleep(600);
      check(F, '설정 줄에 "사진이나 직접 만든 그림은 보내지 않아" 안내', (await boxText(pa)).includes(t('friends.visitCustom')), (await boxText(pa)).slice(0, 300));
      await b.main('__jj.server.friends.refresh().then(() => 1)');
      await b.main('(__jj.visitors.setState({ lastAt: 0, count: 0, last: {}, pausedDay: null }), 1)');
      const r1 = await callVisitor(b);
      const lk = (await vstate(b)).look;
      check(F, 'B 화면 손님 = 기본 펫 모양 + 사진 펫 이름', r1?.went === true && lk?.species === `kind:${kindA}` && lk.name === '사진펫' && !lk.starter, JSON.stringify(lk));
      await b.main("(__jj.visitors.dismiss('test'), 1)");
      await sleep(800);
      await a.main("(__jj.settings.set({ petImage: null, petName: __jj.settings.get().petName === '사진펫' ? '콩' : __jj.settings.get().petName }), 1)");
      // 서버에 받는 앱이 모르는 종류가 있으면 (더 새 앱의 카드) 대역 콩이
      sql(`UPDATE pet_card SET species = 'kind:dragon' WHERE account_id = ${A.id}`);
      await b.main('(__jj.visitors.setState({ lastAt: 0, count: 0, last: {} }), 1)');
      const r2 = await callVisitor(b);
      const lk2 = (await vstate(b)).look;
      check(F, '모르는 종류(kind:dragon) → 대역 콩이 (이름은 그대로)', r2?.went === true && lk2?.known === false && lk2.kind === 'kong' && lk2.name === '사진펫', JSON.stringify(lk2));
      await b.main("(__jj.visitors.dismiss('test'), 1)");
      await sleep(800);
      // 앱에 든 밀크는 번들 그림으로
      sql(`UPDATE pet_card SET species = 'starter:milk', stand = true WHERE account_id = ${A.id}`);
      await b.main('(__jj.visitors.setState({ lastAt: 0, count: 0, last: {} }), 1)');
      const r3 = await callVisitor(b);
      const lk3 = (await vstate(b)).look;
      check(F, 'starter:milk → 앱에 든 밀크 그림 (starter 표시)', r3?.went === true && lk3?.starter === 'milk' && lk3.known === true, JSON.stringify(lk3));
      await sleep(1500);
      await shotPet(b, true, join(OUT, `v06-milk-visitor-${LANG}.png`));
      await b.main("(__jj.visitors.dismiss('test'), 1)");
      await sleep(500);
    }

    // --- 일정, 기능 키, 서버 꺼짐: 조용히 미룬다 ---
    {
      const F = '조용히';
      await clearAll(a);
      const soon = Date.now() + 2 * 60_000;
      await a.main(`(__jj.events.add({ title: 'meeting', startAt: ${soon}, endAt: ${soon + 30 * 60_000}, reminds: [] }, Date.now()), 1)`);
      const cal = await tickReason(a);
      check(F, '4분 안에 일정이 있음 → calendar', cal?.went === false && cal.reason === 'calendar', JSON.stringify(cal));
      // 기능 키를 끄면 스위치와 머리말이 사라지고 손님도 없다
      sql(`UPDATE feature_flag SET mode = 'off' WHERE key = 'friend_visit'`);
      await sleep(5500);
      await clickSync(a, pa);
      await soft(until('스위치 사라짐', async () => !(await hasSwitch(pa, NICKS[1])), 15_000));
      check(F, 'friend_visit 끔 → 스위치와 머리말 줄이 숨음', !(await hasSwitch(pa, NICKS[1])) && !(await pa.ev(`!!document.querySelector('.friends-visitbar')`)));
      const off = await tickReason(a);
      check(F, 'friend_visit 끔 → 손님 안 부름 (server)', off?.went === false && off.reason === 'server', JSON.stringify(off));
      await pa.shots('v07-a-feature-off', '.friends-box');
      sql(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'friend_visit'`);
      // 서버가 꺼짐: 말풍선도 알림도 없이 미룬다
      await nest.close();
      await clickSync(a, pa);
      await soft(until('오프라인', async () => (await a.status()).problem === 'offline', 20_000));
      const off2 = await tickReason(a);
      const bubble = await (await a.page('pet')).ev(`(() => { const x = document.getElementById('bubble'); return !x || x.hidden; })()`);
      check(F, '서버가 꺼짐(offline) → 손님 안 부르고 말풍선도 없음', off2?.went === false && off2.reason === 'server' && bubble === true, JSON.stringify(off2));
      check(F, '앱이 멈추지 않음 (메인 응답)', (await a.main('1+1')) === 2);
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
/** 앱의 main.log 에서 손님([visit]) 줄만 보여 준다 */
function visitLog(h) {
  try {
    const lines = readFileSync(join(h.data, 'logs', 'main.log'), 'utf8').split('\n').filter((x) => x.includes('visit'));
    console.log(`  [${h.name} main.log visit]\n  ${lines.slice(-12).join('\n  ')}`);
  } catch {}
}
async function clearAll(h) {
  await h.main("(__jj.visitors.dismiss('test'), __jj.visitors.setState({ lastAt: 0, count: 0, last: {}, pausedDay: null }), 1)");
}

if (process.env.COMPARE_OUT) process.on('exit', () => compare());
function compare() {
  const f = (n) => join(OUT, n);
  try {
    execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
out, before, after, main, guest = sys.argv[1:6]
def load(p):
    try: return Image.open(p).convert('RGBA')
    except Exception: return Image.new('RGBA', (320, 120), (200, 200, 200, 255))
def fit(im, w=900):
    return im.resize((w, round(im.height * w / im.width)))
b, a, m, g = fit(load(before)), fit(load(after)), load(main), load(guest)
pad = 16
top = max(b.height, a.height)
w = b.width + a.width + pad * 3
scene_h = max(m.height, g.height)
canvas = Image.new('RGBA', (max(w, m.width + g.width + pad * 3), top + scene_h + pad * 3 + 40), (255, 255, 255, 255))
d = ImageDraw.Draw(canvas)
canvas.paste(b, (pad, pad)); canvas.paste(a, (b.width + pad * 2, pad))
y = top + pad * 2
d.rectangle((0, y - 6, canvas.width, y - 5), fill=(200, 200, 200, 255))
canvas.paste(m, (pad, y), m); canvas.paste(g, (m.width + pad * 2, y), g)
canvas.convert('RGB').save(out)
`, process.env.COMPARE_OUT, f(`v01-a-before-${LANG}-light.png`), f(`v03-a-switch-on-${LANG}-light.png`), f(`v04-main-${LANG}.png`), f(`v05-visitor-${LANG}.png`)], { stdio: 'inherit' });
  } catch (err) {
    console.log('비교 그림 실패', String(err).slice(0, 200));
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
