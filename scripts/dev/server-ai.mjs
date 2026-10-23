// AI 대화권 통합 점검 (이슈 #100). 시험용 Postgres 컨테이너, 가짜 Anthropic(server/scripts/fake-anthropic.mjs),
// 페어리 서버(server/dist)를 무작위 포트로 띄우고 앱을 붙인다(JJ_SERVER_URL_OVERRIDE). 진짜 Anthropic 은 부르지 않는다.
// 시험 서버는 구글 값이 비어 있어 로그인은 DB 에 세션을 만들고 앱 메모리에 넣는다(__jj.server.debugSetSession).
// 보는 것: 대화권이 보이는 조건(18+ 로그인), 첫 로그인 10개, 국외 이전 안내와 "알겠어", "AI 와 대화 중", 차감,
// 업스트림 실패 되돌림, 다 썼을 때 안내와 내 컴퓨터 AI 단추, 신고, 내용 미저장(표 전체), 14~17 이면 숨김. 경우마다 PASS/FAIL.
//
//   npm run build && (cd server && npm run build) && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/server-ai.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory(키체인 안 씀), 입력은 CDP 로만.
// 진짜 AI CLI 가 잡히지 않게 환경 변수는 비우고 PATH 는 /usr/bin:/bin 과 node 만 둔다.
// 컨테이너는 jj-server-test-pg-<무작위> 이름으로만 만들고 지운다 (운영 컨테이너 fairy-*, moilga-* 는 건드리지 않는다).
// 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9873, 9874).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';
import { startFakeAnthropic } from '../../server/scripts/fake-anthropic.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'server-ai-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9873);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9874);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

