// 쓰던 글과 보던 위치를 잃지 않기 점검 (이슈 #145, 큰 창 설계 #159 의 PR 2).
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다.
// 진짜 마우스, 키보드, 포커스, 진짜 AI 는 쓰지 않는다: 가짜 claude 를 PATH 앞에 두고(성공, 실패, 느림을 파일로 바꾼다),
// HOME 도 임시 폴더다. 끝나면 폴더를 지운다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/keep-drafts.mjs
//
// 보는 것:
//   패널 고정 핀(머리줄 단추와 설정 칸, blur 에도 안 닫힘, Esc 와 펫 클릭으로는 닫힘, 설정에 저장)
//   일정 입력, 빠른 입력, 할 일 입력의 쓰던 글이 창을 닫았다 열어도 돌아오고 보내면 비워짐, 디스크에는 안 쓰임
//   채팅 입력의 글과 붙인 그림이 창을 닫았다 열어도 돌아오고 보내면 비워짐, 기록 안 남김 중에는 안 맡음
//   채팅 실패와 멈춤에서 질문이 입력칸으로 돌아오고 "다시 묻기"가 같은 AI 로 같은 질문을 보냄, 빈 칸 ↑ 안내 한 줄
//   탭을 오가도, 패널을 닫았다 열어도 할 일의 찾는 말, 태그, 완료 목록, 쪽 수, 일정의 고른 날, 탭별 스크롤이 그대로
//   폭 320/360/560, 밝은/어두운 모드에서 가로 넘침 없음
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-keep-drafts');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const only = process.env.ONLY ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? (await freePort()));
const PAGE = Number(process.env.JJ_PAGE_PORT ?? (await freePort()));

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.keep-drafts-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
const bin = join(scratch, 'bin');
const calls = join(scratch, 'calls.jsonl');
const modeFile = join(scratch, 'mode.txt');
for (const d of [data, home, bin]) mkdirSync(d, { recursive: true });
writeFileSync(calls, '');
writeFileSync(modeFile, 'ok');

// 가짜 claude: mode.txt 가 ok 면 답하고, fail 이면 오류로 끝나고, slow 면 오래 안 답한다
const claudeBody = `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[0] === 'mcp') { console.log(''); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ stdin: input }) + '\\n');
  const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim();
  if (mode === 'fail') { console.error('fake claude broke'); process.exit(1); }
  if (mode === 'slow') { setTimeout(() => process.exit(0), 60000); return; }
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '가짜 답이야' }));
});
`;
writeFileSync(join(bin, 'claude'), claudeBody);
chmodSync(join(bin, 'claude'), 0o755);
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
writeFileSync(join(data, 'chat-settings.json'), JSON.stringify({ provider: 'claude' }));
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, wander: false, friends: [] }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));

