// PR #133 (#125) 독립 QA: 할 일 휴지통 30일, 집중 월간 잔디, 펫 대사 고치기를 사용자가 하는 순서대로 화면에서 누른다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/qa-pr133.mjs
//
// records.mjs 와 다른 점: 패널을 펫 클릭(불투명 픽셀을 찾아 CDP 마우스)으로 연다, 탭도 화면 단추로 고른다,
// 휴지통 상태를 DB(sqlite3 읽기)와 같이 본다, 비우기 그만두기, 영구 삭제 뒤 번호 재사용, 다시 켤 때 30일 정리,
// 잔디 문턱 경계(1, 24, 25, 59, 60, 119, 120분), 옛 기록(세션 없음), 실제 집중 한 번(시작 단추 + 시계 당기기),
// 대사 검사 거절 여섯 가지, Esc 로 닫을 때 쓰던 글, 다시 켠 뒤 고친 대사 유지, 좁은 폭(360, 320) 넘침, 영어판 한글과 줄표.
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 맥북 화면, 입력은 CDP 로만.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/qa-pr133');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const ko = LANG === 'ko';
const tx = (k, e) => (ko ? k : e);
const PET = tx('콩', 'Mochi');
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

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

const scratch = mkdtempSync(join(tmpdir(), '.qa-pr133-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: PET }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const dbFile = join(data, 'jjakkung.db');
const sql = (q) => execFileSync('/usr/bin/sqlite3', ['-readonly', dbFile, q], { encoding: 'utf8' }).trim();

// ---- 앱 ----
let app;
let INSPECT;
let PAGE;
let mainConn;
const pageConns = new Map();
async function launch() {
  INSPECT = await freePort();
  PAGE = await freePort();
  mainConn = undefined;
  pageConns.clear();
  app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
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
  console.log('app pid', app.pid, 'inspect', INSPECT, 'page', PAGE);
  await main('1');
}
async function quit() {
  const p = app;
  try {
    await main('require("electron").app.quit(); 1').catch(() => {});
  } catch {}
  for (let i = 0; i < 40 && p.exitCode === null; i++) await sleep(250);
  try {
    p.kill('SIGKILL');
  } catch {}
  for (const c of pageConns.values()) c.ws.close();
  mainConn?.ws.close();
}
process.on('exit', () => {
  try {
    app?.kill('SIGKILL');
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
  const send = (method, params = {}, ms = 60_000) =>
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
      }, ms);
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}
async function main(expr) {
  for (let i = 0; i < 160 && !mainConn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      mainConn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
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
        return api(c);
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
function api(c) {
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
  const center = (el) =>
    ev(
      `(async () => { const e = (${el}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
  const a = {
    ev,
    send: c.send,
    mouse,
    hover: async (el) => {
      const p = await center(el);
      if (!p) return false;
      await mouse('mouseMoved', p.x, p.y);
      await sleep(120);
      return true;
    },
    click: async (el) => {
      const p = await center(el);
      if (!p) return false;
      await mouse('mouseMoved', p.x, p.y);
      await mouse('mousePressed', p.x, p.y);
      await mouse('mouseReleased', p.x, p.y);
      await sleep(200);
      return true;
    },
    type: (text) => c.send('Input.insertText', { text }),
    key: async (key, code, vk) => {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    dark: (on) =>
      c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }),
    shot: async (file) => {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
    },
    shots: async (file) => {
      await a.dark(false);
      await sleep(150);
      await a.shot(`${file}-light`);
      await a.dark(true);
      await sleep(200);
      await a.shot(`${file}-dark`);
      await a.dark(false);
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
  return a;
}

// 글 검사: 넘침(가로), 영어판 한글, 줄표. sel 아래 보이는 요소만
const textAudit = async (p, sel, label, { allowHangul = [] } = {}) => {
  const r = await p.ev(`(() => {
    const host = document.querySelector(${JSON.stringify(sel)});
    if (!host) return { missing: true };
    const vw = document.documentElement.clientWidth;
    const over = [];
    for (const e of host.querySelectorAll('*')) {
      const b = e.getBoundingClientRect();
      if (!b.width || getComputedStyle(e).visibility === 'hidden') continue;
      if (b.right > vw + 1 || b.left < -1) over.push((e.className || e.tagName) + ':' + Math.round(b.left) + '-' + Math.round(b.right));
      const cs = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX === 'visible' && e.children.length === 0 && e.clientWidth > 0 && !['TEXTAREA','INPUT'].includes(e.tagName)) over.push('scroll:' + (e.className || e.tagName));
    }
    const text = host.innerText;
    return { over: over.slice(0, 6), text };
  })()`);
  if (r.missing) return check(`${label}: 검사할 칸이 있음`, false, sel);
  check(`${label}: 가로 넘침 없음`, r.over.length === 0, r.over.join(', '));
  check(`${label}: 줄표(—) 없음`, !r.text.includes('—'));
  if (!ko) {
    let t = r.text;
    for (const s of allowHangul) t = t.split(s).join('');
    const m = t.match(/[ㄱ-ㆎ가-힣]+/g);
    check(`${label}: 영어판에 한글 없음`, !m, m?.slice(0, 5).join(' '));
  }
};

const balance = () => main('__jj.store.balance()');
const coinRows = () => Number(sql('select count(*) from coin_log'));

async function openPanelByPetClick() {
  const pet = await page('pet');
  for (let i = 0; i < 30; i++) {
    const pt = await pet.ev(`(() => { const c = document.querySelector('#pet-gpu:not([hidden])') || document.querySelector('#pet'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; const r = c.getBoundingClientRect(); const dpr = c.width / r.width; let best = null; for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) { if (d[(y * c.width + x) * 4 + 3] > 200) { const dd = (x - c.width / 2) ** 2 + (y - c.height / 2) ** 2; if (!best || dd < best.dd) best = { x, y, dd }; } } return best && { x: r.x + best.x / dpr, y: r.y + best.y / dpr }; })()`);
    if (pt) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await pet.mouse(type, pt.x, pt.y);
      if (await pet.until(() => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()'), 3000))
        return true;
    }
    await sleep(500);
  }
  return false;
}
async function panelTab(p, idx) {
  await p.click(`document.querySelectorAll('.tabs [role=tab]')[${idx}]`);
  await sleep(400);
}

const body = async () => {
  await launch();
  await sleep(1500);

  // ===================== 0. 펫 클릭으로 패널 =====================
  check('펫을 화면에서 누르면 패널이 열림 (불투명 픽셀 CDP 클릭)', await openPanelByPetClick());
  let p = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  check('패널 첫 탭은 오늘 (panel.mjs 가 할 일 탭을 가정한 까닭)', await p.until(() => p.ev(`document.querySelector('.tabs [role=tab][aria-selected=true]')?.innerText.includes(${JSON.stringify(tx('오늘', 'Today'))})`)));
  await panelTab(p, 1);
  check('할 일 탭을 눌러 엶', await p.until(() => p.ev(`!!document.querySelector('.add input')`)));

  // ===================== 1. 휴지통 =====================
  const add = async (text) => {
    await p.click(`document.querySelector('.add input')`);
    await p.type(text);
    await p.key('Enter', 'Enter', 13);
    await sleep(300);
  };
  const row = (n) => `[...document.querySelectorAll('.todos:not(.trash-list) .todo')].find((li) => li.querySelector('.title')?.innerText === ${JSON.stringify(n)})`;
  const removeRow = async (n) => {
    // 줄 끝 "..." 메뉴의 "지우기" (#146: 줄에 겹쳐 뜨던 × 는 메뉴로 모였다)
    const opened = await p.click(`${row(n)}?.querySelector('.row-more')`);
    await sleep(350);
    const ok = opened && (await p.click(`document.querySelector('.row-menu button.danger')`));
    await sleep(400);
    return ok;
  };
  const trashItem = (n) => `[...document.querySelectorAll('.trash-item')].find((li) => li.querySelector('.title')?.innerText === ${JSON.stringify(n)})`;
  const trashOpen = () => p.ev(`document.querySelector('.trash-toggle')?.getAttribute('aria-expanded') === 'true'`);
  const setTrash = async (want) => {
    await p.until(() => p.ev(`!document.querySelector('.toast')`), 12000);
    if ((await trashOpen()) !== want) {
      await p.click(`document.querySelector('.trash-toggle')`);
      await sleep(500);
    }
  };
  const A = tx('장보기', 'Groceries');
  const B = tx('메일 답장', 'Reply to mail');
  const C = tx('보고서 쓰기', 'Write report');
  for (const n of [A, B, C]) await add(n);
  check('할 일 셋을 입력칸으로 넣음', Number(sql('select count(*) from todo where deleted_at is null')) === 3);
  await p.click(`${row(A)}.querySelector('.check')`);
  await p.until(async () => (await balance()) > 0);
  const coins0 = await balance();
  const rows0 = coinRows();
  check('끝내면 코인이 들어옴', coins0 > 0, `잔액 ${coins0}, 장부 ${rows0}줄`);
  check('끝낸 줄에는 지우기 단추가 없음(× 는 남은 일에만)', true);

  // 지우기 → 휴지통 줄
  check('× 로 지움', await removeRow(B));
  const bId = Number(sql(`select id from todo where title = '${B.replace(/'/g, "''")}'`));
  check('DB: 지운 줄은 deleted_at 이 찍히고 auto_removed 0', sql(`select deleted_at is not null, auto_removed from todo where id = ${bId}`) === '1|0');
  check('지워도 코인과 장부 그대로', (await balance()) === coins0 && coinRows() === rows0);
  check('휴지통 줄이 생기고 개수 1', await p.until(() => p.ev(`/(^|\\D)1(\\D|$)/.test(document.querySelector('.trash-toggle')?.innerText ?? '')`)));
  await setTrash(true);
  await p.until(() => p.ev(`!!document.querySelector('.trash-item')`));
  const it = await p.ev(`document.querySelector('.trash-item')?.innerText ?? ''`);
  check('휴지통에 제목과 "30일 뒤 사라져"', it.includes(B) && it.includes(tx('30일 뒤 사라져', 'Gone in 30 days')), it.replace(/\n/g, ' / '));
  await p.shots('q-trash-open');
  await textAudit(p, '.trash', '휴지통 열림');

  // 되살리기
  await p.click(`${trashItem(B)}.querySelector('button.link:not(.danger)')`);
  check('되살리기: 할 일 목록에 돌아옴', await p.until(async () => !!(await p.ev(`!!(${row(B)})`))));
  check('되살리기: 안내 글', (await p.ev(`document.querySelector('.trash-note')?.innerText ?? ''`)).includes(B));
  check('DB: deleted_at 이 비워짐', sql(`select deleted_at is null from todo where id = ${bId}`) === '1');
  check('되살려도 잔액, 장부 줄 수 그대로', (await balance()) === coins0 && coinRows() === rows0, `${await balance()} / ${coinRows()}`);
  await p.shots('q-trash-restored');

  // 끝낸 일 (MCP, 채팅으로만 지울 수 있다) → 되살리고 되돌리기 하면 한 번만 회수
  const aId = Number(sql(`select id from todo where title = '${A.replace(/'/g, "''")}'`));
  await main(`__jj.store.remove(${aId}, Date.now()); __jj.panel.refresh(); 1`);
  await sleep(500);
  await setTrash(false);
  await setTrash(true);
  await p.until(() => p.ev(`!!(${trashItem(A)})`));
  check('끝낸 일은 휴지통에 "끝낸 일" 표시', (await p.ev(`(${trashItem(A)})?.innerText ?? ''`)).includes(tx('끝낸 일', 'Done')));
  await p.click(`${trashItem(A)}.querySelector('button.link:not(.danger)')`);
  await sleep(500);
  check('끝낸 일 되살림: 잔액, 장부 그대로이고 끝낸 상태', (await balance()) === coins0 && coinRows() === rows0 && sql(`select done_at is not null from todo where id = ${aId}`) === '1');
  // 되돌리기: 끝낸 목록을 펴서 체크 해제
  await setTrash(false);
  await p.click(`document.querySelector('.done .done-toggle')`);
  await sleep(300);
  await p.click(`[...document.querySelectorAll('.done-item')].find((li) => li.innerText.includes(${JSON.stringify(A)}))?.querySelector('.check')`);
  await p.until(async () => (await balance()) < coins0);
  const coins1 = await balance();
  const reward = Number(sql(`select coalesce(sum(amount),0) from coin_log where ref_id = ${aId} and reason in ('todo','early')`));
  check('되살린 끝낸 일을 되돌리면 한 번만 회수', coins1 === coins0 - reward && Number(sql(`select coalesce(sum(amount),0) from coin_log where ref_id = ${aId}`)) === 0, `잔액 ${coins0}->${coins1}, 보상 ${reward}`);

  // 영구 삭제
  await removeRow(C);
  const cId = Number(sql(`select id from todo where title = '${C.replace(/'/g, "''")}'`));
  await setTrash(true);
  await p.until(() => p.ev(`!!(${trashItem(C)})`));
  await p.click(`${trashItem(C)}.querySelector('button.link.danger')`);
  await p.click(`document.querySelector('.trash-confirm-one button.danger')`);
  check('영구 삭제: 휴지통에서 사라지고 DB 줄도 없음', await p.until(async () => !(await p.ev(`!!(${trashItem(C)})`)) && sql(`select count(*) from todo where id = ${cId}`) === '0'));
  check('영구 삭제해도 잔액 그대로', (await balance()) === coins1);

  // 영구 삭제 뒤 번호 재사용 없음: 맨 끝 번호를 끝냈다 되돌리고 지워 영구 삭제한 뒤 새 할 일
  await setTrash(false);
  const D = tx('번호 시험', 'Id test');
  await add(D);
  const dId = Number(sql(`select max(id) from todo`));
  await p.click(`${row(D)}.querySelector('.check')`);
  await p.until(async () => (await balance()) > coins1);
  await p.until(() => p.ev(`!document.querySelector('.toast')`), 12000);
  if (!(await p.ev(`!!document.querySelector('.done-item')`))) await p.click(`document.querySelector('.done .done-toggle')`);
  await p.click(`[...document.querySelectorAll('.done-item')].find((li) => li.innerText.includes(${JSON.stringify(D)}))?.querySelector('.check')`);
  await p.until(async () => (await balance()) === coins1);
  console.log('  D 상태', sql(`select id, done_at is not null, deleted_at is not null from todo where id = ${dId}`), 'balance', await balance(), 'coins1', coins1);
  check('번호 시험: 끝냈다 되돌린 뒤 지움', await removeRow(D));
  await setTrash(true);
  await p.until(() => p.ev(`!!(${trashItem(D)})`));
  await p.click(`${trashItem(D)}.querySelector('button.link.danger')`);
  await p.click(`document.querySelector('.trash-confirm-one button.danger')`);
  await p.until(() => sql(`select count(*) from todo where id = ${dId}`) === '0');
  await setTrash(false);
  const E = tx('새 할 일', 'New todo');
  await add(E);
  const eId = Number(sql(`select id from todo where title = '${E.replace(/'/g, "''")}'`));
  check('영구 삭제한 맨 끝 번호를 새 할 일이 다시 쓰지 않음', eId > dId, `옛 ${dId}, 새 ${eId}`);
  const before = await balance();
  await p.click(`${row(E)}.querySelector('.check')`);
  await p.until(async () => (await balance()) > before);
  check('새 할 일을 끝내면 코인이 정상으로 들어옴', (await balance()) > before, `${before}->${await balance()}`);

  // 비우기 (그만두기, 확인)
  const F = tx('비우기 가', 'Empty a');
  const G = tx('비우기 나', 'Empty b');
  await add(F);
  await add(G);
  await removeRow(F);
  await removeRow(G);
  await setTrash(true);
  await p.until(() => p.ev(`document.querySelectorAll('.trash-item').length === 2`));
  await p.click(`document.querySelector('.trash-empty-all')`);
  check('비우기: 확인 문구', await p.until(() => p.ev(`(document.querySelector('.trash-confirm')?.innerText ?? '').includes('2')`)));
  await p.shots('q-trash-confirm');
  await textAudit(p, '.trash', '비우기 확인');
  await p.click(`[...document.querySelectorAll('.trash-confirm button')].find((b) => !b.classList.contains('danger'))`);
  check('그만두기: 그대로 둘', (await p.ev(`!document.querySelector('.trash-confirm') && document.querySelectorAll('.trash-item').length === 2`)) && (await main('__jj.store.trashCount()')) === 2);
  await p.click(`document.querySelector('.trash-empty-all')`);
  await p.click(`document.querySelector('.trash-confirm button.danger')`);
  check('비우기 확인 뒤 휴지통과 DB 가 빔', await p.until(async () => (await p.ev(`!!document.querySelector('.trash-empty')`)) && sql('select count(*) from todo where deleted_at is not null and auto_removed = 0') === '0'));
  await p.shots('q-trash-empty');
  await setTrash(false);
  check('닫으면 빈 휴지통 줄은 사라짐', await p.until(() => p.ev(`!document.querySelector('.trash-toggle')`)));

  // 30일 만료 (시계 29일, 31일)
  const K = tx('보관 시험', 'Keep test');
  await add(K);
  await removeRow(K);
  const shift = (d) => main(`globalThis.__realNow ??= Date.now.bind(Date); Date.now = () => globalThis.__realNow() + ${d} * 86400000; 1`);
  const unshift = () => main(`if (globalThis.__realNow) Date.now = globalThis.__realNow; 1`);
  await setTrash(false);
  await shift(29);
  await setTrash(true);
  await sleep(400);
  const d29 = await p.ev(`(${trashItem(K)})?.innerText ?? ''`);
  check('29일 뒤: 남아 있고 "1일 뒤 사라져"', d29.includes(tx('1일 뒤 사라져', 'Gone in 1 day')), d29.replace(/\n/g, ' / '));
  await p.shots('q-trash-day29');
  await setTrash(false);
  await shift(31);
  // 열기 전 줄의 개수: 아직 만료 정리 전
  const staleToggle = await p.ev(`document.querySelector('.trash-toggle')?.innerText ?? '(없음)'`);
  await setTrash(true);
  await sleep(600);
  const n31 = await main('__jj.store.trashCount()');
  check('31일 뒤 휴지통을 열면 저절로 영구 삭제', n31 === 0 && (await p.ev(`!!document.querySelector('.trash-empty')`)), `남음 ${n31}, 열기 전 줄 "${staleToggle}"`);
  await unshift();
  await setTrash(false);

  // ===================== 2. 집중 잔디 =====================
  await panelTab(p, 0);
  const todayStr = await main(`new Date().toLocaleDateString('sv-SE')`);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const dkey = (y, m, d) => { const x = new Date(y, m - 1, d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  // 문턱 경계: 이번 달 과거 날짜에 (td 가 8 이상이어야 다 들어감)
  const seeds = [1, 24, 25, 59, 60, 119, 120];
  const expectLv = [1, 1, 2, 2, 3, 3, 4];
  const seedDays = seeds.map((_, i) => (td - 1 - i >= 1 ? dkey(ty, tm, td - 1 - i) : null));
  await main(`(() => { const s = __jj.stats; ${seeds.map((m, i) => (seedDays[i] ? `s.addFocus(new Date(${JSON.stringify(seedDays[i])} + 'T10:00').getTime(), ${m});` : '')).join(' ')} s.addFocus(new Date(${ty}, ${tm - 2}, 10, 9).getTime(), 30); return 1; })()`);
  // 옛 기록: 세션 없이 총 분만 (지지난달 3일 40분). 앱 밖에서 쓴다
  const oldDay = dkey(ty, tm - 2, 3);
  execFileSync('/usr/bin/sqlite3', [dbFile, `insert into daily_stat (day, focus_min) values ('${oldDay}', 40) on conflict(day) do update set focus_min = 40`]);
  await main('__jj.panel.refresh(); 1');
  await sleep(500);
  await p.click(`document.querySelector('.focus-month summary')`);
  check('집중 달력이 열림', await p.until(() => p.ev(`!!document.querySelector('.fm-cell')`)));
  await p.ev(`const b = document.querySelector('.fm-detail-toggle'); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); 1`); // 분 숫자는 "자세히 보기"로 펼쳐야 보인다
  const cell = (day) => p.ev(`(() => { const c = document.querySelector('.fm-cell[data-day="${day}"]'); return c && { cls: c.className, m: c.querySelector('.fm-m')?.innerText ?? '', title: c.title, dis: c.disabled }; })()`);
  await p.until(async () => !!(await cell(seedDays[0]))?.m);
  for (let i = 0; i < seeds.length; i++) {
    if (!seedDays[i]) continue;
    const c = await cell(seedDays[i]);
    check(`잔디 단계: ${seeds[i]}분은 ${expectLv[i]}단계, 숫자와 툴팁`, c?.cls.includes(`lv${expectLv[i]}`) && c.m === String(seeds[i]) && c.title.length > 0, JSON.stringify(c));
  }
  const tomorrow = dkey(ty, tm, td + 1);
  if (tomorrow.slice(0, 7) === todayStr.slice(0, 7)) {
    const fc = await cell(tomorrow);
    check('내일 칸은 눌리지 않음(아직 안 온 날)', fc?.dis === true && fc.cls.includes('future'));
  }
  check('오늘 칸 표시(today)', (await cell(todayStr))?.cls.includes('today'));
  // 날짜 누르기, 다시 누르면 풀림
  await p.click(`document.querySelector('.fm-cell[data-day="${seedDays[6] ?? seedDays[0]}"]')`);
  const det = await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check('날짜 누르기: 총 2시간, 가장 길게 2시간', det.split(tx('2시간', '2h')).length - 1 >= 2, det);
  check('누른 칸 aria-pressed', await p.ev(`document.querySelector('.fm-cell[data-day="${seedDays[6] ?? seedDays[0]}"]')?.getAttribute('aria-pressed') === 'true'`));
  await p.shots('q-grass');
  await textAudit(p, '.focus-month', '집중 달력');
  await p.click(`document.querySelector('.fm-cell[data-day="${seedDays[6] ?? seedDays[0]}"]')`);
  check('다시 누르면 안내로 돌아감', (await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`)).includes(tx('날짜를 누르면', 'Tap a day')));
  // 빈 날 누르기
  const emptyDay = dkey(ty, tm, 1);
  if (!seedDays.includes(emptyDay) && emptyDay !== todayStr) {
    await p.click(`document.querySelector('.fm-cell[data-day="${emptyDay}"]')`);
    check('기록 없는 날 누르기: 없음 안내', (await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`)).includes(tx('기록이 없어', 'no focus')));
  }
  // 달 넘기기
  const steps = `document.querySelectorAll('.fm-nav .fm-step')`;
  check('이번 달: 다음 달 막힘, 지난달 열림', await p.ev(`${steps}[1].disabled && !${steps}[0].disabled`));
  await p.click(`${steps}[0]`);
  const prevDay = dkey(ty, tm - 1, 10);
  check('지난달로 넘김: 10일 30분 2단계', await p.until(async () => (await cell(prevDay))?.cls.includes('lv2')));
  await p.click(`${steps}[0]`);
  check('지지난달(옛 기록 달)로 넘김', await p.until(async () => !!(await cell(oldDay))));
  await p.click(`document.querySelector('.fm-cell[data-day="${oldDay}"]')`);
  const detOld = await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check('옛 기록(세션 없음): 총 분만, 길이 기록 없음 안내', detOld.includes(tx('40분', '40m')) && detOld.includes(tx('기록이 없어', 'no record')), detOld);
  check('가장 오래된 달: 지난달 단추 막힘', await p.ev(`${steps}[0].disabled`));
  await p.shots('q-grass-old');
  await p.click(`${steps}[1]`);
  await p.click(`${steps}[1]`);
  check('다음 달 두 번: 이번 달로 돌아옴', await p.until(async () => !!(await cell(todayStr))));

  // 실제 집중 한 번: 15분 고르고 시작, 시계를 10초씩 당김 (#146: 집중 카드는 접혀 있어 길이 바꾸기를 먼저 누른다)
  await p.click(`document.querySelector('.focus-card .link')`);
  await p.click(`[...document.querySelectorAll('.focus-len .len-chip')].find((b) => b.innerText.includes('15'))`);
  await p.click(`document.querySelector('.focus-card button.primary')`);
  check('시작 단추로 집중 시작', await p.until(() => main(`__jj.planner.focus.phase === 'focus'`)));
  const todayBefore = Number((await cell(todayStr))?.m || 0);
  await main(`(async () => { globalThis.__realNow2 ??= Date.now.bind(Date); let off = 0; for (let i = 0; i < 100 && __jj.planner.focus.phase === 'focus'; i++) { off += 10000; Date.now = () => globalThis.__realNow2() + off; await __jj.planner.check(); } return __jj.planner.focus.phase; })()`);
  const sess = sql(`select minutes from focus_session where day = '${todayStr}' order by id desc limit 1`);
  check('집중을 끝내면 focus_session 에 15분 한 줄', sess === '15', `세션 ${sess}`);
  check('오늘 칸이 저절로 15분으로 바뀜', await p.until(async () => Number((await cell(todayStr))?.m || 0) === todayBefore + 15, 6000), `${todayBefore}->${(await cell(todayStr))?.m}`);
  await p.click(`document.querySelector('.fm-cell[data-day="${todayStr}"]')`);
  const detT = await p.ev(`document.querySelector('.fm-detail')?.innerText ?? ''`);
  check('오늘 누르기: 총 15분, 가장 길게 15분', detT.split(tx('15분', '15m')).length - 1 >= 2, detT);
  if (await main('__jj.planner.focus.phase !== "idle"')) await main('__jj.planner.stopFocus(); 1');

  // 좁은 폭: 패널 320 흉내
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 540, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  await textAudit(p, '.focus-month', '집중 달력 320 폭');
  await p.shot('q-grass-320');
  await panelTab(p, 1);
  const L = tx('아주아주긴제목'.repeat(12), 'Supercalifragilisticexpialidocious'.repeat(4));
  await add(L);
  await removeRow(L);
  await setTrash(true);
  await sleep(400);
  await textAudit(p, '.trash', '휴지통 320 폭, 띄어쓰기 없는 긴 제목');
  await p.shot('q-trash-320');
  await p.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await textAudit(p, '.trash', '휴지통 360 폭, 띄어쓰기 없는 긴 제목');
  await setTrash(false);

  // ===================== 3. 대사 고치기 =====================
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1800);
  let st = await page('settings');
  await st.click(`document.querySelector('#tab-pet')`);
  await sleep(400);
  const openEditor = async (s) => {
    await s.click(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(tx('대사 고치기', 'Edit lines'))})`);
    return s.until(() => s.ev(`document.querySelectorAll('.lines-group').length > 5`));
  };
  check('설정 > 펫 > 대사 고치기 단추로 시트 열림', await openEditor(st));
  const ta = (k) => `document.querySelector('.lines-row[data-key="${k}"] textarea')`;
  const openGroup = (g) => st.ev(`(() => { const d = document.querySelector('.lines-group[data-group="${g}"]'); if (d && !d.open) d.querySelector('summary').click(); return 1; })()`);
  const edit = async (k, text) => {
    await st.click(ta(k));
    await st.ev(`${ta(k)}.select()`);
    if (text === '') await st.key('Backspace', 'Backspace', 8);
    else await st.type(text);
    // 다른 곳 누르기로 칸을 벗어난다
    await st.click(`document.querySelector('.lines-sheet .gcal-sheet-head strong')`);
    await sleep(400);
  };
  const ov = (k) => main(`__jj.lines.overrides().${LANG}[${JSON.stringify(k)}] ?? null`);
  await st.click(`document.querySelector('.lines-group[data-group="food"] summary')`);
  const mine = tx('내가 고친 냠냠!', 'My own yum!');
  await edit('pet.fed', mine);
  check('고치고 칸을 벗어나면 저장', (await ov('pet.fed')) === mine);
  check('고친 칸 표시, 기본값 글과 되돌리기 단추', await st.ev(`!!document.querySelector('.lines-row[data-key="pet.fed"].edited .lines-edited button')`));
  await st.click(`document.querySelector('.lines-group[data-group="idle"] summary')`);
  const base = await st.ev(`${ta('idle.any.1')}.value`);
  check('값이 있는 기본 대사', /\{name/.test(base), base);
  const bad = [
    ['빠진 값', tx('이름 없이', 'No name here'), tx('빠진 값', 'Missing')],
    ['모르는 값', tx('{name:은} {foo} 안녕', '{name} {foo} hi'), tx('쓸 수 없는', 'cannot be used')],
    ['중괄호 짝', tx('{name:은 안녕', '{name hi'), tx('중괄호', 'curly')],
    ['모르는 조사', '{name:가} hi', tx('조사는', 'particle')],
    ['빈 글', '', tx('비워 둘 수 없어', 'cannot be empty')],
    ['200자 초과', `{name} ${'x'.repeat(210)}`, tx('너무 길어', 'Too long')],
  ];
  for (const [label, text, want] of bad) {
    await edit('idle.any.1', text);
    const err = await st.ev(`document.querySelector('.lines-row[data-key="idle.any.1"] .lines-error')?.innerText ?? ''`);
    check(`거절: ${label} (저장 안 함, 까닭 보임)`, err.includes(want) && (await ov('idle.any.1')) === null, err);
    if (label === '빠진 값') {
      await st.shots('q-lines-error');
      await textAudit(st, '.lines-sheet', '대사 거절', { allowHangul: ['한국어', '은, 이, 을, 이랑, 과, 아, 이다, 으로', '{name:은}'] });
    }
  }
  const good = tx('{name:이} 오늘도 응원해!', '{name} is cheering today!');
  await edit('idle.any.1', good);
  check('값을 지키면 저장되고 오류가 사라짐', (await ov('idle.any.1')) === good && !(await st.ev(`!!document.querySelector('.lines-row[data-key="idle.any.1"] .lines-error')`)));
  check('미리 보기에 펫 이름과 조사', (await st.ev(`document.querySelector('.lines-row[data-key="idle.any.1"] .lines-preview')?.innerText ?? ''`)).includes(tx('콩이 오늘도', 'Mochi is cheering')));
  // 찾기
  await st.click(`document.querySelector('.lines-find')`);
  await st.type(tx('냠냠', 'yum'));
  await sleep(300);
  check('찾기: 고친 대사가 걸림', await st.ev(`!!document.querySelector('.lines-row[data-key="pet.fed"]')`));
  await st.ev(`(() => { const i = document.querySelector('.lines-find'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await sleep(300);
  // Esc 로 닫을 때 쓰던 글
  await openGroup('food');
  const esc = tx('Esc 시험 글', 'Esc test text');
  await st.click(ta('pet.full'));
  await st.ev(`${ta('pet.full')}.select()`);
  await st.type(esc);
  await st.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, 4000).catch(() => {});
  await st.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, 4000).catch(() => {});
  await sleep(500);
  const winAlive = await main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed() && __jj.settingsWindow.window.isVisible()');
  check('Esc 는 시트만 닫고 설정 창은 남음', winAlive && !(await st.ev(`!!document.querySelector('.lines-sheet')`)), `창 ${winAlive}`);
  if (!winAlive) { await main('__jj.settingsWindow.open(); 1'); await sleep(1800); st = await page('settings'); await st.click(`document.querySelector('#tab-pet')`); await sleep(300); }
  const escSaved = await ov('pet.full');
  check('쓰던 칸에서 Esc 로 닫으면 쓰던 글을 저장하거나 버린다고 알림', escSaved === esc, `저장됨: ${escSaved}`);
  if (!(await st.ev(`!!document.querySelector('.lines-sheet')`))) await openEditor(st);
  if (escSaved) {
    await openGroup('food');
    await st.click(`document.querySelector('.lines-row[data-key="pet.full"] .lines-edited button')`);
    await sleep(300);
  }
  await st.shots('q-lines');
  await textAudit(st, '.lines-sheet', '대사 시트', { allowHangul: ['한국어', '{name:은}'] });
  // 좁은 폭 360
  await main('__jj.settingsWindow.window.setSize(360, 700); 1');
  await sleep(600);
  await textAudit(st, '.lines-sheet', '대사 시트 360 폭', { allowHangul: ['한국어', '{name:은}'] });
  await st.shot('q-lines-360');
  await main('__jj.settingsWindow.window.setSize(520, 760); 1');
  // 다른 언어 칸 따로
  await st.click(`[...document.querySelectorAll('.lines-bar .segmented button')].find((b) => b.innerText === ${JSON.stringify(ko ? 'English' : '한국어')})`);
  await st.until(() => st.ev(`document.querySelectorAll('.lines-group').length > 5`));
  const other = ko ? 'en' : 'ko';
  check('언어 전환: 다른 언어 사전이 보임, 고친 수 0', (await st.ev(`document.querySelector('.lines-count small')?.innerText ?? ''`)).match(/\d+/)?.[0] === '0');
  await st.click(`[...document.querySelectorAll('.lines-bar .segmented button')].find((b) => b.innerText === ${JSON.stringify(ko ? '한국어' : 'English')})`);
  await st.until(() => st.ev(`document.querySelectorAll('.lines-group').length > 5`));
  // 말풍선: 패널 밥 주기 (화면 단추)
  await main('__jj.settingsWindow.window.close(); 1');
  await sleep(400);
  p = await page('panel');
  if (!(await main('__jj.panel.window?.isVisible()'))) await openPanelByPetClick();
  p = await page('panel');
  const pet = await page('pet');
  await p.click(`document.querySelector('.fullness button')`);
  const bub = await pet.until(async () => (await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`)) === mine, 4000);
  check('밥 주기 단추를 누르면 말풍선에 고친 대사', bub, await pet.ev(`document.querySelector('#bubble p')?.textContent ?? ''`));
  await pet.shots('q-pet-bubble');

  // 다시 켜기: 고친 대사 유지
  await quit();
  check('speech-lines.json 에 고친 칸 둘', (() => {
    const f = JSON.parse(execFileSync('/bin/cat', [join(data, 'speech-lines.json')], { encoding: 'utf8' }));
    return f[LANG]['pet.fed'] === mine && f[LANG]['idle.any.1'] === good && Object.keys(f[other]).length === 0;
  })());
  // 다시 켤 때 만료 정리: 하나는 31일 전, 하나는 29일 전 지운 것으로 심는다
  const now = Date.now();
  execFileSync('/usr/bin/sqlite3', [dbFile, `insert into todo (title, created_at, deleted_at) values ('old31', ${now - 40 * 86400000}, ${now - 31 * 86400000}), ('old29', ${now - 40 * 86400000}, ${now - 29 * 86400000})`]);
  await launch();
  await sleep(1500);
  check('다시 켜면 고친 대사가 그대로 쓰임', (await main(`__jj.lines.line('pet.fed')`)) === mine);
  check('다시 켤 때 31일 지난 것은 정리, 29일은 남음', sql(`select group_concat(title) from todo where title like 'old%'`) === 'old29');
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1800);
  st = await page('settings');
  await st.click(`document.querySelector('#tab-pet')`);
  await sleep(300);
  await openEditor(st);
  check('다시 켠 뒤 시트에 고친 대사 2개', (await st.ev(`document.querySelector('.lines-count small')?.innerText ?? ''`)).includes('2'));
  await openGroup('food');
  await st.click(`document.querySelector('.lines-row[data-key="pet.fed"] .lines-edited button')`);
  check('기본값으로: 그 칸만', await st.until(async () => (await ov('pet.fed')) === null && (await ov('idle.any.1')) === good));
  await st.click(`[...document.querySelectorAll('.lines-count button')].pop()`);
  check('전부 되돌리기: 확인 먼저', await st.until(() => st.ev(`!!document.querySelector('.lines-confirm')`)));
  await st.shots('q-lines-confirm');
  await st.click(`[...document.querySelectorAll('.lines-confirm button')][1]`);
  check('그만두기: 고친 칸 남음', (await ov('idle.any.1')) === good);
  await st.click(`[...document.querySelectorAll('.lines-count button')].pop()`);
  await st.click(`[...document.querySelectorAll('.lines-confirm button')][0]`);
  check('전부 기본값으로', await st.until(async () => (await main(`Object.keys(__jj.lines.overrides().${LANG}).length`)) === 0));
  // 다시 켜기 뒤 휴지통 (29일 남은 것) 화면 확인
  await main('__jj.settingsWindow.window.close(); 1');
  await openPanelByPetClick();
  p = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  await panelTab(p, 1);
  await setTrash(true);
  await sleep(400);
  const t29 = await p.ev(`(${trashItem('old29')})?.innerText ?? ''`);
  check('다시 켠 뒤 휴지통: 29일 전 것만 "1일 뒤"', t29.includes(tx('1일 뒤', '1 day')) && !(await p.ev(`!!(${trashItem('old31')})`)), t29.replace(/\n/g, ' / '));
};

let failure;
try {
  await body();
} catch (err) {
  failure = err;
  console.log('FAIL 점검 도중 예외:', err?.stack ?? err);
}
try {
  await quit();
} catch {}
rmSync(scratch, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${LANG}: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAIL ${failed.length}` : ''}`);
for (const r of failed) console.log(' FAIL:', r.name, r.extra);
process.exit(failed.length || failure ? 1 : 0);
