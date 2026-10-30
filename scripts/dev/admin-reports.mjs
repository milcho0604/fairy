// 신고 처리 화면 시험 (#151): 웹 /admin 의 신고 칸을 헤드리스 Chrome(CDP, 창 없음)으로 폭 1280 과 360, 밝은 어두운 모드에서
// 목록(대화 글 없음), 열기(운영 기록), 상태 바꾸기, 낡은 화면의 거절, 막기, 이용자 상세의 신고, 홈 카드, 넘침, CSP 를 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-reports.mjs
//
// 시험용 Postgres(jj-admin151-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 앱 요약(신고 대기 개수)은 scripts/dev/admin-ia.mjs 의 ONLY=app 이 ko, en 으로 본다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 신고 칸 그림만 찍는다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-reports-shots'));
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
const pgName = `jj-admin151-pg-${randomBytes(4).toString('hex')}`;
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin151-'));
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
  // ---- 자료: 이용자 셋, 신고 여섯 (미처리 셋, 확인 하나, 조치 둘) ----
  sql(`INSERT INTO account (age, nickname, code) VALUES ('18+', '고양이', 'F-ABCD-0001'), ('18+', '강아지', 'F-ABCD-0002'), ('18+', NULL, 'F-ABCD-0003')`);
  const acc = (code) => sql(`SELECT id FROM account WHERE code = '${code}'`);
  const long = '긴 답 '.repeat(700);
  const rows = [
    [acc('F-ABCD-0001'), 'SECRETQ-하나 질문', 'SECRETA-하나 답 <b>굵게</b> & "따옴표"', 'pending'],
    [acc('F-ABCD-0001'), '두 번째 질문', long, 'pending'],
    [acc('F-ABCD-0002'), '', 'SECRETA-질문 없는 신고의 답', 'pending'],
    [acc('F-ABCD-0002'), '확인된 질문', '확인된 답', 'seen'],
    [acc('F-ABCD-0003'), '조치된 질문', '조치된 답', 'done'],
    [acc('F-ABCD-0003'), '조치된 질문 둘', '조치된 답 둘', 'done'],
  ];
  // 옛 판(TAG=before)은 처리 상태 열이 없어 그것 없이 넣는다
  for (const [a, q, an, st] of TAG === 'before' ? rows.map((r) => [...r.slice(0, 3), 'pending']) : rows)
    sql(`${TAG === 'before' ? `INSERT INTO ai_report (account_id, question, answer) VALUES (${a}, $q$${q}$q$, $a$${an}$a$)` : `INSERT INTO ai_report (account_id, question, answer, status, handled_by, handled_name, handled_at) VALUES (${a}, $q$${q}$q$, $a$${an}$a$, '${st}', ${st === 'pending' ? 'NULL' : "'admin:abcd1234'"}, ${st === 'pending' ? 'NULL' : "'웹 운영자'"}, ${st === 'pending' ? 'NULL' : 'now()'})`}`);
  const rid = (n) => sql(`SELECT id FROM ai_report ORDER BY id OFFSET ${n - 1} LIMIT 1`);

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
  const shot = async (name, selector, maxH = 1600) => {
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
  const cellText = () => ev(`document.querySelector('#cell-reports').innerText`);
  const login = async () => {
    await nav(`${apiUrl}/admin`);
    await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
    await submitAndWait('form[action="/admin/login"]');
  };

  await size(1280, 900);
  await login();

  // ---- 옛 화면 그림만 (비교용) ----
  if (TAG === 'before') {
    for (const [w, h] of [[1280, 700], [360, 700]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#reports`);
      await shot(`reports-before-${w}`, '#cell-reports');
    }
    console.log('이전 그림만 찍음', OUT);
  } else {
    const overflow = () => ev(`document.documentElement.scrollWidth <= innerWidth`);
    const bgOf = (sel) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);

    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);

        // ---- 목록 ----
        await nav(`${apiUrl}/admin#reports`);
        const body = await ev(`document.body.innerHTML`);
        const text = await cellText();
        await shot(`reports-list-${tag}`, '#cell-reports');
        check(`[${tag}] 목록에 신고 6건 행과 상태 이름 (미처리 3, 확인 1, 조치 2)`, (await ev(`document.querySelectorAll('#reports-list tbody tr').length`)) === 6 && (text.match(/미처리/g) ?? []).length >= 3, text.slice(0, 200));
        check(`[${tag}] 목록(DOM 전체)에 질문과 답 글이 없다`, !body.includes('SECRETQ') && !body.includes('SECRETA'));
        check(`[${tag}] 미처리가 맨 위: 첫 3행이 미처리`, (await ev(`[...document.querySelectorAll('#reports-list tbody tr')].slice(0, 3).every((r) => r.textContent.includes('미처리'))`)) === true);
        check(`[${tag}] 가로 넘침 없음`, await overflow());
        if (w === 360)
          check(`[${tag}] 휴대폰 폭에서 표는 카드로 (머리글 숨김, 칸 이름 앞에 붙음)`, (await ev(`getComputedStyle(document.querySelector('#reports-list thead')).display`)) === 'none' && (await ev(`getComputedStyle(document.querySelector('#reports-list td[data-l]'), '::before').content`)).includes('번호'));
        // 상태 태그 글자 대비
        const contrast = await ev(`(() => {
          const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
          const bg = lum(getComputedStyle(document.querySelector('section#reports-list')).backgroundColor);
          return [...document.querySelectorAll('#reports-list .tag')].map((t) => { const l = lum(getComputedStyle(t).color); const [a, b] = l > bg ? [l, bg] : [bg, l]; return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10; });
        })()`);
        check(`[${tag}] 상태 태그 글자 대비 4.5 이상`, contrast.length > 0 && contrast.every((x) => x >= 4.5), JSON.stringify(contrast));

        // ---- 열기 ----
        const first = rid(1);
        const viewsBefore = Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'report.view'`));
        await nav(`${apiUrl}/admin?report=${first}#reports`);
        const open = await cellText();
        await shot(`reports-open-${tag}`, '#cell-reports', 1800);
        check(`[${tag}] 열면 질문과 답이 보인다 (HTML 글자는 글로)`, open.includes('SECRETQ-하나 질문') && open.includes('<b>굵게</b>'));
        check(`[${tag}] 열면 운영 기록이 한 줄 늘었다`, Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'report.view'`)) === viewsBefore + 1);
        check(`[${tag}] 열람 안내와 이용자 링크, 목록으로 링크`, open.includes('운영 기록에 남아요') && (await ev(`!!document.querySelector('.report-open a[href*="/admin?q=F-ABCD-0001"]') && !!document.querySelector('.report-open a[href="/admin#reports"]')`)));
        check(`[${tag}] 열린 화면도 가로 넘침 없음`, await overflow());
        const longId = rid(2);
        await nav(`${apiUrl}/admin?report=${longId}#reports`);
        check(`[${tag}] 긴 답(4200자)은 안에서 스크롤, 화면은 넘치지 않음`, (await overflow()) && (await ev(`(() => { const p = [...document.querySelectorAll('pre.convo')][1]; return p.scrollHeight > p.clientHeight && p.getBoundingClientRect().width <= innerWidth; })()`)));
        await nav(`${apiUrl}/admin?report=${rid(3)}#reports`);
        check(`[${tag}] 질문 없이 신고한 건은 안내 글`, (await cellText()).includes('질문 없이 신고했어요'));
        await nav(`${apiUrl}/admin?report=999999#reports`);
        check(`[${tag}] 없는 신고 번호는 오류 글`, (await cellText()).includes('없는 신고예요'));

        // ---- 홈 카드 ----
        await nav(`${apiUrl}/admin#home`);
        const card = await ev(`(() => { const a = document.querySelector('#cell-home ul.todo a[href="#reports"]'); return a ? a.textContent : null; })()`);
        check(`[${tag}] 홈에 "처리하지 않은 신고가 3건"`, card === '처리하지 않은 신고가 3건 있어요', String(card));
        await ev(`document.querySelector('#cell-home ul.todo a[href="#reports"]').click(); true`);
        await sleep(300);
        check(`[${tag}] 카드를 누르면 신고 칸이 보인다`, (await ev(`location.hash`)) === '#reports' && (await ev(`getComputedStyle(document.querySelector('#cell-reports')).display`)) !== 'none');
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 상태 바꾸기 (진짜 단추) ----
    const id1 = rid(1);
    await nav(`${apiUrl}/admin?report=${id1}#reports`);
    const viewsBefore = Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'report.view'`));
    await submitAndWait('.report-open form[action="/admin/reports/status"]:nth-of-type(1)');
    check('"확인했어요" 를 누르면 확인 상태와 처리자가 DB 에 남는다', sql(`SELECT status || '|' || handled_name FROM ai_report WHERE id = ${id1}`) === 'seen|웹 운영자');
    check('쓰기 뒤에는 처리한 신고가 열려 있고 열람 기록이 한 번만 늘어난다', (await ev(`location.search.includes('report=${id1}')`)) === true && Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'report.view'`)) === viewsBefore + 1);
    check('결과 글이 신고 칸에 보인다', (await cellText()).includes(`신고 #${id1} 를 확인으로 표시했어요`));
    await shot('reports-after-seen-1280', '#cell-reports');
    // 낡은 화면: 열어 둔 채 다른 곳에서 바뀌면 거절
    await nav(`${apiUrl}/admin?report=${rid(2)}#reports`);
    sql(`UPDATE ai_report SET status = 'done' WHERE id = ${rid(2)}`);
    await submitAndWait('.report-open form[action="/admin/reports/status"]:nth-of-type(1)');
    check('낡은 화면에서 누르면 "다른 곳에서 먼저 바꿨어요" 로 거절하고 덮어쓰지 않는다', (await cellText()).includes('다른 곳에서 먼저 바꿨어요') && sql(`SELECT status FROM ai_report WHERE id = ${rid(2)}`) === 'done');
    sql(`UPDATE ai_report SET status = 'pending', handled_by = NULL, handled_name = NULL, handled_at = NULL WHERE id = ${rid(2)}`);
    // 두 번 눌러도 한 번: 첫 제출이 시작되면 단추가 막힌다
    await nav(`${apiUrl}/admin?report=${rid(3)}#reports`);
    const doubled = await ev(`(() => { const f = document.querySelector('.report-open form[action="/admin/reports/status"]'); const b = f.querySelector('button'); f.requestSubmit(); const second = f.classList.contains('busy'); f.requestSubmit(); return second; })()`);
    await sleep(800);
    check('제출 중에는 같은 폼이 막혀 두 번째 제출이 나가지 않는다', doubled === true && Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'report.seen' AND detail->>'report' = '${rid(3)}'`)) === 1);

    // ---- 막기 ----
    await nav(`${apiUrl}/admin?report=${rid(4)}#reports`);
    const blockSel = '.report-open form[action="/admin/ai/block"]';
    check('막기는 확인 칸이 이용자 이름 문장으로 있고 체크 전에는 제출할 수 없다', (await ev(`(() => { const f = document.querySelector(${JSON.stringify(blockSel)}); const c = f.querySelector('input[name=confirm]'); return c.required && !c.checked && f.querySelector('label').textContent.includes('F-ABCD-0002'); })()`)) === true);
    await ev(`document.querySelector(${JSON.stringify(blockSel)} + ' input[name=confirm]').checked = true; true`);
    await submitAndWait(blockSel);
    check('확인하고 막으면 신고 칸으로 돌아오고 막힘이 DB 에 남는다', Number(sql(`SELECT count(*) FROM ai_block WHERE account_id = ${acc('F-ABCD-0002')}`)) === 1 && (await ev(`location.hash`)) === '#reports');
    check('목록에서 그 이용자의 신고 행에 막힘 표시', (await cellText()).includes('막힘'));
    await shot('reports-blocked-1280', '#cell-reports');

    // ---- 이용자 상세의 신고 ----
    await nav(`${apiUrl}/admin?q=F-ABCD-0001#users/list`);
    const dd = await ev(`(() => { const dt = [...document.querySelectorAll('dt')].find((x) => x.textContent === '신고'); return dt ? dt.nextElementSibling.innerText : null; })()`);
    check('이용자 상세에 신고 2건과 번호 링크', typeof dd === 'string' && dd.startsWith('2건') && (await ev(`document.querySelectorAll('dt + dd a[href*="?report="]').length`)) >= 2, String(dd));
    await shot('reports-user-detail-1280', 'section:has(dl.stats)');

    // ---- 보안 머리, 인라인 없음 ----
    const html = await (await fetch(`${apiUrl}/admin?report=${rid(1)}`, { headers: { cookie: '' } })).text();
    const head = await fetch(`${apiUrl}/admin`);
    const csp = head.headers.get('content-security-policy') ?? '';
    check('CSP: style-src self, script-src self, 인라인 허용 없음', csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline') && html.length > 0);
    const live = await ev(`document.documentElement.outerHTML`);
    check('신고 칸에 인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(live.slice(live.indexOf('id="cell-reports"'), live.indexOf('id="cell-announce"'))) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
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
