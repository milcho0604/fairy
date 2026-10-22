// 맥 Dock 점검 (이슈 #161, 큰 창 설계 #159 "맥 Dock 위험"): 큰 창이 열린 동안만 Dock 에 보이게 해도
// "펫을 누르면 다른 데스크톱으로 끌려가는" 문제가 돌아오지 않는지, 앱 종류가 제자리로 돌아오는지를 실제 맥에서 잰다.
//
//   JJ_DOCK_PROBE=1 OUT=<레포 밖 폴더> node scripts/dev/dock-probe.mjs
//
// 이 시험은 사용자의 Dock 에 앱 아이콘을 진짜로 띄웠다 숨긴다 (app.dock.show, hide 를 부른다). 그래서 JJ_DOCK_PROBE=1 이 없으면 아무것도 안 하고
// 끝난다(종료 코드 2). 컨트롤러가 돌릴지 정한다. 시작 전에 5초 기다린다(Ctrl+C 로 멈춘다).
// 앱은 빈 데이터 폴더, 무작위 포트, JJ_NO_FOCUS=1 로 띄운다: 창은 맥북 내장 화면에 투명하게 숨고 마우스도 통과시킨다.
// 입력은 CDP 로만 넣는다. 사용자가 켜 둔 펫(디버그 포트 없는 것)은 건드리지 않는다. 끝나면 데이터 폴더를 지우고 우리 앱을 PID 로 끝낸다.
//
// 더 센 단계는 환경 변수로 따로 켠다 (켜면 아래 "위험"이 더해진다):
//   JJ_DOCK_PROBE_FOCUS=1       JJ_NO_FOCUS 를 빼고 JJ_CONFINE=1 로 띄운다. 창은 여전히 내장 화면에 투명하게 숨지만 앱을 진짜로 앞으로 가져온다
//                               (app.focus steal, 맥이 데스크톱을 넘기는 그 길). "끌림" 시험은 이것이 있어야 뜻이 있다. 위험: 키보드 입력이 이 앱으로 간다
//                               (보이지 않는 창에). 사용자가 자리를 비웠을 때만.
//   JJ_DOCK_PROBE_FULLSCREEN=1  큰 창을 진짜 전체 화면으로 만들어 새 데스크톱을 띄운다, 그리고 "다른 앱" 전체 화면(별도 Electron 프로세스의 전체 화면
//                               검은 창)을 띄워 그 위에서 큰 창을 부른다. 위험: 화면에 새 데스크톱과 검은 전체 화면 창이 잠깐 뜬다
//   JJ_DOCK_PROBE_KEYS=1        데스크톱 둘 이상일 때 osascript 로 Ctrl+→ / Ctrl+← 를 보내 데스크톱을 옮긴다 (진짜 키 입력, 손님 없이)
//                               (손쉬운 사용 권한이 없으면 건너뛴다). 위험: 보고 있던 데스크톱이 바뀐다 (끝나면 처음 데스크톱으로 돌아온다)
//
// 재는 것 (모두 읽기만 한다):
//   - 앱 종류: `lsappinfo info -only ApplicationType <ASN>` (Foreground = Dock 있는 보통 앱, UIElement = Dock 없는 앱)
//   - 지금 보는 데스크톱(Space) 번호: osascript JXA 로 CGSGetActiveSpace (개인 API, 읽기만)
//   - 우리 앱 창이 지금 데스크톱에 떠 있는지: CGWindowListCopyWindowInfo(OnScreenOnly) 에서 우리 pid 의 창 (크기와 자리)
//   - 앱 쪽: __jj.dock.stats() (진짜 dock.show, hide 를 부른 횟수, isVisible, 이벤트 기록), 펫 창 isVisible, isVisibleOnAllWorkspaces
//
// 순서와 통과 기준 (하나라도 어긋나면 FAIL, 종료 코드 1. "건너뜀"은 통과도 실패도 아니다):
//   0. 처음: 앱 종류가 Foreground 가 아니다(Dock 없는 앱), 펫이 지금 데스크톱에 있다. 이 기준 종류를 기억한다
//   1. 열고 닫기 5번: 큰 창을 열면 앱 종류가 3초 안에 Foreground, 닫으면 4초 안에 처음 종류로 돌아온다, 닫은 뒤 app.dock.isVisible() 거짓,
//      열고 닫는 내내 데스크톱 번호가 그대로(끌리지 않음), 펫이 늘 지금 데스크톱에 있고 자리가 안 바뀜
//   2. 빠르게 열고 닫기 12번(간격 120ms): 오류 없이 끝나고, 멈춘 뒤 5초 안에 처음 종류로 돌아온다 (1초 안의 hide 는 Electron 이 무시한다: 대기 규칙 확인).
//      Dock 호출은 열고 닫은 횟수보다 적다(쓸데없는 호출을 묶는다), 데스크톱 번호 그대로
//   3. 숨기기: hide 로 숨기면 4초 안에 처음 종류, 다시 열면 Foreground, 숨긴 채 JJ_HOME_KEEP_MS 가 지나 없어지면 처음 종류
//   4. 큰 창이 열린 동안 펫 창 설정을 다시 걸어도(setVisibleOnAllWorkspaces, KEEP_APP_TYPE) 앱 종류가 Foreground 그대로 (UIElement 로 안 뒤집힌다),
//      Dock 을 껐다 켠 뒤에도 펫 창 isVisibleOnAllWorkspaces 가 참이고 지금 데스크톱에 있다
//   5. (FOCUS) 앱을 진짜 앞으로 가져온 채 위 1을 되풀이: 데스크톱 번호 그대로
//   6. (FULLSCREEN) 큰 창 전체 화면: 새 데스크톱이 생기고(번호 바뀜) 펫이 그 위에도 있다, 풀면 처음 번호로 돌아오고 펫도 제자리.
//      "다른 앱" 전체 화면 위에서 큰 창을 부르면(펫 누르기와 같은 길 panel.togglePanel): 작은 패널을 부를 때와 같은 데스크톱 결과여야 한다
//      (큰 창이 패널보다 더 끌지 않는다), 끝나고 펫 자리가 그대로
//   7. (KEYS, FOCUS) 데스크톱 B 로 옮긴 채 펫 누르기 길(panel.togglePanel)로 큰 창을 부르면 데스크톱 번호가 B 그대로(처음 큰 창이 있던 A 로 끌려가지 않음),
//      큰 창이 B 에 뜬다(우리 pid 창이 B 의 화면 목록에 있다). 닫으면 처음 종류로 돌아온다
//   8. 끝: 앱을 끝내면 Dock 아이콘이 없다 (앱 종류를 조회할 프로세스가 없다)
//
// 결과 읽는 법: 각 줄에 PASS/FAIL/건너뜀과 잰 값이 나온다. OUT 폴더에 probe.json(모든 잰 값과 __jj.dock.stats().events 기록)을 남긴다.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

