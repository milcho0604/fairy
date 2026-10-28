// 2D 그림 세트 만들기 창: 한 번 호출로 두 줄 시트(서기 8칸, 걷기 8칸)를 받는 흐름. 앱은 임시 데이터/HOME, JJ_NO_FOCUS, CDP 로만 조작하고,
// 그림 서버는 가짜(__jj.maker.debugSpriteFetch)라 진짜 무료 횟수를 쓰지 않는다. 가짜 서버는 요청한 크기(높이 256 또는 512)대로 합성 시트를 돌려준다.
//   npm run build && SCEN=full|broken LANG_UNDER_TEST=ko THEME=light WIDTH=900 OUT=/tmp/sprites-sheet node scripts/dev/sprites-sheet.mjs
//   full: 다섯 동작이 다 된다 (호출은 다섯 번, 서기와 걷기는 1024x512), 저장하면 28 자세가 든다
//   broken: 걷기 시트의 일곱째 칸을 비운다. 첫 줄(walk-0~3)이 온전해 그 줄만 쓰고 아래 줄 네 칸은 뺀다 (호출은 다섯 번 그대로)
//   BEFORE=1 이면 옛 빌드(한 줄 띠)의 같은 화면을 찍는다 (전후 비교 그림용, 검사는 안 함)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import electron from 'electron';

const lang = process.env.LANG_UNDER_TEST === 'en' ? 'en' : 'ko';
const theme = process.env.THEME === 'dark' ? 'dark' : 'light';
const scen = process.env.SCEN === 'broken' ? 'broken' : 'full';
const width = Number(process.env.WIDTH ?? 900);
const before = !!process.env.BEFORE;
const root = process.env.APP_ROOT ?? resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'fairy-sheet-'));
const data = join(scratch, 'data');
const home = join(scratch, 'home');
process.env.OUT ??= '/tmp/sprites-sheet';
for (const d of [data, join(data, 'pets'), home, process.env.OUT]) mkdirSync(d, { recursive: true });

