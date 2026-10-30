// 이용자 상세와 안전한 지급 시험 (#153): 웹 /admin 이용자 칸을 헤드리스 Chrome(CDP, 창 없음)으로 폭 1280 과 360, 밝은 어두운 모드에서
// 이용자 표(휴대폰은 카드, 지급 단추가 화면 안), 검색 하나, 상세 한 화면, 지급 단추 옆 대상 이름, 대상 확인과 인원 수 확인,
// 표에서 골라 지급, 일괄 지급(못 찾음, 중복, 합쳐짐), 받았는지 추적, 넘침, 글자 대비, CSP 를 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-user-detail.mjs
//
// 시험용 Postgres(jj-admin153-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 이용자 화면 그림만 찍는다.
// 묶음 하나만: ONLY=revoke 면 코인 회수(미리보기, 잔액 넘김, 확정), 안 연 쪽지 철회, 홈의 밖 백업 상태(성공, 실패, 오래됨)만 본다
// (TAG=before 와 같이 쓰면 그 묶음의 옛 화면 그림만).
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
const ONLY = process.env.ONLY ?? '';
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
// 밖 백업 상태 파일 폴더 (server 의 BACKUP_STATUS_DIR). 묶음 revoke 가 파일을 써 넣는다
const statusDir = join(scratch, 'backup-status');
mkdirSync(statusDir, { recursive: true });
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
  cwd: SERVER_ROOT,
  env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, BACKUP_STATUS_DIR: statusDir, RELEASES_API: 'http://127.0.0.1:9/latest', ADMIN_TOKEN, ANTHROPIC_API_KEY: 'fake-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' },
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

  if (TAG === 'before' && ONLY === 'revoke') {
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin?user=${id1}#users/list`);
      await shot(`revoke-before-detail-${w}`, '#user-detail', 3200);
      await nav(`${apiUrl}/admin#home`);
      await shot(`revoke-before-home-${w}`, '#cell-home', 2400);
    }
    console.log('이전 그림만 찍음', OUT);
  } else if (TAG === 'before') {
    for (const [w, h] of [[1280, 800], [360, 800]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#users/list`);
      await shot(`users-before-${w}`, '#cell-users', 1500);
      await nav(`${apiUrl}/admin?q=F-ABCD-0001#users/list`);
      await shot(`detail-before-${w}`, '#cell-users', 2600);
    }
    console.log('이전 그림만 찍음', OUT);
  } else if (ONLY === 'revoke') {
    // ---- 묶음: 코인 회수(미리보기, 잔액 넘김, 확정), 안 연 쪽지 철회, 홈의 밖 백업 상태 ----
    const H = 3_600_000;
    const sec = (ms) => Math.floor(ms / 1000);
    const put = (n, t) => writeFileSync(join(statusDir, n), t);
    const clearStatus = () => {
      for (const n of ['db.ok', 'db.fail', 'db.checked', 'files.ok', 'files.fail', 'files.checked']) rmSync(join(statusDir, n), { force: true });
    };
    const bal = (a) => Number(sql(`SELECT balance FROM account WHERE id = ${a}`));
    const detail = `${apiUrl}/admin?user=${id1}#users/list`;
    const previewWith = async (coins, reason) => {
      await nav(detail);
      await setVal('#user-detail form[action="/admin/coins/revoke/preview"] input[name=coins]', String(coins));
      await setVal('#user-detail form[action="/admin/coins/revoke/preview"] textarea[name=reason]', reason);
      // 입력 상한(max=잔액)은 브라우저 검사일 뿐이다: 서버가 막는지 보려고 상한을 떼고 보낸다
      if (coins > 120) await ev(`document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] input[name=coins]').removeAttribute('max'); true`);
      await submitAndWait('#user-detail form[action="/admin/coins/revoke/preview"]');
    };

    await size(1280, 900);
    await scheme(false);

    // ---- 코인 회수 ----
    await nav(detail);
    const d0 = await text('#user-detail');
    check('상세에 코인 회수 칸(회수할 코인, 사유, 미리보기 단추)이 있다', (await ev(`!!document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] input[name=coins]') && !!document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] textarea[name=reason]')`)) === true && d0.includes('코인 회수'));
    check('회수 칸에 잔액(120)이 적혀 있고 입력 상한도 잔액', d0.includes('잔액 120') && (await ev(`document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] input[name=coins]').max`)) === '120');
    check('회수는 폼이 하나 더 있을 뿐 이용권 회수 폼과 섞이지 않는다', (await ev(`document.querySelectorAll('#user-detail form[action="/admin/ai/revoke"]').length`)) === 1);
    await shot('revoke-detail-form-1280', '#user-detail', 3200);

    // 잔액 넘김: 미리보기가 막히고 확정 단추가 꺼져 있다
    await previewWith(500, '넘치는 회수');
    check('잔액보다 큰 값은 미리보기에서 막힌다 (오류 글과 꺼진 확정 단추)', (await text('#revoke-preview')).includes('잔액 120보다 많이 회수할 수 없어요') && (await ev(`document.querySelector('#revoke-preview form[action="/admin/coins/revoke"] button[type=submit]').disabled`)) === true);
    check('막힌 미리보기에서는 아무것도 빼지 않았다', bal(id1) === 120);
    await shot('revoke-blocked-1280', '#user-detail', 3200);
    await submitAndWait('#user-detail form[action="/admin/flow/cancel"]');
    check('고치기로 돌아오면 쓰던 값(500, 사유)이 칸에 남는다', (await ev(`document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] input[name=coins]').value`)) === '500' && (await ev(`document.querySelector('#user-detail form[action="/admin/coins/revoke/preview"] textarea[name=reason]').value`)) === '넘치는 회수');

    // 정상 미리보기
    await previewWith(30, '잘못 준 코인 회수');
    const pv = await text('#revoke-preview');
    check('미리보기에 대상, 지금 잔액 120, 회수 30, 회수 뒤 잔액 90, 사유', pv.includes('고양이') && /지금 잔액\s*120/.test(pv) && /회수\s*30/.test(pv) && /회수 뒤 잔액\s*90/.test(pv) && pv.includes('잘못 준 코인 회수'), pv.slice(0, 200));
    check('미리보기만으로는 잔액이 그대로 (쓰기 없음)', bal(id1) === 120 && Number(sql(`SELECT count(*) FROM coin_entry WHERE reason = 'admin-revoke'`)) === 0);
    check('확인 칸을 체크해야 제출된다 (비어 있으면 검사 실패)', (await ev(`document.querySelector('#revoke-preview form[action="/admin/coins/revoke"]').checkValidity()`)) === false);
    await shot('revoke-preview-1280', '#user-detail', 3200);
    await ev(`document.querySelector('#revoke-preview input[name=confirm]').checked = true; true`);
    await submitAndWait('#revoke-preview form[action="/admin/coins/revoke"]');
    const done = await text('#user-detail');
    check('확정하면 결과 글(30개 회수)이 나오고 서버 잔액이 90', done.includes('코인 30개를 회수했어요') && bal(id1) === 90, done.slice(0, 200));
    check('장부에 회수 줄(-30)이 하나, 운영 기록에 coins.revoke 가 하나', Number(sql(`SELECT count(*) FROM coin_entry WHERE reason = 'admin-revoke' AND amount = -30 AND account_id = ${id1}`)) === 1 && Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'coins.revoke' AND target = 'account:${id1}'`)) === 1);
    check('코인 내역 표에 admin-revoke -30 이 보인다', done.includes('admin-revoke') && done.includes('-30'));
    check('같은 미리보기를 다시 확정할 수 없다 (뒤로 가기 등): 확정 폼이 사라졌다', (await ev(`!document.querySelector('#revoke-preview')`)) === true);
    await shot('revoke-result-1280', '#user-detail', 3200);

    // ---- 안 연 쪽지 철회 ----
    const noteForms = await ev(`document.querySelectorAll('#user-detail form[action="/admin/notes/withdraw"]').length`);
    const dn = await text('#user-detail');
    check('철회 단추는 안 열고 기한 안인 지급 쪽지 한 줄에만 있다 (연 쪽지와 기한 지난 쪽지에는 없다)', noteForms === 1 && dn.includes('연 쪽지는 철회할 수 없어요'));
    check('철회 단추에 쪽지 번호가 붙는 확인 글이 있다', (await ev(`document.querySelector('#user-detail form[action="/admin/notes/withdraw"] label.confirm').innerText`)).includes('철회할게요'));
    await shot('withdraw-form-1280', '#user-detail', 3200);
    check('확인 칸 없이는 제출되지 않는다', (await ev(`document.querySelector('#user-detail form[action="/admin/notes/withdraw"]').checkValidity()`)) === false);
    const noteId = sql(`SELECT id FROM inbox WHERE account_id = ${id1} AND message = '안 연 지급'`);
    await ev(`document.querySelector('#user-detail form[action="/admin/notes/withdraw"] input[name=confirm]').checked = true; true`);
    await submitAndWait('#user-detail form[action="/admin/notes/withdraw"]');
    const dw = await text('#user-detail');
    check('철회하면 결과 글, 그 줄이 "철회됨", 철회 단추가 사라진다', dw.includes('철회했어요') && dw.includes('철회됨') && (await ev(`document.querySelectorAll('#user-detail form[action="/admin/notes/withdraw"]').length`)) === 0, dw.slice(0, 200));
    check('DB 에 철회 시각과 운영 기록, 코인은 그대로', sql(`SELECT withdrawn_at IS NOT NULL FROM inbox WHERE id = ${noteId}`) === 't' && Number(sql(`SELECT count(*) FROM admin_log WHERE action = 'note.withdraw' AND target = 'account:${id1}'`)) === 1 && bal(id1) === 90);
    await shot('withdraw-result-1280', '#user-detail', 3200);

    // ---- 휴대폰 폭과 어두운 모드: 회수 미리보기, 철회 줄 ----
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        if (w === 1280 && !dark) continue;
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await previewWith(10, '폭 시험');
        check(`[${tag}] 회수 미리보기가 화면 안에 있고 가로 넘침이 없다`, (await overflow()) && (await inside('#revoke-preview button, #revoke-preview .stats')));
        check(`[${tag}] 확정 단추와 고치기 단추가 보인다`, (await ev(`['#revoke-preview form[action="/admin/coins/revoke"] button[type=submit]', '#revoke-preview form[action="/admin/flow/cancel"] button'].every((s) => { const e = document.querySelector(s); return e && e.getClientRects().length > 0; })`)) === true);
        await shot(`revoke-preview-${tag}`, '#user-detail', 3200);
        await submitAndWait('#user-detail form[action="/admin/flow/cancel"]');
        await nav(detail);
        check(`[${tag}] 쪽지 표(철회됨 줄 포함)가 화면 안에 있다`, (await overflow()) && (await inside('#user-detail table.cards td[data-l="받았는지"]')));
        await shot(`withdraw-table-${tag}`, '#user-detail', 3200);
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 홈의 밖 백업 상태 ----
    const now = Date.now();
    clearStatus();
    await nav(`${apiUrl}/admin#home`);
    check('상태 파일이 없으면 "아직 못 읽었어요" 한 줄 (경고 카드 없음)', (await text('#cell-home')).includes('결과는 아직 못 읽었어요') && !(await text('#cell-home')).includes('성공하지 못했어요') && !(await text('#cell-home')).includes('실패했어요'));
    await shot('backup-unknown-1280', '#cell-home', 2400);

    put('db.ok', `${sec(now - 2 * H)}\tfairy-20261028-053000.sql.gz 4096바이트\n`);
    put('db.checked', `${sec(now - 60_000)}\n`);
    put('files.ok', `${sec(now - 3 * H)}\t서버 백업 파일 12개 맞춤\n`);
    put('files.checked', `${sec(now - 60_000)}\n`);
    await nav(`${apiUrl}/admin#home`);
    const homeOk = await text('#cell-home');
    check('둘 다 성공이면 마지막 성공 시각이 두 줄로 나오고 경고 카드는 없다', /데이터베이스 덤프: 마지막 성공 20\d\d-\d\d-\d\d \d\d:\d\d/.test(homeOk) && /백업 파일 외장 디스크 사본: 마지막 성공/.test(homeOk) && !homeOk.includes('성공하지 못했어요') && !homeOk.includes('실패했어요'));
    await shot('backup-ok-1280', '#cell-home', 2400);

    put('files.ok', `${sec(now - 30 * H)}\t서버 백업 파일 12개 맞춤\n`);
    put('db.ok', `${sec(now - 28 * H)}\tfairy-20261027-053000.sql.gz 4096바이트\n`);
    await nav(`${apiUrl}/admin#home`);
    const homeStale = await text('#cell-home');
    check('26시간 넘게 성공 못 하면 몇 시간째인지와 경고 카드 둘', homeStale.includes('30시간째 성공하지 못했어요') && homeStale.includes('28시간째 성공하지 못했어요') && (await ev(`document.querySelectorAll('#cell-home ul.todo li.warn').length`)) >= 4);
    await shot('backup-stale-1280', '#cell-home', 2400);

    put('files.ok', `${sec(now - 30 * H)}\t서버 백업 파일 12개 맞춤\n`);
    put('files.fail', `${sec(now - 20 * 60_000)}\trsync 종료 코드 23 <b>x</b>\n`);
    put('db.ok', `${sec(now - 2 * H)}\tfairy-20261028-053000.sql.gz 4096바이트\n`);
    put('db.fail', `${sec(now - 30 * 60_000)}\t가장 새 덤프가 깨졌어요 (fairy-20261028-053000.sql.gz, 압축 검사 실패)\n`);
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        await size(w, h);
        await scheme(dark);
        await nav(`${apiUrl}/admin#home`);
        const homeFail = await text('#cell-home');
        check(`[${tag}] 실패는 시각과 까닭이 홈에 나오고 까닭의 태그는 글로 보인다`, /마지막 실패 20\d\d-\d\d-\d\d \d\d:\d\d, 까닭 rsync 종료 코드 23 <b>x<\/b>/.test(homeFail) && homeFail.includes('압축 검사 실패') && homeFail.includes('데이터베이스 덤프 백업이 마지막에 실패했어요'), homeFail.slice(0, 300));
        check(`[${tag}] 실패 줄은 bad 모양 (붉은 카드), 가로 넘침 없음`, (await ev(`document.querySelectorAll('#cell-home ul.todo li.bad').length`)) >= 4 && (await overflow()));
        check(`[${tag}] 실패 줄의 글자 대비 4.5 이상`, await ev(`(() => { const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); }; const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; }; return [...document.querySelectorAll('#cell-home ul.todo li.bad a')].filter((a) => a.getClientRects().length).every((a) => { const l1 = lum(getComputedStyle(a).color), l2 = lum(bgOf(a)); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05) >= 4.5; }); })()`));
        await shot(`backup-failed-${tag}`, '#cell-home', 2400);
      }
    }
    await size(1280, 900);
    await scheme(false);
    await nav(`${apiUrl}/admin#settings/ai`);
    const st = await text('#backup-status');
    check('설정의 백업 현황에 작업마다 상태, 마지막 성공, 마지막 실패(까닭), 확인한 때', st.includes('데이터베이스 덤프') && st.includes('백업 파일 외장 디스크 사본') && st.includes('마지막이 실패') && st.includes('마지막 성공') && st.includes('작업이 확인한 때'), st.slice(0, 300));
    await shot('backup-section-1280', '#backup-status', 2400);
    // 성공으로 돌아오면 실패 카드가 사라진다
    put('files.ok', `${sec(Date.now())}\t서버 백업 파일 13개 맞춤\n`);
    put('db.ok', `${sec(Date.now() + 5000)}\tfairy-20261028-120000.sql.gz 4096바이트\n`);
    await nav(`${apiUrl}/admin#home`);
    const homeBack = await text('#cell-home');
    check('그 뒤 둘 다 성공하면 실패와 오래됨 경고가 사라진다', !homeBack.includes('실패했어요') && !homeBack.includes('성공하지 못했어요') && !homeBack.includes('마지막 실패'), homeBack.slice(0, 200));

    // ---- 보안 머리, 인라인 없음, 쪽 오류 ----
    const live = await ev(`document.documentElement.outerHTML`);
    check('인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(live) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
    check('쪽 안 오류 없음 (콘솔, 예외)', pageErrors.length === 0, pageErrors.join(' | '));
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
        check(`[${tag}] 표는 한 쪽에 20행, 쪽 표시는 1 / 2 (29명, 합쳐진 옛 계정은 없음)`, (await ev(`document.querySelectorAll('#sub-users-list tbody tr').length`)) === 20 && (await text('#sub-users-list .pager')).includes('1 / 2'), String(await ev(`document.querySelectorAll('#sub-users-list tbody tr').length`)));
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
        check(`[${tag}] 단추 이름에 대상 이름이 붙는다 ("이용자26 지급")`, (await ev(`[...document.querySelectorAll('#sub-users-list td.act a')].some((a) => a.textContent === '이용자26 지급')`)) === true, JSON.stringify(await ev(`[...document.querySelectorAll('#sub-users-list td.act a')].slice(0, 4).map((a) => a.textContent)`)));
        await shot(`users-list-${tag}`, '#cell-users', 1700);

        // ---- 상세 ----
        await nav(`${apiUrl}/admin?user=${id1}#users/list`);
        const t = await text('#user-detail');
        check(`[${tag}] 상세 한 화면에 지급, 막기, 정기 지급, 회수, 신고, 내역, 운영 기록`, ['이 사람에게 지급', '막기와 허용', '정기 지급', '회수 (채팅 이용권, 코인)', '신고', '받은 쪽지와 받았는지', '코인 내역', '이 사람의 운영 기록'].every((s) => t.includes(s)), ['이 사람에게 지급', '막기와 허용', '정기 지급', '회수 (채팅 이용권, 코인)', '신고', '받은 쪽지와 받았는지', '코인 내역', '이 사람의 운영 기록'].filter((s) => !t.includes(s)).join(', '));
        check(`[${tag}] 이름 뒤 빈 칸 없이 "지급 대상 확인하기: 고양이", "정기 지급 걸기: 고양이"`, (await ev(`[...document.querySelectorAll('#user-detail form button[type=submit]')].map((b) => b.textContent)`)).filter((x) => x.includes('고양이')).sort().join('|') === '정기 지급 걸기: 고양이|지급 대상 확인하기: 고양이');
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
    check('한 명이면 인원 수를 다시 적는 칸이 없고 확인 체크 하나로 확정한다', (await ev(`document.querySelectorAll('#sub-users-grants input[name=people]').length`)) === 0 && (await ev(`document.querySelector('#sub-users-grants form[action="/admin/grants/batch"]').checkValidity()`)) === false);
    await ev(`document.querySelector('#sub-users-grants input[name=confirm]').checked = true; true`);
    await submitAndWait('#sub-users-grants form[action="/admin/grants/batch"]');
    check('확인을 체크하고 확정하면 쪽지가 한 통 가고 5. 결과 확인', notes(id2) === 1 && (await text('#sub-users-grants')).includes('5. 결과 확인') && (await text('#sub-users-grants')).includes('1명에게 지급 쪽지를 보냈어요'));
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