if (process.env.JJ_DOCK_PROBE !== '1') {
  console.log(
    'dock-probe: 사용자의 Dock 에 아이콘을 진짜로 띄웠다 숨기는 시험이라 JJ_DOCK_PROBE=1 이 있어야 돈다. 아무것도 하지 않았다.',
  );
  process.exit(2);
}
if (process.platform !== 'darwin') {
  console.log('dock-probe: 맥에서만 뜻이 있다.');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-dock-probe');
const FOCUS = process.env.JJ_DOCK_PROBE_FOCUS === '1';
const FULLSCREEN = process.env.JJ_DOCK_PROBE_FULLSCREEN === '1';
const KEYS = process.env.JJ_DOCK_PROBE_KEYS === '1';
const KEEP_MS = 3000;
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

const results = [];
const record = {};
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const skip = (name, why) => console.log(`건너뜀 ${name} (${why})`);

console.log(
  `dock-probe 시작: 5초 뒤 앱을 띄운다. 사용자의 Dock 에 아이콘이 뜬다. FOCUS=${FOCUS} FULLSCREEN=${FULLSCREEN} KEYS=${KEYS}. 멈추려면 Ctrl+C`,
);
await sleep(5000);

// ---- 앱 띄우기 ----
const scratch = mkdtempSync(join(process.env.JJ_SCRATCH ?? tmpdir(), '.dock-probe-'));
const data = join(scratch, 'data');
const homeDir = join(scratch, 'home');
mkdirSync(data, { recursive: true });
mkdirSync(homeDir, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: 'ko', petName: '콩', wander: false }),
);
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const env = {
  HOME: homeDir,
  SHELL: '/usr/bin/false',
  PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
  JJ_USER_DATA: data,
  JJ_TEST_SECRETS: 'memory',
  JJ_HOME_KEEP_MS: String(KEEP_MS),
  // 진짜 dock.show, hide 를 부르게 한다 (src/main/index.ts). 이 변수가 없으면 시험 실행은 부르려 했다만 센다
  JJ_DOCK_PROBE: '1',
  ...(FOCUS ? { JJ_CONFINE: '1' } : { JJ_NO_FOCUS: '1' }),
};
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env,
  stdio: 'ignore',
});
const others = [];
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const p of [...others, app]) {
    try {
      p.kill('SIGTERM');
    } catch {}
  }
  await sleep(1200);
  for (const p of [...others, app]) {
    try {
      p.kill('SIGKILL');
    } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', () => {
  for (const p of [...others, app]) {
    try {
      p.kill('SIGKILL');
    } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
});
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

