// 큰 창 메모 구역: 들어가자마자 빈 새 메모 칸에서 바로 쓴다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/note-ready.mjs
//   (SHOTS_ONLY=1 PREFIX=before 면 판정 없이 그림만: 옛 판 비교용)
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 JJ_INSPECT_PORT/JJ_PAGE_PORT) 화면은 CDP 로만 다룬다.
// 진짜 마우스, 키보드, 포커스는 쓰지 않는다. 창 포커스는 Emulation.setFocusEmulationEnabled 로 흉내 낸다.
//
// 보는 것 (PASS/FAIL):
//   구역을 고르면 오른쪽이 빈 새 메모 칸(안내 글 없음)이고 메모는 안 만들어짐, 앞에 있는 창이면 본문에 커서, 앞에 없으면(시험 창) 커서를 안 가져감,
//   찾기 칸에 커서가 있을 때 키보드로 구역을 골러도 안 가져감, 한 글자 쓰면 메모 1건이 목록 맨 위에 생기고 편집기로 넘어가 커서와 글이 이어짐,
//   조합 중에는 만들지 않고 조합이 끝나면 만듦, 제목 칸에서 쓰면 제목 칸에 커서, 안 쓰고 다른 메모/구역을 가면 0건 늘어남,
//   "새 메모" 단추: 빈 칸 편집 중이면 커서만, 메모를 열어 둔 때는 빈 칸으로 돌아가고 메모를 안 만듦, 밝음/어두움 폭 760/1100 그림
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-note-ready');
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.note-ready-'));
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
async function homePage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.filter((x) => x.type === 'page' && x.url.includes('home.html')).at(-1);
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
  throw new Error('no home page');
}

const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};