// ----- 합성 그림 (주황 고양이, 단색 배경) -----
const BG = [26, 227, 31];
const ORANGE = [230, 120, 40];
const DARK = [120, 60, 20];
const WHITE = [250, 250, 250];
const PINK = [240, 150, 160];
function canvas(w, h, bg) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...bg, 255], i * 4);
  return { w, h, d };
}
const put = (c, x, y, col) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < c.w && y < c.h) c.d.set([...col, 255], (y * c.w + x) * 4);
};
function ellipse(c, cx, cy, rx, ry, col) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(c, x, y, col);
}
function rect(c, x0, y0, w, h, col) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(c, x, y, col);
}
function tri(c, [ax, ay], [bx, by], [cx, cy], col) {
  const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) || 1;
  for (let y = Math.floor(minY); y <= maxY; y++)
    for (let x = Math.floor(minX); x <= maxX; x++) {
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) put(c, x, y, col);
    }
}
/** 정면 고양이 한 칸. look: 눈동자 방향(-1~1), mood 로 몸을 조금 바꾼다 */
function front(c, ox, oy, o = {}) {
  const cx = ox + 128;
  const squash = o.mood === 'sit' ? 0.9 : o.mood === 'sleep' ? 0.8 : 1;
  const base = oy + 232;
  const bodyH = 66 * squash;
  ellipse(c, cx, base - bodyH, 58, bodyH, ORANGE);
  const hy = base - bodyH * 2 - 30 * squash;
  tri(c, [cx - 52, hy - 20], [cx - 22, hy - 62], [cx - 6, hy - 30], ORANGE);
  tri(c, [cx + 52, hy - 20], [cx + 22, hy - 62], [cx + 6, hy - 30], ORANGE);
  ellipse(c, cx, hy, 54, 46, ORANGE);
  const gx = (o.look?.[0] ?? 0) * 7;
  const gy = (o.look?.[1] ?? 0) * 6;
  for (const s of [-1, 1]) {
    if (o.blink || o.mood === 'sleep') rect(c, cx + s * 20 - 10, hy - 4, 20, 4, DARK);
    else {
      ellipse(c, cx + s * 20, hy - 4, 12, 13, WHITE);
      ellipse(c, cx + s * 20 + gx, hy - 4 + gy, 5, 6, [20, 20, 20]);
    }
  }
  ellipse(c, cx, hy + 14, 6, 4, PINK);
  if (o.mood === 'yawn' || o.mood === 'talk1') ellipse(c, cx, hy + 28, 12, o.mood === 'yawn' ? 14 : 8, [150, 40, 50]);
  if (o.mood === 'wave') rect(c, cx + 52, base - 150, 18, 76, ORANGE);
  rect(c, cx - 34, base - 14, 20, 14, DARK);
  rect(c, cx + 14, base - 14, 20, 14, DARK);
}
/** 옆모습 걷기 한 칸 (오른쪽을 본다). phase 0~1 로 다리가 엇갈린다 */
function side(c, ox, oy, phase) {
  const cx = ox + 120;
  const base = oy + 232;
  const bob = Math.abs(Math.sin(phase * Math.PI * 2)) * 6;
  ellipse(c, cx, base - 84 - bob, 74, 40, ORANGE);
  ellipse(c, cx + 78, base - 112 - bob, 36, 33, ORANGE);
  tri(c, [cx + 62, base - 138 - bob], [cx + 70, base - 172 - bob], [cx + 88, base - 142 - bob], ORANGE);
  ellipse(c, cx + 92, base - 116 - bob, 5, 6, [20, 20, 20]);
  rect(c, cx - 98, base - 126 - bob, 14, 54, ORANGE);
  for (let i = 0; i < 4; i++) {
    const x = cx - 54 + i * 34 + Math.sin((phase + (i % 2) * 0.5) * Math.PI * 2) * 22;
    const lift = Math.max(0, Math.cos((phase + (i % 2) * 0.5) * Math.PI * 2)) * 10;
    rect(c, Math.round(x) - 8, Math.round(base - 56 - lift), 16, Math.round(56 + lift - (i < 2 ? 0 : 0)), i % 2 ? DARK : ORANGE);
  }
}
const STAND = [
  { look: [0, 0] }, { blink: true }, { look: [-1, 0] }, { look: [1, 0] },
  { look: [0, -1] }, { look: [0, 1] }, { look: [-1, -1] }, { look: [1, -1] },
];
const REST = [{ mood: 'sit' }, { mood: 'sit', blink: true }, { mood: 'sleep' }, { mood: 'yawn' }];
const FEEL = [{ mood: 'happy' }, { mood: 'sit' }, { look: [-1, 1] }, { mood: 'wave' }];
const TALK = [{}, { mood: 'talk1' }, { mood: 'sit' }, { blink: true }];
function sheet(kind, lines, skip = -1) {
  const c = canvas(1024, 256 * lines, BG);
  const n = lines * 4;
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    const ox = (i % 4) * 256;
    const oy = Math.floor(i / 4) * 256;
    if (kind === 'walk') side(c, ox, oy, i / 8);
    else front(c, ox, oy, { stand: STAND, rest: REST, feel: FEEL, talk: TALK }[kind][i]);
  }
  return c;
}
function png(c) {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    Buffer.from(c.d.buffer, y * c.w * 4, c.w * 4).copy(raw, y * (c.w * 4 + 1) + 1);
  }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// 펫 그림 (기준 그림): 투명 배경 주황 고양이
