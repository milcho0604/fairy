// PR #131 (이슈 #126) 추가 QA: 화면 모양(ko/en, 밝음/어두움, 기본/좁은 폭), 더 많은 가짜 비밀 가리기,
// 사용자가 누르기 전에는 아무것도 나가지 않음(네트워크, 클립보드, 외부 열기, AI 질문 0건).
//
//   npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/ai-safety-ui.mjs
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

// 감시 장치: 메인의 fetch, net, http(s), 클립보드, 외부 열기, 브라우저 세션 요청
await main(`(() => {
  const req = process.mainModule ? process.mainModule.require.bind(process.mainModule) : require;
  const e = req('electron');
  const q = (globalThis.__qa = { net: [], clip: [], open: [] });
  const of = globalThis.fetch;
  globalThis.fetch = (u, o) => { q.net.push('fetch ' + String(u?.url ?? u)); return of(u, o); };
  const onf = e.net.fetch.bind(e.net);
  try { e.net.fetch = (u, o) => { q.net.push('net.fetch ' + String(u?.url ?? u)); return onf(u, o); }; } catch {}
  const onr = e.net.request.bind(e.net);
  try { e.net.request = (o) => { q.net.push('net.request ' + JSON.stringify(o).slice(0, 120)); return onr(o); }; } catch {}
  for (const m of ['http', 'https']) {
    const mod = req(m);
    const r0 = mod.request, g0 = mod.get;
    mod.request = function (...a) { q.net.push(m + '.request ' + String(a[0]?.href ?? a[0]?.host ?? a[0]).slice(0, 120)); return r0.apply(this, a); };
    mod.get = function (...a) { q.net.push(m + '.get ' + String(a[0]?.href ?? a[0]?.host ?? a[0]).slice(0, 120)); return g0.apply(this, a); };
  }
  e.clipboard.writeText = (t) => { q.clip.push(t); };
  e.shell.openExternal = async (u) => { q.open.push(u); };
  e.session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    if (!/^(file|devtools|data|blob|chrome|jj-model):/.test(d.url)) q.net.push('web ' + d.url);
    cb({});
  });
  return 1;
})()`);
const qa = async () => JSON.parse(await main('JSON.stringify(__qa)'));
const resetQa = () => main('__qa.net.length = 0; __qa.clip.length = 0; __qa.open.length = 0; 1');

// 상태 준비 (손잡이): 할 일+단계, 메모, 일정, 대화
await main(`(() => { const t = __jj.store.add({ title: ${JSON.stringify(TODO)} }, Date.now()); try { __jj.store.addStep?.(t.id, ${JSON.stringify(STEP)}, Date.now()); } catch {} return 1; })()`);
await main(`__jj.notes.add({ title: ${JSON.stringify(NOTE)}, body: 'b' }, Date.now()); 1`);
await main(`__jj.events.add({ title: ${JSON.stringify(EVENT)}, startAt: Date.now() + 86400000 }, Date.now()); 1`);
await main(`__jj.chat.debugSetState((s) => ({ ...s, messages: [
  { id: 'old', role: 'user', text: ${JSON.stringify(CHAT_OLD)} },
  ...Array.from({ length: 60 }, (_, i) => ({ id: 'f' + i, role: i % 2 ? 'assistant' : 'user', text: 'filler ' + i })),
  { id: 'c1', role: 'user', text: ${JSON.stringify(CHAT1)} },
  { id: 'c2', role: 'assistant', text: ${JSON.stringify(CHAT2)} },
  { id: 'c3', role: 'user', text: ${JSON.stringify(CHAT_PART)} },
] })); 1`);
const stepOk = await main(`JSON.stringify(__jj.store.list(Date.now()).open.flatMap((x) => x.steps.map((s) => s.title)))`);

