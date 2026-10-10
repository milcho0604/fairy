import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SD_SETUP_STAGES, setupRatio, setupStageOf, setupStagesFor } from '../shared/local-draw.ts';
import {
  classifySdFailure,
  gpuLooksUsable,
  isSdSetupDone,
  killTreeArgs,
  modelsRatio,
  PASS_MINUTES,
  parseSdState,
  pickLocalEngine,
  pictureMinutes,
  ranOnCpu,
  SD_MODEL_BYTES,
  SD_MODELS,
  SD_RELEASE,
  SD_WIN_ASSETS,
  sdAssetUrl,
  sdBinary,
  sdDrawArgs,
  sdDrawRatio,
  sdDrawSize,
  sdLayout,
  sdProgress,
  sdSpaceNeeded,
  sdStepsToRun,
  shouldFallbackToCpu,
  tasklistArgs,
  tasklistHas,
  tierOf,
  unzipArgs,
  winTar,
} from './sdcpp-core.ts';

const GiB = 1024 ** 3;
const m2 = {
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'Apple M2 Pro',
  totalMem: 16 * GiB,
  osRelease: '24.1.0',
};
const win = {
  platform: 'win32',
  arch: 'x64',
  cpuModel: 'Intel(R) Core(TM) i5-1135G7',
  totalMem: 16 * GiB,
  osRelease: '10.0.22631',
};
const intelMac = {
  ...m2,
  arch: 'x64',
  cpuModel: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz',
  osRelease: '22.6.0',
};

test('엔진 고르기: Apple 칩 macOS 14+ 는 mflux, 나머지 되는 컴퓨터는 sd.cpp', () => {
  assert.deepEqual(pickLocalEngine(m2), { ok: true, engine: 'mflux' });
  // Apple 칩 macOS 12, 13 은 Metal
  assert.deepEqual(pickLocalEngine({ ...m2, osRelease: '22.6.0' }), {
    ok: true,
    engine: 'sdcpp',
    backend: 'metal',
  });
  assert.deepEqual(pickLocalEngine({ ...m2, osRelease: '21.0.1' }), {
    ok: true,
    engine: 'sdcpp',
    backend: 'metal',
  });
  // macOS 11 은 직접 빌드한 sd-cli(12 대상)가 안 돈다
  assert.deepEqual(pickLocalEngine({ ...m2, osRelease: '20.6.0' }), { ok: false, reason: 'macos' });
  assert.deepEqual(pickLocalEngine({ ...m2, osRelease: '' }), { ok: false, reason: 'macos' });
  // 인텔 Mac 은 CPU (최신 macOS 여도)
  assert.deepEqual(pickLocalEngine(intelMac), { ok: true, engine: 'sdcpp', backend: 'cpu' });
  assert.deepEqual(pickLocalEngine({ ...intelMac, osRelease: '24.0.0' }), {
    ok: true,
    engine: 'sdcpp',
    backend: 'cpu',
  });
  // 로제타로 도는 인텔용 앱: macOS 14+ 는 mflux, 그 아래는 Apple 칩용 앱을 깔라고
  const rosetta = { ...m2, arch: 'x64', cpuModel: 'VirtualApple @ 2.50GHz processor' };
  assert.deepEqual(pickLocalEngine(rosetta), { ok: true, engine: 'mflux' });
  assert.deepEqual(pickLocalEngine({ ...rosetta, osRelease: '22.1.0' }), { ok: false, reason: 'rosetta' });
  // 윈도우 x64 는 Vulkan 부터
  assert.deepEqual(pickLocalEngine(win), { ok: true, engine: 'sdcpp', backend: 'vulkan' });
  assert.deepEqual(pickLocalEngine({ ...win, arch: 'ia32' }), { ok: false, reason: 'chip' });
  assert.deepEqual(pickLocalEngine({ ...win, arch: 'arm64' }), { ok: false, reason: 'chip' });
  assert.deepEqual(pickLocalEngine({ ...win, platform: 'linux' }), { ok: false, reason: 'os' });
});

