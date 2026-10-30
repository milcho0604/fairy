// 채팅 AI 고르기의 채팅 이용권 줄 (feat/ticket-default): 맨 위에 늘 보임, 남은 장수 이름표, 못 쓰면 흐리게(aria-disabled)와 까닭 한 줄과 길 한 줄,
// 못 쓰는 줄을 눌러도 AI 가 안 바뀜, 가로 넘침 없음. 서버 없이 채팅 상태만 창에 보낸다(운영 서버 요청 없음). 가짜 claude 만 쓴다.
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en node scripts/dev/ticket-default.mjs
// 채팅, 설정, 만들기 창 화면 디테일: 펫 이름 잘림, 머리줄 단추 높이, 탭 줄 꺾임, 칩 줄 끝, 백업 단추, AI 칩 됨/안 됨, 표, 사용량 막대, 만들기 머리.
// 앱은 JJ_NO_FOCUS=1 로 보이지 않게, 빈 데이터 폴더, 가짜 claude. 화면과 입력은 CDP 로만.
//   npm run build && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko|en [JJ_ROOT=<빌드한 체크아웃>] [TAG=before|after] node scripts/dev/ticket-default.mjs
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(process.env.JJ_ROOT ?? resolve(import.meta.dirname, '..', '..'));
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-ticket-default');
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
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
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.ticket-default-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
const bin = join(scratch, 'bin');
for (const d of [data, home, bin]) mkdirSync(d, { recursive: true });
const now = Math.floor(Date.now() / 1000);
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Fake Claude)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (argv[0] === 'mcp') { console.log(''); process.exit(0); }
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok' }));
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const PATH_ENV = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
writeFileSync(join(data, 'ai-env.json'), JSON.stringify({ path: PATH_ENV }));
writeFileSync(join(data, 'ai-mcp.json'), JSON.stringify({ at: Date.now(), servers: [] }));
writeFileSync(join(data, 'chat-settings.json'), JSON.stringify({ provider: 'claude' }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG, wander: false, friends: [], petName: LANG === 'en' ? 'Mochi' : '모찌' }));
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
const cases = [
  ['usable', { tickets: 5 }, false],
  ['signedOut', { block: 'signedOut', tickets: null }, true],
  ['empty', { block: 'empty', tickets: 0 }, true],
  ['waitlisted', { block: 'waitlisted', tickets: null }, true],
];
try {
  await main('typeof __jj !== "undefined"');
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  const c = await page('chat');
  for (let i = 0; i < 60 && !(await c.ev("!!document.querySelector('textarea')")); i++) await sleep(150);
  await sleep(500);
  const base = JSON.parse(await main('JSON.stringify(__jj.chat.debugState)'));
  for (const [name, gate, blocked] of cases) {
    const st = { ...base, provider: name === 'usable' ? 'fairy-ticket' : 'claude', messages: [], pendingId: undefined, ticketGate: gate };
    await main(`__jj.chat.faces()[0].contents.send('chat:state', ${JSON.stringify(st)}); 1`);
    await sleep(300);
    for (const dark of [false, true]) {
      await c.dark(dark);
      for (const w of [320, 560]) {
        await main(`__jj.chat.window.setSize(${w}, 560); 1`);
        await sleep(350);
        if (!(await c.ev("!!document.querySelector('.picker-menu')"))) await c.ev("document.querySelector('.picker-button').click()");
        await sleep(250);
        const tag = `${name}-${LANG}-${dark ? 'dark' : 'light'}-${w}`;
        const m = JSON.parse(await c.ev(`JSON.stringify((() => {
          const first = document.querySelector('.picker-menu > button');
          const menu = document.querySelector('.picker-menu').getBoundingClientRect();
          return {
            firstIsTicket: !!first && first.classList.contains('ticket-row'),
            disabled: first.getAttribute('aria-disabled'),
            name: first.querySelector('.name').textContent,
            tag: first.querySelector('.ticket-left')?.textContent ?? '',
            lines: [...first.querySelectorAll('.ticket-why > span')].map((s) => s.textContent),
            opacity: getComputedStyle(first).opacity,
            over: menu.left < -1 || menu.right > innerWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
          };
        })())`));
        await c.shot(tag);
        check(`${tag} 맨 위 줄이 채팅 이용권`, m.firstIsTicket && m.name === (LANG === 'en' ? 'Chat pass' : '채팅 이용권'), m.name);
        check(`${tag} 못 쓰면 aria-disabled`, blocked ? m.disabled === 'true' && Number(m.opacity) < 0.8 : m.disabled === null);
        check(`${tag} 이름표`, gate.tickets === null ? m.tag === '' : m.tag === (LANG === 'en' ? `${gate.tickets} left` : `${gate.tickets}장 남음`), m.tag);
        check(`${tag} 까닭과 길 한 줄씩`, blocked ? m.lines.length === 2 && m.lines.every((l) => l.length > 0) : m.lines.length === 0, m.lines.join(' / '));
        check(`${tag} 가로 넘침 없음`, !m.over);
        if (name === 'usable') {
          const sel = JSON.parse(await c.ev(`JSON.stringify({ label: document.querySelector('.picker-label').textContent, checked: document.querySelector('.picker-menu > button').getAttribute('aria-checked') })`));
          check(`${tag} 이용권이 선택된 상태`, sel.label === (LANG === 'en' ? 'Chat pass' : '채팅 이용권') && sel.checked === 'true', `${sel.label}/${sel.checked}`);
        }
        if (blocked && w === 560 && !dark) {
          await c.ev("document.querySelector('.picker-menu > button').click()");
          await sleep(300);
          const prov = await main('__jj.chat.debugState.provider');
          check(`${tag} 눌러도 AI 가 안 바뀜`, prov !== 'fairy-ticket' && (await c.ev("!!document.querySelector('.picker-menu')")), prov);
        }
      }
    }
    await c.ev("document.querySelector('.picker-menu') && document.querySelector('.picker-button').click()");
    await sleep(200);
  }
  // 한국어에서 나쁜 낱말
  const text = await c.ev('document.body.innerText');
  check('모드 낱말 없음', !/모드/.test(text));
  console.log(`\n${pass} PASS, ${fails.length} FAIL`);
  if (fails.length) { console.log(fails.join('\n')); code = 1; }
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  try { app.kill(); } catch {}
  await sleep(500);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