// ---- CDP (메인 디버거 하나) ----
let mainConn;
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
      const timer = setTimeout(() => j(new Error(`CDP 답 없음: ${method}`)), 20_000);
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

// ---- 잴 것들 (읽기만) ----
/** 우리 pid 의 앱 종류 (lsappinfo). Foreground, UIElement, BackgroundOnly. 못 읽으면 undefined */
function appType(pid) {
  try {
    const found = execFileSync('lsappinfo', ['find', `pid=${pid}`], { encoding: 'utf8' });
    const asn = /ASN:0x[0-9a-f]+-0x[0-9a-f]+/.exec(found)?.[0];
    if (!asn) return undefined;
    const out = execFileSync('lsappinfo', ['info', '-only', 'ApplicationType', `${asn}:`], { encoding: 'utf8' });
    return /"ApplicationType"="([^"]+)"/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}
const jxa = (code) => execFileSync('osascript', ['-l', 'JavaScript', '-e', code], { encoding: 'utf8' }).trim();
/** 지금 보고 있는 데스크톱(Space) 번호. 읽기만 하는 개인 API. 못 읽으면 undefined */
function activeSpace() {
  try {
    return Number(
      jxa(
        "ObjC.import('CoreGraphics'); ObjC.bindFunction('CGSMainConnectionID', ['int', []]); ObjC.bindFunction('CGSGetActiveSpace', ['int', ['int']]); $.CGSGetActiveSpace($.CGSMainConnectionID());",
      ),
    );
  } catch {
    return undefined;
  }
}
/** 지금 데스크톱에 떠 있는 이 pid 의 창들 [{x,y,w,h,layer}] */
function onScreen(pid) {
  try {
    const out = jxa(
      "ObjC.import('CoreGraphics'); ObjC.import('Foundation'); const l = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID))); JSON.stringify(l.map((w) => ({ pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height })))",
    );
    return JSON.parse(out)
      .filter((w) => w.pid === pid)
      .map(({ pid: _p, ...rest }) => rest);
  } catch {
    return undefined;
  }
}
const near = (a, b) => Math.abs(a - b) <= 2;
/** 펫 창이 지금 데스크톱 화면 목록에 자기 크기, 자리 그대로 있다 */
async function petInPlace() {
  const b = JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
  const wins = onScreen(app.pid);
  if (!wins) return { ok: undefined, why: '창 목록을 못 읽음' };
  const hit = wins.find((w) => near(w.w, b.width) && near(w.h, b.height) && near(w.x, b.x) && near(w.y, b.y));
  return { ok: !!hit, why: hit ? '' : `펫 ${JSON.stringify(b)} 가 목록에 없음 (${wins.length}개)` };
}
const dockStats = async () => JSON.parse(await main('JSON.stringify(__jj.dock.stats())'));
const homeAlive = () => main('!!__jj.home.window && !__jj.home.window.isDestroyed()');
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return !!(await fn());
}
const typeIs = (want, ms) => waitFor(() => appType(app.pid) === want, ms);

