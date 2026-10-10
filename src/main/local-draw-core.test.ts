import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupRatio, setupStageOf } from '../shared/local-draw.ts';
import {
  checkDrawn,
  classifyFailure,
  drawArgs,
  drawRatio,
  drawSize,
  drawTmpBase,
  installArgs,
  installRatio,
  isSetupDone,
  lastFraction,
  layout,
  localDrawEligibility,
  MFLUX_PIN,
  MIN_DRAWN_BYTES,
  mfluxTag,
  modelTag,
  orphanGroupAlive,
  parseProxy,
  parseRunPid,
  parseSetupState,
  saveArgs,
  setupSpaceNeeded,
  stepsToRun,
  tail,
  toolEnv,
  UV_PIN,
  untarArgs,
} from './local-draw-core.ts';

const GiB = 1024 ** 3;
const mac = {
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'Apple M2 Pro',
  totalMem: 16 * GiB,
  osRelease: '24.1.0',
};

test('그릴 수 있는 Mac: Apple 칩(로제타 포함), macOS 14 이상, 메모리 8GB 이상', () => {
  assert.deepEqual(localDrawEligibility(mac), { ok: true });
  // 로제타로 도는 x64 앱: 칩 이름으로 안다 (VirtualApple 도)
  assert.deepEqual(
    localDrawEligibility({ ...mac, arch: 'x64', cpuModel: 'VirtualApple @ 2.50GHz processor' }),
    {
      ok: true,
    },
  );
  assert.deepEqual(localDrawEligibility({ ...mac, arch: 'x64', cpuModel: 'Intel(R) Core(TM) i7' }), {
    ok: false,
    reason: 'chip',
  });
  assert.deepEqual(localDrawEligibility({ ...mac, platform: 'win32' }), { ok: false, reason: 'os' });
  assert.deepEqual(localDrawEligibility({ ...mac, osRelease: '22.6.0' }), { ok: false, reason: 'macos' });
  assert.deepEqual(localDrawEligibility({ ...mac, osRelease: '' }), { ok: false, reason: 'macos' });
  assert.deepEqual(localDrawEligibility({ ...mac, totalMem: 8 * GiB }), { ok: true });
  assert.deepEqual(localDrawEligibility({ ...mac, totalMem: 4 * GiB }), { ok: false, reason: 'memory' });
});

test('자리는 모두 local-draw 안 (빈칸 있는 경로도 그대로)', () => {
  const root = '/Users/a/Library/Application Support/jjakkung/local-draw';
  const l = layout(root);
  for (const v of Object.values(l)) assert.ok(v.startsWith(root), v);
  assert.equal(l.python, `${root}/tools/mflux/bin/python`);
  assert.equal(l.model, `${root}/models/klein4b-q4`);
});

