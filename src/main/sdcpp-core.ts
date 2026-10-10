// 내 컴퓨터에서 그리기의 sd.cpp 엔진 순수 계산 (Electron, child_process 없이 시험한다, sdcpp-core.test.ts).
// 무엇을: stable-diffusion.cpp(MIT)의 sd-cli 로 FLUX.2 klein 4B(GGUF Q4_0)를 돌린다. mflux 가 안 되는 컴퓨터
// (Windows x64, 인텔 Mac, macOS 12~13 의 Apple 칩 Mac)도 공짜로 그리게. 모든 파일은 사용자 데이터 local-draw-sd/ 안에
import { join, win32 } from 'node:path';
import type { LocalTier, LocalUnsupported } from '../shared/local-draw.ts';
import { partPath } from './download-resume.ts';
import { imageSize, kleinSize } from './hf-illust.ts';
import { classifyFailure, type LocalDrawErrorKind, localDrawEligibility } from './local-draw-core.ts';

/**
 * 고정한 sd.cpp 판. 윈도우는 공식 릴리스 묶음을 받고(해시 확인), 맥은 공식 묶음이 macOS 26 용이라
 * 같은 커밋을 macOS 12 대상으로 직접 빌드해 앱 안에 넣는다 (scripts/build-sdcpp.mjs)
 */
export const SD_RELEASE = {
  tag: 'master-951-f89d9b1',
  commit: 'f89d9b13d730eabeede7314ce49dacd18d3c90c2',
} as const;

const releaseUrl = (name: string) =>
  `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_RELEASE.tag}/${name}`;

/** 윈도우 도구 묶음 (zip). Vulkan 판을 먼저 쓰고, 안 되면 CPU 판으로. 둘 다 처음 준비 때 받아 둔다 (47MB 쯤) */
export const SD_WIN_ASSETS = {
  vulkan: {
    name: 'sd-master-f89d9b1-bin-win-vulkan-x64.zip',
    bytes: 30_117_011,
    sha256: '2c5bed22585ff678ff2c9077f5088d55c2d9c0faa948db7f2e689e1ccea701a9',
  },
  cpu: {
    name: 'sd-master-f89d9b1-bin-win-cpu-x64.zip',
    bytes: 17_536_557,
    sha256: '7c46bc1f4e89b22af9dd70e8d510dea2167c619676d23d313b83deffcd9b1ecc',
  },
} as const;

export const sdAssetUrl = (name: string) => releaseUrl(name);

/**
 * Hugging Face 파일 주소. main 이 아니라 고정한 커밋에서 받는다 (depth-model.ts 처럼): 올린 사람이 파일을 바꿔도
 * 해시가 어긋나 준비가 깨지지 않고, 받다 만 .part 에 다른 판이 이어 붙지 않게
 */