test('엔진 고르기: 메모리 8GB 미만은 어디서나 안 된다 (8GiB 를 조금 덜 알려도 된다)', () => {
  for (const sys of [m2, win, intelMac]) {
    assert.deepEqual(pickLocalEngine({ ...sys, totalMem: 4 * GiB }), { ok: false, reason: 'memory' });
    assert.equal(pickLocalEngine({ ...sys, totalMem: 8 * GiB * 0.97 }).ok, true);
  }
});

test('윈도우 그래픽 칩: 기본 렌더러(0x1414)뿐이거나 없으면 CPU 로', () => {
  assert.equal(gpuLooksUsable([{ vendorId: 0x10de }]), true);
  assert.equal(gpuLooksUsable([{ vendorId: 0x1414 }, { vendorId: 0x8086 }]), true);
  assert.equal(gpuLooksUsable([{ vendorId: 0x1414 }]), false);
  assert.equal(gpuLooksUsable([{ vendorId: 0 }]), false);
  assert.equal(gpuLooksUsable([]), false);
  assert.equal(gpuLooksUsable(undefined), false);
});

test('고정한 판: 릴리스 주소, 묶음과 모델 해시 모양', () => {
  assert.equal(
    sdAssetUrl(SD_WIN_ASSETS.vulkan.name),
    'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-win-vulkan-x64.zip',
  );
  assert.ok(SD_RELEASE.commit.startsWith('f89d9b1'));
  for (const a of [...Object.values(SD_WIN_ASSETS), ...SD_MODELS]) assert.match(a.sha256, /^[0-9a-f]{64}$/);
  for (const m of SD_MODELS) assert.ok(m.url.endsWith(`/${m.file}`), m.url);
  // 안내의 5.2GB 와 맞는다
  assert.ok(SD_MODEL_BYTES > 5.1e9 && SD_MODEL_BYTES < 5.3e9);
});

test('자리는 모두 local-draw-sd 안, sd-cli 는 윈도우는 받은 것, 맥은 앱 안', () => {
  const root = '/Users/a/Library/Application Support/Jjakkung/local-draw-sd';
  const l = sdLayout(root);
  for (const v of Object.values(l)) assert.ok(v.startsWith(root), v);
  const base = { l, resourcesPath: '/App/Contents/Resources', appPath: '/src/jj', packaged: true };
  assert.equal(
    sdBinary({ ...base, platform: 'win32', arch: 'x64', backend: 'vulkan' }),
    `${root}/bin/vulkan/sd-cli.exe`,
  );
  assert.equal(
    sdBinary({ ...base, platform: 'win32', arch: 'x64', backend: 'cpu' }),
    `${root}/bin/cpu/sd-cli.exe`,
  );
  assert.equal(
    sdBinary({ ...base, platform: 'darwin', arch: 'arm64', backend: 'metal' }),
    '/App/Contents/Resources/sd/sd-cli',
  );
  // 개발 중에는 build-sdcpp.mjs 가 만든 자리
  assert.equal(
    sdBinary({ ...base, packaged: false, platform: 'darwin', arch: 'x64', backend: 'cpu' }),
    '/src/jj/resources-bin/sd/x64/sd-cli',
  );
});

test('윈도우 도구: 시스템 tar 로 zip 풀기, taskkill 로 자손까지, tasklist 로 남은 것 찾기', () => {
  assert.ok(winTar('C:\\Windows').endsWith('tar.exe'));
  assert.ok(winTar(undefined).startsWith('C:\\Windows'));
  assert.deepEqual(unzipArgs('a.zip', 'd'), ['-xf', 'a.zip', '-C', 'd']);
  assert.deepEqual(killTreeArgs(42), ['/pid', '42', '/T', '/F']);
  assert.deepEqual(tasklistArgs(42), ['/FI', 'PID eq 42', '/FO', 'CSV', '/NH']);
  const out = '"sd-cli.exe","4242","Console","1","1,234,567 K"\r\n';
  assert.equal(tasklistHas(out, 4242), true);
  assert.equal(tasklistHas(out, 42), false);
  // pid 가 다른 프로그램에 다시 쓰였으면 건드리지 않는다
  assert.equal(tasklistHas('"notepad.exe","4242","Console","1","9 K"', 4242), false);
  assert.equal(tasklistHas('INFO: No tasks are running which match the specified criteria.', 4242), false);
});

