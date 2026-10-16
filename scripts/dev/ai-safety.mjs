// AI 안전과 지원 통합 점검 (이슈 #126): 펫 대화 읽기 전용 강제, AI 능력표와 자동 감지, 도움 보내기.
//
//   npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/ai-safety.mjs
//
// 진짜 AI 는 부르지 않는다. 가짜 claude, codex, cursor-agent, gemini(이 스크립트가 임시 폴더에 만든다)를 PATH 앞에 두고
// 앱이 실제로 넘기는 실행 인자와 환경을 기록해서 본다. 진짜 ~/.claude, ~/.codex, 키체인, 사용자 펫은 건드리지 않는다:
// HOME 도 임시 폴더, codex 설정 폴더도 임시 폴더(가짜 MCP 서버를 적어 둔다), 데이터 폴더는 빈 임시 폴더다.
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만(마우스는 CDP 클릭), 포트는 무작위.
//
// 보는 것:
//   1. 시작 안내 3쪽의 "이 컴퓨터에서 찾은 AI" 표시 (찾았어, 로그인 필요, 없어, 모델 안 받음) 를 화면 클릭으로 열어 본다
//   2. 설정 AI 탭의 능력표와 "다시 찾기" (가짜 codex 를 지웠다 되살리면 표시가 바뀐다)
//   3. AI 를 부르는 모든 경로(대화, 일기 다듬기, 말로 만들기, 그림 설계도)가 AI 별로 읽기 전용 인자를 싣는다
//      (격리 켬/끔, 내 MCP 켬, codex 사용자 설정의 MCP 서버). claude 훅 명령을 실제로 돌려 쓰기 도구를 막는지도 본다
//   4. 정보 탭 "도움 보내기": 단추 클릭과 단축키(Cmd/Ctrl+Shift+H)로 미리 보기 창이 열리고, 기록에 심어 둔 가짜 비밀과
//      할 일, 대화 글이 가려진다. 저장은 미리 본 글과 바이트가 같다
// 화면은 OUT 에 ko/en 스크린샷으로 남긴다.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-126');
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

// ---- 임시 폴더, 가짜 CLI ----
const tmp = mkdtempSync(join(tmpdir(), 'fairy-ai-safety-'));
const data = join(tmp, 'data');
const home = join(tmp, 'home');
const bin = join(tmp, 'bin');
const codexHome = join(tmp, 'codex-home');
const calls = join(tmp, 'calls.jsonl');
for (const d of [data, home, bin, codexHome, join(data, 'logs')]) mkdirSync(d, { recursive: true });
writeFileSync(calls, '');
writeFileSync(join(codexHome, 'auth.json'), '{"tokens":{}}');
writeFileSync(
  join(codexHome, 'config.toml'),
  [
    'model = "gpt-test"',
    '[mcp_servers.notion]',
    'command = "echo"',
    '[mcp_servers."my.server"]',
    'url = "https://example.invalid/mcp"',
    '[mcp_servers.fairy]',
    'command = "echo"',
  ].join('\n'),
);

