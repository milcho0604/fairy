// 오늘 탭과 할 일 줄 점검 (이슈 #146).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/todo-rows.mjs   (en 도)
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 진짜 AI 는 부르지 않는다: PATH 는 /usr/bin:/bin 과 node 만 둔다. 끝나면 데이터 폴더를 지운다.
//
// 보는 것 (PASS/FAIL, ko/en, 폭 320/360/560, 큰 창 1100, 밝음/어두움):
//   할 일 줄: 줄 하나가 탭 정지점 하나(위아래 화살표, Space 끝내기, Enter 고치기, Delete 지우기와 되돌리기), 줄 끝은 표시와 "..." 하나(제목과 안 겹침),
//     Alt+위아래와 메뉴와 끌기로 순서 바꾸기, 새로 넣은 줄 스크롤과 1초 하이라이트, 마감 칩 작은 메뉴(오늘, 내일, 다음 주 월요일),
//     반복 할 일 끝내면 "다음은 내일" 안내
//   오늘 탭: 집중 카드 한 줄과 직접 5~120분, 그만 되돌리기, 펫 상태 머리 한 줄, 할 일 0개일 때 아침 계획 시트 인라인 입력,
//     아침 첫 열기가 보던 탭을 안 바꾸고 시트로 덮지 않는 것
//   일정: "내일 종일 휴가" 에서 "종일" 이 제목에 안 남고 "내일 점심" 은 낮 12시, 끝 시각과 길이 고치기, 반복 일정과 다음 회차 생성
//   한 번에 찾기: Cmd+K 와 머리 돋보기, 할 일, 메모, 일정 묶음 결과와 고른 곳으로 가기
//   BASELINE=1 PREFIX=before 는 확인 없이 같은 자료로 전후 비교 그림용 찍기만 한다
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

/** 키 이벤트를 창 전체에 보낸다 (숨은 창이라 CDP 키 입력 대신 같은 이벤트를 만든다) */
const keyEvent = (init) =>
  `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} })); return true; })()`;
const mod = { metaKey: true };
/**
 * 가로 넘침: 창 밖으로 나간 요소, 가로로 스크롤되는 칸(태그 칩 줄은 일부러 가로 스크롤), 쪽 가로 스크롤.
 * 오늘 탭 줄이 일부러 -6px 로 번지는 것처럼 칸 안에서 스크롤이 생기지 않는 번짐은 넘침이 아니다
 */
const overflow = (p, root = '.surface.home') =>
  p
    .ev(`(() => {
    const out = [];
    for (const e of document.querySelectorAll('${root} *')) {
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
/**
 * 펫을 CDP 마우스로 누른다 (진짜 마우스가 아니다). 쓰는 사람이 자리를 비워 화면이 꺼지면 펫 화면이 멈춰 CDP 클릭이 먹지 않는다:
 * 그때는 펫 클릭이 부르는 같은 길(panel.togglePanel)을 메인에서 부르고 한 번 알린다. 큰 창 껍데기 시험은 어느 쪽이든 같은 길을 탄다
 */
let petPage;
let clickFallbacks = 0;
const state3 = async () => `${await homeAlive()}|${await panelAlive()}|${JSON.stringify(await main('__jj.home.look()'))}`;
const clickPet = async (expectChange = true) => {
  petPage ??= await page('pet');
  const before = await state3();
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
  if (expectChange && (await state3()) === before) {
    clickFallbacks++;
    await main('__jj.panel.togglePanel(); 1');
    await sleep(1200);
  }
};



const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};

const MOD_ALT = 1;
const MOD_META = 4;
/** 키 하나를 지금 초점이 있는 요소에 보낸다 (숨은 창이라 CDP 키 입력 대신 같은 이벤트를 만든다. 탭 키는 정지점 수로 센다) */
const press = (p, key, init = {}) =>
  p.ev(
    `(() => { const el = document.activeElement || document.body; el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ${JSON.stringify(key)}, code: ${JSON.stringify(init.code ?? key)}, altKey: ${!!init.alt}, metaKey: ${!!init.meta}, ctrlKey: false, shiftKey: ${!!init.shift} })); return true; })()`,
  );

/** 탭 키로 서는 자리: 보이는 단추와 칸 가운데 tabindex 가 -1 이 아닌 것 */
const stopsExpr = (rootSel) => `(() => {
  const root = document.querySelector(${JSON.stringify(rootSel)});
  return [...root.querySelectorAll('input:not([disabled]), button:not([disabled]), select, textarea, a[href], [tabindex]')].filter((e) => {
    if (e.tabIndex < 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
})()`;

const todoTitles = [
  ['메일 답장', 'Reply to mail', {}],
  ['보고서 쓰기', 'Write the report', { important: true }],
  ['장보기', 'Groceries', {}],
  ['치과 예약 전화하기', 'Call the dentist', {}],
  ['아주 긴 할 일 제목이 두 줄 넘어가도 줄이 예쁘게 바뀌는지 보려고 일부러 길게 적은 할 일', 'A very long to-do title that goes past two lines to check the row wraps nicely', {}],
  ['운동', 'Workout', { repeat: 'daily' }],
  ['책 반납', 'Return the book', {}],
  ['빨래', 'Laundry', {}],
];

async function openCompactPanel(width = 360, height = 680, tab = 'todo') {
  await setView('compact');
  await main(`__jj.panel.openTab(${JSON.stringify(tab)}); 1`);
  await waitFor(panelAlive);
  await sleep(1200);
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const pp = await page('panel');
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${width}, height: ${height} }); 1`);
  await sleep(600);
  return pp;
}
const setWidth = async (w, h = 680) => {
  await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: ${h} }); 1`);
  await sleep(500);
};

const days = async () =>
  JSON.parse(
    await main(`(() => {
      const f = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
      const t = new Date(); const tm = new Date(t.getTime() + 86400000);
      const wd = t.getDay(); const add = (8 - wd) % 7 || 7; const mon = new Date(t.getTime() + add * 86400000);
      return JSON.stringify({ today: f(t), tomorrow: f(tm), nextMon: f(mon) });
    })()`),
  );

const storeOpen = async () =>
  JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.map((t) => ({ id: t.id, title: t.title, due: t.due, repeat: t.repeat, pinned: t.pinnedAt !== null })))`));
