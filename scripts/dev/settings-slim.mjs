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
  await type('');
  // ---- 딥링크: 설정 -> 큰 창 구역 ----
  await h.ev("document.querySelector('#ptab-today').click()");
  await s.ev("window.jjakkungSettings.openHome('assist')");
  check('설정에서 비서 구역 열기가 큰 창을 그 구역으로', await until(() => h.ev("document.querySelector('#ptab-assist')?.getAttribute('aria-current') === 'page'")));
  await s.ev("window.jjakkungSettings.openHome('pet')");
  check('설정에서 페어리 구역 열기', await until(() => h.ev("document.querySelector('#ptab-pet')?.getAttribute('aria-current') === 'page'")));
  // 큰 창에서만 쓰는 것이 설정 창으로 새지 않음: 큰 창에는 설정 다리 중 서버 계정이 없다
  check('큰 창에는 서버 계정 다리가 없음', (await h.ev('typeof window.jjakkungServer')) === 'undefined');
} catch (err) {
  check('시험 실행', false, String(err?.stack ?? err).slice(0, 300));
} finally {
  await cleanup();
}
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