test('그리기 인자: 4단계 cfg 1.0 euler, GPU 는 오프로드와 flash attention, CPU 는 --backend cpu', () => {
  const l = sdLayout('/r');
  const o = {
    input: '/t/in.jpg',
    output: '/t/out.png',
    prompt: 'a "cute" pet',
    width: 768,
    height: 1024,
    seed: 7,
  };
  const gpu = sdDrawArgs(l, { ...o, backend: 'vulkan' });
  const at = (args: string[], k: string) => args[args.indexOf(k) + 1];
  assert.equal(at(gpu, '--diffusion-model'), '/r/models/flux-2-klein-4b-Q4_0.gguf');
  assert.equal(at(gpu, '--llm'), '/r/models/Qwen3-4B-Q4_K_M.gguf');
  assert.equal(at(gpu, '--vae'), '/r/models/full_encoder_small_decoder.safetensors');
  assert.equal(at(gpu, '-r'), '/t/in.jpg');
  // 요청문은 셸 없이 인자 하나로
  assert.equal(at(gpu, '-p'), 'a "cute" pet');
  assert.equal(at(gpu, '--steps'), '4');
  assert.equal(at(gpu, '--cfg-scale'), '1.0');
  assert.equal(at(gpu, '--sampling-method'), 'euler');
  assert.equal(at(gpu, '-W'), '768');
  assert.equal(at(gpu, '-H'), '1024');
  assert.equal(at(gpu, '--seed'), '7');
  assert.equal(at(gpu, '-o'), '/t/out.png');
  assert.ok(gpu.includes('--offload-to-cpu') && gpu.includes('--diffusion-fa'));
  assert.ok(gpu.includes('--disable-image-metadata'));
  assert.ok(!gpu.includes('--backend'));
  const metal = sdDrawArgs(l, { ...o, backend: 'metal' });
  assert.ok(metal.includes('--offload-to-cpu'));
  const cpu = sdDrawArgs(l, { ...o, backend: 'cpu' });
  assert.equal(at(cpu, '--backend'), 'cpu');
  assert.ok(!cpu.includes('--offload-to-cpu'));
});

test('그릴 크기: GPU 는 긴 변 1024, CPU 는 768, 16 의 배수. 모르면 세로 3:4', () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
  };
  assert.deepEqual(sdDrawSize(png(3000, 4000), 'gpu'), { width: 768, height: 1024 });
  assert.deepEqual(sdDrawSize(png(3000, 4000), 'cpu'), { width: 576, height: 768 });
  assert.deepEqual(sdDrawSize(png(1920, 1080), 'cpu'), { width: 768, height: 432 });
  assert.deepEqual(sdDrawSize(new Uint8Array([1, 2, 3]), 'gpu'), { width: 768, height: 1024 });
});

test('진행 줄 읽기: 그리기(s/it, it/s)와 모델 읽기(MB/s), \\r 로 덮어쓴 마지막 것', () => {
  const load = '\r  |##########                    | 120/480 - 85.32MB/s\x1b[K';
  assert.deepEqual(sdProgress(load), { phase: 'load', n: 120, total: 480 });
  const text = `[INFO ] loading\n${load}\r  |=========================>      | 2/4 - 3.21s/it\x1b[K`;
  assert.deepEqual(sdProgress(text), { phase: 'sample', n: 2, total: 4 });
  assert.deepEqual(
    sdProgress('  |==================================================| 4/4 - 1.50it/s\x1b[K\n'),
    {
      phase: 'sample',
      n: 4,
      total: 4,
    },
  );
  assert.deepEqual(sdProgress('|#####| 1/1 - 1.20GB/s'), { phase: 'load', n: 1, total: 1 });
  assert.equal(sdProgress('[INFO ] stable-diffusion.cpp: 2/4 things'), undefined);
  assert.equal(sdProgress(''), undefined);
  assert.equal(sdProgress('|==| 5/4 - 1.0s/it'), undefined);
});

