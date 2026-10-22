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
//   화면: 폭 760/1100/1440 x 밝음/어두움 찍기와 가로 넘침, 구역마다, 사이드바(구역, 채팅과 친구는 따로 창, 설정), 단축키(Cmd+1~, Cmd+, Cmd+W),
//     빠른 입력으로 넣은 할 일이 큰 창에 바로 보임, 사이드바 체크와 설정 칸이 같은 panelView 를 바꿈
//   ko/en: 영어 화면에 한글 없음, "모드" 라는 낱말 없음
//   오늘과 일정의 넓은 배치 (이슈 #162): 구간별(작은 패널 320/360/560, 큰 창 760/1100/1440) 찍기와 넘침, 오늘 첫 화면 순서(일정, 다음 할 일, 마감이 맨 위),
//     넓음(>=860)에서만 두 열("할 것"/"나와 펫"), 못 한 N개 내일로(옮기고 되돌리기), 일정 큰 월 보기(칸 안 제목, 넘치면 +N)와 옆 날 목록
//   할 일과 메모의 넓은 배치 (이슈 #163): 태그 칸, 목록, 상세 칸 세 열(고치면 목록에 바로 반영, 키보드 이동), 메모 목록과 편집기 나란히,
//     편집기가 갈아 끼워지는 순간마다 저장된 글 세기(다른 메모 누르기, 곧바로 돌아오기, 숨기기, 탭 바꾸기, 창 닫기, 거절 상태), 760 미만 한 열 복귀,
//     구역별 찍기와 넘침, 작은 패널 320/360/560 회귀. LISTS_ONLY=1 이면 이 부분만, LISTS_BASELINE=1 이면 옛 판 비교 그림용 찍기만
//   WIDE_ONLY=1 이면 이 부분만 돈다. BASELINE=1 을 더하면 확인 없이 같은 자료로 찍기만 한다 (옛 판에서 전후 비교 그림 만들 때)
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

  if (process.env.LISTS_ONLY) {
    await listsLayouts();
    return;
  }
  if (process.env.WIDE_ONLY) {
    await wideLayouts();
    return;
  }

  /**
   * 할 일과 메모의 넓은 배치 (이슈 #163). 본문 칸이 넓음(>=860, 큰 창 폭 1068 이상)이면 할 일은 태그 칸, 목록, 상세 칸 세 열이고
   * 메모는 목록과 편집기가 나란히다. 좁으면 지금처럼 한 열. 메모는 편집기가 "갈아 끼워지는" 순간(다른 메모 누르기, 곧바로 돌아오기,
   * 큰 창 숨기기, 탭 바꾸기, 창 닫기, 다른 곳이 먼저 고친 상태)마다 저장된 글을 숫자로 센다.
   * LISTS_ONLY=1 이면 이 부분만 돈다. LISTS_BASELINE=1 이면 확인 없이 같은 자료로 할 일 1100 만 찍는다 (옛 판 비교 그림용)
   */
  async function listsLayouts() {
    const dayMs = 86_400_000;
    const dayStr = (ms) =>
      main(`(() => { const d = new Date(${ms}); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`);
    const tomorrow = await dayStr(dayStart + dayMs);
    const T = {
      laundry: tx('#집 빨래 널기', '#home Hang laundry'),
      report: tx('#일 분기 보고서 쓰기', '#work Write quarterly report'),
      mail: tx('#일 메일 정리', '#work Clean inbox'),
      groceries: tx('#집 장보기 목록 만들기', '#home Make a grocery list'),
      book: tx('책 반납하기', 'Return the book'),
    };
    const addTodo = (title, extra = {}) =>
      main(`__jj.store.add({ title: ${JSON.stringify(title)}, ...${JSON.stringify(extra)} }, ${NOW}).id`);
    const ids = {
      laundry: await addTodo(T.laundry, { due: tomorrow }),
      report: await addTodo(T.report, { important: true, due: todayStr }),
      mail: await addTodo(T.mail),
      groceries: await addTodo(T.groceries),
      book: await addTodo(T.book),
    };
    await main(`__jj.store.addSteps(${ids.laundry}, ${JSON.stringify([tx('세탁기 돌리기', 'Run the washer'), tx('건조대에 널기', 'Hang to dry')])}, ${NOW}); 1`);
    const N = {};
    for (const [key, title, body] of [
      ['a', tx('독서 메모', 'Reading notes'), tx('1장 요약\n2장 요약', 'Chapter 1 summary\nChapter 2 summary')],
      ['b', tx('회의록', 'Meeting minutes'), tx('안건 하나\n안건 둘', 'Agenda one\nAgenda two')],
      ['c', tx('여행 계획', 'Trip plan'), tx('교토 3박\n오사카 1박', 'Kyoto 3 nights\nOsaka 1 night')],
    ])
      N[key] = await main(`__jj.notes.add({ title: ${JSON.stringify(title)}, body: ${JSON.stringify(body)} }, ${NOW}).id`);
    await sleep(400);

    await closeHome();
    await closePanel();
    await main("__jj.home.open('todo'); 1");
    await waitFor(homeAlive);
    await sleep(1200);
    let wh = await page('home');
    const setBounds = async (w, h = 780) => {
      await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: ${h} }); 1`);
      await sleep(700);
    };
    const tab = async (id) => {
      await wh.click(`document.getElementById('ptab-${id}')`);
      await sleep(450);
    };
    const pos = (sel) =>
      wh.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
    const shown = (sel) => wh.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`);

    if (process.env.LISTS_BASELINE) {
      await setBounds(1100);
      await tab('todo');
      await wh.dark(false);
      await wh.ev(`(() => { const e = [...document.querySelectorAll('li.todo .title-text')].find((x) => x.textContent.includes(${JSON.stringify(tx('분기', 'quarterly'))})); e?.scrollIntoView(); return true; })()`);
      await wh.shot('lists-todo-w1100-light');
      return;
    }

    const todoOf = (id) => main(`JSON.stringify(__jj.store.get(${id}))`).then((j) => JSON.parse(j));
    const openOf = () => main(`JSON.stringify(__jj.store.list(Date.now()).open.map((t) => t.id))`).then((j) => JSON.parse(j));
    const rowTitle = (part) => `[...document.querySelectorAll('li.todo .title-text')].find((e) => e.textContent.includes(${JSON.stringify(part)}))`;
    const pickRow = async (part) => {
      // 제목 글자의 왼쪽 위 끝을 누른다 (제목이 두 줄로 접히면 가운데는 줄 사이 빈틈이다)
      await wh.ev(`(() => { const e = ${rowTitle(part)}; e?.scrollIntoView({ block: 'center', behavior: 'instant' }); return !!e; })()`);
      await sleep(150);
      const at = await wh.ev(`(() => { const e = ${rowTitle(part)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; })()`);
      if (!at) return false;
      await wh.clickAt(at.x, at.y);
      await sleep(250);
      return true;
    };
    const setValue = (sel, v) =>
      wh.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const key = (k, code, vk) => wh.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });

    // =========================== 할 일 ===========================
    for (const w of [760, 1100, 1440]) {
      await setBounds(w);
      await tab('todo');
      const wideNow = (await wh.ev(`document.getElementById('ptab-panel').dataset.zone`)) === 'wide';
      const mark = `폭 ${w}`;
      const layout = await pos('.todo-layout');
      check(`${mark} 할 일: ${wideNow ? '세 열' : '한 열'} (.wide ${wideNow ? '있음' : '없음'})`, !!layout && (await wh.ev(`document.querySelector('.todo-layout').classList.contains('wide')`)) === wideNow);
      if (wideNow) {
        const tags = await pos('.todo-tags');
        const main_ = await pos('.todo-main');
        const detail = await pos('.todo-detail');
        check(`${mark} 할 일: 태그 칸, 목록, 상세 칸이 왼쪽부터 차례로 놓인다`, !!tags && !!main_ && !!detail && tags.r <= main_.x + 1 && main_.r <= detail.x + 1, JSON.stringify({ tags: tags?.x, main: main_?.x, detail: detail?.x }));
        check(`${mark} 할 일: 목록 폭이 320 이상 (${Math.round(main_?.w ?? 0)})`, (main_?.w ?? 0) >= 320);
        check(`${mark} 할 일: 태그 칩은 가로 줄이 아니라 왼쪽 세로 칸 (목록 위에 칩 줄 없음)`, !(await wh.ev(`!!document.querySelector('.todo-main > .tag-chips')`)) && (await wh.ev(`getComputedStyle(document.querySelector('.tag-col')).flexDirection`)) === 'column');
      } else {
        check(`${mark} 할 일: 태그 칸과 상세 칸이 안 보이고 태그 칩이 목록 위 가로 줄`, !(await shown('.todo-tags')) && !(await shown('.todo-detail')) && (await wh.ev(`!!document.querySelector('.todo-main > .tag-chips')`)) && (await wh.ev(`getComputedStyle(document.querySelector('.todo-main > .tag-chips')).flexDirection`)) === 'row');
        check(`${mark} 할 일: 줄 끝 단추(.extra)가 예전 그대로 있다`, (await wh.ev(`document.querySelectorAll('li.todo .tools .extra').length`)) > 0);
      }
      for (const dark of [false, true]) {
        await wh.dark(dark);
        await sleep(200);
        if (wideNow) await pickRow(tx('분기', 'quarterly'));
        await wh.shot(`lists-todo-w${w}-${dark ? 'dark' : 'light'}`);
        const over = await overflow(wh);
        check(`${mark} 할 일: 가로 넘침 없음 ${dark ? '어두움' : '밝음'}`, over.length === 0, over.join(', '));
      }
      await wh.dark(false);
    }

    // ---- 넓음(1100) 할 일 동작 ----
    await setBounds(1100);
    await tab('todo');
    const nTodoRows = await wh.ev(`document.querySelectorAll('li.todo').length`);
    // 태그 칸
    const tagTexts = await wh.ev(`JSON.stringify([...document.querySelectorAll('.tag-col .len-chip')].map((e) => e.textContent))`);
    const homeTag = tx('집', 'home');
    const chipOf = (name) => `[...document.querySelectorAll('.tag-col .len-chip')].find((e) => e.textContent.startsWith('#${name}'))`;
    check('태그 칸에 모두와 #집(#home) #일(#work) 이 개수와 함께 있다', JSON.parse(tagTexts).length >= 3 && JSON.parse(tagTexts)[0] === tx('모두', 'All') && JSON.parse(tagTexts).some((x) => x.startsWith(`#${homeTag}`) && x.endsWith('2')), tagTexts);
    await wh.click(chipOf(homeTag));
    await sleep(300);
    const homeRows = await wh.ev(`[...document.querySelectorAll('li.todo .title-text')].map((e) => e.textContent).join('|')`);
    check('#집 태그를 누르면 목록이 그 태그 할 일 둘만 남는다', (await wh.ev(`document.querySelectorAll('li.todo').length`)) === 2 && homeRows.includes(tx('빨래', 'laundry')) && homeRows.includes(tx('장보기', 'grocery')), homeRows);
    await wh.click(chipOf(homeTag));
    await sleep(300);
    check('같은 태그를 다시 누르면 전체로', (await wh.ev(`document.querySelectorAll('li.todo').length`)) === nTodoRows);

    const pickHint = tx('할 일을 고르면 여기서 마감, 단계, 알림, 반복을 고칠 수 있어.', 'Pick a to-do to edit its due date, steps, reminders and repeat here.');
    // 고르기
    await pickRow(tx('빨래', 'laundry'));
    const sel1 = await wh.ev(`JSON.stringify({ rows: document.querySelectorAll('li.todo.selected').length, title: document.querySelector('.detail-title')?.value, rowTitle: document.querySelector('li.todo.selected .title-text')?.textContent })`);
    const s1 = JSON.parse(sel1);
    check('줄을 누르면 그 줄만 선택 표시되고 상세 칸에 제목이 열린다', s1.rows === 1 && s1.title === T.laundry && s1.rowTitle === T.laundry, sel1);
    check('줄을 눌러도 제목 고치기 칸이 줄 안에서 열리지 않는다 (고치기는 상세 칸)', !(await wh.ev(`!!document.querySelector('li.todo .title-edit')`)));
    check('상세 칸에 마감, 단계, 알림, 반복, 끝내기, 지우기가 있다', await wh.ev(`!!document.querySelector('.detail-date') && !!document.querySelector('.detail .step-sheet') && !!document.querySelector('.detail .remind-btn') && document.querySelectorAll('.detail-repeat .len-chip').length === 5 && [...document.querySelectorAll('.detail-actions button')].some((b) => b.classList.contains('primary'))`));
    check('상세 칸 단계에 이 할 일의 단계 둘이 보인다', (await wh.ev(`document.querySelectorAll('.detail .step').length`)) === 2);

    // 상세에서 고치면 목록에 바로 반영: 마감
    await setValue('.detail-date', tomorrow);
    await sleep(500);
    const d1 = await todoOf(ids.laundry);
    check('상세 칸 마감 고치기: 저장소 마감이 바뀐다', d1.due === tomorrow, d1.due);
    await setValue('.detail-date', todayStr);
    await sleep(500);
    check('상세 칸 마감 고치기: 목록 줄의 마감 칩이 바로 바뀐다 (오늘)', (await wh.ev(`document.querySelector('li.todo.selected .due-btn')?.textContent ?? ''`)).includes(tx('오늘', 'Today')) && (await todoOf(ids.laundry)).due === todayStr, await wh.ev(`document.querySelector('li.todo.selected .due-btn')?.textContent ?? ''`));
    // 마감 시각
    await setValue('.detail-time', '15:30');
    await sleep(500);
    check('상세 칸 마감 시각: 15:30 이 분(930)으로 저장된다', (await todoOf(ids.laundry)).dueMin === 930, String((await todoOf(ids.laundry)).dueMin));
    // 알림
    const remindsBefore = (await todoOf(ids.laundry)).reminds;
    await wh.click(`document.querySelector('.detail .remind-btn')`);
    await sleep(300);
    await wh.click(`[...document.querySelectorAll('.detail .rs-chip')].find((c) => c.getAttribute('aria-pressed') === 'false')`);
    await sleep(500);
    const reminds = (await todoOf(ids.laundry)).reminds;
    check('상세 칸 알림: 꺼진 칩을 누르면 알림이 하나 늘고 알림 단추 개수도 바뀐다', reminds.length === remindsBefore.length + 1 && (await wh.ev(`document.querySelector('.detail .remind-count')?.textContent ?? '1'`)) === String(reminds.length), `${JSON.stringify(remindsBefore)} -> ${JSON.stringify(reminds)}`);
    await wh.click(`document.querySelector('.detail .rs-close')`);
    await sleep(200);
    // 반복
    await wh.click(`[...document.querySelectorAll('.detail-repeat .len-chip')].find((b) => b.textContent === ${JSON.stringify(tx('매주', 'Weekly'))})`);
    await sleep(500);
    check('상세 칸 반복: 매주를 누르면 저장소 반복이 weekly, 목록 줄에 반복 표시', (await todoOf(ids.laundry)).repeat === 'weekly' && (await wh.ev(`!!document.querySelector('li.todo.selected .repeat-badge')`)));
    check('반복 칩은 누른 하나만 눌림 표시', (await wh.ev(`document.querySelectorAll('.detail-repeat .len-chip[aria-pressed="true"]').length`)) === 1);
    // 단계 더하기
    await wh.ev(`document.querySelector('.detail .step-add').focus(); 1`);
    await wh.type(tx('빨래집게 챙기기', 'Bring clothespins'));
    await wh.enter();
    await sleep(600);
    const steps = (await todoOf(ids.laundry)).steps;
    check('상세 칸 단계 더하기: 단계가 셋이 되고 목록 줄 표시가 0/3', steps.length === 3 && (await wh.ev(`document.querySelector('li.todo.selected .steps-badge')?.textContent ?? ''`)).includes('0/3'), `${steps.length} ${await wh.ev(`document.querySelector('li.todo.selected .steps-badge')?.textContent ?? ''`)}`);
    // 제목 고치기 (멈추면 저장, 목록에 바로 반영)
    await wh.ev(`(() => { const e = document.querySelector('.detail-title'); e.focus(); e.select(); return true; })()`);
    await wh.type(tx('#집 빨래 널고 개기', '#home Hang and fold laundry'));
    await sleep(900);
    const t1 = (await todoOf(ids.laundry)).title;
    check('상세 칸 제목 고치기: 멈추면 저장되고 목록 줄 제목이 바로 바뀐다', t1 === tx('#집 빨래 널고 개기', '#home Hang and fold laundry') && (await wh.ev(`document.querySelector('li.todo.selected .title-text')?.textContent ?? ''`)).includes(tx('개기', 'fold')), t1);
    // 중요
    await wh.click(`document.querySelector('.detail-actions .star')`);
    await sleep(400);
    check('상세 칸 별: 중요가 켜지고 목록 줄 별도 켜진다', (await todoOf(ids.laundry)).important === true && (await wh.ev(`!!document.querySelector('li.todo.selected .star.on')`)));

    // 다른 할 일을 고르면 상세가 바뀐다
    await pickRow(tx('분기', 'quarterly'));
    const sel2 = await wh.ev(`document.querySelector('.detail-title')?.value`);
    check('다른 줄을 고르면 상세 칸이 그 할 일로 바뀐다', sel2 === T.report, sel2);
    check('앞 할 일의 고친 값은 그대로 남았다 (제목, 반복)', (await todoOf(ids.laundry)).repeat === 'weekly' && (await todoOf(ids.laundry)).title.includes(tx('개기', 'fold')));
    // 제목을 고치다 곧바로 다른 줄을 누르면 고친 제목이 저장된다
    await wh.ev(`(() => { const e = document.querySelector('.detail-title'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); return true; })()`);
    await wh.type(tx('!', '!'));
    await pickRow(tx('메일 정리', 'inbox'));
    await sleep(500);
    check('제목을 고치다 곧바로 다른 줄을 눌러도 고친 제목이 저장된다', (await todoOf(ids.report)).title === `${T.report}!`, (await todoOf(ids.report)).title);
    check('다른 줄로 옮겨도 그 줄 제목은 남의 것과 섞이지 않는다', (await todoOf(ids.mail)).title === T.mail);

    // 키보드
    await wh.ev(`(() => { document.querySelector('li.todo .title').focus(); return true; })()`);
    const firstId = await wh.ev(`document.activeElement.closest('li.todo').dataset.id`);
    await key('ArrowDown', 'ArrowDown', 40);
    await sleep(250);
    const kb1 = await wh.ev(`JSON.stringify({ active: document.activeElement.closest('li.todo')?.dataset.id, sel: document.querySelector('li.todo.selected')?.dataset.id })`);
    const k1 = JSON.parse(kb1);
    check('키보드: 아래 화살표가 다음 줄로 옮기고 선택과 포커스가 같다', k1.active === k1.sel && k1.sel !== firstId, kb1);
    await key('ArrowUp', 'ArrowUp', 38);
    await sleep(250);
    check('키보드: 위 화살표가 앞 줄로 돌아온다', (await wh.ev(`document.querySelector('li.todo.selected')?.dataset.id`)) === firstId);
    await key('Enter', 'Enter', 13);
    await sleep(250);
    check('키보드: Enter 가 상세 칸 제목에 커서를 둔다', await wh.ev(`document.activeElement?.classList.contains('detail-title')`));
    check('키보드: 상세 칸 제목은 고른 할 일의 것', (await wh.ev(`document.querySelector('.detail-title').value`)) === (await wh.ev(`document.querySelector('li.todo.selected .title-text').textContent`)));
    await key('Escape', 'Escape', 27);
    await sleep(250);
    check('키보드: Esc 가 목록의 그 줄로 돌아온다', (await wh.ev(`document.activeElement?.closest('li.todo')?.dataset.id`)) === firstId);

    // 날짜, 시각 칸을 키보드로 고치는 도중 (버그잡이 163-1): 덜 찬 값이 마감, 시각, 알림을 지우면 안 된다
    const keyUp = (k, code, vk, text) =>
      wh.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }).then(() =>
        wh.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }),
      );
    await pickRow(tx('빨래', 'laundry'));
    // 반복 할 일은 마감을 없앨 수 없다(저장소 규칙): 반복을 끄고 시험한다
    await main(`__jj.store.update(${ids.laundry}, { dueMin: 600, repeat: null }, Date.now()); 1`);
    await sleep(400);
    const dBefore = await todoOf(ids.laundry);
    await main(`(() => { globalThis.__dueLog = []; const s = __jj.store; if (!s.__upd) { s.__upd = s.update; s.update = (id, p, now) => { globalThis.__dueLog.push(JSON.stringify(p)); return s.__upd(id, p, now); }; } return 1; })()`);
    await wh.ev(`document.querySelector('.detail-date').focus(); 1`);
    await keyUp('Backspace', 'Backspace', 8);
    await sleep(500);
    const dMid = await todoOf(ids.laundry);
    check('날짜 칸 연도를 Backspace 로 지운 도중에도 마감, 시각, 알림이 그대로다', dMid.due === dBefore.due && dMid.dueMin === 600 && dMid.reminds.length === dBefore.reminds.length && dBefore.reminds.length > 0, JSON.stringify([dMid.due, dMid.dueMin, dMid.reminds]));
    // 칸 순서는 언어마다 다르다(en 은 월, 일, 연): 연도가 끝까지 찰 때까지 한 번 더 친다
    for (const d of '20272027') await keyUp(d, `Digit${d}`, 48 + Number(d), d);
    await sleep(800);
    const dAfter = await todoOf(ids.laundry);
    const sent = JSON.parse(await main('JSON.stringify(globalThis.__dueLog)'));
    check('치는 도중 값(마감 null, 연도 1000 미만)은 메인에 한 번도 안 보낸다', !sent.some((x) => /"due":null/.test(x) || /"due":"0/.test(x)), JSON.stringify(sent));
    check('칸을 다 치면(칸 순서는 언어마다 다르다) 그때 마감이 바뀌고 시각과 알림은 남는다', /^\d{4}-\d{2}-\d{2}$/.test(dAfter.due ?? '') && dAfter.due !== dBefore.due && dAfter.dueMin === 600, JSON.stringify([dAfter.due, dAfter.dueMin, dAfter.reminds, await wh.ev(`document.querySelector('.detail-date')?.value`), sent]));
    check('치는 칸이 돌아온 값에 덮이지 않고 포커스가 남아 있다', (await wh.ev(`document.activeElement?.classList.contains('detail-date')`)) === true);
    await wh.ev(`document.querySelector('.detail-time').focus(); 1`);
    await keyUp('Backspace', 'Backspace', 8);
    await sleep(500);
    const tMid = await todoOf(ids.laundry);
    const sent2 = JSON.parse(await main('JSON.stringify(globalThis.__dueLog)'));
    check('시각 칸을 Backspace 로 비운 도중에도 시각이 안 지워진다 (null 을 보내지 않는다)', tMid.dueMin === 600 && tMid.due === dAfter.due && !sent2.some((x) => /"dueMin":null/.test(x)), JSON.stringify([tMid.due, tMid.dueMin]));
    await wh.ev(`document.activeElement.blur(); 1`);
    await sleep(300);
    check('칸을 떠나면 저장된 값으로 돌아온다 (시각 10:00)', (await wh.ev(`document.querySelector('.detail-time').value`)) === '10:00');
    await wh.click(`document.querySelector('.detail-due .ghost')`);
    await sleep(500);
    check('"시각 지우기" 단추로만 시각이 지워진다', (await todoOf(ids.laundry)).dueMin === null);
    await wh.click(`[...document.querySelectorAll('.detail-due .ghost')].find((b) => b.textContent === ${JSON.stringify(tx('마감 없애기', 'Clear due date'))})`);
    await sleep(500);
    check('"마감 없애기" 단추로만 마감이 지워진다', (await todoOf(ids.laundry)).due === null, JSON.stringify(await todoOf(ids.laundry)).slice(0, 160));
    await setValue('.detail-date', todayStr);
    await sleep(400);

    // 끝내기: 상세에서 끝내면 끝난 일이 되고 상세는 안내로
    await pickRow(tx('책 반납', 'book'));
    await wh.click(`document.querySelector('.detail-actions .primary')`);
    await sleep(700);
    const openIds = await openOf();
    check('상세 칸 끝내기: 끝난 일이 되어 목록에서 빠지고 상세 칸은 안내 글로 돌아간다', !openIds.includes(ids.book) && !(await wh.ev(`!!document.querySelector('.detail-title')`)) && (await wh.ev(`document.querySelector('.todo-detail .todo-col-empty')?.textContent ?? ''`)) === pickHint);
    // 지우기
    await pickRow(tx('메일 정리', 'inbox'));
    await wh.click(`[...document.querySelectorAll('.detail-actions button')].find((b) => b.classList.contains('ghost'))`);
    await sleep(600);
    const undoToast = await wh.ev(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|')`);
    check('상세 칸 지우기: 목록에서 빠지고 되돌리기 알림이 뜬다', !(await openOf()).includes(ids.mail) && undoToast.includes(tx('되돌리기', 'Undo')), `${JSON.stringify(await openOf())} ${undoToast}`);
    await wh.click(`[...document.querySelectorAll('.toast .undo')].at(-1)`);
    await sleep(600);
    check('지우기를 되돌리면 같은 할 일이 돌아온다', (await openOf()).includes(ids.mail));

    // 가려진 선택
    await pickRow(tx('분기', 'quarterly'));
    await wh.click(chipOf(homeTag));
    await sleep(300);
    check('고른 할 일이 태그 거르기로 목록에서 가려지면 상세 칸도 안내로', !(await wh.ev(`!!document.querySelector('.detail-title')`)));
    await wh.click(`document.querySelector('.tag-col .len-chip')`);
    await sleep(300);

    // 폭을 760 으로 줄이면 한 열로 돌아오고 앞에서 고르던 것이 망가지지 않는다
    await pickRow(tx('분기', 'quarterly'));
    await setBounds(760);
    check('1100 에서 760 으로 줄이면 한 열 (태그 칸, 상세 칸 사라짐, 칩은 가로 줄)', !(await shown('.todo-tags')) && !(await shown('.todo-detail')) && (await wh.ev(`!!document.querySelector('.todo-main > .tag-chips')`)));
    check('한 열로 돌아와도 할 일 줄은 모두 있다 (예전 줄 끝 단추 포함)', (await wh.ev(`document.querySelectorAll('li.todo').length`)) >= 3 && (await wh.ev(`document.querySelectorAll('li.todo .tools .extra').length`)) > 0);
    await wh.click(rowTitle(tx('분기', 'quarterly')));
    await sleep(300);
    check('한 열에서 제목을 누르면 예전처럼 줄 안에서 고치기 칸이 열린다', await wh.ev(`!!document.querySelector('li.todo .title-edit')`));
    await key('Escape', 'Escape', 27);
    await setBounds(1100);
    check('다시 1100 으로 넓히면 세 열로 돌아온다', await shown('.todo-detail'));

    // =========================== 메모 ===========================
    await tab('note');
    const noteOf = (id) => main(`JSON.stringify(__jj.notes.get(${id}))`).then((j) => JSON.parse(j));
    const noteBody = async (id) => (await noteOf(id)).body;
    const rowBtn = (part) => `[...document.querySelectorAll('li.note-row')].find((r) => r.textContent.includes(${JSON.stringify(part)}))?.querySelector('button')`;
    const nA = tx('독서 메모', 'Reading notes');
    const nB = tx('회의록', 'Meeting minutes');
    const nC = tx('여행 계획', 'Trip plan');
    const openNote = async (part) => {
      await wh.click(rowBtn(part));
      await sleep(500);
    };
    const type = async (text) => {
      await wh.ev(`(() => { const e = document.querySelector('.note-editor textarea'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); return true; })()`);
      await wh.type(text);
    };
    const editorBody = () => wh.ev(`document.querySelector('.note-editor textarea')?.value ?? null`);
    const resetHome = async (tabId = 'note') => {
      await closeHome();
      await main(`__jj.home.open('${tabId}'); 1`);
      await waitFor(homeAlive);
      await sleep(1200);
      wh = await page('home');
      await setBounds(1100);
    };

    const noteLayout = await wh.ev(`document.querySelector('.note-layout')?.className ?? ''`);
    check('1100 메모: 나란히 보기 (.split) 이고 아직 안 골랐으면 안내 글', noteLayout.includes('split') && (await shown('.note-pane-empty')) && !(await shown('.note-editor')), noteLayout);
    await openNote(nA);
    const lp = await pos('.note-list-pane');
    const ed = await pos('.note-editor');
    check('메모를 고르면 오른쪽에 편집기가 열리고 목록은 왼쪽에 그대로 있다', !!lp && !!ed && lp.r <= ed.x + 1 && lp.w > 200 && ed.w > 300 && (await wh.ev(`document.querySelectorAll('li.note-row').length`)) >= 3, JSON.stringify({ list: lp?.w, editor: ed?.w }));
    await wh.shot('lists-note-clean-w1100-light');
    check('열린 메모 줄에 현재 표시', (await wh.ev(`document.querySelector('li.note-row.current')?.textContent.includes(${JSON.stringify(nA)})`)) === true);
    check('나란히 볼 때는 "메모" 뒤로 단추가 안 보인다', !(await shown('.note-bar .back')));
    check('편집기에 고르기 전 글이 그대로 들어 있다', (await editorBody()) === (await noteBody(N.a)));

    // (a) 고치다 곧바로 다른 메모를 누른다
    const baseA = await noteBody(N.a);
    await type(' +A1');
    await wh.click(rowBtn(nB));
    await sleep(900);
    check('(a) 고치다 곧바로 다른 메모를 누르면 앞 메모에 고친 글이 저장된다', (await noteBody(N.a)) === `${baseA} +A1`, JSON.stringify(await noteBody(N.a)));
    check('(a) 새로 연 메모 편집기는 그 메모 글 (섞이지 않음)', (await editorBody()) === (await noteBody(N.b)) && !(await editorBody()).includes('+A1'));
    // (b) 고치다 다른 메모 갔다 곧바로 돌아온다
    const baseB = await noteBody(N.b);
    await type(' +B1');
    await wh.click(rowBtn(nA));
    await wh.click(rowBtn(nB));
    await sleep(900);
    const bBody = await noteBody(N.b);
    check('(b) 고치다 다른 메모를 눌렀다 곧바로 돌아와도 고친 글이 저장돼 있다', bBody === `${baseB} +B1`, JSON.stringify(bBody));
    check('(b) 돌아와 연 편집기가 방금 쓴 글을 보여 준다 (옛 글이 아니다)', (await editorBody()) === bBody, JSON.stringify(await editorBody()));
    await type(' +B2');
    await sleep(900);
    check('(b) 돌아와서 더 쓴 글도 거절 없이 저장된다', (await noteBody(N.b)) === `${baseB} +B1 +B2` && !(await shown('.note-stale')), JSON.stringify(await noteBody(N.b)));
    // 글자 수 합계: 세 메모에서 사라진 글이 없다
    const total1 = (await noteBody(N.a)).length + (await noteBody(N.b)).length + (await noteBody(N.c)).length;
    check(`(a, b) 세 메모 글자 수 합 ${total1} 이 시작 합 + 쓴 글자와 같다`, total1 === baseA.length + 4 + baseB.length + 8 + (await noteBody(N.c)).length, String(total1));

    // (c) 큰 창 숨기기
    await type(' +H1');
    await main('__jj.home.hide(); 1');
    // 자동 저장(0.4초 멈춤)보다 먼저: 숨기는 순간 바로 보내야 한다
    await sleep(200);
    check('(c) 고치다 큰 창을 숨기면 자동 저장을 기다리지 않고 바로 저장된다', (await noteBody(N.b)).endsWith(' +B1 +B2 +H1'), JSON.stringify(await noteBody(N.b)));
    await main('__jj.home.open(); 1');
    await sleep(700);
    wh = await page('home');
    check('(c) 다시 보이면 편집기가 그 글로 그대로 열려 있다', (await editorBody()) === (await noteBody(N.b)));

    // (d) 탭 바꾸기
    await type(' +T1');
    await tab('todo');
    await sleep(700);
    check('(d) 고치다 할 일 탭으로 바꾸면 고친 글이 저장된다', (await noteBody(N.b)).endsWith(' +H1 +T1'), JSON.stringify(await noteBody(N.b)));
    await tab('note');
    await sleep(700);
    check('(d) 메모 탭으로 돌아오면 목록이고, 그 메모를 열면 고친 글이 그대로 있다', !(await shown('.note-editor')) && (await shown('.note-list-pane')), '');
    await openNote(nB);
    check('(d) 다시 연 메모에 고친 글이 들어 있다', (await editorBody()) === (await noteBody(N.b)), JSON.stringify(await editorBody()));

    // (e) 창 닫기
    await type(' +W1');
    const beforeClose = await noteBody(N.b);
    await main('__jj.home.window.close(); 1');
    await sleep(1200);
    check('(e) 고치다 큰 창을 닫으면 고친 글이 저장된다', (await noteBody(N.b)) === `${beforeClose} +W1`, JSON.stringify(await noteBody(N.b)));
    await main("__jj.home.open('note'); 1");
    await waitFor(homeAlive);
    await sleep(1400);
    wh = await page('home');
    await setBounds(1100);
    check('(e) 다시 열면 닫을 때 열려 있던 메모가 저장된 글로 열린다 (보관 글이 남아 되살리지 않는다)', (await editorBody()) === (await noteBody(N.b)) && !(await shown('.note-stale')), JSON.stringify(await editorBody()));

    // (f) 다른 곳이 먼저 고쳤다 (거절): 같은 메모에 단추가 붙고, 다른 메모를 갔다 와도 그 메모에 붙어 있다
    await openNote(nA);
    const baseA2 = await noteBody(N.a);
    await type(' +MINE');
    await main(`__jj.notes.update(${N.a}, { body: 'ELSEWHERE' }, Date.now() + 5000); 1`);
    await sleep(1400);
    check('(f) 다른 곳이 먼저 고친 메모를 저장하면 거절 안내와 세 단추가 그 편집기에 뜬다', (await shown('.note-stale')) && (await wh.ev(`document.querySelectorAll('.note-stale button').length`)) === 3, String(await wh.ev(`document.querySelectorAll('.note-stale button').length`)));
    check('(f) 거절되면 저장된 글은 그대로 ELSEWHERE, 내 글은 편집기에 있다', (await noteBody(N.a)) === 'ELSEWHERE' && (await editorBody()).endsWith('+MINE'), JSON.stringify(await noteBody(N.a)));
    await openNote(nC);
    check('(f) 다른 메모(C)로 가면 그 편집기에는 거절 단추가 없다 (A 에 붙어 있다)', !(await shown('.note-stale')) && (await editorBody()) === (await noteBody(N.c)));
    const keptA = JSON.parse(await wh.ev(`JSON.stringify(window.jjakkungPanel.noteKeepGet(${N.a}))`));
    check('(f) A 의 내 글과 거절 상태는 메인 보관 글에 남아 있다', keptA?.draft?.body === `${baseA2} +MINE` && keptA?.conflict?.body === 'ELSEWHERE', JSON.stringify(keptA)?.slice(0, 160));
    check('(f) C 의 보관 글은 없다 (A 의 것이 C 에 붙지 않는다)', (await wh.ev(`JSON.stringify(window.jjakkungPanel.noteKeepGet(${N.c}))`)) === 'null');
    await openNote(nA);
    check('(f) A 로 돌아오면 거절 단추가 다시 A 편집기에 뜨고 내 글이 그대로다', (await shown('.note-stale')) && (await editorBody()) === `${baseA2} +MINE`, JSON.stringify(await editorBody()));
    check('(f) 돌아와도 자동으로 저장하지 않는다 (저장된 글은 ELSEWHERE 그대로)', (await noteBody(N.a)) === 'ELSEWHERE');
    await sleep(900);
    check('(f) 한참 둬도 덮지 않는다', (await noteBody(N.a)) === 'ELSEWHERE');
    // (g) 거절된 채 창을 닫는다
    await main('__jj.home.window.close(); 1');
    await sleep(800);
    await main("__jj.home.open('note'); 1");
    await waitFor(homeAlive);
    await sleep(1400);
    wh = await page('home');
    await setBounds(1100);
    check('(g) 거절된 채 창을 닫았다 열면 그 메모가 거절 단추와 함께 열린다', (await shown('.note-stale')) && (await editorBody()) === `${baseA2} +MINE`, JSON.stringify(await editorBody()));
    check('(g) 그때도 저장된 글은 ELSEWHERE 그대로', (await noteBody(N.a)) === 'ELSEWHERE');
    await wh.click(`[...document.querySelectorAll('.note-stale button')].find((b) => b.classList.contains('primary'))`);
    await sleep(900);
    check('(g) "내 글로 덮기"를 고르면 그때 내 글이 저장되고 단추가 사라진다', (await noteBody(N.a)) === `${baseA2} +MINE` && !(await shown('.note-stale')), JSON.stringify(await noteBody(N.a)));
    check('(g) 고른 뒤 보관 글은 지워졌다', (await wh.ev(`JSON.stringify(window.jjakkungPanel.noteKeepGet(${N.a}))`)) === 'null');
    // 저장된 글로 바꾸기
    await type(' +MINE2');
    await main(`__jj.notes.update(${N.a}, { body: 'ELSEWHERE2' }, Date.now() + 9000); 1`);
    await sleep(1400);
    await wh.click(`[...document.querySelectorAll('.note-stale button')].find((b) => !b.classList.contains('primary') && b.getAttribute('aria-expanded') === null)`);
    await sleep(500);
    check('(g) "저장된 글로 바꾸기"를 고르면 편집기가 저장된 글이 되고 내 글은 저장하지 않는다', (await editorBody()) === 'ELSEWHERE2' && (await noteBody(N.a)) === 'ELSEWHERE2' && !(await shown('.note-stale')), JSON.stringify(await editorBody()));

    // (h) 닫는 순간(0.4초 안에) 다른 곳이 먼저 고쳤다
    await resetHome();
    await openNote(nB);
    const baseB2 = await noteBody(N.b);
    await type(' +LAST');
    await main(`__jj.notes.update(${N.b}, { body: 'ELSEWHERE3' }, Date.now() + 15000); __jj.home.window.close(); 1`);
    await sleep(1400);
    check('(h) 닫는 순간 다른 곳이 먼저 고쳐 거절돼도 저장된 글은 덮이지 않는다', (await noteBody(N.b)) === 'ELSEWHERE3', JSON.stringify(await noteBody(N.b)));
    await main("__jj.home.open('note'); 1");
    await waitFor(homeAlive);
    await sleep(1400);
    wh = await page('home');
    await setBounds(1100);
    check('(h) 다시 열면 내 마지막 글이 살아 있고 거절 단추로 고르게 한다 (말없이 사라지지 않는다)', (await shown('.note-stale')) && (await editorBody()) === `${baseB2} +LAST`, JSON.stringify(await editorBody()));
    check('(h) 그때도 자동으로 덮지 않았다', (await noteBody(N.b)) === 'ELSEWHERE3');
    await wh.click(`[...document.querySelectorAll('.note-stale button')].find((b) => b.classList.contains('primary'))`);
    await sleep(900);
    check('(h) 내 글로 덮기를 고르면 마지막 글이 저장된다', (await noteBody(N.b)) === `${baseB2} +LAST`);

    // (i) 닫는 순간 아무도 안 고쳤다: 보관 글이 남아 되살아나지 않는다
    await openNote(nC);
    const baseC = await noteBody(N.c);
    await type(' +CLOSE');
    await main('__jj.home.window.close(); 1');
    await sleep(1200);
    await main("__jj.home.open('note'); 1");
    await waitFor(homeAlive);
    await sleep(1400);
    wh = await page('home');
    await setBounds(1100);
    check('(i) 0.4초 안에 닫아도 마지막 글이 저장되고 다시 열면 거절 단추 없이 그 글로 열린다', (await noteBody(N.c)) === `${baseC} +CLOSE` && !(await shown('.note-stale')) && (await editorBody()) === `${baseC} +CLOSE`, JSON.stringify(await noteBody(N.c)));
    check('(i) 보관 글이 남아 있지 않다', (await wh.ev(`JSON.stringify(window.jjakkungPanel.noteKeepGet(${N.c}))`)) === 'null');

    // 새 메모와 지우기
    const countNotes = () => main(`__jj.notes.list().length`);
    const n0 = await countNotes();
    await wh.click(`document.querySelector('.note-list-pane .add.row .primary')`);
    await sleep(700);
    check('새 메모를 누르면 목록은 그대로 두고 오른쪽에 빈 편집기가 열린다', (await countNotes()) === n0 + 1 && (await shown('.note-editor')) && (await editorBody()) === '' && (await wh.ev(`document.querySelectorAll('li.note-row').length`)) >= 4);
    await openNote(nA);
    await sleep(500);
    check('빈 새 메모를 두고 다른 메모를 누르면 빈 메모가 소리 없이 사라진다 (목록에 빈 메모가 안 남는다)', (await countNotes()) === n0, `${await countNotes()} vs ${n0}`);
    await wh.click(`document.querySelector('.note-editor .link.danger')`);
    await sleep(700);
    check('지우기를 누르면 편집기가 닫혀 안내 글이 돌아오고 목록에서 빠진다', (await countNotes()) === n0 - 1 && (await shown('.note-pane-empty')));
    await wh.ev(`document.querySelector('.toast .undo')?.click(); 1`);
    await sleep(600);
    check('지운 메모를 되돌리면 돌아온다', (await countNotes()) === n0);

    // 메인의 메모 저장이 늦게 반영될 때(느린 디스크): 저장 요청을 받아 0.4초 뒤에 반영한다. 메인은 막히지 않아 그동안 다른 요청(메모 읽기)은 바로 답한다
    const slowNotes = (on) =>
      main(`(() => { const { ipcMain } = process.mainModule.require('electron'); const h = ipcMain._invokeHandlers; const k = 'panel:note-update'; if (!h.get(k)) throw new Error('핸들러 없음: ' + k); if (${on}) { if (!globalThis.__origUpd) { globalThis.__origUpd = h.get(k); h.set(k, async (e, ...a) => { await new Promise((r) => setTimeout(r, 1000)); return globalThis.__origUpd(e, ...a); }); } } else if (globalThis.__origUpd) { h.set(k, globalThis.__origUpd); delete globalThis.__origUpd; } return 1; })()`);
    const pt = (sel) => wh.ev(`(() => { const e = (${sel}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const editorTitle = () => wh.ev(`document.querySelector('.note-editor .note-title-input')?.value ?? null`);
    const clickRow = async (part) => {
      const at = await pt(rowBtn(part));
      await wh.clickAt(at.x, at.y);
    };
    // (j) 쓴 글이 아직 메인에 반영되기 전에 다른 메모를 눌렀다 곧바로 돌아온다: 기다림(SaveGate) 없이는 옛 글로 열린다
    await openNote(nA);
    await slowNotes(true);
    const baseJ = await noteBody(N.a);
    await type(' +x');
    await clickRow(nB);
    for (let i = 0; i < 40 && (await editorTitle()) !== nB; i++) await sleep(25);
    check('(j) 다른 메모를 누르면 저장이 늦어도 그 메모는 바로 열린다', (await editorTitle()) === nB);
    await clickRow(nA);
    await sleep(250);
    const mid = { title: await editorTitle(), body: await editorBody() };
    check('(j) 앞 저장이 반영되기 전에 돌아오면 옛 글로 열리지 않는다 (기다렸다 열거나 방금 쓴 글로 연다)', !(mid.title === nA && mid.body === baseJ), JSON.stringify(mid));
    await sleep(2000);
    check('(j) 결국 돌아온 편집기는 방금 쓴 글(+x)이고 저장된 글과 같다', (await editorTitle()) === nA && (await editorBody()) === (await noteBody(N.a)) && (await noteBody(N.a)) === `${baseJ} +x`, JSON.stringify([await editorTitle(), await editorBody(), await noteBody(N.a)]));
    await slowNotes(false);
    // (k) B, A, C 를 기다림 없이 연달아 누르면 마지막 C 가 열린다 (A 는 앞 저장을 기다리느라 늦게 읽힌다)
    await slowNotes(true);
    await type(' +z');
    await clickRow(nB);
    for (let i = 0; i < 40 && (await editorTitle()) !== nB; i++) await sleep(25);
    await clickRow(nA);
    await sleep(30);
    await clickRow(nC);
    await sleep(2400);
    check('(k) B, A, C 를 연달아 누르면 마지막에 누른 C 가 열린다 (늦게 읽힌 A 가 덮지 않는다)', (await editorTitle()) === nC, `열린 것 ${await editorTitle()}`);
    await slowNotes(false);

    // 폭을 줄이면 한 열: 열려 있는 편집기와 쓰던 글이 그대로
    await openNote(nB);
    await wh.ev(`window.__ed = document.querySelector('.note-editor textarea'); 1`);
    await type(' +NARROW');
    await setBounds(760);
    check('1100 에서 760 으로 줄이면 편집기 하나만 (목록 칸 사라짐, 뒤로 단추 보임)', !(await shown('.note-list-pane')) && (await shown('.note-editor')) && (await shown('.note-bar .back')));
    check('줄여도 같은 편집기 칸이 살아 있고 쓰던 글이 그대로다 (갈아 끼워지지 않는다)', (await wh.ev(`window.__ed === document.querySelector('.note-editor textarea')`)) && (await editorBody()).endsWith('+NARROW'));
    await sleep(900);
    check('줄인 뒤 쓰던 글이 저장된다', (await noteBody(N.b)).endsWith('+NARROW'));
    await wh.click(`document.querySelector('.note-bar .back')`);
    await sleep(500);
    check('760 에서 뒤로를 누르면 예전처럼 목록 하나', (await shown('.note-list-pane')) && !(await shown('.note-editor')) && !(await shown('.note-pane-empty')));
    await setBounds(1100);
    check('다시 1100 으로 넓히면 나란히 + 안내 글', (await shown('.note-list-pane')) && (await shown('.note-pane-empty')));

    // 폭별 찍기와 넘침
    for (const w of [760, 1100, 1440]) {
      await setBounds(w);
      await tab('note');
      await openNote(nA);
      const mark = `폭 ${w}`;
      const split = (await wh.ev(`document.getElementById('ptab-panel').dataset.zone`)) === 'wide';
      check(`${mark} 메모: ${split ? '목록과 편집기가 나란히' : '편집기 하나'}`, (await shown('.note-list-pane')) === split && (await shown('.note-editor')));
      for (const dark of [false, true]) {
        await wh.dark(dark);
        await sleep(200);
        await wh.shot(`lists-note-w${w}-${dark ? 'dark' : 'light'}`);
        const over = await overflow(wh);
        check(`${mark} 메모: 가로 넘침 없음 ${dark ? '어두움' : '밝음'}`, over.length === 0, over.join(', '));
      }
      await wh.dark(false);
    }
    // 글 크기 1.5배, 폭 1440
    await setBounds(1440);
    await main('__jj.home.window.webContents.setZoomFactor(1.5); 1');
    await sleep(700);
    for (const id of ['todo', 'note']) {
      await tab(id);
      const over = await overflow(wh);
      check(`글 크기 1.5배 폭 1440: ${id} 가로 넘침 없음`, over.length === 0, over.join(', '));
    }
    await main('__jj.home.window.webContents.setZoomFactor(1); 1');
    await setBounds(1100);
    // 상세 칸 제목을 치고 0.5초 멈춤 안에 큰 창을 숨기거나 닫아도 글이 남는다 (버그잡이 163-2)
    await tab('todo');
    await pickRow(tx('빨래', 'laundry'));
    const tBase = (await todoOf(ids.laundry)).title;
    const typeTitle = async (text) => {
      await wh.ev(`(() => { const e = document.querySelector('.detail-title'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); return true; })()`);
      await wh.type(text);
    };
    await typeTitle('H');
    await main('__jj.home.hide(); 1');
    await sleep(250);
    check('상세 칸 제목을 치고 곧바로 큰 창을 숨기면 0.5초를 기다리지 않고 저장된다', (await todoOf(ids.laundry)).title === `${tBase}H`, (await todoOf(ids.laundry)).title);
    await main('__jj.home.open(); 1');
    await sleep(700);
    wh = await page('home');
    await typeTitle('C');
    await main('__jj.home.window.close(); 1');
    await sleep(900);
    check('상세 칸 제목을 치고 곧바로 큰 창을 닫아도 저장된다', (await todoOf(ids.laundry)).title === `${tBase}HC`, (await todoOf(ids.laundry)).title);
    await main("__jj.home.open('todo'); 1");
    await waitFor(homeAlive);
    await sleep(1200);
    await closeHome();

    // ---- 작은 패널 회귀: 320/360 좁음, 560 보통. 예전 그대로 한 열 ----
    await setView('compact');
    await main('__jj.panel.togglePanel(); 1');
    await waitFor(panelAlive);
    await sleep(1200);
    await main("__jj.panel.window.removeAllListeners('blur'); 1");
    const pp = await page('panel');
    const ppos = (sel) =>
      pp.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; })()`);
    for (const w of [320, 360, 560]) {
      await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 680 }); 1`);
      await sleep(600);
      const mark = `작은 패널 ${w}`;
      await main("__jj.panel.openTab('todo'); 1");
      await sleep(500);
      const zone = await pp.ev(`document.getElementById('ptab-panel').dataset.zone`);
      check(`${mark}: 구간은 ${w >= 520 ? '보통' : '좁음'}`, zone === (w >= 520 ? 'medium' : 'narrow'), zone);
      check(`${mark} 할 일: 한 열 (태그 칸, 상세 칸 없음), 칩은 목록 위 가로 줄, 줄 끝 단추 예전 그대로`, !(await pp.ev(`document.querySelector('.todo-layout').classList.contains('wide')`)) && !(await pp.ev(`!!document.querySelector('.todo-tags')?.offsetParent`)) && !(await pp.ev(`!!document.querySelector('.todo-detail')?.offsetParent`)) && (await pp.ev(`getComputedStyle(document.querySelector('.todo-main > .tag-chips')).flexDirection`)) === 'row' && (await pp.ev(`document.querySelectorAll('li.todo .tools .extra').length`)) > 0);
      let over = await overflow(pp, '.surface');
      check(`${mark} 할 일: 가로 넘침 없음`, over.length === 0, over.join(', '));
      await pp.shot(`lists-panel-todo-w${w}`);
      await main("__jj.panel.openTab('note'); 1");
      await sleep(500);
      check(`${mark} 메모: 한 열 (나란히 아님), 목록이 보인다`, !(await pp.ev(`document.querySelector('.note-layout').classList.contains('split')`)) && (await pp.ev(`!!document.querySelector('.note-list-pane')?.offsetParent`)) && !(await pp.ev(`!!document.querySelector('.note-pane-empty')?.offsetParent`)));
      await pp.click(`[...document.querySelectorAll('li.note-row')][0]?.querySelector('button')`);
      await sleep(500);
      check(`${mark} 메모: 열면 편집기 하나, 목록은 사라지고 뒤로 단추가 있다`, (await pp.ev(`!!document.querySelector('.note-editor')?.offsetParent`)) && !(await pp.ev(`!!document.querySelector('.note-list-pane')?.offsetParent`)) && (await pp.ev(`!!document.querySelector('.note-bar .back')?.offsetParent`)));
      over = await overflow(pp, '.surface');
      check(`${mark} 메모: 가로 넘침 없음`, over.length === 0, over.join(', '));
      await pp.shot(`lists-panel-note-w${w}`);
      await pp.click(`document.querySelector('.note-bar .back')`);
      await sleep(400);
    }
    await closePanel();
    await setView('compact');
  }

  /**
   * 오늘과 일정의 넓은 배치 (이슈 #162). 큰 창 폭 760/1100/1440 과 작은 패널 320/360/560 을 같은 자료로 찍고 잰다.
   * 본문 칸 폭 = 창 폭 - 사이드바 208 이라 큰 창은 760 이 보통, 1100(본문 892)과 1440 이 넓음이다
   */
  async function wideLayouts() {
    const dayMs = 86_400_000;
    const dayStr = (ms) =>
      main(`(() => { const d = new Date(${ms}); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`);
    const yesterday = await dayStr(dayStart - dayMs);
    const tomorrow = await dayStr(dayStart + dayMs);
    const crowded = await dayStr(dayStart + 2 * dayMs);
    // 어제 마감 둘(지난 마감), 오늘 마감 하나는 위에서 넣었다 -> 못 한 3개
    for (const title of [tx('지난 보고 정리', 'Old report cleanup'), tx('세금 서류', 'Tax papers')])
      await main(`__jj.store.add({ title: ${JSON.stringify(title)}, due: ${JSON.stringify(yesterday)} }, ${NOW}); 1`);
    // 오늘 일정: 종일 둘과 시각 둘 (자정 가까이여도 오늘 안에 있게 끝에서 거꾸로 잡는다)
    const lastMs = dayStart + dayMs - 45 * 60_000;
    for (const [title, startAt, allDay] of [
      [tx('가족 모임', 'Family dinner'), dayStart, true],
      [tx('재택 근무', 'Remote day'), dayStart, true],
      [tx('팀 스탠드업', 'Team standup'), Math.min(NOW + 10 * 60_000, lastMs - 30 * 60_000), false],
      [tx('디자인 리뷰', 'Design review'), Math.min(NOW + 3 * 3_600_000, lastMs), false],
    ])
      await main(
        `__jj.events.add({ title: ${JSON.stringify(title)}, startAt: ${startAt}, allDay: ${allDay}, reminds: [] }, ${NOW}); 1`,
      );
    // 모레는 일정이 많아 칸 안에 +N 이 나온다
    const [cy, cm, cd] = crowded.split('-').map(Number);
    for (let i = 1; i <= 6; i++)
      await main(
        `__jj.events.add({ title: ${JSON.stringify(tx(`모레 회의 ${i}`, `Meeting ${i}`))}, startAt: ${new Date(cy, cm - 1, cd, 8 + i, 0).getTime()}, reminds: [] }, ${NOW}); 1`,
      );
    await sleep(500);

    await closeHome();
    await closePanel();
    await main("__jj.home.open('today'); 1");
    await waitFor(homeAlive);
    await sleep(1200);
    let wh = await page('home');
    const pos = (sel) =>
      wh.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width }; })()`);
    const hasText = (sel, re) =>
      wh.ev(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].some((e) => ${re}.test(e.textContent)))()`);
    const eventsHead = ".today-plan section:has(.events) h2";
    const dueHead = ".today-plan section:has(.todos) h2";
    const calTab = async (tab) => {
      await wh.click(`document.getElementById('ptab-${tab}')`);
      await sleep(450);
    };
    const showCalendar = async () => {
      await calTab('event');
      if (!(await wh.ev(`!!document.querySelector('.cal')`))) {
        await wh.click(`[...document.querySelectorAll('.view-switch button')].find((b) => b.getAttribute('aria-pressed') === 'false')`);
        await sleep(600);
      }
    };

    if (process.env.BASELINE) {
      // 옛 판(넓은 배치 전)에서 같은 자료로 찍기만 한다: 전후 비교 그림용
      for (const w of [1100, 1440]) {
        await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: 780 }); 1`);
        await sleep(800);
        await calTab('today');
        await wh.shot(`wide-today-w${w}-light`);
        await calTab('event');
        if (!(await wh.ev(`!!document.querySelector('.cal')`))) {
          await wh.click(`[...document.querySelectorAll('.view-switch button')].find((b) => b.getAttribute('aria-pressed') === 'false')`);
          await sleep(600);
        }
        await wh.shot(`wide-calendar-w${w}-light`);
      }
      return;
    }

    for (const w of [760, 1100, 1440]) {
      await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: 780 }); 1`);
      await sleep(800);
      const wideNow = (await wh.ev(`document.getElementById('ptab-panel').dataset.zone`)) === 'wide';
      const mark = `폭 ${w}`;

      // ---- 오늘 ----
      await calTab('today');
      const cols = await wh.ev(`getComputedStyle(document.querySelector('.today-cols')).display`);
      check(`${mark}: 오늘은 ${wideNow ? '두 열(grid)' : '한 열(block)'}`, cols === (wideNow ? 'grid' : 'block'), cols);
      const titleShown = await wh.ev(`[...document.querySelectorAll('.today-col-title')].filter((e) => e.offsetParent).map((e) => e.textContent).join('|')`);
      check(
        `${mark}: 열 제목은 넓을 때만 보인다`,
        wideNow ? titleShown === tx('할 것|나와 펫', 'To do|You and your pet') : titleShown === '',
        titleShown,
      );
      const ev = await pos(eventsHead);
      const due = await pos(dueHead);
      const next = await pos('.next-up');
      const focus = await pos('.focus-card');
      check(`${mark}: 첫 화면 순서 오늘 일정이 오늘 마감보다 위`, !!ev && !!due && ev.y < due.y, JSON.stringify({ ev: ev?.y, due: due?.y }));
      check(`${mark}: 다음 할 일은 일정 아래, 마감 위`, !!next && next.y > ev.y && next.y < due.y, JSON.stringify({ next: next?.y }));
      if (wideNow) {
        check(`${mark}: 집중 카드는 오른쪽 열 (일정 열의 오른쪽, 위쪽)`, !!focus && focus.x > ev.r - 1 && focus.y < due.y, JSON.stringify(focus));
        check(`${mark}: 오른쪽 열에 습관, 이번 주, 일기가 있다`, !!(await pos('.today-pet .habits')) && !!(await pos('.today-pet details.week')) && !!(await pos('.today-pet details.diary')));
        check(`${mark}: 이번 주와 일기는 펼쳐져 있다`, await wh.ev(`!!document.querySelector('.today-pet details.week[open]') && !!document.querySelector('.today-pet details.diary[open]')`));
        check(`${mark}: 못 한 N개 내일로 단추는 왼쪽 열`, !!(await pos('.today-plan .defer-tomorrow')));
      } else {
        check(`${mark}: 집중 카드는 마감 아래 (아래로만 옮겼다)`, !!focus && focus.y > due.y, JSON.stringify(focus));
        check(`${mark}: 한 열이라 두 열의 왼쪽이 같다`, Math.abs((await pos('.today-pet .focus-card')).x - ev.x) < 2);
      }
      for (const [name, sel] of [['집중', '.focus-card'], ['다음 할 일', '.next-up'], ['습관', '.habits'], ['끝낸 수', '.done-count'], ['업적', 'details.achieve:not(.week):not(.diary)'], ['일기', 'details.diary'], ['이번 주', 'details.week']])
        check(`${mark}: 익숙한 카드가 남아 있다: ${name}`, !!(await pos(sel)));
      for (const dark of [false, true]) {
        await wh.dark(dark);
        await sleep(200);
        await wh.shot(`wide-today-w${w}-${dark ? 'dark' : 'light'}`);
        const over = await overflow(wh);
        check(`${mark}: 오늘 가로 넘침 없음 ${dark ? '어두움' : '밝음'}`, over.length === 0, over.join(', '));
      }
      await wh.dark(false);

      // ---- 못 한 N개 내일로 ----
      const before = JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((t) => t.due !== null && t.due <= ${JSON.stringify(todayStr)} && !t.repeat).map((t) => [t.id, t.due]))`));
      const label = await wh.ev(`document.querySelector('.defer-tomorrow')?.textContent ?? ''`);
      check(`${mark}: 단추 글에 개수 ${before.length}`, label === tx(`못 한 ${before.length}개 내일로`, `Push ${before.length} undone to tomorrow`), label);
      // 폭을 바꾼 직후라 배치가 움직이는 중일 수 있다: 단추 자리가 멈춘 뒤 누른다
      for (let i = 0, prev = ''; i < 20; i++) {
        const cur = JSON.stringify(await pos('.defer-tomorrow'));
        if (cur === prev) break;
        prev = cur;
        await sleep(100);
      }
      await wh.click(`document.querySelector('.defer-tomorrow')`);
      await sleep(700);
      const after = JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((t) => ${JSON.stringify(before.map((b) => b[0]))}.includes(t.id)).map((t) => [t.id, t.due]))`));
      check(`${mark}: 누르면 ${before.length}개 모두 마감이 내일`, after.length === before.length && after.every((a) => a[1] === tomorrow), JSON.stringify(after));
      const toast = await wh.ev(`document.querySelector('.toast')?.textContent ?? ''`);
      check(`${mark}: 되돌리기 알림이 뜬다`, toast.includes(tx(`못 한 ${before.length}개를 내일로 옮겼어`, `Pushed ${before.length} to-dos to tomorrow`)), toast);
      check(`${mark}: 옮긴 뒤 단추는 사라진다 (남은 마감 없음)`, !(await pos('.defer-tomorrow')));
      await wh.shot(`wide-defer-w${w}`);
      await wh.click(`document.querySelector('.toast .undo')`);
      await sleep(700);
      const back = JSON.parse(await main(`JSON.stringify(__jj.store.list(Date.now()).open.filter((t) => ${JSON.stringify(before.map((b) => b[0]))}.includes(t.id)).map((t) => [t.id, t.due]))`));
      check(`${mark}: 되돌리면 원래 마감으로`, JSON.stringify(back.sort()) === JSON.stringify([...before].sort()), JSON.stringify(back));

      // ---- 일정 (달력 보기) ----
      await showCalendar();
      const calDisplay = await wh.ev(`getComputedStyle(document.querySelector('.cal')).display`);
      check(`${mark}: 일정은 ${wideNow ? '두 열(grid)' : '한 열(block)'}`, calDisplay === (wideNow ? 'grid' : 'block'), calDisplay);
      const grid = await pos('.cal-grid');
      const days = await pos('.cal-days');
      if (wideNow) check(`${mark}: 고른 날 목록이 월 보기 오른쪽`, !!days && days.x >= grid.r - 1, JSON.stringify({ grid: grid.r, days: days?.x }));
      else check(`${mark}: 고른 날 목록이 월 보기 아래`, !!days && days.y >= grid.b - 1, JSON.stringify({ grid: grid.b, days: days?.y }));
      check(`${mark}: 일정 넣기 단추는 넓을 때만`, !!(await pos('.cal-add-here')) === wideNow);
      const todayLines = await wh.ev(`document.querySelectorAll('.cal-cell.today .cal-line').length`);
      check(`${mark}: 오늘 칸 안에 일정 제목이 보인다`, todayLines >= 1, String(todayLines));
      const crowdedCell = `.cal-cell[data-day="${crowded}"]`;
      // 모레 달이 다음 달로 넘어가는 날이면 칸이 다른 달에 있어 건너뛴다
      if (await pos(crowdedCell)) {
        const lines = await wh.ev(`document.querySelectorAll('${crowdedCell} .cal-line').length`);
        const more = await wh.ev(`document.querySelector('${crowdedCell} .cal-more')?.textContent ?? ''`);
        const want = wideNow ? 3 : 1;
        check(`${mark}: 일정이 많은 칸은 제목 ${want}개와 +N`, lines === want && /\+\s?\d/.test(more), `${lines} ${more}`);
        const cell = await pos(`${crowdedCell} button`);
        const lastLine = await pos(`${crowdedCell} .cal-more`);
        check(`${mark}: +N 이 칸 안에 들어 있다`, !!lastLine && lastLine.b <= cell.b + 1, JSON.stringify({ cell: cell.b, more: lastLine?.b }));
        await wh.click(`document.querySelector('${crowdedCell} button')`);
        await sleep(500);
        const listed = await hasText('.cal-day h2 + ul, .cal-day ul', new RegExp(tx('모레 회의 6', 'Meeting 6')));
        check(`${mark}: 칸을 누르면 그날 목록에 일정이 모두 보인다`, listed);
      }
      for (const dark of [false, true]) {
        await wh.dark(dark);
        await sleep(200);
        await wh.shot(`wide-calendar-w${w}-${dark ? 'dark' : 'light'}`);
        const over = await overflow(wh);
        check(`${mark}: 일정 가로 넘침 없음 ${dark ? '어두움' : '밝음'}`, over.length === 0, over.join(', '));
      }
      await wh.dark(false);
      // 주 보기도 깨지지 않는다
      await wh.click(`[...document.querySelectorAll('.cal-mode button')].find((b) => b.getAttribute('aria-pressed') === 'false')`);
      await sleep(500);
      const overWeek = await overflow(wh);
      check(`${mark}: 일정 주 보기 가로 넘침 없음`, overWeek.length === 0, overWeek.join(', '));
      await wh.shot(`wide-calendar-week-w${w}`);
      await wh.click(`[...document.querySelectorAll('.cal-mode button')].find((b) => b.getAttribute('aria-pressed') === 'false')`);
      await sleep(300);
    }
    // 글 크기 1.5배, 폭 1440 (넓음)
    await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 1440, height: 780 }); 1');
    await main('__jj.home.window.webContents.setZoomFactor(1.5); 1');
    await sleep(700);
    for (const tab of ['today', 'event']) {
      await calTab(tab);
      const over = await overflow(wh);
      check(`글 크기 1.5배 폭 1440: ${tab} 가로 넘침 없음`, over.length === 0, over.join(', '));
    }
    await main('__jj.home.window.webContents.setZoomFactor(1); 1');
    await closeHome();

    // ---- 작은 패널 회귀: 320/360 은 좁음, 560 은 보통 ----
    await setView('compact');
    await main('__jj.panel.togglePanel(); 1');
    await waitFor(panelAlive);
    await sleep(1200);
    await main("__jj.panel.window.removeAllListeners('blur'); 1");
    const pp = await page('panel');
    const ppos = (sel) =>
      pp.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; })()`);
    for (const w of [320, 360, 560]) {
      await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 680 }); 1`);
      await sleep(600);
      const mark = `작은 패널 ${w}`;
      await main("__jj.panel.openTab('today'); 1");
      await sleep(500);
      const zone = await pp.ev(`document.getElementById('ptab-panel').dataset.zone`);
      check(`${mark}: 구간은 ${w >= 520 ? '보통' : '좁음'}`, zone === (w >= 520 ? 'medium' : 'narrow'), zone);
      const ev = await ppos(eventsHead);
      const due = await ppos(dueHead);
      const focus = await ppos('.focus-card');
      check(`${mark}: 오늘 일정, 마감, 집중 순서로 쌓인다`, !!ev && !!due && !!focus && ev.y < due.y && due.y < focus.y, JSON.stringify({ ev: ev?.y, due: due?.y, focus: focus?.y }));
      check(`${mark}: 오늘은 한 열 (열 제목 없음)`, (await pp.ev(`getComputedStyle(document.querySelector('.today-cols')).display`)) === 'block' && !(await pp.ev(`!!document.querySelector('.today-col-title')?.offsetParent`)));
      check(`${mark}: 못 한 N개 내일로 단추가 있다`, !!(await ppos('.defer-tomorrow')));
      let over = await overflow(pp, '.surface');
      check(`${mark}: 오늘 가로 넘침 없음`, over.length === 0, over.join(', '));
      await pp.shot(`wide-panel-today-w${w}`);
      await main("__jj.panel.openTab('event'); 1");
      await sleep(500);
      if (!(await pp.ev(`!!document.querySelector('.cal')`))) {
        await pp.click(`[...document.querySelectorAll('.view-switch button')].find((b) => b.getAttribute('aria-pressed') === 'false')`);
        await sleep(600);
      }
      const calDisplay = await pp.ev(`getComputedStyle(document.querySelector('.cal')).display`);
      check(`${mark}: 일정은 한 열 달력`, calDisplay === 'block', calDisplay);
      const todayCell = await pp.ev(`document.querySelectorAll('.cal-cell.today .cal-line').length`);
      check(`${mark}: 오늘 칸 줄 수가 예전 그대로 (최대 1개와 +N)`, w <= 300 || todayCell <= 1, String(todayCell));
      over = await overflow(pp, '.surface');
      check(`${mark}: 일정 가로 넘침 없음`, over.length === 0, over.join(', '));
      await pp.shot(`wide-panel-calendar-w${w}`);
    }

    // ---- 집중이 돌고 있으면 시계와 그만 단추가 첫 화면에 (320, 560) ----
    for (const w of [320, 560]) {
      await main(`__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: ${w}, height: 600 }); 1`);
      await main("__jj.panel.openTab('today'); 1");
      await sleep(500);
      await pp.ev('jjakkungPanel.focusStart(25); 1');
      await sleep(1200);
      const clock = JSON.parse(
        await pp.ev(`(() => { const c = document.querySelector('.focus-card .clock'); const stop = document.querySelector('.focus-card .ghost'); const sc = document.querySelector('.scroll.today'); if (!c || !stop) return JSON.stringify(null); return JSON.stringify({ top: c.getBoundingClientRect().top, stopB: stop.getBoundingClientRect().bottom, scB: sc.getBoundingClientRect().bottom, firstIsFocus: sc.querySelector('section')?.classList.contains('focus-card') }); })()`),
      );
      check(`작은 패널 ${w}: 집중 중 시계와 그만 단추가 첫 화면 안`, !!clock && clock.top < clock.scB && clock.stopB <= clock.scB, JSON.stringify(clock));
      check(`작은 패널 ${w}: 집중 중이면 집중 카드가 맨 위 구역`, !!clock && clock.firstIsFocus === true);
      await pp.shot(`wide-panel-focus-w${w}`);
      await pp.ev('jjakkungPanel.focusStop(); 1');
      await sleep(400);
    }

    // ---- 알림 둘과 빠른 두 번: 묶음마다 되돌린다 ----
    const grab = (title) => main(`__jj.store.add({ title: ${JSON.stringify(title)}, due: ${JSON.stringify(todayStr)} }, ${NOW}).id`);
    const dueOf = (id) => main(`__jj.store.get(${id}).due`);
    const tomorrowStr = await dayStr(dayStart + dayMs);
    const q1 = await grab('묶음 1');
    const first = await pp.ev(`jjakkungPanel.moveOverdue('tomorrow', { key: 111, today: ${JSON.stringify(todayStr)}, ids: [${q1}] }).then((m) => m.length)`);
    const q2 = await grab('묶음 2');
    const second = await pp.ev(`jjakkungPanel.moveOverdue('tomorrow', { key: 222, today: ${JSON.stringify(todayStr)}, ids: [${q2}] }).then((m) => m.length)`);
    const dup = await pp.ev(`jjakkungPanel.moveOverdue('tomorrow', { key: 333, today: ${JSON.stringify(todayStr)}, ids: [${q2}] }).then((m) => m.length)`);
    check('알림 둘: 각 묶음이 한 개씩 옮겨지고 같은 목록을 또 부르면 0개', first === 1 && second === 1 && dup === 0, `${first} ${second} ${dup}`);
    await pp.ev('jjakkungPanel.undoMoveOverdue(111); 1');
    await sleep(500);
    check('알림 둘: 앞 알림(111)을 되돌리면 그 묶음만 돌아온다', (await dueOf(q1)) === todayStr && (await dueOf(q2)) === tomorrowStr, `${await dueOf(q1)} ${await dueOf(q2)}`);
    await pp.ev('jjakkungPanel.undoMoveOverdue(222); 1');
    await sleep(500);
    check('알림 둘: 뒤 알림(222)도 자기 묶음을 되돌린다 (0개 호출 333 이 기억을 덮지 않았다)', (await dueOf(q2)) === todayStr, await dueOf(q2));
    // 자정 직후: 화면이 본 어제 날짜 기준이면 오늘이 된 것은 그대로
    const q3 = await grab('자정 전에 보던 것');
    const q4 = await main(`__jj.store.add({ title: '자정에 오늘이 된 것', due: ${JSON.stringify(tomorrowStr)} }, ${NOW}).id`);
    const got = await pp.ev(`jjakkungPanel.moveOverdue('tomorrow', { key: 444, today: ${JSON.stringify(todayStr)}, ids: [${q3}, ${q4}] }).then((m) => m.map((x) => x.id).join(','))`);
    check('화면이 본 오늘 기준: 내일 마감은 목록에 있어도 안 옮긴다', got === String(q3) && (await dueOf(q4)) === tomorrowStr, got);
    await closePanel();
  }

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
  await clickPet(false);
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('뒤에 있으면(포커스 없음) 누르기는 앞으로 가져올 뿐 숨기지 않는다', look.alive && !look.hidden);

  // 패널 보기가 compact 여도 큰 창이 열려 있으면 큰 창
  await setView('compact');
  await sleep(300);
  await clickPet(false);
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

  // ===================== 5b. 숨겨 둔 큰 창과 작은 패널 =====================
  // 숨긴 큰 창은 보이는 면이 아니다: 그 상태에서 작은 패널을 열면 쪽지함, 여정, 주간 카드 요청이 패널 것으로 받아진다
  await main('__jj.home.open(); 1');
  await waitFor(homeAlive);
  await sleep(700);
  await main(`(() => {
    const w = __jj.home.window;
    globalThis.__homeSends = 0;
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => { if (ch === 'panel:state') globalThis.__homeSends++; return orig(ch, ...a); };
    return 1;
  })()`);
  await main('__jj.home.hide(); 1');
  await sleep(400);
  await main('__jj.panel.refresh(); __jj.panel.refresh(); 1');
  await sleep(300);
  check('숨긴 큰 창에는 상태를 보내지 않는다', (await main('globalThis.__homeSends')) === 0, String(await main('globalThis.__homeSends')));
  await setView('compact');
  await main('__jj.panel.togglePanel(); 1');
  await sleep(1500);
  check('큰 창을 숨긴 채 패널 보기가 compact 면 작은 패널이 열린다', await panelAlive());
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const pp = await page('panel');
  check('숨긴 큰 창이 있어도 패널에서 쪽지함 요청이 받아진다', (await pp.ev(`window.jjakkungNotes.list().then((v) => v !== undefined)`)) === true);
  check('숨긴 큰 창이 있어도 패널에서 여정 요청이 받아진다', (await pp.ev(`window.jjakkungBond.journeyGet().then((v) => v !== undefined)`)) === true);
  check('숨긴 큰 창이 있어도 패널에서 주간 카드 제목 요청이 받아진다 (빈 목록도 배열)', (await pp.ev(`window.jjakkungBond.weekTitles().then((v) => Array.isArray(v))`)) === true);
  check('숨긴 큰 창이 있어도 보이는 면은 패널', await main('__jj.panel.activeSurface() === __jj.panel.window'));
  await closePanel();
  await main('__jj.home.open(); 1');
  await sleep(700);
  check('숨겼던 큰 창이 다시 보일 때 상태를 한 번 받는다', (await main('globalThis.__homeSends')) >= 1);
  check('다시 보이면 보이는 면은 큰 창', await main('__jj.panel.activeSurface() === __jj.home.window'));
  await setView('window');
  // 전체 화면이 풀리기를 기다리는 동안 다시 열면 늦게 온 숨기기가 무시된다 (진짜 전체 화면은 켜지 않고 흉내 낸다)
  await main(`(() => { const w = __jj.home.window; w.isFullScreen = () => true; w.setFullScreen = () => {}; return 1; })()`);
  await main('__jj.home.hide(); 1');
  await main('__jj.home.open(); 1');
  await main("__jj.home.window.emit('leave-full-screen'); 1");
  await sleep(500);
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('숨기는 중(전체 화면 풀림 대기)에 다시 열면 숨겨지지 않는다', look.alive && !look.hidden && (await main('__jj.home.window.isVisible()')));
  await main(`(() => { const w = __jj.home.window; delete w.isFullScreen; delete w.setFullScreen; return 1; })()`);
  // 숨기기를 요청하고 그대로 두면 풀린 뒤 숨겨진다 (대조)
  await main(`(() => { const w = __jj.home.window; w.isFullScreen = () => true; w.setFullScreen = () => {}; return 1; })()`);
  await main('__jj.home.hide(); 1');
  await main("__jj.home.window.emit('leave-full-screen'); 1");
  await sleep(500);
  look = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
  check('대조: 다시 열지 않으면 전체 화면이 풀린 뒤 숨겨진다', look.alive && look.hidden);
  await main(`(() => { const w = __jj.home.window; delete w.isFullScreen; delete w.setFullScreen; return 1; })()`);
  await main('__jj.home.open(); 1');
  await sleep(600);
  await closeHome();

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
  await main('__jj.home.window.setBounds({ x: 40, y: 40, width: 1100, height: 720 }); 1');
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
  for (const w of [760, 1100, 1440]) {
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
  await wideLayouts();
  await listsLayouts();
  await closeHome();
  await main("__jj.home.open('today'); 1");
  await waitFor(homeAlive);
  await sleep(1000);
  h = await page('home');
  if (!ko) {
    const hangul = await h.ev(`/[\\u3131-\\u318e\\uac00-\\ud7a3]/.test(document.querySelector('.home-side').innerText) ? document.querySelector('.home-side').innerText : ''`);
    check('영어 화면 사이드바에 한글이 없다', hangul === '', hangul.slice(0, 40));
  }
  const sideText = await h.ev(`document.querySelector('.home-side').innerText`);
  check('사이드바에 "모드" 라는 낱말이 없다', !/모드|\bmode\b/i.test(sideText), sideText.slice(0, 60).replace(/\n/g, ' '));

  // 글 크기 1.5배(큰 글씨)에서도 넘치지 않는다
  await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 1100, height: 760 }); 1');
  await sleep(500);
  await main('__jj.home.window.webContents.setZoomFactor(1.5); 1');
  await sleep(600);
  const overBig = await overflow(h);
  check('글 크기 1.5배, 폭 1100: 가로 넘침 없음', overBig.length === 0, overBig.join(', '));
  await h.shot('home-zoom15-w1100');
  await main('__jj.home.window.webContents.setZoomFactor(1); 1');

  // ===================== 10. Cmd+W 로 닫기 =====================
  await h.ev(keyEvent({ ...mod, key: 'w', code: 'KeyW' }));
  check('Cmd+W 는 큰 창을 닫는다 (앱은 계속 돈다)', await waitFor(async () => !(await homeAlive())) && (await main('!!__jj.pet.win && !__jj.pet.win.isDestroyed()')));

  // ===================== 11. 끝 =====================
  if (clickFallbacks) console.log(`알림: 펫 CDP 클릭이 ${clickFallbacks}번 먹지 않아 togglePanel 로 대신했다 (화면이 꺼진 컴퓨터)`);
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