test('자식 환경: 사용자 파이썬, uv, HF 값은 빼고 자리는 local-draw 안으로', () => {
  const l = layout('/x/local-draw');
  const env = toolEnv(
    {
      PATH: '/opt/homebrew/bin',
      HOME: '/Users/a',
      LANG: 'ko_KR.UTF-8',
      UV_PYTHON_DOWNLOADS: 'never',
      UV_INDEX_URL: 'https://evil',
      PYTHONPATH: '/x',
      PYTHONHOME: '/y',
      VIRTUAL_ENV: '/venv',
      CONDA_PREFIX: '/c',
      HF_TOKEN: 'hf_secret',
      HF_HUB_OFFLINE: '1',
      PIP_INDEX_URL: 'x',
      EMPTY: undefined,
    },
    l,
  );
  assert.equal(env.HOME, '/Users/a');
  assert.equal(env.LANG, 'ko_KR.UTF-8');
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  for (const k of [
    'UV_INDEX_URL',
    'PYTHONPATH',
    'PYTHONHOME',
    'VIRTUAL_ENV',
    'CONDA_PREFIX',
    'HF_TOKEN',
    'PIP_INDEX_URL',
    'EMPTY',
  ])
    assert.equal(env[k], undefined, k);
  assert.equal(env.UV_PYTHON_DOWNLOADS, 'automatic');
  assert.equal(env.UV_NO_CONFIG, '1');
  assert.equal(env.UV_PYTHON_PREFERENCE, 'only-managed');
  assert.equal(env.UV_TOOL_DIR, l.toolDir);
  assert.equal(env.UV_TOOL_BIN_DIR, l.binDir);
  assert.equal(env.UV_PYTHON_INSTALL_DIR, l.pythonDir);
  assert.equal(env.UV_CACHE_DIR, l.uvCache);
  assert.equal(env.HF_HOME, l.hfHome);
  assert.equal(env.PYTHONNOUSERSITE, '1');
  // 준비(받기)는 온라인, 그리기는 받기를 막는다
  assert.equal(env.HF_HUB_OFFLINE, undefined);
  assert.equal(toolEnv({}, l, { offline: true }).HF_HUB_OFFLINE, '1');
  assert.ok(toolEnv({}, l).PATH?.includes('/usr/bin'));
  // 회사 망 인증서는 키체인으로
  assert.equal(env.UV_NATIVE_TLS, '1');
  assert.equal(toolEnv({ UV_NATIVE_TLS: '0' }, l).UV_NATIVE_TLS, '1');
});

test('자식 환경 프록시: 시스템 프록시를 넘기고, 셸에 직접 넣은 값이 먼저', () => {
  const l = layout('/x/local-draw');
  const env = toolEnv({}, l, { proxy: 'http://p.corp:8080' });
  assert.equal(env.HTTPS_PROXY, 'http://p.corp:8080');
  assert.equal(env.HTTP_PROXY, 'http://p.corp:8080');
  assert.equal(env.https_proxy, 'http://p.corp:8080');
  assert.equal(toolEnv({}, l).HTTPS_PROXY, undefined);
  assert.equal(
    toolEnv({ HTTPS_PROXY: 'http://mine:1' }, l, { proxy: 'http://p:2' }).HTTPS_PROXY,
    'http://mine:1',
  );
});

test('resolveProxy 글 읽기: 앞에서부터, DIRECT 가 먼저면 없음, SOCKS 와 이상한 글은 건너뜀', () => {
  assert.equal(parseProxy('DIRECT'), undefined);
  assert.equal(parseProxy(''), undefined);
  assert.equal(parseProxy(undefined), undefined);
  assert.equal(parseProxy('PROXY proxy.corp:8080'), 'http://proxy.corp:8080');
  assert.equal(parseProxy('PROXY proxy.corp:8080; DIRECT'), 'http://proxy.corp:8080');
  assert.equal(parseProxy('HTTPS secure.corp:443'), 'https://secure.corp:443');
  assert.equal(parseProxy('DIRECT; PROXY p:1'), undefined);
  assert.equal(parseProxy('SOCKS5 s:1080; PROXY p:3128'), 'http://p:3128');
  assert.equal(parseProxy('SOCKS5 s:1080'), undefined);
  assert.equal(parseProxy('proxy [::1]:8080'), 'http://[::1]:8080');
  assert.equal(parseProxy('PROXY a b:1'), undefined);
  assert.equal(parseProxy('PROXY user@evil:1'), undefined);
  assert.equal(parseProxy('PROXY nohost'), undefined);
});

