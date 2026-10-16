// PR #134 (#124) 독립 QA: 질문 칩 경계값, 긴 제목, 패널 밖 끝내기와 지우기와 되돌리기, 가장자리 확대,
// 커진 동안 크기, 깡충, 걷기, 숨기기, 모니터 바뀜, 짧은 누르기, 빠른 끌기와 느린 끌기, 못 키울 때 클릭,
// 커져도 말풍선 유지, 움직임 줄이기, 칸 셋 끄기, 백업 되살리기 뒤 진행 중 표시 비움, 넘침과 줄표와 영어판 한글.
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, JJ_TEST_SECRETS=memory, 포트 무작위) 화면 요소를 CDP 로 누른다.
// 진짜 마우스, 키보드, AI 는 쓰지 않는다. 우클릭 메뉴는 운영체제 메뉴라 템플릿을 받아 그 줄의 click 을 부른다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr134.mjs
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/qa-pr134');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
const INSPECT = await freePort();
const PAGE = await freePort();

// 기대 글 (사전과 따로 적는다)
const ko = {
  menu: '물어보기',
  ask: '뭐가 궁금해?',
  more: '다른 것도',
  enough: '됐어',
  doneNone: '오늘은 아직 끝낸 할 일이 없어. 하나만 해 볼까?',
  doneAll: (n) => `오늘 할 일 ${n}개 끝냈어! 남은 건 없어.`,
  leftNone: '남은 할 일이 없어. 푹 쉬어도 돼!',
  left: (n, t) => `남은 할 일이 ${n}개야. 먼저 "${t}" 어때?`,
  eventNone: '앞으로 2주 안에 일정이 없어.',
  eventTomorrowAllDay: (t) => `다음 일정은 내일 종일에 있는 "${t}" 일정이야.`,
  eventNow: (t) => `지금 "${t}" 일정이 진행 중이야.`,
  focusNone: '오늘은 아직 집중한 시간이 없어.',
  focus: (s) => `오늘 ${s} 집중했어.`,
  focusRunning: (s) => `오늘 ${s} 집중했어. 지금도 집중 중이야!`,
  hm: (h, m) => `${h}시간 ${m}분`,
  coins: (n) => `코인 ${n}개 가지고 있어.`,
  doing: (t) => `▶ 진행 중: ${t}`,
  doingMore: (t, n) => `▶ 진행 중: ${t} 외 ${n}개`,
  toggles: { chips: '질문 칩', doing: '진행 중 말풍선', grow: '꾹 누르면 커지기' },
  todoTab: '할 일',
  longTitle: '분기 보고서 초안을 팀장님께 보내기 전에 숫자와 표를 한 번 더 확인하고 맞춤법도 보기',
};
const en = {
  menu: 'Quick questions',
  ask: 'What do you want to know?',
  more: 'Ask more',
  enough: 'Done',
  doneNone: 'No to-dos finished today yet. How about one?',
  doneAll: (n) => `You finished ${n} to-do${n === 1 ? '' : 's'} today! Nothing left.`,
  leftNone: 'Nothing left to do. Go rest!',
  left: (n, t) => `${n} to-do${n === 1 ? '' : 's'} left. How about "${t}" first?`,
  eventNone: 'No events in the next two weeks.',
  eventTomorrowAllDay: (t) => `Your next event is "${t}", tomorrow all day.`,
  eventNow: (t) => `"${t}" is on right now.`,
  focusNone: 'No focus time yet today.',
  focus: (s) => `You focused for ${s} today.`,
  focusRunning: (s) => `You focused for ${s} today. Still going!`,
  hm: (h, m) => `${h} hr ${m} min`,
  coins: (n) => `You have ${n} coin${n === 1 ? '' : 's'}.`,
  doing: (t) => `▶ Working on: ${t}`,
  doingMore: (t, n) => `▶ Working on: ${t} and ${n} more`,
  toggles: { chips: 'Quick questions', doing: 'In-progress bubble', grow: 'Grow when held' },
  todoTab: 'To-do',
  longTitle: 'Send the quarterly report draft to the team lead after checking every number and table twice',
};
const TXT = LANG === 'en' ? en : ko;
/** shortTitle 과 같은 규칙을 따로 적는다: 공백 하나로, max 넘으면 max-1 자 + … */
const cut = (s, max) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.qa-pr134-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  J({ onboarded: true, osNotify: false, lang: LANG, wander: false, friends: [], chatter: 'quiet' }),
);
writeFileSync(join(data, 'day-plan.json'), J({ prefs: { auto: false, fromMinute: 480 } }));

