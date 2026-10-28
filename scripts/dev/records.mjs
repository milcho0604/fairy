// 기록 통합 점검 (이슈 #125): 할 일 휴지통 30일, 집중 월간 잔디, 펫 대사 고치기를 실제 앱 화면에서 누르며 본다.
//
//   npm run build && OUT=/tmp/fairy-125 LANG_UNDER_TEST=ko node scripts/dev/records.mjs
//
// 4번째 묶음 home (#166): 큰 창 사이드바 "기록" 구역에 같은 구성요소(위 1~2번과 같은 선택자)가 한곳에 펼쳐지는지,
// 큰 창 기본 폭(1100)과 좁은 폭(760)에서 배치와 넘침, 작은 패널은 그대로인지(탭 줄에 기록 없음, 줄이 접힌 채)를 본다.
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
const ONLY = process.env.ONLY ?? 'trash,focus,lines,home';
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

const body = async () => {
  await main('1');
  const pet = await page('pet');
  let p;
  await sleep(1500);
  // 코인 장부, 잔액 읽기
  const balance = () => main('__jj.store.balance()');

  // ===================== 1. 할 일 휴지통 =====================
  if (ONLY.includes('trash')) {
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(1500);
  p = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const add = async (text) => {
    await p.ev(`document.querySelector('.add input').focus()`);
    await p.type(text);
    await p.key('Enter', 'Enter', 13);
    await sleep(250);
  };
  for (const title of [tx('휴지통 시험 하나', 'Trash test one'), tx('휴지통 시험 둘', 'Trash test two'), tx('휴지통 시험 셋', 'Trash test three')])
    await add(title);
  const rowExpr = (name) =>
    `[...document.querySelectorAll('.todos .todo')].find((li) => li.innerText.includes(${JSON.stringify(name)}))`;
  const openTitles = () =>
    p.ev(`[...document.querySelectorAll('.todos:not(.trash-list) .todo .title')].map((e) => e.innerText).join('|')`);
  /** 휴지통 칸을 연 상태로(true) 닫은 상태로(false) 맞춘다 */
  const trashOpen = () => p.ev(`document.querySelector('.trash-toggle')?.getAttribute('aria-expanded') === 'true'`);
  const setTrash = async (want) => {
    // 지운 직후 아래에 뜨는 되돌리기 알림이 휴지통 줄을 가리니 사라질 때까지 기다린다
    await p.until(() => p.ev(`!document.querySelector('.toast')`), 12000);
    if ((await trashOpen()) !== want) {
      await p.click(`document.querySelector('.trash-toggle')`);
      await sleep(450);
    }
  };
  check('할 일 셋을 화면에서 넣음', (await main('__jj.store.list(Date.now()).open.length')) === 3);
  /** 줄 끝 "..." 메뉴를 열어 "지우기" 를 누른다 (#146: 줄에 겹쳐 뜨던 × 는 메뉴로 모였다) */
  const removeVia = async (name) => {
    const opened = await p.click(`${rowExpr(name)}.querySelector('.row-more')`);
    await sleep(350);
    return opened && (await p.click(`document.querySelector('.row-menu button.danger')`));
  };

  // 하나를 끝내 코인을 받는다
  await p.click(`${rowExpr(tx('하나', 'one'))}.querySelector('.check')`);
  await sleep(500);
  const coinsAfterDone = await balance();
  check('끝내면 코인이 들어옴', coinsAfterDone > 0, `잔액 ${coinsAfterDone}`);

  // 둘째를 지운다 (줄에 마우스를 올려야 × 가 나온다)
  const removed = await removeVia(tx('둘', 'two'));
  await sleep(500);
  check('× 로 지움', removed && !(await openTitles()).includes(tx('둘', 'two')));
  check('지워도 코인은 그대로', (await balance()) === coinsAfterDone);
  check(
    '패널에 휴지통 줄이 생기고 개수가 1',
    await p.until(() => p.ev(`document.querySelector('.trash-toggle')?.innerText.includes('1')`)),
  );

  // 휴지통을 연다
  await setTrash(true);
  await p.until(() => p.ev(`!!document.querySelector('.trash-item')`));
  const itemText = await p.ev(`document.querySelector('.trash-item')?.innerText ?? ''`);
  check('휴지통에 지운 할 일과 남은 날(30일)이 보임', itemText.includes(tx('둘', 'two')) && /30/.test(itemText), itemText.replace(/\n/g, ' / '));
  await p.shots('trash-open', `document.querySelector('.panel')`);
  check('휴지통 걸러 보기 첫 링크는 "전체" (제목과 이름이 겹치지 않음)', (await p.ev(`document.querySelector('.trash-body > .trash-actions .link')?.innerText.trim()`)) === tx('전체', 'All'));

  // 되살리기
  await p.click(`document.querySelector('.trash-item button.link:not(.danger)')`);
  await p.until(async () => (await openTitles()).includes(tx('둘', 'two')));
  check('되살리기: 할 일 목록에 돌아옴', (await openTitles()).includes(tx('둘', 'two')));
  check('되살려도 코인 그대로 (두 번 들어오지 않음)', (await balance()) === coinsAfterDone, `잔액 ${await balance()}`);
  check('되살린 뒤 휴지통 목록이 빔', await p.until(() => p.ev(`!!document.querySelector('.trash-empty') && !document.querySelector('.trash-item')`)));
  await setTrash(false);
  check('닫으면 휴지통 줄이 사라짐', await p.until(() => p.ev(`!document.querySelector('.trash-toggle')`)));

  // 끝낸 할 일을 휴지통으로 보내고(메인에서, 끝낸 줄에는 × 가 없다) 되살려도 코인 불변
  const doneId = await main(`__jj.store.list(Date.now()).doneToday[0]?.id`);
  await main(`__jj.store.remove(${doneId}, Date.now()); __jj.panel.refresh(); 1`);
  await sleep(500);
  await setTrash(true);
  await p.until(() => p.ev(`!!document.querySelector('.trash-item')`));
  check(
    '끝낸 일은 휴지통에 "끝낸 일" 표시',
    (await p.ev(`document.querySelector('.trash-item')?.innerText ?? ''`)).includes(tx('끝낸 일', 'Done')),
  );
  await p.click(`document.querySelector('.trash-item button.link:not(.danger)')`);
  await sleep(500);
  check('끝낸 일 되살림: 잔액 그대로', (await balance()) === coinsAfterDone);
  check(
    '끝낸 일 되살림: 여전히 끝낸 상태',
    (await main(`__jj.store.list(Date.now()).doneToday.length`)) === 1,
  );

  // 영구 삭제
  await setTrash(false);
  await removeVia(tx('셋', 'three'));
  await sleep(400);
  await setTrash(true);
  await p.until(() => p.ev(`!!document.querySelector('.trash-item')`));
  await p.click(`document.querySelector('.trash-item button.link.danger')`);
  check('영구 삭제: 확인 문구가 먼저 나옴', await p.until(() => p.ev(`!!document.querySelector('.trash-confirm-one')`)));
  check('확인 전에는 아직 지워지지 않음 (낱개)', (await main('__jj.store.trashCount()')) === 1);
  await p.click(`document.querySelector('.trash-confirm-one button.danger')`);
  await p.until(async () => (await main('__jj.store.trashCount()')) === 0);
  check('영구 삭제: 휴지통이 비고 되살릴 수 없음', (await main('__jj.store.trashCount()')) === 0);
  check('영구 삭제해도 코인 그대로', (await balance()) === coinsAfterDone);

  // 비우기 (확인 한 번)
  await setTrash(false);
  const first = tx('비우기 시험 가', 'Empty test a');
  const second = tx('비우기 시험 나', 'Empty test b');
  await add(first);
  await add(second);
  for (const name of [first, second]) {
    await removeVia(name);
    await sleep(300);
  }
  await setTrash(true);
  await p.until(() => p.ev(`document.querySelectorAll('.trash-item').length === 2`));
  await p.click(`document.querySelector('.trash-empty-all')`);
  check('비우기: 확인 문구가 먼저 나옴', await p.until(() => p.ev(`!!document.querySelector('.trash-confirm')`)));
  await p.shots('trash-confirm', `document.querySelector('.panel')`);
  check('확인 전에는 아직 지워지지 않음', (await main('__jj.store.trashCount()')) === 2);
  await p.click(`document.querySelector('.trash-confirm button.danger')`);
  await p.until(async () => (await main('__jj.store.trashCount()')) === 0);
  check('비우기 확인 뒤 휴지통이 빔', (await main('__jj.store.trashCount()')) === 0);
  await setTrash(false);

  // 30일 만료: 시계를 당겨 연다
  const keep = tx('보관 시험', 'Keep test');
  await add(keep);
  await removeVia(keep);
  await sleep(400);
  const toggleOpen = async () => {
    await p.click(`document.querySelector('.trash-toggle')`);
    await sleep(500);
  };
  const shiftClock = (days) =>
    main(
      `globalThis.__realNow ??= Date.now.bind(Date); Date.now = () => globalThis.__realNow() + ${days} * 86400000; 1`,
    );
  const restoreClock = () => main(`if (globalThis.__realNow) Date.now = globalThis.__realNow; 1`);
  await setTrash(false);
  await shiftClock(29);
  await toggleOpen(); // 29일 뒤에 열기
  const day29 = await p.ev(`document.querySelector('.trash-item')?.innerText ?? ''`);
  check('29일 뒤에도 남아 있고 "1일 뒤 사라져"', day29.includes(keep) && /(1일|1 day)/.test(day29), day29.replace(/\n/g, ' / '));
  await toggleOpen(); // 닫기
  await shiftClock(31);
  await toggleOpen(); // 31일 뒤에 열기
  await sleep(500);
  const count31 = await main('__jj.store.trashCount()');
  await restoreClock();
  check('31일 뒤에 열면 자동으로 영구 삭제됨', count31 === 0, `휴지통 ${count31}`);
  check('만료 삭제 뒤 코인 그대로', (await balance()) === coinsAfterDone);

  }
  // ===================== 2. 집중 월간 잔디 =====================
  if (ONLY.includes('focus')) {
  await main("__jj.panel.openTab('today'); 1");
  await sleep(800);
  const todayStr = await main(`new Date().toLocaleDateString('sv-SE')`);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime();
  // 오늘: 25분 + 50분 (가장 길게 50), 사흘 전 130분 한 번 (가장 길게 130), 지난달 15일 60분
  const threeAgo = new Date(ty, tm - 1, td - 3);
  const prevMonthDate = new Date(ty, tm - 2, 15);
  await main(`(() => { const s = __jj.stats; s.addFocus(${at(ty, tm, td, 9, 0)}, 25); s.addFocus(${at(ty, tm, td, 11, 0)}, 50); s.addFocus(${threeAgo.getTime()}, 130); s.addFocus(${prevMonthDate.getTime()}, 60); return 1; })()`);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await main('__jj.panel.refresh(); 1');
  await sleep(600);
  p = await page('panel');
  await p.click(`document.querySelector('.focus-month summary')`);
  check('집중 달력이 열림', await p.until(() => p.ev(`!!document.querySelector('.fm-cell')`)));
  const cellInfo = (day) =>
    p.ev(
      `(() => { const c = document.querySelector('.fm-cell[data-day="${day}"]'); return c ? { cls: c.className, text: c.innerText.replace(/\\s+/g, ' ').trim(), title: c.title, label: c.getAttribute('aria-label') } : null; })()`,
    );
  await p.until(async () => (await cellInfo(todayStr))?.cls.includes('lv3'));
  const todayCell = await cellInfo(todayStr);
  check('오늘 칸: 75분은 3단계, 숫자 75, 툴팁', !!todayCell?.cls.includes('lv3') && todayCell.text.includes('75') && !!todayCell.title, JSON.stringify(todayCell));
  const key3 = key(threeAgo);
  if (key3.slice(0, 7) === todayStr.slice(0, 7)) {
    const c3 = await cellInfo(key3);
    check('사흘 전 칸: 130분은 4단계', !!c3?.cls.includes('lv4') && c3.text.includes('130'), JSON.stringify(c3));
  }
  check(
    '색만으로 구분하지 않음: 집중한 칸마다 숫자와 툴팁',
    await p.ev(
      `[...document.querySelectorAll('.fm-cell.lv1, .fm-cell.lv2, .fm-cell.lv3, .fm-cell.lv4')].every((c) => /\\d/.test(c.querySelector('.fm-m')?.innerText ?? '') && c.title.length > 0 && c.getAttribute('aria-label') === c.title)`,
    ),
  );
  // 날짜 누르기
  await p.click(`document.querySelector('.fm-cell[data-day="${todayStr}"]')`);
  const detail = await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check(
    '날짜를 누르면 총 시간(1시간 15분)과 가장 길게 이어 간 집중(50분)',
    detail.includes(tx('1시간 15분', '1h 15m')) && detail.includes(tx('50분', '50m')),
    detail.replace(/\n/g, ' '),
  );
  await p.shots('focus-month', `document.querySelector('.panel')`);
  // 달 넘기기: 지난달
  const prevDisabledBefore = await p.ev(`document.querySelector('.fm-nav .fm-step')?.disabled`);
  check('기록이 지난달에 있으니 지난달 단추가 눌림', prevDisabledBefore === false);
  check('이번 달에서는 다음 달 단추가 막힘', await p.ev(`document.querySelectorAll('.fm-nav .fm-step')[1]?.disabled`));
  await p.click(`document.querySelector('.fm-nav .fm-step')`);
  const prevKey = key(prevMonthDate);
  await p.until(async () => !!(await cellInfo(prevKey))?.cls.includes('lv3'));
  const pc = await cellInfo(prevKey);
  check('지난달 15일 칸: 60분은 3단계', !!pc?.cls.includes('lv3') && pc.text.includes('60'), JSON.stringify(pc));
  await p.click(`document.querySelector('.fm-cell[data-day="${prevKey}"]')`);
  const detail2 = await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check('지난달 날짜: 총 1시간, 가장 길게 1시간', detail2.split(tx('1시간', '1h')).length - 1 >= 2, detail2.replace(/\n/g, ' '));
  check('가장 오래된 달에서 지난달 단추가 막힘', await p.ev(`document.querySelector('.fm-nav .fm-step')?.disabled`));
  await p.shots('focus-month-prev', `document.querySelector('.panel')`);
  check(
    '가로 넘침 없음',
    !(await p.ev(`[...document.querySelectorAll('.panel *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1)`)),
  );
  await p.click(`document.querySelectorAll('.fm-nav .fm-step')[1]`);

  }
  // ===================== 3. 펫 대사 고치기 =====================
  if (ONLY.includes('lines')) {
  await main('__jj.settingsWindow.open(); 1');
  await sleep(2000);
  const st = await page('settings');
  await main('__jj.settingsWindow.window.setSize(520, 760); 1');
  await sleep(500);
  check('설정에서 "대사 고치기" 단추', await st.click(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(tx('대사 고치기', 'Edit lines'))})`));
  check('대사 고치기 시트가 열림', await st.until(() => st.ev(`!!document.querySelector('.lines-sheet')`)));
  await st.until(() => st.ev(`document.querySelectorAll('.lines-group').length > 5`));
  const groupCount = await st.ev(`document.querySelectorAll('.lines-group').length`);
  const lineCount = await st.ev(`document.querySelectorAll('.lines-row').length`);
  check('상황 묶음 10개 안팎, 대사 100줄 넘게 (빌드된 앱에서 사전 함수 풀기)', groupCount >= 8 && lineCount > 100, `묶음 ${groupCount}, 줄 ${lineCount}`);
  await st.shots('lines-sheet', `document.querySelector('.lines-sheet')`);
  // 밥 먹을 때 하는 말 묶음(food)에서 pet.fed 를 고친다
  await st.click(`document.querySelector('.lines-group[data-group="food"] summary')`);
  const fedBase = await st.ev(`document.querySelector('.lines-row[data-key="pet.fed"] textarea')?.value`);
  check('기본 대사가 틀로 보임', typeof fedBase === 'string' && fedBase.length > 0, fedBase);
  const mine = tx('내가 고친 냠냠 인사!', 'My own yum greeting!');
  await st.ev(`(() => { const t = document.querySelector('.lines-row[data-key="pet.fed"] textarea'); t.focus(); t.select(); })()`);
  await st.type(mine);
  await st.ev(`document.activeElement.blur()`);
  await st.until(async () => (await main(`__jj.lines.overrides().${LANG}['pet.fed'] ?? ''`)) === mine);
  check('고치면 그 칸만 저장됨', (await main(`JSON.stringify(Object.keys(__jj.lines.overrides().${LANG}))`)) === '["pet.fed"]');
  check('저장 파일에 고친 칸만 (speech-lines.json)', (() => {
    try {
      const f = JSON.parse(readFileSync(join(data, 'speech-lines.json'), 'utf8'));
      return Object.keys(f[LANG]).length === 1 && f[LANG]['pet.fed'] === mine;
    } catch {
      return false;
    }
  })());
  check('고친 칸에 "고침" 표시와 기본값으로 단추', await st.ev(`!!document.querySelector('.lines-row[data-key="pet.fed"].edited .lines-edited button')`));
  check('고친 대사가 말풍선 글에 쓰임', (await main(`__jj.lines.line('pet.fed')`)) === mine);
  // 값 검사: {name} 이 있는 대사에서 값을 빼면 거절
  await st.click(`document.querySelector('.lines-group[data-group="idle"] summary')`);
  const idleBase = await st.ev(`document.querySelector('.lines-row[data-key="idle.any.1"] textarea')?.value`);
  check('값이 있는 기본 대사 ({name} 이나 {name:은})', /\{name[:}]/.test(idleBase ?? ''), idleBase);
  await st.ev(`(() => { const t = document.querySelector('.lines-row[data-key="idle.any.1"] textarea'); t.focus(); t.select(); })()`);
  await st.type(tx('이름 없이 고친 말', 'A line with no name'));
  await st.ev(`document.activeElement.blur()`);
  await st.until(() => st.ev(`!!document.querySelector('.lines-row[data-key="idle.any.1"] .lines-error')`));
  const errText = await st.ev(`document.querySelector('.lines-row[data-key="idle.any.1"] .lines-error')?.innerText ?? ''`);
  check('값을 빼면 거절하고 까닭을 보임', errText.includes('{name}') && !(await main(`'idle.any.1' in __jj.lines.overrides().${LANG}`)), errText);
  await st.shots('lines-error', `document.querySelector('.lines-sheet')`);
  // 값을 지킨 채로 고치면 저장되고 펫 이름과 조사가 붙는다
  const withName = tx('{name:이} 오늘도 곁에서 응원하는 중!', '{name} is cheering for you today!');
  await st.ev(`(() => { const t = document.querySelector('.lines-row[data-key="idle.any.1"] textarea'); t.focus(); t.select(); })()`);
  await st.type(withName);
  await st.ev(`document.activeElement.blur()`);
  await st.until(async () => (await main(`__jj.lines.overrides().${LANG}['idle.any.1'] ?? ''`)) === withName);
  const rendered = await main(`__jj.lines.line('idle.any.1', { name: ${JSON.stringify(tx('콩', 'Mochi'))} })`);
  check('값과 조사가 채워진 말풍선 글', rendered === tx('콩이 오늘도 곁에서 응원하는 중!', 'Mochi is cheering for you today!'), rendered);
  check(
    '미리 보기 줄에 펫 이름이 들어감',
    (await st.ev(`document.querySelector('.lines-row[data-key="idle.any.1"] .lines-preview')?.innerText ?? ''`)).includes(tx('콩이', 'Mochi')),
  );
  // 펫 말풍선: 실제 길(패널 밥 주기)로 고친 대사가 뜬다
  await main(`__jj.settingsWindow.window.close(); 1`);
  await sleep(500);
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(1200);
  p = await page('panel');
  await main("__jj.panel.window?.removeAllListeners('blur'); 1");
  const fedBefore = await balance();
  const fedOk = await p.click(`document.querySelector('.fullness button')`);
  await sleep(900);
  const bubble = await pet.ev(`document.querySelector('#bubble')?.hidden ? '(없음)' : document.querySelector('#bubble p')?.textContent ?? ''`);
  check('밥을 주면 펫 말풍선에 고친 대사', fedOk && bubble === mine, `${bubble} / 잔액 ${fedBefore}->${await balance()}`);
  await pet.shots('pet-bubble-edited');
  // 기본값으로 되돌리기
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1800);
  const st2 = await page('settings');
  check(
    '새로 연 설정 창의 화면도 고친 대사를 받음 (preload 동기 전달)',
    (await st2.ev(`JSON.stringify(window.jjakkungLineOverrides ?? null)`)).includes('idle.any.1'),
  );
  await st2.click(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(tx('대사 고치기', 'Edit lines'))})`);
  await st2.until(() => st2.ev(`document.querySelectorAll('.lines-group').length > 5`));
  check('다시 열어도 고친 칸이 남아 있음', (await st2.ev(`document.querySelector('.lines-count small')?.innerText ?? ''`)).includes('2'));
  await st2.click(`document.querySelector('.lines-group[data-group="food"] summary')`);
  await st2.click(`document.querySelector('.lines-row[data-key="pet.fed"] .lines-edited button')`);
  await st2.until(async () => !(await main(`'pet.fed' in __jj.lines.overrides().${LANG}`)));
  check('기본값으로: 그 칸만 지워짐', !(await main(`'pet.fed' in __jj.lines.overrides().${LANG}`)) && (await main(`'idle.any.1' in __jj.lines.overrides().${LANG}`)));
  check('기본값으로 되돌린 말풍선 글', (await main(`__jj.lines.line('pet.fed')`)) !== mine);
  // 업데이트 시뮬레이션: 사전이 바뀌어도 고친 칸은 남음 (다시 읽기)
  await main('__jj.lines.reload(); 1');
  check('다시 읽어도 고친 칸(idle.any.1)이 남음', await main(`__jj.lines.overrides().${LANG}['idle.any.1'] === ${JSON.stringify(withName)}`));
  // 전부 되돌리기
  await st2.click(`[...document.querySelectorAll('.lines-count button')].find((b) => b.innerText.includes(${JSON.stringify(tx('전부', 'Reset all'))}))`);
  check('전부 되돌리기는 확인을 먼저 물음', await st2.until(() => st2.ev(`!!document.querySelector('.lines-confirm')`)));
  await st2.click(`document.querySelector('.lines-confirm button')`);
  await st2.until(async () => (await main(`Object.keys(__jj.lines.overrides().${LANG}).length`)) === 0);
  check('전부 기본값으로', (await main(`Object.keys(__jj.lines.overrides().${LANG}).length`)) === 0);
  check('영어 칸은 따로 (다른 언어 덮어쓰기는 건드리지 않음)', (await main(`Object.keys(__jj.lines.overrides().${LANG === 'ko' ? 'en' : 'ko'}).length`)) === 0);
  await st2.shots('lines-after-reset', `document.querySelector('.lines-sheet')`);

  }
  // ===================== 4. 큰 창 기록 구역 (#166) =====================
  if (ONLY.includes('home')) {
  const rec = (label) => ko ? label[0] : label[1];
  // 기록 재료: 집중(오늘 75분, 사흘 전 130분), 휴지통 둘 (하나는 끝낸 일)
  const todayStr2 = await main(`new Date().toLocaleDateString('sv-SE')`);
  const [hy, hm, hd] = todayStr2.split('-').map(Number);
  // 2번(focus)이 같은 실행에서 이미 오늘 75분을 넣었으면 다시 넣지 않는다
  if (!ONLY.includes('focus')) await main(`(() => { const s = __jj.stats; s.addFocus(${new Date(hy, hm - 1, hd, 9, 0).getTime()}, 25); s.addFocus(${new Date(hy, hm - 1, hd, 11, 0).getTime()}, 50); return 1; })()`);
  const tA = tx('큰 창 휴지통 가', 'Home trash a');
  const tB = tx('큰 창 휴지통 나', 'Home trash b');
  const tC = tx('큰 창 휴지통 다', 'Home trash c');
  await main(`(() => { for (const title of ${JSON.stringify([tA, tB, tC])}) { __jj.store.add({ title }, Date.now()); } return 1; })()`);
  await main(`(() => { const l = __jj.store.list(Date.now()).open; for (const t of l.filter((x) => ${JSON.stringify([tA, tB])}.includes(x.title))) __jj.store.remove(t.id, Date.now()); return 1; })()`);
  await main('__jj.panel.refresh(); 1');

  // --- 작은 패널은 그대로: 탭 줄에 기록이 없고, 오늘 탭 줄은 접힌 채 ---
  await main("__jj.panel.openTab('today'); 1");
  await sleep(1500);
  let pc = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  check('작은 패널 탭 줄에는 기록이 없다 (다섯 탭)', (await pc.ev(`document.querySelectorAll('.tabs [role="tab"]').length`)) === 5 && !(await pc.ev(`!!document.getElementById('ptab-records')`)));
  check('작은 패널 오늘 탭: 집중 달력, 일기는 접힌 채', await pc.ev(`!document.querySelector('.focus-month').open && !document.querySelector('details.diary').open`));
  await pc.click(`document.querySelector('.focus-month summary')`);
  check('작은 패널: 집중 달력 줄을 눌러 여는 동작 그대로', await pc.until(() => pc.ev(`!!document.querySelector('.focus-month[open] .fm-cell')`)));
  await pc.click(`document.querySelector('.focus-month summary')`);
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(700);
  check('작은 패널 할 일 탭: 휴지통 줄은 닫힌 채 (휴지통 2개)', await pc.until(() => pc.ev(`document.querySelector('.trash-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.trash-toggle').innerText.includes('2')`)));
  await main('__jj.panel.window.close(); 1');
  await sleep(500);

  // --- 큰 창 기록 구역 ---
  await main("__jj.home.open('records'); 1");
  let hw;
  for (let i = 0; i < 40 && !(await main('!!__jj.home.window && !__jj.home.window.isDestroyed()')); i++) await sleep(200);
  await sleep(1200);
  await main('__jj.home.window.setBounds({ x: 40, y: 40, width: 1100, height: 760 }); 1');
  await sleep(800);
  hw = await page('home');
  const nav = await hw.ev(`[...document.querySelectorAll('.home-nav button .name')].map((e) => e.textContent).join('|')`);
  check('사이드바에 기록 항목 (상점 다음)', nav.split('|').at(-1) === rec(['기록', 'Records']) && nav.split('|').at(-2) === rec(['상점', 'Shop']), nav);
  check('기록 항목이 지금 구역으로 표시되고 본문 이름표가 맞음', await hw.ev(`document.getElementById('ptab-records').getAttribute('aria-current') === 'page' && document.getElementById('ptab-panel').getAttribute('aria-labelledby') === 'ptab-records'`));
  check('구역 제목줄이 기록', (await hw.ev(`document.querySelector('.home-bar h2').textContent`)) === rec(['기록', 'Records']));
  check('집중 월간 잔디가 펼쳐져 있다 (.focus-month[open] .fm-cell)', await hw.until(() => hw.ev(`!!document.querySelector('.focus-month[open] .fm-cell')`)));
  check('이번 주가 펼쳐져 있다 (details.week[open] .week-bar)', await hw.ev(`!!document.querySelector('details.week[open] .week-bar')`));
  check('일기가 펼쳐져 있다 (details.diary[open])', await hw.ev(`!!document.querySelector('details.diary[open] .diary-text')`));
  check('휴지통이 펼쳐져 있고 지운 둘이 보인다 (.trash-item)', await hw.until(() => hw.ev(`document.querySelectorAll('.trash-item').length === 2`)));
  const area = (sel) => hw.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width }; })()`);
  let fm = await area('.focus-month');
  let wk = await area('details.week');
  let dr = await area('details.diary');
  let tr = await area('.trash');
  check('기본 폭(1100): 두 열 (잔디와 이번 주가 왼쪽, 일기와 휴지통이 오른쪽)', !!fm && !!dr && !!tr && !!wk && dr.x > fm.r - 1 && tr.x > fm.r - 1 && Math.abs(wk.x - fm.x) < 2 && wk.y > fm.y && tr.y > dr.y, JSON.stringify({ fm, wk, dr, tr }));
  check('기본 폭: 열 제목 둘이 보인다', (await hw.ev(`[...document.querySelectorAll('.records-col-title')].filter((e) => e.offsetParent).map((e) => e.textContent).join('|')`)) === tx('집중과 한 주|일기와 휴지통', 'Focus and this week|Diary and trash'));
  check('기본 폭: 가로 넘침 없음', !(await hw.ev(`[...document.querySelectorAll('.records-tab *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1) || document.documentElement.scrollWidth > innerWidth`)));
  await hw.shots('home-records-1100', `document.querySelector('.surface.home')`);

  // --- 위 1~2번과 같은 선택자로 같은 동작 (회귀) ---
  const cell = (day) => hw.ev(`(() => { const c = document.querySelector('.fm-cell[data-day="${day}"]'); return c ? { cls: c.className, text: c.innerText.replace(/\s+/g, ' ').trim(), title: c.title } : null; })()`);
  await hw.until(async () => (await cell(todayStr2))?.cls.includes('lv3'));
  const hc = await cell(todayStr2);
  check('큰 창 잔디: 오늘 칸 75분은 3단계, 숫자 75, 툴팁', !!hc?.cls.includes('lv3') && hc.text.includes('75') && !!hc.title, JSON.stringify(hc));
  await hw.click(`document.querySelector('.fm-cell[data-day="${todayStr2}"]')`);
  const hd2 = await hw.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check('큰 창 잔디: 날짜를 누르면 총 1시간 15분, 가장 길게 50분', hd2.includes(tx('1시간 15분', '1h 15m')) && hd2.includes(tx('50분', '50m')), hd2.replace(/\n/g, ' '));
  check('큰 창 잔디: 이번 달에서 다음 달 단추가 막힘', await hw.ev(`document.querySelectorAll('.fm-nav .fm-step')[1]?.disabled`));
  check('큰 창 이번 주: 끝낸 일과 집중 요약 줄', (await hw.ev(`document.querySelector('details.week summary')?.innerText ?? ''`)).length > 0);
  // 휴지통: 되살리기 -> 영구 삭제 -> 비우기 (확인 먼저)
  await hw.until(() => hw.ev(`document.querySelectorAll('.trash-item').length === 2`));
  await hw.click(`document.querySelector('.trash-item button.link:not(.danger)')`);
  check('큰 창 휴지통: 되살리면 할 일에 돌아오고 목록이 하나로', await hw.until(async () => (await main('__jj.store.trashCount()')) === 1 && (await hw.ev(`document.querySelectorAll('.trash-item').length === 1`))));
  await hw.shots('home-records-restored', `document.querySelector('.surface.home')`);
  await hw.click(`document.querySelector('.trash-empty-all')`);
  check('큰 창 휴지통 비우기: 확인 문구가 먼저', await hw.until(() => hw.ev(`!!document.querySelector('.trash-confirm')`)) && (await main('__jj.store.trashCount()')) === 1);
  await hw.click(`document.querySelector('.trash-confirm button.danger')`);
  check('큰 창 휴지통 비우기 확인 뒤 비고, 비어도 줄은 남는다', await hw.until(async () => (await main('__jj.store.trashCount()')) === 0 && (await hw.ev(`!!document.querySelector('.trash-empty') && !!document.querySelector('.trash-toggle')`))));

  // --- 좁은 폭 (큰 창 하한 760): 한 열 ---
  await main('__jj.home.window.setBounds({ x: 40, y: 40, width: 760, height: 760 }); 1');
  await sleep(800);
  hw = await page('home');
  fm = await area('.focus-month');
  dr = await area('details.diary');
  tr = await area('.trash');
  check('좁은 폭(760): 한 열 (잔디, 일기, 휴지통이 위에서 아래로 같은 왼쪽 선)', !!fm && !!dr && !!tr && dr.y > fm.y && tr.y > dr.y && Math.abs(dr.x - fm.x) < 2 && Math.abs(tr.x - fm.x) < 2, JSON.stringify({ fm, dr, tr }));
  check('좁은 폭: 열 제목은 숨김', (await hw.ev(`[...document.querySelectorAll('.records-col-title')].filter((e) => e.offsetParent).length`)) === 0);
  check('좁은 폭: 가로 넘침 없음', !(await hw.ev(`[...document.querySelectorAll('.records-tab *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1) || document.documentElement.scrollWidth > innerWidth`)));
  check('좁은 폭: 잔디 칸이 읽을 만하다 (칸 너비 24px 이상)', (await hw.ev(`document.querySelector('.fm-cell')?.getBoundingClientRect().width ?? 0`)) >= 24);
  await hw.shots('home-records-760', `document.querySelector('.surface.home')`);
  // 구역 옮겨 다녀도 이 구역 스크롤이 남는다
  await hw.click(`document.getElementById('ptab-today')`);
  await sleep(300);
  await hw.click(`document.getElementById('ptab-records')`);
  check('다른 구역에 다녀와도 기록 구역이 그대로 그려진다', await hw.until(() => hw.ev(`!!document.querySelector('.focus-month[open] .fm-cell') && !!document.querySelector('details.diary[open]')`)));
  check('Dock 은 한 번도 안 불렀다 (JJ_NO_FOCUS)', (await main('__jj.dock.stats().shows')) === 0);
  await main('__jj.home.window.close(); 1');
  await sleep(500);

  }
  // 글이 바뀌었는지 확인할 수 있게 마지막 정리: 시험이 만든 할 일 모두 지우기
  await main(`(() => { for (const t of __jj.store.list(Date.now()).open) __jj.store.remove(t.id, Date.now()); __jj.store.emptyTrash(); return 1; })()`);
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
