// 큰 창을 열었을 때 펫 애니메이션 프레임 시간과 CPU, 메모리가 어떻게 달라지는지 잰다 (이슈 #161, 큰 창 설계 7.2).
//
//   npm run build && OUT=<레포 밖 폴더> node scripts/dev/home-perf.mjs
//
// 앱을 직접 띄우고(빈 데이터 폴더, JJ_NO_FOCUS=1, 포트 무작위, JJ_METRICS=3) 다섯 상태를 차례로 잰다. 상태마다 3초 데우고 12초 잰다:
//   닫힘(작은 패널도 큰 창도 없음), 패널(작은 패널 열림), 큰 창(가만히), 큰 창(스크롤: 오늘 탭을 계속 아래위로 굴림), 닫힘(마지막: 흐름 비교)
// 재는 값:
//   - 펫 창 requestAnimationFrame 간격 (ms): 중앙값, 95%, 99%, 가장 긴 것, 50ms 넘는 틀 수. 펫 그림이 이 틀마다 그려진다
//   - app.getAppMetrics(): 모든 프로세스 CPU 합(코어 하나 기준 %, src/main/index.ts logMetrics 와 같은 셈), 메모리 합(MB), 프로세스 수,
//     렌더러만 따로. JJ_METRICS 로 앱이 main.log 에 3초마다 적는 같은 줄도 상태별로 옮겨 적는다
// 기준 (큰 창 설계 7.2): 펫 프레임 시간 중앙값이 닫힘보다 10% 넘게 나빠지면 머지 전에 원인을 찾는다. 이 숫자는 투명하게 숨긴 창에서
// 잰 것이라 실제 보이는 창보다 낮게 나올 수 있다 (소프트웨어 합성). 같은 컴퓨터에서 상태끼리 견주는 용도다.
// 진짜 마우스, 키보드, 포커스는 쓰지 않는다. 끝나면 데이터 폴더를 지운다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-home-perf');
const WARM_MS = 3000;
const MEASURE_MS = 12_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const freePort = () =>
  new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
const INSPECT = await freePort();
const PAGE = await freePort();

