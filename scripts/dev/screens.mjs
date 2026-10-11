// 문서 화면 다시 찍기: docs/assets/screens/pets.png, pet-styles.png, desktop.png.
// 실제 앱을 시험 인스턴스로 띄워 CDP 로 펫, 말풍선, 패널을 찍고, 앱 안 숨은 창에서 그림 한 장으로 합친다.
// 할 일, 일정은 지어낸 예시만 넣는다 (아래 SAMPLE). 사람 마우스와 키보드는 쓰지 않는다.
//
//   npm run build
//   xvfb-run -a -s "-screen 0 1512x982x24" node scripts/dev/screens.mjs            # 셋 다
//   xvfb-run -a -s "-screen 0 1512x982x24" node scripts/dev/screens.mjs pets       # 하나만 (pets, styles, desktop)
//   OUT=/tmp/shots node scripts/dev/screens.mjs                                     # 다른 곳에 쓰기 (기본 docs/assets/screens)
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 포트 9851(메인), 9852(화면).
// 맥에서 돌리면 창은 내장 화면에 투명하게 뜬다. 리눅스(가상 화면)에서는 소프트웨어 WebGL(SwiftShader)로 입체를 그린다.
// 결과는 찍을 때마다 숨쉬기, 깜빡임 때문에 조금씩 다르다.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_CAT } from '../../src/shared/pet3d/examples.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'docs', 'assets', 'screens'));
const INSPECT = 9851;
const PAGE = 9852;
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 시험 인스턴스 띄우기 ----
const data = mkdtempSync(join(tmpdir(), 'jj-screens-'));
mkdirSync(join(data, 'pets'), { recursive: true });
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({
    lang: 'ko',
    onboarded: true,
    petName: '콩이',
    petNameEdited: true,
    updateCheck: false,
    wander: false,
    lookAtCursor: false,
    sound: false,
    // 찍는 시각(가상 화면은 UTC 새벽일 수 있다)에 따라 졸린 얼굴이 되지 않게
    dayRhythm: false,
    chatter: 'quiet',
  }),
);
const electron = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const args = [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`];
// 가상 화면(그래픽 칩 없음)에서도 입체를 그린다. root 로 돌면 샌드박스를 끈다 (CI 컨테이너)
if (process.platform === 'linux')
  args.push('--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
if (process.getuid?.() === 0) args.push('--no-sandbox');
const app = spawn(electron, args, {
  cwd: root,
  env: { ...process.env, JJ_NO_FOCUS: '1', JJ_USER_DATA: data },
  stdio: 'ignore',
});
let appExited = false;
app.on('exit', () => {
  appExited = true;
});

async function finish(code) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
  rmSync(data, { recursive: true, force: true });
  process.exit(code);
}

// ---- CDP ----
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      const h = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === i) {
          ws.removeEventListener('message', h);
          r(m);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}

async function retry(fn, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // 아직 안 떴다
    }
    await sleep(250);
  }
  throw new Error('시간 초과');
}

const mainConn = await retry(async () => {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
  return t && connect(t.webSocketDebuggerUrl);
});
async function main(expr) {
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails)
    throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
async function page(name) {
  const p = await retry(async () => {
    const list = await (await fetch(`http://127.0.0.1:${PAGE}/json/list`)).json();
    return list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
  });
  const c = await connect(p.webSocketDebuggerUrl);
  return {
    ...c,
    ev: async (expr) =>
      (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
        ?.result?.value,
  };
}

// ---- 펫 찍기 ----
await retry(() => main('typeof __jj === "object" && !!__jj.pet.win'));
const pet = await page('pet');
await pet.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
// 2배로 그려 찍는다 (합칠 때 반으로 줄여 또렷하게)
const SCALE = 2;
async function hiRes(p, w, h) {
  await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false });
}
const NEUTRAL =
  '{hidden:false,grabbed:false,thinking:false,talkingUntil:0,systemBusy:false,excitedUntil:0,userIdleMs:0,focusTimer:false,sulkLevel:0}';
// 가상 화면은 사람 입력이 없어 펫이 졸고(자리 비움), 빌드 직후면 "바빠서" 쉰다. 찍는 동안 늘 깨어 있는 보통 상태로 둔다
await pet.ev(`window.__jjDocs = setInterval(() => window.__pet && __pet.setInputs(${NEUTRAL}), 50); 1`);

