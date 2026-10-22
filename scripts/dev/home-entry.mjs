// 크게 보기 단추와 진입점 점검 (이슈 #164, 큰 창 설계 #159).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/home-entry.mjs
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다. 진짜 마우스, 키보드, 포커스는 쓰지 않는다.
// 진짜 AI 는 부르지 않는다: PATH 는 /usr/bin:/bin 과 node 만 둔다. 끝나면 데이터 폴더를 지운다.
//
// 보는 것 (PASS/FAIL):
//   머리줄 "크게 보기" 단추: 접근성 이름과 풀이(ko/en), 폭 320/360/560 에서 머리줄 단추 셋이 다 보이고 넘치지 않음, 밝음/어두움 찍기
//   "크게 볼까요?" 칩: 가장 넓게(560) 만든 채 더 끌면 한 번만 뜨고 몇 초 뒤 사라짐, 아직 못 닿았으면 안 뜸, 창은 저절로 안 바뀜,
//     같은 끌기에서 한 번만, 바로 다음 끌기에는 안 뜸(너무 자주 안 뜸), 키보드 크기 조절에서도 뜸, 칩을 누르면 크게 보기, 대비 4.5 이상
//   승격(단추, 칩, 트레이, 펫 메뉴): 탭마다(오늘, 할 일, 일정, 메모, 상점) 같은 탭으로 큰 창이 뜨고, 할 일은 쓰던 글, 찾는 말, 스크롤,
//     일정은 고른 날, 메모는 열린 메모와 아직 저장 전인 글이 그대로 나옴.
//     두 창의 보임 시각을 2ms 간격으로 재서 "빈 순간 없음"(큰 창이 보이기 전에 패널이 사라진 표본이 없음)과 패널 닫힘 시각 >= 큰 창 보임 시각을 숫자로 확인
//   경계: 숨겨 둔 큰 창이 있을 때(낡은 글을 쓰지 않고 새로 만듦), 큰 창이 이미 열려 있을 때(앞으로만), 패널이 멈췄을 때(트레이, 펫 메뉴가 1.5초 뒤 그냥 큰 창을 엶),
//     패널이 열려 있지 않을 때의 트레이, 펫 메뉴(그냥 큰 창), 트레이와 펫 메뉴 항목 이름(ko/en)
//   ko/en: 영어 화면에 한글 없음, "모드" 라는 낱말 없음
//
// 검출력 확인(되돌려 보기): 패널을 큰 창이 뜨기 전에 닫게 하면 "빈 순간 없음"이 실패하고, 승격 전에 쓰던 글을 안 보내면 글 확인이 실패한다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-home-entry');
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
const todoDraft = tx('쓰던 할 일 한 줄', 'Half-typed task');

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.home-entry-'));
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
      if (e.closest('svg') || e.closest('.sr-only') || e.closest('[hidden]') || e.classList.contains('grip')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      if (r.right > innerWidth + 1) out.push('밖:' + e.tagName + '.' + e.className);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('쪽 가로 스크롤');
    return JSON.stringify([...new Set(out)].slice(0, 8));
  })()`)
    .then((s) => JSON.parse(s));

async function openPanel(tab = 'today') {
  await closeAll();
  await main(`__jj.settings.set({ panelView: 'compact' }); __jj.panel.openNextAt('${tab}'); __jj.panel.togglePanel(); 1`);
  await waitFor(panelAlive);
  const p = await page('panel');
  await p.until(() => p.ev("!!document.querySelector('.grip-se') && !!document.querySelector('.panel-tabpanel')"));
  await sleep(400);
  return p;
}
const gripPoint = (p, sel) =>
  p
    .ev(
      `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
    )
    .then((s) => JSON.parse(s));
