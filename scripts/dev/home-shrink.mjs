// 큰 창의 "작게 보기" 단추 점검 (사용자 피드백: 작은 패널로 돌아가는 길을 찾기 힘들다).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/home-shrink.mjs
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 보는 것 (PASS/FAIL): 사이드바 머리 아래에 단추가 보임(글, 아이콘, 풀이 ko/en, 폭 760/1100/1440 넘침 없음, 밝음/어두움 찍기),
//   누르면 큰 창이 숨고 작은 패널이 같은 구역으로 뜸, 패널 보기가 작은 패널로 바뀜, 사이드바 체크 문구
//   ("펫을 누르면 큰 창으로 열기"), 영어 화면에 한글 없음.
// 검출력: 단추의 shrink 호출을 빼면 "누르면 패널" 이 실패한다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-home-shrink');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.home-shrink-'));
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
        const ev = async (expr, ms) => {
          const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ms);
          if (r.result?.exceptionDetails)
            throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
          return r.result?.result?.value;
        };
        const mouse = (type, x, y, extra = {}) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left',
            buttons: type === 'mousePressed' ? 1 : (extra.buttons ?? 0),
            clickCount: 1,
          });
        return {
          id: p.id,
          ev,
          send: c.send,
          mouse,
          click: async (elExpr) => {
            const shown = await ev(`(() => { const e = (${elExpr}); if (!e) return false; e.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
            if (!shown) return false;
            await sleep(150);
            const pos = await ev(
              `(() => { const e = (${elExpr}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
            );
            if (!pos) return false;
            await mouse('mouseMoved', pos.x, pos.y);
            await mouse('mousePressed', pos.x, pos.y);
            await mouse('mouseReleased', pos.x, pos.y);
            await sleep(250);
            return true;
          },
          type: (text) => c.send('Input.insertText', { text }),
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
          shot: async (file, clip) => {
            await ev(
              `(() => { document.activeElement?.blur?.(); const s = document.createElement('style'); s.id = '__shot'; s.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.append(s); })()`,
            );
            await sleep(150);
            const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
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
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
}

// ---- 공통 ----
const alive = (w) => main(`(() => { const w = __jj.${w}.window; return !!w && !w.isDestroyed(); })()`);
const homeAlive = () => alive('home');
const panelAlive = () => alive('panel');
const homeShown = () => main('(() => { const w = __jj.home.window; return !!w && !w.isDestroyed() && w.isVisible(); })()');
const closeAll = async () => {
  await main(`(() => { for (const w of [__jj.home.window, __jj.panel.window]) if (w && !w.isDestroyed()) w.close(); return 1; })()`);
  await waitFor(async () => !(await homeAlive()) && !(await panelAlive()));
  await sleep(300);
};
const overflow = (p, root) =>
  p
    .ev(`(() => {
    const out = [];
    for (const e of document.querySelectorAll('${root} *')) {
      if (e.closest('svg') || e.closest('.sr-only') || e.closest('[hidden]')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > innerWidth + 1) out.push('밖:' + e.tagName + '.' + e.className);
    }
    return JSON.stringify([...new Set(out)].slice(0, 8));
  })()`)
    .then((s) => JSON.parse(s));

// ---- 시험 ----
try {
  await waitFor(async () => (await main('typeof __jj').catch(() => 'undefined')) === 'object', 60000);
  const openHome = async (tab = 'todo', w = 1100) => {
    await closeAll();
    await main(`__jj.settings.set({ panelView: 'window' }); __jj.home.open('${tab}'); 1`);
    await waitFor(homeShown);
    await main(`__jj.home.window.setSize(${w}, 720); 1`);
    await sleep(500);
    return page('home');
  };

  // 1. 단추가 보인다
  let h = await openHome('todo');
  const btn = `document.querySelector('.home-shrink')`;
  const info = await h.ev(`(() => { const b = ${btn}; if (!b) return null; const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), title: b.title, w: r.width, h: r.height, svg: !!b.querySelector('svg') }; })()`);
  check('사이드바에 작게 보기 단추가 있다', !!info && info.svg && info.w > 100 && info.h > 20, JSON.stringify(info));
  check('단추 글', info?.text === tx('작게 보기', 'Small view'), info?.text);
  check('단추 풀이', (info?.title ?? '').includes(tx('작은 패널', 'small panel')), info?.title);
  const chk = await h.ev(`document.querySelector('.home-check span').textContent`);
  check('체크 문구가 큰 창을 말한다', chk === tx('펫을 누르면 큰 창으로 열기', 'Open the large window when I click the fairy'), chk);
  const body = await h.ev('document.body.innerText');
  if (!ko) check('영어 화면에 한글 없음', !/[가-힣]/.test(body));
  check('"모드" 낱말 없음', !body.includes('모드'));

  // 2. 폭마다 넘침 없음, 밝음/어두움 찍기
  for (const w of [760, 1100, 1440]) {
    h = await openHome('todo', w);
    const of = await overflow(h, '.home-side');
    const inside = await h.ev(
      `(() => { const b = ${btn}.getBoundingClientRect(), s = document.querySelector('.home-side').getBoundingClientRect(); return b.left >= s.left && b.right <= s.right; })()`,
    );
    check(`폭 ${w} 단추가 사이드바 안, 넘침 없음`, inside && of.length === 0, JSON.stringify(of));
    for (const dark of [false, true]) {
      await h.dark(dark);
      if (w !== 1440) await h.shot(`shrink-${w}-${dark ? 'dark' : 'light'}`);
    }
    await h.dark(false);
  }

  // 3. 누르면: 큰 창 숨김, 패널이 같은 구역으로, 패널 보기가 작은 패널로
  for (const tab of ['todo', 'note']) {
    h = await openHome(tab);
    check(`(${tab}) 단추를 눌렀다`, await h.click(btn));
    check(`(${tab}) 큰 창이 숨는다`, await waitFor(async () => !(await homeShown())));
    check(`(${tab}) 작은 패널이 뜬다`, await waitFor(panelAlive));
    const view = await main('__jj.settings.get().panelView');
    check(`(${tab}) 패널 보기가 작은 패널로`, view === 'compact', String(view));
    const p = await page('panel');
    await sleep(500);
    const cur = await p.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.id.replace('ptab-','') ?? ''`);
    if (tab === 'todo') await p.shot('shrink-panel');
    check(`(${tab}) 같은 구역`, cur === tab, cur);
  }

  // 3-2. 기록 구역에서 누르면 작은 패널에 없는 구역이라 오늘로
  h = await openHome('records');
  await h.click(btn);
  await waitFor(panelAlive);
  const pr = await page('panel');
  await sleep(500);
  const curR = await pr.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.id.replace('ptab-','') ?? ''`);
  check('(records) 기록에서 누르면 오늘 탭', curR === 'today', curR);

  // 4. 돌아간 뒤 펫 누르기는 패널을 닫는다 (큰 창이 다시 뜨지 않는다)
  await main('__jj.panel.togglePanel(); 1');
  await sleep(500);
  check('펫을 누르면 큰 창이 아니라 패널이 닫힌다', !(await panelAlive()) && !(await homeShown()));
  await main('__jj.panel.togglePanel(); 1');
  await sleep(600);
  check('다시 누르면 작은 패널이 뜬다', (await panelAlive()) && !(await homeShown()));
} catch (err) {
  console.log('FAIL 예외', err.message);
  results.push({ name: '예외', ok: false });
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  await cleanup();
  process.exit(failed.length ? 1 : 0);
}