test('그리기 진행률: 그리기 반, 털 다듬기 반. 읽기 15%, 4단계 80%', () => {
  assert.equal(sdDrawRatio(0), 0.01);
  assert.ok(Math.abs(sdDrawRatio(0, { phase: 'load', n: 1, total: 1 }) - 0.075) < 1e-9);
  assert.ok(Math.abs(sdDrawRatio(0, { phase: 'sample', n: 4, total: 4 }) - 0.475) < 1e-9);
  assert.ok(Math.abs(sdDrawRatio(1, { phase: 'sample', n: 2, total: 4 }) - 0.775) < 1e-9);
  assert.ok(sdDrawRatio(1, { phase: 'sample', n: 4, total: 4 }) < 1);
});

test('실패 고르기: 그래픽 메모리, 윈도우 메모리 부족 코드, 모델 못 읽음, 그 밖은 mflux 규칙', () => {
  const draw = { phase: 'draw' as const };
  assert.equal(
    classifySdFailure('ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory', draw),
    'memory',
  );
  assert.equal(classifySdFailure('std::bad_alloc', draw), 'memory');
  assert.equal(classifySdFailure('', { ...draw, exitCode: 0xc0000017 }), 'memory');
  assert.equal(classifySdFailure('init model loader from file failed: x.gguf', draw), 'notReady');
  assert.equal(classifySdFailure('init model loader from file failed', { phase: 'setup' }), 'failed');
  assert.equal(classifySdFailure('', { ...draw, exitCode: 0xc0000005 }), 'failed');
  assert.equal(classifySdFailure('No space left on device', draw), 'disk');
  assert.equal(classifySdFailure('whatever', { ...draw, aborted: true }), 'cancelled');
  assert.equal(classifySdFailure('whatever', { ...draw, timedOut: true }), 'timeout');
  assert.equal(classifySdFailure('', { ...draw, spawnCode: 'ENOENT' }), 'notReady');
});

test('CPU 로 되돌리기: 그래픽 칩이 죽거나 그래픽 메모리가 모자랄 때만, CPU 는 더 갈 데가 없다', () => {
  assert.equal(shouldFallbackToCpu('vulkan', 'failed', 'exit 3221225477'), true);
  assert.equal(shouldFallbackToCpu('metal', 'failed', ''), true);
  assert.equal(shouldFallbackToCpu('vulkan', 'memory', 'ggml_vulkan: ErrorOutOfDeviceMemory'), true);
  // 컴퓨터 메모리가 모자란 것은 CPU 로 가도 같다
  assert.equal(shouldFallbackToCpu('vulkan', 'memory', 'std::bad_alloc'), false);
  for (const k of ['cancelled', 'timeout', 'disk', 'notReady', 'bad'] as const)
    assert.equal(shouldFallbackToCpu('vulkan', k, 'vulkan'), false, k);
  assert.equal(shouldFallbackToCpu('cpu', 'failed', 'vulkan'), false);
  assert.equal(ranOnCpu('[WARN ] loading CPU backend'), true);
  assert.equal(ranOnCpu('[WARN ] device Vulkan0 failed to init'), true);
  assert.equal(ranOnCpu('[INFO ] Using Vulkan0'), false);
});

