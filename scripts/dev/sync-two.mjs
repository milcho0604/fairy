// 기기 간 동기화 두 기기 통합 점검 (docs/sync-plan.md 7절). 시험용 Postgres 컨테이너와 페어리 서버(server/dist, 기능 키 sync 는 everyone)를
// 무작위 포트로 띄우고, 앱 둘(기기 A, 기기 B)을 같은 계정으로 붙여 설정 > 데이터와 계정의 "기기 간 동기화" 칸을 실제로 누른다.
// 진짜 구글, 진짜 AI, 운영 서버(fairy-api.moilga.com)는 부르지 않는다:
// - 시작 전에 서버 주소가 이 컴퓨터(127.0.0.1)인지 확인하고 아니면 멈춘다.
// - 구글 로그인은 DB 에 세션을 만들어 앱 메모리에 넣는다(__jj.server.debugSetSession, JJ_TEST_SECRETS=memory 일 때만).
//   기기 B 를 A 의 계정으로 합친 것은 calendar-link.mjs 와 같이 DB 에서 기기 줄을 옮겨 흉내 낸다.
// - 복사는 클립보드, 파일 저장은 저장 대화상자를 바꿔 끼워 사용자 클립보드와 대화상자를 건드리지 않는다.
// 보는 것: A 켜기와 복구 코드 5묶음, 적어 뒀어 체크 전에는 닫히지 않음, 복사와 파일 저장, B 에서 틀린 코드와 맞는 코드,
// A 의 메모, 할 일, 일정이 B 에 나타남, B 의 할 일 완료가 A 에 감, 서버 멈춤(오프라인) 뒤 다시 맞춤,
// 복구 코드 새로 만들기와 열쇠 바꾸기(gen), 이 컴퓨터만 끄기, 서버 사본 지우기 뒤 A 가 멈춤(epoch), 올릴지 묻기, 충돌 사본 표시.
// 단계마다 설정 화면을 찍고, 주요 단계는 넓은 폭과 좁은 폭, 밝음과 어두움으로 찍는다. 경우마다 PASS/FAIL.
//
//   npm run build && (cd server && npm run build) && OUT=<레포 밖 폴더> LANG_UNDER_TEST=ko node scripts/dev/sync-two.mjs
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 입력은 CDP 로만, 종료는 PID 로만.
// 컨테이너는 jj-synctwo-pg-<무작위> 이름으로만 만들고 `docker rm -f -v` 로 지운다. 포트는 9800~9999 에서 lsof 로 빈 것을 고른다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'sync-two-shots'));
const LANG = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const used = new Set();
/** 9800~9999 에서 아무도 듣지 않는 포트 (lsof 로 확인) */
function freePort() {
  for (let i = 0; i < 400; i++) {
    const p = 9800 + Math.floor(Math.random() * 200);
    if (used.has(p)) continue;
    try {
      execFileSync('lsof', ['-nP', `-iTCP:${p}`], { stdio: 'ignore' });
    } catch {
      used.add(p);
      return p;
    }
  }
  throw new Error('빈 포트 없음');
}

// ---- 시험용 Postgres ----
const pgName = `jj-synctwo-pg-${randomBytes(4).toString('hex')}`;
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

