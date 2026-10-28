// 다듬기 화면의 옵트인 도구 두 개: 종이 색 지우기와 털 다듬기. 앱은 임시 데이터/HOME, JJ_NO_FOCUS, CDP 로만 조작한다.
// npm run build && PAPER=<옅은 종이 그림> FUR=<털 있는 사진> PHOTO=<사진 배경 사진> WHITE=<흰 바탕의 흰 몸 사진> MODELS=<모델 폴더> LANG_UNDER_TEST=ko THEME=light WIDTH=900 OUT=/tmp/maker-refine node scripts/dev/maker-refine.mjs
//   MODELS 폴더에 isnet-general-use.onnx(사진 모델)가 있어야 한다. 받는 것은 하지 않는다(진짜 네트워크를 쓰지 않는다).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const theme = process.env.THEME === 'dark' ? 'dark' : 'light';
const width = Number(process.env.WIDTH ?? 900);
const { PAPER, FUR, PHOTO, WHITE, MODELS } = process.env;
assert.ok(PAPER && FUR && PHOTO && WHITE && MODELS, 'PAPER, FUR, PHOTO, WHITE, MODELS 가 필요하다');
const scratch = mkdtempSync(join(tmpdir(), 'fairy-refine-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= '/tmp/maker-refine';
for (const d of [data, join(data, 'models'), home, process.env.OUT]) mkdirSync(d, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, lang, osNotify: false, wander: false, chatter: 'quiet' }));
// 받는 것을 흉내 내지 않고 해시가 맞는 진짜 파일을 미리 둔다 (앱이 해시를 맞춰 본다)
const root = process.env.APP_ROOT ?? resolve(import.meta.dirname, '../..');
copyFileSync(join(MODELS, 'isnet-general-use.onnx'), join(data, 'models', 'isnet-general-use.onnx'));
copyFileSync(
  join(dirname(createRequire(import.meta.url).resolve('onnxruntime-web')), 'ort-wasm-simd-threaded.jspi.wasm'),
  join(data, 'models', 'ort-wasm-simd-threaded.jspi-1.30.0.wasm'),
);
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return String(p);
}
process.env.JJ_INSPECT_PORT = await port();
process.env.JJ_PAGE_PORT = await port();
const app = spawn(electron, [`--inspect=${process.env.JJ_INSPECT_PORT}`, '.', `--remote-debugging-port=${process.env.JJ_PAGE_PORT}`], {
  cwd: root,
  env: { ...process.env, HOME: home, PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, SHELL: '/usr/bin/false', JJ_NO_FOCUS: '1', JJ_SHOW: '', JJ_USER_DATA: data, JJ_TEST_SECRETS: 'memory' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
app.stdout.on('data', (b) => { logs += b; });
app.stderr.on('data', (b) => { logs += b; });
const { main, page, sleep, disconnect } = await import('./cdp.mjs');
async function until(fn, label, n = 100) {
  for (let i = 0; i < n; i++) { try { if (await fn()) return; } catch {} await sleep(100); }
  throw new Error(`timeout: ${label}`);
}
const T =
  lang === 'ko'
    ? { paper: '종이 색 지우기', fur: '털 다듬기', paperDone: '종이 색으로 다시 지웠어', offer: '그림용으로 다시 지워 볼까', furDone: '털 끝을 다듬었어', paperFail: '종이 색이 고르지 않아서', paperSimilar: '몸 색이 종이와 비슷해서', same: '더 바꿀 곳이 없어', hollow: '테두리만 남은' }
    : { paper: 'Erase paper color', fur: 'Smooth fur', paperDone: 'Redone with the paper color', offer: 'try the drawing remover', furDone: 'Fur edge smoothed', paperFail: 'The paper color is not even', paperSimilar: 'The body color is close to the paper', same: 'Nothing more to change', hollow: 'leaving just the outline' };
let code = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  await main('__jj.maker.open(); 1');
  await sleep(1500);
  const m = await page('maker');
  await m.send('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false });
  await m.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const tag = `${lang}-${theme}-${width}`;
  const state = () =>
    m.ev(`(() => {
    const c = document.querySelector('.edit canvas');
    const g = c?.getContext('2d');
    const d = g ? g.getImageData(0, 0, c.width, c.height).data : [];
    let kept = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) kept++;
    const btns = [...document.querySelectorAll('.tools.refine button')];
    const undo = [...document.querySelectorAll('.tools .ghost')].find((b) => !b.closest('.refine'));
    return {
      kept,
      labels: btns.map((b) => b.textContent),
      undoOff: undo ? undo.disabled : null,
      hint: [...document.querySelectorAll('.edit .hint')].map((p) => p.textContent).join('|'),
      warn: [...document.querySelectorAll('.edit .warn')].map((p) => p.textContent).join('|'),
      error: document.querySelector('.error')?.textContent ?? '',
      buttons: [...document.querySelectorAll('.edit-actions button')].map((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; }),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  const upload = async (file) => {
    const doc = await m.send('DOM.getDocument', {});
    const q = await m.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
    await m.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
    await until(async () => await m.ev(`!!document.querySelector('.edit canvas') || !!document.querySelector('.error')`), 'edit', 600);
    await sleep(600);
  };
  const click = (i) => m.ev(`document.querySelectorAll('.tools.refine button')[${i}].click()`);
  const settle = async (want) => {
    await until(async () => {
      const s = await state();
      return s.hint.includes(want) || s.warn.includes(want);
    }, `done ${want}`, 300);
    await sleep(300);
  };
  const undo = async () => {
    await m.ev(`[...document.querySelectorAll('.tools .ghost')].find((b) => !b.closest('.refine')).click()`);
    await sleep(400);
  };
  const back = async () => {
    await m.ev(`document.querySelector('.edit-actions .ghost').click()`);
    await sleep(500);
  };
  // 1. 옅은 종이 그림: 종이 색 지우기가 더 많이 살린다, 되돌리기로 원래대로
  await upload(PAPER);
  let s0 = await state();
  assert.deepEqual(s0.labels, [T.paper, T.fur], JSON.stringify(s0));
  assert.equal(s0.error, '', JSON.stringify(s0));
  assert.equal(s0.overflowX, false, '가로로 넘침');
  assert.ok(s0.buttons.every(Boolean), `아래 단추가 창 밖: ${JSON.stringify(s0.buttons)}`);
  // 옅은 그림은 사진 모델이 조각을 많이 남겨 그림용 권하기가 뜬다 (아래 단언이 헛돌지 않게 먼저 본다)
  assert.ok(s0.warn.includes(T.offer), `처음엔 권하기가 보여야 한다: ${s0.warn}`);
  await m.shot(`refine-${tag}-paper-before`);
  await click(0);
  await settle(T.paperDone);
  let s1 = await state();
  assert.ok(s1.kept > s0.kept * 1.3, `옅은 그림을 더 살려야 한다: ${s0.kept} -> ${s1.kept}`);
  assert.equal(s1.undoOff, false);
  assert.ok((await state()).buttons.every(Boolean), '안내가 떠도 아래 단추는 창 안');
  assert.equal(s1.warn.includes(T.offer), false, `종이 지우기 뒤에는 낡은 권하기 상자가 없어야 한다: ${s1.warn}`);
  assert.equal(s1.warn.includes(T.hollow), false, `종이 지우기 뒤에 속 빔 거짓 경고가 뜨면 안 된다: ${s1.warn}`);
  await m.shot(`refine-${tag}-paper-after`);
  // 같은 도구를 또 눌러 바뀐 것이 없으면 이력에 쌓이지 않는다 (한 번 되돌리면 처음으로)
  await click(0);
  await settle(T.same);
  await undo();
  assert.equal((await state()).kept, s0.kept, '되돌리기는 원래 마스크로');
  assert.equal((await state()).hint.includes(T.paperDone), false, '되돌리면 성공 문구는 사라진다');
  assert.ok((await state()).warn.includes(T.offer), '되돌리면 권하기가 다시 보인다');
  // 2. 털 있는 사진: 털 다듬기는 가장자리만 바꾸고(넓이 변화 5% 이내) 되돌릴 수 있다
  await back();
  await upload(FUR);
  s0 = await state();
  await m.shot(`refine-${tag}-fur-before`);
  await click(1);
  await settle(T.furDone);
  s1 = await state();
  assert.ok(Math.abs(s1.kept - s0.kept) < s0.kept * 0.05, `털 다듬기가 모양을 바꾸면 안 된다: ${s0.kept} -> ${s1.kept}`);
  assert.notEqual(s1.kept, s0.kept, '가장자리가 바뀌어야 한다');
  assert.equal(s1.undoOff, false);
  await m.shot(`refine-${tag}-fur-after`);
  await undo();
  assert.equal((await state()).kept, s0.kept);
  // 3. 사진 배경(종이가 아님): 종이 색 지우기는 하지 않고 안내만
  await back();
  await upload(PHOTO);
  s0 = await state();
  await click(0);
  await settle(T.paperFail);
  s1 = await state();
  assert.equal(s1.kept, s0.kept, '못 지웠으면 그대로');
  assert.equal(s1.undoOff, true, '바뀐 게 없으니 되돌리기는 꺼져 있다');
  await m.shot(`refine-${tag}-paper-fail`);
  // 4. 흰 바탕의 흰 몸: 몸을 지우지 않고 안내만
  await back();
  await upload(WHITE);
  s0 = await state();
  await click(0);
  await settle(T.paperSimilar);
  s1 = await state();
  assert.equal(s1.kept, s0.kept, '흰 몸을 지우면 안 된다');
  assert.equal(s1.undoOff, true, '바뀐 게 없으니 되돌리기는 꺼져 있다');
  assert.equal(s1.hint.includes(T.paperDone), false);
  await m.shot(`refine-${tag}-paper-similar`);
  console.log('ok', tag);
} catch (err) {
  console.error(err);
  console.error(logs.slice(-1500));
  code = 1;
} finally {
  disconnect();
  app.kill();
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);