test('준비 기록: 깨진 글은 빈 기록, 모르는 모델과 틀린 해시 모양은 버린다', () => {
  assert.deepEqual(parseSdState(undefined), {});
  assert.deepEqual(parseSdState('{oops'), {});
  assert.deepEqual(parseSdState('[1]'), {});
  const m = SD_MODELS[0];
  assert.deepEqual(
    parseSdState(
      JSON.stringify({
        tools: SD_RELEASE.tag,
        models: { [m.file]: m.sha256, 'other.gguf': m.sha256, [SD_MODELS[1].file]: 'nope' },
        backend: 'cpu',
        bytes: 5,
      }),
    ),
    { tools: SD_RELEASE.tag, models: { [m.file]: m.sha256 }, backend: 'cpu', bytes: 5 },
  );
  assert.deepEqual(parseSdState(JSON.stringify({ backend: 'vulkan', bytes: -1 })), {});
});

test('할 단계: 윈도우만 도구, 해시가 기록과 다른 모델만. 다 되면 준비 끝', () => {
  assert.equal(sdStepsToRun({}, 'win32').tools, true);
  assert.equal(sdStepsToRun({}, 'darwin').tools, false);
  assert.equal(sdStepsToRun({}, 'darwin').models.length, 3);
  const all = Object.fromEntries(SD_MODELS.map((m) => [m.file, m.sha256]));
  assert.equal(isSdSetupDone({ models: all }, 'darwin'), true);
  assert.equal(isSdSetupDone({ models: all }, 'win32'), false);
  assert.equal(isSdSetupDone({ models: all, tools: SD_RELEASE.tag }, 'win32'), true);
  // 고정한 판이 바뀌면 다시
  assert.equal(isSdSetupDone({ models: all, tools: 'master-1-old' }, 'win32'), false);
  const one = sdStepsToRun({ models: { [SD_MODELS[0].file]: SD_MODELS[0].sha256 } }, 'darwin');
  assert.deepEqual(
    one.models.map((m) => m.key),
    ['llm', 'vae'],
  );
});

test('준비 빈 공간: 남은 모델 + 도구 + 여유, 받아 둔 .part 만큼 덜, 할 게 없으면 0', () => {
  assert.equal(sdSpaceNeeded({ tools: false, models: [] }), 0);
  const all = sdSpaceNeeded({ tools: true, models: SD_MODELS });
  assert.ok(all > SD_MODEL_BYTES + 1e9 && all < SD_MODEL_BYTES + 1.5e9);
  assert.equal(sdSpaceNeeded({ tools: false, models: SD_MODELS }, 1e9), SD_MODEL_BYTES - 1e9 + 1e9);
  assert.equal(modelsRatio(0, 0), 0);
  assert.equal(modelsRatio(SD_MODEL_BYTES, 0), 1);
  assert.ok(Math.abs(modelsRatio(SD_MODELS[0].bytes, 0) - SD_MODELS[0].bytes / SD_MODEL_BYTES) < 1e-12);
});

test('걸리는 시간: 한 장은 두 번 그리기, CPU 는 GPU 보다 오래', () => {
  assert.deepEqual(pictureMinutes('gpu'), { min: PASS_MINUTES.gpu.min * 2, max: PASS_MINUTES.gpu.max * 2 });
  assert.ok(pictureMinutes('cpu').min > pictureMinutes('gpu').max);
  assert.equal(tierOf('vulkan'), 'gpu');
  assert.equal(tierOf('metal'), 'gpu');
  assert.equal(tierOf('cpu'), 'cpu');
});

test('sd.cpp 준비 단계: 도구 1%, 모델 99%', () => {
  assert.equal(setupStagesFor('sdcpp'), SD_SETUP_STAGES);
  assert.equal(setupRatio('uv', 1, SD_SETUP_STAGES), 0.01);
  assert.ok(Math.abs(setupRatio('model', 0.5, SD_SETUP_STAGES) - 0.505) < 1e-9);
  assert.equal(setupRatio('pack', 1, SD_SETUP_STAGES), 0);
  assert.equal(setupStageOf(0, SD_SETUP_STAGES), 'uv');
  assert.equal(setupStageOf(0.5, SD_SETUP_STAGES), 'model');
  assert.equal(setupStageOf(1, SD_SETUP_STAGES), 'model');
});
