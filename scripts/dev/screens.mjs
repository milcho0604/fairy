// 문서 화면 다시 찍기 (docs/assets/screens). 실제 앱을 시험 인스턴스로 띄워 CDP 로 창을 찍고, 앱 안 숨은 창에서 한 장으로 합친다.
// 할 일, 일정, 메모, 대화는 지어낸 예시만 넣는다 (seedSample, CHAT). 사람 마우스와 키보드는 쓰지 않는다.
//
//   npm run build
//   xvfb-run -a -s "-screen 0 1512x982x24" node scripts/dev/screens.mjs            # 다
//   xvfb-run -a -s "-screen 0 1512x982x24" node scripts/dev/screens.mjs panel chat # 고른 것만
//   OUT=/tmp/shots node scripts/dev/screens.mjs                                     # 다른 곳에 쓰기 (기본 docs/assets/screens)
//
// 고를 수 있는 것 (만드는 그림):
//   pets (pets.png), styles (pet-styles.png), desktop (desktop.png),
//   settings (settings-1.png, settings-2.png), panel (panel.png, panel-dark.png, panel-more.png),
//   chat (chat.png, chat-picker.png), quick (quick-add.png), onboarding (onboarding.png),
//   maker (maker-steps.png, maker-more.png, maker-gemini.png)
// maker 는 배경 지우기 모델이 있어야 한다: JJ_BG_MODEL=<받아 둔 isnet-general-use.onnx> (src/main/bg-model.ts, 해시를 맞춘다).
// 없으면 maker 는 건너뛴다. 사진 AI 엔진 wasm 은 node_modules 의 것을 시험 데이터 폴더에 넣는다(해시가 같다).
// 입체 피규어 미리 보기는 AI 대신 요청문 보기 설계도(긴 털 흰 고양이, examples.ts)를 돌려준다.
//
// CLAUDE.md 시험 창 규칙: JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 포트 9851(메인), 9852(화면). JJ_INSPECT_PORT, JJ_PAGE_PORT 로 바꾼다.
// 맥에서 돌리면 창은 내장 화면에 투명하게 뜬다. 리눅스(가상 화면)에서는 소프트웨어 WebGL(SwiftShader)로 입체를 그린다.
// 리눅스에서 맥 글꼴처럼 찍으려면 Pretendard 를 깔고 fontconfig 로 "Apple SD Gothic Neo" 를 그 글꼴로 돌린다 (FONTCONFIG_FILE).
// 스크롤 막대는 맥처럼 숨겨 찍는다. 철마다 옷은 끈다 (찍는 달마다 그림이 달라지지 않게).
// 결과는 찍을 때마다 숨쉬기, 깜빡임, 오늘 날짜와 시각 때문에 조금씩 다르다.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { ORT_WASM } from '../../src/shared/ort-wasm.ts';
import { EXAMPLE_CAT } from '../../src/shared/pet3d/examples.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.env.OUT ?? join(root, 'docs', 'assets', 'screens'));
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9851);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9852);
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
    seasonWear: false,
  }),
);
// 사진으로 만들기: 배경 지우기 모델(받아 둔 것)과 사진 AI 엔진 wasm 을 미리 넣는다 (src/main/bg-model.ts, ort-wasm.ts)
const BG_MODEL = process.env.JJ_BG_MODEL;
const canMake = !!BG_MODEL && existsSync(BG_MODEL);
if (canMake) {
  mkdirSync(join(data, 'models'), { recursive: true });
  copyFileSync(BG_MODEL, join(data, 'models', 'isnet-general-use.onnx'));
  copyFileSync(
    join(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.jspi.wasm'),
    join(data, 'models', ORT_WASM.file),
  );
}
// 아침 계획 화면이 패널을 덮지 않게 저절로 띄우기를 끈다 (src/shared/day-plan.ts PlanPrefs)
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
// 감싼 스크립트(node_modules/.bin/electron) 말고 실행 파일을 바로 띄운다: 끝낼 때 진짜 앱이 끝난 뒤에 데이터 폴더를 지우게
const electron = electronPath;
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
  // 끝난 뒤에도 크로미엄 자식 프로세스가 잠깐 캐시를 쓴다. 조금 기다렸다 지우고 한 번 더 지운다
  for (let i = 0; i < 3; i++) {
    await sleep(1000);
    rmSync(data, { recursive: true, force: true });
  }
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

// ---- 창 찍기 (설정, 패널, 채팅, 빠른 입력, 시작 안내, 만들기) ----
const BG = '#f0eae2';
const winOf = (name) =>
  `__jj.pet.win.constructor.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('${name}.html'))`;
async function closeWin(name) {
  await main(`(() => { const w = ${winOf(name)}; if (w) w.destroy(); return 1; })()`);
  await sleep(300);
}
/**
 * 창 하나를 2배로 찍는다. size 면 창 안 크기를 바꾼다. dark 는 어두운 모드, before 는 찍기 전에 창에서 돌릴 식.
 * 스크롤 막대는 숨긴다 (맥은 겹쳐 뜨는 막대라 평소에 안 보인다)
 */
async function shootWin(name, { size, dark = false, before, wait = 700 } = {}) {
  if (size) await main(`${winOf(name)}.setContentSize(${size[0]}, ${size[1]}); 1`);
  const p = await page(name);
  await p.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await p.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
  });
  await p.ev(`(() => {
    if (!document.getElementById('docs-shot')) {
      const s = document.createElement('style');
      s.id = 'docs-shot';
      s.textContent = '* { scrollbar-width: none !important; caret-color: transparent } *::-webkit-scrollbar { display: none !important }';
      document.head.append(s);
    }
    return 1;
  })()`);
  // 얼굴 그림처럼 늦게 오는 그림을 기다린다
  await p.ev(`Promise.race([
    Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))),
    new Promise((r) => setTimeout(r, 3000)),
  ]).then(() => 1)`);
  await sleep(300);
  if (before) await p.ev(before);
  const [w, h] = await p.ev('[innerWidth, innerHeight]');
  await hiRes(p, w, h);
  await sleep(wait);
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  await p.send('Emulation.clearDeviceMetricsOverride');
  p.ws.close();
  return { img: `data:image/png;base64,${r.result.data}`, w, h };
}