test('명령 인자: 셸 없이 배열로, 고정한 판으로', () => {
  const l = layout('/r');
  assert.deepEqual(untarArgs(l), [
    '-xzf',
    '/r/download/uv-aarch64-apple-darwin.tar.gz',
    '-C',
    '/r/uv',
    '--strip-components',
    '1',
  ]);
  const inst = installArgs();
  assert.ok(inst.includes(`mflux==${MFLUX_PIN.version}`));
  assert.equal(inst[inst.indexOf('--python') + 1], '3.12');
  assert.equal(inst[inst.indexOf('--exclude-newer') + 1], MFLUX_PIN.excludeNewer);
  assert.deepEqual(saveArgs(l), [
    l.save,
    '--model',
    'flux2-klein-4b',
    '--quantize',
    '4',
    '--path',
    l.modelPart,
  ]);
  const prompt = 'say "hi"; rm -rf ~ $(x)';
  const a = drawArgs(l, {
    input: '/t/in.png',
    output: '/t/out.png',
    prompt,
    width: 768,
    height: 1024,
    seed: 42,
  });
  assert.equal(a[0], l.generate);
  assert.equal(a[a.indexOf('--prompt') + 1], prompt);
  assert.equal(a[a.indexOf('--model') + 1], l.model);
  assert.equal(a[a.indexOf('--base-model') + 1], 'flux2-klein-4b');
  assert.equal(a[a.indexOf('--steps') + 1], '4');
  assert.equal(a[a.indexOf('--guidance') + 1], '1.0');
  assert.equal(a[a.indexOf('--width') + 1], '768');
  assert.equal(a[a.indexOf('--height') + 1], '1024');
  assert.equal(a[a.indexOf('--seed') + 1], '42');
  assert.ok(a.includes('--low-ram'));
  assert.equal(a.at(-1), '/t/out.png');
});

test('그릴 크기: 사진 비율대로 긴 변 1024, 16 의 배수. 모르면 768x1024', () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(32);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
  };
  assert.deepEqual(drawSize(png(3000, 4000)), { width: 768, height: 1024 });
  assert.deepEqual(drawSize(png(1920, 1080)), { width: 1024, height: 576 });
  assert.deepEqual(drawSize(new Uint8Array([1, 2, 3])), { width: 768, height: 1024 });
});

test('진행 글: tqdm 의 n/m 을 \\r 로 덮어쓴 줄에서도 마지막 것', () => {
  const s =
    '  0%|          | 0/4 [00:00<?, ?it/s]\r 50%|█████     | 2/4 [00:10<00:10,  5.0s/it]\r 75%|███▌| 3/4 [00:15<00:05]';
  assert.deepEqual(lastFraction(s), { n: 3, total: 4 });
  assert.equal(lastFraction('loading weights...'), undefined);
  const save =
    'Fetching 12 files: 100%|█| 12/12 [01:00<00:00]\nSaving components:  33%|███| 1/3 [00:20<00:40]';
  assert.deepEqual(lastFraction(save, /Saving components/), { n: 1, total: 3 });
  assert.equal(lastFraction('Fetching 3 files: | 1/3 [', /Saving/), undefined);
  // 날짜 같은 것(10/10/2026)이나 n > m 은 진행이 아니다
  assert.equal(lastFraction('x | 9/4 ['), undefined);
});

test('uv 설치 진행: 받기 시작과 끝 줄을 센다', () => {
  assert.equal(installRatio(''), 0);
  assert.equal(installRatio('Downloading torch (120MiB)\nDownloading mlx (30MiB)\n Downloaded mlx\n'), 0.45);
  assert.equal(installRatio('Downloading a\nDownloaded a\n'), 0.9);
});

test('그리기 진행률: 그리기 반, 털 다듬기 반', () => {
  assert.equal(drawRatio(0), 0.035);
  assert.ok(Math.abs(drawRatio(0, { n: 4, total: 4 }) - 0.475) < 1e-9);
  assert.ok(Math.abs(drawRatio(1, { n: 0, total: 4 }) - 0.575) < 1e-9);
  assert.ok(drawRatio(1, { n: 4, total: 4 }) <= 0.99);
});