const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.home-perf-'));
const data = join(scratch, 'data');
const homeDir = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(homeDir, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: 'ko', petName: '콩', wander: false }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: homeDir,
    SHELL: '/usr/bin/false',
    PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    JJ_TEST_SECRETS: 'memory',
    JJ_METRICS: '3',
  },
  stdio: 'ignore',
});
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    app.kill('SIGTERM');
  } catch {}
  await sleep(800);
  try {
    app.kill('SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', () => {
  try {
    app.kill('SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
});

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const i = ++id;
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), 60_000);
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          clearTimeout(timer);
          ws.removeEventListener('message', h);
          r(m);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send };
}
let mainConn;
async function main(expr) {
  if (!mainConn) {
    for (let i = 0; i < 120 && !mainConn; i++) {
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
const pageConns = new Map();
async function page(name) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PAGE}/json`)).json();
      const p = list.filter((x) => x.type === 'page' && x.url.includes(`${name}.html`)).at(-1);
      if (p) {
        let c = pageConns.get(p.id);
        if (!c) {
          c = await connect(p.webSocketDebuggerUrl);
          pageConns.set(p.id, c);
        }
        return async (expr) => {
          const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails)
            throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
          return r.result?.result?.value;
        };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    median: +pct(s, 50).toFixed(2),
    p95: +pct(s, 95).toFixed(2),
    p99: +pct(s, 99).toFixed(2),
    max: +s.at(-1).toFixed(2),
    over50: s.filter((x) => x > 50).length,
  };
};

const results = {};
let evPet;

/** 펫 창에서 ms 동안 rAF 간격을 모은다 */
const frames = (ms) =>
  evPet(`new Promise((resolve) => {
    const out = [];
    let last = performance.now();
    const end = last + ${ms};
    const tick = (t) => {
      out.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(tick);
      else resolve(JSON.stringify(out.slice(1)));
    };
    requestAnimationFrame(tick);
  })`).then((s) => JSON.parse(s));

const sampleMetrics = async () => JSON.parse(await main('JSON.stringify(__jj.metrics())'));

async function measure(name, scrollIn) {
  await sleep(WARM_MS);
  await sampleMetrics(); // 첫 CPU 값은 기준점이라 버린다
  const logBefore = readLog();
  let scroller;
  if (scrollIn) scroller = await scrollIn();
  const started = Date.now();
  const ticks = [];
  const poll = (async () => {
    while (Date.now() - started < MEASURE_MS) {
      await sleep(2000);
      ticks.push(await sampleMetrics());
    }
  })();
  const fr = await frames(MEASURE_MS);
  await poll;
  if (scroller) await scroller();
  const avg = (k) => +(ticks.reduce((s, t) => s + t[k], 0) / Math.max(1, ticks.length)).toFixed(1);
  results[name] = {
    frame: stat(fr),
    cpu: avg('cpu'),
    memMB: avg('memMB'),
    rendererMB: avg('rendererMB'),
    procs: ticks.at(-1)?.procs,
    mainLog: readLog().slice(logBefore.length).filter((l) => l.includes('metrics')).slice(-3),
  };
  console.log(name, JSON.stringify({ ...results[name], mainLog: undefined }));
}
const readLog = () => {
  try {
    return readFileSync(join(data, 'logs', 'main.log'), 'utf8').split('\n');
  } catch {
    return [];
  }
};

const body = async () => {
  await main('1');
  await sleep(2500);
  const NOW = await main('Date.now()');
  // 긴 목록: 큰 창 스크롤이 일을 하게
  for (let i = 0; i < 60; i++) await main(`__jj.store.add({ title: '시험 할 일 ${i + 1}' }, ${NOW + i}); 1`);
  evPet = await page('pet');

  await measure('닫힘');

  await main("__jj.panel.openTab('today'); 1");
  await sleep(1500);
  await main("__jj.panel.window.removeAllListeners('blur'); 1");
  await measure('패널');
  await main('__jj.panel.window.close(); 1');
  await sleep(1000);

  await main("__jj.settings.set({ panelView: 'window' }); __jj.home.open('today'); 1");
  await sleep(2000);
  await measure('큰 창(가만히)');

  const evHome = await page('home');
  await measure('큰 창(스크롤)', async () => {
    await evHome(`(() => {
      const box = document.querySelector('.scroll') ?? document.querySelector('.panel-tabpanel');
      let dir = 1;
      window.__scrollTimer = setInterval(() => {
        if (!box) return;
        box.scrollTop += dir * 40;
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2 || box.scrollTop <= 0) dir = -dir;
      }, 16);
      return 1;
    })()`);
    return async () => evHome('clearInterval(window.__scrollTimer); 1');
  });
  await main('__jj.home.window.close(); 1');
  await sleep(1500);

  await measure('닫힘(마지막)');

  const base = results['닫힘'].frame.median;
  console.log('\n상태            | 틀 중앙값 | 95%   | 99%   | 최대   | 50ms 넘음 | CPU %  | 메모리 MB | 렌더러 MB | 프로세스');
  for (const [name, r] of Object.entries(results)) {
    const worse = base > 0 ? `${(((r.frame.median - base) / base) * 100).toFixed(1)}%` : '-';
    console.log(
      `${name.padEnd(14)} | ${String(r.frame.median).padEnd(9)} | ${String(r.frame.p95).padEnd(5)} | ${String(r.frame.p99).padEnd(5)} | ${String(r.frame.max).padEnd(6)} | ${String(r.frame.over50).padEnd(9)} | ${String(r.cpu).padEnd(6)} | ${String(r.memMB.toFixed(0)).padEnd(9)} | ${String(r.rendererMB.toFixed(0)).padEnd(9)} | ${r.procs}   (닫힘 대비 틀 중앙값 ${worse})`,
    );
  }
  writeFileSync(join(OUT, 'home-perf.json'), JSON.stringify(results, null, 1));
  const lim = base * 1.1;
  const bad = ['패널', '큰 창(가만히)', '큰 창(스크롤)'].filter((k) => results[k].frame.median > lim);
  console.log(
    bad.length ? `\n10% 넘게 나빠진 상태: ${bad.join(', ')} (닫힘 ${base}ms 기준)` : '\n펫 틀 중앙값은 모든 상태에서 닫힘 대비 10% 안',
  );
};

try {
  await body();
} catch (err) {
  console.log('ERR', err instanceof Error ? err.stack : String(err));
} finally {
  await cleanup();
}
process.exit(0);