let app;
function launch() {
  app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
    },
    stdio: 'ignore',
  });
  console.log('app pid', app.pid, 'lang', LANG, 'ports', INSPECT, PAGE);
}
/** 데이터 폴더를 쓰는 앱 프로세스 (되살리기로 다시 켜진 것까지) */
const appPids = () => {
  try {
    // 다시 켜진 앱은 데이터 폴더를 환경 변수로만 받아 명령 줄에 없다: 디버그 포트로 찾는다
    return execFileSync('/usr/bin/pgrep', ['-f', '--', `--inspect=${INSPECT} `]).toString().trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
};
async function quitAll() {
  if (app && app.exitCode === null) {
    const gone = new Promise((r) => app.once('exit', r));
    app.kill('SIGTERM');
    await Promise.race([gone, sleep(8000)]);
  }
  for (let i = 0; i < 20 && appPids().length; i++) {
    for (const p of appPids()) try { process.kill(p, i < 10 ? 'SIGTERM' : 'SIGKILL'); } catch {}
    await sleep(500);
  }
}

// ---- CDP ----
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
      ws.send(J({ id: i, method, params }));
    });
  return { ws, send };
}
let mainConn;
async function main(expr) {
  if (!mainConn) {
    for (let i = 0; i < 160 && !mainConn; i++) {
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
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
            ?.value;
        const mouse = (type, x, y, o = {}) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: o.button ?? (type === 'mouseMoved' && !o.buttons ? 'none' : 'left'),
            buttons: o.buttons ?? (type === 'mousePressed' ? 1 : 0),
            clickCount: type === 'mouseMoved' ? 0 : 1,
          });
        const at = async (selector, index = 0) =>
          JSON.parse(
            await ev(
              `(() => { const e = document.querySelectorAll(${J(selector)})[${index}]; if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
            ),
          );
        return {
          ev,
          send: c.send,
          mouse,
          at,
          click: async (selector, index = 0) => {
            const r = await at(selector, index);
            if (!r) throw new Error(`요소 없음: ${selector}[${index}]`);
            await mouse('mouseMoved', r.x, r.y);
            await mouse('mousePressed', r.x, r.y);
            await mouse('mouseReleased', r.x, r.y);
          },
          shot: async (file) => {
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }),
          motion: (reduce) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
            }),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
async function until(what, fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(150);
  }
  throw new Error(`기다림 끝: ${what}`);
}
const soft = (p) => p.then(() => true, () => false);

const results = [];
const fails = [];
function check(name, ok, extra = '') {
  results.push(ok);
  if (!ok) fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const seenTexts = new Set();
const bubbleText = async (pet) => {
  const t = await pet.ev(
    `(() => { const b = document.getElementById('bubble'); return b.hidden || !b.classList.contains('shown') ? null : b.querySelector('p').textContent; })()`,
  );
  if (t) seenTexts.add(t);
  return t;
};
const bubbleButtons = async (pet) =>
  JSON.parse(await pet.ev(`JSON.stringify([...document.querySelectorAll('#bubble .actions button')].map((b) => b.textContent))`));
/** 말풍선이 창 안에 있고 안에서 글이 넘치지 않는다 */
const bubbleFits = async (pet) => {
  let f;
  for (let i = 0; i < 20; i++) {
    f = await bubbleFits1(pet);
    if (f.inside && f.over.length === 0) return f;
    await sleep(200);
  }
  return f;
};
const bubbleFits1 = async (pet) =>
  JSON.parse(
    await pet.ev(`(() => {
      const b = document.getElementById('bubble'); const r = b.getBoundingClientRect();
      const inside = r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      const over = [b, ...b.querySelectorAll('*')].filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1).map((e) => e.tagName + '.' + e.className);
      return JSON.stringify({ inside, over, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], win: [innerWidth, innerHeight] });
    })()`),
  );
const petBox = async () => JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
const winBox = async () => JSON.parse(await main('JSON.stringify(__jj.pet.win.getBounds())'));
const panelOpen = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()');
const inArea = (b, a) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1;

async function petPoint(pet) {
  return JSON.parse(
    await pet.ev(
      `(() => { const r = document.querySelector('#pet').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height * 0.6 }); })()`,
    ),
  );
}
async function tapPet(pet, holdMs = 0) {
  const c = await petPoint(pet);
  await pet.mouse('mouseMoved', c.x, c.y);
  await pet.mouse('mousePressed', c.x, c.y);
  if (holdMs) await sleep(holdMs);
  await pet.mouse('mouseReleased', c.x, c.y);
}
async function closePanel() {
  await main(`(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()`);
  await sleep(500);
}
async function capture(p, name, bg = true) {
  for (const dark of [false, true]) {
    await p.dark(dark);
    if (bg)
      await p.send('Emulation.setDefaultBackgroundColorOverride', {
        color: dark ? { r: 40, g: 42, b: 48, a: 1 } : { r: 214, g: 220, b: 228, a: 1 },
      });
    await sleep(250);
    await p.shot(`${name}-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await p.dark(false);
}
async function rightClickMenu(pet) {
  const c = await petPoint(pet);
  await pet.mouse('mouseMoved', c.x, c.y);
  await pet.mouse('mousePressed', c.x, c.y, { button: 'right', buttons: 2 });
  await pet.mouse('mouseReleased', c.x, c.y, { button: 'right', buttons: 0 });
  await sleep(500);
  return JSON.parse(await main('JSON.stringify(__t.menus.at(-1)?.map((i) => i.label ?? null) ?? [])'));
}
async function openChips(pet) {
  const labels = await rightClickMenu(pet);
  if (!labels.includes(TXT.menu)) throw new Error(`메뉴에 물어보기 없음 ${J(labels)}`);
  await main(`__t.menus.at(-1).find((i) => i.label === ${J(TXT.menu)}).click(); 1`);
  await until('칩 말풍선', async () => (await bubbleText(pet)) === TXT.ask);
  await sleep(400);
}
/** 칩 i 를 눌러 답을 받는다 (말풍선이 다시 그려지는 사이 묻히면 다시) */
async function askChip(pet, i) {
  for (let tries = 0; tries < 3; tries++) {
    await pet.click('#bubble .actions button', i);
    const t = await until('답', async () => {
      const x = await bubbleText(pet);
      return x && x !== TXT.ask ? x : null;
    }, 4000).catch(() => null);
    if (t) return t;
  }
  throw new Error(`칩 ${i} 답 없음`);
}
async function clearBubbles(pet) {
  for (let quiet = 0, n = 0; quiet < 4 && n < 40; n++) {
    const t = await bubbleText(pet);
    if (t === null || (await pet.ev(`document.getElementById('bubble').hasAttribute('data-ambient')`))) {
      quiet++;
      await sleep(800);
    } else {
      quiet = 0;
      await pet.click('#bubble');
      await sleep(1000);
    }
  }
}
function installStubs() {
  return main(`(() => {
    const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__t = { E, idle: E.powerMonitor.getSystemIdleTime, cursor: E.screen.getCursorScreenPoint, menu: E.Menu.buildFromTemplate, menus: [], at: { x: 0, y: 0 },
      all: E.screen.getAllDisplays, matching: E.screen.getDisplayMatching, nearest: E.screen.getDisplayNearestPoint };
    E.powerMonitor.getSystemIdleTime = () => 0;
    E.Menu.buildFromTemplate = (tpl) => { globalThis.__t.menus.push(tpl); return { popup() {} }; };
    __jj.settings.set({ osNotify: false, wander: false, friends: [], chatter: 'quiet' });
    return 1;
  })()`);
}
const doingIds = async () => JSON.parse(await main('JSON.stringify(__jj.doing.ids())'));