const pet = canvas(320, 320, [0, 0, 0]);
for (let i = 0; i < pet.w * pet.h; i++) pet.d[i * 4 + 3] = 0;
{
  const tmp = canvas(256, 256, BG);
  front(tmp, 0, 0, {});
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      if (tmp.d[i] === BG[0] && tmp.d[i + 1] === BG[1] && tmp.d[i + 2] === BG[2]) continue;
      pet.d.set(tmp.d.subarray(i, i + 4), ((y + 32) * 320 + x + 32) * 4);
    }
}
writeFileSync(join(data, 'pets', 'pet-1.png'), png(pet));
writeFileSync(
  join(data, 'settings.json'),
  JSON.stringify({ onboarded: true, lang, osNotify: false, wander: false, chatter: 'quiet', petImage: 'pet-1.png', petName: 'Tabby' }),
);
const sheets = {
  stand256: png(sheet('stand', 1)),
  stand512: png(sheet('stand', 2)),
  walk256: png(sheet('walk', 1)),
  walk512: png(sheet('walk', 2)),
  walk512broken: png(sheet('walk', 2, 6)),
  rest: png(sheet('rest', 1)),
  feel: png(sheet('feel', 1)),
  talk: png(sheet('talk', 1)),
};

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
let code = 0;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT}/json/list`)).ok, 'inspector');
  await until(() => main('typeof __jj !== "undefined"'), '__jj');
  // 가짜 그림 서버: Gradio 규약 (upload, call, SSE, file). 요청한 높이(256 또는 512)와 요청문으로 어느 시트를 줄지 고른다
  await main(`globalThis.__sheets = ${JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.toString('base64')])))}; globalThis.__calls = []; globalThis.__broken = ${scen === 'broken'}; 1`);
  await main(`__jj.maker.debugSpriteFetch(async (url, init = {}) => {
    const J = (x) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/gradio_api/upload')) return J(['/tmp/gradio/up/pet.png']);
    if (url.endsWith('/gradio_api/call/infer') && init.method === 'POST') {
      const d = JSON.parse(init.body).data;
      const p = String(d[0]);
      const h = d[6];
      const kind = /walking/.test(p) ? 'walk' : /sitting/.test(p) && /yawning/.test(p) ? 'rest' : /jumping with joy/.test(p) ? 'feel' : /talking/.test(p) ? 'talk' : 'stand';
      const key = kind === 'rest' || kind === 'feel' || kind === 'talk' ? kind : kind + (h === 512 ? (kind === 'walk' && globalThis.__broken ? '512broken' : '512') : '256');
      globalThis.__calls.push({ w: d[5], h, kind, key });
      globalThis.__next = key;
      return J({ event_id: 'e' + globalThis.__calls.length });
    }
    if (url.includes('/gradio_api/call/infer/')) return new Response('event: complete\\ndata: [{"path": "/tmp/gradio/out/s.png", "meta": {"_type": "gradio.FileData"}}, 1]\\n\\n');
    if (url.includes('/gradio_api/file=')) return new Response(Buffer.from(globalThis.__sheets[globalThis.__next], 'base64'), { headers: { 'content-type': 'image/png' } });
    return new Response('no', { status: 404 });
  }); 1`);
  await main('__jj.maker.open("sprites"); 1');
  await sleep(1500);
  const m = await page('maker');
  await m.send('Emulation.setDeviceMetricsOverride', { width, height: Number(process.env.HEIGHT ?? 2600), deviceScaleFactor: 1, mobile: false });
  await m.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const tag = `${lang}-${theme}-${width}-${scen}`;
  await until(async () => await m.ev(`!!document.querySelector('.sprite-rows')`), 'rows');
  const state = () =>
    m.ev(`(() => ({
      rows: Object.fromEntries([...document.querySelectorAll('.sprite-row')].map((r) => [r.dataset.row, r.className.replace('sprite-row ', '')])),
      pics: [...document.querySelectorAll('.sprite-pic')].map((i) => i.alt),
      states: Object.fromEntries([...document.querySelectorAll('.sprite-row')].map((r) => [r.dataset.row, r.querySelector('.sprite-row-state')?.textContent ?? ''])),
      strips: [...document.querySelectorAll('.sprite-strip')].map((i) => [i.naturalWidth, i.naturalHeight]),
      error: document.querySelector('.error')?.textContent ?? '',
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }))()`);
  await m.ev(`document.querySelector('.actions .primary').click()`);
  await until(async () => {
    const s = await state();
    return Object.values(s.rows).every((v) => v !== 'wait' && v !== 'run');
  }, 'all rows', 600);
  await sleep(800);
  const s = await state();
  const calls = await main('JSON.stringify(globalThis.__calls)').then(JSON.parse);
  await m.shot(`sheet-${tag}${before ? '-before' : ''}`);
  if (before) {
    console.log('ok before', tag, JSON.stringify(calls.map((c) => c.h)), s.pics.length);
    throw Object.assign(new Error('done'), { quiet: true });
  }
  // 호출은 동작마다 한 번 (칸이 8개인 동작도 한 번), 서기와 걷기는 두 줄 시트
  assert.equal(calls.length, 5, JSON.stringify(calls));
  assert.deepEqual(calls.map((c) => [c.kind, c.w, c.h]), [['stand', 1024, 512], ['walk', 1024, 512], ['rest', 1024, 256], ['feel', 1024, 256], ['talk', 1024, 256]]);
  assert.equal(s.error, '', JSON.stringify(s));
  assert.equal(s.overflowX, false, '가로로 넘침');
  assert.deepEqual(s.strips.slice(0, 2), [[1024, 512], [1024, 512]], '두 줄 시트가 그대로 보인다');
  if (scen === 'full') {
    assert.deepEqual(Object.values(s.rows), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(s.rows));
    assert.equal(s.pics.length, 28, `자세 28장: ${s.pics.join(',')}`);
    for (const n of ['walk-7', 'look-u', 'look-d', 'look-ul', 'look-ur']) assert.ok(s.pics.includes(n), n);
  } else {
    assert.deepEqual(Object.values(s.rows), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(s.rows));
    assert.deepEqual(s.pics.filter((n) => n.startsWith('walk-')), ['walk-0', 'walk-1', 'walk-2', 'walk-3'], '첫 줄만 쓴다');
    assert.ok(s.states.walk.includes('4'), `빼고 쓴 칸 수를 알린다: ${s.states.walk}`);
  }
  // 저장하면 펫 설정에 그림 세트가 든다
  await m.ev(`[...document.querySelectorAll('.actions .primary')].at(-1).click()`);
  await until(async () => await m.ev(`!!document.querySelector('.done')`), 'saved', 100);
  const saved = await main('JSON.stringify(Object.keys(__jj.settings.get().petSprites ?? {}))').then(JSON.parse);
  if (scen === 'full') {
    assert.equal(saved.length, 28, saved.join(','));
    assert.ok(saved.includes('walk-7') && saved.includes('look-ur'));
  } else {
    assert.ok(saved.includes('idle') && saved.includes('look-u') && saved.includes('walk-3') && !saved.includes('walk-4'), saved.join(','));
  }
  await m.shot(`sheet-${tag}-saved`);
  if (scen === 'full') {
    // 저장한 세트가 펫 창에서 여덟 장 걷기와 위, 아래 시선으로 그려진다 (펫 창 __pet.debugRender, 입력은 CDP 로만)
    const pet = await page('pet');
    const states = [
      ...Array.from({ length: 8 }, (_, k) => ({ activity: { type: 'walk', dir: 1, phase: ((k + 0.5) / 4) % 1, steps: (k + 0.5) / 4 } })),
      { gaze: { x: 0, y: -0.9 } }, { gaze: { x: 0, y: 0.9 } }, { gaze: { x: -0.8, y: -0.8 } }, { gaze: { x: 0.8, y: -0.8 } }, {},
    ];
    let shots = [];
    await until(async () => {
      shots = await pet.ev(`__pet.debugRender(${JSON.stringify(states)}, 2)`);
      return shots.length === states.length && new Set(shots.slice(0, 8)).size === 8;
    }, 'pet renders', 150);
    assert.equal(new Set(shots.slice(0, 8)).size, 8, '걷기 여덟 장이 모두 다르게 그려진다');
    assert.equal(new Set(shots.slice(8)).size, 5, '위, 아래, 왼쪽 위, 오른쪽 위 시선과 정면이 모두 다르다');
    shots.forEach((u, i) => writeFileSync(join(process.env.OUT, `pet-${tag}-${i < 8 ? `walk-${i}` : `gaze-${i - 8}`}.png`), Buffer.from(u.split(',')[1], 'base64')));
  }
  console.log('ok', tag, JSON.stringify(calls.map((c) => c.h)), saved.length);
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
