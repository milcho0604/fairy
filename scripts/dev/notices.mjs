// 공지 창과 공지 파일의 최소 버전 점검 (docs/server-plan.md 23절). 앱을 직접 띄우고, 이 컴퓨터 http 서버로 notices.json 과
// 가짜 릴리스를 내준다 (JJ_NOTICES_URL, JJ_RELEASES_API). 종류 넷 화면을 밝은, 어두운 모드로 찍고 경우마다 PASS/FAIL.
//
//   npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/notices.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 맥북 화면, 입력은 CDP 로만.
// 진짜 AI CLI 가 잡히지 않게 환경 변수는 비우고 PATH 는 /usr/bin:/bin 과 node 만 둔다. 링크와 "업데이트" 단추는 누르지 않는다
// (진짜 브라우저가 열린다). 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9861, 9862).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'notice-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9861);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9862);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ---- 가짜 홈페이지와 릴리스 ----
const text = (ko, en) => ({ ko, en });
const NOTICES = {
  info: {
    id: 'test-info-1',
    kind: 'info',
    title: text('이번 주 선물', 'Gift this week'),
    body: text(
      '이번 주에는 할 일을 끝내면 코인을 두 배로 받아. 금요일까지야.',
      'This week you get double coins for finished to-dos. Until Friday.',
    ),
    link: 'https://fairy.moilga.com/news/1',
  },
  important: {
    id: 'test-important-1',
    kind: 'important',
    title: text('구글 캘린더 잇기가 잠깐 멈춰', 'Google Calendar sync is paused'),
    body: text(
      '구글 쪽 점검으로 오늘 밤 10시부터 한 시간 동안 일정을 주고받지 못해.\n그동안 바꾼 일정은 끝난 뒤에 맞춰 줄게.',
      "Because of maintenance on Google's side, events won't sync for an hour from 10 PM tonight.\nChanges you make meanwhile sync afterwards.",
    ),
  },
  update: {
    id: 'test-update-1',
    kind: 'update',
    title: text('새 버전에서 메모가 더 안전해', 'Notes are safer in the new version'),
    body: text(
      '메모를 빠르게 지울 때 가끔 다른 메모가 같이 지워지던 문제를 고쳤어.',
      'Fixed a rare bug where deleting notes quickly could also delete another note.',
    ),
  },
  force: {
    id: 'test-force-1',
    kind: 'force',
    title: text('꼭 업데이트해 줘', 'Please update now'),
    body: text(
      '이 버전은 할 일 저장 파일을 망가뜨릴 수 있어. 새 버전으로 바꾸기 전까지 AI 대화를 쉴게.',
      'This version can damage your to-do file. AI chat is paused until you update.',
    ),
  },
};
const state = {
  /** 내줄 글 (문자열이면 그대로) */
  notices: { version: 1, notices: [NOTICES.info] },
  /** true 면 연결을 끊는다 (오프라인) */
  offline: false,
  /** 받을 때마다 minVersion 을 바꾼다 (두 번 받기 시험) */
  flip: false,
  flipCount: 0,
  noticeHits: 0,
  release: {
    tag_name: 'v0.5.0',
    html_url: 'https://github.com/milcho0604/fairy-releases/releases/tag/v0.5.0',
    body: '',
    draft: false,
    prerelease: false,
  },
};
const server = createServer((req, res) => {
  if (state.offline) {
    req.socket.destroy();
    return;
  }
  if (req.url === '/notices.json') {
    state.noticeHits++;
    let body;
    if (state.flip) {
      state.flipCount++;
      body = JSON.stringify({ version: 1, notices: [], ...(state.flipCount % 2 ? { minVersion: '0.4.4' } : {}) });
    } else body = typeof state.notices === 'string' ? state.notices : JSON.stringify(state.notices);
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', etag });
    res.end(body);
    return;
  }
  if (req.url === '/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state.release));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- 앱 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.notice-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
// 처음 안내를 건너뛰고, 운영체제 알림을 끄고, 말을 정한다
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
    JJ_NOTICES_URL: `http://127.0.0.1:${port}/notices.json`,
    JJ_RELEASES_API: `http://127.0.0.1:${port}/latest`,
  },
  stdio: 'ignore',
});
console.log('app pid', app.pid, 'server', port, 'lang', LANG);
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
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
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
            const r = await c.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(OUT, `${file}.png`), Buffer.from(r.result.data, 'base64'));
          },
          dark: (on) =>
            c.send('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }],
            }),
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
const current = () => main('JSON.stringify(__jj.notices.window.current ?? null)').then((v) => JSON.parse(v));
const seen = () => main('JSON.stringify(__jj.notices.seen)').then((v) => JSON.parse(v));
const locked = () => main('__jj.updates.locked()');

