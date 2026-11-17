// 할 일 태그 앞머리 점검 (feat/todo-tag-prefix): 태그로 걸러 보는 중 새 할 일 칸이 비어 있으면 "#태그 " 가 미리 들어가고,
// 태그를 바꾸면 앞머리만 바뀌고, 풀면 지워지고, 쓴 글과 직접 친 태그는 안 건드리며, 한글 조합 중에도 안 깨지고,
// 넣으면 그 태그로 저장된다 (작은 패널 320, 560 과 큰 창 760, 밝음과 어두움 그림).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en JJ_INSPECT_PORT=99xx JJ_PAGE_PORT=99yy node scripts/dev/todo-tag-prefix.mjs
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 끝나면 데이터 폴더를 지운다.
//
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-146');
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.tagprefix-test-'));
const data = join(scratch, 'data');
const homeDir = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(homeDir, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi'), wander: false }),
);
// 아침 계획 저절로 띄우기를 켜 둔다 (지금 분 5분 전부터 한 시간): 첫 열기에서 시트가 덮지 않고 탭도 안 바꾸는지 본다
const nowMinute = new Date().getHours() * 60 + new Date().getMinutes();
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: true, fromMinute: Math.max(0, nowMinute - 5) } }));
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
            // 굴려서 보이게 한 뒤 배치가 자리 잡을 때까지 기다렸다가 자리를 다시 잰다 (굴린 직후 재면 빗나간다)
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


const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};
const panelAlive = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()');

/** 지금에서 deltaMin 분 뒤의 현지 날짜와 하루 안의 분 */
const at = (deltaMin) =>
  main(`(() => { const d = new Date(Date.now() + ${deltaMin} * 60000); const p = (n) => String(n).padStart(2, '0');
    return JSON.stringify({ due: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), min: d.getHours() * 60 + d.getMinutes() }); })()`).then(JSON.parse);

