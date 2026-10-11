// 홈페이지 그림을 찍을 시험 인스턴스 (pets.mjs 가 쓴다). CLAUDE.md 시험 창 규칙 그대로:
// JJ_NO_FOCUS=1 (맥북 내장 화면, 투명, 마우스 통과, 포커스 안 뺏음), 빈 JJ_USER_DATA (끝나면 지운다), 입력은 CDP 로만.
// 바깥 인터넷은 막는다 (--proxy-server=127.0.0.1:9): 찍는 동안 AI, 업데이트, 갤러리 요청이 나가지 않게.
// Test instance for the site's pictures: invisible, click-through, built-in display only, empty data folder, no network.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function retry(fn, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('timed out');
}

/** Starts the app. settings: extra settings.json fields. Returns { data, main(expr), page(name), finish(code) }. */
export async function launch(settings = {}) {
  const INSPECT = Number(process.env.JJ_INSPECT_PORT ?? 9851);
  const PAGE = Number(process.env.JJ_PAGE_PORT ?? 9852);
  const data = mkdtempSync(join(tmpdir(), 'fairy-site-'));
  mkdirSync(join(data, 'pets'), { recursive: true });
  writeFileSync(join(data, 'settings.json'), JSON.stringify({
    lang: 'ko', onboarded: true, petName: '콩이', petNameEdited: true, updateCheck: false, wander: false,
    lookAtCursor: false, sound: false, dayRhythm: false, chatter: 'quiet', seasonWear: false, ...settings,
  }));
  writeFileSync(join(data, 'day-plan.json'), JSON.stringify({ prefs: { auto: false, fromMinute: 480 } }));
  const args = [`--inspect=${INSPECT}`, '.', `--remote-debugging-port=${PAGE}`, '--proxy-server=127.0.0.1:9'];
  if (process.platform === 'linux') args.push('--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const app = spawn(electronPath, args, { cwd: root, env: { ...process.env, JJ_NO_FOCUS: '1', JJ_USER_DATA: data }, stdio: 'ignore' });
  console.log('app pid', app.pid, 'data', data);
  let exited = false;
  app.on('exit', () => { exited = true; });
  const finish = async (code) => {
    app.kill('SIGTERM');
    for (let i = 0; i < 20 && !exited; i++) await sleep(250);
    if (!exited) app.kill('SIGKILL');
    for (let i = 0; i < 3; i++) { await sleep(1000); rmSync(data, { recursive: true, force: true }); }
    process.exit(code);
  };
  const mainConn = await retry(async () => {
    const [t] = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
    return t && connect(t.webSocketDebuggerUrl);
  });
  const main = async (expr) => {
    const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
    return m.result?.result?.value;
  };
  const page = async (name) => {
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
    return { ...c, ev };
  };
  return { data, main, page, finish };
}