test('준비 진행률: 단계 몫을 이어 붙이고, 비율로 단계를 다시 고른다', () => {
  assert.equal(setupRatio('uv', 0), 0);
  assert.equal(setupRatio('uv', 1), 0.01);
  assert.ok(Math.abs(setupRatio('model', 0.5) - (0.06 + 0.44)) < 1e-9);
  assert.equal(setupRatio('pack', 1), 1);
  assert.equal(setupRatio('model', Number.NaN), setupRatio('model', 0));
  assert.equal(setupStageOf(0), 'uv');
  assert.equal(setupStageOf(0.03), 'tools');
  assert.equal(setupStageOf(0.5), 'model');
  assert.equal(setupStageOf(0.97), 'pack');
  assert.equal(setupStageOf(1), 'pack');
});

test('실패 종류: 그만두기, 시간, 공간, 배터리, 메모리, 인터넷 순', () => {
  const setup = { phase: 'setup' as const };
  const draw = { phase: 'draw' as const };
  assert.equal(classifyFailure('No space left on device', { ...setup, aborted: true }), 'cancelled');
  assert.equal(classifyFailure('', { ...draw, timedOut: true }), 'timeout');
  assert.equal(classifyFailure('OSError: [Errno 28] No space left on device', setup), 'disk');
  assert.equal(classifyFailure('', { ...setup, spawnCode: 'ENOSPC' }), 'disk');
  assert.equal(classifyFailure('Battery below 5% threshold: 3%', draw), 'battery');
  assert.equal(
    classifyFailure('[METAL] Command buffer execution failed: Insufficient Memory', draw),
    'memory',
  );
  assert.equal(classifyFailure('', { ...draw, signal: 'SIGKILL' }), 'memory');
  assert.equal(classifyFailure('error: Failed to fetch: `https://pypi.org/simple/mflux/`', setup), 'offline');
  assert.equal(classifyFailure('requests.exceptions.ConnectionError: Max retries', setup), 'offline');
  // 그리기 중 인터넷 글은 준비가 깨진 것이거나 그냥 실패
  assert.equal(classifyFailure('ConnectionError', draw), 'failed');
  assert.equal(classifyFailure('LocalEntryNotFoundError: offline', draw), 'notReady');
  assert.equal(classifyFailure('', { ...draw, spawnCode: 'ENOENT' }), 'notReady');
  assert.equal(classifyFailure('Traceback ... ValueError', draw), 'failed');
});

test('기록 끝부분은 짧게', () => {
  assert.equal(tail('a\r\rb\n\n\nc'), 'a\nb\nc');
  const long = tail('x'.repeat(1000), 10);
  assert.equal(long, `...${'x'.repeat(10)}`);
});

test('준비 기록: 깨진 글은 처음부터, 판이 바뀐 단계부터 다시', () => {
  assert.deepEqual(parseSetupState(undefined), {});
  assert.deepEqual(parseSetupState('{oops'), {});
  assert.deepEqual(parseSetupState('[1]'), {});
  assert.deepEqual(parseSetupState('{"uv":1,"mflux":"","model":"m","x":"y"}'), { model: 'm' });
  const done = { uv: UV_PIN.version, mflux: mfluxTag(), model: modelTag() };
  assert.equal(isSetupDone(done), true);
  assert.deepEqual(stepsToRun(done), { uv: false, mflux: false, model: false });
  assert.deepEqual(stepsToRun({}), { uv: true, mflux: true, model: true });
  // uv 판이 바뀌면 mflux 도 다시 깔지만 줄인 모델은 그대로
  assert.deepEqual(stepsToRun({ ...done, uv: '0.1.0' }), { uv: true, mflux: true, model: false });
  assert.deepEqual(stepsToRun({ ...done, mflux: '0.20.0' }), { uv: false, mflux: true, model: false });
  assert.deepEqual(stepsToRun({ ...done, model: undefined }), { uv: false, mflux: false, model: true });
  assert.equal(isSetupDone({ ...done, model: undefined }), false);
});