try {
  await waitFor(() => main("typeof __jj === 'object'").catch(() => false), 30_000);
  await main(`__jj.settings.set({ panelView: 'compact' }); 1`);
  const NOW = await main('Date.now()');
  const add = (title) => main(`__jj.store.add({ title: ${JSON.stringify(title)}, reminds: [] }, ${NOW}); 1`);
  await add(tx('보고서 #회사', 'Report #work'));
  await add(tx('회의록 #회사', 'Minutes #work'));
  await add(tx('청소 #집', 'Cleaning #home'));
  await add(tx('책 읽기', 'Read a book'));
  await main('__jj.panel.refresh(); 1');
  const W = tx('회사', 'work');
  const H = tx('집', 'home');

  const titles = () => main(`JSON.stringify(__jj.store.list(Date.now()).open.map((x) => x.title))`).then(JSON.parse);
  const inputSel = `document.querySelector('.todo-main .add input')`;
  const inputOf = (p) => p.ev(`JSON.stringify({ v: ${inputSel}.value, s: ${inputSel}.selectionStart, e: ${inputSel}.selectionEnd })`).then(JSON.parse);
  const chip = (p, label) =>
    p.click(`[...document.querySelectorAll('.tag-chips button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`);
  const allChip = (p) => p.click(`document.querySelector('.tag-chips button')`);
  const setInput = async (p, text) => {
    await p.ev(`(() => { const i = ${inputSel}; i.focus(); i.select(); return 1; })()`);
    if (text) await p.type(text);
    else await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(200);
  };
  const clearAll = async (p) => {
    await allChip(p);
    await setInput(p, '');
    await sleep(150);
  };
  const overflow = (p, root) =>
    p.ev(`(() => { const r = document.querySelector(${JSON.stringify(root)}) ?? document.body; return r.scrollWidth > r.clientWidth + 1; })()`);

  async function run(p, name, root) {
    const tag = `[${name}]`;
    await clearAll(p);
    check(`${tag} 태그 없음: 칸이 비어 있음`, (await inputOf(p)).v === '');
    await chip(p, `#${W}`);
    let st = await inputOf(p);
    check(`${tag} 태그를 고르면 "#${W} " 가 들어가고 커서는 끝`, st.v === `#${W} ` && st.s === st.v.length && st.e === st.v.length, JSON.stringify(st));
    await chip(p, `#${H}`);
    st = await inputOf(p);
    check(`${tag} 다른 태그로 바꾸면 앞머리만 바뀜`, st.v === `#${H} `, st.v);
    await allChip(p);
    check(`${tag} 태그를 풀면 앞머리가 지워짐`, (await inputOf(p)).v === '');

    // 앞머리 뒤에 쓴 글은 그대로
    await chip(p, `#${W}`);
    await p.ev(`(() => { const i = ${inputSel}; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1; })()`);
    await p.type(tx('보고서 쓰기', 'write report'));
    await sleep(200);
    await chip(p, `#${H}`);
    check(`${tag} 태그를 바꿔도 뒤에 쓴 글은 그대로`, (await inputOf(p)).v === `#${H} ${tx('보고서 쓰기', 'write report')}`, (await inputOf(p)).v);
    await allChip(p);
    check(`${tag} 태그를 풀어도 쓴 글은 남음`, (await inputOf(p)).v === tx('보고서 쓰기', 'write report'), (await inputOf(p)).v);

    // 사용자가 이미 쓴 글은 건드리지 않음
    await clearAll(p);
    await setInput(p, tx('책 사기', 'buy book'));
    await chip(p, `#${W}`);
    check(`${tag} 쓴 글이 있으면 태그를 골라도 그대로`, (await inputOf(p)).v === tx('책 사기', 'buy book'), (await inputOf(p)).v);
    await allChip(p);

    // 사용자가 직접 친 태그는 안 지움
    await setInput(p, `#${W} x`);
    await chip(p, `#${H}`);
    await allChip(p);
    check(`${tag} 직접 친 태그 글은 안 바뀜`, (await inputOf(p)).v === `#${W} x`, (await inputOf(p)).v);

    // 자동 앞머리를 사용자가 고치면 그 뒤로 우리 것이 아님
    await clearAll(p);
    await chip(p, `#${W}`);
    await setInput(p, `#${W}`);
    await chip(p, `#${H}`);
    check(`${tag} 앞머리를 고친 뒤에는 태그를 바꿔도 안 건드림`, (await inputOf(p)).v === `#${W}`, (await inputOf(p)).v);
    await clearAll(p);

    // 한글 조합: 앞머리가 있는 칸에서 조합해도 앞머리와 글이 안 깨짐
    await chip(p, `#${W}`);
    await p.ev(`(() => { const i = ${inputSel}; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1; })()`);
    await p.send('Input.imeSetComposition', { text: 'ㅂ', selectionStart: 1, selectionEnd: 1 });
    await p.send('Input.imeSetComposition', { text: '보', selectionStart: 1, selectionEnd: 1 });
    // 조합 중에 태그가 바뀌어도(칩을 JS 로 눌러 포커스를 안 뺏는다) 조합 글이 깨지지 않고, 끝난 뒤 맞춘다
    await p.ev(`[...document.querySelectorAll('.tag-chips button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(`#${H}`)})).click()`);
    await sleep(200);
    const mid = (await inputOf(p)).v;
    check(`${tag} 조합 중에는 칸을 안 바꿈`, mid === `#${W} 보`, mid);
    await p.send('Input.insertText', { text: '보' });
    await sleep(400);
    st = await inputOf(p);
    check(`${tag} 조합이 끝나면 앞머리가 새 태그로, 글은 그대로`, st.v === `#${H} 보`, st.v);
    await clearAll(p);

    // 넣기: 앞머리 태그가 붙고, 날짜 낱말도 읽힌다
    const before = (await titles()).length;
    await chip(p, `#${W}`);
    await p.ev(`(() => { const i = ${inputSel}; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1; })()`);
    await p.type(tx('내일 점검표 쓰기', 'tomorrow write checklist'));
    await p.enter();
    await sleep(700);
    const list = await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((x) => x.title.includes(${JSON.stringify(tx('점검표', 'checklist'))})))`).then(JSON.parse);
    const added = list[0];
    check(`${tag} 넣은 할 일이 그 태그로 저장되고 날짜를 읽음`, !!added && added.title === `${tx('점검표 쓰기', 'write checklist')} #${W}` && !!added.due, JSON.stringify(added && { t: added.title, d: added.due }));
    check(`${tag} 넣은 뒤 같은 태그 앞머리가 다시 들어감`, (await inputOf(p)).v === `#${W} `, (await inputOf(p)).v);
    // 앞머리뿐이면 안 넣는다
    await p.ev(`${inputSel}.focus()`);
    await p.enter();
    await sleep(500);
    check(`${tag} 앞머리뿐이면 할 일을 안 넣음`, (await titles()).length === before + 1, String((await titles()).length));
    // 목록에도 그 태그 칩으로 걸림
    const shown = await p.ev(`document.querySelectorAll('li.todo[data-id]').length`);
    check(`${tag} 걸러 본 목록에 새 줄이 보임`, shown >= 3, String(shown));
    // 자동 앞머리 뒤에 날짜 낱말만 쓰면: 제목은 태그, 마감은 그 날짜
    await p.ev(`(() => { const i = ${inputSel}; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1; })()`);
    await p.type(tx('내일', 'tomorrow'));
    await p.enter();
    await sleep(700);
    const only = await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((x) => x.title === ${JSON.stringify(`#${W}`)}))`).then(JSON.parse);
    check(`${tag} 앞머리 뒤에 날짜만 쓰면 제목은 태그, 마감은 날짜`, only.length >= 1 && !!only[0].due, JSON.stringify(only.map((x) => ({ t: x.title, d: x.due }))));
    // 직접 앞에 친 다른 태그는 쓴 자리 그대로
    await setInput(p, `#${H} ${tx('직접 친 글', 'typed by me')}`);
    await p.ev(`${inputSel}.focus()`);
    await p.enter();
    await sleep(700);
    const typed = await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((x) => x.title.includes(${JSON.stringify(tx('직접 친 글', 'typed by me'))})))`).then(JSON.parse);
    check(`${tag} 직접 친 태그는 앞에 그대로 저장됨`, typed.length >= 1 && typed.every((x) => x.title === `#${H} ${tx('직접 친 글', 'typed by me')}`), JSON.stringify(typed.map((x) => x.title)));
    // Esc 로 지우면 되넣지 않는다
    await p.ev(`${inputSel}.focus()`);
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
    check(`${tag} Esc 로 지운 칸에는 되넣지 않음`, (await inputOf(p)).v === '', (await inputOf(p)).v);
    check(`${tag} 가로 넘침 없음`, !(await overflow(p, root)));
  }

  // ---- 작은 패널 320, 560 ----
  await main(`__jj.panel.openTab('todo'); 1`);
  await waitFor(panelAlive);
  await sleep(1200);
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const pp = await page('panel');
  for (const w of [320, 560]) {
    await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 640 }); 1`);
    await sleep(700);
    await run(pp, `패널 ${w}`, '.surface');
    for (const dark of [false, true]) {
      await pp.dark(dark);
      await allChip(pp);
      await chip(pp, `#${W}`);
      await pp.ev(`(() => { const i = ${inputSel}; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1; })()`);
      await sleep(250);
      // 커서와 칸 모양을 보이려고 포커스를 둔 채 찍는다 (shot 은 포커스를 뺀다: 그림은 칩 선택 상태와 앞머리)
      await pp.shot(`tag-prefix-panel${w}-${dark ? 'dark' : 'light'}`);
    }
    await pp.dark(false);
    await clearAll(pp);
  }
  await main('__jj.panel.window.close(); 1');
  await sleep(600);

  // ---- 큰 창 760 ----
  await main("__jj.home.open('todo'); 1");
  await waitFor(() => main('!!__jj.home.window && !__jj.home.window.isDestroyed()'));
  await sleep(1200);
  await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 760, height: 780 }); 1');
  await sleep(800);
  const hh = await page('home');
  await run(hh, '큰 창 760', '.surface.home');
  for (const dark of [false, true]) {
    await hh.dark(dark);
    await allChip(hh);
    await chip(hh, `#${W}`);
    await sleep(250);
    await hh.shot(`tag-prefix-home760-${dark ? 'dark' : 'light'}`);
  }
  await hh.dark(false);
} catch (e) {
  console.log('ERROR', e.message);
  results.push({ name: 'error', ok: false });
} finally {
  await cleanup();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
