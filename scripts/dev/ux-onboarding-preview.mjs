// 화면 개선 셋 점검 (feat/ux-onboarding-preview):
//  1. 시작 안내 4쪽: 지금 적용된 키 한 벌만, 쉬운 키 묶음 스위치(켜짐/꺼짐, 누르면 표가 그 자리에서 바뀜),
//     펫 누르기 설명이 패널 보기(작은 패널/큰 창)를 따름, 설정의 같은 스위치와 글이 같음, 스크롤 없이 들어감
//  2. 일정 입력칸 해석 미리보기 (작은 패널과 큰 창): 쓰는 동안 한 줄, 못 읽으면 숨김, 넣은 일정과 같은 해석
//  3. 큰 창 오늘 탭 놓친 알림에서 업적 달성 알림 빠짐, 760 폭에서 집중 카드가 놓친 알림 위
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/ux-onboarding-preview.mjs   (en 도)
//   SHOTS_ONLY=1 JJ_ROOT=<체크아웃> PREFIX=before|after 이면 점검 없이 비교 그림 재료만 찍는다
//
// 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 진짜 AI 없음.
// 포트는 9800~9999 에서 비어 있는 것 (JJ_INSPECT_PORT, JJ_PAGE_PORT 로 정할 수도 있다).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? join(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-ux-onboarding-preview');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const SHOTS_ONLY = process.env.SHOTS_ONLY === '1';
const PREFIX = process.env.PREFIX ?? 'run';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const freePort = async () => {
  for (let i = 0; i < 200; i++) {
    const p = 9800 + Math.floor(Math.random() * 200);
    const ok = await new Promise((r) => {
      const s = createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('9800~9999 에 빈 포트가 없다');
};
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? (await freePort()));
let PAGE = Number(process.env.JJ_PAGE_PORT ?? 0);
while (!PAGE || PAGE === INSPECT) PAGE = await freePort();
const ko = LANG === 'ko';
const tx = (koText, enText) => (ko ? koText : enText);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${extra ? ` (${extra})` : ''}`);
};

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.ux-onb-preview-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, pet3d: false, wander: false, petName: tx('콩', 'Mochi') }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
// 놓친 알림: 업적 달성 하나와 일반 알림 하나 (오늘 것)
const at = Date.now() - 120_000;
writeFileSync(
  join(data, 'missed.json'),
  JSON.stringify([
    { text: tx('치과 예약', 'Dentist'), at },
    {
      text: tx('업적 달성: 첫 걸음', 'Achievement: First step'),
      at: at + 1000,
      msg: { key: 'pet.achieved', vars: { name: { key: 'achieve.todo1.name' }, hint: { key: 'achieve.todo1.hint' } } },
    },
  ]),
);
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
    process.kill(app.pid, 'SIGTERM');
  } catch {}
  await sleep(800);
  try {
    process.kill(app.pid, 'SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', () => {
  try {
    process.kill(app.pid, 'SIGKILL');
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
        const mouse = (type, x, y) =>
          c.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
          });
        const center = async (elExpr) =>
          ev(
            `(async () => { const e = (${elExpr}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          );
        const api = {
          ev,
          center,
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
          shot: async (file) => {
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
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
        return api;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}

/** React 가 듣는 input 값을 바꾼다 (입력칸 비우기) */
const setValue = (p, selector, value) =>
  p.ev(
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`,
  );

const tipRows = (p) =>
  p.ev(`[...document.querySelectorAll('.tips')].map((dl) => [...dl.querySelectorAll('dt')].map((dt) => dt.innerText.replace(/\\s+/g, ' ').trim()))`);

// ---- 1. 시작 안내 4쪽 ----
async function closeOnb() {
  await main('__jj.onboarding.window?.close(); 1');
  for (let i = 0; i < 50; i++) {
    if (await main('!__jj.onboarding.window || __jj.onboarding.window.isDestroyed()')) break;
    await sleep(100);
  }
  pageConns.delete('onboarding');
  await sleep(300);
}
async function openTips() {
  await main('__jj.settings.set({ onboardPage: 0 }); __jj.onboarding.open(); 1');
  const p = await page('onboarding');
  await p.until(() => p.ev('!!document.querySelector("main h1")'));
  for (let i = 0; i < 3; i++) {
    await p.ev('document.querySelector("footer .primary").click(); 1');
    await sleep(200);
  }
  await p.until(() => p.ev('!!document.querySelector(".easy-switch, .tips")'));
  return p;
}
async function onboarding() {
  await main('__jj.settings.set({ shortcuts: { ...__jj.settings.get().shortcuts, hide: "CommandOrControl+Alt+Shift+H" } }); 1');
  const small = tx(['작은 패널'], ['Small panel'])[0];
  const big = tx('큰 창', 'Large window');
  let p = await openTips();
  const sw = () => p.ev(`document.querySelector('.easy-switch [role=switch]')?.getAttribute('aria-checked')`);
  const keyTexts = () => p.ev(`[...document.querySelectorAll('.tips')][1] ? [...document.querySelectorAll('.tips')][1].innerText.replace(/\\s+/g, ' ') : ''`);
  check('쉬운 키 묶음이 스위치로 보임 (꺼짐 상태)', (await sw()) === 'false');
  const label = await p.ev(`document.querySelector('.easy-switch strong')?.innerText`);
  check('스위치 이름이 설정과 같은 글', label === tx('쉬운 키 묶음', 'Easy shortcut set'), label);
  const dots = await p.ev(`document.querySelector('main').innerText.includes('\\u00b7')`);
  check('옛 "한 줄 키 예고"(가운뎃점으로 이은 줄)가 없음', dots === false);
  let text = await keyTexts();
  check('꺼짐: 기본 키 표만 (Option 포함, 쉬운 K 줄 없음)', /N/.test(text) && text.includes(tx('Option', 'Option')) && !/\bK\b/.test(text), text);
  const rowsBefore = (await tipRows(p))[1];
  check('키 줄은 지금 적용된 한 벌뿐 (4줄)', rowsBefore.length === 4, String(rowsBefore.length));
  await p.shot(`${PREFIX}-onb-off`);
  await p.click(`document.querySelector('.easy-switch [role=switch]')`);
  check('누르면 켜짐', await p.until(async () => (await sw()) === 'true'));
  text = await keyTexts();
  check('켜짐: 표가 그 자리에서 쉬운 키로 (K, B, M, Y 와 Option 없음)', /\bK\b/.test(text) && /\bB\b/.test(text) && /\bM\b/.test(text) && !text.includes('Option'), text);
  check('설정에도 쉬운 키가 저장됨', (await main('__jj.settings.get().shortcuts.quickAdd')) === 'CommandOrControl+Shift+K');
  check('안내 쪽은 그대로 4쪽 (쪽이 바뀌지 않음)', (await p.ev(`[...document.querySelectorAll('.dots li')].findIndex((e) => e.classList.contains('on'))`)) === 3);
  await p.shot(`${PREFIX}-onb-on`);
  await p.click(`document.querySelector('.easy-switch [role=switch]')`);
  check('다시 누르면 꺼짐, 기본 키로 돌아감', await p.until(async () => (await sw()) === 'false' && (await main('__jj.settings.get().shortcuts.quickAdd')) === 'CommandOrControl+Alt+Shift+N'));
  // 직접 바꾼 키가 섞여 있으면 꺼짐으로 보이고 표는 지금 키 그대로
  await main('__jj.settings.set({ shortcuts: { ...__jj.settings.get().shortcuts, chat: "CommandOrControl+Alt+Shift+X" } }); 1');
  await closeOnb();
  p = await openTips();
  text = await keyTexts();
  check('직접 바꾼 키는 꺼짐으로 보이고 표에 그 키가 보임', (await sw()) === 'false' && /\bX\b/.test(text), text + ' / ' + (await main('__jj.settings.get().shortcuts.chat')));
  await main('__jj.settings.set({ shortcuts: { ...__jj.settings.get().shortcuts, chat: "CommandOrControl+Alt+Shift+J" } }); 1');

  // 펫을 누르면 설명이 패널 보기를 따름
  const clickDesc = () => p.ev(`document.querySelector('.tips dd').innerText`);
  const panelDesc = () => p.ev(`[...document.querySelectorAll('.tips')][1].querySelectorAll('dd')[2].innerText`);
  await closeOnb();
  p = await openTips();
  let d = await clickDesc();
  check('작은 패널이면 펫을 누르면 설명에 작은 패널', d.includes(small), d);
  await main("__jj.settings.set({ panelView: 'window' }); 1");
  await closeOnb();
  p = await openTips();
  d = await clickDesc();
  check('큰 창이면 펫을 누르면 설명에 큰 창', d.includes(big) && !d.includes(small), d);
  const pd = await panelDesc();
  check('큰 창이면 패널 단축키 설명도 큰 창', pd.toLowerCase().includes(big.toLowerCase()), pd);
  await main("__jj.settings.set({ panelView: 'compact' }); 1");
  await closeOnb();
  p = await openTips();

  // 스크롤 없이 들어감, 가로 넘침 없음
  const fit = await p.ev(`(() => { const m = document.querySelector('main'); const f = document.querySelector('footer').getBoundingClientRect(); return { over: m.scrollHeight - m.clientHeight, foot: f.bottom, h: innerHeight, x: document.documentElement.scrollWidth - innerWidth }; })()`);
  check('4쪽 본문이 스크롤 없이 들어감', fit.over <= 1 && fit.foot <= fit.h + 1, JSON.stringify(fit));
  check('가로 넘침 없음', fit.x <= 1, String(fit.x));
  await main('__jj.onboarding.window.setSize(360, 640); 1');
  await sleep(300);
  const fit2 = await p.ev(`(() => { const m = document.querySelector('main'); return { x: document.documentElement.scrollWidth - innerWidth, mx: m.scrollWidth - m.clientWidth }; })()`);
  check('폭 360 에서도 가로 넘침 없음', fit2.x <= 1 && fit2.mx <= 1, JSON.stringify(fit2));
  await closeOnb();

  // 설정의 같은 스위치
  await main('__jj.settingsWindow.open(); 1');
  const s = await page('settings');
  await s.until(() => s.ev(`!!document.getElementById('tab-ease')`));
  await s.click(`document.getElementById('tab-ease')`);
  await sleep(400);
  const sSw = () => s.ev(`document.querySelector('[role=switch][aria-label=${JSON.stringify(label)}]')?.getAttribute('aria-checked')`);
  check('설정에도 같은 이름의 스위치 (꺼짐)', (await sSw()) === 'false');
  const sHint = await s.ev(`(() => { const t = document.querySelector('[role=switch][aria-label=${JSON.stringify(label)}]').closest('.toggle'); return t.querySelector('small').innerText; })()`);
  const oHint = tx('켜면 Option/Alt 없이 세 키로 눌러. 끄면 기본 네 키로 돌아가.', 'On: three keys, no Option/Alt. Off: back to the default four keys.');
  check('설정과 안내의 설명 글이 같음', sHint === oHint, sHint);
  await s.click(`document.querySelector('[role=switch][aria-label=${JSON.stringify(label)}]')`);
  check('설정에서 켜면 쉬운 키 저장', await s.until(async () => (await sSw()) === 'true' && (await main('__jj.settings.get().shortcuts.chat')) === 'CommandOrControl+Shift+B'));
  await s.click(`document.querySelector('[role=switch][aria-label=${JSON.stringify(label)}]')`);
  check('설정에서 끄면 기본 키', await s.until(async () => (await sSw()) === 'false' && (await main('__jj.settings.get().shortcuts.chat')) === 'CommandOrControl+Alt+Shift+J'));
  await s.shot(`${PREFIX}-settings-keys`);
  await main('__jj.settingsWindow.window.close(); 1');
}

// ---- 2. 일정 입력칸 해석 미리보기 ----
async function preview(surface) {
  const w = surface === 'panel' ? 320 : 760;
  const inputSel = surface === 'panel' ? '.event-add input' : '.event-add input';
  if (surface === 'panel') {
    await main("__jj.panel.openTab('event'); 1");
    await sleep(800);
    await main(`__jj.panel.window.removeAllListeners('blur'); __jj.panel.window.setBounds({ x: 20, y: 30, width: ${w}, height: 640 }); 1`);
  } else {
    await main("__jj.home.open('event'); 1");
    await sleep(900);
    await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: 780 }); 1`);
  }
  await sleep(500);
  const p = await page(surface === 'panel' ? 'panel' : 'home');
  const tag = `${surface}-${w}`;
  await p.until(() => p.ev(`!!document.querySelector(${JSON.stringify(inputSel)})`));
  const previewText = () => p.ev(`document.querySelector('[data-event-preview]')?.innerText ?? null`);
  await p.click(`document.querySelector(${JSON.stringify(inputSel)})`);
  const want = (whenKo, whenEn) => tx(`이렇게 넣을게: ${whenKo}`, `Will add: ${whenEn}`);
  const typed = tx('매주 월요일 10시 팀 회의', 'weekly monday 10am team meeting');
  const steps = ko ? ['매주 월요일', ' 10시', ' 팀 회의'] : ['weekly monday', ' 10am', ' team meeting'];
  let acc = '';
  const t0 = Date.now();
  for (const [i, part] of steps.entries()) {
    for (const ch of part) {
      await p.type(ch);
      acc += ch;
    }
    await sleep(320);
    const shown = await previewText();
    if (i < 2) check(`${tag}: 쓰다 만 "${acc}" 는 미리보기를 숨김`, shown === null, String(shown));
  }
  const typingMs = Date.now() - t0 - 3 * 320;
  const full = await previewText();
  const expectLine = tx('11월', 'Nov');
  check(`${tag}: "${typed}" 를 다 치면 한 줄이 뜸 (날짜, 시각, 반복, 제목)`, !!full && full.startsWith(tx('이렇게 넣을게:', 'Will add:')) && full.includes(tx('오전 10:00', '10:00 AM')) && full.includes(tx('매주', 'Weekly')) && full.includes(tx('팀 회의', 'team meeting')), String(full));
  check(`${tag}: 입력이 막히지 않음 (글자 ${typed.length}개 입력 ${typingMs}ms)`, typingMs < typed.length * 250, `${typingMs}ms`);
  const overflow = await p.ev(`(() => { const e = document.querySelector('[data-event-preview]'); return e ? e.scrollWidth - e.clientWidth : 0; })()`);
  check(`${tag}: 미리보기가 가로로 넘치지 않음`, overflow <= 1, String(overflow));
  const docX = await p.ev(`document.documentElement.scrollWidth - innerWidth`);
  check(`${tag}: 화면 가로 넘침 없음`, docX <= 1, String(docX));
  if (surface === 'panel') await p.shot(`${PREFIX}-preview`);
  if (surface === 'home') await p.shot(`${PREFIX}-preview-home`);
  // 넣으면 미리보기와 같은 일정
  await p.key('Enter', 'Enter', 13);
  const got = await p.until(async () => (await main('__jj.events.titles().length')) >= 1, 4000);
  const ev0 = await main(`(() => { const t = __jj.events.titles().find((x) => x.title === ${JSON.stringify(tx('팀 회의', 'team meeting'))}); if (!t) return null; const e = __jj.events.get(t.id); const d = new Date(e.startAt); return { h: d.getHours(), m: d.getMinutes(), dow: d.getDay(), repeat: e.repeat ?? null }; })()`);
  check(`${tag}: 넣은 일정이 미리보기와 같음 (월요일 10:00 매주)`, got && ev0 && ev0.h === 10 && ev0.m === 0 && ev0.dow === 1 && ev0.repeat === 'weekly', JSON.stringify(ev0));
  check(`${tag}: 넣고 나면 미리보기가 사라짐`, await p.until(async () => (await previewText()) === null));
  await main('__jj.events.titles().forEach((t) => __jj.events.remove(t.id, Date.now())); __jj.panel.refresh(); 1');
  // 여러 입력 (표): 읽히면 한 줄, 못 읽으면 숨김
  const table = ko
    ? [
        ['내일 3시 회의', '오후 3:00'],
        ['내일 제주도 여행', '종일'],
        ['장보기', null],
        ['25시 회의', null],
      ]
    : [
        ['gym 3pm', '3:00 PM'],
        ['jeju trip tomorrow', 'All day'],
        ['groceries', null],
      ];
  for (const [line, frag] of table) {
    await setValue(p, inputSel, line);
    await sleep(380);
    const shown = await previewText();
    check(`${tag}: "${line}" ${frag ? '는 한 줄' : '는 숨김'}`, frag ? !!shown && shown.includes(frag) : shown === null, String(shown));
  }
  await setValue(p, inputSel, '');
  await sleep(300);
  check(`${tag}: 비우면 숨김`, (await previewText()) === null);
  void want;
  void expectLine;
  if (surface === 'panel') await main('__jj.panel.window.hide(); 1');
  else await main('__jj.home.window.close(); 1');
}

// ---- 3. 큰 창 오늘 탭 ----
async function today(w) {
  await main("__jj.home.open('today'); 1");
  await sleep(900);
  await main(`__jj.home.window.setBounds({ x: 20, y: 30, width: ${w}, height: 780 }); 1`);
  await sleep(700);
  const p = await page('home');
  await p.until(() => p.ev(`!!document.querySelector('.focus-card')`));
  await main('__jj.panel.refresh(); 1');
  await sleep(500);
  const tag = `home-${w}`;
  const missed = await p.ev(`[...document.querySelectorAll('.missed li .title')].map((e) => e.innerText)`);
  check(`${tag}: 놓친 알림에 일반 알림은 남고 업적 달성은 없음`, missed.length === 1 && missed[0] === tx('치과 예약', 'Dentist'), JSON.stringify(missed));
  const pos = await p.ev(`(() => { const f = document.querySelector('.focus-card').getBoundingClientRect(); const m = document.querySelector('.missed')?.getBoundingClientRect(); const s = document.querySelector('.today'); const sr = s.getBoundingClientRect(); return { fTop: f.top - sr.top, fBottom: f.bottom - sr.top, mTop: m ? m.top - sr.top : null, viewH: s.clientHeight, x: document.documentElement.scrollWidth - innerWidth }; })()`);
  if (w < 860) {
    check(`${tag}: 집중 카드가 첫 화면 안, 놓친 알림 위`, pos.fBottom <= pos.viewH && (pos.mTop === null || pos.fTop < pos.mTop), JSON.stringify(pos));
  } else {
    const cols = await p.ev(`!!document.querySelector('.today-pet .focus-card')`);
    check(`${tag}: 넓은 칸은 집중 카드가 오른쪽 열 맨 위 그대로`, cols === true, JSON.stringify(pos));
  }
  check(`${tag}: 가로 넘침 없음`, pos.x <= 1, String(pos.x));
  const once = await p.ev(`document.querySelectorAll('.focus-card').length`);
  check(`${tag}: 집중 카드는 하나만`, once === 1, String(once));
  await p.shot(`${PREFIX}-today-${w}`);
  // 집중 중이면 맨 위
  if (w < 860) {
    await p.ev('jjakkungPanel.focusStart(25); 1');
    await p.until(() => p.ev(`document.querySelector('.focus-card.work, .focus-card.running') !== null || document.querySelector('.focus-card:not(.fold)') !== null`));
    await sleep(400);
    const top = await p.ev(`(() => { const f = document.querySelector('.focus-card').getBoundingClientRect(); const s = document.querySelector('.today').getBoundingClientRect(); const h = [...document.querySelectorAll('.today h2')].find((e) => e.innerText.includes(${JSON.stringify(tx('오늘 일정', 'Today'))})); return { fTop: f.top - s.top, n: document.querySelectorAll('.focus-card').length }; })()`);
    check(`${tag}: 집중 중에도 카드 하나, 첫 화면 위쪽`, top.n === 1 && top.fTop < 200, JSON.stringify(top));
    await p.ev('jjakkungPanel.focusStop?.(); 1').catch(() => {});
  }
  await main('__jj.home.window.close(); 1');
}

// ---- 비교 그림 재료: 1 시작 안내 4쪽, 2 일정 입력 미리보기(작은 패널), 3 큰 창 오늘 760 ----
async function shotsOnly() {
  // 1
  const p1 = await openTips();
  await p1.shot(`${PREFIX}-1`);
  await closeOnb();
  // 2
  await main("__jj.panel.openTab('event'); 1");
  await sleep(800);
  await main('__jj.panel.window.removeAllListeners("blur"); 1');
  const p2 = await page('panel');
  await p2.click(`document.querySelector('.event-add input')`);
  await p2.type(tx('매주 월요일 10시 팀 회의', 'weekly monday 10am team meeting'));
  await sleep(500);
  await p2.shot(`${PREFIX}-2`);
  await main('__jj.panel.window.hide(); 1');
  // 3
  await main("__jj.home.open('today'); 1");
  await sleep(900);
  await main('__jj.home.window.setBounds({ x: 20, y: 30, width: 760, height: 780 }); 1');
  await sleep(700);
  const p3 = await page('home');
  await p3.until(() => p3.ev(`!!document.querySelector('.focus-card')`));
  await sleep(500);
  await p3.shot(`${PREFIX}-3`);
  await main('__jj.home.window.close(); 1');
}

let failure;
try {
  await main('1');
  await sleep(1500);
  if (SHOTS_ONLY) await shotsOnly();
  else {
    await onboarding();
    await preview('panel');
    await preview('home');
    await today(760);
    await today(1100);
  }
} catch (err) {
  failure = err;
  console.log('FAIL 점검 도중 예외:', err?.message ?? err);
}
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${LANG}: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAIL ${failed.length}` : ''}`);
for (const r of failed) console.log(' FAIL:', r.name);
process.exit(failed.length || failure ? 1 : 0);
