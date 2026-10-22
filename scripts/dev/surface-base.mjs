// 여러 면 기반 점검 (이슈 #160, 큰 창 설계 #159): 패널 구성요소를 창 하나 가정에서 뗀 뒤에도 화면이 그대로인지, 새 길이 되는지 본다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/surface-base.mjs
//
// 두 가지 일을 한다.
//  1) 모습 찍기: 같은 상태(ko/en, 폭 360/560, 탭 다섯, 알림, 아침 계획 시트, 주간 카드, 줄 메뉴, 메모 편집, 어두운 모드)를
//     OUT/<이름>.png 로 찍고, 덮는 것들의 자리(숫자)를 OUT/metrics-<언어>.json 에 적는다.
//     고치기 전(기준) 트리와 고친 트리에서 각각 돌려 scripts/dev/surface-diff.py 로 픽셀과 숫자를 견준다.
//     기준 트리에는 새 길이 없으니 SNAP_ONLY=1 로 찍기만 한다.
//  2) 새 길 확인 (PASS/FAIL, SNAP_ONLY 가 아닐 때): 본문 칸 구간(data-zone), 덮는 것이 면 기준, Esc 닫기,
//     큰 창에서 온 열기 요청이 패널을 닫지 않음, 보이는 면 고르기, 오래된 메모 쓰기 거절.
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1(창은 보이지 않고 맥북 화면에만), 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만.
// 진짜 AI CLI 가 잡히지 않게 PATH 는 /usr/bin:/bin 과 node 만 둔다. 포트는 무작위.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-surface');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const SNAP_ONLY = process.env.SNAP_ONLY === '1';
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
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? (await freePort()));
const PAGE = Number(process.env.JJ_PAGE_PORT ?? (await freePort()));
const ko = LANG === 'ko';
const tx = (koText, enText) => (ko ? koText : enText);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.surface-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi') }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
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
  const send = (method, params = {}, ms = 20_000) =>
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
        j(new Error(`CDP 답 없음: ${method} ${String(params.expression ?? '').slice(0, 80)}`));
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
/** 이름(panel.html 등)과 순번으로 화면을 잡는다. skip 은 이미 잡은 화면의 id */
async function page(name, { not } = {}) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`) && x.id !== not);
      if (p) {
        let c = pageConns.get(p.id);
        if (!c) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(p.id, c);
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
            button: type === 'mouseMoved' ? 'none' : (extra.button ?? 'left'),
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
            ...extra,
          });
        const center = (elExpr) =>
          ev(
            `(() => { const e = (${elExpr}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          );
        const api = {
          id: p.id,
          ev,
          center,
          click: async (elExpr, extra = {}) => {
            const p2 = await center(elExpr);
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await mouse('mousePressed', p2.x, p2.y, extra);
            await mouse('mouseReleased', p2.x, p2.y, extra);
            await sleep(200);
            return true;
          },
          key: async (key, code, vk) => {
            await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
            await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
          },
          type: (text) => c.send('Input.insertText', { text }),
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
          /** 화면 전체(창 가득)를 찍는다. 글 칸 깜박이는 커서와 마우스 올림은 미리 치운다 */
          shot: async (file) => {
            await ev(
              `(() => { document.activeElement?.blur?.(); const s = document.createElement('style'); s.id = '__shot'; s.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.append(s); })()`,
            );
            await sleep(120);
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            await ev(`document.getElementById('__shot')?.remove()`);
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
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

const metrics = {};
/** 스크롤 칸 안에서 요소를 가운데로 가져온다 (긴 오늘 탭의 아래쪽 단추) */
const reveal = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center', behavior: 'instant' }), 1)`;
/** Esc 키 이벤트를 요소(없으면 지금 포커스, 그것도 없으면 body)에 보낸다 (숨은 창이라 CDP 키 입력은 창이 닫힐 때 답이 끊긴다) */
const esc = (sel) =>
  `(() => { const e = (${sel ? `document.querySelector(${JSON.stringify(sel)})` : 'null'}) ?? document.activeElement ?? document.body; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); return true; })()`;
/** 줄 우클릭 흉내 (CDP 마우스 오른쪽 단추는 이 화면에서 contextmenu 가 안 와서, 같은 자리에 같은 이벤트를 보낸다) */
const rightClick = (sel) =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2 })); return true; })()`;
/** 요소의 자리(CSS px, 소수 둘째 자리까지)를 적는다 */
const rectOf = (sel) =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100); })()`;

