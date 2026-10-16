// PR #131 (이슈 #126) 추가 QA: 설정 창의 탭마다 문서 높이가 창 높이와 같은지(전체 스크롤이 생겨 머리가 밀려 나가지 않는지) 본다.
//
//   npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/root-scroll-probe.mjs
//
// 진짜 AI 는 부르지 않는다(가짜 CLI). 클립보드 쓰기와 외부 열기는 메인에서 바꿔 끼워 사용자 클립보드, 브라우저를 건드리지 않는다.
// JJ_NO_FOCUS=1, 빈 JJ_USER_DATA, JJ_TEST_SECRETS=memory, CDP 입력만, 끝나면 임시 폴더를 지운다.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, hostname, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-126-ui');
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
const INSPECT = await freePort();
const PAGE = await freePort();
const DEAD = await freePort(); // 서버 주소: 아무도 듣지 않는 포트

const tmp = mkdtempSync(join(tmpdir(), 'fairy-ai-ui-'));
const data = join(tmp, 'data');
const home = join(tmp, 'home');
const bin = join(tmp, 'bin');
const codexHome = join(tmp, 'codex-home');
const calls = join(tmp, 'calls.jsonl');
for (const d of [data, home, bin, codexHome, join(data, 'logs')]) mkdirSync(d, { recursive: true });
writeFileSync(calls, '');
writeFileSync(join(codexHome, 'auth.json'), '{"tokens":{}}');
writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-test"\n');
function fake(name, body) {
  const file = join(bin, name);
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
const done = (extra = {}) => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ bin: ${JSON.stringify(name)}, argv, ...extra }) + '\\n');
${body}
`,
  );
  chmodSync(file, 0o755);
}
fake('claude', `
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: false })); process.exit(0); }
if (argv[0] === 'mcp') { console.log(''); process.exit(0); }
done(); console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x' }));`);
fake('codex', `
if (argv[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
if (argv[0] === 'login') { console.log('Logged in'); process.exit(0); }
done();`);
fake('gemini', `
if (argv[0] === '--version') { console.log('0.99.0'); process.exit(0); }
done();`);
// cursor 는 없다 (없어 상태)

const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV, codexHome }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
const ICS = 'https://calendar.example.org/private-abc123/basic.ics';
const MEMORY = '고양이 이름은 두부리안';
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, icsUrl: ICS, petMemory: [MEMORY], updateCheck: false }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));

// 더 많은 가짜 비밀 (모양만)
const REAL_USER = userInfo().username;
const HOST = hostname();
const FAKE = {
  stripe: 'sk_live_51Habcdefghijklmnop1234',
  npm: 'npm_abcdefghijklmnopqrstuvwxyz0123456789',
  notion: 'ntn_abcdefghijklmnopqrstuvwxyz0123456789AB',
  supa: 'sbp_abcdef0123456789abcdef0123456789abcdef',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  bearer: 'Bearer abcDEF123456ghiJKL',
  pass: 'hunter2hunter2',
  ip: '203.0.113.77',
  phone: '010-2345-6789',
  rrn: '900101-1234567',
  slack: 'xoxb-1234567890-abcdefghij',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  fd: `fd_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6nP9rS2u'}`,
  mail: 'qa.tester+fairy@example.co.kr',
  
};
const TODO = '병원 결과 받으러 가기 시험';
const STEP = '보험 서류 챙기기 시험';
const NOTE = '비밀 메모 제목 시험';
const EVENT = '면접 일정 시험용 회사';
const CHAT1 = '이건 시험용 대화 글이야 아무도 보면 안 돼';
const CHAT2 = 'second chat line\nwith a newline QA-ZEBRA';
const CHAT_OLD = '아주 오래된 대화 글 시험 61번째 전';
const CHAT_PART = '긴 대화 글의 앞부분만 기록에 남은 경우를 본다 시험용 문장';
writeFileSync(
  join(data, 'logs', 'main.log'),
  [
    `2026-10-15T09:00:01.000Z [boot] /Users/${REAL_USER}/Library/x host ${HOST}`,
    `2026-10-15T09:00:02.000Z [pay] stripe ${FAKE.stripe} npm ${FAKE.npm}`,
    `2026-10-15T09:00:03.000Z [mcp] notion ${FAKE.notion} supabase ${FAKE.supa}`,
    `2026-10-15T09:00:04.000Z [http] Authorization: ${FAKE.bearer} jwt ${FAKE.jwt}`,
    `2026-10-15T09:00:05.000Z [x] password=${FAKE.pass} from ${FAKE.ip} tel ${FAKE.phone} rrn ${FAKE.rrn}`,
    `2026-10-15T09:00:06.000Z [x] slack ${FAKE.slack} aws ${FAKE.aws} device ${FAKE.fd}`,
    `2026-10-15T09:00:07.000Z [x] mail ${FAKE.mail}`,
    `2026-10-15T09:00:08.000Z [todo] ${TODO} / ${STEP}`,
    `2026-10-15T09:00:09.000Z [note] ${NOTE} [event] ${EVENT}`,
    `2026-10-15T09:00:10.000Z [gcal] ics ${ICS} memory ${MEMORY}`,
    `2026-10-15T09:00:11.000Z [chat] "${CHAT1}" "${CHAT2.replace('\n', ' ')}"`,
    `2026-10-15T09:00:12.000Z [chat] old "${CHAT_OLD}"`,
    `2026-10-15T09:00:13.000Z [chat] cut "${CHAT_PART.slice(0, 18)}"`,
    `2026-10-15T09:00:14.000Z [server] http://127.0.0.1:${DEAD}/v1/me 실패`,
    '',
  ].join('\n'),
);