// ---- 페어리 서버 (구글 값 비움, 기능 키 sync 는 모두에게) ----
const apiPort = freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
// 운영 서버로 가는 일이 없게: 서버 주소는 이 컴퓨터여야 한다
if (new URL(apiUrl).hostname !== '127.0.0.1' || /moilga/i.test(apiUrl)) throw new Error(`서버 주소가 이 컴퓨터가 아니다: ${apiUrl}`);
let api;
async function startApi() {
  api = spawn(process.execPath, [join(root, 'server', 'dist', 'main.js')], {
    cwd: join(root, 'server'),
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      PUBLIC_URL: apiUrl,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      FEATURE_SYNC: 'everyone',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('서버가 뜨지 않음');
}
async function stopApi() {
  if (!api || api.exitCode !== null) return;
  const gone = new Promise((r) => api.once('exit', r));
  api.kill('SIGTERM');
  await gone;
}
await startApi();

// ---- 앱 둘 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.sync-two-test-'));

async function launch(name) {
  const data = join(scratch, `${name}-data`);
  const home = join(scratch, `${name}-home`);
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: LANG }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const inspect = freePort();
  const pagePort = freePort();
  const proc = spawn(electronPath, [`--inspect=${inspect}`, '.', `--remote-debugging-port=${pagePort}`], {
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
  const h = { name, data, proc, exited: false, inspect, pagePort, conn: undefined };
  proc.on('exit', () => {
    h.exited = true;
  });
  console.log('app', name, 'pid', proc.pid, 'ports', inspect, pagePort);
  return h;
}

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
        ws.removeEventListener('message', on);
      };
      const on = (e) => {
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
      ws.addEventListener('message', on);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}
async function main(h, expr) {
  for (let i = 0; i < 120 && !h.conn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${h.inspect}/json/list`)).json();
      h.conn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  const m = await h.conn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const WIDE = 760;
const NARROW = 380;
async function page(h, name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${h.pagePort}/json`)).json();
      const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
      if (p) {
        const c = await connect(p.webSocketDebuggerUrl);
        const ev = async (expr) =>
          (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
            ?.value;
        const clipOf = (sel) =>
          ev(
            `(() => { const e = document.querySelector(${JSON.stringify(sel)})?.closest('section'); if (!e) return null; e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 4), width: document.documentElement.clientWidth, height: Math.min(r.height + 8, 2400), scale: 1 }; })()`,
          );
        /** 칸(sel 이 든 section)을 찍는다 */
        const snap = async (file, sel = '.sync-box') => {
          await sleep(350);
          const clip = await clipOf(sel);
          const r = await c.send('Page.captureScreenshot', {
            format: 'png',
            ...(clip ? { clip, captureBeyondViewport: true } : {}),
          });
          writeFileSync(join(OUT, `${file}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
        };
        return {
          ev,
          shot: snap,
          /** 넓은 폭, 좁은 폭 x 밝음, 어두움 네 장 (파일 이름에 -wide-light 처럼 붙인다) */
          matrix: async (file, sel) => {
            for (const [w, wn] of [
              [WIDE, 'wide'],
              [NARROW, 'narrow'],
            ])
              for (const dark of [false, true]) {
                await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
                await c.send('Emulation.setEmulatedMedia', {
                  features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
                });
                await snap(`${file}-${wn}-${dark ? 'dark' : 'light'}`, sel);
                // 좁은 폭에서 가로로 삐져나가지 않는다
                const over = await ev(
                  `(() => { const s = document.querySelector('.sync-box')?.closest('section'); return s ? s.scrollWidth - s.clientWidth : 0; })()`,
                );
                if (over > 1) console.log('FAIL 가로 넘침', file, wn, over);
                results.push({ name: `가로 넘침 없음 ${file} ${wn} ${dark ? 'dark' : 'light'}`, ok: over <= 1 });
              }
            await c.send('Emulation.clearDeviceMetricsOverride');
            await c.send('Emulation.setEmulatedMedia', { features: [] });
          },
          close: () => c.ws.close(),
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`${h.name}: ${name} 화면 없음`);
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
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}
const status = async (h) => JSON.parse(await main(h, 'JSON.stringify(__jj.server.core.status())'));
const view = async (h) => JSON.parse(await main(h, 'JSON.stringify(__jj.server.sync.view())'));
const T = {
  ko: {
    turnOn: '동기화 켜기',
    ack: '적어 뒀어',
    done: '닫기',
    copy: '복사',
    save: '파일로 저장',
    submit: '코드 넣기',
    bad: '코드가 맞지 않아.',
    cancel: '이 컴퓨터는 끄기',
    newCode: '복구 코드 새로 만들기',
    rotate: '열쇠 바꾸기',
    sure: '한 번 더 눌러 확인',
    local: '이 컴퓨터만 끄기',
    wipe: '서버 사본도 지우기',
    epoch: '다른 곳에서 동기화를 다시 시작했어. 복구 코드를 넣어 줘.',
    gen: '다른 기기가 열쇠를 바꿨어. 새 복구 코드를 넣어 줘.',
    offline: '인터넷에 닿지 않아. 나중에 맞출게.',
    fresh: '방금 맞췄어.',
    askLede: '이 컴퓨터에 다른 계정에서 쓰던 메모, 할 일, 일정이 있어.',
    upload: '이 계정으로 올리기',
    download: '올리지 않고 받기만',
    copyTag: '충돌 사본',
    lede: '메모, 할 일, 일정을 이 컴퓨터에서 잠가 서버에 두고',
    unavailable: '지금은 동기화를 쓸 수 없어.',
  },
  en: {
    turnOn: 'Turn on sync',
    ack: "I've written it down",
    done: 'Close',
    copy: 'Copy',
    save: 'Save as file',
    submit: 'Enter code',
    bad: "That code doesn't match.",
    cancel: 'Turn off on this computer',
    newCode: 'Make a new recovery code',
    rotate: 'Change key',
    sure: 'Press again to confirm',
    local: 'Turn off on this computer only',
    wipe: 'Also delete the server copy',
    epoch: 'Sync was restarted somewhere else. Enter the recovery code.',
    gen: 'Another device changed the key. Enter the new recovery code.',
    offline: "Can't reach the internet. Will sync later.",
    fresh: 'Just synced.',
    askLede: 'This computer has notes, to-dos, and events from another account.',
    upload: 'Upload to this account',
    download: 'Only receive, no upload',
    copyTag: 'Conflict copy',
    lede: 'Locks your notes, to-dos, and events on this computer',
    unavailable: "Sync isn't available right now.",
  },
}[LANG];

/** 칸 안 단추를 글로 찾아 누른다 (CDP, 진짜 마우스 없이) */
const press = (p, text) =>
  p.ev(
    `(() => { const b = [...document.querySelectorAll('.sync-box button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
  );
const boxText = (p) => p.ev(`document.querySelector('.sync-box')?.innerText ?? ''`);
const boxMode = (p) => p.ev(`document.querySelector('.sync-box')?.dataset.syncMode ?? ''`);
const typeCode = (p, v) =>
  p.ev(
    `(() => { const el = document.querySelector('.sync-code-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`,
  );
const submit = (p) => p.ev(`document.querySelector('.sync-need').requestSubmit(); 1`);
const readCode = (p) => p.ev(`[...document.querySelectorAll('.sync-code-part')].map((x) => x.textContent).join('-')`);

/** 설정 창을 (다시) 열고 화면 연결 */
async function openSettings(h) {
  await main(h, "__jj.settingsWindow.open('restore'); 1");
  const p = await page(h, 'settings');
  await until(`${h.name} 설정 화면`, () => p.ev(`!!document.querySelector('.server-box')`), 40_000);
  return p;
}
const closeSettings = async (h) => {
  await main(h, '(() => { const w = __jj.settingsWindow.window; if (w && !w.isDestroyed()) w.close(); return 1; })()');
  // 창이 정말 사라진 뒤에 다시 연다 (닫는 중인 창에 열기를 보내면 새 창이 안 뜬다)
  await until(`${h.name} 설정 창 닫힘`, () => main(h, '(() => { const w = __jj.settingsWindow.window; return !w || w.isDestroyed(); })()'), 10_000);
};

/** 서버 모드(만 18세 이상) → 기기 계정이 생길 때까지 */
async function serverOn(h) {
  await until(`${h.name} __jj`, () => main(h, 'typeof __jj === "object"'), 60_000);
  await main(h, `__jj.server.core.setAge('adult')`);
  await until(`${h.name} 기기 계정`, async () => {
    const s = await status(h);
    return s.device && s.balance !== null && !s.syncing;
  });
  return sql('SELECT id FROM account WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
}
async function signIn(h, accountId) {
  const session = `fs_${randomBytes(32).toString('base64url')}`;
  sql(`INSERT INTO session (account_id, token_hash) VALUES (${accountId}, sha256('${session}'::bytea))`);
  return main(h, `__jj.server.debugSetSession(${JSON.stringify(session)})`);
}
async function featureOn(h) {
  await until(
    `${h.name} 기능 키 sync`,
    async () => {
      await main(h, '__jj.server.core.refreshProviders(true).then(() => 1)');
      return (await status(h)).features?.sync === true;
    },
    20_000,
  );
}
const runSync = (h) => main(h, '__jj.server.sync.run(true).then(() => 1)');
/** 양쪽을 번갈아 맞춘다 */
const settle = async (...hs) => {
  for (let i = 0; i < 3; i++) for (const h of hs) await runSync(h);
};
const titles = (h, what) => main(h, `JSON.stringify(${what})`).then((v) => JSON.parse(v));
const noteTitles = (h) => titles(h, `__jj.notes.list().map((n) => n.title)`);
const todoTitles = (h) => titles(h, `(() => { const l = __jj.store.list(Date.now()); return [...l.open, ...l.doneToday].map((t) => t.title + (t.doneAt ? ':done' : '')); })()`);
const eventTitles = (h) => titles(h, `__jj.events.between(0, 4e12).map((e) => e.title)`);

/** 앱 폴더 어디에도 복구 코드가 글자로 남지 않았나 */
function dataHas(dir, needles) {
  const found = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      let s;
      try {
        s = statSync(f);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(f);
      else if (s.isFile() && s.size < 80_000_000) {
        const b = readFileSync(f);
        for (const x of needles) if (b.includes(x)) found.push(`${n}:${x.slice(0, 5)}`);
      }
    }
  };
  walk(dir);
  return found;
}

const apps = [];
let failed = false;
try {
  console.log('서버 주소', apiUrl, '(이 컴퓨터)');
  // ---- 기기 A: 처음 로그인한 기기 ----
  const A = await launch('A');
  apps.push(A);
  const id = await serverOn(A);
  sql(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'test-sub-${randomBytes(4).toString('hex')}', ${id})`);
  check('A 세션 넣기', (await signIn(A, id)) === true);
  await featureOn(A);
  check('서버가 기능 키 sync 를 내려 준다 (앱 features.sync)', (await status(A)).features?.sync === true);
  // 클립보드와 저장 대화상자를 바꿔 끼운다 (사용자 클립보드와 진짜 대화상자를 건드리지 않는다)
  const savedFile = join(scratch, 'saved-code.txt');
  await main(
    A,
    `(() => { const e = process.getBuiltinModule('module').createRequire(process.cwd() + '/')('electron'); e.clipboard.writeText = (v) => { globalThis.__clip = v; }; __jj.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(savedFile)} }); return 1; })()`,
  );
  const pa = await openSettings(A);
  await until('A 동기화 칸', () => pa.ev(`!!document.querySelector('.sync-box')`));
  check('A 꺼짐 칸: 한 줄 설명과 켜기 단추', (await boxText(pa)).includes(T.lede) && (await boxText(pa)).includes(T.turnOn), await boxMode(pa));
  await pa.matrix('sync-1-off');

  // A 켜기 → 복구 코드
  check('A 켜기 단추', await press(pa, T.turnOn));
  await until('A 복구 코드 칸', () => pa.ev(`!!document.querySelector('.sync-reveal')`));
  const code = await readCode(pa);
  check('복구 코드 25글자, 5묶음', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(code), `${code.length}자`);
  check('엔진은 켜졌고(on) 칸은 코드를 먼저 보인다', (await view(A)).phase === 'on' && (await boxMode(pa)) === 'code');
  await pa.matrix('sync-2-code');
  check('적어 뒀어 전에는 닫기가 막혀 있다', !(await press(pa, T.done)) && (await pa.ev(`!!document.querySelector('.sync-reveal')`)));
  // 탭을 옮겨도(칸이 사라졌다 다시 그려져도) 코드가 남는다: 설정 창을 닫고 다시 열면 이 창 메모리가 사라지므로 닫지 않고 칸만 다시 그린다
  const copied = await pa.ev(`(async () => { const b = [...document.querySelectorAll('.sync-box button')].find((x) => x.textContent.trim() === ${JSON.stringify(T.copy)}); b.click(); await new Promise((r) => setTimeout(r, 400)); return 1; })()`);
  check('복사: 클립보드에 같은 코드', copied === 1 && (await main(A, 'globalThis.__clip')) === code);
  await press(pa, T.save);
  await sleep(500);
  const fileText = (() => {
    try {
      return readFileSync(savedFile, 'utf8');
    } catch {
      return '';
    }
  })();
  check('파일로 저장: 코드가 든 글 파일(권한 600)', fileText.includes(code) && (statSync(savedFile).mode & 0o777) === 0o600);
  check('저장 결과가 단추 아래에 보인다', /저장했어|Saved/.test(await boxText(pa)));
  await pa.ev(`document.querySelector('.sync-ack input').click(); 1`);
  await sleep(150);
  check('체크하면 닫기가 열린다', await press(pa, T.done));
  await sleep(300);
  check('닫으면 코드는 화면에서 사라진다', !(await pa.ev(`!!document.querySelector('.sync-reveal')`)) && !(await boxText(pa)).includes(code.slice(0, 5)));
  check('켜짐 칸 (방금 맞췄어)', (await boxMode(pa)) === 'on');
  await runSync(A);
  await sleep(500);
  await pa.matrix('sync-3-on');
  check('사용량 상한이 100MB 로 보인다 (서버 상한과 같은 1024 기준)', /\/ 100MB/.test(await boxText(pa)), (await boxText(pa)).split('\n').find((x) => x.includes('MB')));
  const needle = [Buffer.from(code), Buffer.from(code.replaceAll('-', ''))];
  const leaks = dataHas(A.data, needle);
  check('A 앱 폴더 어디에도 복구 코드 글자가 없다', leaks.length === 0, leaks.join(','));

  // ---- 기기 B ----
  const B = await launch('B');
  apps.push(B);
  const idB = await serverOn(B);
  sql(`UPDATE device SET account_id = ${id} WHERE account_id = ${idB}`);
  sql(`UPDATE account SET closed_at = now(), merged_into = ${id} WHERE id = ${idB}`);
  check('B 세션 넣기 (같은 계정)', (await signIn(B, id)) === true);
  await featureOn(B);
  const pb = await openSettings(B);
  await until('B 동기화 칸', () => pb.ev(`!!document.querySelector('.sync-box')`));
  check('B 꺼짐 칸', (await boxMode(pb)) === 'off');
  check('B 켜기', await press(pb, T.turnOn));
  await until('B 복구 코드 넣기 칸', () => pb.ev(`!!document.querySelector('.sync-need')`));
  check('서버에 열쇠가 있으니 B 는 복구 코드 넣기로 간다', (await view(B)).phase === 'needCode');
  await pb.matrix('sync-4-need-code');
  // 틀린 코드(모양은 맞지만 다른 코드)
  await typeCode(pb, 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE');
  await submit(pb);
  await until('틀린 코드 안내', async () => (await boxText(pb)).includes(T.bad), 40_000);
  check('틀린 코드: "코드가 맞지 않아"', (await boxText(pb)).includes(T.bad));
  await pb.shot('sync-5-bad-code');
  // 맞는 코드를 소문자, 공백, 줄바꿈 섞어 붙여넣은 것처럼
  await typeCode(pb, ` ${code.toLowerCase().replaceAll('-', ' ')}\n`);
  await submit(pb);
  await until('B 켜짐', async () => (await view(B)).phase === 'on', 40_000);
  await sleep(500);
  check('맞는 코드(소문자, 공백 섞임)를 넣으면 켜진다', (await boxMode(pb)) === 'on');
  await pb.shot('sync-6-b-on');

  // ---- A 에서 만든 것이 B 에 나타나는지 ----
  await main(
    A,
    `(() => { const now = Date.now(); __jj.notes.add({ title: '장보기 메모', body: '우유, 달걀' }, now); __jj.store.add({ title: '보고서 내기' }, now); __jj.events.add({ title: '팀 회의', startAt: now + 86400000, endAt: now + 86400000 + 3600000 }, now); return 1; })()`,
  );
  await settle(A, B);
  check('A 의 메모가 B 에 나타난다', (await noteTitles(B)).includes('장보기 메모'), (await noteTitles(B)).join('|'));
  check('A 의 할 일이 B 에 나타난다', (await todoTitles(B)).includes('보고서 내기'));
  check('A 의 일정이 B 에 나타난다', (await eventTitles(B)).includes('팀 회의'));
  // B 에서 할 일 완료 → A
  const bTodo = await main(B, `__jj.store.list(Date.now()).open.find((t) => t.title === '보고서 내기')?.id ?? 0`);
  const coinsA0 = await main(A, '__jj.store.balance()');
  await main(B, `__jj.store.complete(${bTodo}, Date.now())`);
  await settle(B, A);
  check('B 의 할 일 완료가 A 에 간다', (await todoTitles(A)).includes('보고서 내기:done'), (await todoTitles(A)).join('|'));
  check('다른 기기의 완료로 A 에 코인이 생기지 않는다', (await main(A, '__jj.store.balance()')) === coinsA0);
  await runSync(A);
  await pa.shot('sync-7-a-after');

  // ---- 서버 멈춤 (오프라인) ----
  await stopApi();
  await main(A, `__jj.notes.add({ title: '오프라인에서 쓴 메모', body: 'x' }, Date.now())`);
  await sleep(300);
  await runSync(A);
  await sleep(500);
  const vOff = await view(A);
  check('서버 멈춤: A 는 오프라인, 보낼 것이 쌓인다', vOff.offline === true && vOff.pending >= 1, JSON.stringify({ o: vOff.offline, p: vOff.pending }));
  await until('A 오프라인 문구', async () => (await boxText(pa)).includes(T.offline), 15_000).catch(() => {});
  check('칸에 "인터넷에 닿지 않아. 나중에 맞출게"와 보낼 것 N개', (await boxText(pa)).includes(T.offline) && /1|2/.test(await boxText(pa)));
  check('오프라인에서도 앱 데이터는 그대로 쓴다', (await noteTitles(A)).includes('오프라인에서 쓴 메모'));
  await pa.matrix('sync-8-offline');
  await startApi();
  // 오프라인 뒤에는 다시 시도까지 늦춘다: 힘껏(force) 돌려 서버가 돌아온 것을 알린다
  await settle(A, B);
  const vBack = await view(A);
  check('서버가 돌아오면 다시 맞춘다 (B 에 메모, 오프라인 끝)', (await noteTitles(B)).includes('오프라인에서 쓴 메모') && vBack.offline === false && vBack.pending === 0, JSON.stringify(vBack));
  await until('칸이 방금 맞췄어로', async () => (await boxText(pa)).includes(T.fresh), 15_000).catch(() => {});
  await pa.shot('sync-9-back-online');

  // ---- 충돌 사본: 같은 메모를 양쪽에서 다르게 고친다 ----
  await main(A, `__jj.notes.add({ title: '일기', body: '오늘은 맑음' }, Date.now())`);
  await settle(A, B);
  await main(A, `(() => { const n = __jj.notes.list().find((x) => x.title === '일기'); __jj.notes.update(n.id, { body: 'A 에서 완전히 다르게 씀' }, Date.now()); return 1; })()`);
  await sleep(20);
  await main(B, `(() => { const n = __jj.notes.list().find((x) => x.title === '일기'); __jj.notes.update(n.id, { body: 'B 에서 완전히 다르게 씀' }, Date.now()); return 1; })()`);
  await runSync(A);
  await runSync(B);
  await settle(A, B);
  check('충돌: 양쪽에 충돌 사본 메모가 하나씩', (await noteTitles(A)).filter((x) => x.includes('충돌 사본') || x.includes('conflict copy')).length === 1);
  check('충돌 사본 제목에 기기 이름과 날짜가 없다', (await noteTitles(A)).some((x) => /^일기 \((충돌 사본|conflict copy)\)$/.test(x)), (await noteTitles(A)).join('|'));
  await main(A, `__jj.panel.refresh(); __jj.panel.openTab('note'); 1`);
  await sleep(1200);
  await main(A, `__jj.panel.window.removeAllListeners('blur'); 1`);
  const pn = await page(A, 'panel');
  await until('A 메모 목록', () => pn.ev(`!!document.querySelector('li.note-row')`));
  await pn.ev(`document.querySelector('#ptab-note')?.click(); 1`);
  await sleep(500);
  const tags = await pn.ev(`[...document.querySelectorAll('li.note-row')].map((li) => ({ title: li.querySelector('.note-title').textContent, tag: li.querySelector('.tag.conflict-copy')?.textContent ?? '' }))`);
  const copyRows = tags.filter((x) => x.tag);
  check('메모 목록: 충돌 사본에만 작은 "충돌 사본" 표시', copyRows.length === 1 && copyRows[0].tag === T.copyTag && tags.length >= 4, JSON.stringify(tags));
  {
    const c = await connect((await (await fetch(`http://127.0.0.1:${A.pagePort}/json`)).json()).find((x) => x.type === 'page' && x.url.includes('panel.html')).webSocketDebuggerUrl);
    for (const dark of [false, true]) {
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await sleep(300);
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `sync-10-note-list-${dark ? 'dark' : 'light'}-${LANG}.png`), Buffer.from(r.result.data, 'base64'));
    }
    await c.send('Emulation.setEmulatedMedia', { features: [] });
    c.ws.close();
  }
  pn.close();
  await main(A, `__jj.panel.window.hide(); 1`).catch(() => {});

  // ---- 복구 코드 새로 만들기 (같은 열쇠, B 는 계속 맞춘다) ----
  check('A 새 코드 단추', await press(pa, T.newCode));
  await until('새 코드 칸', () => pa.ev(`!!document.querySelector('.sync-reveal')`));
  const code2 = await readCode(pa);
  check('새 복구 코드는 옛 코드와 다르다', code2 !== code && /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(code2));
  await pa.shot('sync-11-new-code');
  await pa.ev(`document.querySelector('.sync-ack input').click(); 1`);
  await sleep(150);
  await press(pa, T.done);
  await sleep(300);
  await runSync(B);
  check('복구 코드를 새로 만들어도 B 는 멈추지 않는다 (같은 열쇠)', (await view(B)).phase === 'on' && (await view(B)).problem === null);

  // ---- 열쇠 바꾸기 (gen): 위험 단추는 두 번 눌러야 한다 ----
  check('열쇠 바꾸기 첫 누름은 확인으로', (await press(pa, T.rotate)) && (await boxText(pa)).includes(T.sure));
  await pa.shot('sync-12-rotate-sure');
  await press(pa, T.sure);
  await until('열쇠 바꾸기 새 코드 칸', () => pa.ev(`!!document.querySelector('.sync-reveal')`), 40_000);
  const code3 = await readCode(pa);
  check('열쇠 바꾸기: 또 다른 새 코드', code3 !== code && code3 !== code2);
  await pa.ev(`document.querySelector('.sync-ack input').click(); 1`);
  await sleep(150);
  await press(pa, T.done);
  await sleep(300);
  await runSync(B);
  await sleep(500);
  const vB = await view(B);
  check('B 는 열쇠가 바뀐 것을 알고 복구 코드 넣기로 멈춘다 (gen)', vB.phase === 'needCode' && vB.problem === 'gen', JSON.stringify(vB));
  await until('B gen 안내', async () => (await boxText(pb)).includes(T.gen), 15_000).catch(() => {});
  check('B 칸에 "다른 기기가 열쇠를 바꿨어" 안내', (await boxText(pb)).includes(T.gen));
  await pb.matrix('sync-13-b-gen');
  await typeCode(pb, code3);
  await submit(pb);
  await until('B 다시 켜짐', async () => (await view(B)).phase === 'on', 40_000);
  await settle(A, B);
  check('새 코드를 넣으면 B 가 이어서 맞춘다 (메모가 그대로)', (await noteTitles(B)).includes('장보기 메모'));

  // ---- 이 컴퓨터만 끄기 ----
  const itemsBefore = Number(sql('SELECT count(*) FROM sync_item'));
  check('이 컴퓨터만 끄기: 첫 누름은 확인', (await press(pb, T.local)) && (await boxText(pb)).includes(T.sure));
  await press(pb, T.sure);
  await until('B 꺼짐', async () => (await view(B)).phase === 'off', 20_000);
  await sleep(400);
  check('B 만 꺼졌다: 서버 사본과 A 는 그대로', Number(sql('SELECT count(*) FROM sync_item')) === itemsBefore && (await view(A)).phase === 'on');
  check('B 의 메모, 할 일, 일정은 남는다', (await noteTitles(B)).includes('장보기 메모') && (await todoTitles(B)).length >= 1 && (await eventTitles(B)).includes('팀 회의'));
  await pb.shot('sync-14-b-off-local');
  // 다시 켜기: 같은 계정이라 묻지 않고 복구 코드만
  await press(pb, T.turnOn);
  await until('B 코드 칸', () => pb.ev(`!!document.querySelector('.sync-need')`), 20_000);
  await typeCode(pb, code3);
  await submit(pb);
  await until('B 다시 켜짐 2', async () => (await view(B)).phase === 'on', 40_000);
  check('같은 계정으로 다시 켜면 올릴지 묻지 않는다', (await view(B)).phase === 'on');

  // ---- 올릴지 묻기 (다른 계정과 맞추던 컴퓨터를 흉내) ----
  await main(B, `(() => { const s = __jj.server.sync.state(); s.ask = true; s.lastAccount = 'F-OTHER-0000'; return 1; })()`);
  await closeSettings(B);
  await sleep(500);
  const pb2 = await openSettings(B);
  await until('B 묻기 칸', async () => (await boxText(pb2)).includes(T.askLede), 20_000);
  check('다른 계정에서 쓰던 항목이 있으면 두 단추로 묻는다', (await boxText(pb2)).includes(T.upload) && (await boxText(pb2)).includes(T.download));
  await pb2.matrix('sync-15-ask-upload');
  check('올리지 않고 받기만', await press(pb2, T.download));
  await sleep(600);
  check('고르면 켜짐 칸으로', (await view(B)).phase === 'on' && (await boxMode(pb2)) === 'on');
  await closeSettings(B);

  // ---- 서버 사본 지우기: 다른 기기는 멈춘다 (epoch) ----
  const pb3 = await openSettings(B);
  await until('B 켜짐 칸', async () => (await boxMode(pb3)) === 'on');
  check('서버 사본도 지우기: 첫 누름은 확인', (await press(pb3, T.wipe)) && (await boxText(pb3)).includes(T.sure));
  await pb3.shot('sync-16-wipe-sure');
  await press(pb3, T.sure);
  await until('B 꺼짐 2', async () => (await view(B)).phase === 'off', 30_000);
  await sleep(500);
  check('서버 사본과 열쇠가 지워졌다', sql('SELECT count(*) FROM sync_item') === '0' && sql('SELECT count(*) FROM sync_key') === '0');
  check('끄고 나면 "서버 사본을 지우고 껐어"', /서버 사본을 지우고 껐어|Deleted the server copy/.test(await boxText(pb3)));
  await pb3.shot('sync-17-b-wiped');
  await runSync(A);
  await sleep(600);
  const vA = await view(A);
  check('A 는 멈춘다: 복구 코드 넣기 상태, 까닭 epoch', vA.phase === 'needCode' && vA.problem === 'epoch', JSON.stringify(vA));
  await until('A epoch 안내', async () => (await boxText(pa)).includes(T.epoch), 15_000).catch(() => {});
  check('A 칸에 "다른 곳에서 동기화를 다시 시작했어. 복구 코드를 넣어 줘"', (await boxText(pa)).includes(T.epoch));
  await pa.matrix('sync-18-a-epoch');
  check('A 의 메모, 할 일, 일정은 그대로 남는다', (await noteTitles(A)).includes('장보기 메모') && (await eventTitles(A)).includes('팀 회의'));
  // 서버에 열쇠가 없는데 옛 코드를 넣으면
  await typeCode(pa, code3);
  await submit(pa);
  await until('A 코드 오류', async () => !(await boxText(pa)).includes(T.submit) || (await pa.ev(`!!document.querySelector('#sync-need-bad')`)), 20_000);
  await sleep(300);
  check('열쇠가 없어진 서버에 옛 코드를 넣으면 막힌다', (await view(A)).phase === 'needCode' && (await pa.ev(`!!document.querySelector('#sync-need-bad')`)));
  await pa.shot('sync-19-a-epoch-bad');
  // B 가 다시 시작하면 A 가 새 코드로 이어진다
  const pb4 = await openSettings(B);
  await until('B 꺼짐 칸', async () => (await boxMode(pb4)) === 'off');
  await press(pb4, T.turnOn);
  await until('B 새 코드 칸', () => pb4.ev(`!!document.querySelector('.sync-reveal')`), 40_000);
  const code4 = await readCode(pb4);
  await pb4.ev(`document.querySelector('.sync-ack input').click(); 1`);
  await sleep(150);
  await press(pb4, T.done);
  await typeCode(pa, code4);
  await submit(pa);
  await until('A 다시 켜짐', async () => (await view(A)).phase === 'on', 40_000);
  await settle(A, B);
  check('다시 시작한 곳의 새 코드를 A 가 넣으면 이어서 맞춘다', (await view(A)).phase === 'on' && (await view(A)).problem === null);
  await pa.shot('sync-20-a-resumed');

  // 기능 키가 꺼져도 켜 둔 기기는 "쓸 수 없어"와 끄기만 보인다
  sql(`INSERT INTO feature_flag (key, mode) VALUES ('sync', 'off') ON CONFLICT (key) DO UPDATE SET mode = 'off'`);
  await until('A 기능 키 꺼짐', async () => {
    await main(A, '__jj.server.core.refreshProviders(true).then(() => 1)');
    return (await status(A)).features?.sync === false;
  }, 20_000);
  await until('A 쓸 수 없음 칸', async () => (await boxText(pa)).includes(T.unavailable), 15_000);
  check('키가 꺼졌어도 켜 둔 기기: 쓸 수 없다는 한 줄과 끄기 단추만', !(await boxText(pa)).includes(T.newCode) && (await boxText(pa)).includes(T.local));
  await pa.shot('sync-3b-unavailable');
  // 가로 넘침, 영어 화면에 한글, 줄표
  const allText = await boxText(pa);
  check('긴 줄표와 가운뎃점이 없다', !/[\u2014\u00b7]/.test(allText));
  if (LANG === 'en') check('영어판에 한글 없음', !/[가-힣]/.test(allText));
  check('"모드"라는 낱말이 없다', !allText.includes('모드'));
  check('A 앱 폴더 어디에도 새 복구 코드 글자가 없다', dataHas(A.data, [Buffer.from(code4), Buffer.from(code3)]).length === 0);
} catch (e) {
  failed = true;
  console.log('FAIL 시험 중단:', e instanceof Error ? e.stack : e);
} finally {
  // 종료는 PID 로만
  for (const h of apps) {
    try {
      h.conn?.ws.close();
    } catch {}
    if (!h.exited) h.proc.kill('SIGTERM');
  }
  for (let i = 0; i < 40 && apps.some((h) => !h.exited); i++) await sleep(250);
  for (const h of apps) if (!h.exited) h.proc.kill('SIGKILL');
  await stopApi().catch(() => {});
  dropPg();
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS${bad.length ? `, FAIL: ${bad.map((r) => r.name).join(' | ')}` : ''}`);
process.exit(failed || bad.length ? 1 : 0);
