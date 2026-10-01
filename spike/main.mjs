// @ts-check
// 0단계 기술 검증 실험 앱. 결과를 stdout 에 "[항목] 값" 형태로 찍는다.
//
//   --pet           펫 창을 띄운다. 사람이 직접 클릭 통과를 확인한다.
//   --idle-test     펫 창을 60초 띄워 두고 CPU, 메모리 평균을 낸다.
//   --capture-test  화면 기록 권한을 읽고 화면 일부를 PNG 로 저장한다.
//   --cli-test      claude 에 이미지 질문을 보내고 시간을 잰다.
//   --gui-path      --cli-test 와 함께. Finder 에서 연 앱처럼 PATH 를 최소로 줄인다.

import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const has = (/** @type {string} */ flag) => process.argv.includes(flag);
// open 으로 띄우면 stdout 을 못 보므로 파일에도 남긴다.
const logFile = join(outDir, 'log.txt');
const log = (/** @type {string} */ tag, /** @type {unknown[]} */ ...rest) => {
  const line = `[${tag}] ${rest.map(String).join(' ')}`;
  console.log(line);
  appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
};

/** 모든 프로세스의 CPU 와 메모리 합. */
function sampleMetrics() {
  const metrics = app.getAppMetrics();
  const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
  const memMB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024;
  return { cpu, memMB, processes: metrics.length };
}

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(join(here, 'pet.html'));

  ipcMain.on('pet:hover', (_e, overPet) => {
    win.setIgnoreMouseEvents(!overPet, { forward: true });
    log('hover', overPet ? '펫 위 (클릭 받음)' : '펫 밖 (클릭 통과)');
  });
  ipcMain.on('pet:event', (_e, name, detail) => log('pet', name, detail ?? ''));

  log('display', JSON.stringify({
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor })),
    primary: display.id,
  }));
  return win;
}

async function captureTest() {
  const status = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'n/a';
  log('permission', 'screen =', status);

  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor;
  const started = performance.now();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width * scale, height: display.size.height * scale },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) {
    log('capture', '실패: 화면 소스가 없다');
    return;
  }
  const rect = { x: 100 * scale, y: 100 * scale, width: 400 * scale, height: 300 * scale };
  const image = source.thumbnail.crop(rect);
  const elapsed = performance.now() - started;
  const file = join(outDir, 'capture.png');
  writeFileSync(file, image.toPNG());

  // 빈 화면(권한 없음)이면 픽셀이 거의 한 색이다. 서로 다른 색 수로 판정한다.
  const bitmap = image.toBitmap();
  const colors = new Set();
  for (let i = 0; i < bitmap.length; i += 4 * 97) colors.add(bitmap.readUInt32LE(i));
  log('capture', JSON.stringify({
    file, ms: Math.round(elapsed), size: image.getSize(), distinctColorsSampled: colors.size,
    verdict: colors.size > 8 ? '내용 있음' : '빈 화면 의심 (권한 확인 필요)',
  }));
}

/** GUI 로 연 앱은 셸 PATH 를 못 받는다. 로그인 셸에 물어서 찾는다. */
function resolveCli(/** @type {string} */ name, /** @type {NodeJS.ProcessEnv} */ env) {
  try {
    return execFileSync('/usr/bin/which', [name], { env, encoding: 'utf8' }).trim();
  } catch {
    log('cli', `${name}: 현재 PATH 에서 못 찾음, 로그인 셸로 다시 찾는다`);
  }
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    return execFileSync(shell, ['-lic', `command -v ${name}`], { encoding: 'utf8', timeout: 10000 })
      .trim().split('\n').pop() ?? '';
  } catch {
    return '';
  }
}

async function cliTest() {
  const env = { ...process.env };
  if (has('--gui-path')) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  log('cli', 'PATH =', env.PATH);

  const claude = resolveCli('claude', env);
  log('cli', 'claude =', claude || '(못 찾음)');
  if (!claude) return;

  const imagePath = existsSync(join(outDir, 'capture.png')) ? join(outDir, 'capture.png') : join(here, 'test.png');
  const data = readFileSync(imagePath).toString('base64');
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        { type: 'text', text: '이 화면에 뭐가 보이는지 한 문장으로 말해 줘.' },
      ],
    },
  };

  const started = performance.now();
  let firstEventMs = 0;
  let firstTextMs = 0;
  const child = spawn(claude, [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--tools', '', '--setting-sources', '', '--no-session-persistence',
    '--append-system-prompt', '너는 데스크톱 펫 짝꿍이다. 반말로 짧게 답한다.',
  ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(JSON.stringify(message) + '\n');

  let buffer = '';
  let partials = 0;
  await new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (!firstEventMs) firstEventMs = performance.now() - started;
        if (event.type === 'stream_event') {
          partials++;
          if (!firstTextMs && event.event?.delta?.text) firstTextMs = performance.now() - started;
        }
        if (event.type === 'result') {
          log('cli', JSON.stringify({
            subtype: event.subtype, answer: event.result, firstEventMs: Math.round(firstEventMs),
            firstTextMs: Math.round(firstTextMs), totalMs: Math.round(performance.now() - started), partials,
          }));
        }
      }
    });
    child.stderr.on('data', (chunk) => log('cli-stderr', String(chunk).trim().slice(0, 300)));
    child.on('close', (code) => { log('cli', 'exit', code); resolve(undefined); });
  });
}

async function idleTest(/** @type {number} */ seconds) {
  createPetWindow();
  const samples = [];
  // 처음 5초는 시작 비용이라 버린다.
  await new Promise((r) => setTimeout(r, 5000));
  app.getAppMetrics();
  for (let i = 0; i < seconds; i += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = sampleMetrics();
    samples.push(s);
    log('metrics', `cpu=${s.cpu.toFixed(2)}% mem=${s.memMB.toFixed(0)}MB procs=${s.processes}`);
  }
  const avg = (/** @type {(s: {cpu:number, memMB:number}) => number} */ f) => samples.reduce((a, s) => a + f(s), 0) / samples.length;
  log('idle', JSON.stringify({
    seconds, avgCpu: Number(avg((s) => s.cpu).toFixed(2)), maxCpu: Number(Math.max(...samples.map((s) => s.cpu)).toFixed(2)),
    avgMemMB: Math.round(avg((s) => s.memMB)),
  }));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();
  try {
    if (has('--capture-test')) await captureTest();
    else if (has('--cli-test')) await cliTest();
    else if (has('--idle-test')) await idleTest(60);
    else { createPetWindow(); return; }
  } catch (err) {
    log('error', err instanceof Error ? err.stack : String(err));
  }
  app.quit();
});
