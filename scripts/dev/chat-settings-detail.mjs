// 채팅, 설정, 만들기 창 화면 디테일: 펫 이름 잘림, 머리줄 단추 높이, 탭 줄 꺾임, 칩 줄 끝, 백업 단추, AI 칩 됨/안 됨, 표, 사용량 막대, 만들기 머리.
// 앱은 JJ_NO_FOCUS=1 로 보이지 않게, 빈 데이터 폴더, 가짜 claude. 화면과 입력은 CDP 로만.
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en [JJ_ROOT=<빌드한 체크아웃>] [TAG=before|after] node scripts/dev/chat-settings-detail.mjs
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? resolve(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-chat-settings-detail');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const TAG = process.env.TAG ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
const INSPECT = await freePort();
const PAGE = await freePort();
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.chat-settings-detail-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
const bin = join(scratch, 'bin');
for (const d of [data, home, bin]) mkdirSync(d, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const table = ['| 항목 | 값 | 설명 |', '|:--|--:|---|', '| a | 1 | 첫 줄 |', '| <img src=x onerror=window.__xss=1> | 2 | <script>window.__xss=1</script> |'].join('\\n');
const reply = `표를 보여 줄게.\\n\\n${table}\\n\\n\`\`\`js\\nconst veryLongLine = "이 줄은 일부러 아주 길게 써서 코드 블록이 가로로 밀리게 한다 이 줄은 일부러 아주 길게 써서";\\n\`\`\``;
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
  console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: ${now} + 3 * 3600 }, seven_day: { utilization: 0.4, resetsAt: ${now} + 3 * 86400 } } } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(reply)}.replace(/\\\\n/g, '\\n') }));
});
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
writeFileSync(join(data, 'chat-settings.json'), JSON.stringify({ provider: 'claude' }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, wander: false, friends: [], petName: process.env.PET_NAME ?? (LANG === 'en' ? 'Kimchi' : '김치') }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));