// ---- 시험용 Postgres ----
const pgName = `jj-server-test-pg-${randomBytes(4).toString('hex')}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker(
  'run',
  '-d',
  '--rm',
  '--tmpfs',
  '/var/lib/postgresql/data',
  '--name',
  pgName,
  '--log-opt',
  'max-size=1m',
  '-e',
  `POSTGRES_PASSWORD=${pgPass}`,
  '-e',
  'POSTGRES_USER=fairy',
  '-e',
  'POSTGRES_DB=fairy',
  '-p',
  '127.0.0.1::5432',
  'postgres:16-alpine',
);
const pgPort = docker('port', pgName, '5432/tcp').split('\n')[0]?.split(':').pop();
for (let i = 0; i < 240; i++) {
  try {
    docker('exec', pgName, 'pg_isready', '-U', 'fairy', '-d', 'fairy', '-h', '127.0.0.1');
    break;
  } catch {
    await sleep(250);
  }
}
const databaseUrl = `postgres://fairy:${pgPass}@127.0.0.1:${pgPort}/fairy`;
const sql = (q) => docker('exec', pgName, 'psql', '-U', 'fairy', '-d', 'fairy', '-At', '-c', q);
execFileSync(process.execPath, [join(root, 'server', 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});
// #101: 채팅 이용권은 기본 allowlist, 첫 로그인 선물은 기본 꺼짐. 이 시험은 #100 흐름(모두, 선물 10장)을 본다
sql(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
sql('UPDATE ai_setting SET first_gift = true');

// ---- 가짜 Anthropic 과 페어리 서버 (구글 값 비움) ----
const fake = await startFakeAnthropic();
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const api = spawn(process.execPath, [join(root, 'server', 'dist', 'main.js')], {
  cwd: join(root, 'server'),
  env: {
    PATH: process.env.PATH,
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    PUBLIC_URL: apiUrl,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    ANTHROPIC_API_KEY: 'sk-test-fake',
    ANTHROPIC_BASE_URL: fake.url,
    GIFT_HMAC_KEY: randomBytes(32).toString('hex'),
  },
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${apiUrl}/health`)).ok) break;
  } catch {}
  await sleep(250);
}

// ---- 앱 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.server-ai-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_SERVER_URL_OVERRIDE: apiUrl,
    JJ_TEST_SECRETS: 'memory',
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'server', apiPort, 'pg', pgName, 'lang', LANG);
let appExited = false;
app.on('exit', () => {
  appExited = true;
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
    for (let i = 0; i < 80 && !mainConn; i++) {
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
async function page(name) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        return {
          ev: async (expr) =>
            (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
              ?.result?.value,
          shot: async (file) => {
            await sleep(250);
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
          },
          close: () => c.ws.close(),
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
    await sleep(250);
  }
  throw new Error(`기다림 끝: ${what}`);
}
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const status = async () => JSON.parse(await main('JSON.stringify(__jj.server.core.status())'));
const chatState = async () => JSON.parse(await main('JSON.stringify(__jj.chat.debugState)'));
const accountId = () => sql('SELECT id FROM account WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
/** 모든 표의 모든 줄을 글로 바꿔 찾는다 (찾은 표 이름들) */
const findAnywhere = (needle) =>
  sql("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    .split('\n')
    .filter(Boolean)
    .filter((t) => sql(`SELECT count(*) FROM "${t}" x WHERE x::text LIKE '%${needle}%'`) !== '0');
const T = {
  ko: { agree: '알겠어, 채팅 이용권 쓰기', report: '신고', send: '보내기', aiNow: 'AI와 대화 중', empty: '채팅 이용권을 다 썼어' },
  en: { agree: 'Got it, use chat passes', report: 'Report', send: 'Send', aiNow: 'talking with an AI', empty: 'used all your chat passes' },
}[LANG];

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));
  // 만 18세 이상, 기기 계정 → DB 에 구글 로그인과 세션을 만들고 앱에 넣는다
  await main(`__jj.server.core.setAge('adult')`);
  await until('기기 계정', async () => {
    const s = await status();
    return s.device && s.balance !== null && !s.syncing;
  });
  check('기기 계정만으로는 대화권이 없다', (await status()).ai === false);
  const id = accountId();
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'test-sub-${randomBytes(4).toString('hex')}', ${id})`);
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${id}, sha256('${session}'::bytea))`);
  check('세션 넣기', (await main(`__jj.server.debugSetSession(${JSON.stringify(session)})`)) === true);
  await until('대화권 수', async () => (await status()).tickets === 10);
  check('로그인 + 18+ 이면 대화권 10개 (첫 로그인 선물)', sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${id}`) === '10');

  // 채팅 창: 대화권 Claude 고르기 → 국외 이전 안내 (아직 보내지 못함)
  await main(`__jj.chat.open(__jj.pet.bounds()); 1`);
  const c = await page('chat');
  await until('채팅 화면', () => c.ev(`!!document.querySelector('.picker')`));
  await c.ev(`window.jjakkungChat.setProvider('fairy-ticket'); 1`);
  await until('대화권 줄', () => c.ev(`!!document.querySelector('.ticket-bar')`));
  const bar = await c.ev(`document.querySelector('.ticket-bar').innerText`);
  check('"AI 와 대화 중" 과 남은 수, 국외 이전 안내', bar.includes(T.aiNow) && bar.includes('10') && bar.includes('Anthropic'), bar.slice(0, 80));
  // 화면을 거치지 않고 보내도 메인이 막는다 (질문이 붙지 않고 서버도 부르지 않는다)
  await c.ev(`window.jjakkungChat.send('미리 보내기', []); 1`);
  await sleep(500);
  check(
    '안내에 "알겠어" 전에는 보내지 않는다',
    (await chatState()).messages.length === 0 && fake.calls.length === 0 && sql('SELECT count(*) FROM ai_usage') === '0',
  );
  await c.shot('ai-1-notice');
  await c.ev(`[...document.querySelectorAll('.ticket-notice button')].find((b) => b.textContent.trim() === ${JSON.stringify(T.agree)}).click()`);
  await until('안내 닫힘', async () => !(await c.ev(`!!document.querySelector('.ticket-notice')`)));

  // 질문 하나: 가짜 Anthropic 답, 차감
  const marker = `비밀질문${randomBytes(4).toString('hex')}`;
  const calls0 = fake.calls.length;
  await c.ev(`window.jjakkungChat.send(${JSON.stringify(`안녕 ${marker}`)}, []); 1`);
  await until('답', async () => {
    const s = await chatState();
    return !s.pendingId && s.messages.at(-1)?.status === 'done';
  });
  const answer = (await chatState()).messages.at(-1)?.text;
  check('대화권 답이 오고 하나 빠진다', answer === '안녕! 나는 AI 야.' && (await status()).tickets === 9, `${answer}`);
  check('서버가 가짜 Anthropic 을 한 번 불렀다 (시스템 프롬프트에 AI 고지)', fake.calls.length === calls0 + 1 && /AI/.test(String(fake.calls.at(-1)?.body.system)));
  {
    const body = fake.calls.at(-1)?.body ?? {};
    const first = JSON.stringify(body.messages?.[0] ?? '');
    check(
      '말투는 system 이 아니라 첫 차례 앞 참고 자료 블록에 (system 에는 펫 이름 없음)',
      /말투 참고 자료|Voice reference/.test(first) && !/콩이|Kongi/.test(String(body.system)),
    );
  }
  await until('남은 수 표시', async () => (await c.ev(`document.querySelector('.ticket-count').innerText`)).includes('9'));
  await c.shot('ai-2-answer');

  // 업스트림 실패: 대화권을 되돌린다
  await c.ev(`window.jjakkungChat.send('[[fail]] 다시', []); 1`);
  await until('실패', async () => {
    const s = await chatState();
    return !s.pendingId && s.messages.at(-1)?.status === 'error';
  });
  check('업스트림 실패: 되돌려 9개 그대로', (await status()).tickets === 9 && sql(`SELECT remaining FROM ai_ticket WHERE account_id = ${id}`) === '9');

  // 신고 (따로 확인한 뒤)
  await c.ev(`[...document.querySelectorAll('.ticket-report-open')][0].click()`);
  await sleep(200);
  await c.shot('ai-3-report-ask');
  await c.ev(`[...document.querySelectorAll('.ticket-report button')].find((b) => b.textContent.trim() === ${JSON.stringify(T.send)}).click()`);
  await until('신고 끝', () => c.ev(`!!document.querySelector('.ticket-report-done.sent')`));
  check('신고: 그 대화만 ai_report 에', sql('SELECT count(*) FROM ai_report') === '1' && findAnywhere(marker).join(',') === 'ai_report');
  sql('DELETE FROM ai_report');
  check('내용 미저장: 신고를 지우면 질문과 답이 DB 어디에도 없다', findAnywhere(marker).length === 0 && findAnywhere('나는 AI').length === 0);

  // 다 쓰면: 안내와 내 컴퓨터 AI 로 다시 묻기
  sql(`UPDATE ai_ticket SET remaining = 0 WHERE account_id = ${id}`);
  await c.ev(`window.jjakkungChat.send('하나 더', []); 1`);
  await until('다 씀', async () => {
    const s = await chatState();
    return !s.pendingId && s.messages.at(-1)?.status === 'error';
  });
  const last = (await chatState()).messages.at(-1);
  check('다 쓰면 no-tickets 안내', last?.error?.kind === 'no-tickets' && last.error.message.includes(T.empty), last?.error?.message);
  await until('다른 AI 단추', () => c.ev(`document.querySelectorAll('.msg.pet:last-child .retry button').length > 0`), 10_000).catch(() => {});
  const alt = await c.ev(`[...document.querySelectorAll('.retry button')].map((b) => b.textContent).join(' | ')`);
  check('내 컴퓨터 AI 로 다시 묻기 단추', alt.length > 0, alt);
  check('남은 수 0 표시', (await c.ev(`document.querySelector('.ticket-count').innerText`)).includes('0'));
  await c.shot('ai-4-empty');

  // 14~17 로 바꾸면 대화권이 사라진다 (목록과 화면)
  await main(`__jj.server.core.setAge('teen')`);
  await until('숨김', async () => (await status()).ai === false);
  await c.ev(`window.jjakkungChat.providers().then((l) => (window.__ids = l.map((p) => p.id)))`);
  await sleep(300);
  const ids = await c.ev('window.__ids');
  check('14~17: 대화권이 목록에 없고 대화권 줄도 없다', Array.isArray(ids) && !ids.includes('fairy-ticket') && (await chatState()).provider !== 'fairy-ticket');
  await sleep(300);
  check('14~17: 대화권 줄이 사라졌다', (await c.ev(`!document.querySelector('.ticket-bar')`)) === true);
  c.close();

  const how = await main(
    "(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); setTimeout(() => e.app.quit(), 100); return 'quit'; })()",
  );
  if (how !== 'quit') throw new Error('끝내기 못 함');
  mainConn.ws.close();
  await until('앱 끝남', () => appExited, 15_000);
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

if (!appExited) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
}
api.kill('SIGTERM');
await fake.close();
dropPg();
if (failed || results.some((r) => !r.ok)) {
  try {
    const lines = readFileSync(join(data, 'logs', 'main.log'), 'utf8').trimEnd().split('\n');
    console.log(`---- 앱 기록 끝 ----\n${lines.filter((l) => /server|chat/.test(l)).slice(-30).join('\n')}`);
  } catch {}
}
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
