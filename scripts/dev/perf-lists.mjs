// 긴 목록과 설정 창 성능 고침 점검 (perf/app-round1). 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 9800~9999 무작위) CDP 로만 다룬다.
// 진짜 마우스, 키보드, 포커스, 진짜 AI 는 쓰지 않는다. HOME 도 임시 폴더고 끝나면 폴더를 지우고 PID 로만 끈다.
//
//   npm run build && LANG_UNDER_TEST=ko node scripts/dev/perf-lists.mjs
//
// 보는 것:
//   일정 목록: 100줄씩 그리고 "더 보기"로 이어 펴기, 끝까지 펴면 전부, 할 일 탭에서 되돌아와도 다시 그리는 쪽 수는 2쪽까지
//   할 일: 더 보기 뒤 줄 누르기(끝내기)와 순서 단추가 최신 목록으로 동작 (memo 줄이 옛 함수를 쥐지 않음)
//   메모: 더 보기 뒤에도 줄을 눌러 열림
//   달력: 월에서 주로 바꿔도(다시 받지 않고 고름) 그 주의 일정이 다시 받은 것과 같음
//   설정 창: 펫 고르기 그림(기본 펫 다섯)이 늦게 읽는 그리기 묶음으로도 찍힘 (2D, 입체 둘 다)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fails++;
};

const portFree = (p) =>
  new Promise((r) => {
    const s = createServer();
    s.once('error', () => r(false));
    s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
  });
async function pickPort(not = 0) {
  for (;;) {
    const p = 9800 + Math.floor(Math.random() * 200);
    if (p !== not && (await portFree(p))) return p;
  }
}
const INSPECT = await pickPort();
const PAGE = await pickPort(INSPECT);

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.perf-lists-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, wander: false, panelView: 'compact' }),
);
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
const conns = [];
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  conns.push(ws);
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          ws.removeEventListener('message', h);
          r(m);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return {
    ev: async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails)
        throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
      return m.result?.result?.value;
    },
  };
}
let mainConn;
const main = async (expr) => {
  for (let i = 0; i < 400 && !mainConn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      mainConn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(25);
    }
  }
  return mainConn.ev(expr);
};
const pages = new Map();
async function page(name) {
  for (let i = 0; i < 200; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.filter((x) => x.type === 'page' && x.url.includes(`${name}.html`)).at(-1);
      if (p) {
        if (!pages.has(p.id)) pages.set(p.id, await connect(p.webSocketDebuggerUrl));
        return pages.get(p.id);
      }
    } catch {}
    await sleep(25);
  }
  throw new Error(`no page ${name}`);
}
const count = (pg, sel) => pg.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (pg, sel) => pg.ev(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);