/** 손잡이를 잡고 (dx, dy) 만큼 끈다 (CDP 마우스) */
async function drag(p, sel, dx, dy = 0, { steps = 10, hold = false } = {}) {
  const g = await gripPoint(p, sel);
  await p.mouse('mouseMoved', g.x, g.y);
  await p.mouse('mousePressed', g.x, g.y, { buttons: 1 });
  for (let i = 1; i <= steps; i++) {
    await p.mouse('mouseMoved', g.x + (dx * i) / steps, g.y + (dy * i) / steps, { buttons: 1 });
    await sleep(60);
  }
  await sleep(150);
  if (!hold) await p.mouse('mouseReleased', g.x + dx, g.y + dy, { buttons: 0 });
  await sleep(150);
}
/** 칸의 글을 모두 골라 바꿔 쓴다 (앞 시험이 남긴 쓰던 글이 겹치지 않게) */
const fresh = async (p, sel, text) => {
  await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select(); return 1; })()`);
  await p.type(text);
};
const watchChips = (p) =>
  p.ev(`(() => {
    window.__chips = 0;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('.expand-chip') || n.querySelector('.expand-chip'))) window.__chips++;
    }).observe(document.body, { childList: true, subtree: true });
    return 1;
  })()`);
const chips = (p) => p.ev('window.__chips');
const chipUp = (p) => p.ev("!!document.querySelector('.expand-chip')");
const panelWidth = () => main('__jj.panel.window.getBounds().width');
const setPanelBounds = (w, h = 540) =>
  main(`(() => { const win = __jj.panel.window; const b = win.getBounds(); win.setBounds({ x: b.x, y: b.y, width: ${w}, height: ${h} }); return 1; })()`);

/** 두 창의 보임을 2ms 간격으로 적는다 (빈 순간 확인) */
const startSampler = () =>
  main(`(() => {
    const vis = (w) => !!w && !w.isDestroyed() && w.isVisible();
    globalThis.__s = { log: [], t: setInterval(() => globalThis.__s.log.push([Date.now(), vis(__jj.home.window), vis(__jj.panel.window)]), 2) };
    return 1;
  })()`);
const stopSampler = async () =>
  JSON.parse(await main('(() => { clearInterval(__s.t); return JSON.stringify(__s.log); })()'));

/** 이 시각 뒤로 두 창이 다 안 보인 표본이 있나, 큰 창이 처음 보인 시각과 패널이 처음 사라진 시각 */
function analyze(log, since) {
  const after = log.filter(([t]) => t >= since);
  const gap = after.filter(([, h, p]) => !h && !p).length;
  const firstHome = after.find(([, h]) => h)?.[0];
  const firstPanelGone = after.find(([, , p], i) => !p && i > 0 && after[i - 1][2])?.[0];
  const both = after.filter(([, h, p]) => h && p).length;
  return { gap, firstHome, firstPanelGone, both, n: after.length };
}

const sectionNow = (h) => h.ev(`document.getElementById('ptab-panel')?.getAttribute('aria-labelledby')`);
const todoTitles = (n, prefix) =>
  Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(2, '0')}`);

/**
 * 승격 한 번: 패널을 이 탭으로 열고, setup 으로 쓰던 글 등을 만들고, via 로 큰 창으로 넘긴 뒤 verify 로 큰 창을 본다.
 * 빈 순간 숫자를 같이 확인한다
 */
