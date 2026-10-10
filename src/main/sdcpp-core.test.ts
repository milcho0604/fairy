import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SD_SETUP_STAGES, setupRatio, setupStageOf, setupStagesFor } from '../shared/local-draw.ts';
import {
  classifySdFailure,
  gpuLooksUsable,
  hasVulkanDevice,
  hfResolveUrl,
  isSdSetupDone,
  killTreeArgs,
  looksGpuFailure,
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
  sdLogWatch,
  sdModelPath,
  sdPartPath,
  sdProgress,
  sdSpaceNeeded,
  sdStateOnDisk,
  sdStepsToRun,
  sdUnzipRel,
  shouldFallbackToCpu,
  sysctlFlag,
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
  cpuFeatures: { avx2: true, fma: true },
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

test('엔진 고르기: 인텔 Mac 은 AVX2 와 FMA 가 있어야 (앱 안 sd-cli 가 그것으로 빌드됐다)', () => {
  // Mac Pro Late 2013 (Ivy Bridge-EP Xeon) 은 AVX 만 있다
  const macPro2013 = { ...intelMac, cpuModel: 'Intel(R) Xeon(R) CPU E5-1650 v2 @ 3.50GHz' };
  assert.deepEqual(pickLocalEngine({ ...macPro2013, cpuFeatures: { avx2: false, fma: false } }), {
    ok: false,
    reason: 'chip',
  });
  assert.deepEqual(pickLocalEngine({ ...intelMac, cpuFeatures: { avx2: true, fma: false } }), {
    ok: false,
    reason: 'chip',
  });
  // 모르면 없는 것으로 (켜자마자 죽는 것보다 감추는 편이 낫다)
  assert.deepEqual(pickLocalEngine({ ...intelMac, cpuFeatures: undefined }), { ok: false, reason: 'chip' });
  // Apple 칩과 윈도우는 상관없다
  assert.equal(pickLocalEngine({ ...m2, osRelease: '22.6.0' }).ok, true);
  assert.equal(pickLocalEngine(win).ok, true);
  assert.equal(sysctlFlag('1\n'), true);
  assert.equal(sysctlFlag('0'), false);
  assert.equal(sysctlFlag(''), false);
  assert.equal(sysctlFlag(undefined), false);
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
  // main 이 아니라 고정한 커밋에서 받는다
  const pinned = {
    diffusion: '3b1f5a9dc3abb32238b053aeb3d823c30afdacbd',
    llm: '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
    vae: 'a3efc24f613ef42d9428af62fdbd6f5fd8856c4a',
  };
  for (const m of SD_MODELS) {
    assert.equal(m.rev, pinned[m.key]);
    assert.ok(m.url.includes(`/resolve/${pinned[m.key]}/`), m.url);
    assert.ok(!m.url.includes('/resolve/main/'), m.url);
  }
  assert.equal(hfResolveUrl('a/b', 'abc', 'c.gguf'), 'https://huggingface.co/a/b/resolve/abc/c.gguf');
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
  // 한글 %APPDATA% 를 피해 root 안 상대 경로 (영문만, 윈도우 구분자)
  for (const w of ['vulkan', 'cpu'] as const) {
    const rel = sdUnzipRel(w);
    assert.equal(rel.zip, `download\\${SD_WIN_ASSETS[w].name}`);
    assert.equal(rel.dir, `bin\\${w}`);
    assert.match(`${rel.zip}${rel.dir}`, /^[\x20-\x7e]+$/);
    assert.deepEqual(unzipArgs(rel.zip, rel.dir), ['-xf', rel.zip, '-C', rel.dir]);
  }
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

test('CPU 로 되돌리기: 그래픽 칩 탓으로 보일 때만 (윈도우 죽음 코드, Vulkan, Metal 흔적), CPU 는 더 갈 데가 없다', () => {
  // 윈도우가 죽였다는 끝 코드 (0xC0000005, 0xC0000409)
  assert.equal(shouldFallbackToCpu('vulkan', 'failed', '', 3221225477), true);
  assert.equal(shouldFallbackToCpu('vulkan', 'failed', '', 3221226505), true);
  // 부호 있는 값으로 와도 같다
  assert.equal(shouldFallbackToCpu('vulkan', 'failed', '', 0xc0000005 | 0), true);
  // 그냥 실패(요청문, 그림 문제)는 CPU 로 가도 같아서 되돌리지 않는다
  assert.equal(shouldFallbackToCpu('metal', 'failed', ''), false);
  assert.equal(shouldFallbackToCpu('vulkan', 'failed', 'exit 1: bad prompt', 1), false);
  for (const log of [
    'ggml_vulkan: device lost',
    'vk_create_buffer failed',
    'ggml_metal_graph_compute: command buffer failed',
    'CUDA out of memory',
    'not enough VRAM',
  ])
    assert.equal(shouldFallbackToCpu('vulkan', 'failed', log, 1), true, log);
  assert.equal(shouldFallbackToCpu('vulkan', 'memory', 'ggml_vulkan: ErrorOutOfDeviceMemory'), true);
  // 컴퓨터 메모리가 모자란 것은 CPU 로 가도 같다
  assert.equal(shouldFallbackToCpu('vulkan', 'memory', 'std::bad_alloc'), false);
  for (const k of ['cancelled', 'timeout', 'disk', 'notReady', 'bad'] as const)
    assert.equal(shouldFallbackToCpu('vulkan', k, 'vulkan', 3221225477), false, k);
  assert.equal(shouldFallbackToCpu('cpu', 'failed', 'vulkan', 3221225477), false);
  // 잘 돌 때도 나오는 Vulkan 안내 줄은 실패 흔적이 아니다
  assert.equal(
    shouldFallbackToCpu('vulkan', 'failed', 'ggml_vulkan: Found 1 Vulkan devices:\nbad prompt', 1),
    false,
  );
  assert.equal(looksGpuFailure('[INFO ] sampling completed'), false);
  assert.equal(looksGpuFailure('ggml_vulkan: 0 = NVIDIA GeForce RTX 3060 (NVIDIA) | uma: 0'), false);
  assert.equal(looksGpuFailure('ok\nggml_vulkan: vk::Queue::submit: ErrorDeviceLost'), true);
  assert.equal(ranOnCpu('[WARN ] loading CPU backend'), true);
  assert.equal(ranOnCpu('[WARN ] device Vulkan0 failed to init'), true);
  assert.equal(ranOnCpu('[INFO ] Using Vulkan0'), false);
});

test('글 지켜보기: 끝 64KB 에서 밀려난 처음 경고도 기억한다', () => {
  const w = sdLogWatch();
  w.feed('[WARN ] loading CPU backend\n');
  // 진행 줄이 쌓여 앞 경고가 밀려난 뒤
  w.feed('  |=====>     | 2/4 - 3.21s/it');
  assert.equal(w.cpu, true);
  assert.equal(w.gpu, undefined);
  const g = sdLogWatch();
  g.feed('ggml_vulkan: Found 1 Vulkan devices:\r\n[ERROR] ggml_vulkan: device lost\n');
  g.feed('later noise');
  assert.equal(g.gpu, '[ERROR] ggml_vulkan: device lost');
  assert.equal(g.cpu, false);
  // 처음 본 줄을 그대로 둔다
  g.feed('vk_other');
  assert.equal(g.gpu, '[ERROR] ggml_vulkan: device lost');
});

test('장치 목록: Vulkan 장치가 있어야 Vulkan 판을 쓴다', () => {
  assert.equal(hasVulkanDevice('CPU\tIntel(R) Core(TM) i5\nVulkan0\tNVIDIA GeForce RTX 3060\n'), true);
  assert.equal(hasVulkanDevice('Vulkan1\tIntel(R) UHD\r\n'), true);
  assert.equal(hasVulkanDevice('CPU\tAMD Ryzen 5\n'), false);
  assert.equal(hasVulkanDevice(''), false);
  // 설명에 Vulkan 이 든 것은 장치 이름이 아니다
  assert.equal(hasVulkanDevice('CPU\tVulkan not found\n'), false);
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

test('기록을 디스크에 맞춘다: 없는 모델은 빼고, sd-cli 가 없으면 도구 기록을 지운다', () => {
  const all = Object.fromEntries(SD_MODELS.map((m) => [m.file, m.sha256]));
  const s = { tools: SD_RELEASE.tag, models: all, backend: 'cpu' as const, bytes: 9 };
  // 다 있으면 그대로
  assert.deepEqual(sdStateOnDisk(s, { model: () => true, tools: true }), s);
  // 누가 llm 파일을 지웠다
  const noLlm = sdStateOnDisk(s, { model: (m) => m.key !== 'llm', tools: true });
  assert.deepEqual(
    sdStepsToRun(noLlm, 'win32').models.map((m) => m.key),
    ['llm'],
  );
  assert.equal(sdStepsToRun(noLlm, 'win32').tools, false);
  // sd-cli.exe 가 사라졌다 (백신이 지움 등)
  const noTools = sdStateOnDisk(s, { model: () => true, tools: false });
  assert.equal(sdStepsToRun(noTools, 'win32').tools, true);
  assert.equal(noTools.backend, 'cpu');
  // 원래 기록은 건드리지 않는다
  assert.equal(s.tools, SD_RELEASE.tag);
  assert.equal(Object.keys(s.models).length, 3);
  assert.deepEqual(sdStateOnDisk({}, { model: () => false, tools: false }), {});
});

test('받다 만 모델은 해시에 묶인 이름', () => {
  const l = sdLayout('/r');
  const m = SD_MODELS[0];
  assert.equal(sdPartPath(l, m), `${sdModelPath(l, m)}.${m.sha256.slice(0, 8)}.part`);
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