/**
 * 창 사진을 나란히 (설정, 패널 모양). 바깥 크기 W×H 에 맞춰 줄이고, caption 이 있으면 아래에 단다.
 * bare 는 창이 스스로 둥근 모서리와 그림자를 그리는 것(패널, 빠른 입력): 겉에 그림자를 또 두르지 않는다
 */
function cards(shots, W, H, { gap = 26, pad = 28, radius = 10 } = {}) {
  const captions = shots.some((c) => c.caption);
  const capH = captions ? 44 : 0;
  const sumW = shots.reduce((a, c) => a + c.w, 0);
  const maxH = Math.max(...shots.map((c) => c.h));
  const k = Math.min((W - pad * 2 - gap * (shots.length - 1)) / sumW, (H - pad * 2 - capH) / maxH);
  const items = shots
    .map(
      (c) => `<figure><img class="${c.bare ? 'bare' : ''}" src="${c.img}" style="width:${c.w * k}px;height:${c.h * k}px;border-radius:${c.bare ? 0 : radius * k}px">${
        c.caption ? `<figcaption>${c.caption}</figcaption>` : ''
      }</figure>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${BG};${FONT}">
    <div style="display:flex;justify-content:center;align-items:flex-start;gap:${gap}px;padding-top:${(H - capH - maxH * k) / 2}px">${items}</div>
    <style>figure{margin:0;display:flex;flex-direction:column;align-items:center}
    img{display:block;box-shadow:0 6px 22px rgba(60,40,20,.16),0 1px 3px rgba(60,40,20,.12)}
    img.bare{box-shadow:none}
    figcaption{margin-top:18px;font-size:15px;font-weight:600;color:#3d332c}</style></body></html>`;
}

/** 지어낸 할 일, 메모, 일정, 코인 (한 번만) */
let seeded = false;
async function seedSample() {
  if (seeded) return;
  seeded = true;
  await main(`(() => {
    const now = Date.now();
    const d = new Date(now);
    const at = (n, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m).getTime();
    const day = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const s = __jj.store;
    for (const title of ['우산 챙기기', '영수증 정리']) s.complete(s.add({ title }, now - 3600e3).id, now - 1800e3);
    // 미리 알림은 끈다 (찍는 시각에 따라 '방금 울린 알림' 이 패널 위를 덮었다)
    const main = s.add({ title: '주간 회의 자료 정리', due: day(0), dueMin: 14 * 60, important: true, reminds: [] }, now);
    s.addSteps(main.id, ['지난주 숫자 모으기', '그래프 두 장 그리기', '요약 한 장 쓰기'], now);
    const first = s.get(main.id).steps[0];
    if (first) s.toggleStep(first.id, true);
    s.add({ title: '부모님 선물 고르기', due: day(3), important: true }, now);
    s.add({ title: '운동 30분', repeat: 'daily' }, now);
    s.add({ title: '은행 들러서 통장 정리', due: day(0) }, now);
    s.add({ title: '블로그 글 초안 쓰기', due: day(2) }, now);
    s.add({ title: '화분 물 주기', due: day(4), repeat: 'weekly' }, now);
    s.add({ title: '여행 사진 정리하기' }, now);
    const n = __jj.notes;
    n.add({ title: '읽고 싶은 책', body: '작은 습관의 힘, 여름의 빌라, 도시 산책 안내서' }, now - 2 * 86400e3);
    n.add({ title: '가을 여행 준비물', body: '얇은 패딩, 보조 배터리, 상비약, 카메라 충전기, 숙소 체크인 시간' }, now - 86400e3);
    n.add({ title: '회의 아이디어', body: '다음 분기 목표를 세 줄로 줄여 보기. 숫자보다 사용자 이야기를 먼저.' }, now - 3 * 3600e3);
    n.add({ title: '주말 장보기', body: '두부, 대파, 달걀 한 판, 귤, 우유', source: 'ai' }, now - 3600e3);
    const e = __jj.events;
    e.add({ title: '친구랑 점심', startAt: at(0, 12, 30), endAt: at(0, 13, 30) }, now);
    e.add({ title: '치과 정기 검진', startAt: at(0, 16, 0), endAt: at(0, 16, 30), reminds: [30] }, now);
    e.add({ title: '요가 수업', startAt: at(0, 19, 0), endAt: at(0, 20, 0) }, now);
    e.add({ title: '주간 회의', startAt: at(1, 10, 0), endAt: at(1, 11, 0) }, now);
    e.add({ title: '동네 도서관 반납', startAt: at(2, 18, 0), endAt: at(2, 18, 30) }, now);
    s.reward(40, 'docs', now);
    try { __jj.journey.skip(); } catch {}
    __jj.panel.refresh();
    return 1;
  })()`);
}

/** 채팅 예시 대화 (지어낸 것) */
const CHAT = `(() => {
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const answer = [
    '오늘 남은 일을 보면 이렇게 가면 좋겠어.',
    '',
    '1. **지금 ~ 12:20** 주간 회의 자료: 그래프 두 장 그리기 (25분 집중 두 번)',
    '2. **12:30** 친구랑 점심',
    '3. **14:00 전** 자료를 팀 채널에 공유하면 마감 맞출 수 있어',
    '4. **16:00** 치과 정기 검진. 가는 길에 은행 들러서 통장 정리',
    '5. **19:00** 요가 수업 (운동 30분은 이걸로 체크해도 될 것 같아)',
    '',
    '블로그 초안은 내일 저녁으로 미뤄도 마감까지 여유 있어.',
  ].join('\\n');
  __jj.chat.debugSetState((s) => ({
    ...s,
    provider: 'claude',
    pendingId: undefined,
    usage: { claude: { provider: 'claude', checkedAt: now - 3 * 60000, windows: [
      { label: '5시간', usedPercent: 18, resetsAt: sec + 3 * 3600 },
      { label: '7일', usedPercent: 41, resetsAt: sec + 4 * 86400 } ] } },
    messages: [
      { id: 'u1', role: 'user', text: '오늘 일정이랑 할 일 보고 오후 계획 좀 짜 줘' },
      { id: 'p1', role: 'pet', provider: 'claude', status: 'done', text: answer },
      { id: 'u2', role: 'user', text: '좋아. 운동 30분은 요가로 칠게!' },
      { id: 'p2', role: 'pet', provider: 'claude', status: 'done', text: '알겠어! 요가 끝나면 "운동 30분"을 끝낸 걸로 표시해 줄게. 오늘도 화이팅 🌱' },
    ],
  }));
  return 1;
})()`;

async function settingsShots() {
  await main(`__jj.settingsWindow.open(); 1`);
  await sleep(2500);
  const shot = async (tab, caption) => ({
    ...(await shootWin('settings', {
      size: [440, 840],
      before: `document.getElementById('tab-${tab}').click(); document.activeElement?.blur(); document.querySelector('[role=tabpanel]')?.scrollTo?.(0, 0); 1`,
    })),
    caption,
  });
  const a = [await shot('pet', '페어리'), await shot('assist', '비서'), await shot('ai', 'AI')];
  await render(cards(a, 1500, 973), 1500, 973, 'settings-1.png');
  const b = [await shot('ease', '편의'), await shot('data', '데이터'), await shot('about', '정보')];
  await render(cards(b, 1500, 973), 1500, 973, 'settings-2.png');
  await closeWin('settings');
}

async function panelShots() {
  await seedSample();
  await main(`__jj.panel.openTab('today'); 1`);
  await sleep(2000);
  // 패널은 다른 곳을 누르면 닫힌다 (찍는 동안 열어 둔다)
  await main(`__jj.panel.window.removeAllListeners('blur'); 1`);
  const tabs = [
    ['today', '오늘'],
    ['todo', '할 일'],
    ['note', '메모'],
    ['event', '일정'],
  ];
  for (const dark of [false, true]) {
    const shots = [];
    for (const [tab, caption] of tabs) {
      await main(`__jj.panel.openTab('${tab}'); 1`);
      await sleep(900);
      shots.push({ ...(await shootWin('panel', { dark, before: 'document.activeElement?.blur(); 1' })), caption, bare: true });
    }
    await render(cards(shots, 1600, 644), 1600, 644, dark ? 'panel-dark.png' : 'panel.png');
  }
  // 오늘 탭 아래 (이번 주, 업적, 일기)와 상점
  await main(`__jj.panel.openTab('today'); 1`);
  await sleep(900);
  const more = {
    ...(await shootWin('panel', {
      // 접힌 이번 주, 업적, 일기를 펴고 그 자리로 내린다
      before: `(async () => {
        document.activeElement?.blur();
        for (const d of document.querySelectorAll('details.achieve')) d.open = true;
        await new Promise((r) => setTimeout(r, 400));
        const d = document.querySelector('details.achieve.week') ?? document.querySelector('details.achieve');
        d?.scrollIntoView({ block: 'start' });
        let e = d?.parentElement;
        while (e && e.scrollHeight <= e.clientHeight + 4) e = e.parentElement;
        // 끝까지 내려 "아래에 더 있어" 안내가 사라지게 한다
        if (e) e.scrollTop = 1e6;
        return 1;
      })()`,
    })),
    caption: '오늘 아래: 이번 주, 업적, 일기',
    bare: true,
  };
  await main(`__jj.panel.openTab('shop'); 1`);
  await sleep(900);
  const shop = { ...(await shootWin('panel', { before: 'document.activeElement?.blur(); 1' })), caption: '상점', bare: true };
  await render(cards([more, shop], 1000, 789), 1000, 789, 'panel-more.png');
  await main(`__jj.panel.closePanel(); 1`);
}

async function chatShots() {
  await seedSample();
  await main(`__jj.chat.open(__jj.pet.bounds()); 1`);
  await sleep(2500);
  await main(CHAT);
  const size = [400, 770];
  const top = `document.activeElement?.blur(); const m = document.querySelector('.messages'); if (m) m.scrollTop = 0; 1`;
  const light = await shootWin('chat', { size, before: top });
  const dark = await shootWin('chat', { size, dark: true, before: top });
  await render(cards([light, dark], 1200, 1016), 1200, 1016, 'chat.png');
  const picker = await shootWin('chat', {
    size,
    // 메뉴는 바깥을 누르면(mousedown) 닫힌다. 단추를 누른 뒤 메뉴가 그려질 때까지 기다린다
    before: `(async () => {
      ${top};
      document.querySelector('.picker-button').click();
      for (let i = 0; i < 20 && !document.querySelector('.picker-menu'); i++) await new Promise((r) => setTimeout(r, 100));
      return 1;
    })()`,
  });
  await render(cards([picker], 600, 982), 600, 982, 'chat-picker.png');
  await closeWin('chat');
}

async function quickShot() {
  await main(`__jj.panel.openQuick(); 1`);
  await sleep(1500);
  const q = await shootWin('quick', {
    before: `(() => {
      const i = document.querySelector('input, textarea');
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value').set.call(i, '내일 오후 3시 치과 예약');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.blur();
      return 1;
    })()`,
  });
  await render(cards([{ ...q, bare: true }], 800, 170, { pad: 12 }), 800, 170, 'quick-add.png');
  await closeWin('quick');
}

async function onboardingShots() {
  await main(`__jj.onboarding.open(); 1`);
  await sleep(2500);
  const blur = 'document.activeElement?.blur(); 1';
  const first = await shootWin('onboarding', { before: blur });
  const firstDark = await shootWin('onboarding', { dark: true, before: blur });
  const next = `[...document.querySelectorAll('footer button')].at(-1).click(); 1`;
  for (let i = 0; i < 3; i++) {
    const p = await page('onboarding');
    await p.ev(next);
    p.ws.close();
    await sleep(700);
  }
  const tips = await shootWin('onboarding', { before: blur });
  await render(cards([first, firstDark, tips], 1500, 572), 1500, 572, 'onboarding.png');
  await closeWin('onboarding');
}

async function makerShots() {
  if (!canMake) {
    console.log('maker 건너뜀: JJ_BG_MODEL 이 없다');
    return;
  }
  // 사진 대신: 앱에 든 밀크 그림을 밝은 벽 앞에 놓고 찍은 듯한 JPEG (실제 사람, 집 사진을 쓰지 않는다)
  const photo = join(data, 'docs-photo.jpg');
  const milk = `data:image/png;base64,${readFileSync(join(root, 'resources', 'pets', 'milk.png')).toString('base64')}`;
  const b64 = await main(`(async () => {
    const W = __jj.pet.win.constructor;
    const w = new W({ show: false, width: 600, height: 800, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } });
    w.setContentSize(600, 800);
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(
      `<body style="margin:0;width:600px;height:800px;overflow:hidden;background:radial-gradient(70% 60% at 50% 40%, #fbeff0, #e9d3d6)"><img src="${milk}" style="position:absolute;left:40px;top:90px;width:520px;height:620px;object-fit:contain"></body>`,
    )}));
    await new Promise((r) => setTimeout(r, 500));
    const img = await w.webContents.capturePage();
    w.destroy();
    return img.toJPEG(90).toString('base64');
  })()`);
  writeFileSync(photo, Buffer.from(b64, 'base64'));
  await main(`__jj.maker.open(); 1`);
  await sleep(2500);
  // 입체 피규어는 AI 대신 예시 설계도를 돌려준다 (사진은 보내지 않는다). 이 창에만 거는 손잡이(webContents.ipc)가
  // 앱 손잡이(ipcMain)보다 먼저 받는다. AI 가 있는지는 창이 뜰 때 물으니 다시 읽는다
  await main(`(() => {
    const wc = ${winOf('maker')}.webContents;
    wc.ipc.handle('maker:visionAi', () => true);
    wc.ipc.handle('maker:shape3d', async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { ok: true, model: ${JSON.stringify(EXAMPLE_CAT)} };
    });
    wc.reload();
    return 1;
  })()`);
  await sleep(2500);
  const size = [560, 620];
  const blur = 'document.activeElement?.blur(); 1';
  const pick = { ...(await shootWin('maker', { size, before: blur })), caption: '1. 사진 고르기' };
  // AI 일러스트 칸과 Gemini 안내 (사진 고르기 전)
  const illustBtn = `[...document.querySelectorAll('fieldset.segmented button')].at(-1).click()`;
  const illust = { ...(await shootWin('maker', { size: [560, 680], before: `${illustBtn}; ${blur}` })), caption: 'AI 일러스트' };
  const gemini = await shootWin('maker', {
    size: [560, 640],
    before: `(() => {
      const d = [...document.querySelectorAll('details')].find((x) => /Gemini/.test(x.querySelector('summary')?.textContent ?? ''));
      if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
      document.activeElement?.blur();
      return 1;
    })()`,
  });
  await render(cards([gemini], 640, 716), 640, 716, 'maker-gemini.png');
  // 사진 그대로로 돌아와 사진을 넣는다
  let m = await page('maker');
  await m.ev(`[...document.querySelectorAll('fieldset.segmented button')][0].click(); 1`);
  const doc = await m.send('DOM.getDocument', {});
  const q = await m.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  await m.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [photo] });
  await retry(() => m.ev(`!!document.querySelector('.edit canvas')`), 600);
  await sleep(800);
  m.ws.close();
  const edit = { ...(await shootWin('maker', { size, before: blur })), caption: '2. 다듬기' };
  m = await page('maker');
  await m.ev(`[...document.querySelectorAll('.actions .primary')].at(-1).click(); 1`);
  await sleep(1200);
  await m.ev(`(() => {
    const i = document.querySelector('.name input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '솜사탕');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  m.ws.close();
  const name = { ...(await shootWin('maker', { size, before: blur })), caption: '3. 이름' };
  await render(cards([pick, edit, name], 1600, 597), 1600, 597, 'maker-steps.png');
  // 입체 피규어 미리 보기
  m = await page('maker');
  await m.ev(`[...document.querySelectorAll('.look3d fieldset button')][1]?.click(); 1`);
  await sleep(500);
  await m.ev(`document.querySelector('.look3d button.ghost')?.click(); 1`);
  await retry(() => m.ev(`!!document.querySelector('.stage canvas')`), 120);
  await sleep(2000);
  // 돌아가는 중간(옆모습)이 찍히지 않게 정면으로 세운다
  await m.ev(`[...document.querySelectorAll('.spin-tools button')].at(-1)?.click(); 1`);
  await sleep(1500);
  m.ws.close();
  const figure = { ...(await shootWin('maker', { size: [560, 680], before: blur, wait: 1500 })), caption: '입체 피규어' };
  await render(cards([figure, illust], 1200, 724), 1200, 724, 'maker-more.png');
  await closeWin('maker');
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
  if (want('settings')) await settingsShots();
  if (want('panel')) await panelShots();
  if (want('chat')) await chatShots();
  if (want('quick')) await quickShot();
  if (want('onboarding')) await onboardingShots();
  if (want('maker')) await makerShots();
} catch (err) {
  console.error('실패:', err instanceof Error ? err.message : err);
  failed = true;
}
await finish(failed ? 1 : 0);

// ---- 바탕 화면: 펫 셋, 말풍선, 오늘 패널 ----
async function desktop() {
  // 지어낸 할 일과 일정 (다른 그림과 같은 것)
  await seedSample();
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
  await sleep(1500);
  const { img: panelImg, w: pw, h: ph } = await shootWin('panel', { before: 'document.activeElement?.blur(); 1' });
  const pb = { width: pw, height: ph };

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