async function promoteCase(label, tab, via, setup, verify) {
  const p = await openPanel(tab);
  await setup(p);
  await startSampler();
  const since = await main('Date.now()');
  let mainDraft;
  if (via === 'button') {
    // 글을 치자마자 누른다 (쓰던 글을 메인에 보내는 멈춤 시간 0.25초가 지나기 전: 승격이 직접 보내야 하는 순간)
    // 같은 순간 메인이 들고 있는 할 일 쓰던 글을 읽는다 (같은 창이 보낸 순서대로 닿으니 단추 전에 보낸 글이 보여야 한다)
    mainDraft = await p.ev("document.querySelector('.expand-btn').click(); window.jjakkungPanel.draftGet('todo')");
  } else if (via === 'mouse') {
    const ok = await p.click("document.querySelector('.expand-btn')");
    if (!ok) check(`${label}: 단추를 눌렀다`, false);
  } else if (via === 'chip') {
    await p.click("document.querySelector('.expand-chip-btn')");
  } else if (via === 'tray') {
    await main(`__t.tray.at(-1).find((i) => i.label === ${JSON.stringify(tx('큰 창 열기', 'Open large window'))}).click(); 1`);
  } else if (via === 'pet') {
    await main(`__t.pet.at(-1).find((i) => i.label === ${JSON.stringify(tx('크게 보기', 'Open large window'))}).click(); 1`);
  }
  if (tab === 'todo' && via === 'button' && label.startsWith('할 일(단추)'))
    check(`${label}: 누르는 순간 쓰던 글이 이미 메인에 있다 (멈춤 시간을 기다리지 않는다)`, mainDraft === todoDraft, JSON.stringify(mainDraft));
  const up = await waitFor(async () => (await homeShown()) && !(await panelAlive()), 9000);
  await sleep(200);
  const log = await stopSampler();
  const a = analyze(log, since);
  const lp = JSON.parse(await main('JSON.stringify(__jj.home.lastPromote() ?? null)'));
  check(`${label}: 큰 창이 뜨고 패널은 닫혔다`, up);
  check(
    `${label}: 빈 순간 없음 (두 창이 다 안 보인 표본 ${a.gap}개 / ${a.n}개)`,
    a.gap === 0 && a.firstHome !== undefined && (a.firstPanelGone === undefined || a.firstHome <= a.firstPanelGone),
    `큰 창 처음 보임 ${a.firstHome ? a.firstHome - since : '-'}ms, 패널 처음 사라짐 ${a.firstPanelGone ? a.firstPanelGone - since : '-'}ms, 함께 보인 표본 ${a.both}`,
  );
  if (lp)
    check(
      `${label}: 기록한 패널 닫힘 시각 >= 큰 창 보임 시각`,
      lp.shownAt !== undefined && lp.panelClosedAt !== undefined && lp.panelClosedAt >= lp.shownAt,
      `보임 +${lp.shownAt - lp.requestedAt}ms, 닫힘 +${lp.panelClosedAt - lp.requestedAt}ms`,
    );
  else check(`${label}: 승격 기록이 있다`, false);
  const h = await page('home');
  await h.until(() => h.ev("!!document.querySelector('.surface.home .panel-tabpanel')"));
  await sleep(500);
  await verify(h);
  return h;
}