const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: { HOME: home, SHELL: '/usr/bin/false', PATH: PATH_ENV, JJ_NO_FOCUS: '1', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: 'ignore',
});
console.log('app pid', app.pid);
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id;
    const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), 30000);
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { clearTimeout(timer); ws.removeEventListener('message', h); r(m); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send };
}
let mainConn;
async function main(expr) {
  for (let i = 0; i < 120 && !mainConn; i++) {
    try { const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json(); mainConn = await connect(t.webSocketDebuggerUrl); } catch { await sleep(250); }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const conns = new Map();
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        let c = conns.get(name);
        if (c?.id !== p.id) { c = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) }; conns.set(name, c); }
        return {
          send: c.send,
          ev: async (expr) => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value,
          shot: async (file) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64')); },
          dark: (on) => c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`화면 없음: ${name}`);
}
let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) pass++; else fails.push(`${name} ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}
const R = (n) => Math.round(n * 10) / 10;
let code = 0;
try {
  await main('typeof __jj !== "undefined"');
  // ---- 채팅
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  const c = await page('chat');
  for (let i = 0; i < 60 && !(await c.ev("!!document.querySelector('textarea')")); i++) await sleep(150);
  await sleep(400);
  await c.ev(`(() => { const e = document.querySelector('textarea'); e.focus(); })()`);
  await c.send('Input.insertText', { text: 'hi' });
  await c.ev(`(() => { const t = document.activeElement; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); })()`);
  for (let i = 0; i < 60 && !(await c.ev("!!document.querySelector('.md-table, .bubble pre')")); i++) await sleep(200);
  await sleep(500);
  for (const dark of [false, true]) {
    await c.dark(dark);
    for (const w of [320, 400, 600]) {
      await main(`__jj.chat.window.setSize(${w}, 700); 1`);
      await sleep(400);
      const tag = `chat-${LANG}-${dark ? 'dark' : 'light'}-${w}`;
      const m = JSON.parse(await c.ev(`JSON.stringify((() => {
        const s = document.querySelector('header .title strong');
        const hs = [...document.querySelectorAll('header button, header .picker-button')].filter((b) => b.offsetParent).map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
        const tops = [...document.querySelectorAll('.usage .track')].map((t) => { const r = t.getBoundingClientRect(); const l = t.previousElementSibling.getBoundingClientRect(); return Math.round((r.top + r.height / 2 - l.top - l.height / 2) * 10) / 10; });
        const nl = document.querySelector('.new-chat');
        const tw = document.querySelector('.md-table-wrap');
        return { nameW: s.clientWidth, nameScroll: s.scrollWidth, hs, tops, nl: nl && getComputedStyle(nl.querySelector('.new-label')).position, table: !!document.querySelector('.md-table'), tableCols: document.querySelectorAll('.md-table th').length, rawPipes: [...document.querySelectorAll('.bubble')].some((b) => b.innerText.includes('|---')), bubbles: document.querySelectorAll('.bubble').length, xss: !!window.__xss, injected: document.querySelectorAll('.bubble img, .bubble script').length, wrapOverflow: tw ? tw.scrollWidth > tw.clientWidth : null };
      })())`));
      console.log(tag, JSON.stringify(m));
      await c.shot(`${TAG}-${tag}`);
      if (TAG === 'after') {
        check(`${tag} 이름 안 잘림`, m.nameScroll <= m.nameW + 1, `${m.nameW}/${m.nameScroll}`);
        check(`${tag} 머리줄 단추 높이 하나`, new Set(m.hs.filter((h) => h >= 20)).size === 1, JSON.stringify(m.hs));
        check(`${tag} 막대 기준선 같음`, new Set(m.tops).size === 1, JSON.stringify(m.tops));
        check(`${tag} 표로 그림`, m.table && m.tableCols === 3 && !m.rawPipes);
        check(`${tag} 태그는 글자로만`, !m.xss && m.injected === 0);
        if (w < 440) check(`${tag} 새 대화는 그림만`, m.nl === 'absolute');
        else check(`${tag} 새 대화는 글자`, m.nl !== 'absolute');
      }
    }
  }
  // ---- 설정
  await main('__jj.settingsWindow.open(); 1');
  const s = await page('settings');
  for (let i = 0; i < 60 && !(await s.ev("!!document.querySelector('#tab-pet')")); i++) await sleep(150);
  await main('__jj.settingsWindow.window.setMinimumSize(320,520); 1');
  for (const dark of [false, true]) {
    await s.dark(dark);
    for (const w of [360, 440, 760]) {
      await main(`__jj.settingsWindow.window.setSize(${w}, 700); 1`);
      await sleep(400);
      const tag = `settings-${LANG}-${dark ? 'dark' : 'light'}-${w}`;
      const tab = async (id) => { await s.ev(`document.querySelector('#tab-${id}').click()`); await sleep(250); };
      const rows = JSON.parse(await s.ev(`JSON.stringify(new Set([...document.querySelectorAll('.tabs [role=tab]')].map((b) => b.offsetTop)).size)`));
      if (w < 640) check(`${tag} 탭 한 줄`, rows === 1, `rows=${rows}`);
      await tab('pet');
      await s.shot(`${TAG}-${tag}-pet`);
      const jump = JSON.parse(await s.ev(`JSON.stringify((() => { const j = document.querySelector('.settings-jump'); return j ? { fade: getComputedStyle(j).maskImage !== 'none', scroll: j.scrollWidth > j.clientWidth } : null; })())`));
      if (w < 640 && jump?.scroll) check(`${tag} 칩 줄 끝 흐림`, jump.fade);
      await tab('data');
      const bk = JSON.parse(await s.ev(`JSON.stringify([...document.querySelectorAll('.action-row')].map((r) => [...r.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10)))`));
      await s.shot(`${TAG}-${tag}-data`);
      if (TAG === 'after') check(`${tag} 같은 줄 단추 높이`, bk.every((r) => new Set(r).size <= 1), JSON.stringify(bk));
      await tab('ai');
      await sleep(600);
      const chips = JSON.parse(await s.ev(`JSON.stringify([...document.querySelectorAll('.ai-chips li.cap')].map((l) => getComputedStyle(l, '::before').content))`));
      await s.shot(`${TAG}-${tag}-ai`);
      if (TAG === 'after' && chips.length) check(`${tag} 칩에 V, X`, chips.every((x) => x !== 'none' && x !== 'normal'), JSON.stringify([...new Set(chips)]));
      await tab('assist');
      await s.shot(`${TAG}-${tag}-assist`);
    }
  }
  // ---- 만들기
  await main('__jj.maker.open(); 1');
  const mk = await page('maker');
  for (const dark of [false, true]) {
    await mk.dark(dark);
    for (const w of [480, 900]) {
      await main(`(() => { const w = __jj.maker.window; w.setMinimumSize(320, 400); w.setSize(${w}, 720); return 1; })()`);
      await sleep(500);
      const tag = `maker-${LANG}-${dark ? 'dark' : 'light'}-${w}`;
      const h = JSON.parse(await mk.ev(`JSON.stringify((() => { const t = document.querySelector('header > strong'); return { lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight || 20)), h: t.getBoundingClientRect().height }; })())`));
      console.log(tag, JSON.stringify(h));
      await mk.shot(`${TAG}-${tag}`);
      if (TAG === 'after') check(`${tag} 제목 한 줄`, h.h < 30, JSON.stringify(h));
    }
  }
  console.log(`\n${pass} 통과, ${fails.length} 실패`);
  for (const f of fails) console.log('FAIL', f);
  code = fails.length ? 1 : 0;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  mainConn?.ws.close();
  for (const v of conns.values()) v.ws.close();
  app.kill('SIGTERM');
  await Promise.race([new Promise((r) => app.once('exit', r)), sleep(8000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);
