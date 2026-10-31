// 설정 줄이기 점검 (ui/settings-slim): 설정에는 계정, 일반, AI 연결, 정보만 남고 페어리 꾸미기와 비서 기능은
// 큰 창 사이드바 "페어리", "비서" 구역에 있다. 옮긴 항목의 저장과 반영, 설정 찾기의 안내, 설정에서 큰 창으로 가는 길을 본다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en JJ_INSPECT_PORT=9830 JJ_PAGE_PORT=9831 node scripts/dev/settings-slim.mjs
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 진짜 AI 없음. 폭 760/1100 x 밝음/어두움 (PASS/FAIL)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-slim');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const TAG = process.env.TAG ?? 'after';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9830);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9831);
const ko = LANG === 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.slim-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: ko ? '콩' : 'Mochi' }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: { HOME: home, SHELL: '/usr/bin/false', PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: 'ignore',
});
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { app.kill('SIGTERM'); } catch {}
  await sleep(800);
  try { app.kill('SIGKILL'); } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', () => { try { app.kill('SIGKILL'); } catch {} rmSync(scratch, { recursive: true, force: true }); });

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id;
    const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), 30000);
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { clearTimeout(timer); ws.removeEventListener('message', h); r(m); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send };
}
let mainConn;
async function main(expr) {
  for (let i = 0; i < 120 && !mainConn; i++) {
    try { const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json(); mainConn = await connect(t.webSocketDebuggerUrl); } catch { await sleep(250); }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const conns = new Map();
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        let c = conns.get(name);
        if (!c || c.id !== p.id) { c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) }; conns.set(name, c); await c.send('Page.enable'); }
        return {
          ev: async (expr) => {
            const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
            return r.result?.result?.value;
          },
          dark: (on) => c.send('Emulation.setEmulatedMedia', { features: on ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [] }),
          shot: async (file) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${file}.png`, Buffer.from(r.result.data, 'base64')); },
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
const until = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(150); } return false; };
const overflow = (pg, sel) => pg.ev(`[...document.querySelectorAll('${sel} *')].filter((e) => { if (e.closest('.settings-jump')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map((e) => e.tagName + '.' + e.className).slice(0, 4).join(',')`);

try {
  await until(async () => (await main('typeof __jj !== "undefined"').catch(() => false)));
  // ---- 큰 창: 사이드바와 새 구역 ----
  await main("__jj.home.open('pet'); 1");
  await until(() => main('!!__jj.home.window && !__jj.home.window.isDestroyed()'));
  const h = await page('home');
  await until(() => h.ev("!!document.querySelector('#ptab-assist')"));
  const names = await h.ev("[...document.querySelectorAll('.home-nav .name')].map((e) => e.textContent.trim()).join('|')");
  check('사이드바에 페어리, 비서 구역', names.includes(ko ? '페어리' : 'Fairy') && names.includes(ko ? '비서' : 'Assistant'), names);
  check('처음 연 구역이 페어리', await until(() => h.ev("document.querySelector('#ptab-pet')?.getAttribute('aria-current') === 'page'")));
  await until(() => h.ev("!!document.querySelector('.hub:not([hidden]) #hub-pet-voice')"));
  const groups = await h.ev("[...document.querySelectorAll('#hub-page-pet section > h2')].map((e) => e.textContent.trim()).join('|')");
  check('페어리 구역 묶음에 한 줄 설명이 붙음', (await h.ev("document.querySelectorAll('#hub-page-pet .section-lede').length")) >= 6, groups);
  check('설정에서 꺼낸 항목이 큰 창에 있음(말투, 움직임)', (await h.ev("!!document.querySelector('#hub-pet-voice .speech-preview, #hub-pet-voice .speech-editor') && !!document.querySelector('#hub-pet-move [role=switch]')")));

  for (const width of [760, 1100]) {
    await main(`__jj.home.window.setBounds({ x: 40, y: 40, width: ${width}, height: 760 }); 1`);
    await sleep(500);
    for (const dark of [false, true]) {
      await h.dark(dark);
      for (const sec of ['pet', 'assist']) {
        await h.ev(`document.querySelector('#ptab-${sec}').click()`);
        await sleep(500);
        await h.ev("document.querySelector('.hub').scrollTop = 0");
        await h.shot(`${TAG}-home-${sec}-${LANG}-${width}${dark ? '-dark' : ''}`);
        const ov = await overflow(h, `#hub-page-${sec}`);
        check(`${sec} 구역 가로 넘침 없음 ${width}${dark ? ' dark' : ''}`, ov === '', ov);
      }
    }
    await h.dark(false);
  }

  // ---- 옮긴 항목의 저장과 반영 ----
  await h.ev("document.querySelector('#ptab-pet').click()");
  await sleep(300);
  const before = await main('__jj.settings.get().persona');
  const next = await h.ev("(() => { const b = [...document.querySelectorAll('#hub-pet-voice fieldset.segmented button')].find((x) => x.getAttribute('aria-pressed') === 'false'); const label = b.textContent; b.click(); return label; })()");
  await sleep(500);
  const after = await main('__jj.settings.get().persona');
  check('말투(성격) 바꾸면 저장됨', after !== before, `${before} -> ${after} (${next})`);
  check('말투 바꾸면 미리 듣기가 그려짐', await h.ev("!!document.querySelector('#hub-pet-voice .speech-preview, #hub-pet-voice .speech-editor')"));
  const wander = await main('__jj.settings.get().wander');
  await h.ev("document.querySelector('#hub-pet-move [role=switch]').click()");
  await sleep(500);
  check('돌아다니기(움직임 켜고 끄기)가 저장됨', (await main('__jj.settings.get().wander')) !== wander);
  await h.ev("document.querySelector('#ptab-assist').click()");
  await sleep(300);
  const chatter = await main('__jj.settings.get().chatter');
  await h.ev("[...document.querySelectorAll('#hub-assist-talk fieldset.segmented button')].find((x) => x.getAttribute('aria-pressed') === 'false').click()");
  await sleep(500);
  check('말 걸기 빈도가 저장됨', (await main('__jj.settings.get().chatter')) !== chatter);
  const review = await main('__jj.settings.get().review');
  await h.ev("document.querySelector('#hub-assist-review [role=switch]').click()");
  await sleep(400);
  check('하루 회고 켜고 끄기가 저장됨', (await main('__jj.settings.get().review')) !== review);
  // 구역을 오가도 쓰던 규칙 글이 남음
  await h.ev("(() => { const t = document.querySelector('#hub-assist-memory textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '답은 세 줄'); t.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await h.ev("document.querySelector('#ptab-today').click()");
  await sleep(200);
  await h.ev("document.querySelector('#ptab-assist').click()");
  await sleep(200);
  check('구역을 오가도 쓰던 규칙 글이 남음', (await h.ev("document.querySelector('#hub-assist-memory textarea').value")) === '답은 세 줄');
  // 설정 창 반영: 설정을 바꾸면 큰 창에도 즉시
  await main("__jj.settings.set({ persona: 'custom' }); 1");
  await sleep(500);
  check('다른 곳에서 바꾼 설정이 구역에 반영됨', await h.ev("!!document.querySelector('#hub-pet-voice .speech-editor')"));

  // 대사 고치기와 갤러리는 페어리 구역 안에서 열린다 (qa-pr133, todo-gallery-setup 이 쓰는 길)
  await h.ev("document.querySelector('#ptab-pet').click()");
  await sleep(300);
  await h.ev(`[...document.querySelectorAll('#hub-pet-voice button')].find((b) => b.innerText.trim() === ${JSON.stringify(ko ? '대사 고치기' : 'Edit lines')}).click()`);
  check('페어리 구역에서 대사 고치기 시트가 열림', await until(() => h.ev("document.querySelectorAll('.lines-group').length > 5")));
  await h.ev("document.querySelector('.lines-sheet button.link, .lines-sheet .ghost')?.click(); 1");
  await sleep(300);
  check('갤러리 열기 단추가 페어리 구역에 있음', await h.ev(`[...document.querySelectorAll('#hub-page-pet button')].some((b) => b.textContent === ${JSON.stringify(ko ? '페어리 갤러리 열기' : 'Open the fairy gallery')})`));

  // ---- 설정 창: 남긴 탭만 ----
  await main('__jj.settingsWindow.open(); 1');
  const s = await page('settings');
  await until(() => s.ev("!!document.querySelector('#tab-data')"));
  const tabs = await s.ev("[...document.querySelectorAll('[role=tab]')].map((e) => e.id).join(',')");
  check('설정 탭은 데이터, 일반, AI, 정보 넷', tabs === 'tab-data,tab-ease,tab-ai,tab-about', tabs);
  check('설정 첫 탭이 데이터와 계정', (await s.ev("document.querySelector('[role=tab][aria-selected=true]').id")) === 'tab-data');
  for (const width of [440, 360, 820]) {
    await main(`__jj.settingsWindow.window.setSize(${width}, 640); 1`);
    await sleep(400);
    for (const tab of ['data', 'ease', 'ai', 'about']) {
      for (const dark of [false, true]) {
        await s.dark(dark);
        await s.ev(`document.querySelector('#tab-${tab}').click()`);
        await sleep(250);
        await s.shot(`${TAG}-settings-${tab}-${LANG}-${width}${dark ? '-dark' : ''}`);
        const ov = await overflow(s, `#panel-${tab}`);
        check(`설정 ${tab} 가로 넘침 없음 ${width}${dark ? ' dark' : ''}`, ov === '', ov);
      }
    }
    await s.dark(false);
  }
  await main('__jj.settingsWindow.window.setSize(520, 700); 1');
  await s.ev("document.querySelector('#tab-ease').click()");
  await sleep(200);
  check('일반 탭에 알림과 소리, 언어, 시작이 있음', (await s.ev("document.querySelectorAll('#panel-ease section > h2').length")) >= 6);
  check('일반 탭에서 큰 창 구역으로 가는 길', (await s.ev("document.querySelectorAll('#panel-ease .hub-sign button').length")) === 2);
  check('AI 탭에 규칙, 기억, 할 일 알기가 없음', !(await s.ev("/규칙|기억|Rules|remembers/.test([...document.querySelectorAll('#panel-ai section > h2')].map((e) => e.textContent).join(' '))")));
  // ---- 설정 찾기: 옮긴 항목은 길 안내 ----
  const type = async (q) => s.ev(`(() => { const i = document.querySelector('input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await type(ko ? '말투' : 'tone');
  await sleep(300);
  check('설정 찾기 "말투"가 페어리 구역으로 안내함', (await s.ev("document.querySelectorAll('.moved-hits button').length")) >= 1);
  await s.shot(`${TAG}-settings-search-moved-${LANG}`);
  await type(ko ? '로그아웃' : 'sign out');
  await sleep(300);
  check('설정에 남은 말은 안내 없이 칸이 나옴', (await s.ev("document.querySelectorAll('.moved-hits').length")) === 0);
  await type('ai');
  await sleep(300);
  check('설정 찾기 "ai" 가 gait, daily 에 걸리지 않음(안내는 AI 도우미 하나)', (await s.ev("document.querySelectorAll('.moved-list li').length")) === 1);
  await type(ko ? '휴식' : 'rest');
  await sleep(300);
  check('설정 찾기 동의어(휴식, rest)가 삐짐으로 안내', (await s.ev("document.querySelectorAll('.moved-list li').length")) >= 1);
  await type('');
  // ---- 딥링크: 설정 -> 큰 창 구역 ----
  await h.ev("document.querySelector('#ptab-today').click()");
  await s.ev("window.jjakkungSettings.openHome('assist')");
  check('설정에서 비서 구역 열기가 큰 창을 그 구역으로', await until(() => h.ev("document.querySelector('#ptab-assist')?.getAttribute('aria-current') === 'page'")));
  await s.ev("window.jjakkungSettings.openHome('pet')");
  check('설정에서 페어리 구역 열기', await until(() => h.ev("document.querySelector('#ptab-pet')?.getAttribute('aria-current') === 'page'")));
  // ---- 큰 창은 허용표 안의 것만: 위험한 설정 다리 메서드는 없고, 메인도 큰 창에서 온 요청을 거절한다 ----
  const surface = await h.ev(`JSON.stringify({ settings: typeof window.jjakkungSettings, hub: Object.keys(window.jjakkungHub ?? {}).sort(), server: Object.keys(window.jjakkungServer ?? {}).sort() })`);
  const sf = JSON.parse(surface);
  const danger = ['relaunch', 'importData', 'exportData', 'restoreConfirm', 'restoreUndo', 'resetCoins', 'clearAiHistory', 'deleteModel', 'checkUpdate', 'saveDiagnostics', 'reset', 'importPet', 'exportPet', 'reveal', 'openOnboarding', 'refreshMcp', 'stats'];
  check('큰 창에는 설정 다리 전체가 없고 허용표 메서드만 있음', sf.settings === 'undefined' && sf.hub.includes('galleryShare') && danger.every((m) => !sf.hub.includes(m)), sf.hub.join(','));
  check('큰 창 서버 다리는 안내 읽기와 끄기 셋뿐', sf.server.join(',') === 'calendarHintNo,onChanged,status', sf.server.join(','));
  const call = (ch, ...args) => main(`(async () => { const { ipcMain } = process.mainModule.require('electron'); const f = ipcMain._invokeHandlers.get(${JSON.stringify(ch)}); return JSON.stringify(await f({ sender: __jj.home.contents }, ...${JSON.stringify(args)})); })()`);
  await main("__jj.settings.set({ persona: 'cat', lang: '" + LANG + "' }); 1");
  await call('settings:reset');
  check('큰 창이 보낸 설정 기본값 복원은 거절됨', (await main('__jj.settings.get().persona')) === 'cat');
  await call('settings:set', { lang: LANG === 'ko' ? 'en' : 'ko' });
  check('큰 창이 구역 밖 설정(언어)을 바꾸지 못함', (await main('__jj.settings.get().lang')) === LANG);
  await call('settings:set', { launchAtLogin: true, persona: 'friend' });
  check('큰 창 설정 조각에 구역 밖 키가 하나라도 있으면 통째로 거절', (await main('__jj.settings.get().persona')) === 'cat');
  await call('settings:set', { persona: 'friend' });
  check('큰 창이 구역 안 설정(말투)은 바꿀 수 있음', (await main('__jj.settings.get().persona')) === 'friend');
  check('큰 창이 보낸 AI 기록 지우기는 거절됨', JSON.parse(await call('settings:clear-ai-history')).ok === false);
  check('큰 창이 보낸 내 기록 읽기는 거절됨', (await call('settings:stats')) === undefined);
  // 다른 곳에서 바꾼 이름을 쓰던 칸이 닫을 때 옛 글로 덮지 않음
  await h.ev("document.querySelector('#ptab-pet').click()");
  await sleep(300);
  await h.ev("(() => { const i = document.querySelector('#hub-pet-look input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '쓰던글'); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await main("__jj.settings.set({ petName: '밖에서' }); 1");
  await sleep(500);
  await h.ev("window.dispatchEvent(new Event('beforeunload')); 1");
  await sleep(500);
  check('쓰던 이름 칸이 다른 곳의 새 이름을 닫을 때 덮지 않음', (await main('__jj.settings.get().petName')) === '밖에서');
  // 캘린더 끊김 알림이 조용해지는 기준: 큰 창 비서 구역을 보는 중
  await h.ev("document.querySelector('#ptab-assist').click()");
  await sleep(400);
  check('큰 창이 비서 구역을 보는 중임을 메인이 앎', (await main('__jj.home.visibleSection()')) === 'assist');
  await h.ev("document.querySelector('#ptab-today').click()");
  await sleep(300);
  check('다른 구역이면 조용히 하지 않음', (await main('__jj.home.visibleSection()')) === 'today');
  // 어두운 모드 건너뛰기 줄: 구역 바탕과 같은 느낌(띠 없음)
  await h.dark(true);
  await h.ev("document.querySelector('#ptab-assist').click()");
  await sleep(300);
  check('어두운 모드 건너뛰기 줄 바탕이 투명', (await h.ev("getComputedStyle(document.querySelector('#hub-page-assist .settings-jump')).backgroundColor")) === 'rgba(0, 0, 0, 0)');
  await h.shot(`${TAG}-home-assist-top-${LANG}-dark`);
  await h.dark(false);
  // ---- 로그인 상태의 데이터와 계정 탭: 서버 상태를 메인에서 흉내 내고 로그아웃 단추를 본다 ----
  await main(`(() => {
    const core = __jj.server.core;
    const st = { enabled: true, age: 'adult', on: true, device: true, signedIn: true, loggingIn: false, syncing: false, balance: 120, pending: 0, lastSyncAt: Date.now(), problem: null, merge: null, leftover: false, ai: false, tickets: null, aiWaitlisted: false, subscription: null, nickname: 'tester', code: 'F-AB12-CD34', inbox: 0, admin: false, providers: null, logins: ['google'], backup: null, features: {}, calendarHint: false };
    globalThis.__slimOut = false;
    core.status = () => (globalThis.__slimOut ? { ...st, signedIn: false, logins: [] } : st);
    core.allowed = () => true;
    core.refreshProviders = async () => {};
    return 1;
  })()`);
  await main('__jj.settingsWindow.window.setSize(520, 760); 1');
  // 서버 상태가 바뀌었다고 설정 창에 알린다 (화면이 다시 받아 그린다)
  await main("__jj.settingsWindow.window.webContents.send('server:changed', __jj.server.core.status()); 1");
  await until(() => s.ev("!!document.querySelector('.server-box')"));
  await sleep(300);
  await s.ev("document.querySelector('#tab-data').click()");
  await sleep(500);
  const first = await s.ev("document.querySelector('#panel-data > section:first-child .server-box') ? 'server' : 'other'");
  check('데이터와 계정 탭 맨 위가 계정 칸', first === 'server', first + ' ' + (await s.ev("document.querySelector('#panel-data').innerText.slice(0, 120)")));
  const lo = await s.ev("(() => { const b = document.querySelector('.server-box .ghost.logout'); if (!b) return null; const r = b.getBoundingClientRect(); const row = b.parentElement; return { text: b.textContent.trim(), first: row.firstElementChild === b, color: getComputedStyle(b).color, visible: r.width > 0 && r.top < innerHeight }; })()");
  check('로그인 상태에 로그아웃 단추가 줄 맨 앞에 눈에 띄게 보임', !!lo && lo.first && lo.visible && lo.text === (ko ? '로그아웃' : lo.text), JSON.stringify(lo));
  for (const dark of [false, true]) {
    await s.dark(dark);
    await sleep(200);
    await s.shot(`${TAG}-settings-data-loggedin-${LANG}${dark ? '-dark' : ''}`);
  }
  await s.dark(false);
} catch (err) {
  check('시험 실행', false, String(err?.stack ?? err).slice(0, 300));
} finally {
  await cleanup();
}
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
