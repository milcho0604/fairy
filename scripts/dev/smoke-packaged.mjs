// 설치판(electron-builder --dir 결과) 켜 보기 시험. CI 의 리눅스 묶음 시험(check.yml package-linux)과 손으로 쓴다.
//   node scripts/dev/smoke-packaged.mjs dist/linux-unpacked/jjakkung
// - 빈 데이터 폴더(JJ_USER_DATA)와 JJ_NO_FOCUS=1 로 띄운다 (CLAUDE.md 시험 창 규칙: 창은 보이지 않고 입력을 뺏지 않는다)
// - 화면(--remote-debugging-port)으로 펫 창이 file:// 에서 열리고 그려졌는지 본다
// - 설치판은 ELECTRON_RENDERER_URL 을 무시해야 한다: 가짜 주소를 심어 두고 창이 그쪽으로 가지 않았는지 본다
// - 퓨즈(EnableNodeCliInspectArguments 끔): --inspect 를 줘도 메인 디버거가 열리지 않아야 한다
// 끝나면 앱을 끄고 데이터 폴더를 지운다. 실패하면 앱 기록(logs/main.log) 끝을 보여 주고 1 로 끝난다.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error('사용법: node scripts/dev/smoke-packaged.mjs <설치판 실행 파일>');
  process.exit(2);
}
const PAGE_PORT = Number(process.env.JJ_PAGE_PORT ?? 9852);
const INSPECT_PORT = Number(process.env.JJ_INSPECT_PORT ?? 9851);
const data = mkdtempSync(join(tmpdir(), 'jj-smoke-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(exe, [`--inspect=${INSPECT_PORT}`, `--remote-debugging-port=${PAGE_PORT}`, '--no-sandbox'], {
  env: {
    ...process.env,
    JJ_NO_FOCUS: '1',
    JJ_USER_DATA: data,
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/evil',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => {
  out += d;
});
child.stderr.on('data', (d) => {
  out += d;
});
let exited = false;
child.on('exit', () => {
  exited = true;
});

async function pages() {
  try {
    return await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json/list`)).json();
  } catch {
    return undefined;
  }
}

async function evalIn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  const res = await new Promise((r) => {
    ws.onmessage = (e) => r(JSON.parse(e.data));
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  ws.close();
  return res.result?.result?.value;
}

const problems = [];
try {
  let pet;
  for (let i = 0; i < 120 && !exited; i++) {
    const list = await pages();
    pet = list?.find((p) => p.type === 'page' && p.url.includes('pet.html'));
    if (pet) break;
    await sleep(500);
  }
  if (exited) problems.push('앱이 켜지자마자 끝났다');
  else if (!pet) problems.push('60초 안에 펫 창이 뜨지 않았다');
  else {
    const list = (await pages()) ?? [];
    console.log('창:', list.filter((p) => p.type === 'page').map((p) => p.url.replace(/^.*\//, '')).join(', '));
    for (const p of list.filter((x) => x.type === 'page'))
      if (!p.url.startsWith('file://') && !p.url.startsWith('data:'))
        problems.push(`창이 file:// 가 아닌 곳에서 열렸다: ${p.url}`);
    // 펫이 그려질 때까지 (body 에 무엇이 있고 문서가 다 읽혔다)
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      ok = !!(await evalIn(
        pet.webSocketDebuggerUrl,
        "document.readyState === 'complete' && document.body.childElementCount > 0",
      ).catch(() => false));
      if (!ok) await sleep(500);
    }
    if (!ok) problems.push('펫 창이 그려지지 않았다');
  }
  // 퓨즈: --inspect 가 무시되어야 한다
  const inspect = await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`).then(
    () => true,
    () => false,
  );
  if (inspect) problems.push('--inspect 로 메인 디버거가 열렸다 (Electron 퓨즈 확인)');
} finally {
  child.kill('SIGTERM');
  for (let i = 0; i < 20 && !exited; i++) await sleep(250);
  if (!exited) child.kill('SIGKILL');
}

if (problems.length) {
  console.error(`실패:\n- ${problems.join('\n- ')}`);
  const log = join(data, 'logs', 'main.log');
  if (existsSync(log)) console.error('--- main.log 끝 ---\n', readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
  console.error('--- 출력 끝 ---\n', out.split('\n').slice(-40).join('\n'));
}
// 끝난 뒤에도 크로미엄 자식 프로세스가 잠깐 캐시를 쓴다. 조금 기다렸다 지우고 한 번 더 지운다
for (let i = 0; i < 3; i++) {
  await sleep(1000);
  rmSync(data, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log('설치판 켜 보기 시험 통과');