/** 펫 몸 칸만 투명 배경으로 (data URL) */
async function shootPet() {
  // 인사 같은 말풍선이 떠 있으면 닫는다 (창이 커져 펫 자리가 바뀐다)
  await pet.ev(`document.getElementById('bubble')?.click(); 1`);
  await sleep(800);
  const { w, p } = await main('({ w: __jj.pet.win.getBounds(), p: __jj.pet.bounds() })');
  await hiRes(pet, w.width, w.height);
  await sleep(1800);
  const r = await pet.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: p.x - w.x, y: p.y - w.y, width: p.width, height: p.height, scale: 1 },
  });
  return `data:image/png;base64,${r.result.data}`;
}

/** 펫 창 통째로 (말풍선 포함). 펫 몸이 창 안 어디인지도 돌려준다 */
async function shootPetWindow() {
  const { w, p } = await main('({ w: __jj.pet.win.getBounds(), p: __jj.pet.bounds() })');
  await hiRes(pet, w.width, w.height);
  await sleep(600);
  const r = await pet.send('Page.captureScreenshot', { format: 'png' });
  return { url: `data:image/png;base64,${r.result.data}`, w, p };
}

async function asKind(kind, style = 'figure', threeD = true) {
  await main(`__jj.library.toDefault(${JSON.stringify(kind)}); __jj.settings.set({ pet3d: ${threeD}, petStyle: '${style}' }); 1`);
  await sleep(2500);
}
async function asStarter(id) {
  await main(`__jj.library.fromStarter(${JSON.stringify(id)}); 1`);
  await sleep(2500);
}

// ---- 합치기: 앱 안 숨은 창에 그려 찍는다 ----
const WALL = `
  background:
    radial-gradient(60% 80% at 18% 55%, #efd3b3 0%, transparent 70%),
    radial-gradient(50% 60% at 80% 20%, #c5c9de 0%, transparent 70%),
    radial-gradient(70% 70% at 65% 95%, #f1c6c6 0%, transparent 70%),
    linear-gradient(120deg, #e8d6c8, #e6cfc6 50%, #d9c8d6);`;
const FONT = `font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'WenQuanYi Zen Hei', sans-serif;`;

