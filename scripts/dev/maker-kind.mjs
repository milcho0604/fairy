// 다듬기 화면의 지우는 방식(사진용, 그림용)과 그림용 자동 다시 지우기. 앱은 임시 데이터/HOME, JJ_NO_FOCUS, CDP 로만 조작한다.
// npm run build && SCEN=ready|missing CARTOON=<만화 그림> PHOTO=<평범한 사진> MODELS=<모델 폴더> LANG_UNDER_TEST=ko THEME=light WIDTH=900 OUT=/tmp/maker-kind node scripts/dev/maker-kind.mjs
//   MODELS 폴더에 isnet-general-use.onnx(사진 모델)와 isnet-anime.onnx(그림용)가 있어야 한다. SCEN=missing 이면 그림용 모델을 안 두어 권하는 안내를 본다.
//   (그림용 모델을 받는 단추는 누르지 않는다: 진짜 네트워크를 쓰지 않는다)
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
const scen = process.env.SCEN === 'missing' ? 'missing' : 'ready';
const width = Number(process.env.WIDTH ?? 900);
const { CARTOON, PHOTO, MODELS } = process.env;
assert.ok(CARTOON && PHOTO && MODELS, 'CARTOON, PHOTO, MODELS 가 필요하다');
const scratch = mkdtempSync(join(tmpdir(), 'fairy-kind-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= '/tmp/maker-kind';
for (const d of [data, join(data, 'models'), home, process.env.OUT]) mkdirSync(d, { recursive: true });
writeFileSync(join(data, 'settings.json'), JSON.stringify({ onboarded: true, lang, osNotify: false, wander: false, chatter: 'quiet' }));
// 받는 것을 흉내 내지 않고 해시가 맞는 진짜 파일을 미리 둔다 (앱이 해시를 맞춰 본다)
const root = process.env.APP_ROOT ?? resolve(import.meta.dirname, '../..');
copyFileSync(join(MODELS, 'isnet-general-use.onnx'), join(data, 'models', 'isnet-general-use.onnx'));
copyFileSync(
  join(dirname(createRequire(import.meta.url).resolve('onnxruntime-web')), 'ort-wasm-simd-threaded.jspi.wasm'),
  join(data, 'models', 'ort-wasm-simd-threaded.jspi-1.30.0.wasm'),
);
if (scen === 'ready') copyFileSync(join(MODELS, 'isnet-anime.onnx'), join(data, 'models', 'isnet-anime.onnx'));
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
const T = lang === 'ko'
  ? { photo: '사진용', drawing: '그림용', auto: '그림용으로 다시 지웠어', suggest: '그림용으로 다시 지워 볼까', try: '그림용으로 다시 지우기' }
  : { photo: 'Photo', drawing: 'Drawing', auto: 'redid it with the drawing remover', suggest: 'try the drawing remover', try: 'Redo for drawing' };
let code = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  await main('__jj.maker.open(); 1');
  await sleep(1500);
  const m = await page('maker');
  await m.send('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false });
  await m.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const tag = `${lang}-${theme}-${width}-${scen}`;
  const state = () => m.ev(`(() => {
    const fs = document.querySelector('.edit .tools .segmented');
    return {
      labels: fs ? [...fs.querySelectorAll('button')].map((b) => b.textContent) : [],
      on: fs?.querySelector('button.on')?.textContent ?? '',
      hint: [...document.querySelectorAll('.edit .hint')].map((p) => p.textContent).join('|'),
      warn: [...document.querySelectorAll('.edit .warn')].map((p) => p.textContent).join('|'),
      error: document.querySelector('.error')?.textContent ?? '',
      tryBtn: !![...document.querySelectorAll('.edit .warn button')].length,
      buttons: [...document.querySelectorAll('.edit-actions button')].map((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; }),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  const upload = async (file) => {
    const doc = await m.send('DOM.getDocument', {});
    const q = await m.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
    await m.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
    await until(async () => (await m.ev(`!!document.querySelector('.edit canvas') || !!document.querySelector('.error')`)), 'edit', 600);
    await sleep(600);
  };
  // 1. 만화 그림 (카드 배경과 글자가 남는다)
  await upload(CARTOON);
  // BEFORE=1: 방식 전환이 없는 옛 빌드의 같은 화면만 찍는다 (전후 비교 그림용)
  if (process.env.BEFORE) {
    await m.shot(`kind-${tag}-before`);
    console.log('ok before', tag);
    throw Object.assign(new Error('done'), { quiet: true });
  }
  let s = await state();
  assert.deepEqual(s.labels, [T.photo, T.drawing], JSON.stringify(s));
  assert.equal(s.error, '', JSON.stringify(s));
  assert.equal(s.overflowX, false, '가로로 넘침');
  assert.ok(s.buttons.every(Boolean), `아래 단추가 창 밖: ${JSON.stringify(s.buttons)}`);
  if (scen === 'ready') {
    assert.equal(s.on, T.drawing, `자동으로 그림용이어야 한다: ${JSON.stringify(s)}`);
    assert.ok(s.hint.includes(T.auto), JSON.stringify(s));
    await m.shot(`kind-${tag}-auto`);
    // 사진용으로 바꾸면 사진 모델로 다시 지운다 (안내는 사라진다)
    await m.ev(`[...document.querySelectorAll('.edit .tools .segmented button')][0].click()`);
    await until(async () => (await state()).on === T.photo && !(await state()).hint.includes(T.auto), 'to photo', 300);
    s = await state();
    assert.equal(s.error, '', JSON.stringify(s));
    await m.shot(`kind-${tag}-photo`);
    // 다시 그림용
    await m.ev(`[...document.querySelectorAll('.edit .tools .segmented button')][1].click()`);
    await until(async () => (await state()).on === T.drawing, 'to drawing', 300);
  } else {
    assert.equal(s.on, T.photo, JSON.stringify(s));
    assert.ok(s.warn.includes(T.suggest), JSON.stringify(s));
    assert.equal(s.tryBtn, true);
    await m.shot(`kind-${tag}-offer`);
  }
  // 2. 평범한 사진: 안내가 없다
  await m.ev(`document.querySelector('.edit-actions .ghost').click()`);
  await sleep(500);
  await upload(PHOTO);
  s = await state();
  assert.equal(s.on, T.photo, JSON.stringify(s));
  assert.equal(s.hint.includes(T.auto), false, JSON.stringify(s));
  assert.equal(s.warn.includes(T.suggest), false, JSON.stringify(s));
  await m.shot(`kind-${tag}-plain`);
  console.log('ok', tag);
} catch (err) {
  if (!err.quiet) {
    console.error(err);
    console.error(logs.slice(-1500));
    code = 1;
  }
} finally {
  disconnect();
  app.kill();
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);
