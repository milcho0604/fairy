// 기록 화면 다듬기 시험: 집중 달력 칸의 분 숫자는 기본 숨김("자세히 보기"로 펼침, 기억), 칸의 색 단계와 툴팁/읽기 글은 그대로,
// 머리줄과 간격, 넓은 창 두 열을 ko/en, 좁음/넓음, 밝음/어두움으로 찍어 본다.
//
//   npm run build && OUT=<레포 밖 폴더> TAG=after LANG_UNDER_TEST=ko JJ_INSPECT_PORT=9950 JJ_PAGE_PORT=9951 node scripts/dev/records-tidy.mjs
//
// TAG=before 는 옛 화면을 찍기만 한다(확인 없음). 시험 규칙은 records.mjs 와 같다: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA, 입력은 CDP 로만.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-records-tidy');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const TAG = process.env.TAG ?? 'after';
const AFTER = TAG !== 'before';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9950);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9951);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ko = LANG === 'ko';
const tx = (a, b) => (ko ? a : b);
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.records-tidy-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi') }));
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
console.log('app pid', app.pid, 'lang', LANG, 'tag', TAG);
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
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          clearTimeout(timer);
          ws.removeEventListener('message', h);
          r(m);
        }
      };
      const timer = setTimeout(() => {
        ws.removeEventListener('message', h);
        j(new Error(`CDP 답 없음: ${method}`));
      }, 60_000);
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
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        await c.send('Page.enable');
        const ev = async (expr) => {
          const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
          return r.result?.result?.value;
        };
        const mouse = (type, x, y) =>
          c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
        const api = {
          ev,
          click: async (elExpr) => {
            const p2 = await ev(
              `(async () => { const e = (${elExpr}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
            );
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await mouse('mousePressed', p2.x, p2.y);
            await mouse('mouseReleased', p2.x, p2.y);
            await sleep(200);
            return true;
          },
          dark: (on) => c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }),
          shot: async (file, tall) => {
            // 본문이 안쪽 스크롤 칸이라 창 키를 잠깐 늘려 전부 보이게 찍는다
            const w = await ev('innerWidth');
            if (tall) {
              await main(`__jj.home.window.setBounds({ x: 40, y: 40, width: ${w}, height: 1500 }); 1`);
              await sleep(500);
            }
            const clip = await ev(`(() => { const r = document.querySelector('.surface.home').getBoundingClientRect(); const sc = document.querySelector('.records-tab'); const need = sc.scrollHeight - sc.clientHeight; return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, r.height - (sc.clientHeight - sc.scrollHeight > 0 ? sc.clientHeight - sc.scrollHeight : 0)) }; })()`);
            const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1.5 } });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
            if (tall) {
              await main(`__jj.home.window.setBounds({ x: 40, y: 40, width: ${w}, height: 760 }); 1`);
              await sleep(400);
            }
          },
          shots: async (file, tall) => {
            await api.dark(false);
            await sleep(150);
            await api.shot(`${file}-light`, tall);
            await api.dark(true);
            await sleep(150);
            await api.shot(`${file}-dark`, tall);
            await api.dark(false);
            await sleep(100);
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

async function seed() {
  const today = await main(`new Date().toLocaleDateString('sv-SE')`);
  const [y, m, d] = today.split('-').map(Number);
  // 이번 달 지난 날에 날마다 다른 집중 분, 지난달에도 몇 날
  const mins = [25, 50, 75, 130, 20, 90, 45, 160, 60, 35, 110, 15];
  const stamps = [];
  for (let i = 0; i < 12; i++) {
    const dt = new Date(y, m - 1, d - i * 2 - (d > 3 ? 0 : 0), 9 + (i % 5), 0);
    stamps.push([dt.getTime(), mins[i]]);
  }
  await main(`(() => { const s = __jj.stats; for (const [t, mm] of ${JSON.stringify(stamps)}) s.addFocus(t, mm); return 1; })()`);
  const titles = ['issue 1', 'issue 2', 'issue 3', 'issue 4', 'issue 5'].map((x) => tx(`할 일 ${x.slice(-1)}`, `Task ${x.slice(-1)}`));
  await main(`(() => { for (const title of ${JSON.stringify(titles)}) { const t = __jj.store.add({ title }, Date.now()); if (title.endsWith('1') || title.endsWith('2') || title.endsWith('3')) __jj.store.complete(t.id, Date.now()); } return 1; })()`);
  await main(`(() => { const l = __jj.store.list(Date.now()).open; for (const t of l.slice(0, 2)) __jj.store.remove(t.id, Date.now()); return 1; })()`);
  await main('__jj.panel.refresh(); 1');
  return today;
}

async function openHome(w) {
  await main("__jj.home.open('records'); 1");
  for (let i = 0; i < 40 && !(await main('!!__jj.home.window && !__jj.home.window.isDestroyed()')); i++) await sleep(200);
  await sleep(1200);
  await main(`__jj.home.window.setBounds({ x: 40, y: 40, width: ${w}, height: 760 }); 1`);
  await sleep(900);
  const hw = await page('home');
  await hw.until(() => hw.ev(`!!document.querySelector('.fm-cell')`));
  return hw;
}
const closeHome = async () => {
  await main('__jj.home.window.close(); 1');
  await sleep(600);
};

let code = 0;
try {
  await main('1');
  await sleep(1500);
  const today = await seed();
  const cellsInfo = (hw) => hw.ev(`[...document.querySelectorAll('.fm-cell:not(.future)')].map((c) => ({ cls: c.className, min: c.querySelector('.fm-m')?.textContent ?? null, label: c.getAttribute('aria-label'), title: c.title }))`);
  const hasToggle = (hw) => hw.ev(`!!document.querySelector('.fm-detail-toggle')`);

  for (const width of [1100, 760]) {
    const hw = await openHome(width);
    const nofit = await hw.ev(`[...document.querySelectorAll('.records-tab *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1) || document.documentElement.scrollWidth > innerWidth`);
    if (AFTER) check(`${width}: 가로 넘침 없음`, !nofit);
    if (!AFTER) {
      await hw.shots(`${TAG}-${LANG}-${width}`, true);
    } else {
      // 기본: 분 숫자 숨김, 단추 접힘
      const btn = `document.querySelector('.fm-detail-toggle')`;
      check(`${width}: 자세히 보기 단추가 있고 접힌 채 (aria-expanded=false)`, (await hw.ev(`${btn}?.getAttribute('aria-expanded')`)) === 'false');
      check(`${width}: 단추 이름이 "${tx('자세히 보기', 'Show details')}"`, (await hw.ev(`${btn}?.textContent.trim()`)) === tx('자세히 보기', 'Show details'));
      let cells = await cellsInfo(hw);
      check(`${width}: 접히면 칸에 분 숫자가 없다`, cells.every((c) => c.min === null));
      const lv = cells.filter((c) => /lv[1-4]/.test(c.cls));
      check(`${width}: 숨겨도 색 단계(lv1~4)와 읽기 글, 툴팁이 같다`, lv.length >= 8 && lv.every((c) => c.label && c.title === c.label && /\d/.test(c.label)), `${lv.length}칸`);
      const levels = new Set(lv.map((c) => c.cls.match(/lv[1-4]/)[0]));
      check(`${width}: 시험 데이터가 네 단계 모두 있다`, levels.size === 4, [...levels].join(','));
      const bodyFold = await hw.ev(`getComputedStyle(document.querySelector('.fm-grid')).display`);
      await hw.shots(`${TAG}-${LANG}-${width}-folded`, true);
      // 펼치기
      await hw.click(btn);
      check(`${width}: 누르면 aria-expanded=true, 이름이 "${tx('접기', 'Hide details')}"`, (await hw.ev(`${btn}.getAttribute('aria-expanded')`)) === 'true' && (await hw.ev(`${btn}.textContent.trim()`)) === tx('접기', 'Hide details'));
      cells = await cellsInfo(hw);
      const withFocus = cells.filter((c) => /lv[1-4]/.test(c.cls));
      check(`${width}: 펼치면 집중한 칸마다 분 숫자가 보인다`, withFocus.every((c) => c.min && /^\d+$/.test(c.min)), `${withFocus.length}칸`);
      check(`${width}: 펼쳐도 분 숫자가 칸 밖으로 넘치지 않는다`, !(await hw.ev(`[...document.querySelectorAll('.fm-cell')].some((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1)`)));
      await hw.shots(`${TAG}-${LANG}-${width}-open`, true);
      // 기억: 창을 닫았다 열어도 펼침
      await closeHome();
      const hw2 = await openHome(width);
      check(`${width}: 창을 닫았다 열어도 펼침이 기억된다`, (await hw2.ev(`${btn}.getAttribute('aria-expanded')`)) === 'true' && (await cellsInfo(hw2)).some((c) => c.min));
      // 접기로 되돌려 다음 폭 시험이 기본에서 시작
      await hw2.click(btn);
      check(`${width}: 접으면 다시 숨고 기억도 접힘`, (await cellsInfo(hw2)).every((c) => c.min === null) && (await hw2.ev(`localStorage.getItem('jj.records.focusDetail')`)) === '0');
      // 키보드로도 되는 단추인지: 진짜 button 이고 탭 순서에 있다
      check(`${width}: 단추는 button 이고 탭으로 닿는다`, await hw2.ev(`${btn}.tagName === 'BUTTON' && ${btn}.tabIndex >= 0`));
      // 날짜를 누르면 접힌 채여도 아래에 그날 분이 나온다
      await hw2.click(`document.querySelector('.fm-cell.lv3, .fm-cell.lv4')`);
      check(`${width}: 접힌 채 날짜를 누르면 그날 기록이 아래에 나온다`, /\d/.test(await hw2.ev(`document.querySelector('.fm-detail').innerText`)));
      await closeHome();
      continue;
    }
    await closeHome();
  }
  void today;
} catch (e) {
  console.log('ERROR', e?.message ?? e);
  code = 1;
} finally {
  await cleanup();
}
if (results.some((r) => !r)) code = 1;
console.log(`${results.filter(Boolean).length}/${results.length} PASS`);
process.exit(code);