const idOf = async (title) => (await storeOpen()).find((t) => t.title === title)?.id;
const rowIds = (pp) => pp.ev(`JSON.stringify([...document.querySelectorAll('.todos li.todo[data-id]')].map((l) => Number(l.dataset.id)))`).then(JSON.parse);
const activeRow = (pp) => pp.ev(`document.activeElement?.matches?.('li.todo[data-id]') ? Number(document.activeElement.dataset.id) : null`);
const toastText = (pp) => pp.ev(`[...document.querySelectorAll('.toast span')].map((e) => e.textContent).join(' | ')`);

/** 줄 제목이 줄 끝(표시, "...")과 겹치지 않고 줄이 가로로 넘치지 않는다 */
const rowOverlap = (pp) =>
  pp
    .ev(`(() => {
      const bad = [];
      for (const li of document.querySelectorAll('.todos li.todo[data-id]')) {
        const text = li.querySelector('.title-text');
        if (!text) continue;
        const tr = text.getBoundingClientRect();
        for (const e of li.querySelectorAll('.tools > *:not(.due-pick)')) {
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const sameLine = r.top < tr.bottom - 2 && r.bottom > tr.top + 2;
          if (sameLine && r.left < tr.right - 1 && r.right > tr.left + 1) bad.push(li.dataset.id + ':' + e.className);
        }
        const lr = li.getBoundingClientRect();
        if (lr.right > innerWidth + 1) bad.push(li.dataset.id + ':밖');
      }
      return JSON.stringify(bad);
    })()`)
    .then(JSON.parse);

const hoverRow = async (pp, index) => {
  const pos = await pp.ev(`(() => { const r = document.querySelectorAll('.todos li.todo[data-id]')[${index}].getBoundingClientRect(); return { x: r.x + 100, y: r.y + r.height / 2 }; })()`);
  await pp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none', buttons: 0 });
  await sleep(250);
};

const seed = async (NOW, todayStr, filler = 30) => {
  for (const [k, e, extra] of todoTitles)
    await main(
      `__jj.store.add({ title: ${JSON.stringify(tx(k, e))}, ...${JSON.stringify(extra)}, ...(${JSON.stringify(extra)}.repeat ? { due: ${JSON.stringify(todayStr)} } : {}) }, ${NOW}); 1`,
    );
  for (let i = 1; i <= filler; i++)
    await main(`__jj.store.add({ title: ${JSON.stringify(tx(`항목 ${i}`, `Item ${i}`))} }, ${NOW + i}); 1`);
};

const shots = async (pp, name) => {
  await pp.dark(false);
  await pp.shot(name);
  await pp.dark(true);
  await sleep(200);
  await pp.shot(`${name}-dark`);
  await pp.dark(false);
};

const baseline = async () => {
  const NOW = await main('Date.now()');
  const { today } = await days();
  await sleep(1500);
  for (const [k, e, extra] of todoTitles.slice(0, 8))
    await main(`__jj.store.add({ title: ${JSON.stringify(tx(k, e))}, ...${JSON.stringify(extra)}, ...(${JSON.stringify(extra)}.repeat ? { due: ${JSON.stringify(today)} } : {}) }, ${NOW}); 1`);
  const pp = await openCompactPanel(360, 640);
  const stops = await pp.ev(`${stopsExpr('#ptab-panel')}.length`);
  console.log('INFO 할 일 탭 탭 정지점 수(목록 포함)', stops);
  await hoverRow(pp, 2);
  await pp.shot(`${process.env.PREFIX ?? 'before'}-todo-360`);
  // 새 판만: 줄 메뉴와 마감 칩 메뉴를 연 모습
  if ((await pp.ev(`!!document.querySelector('.row-more')`)) === true) {
    await pp.click(`document.querySelectorAll('.todos li.todo[data-id] .row-more')[2]`);
    await sleep(300);
    await pp.shot(`${process.env.PREFIX ?? 'before'}-menu-360`);
    await pp.click(`document.body`);
    await sleep(200);
  }
  await main("__jj.panel.openTab('today'); 1");
  await sleep(600);
  await pp.shot(`${process.env.PREFIX ?? 'before'}-today-360`);
};

