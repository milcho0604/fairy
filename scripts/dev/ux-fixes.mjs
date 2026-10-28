// 앱 화면 편의성 고침 점검 (fix/app-ux-hunt): 할 일 줄 메뉴 "내일로 미루기", 메모 요약과 쪼개기 안내,
// 일정 줄 반복 뱃지 간격과 종 단추 이름, 집중 그만하기 단추, 채팅 기록 안 남김 문구, 설정 언어 바꿀 때 옛 안내가 안 남음.
// (휴지통 영구 삭제 확인과 "전체" 링크는 records.mjs, 큰 창 순서와 Cmd+3 은 home.mjs 가 본다)
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/ux-fixes.mjs   (en 도)
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 진짜 AI CLI 없음.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-ux-fixes');
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.ux-fixes-test-'));
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
  await sleep(1500);
  const NOW = Date.now();
  const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = dayStr(new Date(NOW + 86_400_000));

  // ---- 4. 할 일 줄 메뉴: 내일로 미루기 ----
  const todoTitle = tx('미루기 시험', 'Postpone test');
  await main(`__jj.store.add({ title: ${JSON.stringify(todoTitle)}, due: ${JSON.stringify(dayStr(new Date(NOW)))} }, ${NOW}); 1`);
  await main("__jj.panel.openTab('todo'); 1");
  await sleep(1500);
  let p = await page('panel');
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  const menuLabels = () => p.ev(`[...document.querySelectorAll('.row-menu button')].map((b) => b.innerText.trim())`);
  await p.click(`[...document.querySelectorAll('.todos .todo')].find((li) => li.innerText.includes(${JSON.stringify(todoTitle)})).querySelector('.row-more')`);
  await sleep(350);
  const labels = await menuLabels();
  check('줄 메뉴에 "내일로 미루기"', labels.includes(tx('내일로 미루기', 'Push to tomorrow')), labels.join('|'));
  await p.shots('ux-todo-menu', `document.querySelector('.panel')`);
  await p.click(`[...document.querySelectorAll('.row-menu button')].find((b) => b.innerText.trim() === ${JSON.stringify(tx('내일로 미루기', 'Push to tomorrow'))})`);
  check('누르면 마감이 내일이 됨', await p.until(async () => (await main(`__jj.store.list(Date.now()).open.find((t) => t.title === ${JSON.stringify(todoTitle)})?.due`)) === tomorrow));
  await p.click(`[...document.querySelectorAll('.todos .todo')].find((li) => li.innerText.includes(${JSON.stringify(todoTitle)})).querySelector('.row-more')`);
  await sleep(350);
  check('이미 내일이면 메뉴에서 빠짐', !(await menuLabels()).includes(tx('내일로 미루기', 'Push to tomorrow')));
  await p.key('Escape', 'Escape', 27);
  // 미래 마감과 반복 할 일에는 "내일로 미루기"가 없다
  const futureTitle = tx('먼 마감', 'Far due');
  const repeatTitle = tx('반복 시험', 'Repeat test');
  await main(`__jj.store.add({ title: ${JSON.stringify(futureTitle)}, due: ${JSON.stringify(dayStr(new Date(NOW + 7 * 86_400_000)))} }, ${NOW}); __jj.store.add({ title: ${JSON.stringify(repeatTitle)}, due: ${JSON.stringify(dayStr(new Date(NOW)))}, repeat: 'daily' }, ${NOW}); __jj.panel.refresh(); 1`);
  for (const [name, label] of [[futureTitle, '미래 마감'], [repeatTitle, '반복']]) {
    await p.until(() => p.ev(`[...document.querySelectorAll('.todos .todo')].some((li) => li.innerText.includes(${JSON.stringify(name)}))`));
    await p.click(`[...document.querySelectorAll('.todos .todo')].find((li) => li.innerText.includes(${JSON.stringify(name)})).querySelector('.row-more')`);
    await sleep(350);
    const ls = await menuLabels();
    check(`${label} 할 일에는 "내일로 미루기"가 없음`, ls.length > 0 && !ls.includes(tx('내일로 미루기', 'Push to tomorrow')), ls.join('|'));
    await p.key('Escape', 'Escape', 27);
  }
  // 휴지통 영구 삭제 확인은 걸러 보기를 바꾸면 닫힌다
  await main(`(() => { const x = __jj.store.add({ title: ${JSON.stringify(tx('휴지통행', 'To trash'))} }, ${NOW}); __jj.store.remove(x.id, ${NOW}); __jj.panel.refresh(); return 1; })()`);
  await p.until(() => p.ev(`!!document.querySelector('.trash-toggle')`));
  await p.click(`document.querySelector('.trash-toggle')`);
  await p.until(() => p.ev(`!!document.querySelector('.trash-item')`));
  await p.click(`document.querySelector('.trash-item button.link.danger')`);
  check('영구 삭제 확인이 뜸', await p.until(() => p.ev(`!!document.querySelector('.trash-confirm-one')`)));
  await p.click(`document.querySelectorAll('.trash-body > .trash-actions .link')[1]`);
  check('걸러 보기를 바꾸면 확인이 닫힘', await p.until(() => p.ev(`!document.querySelector('.trash-confirm-one')`)));

  // ---- 6, 7. 일정 줄: 반복 뱃지 간격, 종 단추 이름 ----
  const evTitle = tx('주간 회의', 'Weekly sync');
  await main(`__jj.events.add({ title: ${JSON.stringify(evTitle)}, startAt: ${NOW + 600_000}, repeat: 'weekly', reminds: [] }, ${NOW}); __jj.panel.refresh(); 1`);
  await main("__jj.panel.openTab('event'); 1");
  await sleep(1200);
  p = await page('panel');
  check('일정 줄이 보임', await p.until(() => p.ev(`!!document.querySelector('.repeat-badge')`)), await p.ev(`document.body.innerText.slice(0, 200).replace(/\\n/g, '/')`));
  const gap = await p.ev(`(() => { const b = document.querySelector('.title .repeat-badge'); const r = document.createRange(); r.setStart(b.parentElement.firstChild, 0); r.setEnd(b.parentElement.firstChild, b.parentElement.firstChild.length); return b.getBoundingClientRect().left - r.getBoundingClientRect().right; })()`);
  check('제목과 반복 뱃지 사이가 4px 이상 벌어짐', gap >= 4, `${gap}px`);
  const bell = await p.ev(`(() => { const b = document.querySelector('.remind-btn'); return { aria: b.getAttribute('aria-label'), title: b.title }; })()`);
  check('종 단추에 알림 상태 글 (aria-label, title)', bell.aria.includes(evTitle) && bell.aria.includes(tx('알림 없음', 'No reminders')) && bell.title.includes(tx('알림 없음', 'No reminders')), JSON.stringify(bell));
  await p.shots('ux-event-row', `document.querySelector('.panel')`);

  // ---- 3. 메모 요약, 쪼개기 안내 ----
  const noteTitle = tx('안내 시험 메모', 'Hint test note');
  await main(`__jj.notes.add({ title: ${JSON.stringify(noteTitle)}, body: ${JSON.stringify(tx('우유\n달걀', 'Milk\nEggs'))} }, ${NOW}); __jj.panel.refresh(); 1`);
  await main("__jj.panel.openTab('note'); 1");
  await sleep(1200);
  p = await page('panel');
  await p.until(() => p.ev(`[...document.querySelectorAll('.note-row button')].some((b) => b.innerText.includes(${JSON.stringify(noteTitle)}))`));
  await p.click(`[...document.querySelectorAll('.note-row button')].find((b) => b.innerText.includes(${JSON.stringify(noteTitle)}))`);
  check('메모 편집 줄이 열림', await p.until(() => p.ev(`!!document.querySelector('.note-ai button[data-polish]')`)));
  const tips = await p.ev(`[...document.querySelectorAll('.note-ai button')].map((b) => b.title)`);
  const sent = tx('보내', 'sent to');
  check('할 일로 쪼개기, 요약, 다듬기 모두 어디로 보내는지 안내', tips.length === 3 && tips.every((x) => x.includes(sent)), tips.join(' | '));
  await p.shots('ux-note-bar', `document.querySelector('.note-bar')`);

  // ---- 10. 집중 그만하기 ----
  await main("__jj.panel.openTab('today'); 1");
  await sleep(800);
  p = await page('panel');
  await p.ev('jjakkungPanel.focusStart(25); 1');
  const stopText = tx('집중 그만하기', 'Stop focusing');
  check('집중 중 단추 이름이 "집중 그만하기"', await p.until(() => p.ev(`[...document.querySelectorAll('button.ghost')].some((b) => b.innerText.trim() === ${JSON.stringify(stopText)})`)));
  await p.shots('ux-focus-stop', `document.querySelector('.panel')`);
  await p.click(`[...document.querySelectorAll('button.ghost')].find((b) => b.innerText.trim() === ${JSON.stringify(stopText)})`);
  check('누르면 집중이 끝남', await p.until(() => p.ev(`![...document.querySelectorAll('button.ghost')].some((b) => b.innerText.trim() === ${JSON.stringify(stopText)})`)));

  // ---- 8. 채팅 기록 안 남김 문구 ----
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(1200);
  const c = await page('chat');
  const optTexts = await c.ev(`[...document.querySelectorAll('.options label.opt')].map((l) => l.innerText.trim())`);
  check('채팅 체크칸이 동사 문구', optTexts.includes(tx('이 대화는 기록하지 않기', "Don't save this chat")), optTexts.join('|'));
  await main('__jj.chat.window?.close?.(); 1').catch(() => {});

  // ---- 5. 설정 언어 바꿀 때 옛 안내가 안 남음 ----
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1200);
  const s = await page('settings');
  await s.click(`document.getElementById('tab-ease')`);
  await sleep(500);
  const other = ko ? 'en' : 'ko';
  const otherText = ko ? 'English' : '한국어';
  const flashes = [];
  await s.ev(`(() => { window.__flash = []; const grab = () => { const x = document.querySelector('header .saved')?.textContent?.trim(); if (x) window.__flash.push(x); }; new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true }); return 1; })()`);
  await s.click(`[...document.querySelectorAll('.segmented button')].find((b) => b.innerText.trim() === ${JSON.stringify(otherText)})`);
  await sleep(1200);
  flashes.push(...(await s.ev('window.__flash')));
  check('언어를 바꿔도 "저장했어" 안내가 뜨지 않음', flashes.length === 0, flashes.join('|'));
  check('언어는 실제로 바뀜', (await main('__jj.settings.get().lang')) === other);
  // 되돌려 두기 (다음 언어 시험을 위해 settings.json 은 임시라 지워진다)
};

let failure;
try {
  await body();
} catch (err) {
  failure = err;
  console.log('FAIL 점검 도중 예외:', err?.message ?? err);
}
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${LANG}: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAIL ${failed.length}` : ''}`);
for (const r of failed) console.log(' FAIL:', r.name);
process.exit(failed.length || failure ? 1 : 0);
