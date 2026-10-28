// 앱 사용자 경험 3차 A 점검 (fix/app-ux-round3a): 설정 "데이터와 계정" 탭 이름과 서버 계정 안내, 나이 뒤 닉네임 자동 초점,
// 이름 통일(서버 계정, 코인 동기화, 모드 없음), 친구 칸 새로 고침과 짧은 갱신과 새 신청 한마디, 스위치 설명 접기와 놀러 가기 방향 한 줄,
// 바쁜 시간의 같은 시간 한 번과 앞 0 없는 시각, 쿠폰, 이벤트, 계정 지우기 결과가 단추 옆에 남음, 서버에 없는 이벤트 단추 숨김,
// 언어를 바꾸면 채팅 AI 이름이 새 말로, 설치 첫날은 하루 회고를 하지 않음.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/ux-round3a.mjs   (en 도)
//   ELECTRON_BIN=<Electron 실행 파일> 로 설치된 electron 을 직접 줄 수 있다 (npm ci 가 electron 내려받기를 건너뛴 작업 폴더용)
//
// 서버와 Postgres 는 띄우지 않는다: 메인 프로세스에서 서버 코어의 status, sessionCall, claim, coupon, remove, setAge 만 가짜로 바꿔
// 화면이 받는 모양을 만든다 (진짜 네트워크, 진짜 입력, 진짜 AI 없음).
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 맥북 화면, 입력은 CDP 로만.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer as httpServer } from 'node:http';