const body = async () => {
  await main('1');
  const NOW = await main('Date.now()');
  const D = await days();
  await sleep(1500);
  await seed(NOW, D.today);
  await main(
    `__jj.events.add({ title: ${JSON.stringify(tx('치과 정기 검진', 'Dental checkup'))}, startAt: ${NOW + 2 * 86_400_000 + 3_600_000}, reminds: [] }, ${NOW}); 1`,
  );
  await main(
    `__jj.notes.add({ title: ${JSON.stringify(tx('장보기 목록', 'Shopping list'))}, body: ${JSON.stringify(tx('우유\n달걀\n식빵', 'Milk\nEggs\nBread'))} }, ${NOW}); 1`,
  );
  const L = (k, e) => tx(k, e);

  // ===== 0. 아침 첫 열기: 보던 탭(일정)을 바꾸지 않고 시트도 덮지 않는다 =====
  const pp = await openCompactPanel(360, 680, 'event');
  await sleep(800);
  const tabNow = await pp.ev(`document.querySelector('[role=tab][aria-selected=true]')?.id`);
  check('아침 첫 열기: 보던 탭(일정)이 그대로이고 계획 시트가 덮지 않는다', tabNow === 'ptab-event' && !(await pp.ev(`!!document.querySelector('.plan-veil')`)), tabNow);
  await main("__jj.panel.openTab('today'); 1");
  await sleep(500);
  check('아침 첫 열기: 계획 시트를 대신할 오늘 계획 시작 단추가 보인다', await pp.ev(`!!document.querySelector('.plan-card.is-empty button')`));
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(500);

  // ===== 1. 할 일 줄: 탭 정지점, 줄 끝, 폭별 =====
  for (const w of [320, 360, 560]) {
    await setWidth(w, 680);
    await main("__jj.panel.openTab('todo'); 1");
    await sleep(400);
    const mark = `폭 ${w}`;
    const rows = await rowIds(pp);
    check(`${mark}: 할 일 줄이 그려진다`, rows.length >= 8, String(rows.length));
    const inner = await pp.ev(`[...document.querySelectorAll('.todos li.todo[data-id]')].every((li) => [...li.querySelectorAll('button, input')].every((e) => e.tabIndex === -1))`);
    const zeros = await pp.ev(`document.querySelectorAll('.todos li.todo[tabindex="0"]').length`);
    check(`${mark}: 줄 안 단추는 탭 정지점이 아니고 줄 하나만 탭 정지점이다`, inner && zeros === 1, `inner=${inner} 정지점=${zeros}`);
    const listStops = await pp.ev(`${stopsExpr('.todos')}.length`);
    check(`${mark}: 목록 전체 탭 정지점은 줄 1개와 더 보기 정도 (줄마다 10개가 아니다)`, listStops <= 2, String(listStops));
    await hoverRow(pp, 2);
    const bad = await rowOverlap(pp);
    check(`${mark}: 줄에 올려도 제목이 줄 끝 표시와 겹치지 않고 넘치지 않는다`, bad.length === 0, bad.join(', '));
    const widest = await pp.ev(`document.documentElement.scrollWidth <= innerWidth + 1`);
    check(`${mark}: 쪽 가로 넘침 없음`, widest);
    await shots(pp, `todo-w${w}`);
  }
  await setWidth(360, 680);
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(300);
  const tabs = await pp.ev(`(() => { const s = ${stopsExpr('#ptab-panel')}; const input = document.querySelector('.add input'); const row = document.querySelector('.todos li.todo[tabindex="0"]'); return s.indexOf(row) - s.indexOf(input); })()`);
  console.log(`INFO 입력칸에서 다섯째 줄까지: 탭 ${tabs}번 + 아래 화살표 4번 (전: 탭 17번)`);
  check('입력칸에서 탭 두 번 이내(찾기 단추 하나 포함)에 목록 줄에 닿는다', tabs <= 2, String(tabs));

  // ===== 2. 키보드 =====
  await pp.ev(`document.querySelector('.todos li.todo[tabindex="0"]').focus()`);
  const ids0 = await rowIds(pp);
  for (let i = 0; i < 4; i++) await press(pp, 'ArrowDown');
  check('아래 화살표 4번이면 다섯째 줄', (await activeRow(pp)) === ids0[4], `${await activeRow(pp)} vs ${ids0[4]}`);
  await press(pp, 'ArrowUp');
  check('위 화살표는 한 줄 위', (await activeRow(pp)) === ids0[3]);
  await press(pp, 'End');
  check('End 는 보이는 마지막 줄', (await activeRow(pp)) === ids0.at(-1));
  await press(pp, 'Home');
  check('Home 은 첫 줄', (await activeRow(pp)) === ids0[0]);
  await press(pp, 'ArrowUp');
  check('첫 줄에서 위 화살표는 그대로', (await activeRow(pp)) === ids0[0]);
  // Space 로 끝내기
  for (let i = 0; i < 3; i++) await press(pp, 'ArrowDown');
  const spaceId = ids0[3];
  await press(pp, ' ', { code: 'Space' });
  await sleep(500);
  check('Space 는 그 줄을 끝낸다', !(await storeOpen()).some((t) => t.id === spaceId));
  check('끝낸 뒤 초점이 이웃 줄로 간다', (await activeRow(pp)) !== null);
  check('끝내기 알림이 뜬다', (await toastText(pp)).includes(L('끝!', 'Done!')), await toastText(pp));
  await pp.ev(`document.body.focus()`);
  await pp.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', metaKey: true }))`);
  await sleep(500);
  check('Cmd+Z 로 끝내기를 되돌린다', (await storeOpen()).some((t) => t.id === spaceId));
  // Enter 로 고치기
  await pp.ev(`document.querySelector('.todos li.todo[data-id="${ids0[1]}"]').focus()`);
  await press(pp, 'Enter');
  await sleep(200);
  check('Enter 는 제목 고치기 칸을 연다', await pp.ev(`document.activeElement?.classList.contains('title-edit')`));
  await pp.ev(`document.activeElement.select()`);
  await pp.type(L('보고서 다시 쓰기', 'Rewrite the report'));
  await pp.enter();
  await sleep(400);
  const renamed = (await storeOpen()).find((t) => t.id === ids0[1])?.title;
  check('Enter 로 고친 제목이 저장되고 줄로 초점이 돌아온다', renamed === L('보고서 다시 쓰기', 'Rewrite the report') && (await activeRow(pp)) === ids0[1], `${renamed}`);
  // Delete 로 지우기와 되돌리기
  await pp.ev(`document.querySelector('.todos li.todo[data-id="${ids0[7]}"]').focus()`);
  await press(pp, 'Delete');
  await sleep(500);
  check('Delete 는 그 줄을 지운다 (할 일 목록에서 빠진다)', !(await storeOpen()).some((t) => t.id === ids0[7]));
  check('지우기 알림에 되돌리기가 있다', (await pp.ev(`!!document.querySelector('.toast .undo')`)));
  await pp.ev(`document.querySelector('.toast .undo').click()`);
  await sleep(500);
  check('되돌리기로 지운 줄이 돌아온다', (await storeOpen()).some((t) => t.id === ids0[7]));
  await sleep(300);

  // ===== 3. 순서 바꾸기: Alt+위아래, 메뉴, 끌기 =====
  const orderIds = async () => (await storeOpen()).map((t) => t.id);
  const before = await orderIds();
  await pp.ev(`document.querySelector('.todos li.todo[data-id="${before[3]}"]').focus()`);
  await press(pp, 'ArrowUp', { alt: true });
  await sleep(500);
  const afterUp = await orderIds();
  check('Alt+위 화살표: 한 칸 위로 (저장 순서)', afterUp[2] === before[3] && afterUp[3] === before[2], afterUp.slice(0, 5).join(','));
  check('Alt+위 화살표 뒤에도 초점이 그 줄에 있다', (await activeRow(pp)) === before[3]);
  await press(pp, 'ArrowDown', { alt: true });
  await sleep(500);
  const afterDown = await orderIds();
  check('Alt+아래 화살표: 한 칸 아래로 (원래 자리)', afterDown.slice(0, 6).join(',') === before.slice(0, 6).join(','), afterDown.slice(0, 6).join(','));
  check('순서를 읽어 준다 (상태 줄)', (await pp.ev(`document.querySelector('[role=status].sr-only')?.textContent ?? ''`)).length > 0);
  // 메뉴로 맨 아래로, 맨 위로
  const menuRowId = before[4];
  await hoverRow(pp, 4);
  await pp.click(`document.querySelector('.todos li.todo[data-id="${menuRowId}"] .row-more')`);
  await sleep(300);
  const labels = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.row-menu button')].map((b) => b.textContent.trim()))`));
  check('줄 메뉴가 열리고 순서, 마감, 반복, 지우기 항목이 있다', labels.length >= 9 && labels.some((l) => l.includes(L('맨 위로', 'Move to top'))) && labels.some((l) => l.includes(L('지우기', 'Delete'))), labels.join(' / '));
  check('줄 메뉴의 첫 항목에 초점이 있다', await pp.ev(`document.activeElement?.closest?.('.row-menu') !== null`));
  await press(pp, 'ArrowDown');
  check('메뉴 안에서 화살표로 항목을 옮긴다', (await pp.ev(`document.activeElement?.textContent?.trim()`)) === labels[1], labels[1]);
  await press(pp, 'Escape', { code: 'Escape' });
  await sleep(200);
  check('Esc 는 메뉴만 닫고 초점은 연 자리로', !(await pp.ev(`!!document.querySelector('.row-menu')`)) && (await main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()')));
  await pp.click(`document.querySelector('.todos li.todo[data-id="${menuRowId}"] .row-more')`);
  await sleep(200);
  await pp.click(`[...document.querySelectorAll('.row-menu button')].find((b) => b.textContent.includes(${JSON.stringify(L('맨 아래로', 'Move to bottom'))}))`);
  await sleep(500);
  const afterBottom = await orderIds();
  check('메뉴 "맨 아래로": 저장 순서 맨 끝', afterBottom.at(-1) === menuRowId, String(afterBottom.at(-1)));
  // 맨 아래 줄은 화면 밖일 수 있다: 저장된 순서로 확인하고 맨 위로 되돌린다
  await main(`__jj.store.place(${menuRowId}, ${afterBottom[0]}, false, Date.now()); __jj.panel.refresh(); 1`);
  await sleep(400);
  check('맨 위로 (저장소)', (await orderIds())[0] === menuRowId);
  // 끌기: 손잡이를 끌어 다른 줄 위에 놓는다
  const dragFrom = (await rowIds(pp))[1];
  const dragTo = (await rowIds(pp))[4];
  const orderBeforeDrag = await orderIds();
  // 끌기는 이벤트마다 화면이 다시 그려져야 끄는 줄을 안다: 이벤트 사이에 잠깐씩 쉰다
  const dnd = (fn) => pp.ev(`(() => { ${fn}; return true; })()`);
  const dtExpr = `window.__dt ??= new DataTransfer();`;
  await dnd(`${dtExpr} document.querySelector('.todos li.todo[data-id="${dragFrom}"] .grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(120);
  await dnd(`document.querySelector('.todos li.todo[data-id="${dragTo}"]').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(120);
  check('끄는 동안 올려 둔 줄에 들어갈 자리 표시가 선다', await pp.ev(`!!document.querySelector('.todos li.todo.drop-over')`));
  await dnd(`document.querySelector('.todos li.todo[data-id="${dragTo}"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(120);
  await dnd(`document.querySelector('.todos li.todo[data-id="${dragFrom}"] .grip')?.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(500);
  const orderAfterDrag = await orderIds();
  const iFrom = orderAfterDrag.indexOf(dragFrom);
  const iTo = orderAfterDrag.indexOf(dragTo);
  check('손잡이 끌기: 위에서 아래 줄로 놓으면 그 줄 뒤에', iFrom === iTo + 1 && orderBeforeDrag.indexOf(dragFrom) < orderBeforeDrag.indexOf(dragTo), `${iFrom} ${iTo} 전 ${orderBeforeDrag.indexOf(dragFrom)} ${orderBeforeDrag.indexOf(dragTo)} 줄 ${dragFrom} ${dragTo}`);
  // 고정한 줄은 순서 메뉴가 없다
  await main(`__jj.store.pin(${orderAfterDrag[0]}, true, Date.now()); __jj.panel.refresh(); 1`);
  await sleep(500);
  console.log('INFO 고정한 줄 수', await pp.ev(`document.querySelectorAll('.todos li.todo.pinned').length`), '토스트', await toastText(pp));
  await pp.click(`document.querySelector('.todos li.todo.pinned .row-more')`);
  await sleep(250);
  const pinLabels = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.row-menu button')].map((b) => b.textContent.trim()))`));
  check('고정한 줄의 메뉴가 열린다', pinLabels.length > 0, pinLabels.join(' / '));
  check('고정한 줄의 메뉴에는 순서 항목이 없다', !pinLabels.some((l) => l.includes(L('맨 위로', 'Move to top'))), pinLabels.join(' / '));
  await press(pp, 'Escape', { code: 'Escape' });
  await sleep(200);
  await main(`__jj.store.pin(${orderAfterDrag[0]}, false, Date.now()); __jj.panel.refresh(); 1`);
  await sleep(300);

  // ===== 4. 새로 넣은 할 일: 그 줄까지 스크롤하고 1초 하이라이트 =====
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(300);
  const newTitle = L('방금 넣은 새 할 일', 'Brand new todo');
  await pp.ev(`document.querySelector('.todos').scrollTop = 0`);
  await pp.ev(`document.querySelector('.add input').focus()`);
  await pp.type(newTitle);
  await pp.enter();
  let flashSeen = false;
  let inView = false;
  for (let i = 0; i < 12 && !flashSeen; i++) {
    await sleep(80);
    const st = await pp.ev(`(() => { const li = [...document.querySelectorAll('.todos li.todo')].find((l) => l.textContent.includes(${JSON.stringify(newTitle)})); if (!li) return null; const list = document.querySelector('.todos').getBoundingClientRect(); const r = li.getBoundingClientRect(); return { flash: li.classList.contains('flash'), vis: r.top >= list.top - 1 && r.bottom <= list.bottom + 1 }; })()`);
    if (st?.flash) {
      flashSeen = true;
      inView = st.vis;
    }
  }
  // 부드럽게 굴러 가는 동안은 기다린다 (굴림이 멈출 때까지)
  for (let last = -1, i = 0; i < 25; i++) {
    const top = await pp.ev(`document.querySelector('.todos').scrollTop`);
    if (top === last) break;
    last = top;
    await sleep(150);
  }
  const inViewLater = await pp.ev(`(() => { const li = [...document.querySelectorAll('.todos li.todo')].find((l) => l.textContent.includes(${JSON.stringify(newTitle)})); if (!li) return false; const list = document.querySelector('.todos').getBoundingClientRect(); const r = li.getBoundingClientRect(); return r.top >= list.top - 1 && r.bottom <= list.bottom + 1; })()`);
  check('새로 넣은 줄이 하이라이트된다 (flash)', flashSeen);
  check('새로 넣은 줄까지 스크롤해서 보인다', inView || inViewLater, `${inView} ${inViewLater} ${await pp.ev(`JSON.stringify({ st: document.querySelector('.todos').scrollTop, sh: document.querySelector('.todos').scrollHeight, ch: document.querySelector('.todos').clientHeight })`)}`);
  await shots(pp, 'todo-newrow');
  await sleep(900);
  check('하이라이트는 1초쯤 뒤에 꺼진다', !(await pp.ev(`!!document.querySelector('.todos li.todo.flash')`)));
  const lastIdNow = (await orderIds()).at(-1);
  check('순서를 손으로 바꾼 뒤에도 새 할 일은 맨 끝에 들어간다', (await storeOpen()).find((t) => t.id === lastIdNow)?.title === newTitle);

  // ===== 5. 마감 칩: 작은 메뉴 =====
  // 위 키보드 시험에서 둘째 줄(운동)의 제목을 고쳤다: 번호로 잡는다
  const exId = ids0[1];
  await pp.ev(`document.querySelector('.todos').scrollTop = 0`);
  await sleep(200);
  const dueClick = await pp.click(`document.querySelector('.todos li.todo[data-id="${exId}"] .due-btn')`);
  await sleep(300);
  console.log('INFO due-btn 누름', dueClick, exId, await pp.ev(`JSON.stringify({ menu: !!document.querySelector('.row-menu'), btn: !!document.querySelector('.todos li.todo[data-id="${exId}"] .due-btn'), rows: document.querySelectorAll('.todos li.todo').length })`));
  const dueLabels = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.row-menu button')].map((b) => b.textContent.replace('✓', '').trim()))`));
  check('마감 칩을 누르면 오늘, 내일, 다음 주 월요일, 날짜 고르기 메뉴가 먼저 나온다', dueLabels.length >= 4 && dueLabels[0].includes(L('오늘', 'Today')) && dueLabels[1].includes(L('내일', 'Tomorrow')) && dueLabels.some((l) => l.includes(L('날짜 고르기', 'Pick a date'))), dueLabels.join(' / '));
  check('지금 마감(오늘)이 표시된다', await pp.ev(`document.querySelector('.row-menu [role=menuitemradio][aria-checked=true]')?.textContent.includes(${JSON.stringify(L('오늘', 'Today'))})`));
  await shots(pp, 'todo-duemenu');
  await pp.click(`[...document.querySelectorAll('.row-menu button')].find((b) => b.textContent.includes(${JSON.stringify(L('내일', 'Tomorrow'))}))`);
  await sleep(500);
  check('"내일" 을 고르면 마감이 내일로 (클릭 두 번)', (await storeOpen()).find((t) => t.id === exId)?.due === D.tomorrow);
  // 마감 없는 줄은 줄 메뉴의 "마감 바꾸기" 로
  const plainId = await idOf(L('책 반납', 'Return the book'));
  await pp.click(`document.querySelector('.todos li.todo[data-id="${plainId}"] .row-more')`);
  await sleep(250);
  await pp.click(`[...document.querySelectorAll('.row-menu button')].find((b) => b.textContent.includes(${JSON.stringify(L('마감 바꾸기', 'Change due date'))}))`);
  await sleep(300);
  const nm = await pp.ev(`[...document.querySelectorAll('.row-menu button')].some((b) => b.textContent.includes(${JSON.stringify(L('다음 주 월요일', 'Next Monday'))}))`);
  check('줄 메뉴 "마감 바꾸기" 가 마감 고르기 메뉴를 연다', nm);
  await pp.click(`[...document.querySelectorAll('.row-menu button')].find((b) => b.textContent.includes(${JSON.stringify(L('다음 주 월요일', 'Next Monday'))}))`);
  await sleep(500);
  const nmDue = (await storeOpen()).find((t) => t.id === plainId)?.due;
  check('"다음 주 월요일" 은 다음에 오는 월요일 날짜', nmDue === D.nextMon, `${nmDue} vs ${D.nextMon}`);
  // 반복 할 일 끝내기: 다음 회차 안내
  await pp.ev(`document.querySelector('.todos').scrollTop = 0`);
  await pp.click(`document.querySelector('.todos li.todo[data-id="${exId}"] .check')`);
  await sleep(600);
  const rt = await toastText(pp);
  check('반복 할 일을 끝내면 "다음은 내일" 안내가 붙는다', rt.includes(L('다음은 ', 'Next one: ')) , rt);
  await shots(pp, 'todo-repeat-toast');

  // ===== 6. 오늘 탭: 집중 한 줄, 직접 길이, 그만 되돌리기 =====
  await main("__jj.panel.openTab('today'); 1");
  await sleep(500);
  check('집중 카드는 한 줄로 접혀 있다 (길이 칩이 안 보인다)', !(await pp.ev(`!!document.querySelector('.focus-card .focus-len')`)));
  await pp.click(`document.querySelector('.focus-card .link')`);
  await sleep(250);
  const chips = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.focus-card .len-chip')].map((b) => b.textContent.trim()))`));
  check('길이 바꾸기: 15, 25, 50분과 "직접" 칩', chips.length === 4 && chips[3].includes(L('직접', 'Custom')), chips.join(' / '));
  await pp.click(`document.querySelectorAll('.focus-card .len-chip')[3]`);
  await sleep(200);
  await pp.ev(`document.querySelector('.focus-custom input').focus(); document.querySelector('.focus-custom input').select()`);
  await pp.type('4');
  await sleep(200);
  check('직접 4분은 받지 않는다 (안내와 시작 단추 꺼짐)', (await pp.ev(`!!document.querySelector('.focus-bad')`)) && (await pp.ev(`document.querySelector('.focus-card .primary').disabled`)));
  await pp.ev(`document.querySelector('.focus-custom input').select()`);
  await pp.type('130');
  await sleep(200);
  check('직접 130분은 받지 않는다 (상한 120)', await pp.ev(`document.querySelector('.focus-card .primary').disabled`));
  await pp.ev(`document.querySelector('.focus-custom input').select()`);
  await pp.type('40');
  await sleep(300);
  check('직접 40분: 안내가 사라지고 시작할 수 있다', !(await pp.ev(`!!document.querySelector('.focus-bad')`)) && !(await pp.ev(`document.querySelector('.focus-card .primary').disabled`)));
  await shots(pp, 'today-focus-custom');
  await pp.click(`document.querySelector('.focus-card .primary')`);
  await sleep(600);
  const fl = JSON.parse(await main(`JSON.stringify({ len: (__jj.planner.focus.endsAt - __jj.planner.focus.startedAt) / 60000, saved: __jj.settings.get().focusMin, phase: __jj.planner.focus.phase })`));
  check('직접 40분으로 집중이 시작되고 다음에도 40분', fl.len === 40 && fl.saved === 40 && fl.phase === 'focus', JSON.stringify(fl));
  // 10분 지난 것으로 그만
  await main(`globalThis.__realNow = Date.now; Date.now = () => globalThis.__realNow() + 10 * 60_000; 1`);
  await pp.click(`document.querySelector('.focus-card .ghost')`);
  await sleep(500);
  await main(`Date.now = globalThis.__realNow; 1`);
  const st = await pp.ev(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).find((x) => /집중|ocus/.test(x)) ?? ''`);
  check('그만 뒤에 "집중 N분을 기록하고 그만뒀어" 알림과 되돌리기', /10|9/.test(st) && (await pp.ev(`!!document.querySelector('.toast .undo')`)), st);
  const ym = await main(`new Date().toISOString().slice(0, 7)`);
  const recorded = await main(`JSON.stringify(__jj.stats.focusMonth(new Date().toISOString().slice(0, 7)).map((d) => d.min))`);
  check('그만두면 분이 기록된다', JSON.parse(recorded).some((m) => m >= 9), recorded);
  await pp.click(`[...document.querySelectorAll('.toast')].find((t) => t.textContent.includes(${JSON.stringify(L('집중', 'focus'))}))?.querySelector('.undo')`);
  await sleep(500);
  const back = JSON.parse(await main(`JSON.stringify({ phase: __jj.planner.focus.phase, left: (__jj.planner.focus.endsAt - Date.now()) / 60000 })`));
  const recorded2 = await main(`JSON.stringify(__jj.stats.focusMonth(new Date().toISOString().slice(0, 7)).map((d) => d.min))`);
  check('되돌리기: 집중이 남은 시간 그대로 다시 돌고 기록이 거둬진다', back.phase === 'focus' && back.left > 20 && !JSON.parse(recorded2).some((m) => m >= 9), `${JSON.stringify(back)} ${recorded2} ${ym}`);
  await pp.click(`document.querySelector('.focus-card .ghost')`);
  await sleep(300);
  await pp.ev(`document.querySelector('.toast .undo')?.click()`);

  // ===== 7. 펫 상태 머리 한 줄 =====
  await setWidth(360, 680);
  const head = await pp.ev(`(() => { const f = document.querySelector('.fullness').getBoundingClientRect(); const t = document.querySelector('.tabs').getBoundingClientRect(); return { h: Math.round(f.height), gap: Math.round(t.top - f.top) }; })()`);
  check('펫 상태(배부름, 기분, 친밀도, 밥 주기)가 폭 360 에서 한 줄', head.h <= 34, JSON.stringify(head));
  const noLifeRow = !(await pp.ev(`!!document.querySelector('.life:not(.chip-only)')`));
  check('기분, 친밀도 줄이 따로 없다', noLifeRow);
  await shots(pp, 'today-w360');

  // ===== 8. 아침 계획: 할 일 0개일 때 바로 적기 =====
  await main(`(() => { const now = Date.now(); for (const t of __jj.store.list(now).open) __jj.store.remove(t.id, now); __jj.panel.refresh(); return 1; })()`);
  await sleep(500);
  await pp.click(`document.querySelector('.plan-card.is-empty button')`);
  await sleep(500);
  const hasInline = await pp.ev(`!!document.querySelector('.plan-sheet .plan-first-todo input')`);
  check('할 일이 0개여도 오늘 계획 단추에서 시트를 열어 바로 입력할 수 있다', hasInline);
  await shots(pp, 'today-plan-inline');
  await pp.click(`document.querySelector('.plan-sheet .plan-first-todo input')`);
  await pp.ev(`(() => { const input = document.querySelector('.plan-sheet .plan-first-todo input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(L('물 마시기', 'Drink water'))}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value; })()`);
  await pp.click(`document.querySelector('.plan-sheet .plan-first-todo button')`);
  await sleep(700);
  check('첫 할 일을 넣으면 계획 후보와 선택이 생긴다', (await pp.ev(`document.querySelectorAll('.plan-cands li').length`)) === 1 && (await pp.ev(`document.querySelector('.plan-count')?.textContent`))?.includes('1'));
  await pp.click(`document.querySelector('.plan-foot .primary')`);
  await sleep(500);
  check('저장한 첫 계획이 오늘 카드에 나타난다', (await pp.ev(`document.querySelectorAll('.plan-card .plan-picks li').length`)) === 1);
  // 시트를 직접 열었을 때도 막다른 길이 아니다
  await main(`(() => { const now = Date.now(); for (const t of __jj.store.list(now).open) __jj.store.remove(t.id, now); __jj.panel.refresh(); return 1; })()`);
  await sleep(300);
  await pp.ev(`window.dispatchEvent(new Event('jj:open-plan'))`);
  await sleep(600);
  check('0개일 때 시트에서 바로 적을 수 있고 빈 입력은 추가할 수 없다', (await pp.ev(`!!document.querySelector('.plan-sheet .plan-first-todo input')`)) && (await pp.ev(`document.querySelector('.plan-sheet .plan-first-todo button').disabled`)));
  await pp.click(`document.querySelector('.plan-sheet .plan-first-todo input')`);
  await pp.ev(`(() => { const input = document.querySelector('.plan-sheet .plan-first-todo input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(L('시트에서 적은 일', 'Typed in sheet'))}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value; })()`);
  await pp.click(`document.querySelector('.plan-sheet .plan-first-todo button')`);
  await sleep(800);
  check('시트에서 적으면 계획 후보로 바로 선택된다', (await pp.ev(`document.querySelector('.plan-count')?.textContent`))?.includes('1'), await pp.ev(`document.querySelector('.plan-count')?.textContent`));
  await pp.ev(`document.querySelector('.plan-close').click()`);
  await sleep(300);

  // ===== 9. 일정: 문장 해석, 끝 시각, 반복 말 =====
  await main("__jj.panel.openTab('event'); 1");
  await sleep(500);
  const typeEvent = async (text) => {
    await pp.ev(`document.querySelector('.event-add input').focus(); document.querySelector('.event-add input').select()`);
    await pp.type(text);
    await pp.enter();
    await sleep(600);
  };
  await typeEvent(L('내일 종일 휴가', 'tomorrow all day offsite'));
  const evs = JSON.parse(await main(`JSON.stringify(__jj.events.between(0, 4e12).map((e) => ({ id: e.id, title: e.title, allDay: e.allDay, startAt: e.startAt, endAt: e.endAt })))`));
  const off = evs.find((e) => e.title === L('휴가', 'offsite'));
  check('"내일 종일 휴가": 종일 일정, 제목에 "종일" 이 남지 않는다', !!off && off.allDay, JSON.stringify(evs.map((e) => e.title)));
  await typeEvent(L('내일 점심', 'tomorrow lunch'));
  const evs2 = JSON.parse(await main(`JSON.stringify(__jj.events.between(0, 4e12).map((e) => ({ id: e.id, title: e.title, allDay: e.allDay, startAt: e.startAt, endAt: e.endAt })))`));
  const lunch = evs2.find((e) => e.title === L('점심', 'lunch'));
  const lunchMin = lunch ? new Date(lunch.startAt).getHours() * 60 + new Date(lunch.startAt).getMinutes() : -1;
  check('"내일 점심": 종일이 아니라 낮 12시 일정 (한 시간)', !!lunch && !lunch.allDay && lunchMin === 720 && lunch.endAt - lunch.startAt === 3_600_000, JSON.stringify(lunch));
  await typeEvent(L('내일 3시 회의', 'tomorrow 3pm meeting'));
  await sleep(300);
  const meet = JSON.parse(await main(`JSON.stringify(__jj.events.between(0, 4e12).find((e) => e.title === ${JSON.stringify(L('회의', 'meeting'))}))`));
  check('"내일 3시 회의" 가 일정으로 들어가고 끝 시각은 없다', !!meet && meet.endAt === null);
  await pp.ev(`(() => { const li = [...document.querySelectorAll('li.event')].find((l) => l.dataset.findKey === 'event:${meet.id}'); li.scrollIntoView(); return true; })()`);
  const setEnd = async (value) => {
    await pp.ev(`(() => {
      const li = document.querySelector('li.event[data-find-key="event:${meet.id}"]');
      const input = li.querySelector('.end-time input');
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
  };
  await setEnd('16:30');
  const meet2 = JSON.parse(await main(`JSON.stringify(__jj.events.get ? __jj.events.get(${meet.id}) : __jj.events.between(0, 4e12).find((e) => e.id === ${meet.id}))`));
  const endHm = meet2.endAt ? `${String(new Date(meet2.endAt).getHours()).padStart(2, '0')}:${String(new Date(meet2.endAt).getMinutes()).padStart(2, '0')}` : null;
  check('끝 시각을 16:30 으로 고친다 (시작 15시)', endHm === '16:30', String(endHm));
  const lenText = await pp.ev(`document.querySelector('li.event[data-find-key="event:${meet.id}"] .end-time').textContent`);
  check('끝 시각 칸에 길이가 보인다 (1시간 30분)', lenText.includes(L('1시간 30분', '1 h 30 min')), lenText);
  await setEnd('14:00');
  const meet3 = JSON.parse(await main(`JSON.stringify(__jj.events.between(0, 4e12).find((e) => e.id === ${meet.id}))`));
  check('시작(15시)보다 이른 끝 시각은 받지 않는다', meet3.endAt === meet2.endAt);
  await shots(pp, 'event-endtime');
  // 반복 일정을 읽어 일정 시리즈와 다음 회차를 만든다
  await pp.ev(`document.querySelector('.event-add input').focus(); document.querySelector('.event-add input').select()`);
  await pp.type(L('매주 월요일 10시 스탠드업', 'every monday 10am standup'));
  await pp.enter();
  await sleep(500);
  await sleep(700);
  const recurring = JSON.parse(
    await main(`JSON.stringify(__jj.events.between(0, 4e12).find((e) => e.repeat === 'weekly' && e.title === ${JSON.stringify(L('스탠드업', 'standup'))}))`),
  );
  check('매주 월요일 10시 입력이 반복 일정으로 저장된다', !!recurring, JSON.stringify(recurring));
  const nextRecurring = recurring
    ? JSON.parse(
        await main(`JSON.stringify(__jj.events.between(${recurring.startAt + 1}, ${recurring.startAt + 8 * 86400000}).find((e) => e.repeat === 'weekly' && e.title === ${JSON.stringify(L('스탠드업', 'standup'))}))`),
      )
    : null;
  check('반복 일정의 다음 주 회차도 일정 목록에 생성된다', !!nextRecurring, JSON.stringify(nextRecurring));
  await shots(pp, 'event-repeat-created');
  await pp.ev(`document.querySelector('.event-add input').focus(); document.querySelector('.event-add input').select()`);
  await pp.type(L('매일 운동', 'daily workout'));
  await pp.enter();
  await sleep(400);
  const noTimeRepeat = await pp.ev(`!!document.querySelector('.hint.error .as-todo')`);
  const accidentalMidnight = JSON.parse(
    await main(`JSON.stringify(__jj.events.between(0, 4e12).some((e) => e.repeat === 'daily' && e.title === ${JSON.stringify(L('운동', 'workout'))}))`),
  );
  check('시각 없는 반복 일정은 자정 일정으로 잘못 저장하지 않고 할 일 경로를 안내한다', noTimeRepeat && !accidentalMidnight);
  await pp.click(`document.querySelector('.hint.error .as-todo')`);
  const repeatTodo = JSON.parse(
    await main(`JSON.stringify(__jj.store.list(Date.now()).open.some((t) => t.repeat === 'daily' && t.title === ${JSON.stringify(L('운동', 'workout'))}))`),
  );
  check('시각 없는 반복 입력은 안내를 눌러 반복 할 일로 넣을 수 있다', repeatTodo);
  check(
    '일정을 넣으면 입력칸이 비워지고 일정 줄이 나타난다',
    (await pp.ev(`document.querySelector('.event-add input').value`)) === '' &&
      (await pp.ev(`!!document.querySelector('li.event[data-find-key="event:${recurring?.id}"]')`)),
  );

  // ===== 10. 한 번에 찾기 =====
  await main("__jj.panel.openTab('today'); 1");
  await sleep(300);
  await pp.ev(`document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'k', code: 'KeyK', metaKey: true }))`);
  await sleep(400);
  check('Cmd+K 로 찾기 칸이 열리고 커서가 있다', await pp.ev(`document.activeElement?.closest?.('.find-sheet') !== null && document.activeElement.tagName === 'INPUT'`));
  await pp.type(L('치과', 'dental'));
  await sleep(700);
  const groupsFound = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.find-group h3')].map((h) => h.textContent))`));
  check('찾기: 할 일 말고 일정에서도 찾는다', groupsFound.includes(L('일정', 'Events')), groupsFound.join(','));
  await pp.ev(`document.activeElement.select()`);
  await pp.type(L('장보기', 'shopping'));
  await sleep(700);
  const g2 = JSON.parse(await pp.ev(`JSON.stringify([...document.querySelectorAll('.find-group h3')].map((h) => h.textContent))`));
  check('찾기: 메모에서도 찾는다 (제목과 본문)', g2.includes(L('메모', 'Notes')), g2.join(','));
  await shots(pp, 'find-all');
  await pp.ev(`document.querySelector('.find-input input')?.focus()`);
  await press(pp, 'Escape', { code: 'Escape' });
  await sleep(300);
  check('Esc 는 찾기만 닫는다 (패널은 그대로)', !(await pp.ev(`!!document.querySelector('.find-sheet')`)) && (await main('!!__jj.panel.window && !__jj.panel.window.isDestroyed()')));
  await pp.click(`document.querySelector('button[aria-label=${JSON.stringify(L('한 번에 찾기', 'Search everything'))}]')`);
  await sleep(300);
  await pp.type(L('치과', 'dental'));
  await sleep(700);
  await press(pp, 'Enter');
  await sleep(1000);
  check('일정 결과를 고르면 일정 탭으로 가서 그 줄에 초점', (await pp.ev(`document.querySelector('[role=tab][aria-selected=true]')?.id`)) === 'ptab-event' && (await pp.ev(`document.activeElement?.dataset?.findKey?.startsWith('event:')`)));
  await pp.ev(`document.querySelector('[role=tab][id=ptab-today]').click()`);
  await sleep(200);
  await pp.ev(`document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'k', code: 'KeyK', metaKey: true }))`);
  await sleep(300);
  await pp.type(L('우유', 'milk'));
  await sleep(700);
  await press(pp, 'Enter');
  await sleep(1000);
  check('메모 결과를 고르면 메모 편집기가 열린다', await pp.ev(`!!document.querySelector('.note-editor')`));
  // 할 일 결과
  await main(`__jj.store.add({ title: ${JSON.stringify(L('찾을 특별한 일', 'Special findable task'))} }, Date.now()); __jj.panel.refresh(); 1`);
  await pp.ev(`document.querySelector('[role=tab][id=ptab-today]').click()`);
  await sleep(300);
  await pp.ev(`document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'k', code: 'KeyK', metaKey: true }))`);
  await sleep(300);
  await pp.type(L('특별한', 'findable'));
  await sleep(700);
  await press(pp, 'Enter');
  await sleep(1000);
  check('할 일 결과를 고르면 할 일 탭에서 그 줄에 초점', (await pp.ev(`document.querySelector('[role=tab][aria-selected=true]')?.id`)) === 'ptab-todo' && (await pp.ev(`document.activeElement?.dataset?.findKey?.startsWith('todo:')`)));

  // ===== 11. 큰 창 1100: 줄 탭 정지점, 메뉴, 밝음과 어두움 =====
  await closePanel();
  await setView('window');
  await main("__jj.home.open('todo'); 1");
  await waitFor(homeAlive);
  await sleep(1200);
  await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 1100, height: 780 }); 1');
  await sleep(700);
  const hh = await page('home');
  await main(`(() => { const now = Date.now(); for (const t of __jj.store.list(now).open) __jj.store.remove(t.id, now); __jj.panel.refresh(); return 1; })()`);
  await seed(NOW, D.today, 12);
  await main('__jj.panel.refresh(); 1');
  await sleep(600);
  const wideRows = await hh.ev(`document.querySelectorAll('.todos li.todo[data-id]').length`);
  check('큰 창 1100: 할 일 줄이 그려진다', wideRows >= 10, String(wideRows));
  check('큰 창 1100: 줄 하나만 탭 정지점', (await hh.ev(`document.querySelectorAll('.todos li.todo[tabindex="0"]').length`)) === 1);
  await hh.ev(`document.querySelector('.todos li.todo[tabindex="0"]').focus()`);
  await press(hh, 'ArrowDown');
  await sleep(300);
  check('큰 창: 화살표로 줄을 옮기면 상세 칸이 따라간다', await hh.ev(`document.querySelector('.todo-detail .detail-title')?.value === document.activeElement?.querySelector('.title-text')?.textContent`), await hh.ev(`JSON.stringify({ d: document.querySelector('.todo-detail .detail-title')?.value, a: document.activeElement?.className, t: document.activeElement?.querySelector?.('.title-text')?.textContent })`));
  await press(hh, 'Enter');
  await sleep(300);
  check('큰 창: Enter 는 상세 칸 제목으로', await hh.ev(`document.activeElement?.classList.contains('detail-title')`));
  const bigOver = await overflow(hh, '.surface.home');
  check('큰 창 1100: 가로 넘침 없음', bigOver.length === 0, bigOver.join(', '));
  await hh.click(`document.querySelectorAll('.todos li.todo[data-id] .row-more')[2]`);
  await sleep(300);
  const wideMenu = JSON.parse(await hh.ev(`JSON.stringify([...document.querySelectorAll('.row-menu button')].map((b) => b.textContent.trim()))`));
  check('큰 창: 줄 메뉴에 진행 중, 고정, 중요, 순서, 지우기 (마감과 반복은 상세 칸)', wideMenu.length >= 7 && !wideMenu.some((l) => l.includes(L('반복', 'Repeat'))), wideMenu.join(' / '));
  await press(hh, 'Escape', { code: 'Escape' });
  await sleep(200);
  await shots(hh, 'todo-w1100');
  await closeHome();
  await setView('compact');

  // ===== 12. 영어 화면에 한글이 없다 =====
  if (!ko) {
    const pp2 = await openCompactPanel(360, 680, 'todo');
    const text = await pp2.ev(`document.body.innerText`);
    check('영어 화면에 한글이 없다', !/[가-힣]/.test(text.replace(/Item|항목/g, '')), (text.match(/[가-힣]+/g) ?? []).slice(0, 5).join(','));
  }
};

try {
  if (process.env.BASELINE) {
    await baseline();
  } else {
    await body();
  }
} catch (err) {
  check('시험이 끝까지 돌았다', false, err instanceof Error ? err.stack : String(err));
} finally {
  await cleanup();
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
