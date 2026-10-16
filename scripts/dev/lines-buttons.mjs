// 대사 고치기 단추와 칸이 어디서도 깨지지 않는지 (#125): ko/en, 밝은/어두운, 설정 창 너비 기본/360/320, 글 크기 1배/1.5배.
// 단추마다 낱말 중간 줄바꿈, 넘침, 잘림, 높이, 키보드 포커스 링을 코드로 재고 화면을 SHOTS(기본 /tmp/fairy-125/lines-buttons)에 찍는다.
//
//   npm run build && OUT=/tmp/fairy-125 LANG_UNDER_TEST=ko node scripts/dev/lines-buttons.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 맥북 화면, 입력은 CDP 로만 넣는다
// (마우스 누르기는 Input.dispatchMouseEvent, 글은 Input.insertText). 진짜 AI CLI 가 잡히지 않게 환경 변수는 비우고
// PATH 는 /usr/bin:/bin 과 node 만 둔다. 포트는 무작위(JJ_INSPECT_PORT, JJ_PAGE_PORT 로 바꿀 수 있다).
// 경우마다 PASS/FAIL 을 찍고 하나라도 FAIL 이면 종료 코드 1. 화면은 밝은, 어두운 모드로 찍는다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-125');
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
const ONLY = process.env.ONLY ?? 'trash,focus,lines';
const KEEP = process.env.KEEP === '1';
const ko = LANG === 'ko';
const tx = (koText, enText) => (ko ? koText : enText);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.records-test-'));
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
  const send = (method, params = {}, ms = 60_000) =>
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
        j(new Error(`CDP 답 없음: ${method}`));
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
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        let c = pageConns.get(name);
        if (!c || c.id !== p.id) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(name, c);
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
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
            ...extra,
          });
        /** expr 가 돌려주는 요소의 가운데 */
        const center = async (elExpr) =>
          ev(
            // 맨 위로 옮긴 뒤 잠깐 기다려 글이 자리를 잡은 다음에 잰다 (옮기고 바로 재면 늦게 바뀌는 높이 때문에 어긋났다)
            `(async () => { const e = (${elExpr}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          );
        const api = {
          ev,
          send: c.send,
          center,
          /** 마우스를 요소 위로 (hover 로 나타나는 단추용) */
          hover: async (elExpr) => {
            const p2 = await center(elExpr);
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await sleep(120);
            return true;
          },
          /** 화면 클릭: 요소 가운데로 마우스를 옮겨 누르고 뗀다 (CDP 입력, 진짜 마우스 아님) */
          click: async (elExpr) => {
            const p2 = await center(elExpr);
            if (!p2) return false;
            await mouse('mouseMoved', p2.x, p2.y);
            await mouse('mousePressed', p2.x, p2.y);
            await mouse('mouseReleased', p2.x, p2.y);
            await sleep(180);
            return true;
          },
          type: async (text) => {
            await c.send('Input.insertText', { text });
          },
          key: async (key, code, vk) => {
            await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
            await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
          shot: async (file, clipExpr) => {
            let clip;
            if (clipExpr) {
              clip = await ev(
                `(() => { const e = (${clipExpr}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) }; })()`,
              );
            }
            const r = await c.send('Page.captureScreenshot', {
              format: 'png',
              ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
            });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          /** 밝은 모드, 어두운 모드로 한 장씩 */
          shots: async (file, clipExpr) => {
            await api.dark(false);
            await sleep(150);
            await api.shot(`${file}-light`, clipExpr);
            await api.dark(true);
            await sleep(150);
            await api.shot(`${file}-dark`, clipExpr);
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

const SHOTS = resolve(process.env.SHOTS ?? '/tmp/fairy-125/lines-buttons');
mkdirSync(SHOTS, { recursive: true });
const ENTRY = tx('대사 고치기', 'Edit lines');

/** 페이지 안에서 도는 검사: 단추와 글 칸마다 낱말 중간 줄바꿈, 넘침, 잘림 */
const PROBE = `(() => {
  const sheet = document.querySelector('.lines-sheet');
  const sr = sheet.getBoundingClientRect();
  const sels = ['.gcal-sheet-head .link', '.lines-bar .segmented button', '.lines-bar .lines-find', '.lines-group > summary', '.lines-count button', '.lines-confirm button', '.lines-edited button', '.lines-error', '.lines-count small', '.lines-sheet > .gcal-sheet-body > small'];
  const out = [];
  for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // 낱말 중간 줄바꿈: 글 조각마다 낱말을 범위로 잡아 줄 수가 1 넘으면
    let mid = false;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const m of n.nodeValue.matchAll(/\\S+/g)) {
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        const tops = new Set([...rg.getClientRects()].map((x) => Math.round(x.top)));
        if (tops.size > 1) mid = true;
      }
    }
    const lines = new Set([...(() => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getClientRects(); })()].map((x) => Math.round(x.top))).size;
    out.push({ sel, text: (el.innerText || el.value || '').slice(0, 30), mid, lines, h: Math.round(r.height), over: el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline', clip: r.left < sr.left - 1 || r.right > sr.right + 1 || r.right > innerWidth + 1 || r.left < -1 });
  }
  return out;
})()`;

const body = async () => {
  await main('1');
  await page('pet');
  await sleep(2000);
  const widths = [0, 360, 320]; // 0 = 기본 너비
  const themes = ['light', 'dark'];
  let page0;
  for (const zoom of [1, 1.5]) {
    for (const want of widths) {
      await main(
        `(() => { const w = __jj.settingsWindow; w.open(); return 1; })()`,
      );
      await sleep(1800);
      const st = await page('settings');
      page0 = st;
      if (want) await main(`__jj.settingsWindow.window.setMinimumSize(1, 1); __jj.settingsWindow.window.setSize(${want}, 760); 1`);
      else await main(`__jj.settingsWindow.window.setSize(440, 760); 1`);
      await main(`__jj.settingsWindow.window.webContents.setZoomFactor(${zoom}); 1`);
      await sleep(600);
      const iw = await st.ev('innerWidth');
      // 칸 안내: 시트를 연다
      const entryExpr = `[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(ENTRY)})`;
      check(`[${iw}px x${zoom}] 펫 탭 진입 단추가 보임`, await st.click(entryExpr));
      await st.until(() => st.ev(`!!document.querySelector('.lines-sheet')`));
      await st.until(() => st.ev(`document.querySelectorAll('.lines-group').length > 5`));
      // 고친 칸(되돌리기 단추)과 오류 글을 만든다
      await st.click(`document.querySelector('.lines-group[data-group="food"] summary')`);
      for (const [key, text] of [
        ['pet.fed', tx('내가 고친 냠냠', 'My own yum')],
        ['pet.full', tx('이것도 고친 배부름 대사', 'Another edited full line')],
      ]) {
        await st.ev(`(() => { const t = document.querySelector('.lines-row[data-key="${key}"] textarea'); t.focus(); t.select(); })()`);
        await st.type(text);
        await st.ev('document.activeElement.blur()');
        await sleep(300);
      }
      await st.click(`document.querySelector('.lines-group[data-group="idle"] summary')`);
      await st.ev(`(() => { const t = document.querySelector('.lines-row[data-key="idle.any.1"] textarea'); t.focus(); t.select(); })()`);
      await st.type(tx('이름 없이 고친 말', 'A line with no name'));
      await st.ev('document.activeElement.blur()');
      await st.until(() => st.ev(`!!document.querySelector('.lines-error')`));
      for (const theme of themes) {
        await st.dark(theme === 'dark');
        await sleep(200);
        for (const confirm of [false, true]) {
          const has = await st.ev(`!!document.querySelector('.lines-confirm')`);
          if (confirm !== has) {
            if (confirm) await st.click(`[...document.querySelectorAll('.lines-count button')].find((b) => b.innerText.trim().length)`);
            else await st.click(`document.querySelector('.lines-confirm button:last-child')`);
            await sleep(250);
          }
          const tag = `[${LANG} ${theme} ${iw}px x${zoom}${confirm ? ' 확인줄' : ''}]`;
          const rows = await st.ev(PROBE);
          const bad = rows.filter((r) => r.mid || r.over || r.clip);
          check(`${tag} 낱말 중간 줄바꿈, 넘침, 잘림 없음 (${rows.length}개 검사)`, bad.length === 0, JSON.stringify(bad).slice(0, 300));
          const seg = rows.filter((r) => r.sel === '.lines-bar .segmented button');
          check(`${tag} 언어 단추 둘이 한 줄, 높이 같음`, seg.length === 2 && seg.every((r) => r.lines === 1) && seg[0].h === seg[1].h, JSON.stringify(seg.map((r) => [r.text, r.lines, r.h])));
          // 언어 단추 묶음과 찾기 칸: 높이 2px 안, 둥근 정도와 테두리 색 같음
          const bar = await st.ev(`(() => { const g = document.querySelector('.lines-bar .segmented'); const i = document.querySelector('.lines-bar .lines-find'); const a = g.getBoundingClientRect(); const b = i.getBoundingClientRect(); const cg = getComputedStyle(g); const ci = getComputedStyle(i); return { gh: a.height, ih: b.height, gr: cg.borderTopLeftRadius, ir: ci.borderTopLeftRadius, gc: cg.borderTopColor, ic: ci.borderTopColor, sameRow: Math.abs(a.top - b.top) < 40 }; })()`);
          check(`${tag} 찾기 칸 높이, 둥근 정도, 테두리 색이 언어 단추 묶음과 같음`, !bar.sameRow || (Math.abs(bar.gh - bar.ih) <= 2 && bar.gr === bar.ir && bar.gc === bar.ic), JSON.stringify(bar));
          const links = rows.filter((r) => r.sel === '.lines-edited button' || r.sel === '.lines-count button' || r.sel === '.lines-confirm button');
          check(`${tag} 되돌리기류 링크 단추 한 줄`, links.every((r) => r.lines <= 1 || !r.text.trim().includes(' ') ) , JSON.stringify(links.filter((r) => r.lines > 1).map((r) => [r.text, r.lines])));
          const png = await st.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(SHOTS, `${LANG}-${theme}-${iw}${zoom > 1 ? '-zoom' : ''}${confirm ? '-confirm' : ''}.png`), Buffer.from(png.result.data, 'base64'));
        }
        // 닫히지 않은 채 다음 테마
      }
      // 포커스 링: 키보드 이동 뒤 focus() (focus-visible)
      await st.dark(false);
      const ring = [];
      const sels = ['.gcal-sheet-head .link', '.lines-bar .segmented button', '.lines-bar .lines-find', '.lines-group > summary', '.lines-count button', '.lines-edited button', '.lines-row textarea'];
      for (const sel of sels) {
        await st.key('Tab', 'Tab', 9);
        const r = await st.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.focus(); const c = getComputedStyle(e); return { sel: ${JSON.stringify(sel)}, vis: e.matches(':focus-visible'), outline: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0, shadow: c.boxShadow !== 'none', border: c.borderColor }; })()`);
        if (r) ring.push(r);
      }
      const noRing = ring.filter((r) => r.vis && !r.outline && !r.shadow);
      check(`[${LANG} ${iw}px x${zoom}] 키보드 포커스 링이 모두 보임 (${ring.length}개)`, noRing.length === 0, JSON.stringify(noRing.map((r) => r.sel)));
      // Esc: 시트만 닫히고 설정 창은 남는다
      await st.key('Escape', 'Escape', 27);
      await sleep(400);
      check(`[${LANG} ${iw}px x${zoom}] Esc 는 시트만 닫음`, !(await st.ev(`!!document.querySelector('.lines-sheet')`)) && (await main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()')));
      // 진입 단추 (펫 탭 칸)
      const eb = await st.ev(`(() => { const b = ${entryExpr}; const r = b.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(b); const lines = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; return { lines, over: b.scrollWidth > b.clientWidth + 1, clip: r.right > innerWidth || r.left < 0, h: Math.round(r.height) }; })()`);
      check(`[${LANG} ${iw}px x${zoom}] 진입 단추 한 줄, 안 잘림`, eb.lines === 1 && !eb.over && !eb.clip, JSON.stringify(eb));
      await main(`__jj.settingsWindow.window.close(); 1`);
      await sleep(600);
    }
  }
  void page0;
  await main(`(() => { const o = __jj.lines.overrides(); return 1; })()`);
};

let failure;
try {
  await body();
} catch (err) {
  failure = err;
  console.log('FAIL 점검 도중 예외:', err?.message ?? err);
}
if (KEEP) {
  console.log('KEEP=1: 앱을 그대로 둔다', INSPECT, PAGE);
  await sleep(10 * 60_000);
}
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${LANG}: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAIL ${failed.length}` : ''}`);
for (const r of failed) console.log(' FAIL:', r.name);
process.exit(failed.length || failure ? 1 : 0);