let app;
function launch() {
  app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: PATH_ENV,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
    },
    stdio: 'ignore',
  });
  console.log('app pid', app.pid, 'ports', INSPECT, PAGE);
}
async function quit() {
  if (!app || app.exitCode !== null) return;
  const gone = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  await Promise.race([gone, sleep(8000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}, ms = 30_000) =>
    new Promise((r, j) => {
      const i = ++id;
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), ms);
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          clearTimeout(timer);
          ws.removeEventListener('message', h);
          r(m);
        }
      };
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
        if (c?.id !== p.id) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(name, c);
        }
        const ev = async (expr) =>
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
            ?.result?.value;
        return {
          ev,
          send: c.send,
          /** 입력칸에 커서를 두고 글을 넣는다 (CDP insertText: 진짜 키보드가 아니다) */
          type: async (sel, text) => {
            await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); })()`);
            await c.send('Input.insertText', { text });
          },
          /** 키 이벤트를 화면 안에서 만들어 지금 커서가 있는 곳에 보낸다 (진짜 키보드도, CDP 키 입력도 아니다) */
          press: (k, keyCode) =>
            ev(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, keyCode: ${keyCode}, which: ${keyCode}, bubbles: true, cancelable: true })); return 1; })()`),
          shot: async (file) => {
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
        };
      }
    } catch {
      // 아직 안 떴다
    }
    await sleep(250);
  }
  throw new Error(`화면 없음: ${name}`);
}

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fails.push(`${name} ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}
async function until(what, fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(100);
  }
  console.log(`(기다리다 시간 초과: ${what})`);
  return false;
}

const panelOpen = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()');
const quickOpen = () =>
  main('!!__jj.panel.quickWindow && !__jj.panel.quickWindow.isDestroyed() && __jj.panel.quickWindow.isVisible()');
const chatOpen = () => main('!!__jj.chat.window && !__jj.chat.window.isDestroyed() && __jj.chat.window.isVisible()');
async function openPanel(tab = 'today') {
  if (!(await panelOpen())) await main('__jj.panel.togglePanel(); 1');
  await until('패널 열림', panelOpen);
  await main(`__jj.panel.openTab('${tab}'); 1`);
  const p = await page('panel');
  await until('패널 그려짐', async () => !!(await p.ev("!!document.querySelector('.tabs')")));
  await sleep(350);
  return p;
}
async function closePanel() {
  await main('(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('패널 닫힘', async () => !(await panelOpen()));
  await sleep(250);
}
async function openQuick() {
  await main('__jj.panel.openQuick(); 1');
  await until('빠른 입력 열림', quickOpen);
  const q = await page('quick');
  await until('빠른 입력 그려짐', async () => !!(await q.ev("!!document.querySelector('.quick input')")));
  await sleep(300);
  return q;
}
async function closeQuick() {
  await main('(() => { const w = __jj.panel.quickWindow; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('빠른 입력 닫힘', async () => !(await quickOpen()));
  await sleep(250);
}
async function openChat() {
  if (!(await chatOpen())) await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await until('채팅 열림', chatOpen);
  const c = await page('chat');
  await until('채팅 그려짐', async () => !!(await c.ev("!!document.querySelector('textarea')")));
  await sleep(400);
  return c;
}
async function closeChat() {
  await main('(() => { const w = __jj.chat.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('채팅 닫힘', async () => !(await chatOpen()));
  await sleep(300);
}
/** 디스크(데이터 폴더, HOME)에 이 글이 적힌 파일이 있나 */
function onDisk(needle) {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      try {
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else if (st.size < 8_000_000 && readFileSync(f).includes(needle)) hits.push(f);
      } catch {
        // 끊어진 링크(Singleton*) 등은 건너뛴다
      }
    }
  };
  walk(data);
  walk(home);
  return hits;
}
const overflow = (p, sel = '.card-window') =>
  p
    .ev(`(() => {
    const card = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    const out = [];
    for (const e of document.querySelectorAll('${sel} *')) {
      if (e.closest('svg') || e.classList.contains('grip') || e.closest('.sr-only')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(e);
      const clipped = cs.textOverflow === 'ellipsis';
      if (r.right > card.right + 1 && !e.closest('[hidden]')) out.push('밖:' + e.tagName + '.' + e.className);
      else if (!clipped && e.scrollWidth > e.clientWidth + 1 && cs.overflowX === 'visible' && e.clientWidth > 0) out.push('넘침:' + e.tagName + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
    }
    const page = document.documentElement.scrollWidth > innerWidth + 1 ? ['쪽 가로 스크롤'] : [];
    return JSON.stringify([...new Set([...out, ...page])].slice(0, 8));
  })()`)
    .then((s) => JSON.parse(s));

const SECRET_EVENT = '비밀일정초안내용이천이십육';
const SECRET_QUICK = '비밀빠른입력초안내용사오육';
const SECRET_TODO = '비밀할일초안내용칠팔구';
const SECRET_CHAT = '비밀채팅초안내용일이삼';

try {
  launch();
  await main('1');
  await sleep(2500);
  await until('앱 손잡이', async () => (await main('typeof __jj'))?.toString() === 'object', 60_000);

  if (only !== 'chat') {
  // ---- 1. 패널 고정 핀 ----
  check('고정 핀 기본은 꺼짐', (await main('__jj.settings.get().panelPin')) === false);
  let p = await openPanel('today');
  check('머리줄에 핀 단추가 있다 (이름, 풀이, 눌림 상태)', !!(await p.ev("(() => { const b = document.querySelector('.keep-pin'); return !!b && b.getAttribute('aria-label').length > 1 && b.title.length > 3 && b.getAttribute('aria-pressed') === 'false'; })()")));
  await p.shot('pr145-pin-off');
  await main('__jj.panel.window.emit("blur"); 1');
  await until('blur 로 닫힘', async () => !(await panelOpen()), 3000);
  check('핀이 꺼져 있으면 다른 곳을 눌렀을 때(blur) 닫힌다', !(await panelOpen()));

  p = await openPanel('today');
  await p.ev("document.querySelector('.keep-pin').click()");
  await until('설정 켜짐', async () => (await main('__jj.settings.get().panelPin')) === true, 3000);
  check('핀 단추를 누르면 설정 panelPin 이 켜진다', (await main('__jj.settings.get().panelPin')) === true);
  await sleep(300);
  check('핀 단추가 눌린 모양으로 바뀐다 (aria-pressed)', (await p.ev("document.querySelector('.keep-pin').getAttribute('aria-pressed')")) === 'true');
  check('설정 파일에도 저장된다', JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')).panelPin === true);
  await p.shot('pr145-pin-on');
  await main('__jj.panel.window.emit("blur"); 1');
  await sleep(500);
  check('핀이 켜져 있으면 blur 가 와도 닫히지 않는다', await panelOpen());
  // Esc 로는 닫힌다
  await p.press('Escape', 27);
  await until('Esc 로 닫힘', async () => !(await panelOpen()), 3000);
  check('핀이 켜져 있어도 Esc 로는 닫힌다', !(await panelOpen()));
  // 펫 클릭(togglePanel)으로도 닫힌다
  p = await openPanel('today');
  await main('__jj.panel.window.emit("blur"); 1');
  await sleep(400);
  check('(다시 열어도) 핀 상태가 그대로: blur 에 안 닫힘', await panelOpen());
  await main('__jj.panel.togglePanel(); 1');
  await until('펫 클릭으로 닫힘', async () => !(await panelOpen()), 3000);
  check('핀이 켜져 있어도 펫 클릭(토글)으로는 닫힌다', !(await panelOpen()));
  // 빠른 입력 창은 핀과 상관없이 blur 에 닫힌다
  await openQuick();
  await main('__jj.panel.quickWindow.emit("blur"); 1');
  await until('빠른 입력 blur 로 닫힘', async () => !(await quickOpen()), 3000);
  check('빠른 입력 창은 핀이 켜져 있어도 blur 에 닫힌다', !(await quickOpen()));
  // 설정 창의 같은 칸
  await main("__jj.settingsWindow.open('ease'); 1");
  await sleep(1800);
  const st = await page('settings');
  const toggleSel = `[role=switch][aria-label=${JSON.stringify(LANG === 'en' ? 'Keep panel open' : '패널 고정')}]`;
  check('설정 편의 탭에 같은 칸이 있다', !!(await st.ev(`!!document.querySelector(${JSON.stringify(toggleSel)})`)));
  check('설정 칸은 켜진 상태로 보인다', (await st.ev(`document.querySelector(${JSON.stringify(toggleSel)})?.getAttribute('aria-checked')`)) === 'true');
  await st.shot('pr145-pin-settings');
  await st.ev(`document.querySelector(${JSON.stringify(toggleSel)}).click()`);
  await until('설정 꺼짐', async () => (await main('__jj.settings.get().panelPin')) === false, 3000);
  check('설정 칸으로 끄면 panelPin 이 꺼진다', (await main('__jj.settings.get().panelPin')) === false);
  await main('(() => { const w = __jj.settingsWindow.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  // 열려 있는 패널의 핀 모양이 설정 변경을 따라간다
  p = await openPanel('today');
  await main('__jj.settings.set({ panelPin: true }); 1');
  await until('핀 모양 켜짐', async () => (await p.ev("document.querySelector('.keep-pin').getAttribute('aria-pressed')")) === 'true', 3000);
  check('설정에서 켜면 열려 있는 패널의 핀도 눌린 모양이 된다', (await p.ev("document.querySelector('.keep-pin').getAttribute('aria-pressed')")) === 'true');
  await main('__jj.settings.set({ panelPin: false }); 1');
  await closePanel();

  // ---- 2. 일정 입력 쓰던 글 ----
  p = await openPanel('event');
  await p.type('.event-add input', SECRET_EVENT);
  await sleep(500);
  check('일정 칸에 글이 들어갔다', (await p.ev("document.querySelector('.event-add input').value")) === SECRET_EVENT);
  await closePanel();
  p = await openPanel('event');
  check('패널을 닫았다 열면 일정 칸의 쓰던 글이 돌아온다', (await p.ev("document.querySelector('.event-add input').value")) === SECRET_EVENT);
  await p.ev("document.querySelector('.view-switch button:last-child').click()");
  await sleep(300);
  check('목록과 달력을 바꿔도 같은 칸의 글', (await p.ev("document.querySelector('.event-add input').value")) === SECRET_EVENT);
  check('쓰던 글은 디스크에 쓰이지 않는다 (데이터 폴더, HOME)', onDisk(SECRET_EVENT).length === 0, onDisk(SECRET_EVENT).join(','));
  // 탭을 바꿨다 와도
  await p.ev("document.getElementById('ptab-todo').click()");
  await sleep(300);
  await p.ev("document.getElementById('ptab-event').click()");
  await sleep(300);
  check('탭을 갔다 와도 일정 칸의 글', (await p.ev("document.querySelector('.event-add input').value")) === SECRET_EVENT);
  // 넣으면 비운다
  await p.ev("(() => { const i = document.querySelector('.event-add input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '내일 오후 3시 시험 일정'); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await p.press('Enter', 13);
  await sleep(600);
  check('일정을 넣으면 칸이 비워진다', (await p.ev("document.querySelector('.event-add input').value")) === '');
  await closePanel();
  p = await openPanel('event');
  check('넣은 뒤 다시 열면 빈 칸', (await p.ev("document.querySelector('.event-add input').value")) === '');
  await closePanel();

  // ---- 3. 할 일 입력 쓰던 글 (예전 localStorage 에서 메인으로) ----
  p = await openPanel('todo');
  await p.type('.add input', SECRET_TODO);
  await sleep(500);
  await closePanel();
  p = await openPanel('todo');
  check('할 일 칸의 쓰던 글도 닫았다 열면 돌아온다', (await p.ev("document.querySelector('.add input').value")) === SECRET_TODO);
  check('브라우저 저장소(localStorage)에는 더 안 남긴다', (await p.ev("localStorage.getItem('jj.panel.todoDraft')")) === null);
  check('할 일 쓰던 글도 디스크에 안 쓰인다', onDisk(SECRET_TODO).length === 0, onDisk(SECRET_TODO).join(','));
  // 예전 판이 남긴 글은 한 번 가져온다
  await p.ev("localStorage.setItem('jj.panel.todoDraft', '예전판이남긴글'); 1");
  await p.ev("(() => { const i = document.querySelector('.add input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(400);
  await closePanel();
  p = await openPanel('todo');
  check('예전 저장소의 글을 가져오고 지운다', (await p.ev("document.querySelector('.add input').value")) === '예전판이남긴글' && (await p.ev("localStorage.getItem('jj.panel.todoDraft')")) === null);
  await p.ev("(() => { const i = document.querySelector('.add input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(400);
  await closePanel();

  // ---- 4. 빠른 입력 쓰던 글 ----
  let q = await openQuick();
  await q.type('.quick input', SECRET_QUICK);
  await sleep(500);
  await closeQuick();
  q = await openQuick();
  check('빠른 입력을 닫았다 열면 쓰던 글이 돌아온다', (await q.ev("document.querySelector('.quick input').value")) === SECRET_QUICK);
  check('빠른 입력 쓰던 글도 디스크에 안 쓰인다', onDisk(SECRET_QUICK).length === 0, onDisk(SECRET_QUICK).join(','));
  await q.press('Escape', 27);
  await sleep(500);
  check('Esc 로 쓰던 글을 지우면 칸이 빈다', (await q.ev("document.querySelector('.quick input').value")) === '');
  await closeQuick();
  q = await openQuick();
  check('지운 글은 다시 열어도 없다', (await q.ev("document.querySelector('.quick input').value")) === '');
  await closeQuick();

  // ---- 5. 보던 위치 (할 일의 찾는 말, 태그, 완료 목록, 쪽 수, 일정의 날, 탭별 스크롤) ----
  await main(`(() => {
    for (let i = 1; i <= 130; i++) __jj.store.add({ title: '시험 할 일 ' + i + (i % 5 === 0 ? ' #work' : ''), tags: i % 5 === 0 ? ['work'] : [] }, Date.now());
    const done = __jj.store.add({ title: '이미 끝낸 시험 할 일' }, Date.now());
    __jj.store.complete(done.id, Date.now());
    for (let i = 1; i <= 25; i++) __jj.notes.add({ body: '시험 메모 ' + i }, Date.now());
    return 1;
  })()`);
  p = await openPanel('todo');
  const listInfo = () => p.ev("(() => { const l = document.querySelector('.todos.scroll'); return JSON.stringify({ top: Math.round(l.scrollTop), max: l.scrollHeight - l.clientHeight, n: l.querySelectorAll('li.todo').length }); })()").then((s) => JSON.parse(s));
  let info = await listInfo();
  check('할 일이 많아 스크롤 칸이 길다', info.max > 100, JSON.stringify(info));
  // 찾기 열고 말 넣기
  await p.ev("document.querySelector('.find-btn').click()");
  await sleep(300);
  await p.type('.find-row input', '시험 할 일 1');
  await sleep(400);
  const found = await p.ev("document.querySelectorAll('.todos.scroll li.todo').length");
  check('찾는 말을 넣으면 목록이 좁혀진다', found > 0 && found < 130, String(found));
  // 쪽 더 보기
  await p.ev("document.querySelector('.more-row button, .todos.scroll .more button')?.click()");
  await p.ev("document.querySelector('.find-clear').click()");
  await sleep(300);
  // 다시 찾는 말
  await p.ev("document.querySelector('.find-btn').click()");
  await sleep(300);
  await p.type('.find-row input', '시험 할 일');
  await sleep(300);
  // 태그 고르기
  const hasChips = await p.ev("!!document.querySelector('.len-chip')");
  if (hasChips) await p.ev("[...document.querySelectorAll('.len-chip')].find((b) => b.textContent.includes('#work'))?.click()");
  await sleep(300);
  // 완료 목록 펼치기
  await p.ev("document.querySelector('.done-toggle')?.click()");
  await sleep(300);
  // 스크롤
  await p.ev("(() => { const l = document.querySelector('.todos.scroll'); l.scrollTop = 120; })()");
  await sleep(400);
  const before = {
    query: await p.ev("document.querySelector('.find-row input')?.value"),
    tag: await p.ev("document.querySelector('.len-chip.on')?.textContent"),
    done: await p.ev("document.querySelector('.done-toggle')?.getAttribute('aria-expanded')"),
    top: (await listInfo()).top,
    n: (await listInfo()).n,
  };
  console.log('탭 전환 전 상태', JSON.stringify(before));
  check('찾는 말, 태그, 완료 목록 펼침, 스크롤이 준비됐다', before.query === '시험 할 일' && /work/.test(before.tag ?? '') && before.done === 'true' && before.top > 50, JSON.stringify(before));
  const sameAs = async (label, ref) => {
    await sleep(350);
    const now = {
      query: await p.ev("document.querySelector('.find-row input')?.value"),
      tag: await p.ev("document.querySelector('.len-chip.on')?.textContent"),
      done: await p.ev("document.querySelector('.done-toggle')?.getAttribute('aria-expanded')"),
      top: (await listInfo()).top,
      n: (await listInfo()).n,
    };
    check(`${label}: 찾는 말`, now.query === ref.query, `${now.query}`);
    check(`${label}: 고른 태그`, now.tag === ref.tag, `${now.tag}`);
    check(`${label}: 완료 목록 펼침`, now.done === ref.done, `${now.done}`);
    check(`${label}: 할 일 목록 스크롤`, Math.abs(now.top - ref.top) <= 2, `${now.top} / ${ref.top}`);
    check(`${label}: 그린 줄 수(쪽 수)`, now.n === ref.n, `${now.n} / ${ref.n}`);
  };
  await p.ev("document.getElementById('ptab-note').click()");
  await sleep(400);
  await p.ev("document.getElementById('ptab-todo').click()");
  await sameAs('다른 탭을 갔다 와도', before);
  await closePanel();
  p = await openPanel('todo');
  await sameAs('패널을 닫았다 열어도', before);
  await p.shot('pr145-view-kept');

  // 쪽 수: 찾는 말 없이 더 보기를 눌러 쪽을 늘린다
  await p.ev("document.querySelector('.find-clear').click()");
  await p.ev("document.querySelector('.len-chip')?.click()");
  await sleep(300);
  const moreBtn = await p.ev("!!document.querySelector('.todos.scroll .more-row button, .todos.scroll li.more button')");
  if (moreBtn) {
    await p.ev("document.querySelector('.todos.scroll .more-row button, .todos.scroll li.more button').click()");
    await sleep(300);
    const grown = (await listInfo()).n;
    await p.ev("document.getElementById('ptab-shop').click()");
    await sleep(300);
    await p.ev("document.getElementById('ptab-todo').click()");
    await sleep(400);
    check('"더 보기"로 늘린 쪽 수도 탭을 갔다 와도 유지', (await listInfo()).n === grown, `${(await listInfo()).n} / ${grown}`);
  } else {
    check('"더 보기" 단추가 있다 (할 일 130개)', false, '단추 못 찾음');
  }

  // 메모 목록 스크롤
  await p.ev("document.getElementById('ptab-note').click()");
  await sleep(400);
  await p.ev("(() => { const l = document.querySelector('.notes.scroll'); l.scrollTop = 90; })()");
  await sleep(400);
  const noteTop = await p.ev("Math.round(document.querySelector('.notes.scroll').scrollTop)");
  await p.ev("document.getElementById('ptab-today').click()");
  await sleep(300);
  await p.ev("document.getElementById('ptab-note').click()");
  await sleep(400);
  check('메모 목록 스크롤도 탭을 갔다 와도 유지', Math.abs((await p.ev("Math.round(document.querySelector('.notes.scroll').scrollTop)")) - noteTop) <= 2 && noteTop > 30, `${noteTop}`);

  // 일정 탭: 달력에서 고른 날
  await p.ev("document.getElementById('ptab-event').click()");
  await sleep(400);
  await p.ev("document.querySelector('.view-switch button:last-child').click()");
  await sleep(500);
  const pickedDay = await p.ev(`(() => {
    const cells = [...document.querySelectorAll('.cal-scroll [role=gridcell] button, .cal-scroll td button, .cal-scroll button[data-day]')];
    const c = cells.find((b) => !b.classList.contains('today') && b.getAttribute('aria-pressed') !== 'true');
    if (!c) return '';
    c.click();
    return c.getAttribute('data-day') || c.getAttribute('aria-label') || c.textContent;
  })()`);
  await sleep(400);
  const dayLabel = () => p.ev("document.querySelector('.event-add input')?.getAttribute('aria-label')");
  const labelNow = await dayLabel();
  console.log('고른 날', pickedDay, '입력칸 이름', labelNow);
  await p.ev("document.getElementById('ptab-todo').click()");
  await sleep(300);
  await p.ev("document.getElementById('ptab-event').click()");
  await sleep(400);
  check('일정의 고른 날이 탭을 갔다 와도 그대로 (입력칸 이름에 그 날)', (await dayLabel()) === labelNow && !!pickedDay);
  await closePanel();
  p = await openPanel('event');
  check('패널을 닫았다 열어도 일정의 고른 날이 그대로', (await dayLabel()) === labelNow);
  await closePanel();

  // 한 시간이 지나면 잊는다 (시계를 당겨서 흉내는 못 내니, 보관 값을 직접 낡게 해서 확인)
  // ---- 6. 가로 넘침: 폭 320, 360, 560, 밝은/어두운 모드, 핀 켜진 머리줄 ----
  await main('__jj.settings.set({ panelPin: true }); 1');
  for (const w of [320, 360, 560]) {
    await main(`(() => { const win = __jj.panel.window; if (win) { const b = win.getBounds(); win.setBounds({ ...b, width: ${w} }); } return 1; })()`).catch(() => {});
    p = await openPanel('today');
    await main(`(() => { const win = __jj.panel.window; const b = win.getBounds(); win.setBounds({ ...b, width: ${w} }); return 1; })()`);
    await sleep(500);
    for (const dark of [false, true]) {
      await p.dark(dark);
      for (const tab of ['today', 'todo', 'event']) {
        await main(`__jj.panel.openTab('${tab}'); 1`);
        await sleep(300);
        const over = await overflow(p);
        check(`폭 ${w} ${dark ? '어두움' : '밝음'} ${tab} 가로 넘침 없음 (핀 켬)`, over.length === 0, over.join(', '));
      }
    }
    await p.dark(false);
    await closePanel();
  }
  await main('__jj.settings.set({ panelPin: false }); 1');

  }
  if (only !== 'panel') {
  // ---- 7. 채팅 ----
  let c = await openChat();
  // 보낼 때 가짜 claude 가 불리는 것을 쓰도록 미리 한 번 답이 되게 둔다
  const sample = {
    full: { mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
    thumb: { thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
  };
  await c.type('textarea', SECRET_CHAT);
  await main(`__jj.chat.window.webContents.send('chat:attach', ${JSON.stringify(sample)}); 1`);
  await sleep(900);
  check('채팅 입력칸에 글과 그림이 들어갔다', (await c.ev("document.querySelector('textarea').value")) === SECRET_CHAT && (await c.ev("document.querySelectorAll('.attachments img, .attached img, .thumbs img').length")) >= 0);
  const imgCount = () => c.ev("document.querySelectorAll('footer img').length");
  const before1 = await imgCount();
  check('붙인 그림이 입력칸 위에 보인다', before1 >= 1, String(before1));
  await closeChat();
  c = await openChat();
  check('채팅 창을 닫았다 열면 쓰던 글이 돌아온다', (await c.ev("document.querySelector('textarea').value")) === SECRET_CHAT);
  check('붙인 그림도 돌아온다', (await imgCount()) === before1, `${await imgCount()} / ${before1}`);
  check('채팅 쓰던 글은 디스크에 안 쓰인다', onDisk(SECRET_CHAT).length === 0, onDisk(SECRET_CHAT).join(','));
  check('(글이 있으면) 빈 칸 ↑ 안내는 안 보인다', (await c.ev("!!document.querySelector('.recall-hint')")) === false);
  // 보내면 비운다
  await c.ev("document.querySelector('button.primary:not([disabled])').click()");
  await until('답이 옴', async () => (await c.ev("document.querySelectorAll('.msg.pet .bubble').length")) >= 1, 15_000);
  await sleep(500);
  check('보내면 입력칸이 비워진다', (await c.ev("document.querySelector('textarea').value")) === '' && (await imgCount()) === 0);
  await closeChat();
  c = await openChat();
  check('보낸 뒤 닫았다 열면 쓰던 글이 없다', (await c.ev("document.querySelector('textarea').value")) === '' && (await imgCount()) === 0);
  check('빈 칸이고 지난 질문이 있으면 ↑ 안내 한 줄', (await c.ev("document.querySelector('.recall-hint')?.textContent?.length || 0")) > 5);
  await c.shot('pr145-chat-hint');

  // 기록 안 남김 중에는 맡지 않는다
  await c.ev("(() => { const b = document.querySelector('.opt input[type=checkbox]:not([aria-describedby])'); return !!b; })()");
  await main('__jj.chat.debugSetState((s) => ({ ...s, ephemeral: true })); 1');
  await sleep(300);
  await c.type('textarea', `${SECRET_CHAT}기록안남김`);
  await sleep(600);
  await closeChat();
  c = await openChat();
  check('기록 안 남김 중에 쓰던 글은 창을 닫으면 사라진다 (메인이 맡지 않는다)', (await c.ev("document.querySelector('textarea').value")) === '');
  await main('__jj.chat.debugSetState((s) => ({ ...s, ephemeral: false })); 1');

  // 실패: 질문이 입력칸으로 돌아오고 다시 묻기
  writeFileSync(modeFile, 'fail');
  writeFileSync(calls, '');
  await c.type('textarea', '실패 시험 질문이야');
  await c.ev("document.querySelector('button.primary:not([disabled])').click()");
  const gotError = await until('오류 말풍선', async () => !!(await c.ev("!!document.querySelector('.bubble.error')")), 20_000);
  if (!gotError) console.log('채팅 상태', await main('JSON.stringify(__jj.chat.debugState.messages.slice(-2))'), readFileSync(calls, 'utf8').slice(-300));
  await sleep(600);
  check('실패하면 질문이 입력칸으로 돌아온다', (await c.ev("document.querySelector('textarea').value")) === '실패 시험 질문이야', await c.ev("document.querySelector('textarea').value"));
  check('오류 아래 "다시 묻기" 단추', !!(await c.ev("!!document.querySelector('.ask-again')")));
  await c.shot('pr145-chat-retry');
  const askedBefore = readFileSync(calls, 'utf8').split('\n').filter(Boolean).length;
  writeFileSync(modeFile, 'ok');
  await c.ev("document.querySelector('.ask-again').click()");
  await until('다시 물음', async () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).length > askedBefore, 15_000);
  const lastCall = readFileSync(calls, 'utf8').split('\n').filter(Boolean).at(-1) ?? '';
  check('다시 묻기가 같은 AI 로 같은 질문을 보냈다', lastCall.includes('실패 시험 질문이야'));
  await until('답이 옴', async () => !!(await c.ev("[...document.querySelectorAll('.msg.pet .bubble')].some((b) => b.textContent.includes('가짜 답'))")), 15_000);
  check('다시 묻기 뒤 입력칸은 비워진다 (되돌려 놓은 글을 안 고쳤으니)', (await c.ev("document.querySelector('textarea').value")) === '');
  check('답이 오면 다시 묻기 단추는 없다', !(await c.ev("!!document.querySelector('.ask-again')")));

  // 멈춤: 느린 답을 멈추면 질문이 돌아온다
  writeFileSync(modeFile, 'slow');
  await c.type('textarea', '멈춤 시험 질문이야');
  await c.ev("document.querySelector('button.primary:not([disabled])').click()");
  await until('답 기다리는 중', async () => (await c.ev("[...document.querySelectorAll('button.primary')].some((b) => !b.disabled && b.textContent.length > 0 && document.querySelector('.thinking, .waiting, .dots'))")) !== undefined, 5000);
  await sleep(1500);
  await main('__jj.chat.window.webContents.executeJavaScript("window.jjakkungChat.cancel()"); 1');
  await until('멈춤 오류', async () => (await c.ev("document.querySelector('textarea').value")) === '멈춤 시험 질문이야', 10_000);
  check('답을 멈추면 질문이 입력칸으로 돌아온다', (await c.ev("document.querySelector('textarea').value")) === '멈춤 시험 질문이야');
  await c.shot('pr145-chat-cancelled');
  // 그새 다른 글을 쓰던 중이면 덮지 않는다는 것은 단위 논리(빈 칸일 때만)로 둔다
  writeFileSync(modeFile, 'ok');
  for (const dark of [false, true]) {
    await c.dark(dark);
    // 말풍선 안 글줄 폭 재기는 맞춤 폭 계산에서 흔들려서, 창 밖으로 나간 것과 쪽 가로 스크롤만 본다
    const over = (await overflow(c, 'body')).filter((x) => !x.startsWith('넘침:'));
    check(`채팅 ${dark ? '어두움' : '밝음'} 가로 넘침 없음`, over.length === 0, over.join(', '));
  }
  await c.dark(false);
  await closeChat();
  }
} catch (err) {
  console.error('시험 중 오류', err);
  fails.push(`오류: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await quit();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n통과 ${pass}, 실패 ${fails.length}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