// =============== 시작 안내 ===============
await main('__jj.onboarding.open(); 1');
const onb = await page('onboarding');
await until('시작 안내', async () => (await onb.ev(`!!document.querySelector('footer .primary')`)) === true, 30_000);
for (let i = 0; i < 2; i++) { await onb.click('footer .primary'); await sleep(300); }
await until('찾은 AI 표', async () => (await onb.ev(`document.querySelectorAll('.ai-found li').length`)) === 5, 40_000);
const onbRows = JSON.parse(await onb.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.ai-found li')].map((l) => [l.dataset.ai, l.dataset.state])))`));
check('시작 안내: claude 로그인 필요, cursor 없어', onbRows.claude === 'login' && onbRows.cursor === 'missing' && onbRows.codex === 'found', JSON.stringify(onbRows));
for (const d of [false, true]) {
  await dark(onb, d);
  await inspect(onb, `시작 안내(${d ? '어두움' : '밝음'})`, 'main');
  await onb.shot(`ui-onboarding-ai-${d ? 'dark' : 'light'}`);
}
await dark(onb, false);
await main('__jj.onboarding.window?.close(); 1');
await sleep(500);
check('감지만으로 AI 질문 0건 (시작 안내)', readCalls().length === 0, readCalls().join('\n'));

// =============== 설정 AI 탭 ===============
await main('__jj.settingsWindow.open(); 1');
const st = await page('settings');
await until('설정 창', async () => (await st.ev(`!!document.querySelector('[role=tab]')`)) === true, 30_000);
const netLog = [];
await st.send('Network.enable');
st.on((m) => {
  if (m.method === 'Network.requestWillBeSent' && !/^(file|devtools|data|blob|chrome|jj-model):/.test(m.params.request.url)) netLog.push(m.params.request.url);
});
await st.click('[role=tab]', 'AI');
await until('능력표', async () => (await st.ev(`document.querySelectorAll('.ai-cap[data-state]:not([data-state=checking])').length`)) === 5, 40_000);
const caps = JSON.parse(await st.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.ai-cap')].map((l) => [l.dataset.ai, [l.dataset.state, l.innerText.replace(/\\s+/g, ' ')]])))`));
check('AI 탭: claude 로그인 필요 표시', caps.claude[0] === 'login', JSON.stringify(caps.claude));
check('AI 탭: cursor 없어 표시', caps.cursor[0] === 'missing', JSON.stringify(caps.cursor));
for (const [w, wl] of [[440, '기본'], [360, '좁음']]) {
  await main(`__jj.settingsWindow.window.setSize(${w}, 760); 1`);
  await sleep(500);
  const iw = await st.ev('innerWidth');
  for (const d of [false, true]) {
    await dark(st, d);
    await st.ev(`document.querySelector('.ai-caps').scrollIntoView({ block: 'start' })`);
    console.log('INFO root scroll', w, d, await st.ev(`JSON.stringify({ top: document.scrollingElement.scrollTop, sh: document.scrollingElement.scrollHeight, ih: innerHeight, header: Math.round(document.querySelector('[role=tablist]').getBoundingClientRect().top), ov: getComputedStyle(document.documentElement).overflowY + '/' + getComputedStyle(document.body).overflowY })`));
    await inspect(st, `AI 탭 ${wl}폭(${iw}px, ${d ? '어두움' : '밝음'})`, '.ai-caps');
    await st.shot(`ui-settings-ai-${w}-${d ? 'dark' : 'light'}`);
  }
}
await dark(st, false);
await main(`__jj.settingsWindow.window.setSize(440, 760); 1`);
// 다시 찾기 (화면 단추): gemini 를 지웠다 되살림
const gem = join(bin, 'gemini');
const gemSrc = readFileSync(gem);
rmSync(gem);
await st.click('button', LANG === 'ko' ? '다시 찾기' : 'Look again');
await until('gemini 없어', async () => (await st.ev(`document.querySelector('.ai-cap[data-ai=gemini]')?.dataset.state`)) === 'missing', 30_000).catch(() => {});
check('다시 찾기: 지운 gemini 는 없어', (await st.ev(`document.querySelector('.ai-cap[data-ai=gemini]')?.dataset.state`)) === 'missing');
writeFileSync(gem, gemSrc);
chmodSync(gem, 0o755);
await st.click('button', LANG === 'ko' ? '다시 찾기' : 'Look again');
await until('gemini 다시', async () => (await st.ev(`document.querySelector('.ai-cap[data-ai=gemini]')?.dataset.state`)) === 'found-unchecked', 30_000).catch(() => {});
check('다시 찾기: 되살린 gemini 는 찾았어(로그인 모름)', (await st.ev(`document.querySelector('.ai-cap[data-ai=gemini]')?.dataset.state`)) === 'found-unchecked');
check('감지, 다시 찾기만으로 AI 질문 0건', readCalls().length === 0, readCalls().join('\n'));

// =============== 정보 탭: 도움 보내기 ===============
await st.click('[role=tab]', LANG === 'ko' ? '정보' : 'About');
await sleep(500);
await resetQa();
netLog.length = 0;
for (const [w, wl] of [[440, '기본'], [360, '좁음']]) {
  await main(`__jj.settingsWindow.window.setSize(${w}, 760); 1`);
  await sleep(500);
  for (const d of [false, true]) {
    await dark(st, d);
    await st.ev(`document.querySelector('#help-open').scrollIntoView({ block: 'center' })`);
    await inspect(st, `도움 보내기 칸 ${wl}폭(${d ? '어두움' : '밝음'})`, '.help-box');
    await st.shot(`ui-about-help-${w}-${d ? 'dark' : 'light'}`);
  }
}
await dark(st, false);
check('정보 탭을 보기만 해서는 아무것도 나가지 않음', (await qa()).net.length + (await qa()).clip.length + (await qa()).open.length + netLog.length === 0, JSON.stringify({ ...(await qa()), netLog }));

// 서버 켬 상태를 바꿔 끼운다 (닉네임, 기기 코드). 머리에 닉네임은 없고 기기 코드만 있어야 한다
const NICK = 'QA닉네임쿠쿠';
const serverPatched = await main(`(() => {
  const core = __jj.server?.core;
  if (!core?.status) return false;
  const s0 = core.status.bind(core);
  core.status = () => ({ ...s0(), on: true, device: true, signedIn: true, nickname: ${JSON.stringify(NICK)}, code: 'F-QAQA-2345', lastSyncAt: Date.now() - 120000, ai: true, pending: 2 });
  return true;
})()`);
check('준비: 서버 켬 상태 바꿔 끼움', serverPatched === true);

// 단추 클릭 -> 미리 보기
await main(`__jj.settingsWindow.window.setSize(440, 760); 1`);
await sleep(400);
const previewText = () => st.ev(`document.querySelector('#help-preview')?.value ?? null`);
await st.click('#help-open');
await until('미리 보기', async () => !!(await previewText()), 30_000);
const text = await previewText();
const secretsList = { ...FAKE, TODO, NOTE, EVENT, ICS, MEMORY, CHAT1, CHAT2a: 'QA-ZEBRA', REAL_USER, HOST };
if (stepOk.includes(STEP)) secretsList.STEP = STEP;
const leaks = Object.entries(secretsList).filter(([, v]) => v && text.includes(v)).map(([k]) => k);
check('미리 보기: 심은 비밀, 할 일, 단계, 메모, 일정, ICS, 기억, 대화, 사용자 이름, 컴퓨터 이름 모두 가려짐', leaks.length === 0, JSON.stringify(leaks));
check('[참고] 미리 보기: 61개 전 대화 글(가리기 범위 밖)', !text.includes(CHAT_OLD), 'CHAT_OLD 노출 (최근 60개만 가린다)');
check('[참고] 미리 보기: 기록에 앞부분만 남은 대화 글', !text.includes(CHAT_PART.slice(0, 18)), '부분 대화 글 노출 (글자 그대로 전체 일치만 가린다)');
const head = text.split('\n').slice(0, 12).join('\n');
check('미리 보기 머리: 서버 줄이 있고 주소, 포트는 없다', /server|서버/i.test(head) && !head.includes(String(DEAD)), head);
check('미리 보기 머리: 서버 켬 줄, 기기 코드 있음, 닉네임 없음', head.includes('F-QAQA-2345') && !text.includes(NICK) && /pending|보내지|2/.test(head), head);
if (LANG === 'en') check('미리 보기 머리: 영어판에 한글 없음', !/[가-힣]/.test(head), head);
check('미리 보기: 줄표(—) 없음 (머리)', !head.includes('—'), head);
writeFileSync(join(OUT, `ui-preview-${LANG}.txt`), text);
let q = await qa();
check('미리 보기 열기만으로 네트워크, 클립보드, 외부 열기 0건', q.net.length + q.clip.length + q.open.length + netLog.length === 0, JSON.stringify({ ...q, netLog }));
for (const [w, wl] of [[440, '기본'], [360, '좁음']]) {
  await main(`__jj.settingsWindow.window.setSize(${w}, 760); 1`);
  await sleep(500);
  for (const d of [false, true]) {
    await dark(st, d);
    await inspect(st, `미리 보기 창 ${wl}폭(${d ? '어두움' : '밝음'})`, '.help-dialog > :not(.feedback-preview)');
    const fits = await st.ev(`(() => { const b = document.querySelector('.help-dialog').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1; })()`);
    check(`미리 보기 창 ${wl}폭: 창 안에 들어감`, fits === true);
    await st.shot(`ui-help-dialog-${w}-${d ? 'dark' : 'light'}`);
  }
}
await dark(st, false);
// 낮은 창 (최소 높이 420)
await main(`__jj.settingsWindow.window.setSize(360, 420); 1`);
await sleep(500);
const lowFit = await st.ev(`(() => { const d = document.querySelector('.help-dialog'); const b = d.getBoundingClientRect(); const btn = document.querySelector('#help-close').getBoundingClientRect(); return JSON.stringify({ top: b.top, bottom: b.bottom, ih: innerHeight, btnBottom: btn.bottom, scroll: d.scrollHeight > d.clientHeight }); })()`);
const lf = JSON.parse(lowFit);
check('최소 창(360x420): 닫기 단추가 보이거나 창 안에서 스크롤로 닿음', lf.btnBottom <= lf.ih + 1 || lf.scroll, lowFit);
await st.shot('ui-help-dialog-360x420-light');
await main(`__jj.settingsWindow.window.setSize(440, 760); 1`);
await sleep(400);

// 복사 (화면 단추) -> 클립보드 한 번, 글은 미리 본 것과 같다
await st.click('#help-copy');
await until('복사', async () => (await qa()).clip.length > 0, 10_000).catch(() => {});
q = await qa();
check('복사 단추: 클립보드 1번, 미리 본 글 그대로', q.clip.length === 1 && q.clip[0] === text, String(q.clip.length));
check('복사 뒤에도 네트워크, 외부 열기 0건', q.net.length + q.open.length + netLog.length === 0, JSON.stringify({ net: q.net, open: q.open, netLog }));
// 다시 읽기 단추
await st.click('.help-dialog button', LANG === 'ko' ? '새로 읽기' : 'Reload');
await sleep(1500);
check('다시 읽기: 미리 보기 다시 나옴', ((await previewText()) ?? '').length > 100);
// 닫기 (화면 단추)
await st.click('#help-close');
await sleep(300);
check('닫기 단추: 창 닫힘', (await st.ev(`!document.querySelector('.help-dialog')`)) === true);
// GitHub 문제 알리기: 기록이 주소에 들어가지 않는다
await st.click('.help-box button.link');
await until('외부 열기', async () => (await qa()).open.length > 0, 10_000).catch(() => {});
q = await qa();
const issue = q.open[0] ?? '';
const issueLeaks = Object.entries(secretsList).filter(([k]) => k !== "REAL_USER").filter(([, v]) => v && decodeURIComponent(issue).includes(v)).map(([k]) => k);
check('GitHub 알리기: 누를 때만 열리고, 주소에 기록과 비밀이 없음', q.open.length === 1 && /^https:\/\/github\.com\//.test(issue) && issueLeaks.length === 0 && decodeURIComponent(issue).length < 2000, `${issue.slice(0, 300)} ${JSON.stringify(issueLeaks)}`);

// 단축키: 진짜 CDP 키 입력 (Cmd+Shift+H), AI 탭에서
await st.click('[role=tab]', 'AI');
await sleep(300);
await st.ev(`window.dispatchEvent(new Event('focus')); 1`);
await st.keyCdp('H', 'KeyH', 72, process.platform === 'darwin' ? 4 | 8 : 2 | 8);
const viaKey = await until('단축키 미리 보기', async () => !!(await previewText()), 10_000).then(() => true, () => false);
check('CDP 키 입력 Cmd/Ctrl+Shift+H 로 미리 보기 열림', viaKey);
if (viaKey) await st.click('#help-close');
// Cmd+Shift+H 아닌 비슷한 키는 열지 않는다 (Cmd+H, Cmd+Alt+Shift+H)
await st.keyCdp('H', 'KeyH', 72, process.platform === 'darwin' ? 4 | 8 | 1 : 2 | 8 | 1);
await sleep(800);
check('Alt 가 더해진 단축키는 열지 않음', (await previewText()) === null);

q = await qa();
check('끝까지 AI 질문 0건', readCalls().length === 0, readCalls().join('\n'));
const helpNet = q.net.filter((x) => !x.includes("calendar.example.org"));
check("끝까지 화면 네트워크 0건, 메인 네트워크 0건 (ICS 정기 동기화 제외)", netLog.length === 0 && helpNet.length === 0, JSON.stringify({ netLog, net: q.net }));

const failed = results.filter((r) => !r.ok && !r.name.startsWith('[참고]'));
console.log(`\n${results.length - failed.length}/${results.length} PASS (${LANG})`);
writeFileSync(join(OUT, `ai-safety-ui-${LANG}.json`), JSON.stringify(results, null, 2));
finished = true;
for (const c of openPages) c.ws.close();
mainConn?.ws.close();
cleanup();
await sleep(2000);
process.exit(failed.length ? 1 : 0);
