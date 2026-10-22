// 큰 창 점검 (이슈 #161, 큰 창 설계 #159).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/home.mjs
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 진짜 AI 는 부르지 않는다: PATH 는 /usr/bin:/bin 과 node 만 둔다. 끝나면 데이터 폴더를 지운다.
//
// 보는 것 (PASS/FAIL):
//   열기와 닫기: 펫 클릭(CDP 마우스)이 panelView 에 따라 작은 패널이나 큰 창을 연다, 큰 창이 열려 있으면 패널 보기와 상관없이 큰 창,
//     패널과 큰 창은 동시에 열리지 않는다(큰 창이 뜨면 패널이 닫힌다, 큰 창이 있으면 패널을 새로 안 연다),
//     탭을 정해 열기(오늘 탭 단추, 펫 메뉴 "상점")도 큰 창을 따른다, 닫으면 없어지고 숨기면 남는다,
//     숨긴 채 JJ_HOME_KEEP_MS 가 지나면 없어진다, 크기 하한 760x520, 닫았다 열면 크기 유지
//   Dock: JJ_NO_FOCUS 에서는 app.dock.show/hide 를 한 번도 안 부르고(__jj.dock.stats 의 shows, hides 가 0) 부르려 한 횟수(triedShow)만 센다,
//     열고 닫기를 빠르게 되풀이해도 오류 없이 끝난다. 아이콘이 실제로 뜨고 지는지는 scripts/dev/dock-probe.mjs 가 잰다
//   전체 화면: 큰 창이 전체 화면이 되면 펫의 "모든 데스크톱, 전체 화면 위" 설정을 다시 걸고, 풀리면 원래대로 건다 (창 호출을 가로채 확인.
//     진짜 전체 화면은 쓰는 사람의 화면에 새 데스크톱을 만들어 시험에서는 켜지 않는다)
//   화면: 폭 760/1040/1440 x 밝음/어두움 찍기와 가로 넘침, 구역마다, 사이드바(구역, 채팅과 친구는 따로 창, 설정), 단축키(Cmd+1~, Cmd+, Cmd+W),
//     빠른 입력으로 넣은 할 일이 큰 창에 바로 보임, 사이드바 체크와 설정 칸이 같은 panelView 를 바꿈
//   ko/en: 영어 화면에 한글 없음, "모드" 라는 낱말 없음
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-home');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const KEEP_MS = 3500;
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.home-test-'));
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
    JJ_HOME_KEEP_MS: String(KEEP_MS),
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
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      // 닫았다 다시 연 창은 새 id 다: 가장 나중 것을 쓴다
      const p = list.filter((x) => x.type === 'page' && x.url.includes(`${name}.html`)).at(-1);
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
        const mouse = (type, x, y) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
          });
        return {
          id: p.id,
          ev,
          send: c.send,
          clickAt: async (x, y) => {
            await mouse('mouseMoved', x, y);
            await mouse('mousePressed', x, y);
            await mouse('mouseReleased', x, y);
          },
          click: async (elExpr) => {
            const pos = await ev(
              `(() => { const e = (${elExpr}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
            );
            if (!pos) return false;
            await mouse('mouseMoved', pos.x, pos.y);
            await mouse('mousePressed', pos.x, pos.y);
            await mouse('mouseReleased', pos.x, pos.y);
            await sleep(250);
            return true;
          },
          type: (text) => c.send('Input.insertText', { text }),
          enter: () =>
            c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }),
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
          shot: async (file) => {
            await ev(
              `(() => { document.activeElement?.blur?.(); const s = document.createElement('style'); s.id = '__shot'; s.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.append(s); })()`,
            );
            await sleep(150);
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
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}

/** 키 이벤트를 창 전체에 보낸다 (숨은 창이라 CDP 키 입력 대신 같은 이벤트를 만든다) */
const keyEvent = (init) =>
  `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} })); return true; })()`;
const mod = { metaKey: true };
/**
 * 가로 넘침: 창 밖으로 나간 요소, 가로로 스크롤되는 칸(태그 칩 줄은 일부러 가로 스크롤), 쪽 가로 스크롤.
 * 오늘 탭 줄이 일부러 -6px 로 번지는 것처럼 칸 안에서 스크롤이 생기지 않는 번짐은 넘침이 아니다
 */
const overflow = (p) =>
  p
    .ev(`(() => {
    const out = [];
    for (const e of document.querySelectorAll('.surface.home *')) {
      if (e.closest('svg') || e.closest('.sr-only') || e.closest('[hidden]')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      if (r.right > innerWidth + 1) out.push('밖:' + e.tagName + '.' + e.className);
      else if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1 && !e.classList.contains('tag-chips'))
        out.push('가로 스크롤:' + e.tagName + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('쪽 가로 스크롤');
    return JSON.stringify([...new Set(out)].slice(0, 8));
  })()`)
    .then((s) => JSON.parse(s));

const homeAlive = () => main('!!__jj.home.window && !__jj.home.window.isDestroyed()');
const panelAlive = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()');
const dockStats = async () => JSON.parse(await main('JSON.stringify(__jj.dock.stats())'));
const setView = (v) => main(`__jj.settings.set({ panelView: '${v}' }); 1`);
const closeHome = async () => {
  if (await homeAlive()) await main('__jj.home.window.close(); 1');
  await sleep(500);
};
const closePanel = async () => {
  if (await panelAlive()) await main('__jj.panel.window.close(); 1');
  await sleep(400);
};
const sectionNow = (h) => h.ev(`document.getElementById('ptab-panel')?.getAttribute('aria-labelledby')`);
/** 펫을 CDP 마우스로 누른다 (진짜 마우스가 아니다) */
let petPage;
const clickPet = async () => {
  petPage ??= await page('pet');
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await petPage.send('Input.dispatchMouseEvent', {
      type,
      x: 80,
      y: 110,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    });
  await sleep(1500);
};

const body = async () => {
  await main('1');
  const NOW = await main('Date.now()');
  await sleep(1500);

  // ---- 시험 거리 ----
  const dayStart = await main('(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })()');
  const todayStr = await main(
    '(() => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()',
  );
  for (const [title, extra] of [
    [tx('메일 답장', 'Reply to mail'), { due: todayStr }],
    [tx('보고서 쓰기', 'Write the report'), { important: true }],
    [tx('장보기', 'Groceries'), {}],
  ])
    await main(`__jj.store.add({ title: ${JSON.stringify(title)}, ...${JSON.stringify(extra)} }, ${NOW}); 1`);
  await main(
    `__jj.events.add({ title: ${JSON.stringify(tx('치과', 'Dentist'))}, startAt: ${dayStart + 86_400_000 + 10 * 3_600_000}, reminds: [] }, ${NOW}); 1`,
  );
  await main(
    `__jj.notes.add({ title: ${JSON.stringify(tx('장보기 목록', 'Shopping list'))}, body: ${JSON.stringify(tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'))} }, ${NOW}); 1`,
  );

  // ===================== 1. 처음 상태와 Dock =====================
  let st = await dockStats();
  check('처음: 큰 창 없음, 패널 없음', !(await homeAlive()) && !(await panelAlive()));
  check('처음: Dock 은 안 불렀다 (show 0, hide 0, 부르려 한 횟수 0)', st.shows === 0 && st.hides === 0 && st.triedShow === 0, JSON.stringify(st));
  check('처음: 설정 panelView 는 compact', (await main('__jj.settings.get().panelView')) === 'compact');
  check('처음: 큰 창 열기 단축키는 비어 있다', (await main('__jj.settings.get().shortcuts.home')) === '');

  // ===================== 2. 펫 클릭이 여는 것 =====================
  await clickPet();
  check('compact: 펫 클릭은 작은 패널을 연다', (await panelAlive()) && !(await homeAlive()));
  await clickPet();
  check('compact: 다시 누르면 패널이 닫힌다', !(await panelAlive()));

  await setView('window');
  await sleep(300);
  await clickPet();
  check('window: 펫 클릭은 큰 창을 연다 (패널은 안 연다)', (await homeAlive()) && !(await panelAlive()));
  st = await dockStats();
  check(
    'window: Dock 은 부르려 했다만 센다 (shows 0, hides 0, triedShow >= 1), 아이콘은 안 뜬다',
    st.shows === 0 && st.hides === 0 && st.triedShow >= 1 && st.visible !== true,
    JSON.stringify({ shows: st.shows, hides: st.hides, tried: st.triedShow, visible: st.visible }),
  );
  check('window: 큰 창은 항상 위가 아니고 일반 프레임이다', await main(`(() => { const w = __jj.home.window; return !w.isAlwaysOnTop() && w.isResizable() && w.isMaximizable() && w.isFullScreenable(); })()`));
  check('window: 큰 창 면이 알려졌다 (보이는 면은 큰 창)', await main('__jj.panel.activeSurface() === __jj.home.window'));

  // 큰 창이 맨 앞(포커스)이면 다시 눌러 숨긴다. 시험 실행은 포커스를 주지 않아 isFocused 를 흉내 낸다
  await main('__jj.home.window.isFocused = () => true; 1');
  await clickPet();
  let look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('맨 앞에서 다시 누르면 숨긴다 (창은 살아 있다)', look.alive && look.hidden && (await main('!__jj.home.window.isVisible()')));
  await main('delete __jj.home.window.isFocused; 1');
  await clickPet();
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('숨긴 뒤 누르면 같은 창이 다시 뜬다', look.alive && !look.hidden && (await main('__jj.home.window.isVisible()')));
  await sleep(300);
  await clickPet();
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('뒤에 있으면(포커스 없음) 누르기는 앞으로 가져올 뿐 숨기지 않는다', look.alive && !look.hidden);

  // 패널 보기가 compact 여도 큰 창이 열려 있으면 큰 창
  await setView('compact');
  await sleep(300);
  await clickPet();
  check('compact 여도 큰 창이 열려 있으면 펫 클릭은 큰 창 (패널 안 열림)', (await homeAlive()) && !(await panelAlive()));
  await main('__jj.panel.togglePanel(); 1');
  await sleep(600);
  check('패널 단축키(togglePanel)도 큰 창이 열려 있으면 패널을 새로 안 연다', !(await panelAlive()) && (await homeAlive()));
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(800);
  let h = await page('home');
  check('탭을 정해 열면(할 일) 큰 창이 그 구역으로, 패널은 안 열림', !(await panelAlive()) && (await sectionNow(h)) === 'ptab-todo');

  // ===================== 3. 패널과 큰 창은 동시에 열리지 않는다 =====================
  await closeHome();
  check('닫으면 큰 창이 없어진다 (창 객체가 사라진다)', !(await homeAlive()));
  await main('__jj.panel.togglePanel(); 1');
  await sleep(1500);
  check('compact: 큰 창 없이 togglePanel 은 패널', (await panelAlive()) && !(await homeAlive()));
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  await main('__jj.home.open(); 1');
  check('작은 패널이 열려 있는데 큰 창을 열면 패널이 닫힌다 (큰 창이 보인 뒤)', await waitFor(async () => !(await panelAlive()) && (await homeAlive())));

  // ===================== 4. 크기 하한과 기억 =====================
  h = await page('home');
  await main('__jj.home.window.setSize(500, 400); 1');
  await sleep(500);
  const small = JSON.parse(await main('JSON.stringify(__jj.home.window.getBounds())'));
  check('크기 하한: 500x400 으로 줄여도 760x520 아래로 안 내려간다', small.width >= 760 && small.height >= 520, `${small.width}x${small.height}`);
  await main('__jj.home.window.setSize(900, 640); 1');
  await sleep(600);
  await closeHome();
  await main('__jj.home.open(); 1');
  await waitFor(homeAlive);
  await sleep(600);
  const again = JSON.parse(await main('JSON.stringify(__jj.home.window.getBounds())'));
  check('닫았다 열어도 크기를 기억한다 (900x640)', again.width === 900 && again.height === 640, `${again.width}x${again.height}`);
  const firstOpen = JSON.parse(readFileSync(join(data, 'window-bounds.json'), 'utf8'));
  check('window-bounds.json 에 home 크기가 적힌다', firstOpen.home?.width === 900 && firstOpen.home?.height === 640);

  // ===================== 5. 숨기기, 10분 뒤 없애기 =====================
  await main('__jj.home.hide(); 1');
  await sleep(300);
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('숨기기: 창은 살아 있고 보이지 않는다', look.alive && look.hidden && (await main('!__jj.home.window.isVisible()')));
  const t0 = Date.now();
  const gone = await waitFor(async () => !(await homeAlive()), KEEP_MS + 4000);
  const waited = Date.now() - t0;
  check(`숨긴 채 ${KEEP_MS}ms(시험용) 지나면 없어진다`, gone && waited >= KEEP_MS - 400, `${waited}ms`);
  // 숨겼다 다시 열면 없애기 타이머가 취소된다
  await main('__jj.home.open(); 1');
  await waitFor(homeAlive);
  await sleep(500);
  await main('__jj.home.hide(); 1');
  await sleep(1200);
  await main('__jj.home.open(); 1');
  await sleep(KEEP_MS + 1500);
  check('숨겼다 시간 안에 다시 열면 없어지지 않는다', await homeAlive());

  // ===================== 6. 빠르게 열고 닫기 =====================
  const before = await dockStats();
  let ok = true;
  try {
    for (let i = 0; i < 6; i++) {
      await main('__jj.home.hide(); 1');
      await sleep(60);
      await main('__jj.home.open(); 1');
      await sleep(60);
    }
    await main('__jj.home.window.close(); 1');
    await sleep(60);
    await main('__jj.home.open(); 1');
    await sleep(60);
    await main('__jj.home.window.close(); 1');
  } catch {
    ok = false;
  }
  await sleep(1200);
  const afterQuick = await dockStats();
  check('빠르게 열고 닫기 7번: 오류 없이 끝나고 창이 없다', ok && !(await homeAlive()));
  check(
    '빠르게 열고 닫기: Dock 호출 0번, 부르려 한 횟수만 늘었다, 원하는 상태는 꺼짐',
    afterQuick.shows === 0 && afterQuick.hides === 0 && afterQuick.triedShow > before.triedShow && afterQuick.want === false && afterQuick.visible !== true,
    JSON.stringify({ tried: afterQuick.triedShow, want: afterQuick.want }),
  );

  // ===================== 7. 전체 화면: 펫의 설정을 다시 건다 =====================
  await main('__jj.home.open(); 1');
  await waitFor(homeAlive);
  await sleep(600);
  await main(`(() => {
    const w = __jj.pet.win;
    globalThis.__spaceCalls = [];
    const orig = w.setVisibleOnAllWorkspaces.bind(w);
    w.setVisibleOnAllWorkspaces = (flag, opts) => { globalThis.__spaceCalls.push({ flag, ...opts }); return orig(flag, opts); };
    return 1;
  })()`);
  await main("__jj.home.window.emit('enter-full-screen'); 1");
  await sleep(200);
  let calls = JSON.parse(await main('JSON.stringify(globalThis.__spaceCalls)'));
  check(
    '큰 창이 전체 화면이 되면 펫 창을 전체 화면 위에도 보이게 다시 건다 (앱 종류는 그대로)',
    calls.at(-1)?.flag === true && calls.at(-1)?.visibleOnFullScreen === true && calls.at(-1)?.skipTransformProcessType === true,
    JSON.stringify(calls.at(-1)),
  );
  await main("__jj.home.window.emit('leave-full-screen'); 1");
  await sleep(200);
  calls = JSON.parse(await main('JSON.stringify(globalThis.__spaceCalls)'));
  check(
    '전체 화면이 풀리면 원래대로(다른 앱 전체 화면 위에는 안 올라감) 다시 건다',
    calls.at(-1)?.flag === true && calls.at(-1)?.visibleOnFullScreen === false && calls.at(-1)?.skipTransformProcessType === true,
    JSON.stringify(calls.at(-1)),
  );
  check('큰 창이 전체 화면이 아니면 isFullScreen 은 거짓', (await main('__jj.home.isFullScreen()')) === false);

  // ===================== 8. 화면: 사이드바, 구역, 단축키 =====================
  h = await page('home');
  await setView('window');
  await sleep(400);
  await main('__jj.home.window.setBounds({ x: 40, y: 40, width: 1040, height: 720 }); 1');
  await sleep(700);
  h = await page('home');
  const navNames = await h.ev(`[...document.querySelectorAll('.home-nav button .name')].map((e) => e.textContent).join('|')`);
  check(
    '사이드바 구역 순서 (친구는 꺼져 있으면 없음)',
    navNames === tx('오늘|할 일|일정|메모|채팅|상점', 'Today|To-dos|Events|Notes|Chat|Shop'),
    navNames,
  );
  check('사이드바 머리: 이름, 코인, 배부름 줄', await h.ev(`!!document.querySelector('.home-head strong') && !!document.querySelector('.home-head .coins') && !!document.querySelector('.home-fullness .track')`));
  check('사이드바 바닥: 체크와 설정 단추', await h.ev(`!!document.querySelector('.home-foot .home-check input') && !!document.querySelector('.home-settings')`));
  check('바닥 체크는 panelView 를 따른다 (window 면 켜짐)', await h.ev(`document.querySelector('.home-check input').checked`));
  check('지금 구역 표시 (aria-current)', await h.ev(`document.querySelector('.home-nav button[aria-current="page"]')?.id`) !== null);

  // 구역 옮기기: 단추와 Cmd+숫자
  for (const [id, label] of [
    ['today', 'today'],
    ['todo', 'todo'],
    ['event', 'event'],
    ['note', 'note'],
    ['shop', 'shop'],
  ]) {
    await h.click(`document.getElementById('ptab-${id}')`);
    await sleep(350);
    check(`구역 단추: ${label}`, (await sectionNow(h)) === `ptab-${id}` && (await h.ev(`document.getElementById('ptab-${id}').getAttribute('aria-current')`)) === 'page');
  }
  await h.ev(keyEvent({ ...mod, key: '2', code: 'Digit2' }));
  await sleep(300);
  check('Cmd+2 는 할 일', (await sectionNow(h)) === 'ptab-todo');
  await h.ev(keyEvent({ ...mod, key: '3', code: 'Digit3' }));
  await sleep(300);
  check('Cmd+3 은 일정', (await sectionNow(h)) === 'ptab-event');
  await h.ev(keyEvent({ ...mod, key: '6', code: 'Digit6' }));
  await sleep(300);
  check('Cmd+6 은 상점', (await sectionNow(h)) === 'ptab-shop');
  await h.ev(keyEvent({ ...mod, key: '7', code: 'Digit7' }));
  await sleep(300);
  check('Cmd+7 은 친구가 꺼져 있으면 아무 일도 없다', (await sectionNow(h)) === 'ptab-shop');

  // 채팅과 설정은 따로 창, 큰 창은 그대로
  await h.click(`document.getElementById('ptab-chat')`);
  check('사이드바 채팅은 채팅 창을 연다 (큰 창은 그대로 열려 있다)', (await waitFor(async () => main('!!__jj.chat.window && !__jj.chat.window.isDestroyed()'))) && (await homeAlive()));
  await h.click(`document.querySelector('.home-settings')`);
  check('사이드바 설정은 설정 창을 연다 (큰 창은 그대로)', (await waitFor(async () => main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()'))) && (await homeAlive()));
  await main('__jj.chat.window?.close(); __jj.settingsWindow.window?.close(); 1');
  await sleep(500);
  await h.ev(keyEvent({ ...mod, key: ',', code: 'Comma' }));
  check('Cmd+, 는 설정 창', await waitFor(async () => main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()')));
  await main('__jj.settingsWindow.window?.close(); 1');
  await sleep(400);

  // 친구: 서버 모드, 로그인, 기능 키가 켜졌을 때만 보인다 (메인의 friendsAvailable 을 손잡이로 켠다)
  await main('__jj.debugFriendsOn(true); 1');
  check('친구 기능이 켜지면 사이드바에 "친구" 가 생긴다 (일곱째)', await h.until(async () => (await h.ev(`[...document.querySelectorAll('.home-nav button .name')].map((e) => e.textContent).at(-1)`)) === tx('친구', 'Friends'), 4000));
  await h.ev(keyEvent({ ...mod, key: '7', code: 'Digit7' }));
  check('Cmd+7 은 친구: 설정 창의 친구 칸을 연다 (큰 창은 그대로)', (await waitFor(async () => main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()'))) && (await homeAlive()));
  await main('__jj.settingsWindow.window?.close(); 1');
  await sleep(400);
  await main('__jj.debugFriendsOn(false); 1');
  check('친구 기능이 꺼지면 다시 사라진다', await h.until(async () => !(await h.ev(`[...document.querySelectorAll('.home-nav button .name')].some((e) => e.textContent === ${JSON.stringify(tx('친구', 'Friends'))})`)), 4000));

  // 빠른 입력으로 넣은 할 일이 큰 창에 바로 보인다
  await h.click(`document.getElementById('ptab-todo')`);
  await sleep(400);
  await main('__jj.panel.openQuick(); 1');
  await sleep(1500);
  const q = await page('quick');
  await q.ev(`document.querySelector('input').focus()`);
  const quickTitle = tx('빠른 입력 큰창 확인', 'Quick add shows in home');
  await q.type(quickTitle);
  await q.enter();
  check(
    '빠른 입력으로 넣은 할 일이 큰 창 목록에 바로 보인다',
    await h.until(async () => (await h.ev(`document.querySelector('.panel-tabpanel')?.innerText ?? ''`)).includes(quickTitle), 6000),
  );
  await main('__jj.panel.quickWindow?.close(); 1');
  await sleep(400);

  // 큰 창 안에서 할 일 넣기
  await h.ev(`document.querySelector('.add input')?.focus()`);
  const inHome = tx('큰 창에서 넣은 일', 'Added in home');
  await h.type(inHome);
  await h.enter();
  check('큰 창 입력칸에서 할 일을 넣으면 목록에 생긴다', await h.until(async () => (await main(`JSON.stringify(__jj.store.list(Date.now()).open.map((t) => t.title))`)).includes(inHome), 6000));

  // 사이드바 체크와 설정 칸이 같은 값을 바꾼다
  await h.click(`document.querySelector('.home-check input')`);
  await sleep(600);
  check('사이드바 체크를 끄면 panelView 가 compact', (await main('__jj.settings.get().panelView')) === 'compact');
  check('체크 상태가 화면에도 따라온다 (꺼짐)', await h.until(async () => !(await h.ev(`document.querySelector('.home-check input').checked`)), 4000));
  await h.click(`document.querySelector('.home-check input')`);
  await sleep(500);
  check('다시 켜면 window', (await main('__jj.settings.get().panelView')) === 'window');

  // 설정 창의 칸
  await main("__jj.settingsWindow.open(); 1");
  await sleep(2000);
  const sp = await page('settings');
  await sp.click(`document.getElementById('tab-ease')`);
  await sleep(500);
  const seg = tx('작은 패널', 'Small panel');
  check('설정 편의 탭에 "패널 보기" 칸 (작은 패널 / 큰 창)', await sp.ev(`[...document.querySelectorAll('fieldset.segmented button')].some((b) => b.textContent === ${JSON.stringify(seg)})`));
  await sp.click(`[...document.querySelectorAll('fieldset.segmented button')].find((b) => b.textContent === ${JSON.stringify(seg)})`);
  await sleep(500);
  check('설정 칸에서 작은 패널을 고르면 panelView 가 compact', (await main('__jj.settings.get().panelView')) === 'compact');
  check('사이드바 체크가 따라 꺼진다', await h.until(async () => !(await h.ev(`document.querySelector('.home-check input').checked`)), 4000));
  await sp.click(`[...document.querySelectorAll('fieldset.segmented button')].find((b) => b.textContent === ${JSON.stringify(tx('큰 창', 'Large window'))})`);
  await sleep(500);
  check('큰 창을 고르면 window', (await main('__jj.settings.get().panelView')) === 'window');
  await sp.shot('settings-panel-view');
  await main('__jj.settingsWindow.window?.close(); 1');
  await sleep(400);

  // ===================== 9. 화면 찍기: 폭 x 밝음/어두움 =====================
  await closeHome();
  await main("__jj.home.open('today'); 1");
  await waitFor(homeAlive);
  await sleep(1200);
  h = await page('home');
  for (const w of [760, 1040, 1440]) {
    await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: 760 }); 1`);
    await sleep(700);
    for (const [id] of [['today'], ['todo'], ['event'], ['note'], ['shop']]) {
      await h.click(`document.getElementById('ptab-${id}')`);
      await sleep(400);
      for (const dark of [false, true]) {
        await h.dark(dark);
        await sleep(200);
        await h.shot(`home-${id}-w${w}-${dark ? 'dark' : 'light'}`);
        const over = await overflow(h);
        check(`가로 넘침 없음: ${id} 폭 ${w} ${dark ? '어두움' : '밝음'}`, over.length === 0, over.join(', '));
      }
      await h.dark(false);
    }
    const zone = await h.ev(`document.getElementById('ptab-panel').dataset.zone`);
    const want = w >= 1068 ? 'wide' : 'medium';
    check(`본문 칸 구간: 폭 ${w} 은 ${want}`, zone === want, zone);
  }
  if (!ko) {
    const hangul = await h.ev(`/[\\u3131-\\u318e\\uac00-\\ud7a3]/.test(document.querySelector('.home-side').innerText) ? document.querySelector('.home-side').innerText : ''`);
    check('영어 화면 사이드바에 한글이 없다', hangul === '', hangul.slice(0, 40));
  }
  const sideText = await h.ev(`document.querySelector('.home-side').innerText`);
  check('사이드바에 "모드" 라는 낱말이 없다', !/모드|\bmode\b/i.test(sideText), sideText.slice(0, 60).replace(/\n/g, ' '));

  // 글 크기 1.5배(큰 글씨)에서도 넘치지 않는다
  await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 1040, height: 760 }); 1');
  await sleep(500);
  await main('__jj.home.window.webContents.setZoomFactor(1.5); 1');
  await sleep(600);
  const overBig = await overflow(h);
  check('글 크기 1.5배, 폭 1040: 가로 넘침 없음', overBig.length === 0, overBig.join(', '));
  await h.shot('home-zoom15-w1040');
  await main('__jj.home.window.webContents.setZoomFactor(1); 1');

  // ===================== 10. Cmd+W 로 닫기 =====================
  await h.ev(keyEvent({ ...mod, key: 'w', code: 'KeyW' }));
  check('Cmd+W 는 큰 창을 닫는다 (앱은 계속 돈다)', await waitFor(async () => !(await homeAlive())) && (await main('!!__jj.pet.win && !__jj.pet.win.isDestroyed()')));

  // ===================== 11. 끝 =====================
  const fin = await dockStats();
  check('끝까지 Dock 을 한 번도 부르지 않았다 (JJ_NO_FOCUS)', fin.shows === 0 && fin.hides === 0, JSON.stringify({ shows: fin.shows, hides: fin.hides }));
  await setView('compact');
};

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

try {
  await body();
} catch (err) {
  check('시험이 끝까지 돌았다', false, err instanceof Error ? err.stack : String(err));
} finally {
  await cleanup();
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