const run = async () => {
  await main('1');
  await sleep(1500);
  const seed = (title, body) =>
    main(`__jj.notes.add({ title: ${JSON.stringify(title)}, body: ${JSON.stringify(body)} }, Date.now()); 1`);
  const count = () => main('__jj.notes.list().length');
  await main("__jj.home.open('today'); 1");
  await waitFor(() => main('!!__jj.home.window && !__jj.home.window.isDestroyed()'));
  await sleep(1400);
  let c = await homePage();
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const setBounds = async (w, h = 780) => {
    await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: ${h} }); 1`);
    await sleep(700);
  };
  const mouse = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  };
  const click = async (sel) => {
    const pos = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!pos) return false;
    await mouse(pos.x, pos.y);
    await sleep(450);
    return true;
  };
  const tab = (id) => click(`#ptab-${id}`);
  const shown = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`);
  const focusOn = () => ev('document.activeElement ? document.activeElement.tagName + "." + document.activeElement.className : ""');
  const bodyFocused = () => ev(`document.activeElement === document.querySelector('.note-editor textarea')`);
  const titleFocused = () => ev(`document.activeElement === document.querySelector('.note-editor .note-title-input')`);
  const realEditor = '.note-editor:not(.note-draft)';
  const shot = async (name, dark) => {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await ev(`(() => { const s = document.createElement('style'); s.id = '__shot'; s.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.append(s); })()`);
    await sleep(250);
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    await ev(`document.getElementById('__shot')?.remove()`);
    writeFileSync(join(OUT, `${PREFIX}-${name}-${dark ? 'dark' : 'light'}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const key = (init) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} })); 1`);

  // 기본 펫, 기본 상태: 메모 둘이 있는 평소 화면
  await seed(tx('장보기 목록', 'Shopping list'), tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'));
  await seed(tx('회의 메모', 'Meeting notes'), tx('다음 주 일정 정리', 'Plan for next week'));
  await sleep(500);
  let n0 = await count();

  if (SHOTS_ONLY) {
    for (const w of [1100, 760]) {
      await setBounds(w);
      await tab('today');
      await tab('note');
      for (const dark of [false, true]) await shot(`w${w}`, dark);
    }
    return;
  }

  // ---- 앞에 있는 창(포커스 흉내)으로 들어가기 ----
  await setBounds(1100);
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await tab('today');
  await tab('note');
  check('구역을 고르면 오른쪽이 빈 새 메모 칸이고 안내 글이 없다', (await shown('.note-draft')) && (await ev(`!document.querySelector('.note-pane-empty')`)) && !(await shown(realEditor)));
  check('들어가도 메모는 안 만들어진다', (await count()) === n0);
  check('본문 칸에 커서가 있다', await bodyFocused(), await focusOn());
  check('칸에 제목, 본문 안내 글이 있다 (ko/en)', (await ev(`[document.querySelector('.note-draft .note-title-input').placeholder, document.querySelector('.note-draft textarea').placeholder].join('|')`)) === tx('제목 (비우면 첫 줄)|적어 봐. # 제목, - 목록 같은 마크다운도 돼.', 'Title (blank uses the first line)|Write here. Markdown like # heading and - list works too.'));
  for (const dark of [false, true]) await shot('w1100-draft', dark);

  // 한 글자 쓰기
  await c.send('Input.insertText', { text: 'a' });
  check('한 글자 쓰면 메모 1건이 생긴다', await waitFor(async () => (await count()) === n0 + 1), String(await count()));
  await sleep(500);
  check('편집기로 넘어가고 첫 줄 목록 맨 위에 나타난다', (await shown(realEditor)) && (await ev(`document.querySelector('li.note-row .note-title')?.textContent`)) === 'a');
  check('커서가 본문에 이어지고 쓴 글이 그대로다', (await bodyFocused()) && (await ev(`document.querySelector('${realEditor} textarea').value`)) === 'a');
  await c.send('Input.insertText', { text: 'bc' });
  await sleep(700);
  check('이어 쓰면 같은 메모가 저장된다 (1건)', (await count()) === n0 + 1 && (await main(`__jj.notes.list().find((n) => n.body === 'abc') ? 1 : 0`)) === 1);
  n0 = await count();
  for (const dark of [false, true]) await shot('w1100-typed', dark);

  // 새 메모 단추: 열린 메모가 있으면 빈 칸으로, 메모는 안 만든다
  await click('.note-list-pane .add.row .primary');
  check('열린 메모가 있을 때 "새 메모"는 빈 새 메모 칸으로 돌아가고 메모를 안 만든다', (await shown('.note-draft')) && (await count()) === n0);
  check('커서가 본문에 있다', await bodyFocused(), await focusOn());
  // 찾기 칸으로 커서를 옮긴 뒤 단추: 커서만 준다
  await click('.note-list-pane .add.row input');
  check('(준비) 찾기 칸에 커서', await ev(`document.activeElement === document.querySelector('.note-list-pane .add.row input')`));
  await click('.note-list-pane .add.row .primary');
  check('빈 칸을 보고 있을 때 "새 메모"는 그 칸에 커서만 준다', (await bodyFocused()) && (await count()) === n0 && (await shown('.note-draft')));
  await click('.note-list-pane .add.row .primary');
  check('한 번 더 눌러도 그대로 (메모 안 생김)', (await bodyFocused()) && (await count()) === n0);

  // 안 쓰고 다른 메모를 고르기
  await click('li.note-row:nth-child(2) > button:first-child');
  check('안 쓰고 다른 메모를 고르면 빈 메모가 안 생긴다', (await shown(realEditor)) && (await count()) === n0);
  // 안 쓰고 다른 구역으로
  await click('.note-list-pane .add.row .primary');
  await tab('todo');
  await tab('note');
  await sleep(500);
  check('안 쓰고 구역을 나갔다 와도 빈 메모가 안 생긴다', (await count()) === n0);

  // 찾기 칸에 쓰던 중 키보드로 구역을 고르면 안 가져간다
  await tab('today');
  await tab('note');
  await click('.note-list-pane .add.row input');
  await c.send('Input.insertText', { text: 'zz' });
  const noteKey = await ev(`document.querySelector('#ptab-note kbd')?.textContent ?? ''`);
  const digit = noteKey.replace(/\D/g, '');
  await key({ key: digit, code: `Digit${digit}`, metaKey: true });
  await sleep(500);
  check('찾기 칸에 쓰던 중 키보드로 메모 구역을 골라도 커서를 안 뺏는다', await ev(`document.activeElement === document.querySelector('.note-list-pane .add.row input')`), `${noteKey} ${await focusOn()}`);
  await ev(`(() => { const i = document.querySelector('.note-list-pane .add.row input'); i.focus(); return 1; })()`);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);

  // 제목 칸에서 쓰기
  await tab('today');
  await tab('note');
  await click('.note-list-pane .add.row .primary');
  await ev(`document.querySelector('.note-draft .note-title-input').focus(); 1`);
  await c.send('Input.insertText', { text: tx('제목글', 'Heading') });
  check('제목 칸에서 쓰면 메모가 생기고 제목 칸에 커서가 이어진다', (await waitFor(async () => (await count()) === n0 + 1)) && (await sleep(500), await titleFocused()), await focusOn());
  n0 = await count();

  // 조합 중에는 만들지 않는다
  await click('.note-list-pane .add.row .primary');
  await c.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  await sleep(500);
  check('한글 조합 중에는 메모를 만들지 않는다', (await count()) === n0 && (await shown('.note-draft')));
  await c.send('Input.insertText', { text: '한' });
  check('조합이 끝나면 만든다', await waitFor(async () => (await count()) === n0 + 1));
  n0 = await count();

  // ---- 구역을 고르지 않고 열린 경우(펫 메뉴, 트레이로 큰 창을 연다)와 앞에 없는 창은 안 가져간다 ----
  await main('__jj.home.window.close(); 1');
  await sleep(800);
  await main("__jj.home.open('note'); 1");
  await waitFor(() => main('!!__jj.home.window && !__jj.home.window.isDestroyed()'));
  await sleep(1500);
  const c2 = await homePage();
  await c2.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const e2 = async (expr) => (await c2.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  // 기억된 마지막 메모가 있으면 그 메모가 열리고(원래 동작), 없으면 빈 칸이다. 어느 쪽이든 빈 칸이 커서를 가져가지 않는다
  check('구역을 고르지 않고 열린 큰 창에서 빈 새 메모 칸은 커서를 가져가지 않는다', !(await e2(`document.activeElement === document.querySelector('.note-draft textarea')`)), (await e2(`document.querySelector('.note-draft') ? '빈 칸' : '기억된 메모'`)));
  // 창 포커스를 흉내 내지 않은 상태에서 키보드로 메모 구역을 고른다: 창이 앞에 없으면 커서를 안 가져간다
  await c2.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const hasFocus = await e2('document.hasFocus()');
  await e2(`document.activeElement?.blur?.(); 1`);
  await e2(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ${JSON.stringify(digit)}, code: 'Digit${digit}', metaKey: true })); 1`);
  await sleep(500);
  const grabbed = await e2(`document.activeElement === document.querySelector('.note-draft textarea')`);
  check('창이 앞에 없으면(창 포커스 없음) 구역을 골라도 커서를 안 가져간다', hasFocus ? true : !grabbed, `hasFocus=${hasFocus} grabbed=${grabbed}`);
  conns.clear();
  c = await homePage();

  // ---- 좁은 폭 760, 어두움 ----
  await setBounds(760);
  await tab('today');
  await tab('note');
  check('760 에서도 빈 새 메모 칸이거나(나란히) 목록 하나이고 넘침이 없다', await ev(`document.documentElement.scrollWidth <= innerWidth + 1`));
  for (const dark of [false, true]) await shot('w760', dark);
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
