// 메인 프로세스 바깥 요청이 Node zlib 의 Brotli 풀개를 거치지 않는지 점검한다 (CVE-2026-111497, 2026-10 Node 보안 릴리스).
// 앱을 직접 띄우고(메인 디버거로 Node zlib Brotli 풀개의 일을 센다), 이 컴퓨터 http 서버가 `content-encoding: br` 를 내준다.
//
//   npm run build && node scripts/dev/net-brotli.mjs
//
// 확인하는 것 (PASS/FAIL):
//  - 대조: 원래 Node fetch(__jj.nodeFetch)는 올바른 br 응답을 Node zlib 로 푼다 (세는 장치가 맞다는 증거. 깨진 br 는 Node 에 먹이지 않는다)
//  - 공용 fetch(__jj.mainFetch)와 막은 전역 fetch: 깨진 br 는 거절되고 앱은 멀쩡하며, 올바른 br 도 Node zlib 을 거치지 않는다
//  - 보통 응답: gzip, 압축 없음, 리다이렉트, 사용자 헤더(X-Fairy-Version), 조각 도착(스트리밍), AbortSignal, 시간 끝, 큰 받기
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1(창 투명, 마우스 통과), 빈 JJ_USER_DATA(끝나면 지운다), JJ_TEST_SECRETS=memory, 모의 열쇠고리,
// 입력은 CDP 로만. JJ_SHOW 는 쓰지 않는다. 포트는 JJ_INSPECT_PORT, JJ_PAGE_PORT (기본 9873, 9874).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9873);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9874);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BIG = 48 * 1024 * 1024;

// ---- 이 컴퓨터 서버 ----
const seen = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  seen.push({ path: url.pathname, headers: req.headers });
  switch (url.pathname) {
    case '/br-bad': // 헤더는 br, 몸통은 br 가 아닌 쓰레기
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' });
      return res.end(Buffer.from('this is not brotli, the header lies. '.repeat(40)));
    case '/br-good': // 정말 br 로 압축한 'hello br'
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' });
      return res.end(brotliCompressSync(Buffer.from('hello br')));
    case '/gz':
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      return res.end(gzipSync(Buffer.from('hello gzip')));
    case '/plain':
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('hello plain');
    case '/redirect':
      res.writeHead(302, { location: '/plain' });
      return res.end();
    case '/echo-header':
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(String(req.headers['x-fairy-version'] ?? ''));
    case '/chunks': {
      // 서버가 보내는 SSE 처럼 text/event-stream (text/plain 은 크로미움이 종류를 보려고 첫 덩어리를 모은다)
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let n = 0;
      const t = setInterval(() => {
        res.write(`part${++n};`);
        if (n === 3) {
          clearInterval(t);
          res.end();
        }
      }, 400);
      res.on('close', () => clearInterval(t));
      return;
    }
    case '/hang': // 헤더만 주고 안 끝낸다
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('x');
      return;
    case '/big': {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(BIG) });
      const chunk = Buffer.alloc(1024 * 1024, 7);
      let sent = 0;
      const pump = () => {
        while (sent < BIG) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end();
      };
      return pump();
    }
    default:
      res.writeHead(404);
      return res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- 앱 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.net-brotli-test-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, osNotify: false, lang: 'ko' }));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: home,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_TEST_SECRETS: 'memory',
  },
  stdio: 'ignore',
});
let appExited = false;
app.on('exit', () => {
  appExited = true;
});
console.log('app pid', app.pid, 'server', base);

