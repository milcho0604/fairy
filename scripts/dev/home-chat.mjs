// 큰 창 안에 품은 채팅 점검 (이슈 #165, 큰 창 설계 #159).
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/home-chat.mjs
//   (전후 비교 그림 재료: COMPARE=1 이면 큰 창 채팅 구역 상태만 찍어 OUT/compare-<ko|en>-<after|before>.png 로 둔다. JJ_ROOT=<체크아웃>)
//
// 앱을 직접 띄운다(빈 데이터 폴더, 임시 HOME, JJ_NO_FOCUS=1, 포트 무작위). 화면은 CDP 로만 다루고 진짜 마우스, 키보드, 포커스를 쓰지 않는다.
// 진짜 AI 는 부르지 않는다: PATH 앞에 가짜 claude 를 두고, HOME 이 임시 폴더라 claude 세션 기록도 거기에만 생겨 끝나면 폴더째 지운다.
//
// 경계 상황 표 (PASS/FAIL):
//   A 열기: 사이드바 채팅 누르기 -> 채팅 view 가 본문 칸 자리에 얹히고 따로 채팅 창은 없다, 구역 바꾸면 view 가 감춰지고 다시 누르면 같은 view
//   B 자리: view 자리 = 본문 칸 자리(760/1100/1440, 글자 배율 1.5), 창 안을 넘지 않는다
//   C 한 번에 하나: 따로 창이 떠 있다가 큰 창 채팅 구역을 열면 따로 창이 닫힌다, 큰 창이 보이는 동안 채팅 열기는 큰 창 안으로,
//     큰 창을 숨기면 따로 창, 큰 창을 닫으면 품은 면이 사라진다. 보이는 면은 늘 하나
//   D 상태 공유: 따로 창에서 하던 대화, 쓰던 글, 기다리는 중 표시가 큰 창 채팅에 그대로 보인다 (반대로도)
//   E 그림: attach 가 품은 면에 붙는다(구역이 달라도, 아직 안 만들어졌어도), 끌어놓기, 따로 창 attach 는 그대로
//   F 답 도착 알림: 앞에서 보고 있으면(큰 창이 앞이고 채팅 구역) 안 내고, 채팅 구역이 아니거나 앞이 아니면 낸다. 따로 창도 같다
//   G 창 단축키: 채팅 view 가 포커스를 쥔 채 Cmd+숫자(구역), Cmd+,(설정), Cmd+W(닫기)가 먹는다, 복사 같은 키는 넘기지 않는다
//   H 시험 창 규칙: 창 투명, 마우스 통과, 포커스 안 뺏음, Dock 호출 0, 내장 화면 안
//   I 수명: 숨겼다 다시 열면 채팅 자리 유지, 숨긴 채 JJ_HOME_KEEP_MS 가 지나면 view 의 화면까지 없어진다(남는 화면 0)
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? resolve(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-home-chat');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const COMPARE = process.env.COMPARE ?? '';
const ko = LANG === 'ko';
const tx = (k, e) => (ko ? k : e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? (await freePort()));
const PAGE = Number(process.env.JJ_PAGE_PORT ?? (await freePort()));
const KEEP_MS = 4000;

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.home-chat-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
const bin = join(scratch, 'bin');
for (const d of [data, home, bin]) mkdirSync(d, { recursive: true });

// 가짜 claude: 짧은 답만 한다 (진짜 AI 는 부르지 않는다)
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[0] === 'mcp') { console.log(''); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '가짜 답이야 (' + input.slice(0, 12).replace(/\\s+/g, ' ') + ')' }));
});
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
writeFileSync(join(data, 'chat-settings.json'), JSON.stringify({ provider: 'claude' }));
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, petName: tx('콩', 'Mochi'), wander: false, friends: [] }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));

