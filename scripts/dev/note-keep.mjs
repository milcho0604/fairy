// 메모 단축키와 보던 메모 유지: Cmd/Ctrl+N 새 메모, 단추 옆 안내(ko/en), 다른 구역이나 탭, 창을 갔다 와도 마지막으로 보던 메모.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/note-keep.mjs   (PREFIX=before|after 는 그림 이름 머리)
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1) 화면은 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 큰 창(나란히 보기)과 작은 패널에서 PASS/FAIL, 폭 760/1100(큰 창), 320/560(패널) x 밝음/어두움 그림.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-note-keep');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const PREFIX = process.env.PREFIX ?? 'after';
const SHOTS_ONLY = !!process.env.SHOTS_ONLY;
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
const tx = (k, e) => (ko ? k : e);
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.note-keep-'));
const data = join(scratch, 'data');
const homeDir = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(homeDir, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi'), wander: false }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: homeDir,
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

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const i = ++id;
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), 20_000);
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
  for (let i = 0; i < 120 && !mainConn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      mainConn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const conns = new Map();
async function pageOf(file) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.filter((x) => x.type === 'page' && x.url.includes(file)).at(-1);
      if (p) {
        let c = conns.get(p.id);
        if (!c) {
          c = await connect(p.webSocketDebuggerUrl);
          conns.set(p.id, c);
          await c.send('Page.enable');
        }
        return c;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no ${file} page`);
}

const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};

const homePage = () => pageOf('home.html');
const panelPage = () => pageOf('panel.html');

const run = async () => {
  await main('1');
  if (!(await waitFor(() => main("typeof __jj !== 'undefined' && !!__jj.notes"), 40_000))) throw new Error('__jj 없음');
  await sleep(800);
  const seed = (title, body) =>
    main(`__jj.notes.add({ title: ${JSON.stringify(title)}, body: ${JSON.stringify(body)} }, Date.now()).id`);
  const titleA = tx('장보기 목록', 'Shopping list');
  const titleB = tx('회의 메모', 'Meeting notes');
  await seed(titleA, tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'));
  const idB = await seed(titleB, tx('다음 주 일정 정리', 'Plan for next week'));
  const count = () => main('__jj.notes.list().length');
  const KEY = '⌘N';
  const EDITOR = '.note-editor:not(.note-draft)';
  // 목록은 고친 때 최근순: B(회의 메모)가 위, A(장보기 목록)가 아래
  const row = (n) => `li.note-row:nth-child(${n}) > button:first-child`;

  // 화면 하나를 다루는 손잡이 묶음
  const tools = (getC) => {
    const ev = async (expr) => {
      const r = await getC().send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    const click = async (sel) => {
      const pos = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!pos) return false;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await getC().send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await sleep(450);
      return true;
    };
    const shown = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`);
    const key = (init) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} })); 1`);
    const shot = async (name, dark) => {
      await getC().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await ev(`(() => { const s = document.createElement('style'); s.id = '__shot'; s.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.append(s); })()`);
      await sleep(250);
      const r = await getC().send('Page.captureScreenshot', { format: 'png' });
      await ev(`document.getElementById('__shot')?.remove()`);
      writeFileSync(join(OUT, `${PREFIX}-${name}-${dark ? 'dark' : 'light'}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
    };
    const title = () => ev(`document.querySelector('${EDITOR} .note-title-input')?.value ?? null`);
    return { ev, click, shown, key, shot, title };
  };
  const hint = (T) => T.ev(`(() => { const b = document.querySelector('.add.row .new-note'); return b ? { text: b.textContent, title: b.title, keys: b.getAttribute('aria-keyshortcuts'), hidden: b.querySelector('.keyhint')?.getAttribute('aria-hidden') } : null; })()`);
  const hintOk = (h) => !!h && h.text.includes(KEY) && h.title === tx(`새 메모 (${KEY})`, `New note (${KEY})`) && h.keys === 'Meta+N' && h.hidden === 'true';

  // ===================== 큰 창 (나란히 보기) =====================
  await main("__jj.home.open('today'); 1");
  await waitFor(() => main('!!__jj.home.window && !__jj.home.window.isDestroyed()'));
  await sleep(1400);
  const hc = await homePage();
  const H = tools(() => hc);
  const setHome = async (w, h = 780) => {
    await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: ${h} }); 1`);
    await sleep(700);
  };
  await setHome(1100);
  await hc.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await H.click('#ptab-today');
  await H.click('#ptab-note');

  let h = await hint(H);
  check('[큰 창] 새 메모 단추 옆에 안내가 보이고 풀이와 aria 가 있다', hintOk(h), JSON.stringify(h));

  const n0 = await count();
  await H.click(row(2));
  check('[큰 창] (준비) 메모를 열었다', (await H.title()) === titleA, String(await H.title()));
  await H.key({ key: 'n', code: 'KeyN', metaKey: true });
  await sleep(500);
  check('[큰 창] Cmd+N 은 열린 메모에서 빈 새 메모 칸으로 돌아가고 메모를 안 만든다', (await H.shown('.note-draft')) && (await count()) === n0);
  check('[큰 창] 빈 칸 본문에 커서가 있다', await H.ev(`document.activeElement === document.querySelector('.note-draft textarea')`));
  await H.key({ key: 'n', code: 'KeyN', metaKey: true });
  await sleep(300);
  check('[큰 창] 한 번 더 눌러도 그대로 (메모 안 생김)', (await H.shown('.note-draft')) && (await count()) === n0);
  await H.click(row(2));
  await H.key({ key: 'n', code: 'KeyN', ctrlKey: true });
  await H.key({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true });
  await sleep(300);
  check('[큰 창] 맥에서 Ctrl+N, Cmd+Shift+N 은 무시한다', (await H.shown(EDITOR)) && !(await H.shown('.note-draft')));
  await H.key({ key: 'ㅜ', code: 'KeyN', metaKey: true });
  await sleep(300);
  check('[큰 창] 한글 자판(key 가 ㅜ)의 Cmd+N 도 받는다', (await H.shown('.note-draft')) && (await count()) === n0);
  await H.key({ key: '1', code: 'Digit1', metaKey: true });
  await sleep(400);
  check('[큰 창] Cmd+1 은 그대로 오늘 구역으로 간다', !(await H.shown('.note-draft')));
  await H.click('#ptab-note');

  // 구역을 갔다 와도 보던 메모
  await H.click(row(2));
  check('[큰 창] (준비) 장보기 목록을 열었다', (await H.title()) === titleA);
  await H.click('#ptab-todo');
  await H.click('#ptab-note');
  await sleep(600);
  check('[큰 창] 다른 구역(할 일)을 갔다 와도 보던 메모가 그대로 열려 있다', (await H.title()) === titleA, String(await H.title()));
  await H.click('#ptab-event');
  await H.click('#ptab-today');
  await H.click('#ptab-note');
  await sleep(600);
  check('[큰 창] 구역을 두 번 돌고 와도 그대로다', (await H.title()) === titleA, String(await H.title()));
  await H.click(row(1));
  check('[큰 창] (준비) 회의 메모로 바꿨다', (await H.title()) === titleB);
  await H.click('#ptab-todo');
  await H.click('#ptab-note');
  await sleep(600);
  check('[큰 창] 메모를 바꿔 보다 갔다 오면 마지막으로 본 메모(회의 메모)가 열린다', (await H.title()) === titleB, String(await H.title()));
  // 새 메모 칸으로 돌아가 있던 채 갔다 오면 빈 칸
  await H.click('.add.row .new-note');
  await H.click('#ptab-todo');
  await H.click('#ptab-note');
  await sleep(600);
  check('[큰 창] 빈 새 메모 칸을 보던 채 갔다 오면 빈 새 메모 칸이다 (옛 메모를 안 연다)', (await H.shown('.note-draft')) && !(await H.shown(EDITOR)), String(await H.title()));
  // 쓰던 글
  await H.click(row(1));
  await H.ev(`(() => { const t = document.querySelector('${EDITOR} textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return 1; })()`);
  await hc.send('Input.insertText', { text: tx(' 추가', ' more') });
  await H.click('#ptab-todo');
  await H.click('#ptab-note');
  await sleep(700);
  const bodyNow = await H.ev(`document.querySelector('${EDITOR} textarea')?.value ?? null`);
  check('[큰 창] 방금 쓴 글도 갔다 오면 그대로다', !!bodyNow && bodyNow.endsWith(tx(' 추가', ' more')), String(bodyNow));
  // 그 사이 사라진 메모
  await H.click('#ptab-todo');
  await main(`__jj.notes.remove(${idB}, Date.now()); 1`);
  await H.click('#ptab-note');
  await sleep(700);
  check('[큰 창] 그 사이 지워진 메모는 열리지 않고 조용히 빈 칸으로 돌아간다', (await H.shown('.note-draft')) && !(await H.shown(EDITOR)), String(await H.title()));
  await seed(titleB, 'x');
  await sleep(300);

  for (const w of [1100, 760]) {
    await setHome(w);
    await H.click('#ptab-today');
    await H.click('#ptab-note');
    check(`[큰 창 ${w}] 가로 넘침이 없다`, await H.ev(`document.documentElement.scrollWidth <= innerWidth + 1`));
    for (const dark of [false, true]) await H.shot(`home-w${w}`, dark);
  }

  // ===================== 작은 패널 =====================
  await main('__jj.home.window.close(); 1');
  await sleep(800);
  const panelUp = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()');
  const openPanel = async () => {
    await main('__jj.panel.togglePanel(); 1');
    await waitFor(panelUp);
    await main("__jj.panel.window.removeAllListeners('blur'); __jj.panel.openTab('note'); 1");
    await sleep(1400);
  };
  await openPanel();
  let pc = await panelPage();
  const P = tools(() => pc);
  await waitFor(() => P.shown('.tabs'));
  const setPanel = async (w) => {
    await main(`(() => { const win = __jj.panel.window; const b = win.getBounds(); win.setBounds({ ...b, width: ${w} }); return 1; })()`);
    await sleep(600);
  };
  await P.click('#ptab-note');
  h = await hint(P);
  check('[패널] 새 메모 단추 옆에 안내와 풀이와 aria 가 있다', hintOk(h), JSON.stringify(h));
  const pn0 = await count();
  await P.key({ key: 'n', code: 'KeyN', metaKey: true });
  await sleep(800);
  check('[패널] Cmd+N 은 새 메모를 만들어 편집기로 연다 (단추와 같다)', (await count()) === pn0 + 1 && (await P.shown(EDITOR)));
  await P.ev(`document.querySelector('.note-bar .back').click(); 1`);
  await sleep(500);
  check('[패널] 안 쓴 빈 새 메모는 뒤로 나가면 지워진다', (await count()) === pn0);
  await P.key({ key: 'n', code: 'KeyN', metaKey: true });
  await P.key({ key: 'n', code: 'KeyN', metaKey: true });
  await sleep(1000);
  check('[패널] Cmd+N 을 빠르게 두 번 눌러도 메모는 하나만 만든다', (await count()) === pn0 + 1, String((await count()) - pn0));
  await P.ev(`document.querySelector('.note-bar .back').click(); 1`);
  await sleep(500);

  for (const w of [320, 560]) {
    await setPanel(w);
    await P.click('#ptab-note');
    const fit = await P.ev(`(() => { const r = document.querySelector('.add.row'); const b = r.querySelector('.new-note').getBoundingClientRect(); const i = r.querySelector('input').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth + 1, inRow: b.right <= r.getBoundingClientRect().right + 1, inputW: Math.round(i.width), btnH: Math.round(b.height) }; })()`);
    check(`[패널 ${w}] 안내가 있어도 넘침이 없고 찾기 칸이 쓸 만하다`, !fit.over && fit.inRow && fit.inputW >= 100, JSON.stringify(fit));
    for (const dark of [false, true]) await P.shot(`panel-w${w}`, dark);
  }
  await setPanel(360);

  await P.click(row(1));
  const pa = await P.title();
  check('[패널] (준비) 메모를 열었다', pa !== null, String(pa));
  await P.click('#ptab-todo');
  await P.click('#ptab-note');
  await sleep(600);
  check('[패널] 다른 탭(할 일)을 갔다 와도 보던 메모가 그대로 열려 있다', (await P.title()) === pa, String(await P.title()));
  await P.click('#ptab-event');
  await P.click('#ptab-note');
  await sleep(600);
  check('[패널] 다른 탭(일정)을 갔다 와도 그대로다', (await P.title()) === pa, String(await P.title()));
  await P.ev(`document.querySelector('.note-bar .back').click(); 1`);
  await sleep(500);
  await P.click('#ptab-todo');
  await P.click('#ptab-note');
  await sleep(600);
  check('[패널] 뒤로 나간 뒤 갔다 오면 목록이다 (저절로 열지 않는다)', (await P.shown('.note-list-pane')) && !(await P.shown(EDITOR)));
  await P.click(row(1));
  const pb = await P.title();
  await main('(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await sleep(800);
  await openPanel();
  conns.clear();
  pc = await panelPage();
  await waitFor(() => P.shown('.tabs'));
  await sleep(500);
  check('[패널] 패널을 닫았다 열어도 보던 메모가 열려 있다', pb !== null && (await P.title()) === pb, `${pb} -> ${await P.title()}`);
  const idNow = await main(`__jj.notes.list().find((n) => n.title === ${JSON.stringify(await P.title())})?.id ?? -1`);
  await P.click('#ptab-todo');
  await main(`__jj.notes.remove(${idNow}, Date.now()); 1`);
  await P.click('#ptab-note');
  await sleep(700);
  check('[패널] 그 사이 지워진 메모는 조용히 목록으로 돌아간다', (await P.shown('.note-list-pane')) && !(await P.shown(EDITOR)));
  check('끝까지 빈 메모는 하나도 없다', (await main(`__jj.notes.list().filter((n) => !n.title.trim() && !n.body.trim()).length`)) === 0);
};

try {
  await run();
} catch (e) {
  check('시험 진행', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' '));
} finally {
  await cleanup();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