const body = async () => {
  await main('1');
  const NOW = await main('Date.now()');
  await sleep(1500);

  // ---- 시험 거리 (기준 트리와 같은 상태) ----
  const dayStart = await main('(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })()');
  const todayStr = await main('(() => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()');
  for (const [title, extra] of [
    [tx('메일 답장', 'Reply to mail'), { due: todayStr }],
    [tx('보고서 쓰기', 'Write the report'), { important: true }],
    [tx('장보기', 'Groceries'), {}],
  ])
    await main(`__jj.store.add({ title: ${JSON.stringify(title)}, ...${JSON.stringify(extra)} }, ${NOW}); 1`);
  await main(
    `__jj.events.add({ title: ${JSON.stringify(tx('치과', 'Dentist'))}, startAt: ${dayStart + 86_400_000 + 10 * 3_600_000}, reminds: [] }, ${NOW}); 1`,
  );
  const note1 = await main(
    `__jj.notes.add({ title: ${JSON.stringify(tx('장보기 목록', 'Shopping list'))}, body: ${JSON.stringify(tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'))} }, ${NOW}).id`,
  );
  await main(
    `__jj.notes.add({ title: ${JSON.stringify(tx('긴 메모', 'Long note'))}, body: ${JSON.stringify(Array.from({ length: 30 }, (_, i) => tx(`긴 메모 ${i + 1}번째 줄`, `Long note line ${i + 1}`)).join('\n'))} }, ${NOW}); 1`,
  );

  await main("__jj.panel.openTab('today'); 1");
  await sleep(1500);
  const p = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const setWidth = async (w) => {
    await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 600 }); 1`);
    await sleep(500);
  };
  const tabTo = async (id) => {
    await main(`__jj.panel.openTab('${id}'); 1`);
    await sleep(450);
  };

  // ===================== 1. 모습 찍기 =====================
  for (const w of [360, 560]) {
    await setWidth(w);
    for (const id of ['today', 'todo', 'note', 'event', 'shop']) {
      if (process.env.DEBUG) console.log('tab', w, id);
      await tabTo(id);
      await p.shot(`tab-${id}-w${w}`);
    }
    if (process.env.DEBUG) console.log('알림', w);
    // 알림 (할 일 끝내기)
    await tabTo('todo');
    await p.click(`document.querySelector('.todos .todo .check')`);
    await sleep(500);
    await p.shot(`toast-w${w}`);
    metrics[`toast-w${w}`] = await p.ev(rectOf('.toast-stack'));
    await p.click(`document.querySelector('.toast .undo')`);
    await sleep(300);
    if (process.env.DEBUG) console.log('줄 메뉴', w);
    // 줄 메뉴 (우클릭)
    const row = await p.center(`document.querySelector('.todos .todo')`);
    if (row) {
      await p.ev(rightClick('.todos .todo .title'));
      await sleep(250);
      await p.shot(`pinmenu-w${w}`);
      metrics[`pinmenu-w${w}`] = await p.ev(rectOf('.pin-menu'));
      if (metrics[`pinmenu-w${w}`]) await p.ev(esc('.pin-menu button'));
      await sleep(150);
    }
    if (process.env.DEBUG) console.log('메모 편집', w);
    // 줄 메뉴: 탭마다 (메뉴가 놓인 자리의 글자 크기를 물려받던 것을 본다)
    for (const [id, sel] of [
      ['today', '.today .todos .todo .title'],
      ['note', '.notes li.note-row'],
      ['event', '.events-list .event .title'],
    ]) {
      await tabTo(id);
      await p.ev(rightClick(sel));
      await sleep(250);
      await p.shot(`pinmenu-${id}-w${w}`);
      metrics[`pinmenu-${id}-w${w}`] = await p.ev(rectOf('.pin-menu'));
      if (metrics[`pinmenu-${id}-w${w}`]) await p.ev(esc('.pin-menu button'));
      await sleep(150);
    }
    // 메모 편집
    await tabTo('note');
    await p.click(`document.querySelector('.notes li.note-row > button:first-child')`);
    await sleep(500);
    await p.shot(`noteedit-w${w}`);
    await p.ev(`document.querySelector('.note-bar .back')?.click()`);
    await tabTo('today');
    if (process.env.DEBUG) console.log('주간 회고 카드', w);
    // 주간 회고 카드
    await p.ev(`document.querySelector('details.week')?.setAttribute('open', ''); 1`);
    await p.ev(reveal('.week-card-open'));
    await sleep(200);
    await p.click(`document.querySelector('.week-card-open')`);
    await sleep(500);
    await p.shot(`weekcard-w${w}`);
    metrics[`weekcard-dim-w${w}`] = await p.ev(rectOf('.week-card-dim'));
    metrics[`weekcard-dialog-w${w}`] = await p.ev(rectOf('.week-card-dialog'));
    if (metrics[`weekcard-dim-w${w}`]) await p.ev(esc());
    await sleep(250);
    if (process.env.DEBUG) console.log('아침 계획 시트', w);
    // 아침 계획 시트
    await p.ev(`window.dispatchEvent(new Event('jj:open-plan'))`);
    await p.until(() => p.ev(`!!document.querySelector('.plan-veil')`), 3000);
    await sleep(500);
    await p.shot(`plan-w${w}`);
    metrics[`plan-veil-w${w}`] = await p.ev(rectOf('.plan-veil'));
    metrics[`plan-sheet-w${w}`] = await p.ev(rectOf('.plan-sheet'));
    if (metrics[`plan-veil-w${w}`]) await p.ev(esc('.plan-sheet'));
    await sleep(300);
    await p.ev(`document.querySelector('.plan-veil') ? (document.querySelector('.plan-close')?.click(), 1) : 0`);
    await sleep(300);
    if (process.env.DEBUG) console.log('어두운 모드', w);
    // 어두운 모드
    await p.dark(true);
    await tabTo('todo');
    await p.shot(`dark-todo-w${w}`);
    await p.dark(false);
    metrics[`card-w${w}`] = await p.ev(rectOf('.card-window'));
    metrics[`tabpanel-w${w}`] = await p.ev(rectOf('.panel-tabpanel'));
  }
  writeFileSync(join(OUT, `metrics-${LANG}.json`), JSON.stringify(metrics, null, 1));
  console.log('찍음', OUT);

  if (SNAP_ONLY) return;

  // ===================== 2. 새 길 =====================
  await setWidth(360);
  await tabTo('today');
  const zone = () => p.ev(`document.querySelector('.panel-tabpanel')?.dataset.zone`);
  check('본문 칸이 컨테이너(container-type: inline-size)', (await p.ev(`getComputedStyle(document.querySelector('.panel-tabpanel')).containerType`)) === 'inline-size');
  check('폭 360 은 좁음', (await zone()) === 'narrow', await zone());
  await setWidth(560);
  check('폭 560 은 보통', await p.until(async () => (await zone()) === 'medium'), await zone());
  await setWidth(320);
  check('폭 320 은 좁음', await p.until(async () => (await zone()) === 'narrow'), await zone());
  await setWidth(360);

  // 덮는 것이 면(.surface) 기준: 부모가 면이고 자리가 카드와 맞는다
  const surfaceOf = (sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.parentElement?.classList.contains('surface')`);
  await p.ev(`document.querySelector('details.week')?.setAttribute('open', ''); 1`);
  await p.ev(reveal('.week-card-open'));
  await sleep(200);
  await p.click(`document.querySelector('.week-card-open')`);
  await sleep(400);
  check('주간 카드 막이 면 안에 있다', await surfaceOf('.week-card-dim'));
  const dim = await p.ev(rectOf('.week-card-dim'));
  const card = await p.ev(rectOf('.card-window'));
  check('주간 카드 막이 카드 테두리 상자와 같은 자리', JSON.stringify(dim) === JSON.stringify(card), `${JSON.stringify(dim)} / ${JSON.stringify(card)}`);
  await p.ev(esc());
  await sleep(250);
  check('주간 카드는 Esc 로 닫히고 패널은 남는다', !(await p.ev(`!!document.querySelector('.week-card-dim')`)) && (await main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()')));
  await tabTo('todo');
  await p.ev(rightClick('.todos .todo .title'));
  await sleep(250);
  check('줄 메뉴가 면 안에 있다', await surfaceOf('.pin-menu'));
  check('줄 메뉴가 맨 위에서 눌린다', await p.ev(`(() => { const m = document.querySelector('.pin-menu button'); if (!m) return false; const r = m.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!top && (top === m || m.contains(top)); })()`));
  await p.ev(esc('.pin-menu button'));
  await sleep(200);
  check('줄 메뉴 Esc 는 메뉴만 닫는다', !(await p.ev(`!!document.querySelector('.pin-menu')`)) && (await main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()')));

  // ---- 큰 창에서 온 요청 (큰 창이 없으니 숨은 창 하나를 면으로 알려서 흉내) ----
  const second = await main(`(async () => {
    const BW = __jj.panel.window.constructor;
    const w = new BW({ show: false, webPreferences: { preload: ${JSON.stringify(join(root, 'out/preload/index.cjs'))}, additionalArguments: ['--jj-window=panel', '--jj-lang=${LANG}'], sandbox: true, contextIsolation: true } });
    await w.loadFile(${JSON.stringify(join(root, 'out/renderer/panel.html'))});
    globalThis.__home = w;
    globalThis.__off = __jj.panel.registerHome(w);
    return true;
  })()`);
  check('숨은 창 하나를 큰 창 면으로 알렸다', second === true);
  const surfaceKind = () => main(`(() => { const s = __jj.panel.activeSurface(); return s === globalThis.__home ? 'home' : s === __jj.panel.window ? 'panel' : s ? 'other' : 'none'; })()`);
  check('큰 창이 있으면 보이는 면은 큰 창', (await surfaceKind()) === 'home', await surfaceKind());
  const h = await page('panel', { not: p.id });
  // 큰 창이 받는 상태: 패널과 같은 push 를 받는다
  await h.ev(`globalThis.__n = 0; window.jjakkungPanel.onState(() => { globalThis.__n++; }); 1`);
  await main(`__jj.store.add({ title: ${JSON.stringify(tx('상태 받기', 'Get state'))} }, Date.now()); __jj.panel.refresh(); 1`);
  check('큰 창도 상태 push 를 받는다', await h.until(async () => (await h.ev('globalThis.__n')) > 0));
  // 큰 창에서 설정 열기: 패널은 닫히지 않는다
  await h.ev(`window.jjakkungPanel.openSettings(); 1`);
  await sleep(800);
  check('큰 창에서 설정을 열어도 패널이 안 닫힌다', await main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()'));
  check('큰 창에서 온 요청으로 설정 창이 열렸다', await main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()'));
  await main('__jj.settingsWindow.window.close(); 1');
  await sleep(500);
  // 큰 창을 떼면 패널이 면
  await main('globalThis.__off(); 1');
  check('큰 창을 떼면 보이는 면은 패널', (await surfaceKind()) === 'panel', await surfaceKind());
  await main('globalThis.__home.destroy(); 1');
  await sleep(300);
  // 패널에서 설정 열기: 패널이 닫힌다 (예전 그대로)
  await p.ev(`window.jjakkungPanel.openSettings(); 1`);
  check('패널에서 설정을 열면 패널이 닫힌다', await p.until(() => main('!__jj.panel.window || __jj.panel.window.isDestroyed()'), 4000));
  await sleep(300);
  await main('__jj.settingsWindow.window?.close(); 1');
  await sleep(500);

  // ---- 오래된 메모 쓰기 거절 ----
  await main("__jj.panel.openTab('note'); 1");
  await sleep(1500);
  const p2 = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const base0 = await main(`__jj.notes.get(${note1}).updatedAt`);
  const upd = (patch, baseObj) => p2.ev(`window.jjakkungPanel.noteUpdate(${note1}, ${JSON.stringify(patch)}, ${JSON.stringify(baseObj)})`);
  // 다른 곳이 먼저 고쳤다 (본문을 바꿈, 합칠 수 없음)
  await main(`__jj.notes.update(${note1}, { body: 'other' }, ${base0 + 5000}); 1`);
  const stale = await upd({ body: 'mine' }, { body: tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'), at: base0 });
  check('오래된 쓰기는 거절(stale)', stale?.ok === false && stale?.stale === true, JSON.stringify(stale));
  check('거절하면 저장된 글은 그대로', (await main(`__jj.notes.get(${note1}).body`)) === 'other');
  // 시각 없는 옛 호출은 지금처럼 저장
  const legacy = await upd({ body: 'legacy' }, { body: 'other' });
  check('시각 없는 옛 호출은 거절하지 않는다', legacy?.ok === true, JSON.stringify(legacy));
  check('옛 호출 결과에 고친 시각이 실려 온다', typeof legacy?.updatedAt === 'number');
  check('base 도 없는 옛 호출도 저장', (await p2.ev(`window.jjakkungPanel.noteUpdate(${note1}, { body: 'plain' })`))?.ok === true);
  // 덧붙임은 합친다 (거절하지 않는다)
  const at1 = await main(`__jj.notes.get(${note1}).updatedAt`);
  await main(`__jj.notes.update(${note1}, { body: 'plain\\nappended' }, ${at1 + 5000}); 1`);
  const merged = await upd({ body: 'plain edited' }, { body: 'plain', at: at1 });
  check('다른 곳이 덧붙인 것은 합쳐 저장(거절 아님)', merged?.ok === true, JSON.stringify(merged));
  check('합친 글에 덧붙인 줄이 남아 있다', ((await main(`__jj.notes.get(${note1}).body`)) ?? '').includes('appended'));
  // 마지막으로 본 시각이 맞으면 저장
  const at2 = await main(`__jj.notes.get(${note1}).updatedAt`);
  const fresh = await upd({ body: 'fresh' }, { body: await main(`__jj.notes.get(${note1}).body`), at: at2 });
  check('최신 시각이면 저장', fresh?.ok === true && (await main(`__jj.notes.get(${note1}).body`)) === 'fresh');

  // ---- 메모 편집 화면: 다른 곳이 먼저 고친 글 위에 쓰면 안내 ----
  await p2.click(`document.querySelector('.notes li.note-row > button:first-child')`);
  await sleep(500);
  const noteNow = await main(`(() => { const n = __jj.notes.list().find((x) => x.id === ${note1}); return n ? n.updatedAt : 0; })()`);
  await p2.ev(`document.querySelector('textarea')?.focus()`);
  await p2.type('X');
  // 입력 뒤 저장 대기(400ms) 안에 다른 곳이 먼저 고친다
  await main(`__jj.notes.update(${note1}, { body: 'replaced elsewhere' }, ${noteNow + 60_000}); 1`);
  const gotNote = await p2.until(() => p2.ev(`!!document.querySelector('.hint.error[role="alert"]')`), 4000);
  check('편집 중 다른 곳이 먼저 고치면 안내가 뜬다', gotNote, await p2.ev(`document.querySelector('.hint.error[role="alert"]')?.textContent`));
  check('그 사이 저장된 글은 덮이지 않았다', (await main(`__jj.notes.get(${note1}).body`)) === 'replaced elsewhere');

  // ---- Esc 로 패널이 닫힌다 (작은 패널) ----
  await p2.ev(`document.activeElement?.blur?.(); 1`);
  await p2.click(`document.querySelector('.panel-main')`);
  await p2.ev(`document.querySelector('.note-bar .back')?.click(); 1`);
  await sleep(300);
  await p2.ev(esc('body'));
  check('작은 패널은 Esc 로 닫힌다', await p2.until(() => main('!__jj.panel.window || __jj.panel.window.isDestroyed()'), 4000));
};

try {
  await body();
} catch (err) {
  check('시험이 끝까지 돌았다', false, err instanceof Error ? err.message : String(err));
} finally {
  await cleanup();
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