/** 가짜 CLI 하나: 부르면 인자와 환경을 calls 에 한 줄 적고, 바르게 생긴 답을 낸다 */
function fake(name, body) {
  const file = join(bin, name);
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
const done = (extra = {}) =>
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ bin: ${JSON.stringify(name)}, argv, env: process.env, cwd: process.cwd(), ...extra }) + '\\n');
${body}
`,
  );
  chmodSync(file, 0o755);
}
// 감지용 명령: 질문이 아니다. claude 는 로그인, codex 는 로그인, cursor 는 로그인 안 됨, gemini 는 확인 방법 없음
const claudeBody = `
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[0] === 'mcp') { console.log('notion: https://x - ✔ Connected\\nlocal: node a.js - ✓ Connected'); process.exit(0); }
let input = ''; process.stdin.on('data', (c) => (input += c)); process.stdin.on('end', () => {
  done({ stdin: input });
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '가짜 답이야' }));
});`;
const codexBody = `
if (argv[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
if (argv[0] === 'login') { console.log('Logged in'); process.exit(0); }
done();
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '가짜 답이야' } }));
console.log(JSON.stringify({ type: 'turn.completed' }));`;
const cursorBody = `
if (argv[0] === '--version') { console.log('2099.1.1'); process.exit(0); }
if (argv[0] === 'status') { console.log('Not logged in'); process.exit(0); }
done();
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '가짜 답이야' }));`;
const geminiBody = `
if (argv[0] === '--version') { console.log('0.99.0'); process.exit(0); }
done();
console.log('가짜 답이야');`;
fake('claude', claudeBody);
fake('codex', codexBody);
fake('cursor-agent', cursorBody);
fake('gemini', geminiBody);

// 앱이 AI 프로그램을 찾는 길: PATH 를 저장해 둔 파일(ai-env.json), 하루 안이면 새로 읽지 않는 MCP 목록(ai-mcp.json)
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV, codexHome }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: ['notion', 'local'] }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, myMcp: true }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));

// ---- 로그에 심어 둘 가짜 비밀 (모양만 같다) ----
const FAKE = {
  fd: `fd_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6nP9rS2u'}`,
  fs: `fs_${'Zq9Xw8Ve7Ur6Ts5Rq4Po3Nm2Lk1Jh0Gf9Ed8Cb7Aa6'}`,
  ts: 'tskey-auth-kAbCdE1234CNTRL-abcdefghijklmnopqrstuvwxyz1234',
  go: 'GOCSPX-abcdEFGH1234ijklMNOP5678qrst',
  gh: `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`,
  sk: 'sk-ant-api03-abcdEFGH1234_ijklMNOP5678-qrstUVWX9012',
  mail: 'seoyeon.test@example.com',
};
const TODO_TITLE = '치과 예약 세시 시험용';
const CHAT_TEXT = '시험용 비밀 대화 내용 오늘 몰래 산 선물';
const USER = 'kimsiheom';
writeFileSync(
  join(data, 'logs', 'main.log'),
  [
    `2026-10-15T09:00:01.000Z [boot] 시작 /Users/${USER}/Library/Application Support/fairy`,
    `2026-10-15T09:00:02.000Z [server] 세션 ${FAKE.fs} 기기 ${FAKE.fd}`,
    `2026-10-15T09:00:03.000Z [net] tailscale ${FAKE.ts} up`,
    `2026-10-15T09:00:04.000Z [gcal] 인증 실패 client_secret=${FAKE.go}`,
    `2026-10-15T09:00:05.000Z [update] GitHub ${FAKE.gh} 로 확인`,
    `2026-10-15T09:00:06.000Z [chat] error claude ${FAKE.sk}`,
    `2026-10-15T09:00:07.000Z [chat] 오류 ${FAKE.mail} 로그인 필요`,
    `2026-10-15T09:00:08.000Z [todo] 저장 실패: ${TODO_TITLE} (SQLITE_BUSY)`,
    `2026-10-15T09:00:09.000Z [chat] 답이 끊김 "${CHAT_TEXT}" 이어서`,
    '2026-10-15T09:00:10.000Z [server] 기기 코드 F-ABCD-2345 확인',
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
    // 다시 찾기가 로그인 셸 대신 이 값을 읽는다 (SHELL 을 막아 두었다)
    CODEX_HOME: codexHome,
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'lang', LANG, 'inspect', INSPECT, 'page', PAGE);
let finished = false;
const cleanup = () => {
  try {
    app.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      app.kill('SIGKILL');
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }, 1500).unref();
};
process.on('exit', () => {
  if (!finished) cleanup();
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
const openPages = [];
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        openPages.push(c);
        const ev = async (expr) =>
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
            ?.result?.value;
        return {
          ev,
          send: c.send,
          shot: async (file) => {
            await sleep(250);
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          /** 요소 가운데를 CDP 마우스 이벤트로 누른다 (진짜 마우스가 아니다). 글이 같은 단추를 찾는다 */
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
            await sleep(120);
            for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
              await c.send('Input.dispatchMouseEvent', {
                type,
                x: pt.x,
                y: pt.y,
                button: type === 'mouseMoved' ? 'none' : 'left',
                buttons: type === 'mousePressed' ? 1 : 0,
                clickCount: 1,
              });
          },
          /** 키 누름 흉내: 화면 안에서 KeyboardEvent 를 보낸다 (진짜 키보드가 아니고, 숨긴 창에도 통한다) */
          key: (key, code, mods = {}) =>
            ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} }))`),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error(`기다림 끝: ${what}`);
}
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !extra ? '' : ` (${extra})`}`);
}
const readCalls = () =>
  readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