export const hfResolveUrl = (repo: string, rev: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

/** 모델 셋 (모두 로그인 없이 받는 Apache-2.0). Hugging Face LFS 의 oid 가 SHA-256 이다. 커밋은 2026-10-10 에 확인 */
export const SD_MODELS = [
  {
    key: 'diffusion',
    file: 'flux-2-klein-4b-Q4_0.gguf',
    rev: '3b1f5a9dc3abb32238b053aeb3d823c30afdacbd',
    url: hfResolveUrl(
      'leejet/FLUX.2-klein-4B-GGUF',
      '3b1f5a9dc3abb32238b053aeb3d823c30afdacbd',
      'flux-2-klein-4b-Q4_0.gguf',
    ),
    bytes: 2_460_378_560,
    sha256: 'd1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4',
  },
  {
    key: 'llm',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    rev: '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
    url: hfResolveUrl(
      'unsloth/Qwen3-4B-GGUF',
      '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
      'Qwen3-4B-Q4_K_M.gguf',
    ),
    bytes: 2_497_281_312,
    sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
  },
  {
    key: 'vae',
    file: 'full_encoder_small_decoder.safetensors',
    rev: 'a3efc24f613ef42d9428af62fdbd6f5fd8856c4a',
    url: hfResolveUrl(
      'black-forest-labs/FLUX.2-small-decoder',
      'a3efc24f613ef42d9428af62fdbd6f5fd8856c4a',
      'full_encoder_small_decoder.safetensors',
    ),
    bytes: 249_519_092,
    sha256: 'ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62',
  },
] as const;
export type SdModel = (typeof SD_MODELS)[number];
export const SD_MODEL_BYTES = SD_MODELS.reduce((n, m) => n + m.bytes, 0);

/** 윈도우 도구 단계(묶음 둘 + 푼 것)에 비어 있어야 하는 공간 */
export const SD_TOOLS_FREE_BYTES = 200e6;
/** 받는 것 말고 더 비워 둘 공간 (임시 그림, 해시 맞추기 중 .part) */
export const SD_FREE_MARGIN = 1e9;

/**
 * 한 번 그리기(4단계) 걸리는 어림 분. 실제로 재서 고칠 자리 (2026-10-10 은 어림 값).
 * mflux 는 M2 Pro 에서 1분쯤, GPU 는 Vulkan(외장, 내장)과 Metal, CPU 는 긴 변 768 로 줄여서
 */
export const PASS_MINUTES: Record<LocalTier, { min: number; max: number }> = {
  mflux: { min: 1, max: 1 },
  gpu: { min: 1, max: 2 },
  cpu: { min: 10, max: 20 },
};

/** 한 장(그리기 + 털 다듬기, 두 번) 걸리는 어림 분 */
export const pictureMinutes = (tier: LocalTier) => ({
  min: PASS_MINUTES[tier].min * 2,
  max: PASS_MINUTES[tier].max * 2,
});

/** 한 번 그리기 상한. CPU 는 느린 노트북에서 한참 걸려 넉넉히 */
export const SD_TIMEOUT_MS: Record<'gpu' | 'cpu', number> = { gpu: 30 * 60_000, cpu: 90 * 60_000 };

/** CPU 로 그릴 때 긴 변 (1024 면 몇 배 느리다) */
export const CPU_LONG_SIDE = 768;

export type SdBackend = 'vulkan' | 'metal' | 'cpu';
export const tierOf = (b: SdBackend): LocalTier => (b === 'cpu' ? 'cpu' : 'gpu');

export type { LocalUnsupported } from '../shared/local-draw.ts';
export type LocalPick =
  | { ok: true; engine: 'mflux' }
  | { ok: true; engine: 'sdcpp'; backend: SdBackend }
  | { ok: false; reason: LocalUnsupported };

const GiB = 1024 ** 3;

/**
 * 이 컴퓨터에서 쓸 엔진. 메모리 8GB 이상이 먼저 (둘 다 4~6GB 를 쓴다).
 * 1. Apple 칩 Mac, macOS 14+ → mflux (가장 빠르다)
 * 2. Apple 칩 Mac, macOS 12~13 → sd.cpp Metal
 * 3. 인텔 Mac, macOS 12+ → sd.cpp CPU (인텔, AMD 그래픽의 ggml Metal 은 믿기 어렵다). 앱에 넣은 sd-cli 가
 *    AVX2, FMA 로 빌드돼서 그게 없는 칩(Mac Pro 2013 같은 Ivy Bridge 이전)은 켜자마자 죽는다 → 칩이 안 된다고 알린다
 * 4. Windows x64 → sd.cpp Vulkan (안 되면 CPU 로, sdcpp.ts)
 * Apple 칩에서 로제타로 도는 인텔용 앱은 macOS 14+ 면 mflux(uv 가 Apple 칩용)로 되지만, 12~13 은
 * 인텔용 sd-cli 가 AVX 를 써서 로제타(macOS 15 전)에서 돌지 않는다 → Apple 칩용 앱을 깔라고 알린다
 */
export function pickLocalEngine(sys: {
  platform: string;
  arch: string;
  cpuModel: string;
  totalMem: number;
  osRelease: string;
  /** 인텔 Mac 의 CPU 기능 (sysctl hw.optional.*). 모르면 없는 것으로 본다 */
  cpuFeatures?: { avx2: boolean; fma: boolean };
}): LocalPick {
  if (sys.platform !== 'darwin' && sys.platform !== 'win32') return { ok: false, reason: 'os' };
  // 8GB 컴퓨터는 정확히 8GiB 를 알린다. 조금 모자라게 알리는 경우(내장 그래픽 몫)를 봐서 5% 덜어 둔다
  if (!(sys.totalMem >= 8 * GiB * 0.95)) return { ok: false, reason: 'memory' };
  if (sys.platform === 'win32') {
    // 윈도우 sd.cpp 묶음은 x64 만 있다
    if (sys.arch !== 'x64') return { ok: false, reason: 'chip' };
    return { ok: true, engine: 'sdcpp', backend: 'vulkan' };
  }
  if (localDrawEligibility(sys).ok) return { ok: true, engine: 'mflux' };
  // 직접 빌드한 sd-cli 는 macOS 12 부터 (다윈 커널 21)
  const darwin = Number.parseInt(sys.osRelease, 10);
  if (!(darwin >= 21)) return { ok: false, reason: 'macos' };
  const appleChip = sys.arch === 'arm64' || /apple/i.test(sys.cpuModel);
  if (appleChip && sys.arch !== 'arm64') return { ok: false, reason: 'rosetta' };
  if (!appleChip && !(sys.cpuFeatures?.avx2 && sys.cpuFeatures.fma)) return { ok: false, reason: 'chip' };
  return { ok: true, engine: 'sdcpp', backend: appleChip ? 'metal' : 'cpu' };
}

/** sysctl -n 한 줄 ("1" 이면 있다). 키가 없거나 읽지 못했으면 없는 것으로 */
export const sysctlFlag = (out: string | undefined | null) => (out ?? '').trim() === '1';

/**
 * 윈도우 그래픽 칩이 쓸 만한지 (Electron app.getGPUInfo('basic') 의 gpuDevice). 없거나 Microsoft 기본 렌더러
 * (vendorId 0x1414, 원격 데스크톱, 드라이버 없음)뿐이면 처음부터 CPU 판으로
 */
export function gpuLooksUsable(devices: readonly { vendorId?: number }[] | undefined): boolean {
  return (devices ?? []).some(
    (d) => typeof d.vendorId === 'number' && d.vendorId !== 0 && d.vendorId !== 0x1414,
  );
}

/** local-draw-sd/ 안 자리들. 모두 이 폴더 안이라 지우기 한 번으로 다 사라진다 */
export interface SdLayout {
  root: string;
  downloadDir: string;
  binDir: string;
  modelsDir: string;
  state: string;
  errorLog: string;
  runPid: string;
  tmp: string;
}

export function sdLayout(root: string): SdLayout {
  return {
    root,
    downloadDir: join(root, 'download'),
    binDir: join(root, 'bin'),
    modelsDir: join(root, 'models'),
    state: join(root, 'state.json'),
    errorLog: join(root, 'last-error.log'),
    runPid: join(root, 'run.pid'),
    tmp: join(root, 'tmp'),
  };
}

export const sdModelPath = (l: SdLayout, m: SdModel) => join(l.modelsDir, m.file);
/** 받다 만 모델 (고정한 해시에 묶인 이름, download-resume.ts partPath) */
export const sdPartPath = (l: SdLayout, m: SdModel) => partPath(sdModelPath(l, m), m.sha256);
export const sdZipPath = (l: SdLayout, which: 'vulkan' | 'cpu') =>
  join(l.downloadDir, SD_WIN_ASSETS[which].name);
/** 윈도우 묶음을 푼 폴더 (묶음은 평평하다: sd-cli.exe 옆에 ggml dll 들) */
export const sdWinDir = (l: SdLayout, which: 'vulkan' | 'cpu') => join(l.binDir, which);

/**
 * sd-cli 자리. 윈도우는 받아 푼 것(Vulkan 판, CPU 로 되돌렸으면 CPU 판). 맥은 앱 안
 * (Contents/Resources/sd/sd-cli), 개발 중(npm run dev)에는 scripts/build-sdcpp.mjs 가 만든 resources-bin/sd/<arch>/
 */
export function sdBinary(o: {
  platform: string;
  arch: string;
  l: SdLayout;
  backend: SdBackend;
  resourcesPath: string;
  appPath: string;
  packaged: boolean;
}): string {
  if (o.platform === 'win32')
    return join(sdWinDir(o.l, o.backend === 'cpu' ? 'cpu' : 'vulkan'), 'sd-cli.exe');
  return o.packaged
    ? join(o.resourcesPath, 'sd', 'sd-cli')
    : join(o.appPath, 'resources-bin', 'sd', o.arch, 'sd-cli');
}

/** 윈도우 10 이상에 들어 있는 tar (bsdtar). zip 도 푼다. PATH 에 다른 tar(Git Bash)가 먼저 있어도 이것만 */
export const winTar = (systemRoot: string | undefined) =>
  join(systemRoot || 'C:\\Windows', 'System32', 'tar.exe');
export const winTaskkill = (systemRoot: string | undefined) =>
  join(systemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
export const winTasklist = (systemRoot: string | undefined) =>
  join(systemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');

export const unzipArgs = (zip: string, dir: string) => ['-xf', zip, '-C', dir];

/**
 * 윈도우 tar 에 줄 zip 과 풀 자리 (local-draw-sd 안에서 본 상대 경로, 영문만). tar.exe 를 cwd: root 로 돌린다.
 * 왜: 사용자 이름이 한글이면 %APPDATA% 경로가 한글인데, bsdtar 는 인자를 시스템 코드 페이지로 읽어 그런 절대 경로를
 * 못 연다. 상대 경로는 우리가 정한 영문 이름뿐이라 깨질 일이 없다
 */
export const sdUnzipRel = (which: 'vulkan' | 'cpu') => ({
  zip: win32.join('download', SD_WIN_ASSETS[which].name),
  dir: win32.join('bin', which),
});
/** 프로세스와 그 자손을 끈다 (윈도우엔 프로세스 묶음이 없다) */
export const killTreeArgs = (pid: number) => ['/pid', String(pid), '/T', '/F'];
export const tasklistArgs = (pid: number) => ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'];

/** tasklist CSV 줄에 그 pid 의 sd-cli.exe 가 있는지 (pid 가 다른 프로그램에 다시 쓰였으면 건드리지 않는다) */
export function tasklistHas(out: string, pid: number, image = 'sd-cli.exe'): boolean {
  for (const line of out.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
    if (cells.length >= 2 && cells[0]?.toLowerCase() === image && Number(cells[1]) === pid) return true;
  }
  return false;
}

/**
 * 한 번 그리기 (참고 그림으로 고치기). 4단계, cfg 1.0 (증류판), euler. GPU 는 무게를 RAM 에 두고 필요할 때 올리고
 * (--offload-to-cpu, 그래픽 메모리 4GB 에서도), CPU 는 --backend cpu 로 못박는다. 요청문이 그림에 박히지 않게 메타데이터는 뺀다
 */
export function sdDrawArgs(
  l: SdLayout,
  o: {
    input: string;
    output: string;
    prompt: string;
    width: number;
    height: number;
    seed: number;
    backend: SdBackend;
  },
): string[] {
  const path = (k: SdModel['key']) => sdModelPath(l, SD_MODELS.find((m) => m.key === k) as SdModel);
  return [
    '--diffusion-model',
    path('diffusion'),
    '--vae',
    path('vae'),
    '--llm',
    path('llm'),
    '-r',
    o.input,
    '-p',
    o.prompt,
    '--cfg-scale',
    '1.0',
    '--sampling-method',
    'euler',
    '--steps',
    '4',
    '-W',
    String(o.width),
    '-H',
    String(o.height),
    '--seed',
    String(o.seed),
    '--disable-image-metadata',
    ...(o.backend === 'cpu' ? ['--backend', 'cpu'] : ['--offload-to-cpu', '--diffusion-fa']),
    '-o',
    o.output,
  ];
}

/** 그릴 크기: 사진 비율 그대로 긴 변 1024 (CPU 는 768), 16 의 배수. 모르면 세로 3:4 */
export function sdDrawSize(photo: Uint8Array, tier: LocalTier): { width: number; height: number } {
  const s = imageSize(photo);
  const out = kleinSize(s?.w ?? 768, s?.h ?? 1024, tier === 'cpu' ? CPU_LONG_SIDE : 1024);
  return { width: out.w, height: out.h };
}

/**
 * sd-cli 진행 줄에서 마지막 것. 모양 (src/core/util.cpp print_progress_line):
 * "\r  |=====>     | 2/4 - 3.21s/it\x1b[K" (그리기, s/it 또는 it/s), "|#####| 120/480 - 85.3MB/s" (모델 읽기).
 * \r 로 줄을 덮어써서 \r 과 \n 둘 다로 나눈다
 */
export function sdProgress(text: string): { phase: 'load' | 'sample'; n: number; total: number } | undefined {
  const lines = text.split(/[\r\n]+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /\|[=>#\s]*\|\s*(\d+)\/(\d+)\s+-\s+[\d.]+\s*(s\/it|it\/s|[KMG]B\/s)/.exec(lines[i] ?? '');
    if (!m) continue;
    const n = Number(m[1]);
    const total = Number(m[2]);
    if (!(total > 0 && n <= total)) continue;
    return { phase: /B\/s$/.test(m[3] ?? '') ? 'load' : 'sample', n, total };
  }
  return undefined;
}

/**
 * 그리기 + 털 다듬기 전체 진행률. pass 0 은 그리기, 1 은 털 다듬기 (반씩). 한 번 안에서는 모델 읽기 15%,
 * 4단계 80%, 저장 5%. 아직 아무 줄도 없으면 읽기 몫의 조금
 */
export function sdDrawRatio(pass: 0 | 1, p?: { phase: 'load' | 'sample'; n: number; total: number }): number {
  const f = p ? Math.min(1, p.n / Math.max(1, p.total)) : 0;
  const within = !p ? 0.02 : p.phase === 'load' ? 0.02 + 0.13 * f : 0.15 + 0.8 * f;
  return Math.min(0.99, (pass + within) / 2);
}

/**
 * sd-cli 실패를 종류로. mflux 와 같은 규칙(classifyFailure) 위에 sd.cpp 와 윈도우 것을 더한다:
 * 그래픽 메모리 부족, 윈도우 STATUS_NO_MEMORY(0xC0000017), 모델 파일을 못 읽음
 */
export function classifySdFailure(
  log: string,
  o: {
    aborted?: boolean;
    timedOut?: boolean;
    signal?: string | null;
    spawnCode?: string;
    exitCode?: number | null;
    phase: 'setup' | 'draw';
  },
): LocalDrawErrorKind {
  const base = classifyFailure(log, o);
  if (base !== 'failed') return base;
  if (
    o.exitCode === 0xc0000017 ||
    /ErrorOutOfDeviceMemory|out of device memory|bad_alloc|memory allocation.*failed/i.test(log)
  )
    return 'memory';
  if (
    o.phase === 'draw' &&
    /init model loader from file failed|load tensors from model loader failed|get sd version from file failed/i.test(
      log,
    )
  )
    return 'notReady';
  return 'failed';
}

/** 윈도우가 프로그램이 죽었을 때 주는 끝 코드: 0xC0000005 (잘못된 메모리 접근), 0xC0000409 (스택 깨짐). 드라이버가 흔한 까닭 */
export const WIN_CRASH_CODES: readonly number[] = [0xc0000005, 0xc0000409];
/**
 * 그래픽 칩 쪽 실패로 보이는 줄. Vulkan 판은 잘 돌 때도 "ggml_vulkan: Found 1 Vulkan devices" 를 남겨서
 * 이름만으로는 안 되고, 그래픽 칩 이름(Vulkan, vk_, Metal, VRAM)에 오류 말이 같이 있거나 장치 잃음, 메모리 모자람일 때만
 */
export function gpuFailLine(line: string): boolean {
  if (/device lost|out of memory|out of device memory/i.test(line)) return true;
  return (
    /vulkan|vk_|vk::|ggml_metal|VRAM/i.test(line) &&
    /error|fail|abort|exception|cannot|unable|not enough|lost/i.test(line)
  );
}
export const looksGpuFailure = (log: string) => log.split(/[\r\n]+/).some(gpuFailLine);

/**
 * 그래픽 칩으로 그리다 실패하면 CPU 로 다시 할지. 그래픽 칩 탓으로 보일 때만: 윈도우가 죽였다고 알린 끝 코드이거나
 * 남긴 글에 Vulkan, Metal, 장치 잃음, 그래픽 메모리 흔적이 있을 때. 그냥 'failed' 는 CPU 로 가도 같은 실패라
 * (요청문, 그림 문제) 20분을 더 기다리게 하지 않는다. 멈추기, 시간 초과, 공간, 준비 깨짐은 그대로 알린다
 */
export function shouldFallbackToCpu(
  backend: SdBackend,
  kind: LocalDrawErrorKind,
  log: string,
  exitCode?: number | null,
): boolean {
  if (backend === 'cpu') return false;
  if (kind !== 'failed' && kind !== 'memory') return false;
  if (kind === 'failed' && typeof exitCode === 'number' && WIN_CRASH_CODES.includes(exitCode >>> 0))
    return true;
  return looksGpuFailure(log);
}

/** Vulkan 판이 그래픽 칩을 못 찾아 스스로 CPU 로 돌았는지 (ggml 이 "loading CPU backend" 를 남긴다) */
export const ranOnCpu = (log: string) =>
  /loading CPU backend|Using CPU backend|No devices found|device \S+ failed to init/i.test(log);

/**
 * sd-cli 가 남기는 글을 흐르는 대로 본다. run 이 주는 글은 끝 64KB 뿐이라 처음에 나온 경고("loading CPU backend",
 * Vulkan 오류)가 뒤의 진행 줄에 밀려 사라질 수 있다 → 보이는 순간 기억해 둔다
 */
export function sdLogWatch() {
  let cpu = false;
  let gpu: string | undefined;
  return {
    feed(text: string) {
      if (!cpu && ranOnCpu(text)) cpu = true;
      if (gpu === undefined) gpu = text.split(/[\r\n]+/).find(gpuFailLine);
    },
    /** 그래픽 칩 대신 CPU 로 돌았다 */
    get cpu() {
      return cpu;
    },
    /** 처음 본 그래픽 칩 실패 흔적 줄 */
    get gpu() {
      return gpu;
    },
  };
}

/**
 * sd-cli --list-devices 결과("이름<TAB>설명" 한 줄씩)에 Vulkan 장치가 있는지. 없으면 Vulkan 판도 CPU 로만 돈다
 * (그래픽 드라이버에 Vulkan 이 없음). 그러면 처음부터 CPU 판을 쓴다 (같은 CPU 라도 CPU 판이 더 맞춰져 있다)
 */
export function hasVulkanDevice(out: string): boolean {
  return out.split(/\r?\n/).some((line) => /^Vulkan\d*\t/i.test(line));
}

/** 준비 기록 (state.json). 단계마다 다 된 판을 적는다. 고정한 판이 바뀌면 그 단계부터 다시 */
export interface SdState {
  /** 윈도우 도구 묶음 판 (SD_RELEASE.tag) */
  tools?: string;
  /** 다 받아 해시를 맞춘 모델: 파일 이름 → sha256 */
  models?: Record<string, string>;
  /** 그래픽 칩이 안 돼 CPU 로 그린다 (윈도우는 CPU 판, 맥은 --backend cpu) */
  backend?: 'cpu';
  bytes?: number;
}

export function parseSdState(raw: string | undefined | null): SdState {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const r = v as Record<string, unknown>;
    const out: SdState = {};
    if (typeof r.tools === 'string' && r.tools.length > 0 && r.tools.length < 200) out.tools = r.tools;
    if (typeof r.models === 'object' && r.models !== null && !Array.isArray(r.models)) {
      const models: Record<string, string> = {};
      for (const m of SD_MODELS) {
        const x = (r.models as Record<string, unknown>)[m.file];
        if (typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) models[m.file] = x;
      }
      out.models = models;
    }
    if (r.backend === 'cpu') out.backend = 'cpu';
    if (typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0) out.bytes = r.bytes;
    return out;
  } catch {
    return {};
  }
}

/**
 * 기록(state.json)을 디스크에 맞춘다. 누가 폴더 안 파일을 지웠으면 기록만 믿고 건너뛰지 않게: 파일이 없는 모델은
 * 기록에서 빼고, 지금 백엔드의 sd-cli(.exe) 나 되돌릴 CPU 판이 없으면 윈도우 도구 기록을 지운다 (다시 받는다)
 */
export function sdStateOnDisk(s: SdState, has: { model: (m: SdModel) => boolean; tools: boolean }): SdState {
  const out: SdState = { ...s };
  if (s.models) {
    const models: Record<string, string> = {};
    for (const m of SD_MODELS) {
      const v = s.models[m.file];
      if (v !== undefined && has.model(m)) models[m.file] = v;
    }
    out.models = models;
  }
  if (!has.tools) delete out.tools;
  return out;
}

/** 아직 할 단계: 윈도우 도구(판이 다르면), 해시가 기록과 다른 모델들 */
export function sdStepsToRun(s: SdState, platform: string): { tools: boolean; models: SdModel[] } {
  return {
    tools: platform === 'win32' && s.tools !== SD_RELEASE.tag,
    models: SD_MODELS.filter((m) => s.models?.[m.file] !== m.sha256),
  };
}

export const isSdSetupDone = (s: SdState, platform: string) => {
  const r = sdStepsToRun(s, platform);
  return !r.tools && r.models.length === 0;
};

/** 준비에 필요한 빈 공간: 남은 모델 바이트(받아 둔 .part 만큼 덜) + 도구 + 여유 */
export function sdSpaceNeeded(todo: { tools: boolean; models: readonly SdModel[] }, partBytes = 0): number {
  const models = todo.models.reduce((n, m) => n + m.bytes, 0);
  if (!todo.tools && models === 0) return 0;
  return (
    Math.max(0, models - Math.max(0, partBytes || 0)) +
    (todo.tools ? SD_TOOLS_FREE_BYTES : 0) +
    SD_FREE_MARGIN
  );
}

/** 모델 받기 진행률 (모델마다 바이트로 나눠 이어 붙인다). done 은 앞서 다 받은 바이트 */
export const modelsRatio = (done: number, current: number, total = SD_MODEL_BYTES) =>
  Math.min(1, Math.max(0, (done + current) / Math.max(1, total)));
