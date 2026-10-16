// 펫 질문 칩, 진행 중 말풍선, 꾹 눌러 커지기 점검 (이슈 #124). 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위)
// 화면 요소를 CDP 로 누른다. 진짜 마우스와 키보드, 진짜 AI 는 쓰지 않는다. 끝나면 데이터 폴더를 지운다.
//
//   npm run build && OUT=/tmp/fairy-124 LANG_UNDER_TEST=ko node scripts/dev/pet-chips.mjs
//
// 보는 것: 우클릭 메뉴의 "물어보기" → 칩 다섯 → 칩마다 답 글(데이터와 같은지) → "다른 것도"로 칩 다시 → 됐어,
// 패널 할 일 줄 ▶ → 펫 머리 위 "진행 중" 말풍선(하나, 여럿), 다른 말풍선과 겹침, 집중 우선, 말풍선 누르면 패널 할 일 탭,
// 끝내기와 지우기로 풀림, 다시 켜도 유지, 꾹 누르면 커지기(짧은 누르기는 클릭, 누른 채 움직이면 끌기, 움직임 줄이기),
// 설정 칸으로 세 기능 끄기. 밝은, 어두운 모드 화면을 OUT 에 찍는다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-124');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
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

// 화면에 보일 글 (사전과 따로 적어 사전이 바뀌면 이 시험이 알린다)
const TXT = {
  ko: {
    menu: '물어보기',
    ask: '뭐가 궁금해?',
    chips: ['오늘 얼마나 했어?', '남은 할 일은?', '다음 일정은?', '오늘 집중 몇 분?', '코인 얼마야?'],
    more: '다른 것도',
    enough: '됐어',
    done: (n, open) => `오늘 할 일 ${n}개 끝냈어! 남은 건 ${open}개야.`,
    left: (n, title) => `남은 할 일이 ${n}개야. 먼저 "${title}" 어때?`,
    event: /^다음 일정은 .*에 있는 "치과 예약" 일정이야\.$/,
    focus: (m) => `오늘 ${m}분 집중했어.`,
    coins: (n) => `코인 ${n}개 가지고 있어.`,
    doing: (title) => `▶ 진행 중: ${title}`,
    doingMore: (title, n) => `▶ 진행 중: ${title} 외 ${n}개`,
    focusing: /^집중 중, \d+분 남았어$/,
    toggles: { chips: '질문 칩', doing: '진행 중 말풍선', grow: '꾹 누르면 커지기' },
  },
  en: {
    menu: 'Quick questions',
    ask: 'What do you want to know?',
    chips: [
      'How much did I do today?',
      'What is left to do?',
      'What is my next event?',
      'Focus time today?',
      'How many coins?',
    ],
    more: 'Ask more',
    enough: 'Done',
    done: (n, open) => `You finished ${n} to-do${n === 1 ? '' : 's'} today! ${open} left.`,
    left: (n, title) => `${n} to-do${n === 1 ? '' : 's'} left. How about "${title}" first?`,
    event: /^Your next event is "치과 예약", .*\.$/,
    focus: (m) => `You focused for ${m} min today.`,
    coins: (n) => `You have ${n} coin${n === 1 ? '' : 's'}.`,
    doing: (title) => `▶ Working on: ${title}`,
    doingMore: (title, n) => `▶ Working on: ${title} and ${n} more`,
    focusing: /^Focusing, \d+ min left$/,
    toggles: { chips: 'Quick questions', doing: 'In-progress bubble', grow: 'Grow when held' },
  },
}[LANG];

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.pet-chips-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
// 처음 안내를 건너뛰고, 운영체제 알림과 돌아다니기를 끄고, 말을 정한다
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
      PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
    },
    stdio: 'ignore',
  });
  console.log('app pid', app.pid, 'lang', LANG, 'ports', INSPECT, PAGE);
}
async function quit() {
  if (!app || app.exitCode !== null) return;
  const gone = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  await Promise.race([gone, sleep(8000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
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
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method} ${String(params.expression ?? '').slice(0, 80)}`)), ms);
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
        const mouse = (type, x, y, o = {}) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: o.button ?? (type === 'mouseMoved' && !o.buttons ? 'none' : 'left'),
            buttons: o.buttons ?? (type === 'mousePressed' ? 1 : 0),
            clickCount: type === 'mouseMoved' ? 0 : 1,
          });
        return {
          ev,
          send: c.send,
          mouse,
          /** 화면 요소 가운데를 CDP 로 누른다 (마우스를 먼저 올려 :hover 로 나오는 단추도 누를 수 있게) */
          click: async (selector, index = 0) => {
            const r = JSON.parse(
              await ev(
                `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
              ),
            );
            if (!r) throw new Error(`요소 없음: ${selector}[${index}] / 말풍선 ${await ev("document.getElementById('bubble').outerHTML")}`);
            await mouse('mouseMoved', r.x, r.y);
            await mouse('mousePressed', r.x, r.y);
            await mouse('mouseReleased', r.x, r.y);
          },
          shot: async (file) => {
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
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
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await sleep(150);
  }
  throw new Error(`기다림 끝: ${what}`);
}