// ---- 메인 디버거 ----
let ws;
let msgId = 0;
async function connectMain() {
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      const w = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        w.onopen = r;
        w.onerror = j;
      });
      ws = w;
    } catch {
      await sleep(250);
    }
  }
  if (!ws) throw new Error('메인 디버거에 못 붙음');
}
async function main(expr, ms = 120_000) {
  const i = ++msgId;
  const r = await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error(`답 없음: ${expr.slice(0, 80)}`)), ms);
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === i) {
        clearTimeout(timer);
        ws.removeEventListener('message', h);
        ok(m);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
let failed = false;

try {
  await connectMain();
  // __jj 가 올라올 때까지
  for (let i = 0; i < 120; i++) {
    if ((await main('typeof globalThis.__jj?.mainFetch')) === 'function') break;
    await sleep(500);
  }
  check('메인에 공용 fetch 와 대조용 fetch 가 있다', (await main('typeof __jj.mainFetch + "," + typeof __jj.nodeFetch')) === 'function,function');

  // Node zlib Brotli 풀개가 일한 횟수를 센다 (_transform 이 실제 풀기)
  await main(`(() => {
    const zlib = process.getBuiltinModule('node:zlib');
    const proto = zlib.BrotliDecompress.prototype;
    if (!proto.__orig) { proto.__orig = proto._transform; proto._transform = function (...a) { globalThis.__brCount = (globalThis.__brCount ?? 0) + 1; return proto.__orig.apply(this, a); }; }
    globalThis.__brCount = 0;
    return true;
  })()`);
  const count = () => main('globalThis.__brCount');
  const procs = await main(`JSON.stringify({ node: process.versions.node, electron: process.versions.electron, chrome: process.versions.chrome })`);
  console.log('버전', procs);

  // 1) 대조
  const c0 = await count();
  const contrast = await main(`__jj.nodeFetch(${JSON.stringify(`${base}/br-good`)}).then((r) => r.text())`);
  const c1 = await count();
  check('대조: 원래 Node fetch 는 올바른 br 를 Node zlib 으로 푼다 (세는 장치가 맞다)', contrast === 'hello br' && c1 > c0, `풀개 ${c0} → ${c1}`);

  // 2) 공용 fetch + 막은 전역 fetch
  for (const [label, fn] of [['공용 fetch', '__jj.mainFetch'], ['전역 fetch(막음)', 'globalThis.fetch']]) {
    const before = await count();
    const bad = await main(`(async () => {
      try {
        const r = await ${fn}(${JSON.stringify(`${base}/br-bad`)});
        const t = await r.text();
        return JSON.stringify({ refused: false, status: r.status, len: t.length });
      } catch (e) { return JSON.stringify({ refused: true, err: String(e?.cause?.message ?? e?.message ?? e).slice(0, 80) }); }
    })()`);
    const b = JSON.parse(bad);
    check(`${label}: 깨진 br 는 거절된다`, b.refused === true, bad);
    check(`${label}: 깨진 br 가 Node zlib 에 닿지 않았다`, (await count()) === before);
    check(`${label}: 거절 뒤에도 앱이 멀쩡하다`, appExited === false && (await main('1+1')) === 2);

    const good = await main(`${fn}(${JSON.stringify(`${base}/br-good`)}).then((r) => r.text()).catch((e) => 'ERR ' + e.message)`);
    check(`${label}: 올바른 br 는 크로미움이 푼다 (Node zlib 안 거침)`, good === 'hello br' && (await count()) === before, good);
  }
  const hdr = seen.find((s) => s.path === '/br-good')?.headers['accept-encoding'];
  console.log('크로미움이 보낸 accept-encoding:', hdr);

  // 3) 보통 응답
  const text = (u, init = '') => main(`__jj.mainFetch(${JSON.stringify(`${base}${u}`)}${init}).then((r) => r.text()).catch((e) => 'ERR ' + e.message)`);
  check('gzip 응답', (await text('/gz')) === 'hello gzip');
  check('압축 없는 응답', (await text('/plain')) === 'hello plain');
  check('리다이렉트를 따라간다', (await text('/redirect')) === 'hello plain');
  check('사용자 헤더(X-Fairy-Version)가 간다', (await text('/echo-header', ', { headers: { "X-Fairy-Version": "9.9.9" } }')) === '9.9.9');
  check('404 상태가 그대로 온다', (await main(`__jj.mainFetch(${JSON.stringify(`${base}/nope`)}).then((r) => r.status)`)) === 404);

  // 4) 스트리밍: 첫 조각이 마지막보다 먼저 온다
  const stream = JSON.parse(
    await main(`(async () => {
      const t0 = Date.now(); const r = await __jj.mainFetch(${JSON.stringify(`${base}/chunks`)});
      const rd = r.body.getReader(); const times = []; let s = '';
      for (;;) { const { done, value } = await rd.read(); if (done) break; times.push(Date.now() - t0); s += new TextDecoder().decode(value); }
      return JSON.stringify({ s, first: times[0], last: times[times.length - 1], n: times.length });
    })()`),
  );
  check('스트리밍 몸통: 조각이 도착하는 대로 읽힌다', stream.s === 'part1;part2;part3;' && stream.n >= 2 && stream.last - stream.first >= 400, JSON.stringify(stream));

  // 5) AbortSignal / 시간 끝
  const aborted = await main(`(async () => {
    const ac = new AbortController();
    const r = await __jj.mainFetch(${JSON.stringify(`${base}/hang`)}, { signal: ac.signal });
    const p = r.text().then(() => 'read', (e) => e.name);
    setTimeout(() => ac.abort(), 200);
    return await p;
  })()`);
  check('AbortSignal 로 읽는 중에도 끊긴다', aborted === 'AbortError' || aborted === 'TypeError', aborted);
  const timed = await main(`(async () => {
    const t0 = Date.now();
    try { const r = await __jj.mainFetch(${JSON.stringify(`${base}/hang`)}, { signal: AbortSignal.timeout(500) }); await r.text(); return 'finished'; }
    catch (e) { return e.name + ':' + (Date.now() - t0 < 5000); }
  })()`);
  check('AbortSignal.timeout 이 듣는다', /^(TimeoutError|AbortError|TypeError):true$/.test(timed), timed);

  // 6) 큰 받기: 조각으로 읽으며 바이트를 센다 (메모리에 쌓지 않는다)
  const big = JSON.parse(
    await main(`(async () => {
      const m0 = process.memoryUsage().rss; const r = await __jj.mainFetch(${JSON.stringify(`${base}/big`)});
      const rd = r.body.getReader(); let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; }
      return JSON.stringify({ n, rssGrowMB: Math.round((process.memoryUsage().rss - m0) / 1048576) });
    })()`, 300_000),
  );
  check(`큰 받기(${BIG / 1048576}MB) 바이트가 맞다 (rss 증가는 참고만: 네트워크 서비스가 본체 안에서 돈다)`, big.n === BIG, JSON.stringify(big));
  check('끝까지 Node zlib Brotli 풀개 횟수는 대조 한 번뿐', (await count()) === c1, `풀개 ${await count()}`);

} catch (err) {
  console.log('FAIL 중단', err instanceof Error ? err.message : String(err));
  failed = true;
}

try {
  ws?.close();
} catch {}
if (!appExited) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
}
server.close();
for (let i = 0; i < 3; i++) {
  await sleep(500);
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS${failed ? ', 중단됨' : ''}`);
process.exit(bad || failed ? 1 : 0);