const body = async () => {
  await main('1');
  await sleep(2500);
  const base = appType(app.pid);
  const space0 = activeSpace();
  record.base = { type: base, space: space0 };
  check('0. 처음 앱 종류가 Foreground 가 아니다 (Dock 없는 앱)', !!base && base !== 'Foreground', `type=${base}`);
  check('0. 지금 데스크톱 번호를 읽었다', space0 !== undefined, `space=${space0}`);
  const p0 = await petInPlace();
  check('0. 펫이 지금 데스크톱에 있다', p0.ok === true, p0.why);
  if (!base || base === 'Foreground') throw new Error('기준 앱 종류를 못 잡았다 (이미 Foreground 이거나 lsappinfo 실패)');
  await main("__jj.settings.set({ panelView: 'window' }); 1");
  const cycleSpaces = [];

  // ---- 1. 열고 닫기 5번 ----
  for (let i = 1; i <= 5; i++) {
    await main('__jj.home.open(); 1');
    const up = await typeIs('Foreground', 3000);
    const alive = await homeAlive();
    const sOpen = activeSpace();
    const pOpen = await petInPlace();
    await main('__jj.home.window.close(); 1');
    const down = await typeIs(base, 4000);
    await sleep(1800);
    const st = await dockStats();
    const sClose = activeSpace();
    const pClose = await petInPlace();
    cycleSpaces.push(sOpen, sClose);
    check(`1.${i} 열면 3초 안에 Foreground (큰 창 ${alive ? '있음' : '없음'})`, up && alive, `type=${appType(app.pid)}`);
    check(`1.${i} 닫으면 4초 안에 처음 종류(${base})로 돌아온다`, down, `type=${appType(app.pid)}`);
    check(`1.${i} 닫은 뒤 app.dock.isVisible() 거짓`, st.visible === false, JSON.stringify({ visible: st.visible, shows: st.shows, hides: st.hides }));
    check(`1.${i} 데스크톱 번호 그대로 (열 때 ${sOpen}, 닫을 때 ${sClose}, 처음 ${space0})`, sOpen === space0 && sClose === space0);
    check(`1.${i} 펫이 열려 있는 동안과 닫은 뒤 모두 지금 데스크톱에 제자리`, pOpen.ok === true && pClose.ok === true, `${pOpen.why} ${pClose.why}`.trim());
  }

  // ---- 2. 빠르게 열고 닫기 ----
  const st2a = await dockStats();
  let quickErr = '';
  try {
    for (let i = 0; i < 12; i++) {
      await main('__jj.home.open(); 1');
      await sleep(120);
      if (await homeAlive()) await main('__jj.home.window.close(); 1');
      await sleep(120);
    }
  } catch (err) {
    quickErr = String(err);
  }
  const settled = await typeIs(base, 5000);
  await sleep(2000);
  const st2b = await dockStats();
  const calls = st2b.shows + st2b.hides - (st2a.shows + st2a.hides);
  check('2. 빠르게 열고 닫기 12번: 오류 없이 끝났다', quickErr === '', quickErr);
  check('2. 멈춘 뒤 5초 안에 처음 종류로 돌아온다', settled, `type=${appType(app.pid)}`);
  check('2. 멈춘 뒤 app.dock.isVisible() 거짓 (아이콘이 남지 않는다)', st2b.visible === false, JSON.stringify(st2b.visible));
  check('2. Dock 호출이 열고 닫은 횟수(24)보다 적다 (묶어 부른다)', calls < 24, `호출 ${calls}번`);
  check('2. 데스크톱 번호 그대로', activeSpace() === space0);
  record.quick = { calls, events: st2b.events.slice(-30) };

  // ---- 3. 숨기기 ----
  await main('__jj.home.open(); 1');
  await typeIs('Foreground', 3000);
  await sleep(1300);
  await main('__jj.home.hide(); 1');
  check('3. 숨기면 4초 안에 처음 종류', await typeIs(base, 4000), `type=${appType(app.pid)}`);
  await sleep(1200);
  await main('__jj.home.open(); 1');
  check('3. 숨긴 창을 다시 열면 Foreground', await typeIs('Foreground', 3000), `type=${appType(app.pid)}`);
  await sleep(1300);
  await main('__jj.home.hide(); 1');
  const gone = await waitFor(async () => !(await homeAlive()), KEEP_MS + 4000);
  check(`3. 숨긴 채 ${KEEP_MS}ms 지나 없어지면 처음 종류 (창 ${gone ? '없음' : '남음'})`, gone && (await typeIs(base, 4000)), `type=${appType(app.pid)}`);

  // ---- 4. 펫 창 설정 다시 걸기와 앱 종류 ----
  await main('__jj.home.open(); 1');
  await typeIs('Foreground', 3000);
  await sleep(1300);
  const reasserted = await main(`(() => {
    const w = __jj.pet.win;
    w.setAlwaysOnTop(true, 'floating');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
    return w.isVisibleOnAllWorkspaces();
  })()`);
  await sleep(800);
  check('4. 큰 창이 열린 동안 펫 창 설정을 다시 걸어도 앱 종류가 Foreground 그대로 (KEEP_APP_TYPE)', appType(app.pid) === 'Foreground', `type=${appType(app.pid)}`);
  check('4. 펫 창 isVisibleOnAllWorkspaces 가 참이다', reasserted === true);
  await main('__jj.home.window.close(); 1');
  await typeIs(base, 4000);
  await sleep(1800);
  const pAfter = await petInPlace();
  check('4. Dock 을 껐다 켠 뒤에도 펫이 모든 데스크톱 창이고 지금 데스크톱에 제자리', (await main('__jj.pet.win.isVisibleOnAllWorkspaces()')) === true && pAfter.ok === true, pAfter.why);

  // ---- 5. 앱을 진짜 앞으로 가져온 채 (FOCUS) ----
  if (!FOCUS) skip('5. 앱을 진짜 앞으로 가져온 채 열고 닫기', 'JJ_DOCK_PROBE_FOCUS=1 이 없다. JJ_NO_FOCUS 에서는 창을 앞으로 가져오지 않아 끌림이 생길 수 없다');
  else {
    let moved = 0;
    for (let i = 1; i <= 5; i++) {
      await main('__jj.home.open(); 1');
      await sleep(1200);
      if (activeSpace() !== space0) moved++;
      await main('__jj.panel.togglePanel(); 1');
      await sleep(800);
      if (activeSpace() !== space0) moved++;
      await main('__jj.home.window.close(); 1');
      await typeIs(base, 4000);
      await sleep(1500);
      if (activeSpace() !== space0) moved++;
    }
    check('5. 진짜 앞으로 가져오며 열고, 펫 누르는 길로 다시 부르고, 닫기 5번: 데스크톱 번호가 한 번도 안 바뀐다', moved === 0, `바뀐 횟수 ${moved}`);
  }

  // ---- 6. 전체 화면 (FULLSCREEN) ----
  if (!FULLSCREEN) skip('6. 전체 화면', 'JJ_DOCK_PROBE_FULLSCREEN=1 이 없다');
  else {
    await main('__jj.home.open(); 1');
    await typeIs('Foreground', 3000);
    await sleep(1300);
    await main('__jj.home.window.setFullScreen(true); 1');
    await sleep(2500);
    const sFull = activeSpace();
    const pFull = onScreen(app.pid);
    const petB = JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));
    check('6.1 큰 창 전체 화면: 새 데스크톱이 생겼다 (번호가 바뀜)', sFull !== undefined && sFull !== space0, `처음 ${space0}, 지금 ${sFull}`);
    check('6.1 그 데스크톱 위에도 펫 창이 떠 있다 (전체 화면 위에 같이 지냄)', !!pFull?.some((w) => near(w.w, petB.width) && near(w.h, petB.height)), `창 ${pFull?.length}개`);
    await main('__jj.home.window.setFullScreen(false); 1');
    await sleep(2500);
    const sBack = activeSpace();
    const pBack = await petInPlace();
    check('6.1 전체 화면을 풀면 처음 데스크톱 번호로 돌아오고 펫이 제자리', sBack === space0 && pBack.ok === true, `번호 ${sBack}, ${pBack.why}`);
    check('6.1 풀린 뒤에도 펫 창은 모든 데스크톱 창이다', (await main('__jj.pet.win.isVisibleOnAllWorkspaces()')) === true);
    await main('__jj.home.window.close(); 1');
    await typeIs(base, 4000);
    await sleep(1800);

    // 다른 앱의 전체 화면: 별도 Electron 프로세스가 검은 전체 화면 창을 띄운다
    const otherJs = join(scratch, 'other-app.js');
    writeFileSync(
      otherJs,
      "const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const w = new BrowserWindow({ show: true, backgroundColor: '#000' }); w.setFullScreen(true); }); setTimeout(() => app.quit(), 45000);",
    );
    const other = spawn(electronPath, [otherJs], { env: { PATH: env.PATH, HOME: homeDir }, stdio: 'ignore' });
    others.push(other);
    await sleep(4500);
    const sOther = activeSpace();
    check('6.2 다른 앱이 전체 화면이 되어 데스크톱이 바뀌었다 (시험 준비)', sOther !== undefined && sOther !== space0, `처음 ${space0}, 지금 ${sOther}`);
    if (sOther !== undefined && sOther !== space0) {
      const visibleOver = onScreen(app.pid) ?? [];
      check('6.2 다른 앱 전체 화면 위에는 펫이 안 올라간다 (원래 정함)', visibleOver.length === 0, `우리 창 ${visibleOver.length}개 보임`);
      // 작은 패널을 부를 때(기준)와 큰 창을 부를 때의 데스크톱 결과를 견준다
      await main("__jj.settings.set({ panelView: 'compact' }); __jj.panel.togglePanel(); 1");
      await sleep(2500);
      const afterPanel = activeSpace();
      await main('__jj.panel.window?.close(); 1');
      await sleep(1000);
      await main("__jj.settings.set({ panelView: 'window' }); 1");
      const before = activeSpace();
      await main('__jj.panel.togglePanel(); 1');
      await sleep(2500);
      const afterHome = activeSpace();
      check(
        '6.2 다른 앱 전체 화면 위에서 큰 창을 부르는 결과가 작은 패널을 부를 때보다 더 끌지 않는다',
        afterHome === before || afterHome === afterPanel,
        `패널 뒤 ${afterPanel}, 큰 창 전 ${before}, 큰 창 뒤 ${afterHome}`,
      );
      record.otherFullscreen = { sOther, afterPanel, before, afterHome };
      await main('__jj.home.window?.close(); 1');
    }
    other.kill('SIGTERM');
    await sleep(3500);
    check('6.2 다른 앱 전체 화면이 끝나면 처음 데스크톱 번호로 돌아온다', activeSpace() === space0, `번호 ${activeSpace()}`);
    check('6.2 끝난 뒤 펫이 제자리', (await petInPlace()).ok === true);
    await typeIs(base, 4000);
  }

  // ---- 7. 여러 데스크톱 (KEYS, FOCUS) ----
  if (!(KEYS && FOCUS)) skip('7. 여러 데스크톱에서 끌림', 'JJ_DOCK_PROBE_KEYS=1 과 JJ_DOCK_PROBE_FOCUS=1 이 둘 다 있어야 한다');
  else {
    const hop = (arrow) =>
      execFileSync('osascript', ['-e', `tell application "System Events" to key code ${arrow} using control down`], { stdio: 'ignore' });
    await main('__jj.home.open(); 1');
    await typeIs('Foreground', 3000);
    await sleep(1300);
    const sA = activeSpace();
    let sB;
    try {
      hop(124); // →
      await sleep(1500);
      sB = activeSpace();
      if (sB === sA) {
        hop(123); // ← (오른쪽에 데스크톱이 없으면 왼쪽으로)
        await sleep(1500);
        sB = activeSpace();
      }
    } catch (err) {
      record.hopError = String(err);
    }
    if (sB === undefined || sB === sA) skip('7. 여러 데스크톱', '데스크톱이 하나뿐이거나 손쉬운 사용 권한이 없어 옮기지 못했다');
    else {
      await main('__jj.panel.togglePanel(); 1'); // 펫 누르기와 같은 길: 큰 창이 열려 있으니 큰 창을 앞으로
      await sleep(2500);
      const sAfter = activeSpace();
      const homeHere = (onScreen(app.pid) ?? []).some((w) => w.w >= 700 && w.h >= 500);
      check('7. 데스크톱 B 에서 펫 누르는 길로 큰 창을 부르면 B 에 머문다 (A 로 끌려가지 않는다)', sAfter === sB, `A ${sA}, B ${sB}, 뒤 ${sAfter}`);
      check('7. 큰 창이 지금 데스크톱 B 에 떠 있다', homeHere);
      await main('__jj.home.window?.close(); 1');
      check('7. 닫으면 처음 종류로 돌아온다', await typeIs(base, 4000), `type=${appType(app.pid)}`);
      // 처음 데스크톱으로 돌아간다
      try {
        hop(sB > sA ? 123 : 124);
        await sleep(1500);
      } catch {}
      check('7. 처음 데스크톱으로 돌아왔다', activeSpace() === sA, `번호 ${activeSpace()}`);
    }
  }

  await main("__jj.settings.set({ panelView: 'compact' }); 1");
  const fin = await dockStats();
  record.final = fin;
};

try {
  await body();
} catch (err) {
  check('시험이 끝까지 돌았다', false, err instanceof Error ? err.message : String(err));
} finally {
  const pid = app.pid;
  await cleanup();
  await sleep(500);
  // 8. 앱을 끝내면 Dock 아이콘이 없다
  check('8. 앱을 끝낸 뒤 Dock 아이콘이 없다 (lsappinfo 가 이 pid 를 못 찾는다)', appType(pid) === undefined);
  writeFileSync(join(OUT, 'probe.json'), JSON.stringify(record, null, 1));
}
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
