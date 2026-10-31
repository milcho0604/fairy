// 할 일 마감 시각과 임박 표시 점검 (마감 칩 메뉴의 시각 넣기와 지우기, 임박 주황과 지남 빨강, 설정 기본값).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko JJ_INSPECT_PORT=9850 JJ_PAGE_PORT=9851 node scripts/dev/todo-due.mjs   (en 도)
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 진짜 AI 는 부르지 않는다: PATH 는 /usr/bin:/bin 과 node 만 둔다. 끝나면 데이터 폴더를 지운다.
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.rows-test-'));
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
  await main('1');
  await main(`__jj.settings.set({ panelView: 'compact' }); 1`);
  const NOW = await main('Date.now()');
  const soon = await at(30);
  const past = await at(-30);
  const later = await at(300);
  const add = (title, extra) => main(`__jj.store.add({ title: ${JSON.stringify(title)}, ...${JSON.stringify(extra)} }, ${NOW}); 1`);
  await add(tx('임박 보고서', 'Soon report'), { due: soon.due, dueMin: soon.min, reminds: [] });
  await add(tx('지난 회의록', 'Past notes'), { due: past.due, dueMin: past.min, reminds: [] });
  await add(tx('나중 일', 'Later task'), { due: later.due, dueMin: later.min, reminds: [] });
  await add(tx('날짜만 일', 'Date only'), { due: soon.due, reminds: [] });
  check('설정 기본값: 마감 임박 알림 켜짐', (await main('__jj.settings.get().dueSoonAlert')) === true);

  await main(`__jj.panel.openTab('todo'); 1`);
  await waitFor(panelAlive);
  await sleep(1200);
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const pp = await page('panel');
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: 360, height: 680 }); 1`);
  await sleep(700);

  const rowOf = (title) => `[...document.querySelectorAll('li.todo[data-id]')].find((l) => l.textContent.includes(${JSON.stringify(title)}))`;
  const chipOf = (title) => pp.ev(`(() => { const l = ${rowOf(title)}; const c = l?.querySelector('.due'); return c ? JSON.stringify({ cls: c.className, text: c.textContent }) : null; })()`).then((v) => (v ? JSON.parse(v) : null));
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  // 줄의 시각은 현지 표기(오후 1:22, 1:22 PM)라 시와 분 숫자로 맞춘다
  const shows = (text, m) => text.includes(`${(Math.floor(m / 60) % 12) || 12}:${String(m % 60).padStart(2, '0')}`) || text.includes(hhmm(m));
  await sleep(500);

  const cSoon = await chipOf(tx('임박 보고서', 'Soon report'));
  const cPast = await chipOf(tx('지난 회의록', 'Past notes'));
  const cLater = await chipOf(tx('나중 일', 'Later task'));
  const cDate = await chipOf(tx('날짜만 일', 'Date only'));
  check('임박(1시간 안)은 soon 색', !!cSoon?.cls.includes('soon') && !cSoon.cls.includes('overdue'), cSoon?.cls);
  check('지난 시각은 overdue 색', !!cPast?.cls.includes('overdue'), cPast?.cls);
  check('5시간 뒤는 색 없음', !!cLater && !cLater.cls.includes('soon') && !cLater.cls.includes('overdue'), cLater?.cls);
  check('날짜만 오늘은 색 없음', !!cDate && !cDate.cls.includes('soon') && !cDate.cls.includes('overdue'), cDate?.cls);
  check('줄에 시각이 보임', !!cSoon && !!cLater && shows(cSoon.text, soon.min) && shows(cLater.text, later.min), `${cSoon?.text} / ${cLater?.text}`);
  check('날짜만 줄에는 시각이 없음', !!cDate && !/\d{2}:\d{2}/.test(cDate.text), cDate?.text);
  await pp.dark(false);
  await pp.shot('due-colors');
  await pp.dark(true);
  await sleep(200);
  await pp.shot('due-colors-dark');
  await pp.dark(false);

  // 마감 칩 메뉴: 날짜만이면 "시각 넣기", 시각이 있으면 "시각 바꾸기"와 "시각 지우기"
  const menuLabels = () => pp.ev(`JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent.trim()))`).then(JSON.parse);
  const openMenu = async (title) => {
    await pp.click(`${rowOf(title)}.querySelector('.due-btn')`);
    await sleep(300);
    return menuLabels();
  };
  const closeMenu = async () => {
    // 메뉴 밖 빈 곳을 눌러 닫는다 (Esc 는 패널을 닫는다)
    await pp.clickAt(6, 6);
    await sleep(300);
  };
  const labelsDate = await openMenu(tx('날짜만 일', 'Date only'));
  check('날짜만: 메뉴에 시각 넣기, 시각 지우기는 없음', labelsDate.includes(tx('시각 넣기', 'Add a time')) && !labelsDate.includes(tx('시각 지우기', 'Remove time')), JSON.stringify(labelsDate));
  await pp.shot('due-menu-dateonly');
  await closeMenu();
  const labelsTimed = await openMenu(tx('임박 보고서', 'Soon report'));
  check('시각 있음: 메뉴에 시각 바꾸기(현재 시각)와 시각 지우기', labelsTimed.some((l) => (l.includes(hhmm(soon.min)) || shows(l, soon.min)) && l.includes(tx('시각 바꾸기', 'Change time'))) && labelsTimed.includes(tx('시각 지우기', 'Remove time')), JSON.stringify(labelsTimed));
  await pp.shot('due-menu-timed');
  // 시각 지우기
  await pp.click(`[...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent.trim() === ${JSON.stringify(tx('시각 지우기', 'Remove time'))})`);
  await sleep(500);
  const open1 = JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.map((t) => ({ title: t.title, due: t.due, dueMin: t.dueMin })))`));
  check('시각 지우기: 날짜는 남고 시각만 사라짐', open1.find((t) => t.title === tx('임박 보고서', 'Soon report'))?.dueMin === null && open1.find((t) => t.title === tx('임박 보고서', 'Soon report'))?.due === soon.due);

  // 시각 넣기: 숨은 time 칸에 값을 넣는다 (달력 대신 같은 변경 이벤트)
  await pp.ev(`(() => { const l = ${rowOf(tx('날짜만 일', 'Date only'))}; const i = l.querySelector('input[type="time"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '16:45'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await sleep(600);
  const open2 = JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.map((t) => ({ title: t.title, due: t.due, dueMin: t.dueMin })))`));
  check('시각 넣기: 16:45 가 저장됨', open2.find((t) => t.title === tx('날짜만 일', 'Date only'))?.dueMin === 16 * 60 + 45);
  const cAfter = await chipOf(tx('날짜만 일', 'Date only'));
  check('넣은 시각이 줄에 보임', !!cAfter && shows(cAfter.text, 16 * 60 + 45), cAfter?.text);

  for (const w of [320, 560]) {
    await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 680 }); 1`);
    await sleep(500);
    const over = await pp.ev(`document.documentElement.scrollWidth > innerWidth + 1`);
    check(`폭 ${w}: 가로 넘침 없음`, over === false);
    await pp.shot(`due-w${w}`);
  }
} catch (e) {
  check(`예외 없이 끝남: ${e.message}`, false);
} finally {
  await cleanup();
}
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} PASS`);
process.exit(bad.length ? 1 : 0);