async function render(html, width, height, file) {
  const b64 = await main(`(async () => {
    const W = __jj.pet.win.constructor;
    const w = new W({ show: false, width: ${width}, height: ${height}, useContentSize: true, enableLargerThanScreen: true,
      webPreferences: { offscreen: true, sandbox: true } });
    w.setContentSize(${width}, ${height});
    w.webContents.setZoomFactor(1);
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(html)}));
    await new Promise((r) => setTimeout(r, 800));
    const img = await w.webContents.capturePage();
    w.destroy();
    return img.resize({ width: ${width} }).toPNG().toString('base64');
  })()`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
  console.log(`찍음: ${join(OUT, file)}`);
}

/** 펫을 나란히 놓고 이름을 단 띠 (pets.png, pet-styles.png 모양) */
function strip(cells, width, height, petPx) {
  const items = cells
    .map(
      (c) => `<figure><img src="${c.img}" style="width:${petPx}px;height:${petPx}px"><figcaption>${c.label}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;${WALL}${FONT}">
    <div style="position:absolute;inset:0;backdrop-filter:blur(30px)"></div>
    <div style="position:relative;display:flex;justify-content:space-around;align-items:flex-end;height:100%;padding:0 20px 18px;box-sizing:border-box">
    ${items}</div>
    <style>figure{margin:0;display:flex;flex-direction:column;align-items:center}
    figcaption{margin-top:8px;font-size:19px;color:#4a3f38;font-weight:500}</style></body></html>`;
}

let failed = false;
try {
  if (want('pets')) {
    const cells = [];
    for (const [kind, label] of [
      ['kong', '콩'],
      ['cat', '냥이'],
      ['chick', '삐약이'],
      ['dog', '멍멍이'],
      ['bunny', '토순이'],
    ]) {
      await asKind(kind);
      cells.push({ img: await shootPet(), label });
    }
    for (const [id, label] of [
      ['milk', '밀크'],
      ['choco', '초코'],
    ]) {
      await asStarter(id);
      cells.push({ img: await shootPet(), label });
    }
    await render(strip(cells, 1600, 303, 190), 1600, 303, 'pets.png');
  }

  if (want('styles')) {
    const cells = [];
    for (const [style, label] of [
      ['figure', '피규어'],
      ['game', '게임 캐릭터'],
      ['real', '실사'],
      ['fluffy', '복슬복슬 (시험)'],
    ]) {
      await asKind('kong', style);
      // 복슬복슬은 털을 처음 만드는 데 오래 걸린다 (소프트웨어 WebGL)
      if (style === 'fluffy') await sleep(4000);
      cells.push({ img: await shootPet(), label });
    }
    await asKind('kong', 'figure', false);
    cells.push({ img: await shootPet(), label: '납작한 2D' });
    // 사진으로 만든 입체 피규어: 앱에 든 밀크 그림과 요청문 보기 설계도(긴 털 흰 고양이, examples.ts)
    copyFileSync(join(root, 'resources', 'pets', 'milk.png'), join(data, 'pets', 'pet-docs.png'));
    writeFileSync(join(data, 'pets', 'model-docs.json'), JSON.stringify(EXAMPLE_CAT));
    await main(
      `__jj.settings.set({ petImage: 'pet-docs.png', petModel: 'model-docs.json', petDepth: null, pet3d: true, petStyle: 'figure' }); 1`,
    );
    await sleep(3000);
    cells.push({ img: await shootPet(), label: '사진 → 입체 피규어' });
    await render(strip(cells, 1600, 352, 230), 1600, 352, 'pet-styles.png');
  }

  if (want('desktop')) await desktop();
} catch (err) {
  console.error('실패:', err instanceof Error ? err.message : err);
  failed = true;
}
await finish(failed ? 1 : 0);

// ---- 바탕 화면: 펫 셋, 말풍선, 오늘 패널 ----
async function desktop() {
  // 지어낸 할 일과 일정 (오늘 기준)
  await main(`(() => {
    const now = Date.now();
    const d = new Date(now);
    const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    const day = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const s = __jj.store;
    for (const title of ['우산 챙기기', '화분 물 주기', '영수증 정리', '메일 답장']) s.complete(s.add({ title }, now).id, now);
    const main = s.add({ title: '주간 회의 자료 정리', due: day(0), important: true }, now);
    s.addSteps(main.id, ['지난주 숫자 모으기', '그래프 두 장 그리기', '요약 한 장 쓰기'], now);
    const first = s.get(main.id).steps[0];
    if (first) s.toggleStep(first.id, true);
    s.add({ title: '보고서 제출', due: day(0), dueMin: 18 * 60 }, now);
    s.add({ title: '여행 숙소 예약', due: day(2) }, now);
    __jj.events.add({ title: '친구랑 점심', startAt: at(12, 30), endAt: at(13, 30) }, now);
    __jj.events.add({ title: '치과 정기 검진', startAt: at(16, 0), endAt: at(16, 40), reminds: [30] }, now);
    __jj.events.add({ title: '요가 수업', startAt: at(19, 0), endAt: at(20, 0) }, now);
    __jj.panel.refresh();
    return 1;
  })()`);
  // 친구 펫 둘: 냥이(입체), 초코(그림)
  await asKind('cat');
  const cat = await shootPet();
  await asStarter('choco');
  const choco = await shootPet();
  // 콩이가 일정 알림을 말한다 (remind.say.eventSoon 과 같은 글). 그림 친구로 바꾸며 바뀐 이름도 되돌린다
  await asKind('kong');
  await main(`__jj.settings.set({ petName: '콩이' }); __jj.panel.refresh(); 1`);
  await main(
    `__jj.pet.say({ kind: 'answer', text: '30분 뒤 치과 정기 검진! 준비됐어? (오후 4:00)', ttlMs: 60000 }); 1`,
  );
  await sleep(1500);
  const kong = await shootPetWindow();
  // 오늘 패널
  await main(`__jj.panel.openTab('today'); 1`);
  const panel = await page('panel');
  await panel.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const pb = await main('__jj.panel.window.getBounds()');
  await hiRes(panel, pb.width, pb.height);
  await sleep(1500);
  const pshot = await panel.send('Page.captureScreenshot', { format: 'png' });
  const panelImg = `data:image/png;base64,${pshot.result.data}`;

  const W = 1360;
  const H = 949;
  const ground = H - 18;
  // 콩이 창: 펫 몸이 창 안 어디인지 맞춰 바닥에 세운다
  const kx = 735;
  const kTop = ground - (kong.p.y - kong.w.y) - kong.p.height;
  const kLeft = kx - (kong.p.x - kong.w.x);
  const html = `<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;${WALL}${FONT}">
    <div style="position:absolute;inset:0;backdrop-filter:blur(40px)"></div>
    <div style="position:absolute;left:0;top:0;width:100%;height:27px;background:rgba(245,247,250,.75)"></div>
    <img src="${panelImg}" style="position:absolute;left:${W - pb.width - 90}px;top:165px;width:${pb.width}px;height:${pb.height}px">
    <img src="${cat}" style="position:absolute;left:140px;top:${ground - 140}px;width:140px;height:140px">
    <img src="${choco}" style="position:absolute;left:375px;top:${ground - 150}px;width:150px;height:150px">
    <img src="${kong.url}" style="position:absolute;left:${kLeft}px;top:${kTop}px;width:${kong.w.width}px;height:${kong.w.height}px">
    </body></html>`;
  await render(html, W, H, 'desktop.png');
}
