// 이용자 상세와 안전한 지급 시험 (#153): 웹 /admin 이용자 칸을 헤드리스 Chrome(CDP, 창 없음)으로 폭 1280 과 360, 밝은 어두운 모드에서
// 이용자 표(휴대폰은 카드, 지급 단추가 화면 안), 검색 하나, 상세 한 화면, 지급 단추 옆 대상 이름, 대상 확인과 인원 수 확인,
// 표에서 골라 지급, 일괄 지급(못 찾음, 중복, 합쳐짐), 받았는지 추적, 넘침, 글자 대비, CSP 를 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-user-detail.mjs
//
// 시험용 Postgres(jj-admin153-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 이용자 화면 그림만 찍는다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-user-detail-shots'));
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
const pgName = `jj-admin153-pg-${randomBytes(4).toString('hex')}`;
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin153-'));
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
  // ---- 자료: 이용자 29명(고양이, 강아지, 닉네임 없음, 채움 26), 합쳐진 옛 계정 하나, 쪽지 셋, 신고 하나 ----
  sql(`INSERT INTO account (age, nickname, code, balance) VALUES ('18+', '고양이', 'F-ABCD-0001', 120), ('18+', '강아지', 'F-ABCD-0002', 40), ('14+', NULL, 'F-ABCD-0003', 5), ('18+', '옛계정', 'F-ABCD-0090', 0)`);
  sql(`INSERT INTO account (age, nickname, code, balance) SELECT '18+', CASE WHEN g = 7 THEN '아주긴닉네임아주긴닉네임' ELSE '이용자' || g END, 'F-ZZZZ-' || lpad(g::text, 4, '0'), g * 3 FROM generate_series(1, 26) g`);
  const acc = (code) => sql(`SELECT id FROM account WHERE code = '${code}'`);
  const id1 = acc('F-ABCD-0001');
  const id2 = acc('F-ABCD-0002');
  const idOld = acc('F-ABCD-0090');
  sql(`UPDATE account SET merged_into = ${id1}, closed_at = now() WHERE id = ${idOld}`);
  let seq = 0;
  const coin = (a, amount, reason) =>
    sql(`INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day) VALUES ('t153-${++seq}', ${a}, '${reason}', ${amount}, ${amount}, 'ok', current_date)`);
  coin(id1, 100, 'todo');
  coin(id1, -30, 'shop');
  coin(idOld, 50, 'oldwallet');
  sql(`INSERT INTO inbox (account_id, kind, message, coins, chat_passes, expires_at, opened_at, opened_coins, opened_passes) VALUES
    (${id1}, 'grant', '첫 지급', 10, 0, now() + interval '9 days', now(), 10, 0),
    (${id1}, 'grant', '안 연 지급', 20, 0, now() + interval '9 days', NULL, NULL, NULL),
    (${id1}, 'grant', '기한 지난 지급', 5, 0, now() - interval '1 day', NULL, NULL, NULL)`);
  sql(`INSERT INTO ai_report (account_id, question, answer) VALUES (${id1}, '질문', '답')`);

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
  const shot = async (name, selector, maxH = 1800) => {
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
  const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; return true; })()`);
  const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const login = async () => {
    await nav(`${apiUrl}/admin`);
    await ev(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
    await submitAndWait('form[action="/admin/login"]');
  };
  const overflow = () => ev(`document.documentElement.scrollWidth <= innerWidth`);
  const inside = (sel) => ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length); return els.length > 0 && els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }); })()`);
  const notes = (a) => Number(sql(`SELECT count(*) FROM inbox WHERE account_id = ${a} AND message = '시험 지급'`));

  await size(1280, 900);
  await login();

  if (TAG === 'before') {
    for (const [w, h] of [[1280, 800], [360, 800]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#users/list`);
      await shot(`users-before-${w}`, '#cell-users', 1500);
      await nav(`${apiUrl}/admin?q=F-ABCD-0001#users/list`);
      await shot(`detail-before-${w}`, '#cell-users', 2600);
    }
    console.log('이전 그림만 찍음', OUT);
  } else {
    const contrastOf = (scope) => ev(`(() => {
      const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const root = document.querySelector('${scope}'); const bg = lum(getComputedStyle(root.tagName === 'SECTION' ? root : root.querySelector('section')).backgroundColor);
      return [...document.querySelectorAll('${scope} .tag')].filter((t) => t.getClientRects().length).map((t) => { const l = lum(getComputedStyle(t).color); const [a, b] = l > bg ? [l, bg] : [bg, l]; return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10; });
    })()`);

    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);

        // ---- 표 ----
        await nav(`${apiUrl}/admin#users/list`);
        check(`[${tag}] 표에 이용자 29행 (합쳐진 옛 계정은 없음)`, (await ev(`document.querySelectorAll('#sub-users-list tbody tr').length`)) === 29);
        check(`[${tag}] 찾는 칸이 하나`, (await ev(`document.querySelectorAll('#cell-users input[name=q]').length`)) === 1);
        check(`[${tag}] 가로 넘침 없음 (표)`, await overflow());
        check(`[${tag}] 열기와 지급 단추가 화면 안 (왼쪽 0 이상, 오른쪽 폭 이하)`, await inside('#sub-users-list td.act a'));
        if (w === 360) {
          check(`[${tag}] 휴대폰 폭에서 표는 카드 (머리글 숨김, 칸 이름 앞에 붙음, 덜 중요한 칸 숨김)`,
            (await ev(`getComputedStyle(document.querySelector('#sub-users-list thead')).display`)) === 'none'
            && (await ev(`getComputedStyle(document.querySelector('#sub-users-list td[data-l="코인"]'), '::before').content`)).includes('코인')
            && (await ev(`getComputedStyle(document.querySelector('#sub-users-list td.opt')).display`)) === 'none');
          check(`[${tag}] 긴 닉네임이 카드 밖으로 안 나감`, await inside('#sub-users-list td.name'));
        } else {
          check(`[${tag}] 넓은 폭에서는 열 12개가 다 보인다`, (await ev(`[...document.querySelectorAll('#sub-users-list thead th')].filter((t) => t.getClientRects().length).length`)) === 12);
        }
        check(`[${tag}] 단추 이름에 대상 이름이 붙는다 ("고양이 지급")`, (await ev(`[...document.querySelectorAll('#sub-users-list td.act a')].some((a) => a.textContent === '고양이 지급')`)) === true);
        await shot(`users-list-${tag}`, '#cell-users', 1700);

        // ---- 상세 ----
        await nav(`${apiUrl}/admin?user=${id1}#users/list`);
        const t = await text('#user-detail');
        check(`[${tag}] 상세 한 화면에 지급, 막기, 정기 지급, 회수, 신고, 내역, 운영 기록`, ['이 사람에게 지급', '막기와 허용', '정기 지급', '채팅 이용권 회수', '신고', '받은 쪽지와 받았는지', '코인 내역', '이 사람의 운영 기록'].every((s) => t.includes(s)), t.slice(0, 200));
        check(`[${tag}] 받는 사람 이름이 지급 단추 곁에 있고 숨은 대상 칸과 같다`,
          (await ev(`(() => { const f = document.querySelector('#user-detail form.grant-one'); const code = f.querySelector('input[name=accounts]').value; return f.querySelector('.target').innerText.includes('고양이') && f.querySelector('.target').innerText.includes(code) && f.querySelector('button[type=submit]').textContent.includes('고양이') && code === 'F-ABCD-0001'; })()`)) === true);
        check(`[${tag}] 지급 단추가 화면 안`, await inside('#user-detail form.grant-one button[type=submit]'));
        check(`[${tag}] 합친 계정(옛계정)의 코인 기록이 한 묶음 (oldwallet)`, t.includes('oldwallet') && t.includes('+100') && t.includes('-30'));
        check(`[${tag}] 받았는지: 받음, 아직 안 열었어요, 기한 지남`, t.includes('받음') && t.includes('아직 안 열었어요') && t.includes('안 열고 기한이 지났어요'));
        check(`[${tag}] 가로 넘침 없음 (상세)`, await overflow());
        const cs = await contrastOf('#user-detail');
        check(`[${tag}] 상세 태그 글자 대비 4.5 이상`, cs.length > 0 && cs.every((x) => x >= 4.5), JSON.stringify(cs));
        await shot(`detail-${tag}`, '#cell-users', 3200);
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 검색 하나: 닉네임을 바꿔 찾으면 지급 대상도 그 사람으로 ----
    await nav(`${apiUrl}/admin#users/list`);
    await setVal('#sub-users-list input[name=q]', '강아지');
    await submitAndWait('#sub-users-list form[action="/admin#users/list"]');
    check('검색(닉네임)으로 강아지 상세가 열리고 받는 사람이 강아지', (await text('#user-detail form.grant-one .target')).includes('강아지') && !(await text('#user-detail form.grant-one .target')).includes('고양이'));
    await setVal('#sub-users-list input[name=q]', 'f-abcd-0001');
    await submitAndWait('#sub-users-list form[action="/admin#users/list"]');
    check('검색(소문자 기기 코드)으로 고양이로 바뀌면 받는 사람도 고양이 (이전 대상이 남지 않음)', (await text('#user-detail form.grant-one .target')).includes('고양이') && !(await text('#user-detail form.grant-one .target')).includes('강아지'));
    await setVal('#sub-users-list input[name=q]', idOld);
    await submitAndWait('#sub-users-list form[action="/admin#users/list"]');
    check('합쳐진 옛 계정 번호로 찾으면 남은 계정(고양이)이 열리고 합쳤다는 안내', (await text('#user-detail')).includes('합쳐졌어요') && (await text('#user-detail form.grant-one .target')).includes('고양이'));

    // ---- 표에서 여러 명 골라 지급 ----
    await nav(`${apiUrl}/admin#users/list`);
    await ev(`(() => { const boxes = document.querySelectorAll('#sub-users-list input[name=pick]'); boxes[0].click(); boxes[2].click(); return true; })()`);
    await submitAndWait('#pick-form');
    check('고른 두 명이 지급 칸의 받는 사람으로 채워진다', (await ev(`location.hash`)) === '#users/grants' && (await ev(`document.querySelector('#sub-users-grants textarea[name=accounts]').value.split(/\\s+/).filter(Boolean).length`)) === 2 && (await text('#sub-users-grants .selected')).startsWith('고른 2명'));
    await shot('pick-grants-1280', '#cell-users', 1400);

    // ---- 상세에서 지급: 대상 확인, 인원 수 확인, 확정 ----
    await nav(`${apiUrl}/admin?user=${id2}#users/list`);
    await setVal('#user-detail form.grant-one input[name=coins]', '7');
    await setVal('#user-detail form.grant-one textarea[name=reason]', '시험 지급');
    await submitAndWait('#user-detail form.grant-one');
    const pv = await text('#sub-users-grants');
    check('지급 단추를 누르면 확정이 아니라 대상 확인 화면 (3. 미리보기), 아직 안 보냄', pv.includes('3. 미리보기') && pv.includes('강아지') && notes(id2) === 0, pv.slice(0, 160));
    await shot('preview-single-1280', '#cell-users', 1400);
    check('인원 수 칸은 비우면 제출할 수 없다', (await ev(`document.querySelector('#sub-users-grants form[action="/admin/grants/batch"]').checkValidity()`)) === false);
    await setVal('input[name=people]', '2');
    await ev(`document.querySelector('input[name=people]').removeAttribute('pattern'); document.querySelector('#sub-users-grants input[name=confirm]').checked = true; true`);
    await submitAndWait('#sub-users-grants form[action="/admin/grants/batch"]');
    check('인원 수를 틀리게 적으면 서버가 거절하고 아무것도 안 보낸다', (await text('#cell-users')).includes('받는 사람 수가 달라요') && notes(id2) === 0);
    // 처음부터 다시
    await nav(`${apiUrl}/admin?user=${id2}#users/list`);
    await setVal('#user-detail form.grant-one input[name=coins]', '7');
    await setVal('#user-detail form.grant-one textarea[name=reason]', '시험 지급');
    await submitAndWait('#user-detail form.grant-one');
    await setVal('input[name=people]', '1');
    await ev(`document.querySelector('#sub-users-grants input[name=confirm]').checked = true; true`);
    await submitAndWait('#sub-users-grants form[action="/admin/grants/batch"]');
    check('맞게 적으면 쪽지가 한 통 가고 5. 결과 확인', notes(id2) === 1 && (await text('#sub-users-grants')).includes('5. 결과 확인') && (await text('#sub-users-grants')).includes('1명에게 지급 쪽지를 보냈어요'));
    await shot('result-1280', '#cell-users', 1600);

    // ---- 받았는지 추적 ----
    await nav(`${apiUrl}/admin?user=${id2}#users/list`);
    check('보낸 직후 상세에 "아직 안 열었어요"', (await text('#user-detail')).includes('아직 안 열었어요'));
    sql(`UPDATE inbox SET opened_at = now(), opened_coins = 7, opened_passes = 0 WHERE account_id = ${id2} AND message = '시험 지급'`);
    await nav(`${apiUrl}/admin?user=${id2}#users/list`);
    check('이용자가 연 뒤에는 "받음" 과 실제로 받은 코인', /받음[\s\S]*받은 코인 7/.test(await text('#user-detail')));
    await nav(`${apiUrl}/admin#users/grants`);
    check('지급 칸의 최근 지급 표에도 받음이 보인다', (await text('#sub-users-grants')).includes('최근 지급과 받았는지') && /강아지[\s\S]*받음/.test(await text('#sub-users-grants')));

    // ---- 일괄 지급: 붙여 넣은 문자열 ----
    await nav(`${apiUrl}/admin#users/grants`);
    await setVal('#sub-users-grants textarea[name=accounts]', 'F-ABCD-0001\nF-ABCD-0001\nF-NOPE-9999\nF-ABCD-0090\nF-ABCD-0002');
    await setVal('#sub-users-grants input[name=coins]', '1');
    await setVal('#sub-users-grants textarea[name=reason]', '일괄 시험');
    await submitAndWait('#sub-users-grants form[action="/admin/grants/preview"]');
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await nav(`${apiUrl}/admin#users/grants`);
        const b = await text('#sub-users-grants');
        check(`[${tag}] 일괄 대상 확인: 받는 사람 2명, 못 찾음, 중복, 합쳐진 계정 표시`, b.includes('2명') && b.includes('찾지 못함') && b.includes('중복') && b.includes('합쳐진 계정') && b.includes('적은 5줄: 찾지 못한 1, 중복 2, 합쳐진 계정 1'), b.slice(0, 300));
        check(`[${tag}] 못 찾은 줄이 있으면 확정 단추가 꺼져 있다`, (await ev(`document.querySelector('#sub-users-grants form[action="/admin/grants/batch"] button[type=submit]').disabled`)) === true);
        check(`[${tag}] 가로 넘침 없음 (대상 확인)`, await overflow());
        const cs2 = await contrastOf('#sub-users-grants');
        check(`[${tag}] 대상 확인 태그 글자 대비 4.5 이상`, cs2.length > 0 && cs2.every((x) => x >= 4.5), JSON.stringify(cs2));
        await shot(`preview-bulk-${tag}`, '#cell-users', 2200);
      }
    }
    await size(1280, 900);
    await scheme(false);
    await submitAndWait('#sub-users-grants form[action="/admin/flow/cancel"]');
    check('고치기로 돌아오면 붙여 넣은 줄이 그대로 남는다', (await ev(`document.querySelector('#sub-users-grants textarea[name=accounts]').value.split(/\\s+/).filter(Boolean).length`)) === 5);
    check('일괄 확인만으로는 아무에게도 안 갔다 (쓰기 없음)', Number(sql(`SELECT count(*) FROM inbox WHERE message = '일괄 시험'`)) === 0);

    // ---- 보안 머리, 인라인 없음 ----
    const head = await fetch(`${apiUrl}/admin`);
    const csp = head.headers.get('content-security-policy') ?? '';
    check('CSP: style-src self, script-src self, 인라인 허용 없음', csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
    const live = await ev(`document.documentElement.outerHTML`);
    check('이용자 칸에 인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(live.slice(live.indexOf('id="cell-users"'), live.indexOf('id="cell-reports"'))) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
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