const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: PATH_ENV,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_TEST_SECRETS: 'memory',
    JJ_SERVER_URL_OVERRIDE: `http://127.0.0.1:${DEAD}`,
    CODEX_HOME: codexHome,
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'lang', LANG, 'inspect', INSPECT, 'page', PAGE, 'tmp', tmp);
let finished = false;
const cleanup = () => {
  try { app.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { app.kill('SIGKILL'); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }, 1500).unref();
};
process.on('exit', () => { if (!finished) cleanup(); });

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}, ms = 60_000) =>
    new Promise((r, j) => {
      const i = ++id;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) { clearTimeout(timer); ws.removeEventListener('message', h); r(m); }
      };
      const timer = setTimeout(() => { ws.removeEventListener('message', h); j(new Error(`CDP 답 없음: ${method}`)); }, ms);
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send, on: (f) => listeners.push(f) };
}
let mainConn;
async function main(expr) {
  for (let i = 0; i < 160 && !mainConn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      mainConn = await connect(t.webSocketDebuggerUrl);
    } catch { await sleep(250); }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const openPages = [];
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        openPages.push(c);
        const ev = async (expr) => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
        return {
          ev, send: c.send, on: c.on,
          shot: async (file, full = false) => {
            await sleep(300);
            const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          click: async (selector, text) => {
            const pt = await ev(`(() => {
              const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
              const el = ${text === undefined ? 'els[0]' : `els.find((e) => e.innerText.includes(${JSON.stringify(text)}))`};
              if (!el) return null;
              el.scrollIntoView({ block: 'center' });
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
            })()`);
            if (!pt) throw new Error(`누를 것이 없음: ${selector} ${text ?? ''}`);
            await sleep(150);
            for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
              await c.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
          },
          keyCdp: async (key, code, keyCode, modifiers) => {
            for (const type of ['rawKeyDown', 'keyUp'])
              await c.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
          },
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(200); }
  throw new Error(`기다림 끝: ${what}`);
}
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra: ok ? '' : String(extra).slice(0, 600) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !extra ? '' : ` (${String(extra).slice(0, 600)})`}`);
}
const readCalls = () => readFileSync(calls, 'utf8').split('\n').filter(Boolean);

// 화면 글 검사: 영어판 한글, 줄표, 가로 넘침, 잘린 글
const layoutProbe = (scope) => `(() => {
  const roots = [...document.querySelectorAll(${JSON.stringify(scope)})];
  const out = { over: [], clipped: [], hangul: [], dash: [] };
  for (const r of roots) for (const e of [r, ...r.querySelectorAll('*')]) {
    const b = e.getBoundingClientRect();
    if (b.width <= 2 || b.height <= 2) continue;
    if (b.right > innerWidth + 1 || b.left < -1) out.over.push(e.tagName + '.' + e.className + ':' + Math.round(b.right));
    const cs = getComputedStyle(e);
    if (e.tagName !== 'TEXTAREA' && (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 1 && e.innerText) out.clipped.push(e.tagName + '.' + e.className + ':' + e.innerText.slice(0, 40));
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    if (/[\\uac00-\\ud7a3]/.test(own)) out.hangul.push(own.trim().slice(0, 50));
    if (/\\u2014/.test(own)) out.dash.push(own.trim().slice(0, 50));
  }
  return JSON.stringify(out);
})()`;
async function inspect(pg, label, scope) {
  const r = JSON.parse(await pg.ev(layoutProbe(scope)));
  check(`${label}: 가로 넘침 없음`, r.over.length === 0, JSON.stringify(r.over));
  check(`${label}: 잘린 글 없음`, r.clipped.length === 0, JSON.stringify(r.clipped));
  check(`${label}: 줄표(—) 없음`, r.dash.length === 0, JSON.stringify(r.dash));
  if (LANG === 'en') check(`${label}: 영어판에 한글 없음`, r.hangul.length === 0, JSON.stringify(r.hangul));
  const docOver = await pg.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(`${label}: 문서 가로 스크롤 없음`, docOver <= 0, String(docOver));
}
const dark = (pg, on) => pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] });

// ---- 시작 ----
await until('앱 손잡이', async () => (await main('typeof __jj !== "undefined" && typeof __jj.chat'))?.toString() === 'object', 90_000);
await sleep(2500);
await main('__jj.settingsWindow.open(); 1');
const st = await page('settings');
await until('설정 창', async () => (await st.ev(`!!document.querySelector('[role=tab]')`)) === true, 30_000);
const tabs = JSON.parse(await st.ev(`JSON.stringify([...document.querySelectorAll('[role=tab]')].map((t) => t.innerText))`));
for (const tab of tabs) {
  await st.click('[role=tab]', tab);
  await sleep(1500);
  await st.ev('document.scrollingElement.scrollTop = 0; 1');
  for (let i = 0; i < 5; i++) await st.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 60, deltaX: 0, deltaY: 400 });
  await sleep(500);
  if (tab === 'AI') { const r = await st.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, 'ui-root-scroll-bug-ai-ko.png'), Buffer.from(r.result.data, 'base64')); }
  console.log('TAB', tab, await st.ev(`JSON.stringify({ sh: document.scrollingElement.scrollHeight, ih: innerHeight, topAfterWheelOnHeader: document.scrollingElement.scrollTop })`));
}
finished = true;
for (const c of openPages) c.ws.close();
mainConn?.ws.close();
cleanup();
await sleep(2000);
process.exit(0);