const results = [];
function check(name, ok, extra = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const J = JSON.stringify;
const bubbleText = (pet) => pet.ev(`(() => { const b = document.getElementById('bubble'); return b.hidden || !b.classList.contains('shown') ? null : b.querySelector('p').textContent; })()`);
const bubbleButtons = (pet) => pet.ev(`JSON.stringify([...document.querySelectorAll('#bubble .actions button')].map((b) => b.textContent))`);
const petBox = async () => JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
const panelTab = async (p) => p.ev(`document.querySelector('[role=tab][aria-selected=true]')?.textContent ?? null`);

/** 펫 가운데 몸통 자리(투명하지 않은 곳) */
async function petPoint(pet) {
  return JSON.parse(
    await pet.ev(
      `(() => { const r = document.querySelector('#pet').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height * 0.6 }); })()`,
    ),
  );
}
/** 펫을 짧게 누른다 (클릭) */
async function tapPet(pet) {
  const c = await petPoint(pet);
  await pet.mouse('mouseMoved', c.x, c.y);
  await pet.mouse('mousePressed', c.x, c.y);
  await pet.mouse('mouseReleased', c.x, c.y);
}
async function closePanel() {
  await main(`(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()`);
  await sleep(500);
}

async function capture(pet, name) {
  await pet.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 214, g: 220, b: 228, a: 1 } });
  for (const dark of [false, true]) {
    await pet.dark(dark);
    await sleep(250);
    if (dark) await pet.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 40, g: 42, b: 48, a: 1 } });
    await pet.shot(`${name}-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await pet.dark(false);
  await pet.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 214, g: 220, b: 228, a: 1 } });
}

try {
  launch();
  await until('__jj', () => main('typeof __jj === "object" && !!__jj.petChips'), 60_000);
  let pet = await page('pet');

  // 시험 준비: 사용자가 자리에 있는 것으로(졸지 않게), 메뉴는 열지 않고 받아 두기, 패널은 블러로 닫히지 않게
  await main(`(() => {
    const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__t = { E, idle: E.powerMonitor.getSystemIdleTime, cursor: E.screen.getCursorScreenPoint, menu: E.Menu.buildFromTemplate, menus: [], at: { x: 0, y: 0 } };
    E.powerMonitor.getSystemIdleTime = () => 0;
    E.Menu.buildFromTemplate = (tpl) => { globalThis.__t.menus.push(tpl); return { popup() {} }; };
    __jj.settings.set({ osNotify: false, wander: false, friends: [], chatter: 'quiet' });
    return 1;
  })()`);
  await sleep(6000);

  // 데이터: 할 일 셋(하나 끝냄), 3시간 뒤 일정, 집중 45분, 코인
  const now = await main('Date.now()');
  const ids = JSON.parse(
    await main(`JSON.stringify(['보고서 쓰기', '메일 답장', '장보기'].map((title) => __jj.store.add({ title }, Date.now()).id))`),
  );
  await main(`__jj.store.completeOpen(${ids[2]}, Date.now())`);
  await main(`__jj.events.add({ title: '치과 예약', startAt: Date.now() + 3 * 3600_000 }, Date.now()); __jj.stats.addFocus(Date.now(), 45); 1`);
  const open0 = JSON.parse(await main('JSON.stringify(__jj.store.list(Date.now()).open.map((t) => [t.id, t.title]))'));
  const coins = Number(await main('__jj.store.balance()'));
  console.log('시험 데이터', J({ open: open0, coins, now }));

  // 끝낸 할 일 때문에 업적 같은 말풍선이 먼저 올 수 있다: 올 만큼 기다렸다 눌러 치운다
  // 6초 동안 말풍선이 없을 때까지 눌러 치운다 (늦게 오는 것도 있다)
  for (let quiet = 0, n = 0; quiet < 6 && n < 60; n++) {
    if ((await bubbleText(pet)) === null) {
      quiet++;
      await sleep(1000);
    } else {
      quiet = 0;
      await pet.click('#bubble');
      await sleep(1200);
    }
  }
  // ===== 1. 질문 칩 =====
  // 우클릭 메뉴에 "물어보기"가 있다 (메뉴는 받아 두기만 한다)
  {
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y, { button: 'right', buttons: 2 });
    await pet.mouse('mouseReleased', c.x, c.y, { button: 'right', buttons: 0 });
    await sleep(500);
    const labels = JSON.parse(await main('JSON.stringify(__t.menus.at(-1)?.map((i) => i.label ?? null) ?? [])'));
    check('우클릭 메뉴에 질문 칩 줄이 있다', labels.includes(TXT.menu), J(labels.slice(0, 6)));
    // 메뉴 줄을 누른 것과 같다
    await main(`__t.menus.at(-1).find((i) => i.label === ${J(TXT.menu)}).click(); 1`);
  }
  await until('칩 말풍선', async () => (await bubbleText(pet)) === TXT.ask);
  const buttons = JSON.parse(await bubbleButtons(pet));
  check('칩 다섯 개, 글이 맞다', J(buttons) === J(TXT.chips), J(buttons));
  await capture(pet, 'chips');
  const inside = await pet.ev(`(() => { const b = document.getElementById('bubble').getBoundingClientRect(); return b.right <= innerWidth + 1 && b.left >= -1 && b.top >= -1; })()`);
  check('칩 말풍선이 창 안에 들어온다', inside === true);

  const expected = [
    TXT.done(1, 2),
    TXT.left(2, open0[0][1]),
    TXT.event,
    TXT.focus(45),
    TXT.coins(coins),
  ];
  for (let i = 0; i < 5; i++) {
    // 말풍선이 막 다시 그려지는 사이에 눌리면 놓칠 수 있어, 안 바뀌면 한 번 더 누른다
    await sleep(300);
    let text = null;
    for (let tries = 0; tries < 3 && !text; tries++) {
      await pet.click('#bubble .actions button', i);
      text = await until(
        `칩 ${i} 답`,
        async () => {
          const x = await bubbleText(pet);
          return x && x !== TXT.ask ? x : null;
        },
        tries === 2 ? 20_000 : 3000,
      ).catch(() => null);
    }
    if (!text) throw new Error(`칩 ${i} 답이 안 뜬다: ${await pet.ev("document.getElementById('bubble').outerHTML + JSON.stringify(document.getElementById('bubble').getBoundingClientRect()) + innerWidth + 'x' + innerHeight")}`);
    const want = expected[i];
    check(`칩 ${i + 1} 답이 데이터와 같다`, want instanceof RegExp ? want.test(text) : text === want, text);
    if (i === 0) await capture(pet, 'answer');
    const btns = JSON.parse(await bubbleButtons(pet));
    if (i === 0) check('답에 "다른 것도", "됐어" 단추', J(btns) === J([TXT.more, TXT.enough]), J(btns));
    if (i < 4) {
      await sleep(400);
      await pet.click('#bubble .actions button', 0); // 다른 것도: 칩이 다시 뜬다
      await until('칩 다시', async () => (await bubbleText(pet)) === TXT.ask);
      await sleep(400); // 창 크기와 말풍선 자리가 자리 잡은 뒤에 누른다
    }
  }
  await pet.click('#bubble .actions button', 1); // 됐어
  await until('칩 닫힘', async () => (await bubbleText(pet)) === null);
  check('됐어를 누르면 닫힌다', true);

  // ===== 2. 진행 중 말풍선 =====
  check('처음에는 상태 말풍선이 없다', (await bubbleText(pet)) === null);
  // 클릭 = 패널. 말풍선이 막 닫히는 사이에는 눌림이 묻힐 수 있어 안 열리면 다시 누른다
  for (let tries = 0; tries < 4; tries++) {
    await tapPet(pet);
    const opened = await until('패널', () => main('!!__jj.panel.window && __jj.panel.window.isVisible()'), 4000).catch(() => false);
    if (opened) break;
  }
  await until('패널', () => main('!!__jj.panel.window && __jj.panel.window.isVisible()'));
  await main(`__jj.panel.window.removeAllListeners('blur'); 1`);
  let panel = await page('panel');
  // 할 일 탭으로
  await main(`__jj.panel.openTab('todo'); 1`);
  await until('할 일 탭', async () => (await panel.ev(`document.querySelectorAll('.todos .todo').length`)) >= 2);
  const rowOf = (title) =>
    `[...document.querySelectorAll('.todos .todo')].findIndex((li) => li.querySelector('.title-text')?.textContent.includes(${J(title)}))`;
  const rowIndex = async (title) => Number(await panel.ev(rowOf(title)));
  /** 줄 위로 마우스를 올려 ▶ 단추를 나오게 하고 누른다 */
  async function pressDoing(title) {
    const i = await rowIndex(title);
    const r = JSON.parse(
      await panel.ev(`(() => { const b = document.querySelectorAll('.todos .todo')[${i}].getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`),
    );
    await panel.mouse('mouseMoved', r.x, r.y);
    await sleep(200);
    const btn = JSON.parse(
      await panel.ev(`(() => { const e = document.querySelectorAll('.todos .todo')[${i}].querySelector('.doing-btn'); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2, on: e.classList.contains('on') }); })()`),
    );
    await panel.mouse('mouseMoved', btn.x, btn.y);
    await panel.mouse('mousePressed', btn.x, btn.y);
    await panel.mouse('mouseReleased', btn.x, btn.y);
    return btn.on;
  }
  // 누름이 묻히면(줄 위로 마우스가 올라오기 전) 한 번 더
  for (let tries = 0; tries < 3; tries++) {
    await pressDoing('보고서 쓰기');
    if (await until('표시', async () => (await main('__jj.doing.ids().length')) > 0, 3000).catch(() => false)) break;
  }
  await until('진행 중 말풍선', async () => (await bubbleText(pet)) === TXT.doing('보고서 쓰기')).catch(async (e) => {
    throw new Error(`${e.message} / 지금 말풍선 ${J(await bubbleText(pet))}, 표시 ${await main('JSON.stringify(__jj.doing.ids())')}`);
  });
  check('▶ 를 누르면 펫 머리 위에 "진행 중 제목"', true, await bubbleText(pet));
  const ambient = await pet.ev(`document.getElementById('bubble').hasAttribute('data-ambient')`);
  check('상태 말풍선은 조용한 모양(ambient)', ambient === true);
  check('진행 중 표시가 파일에 남는다', J(JSON.parse(readFileSync(join(data, 'doing.json'), 'utf8'))) === J([ids[0]]));
  const marked = await panel.ev(`document.querySelectorAll('.todos .todo')[${await rowIndex('보고서 쓰기')}].querySelector('.doing-btn')?.getAttribute('aria-pressed')`);
  check('패널 줄 ▶ 가 켜진 모양', marked === 'true', marked);

  await pressDoing('메일 답장');
  await until('여럿', async () => (await bubbleText(pet)) === TXT.doingMore('보고서 쓰기', 1));
  check('여러 개면 "제목 외 n개"', true, await bubbleText(pet));
  await capture(pet, 'doing');
  // 줄 위에 마우스를 올린 채 지우기(×)와 켠 ▶ 의 누르는 자리가 6px 넘게 떨어져 있다 (잘못 눌러 지우지 않게)
  {
    const i = await rowIndex('메일 답장');
    const r = JSON.parse(await panel.ev(`(() => { const b = document.querySelectorAll('.todos .todo')[${i}].getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`));
    await panel.mouse('mouseMoved', r.x, r.y);
    await sleep(300);
    const gap = await panel.ev(`(() => { const li = document.querySelectorAll('.todos .todo')[${i}]; const a = li.querySelector('.remove')?.getBoundingClientRect(); const b = li.querySelector('.doing-btn.on')?.getBoundingClientRect(); return a && b ? Math.round(Math.max(b.left - a.right, a.left - b.right)) : null; })()`);
    const rects = await panel.ev(`(() => { const li = document.querySelectorAll('.todos .todo')[${i}]; return JSON.stringify([...li.querySelectorAll('.remove, .doing-btn, .tools')].map((e) => [e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().right)])); })()`);
    check('지우기(×)와 켠 ▶ 의 누르는 자리가 6px 이상 떨어져 있다', gap !== null && gap >= 6, `간격 ${gap}px ${rects}`);
  }
  // 패널 할 일 줄의 ▶ (켠 줄은 늘 보이고, 안 켠 줄은 마우스를 올리면 보인다)
  for (const dark of [false, true]) {
    await panel.dark(dark);
    await sleep(250);
    await panel.shot(`panel-doing-${LANG}-${dark ? 'dark' : 'light'}`);
  }
  await panel.dark(false);

  // 다른 말풍선과 겹침: 말하는 말풍선이 먼저, 닫히면 돌아온다
  await main(`void __jj.pet.say({ kind: 'answer', text: 'pet-chips-overlap', buttons: [], ttlMs: 2500 }); 1`);
  await until('말하는 말풍선', async () => (await bubbleText(pet)) === 'pet-chips-overlap');
  check('말하는 말풍선이 상태 말풍선을 밀어낸다', true);
  const talkingAmbient = await pet.ev(`document.getElementById('bubble').hasAttribute('data-ambient')`);
  check('말하는 말풍선은 ambient 가 아니다', talkingAmbient === false);
  await until('상태 말풍선 복귀', async () => (await bubbleText(pet)) === TXT.doingMore('보고서 쓰기', 1), 15_000);
  check('말이 끝나면 상태 말풍선이 돌아온다', true);

  // 집중 중이면 집중 말풍선이 먼저
  await main(`__jj.planner.startFocus(25); 1`);
  await until('집중 말풍선', async () => TXT.focusing.test((await bubbleText(pet)) ?? ''));
  check('집중 중이면 집중 말풍선이 우선', true, await bubbleText(pet));
  await capture(pet, 'focus');
  await main(`__jj.planner.stopFocus(); 1`);
  await until('집중 끝 뒤 진행 중', async () => (await bubbleText(pet)) === TXT.doingMore('보고서 쓰기', 1));
  check('집중이 끝나면 진행 중으로 돌아온다', true);

  // 말풍선을 누르면 패널 할 일 탭
  await closePanel();
  await main(`__jj.panel.openTab('today'); 1`);
  await sleep(600);
  await main(`__jj.panel.window.removeAllListeners('blur'); 1`);
  panel = await page('panel');
  await pet.click('#bubble');
  await until('패널 할 일 탭', async () => {
    const tab = await panelTab(await page('panel'));
    return tab && tab.includes(LANG === 'en' ? 'To-do' : '할 일');
  });
  check('상태 말풍선을 누르면 패널 할 일 탭', true, await panelTab(await page('panel')));
  await until('눌러도 말풍선 돌아옴', async () => (await bubbleText(pet)) === TXT.doingMore('보고서 쓰기', 1), 15_000);
  check('눌러 사라진 말풍선이 곧 돌아온다', true);

  // 끝내기와 지우기로 풀림
  panel = await page('panel');
  await panel.click('.todos .todo .check', await rowIndex('메일 답장'));
  await until('끝내면 풀림', async () => (await bubbleText(pet)) === TXT.doing('보고서 쓰기'));
  check('진행 중인 할 일을 끝내면 말풍선에서 풀린다 (표시는 되돌리기용으로 남는다)', J(JSON.parse(readFileSync(join(data, 'doing.json'), 'utf8'))).includes(String(ids[0])));
  const rm = await rowIndex('보고서 쓰기');
  const rr = JSON.parse(await panel.ev(`(() => { const b = document.querySelectorAll('.todos .todo')[${rm}].getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`));
  await panel.mouse('mouseMoved', rr.x, rr.y);
  await sleep(200);
  await panel.click('.todos .todo .remove', rm);
  await until('지우면 사라짐', async () => (await bubbleText(pet)) === null);
  check('진행 중인 할 일을 지우면 말풍선이 사라진다', true);

  // 다시 켜도 유지: 하나를 다시 표시하고 앱을 껐다 켠다
  const again = await main(`JSON.stringify(__jj.store.add({ title: '다시 켜도 남기' }, Date.now()).id)`);
  await main(`__jj.doing.set(${again}, true); 1`);
  await closePanel();
  await quit();
  mainConn?.ws.close();
  mainConn = undefined;
  pageConns.clear();
  launch();
  await until('__jj', () => main('typeof __jj === "object" && !!__jj.petChips'), 60_000);
  pet = await page('pet');
  await until('재시작 뒤 진행 중', async () => (await bubbleText(pet)) === TXT.doing('다시 켜도 남기'), 40_000);
  check('앱을 다시 켜도 진행 중이 남아 있다', true, await bubbleText(pet));
  await main(`(() => {
    const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__t = { E, idle: E.powerMonitor.getSystemIdleTime, cursor: E.screen.getCursorScreenPoint, menu: E.Menu.buildFromTemplate, menus: [], at: { x: 0, y: 0 } };
    E.powerMonitor.getSystemIdleTime = () => 0;
    E.Menu.buildFromTemplate = (tpl) => { globalThis.__t.menus.push(tpl); return { popup() {} }; };
    return 1;
  })()`);
  await main(`__jj.doing.set(${again}, false); 1`);
  await until('풀면 사라짐', async () => (await bubbleText(pet)) === null, 15_000);
  await sleep(2500);

  // ===== 3. 꾹 눌러 커지기 =====
  const base = await petBox();
  const samples = async (ms) => {
    await main(`globalThis.__w = []; globalThis.__wi = setInterval(() => __w.push(__jj.pet.bounds().width), 8); 1`);
    await sleep(ms);
    return JSON.parse(await main(`clearInterval(__wi); JSON.stringify([...new Set(__w)])`));
  };
  await closePanel();
  {
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    const seen = await samples(1300);
    const grown = await petBox();
    check('꾹 누르면 커진다', grown.width >= base.width * 1.35, `${base.width} -> ${grown.width}`);
    check('부드럽게 커진다 (중간 크기를 거침)', seen.length >= 3, J(seen));
    check('커져도 아래 가운데 기준 (발 밑 그대로)', Math.abs(grown.y + grown.height - (base.y + base.height)) <= 2 && Math.abs(grown.x + grown.width / 2 - (base.x + base.width / 2)) <= 3, J({ base, grown }));
    const prePanel = await main('!!__jj.panel.window && __jj.panel.window.isVisible()');
    await capture(pet, 'peek');
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(900);
    const back = await petBox();
    check('놓으면 원래 크기로 돌아온다', back.width === base.width && back.x === base.x && back.y === base.y, J({ base, back }));
    const postPanel = await main('!!__jj.panel.window && __jj.panel.window.isVisible()');
    check('꾹 눌렀다 놓은 것은 클릭(패널)이 아니다', prePanel === false && postPanel === false);
    // 저장 파일이 아직 없으면(자리를 옮긴 적 없음) 저장하지 않은 것이다
    let saved = null;
    try {
      saved = JSON.parse(readFileSync(join(data, 'pet-position.json'), 'utf8'));
    } catch {}
    check('커진 동안의 크기를 저장하지 않는다', saved === null || (Math.abs(saved.scale - 1) < 0.01 && saved.x === base.x && saved.y === base.y), J(saved));
  }
  // 짧게 누르면 그대로 클릭(패널), 커지지 않는다
  {
    const c = await petPoint(pet);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(120);
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(900);
    const b = await petBox();
    const panelOpen = await main('!!__jj.panel.window && __jj.panel.window.isVisible()');
    check('짧게 누르면 클릭: 패널이 열리고 커지지 않는다', panelOpen && b.width === base.width, J({ panelOpen, width: b.width }));
    await closePanel();
    await sleep(500);
  }
  // 누른 채 움직이면 끌기: 커졌어도 원래 크기로 돌려 놓고 끈다
  {
    const area = JSON.parse(await main('JSON.stringify(__t.E.screen.getDisplayMatching(__jj.pet.bounds()).workArea)'));
    const w = JSON.parse(await main('JSON.stringify(__jj.pet.win.getBounds())'));
    const c = await petPoint(pet);
    const start = { x: Math.round(w.x + c.x), y: Math.round(w.y + c.y) };
    await main(`__t.at = ${J(start)}; __t.E.screen.getCursorScreenPoint = () => ({ ...__t.at }); 1`);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(900);
    const grown = await petBox();
    // 커진 동안 창이 움직여도 화면 기준으로 움직인 만큼만 본다: 안 움직였으니 끌기가 아니다
    await sleep(300);
    const still = await petBox();
    check('커진 채 가만히 있으면 끌기로 오해하지 않는다', still.width === grown.width && grown.width > base.width, J({ grown: grown.width, still: still.width }));
    const to = { x: Math.min(area.x + area.width - 200, start.x + 160), y: Math.max(area.y + 200, start.y - 120) };
    await pet.mouse('mouseMoved', c.x + 12, c.y + 12, { buttons: 1 });
    await pet.mouse('mouseMoved', c.x + 30, c.y + 30, { buttons: 1 });
    await main(`__t.at = ${J(to)}; 1`);
    await sleep(700);
    const dragged = await petBox();
    check('누른 채 움직이면 끌기: 원래 크기로 돌아와 끌려간다', dragged.width === base.width && (dragged.x !== base.x || dragged.y !== base.y), J({ base, dragged, to }));
    // 잡은 자리가 커서 밑에 그대로 있다 (커졌다 돌아오며 잡은 자리가 어긋나지 않는다)
    check(
      '잡은 자리가 커서 밑에 그대로',
      Math.abs(dragged.x - (to.x - c.x)) <= 3 && Math.abs(dragged.y - (to.y - c.y)) <= 3,
      J({ dragged, to, grab: c }),
    );
    // 한 번 더 움직여도 계속 따라온다 (끌기가 중간에 끊기지 않았다)
    const to2 = { x: Math.max(area.x + 100, to.x - 300), y: to.y };
    await main(`__t.at = ${J(to2)}; 1`);
    await sleep(500);
    const dragged2 = await petBox();
    check('커졌다 끌기로 바뀐 뒤에도 끌기가 이어진다', dragged2.x !== dragged.x || dragged2.y !== dragged.y, J({ dragged, dragged2 }));
    await pet.mouse('mouseReleased', c.x + 30, c.y + 30);
    await sleep(900);
    const after = await petBox();
    check('끌고 놓은 뒤에도 원래 크기', after.width === base.width, J(after));
    await main(`__t.E.screen.getCursorScreenPoint = __t.cursor; 1`);
    await main(`__jj.pet.debugMoveTo(${base.x}, ${base.y}); 1`);
    await sleep(600);
  }
  // 움직임 줄이기: 중간 크기 없이 바로 바뀐다
  {
    await pet.motion(true);
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    const seen = await samples(1300);
    const grown = await petBox();
    check('움직임 줄이기: 바로 커진다 (중간 크기 없음)', grown.width >= base.width * 1.35 && seen.length <= 2, J(seen));
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(500);
    const back = await petBox();
    check('움직임 줄이기: 놓으면 바로 돌아온다', back.width === base.width, J(back));
    await pet.motion(false);
    await closePanel();
  }

  // ===== 3-2. 커진 동안 다른 움직임이 겹칠 때 (버그잡이 #134) =====
  // 커진 동안 크기, 모니터, 자리가 바뀌면 놓을 때 옛 자리나 옛 크기로 돌아가면 안 된다
  await main(`(() => {
    const E = __t.E;
    globalThis.__h = { all: E.screen.getAllDisplays, matching: E.screen.getDisplayMatching, nearest: E.screen.getDisplayNearestPoint };
    return 1;
  })()`);
  const hold = async () => {
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(900);
    return c;
  };
  const release = async (c) => {
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(900);
  };
  const area0 = JSON.parse(await main('JSON.stringify(__t.E.screen.getDisplayMatching(__jj.pet.bounds()).workArea)'));
  const inArea = (b, a) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
  // A. 크기 조절(Cmd+휠과 같은 길)
  {
    const c = await hold();
    await pet.ev('window.jjakkung.wheel(-400, true)');
    await sleep(300);
    const scaleNow = await main('__jj.pet.scale()');
    await release(c);
    const back = await petBox();
    check('커진 동안 크기를 바꾸면 놓은 뒤 펫 폭이 배율과 맞는다', Math.abs(back.width - Math.round(160 * scaleNow)) <= 2, `폭 ${back.width}, 배율 ${scaleNow}`);
    await main('__jj.pet.debugScale(1); 1');
    await sleep(800);
  }
  // B. 모니터가 바뀜 (원래 자리가 화면 밖이 된다)
  {
    const b0 = await petBox();
    const c = await hold();
    const far = { x: b0.x + 3000, y: 0, width: 1200, height: 800 };
    await main(`(() => {
      const d0 = __h.all.call(__t.E.screen)[0];
      const fake = { ...d0, id: 999, bounds: ${J(far)}, workArea: ${J(far)} };
      __t.E.screen.getAllDisplays = () => [fake];
      __t.E.screen.getDisplayMatching = () => fake;
      __t.E.screen.getDisplayNearestPoint = () => fake;
      __t.E.screen.emit('display-removed', {}, d0);
      return 1; })()`);
    await sleep(800);
    await release(c);
    const back = await petBox();
    check('커진 동안 모니터가 빠지면 놓은 뒤에도 남은 화면 안에 있다', inArea(back, far), J({ back, far }));
    await main(`(() => { const h = __h; __t.E.screen.getAllDisplays = h.all; __t.E.screen.getDisplayMatching = h.matching; __t.E.screen.getDisplayNearestPoint = h.nearest; __t.E.screen.emit('display-added', {}, {}); return 1; })()`);
    await sleep(800);
    await main(`__jj.pet.debugMoveTo(${b0.x}, ${b0.y}); 1`);
    await sleep(500);
  }
  // C. 커진 동안 깡충(jumpTo)
  {
    const b0 = await petBox();
    const c = await hold();
    const target = { x: area0.x + 40, y: b0.y };
    await main(`void __jj.pet.jumpTo(${target.x}, ${target.y}); 1`);
    await sleep(1200);
    await release(c);
    const back = await petBox();
    check('커진 동안 깡충 뛴 자리를 놓을 때 되돌리지 않는다', Math.abs(back.x - target.x) < 120, J({ target, back }));
    await main(`__jj.pet.debugMoveTo(${b0.x}, ${b0.y}); 1`);
    await sleep(500);
  }
  // D. 오른쪽 위 모서리에서도 창이 작업 영역 안, 놓으면 제자리
  {
    const b0 = await petBox();
    await main(`__jj.pet.debugMoveTo(${area0.x + area0.width - b0.width}, ${area0.y}); 1`);
    await sleep(800);
    const base0 = await petBox();
    const c = await hold();
    const win = JSON.parse(await main('JSON.stringify(__jj.pet.win.getBounds())'));
    await release(c);
    const back = await petBox();
    check('모서리에서 커져도 창이 화면 안, 놓으면 제자리', inArea(win, area0) && back.x === base0.x && back.y === base0.y, J({ win, base0, back }));
    await main(`__jj.pet.debugMoveTo(${b0.x}, ${b0.y}); 1`);
    await sleep(500);
  }
  // E. 놓는 신호가 안 오는 길(8초 안전장치)로 돌아와도 제자리
  {
    const b0 = await petBox();
    const c = await hold();
    await sleep(8000);
    const back = await petBox();
    check('안전장치(8초)로 돌아와도 원래 자리, 화면 안', back.x === b0.x && back.y === b0.y && back.width === b0.width && inArea(back, area0), J({ b0, back }));
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(600);
    await closePanel();
  }

  // ===== 4. 설정 칸 =====
  await main('__jj.settingsWindow.open(); 1');
  const sp = await page('settings');
  await until('설정 칸', async () => (await sp.ev(`!!document.querySelector('[role=switch][aria-label=${J(TXT.toggles.grow)}]')`)) === true);
  await capture(pet, 'pet-after-peek');
  const sw = (label) => `[role=switch][aria-label=${J(label)}]`;
  const state = async (label) => sp.ev(`document.querySelector(${J(sw(label))}).getAttribute('aria-checked')`);
  check('설정 펫 탭에 세 칸이 있고 기본은 켬', [TXT.toggles.chips, TXT.toggles.doing, TXT.toggles.grow].every((x) => true) && (await state(TXT.toggles.chips)) === 'true' && (await state(TXT.toggles.doing)) === 'true' && (await state(TXT.toggles.grow)) === 'true');
  await sp.ev(`document.querySelector(${J(sw(TXT.toggles.chips))}).scrollIntoView({ block: 'start' })`);
  await sleep(300);
  await sp.shot(`settings-${LANG}-light`);
  await sp.dark(true);
  await sleep(250);
  await sp.shot(`settings-${LANG}-dark`);
  await sp.dark(false);

  // 꾹 누르면 커지기 끄기
  await sp.click(sw(TXT.toggles.grow));
  await until('설정 반영', async () => (await main('__jj.settings.get().clickGrow')) === false);
  {
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y);
    await sleep(1000);
    const b = await petBox();
    await pet.mouse('mouseReleased', c.x, c.y);
    await sleep(600);
    check('설정에서 끄면 꾹 눌러도 커지지 않는다', b.width === base.width, `폭 ${b.width}`);
    await closePanel();
  }
  await sp.click(sw(TXT.toggles.grow));
  await until('다시 켬', async () => (await main('__jj.settings.get().clickGrow')) === true);

  // 진행 중 말풍선 끄기
  const mid = await main(`JSON.stringify(__jj.store.add({ title: '끄기 시험' }, Date.now()).id)`);
  await main(`__jj.doing.set(${mid}, true); 1`);
  await until('켜 둔 진행 중', async () => (await bubbleText(pet)) === TXT.doing('끄기 시험'), 15_000);
  await sp.click(sw(TXT.toggles.doing));
  await until('끄면 사라짐', async () => (await bubbleText(pet)) === null, 15_000);
  check('설정에서 끄면 진행 중 말풍선이 사라진다', (await main('__jj.settings.get().doingBubble')) === false);
  await main(`void __jj.planner.startFocus(25); 1`);
  await sleep(1500);
  check('끄면 집중 말풍선도 같이 꺼진다', (await bubbleText(pet)) === null);
  await main(`__jj.planner.stopFocus(); 1`);
  await sp.click(sw(TXT.toggles.doing));
  await until('다시 켜면 돌아옴', async () => (await bubbleText(pet)) === TXT.doing('끄기 시험'), 15_000);
  check('다시 켜면 말풍선이 돌아온다', true);
  await main(`__jj.doing.set(${mid}, false); 1`);

  // 질문 칩 끄기: 메뉴에서 줄이 빠진다
  await sp.click(sw(TXT.toggles.chips));
  await until('칩 끔', async () => (await main('__jj.settings.get().petChips')) === false);
  {
    const c = await petPoint(pet);
    await pet.mouse('mouseMoved', c.x, c.y);
    await pet.mouse('mousePressed', c.x, c.y, { button: 'right', buttons: 2 });
    await pet.mouse('mouseReleased', c.x, c.y, { button: 'right', buttons: 0 });
    await sleep(500);
    const labels = JSON.parse(await main('JSON.stringify(__t.menus.at(-1)?.map((i) => i.label ?? null) ?? [])'));
    check('설정에서 끄면 우클릭 메뉴에 질문 칩 줄이 없다', labels.length > 3 && !labels.includes(TXT.menu), J(labels.slice(0, 5)));
  }
  await sp.click(sw(TXT.toggles.chips));
  await until('칩 켬', async () => (await main('__jj.settings.get().petChips')) === true);

  // 정리: 시험이 만든 것 되돌리기
  await main(`(() => { const s = __t; s.E.powerMonitor.getSystemIdleTime = s.idle; s.E.screen.getCursorScreenPoint = s.cursor; s.E.Menu.buildFromTemplate = s.menu; return 1; })()`);
} catch (e) {
  console.log('FAIL 예외', e?.stack ?? e);
  results.push(false);
} finally {
  mainConn?.ws.close();
  await quit();
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} PASS${failed ? `, ${failed} FAIL` : ''}`);
process.exit(failed ? 1 : 0);
