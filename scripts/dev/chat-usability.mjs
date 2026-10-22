// 채팅 창 사용성 점검 (이슈 #147): 긴 답 위치, 기다리는 동안, 그림 아닌 파일, 답 아래 단추, 이름 바꾸기 실패, ↑ 안내, 글자 크기.
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위) 화면 요소를 CDP 로만 다룬다.
// 진짜 AI 는 쓰지 않는다: 가짜 claude 를 PATH 앞에 두고(짧은 답, 40문단 한 번에, 40문단 조각으로, 멈춤, 실패), HOME 도 임시 폴더라
// claude 세션 기록은 거기에만 생기고 끝나면 폴더째 지운다.
//
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/chat-usability.mjs
//   (전후 비교 재료만: COMPARE=before|after JJ_ROOT=<빌드한 체크아웃>. SKIP_MINUTE=1 이면 1분 넘는 대기 확인을 건너뛴다)
//
// 보는 것: 창 폭 320, 600 x 밝음, 어두움 x ko, en
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? resolve(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-chat-usability');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const only = process.env.ONLY ?? '';
const run = (name) => !only || only === name;
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.chat-usability-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
const bin = join(scratch, 'bin');
const calls = join(scratch, 'calls.jsonl');
const modeFile = join(scratch, 'mode.txt');
for (const d of [data, home, bin]) mkdirSync(d, { recursive: true });
writeFileSync(calls, '');
writeFileSync(modeFile, 'ok');

// 가짜 claude: mode.txt 가 ok(짧은 답), long(40문단을 한 번에), stream(40문단을 조각으로), slow(답이 안 옴), fail(실패)
const claudeBody = `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[0] === 'mcp') { console.log(''); process.exit(0); }
const paras = Array.from({ length: 40 }, (_, i) => (i === 0 ? '첫 문단: 이 답의 처음이야. ' : (i + 1) + '번째 문단이야. ') + '긴 답이 한 번에 오는 경우를 보려고 길게 쓴 문장이야. 한국어 문장이 두 줄 세 줄로 넘어가는지도 본다.');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ stdin: input }) + '\\n');
  const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim();
  if (mode === 'fail') { console.error('fake claude broke'); process.exit(1); }
  if (mode === 'slow') {
    // 멈춘 척: 답은 안 오고 10초마다 "생각 중" 조각만 흘려 보낸다 (앱의 60초 무응답 제한을 넘겨 1분 넘는 대기를 보려고)
    setInterval(() => console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta' } } })), 10000);
    return;
  }
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }));
  if (mode === 'stream') {
    for (const p of paras) {
      console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: p + '\\n\\n' } } }));
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  const result = mode === 'long' || mode === 'stream' ? paras.join('\\n\\n') : '가짜 답이야 (' + input.slice(0, 20).replace(/\\s+/g, ' ') + ')';
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }));
});
`;
writeFileSync(join(bin, 'claude'), claudeBody);
chmodSync(join(bin, 'claude'), 0o755);
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
writeFileSync(join(data, 'chat-settings.json'), JSON.stringify({ provider: 'claude' }));
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, wander: false, friends: [] }),
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
    },
    stdio: 'ignore',
  });
  console.log('app pid', app.pid, 'ports', INSPECT, PAGE);
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
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        let c = pageConns.get(name);
        if (c?.id !== p.id) {
          c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
          pageConns.set(name, c);
        }
        const ev = async (expr) =>
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
            ?.result?.value;
        return {
          ev,
          send: c.send,
          /** 입력칸에 커서를 두고 글을 넣는다 (CDP insertText: 진짜 키보드가 아니다) */
          type: async (sel, text) => {
            await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); })()`);
            await c.send('Input.insertText', { text });
          },
          /** 키 이벤트를 화면 안에서 만들어 지금 커서가 있는 곳에 보낸다 (진짜 키보드도, CDP 키 입력도 아니다) */
          // (Esc 로 창이 닫히면 답이 안 올 수 있어 잠깐만 기다린다)
          press: (k, keyCode) =>
            Promise.race([ev(`(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, keyCode: ${keyCode}, which: ${keyCode}, bubbles: true, cancelable: true })); return 1; })()`).catch(() => {}), sleep(1500)]),
          shot: async (file) => {
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
          },
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
  throw new Error(`화면 없음: ${name}`);
}

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fails.push(`${name} ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}
async function until(what, fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(100);
  }
  console.log(`(기다리다 시간 초과: ${what})`);
  return false;
}