const body = async () => {
  await main('1');
  const NOW = await main('Date.now()');
  await sleep(1500);

  // ---- 시험 거리: 할 일 60개(스크롤), 메모, 이틀 뒤 일정 ----
  const titles = todoTitles(60, tx('할 일', 'Task'));
  for (const title of titles) await main(`__jj.store.add({ title: ${JSON.stringify(title)} }, ${NOW}); 1`);
  const dayStart = await main('(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })()');
  await main(
    `__jj.events.add({ title: ${JSON.stringify(tx('치과', 'Dentist'))}, startAt: ${dayStart + 3 * 86_400_000 + 10 * 3_600_000}, reminds: [] }, ${NOW}); 1`,
  );
  const noteTitle = tx('장보기 목록', 'Shopping list');
  await main(
    `__jj.notes.add({ title: ${JSON.stringify(noteTitle)}, body: ${JSON.stringify(tx('우유\n달걀', 'Milk\nEggs'))} }, ${NOW}); 1`,
  );
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (offset) =>
    main(
      `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`,
    );

  // 메뉴는 열지 않고 받아 둔다 (트레이, 펫 우클릭): 진짜 메뉴가 뜨지 않게
  await main(`(() => {
    const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__t = { menus: [], tray: [], pet: [] };
    E.Menu.buildFromTemplate = (tpl) => { globalThis.__t.menus.push(tpl); return { popup() {} }; };
    __jj.tray.popUpContextMenu = () => {};
    return 1;
  })()`);

  // ===================== 1. 머리줄 단추: 이름, 폭, 찍기 =====================
  {
    const p = await openPanel('today');
    const btn = await p.ev(`(() => { const b = document.querySelector('.expand-btn'); return b ? JSON.stringify({ label: b.getAttribute('aria-label'), title: b.title, tag: b.tagName, svg: !!b.querySelector('svg') }) : null; })()`);
    const info = btn ? JSON.parse(btn) : null;
    check('머리줄에 "크게 보기" 단추가 있다 (아이콘, 접근성 이름, 풀이)', !!info && info.svg && info.tag === 'BUTTON' && info.label === tx('크게 보기', 'Open large window') && info.title.length > 8, JSON.stringify(info));
    check('단추 이름에 ' + tx('영어', '한글') + ' 이 섞이지 않았다', ko ? !/[A-Za-z]{4}/.test(info?.label ?? '') : !/[가-힣]/.test(`${info?.label}${info?.title}`));
    check('"모드" 라는 낱말이 없다', !/모드|mode/i.test(`${info?.label}${info?.title}`));
    for (const w of [320, 360, 560]) {
      await setPanelBounds(w);
      await sleep(400);
      const geo = JSON.parse(
        await p.ev(`(() => {
          const h = document.querySelector('.panel header').getBoundingClientRect();
          const btns = [...document.querySelectorAll('.panel header .icon-btn')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.width]; });
          const name = document.querySelector('.panel header strong').getBoundingClientRect();
          return JSON.stringify({ hr: h.right, btns, nameW: name.width, win: innerWidth });
        })()`),
      );
      const inside = geo.btns.length === 3 && geo.btns.every(([l, r, wd]) => l >= 0 && r <= geo.win && wd >= 24);
      const gaps = geo.btns.every(([l], i) => i === 0 || l >= geo.btns[i - 1][1] - 0.5);
      check(`폭 ${w}: 머리줄 단추 셋(고정, 크게 보기, 설정)이 겹치지 않고 안에 있다`, inside && gaps, JSON.stringify(geo.btns.map((b) => Math.round(b[0]))));
      check(`폭 ${w}: 펫 이름이 보인다 (너비 ${Math.round(geo.nameW)})`, geo.nameW >= 24);
      const over = await overflow(p, '.panel');
      check(`폭 ${w}: 가로 넘침 없음`, over.length === 0, over.join(', '));
    }
    await setPanelBounds(360);
    await sleep(300);
    // 단추를 키보드로: Tab 순서와 포커스 보임
    const focusOk = await p.ev(`(() => { const b = document.querySelector('.expand-btn'); b.focus(); return document.activeElement === b; })()`);
    check('단추에 키보드 포커스가 간다', focusOk);
    await p.shot('164-header-light');
    await p.dark(true);
    await sleep(200);
    await p.shot('164-header-dark');
    await p.dark(false);
  }

  // ===================== 2. 칩: 언제 뜨고 언제 안 뜨나 =====================
  {
    let p = await openPanel('today');
    await watchChips(p);
    await main('__jj.panel.window.setBounds({ ...__jj.panel.window.getBounds(), width: 360, height: 540 }); 1');
    await sleep(300);
    // (a) 아직 못 닿았다: 360 -> 480
    await drag(p, '.grip-se', 120, 0, { steps: 6 });
    check('칩 (a) 560 에 못 닿았으면 안 뜬다', (await chips(p)) === 0 && (await panelWidth()) < 560, `너비 ${await panelWidth()}`);
    // (b) 560 을 넘겨 끈다: 한 번만
    await drag(p, '.grip-se', 400, 0, { steps: 12, hold: true });
    const w560 = await panelWidth();
    check('칩 (b) 가장 넓게(560) 만든 채 더 끌면 칩이 뜬다', w560 === 560 && (await chipUp(p)), `너비 ${w560}, 칩 ${await chips(p)}번`);
    const chipInfo = JSON.parse(
      await p.ev(`(() => { const c = document.querySelector('.expand-chip'); const b = c?.querySelector('button'); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ role: c.getAttribute('role'), text: b.textContent.trim(), l: r.left, r: r.right, t: r.top, b: r.bottom, win: innerWidth, winH: innerHeight }); })()`),
    );
    check('칩 글과 위치 (ko/en, 창 안, role=status)', chipInfo?.text === tx('크게 볼까요?', 'Want a bigger view?') && chipInfo.role === 'status' && chipInfo.l >= 0 && chipInfo.r <= chipInfo.win, JSON.stringify(chipInfo));
    await p.shot('164-chip-560');
    for (const dark of [false, true]) {
      await p.dark(dark);
      await sleep(150);
      const ratio = await p.ev(`(() => {
        const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const b = document.querySelector('.expand-chip-btn'); const cs = getComputedStyle(b);
        const a = lum(cs.color), c = lum(cs.backgroundColor); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
      })()`);
      check(`칩 글자 대비 4.5 이상 (${dark ? '어두움' : '밝음'}: ${ratio.toFixed(2)})`, ratio >= 4.5);
    }
    await p.dark(false);
    // 끄는 중에 더 움직여도 같은 끌기에서는 다시 안 뜬다
    const g = await gripPoint(p, '.grip-se');
    for (let i = 1; i <= 5; i++) {
      await p.mouse('mouseMoved', g.x + 20 * i, g.y, { buttons: 1 });
      await sleep(60);
    }
    await p.mouse('mouseReleased', g.x + 100, g.y, { buttons: 0 });
    await sleep(200);
    check('칩 (c) 같은 끌기에서는 한 번만 (칩이 만들어진 횟수 1)', (await chips(p)) === 1, `${await chips(p)}번`);
    check('칩 (d) 자동으로 바꾸지 않는다 (큰 창 없음, 패널 그대로)', !(await homeAlive()) && (await panelAlive()));
    // 사라짐
    const gone = await p.until(async () => !(await chipUp(p)), 7000);
    check('칩 (e) 몇 초 뒤 저절로 사라진다 (무시하면 끝)', gone && (await panelAlive()) && !(await homeAlive()));
    // (f) 바로 다음 끌기에는 안 뜬다 (너무 자주 안 뜸)
    await drag(p, '.grip-se', 120, 0, { steps: 6 });
    check('칩 (f) 곧바로 다시 끌어도 또 뜨지 않는다 (간격 60초)', (await chips(p)) === 1 && !(await chipUp(p)), `${await chips(p)}번`);
    // (g) 높이만 끌면 안 뜬다: 새 창에서
    p = await openPanel('today');
    await watchChips(p);
    await setPanelBounds(560, 540);
    await sleep(300);
    await drag(p, '.grip-s', 0, 100, { steps: 6 });
    check('칩 (g) 560 인 채로 아래로만 끌면 안 뜬다 (너비를 안 바꾼다)', (await chips(p)) === 0);
    await drag(p, '.grip-se', 0, 30, { steps: 3 });
    check('칩 (h) 560 인 채 모서리를 아래로만 끌어도 안 뜬다', (await chips(p)) === 0);
    // (i) 키보드로
    p = await openPanel('today');
    await watchChips(p);
    await setPanelBounds(520, 540);
    await sleep(300);
    await p.ev("document.querySelector('.grip-se').focus()");
    const key = (shift, k) =>
      p.ev(`document.querySelector('.grip-se').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', shiftKey: ${shift}, bubbles: true, cancelable: true })); 1`);
    await key(true, 'ArrowRight');
    await sleep(400);
    const wk = await panelWidth();
    check('칩 (i) 키보드로 520 에서 늘려 560 에 닿는 동안은 안 뜬다', wk === 560 && (await chips(p)) === 0, `너비 ${wk}`);
    await key(true, 'ArrowRight');
    await sleep(400);
    check('칩 (j) 키보드로 560 에서 더 늘리면 뜬다', (await chips(p)) === 1 && (await chipUp(p)));
    // (k) 칩을 누르면 크게 보기: 아래 승격 시험에서 한다
    await closeAll();
  }

  // ===================== 3. 승격: 탭마다 =====================
  const findQuery = tx('할 일 5', 'Task 5');

  // 3-1. 오늘 탭, 단추
  await promoteCase('오늘(단추, 마우스 누르기)', 'today', 'mouse', async () => {}, async (h) => {
    check('오늘(단추, 마우스 누르기): 같은 탭(오늘)이 열렸다', (await sectionNow(h)) === 'ptab-today', await sectionNow(h));
  });

  // 3-2. 할 일 스크롤 (찾는 말 없이 긴 목록. 찾는 말은 보관되니 찾기 시험보다 먼저)
  await promoteCase(
    '할 일 스크롤(단추)',
    'todo',
    'button',
    async (p) => {
      await p.ev("(() => { const l = document.querySelector('.todos.scroll'); l.scrollTop = 400; return 1; })()");
      await sleep(60);
    },
    async (h) => {
      const top = await h.until(async () => (await h.ev("(() => { const l = [...document.querySelectorAll('.surface.home .scroll')].find((e) => e.scrollTop > 0); return l ? Math.round(l.scrollTop) : 0; })()")) > 0, 3000);
      check('할 일 스크롤(단추): 스크롤 위치가 남아 있다', top);
      if (!top) console.log('  진단', await h.ev("JSON.stringify({ todos: document.querySelectorAll('li.todo').length, ih: innerHeight, de: document.documentElement.scrollHeight, listH: [...document.querySelectorAll('.todos')].map((e) => e.className + ':' + e.clientHeight + '/' + e.scrollHeight + '/' + getComputedStyle(e).overflowY) })"));
      if (!top) console.log('  스크롤 칸', await h.ev("JSON.stringify([...document.querySelectorAll('.surface.home *')].filter((e) => e.scrollHeight > e.clientHeight + 4 && ['auto','scroll'].includes(getComputedStyle(e).overflowY)).map((e) => e.className + ':' + e.scrollTop + '/' + e.scrollHeight + '/' + e.clientHeight))"));
    },
  );
  await closeAll();

  // 3-3. 할 일: 쓰던 글, 찾는 말, 스크롤 (단추)
  await promoteCase(
    '할 일(단추)',
    'todo',
    'button',
    async (p) => {
      await p.click("document.querySelector('.find-btn')");
      await fresh(p, '.find-row input', findQuery);
      await sleep(400);
      await fresh(p, '.add input', todoDraft);
      // 목록을 아래로: 찾는 말을 비운 긴 목록이 아니라 찾은 결과여도 스크롤 칸이 있으면 굴린다
      await p.ev("(() => { const l = document.querySelector('.todos.scroll'); if (l) l.scrollTop = 120; return 1; })()");
    },
    async (h) => {
      check('할 일(단추): 같은 탭(할 일)이 열렸다', (await sectionNow(h)) === 'ptab-todo', await sectionNow(h));
      check('할 일(단추): 쓰던 글이 입력칸에 그대로 있다', (await h.ev("document.querySelector('.add input')?.value")) === todoDraft);
      check('할 일(단추): 찾는 말이 그대로 있다', (await h.ev("document.querySelector('.find-row input')?.value")) === findQuery);
    },
  );
  await closeAll();

  // 3-4. 일정: 고른 날
  const pickDay = await dayOf(3);
  const dayAfter = await dayOf(5);
  await promoteCase(
    '일정(단추)',
    'event',
    'button',
    async (p) => {
      // 달력 보기로 바꾸고 5일 뒤를 고른다 (이번 달 안이 아닐 수 있어 같은 달 날짜를 고른다)
      const cal = await p.click("document.querySelector('.view-switch button:nth-child(2)')");
      await sleep(300);
      const ok = await p.click(`document.querySelector('[data-day="${dayAfter}"] button')`);
      if (!ok) console.log('알림: 달력에서', dayAfter, '칸을 못 찾음', cal);
    },
    async (h) => {
      check('일정(단추): 같은 탭(일정)이 열렸다', (await sectionNow(h)) === 'ptab-event', await sectionNow(h));
      const picked = await h.ev(`document.querySelector('.cal-cell.on')?.getAttribute('data-day') ?? document.querySelector('.cal-day.on')?.getAttribute('data-day') ?? null`);
      check('일정(단추): 고른 날이 그대로다', picked === dayAfter, `${picked} / ${dayAfter}, ${pickDay}`);
    },
  );
  await closeAll();

  // 3-5. 메모: 열린 메모, 아직 저장 전인 글 (단추)
  const noteExtra = tx(' 쓰던 줄', ' half line');
  await promoteCase(
    '메모(단추)',
    'note',
    'button',
    async (p) => {
      await p.click("document.querySelector('.notes li > button')");
      await sleep(500);
      await p.ev("(() => { const b = document.querySelector('.note-editor textarea'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); return 1; })()");
      // 저장 주기(0.5초)를 기다리지 않고 바로 넘긴다
      await p.type(noteExtra);
    },
    async (h) => {
      check('메모(단추): 같은 탭(메모)이 열렸다', (await sectionNow(h)) === 'ptab-note', await sectionNow(h));
      const ok = await h.until(async () => (await h.ev("document.querySelector('.note-editor textarea')?.value ?? ''")).includes(noteExtra.trim()), 4000);
      const val = await h.ev("document.querySelector('.note-editor textarea')?.value ?? ''");
      check('메모(단추): 열려 있던 메모가 열려 있고 아직 저장 전인 글이 그대로다', ok && val.includes(tx('우유', 'Milk')), JSON.stringify(val));
      const title = await h.ev("document.querySelector('.note-editor .note-title-input')?.value ?? ''");
      check('메모(단추): 같은 메모다', title === noteTitle, title);
      // 저장된 글도 같은지 (잃지 않았다)
      const saved = await main(`JSON.stringify(__jj.notes.list?.().find?.((n) => n.title === ${JSON.stringify(noteTitle)})?.body ?? null)`).catch(() => 'null');
      console.log('  저장된 메모 본문', saved);
    },
  );
  await closeAll();

  // 3-6. 상점
  await promoteCase('상점(단추)', 'shop', 'button', async () => {}, async (h) => {
    check('상점(단추): 같은 탭(상점)이 열렸다', (await sectionNow(h)) === 'ptab-shop', await sectionNow(h));
  });
  await closeAll();

  // 3-7. 칩으로
  await promoteCase(
    '할 일(칩)',
    'todo',
    'chip',
    async (p) => {
      await fresh(p, '.add input', todoDraft);
      await sleep(100);
      await watchChips(p);
      await setPanelBounds(560, 540);
      await sleep(300);
      await drag(p, '.grip-se', 200, 0, { steps: 6, hold: true });
      const up = await p.until(() => chipUp(p), 3000);
      check('할 일(칩): 칩이 떴다', up);
      await p.mouse('mouseReleased', 0, 0, { buttons: 0 });
      await sleep(150);
    },
    async (h) => {
      const got = await h.ev("document.querySelector('.add input')?.value");
      check('할 일(칩): 같은 탭과 쓰던 글이 그대로다', (await sectionNow(h)) === 'ptab-todo' && got === todoDraft, `${await sectionNow(h)} ${JSON.stringify(got)}`);
    },
  );
  await closeAll();

  // 3-8. 패널이 열린 채 트레이, 펫 메뉴
  await main(`(() => {
    __jj.tray.emit('right-click');
    globalThis.__t.tray = [globalThis.__t.menus.at(-1)];
    return 1;
  })()`);
  const trayLabels = JSON.parse(await main('JSON.stringify(__t.tray.at(-1).map((i) => i.label ?? null))'));
  check('트레이에 "큰 창 열기"가 있다', trayLabels.includes(tx('큰 창 열기', 'Open large window')), trayLabels.join(' | '));
  const petPage = await page('pet');
  await petPage.ev('window.jjakkung.contextMenu(); 1');
  await sleep(700);
  await main('globalThis.__t.pet = [globalThis.__t.menus.at(-1)]; 1');
  const petLabels = JSON.parse(await main('JSON.stringify(__t.pet.at(-1).map((i) => i.label ?? null))'));
  check('펫 우클릭 메뉴에 "크게 보기"가 있다', petLabels.includes(tx('크게 보기', 'Open large window')), petLabels.filter(Boolean).join(' | '));

  for (const via of ['tray', 'pet']) {
    const name = via === 'tray' ? '트레이' : '펫 메뉴';
    await promoteCase(
      `할 일(${name}, 패널이 열린 채)`,
      'todo',
      via,
      async (p) => {
        await fresh(p, '.add input', todoDraft);
      },
      async (h) => {
        check(`할 일(${name}): 같은 탭과 쓰던 글이 그대로다`, (await sectionNow(h)) === 'ptab-todo' && (await h.ev("document.querySelector('.add input')?.value")) === todoDraft);
      },
    );
    await closeAll();
  }

  // ===================== 4. 경계 =====================
  // 4-1. 패널이 안 열려 있을 때 트레이, 펫 메뉴: 그냥 큰 창
  for (const via of ['tray', 'pet']) {
    await closeAll();
    await main(`__t.${via}.at(-1).find((i) => i.label === ${JSON.stringify(via === 'tray' ? tx('큰 창 열기', 'Open large window') : tx('크게 보기', 'Open large window'))}).click(); 1`);
    check(`패널이 없을 때 ${via === 'tray' ? '트레이' : '펫 메뉴'}: 큰 창이 뜬다`, await waitFor(homeShown));
  }
  await closeAll();

  // 4-2. 숨겨 둔 큰 창이 있을 때: 낡은 글을 쓰지 않고 새로 만든다
  {
    await main('__jj.home.open(); 1');
    await waitFor(homeShown);
    const h0 = await page('home');
    await h0.until(() => h0.ev("!!document.querySelector('.surface.home .add input')").catch(() => false), 2000);
    await main('__jj.home.hide(); 1');
    await sleep(500);
    const hid = JSON.parse(await main('JSON.stringify(__jj.home.look())'));
    check('경계: 큰 창을 숨겨 두었다', hid.alive && hid.hidden);
    const oldWin = await main('__jj.home.window.id');
    const h = await promoteCase(
      '숨겨 둔 큰 창이 있을 때',
      'todo',
      'button',
      async (p) => {
        await fresh(p, '.add input', todoDraft);
      },
      async (hh) => {
        check('숨겨 둔 큰 창이 있을 때: 쓰던 글이 새 큰 창에 나온다 (낡은 창을 쓰지 않았다)', (await hh.ev("document.querySelector('.add input')?.value")) === todoDraft);
      },
    );
    const newWin = await main('__jj.home.window.id');
    check('숨겨 둔 큰 창이 있을 때: 새 창으로 바뀌었다', newWin !== oldWin, `${oldWin} -> ${newWin}`);
    void h;
    await closeAll();
  }

  // 4-3. 큰 창이 이미 열려 있으면 앞으로만 (패널은 같이 안 열린다)
  {
    await main('__jj.home.open(); 1');
    await waitFor(homeShown);
    const idBefore = await main('__jj.home.window.id');
    await main('__jj.home.promote("note"); 1');
    await sleep(600);
    const idAfter = await main('__jj.home.window.id');
    check('경계: 큰 창이 열려 있을 때 승격은 새로 만들지 않고 그 창을 쓴다', idBefore === idAfter && (await homeShown()));
    await closeAll();
  }

  // 4-4. 패널이 멈췄을 때: 트레이가 1.5초 뒤 그냥 큰 창을 엶
  {
    const p = await openPanel('today');
    await p.ev('1');
    // 패널 화면을 3.5초 붙잡는다 (답을 하지 못함)
    const stuck = p.ev('(() => { const t = Date.now(); while (Date.now() - t < 3500); return 1; })()', 10_000).catch(() => 0);
    await sleep(150);
    const t0 = Date.now();
    await main(`__t.tray.at(-1).find((i) => i.label === ${JSON.stringify(tx('큰 창 열기', 'Open large window'))}).click(); 1`);
    const opened = await waitFor(async () => await homeAlive(), 3000);
    const dt = Date.now() - t0;
    check('경계: 패널이 멈춰 있어도 트레이 "큰 창 열기"가 1.5초쯤 뒤 큰 창을 연다', opened && dt >= 1200 && dt < 3300, `${dt}ms`);
    await stuck;
    await sleep(800);
    await waitFor(homeShown);
    check('경계: 멈춘 패널이 풀린 뒤에도 큰 창이 보인다', await homeShown());
    await closeAll();
  }

  // ===================== 5. 비교 그림용 찍기 =====================
  {
    const p = await openPanel('today');
    await setPanelBounds(360, 540);
    await sleep(400);
    await p.shot('164-panel-after', { x: 0, y: 0, width: 360, height: 130 });
    await p.ev(`(() => { const b = document.querySelector('.expand-btn'); b.style.display = 'none'; return 1; })()`);
    await sleep(200);
    await p.shot('164-panel-before', { x: 0, y: 0, width: 360, height: 130 });
    await p.ev(`(() => { document.querySelector('.expand-btn').style.display = ''; return 1; })()`);
    await watchChips(p);
    await setPanelBounds(560, 540);
    await sleep(300);
    await drag(p, '.grip-se', 120, 0, { steps: 4, hold: true });
    await p.until(() => chipUp(p), 3000);
    await sleep(300);
    await p.shot('164-panel-chip', { x: 0, y: 0, width: 560, height: 200 });
    await p.mouse('mouseReleased', 0, 0, { buttons: 0 });
    await closeAll();
  }
};

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
