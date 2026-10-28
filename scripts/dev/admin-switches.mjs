// 기능 스위치 표 화면 시험 (#156): 웹 /admin 설정 칸의 기능 스위치 한 표(채팅 이용권 포함)를 헤드리스 Chrome(CDP, 창 없음)으로
// 폭 1280 과 360, 밝은 어두운 모드에서 본다: 표 구성, 확인 칸, 바꾸기, 이전 값과 되돌리기, 낡은 화면의 거절, 운영 기록,
// 예산과 정책과 백업이 한 칸, 휴대폰 카드, 넘침, CSP 를 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-switches.mjs
//
// 시험용 Postgres(jj-admin156-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 기능 스위치 탭과 채팅 이용권 탭 그림만 찍는다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-switches-shots'));
const TAG = process.env.TAG === 'before' ? 'before' : 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function pick() {
  for (let i = 0; i < 200; i++) {
    const port = 9800 + randomInt(200);
    const free = await new Promise((r) => {
      const s = createServer();
      s.once('error', () => r(false));
      s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) return port;
  }
  throw new Error('빈 포트 없음');
}
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pgName = `jj-admin156-pg-${randomBytes(4).toString('hex')}`;
const pgPass = randomBytes(12).toString('hex');
const dropPg = () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', pgName], { stdio: 'ignore' });
  } catch {}
};
process.on('exit', dropPg);
docker('run', '-d', '--rm', '--tmpfs', '/var/lib/postgresql/data', '--name', pgName, '--log-opt', 'max-size=1m', '-e', `POSTGRES_PASSWORD=${pgPass}`,
  '-e', 'POSTGRES_USER=fairy', '-e', 'POSTGRES_DB=fairy', '-p', '127.0.0.1::5432', 'postgres:16-alpine');
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
execFileSync(process.execPath, [join(SERVER_ROOT, 'scripts', 'migrate.mjs')], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'ignore',
});

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin156-'));
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
  cwd: SERVER_ROOT,
  env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, RELEASES_API: 'http://127.0.0.1:9/latest', ADMIN_TOKEN, ANTHROPIC_API_KEY: 'fake-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' },
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${apiUrl}/health`)).ok) break;
  } catch {}
  await sleep(250);
}

const results = [];
function check(name, ok, extra = '') {
  if (TAG === 'before') return;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !extra ? '' : ` (${extra})`}`);
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method) for (const l of listeners) l(m);
  });
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
  const once = (name, ms = 20_000) =>
    new Promise((r, j) => {
      const timer = setTimeout(() => j(new Error(`사건 없음: ${name}`)), ms);
      const l = (m) => {
        if (m.method === name) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(l), 1);
          r(m.params);
        }
      };
      listeners.push(l);
    });
  return { ws, send, once, on: (cb) => listeners.push(cb) };
}