/** 질문 하나가 부른 CLI 호출 (감지용 --version 같은 것은 기록하지 않는다) */
async function nextCall(trigger) {
  const before = readCalls().length;
  await trigger();
  await until('가짜 CLI 호출', () => readCalls().length > before, 20_000);
  await sleep(300);
  return readCalls().slice(before);
}
const flag = (argv, f) => argv[argv.indexOf(f) + 1];
const cfg = (argv) => argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));

// ---- 시작 ----
await until('앱 손잡이', async () => (await main('typeof __jj !== "undefined" && typeof __jj.chat'))?.toString() === 'object', 90_000);
await main(`__jj.pet.win.isDestroyed() ? 0 : 1`);
await sleep(2500);

// =============== 1. 시작 안내: 찾은 AI ===============
await main('__jj.onboarding.open(); 1');
const onb = await page('onboarding');
await until('시작 안내 그려짐', async () => (await onb.ev(`!!document.querySelector('footer .primary')`)) === true, 30_000);
for (let i = 0; i < 2; i++) {
  await onb.click('footer .primary');
  await sleep(300);
}
await until('시작 안내 AI 표', async () => (await onb.ev(`document.querySelectorAll('.ai-found li').length`)) === 5, 40_000);
const onbRows = JSON.parse(await onb.ev(`JSON.stringify([...document.querySelectorAll('.ai-found li')].map((l) => [l.dataset.ai, l.dataset.state, l.innerText.replace(/\\s+/g, ' ')]))`));
const byAi = Object.fromEntries(onbRows.map(([id, state, text]) => [id, { state, text }]));
check('시작 안내: Claude Code 찾았어', byAi.claude?.state === 'found' && /✓/.test(byAi.claude.text), JSON.stringify(byAi.claude));
check('시작 안내: Codex 찾았어', byAi.codex?.state === 'found');
check('시작 안내: Cursor 로그인 필요', byAi.cursor?.state === 'login');
check('시작 안내: Gemini 찾았어(로그인은 모름)', byAi.gemini?.state === 'found-unchecked');
check('시작 안내: 내 컴퓨터 AI 모델 안 받음', byAi.local?.state === 'missing');
const onbOver = await onb.ev(`[...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length`);
check('시작 안내: 가로로 넘치지 않음', onbOver === 0, String(onbOver));
check('시작 안내: 5줄이 스크롤 없이 한 화면에 들어간다', (await onb.ev(`(() => { const m = document.querySelector('main'); return m.scrollHeight <= m.clientHeight + 1; })()`)) === true, await onb.ev(`(() => { const m = document.querySelector('main'); return m.scrollHeight + '/' + m.clientHeight; })()`));
await onb.shot('onboarding-ai');
await main('__jj.onboarding.window?.close(); 1');
await sleep(500);