let panel;
async function openTodoPanel() {
  if (!(await panelOpen())) await main(`__jj.panel.openTab('todo'); 1`);
  else await main(`__jj.panel.openTab('todo'); 1`);
  await until('패널', panelOpen);
  await main(`__jj.panel.window.removeAllListeners('blur'); 1`);
  panel = await page('panel');
  await until('할 일 탭', async () => (await panel.ev(`!!document.querySelector('.add input')`)) === true);
  await sleep(300);
}
const rowIndex = async (title) =>
  Number(
    await panel.ev(
      `[...document.querySelectorAll('.todos .todo')].findIndex((li) => li.querySelector('.title-text')?.textContent.includes(${J(title)}))`,
    ),
  );
/** 줄에 마우스를 올린 뒤 그 줄의 selector 단추를 누른다 */
async function rowButton(title, selector) {
  const i = await rowIndex(title);
  if (i < 0) throw new Error(`줄 없음 ${title}`);
  const r = JSON.parse(
    await panel.ev(
      `(() => { const b = document.querySelectorAll('.todos .todo')[${i}].getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
    ),
  );
  await panel.mouse('mouseMoved', r.x, r.y);
  await sleep(250);
  const btn = JSON.parse(
    await panel.ev(
      `(() => { const e = document.querySelectorAll('.todos .todo')[${i}].querySelector(${J(selector)}); if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
    ),
  );
  if (!btn) throw new Error(`단추 없음 ${selector} @ ${title}`);
  await panel.mouse('mouseMoved', btn.x, btn.y);
  await panel.mouse('mousePressed', btn.x, btn.y);
  await panel.mouse('mouseReleased', btn.x, btn.y);
  await sleep(400);
}
const rowDoingOn = async (title) => {
  const i = await rowIndex(title);
  if (i < 0) return null;
  return panel.ev(`document.querySelectorAll('.todos .todo')[${i}].querySelector('.doing-btn')?.getAttribute('aria-pressed') ?? 'none'`);
};
async function setDoing(title, on) {
  for (let tries = 0; tries < 3; tries++) {
    if ((await rowDoingOn(title)) === String(on)) return;
    await rowButton(title, '.doing-btn');
    if (await soft(until('▶', async () => (await rowDoingOn(title)) === String(on), 2500))) return;
  }
  throw new Error(`▶ 안 바뀜 ${title}`);
}
const addTodo = async (title) => Number(await main(`__jj.store.add({ title: ${J(title)} }, Date.now()).id`));

/** 꾹 누르기 시작 (놓지 않음) */
async function hold(pet, ms = 900) {
  const c = await petPoint(pet);
  await pet.mouse('mouseMoved', c.x, c.y);
  await pet.mouse('mousePressed', c.x, c.y);
  await sleep(ms);
  return c;
}
async function release(pet, c, ms = 900) {
  await pet.mouse('mouseReleased', c.x, c.y);
  await sleep(ms);
}

try {
  launch();
  await until('__jj', () => main('typeof __jj === "object" && !!__jj.petChips'), 60_000);
  let pet = await page('pet');
  await installStubs();
  await sleep(6000);
  await clearBubbles(pet);
  const area = JSON.parse(await main('JSON.stringify(__t.E.screen.getDisplayMatching(__jj.pet.bounds()).workArea)'));
  const home0 = await petBox();
  console.log('작업 영역', J(area), '펫', J(home0));

  let idLong;
  if (process.env.QA_ONLY !== 'restore') {
  // ===== 1. 진짜 클릭으로 패널 =====
  {
    check('처음에는 패널이 닫혀 있다', (await panelOpen()) === false);
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
      await tapPet(pet);
      opened = await soft(until('패널', panelOpen, 3000));
    }
    check('펫을 CDP 로 짧게 누르면 패널이 열린다', opened);
    const tab = await (await page('panel')).ev(`document.querySelector('[role=tab][aria-selected=true]')?.textContent`);
    console.log('  처음 탭', tab);
    await closePanel();
  }

  // ===== 2. 빈 데이터 칩 =====
  {
    await openChips(pet);
    const btns = await bubbleButtons(pet);
    check('칩 다섯 개', btns.length === 5, J(btns));
    const want = [TXT.doneNone, TXT.leftNone, TXT.eventNone, TXT.focusNone, TXT.coins(Number(await main('__jj.store.balance()')))];
    for (let i = 0; i < 5; i++) {
      const text = await askChip(pet, i);
      check(`빈 데이터 칩 ${i + 1}`, text === want[i], text);
      await sleep(700);
      const fit = await bubbleFits(pet);
      if (fit.over.length || !fit.inside) check(`빈 데이터 칩 ${i + 1} 말풍선 넘침 없음`, false, J(fit));
      if (i === 0) await capture(pet, 'chip-empty');
      await sleep(300);
      if (i < 4) {
        await pet.click('#bubble .actions button', 0);
        await until('칩 다시', async () => (await bubbleText(pet)) === TXT.ask);
        await sleep(400);
      }
    }
    await pet.click('#bubble .actions button', 1);
    await until('닫힘', async () => (await bubbleText(pet)) === null);
    // 칩을 띄워 두고 그냥 두면 닫힌다 (25초)
    await openChips(pet);
    const gone = await soft(until('칩 저절로 닫힘', async () => (await bubbleText(pet)) === null, 32_000));
    check('칩을 그냥 두면 저절로 닫힌다', gone);
  }

  // ===== 3. 경계값 칩 =====
  {
    const one = await addTodo('물 마시기');
    await main(`__jj.store.completeOpen(${one}, Date.now()); 1`);
    await sleep(2500);
    await clearBubbles(pet);
    const longId = await addTodo(TXT.longTitle);
    // 내일 종일 일정, 75분 집중, 코인 1개
    await main(`(() => { const d = new Date(); d.setHours(0,0,0,0); __jj.events.add({ title: '가족 여행', startAt: d.getTime() + 86400000, allDay: true }, Date.now()); return 1; })()`);
    await main(`__jj.stats.addFocus(Date.now(), 75); 1`);
    const bal = Number(await main('__jj.store.balance()'));
    if (bal > 1) await main(`__jj.store.spend(${bal - 1}, 'qa', Date.now()); 1`);
    const coinsNow = Number(await main('__jj.store.balance()'));
    await openChips(pet);
    const a0 = await askChip(pet, 0);
    // 할 일이 하나 열려 있으니 doneAll 이 아니라 done(1, 1)
    check('칩 1: 끝낸 1개, 남은 1개', a0 === (LANG === 'en' ? 'You finished 1 to-do today! 1 left.' : '오늘 할 일 1개 끝냈어! 남은 건 1개야.'), a0);
    await pet.click('#bubble .actions button', 0);
    await until('칩', async () => (await bubbleText(pet)) === TXT.ask);
    await sleep(400);
    const a1 = await askChip(pet, 1);
    check('칩 2: 긴 제목은 24자로 잘린다', a1 === TXT.left(1, cut(TXT.longTitle, 24)), a1);
    check('잘린 제목이 빈칸 뒤 …로 끝나지 않는다', !/\s…/.test(a1), a1);
    await sleep(700);
    const fit = await bubbleFits(pet);
    check('긴 제목 답 말풍선이 창 안, 넘침 없음', fit.inside && fit.over.length === 0, J(fit));
    await capture(pet, 'chip-long');
    await pet.click('#bubble .actions button', 0);
    await until('칩', async () => (await bubbleText(pet)) === TXT.ask);
    await sleep(400);
    const a2 = await askChip(pet, 2);
    check('칩 3: 내일 종일 일정', a2 === TXT.eventTomorrowAllDay('가족 여행'), a2);
    await pet.click('#bubble .actions button', 0);
    await until('칩', async () => (await bubbleText(pet)) === TXT.ask);
    await sleep(400);
    const a3 = await askChip(pet, 3);
    check('칩 4: 75분은 1시간 15분', a3 === TXT.focus(TXT.hm(1, 15)), a3);
    await pet.click('#bubble .actions button', 0);
    await until('칩', async () => (await bubbleText(pet)) === TXT.ask);
    await sleep(400);
    const a4 = await askChip(pet, 4);
    check(`칩 5: 코인 ${coinsNow}개 (단수)`, a4 === TXT.coins(coinsNow) && coinsNow === 1, a4);
    await pet.click('#bubble .actions button', 1);
    await until('닫힘', async () => (await bubbleText(pet)) === null || (await bubbleText(pet))?.startsWith('▶'));
    // 지금 진행 중인 일정, 집중 중
    await main(`__jj.events.add({ title: '주간 회의', startAt: Date.now() - 10 * 60000, endAt: Date.now() + 50 * 60000 }, Date.now()); 1`);
    await main(`void __jj.planner.startFocus(25); 1`);
    await sleep(1500);
    await openChips(pet);
    const b2 = await askChip(pet, 2);
    check('칩 3: 지금 도는 일정', b2 === TXT.eventNow('주간 회의'), b2);
    await pet.click('#bubble .actions button', 0);
    await until('칩', async () => (await bubbleText(pet)) === TXT.ask);
    await sleep(400);
    const b3 = await askChip(pet, 3);
    check('칩 4: 집중 중이면 "지금도 집중 중"', b3 === TXT.focusRunning(TXT.hm(1, 15)), b3);
    await pet.click('#bubble .actions button', 1);
    await main(`__jj.planner.stopFocus(); 1`);
    await sleep(1500);
    await main(`__jj.store.remove(${longId}, Date.now()); 1`);
    await clearBubbles(pet);
  }

  // ===== 4. 긴 제목 진행 중, 여럿 =====
  await openTodoPanel();
  const T = {
    long: TXT.longTitle,
    a: LANG === 'en' ? 'Reply to email' : '메일 답장',
    b: LANG === 'en' ? 'Buy groceries' : '장보기',
  };
  // 사용자처럼 패널 입력칸에 넣는다
  const typeTodo = async (title) => {
    await panel.ev(`document.querySelector('.add input').focus()`);
    await panel.send('Input.insertText', { text: title });
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(500);
    return Number(await main(`__jj.store.list(Date.now()).open.find((t) => t.title === ${J(title)})?.id ?? -1`));
  };
  const id = { long: await typeTodo(T.long), a: await typeTodo(T.a), b: await typeTodo(T.b) };
  idLong = id.long;
  console.log('  넣은 할 일', J(id), J(await panel.ev(`[...document.querySelectorAll('.todos .todo .title-text')].map((e) => e.textContent)`)));
  await until('줄', async () => (await rowIndex(T.b)) >= 0);
  await setDoing(T.long, true);
  const longShown = TXT.doing(cut(T.long, 22));
  await sleep(1500);
  console.log('  긴 진행 중 실제', J(await bubbleText(pet)), '기대', J(longShown));
  if ((await bubbleText(pet)) === null) {
    console.log('  진단', await main(`JSON.stringify({ ids: __jj.doing.ids(), status: __jj.petChips.statusNow(), hidden: __jj.pet.isHidden(), idle: __jj.pet.isIdle?.(), vis: __jj.pet.win.isVisible() })`));
    try { console.log('  기록', readFileSync(join(data, 'logs', 'main.log'), 'utf8').split('\n').slice(-15).join('\n  ')); } catch {}
  }
  check('긴 제목 진행 중 말풍선은 22자로 잘린다', await soft(until('긴 진행 중', async () => (await bubbleText(pet)) === longShown, 15_000)), await bubbleText(pet));
  {
    await sleep(700);
    const fit = await bubbleFits(pet);
    check('긴 진행 중 말풍선이 창 안, 넘침 없음', fit.inside && fit.over.length === 0, J(fit));
    await capture(pet, 'doing-long');
  }
  await setDoing(T.a, true);
  await setDoing(T.b, true);
  check('셋이면 "외 2개"', await soft(until('여럿', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 2), 15_000)), await bubbleText(pet));
  {
    await sleep(700);
    const fit = await bubbleFits(pet);
    check('"외 2개" 말풍선 넘침 없음', fit.inside && fit.over.length === 0, J(fit));
    await capture(pet, 'doing-more');
    const rowOver = await panel.ev(
      `[...document.querySelectorAll('.todos .todo')].filter((li) => li.scrollWidth > li.clientWidth + 1).length`,
    );
    check('패널 할 일 줄 가로 넘침 없음 (긴 제목, ▶ 켬)', rowOver === 0, `넘친 줄 ${rowOver}`);
    // ▶ 와 × 사이 띄움 (마우스 올린 줄)
    {
      const i = await rowIndex(T.a);
      const r = JSON.parse(await panel.ev(`(() => { const b = document.querySelectorAll('.todos .todo')[${i}].getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`));
      await panel.mouse('mouseMoved', r.x, r.y);
      await sleep(300);
    }
    const gap = JSON.parse(
      await panel.ev(`(() => { const li = document.querySelectorAll('.todos .todo')[${await rowIndex(T.a)}]; const a = li.querySelector('.remove')?.getBoundingClientRect(); const b = li.querySelector('.doing-btn')?.getBoundingClientRect(); return JSON.stringify(a && b ? Math.round(b.left - a.right) : null); })()`),
    );
    console.log('  × 와 ▶ 사이 px', gap);
    await capture(panel, 'panel-doing', false);
  }
  // 다시 누르면 풀린다
  await setDoing(T.b, false);
  check('▶ 를 다시 누르면 그 할 일만 풀린다', await soft(until('풀림', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));

  // ===== 5. 패널 밖에서 끝내기와 지우기, 되돌리기 =====
  {
    // 긴 제목을 패널 밖(저장소, MCP 와 같은 길)에서 끝낸다 → a 만 남는다
    await main(`__jj.store.completeOpen(${id.long}, Date.now()); 1`);
    check('패널 밖에서 끝내면 말풍선에서 빠진다', await soft(until('끝냄', async () => (await bubbleText(pet)) === TXT.doing(T.a), 15_000)), await bubbleText(pet));
    await main(`__jj.store.undo(${id.long}, Date.now()); 1`);
    check('패널 밖에서 끝낸 것을 되돌리면 ▶ 가 돌아온다 (말풍선)', await soft(until('되돌림', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));
    check('되돌린 줄의 ▶ 가 켜져 있다 (패널)', await soft(until('패널 ▶', async () => (await rowDoingOn(T.long)) === 'true', 8000)), await rowDoingOn(T.long));
    // 패널 밖에서 지우고 되살리기
    await main(`__jj.store.remove(${id.a}, Date.now()); 1`);
    check('패널 밖에서 지우면 말풍선에서 빠진다', await soft(until('지움', async () => (await bubbleText(pet)) === TXT.doing(cut(T.long, 22)), 15_000)), await bubbleText(pet));
    await main(`__jj.store.restore(${id.a}); 1`);
    check('패널 밖에서 지운 것을 되살리면 ▶ 가 돌아온다', await soft(until('되살림', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));
    // 패널에서 끝내고 토스트 되돌리기
    await rowButton(T.a, '.check');
    await until('토스트', async () => (await panel.ev(`!!document.querySelector('.toast .undo')`)) === true, 5000);
    check('패널에서 끝내면 빠진다', await soft(until('끝', async () => (await bubbleText(pet)) === TXT.doing(cut(T.long, 22)), 15_000)), await bubbleText(pet));
    await panel.click('.toast .undo');
    check('패널 토스트 되돌리기로 ▶ 가 돌아온다', await soft(until('돌아옴', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));
    await sleep(500);
    // 패널에서 지우고 토스트 되돌리기
    await rowButton(T.a, '.remove');
    const toast = await soft(until('지움 토스트', async () => (await panel.ev(`!!document.querySelector('.toast .undo')`)) === true, 5000));
    check('패널에서 지우면 빠진다', await soft(until('지움', async () => (await bubbleText(pet)) === TXT.doing(cut(T.long, 22)), 15_000)), await bubbleText(pet));
    if (toast) {
      await panel.click('.toast .undo');
      check('패널 지움 토스트 되돌리기로 ▶ 가 돌아온다', await soft(until('돌아옴', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));
    } else check('패널에서 지운 뒤 되돌리기 토스트가 있다', false);
    // 끝낸 할 일에는 ▶ 를 켤 수 없다 (IPC 가드). 끝낸 목록에 ▶ 단추가 없는지
    const doneBtns = await panel.ev(`document.querySelectorAll('.done-list .doing-btn, .todo.done .doing-btn').length`);
    check('끝낸 줄에는 ▶ 단추가 없다', doneBtns === 0, String(doneBtns));
  }

  // ===== 6. 칩과 진행 중 말풍선 =====
  {
    await openChips(pet);
    check('칩이 진행 중 말풍선 자리를 먼저 쓴다', (await bubbleText(pet)) === TXT.ask);
    await pet.click('#bubble .actions button', 4);
    await until('답', async () => (await bubbleText(pet))?.startsWith(TXT.coins(0).slice(0, 3)));
    await pet.click('#bubble .actions button', 1);
    check('칩을 닫으면 진행 중이 돌아온다', await soft(until('돌아옴', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 15_000)), await bubbleText(pet));
  }

  // ===== 7. 커져도 말풍선 유지 =====
  await closePanel();
  {
    // 상태 말풍선: 커진 동안 비키고 놓으면 돌아온다
    const c = await hold(pet);
    const during = await bubbleText(pet);
    await release(pet, c, 400);
    check('진행 중 말풍선은 놓으면 돌아온다', await soft(until('복귀', async () => (await bubbleText(pet)) === TXT.doingMore(cut(T.long, 22), 1), 8000)), `커진 동안 ${J(during)}`);
    // 칩: 커져도 닫히지 않고, 놓은 뒤 칩을 누를 수 있다
    await openChips(pet);
    const c2 = await hold(pet);
    const grown = await petBox();
    const duringChips = await bubbleText(pet);
    const fit = await bubbleFits(pet);
    await capture(pet, 'peek-with-chips');
    await release(pet, c2);
    check('커져도 칩 말풍선이 남는다', duringChips === TXT.ask && grown.width > home0.width * 1.3, J({ duringChips, w: grown.width }));
    check('커진 동안 칩 말풍선이 창 안', fit.inside && fit.over.length === 0, J(fit));
    check('놓은 뒤에도 칩 말풍선이 남는다', (await bubbleText(pet)) === TXT.ask, await bubbleText(pet));
    const ans = await askChip(pet, 3).catch(() => null);
    check('놓은 뒤 칩을 누르면 답한다', !!ans && ans !== TXT.ask, ans ?? '');
    const pOpen = await panelOpen();
    check('꾹 눌렀다 놓은 것은 패널을 열지 않는다', pOpen === false);
    await pet.click('#bubble .actions button', 1);
    // 말하는 말풍선 (답 알림)
    await main(`void __jj.pet.say({ kind: 'answer', text: 'qa-talk-bubble', buttons: [], ttlMs: 15000 }); 1`);
    await until('말', async () => (await bubbleText(pet)) === 'qa-talk-bubble');
    const c3 = await hold(pet);
    const d3 = await bubbleText(pet);
    await release(pet, c3);
    check('커져도 말하는 말풍선이 남는다', d3 === 'qa-talk-bubble' && (await bubbleText(pet)) === 'qa-talk-bubble', J(d3));
    await pet.click('#bubble');
    await sleep(1200);
    await closePanel();
  }

  // ===== 8. 가장자리 확대 =====
  {
    const w = home0.width;
    const spots = {
      left: { x: area.x, y: area.y + area.height - home0.height },
      right: { x: area.x + area.width - w, y: area.y + area.height - home0.height },
      topLeft: { x: area.x, y: area.y },
      topRight: { x: area.x + area.width - w, y: area.y },
      middleTop: { x: area.x + Math.round(area.width / 2 - w / 2), y: area.y },
    };
    for (const [name, p] of Object.entries(spots)) {
      await main(`__jj.pet.debugMoveTo(${p.x}, ${p.y}); 1`);
      await sleep(900);
      const base = await petBox();
      const c = await hold(pet);
      const g = await petBox();
      const win = await winBox();
      if (name === 'topRight') await capture(pet, 'peek-edge');
      await release(pet, c);
      const back = await petBox();
      check(
        `가장자리 확대 ${name}: 1.4배, 펫과 창이 화면 안, 놓으면 제자리`,
        Math.abs(g.width - Math.round(base.width * 1.4)) <= 2 && inArea(g, area) && inArea(win, area) && back.x === base.x && back.y === base.y && back.width === base.width,
        J({ base, g, win, back }),
      );
      await closePanel();
    }
    await main(`__jj.pet.debugMoveTo(${home0.x}, ${home0.y}); 1`);
    await sleep(800);
  }

  // ===== 9. 커진 동안 크기, 깡충, 걷기, 숨기기, 모니터 바뀜 =====
  {
    const base = await petBox();
    // 크기
    let c = await hold(pet);
    await main('__jj.pet.debugScale(1.5); 1');
    await sleep(500);
    await release(pet, c);
    let b = await petBox();
    let sc = Number(await main('__jj.pet.scale()'));
    check('커진 동안 크기를 바꾸면 그 크기로 (화면 안)', Math.abs(b.width - Math.round(160 * sc)) <= 2 && inArea(b, area), J({ b, sc }));
    const pos = JSON.parse(readFileSync(join(data, 'pet-position.json'), 'utf8'));
    check('저장된 배율이 바꾼 크기 (1.4배가 아님)', Math.abs(pos.scale - sc) < 0.02, J(pos));
    await main('__jj.pet.debugScale(1); 1');
    await sleep(800);
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(600);
    // 깡충
    c = await hold(pet);
    const target = { x: area.x + 60, y: base.y };
    await main(`void __jj.pet.jumpTo(${target.x}, ${target.y}); 1`);
    await sleep(1500);
    await release(pet, c);
    b = await petBox();
    check('커진 동안 깡충: 뛴 자리, 원래 크기, 화면 안', Math.abs(b.x - target.x) < 120 && b.width === base.width && inArea(b, area), J({ target, b }));
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(600);
    // 걷기
    c = await hold(pet);
    await main(`void __jj.pet.walkTo(${base.x - 200}); 1`);
    await sleep(2000);
    await release(pet, c);
    b = await petBox();
    check('커진 동안 걷기: 원래 크기, 화면 안', b.width === base.width && inArea(b, area), J(b));
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(600);
    // 숨기기와 다시 보이기
    c = await hold(pet);
    await main(`__jj.pet.setHidden('user', true); 1`);
    await sleep(600);
    await release(pet, c, 300);
    await main(`__jj.pet.setHidden('user', false); 1`);
    await sleep(1200);
    pet = await page('pet');
    b = await petBox();
    check('커진 동안 숨겼다 보이면 원래 크기, 제자리', b.width === base.width && b.x === base.x && b.y === base.y, J({ base, b }));
    // 모니터 바뀜: 지금 화면이 빠지고 다른 화면 하나만 남는다
    c = await hold(pet);
    const far = { x: area.x + area.width + 500, y: area.y, width: 1280, height: 800 };
    await main(`(() => {
      const d0 = __t.all.call(__t.E.screen)[0];
      const fake = { ...d0, id: 4242, bounds: ${J(far)}, workArea: ${J(far)} };
      __t.E.screen.getAllDisplays = () => [fake];
      __t.E.screen.getDisplayMatching = () => fake;
      __t.E.screen.getDisplayNearestPoint = () => fake;
      __t.E.screen.emit('display-removed', {}, d0);
      return 1; })()`);
    await sleep(900);
    await release(pet, c);
    b = await petBox();
    check('커진 동안 모니터가 빠지면 남은 화면 안, 원래 크기', inArea(b, far) && b.width === base.width, J({ b, far }));
    await main(`(() => { __t.E.screen.getAllDisplays = __t.all; __t.E.screen.getDisplayMatching = __t.matching; __t.E.screen.getDisplayNearestPoint = __t.nearest; __t.E.screen.emit('display-added', {}, {}); return 1; })()`);
    await sleep(900);
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(800);
    await closePanel();
  }

  // ===== 10. 짧은 누르기, 빠른 끌기, 느린 끌기 =====
  const dragTo = async (holdBefore, to) => {
    const w = await winBox();
    const p0 = await petBox();
    const c = await petPoint(pet);
    // 잡은 자리 (펫 기준). 창에는 말풍선 자리도 있어 창 기준과 다르다
    const grab = { x: c.x - (p0.x - w.x), y: c.y - (p0.y - w.y) };
    const start = { x: Math.round(w.x + c.x), y: Math.round(w.y + c.y) };
    await main(`__t.at = ${J(start)}; __t.E.screen.getCursorScreenPoint = () => ({ ...__t.at }); 1`);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(holdBefore);
    const mid = await petBox();
    await pet.mouse('mouseMoved', c.x + 12, c.y + 12, { buttons: 1 });
    await pet.mouse('mouseMoved', c.x + 30, c.y + 30, { buttons: 1 });
    await main(`__t.at = ${J(to)}; 1`);
    await sleep(800);
    const during = await petBox();
    await pet.mouse('mouseReleased', c.x + 30, c.y + 30);
    await sleep(900);
    const after = await petBox();
    await main(`__t.E.screen.getCursorScreenPoint = __t.cursor; 1`);
    return { c: grab, mid, during, after };
  };
  {
    const base = await petBox();
    await tapPet(pet, 120);
    const opened = await soft(until('패널', panelOpen, 3000));
    const b = await petBox();
    check('짧게 누르면 패널, 커지지 않음', opened && b.width === base.width, J({ opened, w: b.width }));
    await closePanel();
    // 빠른 끌기
    const to = { x: Math.min(area.x + area.width - 200, base.x + 300), y: Math.max(area.y + 200, base.y - 150) };
    let r = await dragTo(60, to);
    check('빠른 끌기: 커지지 않고 끌린다', r.mid.width === base.width && r.after.width === base.width && Math.abs(r.after.x - (to.x - r.c.x)) <= 4, J({ to, after: r.after, grab: r.c }));
    check('끌고 나서 패널이 안 열린다', (await panelOpen()) === false);
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(700);
    // 느린 끌기: 커진 뒤 움직인다
    r = await dragTo(900, to);
    check('느린 끌기: 커졌다가 움직이면 원래 크기로 끌린다', r.mid.width > base.width * 1.3 && r.during.width === base.width && r.after.width === base.width, J({ mid: r.mid.width, during: r.during.width, after: r.after.width }));
    check('느린 끌기: 잡은 자리가 커서 밑', Math.abs(r.after.x - (to.x - r.c.x)) <= 4 && Math.abs(r.after.y - (to.y - r.c.y)) <= 4, J({ to, after: r.after, grab: r.c }));
    check('느린 끌기 뒤 패널이 안 열린다', (await panelOpen()) === false);
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(800);
    await clearBubbles(pet);
  }

  // ===== 11. 못 키울 때 꾹 누르면 클릭 =====
  {
    await closePanel();
    const base = await petBox();
    // 깡충 뛰는 동안(못 키운다)
    await main(`void __jj.pet.jumpTo(${base.x - 250}, ${base.y}); 1`);
    await sleep(80);
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(800);
    const g = await petBox();
    await pet.mouse('mouseReleased', c.x, c.y);
    const opened = await soft(until('패널', panelOpen, 3000));
    check('못 키우는 때(깡충) 꾹 누르면 커지지 않고 클릭(패널)', opened && g.width === base.width, J({ opened, w: g.width }));
    await closePanel();
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(1200);
  }

  // ===== 12. 움직임 줄이기 =====
  {
    const base = await petBox();
    await pet.motion(true);
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await main(`globalThis.__w = []; globalThis.__wi = setInterval(() => __w.push(__jj.pet.bounds().width), 8); 1`);
    await sleep(1200);
    const seen = JSON.parse(await main(`clearInterval(__wi); JSON.stringify([...new Set(__w)])`));
    await main(`globalThis.__w = []; globalThis.__wi = setInterval(() => __w.push(__jj.pet.bounds().width), 8); 1`);
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(600);
    const seenBack = JSON.parse(await main(`clearInterval(__wi); JSON.stringify([...new Set(__w)])`));
    check('움직임 줄이기: 중간 크기 없이 커지고 돌아온다', seen.length <= 2 && seenBack.length <= 2 && seen.includes(Math.round(base.width * 1.4)), J({ seen, seenBack }));
    await pet.motion(false);
    await closePanel();
  }

  // ===== 13. 설정 칸 끄기 =====
  {
    await main('__jj.settingsWindow.open(); 1');
    const sp = await page('settings');
    const sw = (label) => `[role=switch][aria-label=${J(label)}]`;
    await until('설정 칸', async () => (await sp.ev(`!!document.querySelector(${J(sw(TXT.toggles.grow))})`)) === true);
    await sp.ev(`document.querySelector(${J(sw(TXT.toggles.chips))}).scrollIntoView({ block: 'start' })`);
    await sleep(300);
    await capture(sp, 'settings-pet', false);
    const over = await sp.ev(
      `[...document.querySelectorAll('main *, .tab-body *, body *')].filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).map((e) => e.tagName + '.' + e.className).slice(0, 5)`,
    );
    check('설정 펫 탭 가로 넘침 없음', over.length === 0, J(over));
    const settingsText = await sp.ev('document.body.innerText');
    seenTexts.add(settingsText);
    // 커지기 끔: 꾹 눌러도 안 커지고, 놓으면 클릭
    await sp.click(sw(TXT.toggles.grow));
    await until('끔', async () => (await main('__jj.settings.get().clickGrow')) === false);
    await sleep(500);
    const base = await petBox();
    let c = await hold(pet, 1000);
    const g = await petBox();
    await release(pet, c, 300);
    const opened = await soft(until('패널', panelOpen, 3000));
    check('커지기 끔: 꾹 눌러도 안 커진다', g.width === base.width, J(g));
    console.log('  커지기 끔에서 오래 눌렀다 놓으면 패널', opened);
    await closePanel();
    await sp.click(sw(TXT.toggles.grow));
    await until('켬', async () => (await main('__jj.settings.get().clickGrow')) === true);
    // 진행 중 말풍선 끔
    await until('진행 중', async () => (await bubbleText(pet))?.startsWith('▶'), 15_000).catch(() => {});
    await sp.click(sw(TXT.toggles.doing));
    check('진행 중 말풍선 끔: 말풍선이 사라진다', await soft(until('사라짐', async () => (await bubbleText(pet)) === null, 15_000)));
    await openTodoPanel();
    const btnCount = await panel.ev(`document.querySelectorAll('.todos .todo .doing-btn').length`);
    console.log('  말풍선 끔에서 패널 ▶ 단추 수', btnCount);
    await closePanel();
    await sp.click(sw(TXT.toggles.doing));
    check('다시 켜면 돌아온다', await soft(until('돌아옴', async () => (await bubbleText(pet))?.startsWith('▶'), 15_000)));
    // 질문 칩 끔
    await sp.click(sw(TXT.toggles.chips));
    await until('칩 끔', async () => (await main('__jj.settings.get().petChips')) === false);
    const labels = await rightClickMenu(pet);
    check('질문 칩 끔: 메뉴에 줄이 없다', labels.length > 3 && !labels.includes(TXT.menu), J(labels.slice(0, 5)));
    await sp.click(sw(TXT.toggles.chips));
    await until('칩 켬', async () => (await main('__jj.settings.get().petChips')) === true);
    const labels2 = await rightClickMenu(pet);
    check('질문 칩 다시 켬: 메뉴에 돌아온다', labels2.includes(TXT.menu));
  }

  // ===== 14. 글 검사 =====
  {
    await openTodoPanel();
    const panelText = await panel.ev(
      `document.body.innerText + '\\n' + [...document.querySelectorAll('[aria-label],[title]')].map((e) => (e.getAttribute('aria-label') ?? '') + ' ' + (e.getAttribute('title') ?? '')).join('\\n')`,
    );
    seenTexts.add(panelText);
    const all = [...seenTexts].join('\n');
    check('보인 글에 줄표(—)가 없다', !all.includes('—'));
    if (LANG === 'en') {
      // 사용자가 넣은 한글 데이터(펫 이름, 할 일, 일정 제목)는 빼고 본다
      const allowed = ['콩이', '가족 여행', '주간 회의', '물 마시기'];
      let rest = all;
      for (const a of allowed) rest = rest.split(a).join('');
      const hangul = [...new Set(rest.match(/[가-힣]+/g) ?? [])];
      check('영어판에 한글 문구가 없다', hangul.length === 0, J(hangul.slice(0, 10)));
    }
    await closePanel();
  }

  } else {
    idLong = await addTodo('A');
    const b2 = await addTodo('B');
    await main(`__jj.doing.set(${idLong}, true); __jj.doing.set(${b2}, true); 1`);
  }
  // ===== 15. 백업 되살리기 뒤 진행 중 표시 비움 =====
  {
    const file = join(scratch, 'qa.fairybackup');
    // ▶ 가 켜진 상태로 백업 (복원한 저장 파일의 번호와 같은 번호를 doing.json 이 들고 있게 된다)
    const before = await doingIds();
    await main(`__jj.backup.exportFile(${J(file)})`);
    check('백업 파일을 만들었다', existsSync(file));
    // 백업 뒤 할 일을 지우고 새로 만들어 번호를 바꾼다
    await main(`__jj.store.remove(${idLong}, Date.now()); 1`);
    const fresh = await addTodo('백업 뒤 새 할 일');
    await main(`__jj.doing.set(${fresh}, true); 1`);
    await sleep(1500);
    const r = await main(`__jj.backup.inspect(${J(file)}, 'file').then((x) => JSON.stringify(x))`);
    console.log('  inspect', String(r).slice(0, 200));
    await main(`__jj.settingsWindow.open('restore'); 1`);
    const sp = await page('settings');
    await until('되살리기 확인 칸', async () => (await sp.ev(`!!document.querySelector('.restore-ask button.danger')`)) === true, 15_000);
    await sp.shot(`restore-ask-${LANG}`);
    console.log('  확인 단추', await sp.ev(`(() => { const e = document.querySelector('.restore-ask button.danger'); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return JSON.stringify({ dis: e.disabled, text: e.textContent, b: [b.x, b.y, b.width, b.height], hit: hit?.outerHTML.slice(0, 120), inner: [innerWidth, innerHeight], n: document.querySelectorAll('.restore-ask').length }); })()`));
    // 메인 디버거를 붙인 채 다시 켜면 멈춘다: 닫고 누른다
    const oldPids = appPids();
    mainConn?.ws.close();
    mainConn = undefined;
    await sp.click('.restore-ask button.danger');
    pageConns.clear();
    const ended = await soft(until('옛 앱 끝', async () => app.exitCode !== null, 30_000));
    console.log('  옛 앱 끝남', ended, '옛 pid', J(oldPids), '지금', J(appPids()));
    try { console.log('  기록', readFileSync(join(data, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => /backup|import|가져/.test(l)).slice(-8).join('\n  ')); } catch {}
    await until('다시 켜짐', async () => appPids().length > 0, 30_000);
    await sleep(3000);
    await until('__jj', () => main('typeof __jj === "object" && !!__jj.petChips'), 60_000);
    pet = await page('pet');
    await installStubs();
    const doingFile = existsSync(join(data, 'doing.json')) ? readFileSync(join(data, 'doing.json'), 'utf8') : null;
    const ids2 = await doingIds();
    console.log('  복원 전 표시', J(before), '복원 뒤 파일', doingFile, 'ids', J(ids2));
    check('되살리면 진행 중 표시가 비어 있다', ids2.length === 0, J({ ids2, doingFile }));
    await sleep(4000);
    const t = await bubbleText(pet);
    check('되살린 뒤 진행 중 말풍선이 없다', !t || !t.startsWith('▶'), J(t));
    await openTodoPanel();
    const onRows = await panel.ev(`document.querySelectorAll('.todos .todo .doing-btn.on').length`);
    check('되살린 뒤 패널 ▶ 켜진 줄 없음', onRows === 0, String(onRows));
    await closePanel();
  }

  await main(`(() => { const s = __t; s.E.powerMonitor.getSystemIdleTime = s.idle; s.E.screen.getCursorScreenPoint = s.cursor; s.E.Menu.buildFromTemplate = s.menu; return 1; })()`).catch(() => {});
} catch (e) {
  console.log('FAIL 예외', e?.stack ?? e);
  results.push(false);
  fails.push('예외');
} finally {
  mainConn?.ws.close();
  await quitAll();
  // 끝나는 앱이 마지막 기록을 쓸 수 있어 조금 기다렸다 지운다
  await sleep(2000);
  rmSync(scratch, { recursive: true, force: true });
  if (existsSync(scratch)) { await sleep(2000); rmSync(scratch, { recursive: true, force: true }); }
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} PASS${failed ? `, ${failed} FAIL: ${fails.join(' / ')}` : ''}`);
process.exit(failed ? 1 : 0);