try {
  await main('1');
  await page('pet');
  await sleep(2500);
  await main(`(() => {
    const now = Date.now(); const day = 86400000;
    const iso = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = 0; i < 520; i++) __jj.store.add({ title: '시험 할 일 ' + (i + 1), due: iso(now + ((i % 30) + 1) * day) }, now + i);
    for (let i = 0; i < 230; i++) __jj.notes.add({ title: '시험 메모 ' + (i + 1), body: '내용 ' + i }, now + i);
    for (let i = 0; i < 260; i++) {
      const start = now + (1 + (i % 12)) * day + (8 + (i % 10)) * 3600000;
      __jj.events.add({ title: '시험 일정 ' + i, startAt: start, endAt: start + 1800000 }, now);
    }
    return 1; })()`);

  // ---- 패널 ----
  await main(`__jj.panel.openTab('today'); 1`);
  await sleep(1200);
  await main(`__jj.panel.window.removeAllListeners('blur'); 1`);
  const pg = await page('panel');
  const tab = async (id) => {
    await click(pg, `#ptab-${id}`);
    await sleep(500);
  };

  await tab('event');
  check('일정 목록은 100줄만 그린다', (await count(pg, '#ptab-panel .events-list li.event')) === 100);
  check('일정 목록 끝에 더 보기', (await count(pg, '#ptab-panel .events-list li.more button')) === 1);
  await click(pg, '#ptab-panel .events-list li.more button');
  await sleep(400);
  check('더 보기 한 번이면 200줄', (await count(pg, '#ptab-panel .events-list li.event')) === 200);
  await click(pg, '#ptab-panel .events-list li.more button');
  await sleep(400);
  check('끝까지 펴면 260줄 전부, 더 보기 사라짐', (await count(pg, '#ptab-panel .events-list li.event')) === 260 && (await count(pg, '#ptab-panel .events-list li.more')) === 0);

  await tab('todo');
  check('할 일은 100줄만 그린다', (await count(pg, '#ptab-panel ul.todos li.todo')) === 100);
  for (let i = 0; i < 4; i++) {
    await click(pg, '#ptab-panel ul.todos li.more button');
    await sleep(300);
  }
  check('더 보기 네 번이면 500줄', (await count(pg, '#ptab-panel ul.todos li.todo')) === 500);
  // 더 보기 뒤에 새로 그려진 줄의 끝내기 단추가 최신 목록으로 동작 (memo 줄이 옛 함수를 쥐지 않는다)
  const victim = await pg.ev(`(() => { const li = document.querySelectorAll('#ptab-panel ul.todos li.todo')[450]; const title = li.querySelector('.title').textContent; li.querySelector('button.check').click(); return title; })()`);
  await sleep(700);
  const gone = await pg.ev(`![...document.querySelectorAll('#ptab-panel ul.todos li.todo .title')].some((x) => x.textContent === ${JSON.stringify(victim)})`);
  check('더 보기로 그려진 450번째 줄을 끝내면 그 줄이 사라진다', gone === true, victim);
  await tab('today');
  await tab('todo');
  const kept = await count(pg, '#ptab-panel ul.todos li.todo');
  check('탭을 갔다 와도 다시 그리는 줄은 200줄까지', kept === 200, String(kept));
  await click(pg, '#ptab-panel ul.todos li.more button');
  await sleep(300);
  check('더 보기로 이어 펴짐', (await count(pg, '#ptab-panel ul.todos li.todo')) === 300);

  await tab('note');
  check('메모는 100줄만 그린다', (await count(pg, '#ptab-panel ul.notes li.note-row')) === 100);
  await click(pg, '#ptab-panel ul.notes li.more button');
  await sleep(300);
  check('메모 더 보기 뒤 200줄', (await count(pg, '#ptab-panel ul.notes li.note-row')) === 200);
  await pg.ev(`document.querySelectorAll('#ptab-panel ul.notes li.note-row button')[150].click(); 1`);
  await sleep(700);
  check('더 보기 뒤 줄을 누르면 편집기가 열린다', (await count(pg, '#ptab-panel .note-editor, #ptab-panel textarea')) > 0);

  // ---- 달력: 월에서 주로 ----
  await tab('event');
  await click(pg, '.view-switch button:nth-of-type(2)');
  await sleep(700);
  await click(pg, '.cal-mode button:nth-of-type(2)');
  await sleep(500);
  const titles = () =>
    pg.ev(`[...document.querySelectorAll('.cal-days li.event')].map((x) => x.textContent).join('|')`);
  const rows = () => count(pg, '.cal-days li.event');
  const direct = await rows();
  const directTitles = await titles();
  // 다음 주, 이전 주로 갔다 오면 새로 받는다
  await pg.ev(`document.querySelectorAll('.cal-nav')[1].click(); 1`);
  await sleep(500);
  await pg.ev(`document.querySelectorAll('.cal-nav')[0].click(); 1`);
  await sleep(600);
  const refetched = await rows();
  check('월에서 주로 바꾼 줄이 새로 받은 것과 같다', direct === refetched && directTitles === (await titles()), `${direct} / ${refetched}`);
  check('주 목록에 일정이 보인다', direct > 0, String(direct));

  // ---- 언어를 바꾸면 memo 줄도 새 언어로 ----
  await click(pg, '.view-switch button:nth-of-type(1)');
  await sleep(500);
  const words = (sel) =>
    pg.ev(`(() => { const li = document.querySelector(${JSON.stringify(sel)}); return li ? [...li.querySelectorAll('[aria-label],[title]')].map((x) => x.getAttribute('aria-label') + '/' + x.getAttribute('title')).join('|') + '#' + li.innerText : ''; })()`);
  const rowsOf = {
    todo: '#ptab-panel ul.todos li.todo',
    event: '#ptab-panel .events-list li.event',
    note: '#ptab-panel ul.notes li.note-row',
  };
  // 탭을 떠나지 않고 바꾼다 (탭을 새로 그리면 옛 글이 남아도 안 보인다)
  const other = LANG === 'ko' ? 'en' : 'ko';
  for (const id of ['todo', 'event', 'note']) {
    await tab(id);
    const was = await words(rowsOf[id]);
    await main(`__jj.settings.set({ lang: '${other}' }); 1`);
    await sleep(1200);
    const now = await words(rowsOf[id]);
    check(`언어를 바꾸면 떠 있는 ${id} 줄 글도 바뀐다`, was !== '' && now !== '' && now !== was);
    await main(`__jj.settings.set({ lang: '${LANG}' }); 1`);
    await sleep(800);
  }

  // ---- 설정: 펫 고르기 그림 ----
  for (const pet3d of [true, false]) {
    await main(`__jj.settings.set({ pet3d: ${pet3d} }); __jj.settingsWindow.window?.close(); 1`);
    await sleep(500);
    await main(`__jj.settingsWindow.open(); 1`);
    await sleep(1200);
    const sp = await page('settings');
    let n = 0;
    for (let i = 0; i < 40; i++) {
      n = await sp.ev(`document.querySelectorAll('.pet-grid .pet-card:not(.starter) img[src^="data:image"]').length`);
      if (n >= 5) break;
      await sleep(150);
    }
    check(`펫 고르기 기본 펫 그림 다섯 장 (${pet3d ? '입체' : '2D'})`, n >= 5, String(n));
  }
} catch (e) {
  console.log('ERR', e instanceof Error ? e.stack : String(e));
  fails++;
} finally {
  for (const ws of conns) {
    try {
      ws.close();
    } catch {}
  }
  try {
    app.kill('SIGTERM');
  } catch {}
  await sleep(900);
  try {
    app.kill('SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