/** 떠 있는 공지 창을 밝은, 어두운 모드로 찍는다 */
async function capture(kind) {
  const p = await page('notice');
  await until(`${kind} 그림`, async () => (await p.ev(`document.querySelector('.kind-${kind} h1')?.textContent`)) !== undefined);
  await sleep(400);
  await p.dark(false);
  await sleep(200);
  await p.shot(`notice-${kind}-${LANG}-light`);
  await p.dark(true);
  await sleep(200);
  await p.shot(`notice-${kind}-${LANG}-dark`);
  await p.dark(false);
  const info = await p.ev(
    `JSON.stringify({ badge: document.querySelector('.badge')?.textContent, title: document.querySelector('h1')?.textContent, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`,
  );
  return { p, info: JSON.parse(info) };
}
async function press(p, id) {
  // 단추 순서는 메인의 view.buttons 와 같다
  const idx = (await current()).buttons.findIndex((b) => b.id === id);
  await until('단추', async () => (await p.ev(`document.querySelectorAll('button').length`)) > idx);
  await p.ev(`document.querySelectorAll('button')[${idx}].click()`);
}

let failed = false;
try {
  await main('1');
  await until('__jj', () => main('typeof __jj === "object"'));

  // 1. 알림: 켜고 5초 뒤 받아서 띄운다
  await until('알림 창', async () => (await current())?.kind === 'info');
  {
    const { p, info } = await capture('info');
    check('알림: 종류, 제목, 단추(자세히 보기, 닫기)', info.buttons.length === 2 && !info.overflow, JSON.stringify(info));
    check('알림: 입력을 뺏지 않음', (await main('__jj.notices.window.window.isFocused()')) === false);
    check('알림: 닫기 단추 있음', (await main('__jj.notices.window.window.isClosable()')) === true);
    await press(p, 'ok');
    await until('알림 닫힘', async () => (await current()) === null);
    const s = await seen();
    check('알림: 본 것으로 기록, 하루 몫 씀', s.done.includes('test-info-1') && !!s.dailyDay);
    await main('void __jj.notices.tick()');
    await sleep(500);
    check('알림: 다시 안 뜸', (await current()) === null);
    p.close();
  }

  // 2. 중요: 하루 상한과 상관없이, 확인을 눌러야 끝
  state.notices = { version: 1, notices: [NOTICES.info, NOTICES.important] };
  await main('__jj.notices.refresh()');
  await until('중요 창', async () => (await current())?.kind === 'important');
  {
    const { p, info } = await capture('important');
    check('중요: 확인 단추 하나', info.buttons.length === 1, JSON.stringify(info));
    await press(p, 'ok');
    await until('중요 닫힘', async () => (await current()) === null);
    check('중요: 확인 눌러 끝', (await seen()).done.includes('test-important-1'));
    p.close();
  }

  // 3. 업데이트 권장: 받을 새 버전이 있어야 뜬다
  await main('__jj.notices.debugForget()');
  state.notices = { version: 1, notices: [NOTICES.update] };
  await main('__jj.notices.refresh()');
  await sleep(1000);
  check('권장: 새 버전을 모르면 안 뜸', (await current()) === null);
  await main('__jj.updates.check(true)');
  check('권장: 확인이 새 버전을 찾음', (await main('__jj.updates.newerAvailable()')) === true);
  await main('void __jj.notices.tick()');
  await until('권장 창', async () => (await current())?.kind === 'update');
  {
    const { p, info } = await capture('update');
    check('권장: 나중에, 업데이트 단추', info.buttons.length === 2, JSON.stringify(info));
    await press(p, 'later');
    await until('권장 닫힘', async () => (await current()) === null);
    check('권장: 오늘 띄움 기록', !!(await seen()).shownDay['test-update-1']);
    p.close();
  }

  // 4. 집중 중에는 미룬다
  await main('__jj.notices.debugForget()');
  state.notices = { version: 1, notices: [NOTICES.info] };
  await main('__jj.planner.startFocus(25)');
  await main('__jj.notices.refresh()');
  await sleep(1500);
  check('집중 중: 알림 미룸', (await current()) === null);
  await main('__jj.planner.stopFocus()');
  await main('void __jj.notices.tick()');
  await until('집중 끝난 뒤 알림', async () => (await current())?.kind === 'info');
  {
    const p = await page('notice');
    await press(p, 'ok');
    await until('닫힘', async () => (await current()) === null);
    p.close();
  }

  // 5. 강제: 공지 파일 minVersion 0.4.4 (최신 0.5.0 이하) 를 두 번 받아 같으면 잠금
  state.notices = { version: 1, minVersion: '0.4.4', notices: [NOTICES.force] };
  const hits = state.noticeHits;
  await main('__jj.notices.refresh()');
  check('강제: 두 번 받음', state.noticeHits - hits >= 2, `${state.noticeHits - hits}번`);
  await until('잠금', locked, 40_000);
  await until('강제 창', async () => (await current())?.kind === 'force');
  {
    const { p, info } = await capture('force');
    check('강제: 단추는 업데이트 하나', info.buttons.length === 1, JSON.stringify(info));
    check('강제: 닫기 없음', (await main('__jj.notices.window.window.isClosable()')) === false);
    await main('__jj.notices.window.window.close()');
    await sleep(800);
    check('강제: 닫으려 해도 남음', (await current())?.kind === 'force');
    check('강제: 잠금 저장(update-lock.json)', JSON.parse(readFileSync(join(data, 'update-lock.json'), 'utf8')).minVersion === '0.4.4');
    // 백업 만들기 길: 설정 데이터 탭의 내보내기 단추가 살아 있다 (누르면 폴더 고르기 창이 떠서 누르지는 않는다)
    await main("__jj.settingsWindow.open('data')");
    const sp = await page('settings');
    const label = LANG === 'ko' ? '내보내기' : 'Export';
    const find = `[...document.querySelectorAll('button')].filter((b) => b.textContent === ${JSON.stringify(label)})`;
    await until('데이터 탭', async () => (await sp.ev(`${find}.length`)) > 0);
    const exp = await sp.ev(`JSON.stringify(${find}.map((b) => ({ t: b.textContent, d: b.disabled })))`);
    check('강제: 설정의 백업 내보내기 단추 살아 있음', JSON.parse(exp)[0]?.d === false, exp);
    sp.close();
    await main('__jj.settingsWindow.window?.close()');
    p.close();
  }

  // 6. 최신 릴리스보다 높은 minVersion 은 무시 (잠금 풀림)
  state.notices = { version: 1, minVersion: '9.9.9', notices: [] };
  await main('__jj.notices.refresh()');
  await until('풀림', async () => !(await locked()), 40_000);
  await until('강제 창 닫힘', async () => (await current()) === null);
  check('높은 minVersion: 잠그지 않음', true);
  check('높은 minVersion: 저장한 잠금 지움', (() => {
    try {
      readFileSync(join(data, 'update-lock.json'));
      return false;
    } catch {
      return true;
    }
  })());

  // 7. 두 번 받은 값이 다르면 잠그지 않는다
  state.flip = true;
  state.flipCount = 0;
  await main('__jj.notices.refresh()');
  await sleep(3000);
  check('두 번 받기가 다르면: 잠그지 않음', !(await locked()));
  state.flip = false;

  /** 0.4.4 로 다시 잠근다 */
  async function relock() {
    state.notices = { version: 1, minVersion: '0.4.4', notices: [] };
    await main('__jj.notices.refresh()');
    await until('다시 잠금', locked, 40_000);
    await until('강제 창', async () => (await current())?.kind === 'force');
  }

  // 8. 깨진 파일: 아무것도 안 띄우고 잠그지 않는다 (잠겨 있었으면 푼다)
  await relock();
  {
    const p = await page('notice');
    await until('기본 글', async () => (await p.ev(`document.querySelector('h1')?.textContent`)) !== undefined);
    const def = await p.ev(`document.querySelector('h1')?.textContent`);
    check('강제: 강제 공지가 없으면 앱 기본 글', def === (LANG === 'ko' ? '업데이트가 필요해' : 'An update is required'), def);
    await p.shot(`notice-force-default-${LANG}-light`);
    p.close();
  }
  state.notices = '{"version": 1, "minVersion": "0.4.4", "notices": [';
  await main('__jj.notices.refresh()');
  await until('깨진 파일로 풀림', async () => !(await locked()), 40_000);
  await sleep(500);
  check('깨진 파일: 창 없음, 잠그지 않음', (await current()) === null && !(await locked()));

  // 9. 너무 큰 파일 (64KB 넘음)
  await relock();
  state.notices = { version: 1, minVersion: '0.4.4', notices: [NOTICES.info], pad: 'a'.repeat(70 * 1024) };
  await main('__jj.notices.debugForget()');
  await main('__jj.notices.refresh()');
  await until('큰 파일로 풀림', async () => !(await locked()), 40_000);
  await sleep(500);
  check('큰 파일: 창 없음, 잠그지 않음', (await current()) === null && !(await locked()));

  // 10. 오프라인: 공지도 릴리스도 못 받으면 잠그지 않는다
  await relock();
  state.offline = true;
  await main('__jj.notices.refresh()');
  await main('__jj.updates.check(true)');
  await until('오프라인으로 풀림', async () => !(await locked()), 40_000);
  await sleep(500);
  check('오프라인: 창 없음, 잠그지 않음', (await current()) === null && !(await locked()));
  state.offline = false;

  // 11. 강제 창이 떠 있어도 앱은 끝낼 수 있다 (메뉴 막대의 끝내기와 같은 app.quit)
  await relock();
  // 메인은 ESM 이라 디버거에서 import 를 못 써서 createRequire 로 electron 을 부른다
  const how = await main(
    "(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); if (typeof e?.app?.quit !== 'function') return typeof e; setTimeout(() => e.app.quit(), 100); return 'quit'; })()",
  );
  if (how !== 'quit') throw new Error(`electron 을 못 부름: ${how}`);
  // 디버거가 붙어 있으면 Node 가 끝난 뒤에도 연결이 끊기길 기다린다. 끊어 준다
  mainConn.ws.close();
  await until('앱 끝남', () => appExited, 15_000);
  check('강제 창이 떠 있어도 끝내기 됨', appExited);
} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

if (!appExited) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
}
server.close();
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