// =============== 2. 설정 AI 탭: 능력표 ===============
await main('__jj.settingsWindow.open(); 1');
const st = await page('settings');
await until('설정 창', async () => (await st.ev(`!!document.querySelector('[role=tab]')`)) === true, 30_000);
await st.click('[role=tab]', 'AI');
await until('능력표', async () => (await st.ev(`document.querySelectorAll('.ai-cap[data-state]:not([data-state=checking])').length`)) === 5, 40_000);
const rowsNow = async () =>
  JSON.parse(await st.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.ai-cap')].map((l) => [l.dataset.ai, l.dataset.state])))`));
let rows = await rowsNow();
check('AI 탭: 감지 표시가 시작 안내와 같다', JSON.stringify(rows) === JSON.stringify({ claude: 'found', codex: 'found', cursor: 'login', gemini: 'found-unchecked', local: 'missing' }), JSON.stringify(rows));
const chips = JSON.parse(await st.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.ai-cap')].map((l) => [l.dataset.ai, [...l.querySelectorAll('.ai-chips li')].map((c) => c.className || 'on')])))`));
check('AI 탭: 화면 보기는 Claude, Codex 만 됨, 페어리 도구도 같다', chips.claude[2] === 'on' && chips.codex[2] === 'on' && chips.cursor[2] === 'off' && chips.gemini[3] === 'off' && chips.local[2] === 'off', JSON.stringify(chips));
await st.ev(`document.querySelector('.ai-caps').scrollIntoView({ block: 'start' })`);
await st.shot('settings-ai-caps');
// 다시 찾기: 가짜 codex 를 지웠다 되살린다
const codexFile = join(bin, 'codex');
const codexSrc = readFileSync(codexFile);
rmSync(codexFile);
await st.click('button', LANG === 'ko' ? '다시 찾기' : 'Look again');
await until('codex 없음으로 바뀜', async () => (await rowsNow()).codex === 'missing', 30_000);
check('AI 탭: 다시 찾기 → 지운 Codex 는 없어', (await rowsNow()).codex === 'missing');
writeFileSync(codexFile, codexSrc);
chmodSync(codexFile, 0o755);
await st.click('button', LANG === 'ko' ? '다시 찾기' : 'Look again');
await until('codex 다시 찾음', async () => (await rowsNow()).codex === 'found', 30_000);
check('AI 탭: 다시 설치하면 다시 찾기로 찾았어', (await rowsNow()).codex === 'found');
const aiOver = await st.ev(`[...document.querySelectorAll('.ai-cap *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length`);
check('AI 탭: 능력표 가로 넘침 없음', aiOver === 0, String(aiOver));

// =============== 3. AI 호출 경로별 읽기 전용 ===============
const WRITE = ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'];
const setProvider = (id) => main(`__jj.chat.debugSetState((s) => ({ ...s, provider: ${JSON.stringify(id)}, pendingId: undefined })); 1`);
const idle = () => until('채팅 대기 끝', async () => !(await main('!!__jj.chat.debugState.pendingId')), 20_000);
const ask = async (provider, text = '시험 질문') => {
  await setProvider(provider);
  const [c] = await nextCall(() => main(`__jj.chat.askInWindow(${JSON.stringify(text)}); 1`));
  await idle();
  return c;
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const paths = [];
const claudeOk = (c, how) => {
  const a = c.argv;
  const dis = (flag(a, '--disallowedTools') ?? '').split(',');
  return (
    flag(a, '--tools') !== undefined &&
    WRITE.every((w) => dis.includes(w)) &&
    flag(a, '--permission-mode') === 'dontAsk' &&
    !a.includes('--dangerously-skip-permissions')
  );
};
const codexOk = (c) => {
  const k = cfg(c.argv);
  return (
    k.includes('sandbox_mode="read-only"') &&
    k.includes('approval_policy="never"') &&
    ['apps', 'browser_use', 'computer_use', 'plugins'].every((f) => k.includes(`features.${f}=false`)) &&
    !c.argv.includes('--dangerously-bypass-approvals-and-sandbox') &&
    !c.argv.includes('--full-auto')
  );
};
const row = (route, who, ok, extra) => {
  paths.push({ route, who, ok });
  check(`${route} / ${who}: 읽기 전용 인자`, ok, extra);
};
// 격리 켬(기본)
await main(`__jj.settings.set({ aiIsolation: true, myMcp: true, aiPetTools: true }); 1`);
let c = await ask('claude');
row('펫 대화', 'Claude 격리', claudeOk(c) && !c.argv.includes('--settings') && flag(c.argv, '--tools') === '', JSON.stringify(c.argv.slice(0, 20)));
c = await ask('codex');
row('펫 대화', 'Codex 격리', codexOk(c), JSON.stringify(cfg(c.argv)));
c = await ask('cursor');
row('펫 대화', 'Cursor', flag(c.argv, '--mode') === 'ask' && !['--force', '--yolo', '--approve-mcps', '-f'].some((x) => c.argv.includes(x)), JSON.stringify(c.argv));
c = await ask('gemini');
row('펫 대화', 'Gemini', flag(c.argv, '--approval-mode') === 'default' && !c.argv.includes('--yolo') && !c.argv.includes('-y'), JSON.stringify(c.argv));
// 환경: 짝꿍 내부 값이 AI 로 새지 않는다
check('환경: ELECTRON_RUN_AS_NODE, JJ_ 값이 AI 프로그램에 안 넘어감', !('ELECTRON_RUN_AS_NODE' in c.env) && !Object.keys(c.env).some((k) => k.startsWith('JJ_')), Object.keys(c.env).join(','));

// 격리 끔 + 내 MCP 켬
await main(`__jj.settings.set({ aiIsolation: false, myMcp: true, aiPetTools: true }); 1`);
c = await ask('claude');
const settingsJson = flag(c.argv, '--settings');
const hookCmd = settingsJson ? JSON.parse(settingsJson).hooks?.PreToolUse?.[0]?.hooks?.[0]?.command : '';
row('펫 대화', 'Claude 격리 끔 + 내 MCP', claudeOk(c) && (flag(c.argv, '--allowedTools') ?? '').includes('mcp__notion') && !!hookCmd && JSON.parse(settingsJson).hooks.PreToolUse[0].matcher === 'mcp__.*', JSON.stringify(c.argv.slice(0, 24)));
// 훅 명령을 셸에서 실제로 돌려 본다 (쓰기 도구는 막고 읽기 도구와 페어리 도구는 통과)
const { spawnSync } = await import('node:child_process');
const hook = (tool) => spawnSync('/bin/sh', ['-c', hookCmd], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool }), encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' }, timeout: 30_000 });
const sendMail = hook('mcp__notion__send_email');
const readDoc = hook('mcp__notion__notion-fetch');
const mine = hook('mcp__fairy__add_todo');
check('claude 훅 명령: 메일 보내기 도구는 deny', sendMail.status === 0 && JSON.parse(sendMail.stdout).hookSpecificOutput.permissionDecision === 'deny', `${sendMail.status} ${sendMail.stdout} ${sendMail.stderr}`);
check('claude 훅 명령: 읽기 도구와 페어리 도구는 막지 않음', readDoc.status === 0 && readDoc.stdout === '' && mine.status === 0 && mine.stdout === '', `${readDoc.stdout}|${mine.stdout}`);
c = await ask('codex');
const k = cfg(c.argv);
row('펫 대화', 'Codex 격리 끔(사용자 설정 MCP)', codexOk(c) && k.includes('mcp_servers.notion.enabled=false') && k.includes('mcp_servers."my.server".enabled=false') && k.some((x) => x.startsWith('mcp_servers.fairy.command=')) && !k.includes('mcp_servers.fairy.enabled=false'), JSON.stringify(k));
await main(`__jj.settings.set({ aiIsolation: true }); 1`);

// 다른 경로: 일기 다듬기(textOnce), 말로 만들기(textShot, 웹 검색), 그림 설계도(oneShot)
for (const id of ['claude', 'codex']) {
  await setProvider(id);
  [c] = await nextCall(() => main(`__jj.chat.textOnce('다듬어 줘', '시스템'); 1`));
  row('일기 다듬기', id === 'claude' ? 'Claude' : 'Codex', id === 'claude' ? claudeOk(c) : codexOk(c));
  [c] = await nextCall(() => main(`__jj.chat.textShot('캐릭터를 만들어 줘', '시스템'); 1`));
  row('말로 만들기', id === 'claude' ? 'Claude(웹 검색만 열림)' : 'Codex', id === 'claude' ? claudeOk(c) && flag(c.argv, '--tools') === 'WebSearch' && flag(c.argv, '--allowedTools') === 'WebSearch' : codexOk(c));
  [c] = await nextCall(() => main(`__jj.chat.oneShot('이 그림을 봐', { mediaType: 'image/png', data: ${JSON.stringify(PNG)} }, '시스템'); 1`));
  row('그림 설계도(화면 보기)', id === 'claude' ? 'Claude' : 'Codex', id === 'claude' ? claudeOk(c) : codexOk(c));
}
const notRead = paths.filter((p) => !p.ok);
check(`AI 호출 경로 ${paths.length}곳 모두 읽기 전용`, notRead.length === 0, JSON.stringify(notRead));

// =============== 4. 도움 보내기 ===============
await main(`__jj.store.add({ title: ${JSON.stringify(TODO_TITLE)} }, Date.now()); 1`);
await main(`__jj.chat.debugSetState((s) => ({ ...s, messages: [...s.messages, { id: 'zz1', role: 'user', text: ${JSON.stringify(CHAT_TEXT)} }] })); 1`);
await st.click('[role=tab]', LANG === 'ko' ? '정보' : 'About');
await sleep(400);
await st.ev(`document.querySelector('#help-open')?.scrollIntoView({ block: 'center' })`);
await st.shot('settings-about-help');
const previewText = async () => st.ev(`document.querySelector('#help-preview')?.value ?? null`);
const checkPreview = (label, text) => {
  check(`${label}: 미리 보기가 열렸다`, !!text && text.length > 100);
  const leaks = [...Object.values(FAKE), TODO_TITLE, CHAT_TEXT, USER].filter((s) => text.includes(s));
  check(`${label}: 토큰, 이메일, 할 일, 대화 글, 사용자 이름이 모두 가려짐`, leaks.length === 0, JSON.stringify(leaks));
  check(`${label}: 머리(판, 운영체제, 아키텍처, 기능, 서버, AI)가 있다`, /0\.\d+\.\d+/.test(text) && text.includes(process.arch) && /wander=\d/.test(text) && /claude=found/.test(text) && /gemini=found-unchecked/.test(text), text.slice(0, 600));
  check(`${label}: 기록 속 기기 코드는 남는다`, text.includes('F-ABCD-2345'));
  check(`${label}: 가린 자리 표시가 있다`, /<secret>/.test(text) && /<email>/.test(text) && /<private>/.test(text));
};
await st.click('#help-open');
await until('미리 보기', async () => !!(await previewText()), 30_000);
let text1 = await previewText();
checkPreview('단추 클릭', text1);
await st.shot('help-dialog');
const hiddenLine = await st.ev(`document.querySelector('.help-dialog')?.innerText`);
check('미리 보기 창: 자동으로 보내지 않는다는 안내가 있다', LANG === 'ko' ? /자동으로 보내지지 않아/.test(hiddenLine) : /sent anywhere automatically/.test(hiddenLine));
// 저장: 대화 상자를 바꿔 끼우고 저장 파일이 미리 본 글과 같은지
const saveTo = join(tmp, 'help-saved.txt');
await main(`__jj.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(saveTo)} }); 1`);
await st.click('#help-save');
await until('저장 파일', async () => {
  try {
    return readFileSync(saveTo, 'utf8').length > 0;
  } catch {
    return false;
  }
}, 15_000);
check('저장한 파일이 미리 본 글과 같다', readFileSync(saveTo, 'utf8') === text1);
await st.click('#help-copy');
await sleep(500);
check('복사 단추: 복사했다는 안내', /복사했어|Copied/.test((await st.ev(`document.querySelector('.help-dialog')?.innerText`)) ?? ''));
// Esc 로 창만 닫힌다 (설정 창은 그대로)
await st.ev(`document.querySelector('.help-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
await sleep(300);
check('Esc: 미리 보기 창만 닫힘', (await st.ev(`!document.querySelector('.help-dialog')`)) === true && (await main('!!__jj.settingsWindow.window && !__jj.settingsWindow.window.isDestroyed()')) === true);
// 단축키 (다른 탭에서도): Cmd/Ctrl+Shift+H
await st.click('[role=tab]', 'AI');
await sleep(300);
await st.key('H', 'KeyH', process.platform === 'darwin' ? { metaKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true });
await until('단축키로 열림', async () => !!(await previewText()), 30_000);
checkPreview('단축키', await previewText());
check('단축키: 정보 탭으로 옮겨 열렸다', (await st.ev(`document.querySelector('#tab-about')?.getAttribute('aria-selected')`)) === 'true');
await st.click('#help-close');
const overHelp = await st.ev(`[...document.querySelectorAll('.help-box *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length`);
check('도움 보내기 칸: 가로 넘침 없음', overHelp === 0, String(overHelp));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS (${LANG})`);
console.log('AI 호출 경로:', paths.map((p) => `${p.route}/${p.who}:${p.ok ? 'O' : 'X'}`).join('  '));
writeFileSync(join(OUT, `ai-safety-${LANG}.json`), JSON.stringify({ results, paths }, null, 2));
finished = true;
for (const c of openPages) c.ws.close();
mainConn?.ws.close();
cleanup();
await sleep(2000);
process.exit(failed.length ? 1 : 0);