const panelOpen = () => main('!!__jj.panel.window && !__jj.panel.window.isDestroyed() && __jj.panel.window.isVisible()');
const quickOpen = () =>
  main('!!__jj.panel.quickWindow && !__jj.panel.quickWindow.isDestroyed() && __jj.panel.quickWindow.isVisible()');
const chatOpen = () => main('!!__jj.chat.window && !__jj.chat.window.isDestroyed() && __jj.chat.window.isVisible()');
async function openPanel(tab = 'today') {
  if (!(await panelOpen())) await main('__jj.panel.togglePanel(); 1');
  await until('패널 열림', panelOpen);
  await main(`__jj.panel.openTab('${tab}'); 1`);
  const p = await page('panel');
  await until('패널 그려짐', async () => !!(await p.ev("!!document.querySelector('.tabs')")));
  await sleep(350);
  return p;
}
async function closePanel() {
  await main('(() => { const w = __jj.panel.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('패널 닫힘', async () => !(await panelOpen()));
  await sleep(250);
}
async function openQuick() {
  await main('__jj.panel.openQuick(); 1');
  await until('빠른 입력 열림', quickOpen);
  const q = await page('quick');
  await until('빠른 입력 그려짐', async () => !!(await q.ev("!!document.querySelector('.quick input')")));
  await sleep(300);
  return q;
}
async function closeQuick() {
  await main('(() => { const w = __jj.panel.quickWindow; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('빠른 입력 닫힘', async () => !(await quickOpen()));
  await sleep(250);
}
async function openChat() {
  if (!(await chatOpen())) await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await until('채팅 열림', chatOpen);
  const c = await page('chat');
  await until('채팅 그려짐', async () => !!(await c.ev("!!document.querySelector('textarea')")));
  await sleep(400);
  return c;
}
async function closeChat() {
  await main('(() => { const w = __jj.chat.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  await until('채팅 닫힘', async () => !(await chatOpen()));
  await sleep(300);
}
/** 디스크(데이터 폴더, HOME)에 이 글이 적힌 파일이 있나 */
function onDisk(needle) {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      try {
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else if (st.size < 8_000_000 && readFileSync(f).includes(needle)) hits.push(f);
      } catch {
        // 끊어진 링크(Singleton*) 등은 건너뛴다
      }
    }
  };
  walk(data);
  walk(home);
  return hits;
}
const overflow = (p, sel = '.card-window') =>
  p
    .ev(`(() => {
    const card = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    const out = [];
    for (const e of document.querySelectorAll('${sel} *')) {
      if (e.closest('svg') || e.classList.contains('grip') || e.closest('.sr-only')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(e);
      const clipped = cs.textOverflow === 'ellipsis';
      if (r.right > card.right + 1 && !e.closest('[hidden]')) out.push('밖:' + e.tagName + '.' + e.className);
      else if (!clipped && e.scrollWidth > e.clientWidth + 1 && cs.overflowX === 'visible' && e.clientWidth > 0) out.push('넘침:' + e.tagName + '.' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
    }
    const page = document.documentElement.scrollWidth > innerWidth + 1 ? ['쪽 가로 스크롤'] : [];
    return JSON.stringify([...new Set([...out, ...page])].slice(0, 8));
  })()`)
    .then((s) => JSON.parse(s));

const ko = LANG === 'ko';
const X = ko
  ? { more: '아래로', waitEnter: '기다리는 중이라', elapsed: /\d+초째/, minute: /1분 \d+초째/, notImage: '그림이 아니라', plus: '외 1개', renameFail: '이름을 바꾸지 못했어', recall: '↑' }
  : { more: 'Scroll down', waitEnter: 'Still waiting', elapsed: /Waiting \d+s/, minute: /Waiting 1m \d+s/, notImage: "isn't an image", plus: 'and 1 more', renameFail: "Couldn't rename", recall: '↑' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const setMode = (m) => writeFileSync(modeFile, m);
const COMPARE = process.env.COMPARE ?? '';
const SIZES = COMPARE ? [[400, 640]] : [[320, 520], [600, 760]];

async function ask(c, text) {
  await c.type('textarea', text);
  await c.ev("document.querySelector('button.primary:not([disabled])').click()");
}
const lastPet = "[...document.querySelectorAll('.msg.pet')].at(-1)";
const answered = (c, needle) => until(`답 ${needle}`, async () => (await c.ev(`(${lastPet}?.innerText ?? '').includes(${JSON.stringify(needle)})`)) === true, 20_000);
const geo = (c) =>
  c
    .ev(`(() => { const m = document.querySelector('.messages'); const a = ${lastPet}; const r = a.getBoundingClientRect(); const mr = m.getBoundingClientRect();
      return JSON.stringify({ top: Math.round(r.top - mr.top), h: Math.round(r.height), vh: m.clientHeight, gap: Math.round(m.scrollHeight - m.scrollTop - m.clientHeight), btn: document.querySelector('.new-below')?.innerText.replace(/\\s*↓$/, '').trim() ?? null }); })()`)
    .then(JSON.parse);
async function newChat(c) {
  const ok = await c.ev("(() => { const b = document.querySelector('button.new-chat'); if (!b || b.disabled) return false; b.click(); return true; })()");
  await until('새 대화', async () => (await c.ev("document.querySelectorAll('.msg').length")) === 0, 4000);
  return ok;
}
const noticeText = (c) => c.ev("[...document.querySelectorAll('footer .notice')].map((n) => n.textContent).join(' | ')");
const dropFiles = (c, files) =>
  c.ev(`(async () => { const dt = new DataTransfer(); for (const [n, t, b64] of ${JSON.stringify(files)}) dt.items.add(new File([b64 ? Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) : 'x'], n, { type: t }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
const clearInput = (c) => c.ev("(() => { const t = document.querySelector('textarea'); t.focus(); t.select(); document.execCommand('delete'); })()");

async function shots(c, name) {
  for (const dark of [false, true]) {
    await c.dark(dark);
    await sleep(150);
    await c.shot(`${name}-${dark ? 'dark' : 'light'}`);
    const over = (await overflow(c, 'body')).filter((x) => !x.startsWith('넘침:'));
    check(`${name} ${dark ? '어두움' : '밝음'} 가로 넘침 없음`, over.length === 0, over.join(', '));
  }
  await c.dark(false);
}

try {
  launch();
  await main('1');
  await sleep(2500);
  await until('앱 손잡이', async () => (await main('typeof __jj'))?.toString() === 'object', 60_000);
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await until('채팅 열림', chatOpen);
  const c = await page('chat');
  await until('채팅 그려짐', async () => !!(await c.ev("!!document.querySelector('textarea')")));
  await sleep(500);

  if (COMPARE) {
    // 전후 비교 그림 재료: 긴 답 자리, 기다리는 중, 답 아래 단추를 찍는다 (판정 없음)
    await main('__jj.chat.window.setSize(400, 640); 1');
    await sleep(400);
    setMode('ok');
    await ask(c, '짧게 답해 줘');
    await answered(c, '가짜 답');
    await sleep(500);
    await c.shot(`${COMPARE}-actions`);
    await newChat(c);
    setMode('long');
    await ask(c, '길게 답해 줘');
    await answered(c, '40번째');
    await sleep(1200);
    await c.shot(`${COMPARE}-long`);
    await newChat(c);
    setMode('slow');
    await ask(c, '오래 걸리는 질문');
    await sleep(11_500);
    await c.shot(`${COMPARE}-wait`);
    await c.ev('window.jjakkungChat.cancel()');
    await sleep(600);
  } else {
    for (const [w, h] of SIZES) {
      const tag = `${w}`;
      await main(`__jj.chat.window.setSize(${w}, ${h}); 1`);
      await sleep(500);
      console.log(`\n== 창 ${w}x${h} (${LANG}) ==`);
      await newChat(c);

      // ---- A. 긴 답 위치 ----
      setMode('long');
      await ask(c, `긴 답 시험 ${tag}`);
      await answered(c, '40번째');
      await sleep(1200);
      let g = await geo(c);
      check(`[${tag}] 한 번에 온 긴 답은 답 위쪽에 맞춘다`, g.top >= -2 && g.top <= 40, JSON.stringify(g));
      check(`[${tag}] 긴 답은 한 면보다 길고 아직 아래에 읽을 것이 남았다`, g.h > g.vh && g.gap > 100, JSON.stringify(g));
      check(`[${tag}] "${X.more}" 단추가 뜬다 ("새 메시지" 가 아니다)`, g.btn === X.more, String(g.btn));
      await shots(c, `u147-${tag}-long`);
      await c.ev("document.querySelector('.new-below').click()");
      await until('아래로', async () => (await geo(c)).gap <= 48, 4000);
      g = await geo(c);
      check(`[${tag}] 단추를 누르면 맨 아래로 가고 단추가 사라진다`, g.gap <= 48 && g.btn === null, JSON.stringify(g));
      // 위로 올려 둔 채 내가 새로 보내면 아래로(기존 동작)
      await c.ev("document.querySelector('.messages').scrollTop = 0");
      await sleep(250);
      setMode('ok');
      await ask(c, '짧은 이어 질문');
      await answered(c, '가짜 답');
      await sleep(500);
      g = await geo(c);
      check(`[${tag}] 내가 보내면 읽던 자리와 상관없이 아래로(기존 동작)`, g.gap <= 48 && g.btn === null, JSON.stringify(g));

      // ---- A2. 짧은 답은 그대로 아래 ----
      await newChat(c);
      await ask(c, `짧은 답 ${tag}`);
      await answered(c, '가짜 답');
      await sleep(500);
      g = await geo(c);
      check(`[${tag}] 짧은 답은 그대로 맨 아래, 단추 없음`, g.gap <= 2 && g.btn === null, JSON.stringify(g));

      // ---- A3. 스트리밍은 따라가고, 끝나도 위로 튀지 않는다 ----
      await newChat(c);
      setMode('stream');
      await ask(c, `스트리밍 ${tag}`);
      await sleep(2600);
      g = await geo(c);
      check(`[${tag}] 오는 중인 답은 맨 아래를 따라간다`, g.gap <= 48 && g.btn === null && g.top < 0, JSON.stringify(g));
      await answered(c, '40번째');
      await sleep(1200);
      g = await geo(c);
      check(`[${tag}] 조각으로 온 긴 답은 끝나도 아래에 머문다 (위로 튀지 않음)`, g.gap <= 48 && g.btn === null && g.top < 0, JSON.stringify(g));

      // ---- D. 답 아래 단추, F. ↑ 안내, 글자 크기 ----
      await newChat(c);
      setMode('ok');
      await ask(c, `단추 시험 하나 ${tag}`);
      await answered(c, '가짜 답');
      await ask(c, `단추 시험 둘 ${tag}`);
      await until('두 번째 답', async () => (await c.ev("document.querySelectorAll('.answer-actions').length")) === 2, 15_000);
      await sleep(400);
      const act = JSON.parse(
        await c.ev(`(() => {
          const lists = [...document.querySelectorAll('.answer-actions')];
          return JSON.stringify(lists.map((a) => {
            const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
            const next = a.parentElement.parentElement.nextElementSibling;
            const bubble = a.previousElementSibling;
            return { opacity: cs.opacity, fs: parseFloat(cs.fontSize), n: a.querySelectorAll('button').length,
              labels: [...a.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || ''),
              tabbable: [...a.querySelectorAll('button')].every((b) => b.tabIndex >= 0 && !b.disabled),
              inView: r.left >= 0 && r.right <= innerWidth,
              afterBubble: !!bubble && bubble.classList.contains('bubble'),
              overlapNext: next ? r.bottom > next.getBoundingClientRect().top + 0.5 : false };
          }));
        })()`),
      );
      check(`[${tag}] 답마다 단추 셋이 마우스 없이도 보인다 (투명하지 않다)`, act.length === 2 && act.every((a) => a.n === 3 && a.opacity === '1'), JSON.stringify(act.map((a) => a.opacity)));
      check(`[${tag}] 단추는 키보드로 닿고(Tab) 이름에 어느 답인지 들어 있다`, act.every((a) => a.tabbable && a.labels.every((l) => l.length > 6)), JSON.stringify(act[0].labels));
      check(`[${tag}] 단추는 답 말풍선 바로 뒤(Tab 순서)이고 창 안에 있다`, act.every((a) => a.afterBubble && a.inView));
      check(`[${tag}] 단추가 다음 메시지와 겹치지 않는다`, act.every((a) => !a.overlapNext));
      check(`[${tag}] 단추 글자는 12.5px 이상`, act.every((a) => a.fs >= 12.5), String(act[0].fs));
      await c.ev("document.querySelector('.answer-actions button').focus()");
      check(`[${tag}] 단추에 키보드 포커스가 간다`, (await c.ev("document.activeElement.closest('.answer-actions') !== null")) === true);
      await c.ev('document.activeElement.blur()');
      await shots(c, `u147-${tag}-actions`);
      const hint = await c.ev("document.querySelector('.recall-hint')?.textContent ?? ''");
      check(`[${tag}] 빈 입력칸에 ↑ 안내가 있다 (질문이 있을 때)`, hint.includes(X.recall), hint);
      const fonts = JSON.parse(await c.ev(`JSON.stringify({ who: parseFloat(getComputedStyle(document.querySelector('.who')).fontSize), recall: parseFloat(getComputedStyle(document.querySelector('.recall-hint')).fontSize), optwhy: 12 })`));
      check(`[${tag}] 보낸이 줄과 ↑ 안내 글자는 12px 이상`, fonts.who >= 12 && fonts.recall >= 12, JSON.stringify(fonts));
      await c.type('textarea', '쓰는 중');
      await sleep(200);
      check(`[${tag}] 글을 쓰기 시작하면 ↑ 안내가 사라진다`, !(await c.ev("!!document.querySelector('.recall-hint')")));
      await clearInput(c);
      await sleep(200);
      await c.press('ArrowUp', 38);
      await sleep(200);
      check(`[${tag}] 빈 칸에서 ↑ 를 누르면 마지막 질문이 돌아온다`, (await c.ev("document.querySelector('textarea').value")) === `단추 시험 둘 ${tag}`);
      await clearInput(c);

      // ---- B. 기다리는 동안 ----
      await newChat(c);
      setMode('slow');
      await ask(c, `기다림 시험 ${tag}`);
      await until('기다리는 중', async () => (await c.ev("!!document.querySelector('.thinking')")) === true, 6000);
      await sleep(2500);
      check(`[${tag}] 처음 몇 초는 경과 시간을 붙이지 않는다`, !(await c.ev("!!document.querySelector('.thinking .elapsed')")));
      await sleep(7000);
      const el1 = await c.ev("document.querySelector('.thinking .elapsed')?.textContent ?? ''");
      check(`[${tag}] 8초가 지나면 경과 시간을 보인다`, X.elapsed.test(el1), el1);
      check(`[${tag}] 매초 바뀌는 숫자는 화면 읽기에서 숨긴다`, (await c.ev("document.querySelector('.thinking .elapsed')?.getAttribute('aria-hidden')")) === 'true');
      const before = readFileSync(calls, 'utf8').trim().split('\n').length;
      await c.type('textarea', '기다리며 쓴 다음 질문');
      await c.press('Enter', 13);
      await sleep(400);
      const wn = await noticeText(c);
      check(`[${tag}] 기다리는 중 Enter 를 누르면 이유를 알려 준다`, wn.includes(X.waitEnter), wn);
      check(`[${tag}] 쓰던 글은 그대로 남고 새로 보내지지 않는다`, (await c.ev("document.querySelector('textarea').value")) === '기다리며 쓴 다음 질문' && readFileSync(calls, 'utf8').trim().split('\n').length === before);
      await shots(c, `u147-${tag}-wait`);
      if (w === SIZES[0][0] && !process.env.SKIP_MINUTE) {
        await sleep(50_000);
        const el2 = await c.ev("document.querySelector('.thinking .elapsed')?.textContent ?? ''");
        check(`[${tag}] 1분이 넘으면 분과 초로 보인다`, X.minute.test(el2), el2);
      }
      await c.ev('window.jjakkungChat.cancel()');
      await until('멈춤', async () => !(await c.ev("!!document.querySelector('.thinking')")), 8000);
      await sleep(400);
      check(`[${tag}] 답이 끝나면 Enter 안내가 거둬진다`, !(await noticeText(c)).includes(X.waitEnter));
      await clearInput(c);

      // ---- C. 그림이 아닌 파일 ----
      await newChat(c);
      await dropFiles(c, [['계획서.pdf', 'application/pdf']]);
      await sleep(300);
      let nt = await noticeText(c);
      check(`[${tag}] 그림이 아닌 파일을 놓으면 못 받는 이유를 알려 준다 (파일 이름 포함)`, nt.includes('계획서.pdf') && nt.includes(X.notImage), nt);
      check(`[${tag}] 그림으로는 붙지 않는다`, (await c.ev('document.querySelectorAll(".attachment").length')) === 0);
      await shots(c, `u147-${tag}-notimage`);
      await dropFiles(c, [['a.txt', 'text/plain'], ['b.zip', 'application/zip']]);
      await sleep(300);
      nt = await noticeText(c);
      check(`[${tag}] 여러 개면 개수까지 알린다`, nt.includes('a.txt') && nt.includes(X.plus), nt);
      await dropFiles(c, [['그림.png', 'image/png', PNG], ['메모.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]);
      await until('그림 붙음', async () => (await c.ev('document.querySelectorAll(".attachment").length')) === 1, 4000);
      nt = await noticeText(c);
      check(`[${tag}] 그림이 섞이면 그림은 붙이고 나머지는 이유를 알려 준다`, (await c.ev('document.querySelectorAll(".attachment").length')) === 1 && nt.includes('메모.docx'), nt);
      await c.ev(`(() => { const i = document.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File(['x'], '표.xlsx', { type: 'application/vnd.ms-excel' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(300);
      check(`[${tag}] 파일 고르기로 고른 그림 아닌 파일도 안내`, (await noticeText(c)).includes('표.xlsx'), await noticeText(c));
      await c.ev(`(() => { const t = document.querySelector('textarea'); const dt = new DataTransfer(); dt.items.add(new File(['x'], '붙임.pdf', { type: 'application/pdf' })); t.focus(); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
      await sleep(300);
      check(`[${tag}] 파일을 붙여 넣어도 안내`, (await noticeText(c)).includes('붙임.pdf'), await noticeText(c));
      await c.ev("document.querySelectorAll('.attachment button').forEach((b) => b.click())");
      setMode('ok');

      // ---- E. 지난 대화 이름 바꾸기 ----
      await newChat(c);
      await ask(c, `RENAME-A 질문 ${tag}`);
      await answered(c, '가짜 답');
      await newChat(c);
      await ask(c, `RENAME-B 질문 ${tag}`);
      await answered(c, '가짜 답');
      await sleep(400);
      await c.ev("document.querySelector('header .icon-btn').click()");
      await until('목록 열림', async () => (await c.ev("document.querySelectorAll('.thread').length")) >= 2, 5000);
      const idA = await c.ev(`window.jjakkungChat.threads('').then((l) => l.threads.find((t) => (t.title || '').includes('RENAME-A 질문 ${tag}'))?.id)`);
      check(`[${tag}] 시험용 지난 대화를 찾았다`, !!idA);
      const renameBtn = (key) => `[...document.querySelectorAll('.thread')].find((li) => li.innerText.includes('${key}')).querySelector('button[aria-label*="${ko ? '이름 바꾸기' : 'Rename'}"]').click()`;
      const retype = (s) => `(() => { const i = document.querySelector('.rename input'); i.focus(); i.select(); document.execCommand('insertText', false, '${s}'); })()`;
      await c.ev(renameBtn(`RENAME-B 질문 ${tag}`));
      await sleep(200);
      await c.ev(retype('바꾼 이름 BBB'));
      await c.ev("document.querySelector('.rename').requestSubmit()");
      await until('이름 바뀜', async () => (await c.ev("document.body.innerText.includes('바꾼 이름 BBB')")) === true, 4000);
      check(`[${tag}] 이름 바꾸기 성공은 목록에 반영되고 실패 안내가 없다`, (await c.ev("document.body.innerText.includes('바꾼 이름 BBB')")) && !(await c.ev("!!document.querySelector('.chat-list [role=alert]')")));
      await c.ev(renameBtn(`RENAME-A 질문 ${tag}`));
      await sleep(200);
      await c.ev(`window.jjakkungChat.deleteThread(${JSON.stringify(idA)})`);
      await c.ev(retype('실패할 새 이름'));
      await c.ev("document.querySelector('.rename').requestSubmit()");
      await until('실패 안내', async () => (await c.ev("!!document.querySelector('.chat-list [role=alert]')")) === true, 4000);
      const rf = await c.ev("document.querySelector('.chat-list [role=alert]')?.textContent ?? ''");
      check(`[${tag}] 이름 바꾸기가 실패하면 화면에 이유를 알린다`, rf.includes(X.renameFail), rf);
      await shots(c, `u147-${tag}-renamefail`);
      await until('안내 걷힘', async () => !(await c.ev("!!document.querySelector('.chat-list [role=alert]')")), 9000);
      check(`[${tag}] 실패 안내는 잠깐 보이고 걷힌다`, !(await c.ev("!!document.querySelector('.chat-list [role=alert]')")));
      await c.ev("[...document.querySelectorAll('.sheet-head button')].at(-1).click()");
      await sleep(300);
    }
    // ---- 버그 사냥 뒤 보강 (PR #177) ----
    await main('__jj.chat.window.setSize(320, 520); 1');
    await sleep(500);
    console.log(`\n== 보강 시나리오 (${LANG}) ==`);
    await newChat(c);

    // 빈 칸 Enter 안내에는 "쓴 글은 그대로" 가 없다. 글이 있으면 있다
    setMode('slow');
    await ask(c, '보강 대기 시험');
    await until('기다리는 중', async () => (await c.ev("!!document.querySelector('.thinking')")) === true, 6000);
    await sleep(2200);
    await c.ev('document.querySelector("textarea").focus()');
    await c.press('Enter', 13);
    await sleep(300);
    let wn = await noticeText(c);
    const keptWord = ko ? '쓴 글은 그대로' : 'still there';
    check('빈 칸 Enter 안내에는 쓴 글 문구가 없다', wn.length > 0 && !wn.includes(keptWord), wn);
    await c.type('textarea', '쓰던 글');
    await c.press('Enter', 13);
    await sleep(300);
    wn = await noticeText(c);
    check('글이 있을 때 Enter 안내에는 쓴 글이 그대로라는 말이 있다', wn.includes(keptWord), wn);
    await clearInput(c);

    // 창을 닫았다 열어도 경과가 이어진다 (기다리기 시작한 시각을 메인 상태에 둠)
    await sleep(9000);
    const e1 = await c.ev("document.querySelector('.thinking .elapsed')?.textContent ?? ''");
    await closeChat();
    await sleep(500);
    await main('__jj.chat.open(__jj.pet.bounds()); 1');
    await until('채팅 열림', chatOpen);
    const c2 = await page('chat');
    await until('채팅 그려짐', async () => !!(await c2.ev("!!document.querySelector('textarea')")));
    await sleep(1500);
    const e2 = await c2.ev("document.querySelector('.thinking .elapsed')?.textContent ?? ''");
    const n1 = Number((e1.match(/\d+/) ?? [0])[0]);
    const n2 = Number((e2.match(/\d+/) ?? [0])[0]);
    check('창을 닫았다 열어도 경과 시간이 0 부터 다시 세지 않는다', n1 >= 8 && n2 >= n1, `${e1} -> ${e2}`);
    await c2.ev('window.jjakkungChat.cancel()');
    await until('멈춤', async () => !(await c2.ev("!!document.querySelector('.thinking')")), 8000);
    await sleep(300);
    setMode('ok');
    await newChat(c2);

    // 긴 파일 이름은 안내가 창 밖으로 나가지 않는다 (en 은 복수형)
    await dropFiles(c2, [['a'.repeat(120) + '.pdf', 'application/pdf']]);
    await sleep(300);
    const ov = JSON.parse(await c2.ev(`(() => { const n = document.querySelector('footer .notice'); const r = n.getBoundingClientRect(); return JSON.stringify({ right: Math.round(r.right), sw: n.scrollWidth, cw: n.clientWidth, iw: innerWidth, doc: document.documentElement.scrollWidth }); })()`));
    check('긴 파일 이름 안내가 폭 320 안에 있다', ov.sw <= ov.cw + 1 && ov.right <= ov.iw && ov.doc <= ov.iw, JSON.stringify(ov));
    await dropFiles(c2, [['a.txt', 'text/plain'], ['b.zip', 'application/zip']]);
    await sleep(300);
    const plural = await noticeText(c2);
    check('여러 파일 안내 문장이 복수형에 맞다', ko ? plural.includes('외 1개') : plural.includes("they aren't images"), plural);

    // 그림 다섯 장과 pdf 를 함께: 두 안내가 모두 남는다. 이어서 정상 그림만 놓으면 지난 안내가 거둬진다
    await dropFiles(c2, [['x.pdf', 'application/pdf'], ...Array.from({ length: 5 }, (_, i) => [`g${i}.png`, 'image/png', PNG])]);
    await sleep(700);
    const both = await noticeText(c2);
    check('그림 다섯 장과 pdf 를 함께 놓으면 pdf 안내와 장수 안내가 모두 남는다', both.includes('x.pdf') && both.includes('4'), both);
    for (let i = 0; i < 6; i++) {
      await c2.ev("document.querySelector('.attachment button')?.click()");
      await sleep(80);
    }
    await dropFiles(c2, [['정상.png', 'image/png', PNG]]);
    await sleep(600);
    check('정상으로 그림이 붙으면 지난 안내가 거둬진다', (await noticeText(c2)) === '' && (await c2.ev('document.querySelectorAll(".attachment").length')) === 1, await noticeText(c2));
    await c2.ev("document.querySelectorAll('.attachment button').forEach((b) => b.click())");

    // 이름 바꾸기 저장이 디스크 오류면: 안내가 뜨고 메모리 목록도 옛 이름
    await ask(c2, 'RENAME-Z 질문');
    await answered(c2, '가짜 답');
    await newChat(c2);
    await ask(c2, 'RENAME-W 질문');
    await answered(c2, '가짜 답');
    await sleep(400);
    await c2.ev("document.querySelector('header .icon-btn').click()");
    await until('목록 열림', async () => (await c2.ev("document.querySelectorAll('.thread').length")) >= 2, 5000);
    await c2.ev(`[...document.querySelectorAll('.thread')].find((li) => li.innerText.includes('RENAME-Z')).querySelector('button[aria-label*="${ko ? '이름 바꾸기' : 'Rename'}"]').click()`);
    await sleep(200);
    await c2.ev("(() => { const i = document.querySelector('.rename input'); i.focus(); i.select(); document.execCommand('insertText', false, '저장실패이름'); })()");
    chmodSync(data, 0o500);
    await c2.ev("document.querySelector('.rename').requestSubmit()");
    await sleep(1500);
    chmodSync(data, 0o700);
    const alertText = await c2.ev("document.querySelector('.chat-list [role=alert]')?.textContent ?? ''");
    const mem = await c2.ev("window.jjakkungChat.threads('').then((l) => l.threads.some((t) => t.title === '저장실패이름'))");
    check('디스크 오류로 이름 저장이 실패하면 화면에 안내', alertText.includes(X.renameFail), alertText);
    check('저장이 실패하면 메모리 목록도 옛 이름 그대로', mem === false);
    await c2.ev("[...document.querySelectorAll('.sheet-head button')].at(-1).click()");
    await sleep(300);

    // 긴 답을 위쪽에 맞춘 뒤 창을 키워도 답 위쪽을 지킨다
    await newChat(c2);
    setMode('long');
    await ask(c2, '긴 답 뒤 창 키우기');
    await answered(c2, '40번째');
    await sleep(800);
    await main('__jj.chat.window.setSize(600, 900); 1');
    await sleep(900);
    const g7 = await geo(c2);
    check('긴 답을 위쪽에 맞춘 뒤 창을 키워도 답 위쪽이 유지된다', g7.top >= -2 && g7.top <= 40 && g7.btn === X.more, JSON.stringify(g7));
    setMode('ok');
    await main('__jj.chat.window.setSize(400, 640); 1');
  }
} catch (err) {
  console.error('시험 중 오류', err);
  fails.push(`오류: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await quit();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n통과 ${pass}, 실패 ${fails.length}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
