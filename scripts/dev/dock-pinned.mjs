// 설정 dockIcon(Dock 에 아이콘 늘 두기) 점검: 시작부터 Dock 에 보이는지, 창을 여닫아도 앱 종류가 Foreground 로 남고 펫 창 설정이
// 그대로인지, 설정을 끄고 켜면 바로 맞는지를 실제 맥에서 잰다. 사용자의 Dock 에 아이콘이 진짜로 뜬다 (JJ_DOCK_PROBE=1 필요).
//
//   JJ_DOCK_PROBE=1 VARIANT=a|b OUT=<레포 밖 폴더> node scripts/dev/dock-pinned.mjs
//
// VARIANT=a: 설치본처럼 Dock 없는 앱(UIElement)으로 시작한 뒤 dock.show (JJ_DOCK_PROBE_LSUI=1), b: 처음부터 Foreground (개발 실행 그대로, 설치본에서 LSUIElement 를 뺀 것과 같다).
// 창은 JJ_NO_FOCUS=1 로 내장 화면에 투명하게 숨고 마우스도 통과시킨다. 입력은 CDP 로만. 포커스를 가져가지 않으므로 onActiveSpace 길은 지나지 않는다
// (focus.ts 는 JJ_NO_FOCUS 에서 showInactive 만 한다). 진짜 데스크톱 전환은 재지 않는다. 끝나면 PID 로 끝내고 Dock 에서 사라졌는지 본다.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';