test('필요한 빈 공간: 할 단계만, 받아 둔 원본만큼 덜, 줄인 모델 자리는 남김', () => {
  const all = { uv: true, mflux: true, model: true };
  assert.equal(setupSpaceNeeded(all, 0), 22e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: true, model: false }, 0), 2e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: false, model: true }, 5e9), 15e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: false, model: true }, 30e9), 5e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: false, model: true }, -1), 20e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: false, model: true }, Number.NaN), 20e9);
  assert.equal(setupSpaceNeeded({ uv: false, mflux: false, model: false }, 0), 0);
});

test('준비 기록의 폴더 크기: 숫자만', () => {
  assert.deepEqual(parseSetupState('{"model":"m","bytes":6500000000}'), { model: 'm', bytes: 6.5e9 });
  assert.deepEqual(parseSetupState('{"bytes":-1}'), {});
  assert.deepEqual(parseSetupState('{"bytes":"9"}'), {});
});

test('run.pid 읽기: 깨졌거나 이상한 pid 면 없음', () => {
  assert.deepEqual(parseRunPid('{"pid":4321,"root":"/r","startedAt":5}'), {
    pid: 4321,
    root: '/r',
    startedAt: 5,
  });
  assert.deepEqual(parseRunPid('{"pid":4321,"root":"/r"}'), { pid: 4321, root: '/r', startedAt: 0 });
  for (const raw of [
    undefined,
    '',
    '{oops',
    'null',
    '{"pid":1,"root":"/r"}',
    '{"pid":0,"root":"/r"}',
    '{"pid":-5,"root":"/r"}',
    '{"pid":1.5,"root":"/r"}',
    '{"pid":"12","root":"/r"}',
    '{"pid":12,"root":""}',
    '{"pid":12}',
  ])
    assert.equal(parseRunPid(raw), undefined, String(raw));
});

test('남은 묶음: 그 묶음에 local-draw 경로가 든 명령이 있어야 우리 것', () => {
  const root = '/Users/a/Library/Application Support/jjakkung/local-draw';
  const ps = [
    '    1 /sbin/launchd',
    ` 5000 ${root}/tools/mflux/bin/python ${root}/tools/mflux/bin/mflux-save --model flux2-klein-4b`,
    ` 5000 ${root}/tools/mflux/bin/python -c resource_tracker`,
    ' 6000 /Applications/Safari.app/Contents/MacOS/Safari',
    'junk',
  ].join('\n');
  assert.equal(orphanGroupAlive(ps, 5000, root), true);
  // pid 가 다른 프로그램 묶음으로 다시 쓰였으면 건드리지 않는다
  assert.equal(orphanGroupAlive(ps, 6000, root), false);
  assert.equal(orphanGroupAlive(ps, 7000, root), false);
  assert.equal(orphanGroupAlive(ps, 5000, '/other/local-draw'), false);
  assert.equal(orphanGroupAlive('', 5000, root), false);
});

test('그리기 임시 폴더: local-draw/tmp, 경로에 중괄호가 있으면 시스템 임시 폴더', () => {
  assert.equal(
    drawTmpBase(layout('/Users/a/Library/Application Support/jj/local-draw'), '/tmp'),
    '/Users/a/Library/Application Support/jj/local-draw/tmp',
  );
  assert.equal(drawTmpBase(layout('/Users/{a}/local-draw'), '/var/T'), '/var/T');
  assert.equal(drawTmpBase(layout('/Users/a}/local-draw'), '/var/T'), '/var/T');
});

test('그린 그림 확인: 그림 형식, 부탁한 크기, 너무 작지 않음', () => {
  const png = (w: number, h: number, size: number) => {
    const b = new Uint8Array(size);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
  };
  const want = { width: 768, height: 1024 };
  assert.deepEqual(checkDrawn(png(768, 1024, MIN_DRAWN_BYTES + 1), want), { ok: true, kind: 'png' });
  assert.equal(checkDrawn(png(768, 1024, 1000), want).ok, false);
  assert.equal(checkDrawn(png(512, 512, MIN_DRAWN_BYTES + 1), want).ok, false);
  assert.equal(checkDrawn(new Uint8Array(MIN_DRAWN_BYTES + 1), want).ok, false);
});