let chrome;
let failed = false;
const pageErrors = [];
try {
  // ---- 자료: 이용자 셋, 친구 맺기는 허용 목록 둘, 카카오 로그인은 모두, 채팅 이용권은 허용 목록 ----
  sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '고양이', 'F-ABCD-0001'), ('18+', '강아지', 'F-ABCD-0002'), ('18+', NULL, 'F-ABCD-0003')`);
  sql(`INSERT INTO feature_flag (key, mode) VALUES ('friends', 'allowlist'), ('kakao_login', 'everyone')`);
  sql(`UPDATE feature_flag SET mode = 'allowlist' WHERE key = 'ai_chat'`);
  sql(`INSERT INTO feature_allow (key, account_id) SELECT 'friends', id FROM account WHERE code IN ('F-ABCD-0001', 'F-ABCD-0002')`);

  const chromePort = await pick();
  const profile = join(scratch, 'chrome');
  mkdirSync(profile, { recursive: true });
  chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--disable-features=MacAppCodeSignClone', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  );
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json()).find((x) => x.type === 'page');
    } catch {}
    if (!target) await sleep(250);
  }
  const c = await connect(target.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !String(m.params.entry.url ?? '').includes('favicon')) pageErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const size = (width, height = 860) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const scheme = (dark) => c.send('Emulation.setEmulatedMedia', { features: dark ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [] });
  const nav = async (url) => {
    const blank = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: 'about:blank' });
    await blank;
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url });
    await loaded;
    await sleep(200);
  };
  const shot = async (name, selector, maxH = 3200) => {
    const box = selector
      ? await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y + scrollY - 8), width: document.documentElement.clientWidth, height: Math.min(r.height + 16, ${maxH}) }; })()`)
      : null;
    await sleep(200);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 1 }, captureBeyondViewport: true } : {}) });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const submitAndWait = async (formSel) => {
    const loaded = c.once('Page.loadEventFired');
    await ev(`document.querySelector(${JSON.stringify(formSel)}).requestSubmit(); true`);
    await loaded;
    await sleep(300);
  };
  const login = async () => {
    await nav(`${apiUrl}/admin`);
    await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
    await submitAndWait('form[action="/admin/login"]');
  };
  const overflow = () => ev(`document.documentElement.scrollWidth <= innerWidth`);
  const row = (key) => `tr.sw[data-key="${key}"]`;
  const formIn = (key, kind) => `${row(key)} form.sw-form${kind === 'undo' ? ':has(input[name=revert])' : ':not(:has(input[name=revert]))'}`;
  const tick = (sel) => ev(`document.querySelector(${JSON.stringify(sel + ' input[name=confirm]')}).checked = true; true`);
  const rowText = (key) => ev(`document.querySelector(${JSON.stringify(row(key))}).textContent`);

  await size(1280, 900);
  await login();

  if (TAG === 'before') {
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#settings/features`);
      await shot(`features-before-${w}`, '#sub-settings-features');
      console.log(`옛 기능 스위치 탭 높이 ${w}:`, await ev(`Math.round(document.querySelector('#sub-settings-features').getBoundingClientRect().height)`));
      await nav(`${apiUrl}/admin#settings/ai`);
      await shot(`config-before-${w}`, '#sub-settings-ai');
    }
    console.log('이전 그림만 찍음', OUT);
  } else {
    const KEYS = ['ai_chat', 'kakao_login', 'coin_reset', 'calendar_link_hint', 'friends', 'friend_gifts', 'friend_calendar', 'friend_visit', 'friend_gift_passes'];
    const modeOf = (key) => sql(`SELECT COALESCE((SELECT mode FROM feature_flag WHERE key = '${key}'), '(없음)')`);

    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await nav(`${apiUrl}/admin#settings/features`);
        await shot(`features-${tag}`, '#sub-settings-features');
        if (!dark) console.log(`새 기능 스위치 칸 높이 ${w}:`, await ev(`Math.round(document.querySelector('#sub-settings-features').getBoundingClientRect().height)`));
        check(`[${tag}] 한 표에 스위치 ${KEYS.length}개, 채팅 이용권 줄 포함`, (await ev(`document.querySelectorAll('table.switches tbody tr.sw').length`)) === KEYS.length && (await ev(`!!document.querySelector('tr.sw[data-key=ai_chat]')`)));
        check(`[${tag}] 줄마다 설명, 상태, 영향, 바꾸는 폼`, (await ev(`[...document.querySelectorAll('tr.sw')].every((r) => r.querySelector('td[data-l=설명]') && r.querySelector('td[data-l=상태] .tag') && r.querySelector('td[data-l=영향]').textContent.trim() && r.querySelector('select[name=mode]') && r.querySelector('input[name=confirm][required]') && r.querySelector('button'))`)) === true);
        check(`[${tag}] 영향 글: 친구 맺기는 허용 목록 2명, 카카오 로그인은 모두`, (await ev(`document.querySelector('tr.sw[data-key=friends] td[data-l=영향]').textContent`)).includes('허용 목록 2명') && (await ev(`document.querySelector('tr.sw[data-key=kakao_login] td[data-l=영향]').textContent`)).includes('모두 써요'));
        check(`[${tag}] 가로 넘침 없음`, await overflow());
        check(`[${tag}] 표 안 단추가 화면 폭 안`, (await ev(`[...document.querySelectorAll('tr.sw button')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.left >= -0.5; })`)) === true);
        const wide = await ev(`[...document.querySelectorAll('tr.sw')].flatMap((r) => { const R = r.getBoundingClientRect(); return [...r.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > R.right + 0.5).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + '>' + Math.round(R.right)); }).slice(0, 6)`);
        check(`[${tag}] 줄 안의 모든 요소가 줄 폭을 넘지 않는다 (scrollWidth, 오른쪽 끝)`, wide.length === 0 && (await ev(`[...document.querySelectorAll('tr.sw')].every((r) => r.scrollWidth <= r.clientWidth + 1)`)) === true, JSON.stringify(wide));
        const lab = await ev(`(() => { const l = document.querySelector('tr.sw label.confirm'); const cs = getComputedStyle(l); const td = l.closest('td'); return [cs.display, cs.gridTemplateColumns, l.scrollWidth, l.clientWidth, Math.round(l.getBoundingClientRect().right), Math.round(td.getBoundingClientRect().right), td.scrollWidth, td.clientWidth, l.parentElement.clientWidth].join(' '); })()`);
        check(`[${tag}] 확인 체크 글이 줄바꿈되어 칸 안에 들어온다`, (await ev(`[...document.querySelectorAll('tr.sw label.confirm')].every((l) => l.scrollWidth <= l.clientWidth + 1 && l.getBoundingClientRect().right <= l.closest('td').getBoundingClientRect().right + 0.5)`)) === true, lab);
        check(`[${tag}] 상태 배지가 한 줄`, (await ev(`[...document.querySelectorAll('tr.sw .tag')].every((t) => t.getClientRects().length === 1 && t.getBoundingClientRect().height < 26)`)) === true);
        if (w === 360) {
          check(`[${tag}] 휴대폰 폭에서 표는 카드로 (머리글 숨김, 줄이 블록, 칸 이름이 앞에)`, (await ev(`getComputedStyle(document.querySelector('table.switches thead')).display`)) === 'none' && (await ev(`getComputedStyle(document.querySelector('tr.sw')).display`)) === 'block' && (await ev(`getComputedStyle(document.querySelector('tr.sw td[data-l=상태]'), '::before').content`)).includes('상태'));
          check(`[${tag}] 휴대폰 단추 높이 42px 이상`, (await ev(`[...document.querySelectorAll('tr.sw button')].every((b) => b.getBoundingClientRect().height >= 41.5)`)) === true);
        }
        const contrast = await ev(`(() => {
          const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
          const bg = lum(getComputedStyle(document.querySelector('#sub-settings-features section')).backgroundColor);
          return [...document.querySelectorAll('tr.sw .tag, tr.sw small, tr.sw summary')].map((t) => { const l = lum(getComputedStyle(t).color); const [a, b] = l > bg ? [l, bg] : [bg, l]; return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10; });
        })()`);
        check(`[${tag}] 상태 태그와 보조 글 대비 4.5 이상`, contrast.length > 0 && contrast.every((x) => x >= 4.5), JSON.stringify(contrast));

        // ---- 예산, 정책, 백업이 한 칸 ----
        await nav(`${apiUrl}/admin#settings/ai`);
        await shot(`config-${tag}`, '#sub-settings-ai');
        const cfg = await ev(`document.querySelector('#sub-settings-ai').innerText`);
        check(`[${tag}] 한 칸에 예산, 정책, 백업 현황`, cfg.includes('예산과 정책') && cfg.includes('정책 저장') && cfg.includes('백업 현황') && cfg.includes('이용자 서버 백업'));
        check(`[${tag}] 설정 아래 칸은 셋 (기능 스위치, 예산 정책 백업, 운영 기록)`, (await ev(`document.querySelectorAll('#cell-settings .subnav a').length`)) === 3);
        check(`[${tag}] 예산 칸 가로 넘침 없음`, await overflow());
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 옛 주소 #settings/backup 은 같은 칸 ----
    await nav(`${apiUrl}/admin#settings/backup`);
    check('#settings/backup 주소가 예산, 정책, 백업 칸을 연다', (await ev(`getComputedStyle(document.querySelector('#sub-settings-ai')).display`)) !== 'none' && (await ev(`document.querySelector('.subnav a[aria-current=page]').dataset.sub`)) === 'settings/ai');

    // ---- 확인 없이는 제출할 수 없다 ----
    await nav(`${apiUrl}/admin#settings/features`);
    await ev(`document.querySelector(${JSON.stringify(row('coin_reset') + ' select[name=mode]')}).value = 'everyone'; true`);
    check('확인 칸을 체크하지 않으면 제출이 막힌다 (브라우저 검증)', (await ev(`document.querySelector(${JSON.stringify(formIn('coin_reset', 'change'))}).checkValidity()`)) === false);

    // ---- 바꾸기: 확인하고 바꾸면 DB, 운영 기록, 이전 값, 되돌리기 ----
    const logsBefore = Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'feature.mode'`));
    await tick(formIn('coin_reset', 'change'));
    await submitAndWait(formIn('coin_reset', 'change'));
    check('바꾸면 DB 의 모드가 바뀐다', modeOf('coin_reset') === 'everyone');
    check('운영 기록에 이전 값과 바뀐 값이 남는다', Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'feature.mode'`)) === logsBefore + 1 && sql(`SELECT detail::text FROM admin_log WHERE action = 'feature.mode' ORDER BY id DESC LIMIT 1`).includes('"before": "off"'));
    check('결과 글이 그 줄 안에 보이고 설정 칸에 머문다', (await rowText('coin_reset')).includes('coin_reset 모드: off → everyone') && (await ev(`location.hash`)).startsWith('#settings/features'));
    check('바뀐 줄에 이전 값(끔)과 되돌리기가 생긴다', (await rowText('coin_reset')).includes('이전 값: 끔') && (await ev(`!!document.querySelector(${JSON.stringify(formIn('coin_reset', 'undo'))})`)));
    await shot('features-after-change-1280', '#sub-settings-features');

    // ---- 되돌리기 ----
    await tick(formIn('coin_reset', 'undo'));
    await submitAndWait(formIn('coin_reset', 'undo'));
    check('되돌리기를 누르면 이전 값(끔)으로 돌아간다', modeOf('coin_reset') === 'off');
    check('되돌린 기록에 되돌림 표시', sql(`SELECT detail->>'revert' FROM admin_log WHERE action = 'feature.mode' ORDER BY id DESC LIMIT 1`) === 'true');
    await nav(`${apiUrl}/admin?la=feature.mode#settings/log`);
    check('운영 기록 화면에 "(되돌림)" 이 보인다', (await ev(`document.querySelector('#sub-settings-log').innerText`)).includes('(되돌림)'));

    // ---- 낡은 화면: 열어 둔 채 다른 곳에서 바뀌면 거절 ----
    await nav(`${apiUrl}/admin#settings/features`);
    sql(`INSERT INTO feature_flag (key, mode) VALUES ('friend_gifts', 'everyone') ON CONFLICT (key) DO UPDATE SET mode = 'everyone'`);
    await ev(`document.querySelector(${JSON.stringify(row('friend_gifts') + ' select[name=mode]')}).value = 'off'; true`);
    await tick(formIn('friend_gifts', 'change'));
    await submitAndWait(formIn('friend_gifts', 'change'));
    check('낡은 화면에서 누르면 "다른 곳에서 먼저 바꿨어요" 로 거절하고 덮어쓰지 않는다', (await rowText('friend_gifts')).includes('다른 곳에서 먼저 바꿨어요') && modeOf('friend_gifts') === 'everyone');
    await shot('features-stale-1280', '#sub-settings-features');

    // ---- 채팅 이용권도 같은 표 ----
    await nav(`${apiUrl}/admin#settings/features`);
    await ev(`document.querySelector(${JSON.stringify(row('ai_chat') + ' select[name=mode]')}).value = 'everyone'; true`);
    await tick(formIn('ai_chat', 'change'));
    await submitAndWait(formIn('ai_chat', 'change'));
    check('채팅 이용권을 표에서 바꾼다 (DB 모드, 기록 ai.mode)', modeOf('ai_chat') === 'everyone' && sql(`SELECT count(*) FROM admin_log WHERE action = 'ai.mode'`) === '1');
    check('채팅 이용권 줄에도 이전 값(허용 목록)과 되돌리기', (await rowText('ai_chat')).includes('이전 값: 허용 목록') && (await ev(`!!document.querySelector(${JSON.stringify(formIn('ai_chat', 'undo'))})`)));
    await tick(formIn('ai_chat', 'undo'));
    await submitAndWait(formIn('ai_chat', 'undo'));
    check('채팅 이용권 되돌리기', modeOf('ai_chat') === 'allowlist');

    // ---- 허용 계정 ----
    await nav(`${apiUrl}/admin#settings/features`);
    check('허용 계정 칸이 기능마다 있다 (채팅 이용권은 예산 칸에)', (await ev(`document.querySelectorAll('details.allow').length`)) === 7);

    // ---- 보안 머리, 인라인 없음 ----
    const head = await fetch(`${apiUrl}/admin`);
    const csp = head.headers.get('content-security-policy') ?? '';
    check('CSP: style-src self, script-src self, 인라인 허용 없음', csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
    const live = await ev(`document.documentElement.outerHTML`);
    check('설정 칸에 인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(live.slice(live.indexOf('id="cell-settings"'))) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
    check('쪽 안 오류 없음 (콘솔, 예외)', pageErrors.length === 0, pageErrors.join(' | '));
  }
} catch (err) {
  failed = true;
  console.error('시험 중 오류', err);
} finally {
  chrome?.kill('SIGKILL');
  api.kill('SIGKILL');
  dropPg();
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
process.exit(failed || bad.length ? 1 : 0);