let app;
function launch() {
  app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
    cwd: root,
    env: {
      HOME: home,
      SHELL: '/usr/bin/false',
      PATH: PATH_ENV,
      JJ_NO_FOCUS: '1',
      JJ_USER_DATA: data,
      JJ_TEST_SECRETS: 'memory',
      JJ_HOME_KEEP_MS: String(KEEP_MS),
    },
    stdio: 'ignore',
  });
  console.log('app pid', app.pid, 'lang', LANG, 'ports', INSPECT, PAGE);
}
async function quit() {
  if (!app || app.exitCode !== null) return;
  const gone = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  await Promise.race([gone, sleep(8000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}, ms = 30_000) =>
    new Promise((r, j) => {
      const i = ++id;
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), ms);
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          clearTimeout(timer);
          ws.removeEventListener('message', h);
          r(m);
        }
      };
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
/** 화면(webContents) 하나. url 에 name 이 든 것 가운데 가장 나중 것. 품은 채팅은 chat.html#embed */
async function page(name, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.filter((x) => x.type === 'page' && x.url.includes(name)).at(-1);
      if (p) {
        let c = pageConns.get(p.id);
        if (!c) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(p.id, c);
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
          url: p.url,
          ev,
          send: c.send,
          click: async (sel) => {
            const pos = await ev(
              `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
            );
            if (!pos) return false;
            await mouse('mouseMoved', pos.x, pos.y);
            await mouse('mousePressed', pos.x, pos.y);
            await mouse('mouseReleased', pos.x, pos.y);
            return true;
          },
          type: async (sel, text) => {
            await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`);
            await c.send('Input.insertText', { text });
          },
          png: async () => Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'),
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
        };
      }
    } catch {
      // 아직 안 떴다
    }
    await sleep(250);
  }
  return undefined;
}
const pagesOf = async (name) =>
  (await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json()).filter((x) => x.type === 'page' && x.url.includes(name));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(120);
  }
  return false;
}

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${LANG}] ${name}${detail ? ` (${detail})` : ''}`);
}

// ---- 메인 쪽 손잡이 ----
const homeAlive = () => main('!!__jj.home.window && !__jj.home.window.isDestroyed()');
const standaloneAlive = () => main('!!__jj.chat.window && !__jj.chat.window.isDestroyed()');
/** 지금 보이는 채팅 면의 수와 종류 */
const shownFaces = async () =>
  JSON.parse(await main('JSON.stringify(__jj.chat.faces().filter((f) => f.shown()).map((f) => f.embedded ? "home" : "window"))'));
const chatRect = async () => JSON.parse(await main('JSON.stringify(__jj.home.chatRect())'));
const viewBounds = async () => JSON.parse(await main('JSON.stringify(__jj.home.chatView ? __jj.home.chatView.getBounds() : null)'));
const viewVisible = () => main('__jj.home.chatView ? __jj.home.chatView.getVisible() : false');
const dockStats = async () => JSON.parse(await main('JSON.stringify(__jj.dock.stats())'));
const closeAll = async () => {
  await main(`(() => { for (const w of [__jj.home.window, __jj.chat.window, __jj.panel.window]) if (w && !w.isDestroyed()) w.close(); return 1; })()`);
  await until(async () => !(await homeAlive()) && !(await standaloneAlive()), 6000);
  await sleep(300);
};
async function openHome(tab = 'today') {
  await main(`__jj.settings.set({ panelView: 'window' }); __jj.home.open('${tab}'); 1`);
  await until(homeAlive);
  const h = await page('home.html');
  await until(async () => !!(await h.ev("!!document.querySelector('#ptab-chat')")));
  await sleep(500);
  return h;
}
/** 사이드바 채팅을 CDP 마우스로 누르고 view 가 얹힐 때까지 */
async function pickChat(h) {
  await h.click('#ptab-chat');
  await until(async () => (await chatRect()) !== null && (await viewVisible()), 6000);
  const c = await page('chat.html#embed');
  await until(async () => !!(await c.ev("!!document.querySelector('textarea')")), 8000);
  await sleep(300);
  return c;
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG = JSON.stringify({
  full: { mime: 'image/png', data: PNG },
  thumb: { thumb: `data:image/png;base64,${PNG}`, full: `data:image/png;base64,${PNG}`, w: 1, h: 1 },
});
const ask = async (c, text) => {
  await c.type('textarea', text);
  await c.ev("document.querySelector('button.primary:not([disabled])').click()");
};
const lastPetText = "[...document.querySelectorAll('.msg.pet')].at(-1)?.innerText ?? ''";
const answered = (c, needle) => until(async () => (await c.ev(lastPetText)).includes(needle), 20_000);
const msgCount = (c) => c.ev("document.querySelectorAll('.msg').length");

try {
  launch();
  await main('1');
  await until(async () => (await main('typeof __jj')) === 'object', 60_000);
  await sleep(1500);

  // 비교 그림 재료 (전: 따로 창, 후: 큰 창 안)
  if (COMPARE) {
    await main(`__jj.chat.debugSetState((s) => ({ ...s, messages: [
      { id: 'u1', role: 'user', text: ${JSON.stringify(tx('오늘 뭐부터 하면 좋을까?', 'What should I start with today?'))} },
      { id: 'p1', role: 'pet', provider: 'claude', status: 'done', text: ${JSON.stringify(tx('급한 것부터 볼게. 마감이 가까운 할 일 둘을 먼저 하고, 나머지는 오후에 나눠 하자.', "Let's start with what's urgent. Do the two nearest deadlines first and spread the rest over the afternoon."))} } ] })); 1`);
    if (COMPARE === 'before') {
      // 전: 큰 창 사이드바 채팅은 따로 창을 연다. 큰 창 본문과 따로 뜬 채팅 창을 한 장에 놓는다
      const h = await openHome('today');
      await main('__jj.home.window.setSize(1100, 720); 1');
      await sleep(400);
      // 옛 동작 그대로: 큰 창이 채팅 열기를 대신 받지 않아 따로 창이 뜬다
      await main('__jj.chat.setHost(undefined); __jj.chat.open(__jj.pet.bounds()); 1');
      await until(standaloneAlive);
      await sleep(1200);
      const c = await page('chat.html');
      const parts = { home: await h.png(), chat: await c.png() };
      writeFileSync(join(OUT, `compare-parts-${LANG}-before-home.png`), parts.home);
      writeFileSync(join(OUT, `compare-parts-${LANG}-before-chat.png`), parts.chat);
    } else {
      const h = await openHome('today');
      await main('__jj.home.window.setSize(1100, 720); 1');
      await sleep(400);
      const c = await pickChat(h);
      await sleep(800);
      const r = await chatRect();
      writeFileSync(join(OUT, `compare-parts-${LANG}-after-home.png`), await h.png());
      writeFileSync(join(OUT, `compare-parts-${LANG}-after-chat.png`), await c.png());
      writeFileSync(join(OUT, `compare-parts-${LANG}-after-rect.json`), JSON.stringify(r));
    }
  } else if (!process.env.ONLY) {
    // ================= A 열기 =================
    console.log('\n== A 열기 ==');
    const h = await openHome('today');
    check('A1 큰 창을 열면 채팅 view 는 아직 없다', (await main('!__jj.home.chatView')) === true);
    check('A2 사이드바 채팅에 ↗ 가 없다 (따로 창이 아니다)', (await h.ev("!document.querySelector('#ptab-chat .out')")) === true);
    const dock0 = await dockStats();
    const c = await pickChat(h);
    check('A3 채팅을 누르면 채팅 자리가 생기고 view 가 보인다', (await chatRect()) !== null && (await viewVisible()) === true);
    check('A4 따로 채팅 창은 없다', !(await standaloneAlive()));
    check('A5 보이는 채팅 면은 큰 창 안 하나', JSON.stringify(await shownFaces()) === '["home"]', JSON.stringify(await shownFaces()));
    check('A6 사이드바 채팅이 현재 구역으로 표시된다', (await h.ev("document.querySelector('#ptab-chat')?.getAttribute('aria-current')")) === 'page');
    check('A7 머리줄 제목이 채팅이다', (await h.ev("document.querySelector('.home-bar h2')?.textContent")) === tx('채팅', 'Chat'));
    check('A8 가려진 본문은 남아 있다 (hidden)', (await h.ev("document.querySelector('.home-panel')?.hidden")) === true);
    const chatId = c.id;
    await h.click('#ptab-todo');
    await until(async () => (await chatRect()) === null, 4000);
    check('A9 다른 구역을 고르면 채팅 자리가 사라지고 view 가 감춰진다', (await chatRect()) === null && (await viewVisible()) === false);
    check('A10 본문이 다시 보인다', (await h.ev("document.querySelector('.home-panel')?.hidden")) === false);
    check('A11 감춘 동안 보이는 채팅 면은 없다', (await shownFaces()).length === 0, JSON.stringify(await shownFaces()));
    await h.click('#ptab-chat');
    await until(async () => (await chatRect()) !== null && (await viewVisible()), 5000);
    const c2 = await page('chat.html#embed');
    check('A12 다시 누르면 같은 채팅 화면이 돌아온다 (새로 읽지 않음)', c2.id === chatId && (await pagesOf('chat.html#embed')).length === 1);
    check('A13 ko/en: 영어 화면에 한글 없음', ko || !/[가-힣]/.test(await h.ev("document.querySelector('.home-side')?.innerText ?? ''")));

    // ================= B 자리 =================
    console.log('\n== B 자리 ==');
    for (const [w, hh] of [[760, 560], [1100, 720], [1440, 780]]) {
      await main(`__jj.home.window.setSize(${w}, ${hh}); 1`);
      await until(async () => {
        const v = await viewBounds();
        const r = await chatRect();
        return v && r && Math.abs(v.width - Math.round(r.width)) <= 1;
      }, 4000);
      await sleep(200);
      const r = await chatRect();
      const v = await viewBounds();
      const content = JSON.parse(await main('JSON.stringify(__jj.home.window.getContentBounds())'));
      check(`B1 [${w}] view 자리 = 본문 칸 자리`, !!v && !!r && Math.abs(v.x - r.x) <= 1 && Math.abs(v.y - r.y) <= 1 && Math.abs(v.width - r.width) <= 1 && Math.abs(v.height - r.height) <= 1, JSON.stringify({ v, r }));
      check(`B2 [${w}] 창 안을 넘지 않는다`, !!v && v.x >= 0 && v.y >= 0 && v.x + v.width <= content.width && v.y + v.height <= content.height, JSON.stringify({ v, content }));
      const cc = await page('chat.html#embed');
      await until(async () => Math.abs((await cc.ev('innerWidth')) - v.width) <= 1, 4000);
      const inner = JSON.parse(await cc.ev('JSON.stringify([innerWidth, innerHeight])'));
      check(`B3 [${w}] 채팅 화면 크기 = view 크기`, !!v && Math.abs(inner[0] - v.width) <= 1 && Math.abs(inner[1] - v.height) <= 1, JSON.stringify({ inner, v }));
      const over = await cc.ev("document.documentElement.scrollWidth > innerWidth + 1");
      check(`B4 [${w}] 채팅에 가로 넘침 없음`, over === false);
    }
    await main('__jj.home.contents.setZoomFactor(1.5); 1');
    await sleep(900);
    {
      const v = await viewBounds();
      const r = await chatRect();
      check('B5 [배율 1.5] view 자리 = 본문 칸 자리 x 1.5', !!v && !!r && Math.abs(v.x - r.x * 1.5) <= 2 && Math.abs(v.width - r.width * 1.5) <= 2, JSON.stringify({ v, r }));
    }
    await main('__jj.home.contents.setZoomFactor(1); 1');
    await sleep(600);

    // ================= C 한 번에 하나 =================
    console.log('\n== C 한 번에 하나 ==');
    await closeAll();
    // C1 따로 창이 먼저 있고, 큰 창을 열어 채팅 구역으로
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    await sleep(900);
    const solo = await page('chat.html');
    await solo.type('textarea', tx('쓰던 글 하나', 'a draft in progress'));
    await sleep(500);
    check('C1 큰 창이 없을 땐 따로 창이 뜬다', (await standaloneAlive()) && !(await homeAlive()) && JSON.stringify(await shownFaces()) === '["window"]');
    const h2 = await openHome('today');
    await pickChat(h2);
    await until(async () => !(await standaloneAlive()), 5000);
    check('C2 큰 창 채팅 구역을 열면 따로 창이 닫힌다', !(await standaloneAlive()));
    check('C3 보이는 채팅 면은 하나', JSON.stringify(await shownFaces()) === '["home"]', JSON.stringify(await shownFaces()));
    const draftBack = await (await page('chat.html#embed')).ev("document.querySelector('textarea')?.value");
    check('C4 따로 창에서 쓰던 글이 큰 창 채팅에 그대로 있다', draftBack === tx('쓰던 글 하나', 'a draft in progress'), String(draftBack));
    // C5 큰 창이 보이는 동안 채팅 열기는 큰 창 안으로
    await h2.click('#ptab-todo');
    await until(async () => (await chatRect()) === null, 4000);
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(async () => (await chatRect()) !== null, 5000);
    check('C5 큰 창이 보이는 동안 채팅 열기 요청(다른 구역에서)은 큰 창 채팅 구역으로', (await chatRect()) !== null && !(await standaloneAlive()));
    await main('__jj.chat.toggle(__jj.pet.bounds()); 1');
    await sleep(600);
    check('C6 toggle 도 따로 창을 만들지 않는다', !(await standaloneAlive()) && JSON.stringify(await shownFaces()) === '["home"]');
    // C7 큰 창을 숨기면 따로 창
    await main('__jj.home.hide(); 1');
    await sleep(500);
    check('C7 큰 창을 숨기면 보이는 채팅 면이 없다', (await shownFaces()).length === 0, JSON.stringify(await shownFaces()));
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    await sleep(900);
    check('C8 큰 창이 숨겨져 있으면 채팅 열기는 따로 창', (await standaloneAlive()) && JSON.stringify(await shownFaces()) === '["window"]', JSON.stringify(await shownFaces()));
    await main('__jj.home.open(); 1');
    await sleep(700);
    // 숨겼다 다시 연 큰 창은 채팅 구역 그대로 (채팅 자리 유지): 따로 창은 큰 창 채팅이 다시 보이면 닫혀야 한다
    check('C9 숨겼다 다시 연 큰 창: 채팅 자리가 유지되고, 그사이 뜬 따로 창은 닫힌다', (await chatRect()) !== null && (await viewVisible()) === true && !(await standaloneAlive()));
    await h2.click('#ptab-todo');
    await sleep(400);
    await h2.click('#ptab-chat');
    await until(async () => (await chatRect()) !== null && !(await standaloneAlive()), 5000);
    check('C10 큰 창 채팅 구역을 다시 열면 따로 창이 닫힌다', !(await standaloneAlive()) && JSON.stringify(await shownFaces()) === '["home"]', JSON.stringify(await shownFaces()));
    // C11 큰 창을 닫으면 품은 면이 사라진다
    await main('__jj.home.window.close(); 1');
    await until(async () => !(await homeAlive()), 6000);
    await sleep(500);
    check('C11 큰 창을 닫으면 품은 채팅 면이 없다', JSON.parse(await main('JSON.stringify(__jj.chat.faces().filter((f) => f.embedded).length)')) === 0);
    check('C12 큰 창을 닫으면 채팅 화면(webContents)이 남지 않는다', (await pagesOf('chat.html#embed')).length === 0);
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    check('C13 큰 창이 없으면 채팅 열기는 따로 창 (회귀)', await standaloneAlive());

    // ================= D 상태 공유 =================
    console.log('\n== D 상태 공유 ==');
    await closeAll();
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    await sleep(1200);
    const s1 = await page('chat.html');
    await ask(s1, tx('안녕 따로 창', 'hello from window'));
    await answered(s1, tx('가짜 답', '가짜 답'));
    const nSolo = await msgCount(s1);
    const h3 = await openHome('today');
    const e1 = await pickChat(h3);
    await until(async () => (await msgCount(e1)) === nSolo, 5000);
    check('D1 따로 창에서 한 대화가 큰 창 채팅에 그대로 보인다', (await msgCount(e1)) === nSolo && nSolo >= 2, String(await msgCount(e1)));
    await ask(e1, tx('두 번째 질문', 'second question'));
    await answered(e1, '가짜 답');
    const nHome = await msgCount(e1);
    check('D2 큰 창 채팅에서 물으면 답이 온다 (가짜 claude)', nHome === nSolo + 2, String(nHome));
    await main('__jj.home.hide(); 1');
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    await sleep(1500);
    const s2 = await page('chat.html');
    await until(async () => (await msgCount(s2)) === nHome, 5000);
    check('D3 큰 창에서 한 대화가 따로 창에 그대로 보인다', (await msgCount(s2)) === nHome, String(await msgCount(s2)));
    // 기다리는 중 표시도 넘어간다
    await main(`__jj.chat.debugSetState((s) => ({ ...s, pendingId: 'w9', messages: [...s.messages, { id: 'w9', role: 'pet', provider: 'claude', status: 'waiting', text: '' }] })); 1`);
    await sleep(500);
    await main('__jj.home.open(); 1');
    await sleep(600);
    await pickChat(h3).catch(() => {});
    await until(async () => !(await standaloneAlive()), 5000);
    const e3 = await page('chat.html#embed');
    await until(async () => (await e3.ev("!!document.querySelector('.thinking, .msg.pet.waiting, [data-status=waiting]')")) === true, 5000);
    check('D4 기다리는 중인 답이 큰 창 채팅에서도 기다리는 중으로 보인다', (await e3.ev("!!document.querySelector('.thinking, .msg.pet.waiting, [data-status=waiting]')")) === true);
    await main(`__jj.chat.debugSetState((s) => ({ ...s, pendingId: undefined, messages: s.messages.filter((m) => m.id !== 'w9') })); 1`);

    // ================= E 그림 =================
    console.log('\n== E 그림 ==');
    const thumbs = (cc) => cc.ev("document.querySelectorAll('.attachments .attachment').length");
    await closeAll();
    // E1 큰 창이 있고 다른 구역, 채팅 view 를 아직 만든 적 없음 -> attach
    const h4 = await openHome('today');
    await main(`__jj.chat.attach(${IMG}, __jj.pet.bounds()); 1`);
    await until(async () => (await chatRect()) !== null, 6000);
    const e4 = await page('chat.html#embed');
    await until(async () => (await thumbs(e4)) === 1, 6000);
    check('E1 채팅을 연 적 없는 큰 창에서 attach: 채팅 구역이 열리고 그림이 붙는다', (await thumbs(e4)) === 1 && !(await standaloneAlive()), String(await thumbs(e4)));
    // E2 이미 만든 view 가 감춰진 상태에서 attach
    await h4.click('#ptab-todo');
    await until(async () => (await chatRect()) === null, 4000);
    await e4.ev("document.querySelector('.attachments .attachment button, .attachments .attachment .remove')?.click()").catch(() => {});
    await main(`__jj.chat.attach(${IMG}, __jj.pet.bounds()); 1`);
    await until(async () => (await chatRect()) !== null, 6000);
    await sleep(600);
    check('E2 감춰 둔 채팅 view 에 attach: 구역이 열리고 그림이 붙는다', (await thumbs(e4)) >= 1 && !(await standaloneAlive()), String(await thumbs(e4)));
    // E3 끌어놓기
    const before = await thumbs(e4);
    await e4.ev(`(async () => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob('${PNG}'), (ch) => ch.charCodeAt(0))], '그림.png', { type: 'image/png' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
    await until(async () => (await thumbs(e4)) === before + 1, 5000);
    check('E3 품은 채팅에 그림 끌어놓기', (await thumbs(e4)) === before + 1, `${before} -> ${await thumbs(e4)}`);
    // E4 따로 창 attach 회귀
    await closeAll();
    await main(`__jj.chat.attach(${IMG}, __jj.pet.bounds()); 1`);
    await until(standaloneAlive);
    const s4 = await page('chat.html');
    await until(async () => (await thumbs(s4)) === 1, 8000);
    check('E4 큰 창이 없을 때 attach 는 따로 창에 붙는다 (회귀)', (await thumbs(s4)) === 1);

    // ================= F 답 도착 알림 =================
    console.log('\n== F 답 도착 알림 ==');
    await closeAll();
    await main(`(() => { globalThis.__said = []; if (!globalThis.__say0) globalThis.__say0 = __jj.pet.say; __jj.pet.say = (o) => { globalThis.__said.push(o.kind); return new Promise(() => {}); }; return 1; })()`);
    const said = async () => JSON.parse(await main('JSON.stringify(globalThis.__said)'));
    const stub = (frame, on) => main(`(() => { const w = ${frame}; w.isFocused = () => ${on}; return 1; })()`);
    async function oneAnswer(c, text) {
      await main('globalThis.__said.length = 0; 1');
      await ask(c, text);
      await answered(c, '가짜 답');
      await sleep(500);
    }
    // F1 큰 창이 앞이고 채팅 구역: 안 냄
    const h5 = await openHome('today');
    const e5 = await pickChat(h5);
    await stub('__jj.home.window', true);
    await oneAnswer(e5, tx('앞에서 본다', 'watching'));
    check('F1 큰 창이 앞이고 채팅 구역이면 답 알림을 안 낸다', (await said()).length === 0, JSON.stringify(await said()));
    // F2 큰 창이 앞이 아님
    await stub('__jj.home.window', false);
    await oneAnswer(e5, tx('뒤에 있다', 'in back'));
    check('F2 큰 창이 앞이 아니면 답 알림을 낸다', (await said()).length === 1, JSON.stringify(await said()));
    // F3 앞이지만 채팅 구역이 아님: 답이 오는 순간의 판정(faces().some(front))이 거짓이어야 알림을 낸다
    await stub('__jj.home.window', true);
    await h5.click('#ptab-todo');
    await until(async () => (await chatRect()) === null, 4000);
    check('F3 큰 창이 앞이어도 채팅 구역이 아니면 앞으로 치지 않는다 (알림을 낸다)', (await main('__jj.chat.faces().some((f) => f.front())')) === false);
    await h5.click('#ptab-chat');
    await until(async () => (await chatRect()) !== null, 4000);
    check('F3b 채팅 구역으로 돌아오면 앞이다', (await main('__jj.chat.faces().some((f) => f.front())')) === true);
    // F4 따로 창이 앞: 안 냄 / 아님: 냄
    await stub('__jj.home.window', false);
    await closeAll();
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(standaloneAlive);
    await sleep(1200);
    const s5 = await page('chat.html');
    await stub('__jj.chat.window', true);
    await oneAnswer(s5, tx('따로 앞', 'window front'));
    check('F4 따로 창이 앞이면 답 알림을 안 낸다 (회귀)', (await said()).length === 0, JSON.stringify(await said()));
    await stub('__jj.chat.window', false);
    await oneAnswer(s5, tx('따로 뒤', 'window back'));
    check('F5 따로 창이 앞이 아니면 답 알림을 낸다 (회귀)', (await said()).length === 1, JSON.stringify(await said()));
    await main('__jj.pet.say = globalThis.__say0; 1');

    // ================= G 창 단축키 =================
    console.log('\n== G 창 단축키 ==');
    await closeAll();
    const h6 = await openHome('today');
    await pickChat(h6);
    // 채팅 view 가 키를 받은 것처럼 before-input-event 를 낸다 (진짜 키보드를 쓰지 않는다)
    const chord = (code, extra = {}) =>
      main(`(() => { let stopped = false; const input = Object.assign({ type: 'keyDown', code: '${code}', key: '${code}', meta: process.platform === 'darwin', control: process.platform !== 'darwin', alt: false, shift: false, isComposing: false }, ${JSON.stringify(extra)}); __jj.home.chatView.webContents.emit('before-input-event', { preventDefault: () => { stopped = true; } }, input); return stopped; })()`);
    check('G1 Cmd+2 는 큰 창이 맡는다 (preventDefault)', (await chord('Digit2')) === true);
    await until(async () => (await chatRect()) === null, 4000);
    check('G2 Cmd+2: 할 일 구역으로 가고 채팅 view 가 감춰진다', (await chatRect()) === null && (await h6.ev("document.querySelector('#ptab-todo')?.getAttribute('aria-current')")) === 'page');
    await chord('Digit5');
    await until(async () => (await chatRect()) !== null, 5000);
    check('G3 Cmd+5: 채팅 구역으로 돌아온다', (await chatRect()) !== null);
    check('G4 Cmd+C 는 넘기지 않는다 (채팅이 그대로 쓴다)', (await chord('KeyC')) === false);
    check('G5 Cmd+Shift+W 는 넘기지 않는다', (await chord('KeyW', { shift: true })) === false);
    await chord('Comma');
    const setOpen = await until(async () => (await main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()')) === true, 5000);
    check('G6 Cmd+, : 설정 창이 열린다 (따로 창)', setOpen);
    await main('(() => { const w = __jj.settingsWindow.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
    await chord('KeyW');
    const closed = await until(async () => !(await homeAlive()), 6000);
    check('G7 Cmd+W : 큰 창이 닫힌다', closed);

    // ================= H 시험 창 규칙 =================
    console.log('\n== H 시험 창 규칙 ==');
    const h7 = await openHome('today');
    await pickChat(h7);
    const hw = JSON.parse(
      await main(`JSON.stringify({ opacity: __jj.home.window.getOpacity(), focused: __jj.home.window.isFocused(), chatFocused: __jj.home.chatView.webContents.isFocused(), bodyFocused: __jj.home.contents.isFocused(), bounds: __jj.home.window.getBounds(), work: __jj.screen.getPrimaryDisplay().workArea })`),
    );
    check('H1 큰 창은 투명이다 (view 도 같이 보이지 않는다)', hw.opacity === 0, String(hw.opacity));
    check('H2 포커스를 뺏지 않는다 (창, 본문, 채팅 view)', !hw.focused && !hw.chatFocused && !hw.bodyFocused, JSON.stringify(hw));
    const b = hw.bounds;
    const w = hw.work;
    check('H3 내장 화면 안에 있다', b.x >= w.x && b.y >= w.y && b.x + b.width <= w.x + w.width && b.y + b.height <= w.y + w.height, JSON.stringify({ b, w }));
    const ds = await dockStats();
    check('H4 Dock 을 실제로 부르지 않는다 (shows, hides 0)', ds.shows === 0 && ds.hides === 0, JSON.stringify(ds));

    // ================= I 수명 =================
    console.log('\n== I 수명 ==');
    await main('__jj.home.hide(); 1');
    await sleep(500);
    check('I1 숨기면 보이는 채팅 면이 없다', (await shownFaces()).length === 0);
    await main('__jj.home.open(); 1');
    await sleep(800);
    check('I2 다시 열면 채팅 구역 그대로, view 가 보인다', (await chatRect()) !== null && (await viewVisible()) === true && JSON.stringify(await shownFaces()) === '["home"]');
    await main('__jj.home.hide(); 1');
    const gone = await until(async () => !(await homeAlive()), KEEP_MS + 5000);
    check('I3 숨긴 채 오래 두면 큰 창이 없어진다', gone);
    await sleep(600);
    check('I4 없어지면 본문과 채팅 화면(webContents)이 남지 않는다', (await pagesOf('home.html')).length === 0 && (await pagesOf('chat.html')).length === 0, `${(await pagesOf('home.html')).length}/${(await pagesOf('chat.html')).length}`);
    check('I5 없어지면 품은 면이 없다', JSON.parse(await main('JSON.stringify(__jj.chat.faces().filter((f) => f.embedded).length)')) === 0);
    const h8 = await openHome('today');
    await pickChat(h8);
    check('I6 없앤 뒤 새로 열어도 채팅 구역이 된다', (await chatRect()) !== null && JSON.stringify(await shownFaces()) === '["home"]');
    const ds2 = await dockStats();
    check('I7 끝까지 Dock 호출 0', ds2.shows === 0 && ds2.hides === 0, JSON.stringify(ds2));
  }
  if (!COMPARE && (!process.env.ONLY || process.env.ONLY === 'J')) {
    // ================= J 품은 채팅이 죽었을 때 =================
    console.log('\n== J Esc 와 화면 파괴 ==');
    await closeAll();
    const hj = await openHome('today');
    const ej = await pickChat(hj);
    const idBefore = ej.id;
    // J1 빈 입력칸에서 Esc: 품은 채팅은 닫을 창이 아니다 (화면이 없어지면 안 된다)
    await ej.ev("document.querySelector('textarea').focus()");
    await ej.ev("document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))");
    await sleep(1500);
    const alive = await main('(() => { try { return !!__jj.home.chatView && !__jj.home.chatView.webContents.isDestroyed(); } catch { return false; } })()');
    check('J1 품은 채팅에서 빈 입력칸 Esc 를 눌러도 채팅 화면이 살아 있다', alive === true);
    await hj.click('#ptab-todo');
    await sleep(500);
    await hj.click('#ptab-chat');
    await until(async () => (await chatRect()) !== null, 5000);
    const e2 = await page('chat.html#embed');
    check('J2 구역을 바꿨다 돌아와도 채팅 입력칸이 있다', (await e2.ev("!!document.querySelector('textarea')")) === true);
    // J3 화면이 파괴돼도(크래시, 다른 경로) 다시 열면 새로 만든다
    await main('__jj.home.chatView.webContents.close(); 1');
    await until(async () => (await chatRect()) === null, 5000);
    check('J3 채팅 화면이 파괴되면 채팅 구역이 닫힌다 (빈 칸으로 남지 않음)', (await chatRect()) === null && (await main('__jj.chat.faces().filter((f) => f.embedded).length')) === 0);
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until(async () => (await chatRect()) !== null, 6000);
    const e3 = await page('chat.html#embed');
    await until(async () => !!(await e3.ev("!!document.querySelector('textarea')")), 8000);
    check('J4 파괴 뒤 채팅 열기: 새 채팅 화면이 뜨고 입력칸이 있다', (await e3.ev("!!document.querySelector('textarea')")) === true && e3.id !== idBefore && JSON.stringify(await shownFaces()) === '["home"]', JSON.stringify(await shownFaces()));
    check('J5 파괴 뒤에도 따로 창은 없다', !(await standaloneAlive()));
    // J6 한글 조합 중 키는 가로채지 않는다 (home-policy.test.ts 가 판정을 본다. 여기서는 emit 으로 끝까지)
    const stopped = await main(`(() => { let s = false; __jj.home.chatView.webContents.emit('before-input-event', { preventDefault: () => { s = true; } }, { type: 'keyDown', code: 'Digit2', key: '2', meta: process.platform === 'darwin', control: process.platform !== 'darwin', alt: false, shift: false, isComposing: true }); return s; })()`);
    check('J6 한글 조합 중 Cmd+숫자는 가로채지 않는다', stopped === false);
  }
} catch (err) {
  console.error('시험 중 오류', err);
  fails.push(`오류: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await quit();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n통과 ${pass}, 실패 ${fails.length} (${LANG})`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
