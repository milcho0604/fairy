// 운영자 홈 시험 (#152): 웹 /admin 홈의 할 일 카드, 일별 추이 막대(서버가 그린 SVG), 백업 현황, 잠기는 인원을 헤드리스 Chrome(CDP, 창 없음)으로
// 폭 1280 과 360, 밝은 어두운 모드에서 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-home.mjs
//
// 시험용 Postgres(jj-admin152-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 서버 백업 키와 폴더는 시험용 값(상한 0.001GB)이다. 앱 요약(할 일 몇 줄, 오늘 숫자, 백업 줄)은 scripts/dev/admin-ia.mjs 의 ONLY=app 이 ko, en 으로 본다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 홈 그림만 찍는다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-home-shots'));
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
const pgName = `jj-admin152-pg-${randomBytes(4).toString('hex')}`;
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin152-'));
mkdirSync(join(scratch, 'backups'), { recursive: true });
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
  cwd: SERVER_ROOT,
  env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, RELEASES_API: 'http://127.0.0.1:9/latest', ADMIN_TOKEN, ANTHROPIC_API_KEY: 'fake-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', AI_MONTHLY_BUDGET_USD: '10', BACKUP_ENC_KEY: randomBytes(32).toString('hex'), BACKUP_DIR: join(scratch, 'backups'), BACKUP_TOTAL_MAX_GB: '0.001' },
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
  // ---- 자료 ----
  // 계정 40: 14일에 걸쳐 가입, 판 분포 (0.4.0 여섯, 0.5.0 열, 0.5.1 스물, 모름 넷)
  sql(`INSERT INTO account (age, nickname, code, created_at, last_active_at, app_version)
       SELECT '18+', 'cat' || g, 'F-' || upper(lpad(to_hex(g / 65536), 4, '0')) || '-' || upper(lpad(to_hex(g % 65536), 4, '0')),
              now() - ((g * 7) % 330) * interval '1 hour', now() - (g % 20) * interval '1 day',
              CASE WHEN g <= 6 THEN '0.4.0' WHEN g <= 16 THEN '0.5.0' WHEN g <= 36 THEN '0.5.1' ELSE NULL END
         FROM generate_series(1, 40) g`);
  sql(`INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day, created_at)
       SELECT 'e' || g, (SELECT min(id) FROM account) + (g % 40), 'todo', 1, 1, 'ok', current_date, now() - ((g * 5) % 300) * interval '1 hour' FROM generate_series(1, 400) g`);
  sql(`INSERT INTO ai_usage (account_id, day, model, status, cost_micros, created_at)
       SELECT (SELECT min(id) FROM account) + (g % 40), current_date, 'm', 'ok', 20000 + (g % 13) * 30000, now() - ((g * 3) % 320) * interval '1 hour' FROM generate_series(1, 150) g`);
  // 서버 백업 여섯: 합 87만 바이트 (상한 0.001GB 의 81%)
  sql(`INSERT INTO backup (account_id, file, size, sha256, created_at)
       SELECT (SELECT min(id) FROM account) + g, md5(g::text), 145000, decode(md5(g::text) || md5(g::text), 'hex'), now() - g * interval '9 hours' FROM generate_series(1, 6) g`);
  // 신고 셋, 이틀 안에 끝나는 이벤트 하나, 하루 안에 끝나는 쿠폰 하나
  sql(`INSERT INTO ai_report (account_id, question, answer) SELECT (SELECT min(id) FROM account) + g, 'q', 'a' FROM generate_series(1, 3) g`);
  sql(`INSERT INTO event (id, kind, title_ko, title_en, body_ko, body_en, starts_at, ends_at, coins) VALUES ('soon1', 'gift', '곧 끝나', 'Ends soon', '본문', 'body', now() - interval '1 day', now() + interval '2 days', 5)`);
  sql(`INSERT INTO coupon (code_hash, hint, label, coins, tickets, starts_at, ends_at, max_uses) VALUES (decode(md5('a') || md5('b'), 'hex'), 'ABCD', '곧 끝나는 쿠폰', 5, 0, now() - interval '1 day', now() + interval '20 hours', 10)`);
  sql(`INSERT INTO site_doc (name, body) VALUES ('notices', '{"minVersion":"0.5.0","restrictVersion":"0.5.1"}'::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`);

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
  const shot = async (name, selector, maxH = 2400) => {
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

  await size(1280, 900);
  await login();

  if (TAG === 'before') {
    for (const [w, h] of [[1280, 700], [360, 700]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#home`);
      await shot(`home-before-${w}`, '#cell-home');
    }
    console.log('이전 그림만 찍음', OUT);
  } else {
    const overflow = () => ev(`document.documentElement.scrollWidth <= innerWidth`);
    // 막대(fill)나 글(color)과 배경의 대비. 단색이라 겹침 없이 그대로 잰다
    const contrast = (sel, bgSel, prop) => ev(`(() => {
      const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const a = lum(getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]);
      const b = lum(getComputedStyle(document.querySelector(${JSON.stringify(bgSel)})).backgroundColor);
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
    })()`);

    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await nav(`${apiUrl}/admin#home`);
        const text = await ev(`document.querySelector('#cell-home').innerText`);
        await shot(`home-${tag}`, '#cell-home');

        // ---- 할 일 카드 ----
        const cards = await ev(`[...document.querySelectorAll('#cell-home ul.todo a')].map((a) => [a.getAttribute('href'), a.textContent])`);
        const want = [
          ['#reports', '처리하지 않은 신고가 3건 있어요'],
          ['#settings/ai', '이번 달 비용이 예산의'],
          ['#announce/events', '3일 안에 끝나는 이벤트가 1개 있어요'],
          ['#announce/coupons', '3일 안에 끝나는 쿠폰이 1개 있어요'],
          ['#settings/backup', '서버 백업이 상한의 81%를 썼어요'],
        ];
        for (const [href, label] of want)
          check(`[${tag}] 할 일 카드 ${href}: ${label}`, cards.some(([hh, tt]) => hh === href && tt.includes(label)), JSON.stringify(cards));
        check(`[${tag}] 백업 한 줄에 마지막 올라온 때와 파일 수와 사용 비율`, /마지막으로 올라온 때 20\d\d-\d\d-\d\d \d\d:\d\d, 파일 6개/.test(text) && text.includes('상한의 81%'), text.slice(0, 300));

        // ---- 추이 ----
        check(`[${tag}] 추이 막대 그림 넷, 각 14칸`, (await ev(`[...document.querySelectorAll('#trend svg.trend-svg')].map((s) => s.querySelectorAll('rect').length).join()`)) === '14,14,14,14');
        check(`[${tag}] 그림이 카드 안에 들어가고 가로 넘침이 없다`, (await ev(`[...document.querySelectorAll('#trend svg.trend-svg')].every((s) => { const r = s.getBoundingClientRect(), p = s.parentElement.getBoundingClientRect(); return r.width > 100 && r.left >= p.left - 1 && r.right <= p.right + 1; })`)) && (await overflow()));
        check(`[${tag}] 막대에 마우스 글(title)과 읽기 글(aria-label)`, (await ev(`[...document.querySelectorAll('#trend svg.trend-svg')].every((s) => s.getAttribute('role') === 'img' && s.getAttribute('aria-label').includes('최근 14일') && s.querySelectorAll('rect > title').length === 14)`)) === true);
        check(`[${tag}] 오늘 막대만 today`, (await ev(`[...document.querySelectorAll('#trend svg.trend-svg')].every((s) => s.querySelectorAll('rect.today').length === 1 && s.lastElementChild.classList.contains('today'))`)) === true);
        const cr = await contrast('#trend svg.trend-svg rect.bar:not(.zero):not(.today)', '#trend', 'fill');
        const crT = await contrast('#trend svg.trend-svg rect.today', '#trend', 'fill');
        check(`[${tag}] 막대와 배경 대비 3 이상 (일반 ${cr}, 오늘 ${crT})`, cr >= 3 && crT >= 3);
        check(`[${tag}] 추이 안내 글 대비 4.5 이상`, (await contrast('#trend p.hint', '#trend', 'color')) >= 4.5);
        // 숫자 표
        await ev(`document.querySelector('#trend details summary').click(); true`);
        check(`[${tag}] "숫자로 보기" 를 열면 14행`, (await ev(`document.querySelectorAll('#trend table.trend-table tbody tr').length`)) === 14);
        check(`[${tag}] 표의 가입 합이 DB 와 같다 (한국 날짜 14일)`, (await ev(`[...document.querySelectorAll('#trend table.trend-table tbody tr')].reduce((s, r) => s + Number(r.children[1].textContent), 0)`)) === Number(sql(`SELECT count(*) FROM account WHERE created_at >= ((((now() AT TIME ZONE 'Asia/Seoul')::date) - 13)::timestamp AT TIME ZONE 'Asia/Seoul')`)));

        // ---- 잠기는 인원 ----
        check(`[${tag}] 앱 판 분포에 잠기는 인원 (최소 0.5.0: 0.4.0 여섯과 판 모름 넷 = 10명, 기능 제한 0.5.1: 0.5.0 열 명)`, text.includes('앱이 잠기는 계정 10명') && text.includes('서버 기능이 거절되는 계정 10명') && text.includes('판을 모르는 4명 포함'), text.slice(text.indexOf('앱 판 분포'), text.indexOf('앱 판 분포') + 300));
        check(`[${tag}] 잠기는 인원 경고 글 대비 4.5 이상`, (await contrast('#cell-home p.warn-text', '#cell-home section', 'color')) >= 4.5);
        check(`[${tag}] 가로 넘침 없음`, await overflow());
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 카드를 누르면 그 칸이 보인다 ----
    for (const [href, cell, sub] of [['#reports', 'reports', ''], ['#announce/events', 'announce', 'announce/events'], ['#announce/coupons', 'announce', 'announce/coupons'], ['#settings/ai', 'settings', 'settings/ai'], ['#settings/backup', 'settings', 'settings/backup']]) {
      await nav(`${apiUrl}/admin#home`);
      await ev(`document.querySelector('#cell-home ul.todo a[href="${href}"]').click(); true`);
      await sleep(300);
      const ok = (await ev(`location.hash`)) === href && (await ev(`getComputedStyle(document.querySelector('#cell-${cell}')).display`)) !== 'none' && (!sub || (await ev(`getComputedStyle(document.querySelector('#sub-${sub.replace('/', '-')}')).display`)) !== 'none');
      check(`카드 ${href} 를 누르면 그 자리가 보인다`, ok);
    }

    // ---- 설정/백업 현황 ----
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await nav(`${apiUrl}/admin#settings/backup`);
        const t = await ev(`document.querySelector('#sub-settings-backup').innerText`);
        await shot(`backup-${tag}`, '#sub-settings-backup');
        check(`[${tag}] 백업 현황: 켜짐, 파일 6개, 총 크기와 상한, 81%`, t.includes('켜짐') && t.includes('6개') && t.includes('상한 1.0MB') && t.includes('81%'), t.slice(0, 300));
        check(`[${tag}] 백업 현황: 실패 기록과 덤프는 모른다고 쓴다`, t.includes('기록 없음') && (t.match(/알 수 없어요/g) ?? []).length >= 3 && t.includes('맥미니 외장 디스크'));
        check(`[${tag}] 백업 현황 가로 넘침 없음`, await overflow());
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 보안 머리, 인라인 없음 ----
    const head = await fetch(`${apiUrl}/admin`);
    const csp = head.headers.get('content-security-policy') ?? '';
    check('CSP: style-src self, script-src self, 인라인 허용 없음', csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
    await nav(`${apiUrl}/admin#home`);
    const live = await ev(`document.documentElement.outerHTML`);
    check('홈과 설정에 인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(live) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
    // 로그인 없이는 그림도 숫자도 없다
    const anon = await (await fetch(`${apiUrl}/admin`)).text();
    check('로그인 없이는 추이 그림이 없다', !anon.includes('trend-svg') && !anon.includes('백업 현황'));
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
