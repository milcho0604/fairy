// 패널 크기 조절과 기억 점검 (이슈 #144, 큰 창 설계 #159). 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위)
// 패널 안 손잡이를 CDP 마우스로 끌어 본다. 진짜 마우스와 키보드, 진짜 AI 는 쓰지 않는다. 끝나면 데이터 폴더를 지운다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/panel-resize.mjs
//
// 보는 것: 처음 크기 360x540, 모서리 끌기, 아래와 오른쪽 가장자리 끌기(한 방향만), 범위(320~560 x 420~작업 영역), 끄는 동안 blur 로
// 안 닫힘과 끝난 뒤 닫힘, 초당 갱신 60 이하, 닫고 열어 크기 유지(window-bounds.json 에는 크기만), 화면 밖 값과 깨진 값,
// 두 번 눌러 처음 크기, 화살표 키(10, Shift 50), 폭 320, 360, 560 에서 가로 넘침, 높이를 늘리면 목록이 늘어남.
// 화면은 OUT 에 찍는다 (pr144-*.png).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-panel-resize');
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.panel-resize-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
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
        const mouse = (type, x, y, o = {}) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' && !o.buttons ? 'none' : 'left',
            buttons: o.buttons ?? (type === 'mousePressed' ? 1 : 0),
            clickCount: o.clickCount ?? (type === 'mouseMoved' ? 0 : 1),
          });
        const key = (type, k, o = {}) =>
          c.send('Input.dispatchKeyEvent', { type, key: k, code: k, modifiers: o.shift ? 8 : 0, ...o.extra });
        return {
          ev,
          mouse,
          key,
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

const bounds = async () => JSON.parse(await main('JSON.stringify(__jj.panel.window.getBounds())'));
const area = async () => JSON.parse(await main('JSON.stringify(__jj.screen.getPrimaryDisplay().workArea)'));
async function waitSize(want, ms = 2000) {
  const t0 = Date.now();
  let b = await bounds();
  while (Date.now() - t0 < ms && (want.width !== undefined && b.width !== want.width || want.height !== undefined && b.height !== want.height)) {
    await sleep(40);
    b = await bounds();
  }
  return b;
}
const isOpen = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()');
async function openPanel(tab = 'today') {
  if (!(await isOpen())) await main('__jj.panel.togglePanel(); 1');
  for (let i = 0; i < 40 && !(await isOpen()); i++) await sleep(150);
  await main(`__jj.panel.openTab('${tab}'); 1`);
  const p = await page('panel');
  for (let i = 0; i < 40 && !(await p.ev("!!document.querySelector('.grip-se')")); i++) await sleep(150);
  await sleep(300);
  return p;
}
async function closePanel() {
  await main('(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  for (let i = 0; i < 20 && (await isOpen()); i++) await sleep(100);
  await sleep(200);
}
const gripPoint = (p, sel) =>
  p
    .ev(
      `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2, w: innerWidth, h: innerHeight }); })()`,
    )
    .then((s) => JSON.parse(s));
/** 손잡이를 잡고 (dx, dy) 만큼 끈다. 끄는 중에 하고 싶은 일(whileDragging)을 받는다 */
async function drag(p, sel, dx, dy, { steps = 10, whileDragging, hold = false } = {}) {
  const g = await gripPoint(p, sel);
  await p.mouse('mouseMoved', g.x, g.y);
  await p.mouse('mousePressed', g.x, g.y, { buttons: 1 });
  for (let i = 1; i <= steps; i++) {
    await p.mouse('mouseMoved', g.x + (dx * i) / steps, g.y + (dy * i) / steps, { buttons: 1 });
    await sleep(25);
  }
  await sleep(120);
  if (whileDragging) await whileDragging();
  if (!hold) await p.mouse('mouseReleased', g.x + dx, g.y + dy, { buttons: 0 });
  await sleep(150);
  return g;
}
const overflow = (p) =>
  p.ev(`(() => {
    const card = document.querySelector('.card-window').getBoundingClientRect();
    const out = [];
    for (const e of document.querySelectorAll('.card-window *')) {
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
  })()`).then((s) => JSON.parse(s));

try {
  launch();
  await main('1');
  await sleep(2500);
  // 보여 줄 할 일과 일정 (목록이 길어야 높이를 늘렸을 때 늘어나는 것이 보인다)
  await main(`(() => {
    const titles = ['보고서 쓰기', '메일 답장하기', '장보기', '병원 예약 전화', '운동 30분', '책 반납', '세금 서류 챙기기', '친구 선물 고르기', '청소기 필터 갈기', '여행 숙소 알아보기', '아주 긴 할 일 제목이 두 줄 넘어가도 줄이 예쁘게 바뀌는지 보려고 일부러 길게 적은 할 일', '화분 물 주기'];
    for (const title of titles) __jj.store.add({ title }, Date.now());
    __jj.events.add({ title: '치과 예약', startAt: Date.now() + 3 * 3600_000 }, Date.now());
    __jj.events.add({ title: '팀 회의', startAt: Date.now() + 6 * 3600_000 }, Date.now());
    return 1;
  })()`);

  const wa = await area();
  console.log('작업 영역', JSON.stringify(wa));

  // 1. 처음 크기
  let p = await openPanel('today');
  let b = await bounds();
  check('처음 크기 360x540', b.width === 360 && b.height === 540, JSON.stringify(b));
  check('손잡이 셋이 있다', (await p.ev("document.querySelectorAll('.grip').length")) === 3);
  check(
    '모서리 손잡이에 풀이와 이름',
    (await p.ev("document.querySelector('.grip-se').title")).length > 5 && (await p.ev("document.querySelector('.grip-se').getAttribute('aria-label')")).length > 2,
  );
  await p.shot('pr144-default-today');
  await main(`__jj.panel.openTab('todo'); 1`);
  await sleep(300);
  await p.shot('pr144-default-todo');
  const listBefore = await p.ev("document.querySelector('.todos').clientHeight");
  await main(`__jj.panel.openTab('today'); 1`);

  // 2. 모서리 끌기 + 끄는 동안 blur 로 안 닫힘 + 갱신 빈도
  await main('globalThis.__rc = 0; __jj.panel.window.on("resize", () => { globalThis.__rc++; }); 1');
  const t0 = Date.now();
  await drag(p, '.grip-se', 120, 90, {
    steps: 40,
    hold: true,
    whileDragging: async () => {
      await main('__jj.panel.window.emit("blur"); 1');
      await sleep(300);
      check('끄는 동안 blur 가 와도 닫히지 않는다', await isOpen());
    },
  });
  const dragMs = Date.now() - t0;
  const rc = Number(await main('globalThis.__rc'));
  check('끄는 중 setBounds 가 초당 60번 이하', rc / (dragMs / 1000) <= 60, `${rc}번 / ${(dragMs / 1000).toFixed(2)}초`);
  b = await waitSize({ width: 480, height: 630 });
  check('모서리 끌기: 360x540 에서 +120 x +90', b.width === 480 && b.height === 630, JSON.stringify(b));
  // 놓기
  await p.mouse('mouseReleased', 0, 0, { buttons: 0 });
  await sleep(200);
  await main('__jj.panel.window.emit("blur"); 1');
  await sleep(500);
  check('끌기가 끝난 뒤 blur 면 닫힌다', !(await isOpen()));

  // 3. 닫고 열어 크기 유지, 파일에는 크기만
  p = await openPanel('today');
  b = await bounds();
  check('닫고 열어도 크기 유지', b.width === 480 && b.height === 630, JSON.stringify(b));
  const file = JSON.parse(readFileSync(join(data, 'window-bounds.json'), 'utf8'));
  check(
    'window-bounds.json 에 panel 크기만 있다 (자리는 펫 기준 거리로 따로)',
    file.panel?.width === 480 && file.panel?.height === 630 && file.panel.x === undefined && file.panel.y === undefined,
    JSON.stringify(file.panel),
  );

  // 4. 아래 가장자리는 높이만, 오른쪽 가장자리는 너비만
  await drag(p, '.grip-s', 200, 40, { steps: 8 });
  b = await waitSize({ height: 670 });
  check('아래 가장자리: 높이만 +40', b.width === 480 && b.height === 670, JSON.stringify(b));
  await drag(p, '.grip-e', -60, 100, { steps: 8 });
  b = await waitSize({ width: 420 });
  check('오른쪽 가장자리: 너비만 -60', b.width === 420 && b.height === 670, JSON.stringify(b));

  // 5. 범위
  await drag(p, '.grip-se', 900, 3000, { steps: 6 });
  b = await waitSize({ width: 560 });
  await sleep(300);
  b = await bounds();
  check('너비 위쪽 끝 560', b.width === 560, JSON.stringify(b));
  check('높이는 작업 영역 높이까지', b.height === wa.height, `${b.height} / 작업 영역 ${wa.height}`);
  check('작업 영역 안에 있다', b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height, JSON.stringify(b));
  await drag(p, '.grip-se', -3000, -3000, { steps: 6 });
  b = await waitSize({ width: 320, height: 420 });
  check('아래쪽 끝 320x420', b.width === 320 && b.height === 420, JSON.stringify(b));
  await p.shot('pr144-320-today');

  // 6. 두 번 눌러 처음 크기
  const g = await gripPoint(p, '.grip-se');
  await p.mouse('mouseMoved', g.x, g.y);
  await p.mouse('mousePressed', g.x, g.y, { buttons: 1, clickCount: 1 });
  await p.mouse('mouseReleased', g.x, g.y, { buttons: 0, clickCount: 1 });
  await p.mouse('mousePressed', g.x, g.y, { buttons: 1, clickCount: 2 });
  await p.mouse('mouseReleased', g.x, g.y, { buttons: 0, clickCount: 2 });
  b = await waitSize({ width: 360, height: 540 });
  check('손잡이 두 번 누르면 처음 크기 360x540', b.width === 360 && b.height === 540, JSON.stringify(b));
  await sleep(600);
  await closePanel();
  p = await openPanel('today');
  b = await bounds();
  check('처음 크기로 돌린 것도 기억', b.width === 360 && b.height === 540, JSON.stringify(b));

  // 7. 화살표 키
  await p.ev("document.querySelector('.grip-se').focus()");
  await p.key('keyDown', 'ArrowRight');
  await p.key('keyUp', 'ArrowRight');
  b = await waitSize({ width: 370 });
  check('오른쪽 화살표 +10', b.width === 370 && b.height === 540, JSON.stringify(b));
  await p.key('keyDown', 'ArrowDown', { shift: true });
  await p.key('keyUp', 'ArrowDown', { shift: true });
  b = await waitSize({ height: 590 });
  check('Shift+아래 화살표 +50', b.width === 370 && b.height === 590, JSON.stringify(b));
  await p.ev("document.querySelector('.grip-se').blur()");

  // 8. 화면 밖, 깨진 저장 값
  await closePanel();
  writeFileSync(join(data, 'window-bounds.json'), JSON.stringify({ panel: { width: 9999, height: 99999, x: -50000, y: 30000 } }));
  p = await openPanel('today');
  b = await bounds();
  check(
    '화면 밖 큰 값: 크기는 범위 안, 작업 영역 안',
    b.width === 560 && b.height === wa.height && b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height,
    JSON.stringify(b),
  );
  await closePanel();
  writeFileSync(join(data, 'window-bounds.json'), JSON.stringify({ panel: { width: 5, height: 5 } }));
  p = await openPanel('today');
  b = await bounds();
  check('너무 작은 값은 320x420 으로 올린다', b.width === 320 && b.height === 420, JSON.stringify(b));
  await closePanel();
  for (const bad of [{ panel: { width: '큼', height: 400 } }, { panel: 7 }, { panel: null }, 'x']) {
    writeFileSync(join(data, 'window-bounds.json'), JSON.stringify(bad));
    p = await openPanel('today');
    b = await bounds();
    check(`깨진 값 ${JSON.stringify(bad).slice(0, 30)} 은 처음 크기`, b.width === 360 && b.height === 540, JSON.stringify(b));
    await closePanel();
  }
  writeFileSync(join(data, 'window-bounds.json'), '{ 깨진 json');
  p = await openPanel('today');
  b = await bounds();
  check('JSON 이 깨져도 처음 크기로 열린다', b.width === 360 && b.height === 540, JSON.stringify(b));

  // 9. 폭 320, 360, 560 가로 넘침 (탭마다), 높이를 늘리면 목록이 늘어난다
  const tabs = ['today', 'todo', 'note', 'event', 'shop'];
  // 360 에서 이미 있던 자리 넘침(이벤트 목록의 -6px 여백 등)은 기준으로 두고 다른 폭에서 새로 생긴 것만 본다
  const baseline = new Map();
  const bare = (list) => list.map((x) => x.replace(/ \d+>\d+$/, ''));
  for (const w of [360, 320, 560]) {
    await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 600 }); 1`);
    await sleep(500);
    for (const tab of tabs) {
      await main(`__jj.panel.openTab('${tab}'); 1`);
      await sleep(400);
      const over = bare(await overflow(p));
      if (w === 360) baseline.set(tab, over);
      const fresh = over.filter((x) => x.startsWith('밖:') || !(baseline.get(tab) ?? []).includes(x));
      check(`폭 ${w} ${tab} 탭 가로 넘침 없음`, fresh.length === 0, fresh.join(', '));
    }
    await main(`__jj.panel.openTab('todo'); 1`);
    await sleep(300);
    await p.shot(`pr144-w${w}-todo`);
    await main(`__jj.panel.openTab('today'); 1`);
    await sleep(300);
    await p.shot(`pr144-w${w}-today`);
  }
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: 360, height: 540 }); __jj.panel.openTab('todo'); 1`);
  await sleep(500);
  const h540 = await p.ev("document.querySelector('.todos').clientHeight");
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: 360, height: 800 }); 1`);
  await sleep(500);
  const h800 = await p.ev("document.querySelector('.todos').clientHeight");
  check('높이를 늘리면 할 일 목록 칸이 늘어난다', h800 - h540 >= 250, `${h540} -> ${h800} (처음 ${listBefore})`);

  // 10. 큰 크기 화면 찍기 (오늘, 할 일), 밝게와 어둡게
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: 560, height: 700 }); 1`);
  await sleep(500);
  for (const tab of ['today', 'todo']) {
    await main(`__jj.panel.openTab('${tab}'); 1`);
    await sleep(400);
    await p.shot(`pr144-big-${tab}`);
  }
  await p.dark(true);
  await sleep(300);
  await p.shot('pr144-big-todo-dark');
  await p.dark(false);

  // 11. 다른 창 회귀: 설정, 채팅 창이 크기를 기억하고 설정 최소 높이 520
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1500);
  const sMin = await main('__jj.settingsWindow.window.getMinimumSize().join("x")');
  check('설정 창 최소 크기 360x520', sMin === '360x520', sMin);
  await main('__jj.settingsWindow.window.setSize(470, 640); 1');
  await sleep(300);
  await main('__jj.settingsWindow.window.close(); 1');
  await sleep(500);
  const saved = JSON.parse(readFileSync(join(data, 'window-bounds.json'), 'utf8'));
  check('설정 창 크기 기억 (window-bounds.json)', saved.settings?.width === 470 && saved.settings?.height === 640, JSON.stringify(saved.settings));
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1200);
  const sb = JSON.parse(await main('JSON.stringify(__jj.settingsWindow.window.getBounds())'));
  check('설정 창 다시 열면 같은 크기', sb.width === 470 && sb.height === 640, JSON.stringify(sb));
  await main('__jj.settingsWindow.window.close(); 1');
  await sleep(300);
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(1500);
  const cb0 = JSON.parse(await main('JSON.stringify(__jj.chat.window.getBounds())'));
  check('채팅 창 처음 크기 400x600 (펫 옆)', cb0.width === 400 && cb0.height === 600, JSON.stringify(cb0));
  await main('__jj.chat.window.setSize(450, 650); __jj.chat.window.close(); 1');
  await sleep(500);
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(1500);
  const cb1 = JSON.parse(await main('JSON.stringify(__jj.chat.window.getBounds())'));
  check('채팅 창 크기 기억', cb1.width === 450 && cb1.height === 650, JSON.stringify(cb1));
  const cfile = JSON.parse(readFileSync(join(data, 'window-bounds.json'), 'utf8'));
  check('채팅 창은 옮기지 않았으면 자리를 적지 않는다 (계속 펫 옆)', cfile.chat?.x === undefined, JSON.stringify(cfile.chat));
  await main('__jj.chat.window.close(); 1');
} catch (err) {
  fails.push(`중단: ${err instanceof Error ? err.stack : err}`);
  console.error(err);
} finally {
  await quit();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`\n통과 ${pass}, 실패 ${fails.length}`);
for (const f of fails) console.log('FAIL', f);
process.exit(fails.length ? 1 : 0);
