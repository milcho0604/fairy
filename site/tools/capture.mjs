#!/usr/bin/env node
// 홈페이지 그림의 원본을 지금 앱에서 다시 찍는다: 패널(밝게, 어둡게), 채팅(밝게, 어둡게, AI 고르기), 빠른 입력,
// 시작 안내의 모습 고르기, 사진으로 페어리 만들기 세 단계. 할 일, 일정, 메모, 대화는 모두 지어낸 예시다.
// Re-shoots the raw window captures behind the site's pictures from the current app, with made-up data.
// Then `python3 site/tools/shots.py compose <OUT>` lays them out and `SCREENS=<OUT> python3 site/tools/images.py` makes the webp.
//
//   npm run build
//   python3 site/tools/shots.py photo <OUT>/photo.png          # the sample "photo" for the maker (Milk on a soft backdrop)
//   OUT=<dir> DISPLAY=:<n> node site/tools/capture.mjs          # needs a display (Xvfb on Linux)
//
// 시험 창 규칙 (CLAUDE.md): JJ_NO_FOCUS=1, 빈 JJ_USER_DATA(끝나면 지운다), 포트 JJ_INSPECT_PORT/JJ_PAGE_PORT (기본 9851/9852),
// 입력은 CDP 로만. 선택: BG_MODEL=<isnet-general-use.onnx> 를 주면 배경 지우기 모델을 받지 않고 복사해 쓴다.
// JJ_ORT_WASM_URL 은 그대로 앱에 넘어간다 (scripts/dev/README.md).
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'fairy-site-shots'));
const PHOTO = resolve(process.env.PHOTO ?? join(OUT, 'photo.png'));
const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9851);
const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9852);
const SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ---- test instance ----
const data = mkdtempSync(join(tmpdir(), 'fairy-site-'));
mkdirSync(join(data, 'pets'), { recursive: true });
mkdirSync(join(data, 'models'), { recursive: true });
if (process.env.BG_MODEL) copyFileSync(process.env.BG_MODEL, join(data, 'models', 'isnet-general-use.onnx'));
writeFileSync(join(data, 'settings.json'), JSON.stringify({
  lang: 'ko', onboarded: true, petName: '콩이', petNameEdited: true, updateCheck: false, wander: false,
  lookAtCursor: false, sound: false, dayRhythm: false, chatter: 'quiet', aiKnowsTodos: true,
}));
writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
const args = [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`];
if (process.platform === 'linux') args.push('--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
if (process.getuid?.() === 0) args.push('--no-sandbox');
const app = spawn(electronPath, args, { cwd: root, env: { ...process.env, JJ_NO_FOCUS: '1', JJ_USER_DATA: data }, stdio: 'ignore' });
let appExited = false;
app.on('exit', () => { appExited = true; });
async function finish(code) {
  app.kill('SIGTERM');
  for (let i = 0; i < 20 && !appExited; i++) await sleep(250);
  if (!appExited) app.kill('SIGKILL');
  for (let i = 0; i < 3; i++) { await sleep(1000); rmSync(data, { recursive: true, force: true }); }
  process.exit(code);
}

// ---- CDP ----
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); r(m); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send };
}
async function retry(fn, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('timed out');
}
const mainConn = await retry(async () => {
  const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
  return t && connect(t.webSocketDebuggerUrl);
});
async function main(expr) {
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}
const NO_SCROLLBARS = '*{scrollbar-width:none!important}::-webkit-scrollbar{width:0!important;height:0!important}';
async function page(name) {
  const p = await retry(async () => {
    const list = await (await fetch(`http://127.0.0.1:${PAGE}/json/list`)).json();
    return list.find((x) => x.type === 'page' && x.url.includes(`/${name}.html`));
  });
  const c = await connect(p.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const m = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(`${name}: ${m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text}`);
    return m.result?.result?.value;
  };
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  // macOS hides idle scrollbars; Linux would draw them into every picture
  await ev(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NO_SCROLLBARS)}; document.head.append(s); 1 })()`);
  return {
    ...c,
    ev,
    async size(w, h) { await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false }); },
    async dark(on) { await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }); },
    async shot(file, clip) {
      await sleep(400);
      const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
      console.log('shot', file);
    },
  };
}
const rects = {};

// ---- made-up data ----
const SEED = `(() => {
  const now = Date.now();
  const d = new Date(now);
  const at = (n, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m).getTime();
  const day = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const s = __jj.store;
  s.reward(40, 'docs', now - 3600e3);
  for (const title of ['우산 챙기기', '영수증 정리']) s.complete(s.add({ title }, now - 7200e3).id, now - 3600e3);
  const main = s.add({ title: '주간 회의 자료 정리', due: day(0), dueMin: 18 * 60, important: true }, now - 9000e3);
  s.addSteps(main.id, ['지난주 숫자 모으기', '그래프 두 장 그리기', '요약 한 장 쓰기'], now);
  const first = s.get(main.id).steps[0];
  if (first) s.toggleStep(first.id, true);
  s.add({ title: '부모님 선물 고르기', due: day(3), important: true }, now - 8000e3);
  s.add({ title: '운동 30분', due: day(0), repeat: 'daily' }, now - 7000e3);
  s.add({ title: '은행 들러서 통장 정리', due: day(0) }, now - 6000e3);
  s.add({ title: '블로그 글 초안 쓰기', due: day(2) }, now - 5000e3);
  s.add({ title: '화분 물 주기', due: day(4), repeat: 'weekly' }, now - 4000e3);
  s.add({ title: '여행 사진 정리하기' }, now - 3000e3);
  const e = __jj.events;
  e.add({ title: '친구랑 점심', startAt: at(0, 12, 30), endAt: at(0, 13, 30) }, now);
  e.add({ title: '치과 정기 검진', startAt: at(0, 16, 0), endAt: at(0, 16, 30), reminds: [30] }, now);
  e.add({ title: '요가 수업', startAt: at(0, 19, 0), endAt: at(0, 20, 0) }, now);
  e.add({ title: '주간 회의', startAt: at(1, 10, 0), endAt: at(1, 11, 0) }, now);
  e.add({ title: '동네 도서관 반납', startAt: at(2, 18, 0), endAt: at(2, 18, 30) }, now);
  e.add({ title: '가을 여행 출발', startAt: at(5, 9, 0), endAt: at(5, 10, 0) }, now);
  const n = __jj.notes;
  n.add({ title: '읽고 싶은 책', body: '작은 습관의 힘\\n여름의 빌라\\n도시 산책 안내서' }, now - 86400e3 * 2);
  n.add({ title: '가을 여행 준비물', body: '얇은 패딩, 보조 배터리, 상비약, 카메라 충전기, 숙소 체크인 시간 확인' }, now - 86400e3);
  n.add({ title: '회의 아이디어', body: '다음 분기 목표를 세 줄로 줄여 보기. 숫자보다 사용자 이야기를 먼저.' }, now - 3 * 3600e3);
  n.add({ title: '주말 장보기', body: '두부, 대파, 달걀 한 판, 귤, 우유', source: 'ai' }, now - 3600e3);
  __jj.journey.skip();
  __jj.panel.refresh();
  return 1;
})()`;

const CHAT = `(() => {
  const now = Date.now();
  const md = [
    '오늘 남은 일을 보면 이렇게 가면 좋겠어.',
    '',
    '1. **지금 ~ 15:30** 주간 회의 자료: 그래프 두 장 그리기 (25분 집중 두 번)',
    '2. **16:00** 치과 정기 검진. 가는 길에 은행 들러서 통장 정리',
    '3. **18:00 전** 요약 한 장 쓰고 자료 공유하면 마감 맞출 수 있어',
    '4. **19:00** 요가 수업 (운동 30분은 이걸로 체크해도 될 것 같아)',
    '',
    '블로그 초안은 내일 저녁으로 미뤄도 마감(13일)까지 여유 있어.',
  ].join('\\n');
  __jj.chat.debugSetState(() => ({
    provider: 'claude',
    knowsTodos: true,
    sessions: {},
    usage: { claude: { provider: 'claude', checkedAt: now - 3 * 60000, windows: [
      { label: '5시간', usedPercent: 18, resetsAt: Math.floor(now / 1000) + 3 * 3600 },
      { label: '7일', usedPercent: 41, resetsAt: Math.floor(now / 1000) + 4 * 86400 } ] } },
    messages: [
      { id: 'u1', role: 'user', text: '오늘 일정이랑 할 일 보고 오후 계획 좀 짜 줘' },
      { id: 'p1', role: 'pet', provider: 'claude', status: 'done', text: md },
      { id: 'u2', role: 'user', text: '좋아. 운동 30분은 요가로 칠게!' },
      { id: 'p2', role: 'pet', provider: 'claude', status: 'done', text: '알겠어! 요가 끝나면 "운동 30분"을 끝낸 걸로 표시해 줄게. 오늘도 화이팅 🌱' },
    ],
  }));
  return 1;
})()`;

let failed = false;
try {
  await retry(() => main('typeof __jj === "object" && !!__jj.pet.win'));
  await sleep(1500);
  await main(SEED);

  // ---- panel: four tabs, light and dark ----
  await main(`__jj.panel.openTab('today'); __jj.panel.window.removeAllListeners('blur'); 1`);
  const panel = await page('panel');
  const pb = await main('__jj.panel.window.getBounds()');
  await panel.size(pb.width, pb.height);
  // let the face icon and fonts settle before the first picture
  await panel.ev(`Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => 0))]).then(() => 1)`);
  await sleep(1500);
  for (const dark of [false, true]) {
    await panel.dark(dark);
    for (const tab of ['today', 'todo', 'note', 'event']) {
      await main(`__jj.panel.openTab('${tab}'); 1`);
      await sleep(900);
      await panel.shot(`raw-panel-${tab}${dark ? '-dark' : ''}.png`);
    }
  }
  await panel.dark(false);
  await main(`__jj.panel.openTab('today'); 1`);

  // ---- quick add ----
  await main('__jj.panel.openQuick(); 1');
  await sleep(1200);
  const quick = await page('quick');
  const qb = await main('__jj.panel.quickWindow.getBounds()');
  await quick.size(qb.width, qb.height);
  await quick.dark(false);
  await quick.ev(`document.querySelector('input').focus(); 1`);
  await quick.send('Input.insertText', { text: '내일 오후 3시 치과 예약' });
  await sleep(600);
  await quick.shot('raw-quick.png');
  await main('__jj.panel.quickWindow.hide(); 1');

  // ---- chat: light, dark, and the AI picker ----
  await main('__jj.chat.open(__jj.pet.bounds()); 1');
  await sleep(2500);
  await main(CHAT);
  await main('__jj.chat.window.setSize(400, 700); 1');
  await sleep(600);
  const chat = await page('chat');
  await chat.size(400, 700);
  for (const dark of [false, true]) {
    await chat.dark(dark);
    await chat.ev(`document.querySelector('.messages').scrollTop = 0; 1`);
    await chat.shot(`raw-chat${dark ? '-dark' : ''}.png`);
  }
  await chat.dark(false);
  await chat.ev(`document.querySelector('.picker-button').click(); 1`);
  await sleep(500);
  await chat.shot('raw-chat-picker.png');
  await chat.ev(`document.querySelector('.picker-button').click(); 1`);
  await main('__jj.chat.window.hide(); 1');

  // ---- first-run guide: the look picker ----
  await main('__jj.onboarding.open(); 1');
  await sleep(2000);
  const ob = await page('onboarding');
  await ob.size(480, 560);
  for (const dark of [false, true]) {
    await ob.dark(dark);
    await sleep(300);
    const r = await ob.ev(`(() => { const f = document.querySelector('fieldset.choice'); const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
    rects.onboardingPick = r;
    await ob.shot(`raw-onboarding${dark ? '-dark' : ''}.png`);
  }

  // ---- make a fairy from a photo: pick, touch up, look & name ----
  await main('__jj.maker.open(); 1');
  await sleep(2500);
  const mk = await page('maker');
  const mb = await main(`(() => { const w = require('electron').BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('maker.html')); return w.getContentBounds(); })()`).catch(() => ({ width: 520, height: 520 }));
  // a little taller than the window so the last step shows its buttons without scrolling
  await mk.size(mb.width, Math.max(mb.height, 600));
  await mk.dark(false);
  await sleep(500);
  await mk.shot('raw-maker-pick.png');
  const doc = await mk.send('DOM.getDocument', {});
  const q = await mk.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  await mk.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [PHOTO] });
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    if (await mk.ev(`!!document.querySelector('.edit canvas')`)) break;
    const err = await mk.ev(`document.querySelector('.error')?.innerText ?? ''`);
    if (err) throw new Error('maker: ' + err);
  }
  await sleep(1200);
  await mk.shot('raw-maker-edit.png');
  await mk.ev(`[...document.querySelectorAll('.actions .primary')].at(-1).click(); 1`);
  await sleep(1500);
  await mk.ev(`document.querySelector('.name input').select(); 1`);
  await mk.send('Input.insertText', { text: '솜사탕' });
  await sleep(1200);
  await mk.shot('raw-maker-name.png');

  writeFileSync(join(OUT, 'rects.json'), JSON.stringify({ ...rects, scale: SCALE }, null, 2));
} catch (err) {
  console.error('failed:', err instanceof Error ? err.message : err);
  failed = true;
}
await finish(failed ? 1 : 0);