if (process.env.JJ_DOCK_PROBE !== '1' || process.platform !== 'darwin') {
  console.log('dock-pinned: 맥에서 JJ_DOCK_PROBE=1 일 때만 돈다. 아무것도 하지 않았다.');
  process.exit(2);
}
const VARIANT = process.env.VARIANT === 'a' ? 'a' : 'b';
const root = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(process.env.OUT ?? '/tmp/fairy-dock-pinned');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INSPECT = VARIANT === 'a' ? 9810 : 9820;
const PAGE = INSPECT + 1;
const scratch = mkdtempSync(join(tmpdir(), 'fairy-dock-pinned-'));
const data = join(scratch, 'data');
mkdirSync(data, { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, osNotify: false, lang: 'ko', petName: '콩', wander: false }),
);
const app = spawn(electronPath, [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`], {
  cwd: root,
  env: {
    HOME: scratch,
    SHELL: '/usr/bin/false',
    PATH: '/usr/bin:/bin',
    JJ_USER_DATA: data,
    JJ_TEST_SECRETS: 'memory',
    JJ_NO_FOCUS: '1',
    JJ_DOCK_PROBE: '1',
    JJ_HOME_KEEP_MS: '60000',
    ...(VARIANT === 'a' ? { JJ_DOCK_PROBE_LSUI: '1' } : {}),
  },
  stdio: 'ignore',
});
const t0 = Date.now();
let mainConn;
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  return {
    send: (method, params = {}) =>
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
      }),
  };
}
async function main(expr) {
  for (let i = 0; i < 120 && !mainConn; i++) {
    try {
      const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
      mainConn = await connect(t.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
function appType(pid) {
  // lsappinfo 가 가끔 앱을 못 찾아 비어 온다: 세 번까지 다시 물어본다
  for (let i = 0; i < 3; i++) {
    const r = appTypeOnce(pid);
    if (r !== 'none') return r;
  }
  return 'none';
}
function appTypeOnce(pid) {
  try {
    const found = execFileSync('lsappinfo', ['find', `pid=${pid}`], { encoding: 'utf8' });
    const asn = /ASN:0x[0-9a-f]+-0x[0-9a-f]+/.exec(found)?.[0];
    if (!asn) return 'none';
    const out = execFileSync('lsappinfo', ['info', '-only', 'ApplicationType', `${asn}:`], { encoding: 'utf8' });
    return /"ApplicationType"="([^"]+)"/.exec(out)?.[1] ?? /\btype="([^"]+)"/.exec(out)?.[1] ?? 'none';
  } catch {
    return 'none';
  }
}
function activeSpace() {
  try {
    return Number(
      execFileSync(
        'osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          "ObjC.import('CoreGraphics'); ObjC.bindFunction('CGSMainConnectionID', ['int', []]); ObjC.bindFunction('CGSGetActiveSpace', ['int', ['int']]); $.CGSGetActiveSpace($.CGSMainConnectionID());",
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
  } catch {
    return undefined;
  }
}
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return !!(await fn());
}
const rows = [];
let fails = 0;
let space0;
async function snap(step, want) {
  const st = JSON.parse(await main('JSON.stringify(__jj.dock.stats())'));
  const pet = JSON.parse(
    await main(
      'JSON.stringify({ all: __jj.pet.win.isVisibleOnAllWorkspaces(), top: __jj.pet.win.isAlwaysOnTop(), vis: __jj.pet.win.isVisible() })',
    ),
  );
  const type = appType(app.pid);
  const space = activeSpace();
  const ok = (want === undefined || type === want) && pet.all && pet.top && pet.vis && space === space0;
  if (!ok) fails++;
  rows.push({ step, type, tile: st.visible, shows: st.shows, hides: st.hides, tried: st.triedShow, petAll: pet.all, petTop: pet.top, space, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}: type=${type} dockVisible=${st.visible} shows=${st.shows} hides=${st.hides} petAll=${pet.all} petTop=${pet.top} space=${space}`);
}
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    app.kill('SIGTERM');
  } catch {}
  await sleep(1500);
  try {
    app.kill('SIGKILL');
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});
try {
  await main('1');
  space0 = activeSpace();
  const reached = await waitFor(() => appType(app.pid) === 'Foreground', 8000);
  console.log(`시작 ${Date.now() - t0}ms 만에 Foreground 도달: ${reached}`);
  await sleep(2500);
  await snap('시작 직후 (설정 켬)', 'Foreground');
  await main("__jj.settings.set({ panelView: 'panel' }); 1");
  await main('__jj.panel.openTab(); 1');
  await sleep(1200);
  await snap('작은 패널 열림', 'Foreground');
  await main('__jj.panel.closePanel(); 1');
  await sleep(800);
  await snap('작은 패널 닫음', 'Foreground');
  await main('__jj.home.open(); 1');
  await sleep(1500);
  await snap('큰 창 열림', 'Foreground');
  await main('__jj.home.window.close(); 1');
  await sleep(2500);
  await snap('큰 창 닫음 (아이콘은 남아야 한다)', 'Foreground');
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(1500);
  await snap('채팅 열림', 'Foreground');
  await main('__jj.chat.window?.close(); 1');
  await sleep(1200);
  await snap('채팅 닫음', 'Foreground');
  await main('__jj.settingsWindow.open(); 1');
  await sleep(1500);
  await snap('설정 창 열림', 'Foreground');
  await main('__jj.settingsWindow.window?.close(); 1');
  await sleep(1200);
  await snap('설정 창 닫음', 'Foreground');
  // 설정을 끈다: 큰 창이 닫혀 있으니 곧 사라진다
  await main('__jj.settings.set({ dockIcon: false }); 1');
  const gone = await waitFor(() => appType(app.pid) !== 'Foreground', 6000);
  await sleep(1800);
  await snap(`설정 끔 (6초 안에 아이콘 사라짐: ${gone})`, 'UIElement');
  // 끈 채 큰 창을 열면 보이고, 닫으면 사라진다
  await main('__jj.home.open(); 1');
  await waitFor(() => appType(app.pid) === 'Foreground', 4000);
  await sleep(1300);
  await snap('설정 끔 + 큰 창 열림', 'Foreground');
  // 큰 창이 열린 채로 켜고 끈다: 켜면 그대로, 끄면 큰 창이 닫힐 때까지 남는다
  await main('__jj.settings.set({ dockIcon: true }); 1');
  await sleep(1500);
  await snap('큰 창 열린 채 설정 켬', 'Foreground');
  await main('__jj.settings.set({ dockIcon: false }); 1');
  await sleep(2500);
  await snap('큰 창 열린 채 설정 끔 (아이콘 남아야 한다)', 'Foreground');
  await main('__jj.home.window.close(); 1');
  const gone2 = await waitFor(() => appType(app.pid) !== 'Foreground', 6000);
  await sleep(1800);
  await snap(`큰 창 닫음 (6초 안에 사라짐: ${gone2})`, 'UIElement');
  await main('__jj.settings.set({ dockIcon: true }); 1');
  await waitFor(() => appType(app.pid) === 'Foreground', 4000);
  await sleep(1500);
  await snap('설정 다시 켬', 'Foreground');
  const ev = JSON.parse(await main('JSON.stringify(__jj.dock.stats().events)'));
  writeFileSync(join(OUT, `pinned-${VARIANT}.json`), JSON.stringify({ rows, events: ev }, null, 2));
} catch (err) {
  fails++;
  console.log('오류', String(err));
} finally {
  const pid = app.pid;
  await cleanup();
  await sleep(500);
  const after = appType(pid);
  console.log(`종료 뒤 앱 종류: ${after} (none 이면 Dock 에서 사라짐)`);
  if (after !== 'none') fails++;
}
console.log(fails === 0 ? 'ALL PASS' : `FAIL ${fails}`);
process.exit(fails === 0 ? 0 : 1);
