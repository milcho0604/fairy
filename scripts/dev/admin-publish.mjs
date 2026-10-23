// 알리기 발행 도구 시험 (#154): 웹 /admin 알리기 칸을 헤드리스 Chrome(CDP, 창 없음)으로 폭 1280 과 360, 밝은 어두운 모드에서
// 게시물 목록(상태 필터, 검색, 휴대폰 카드), 만들기(종류별 입력만, 기본값), 이벤트와 쿠폰과 버전의 미리보기와 확정,
// 쿠폰 코드 복사 단추, 영향 인원, 초안 저장과 불러오기, 저장과 앱 반영 안내, 넘침, 글자 대비, CSP 를 PASS/FAIL 로 본다.
//
//   (cd server && npm run build) && OUT=<레포 밖 폴더> node scripts/dev/admin-publish.mjs
//
// 시험용 Postgres(jj-admin154-pg-<무작위>)와 server/dist 를 이 프로세스가 띄우고 지운다. 진짜 구글, 카카오, Anthropic, 운영 서버는 부르지 않는다.
// 비교 그림: SERVER_ROOT=<옛 판 server 폴더> TAG=before 로 돌리면 판정 없이 옛 알리기 화면 그림만 찍는다.
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const SERVER_ROOT = resolve(process.env.SERVER_ROOT ?? join(root, 'server'));
const OUT = resolve(process.env.OUT ?? join(root, 'out', 'admin-publish-shots'));
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
const pgName = `jj-admin154-pg-${randomBytes(4).toString('hex')}`;
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

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.admin154-'));
// 최신 릴리스는 이 프로세스가 내주는 가짜 주소다 (진짜 GitHub 을 부르지 않는다)
const releaseServer = createHttp((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ tag_name: 'v0.5.0' }));
});
await new Promise((r) => releaseServer.listen(0, '127.0.0.1', r));
const releaseUrl = `http://127.0.0.1:${releaseServer.address().port}/latest`;
const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const api = spawn(process.execPath, [join(SERVER_ROOT, 'dist', 'main.js')], {
  cwd: SERVER_ROOT,
  env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, PORT: String(apiPort), PUBLIC_URL: apiUrl, RELEASES_API: releaseUrl, ADMIN_TOKEN, ANTHROPIC_API_KEY: 'fake-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' },
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
  // ---- 자료: 이용자 판 분포(영향 인원), 공지 하나(대상 조건 있음), 이벤트(진행, 예정, 끝남, 오래된 것 60), 쿠폰 둘 ----
  for (const [v, n] of [['0.3.0', 3], ['0.4.0', 2], ['0.4.3', 4], ['0.5.0', 5]]) {
    sql(`INSERT INTO account (age, nickname, code, app_version, last_active_at) SELECT '18+', '판' || g, 'F-V${v.replaceAll('.', '')}-' || lpad(g::text, 4, '0'), '${v}', now() FROM generate_series(1, ${n}) g`);
  }
  sql(`INSERT INTO account (age, nickname, code, last_active_at) VALUES ('18+', '판모름', 'F-VABC-0001', now())`);
  const ev = (id, title, a, b) =>
    sql(`INSERT INTO event (id, kind, title_ko, title_en, body_ko, body_en, starts_at, ends_at, coins) VALUES ('${id}', 'gift', '${title}', '${title} en', '본문', 'body', now() + interval '${a} hours', now() + interval '${b} hours', 10)`);
  ev('ev-live', '진행 중 이벤트', -2, 48);
  ev('ev-soon', '예정 이벤트', 24, 96);
  ev('ev-ended', '끝난 이벤트', -96, -48);
  sql(`INSERT INTO event (id, kind, title_ko, title_en, body_ko, body_en, starts_at, ends_at, coins) SELECT 'old-' || lpad(g::text, 2, '0'), 'gift', '오래된 ' || g, 'old ' || g, '본문', 'body', now() - make_interval(hours => 9000 + g), now() - make_interval(hours => 8000 + g), 5 FROM generate_series(0, 59) g`);
  sql(`INSERT INTO coupon (code_hash, hint, label, coins, tickets, starts_at, ends_at, max_uses) VALUES (decode(repeat('11', 32), 'hex'), 'AAAA', '진행 쿠폰', 10, 0, now() - interval '1 hour', now() + interval '5 days', 5), (decode(repeat('22', 32), 'hex'), 'BBBB', '끈 쿠폰', 10, 0, now() - interval '1 hour', now() + interval '5 days', 5)`);
  sql(`UPDATE coupon SET disabled_at = now() WHERE hint = 'BBBB'`);
  sql(`INSERT INTO site_doc (name, body) VALUES ('notices', '{"version":1,"notices":[{"id":"target-1","kind":"important","title":{"ko":"대상 있는 공지","en":"Targeted"},"body":{"ko":"본문","en":"Body"},"versions":"<0.9.0","platforms":["darwin"]}]}'::jsonb)`);

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
  const ev2 = async (expr) => {
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
      ? await ev2(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y + scrollY - 8), width: document.documentElement.clientWidth, height: Math.min(r.height + 16, ${maxH}) }; })()`)
      : null;
    await sleep(200);
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(box ? { clip: { ...box, scale: 1 }, captureBeyondViewport: true } : {}) });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const submitAndWait = async (formSel) => {
    const loaded = c.once('Page.loadEventFired');
    await ev2(`document.querySelector(${JSON.stringify(formSel)}).requestSubmit(); true`);
    await loaded;
    await sleep(300);
  };
  const setVal = (sel, v) => ev2(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; return true; })()`);
  const text = (sel) => ev2(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const login = async () => {
    await c.send('Network.clearBrowserCookies');
    await nav(`${apiUrl}/admin`);
    await ev2(`document.querySelector('input[name=token]').value = ${JSON.stringify(ADMIN_TOKEN)}; true`);
    await submitAndWait('form[action="/admin/login"]');
  };
  const overflow = () => ev2(`document.documentElement.scrollWidth <= innerWidth`);
  const inside = (sel) => ev2(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length); return els.length > 0 && els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }); })()`);
  const contrastOf = (scope) => ev2(`(() => {
      const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const bg = lum(getComputedStyle(document.querySelector('${scope} section')).backgroundColor);
      return [...document.querySelectorAll('${scope} .tag, ${scope} .hint, ${scope} .reach li')].filter((t) => t.getClientRects().length).map((t) => { const l = lum(getComputedStyle(t).color); const [a, b] = l > bg ? [l, bg] : [bg, l]; return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10; });
    })()`);
  const step = () => text('#sub-announce-new ol.steps li[aria-current=step]');
  const kst = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);
  const rows = (kind) => ev2(`[...document.querySelectorAll('#sub-announce-posts table.posts tbody tr')].filter((r) => r.children[0].textContent === ${JSON.stringify(kind)}).map((r) => r.querySelector('td.name').firstChild.textContent)`);

  await size(1280, 900);
  await login();

  if (TAG === 'before') {
    for (const [w, h] of [[1280, 800], [360, 800]]) {
      await size(w, h);
      await nav(`${apiUrl}/admin#announce/notices`);
      await shot(`notices-before-${w}`, '#cell-announce', 2600);
      await nav(`${apiUrl}/admin#announce/events`);
      await shot(`events-before-${w}`, '#cell-announce', 2600);
    }
    console.log('이전 그림만 찍음', OUT);
  } else {
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      for (const dark of [false, true]) {
        const tag = `${w}${dark ? '-dark' : ''}`;
        const tid = tag.replace('-', '');
        await size(w, h);
        await scheme(dark);
        // 쓰기 하나에 요청이 여럿이라 세션별 한 분 120번 상한에 닿지 않게 조합마다 새 세션으로
        await login();

        // ---- 게시물 목록 ----
        await nav(`${apiUrl}/admin#announce/posts`);
        const kinds = await ev2(`[...document.querySelectorAll('#sub-announce-posts table.posts tbody tr')].map((r) => r.children[0].textContent)`);
        check(`[${tag}] 한 목록에 공지, 이벤트, 쿠폰, 버전 기준이 모두 있다`, ['공지', '이벤트', '쿠폰', '버전 기준'].every((k) => kinds.includes(k)), JSON.stringify([...new Set(kinds)]));
        const evTitles = await rows('이벤트');
        check(`[${tag}] 이벤트는 진행 중, 예정, 끝남 순 (끝난 것이 아래)`, evTitles.indexOf('진행 중 이벤트') < evTitles.indexOf('예정 이벤트') && evTitles.indexOf('예정 이벤트') < evTitles.indexOf('끝난 이벤트'), JSON.stringify(evTitles.slice(0, 4)));
        check(`[${tag}] 가로 넘침 없음 (목록)`, await overflow());
        check(`[${tag}] 행의 단추(불러오기, 끝내기)가 화면 안`, await inside('#sub-announce-posts td.act a, #sub-announce-posts td.act button'));
        if (w === 360) {
          check(`[${tag}] 휴대폰 폭에서 목록은 카드 (머리글 숨김, 칸 이름이 앞에 붙음)`,
            (await ev2(`getComputedStyle(document.querySelector('#sub-announce-posts thead')).display`)) === 'none'
            && (await ev2(`getComputedStyle(document.querySelector('#sub-announce-posts td[data-l="상태"]'), '::before').content`)).includes('상태'));
        }
        const cs = await contrastOf('#sub-announce-posts');
        check(`[${tag}] 목록 태그와 안내 글자 대비 4.5 이상`, cs.length > 0 && cs.every((x) => x >= 4.5), JSON.stringify(cs));
        await shot(`posts-${tag}`, '#cell-announce', 2400);

        // ---- 상태 필터, 검색 (오래된 것도 찾는다) ----
        await nav(`${apiUrl}/admin?pk=event&ps=ended#announce/posts`);
        const ended = await rows('이벤트');
        check(`[${tag}] 끝남 필터: 끝난 이벤트 61개만 (진행 중, 예정 없음)`, ended.length === 61 && !ended.includes('진행 중 이벤트') && !ended.includes('예정 이벤트'), String(ended.length));
        await nav(`${apiUrl}/admin#announce/posts`);
        await setVal('#sub-announce-posts input[name=pq]', 'old-07');
        await submitAndWait('#sub-announce-posts form.posts-find');
        check(`[${tag}] 검색: 최근 50개 밖의 오래된 이벤트를 찾는다 (찾기 칸은 그대로 남음)`, JSON.stringify(await rows('이벤트')) === JSON.stringify(['오래된 7']) && (await ev2(`document.querySelector('#sub-announce-posts input[name=pq]').value`)) === 'old-07', JSON.stringify(await rows('이벤트')));

        // ---- 만들기: 종류별로 필요한 입력만, 기본값 ----
        await nav(`${apiUrl}/admin#announce/new`);
        const visibleForms = () => ev2(`[...document.querySelectorAll('#sub-announce-new form.mk-f')].filter((f) => f.closest('.mk-body').getClientRects().length > 0).map((f) => f.getAttribute('action'))`);
        check(`[${tag}] 처음에는 공지 폼 하나만 보인다`, JSON.stringify(await visibleForms()) === JSON.stringify(['/admin/notices/preview']), JSON.stringify(await visibleForms()));
        check(`[${tag}] 기본값이 채워져 있다 (공지 id)`, /^notice-\d{8}$/.test(await ev2(`document.querySelector('form.mk-notices input[name=id]').value`)));
        check(`[${tag}] 링크, 기간, 대상은 접혀 있다 (필요할 때만)`, (await ev2(`document.querySelector('form.mk-notices details').open`)) === false);
        await ev2(`document.getElementById('mk-events').click(); true`);
        check(`[${tag}] 이벤트를 고르면 이벤트 폼만 보인다`, JSON.stringify(await visibleForms()) === JSON.stringify(['/admin/events/preview']));
        check(`[${tag}] 선물이 기본: 코인 칸이 보이고 배수 칸은 숨음`,
          (await ev2(`getComputedStyle(document.querySelector('form.mk-events .only-gift')).display`)) !== 'none'
          && (await ev2(`getComputedStyle(document.querySelector('form.mk-events .only-boost')).display`)) === 'none');
        await ev2(`document.querySelector('form.mk-events input[name=kind][value=boost]').click(); true`);
        check(`[${tag}] 배수를 고르면 코인 칸이 숨고 까닭과 배수 칸이 보인다`,
          (await ev2(`getComputedStyle(document.querySelector('form.mk-events .only-gift')).display`)) === 'none'
          && (await ev2(`getComputedStyle(document.querySelector('form.mk-events .only-boost')).display`)) !== 'none');
        check(`[${tag}] 이벤트 시작과 끝에 기본값 (다음 정시, 일주일 뒤)`, /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(await ev2(`document.querySelector('form.mk-events input[name=from]').value`)));
        await shot(`new-events-${tag}`, '#cell-announce', 1800);
        await ev2(`document.getElementById('mk-coupons').click(); true`);
        check(`[${tag}] 쿠폰을 고르면 쿠폰 폼만 보이고 기본값(상한 100)`, JSON.stringify(await visibleForms()) === JSON.stringify(['/admin/coupons/preview']) && (await ev2(`document.querySelector('form.mk-coupons input[name=max_uses]').value`)) === '100');
        await ev2(`document.getElementById('mk-versions').click(); true`);
        check(`[${tag}] 버전을 고르면 지금 기준이 채워진 버전 폼만 보인다`, JSON.stringify(await visibleForms()) === JSON.stringify(['/admin/versions/preview']));
        check(`[${tag}] 가로 넘침 없음 (만들기)`, await overflow());
        await shot(`new-versions-${tag}`, '#cell-announce', 2000);
        const csN = await contrastOf('#sub-announce-new');
        check(`[${tag}] 만들기 안내 글자 대비 4.5 이상`, csN.length > 0 && csN.every((x) => x >= 4.5), JSON.stringify(csN));

        // ---- 이벤트: 작성, 미리보기, 확정, 결과 ----
        const evId = `ev-${tid}`;
        await nav(`${apiUrl}/admin#announce/new`);
        await ev2(`document.getElementById('mk-events').click(); true`);
        await setVal('form.mk-events input[name=id]', evId);
        await setVal('form.mk-events input[name=title_ko]', `선물 ${tid}`);
        await setVal('form.mk-events input[name=title_en]', `Gift ${tid}`);
        await setVal('form.mk-events textarea[name=body_ko]', '코인을 받아요');
        await setVal('form.mk-events textarea[name=body_en]', 'Get coins');
        await submitAndWait('form.mk-events');
        const pvEv = await text('#sub-announce-new');
        check(`[${tag}] 이벤트 미리보기: 3단계, 앱 모양 ko/en, 아직 안 만들어짐`, (await step()).startsWith('3.') && pvEv.includes('선물 50 코인') && pvEv.includes('Gift 50 coins') && Number(sql(`SELECT count(*) FROM event WHERE id = '${evId}'`)) === 0, pvEv.slice(0, 200));
        check(`[${tag}] 미리보기에 저장과 앱 반영이 다르다는 안내 (서버, 홈페이지 파일, 앱)`, ['서버에 저장', '홈페이지 파일', '앱에 닿음', '6시간마다'].every((s) => pvEv.includes(s)));
        check(`[${tag}] 가로 넘침 없음 (이벤트 미리보기)`, await overflow());
        await shot(`preview-event-${tag}`, '#cell-announce', 1800);
        await submitAndWait('#sub-announce-new form[action="/admin/events"]');
        const doneEv = await text('#sub-announce-new');
        check(`[${tag}] 확정하면 5. 결과 확인, 이벤트가 만들어지고 반영 시점을 알린다`, (await step()).startsWith('5.') && Number(sql(`SELECT count(*) FROM event WHERE id = '${evId}'`)) === 1 && doneEv.includes('늦어도'), doneEv.slice(0, 200));
        await shot(`result-event-${tag}`, '#cell-announce', 1600);

        // ---- 쿠폰: 코드 한 번, 복사 단추 ----
        await nav(`${apiUrl}/admin#announce/new`);
        await ev2(`document.getElementById('mk-coupons').click(); true`);
        await setVal('form.mk-coupons input[name=label]', `쿠폰 ${tid}`);
        await submitAndWait('form.mk-coupons');
        const pvCp = await text('#sub-announce-new');
        check(`[${tag}] 쿠폰 미리보기: 코드는 확정 때 한 번, 홈페이지 파일을 거치지 않는다는 안내`, pvCp.includes('한 번만 보여요') && pvCp.includes('홈페이지 파일을 거치지 않아요'));
        await shot(`preview-coupon-${tag}`, '#cell-announce', 1600);
        await submitAndWait('#sub-announce-new form[action="/admin/coupons"]');
        const code = await ev2(`(document.querySelector('#coupon-code') || {}).textContent || ''`);
        check(`[${tag}] 결과에 쿠폰 코드와 "다시 볼 수 없다" 안내와 복사 단추`, /^[A-Z0-9-]{12,20}$/.test(code) && (await text('#sub-announce-new')).includes('다시 볼 수 없어요') && (await ev2(`!!document.querySelector('button[data-copy]')`)));
        await ev2(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); true`);
        await ev2(`document.querySelector('button[data-copy]').click(); true`);
        await sleep(150);
        check(`[${tag}] 복사 단추가 코드를 복사하고 "복사했어요" 로 바뀐다`, (await ev2(`window.__copied`)) === code && (await ev2(`document.querySelector('button[data-copy]').textContent`)) === '복사했어요');
        check(`[${tag}] 코드 글자가 선택 가능한 큰 글자 (복사 단추가 안 될 때 대비)`, (await ev2(`getComputedStyle(document.querySelector('#coupon-code')).userSelect`)) === 'all');
        check(`[${tag}] 서버에는 해시만 있다 (쿠폰 표에 원본 코드 없음)`, !sql(`SELECT row_to_json(c)::text FROM coupon c WHERE label = '쿠폰 ${tid}'`).includes(code.replaceAll('-', '')));
        await shot(`result-coupon-${tag}`, '#cell-announce', 1600);
        await nav(`${apiUrl}/admin#announce/new`);
        check(`[${tag}] 다시 열면 코드가 없다`, !(await ev2(`document.documentElement.outerHTML`)).includes(code));

        // ---- 버전: 영향 인원, 순서, 안내문 ----
        // 조합마다 같은 출발점에서 보도록 저장된 기준과 안내문을 비운다
        sql(`UPDATE site_doc SET body = (body - 'minVersion' - 'recommendVersion' - 'restrictVersion') || jsonb_build_object('notices', (SELECT coalesce(jsonb_agg(n), '[]'::jsonb) FROM jsonb_array_elements(body->'notices') n WHERE n->>'id' NOT LIKE 'force-%')) WHERE name = 'notices'`);
        await nav(`${apiUrl}/admin#announce/new`);
        await ev2(`document.getElementById('mk-versions').click(); true`);
        await setVal('form.mk-versions input[name=minVersion]', '0.4.0');
        await setVal('form.mk-versions input[name=recommendVersion]', '0.4.3');
        await ev2(`document.querySelector('form.mk-versions details').open = true; true`);
        await setVal('form.mk-versions select[name=msg_kind]', 'force');
        await setVal('form.mk-versions input[name=msg_title_ko]', '업데이트해 주세요');
        await setVal('form.mk-versions input[name=msg_title_en]', 'Please update');
        await setVal('form.mk-versions textarea[name=msg_body_ko]', '새 판이 나왔어요');
        await setVal('form.mk-versions textarea[name=msg_body_en]', 'A new version is out');
        await submitAndWait('form.mk-versions');
        const pvV = await text('#sub-announce-new');
        // 최소 0.4.0 보다 낮은 판: 0.3.0 의 3명 + 판 모름 1명. 권장 0.4.3 보다 낮은 판: 0.3.0, 0.4.0, 판 모름
        check(`[${tag}] 버전 미리보기: 잠기는 인원 지금 0명 -> 저장하면 4명`, /앱이 잠기는 계정\s*0명\s*→\s*4명/.test(pvV.replace(/\s+/g, ' ')) || pvV.includes('0명 → 4명'), pvV.slice(0, 400));
        check(`[${tag}] 권장 알림 대상 0명 -> 6명, 안내문 미리보기 ko/en`, pvV.includes('0명 → 6명') && pvV.includes('업데이트해 주세요') && pvV.includes('Please update'));
        check(`[${tag}] 강제를 올리면 확인 칸이 필수`, (await ev2(`document.querySelector('#sub-announce-new form[action="/admin/versions"] input[name=confirm]').required`)) === true);
        await shot(`preview-version-${tag}`, '#cell-announce', 2200);
        await ev2(`document.querySelector('#sub-announce-new form[action="/admin/versions"] input[name=confirm]').click(); true`);
        await submitAndWait('#sub-announce-new form[action="/admin/versions"]');
        check(`[${tag}] 버전을 확정하면 기준과 안내문(force-0.4.0)이 같이 저장된다`, sql(`SELECT (body->>'minVersion') || '/' || (body->>'recommendVersion') || '/' || (SELECT string_agg(n->>'id', ',') FROM jsonb_array_elements(body->'notices') n WHERE n->>'id' LIKE 'force-%') FROM site_doc WHERE name = 'notices'`) === '0.4.0/0.4.3/force-0.4.0');
        await shot(`result-version-${tag}`, '#cell-announce', 1800);

        // ---- 순서 어긋남은 작성 화면 오류 ----
        await nav(`${apiUrl}/admin#announce/new`);
        await ev2(`document.getElementById('mk-versions').click(); true`);
        await setVal('form.mk-versions input[name=minVersion]', '0.4.3');
        await setVal('form.mk-versions input[name=recommendVersion]', '0.4.0');
        await submitAndWait('form.mk-versions');
        check(`[${tag}] 최소 > 권장이면 미리보기로 안 가고 폼 안에 오류`, (await text('#sub-announce-new form.mk-versions .flash.error')).includes('순서') || (await text('#sub-announce-new form.mk-versions .flash.error')).length > 0 ? (await step()).startsWith('1.') : false, await text('#sub-announce-new form.mk-versions .flash.error'));
        check(`[${tag}] 오류가 난 뒤에도 쓴 값이 남는다`, (await ev2(`document.querySelector('form.mk-versions input[name=minVersion]').value`)) === '0.4.3');

        // ---- 초안 ----
        await nav(`${apiUrl}/admin#announce/new`);
        await setVal('form.mk-notices input[name=title_ko]', `초안 제목 ${tid}`);
        await ev2(`(() => { const f = document.querySelector('form.mk-notices'); const b = [...f.querySelectorAll('button')].find((x) => x.textContent === '초안 저장'); const loaded = true; b.click(); return loaded; })()`);
        await sleep(600);
        check(`[${tag}] 초안 저장: 쓰던 값이 그대로, 저장했다는 안내, 초안 바가 보임`, (await ev2(`document.querySelector('form.mk-notices input[name=title_ko]').value`)) === `초안 제목 ${tid}` && (await text('#sub-announce-new')).includes('초안을 저장했어요') && (await text('#sub-announce-new')).includes('저장한 초안이 있어요'));
        await nav(`${apiUrl}/admin#announce/new`);
        await submitAndWait('#sub-announce-new .mk-notices form.draft-bar');
        check(`[${tag}] 초안 불러오기: 빈 폼에 쓰던 글이 돌아온다`, (await ev2(`document.querySelector('form.mk-notices input[name=title_ko]').value`)) === `초안 제목 ${tid}`);
        check(`[${tag}] 초안 표에 개인정보나 확인 칸이 없다`, !JSON.stringify(sql(`SELECT body FROM admin_draft WHERE kind = 'notices'`)).includes('csrf'));
        await ev2(`(() => { document.querySelector('#sub-announce-new .mk-notices form.draft-bar button[formaction="/admin/drafts/delete"]').click(); return true; })()`);
        await sleep(600);
        check(`[${tag}] 초안 지우기`, Number(sql(`SELECT count(*) FROM admin_draft`)) === 0);

        // ---- 불러와 고치기 ----
        await nav(`${apiUrl}/admin?load=notice%3Atarget-1#announce/new`);
        check(`[${tag}] 공지 불러오기: 같은 id 와 대상 조건(<0.9.0, darwin)이 폼에 채워진다`, (await ev2(`document.querySelector('form.mk-notices input[name=id]').value`)) === 'target-1' && (await ev2(`document.querySelector('form.mk-notices input[name=versions]').value`)) === '<0.9.0' && (await ev2(`document.querySelector('form.mk-notices input[name=platforms]').value`)) === 'darwin' && (await ev2(`document.querySelector('form.mk-notices details').open`)) === true);
        await nav(`${apiUrl}/admin?load=event%3Aev-live#announce/new`);
        check(`[${tag}] 이벤트 불러오기는 복사본 (새 id ev-live-2, 이벤트 폼이 열림)`, (await ev2(`document.querySelector('form.mk-events input[name=id]').value`)) === 'ev-live-2' && JSON.stringify(await visibleForms()) === JSON.stringify(['/admin/events/preview']));
      }
    }
    await size(1280, 900);
    await scheme(false);

    // ---- 끝내기, 끄기, 지우기는 대상 이름 확인 칸이 있다 ----
    await nav(`${apiUrl}/admin?pk=event&pq=ev-live#announce/posts`);
    check('이벤트 끝내기는 대상 이름이 적힌 확인 칸을 체크해야 제출된다', (await ev2(`document.querySelector('#sub-announce-posts form.sure input[name=confirm]').required`)) === true && (await text('#sub-announce-posts form.sure label')).includes('ev-live'));

    // ---- 보안 머리, 인라인 없음 ----
    const head = await fetch(`${apiUrl}/admin`);
    const csp = head.headers.get('content-security-policy') ?? '';
    check('CSP: style-src self, script-src self, 인라인 허용 없음', csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
    await nav(`${apiUrl}/admin#announce/posts`);
    const live = await ev2(`document.documentElement.outerHTML`);
    const cell = live.slice(live.indexOf('id="cell-announce"'), live.indexOf('id="cell-settings"'));
    check('알리기 칸에 인라인 스타일, 인라인 스크립트, 이벤트 속성 없음', !/<[^>]+\sstyle=/.test(cell) && !/<script(?![^>]*src=)/.test(live) && !/\son(click|load|error)=/.test(live));
    check('쪽 안 오류 없음 (콘솔, 예외)', pageErrors.length === 0, pageErrors.join(' | '));
  }
} catch (err) {
  failed = true;
  console.error('시험 중 오류', err);
} finally {
  chrome?.kill('SIGKILL');
  api.kill('SIGKILL');
  releaseServer.close();
  dropPg();
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
process.exit(failed || bad.length ? 1 : 0);