let electronPath = process.env.ELECTRON_BIN;
if (!electronPath) electronPath = (await import('electron')).default;

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-ux-round3a');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
/** 9800~9999 중 비어 있는 포트를 무작위로 (시험 창 규칙) */
const freePort = async () => {
  for (let i = 0; i < 200; i++) {
    const port = 9800 + Math.floor(Math.random() * 200);
    const ok = await new Promise((r) => {
      const s = createServer();
      s.once('error', () => r(false));
      s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return port;
  }
  throw new Error('빈 포트 없음');
};
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? (await freePort()));
let PAGE = Number(process.env.JJ_PAGE_PORT ?? (await freePort()));
while (PAGE === INSPECT) PAGE = await freePort();
const KEEP = process.env.KEEP === '1';
const ko = LANG === 'ko';
const tx = (koText, enText) => (ko ? koText : enText);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.ux-round3a-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi') }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
// 이 컴퓨터 http 서버 하나: 이벤트 목록(선물 이벤트 하나)만 내주고 공지, 릴리스는 404 (바깥으로 나가는 요청 없음)
const NOW0 = Date.now();
const eventsJson = JSON.stringify({
  version: 1,
  events: [
    {
      id: 'ux-gift-1',
      kind: 'gift',
      title: { ko: '가을 선물', en: 'Autumn gift' },
      body: { ko: '모두에게 코인 50개.', en: '50 coins for everyone.' },
      from: new Date(NOW0 - 3_600_000).toISOString(),
      until: new Date(NOW0 + 7 * 86_400_000).toISOString(),
      coins: 50,
    },
  ],
});
const local = httpServer((req, res) => {
  if (req.url?.startsWith('/events.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(eventsJson);
  } else {
    res.writeHead(404);
    res.end('{}');
  }
});
await new Promise((r) => local.listen(0, '127.0.0.1', r));
const localBase = `http://127.0.0.1:${local.address().port}`;
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_TEST_SECRETS: 'memory',
    // 서버 칸이 보이게 주소만 준다 (닫힌 포트라 요청은 곧바로 실패하고, 코어는 아래에서 가짜로 바꾼다)
    JJ_SERVER_URL_OVERRIDE: 'http://127.0.0.1:1',
    JJ_EVENTS_URL: `${localBase}/events.json`,
    JJ_NOTICES_URL: `${localBase}/notices.json`,
    JJ_RELEASES_API: `${localBase}/latest`,
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'lang', LANG, 'inspect', INSPECT, 'page', PAGE);
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    app.kill('SIGTERM');
  } catch {}
  await sleep(800);
  try {
    app.kill('SIGKILL');
  } catch {}
  local.close();
  rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', () => {
  try {
    app.kill('SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
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
    for (let i = 0; i < 120 && !mainConn; i++) {
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
const pageConns = new Map();
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        let c = pageConns.get(name);
        if (!c || c.id !== p.id) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(name, c);
          await c.send('Page.enable');
        }
        const ev = async (expr) => {
          const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails)
            throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
          return r.result?.result?.value;
        };
        const mouse = (type, x, y, extra = {}) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
            ...extra,
          });
        /** expr 가 돌려주는 요소의 가운데 */
        const center = async (elExpr) =>
          ev(
            // 맨 위로 옮긴 뒤 잠깐 기다려 글이 자리를 잡은 다음에 잰다 (옮기고 바로 재면 늦게 바뀌는 높이 때문에 어긋났다)
            `(async () => { const e = (${elExpr}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          );
        const api = {
          ev,
          send: c.send,
          center,
          /** 마우스를 요소 위로 (hover 로 나타나는 단추용) */
          hover: async (elExpr) => {
            const p2 = await center(elExpr);
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await sleep(120);
            return true;
          },
          /** 화면 클릭: 요소 가운데로 마우스를 옮겨 누르고 뗀다 (CDP 입력, 진짜 마우스 아님) */
          click: async (elExpr) => {
            const p2 = await center(elExpr);
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await mouse('mousePressed', p2.x, p2.y);
            await mouse('mouseReleased', p2.x, p2.y);
            await sleep(180);
            return true;
          },
          type: async (text) => {
            await c.send('Input.insertText', { text });
          },
          key: async (key, code, vk) => {
            await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
            await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
          shot: async (file, clipExpr) => {
            let clip;
            if (clipExpr) {
              clip = await ev(
                `(() => { const e = (${clipExpr}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) }; })()`,
              );
            }
            const r = await c.send('Page.captureScreenshot', {
              format: 'png',
              ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
            });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          /** 밝은 모드, 어두운 모드로 한 장씩 */
          shots: async (file, clipExpr) => {
            await api.dark(false);
            await sleep(150);
            await api.shot(`${file}-light`, clipExpr);
            await api.dark(true);
            await sleep(150);
            await api.shot(`${file}-dark`, clipExpr);
            await api.dark(false);
            await sleep(100);
          },
          until: async (fn, ms = 8000) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
              if (await fn()) return true;
              await sleep(120);
            }
            return false;
          },
        };
        return api;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}

const body = async () => {
const NICK = tx('콩이', 'Bean');
const FRIEND = tx('콩친구', 'Pal');
const ONLY = process.env.ONLY ?? 'tab,age,server,friends,events,remove,review,chat';
const has = (k) => ONLY.split(',').includes(k);
const wait = sleep;

/** 메인 프로세스에서 서버 코어를 가짜로 바꾼다 (status, sessionCall, claim, coupon, remove, setAge) */
const installStubs = () =>
  main(`(() => {
  const core = __jj.server.core;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const at = (h, m, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d.getTime(); };
  const server = { enabled: true, age: 'adult', on: true, device: true, signedIn: true, loggingIn: false, syncing: false, balance: 120, pending: 0, lastSyncAt: now, problem: null, merge: null, leftover: false, ai: false, tickets: null, aiWaitlisted: false, subscription: null, nickname: ${JSON.stringify(NICK)}, code: 'F-AB12-CD34', inbox: 0, admin: false, providers: null, logins: ['google'], backup: null, features: { friends: true, friend_gifts: true, friend_calendar: true, friend_visit: true }, calendarHint: false };
  const asking = { ...server, age: null, on: false, device: false, signedIn: false, nickname: null, code: null, features: null };
  const ux = (globalThis.__ux = { server, asking, st: asking, calls: { friends: 0, busy: 0 }, said: [], incoming: [1] });
  core.status = () => ux.st;
  core.allowed = () => ux.st.on;
  core.refreshProviders = async () => {};
  core.setAge = async (age, nick) => (ux.st = { ...server, age, nickname: nick ?? server.nickname });
  core.claim = async () => ({ ok: false, error: 'no_event' });
  core.coupon = async () => ({ ok: false, error: 'no_coupon' });
  core.remove = async () => { ux.st = asking; return { ok: true, status: asking }; };
  const api = {
    friends: async () => {
      ux.calls.friends++;
      return { ok: true, status: 200, data: {
        me: { code: 'F-AB12-CD34', nickname: ${JSON.stringify(NICK)} },
        friends: [{ code: 'F-0000-1111', nickname: ${JSON.stringify(FRIEND)}, since: iso(now), iShare: true, theyShare: true, busyAt: iso(now), iVisit: true, theyVisit: false, canTitle: true, iTitle: true, theyTitle: false }],
        incoming: ux.incoming.map((id) => ({ id, code: 'F-AAAA-000' + id, nickname: 'REQ' + id, sentAt: iso(now), expiresAt: iso(now + 14 * 86400000) })),
        outgoing: [], blocked: [],
        limits: { friends: 100, giftCoinsPerDay: 500, giftPassesPerDay: 5, requestDays: 14, busyDays: 14 },
        today: { coins: 0, passes: 0 },
      } };
    },
    friendBusy: async () => {
      ux.calls.busy++;
      const meeting = ${JSON.stringify(tx('회의', 'Meeting'))};
      const study = ${JSON.stringify(tx('스터디', 'Study'))};
      return { ok: true, status: 200, data: {
        blocks: [{ start: at(10, 0), end: at(11, 0) }, { start: at(15, 0), end: at(16, 0) }, { start: at(9, 0, 1), end: at(9, 30, 1) }],
        titles: [{ start: at(15, 0), end: at(16, 0), title: meeting }, { start: at(9, 0, 1), end: at(9, 30, 1), title: study }],
        updatedAt: iso(now),
      } };
    },
  };
  core.sessionCall = (f) => f(api, 'tok');
  const pet = __jj.pet;
  pet.say = (o) => { ux.said.push({ kind: o.kind, text: o.text }); return Promise.resolve(undefined); };
  return 1;
})()`);

const SERVER_SEC = `[...document.querySelectorAll('#panel-data section')].find((x) => x.querySelector('.server-box'))`;
/** 칸을 맨 위로 내리고 밝음, 어두움으로 찍는다 (창을 길게 늘려 칸 전체가 들어가게) */
const shotSec = async (s, name, expr, height = 1500, width = 760) => {
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await s.ev(`(${expr}).scrollIntoView({ block: 'start' })`);
  await sleep(300);
  await s.shots(name, expr);
  await s.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
};
const reloadSettings = async (s) => {
  await s.send('Page.reload');
  await sleep(1500);
};
const tabName = (s) => s.ev(`document.querySelector('#tab-data .tab-name')?.textContent.trim()`);
const boxText = (s, sel) => s.ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);

await main('1');
await sleep(1500);
await installStubs();
await main('__jj.settingsWindow.open(); 1');
await sleep(1500);
let s = await page('settings');
await s.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
await s.click(`document.getElementById('tab-data')`);
await sleep(400);

// ---- 2. 탭 이름과 계정 찾기 ----
if (has('tab')) {
  const name = await tabName(s);
  check('탭 이름이 "데이터와 계정"', name === tx('데이터와 계정', 'Data and account'), name);
  const hint = await s.ev(`document.querySelector('#tab-data .tab-hint')?.textContent.trim()`);
  check('탭 풀이에 서버 계정과 친구', hint.includes(tx('서버 계정', 'server account')) && hint.includes(tx('친구', 'friends')), hint);
  await s.shots('ux3a-tabs', `document.querySelector('.tabs')`);
  // Cmd+F 색인: 계정, 로그인, 친구로 찾으면 데이터 탭의 칸이 맞는다
  for (const q of tx(['계정', '로그인', '친구'], ['account', 'sign in', 'friends'])) {
    await s.ev(`(() => { const i = document.querySelector('.search input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(350);
    const shown = await s.ev(`!document.getElementById('panel-data').hidden && [...document.querySelectorAll('#panel-data section')].some((x) => !x.hidden && x.querySelector('.server-box'))`);
    check(`설정 찾기 "${q}" 가 서버 계정 칸을 찾음`, shown === true);
  }
  await s.ev(`(() => { const i = document.querySelector('.search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await s.click(`document.getElementById('tab-data')`);
  // 칸 이름으로 열기(친구 초대 링크, 백업 파일): 다른 탭에 있다가도 "데이터와 계정" 탭으로 온다
  for (const section of ['friends', 'restore']) {
    await s.click(`document.getElementById('tab-about')`);
    await main(`__jj.settingsWindow.open(${JSON.stringify(section)}); 1`);
    await sleep(500);
    const on = await s.ev(`document.getElementById('tab-data').getAttribute('aria-selected')`);
    check(`칸 이름 ${section} 으로 열면 데이터와 계정 탭`, on === 'true', on);
  }
}

// ---- 2. 나이 묻기: 서버 계정이 해 주는 것 한 줄, 나이를 고르면 닉네임 칸에 초점 ----
if (has('age')) {
  const benefit = await boxText(s, '.server-benefit');
  check('나이 카드 앞에 "서버 계정이 해 주는 것" 한 줄', benefit.includes(tx('서버 계정이 해 주는 것', 'What a server account does')), benefit.slice(0, 60));
  const order = await s.ev(`(() => { const b = document.querySelector('.server-benefit'); const a = document.querySelector('.server-ages'); return !!b && !!a && !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); })()`);
  check('그 한 줄이 나이 단추보다 앞', order === true);
  const t0 = await boxText(s, '.server-box');
  check('나이 묻는 칸에 "모드" 가 없음', !/모드|\bmode\b/i.test(t0), t0.slice(0, 80));
  await shotSec(s, 'ux3a-age', SERVER_SEC, 700);
  await s.click(`[...document.querySelectorAll('.server-ages button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('만 18세 이상', '18 or older'))})`);
  await sleep(500);
  const focused = await s.ev(`document.activeElement?.classList.contains('server-nickname') === true`);
  check('나이를 고르면 닉네임 칸에 자동 초점', focused === true, await s.ev(`document.activeElement?.tagName + '.' + document.activeElement?.className`));
  await s.type(NICK);
  await sleep(200);
  const typed = await s.ev(`document.querySelector('.server-nickname')?.value`);
  check('바로 쳐서 닉네임 칸에 들어감 (클릭 없이)', typed === NICK, typed);
  await shotSec(s, 'ux3a-nick', SERVER_SEC, 700);
  await s.click(`[...document.querySelectorAll('.server-nickname-step button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('서버 계정 시작', 'Start server account'))})`);
  await sleep(700);
}

// ---- 4. 이름 통일 ----
if (has('server')) {
  await main('(globalThis.__ux.st = globalThis.__ux.server, 1)');
  await reloadSettings(s);
  s = await page('settings');
  await s.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.click(`document.getElementById('tab-data')`);
  await sleep(500);
  const titles = await s.ev(`[...document.querySelectorAll('.server-group-title')].map((x) => x.textContent.trim())`);
  check('묶음 이름이 "코인 동기화"', titles.includes(tx('코인 동기화', 'Coin sync')), titles.join('|'));
  const syncBtn = await s.ev(`[...document.querySelectorAll('.server-line button')].map((x) => x.textContent.trim())`);
  check('단추가 "코인 동기화"', syncBtn.includes(tx('코인 동기화', 'Sync coins')), syncBtn.join('|'));
  const dataText = await s.ev(`document.getElementById('panel-data').innerText`);
  check('데이터와 계정 탭 글에 "모드", "지금 맞추기", "서버 기능" 이 없음', !/모드|지금 맞추기|코인 맞추기|서버 기능|\bmode\b|Sync now|server feature/i.test(dataText), (dataText.match(/.{0,12}(모드|지금 맞추기|코인 맞추기|서버 기능|mode|Sync now|server feature).{0,12}/i) ?? [''])[0]);
  await s.click(`document.getElementById('tab-pet')`);
  await sleep(300);
  const petTitles = await s.ev(`[...document.querySelectorAll('#panel-pet section > h2')].map((x) => x.textContent.trim())`);
  check('펫 탭 칸 이름이 "페어리 공유"', petTitles.includes(tx('페어리 공유', 'Share a fairy')), petTitles.join('|'));
  await s.click(`document.getElementById('tab-data')`);
  await sleep(300);
  await shotSec(s, 'ux3a-server', SERVER_SEC);
}

// ---- 3, 4, 6. 친구 칸 ----
if (has('friends')) {
  await s.click(`document.getElementById('tab-data')`);
  await sleep(800);
  const box = '.friends-box';
  check('친구 칸이 보임', (await s.ev(`!!document.querySelector('${box}')`)) === true);
  const refreshBtn = await s.ev(`[...document.querySelectorAll('${box} button')].some((b) => b.textContent.trim() === ${JSON.stringify(tx('새로 고침', 'Refresh'))})`);
  check('친구 칸에 "새로 고침" 단추', refreshBtn === true);
  // 설명 접기
  const more = await s.ev(`document.querySelectorAll('${box} details.friends-more').length`);
  check('스위치 설명이 접는 칸(details) 안에 있음', more === 1, `details ${more}`);
  const open = await s.ev(`document.querySelector('${box} details.friends-more').open`);
  check('접힌 채로 시작', open === false);
  const visibleLong = await s.ev(`[...document.querySelectorAll('${box} .friends-friend > small.friends-note')].map((x) => x.textContent.trim())`);
  check('접힌 밖에는 긴 설명이 없고 놀러 가기 방향 한 줄만', visibleLong.length === 2 && visibleLong[0].includes(FRIEND) && visibleLong[0].includes(tx('내 펫', 'my pet')), visibleLong.join(' | ').slice(0, 160));
  check('방향 줄이 누구 펫이 누구에게 가는지 말함', visibleLong[0].includes(tx('내 펫이', 'sends my pet')) || visibleLong[0].includes(tx('놀러 가', "'s screen")), visibleLong[0]);
  // 새로 고침을 누르면 서버에 다시 묻고 결과가 단추 옆에 남는다
  const c0 = await main('globalThis.__ux.calls.friends');
  await s.click(`[...document.querySelectorAll('${box} .friends-me button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('새로 고침', 'Refresh'))})`);
  await sleep(700);
  const c1 = await main('globalThis.__ux.calls.friends');
  check('새로 고침이 서버에 다시 물음', c1 > c0, `${c0} -> ${c1}`);
  const near = await boxText(s, `${box} .near-result`);
  check('새로 고침 결과가 단추 옆에 남음', near === tx('친구 목록을 새로 받았어.', 'Friend list refreshed.'), near);
  // 새 신청이 오면 펫이 한마디 (처음 받은 목록은 기준일 뿐)
  const saidBefore = await main('globalThis.__ux.said.length');
  await main('(globalThis.__ux.incoming = [1, 2], 1)');
  await s.click(`[...document.querySelectorAll('${box} .friends-me button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('새로 고침', 'Refresh'))})`);
  await sleep(900);
  const said = JSON.parse(await main('JSON.stringify(globalThis.__ux.said)'));
  const mine = said.slice(saidBefore).filter((x) => x.text.includes('REQ2'));
  check('새 친구 신청이 오면 펫이 신청자 이름으로 한마디', mine.length === 1, JSON.stringify(said.slice(saidBefore)).slice(0, 160));
  check('이미 본 신청(REQ1)은 다시 말하지 않음', !said.slice(saidBefore).some((x) => x.text.includes('REQ1')));
  // 칸이 열려 있으면 짧은 주기로 저절로 갱신 (20초)
  const hidden = await s.ev('document.hidden');
  const visible = await s.ev(`document.querySelector('${box}').offsetParent !== null`);
  console.log(`  참고: document.hidden=${hidden}, 칸 보임=${visible}`);
  const p0 = await main('globalThis.__ux.calls.friends');
  await wait(22_000);
  const p1 = await main('globalThis.__ux.calls.friends');
  check('설정 창이 열려 있으면 누르지 않아도 20초쯤마다 갱신', p1 > p0, `${p0} -> ${p1}`);
  // 바쁜 시간: 같은 시간 한 번, 앞 0 없음
  await s.click(`[...document.querySelectorAll('${box} .friends-line button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('바쁜 시간', 'Busy times'))})`);
  await sleep(900);
  const days = await s.ev(`[...document.querySelectorAll('${box} .friends-busy li')].map((li) => ({ times: li.querySelector('.friends-times')?.textContent.trim() ?? null, events: [...li.querySelectorAll('.friends-event')].map((e) => e.textContent.trim()) }))`);
  const today = days[0];
  const tomorrow = days[1];
  check('제목 있는 시간은 제목 줄에만 (오늘 15시)', today?.events.length === 1 && !(today?.times ?? '').includes('3:00') && today.events[0].includes('3:00'), JSON.stringify(today));
  check('제목 없는 바쁜 시간은 시간 줄에 (오늘 10시)', (today?.times ?? '').includes('10:00'), JSON.stringify(today));
  check('제목 일정만 있는 날은 시간 줄이 없음 (내일)', tomorrow?.times === null && tomorrow?.events.length === 1, JSON.stringify(tomorrow));
  const allTimes = JSON.stringify(days);
  check('시각 앞에 0 이 붙지 않음 (오후 03:00 같은 모양 없음)', !/(^|[^\d])0\d:\d\d/.test(allTimes), allTimes.slice(0, 200));
  await shotSec(s, 'ux3a-friends', `document.querySelector('${box}')`, 1500);
  // 좁은 폭
  await s.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const overflow = await s.ev(`document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1`);
  check('폭 420 에서 가로로 넘치지 않음', overflow === false);
  await shotSec(s, 'ux3a-friends-narrow', `document.querySelector('${box}')`, 1900, 420);
  await s.click(`document.querySelector('${box} details.friends-more > summary')`);
  await sleep(300);
  await shotSec(s, 'ux3a-friends-more-narrow', `document.querySelector('${box}')`, 2100, 420);
  await s.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
}

// ---- 5, 8. 이벤트 선물과 쿠폰 ----
if (has('events')) {
  await s.click(`document.getElementById('tab-data')`);
  await s.until(async () => (await s.ev(`!!document.querySelector('.event-item')`)) === true, 15_000);
  const claimLabel = tx('선물 받기', 'Get gift');
  const hasBtn = await s.ev(`[...document.querySelectorAll('.event-item button')].some((b) => b.textContent.trim() === ${JSON.stringify(claimLabel)})`);
  check('서버 계정이면 선물 받기 단추가 보임', hasBtn === true);
  await s.click(`[...document.querySelectorAll('.event-item button')].find((b) => b.textContent.trim() === ${JSON.stringify(claimLabel)})`);
  await sleep(700);
  const claimNear = await boxText(s, '.event-item .near-result');
  check('서버에 없는 이벤트면 무엇을 하라는지 말함 (10분 뒤 설정 창 다시)', claimNear.includes(tx('10분', '10 minutes')) && claimNear.includes(tx('준비', 'ready')), claimNear);
  const btnAfter = await s.ev(`[...document.querySelectorAll('.event-item button')].some((b) => b.textContent.trim() === ${JSON.stringify(claimLabel)})`);
  check('서버가 모른다고 한 이벤트의 단추는 숨고 "서버 준비 중" 이 보임', btnAfter === false && (await boxText(s, '.event-item .event-pending')) === tx('서버 준비 중', 'Getting ready'));
  const stillThere = await s.ev(`(() => { const n = document.querySelector('.event-item .near-result'); const b = document.querySelector('.event-item .item-actions'); return !!n && !!b && n.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 2; })()`);
  check('결과가 단추 아래에 붙어 있음', stillThere === true);
  await sleep(3500);
  check('2.4초가 지나도 결과가 남아 있음', (await boxText(s, '.event-item .near-result')).length > 0);
  // 쿠폰
  await s.click(`document.querySelector('.coupon-input')`);
  await s.type('ABCD2345WXYZ');
  await s.click(`[...document.querySelectorAll('.coupon-row button')].find((b) => b.textContent.trim() === ${JSON.stringify(tx('쿠폰 쓰기', 'Use coupon'))})`);
  await sleep(700);
  const couponNear = await boxText(s, '.coupon-box .near-result');
  check('쿠폰 결과가 쿠폰 칸 단추 옆에 남음', couponNear.length > 0, couponNear);
  const headerSaved = await s.ev(`document.querySelector('header .saved')?.textContent.trim() ?? ''`);
  check('창 맨 위 안내에는 따로 띄우지 않음', headerSaved === '', headerSaved);
  await sleep(2800);
  check('쿠폰 결과가 3초 뒤에도 남음', (await boxText(s, '.coupon-box .near-result')).length > 0);
  await shotSec(s, 'ux3a-events', `[...document.querySelectorAll('#panel-data section')].find((x) => x.querySelector('.events-box'))`, 900);
}

// ---- 5. 서버 계정 지우기 결과 ----
if (has('remove')) {
  await s.click(`document.getElementById('tab-data')`);
  const rm = tx('서버 계정 지우기', 'Delete server account');
  const sure = tx('정말 지우기', 'Really delete');
  await s.click(`[...document.querySelectorAll('.server-danger button')].find((b) => b.textContent.trim() === ${JSON.stringify(rm)})`);
  await s.click(`[...document.querySelectorAll('.server-danger button')].find((b) => b.textContent.trim() === ${JSON.stringify(sure)})`);
  await sleep(800);
  const removed = await boxText(s, '.server-box .near-result');
  check('계정을 지운 결과가 칸 안에 남음', removed === tx('서버 계정을 지웠어.', 'Deleted the server account.'), removed);
  await sleep(2800);
  check('3초 뒤에도 남음', (await boxText(s, '.server-box .near-result')).length > 0);
  await shotSec(s, 'ux3a-removed', SERVER_SEC, 700);
}

// ---- 1. 설치 첫날은 하루 회고를 하지 않음 ----
if (has('review')) {
  await main(`(() => {
    const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron');
    E.powerMonitor.getSystemIdleTime = () => 0;
    E.powerMonitor.getSystemIdleState = () => 'active';
    __jj.settings.set({ review: true, reviewMinute: 0, chatter: 'chatty' });
    __jj.stats.tick(Date.now(), false);
    globalThis.__ux.said.length = 0;
    return 1;
  })()`);
  for (let i = 0; i < 3; i++) {
    await main('__jj.planner.check(); 1');
    await sleep(300);
  }
  const todaySays = JSON.parse(await main('JSON.stringify(globalThis.__ux.said)'));
  const reviewToday = todaySays.filter((x) => x.kind === 'schedule');
  check('첫 기록이 오늘이면(설치 첫날) 하루 회고 말풍선이 없음', reviewToday.length === 0, JSON.stringify(todaySays).slice(0, 200));
  // 이틀 뒤(첫 기록은 이틀 전): 회고를 한다
  await main(`(() => { const real = Date.now; globalThis.__realNow = real; Date.now = () => real() + 2 * 86400000; globalThis.__ux.said.length = 0; return 1; })()`);
  for (let i = 0; i < 3; i++) {
    await main('__jj.planner.check(); 1');
    await sleep(300);
  }
  const laterSays = JSON.parse(await main('JSON.stringify(globalThis.__ux.said)'));
  check('첫 기록이 이틀 전이면 하루 회고를 함', laterSays.some((x) => x.kind === 'schedule'), JSON.stringify(laterSays).slice(0, 200));
  await main('(Date.now = globalThis.__realNow, 1)');
}

// ---- 7. 언어를 바꾸면 채팅 AI 이름이 새 말로 ----
if (has('chat')) {
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(1500);
  const c = await page('chat');
  await main("__jj.chat.debugSetState((st) => ({ ...st, provider: 'local' })); 1");
  await sleep(600);
  const localKo = tx('무료 AI', 'Free AI');
  const localEn = tx('Free AI', '무료 AI');
  const before = await c.ev(`document.body.innerText.includes(${JSON.stringify(localKo)})`);
  check('처음엔 지금 언어의 AI 이름', before === true);
  const other = ko ? 'en' : 'ko';
  await main(`__jj.settings.set({ lang: ${JSON.stringify(other)} }); 1`);
  await sleep(1500);
  const after = await c.ev(`document.body.innerText.includes(${JSON.stringify(localEn)})`);
  const stale = await c.ev(`document.body.innerText.includes(${JSON.stringify(localKo)})`);
  check('언어를 바꾸면 AI 이름이 새 말로 바뀜', after === true && stale === false, `새 말 ${after}, 옛 말 ${stale}`);
}
};

let failure;
try {
  await body();
} catch (err) {
  failure = err;
  console.log('FAIL 점검 도중 예외:', err?.message ?? err);
}
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${LANG}: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAIL ${failed.length}` : ''}`);
for (const r of failed) console.log(' FAIL:', r.name);
process.exit(failed.length || failure ? 1 : 0);
