// 내 Mac에서 그리기의 순수 계산 (Electron, child_process 없이 시험한다, local-draw-core.test.ts).
// 무엇을: mflux(MLX, Apple 칩 전용)로 FLUX.2 klein 4B(Apache-2.0, 받기에 로그인 필요 없음)를 이 Mac 에서 돌린다.
// 사용자의 파이썬, uv 는 건드리지 않고 사용자 데이터 폴더 local-draw/ 안에 uv, 파이썬, mflux, 모델을 모두 둔다.
import { join } from 'node:path';
import { type ImageKind, imageKind, imageSize, kleinSize } from './hf-illust.ts';

/**
 * 고정한 uv. GitHub 릴리스 원본, 받은 뒤 SHA-256 을 맞춘다. 2026-10-10 에 받아 해시를 쟀고 릴리스에 붙은 .sha256 과 같았다.
 * 0.13 은 하루 전에 나와 한 주 묵은 0.12.23 으로
 */
export const UV_PIN = {
  version: '0.12.23',
  url: 'https://github.com/astral-sh/uv/releases/download/0.12.23/uv-aarch64-apple-darwin.tar.gz',
  sha256: '50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544',
  bytes: 17_044_217,
} as const;

/**
 * 고정한 mflux 와 의존성 시점. 0.21.0 (2026-10-03) 에 mflux-generate-flux2-edit, mflux-save, --low-ram 이 있다.
 * excludeNewer 로 그 뒤에 나온 의존성 판은 고르지 않는다 (같은 판을 받아 어제 되던 것이 오늘 깨지지 않게)
 */
export const MFLUX_PIN = {
  version: '0.21.0',
  excludeNewer: '2026-10-04T00:00:00Z',
  python: '3.12',
} as const;

/** 4비트로 줄여 저장한 klein 4B. 원본(15GB 쯤)은 저장 뒤 지운다 */
export const MODEL_PIN = { id: 'flux2-klein-4b', quantize: 4, dir: 'klein4b-q4' } as const;

/** 원본 모델 받기 진행률을 재는 어림 크기 (바이트). 받은 폴더 크기를 이것으로 나눈다 */
export const MODEL_DOWNLOAD_BYTES = 15_500_000_000;
/** 준비 중 비어 있어야 하는 공간 (원본 15GB + 줄인 모델 4GB + 도구 1GB) */
export const SETUP_FREE_BYTES = 20 * 1e9;
/** 그리기 전 비어 있어야 하는 공간 (임시 그림, MLX 캐시) */
export const DRAW_FREE_BYTES = 1e9;
/** 한 장(4단계)을 그리는 상한. M2 Pro 에서 1분쯤 (처음에는 Metal 커널을 만드느라 더 걸린다) */
export const DRAW_TIMEOUT_MS = 8 * 60_000;
/** 그린 그림이 이보다 작으면 거의 한 색(검은 판)이다. 1024 PNG 그림은 1MB 안팎 */
export const MIN_DRAWN_BYTES = 40 * 1024;

const GiB = 1024 ** 3;

export type LocalDrawUnsupported = 'os' | 'chip' | 'macos' | 'memory';

/**
 * 이 컴퓨터에서 돌릴 수 있는지. macOS, Apple 칩(로제타로 도는 x64 앱이어도 칩 이름에 Apple 이 있다),
 * macOS 14 이상(MLX 휠이 macosx_14_0 부터, 다윈 커널 23), 메모리 8GB 이상 (low-ram 으로 4.6GB 쯤 쓴다)
 */
export function localDrawEligibility(sys: {
  platform: string;
  arch: string;
  cpuModel: string;
  totalMem: number;
  osRelease: string;
}): { ok: true } | { ok: false; reason: LocalDrawUnsupported } {
  if (sys.platform !== 'darwin') return { ok: false, reason: 'os' };
  if (sys.arch !== 'arm64' && !/apple/i.test(sys.cpuModel)) return { ok: false, reason: 'chip' };
  const darwin = Number.parseInt(sys.osRelease, 10);
  if (!(darwin >= 23)) return { ok: false, reason: 'macos' };
  // 8GB 맥은 정확히 8GiB 를 알린다. 조금 모자라게 알리는 경우를 봐서 5% 덜어 둔다
  if (!(sys.totalMem >= 8 * GiB * 0.95)) return { ok: false, reason: 'memory' };
  return { ok: true };
}

/** local-draw/ 안 자리들. 모두 이 폴더 안이라 지우기 한 번으로 다 사라진다 */
export interface Layout {
  root: string;
  uvDir: string;
  uv: string;
  uvTarball: string;
  pythonDir: string;
  toolDir: string;
  binDir: string;
  uvCache: string;
  mfluxCache: string;
  mplCache: string;
  hfHome: string;
  modelsDir: string;
  model: string;
  modelPart: string;
  /** mflux 도구 venv 의 파이썬과 실행 글 (진입 글을 파이썬으로 직접 돌린다, 아래 drawCommand) */
  python: string;
  generate: string;
  save: string;
  state: string;
  errorLog: string;
}

export function layout(root: string): Layout {
  const toolDir = join(root, 'tools');
  const venvBin = join(toolDir, 'mflux', 'bin');
  const modelsDir = join(root, 'models');
  return {
    root,
    uvDir: join(root, 'uv'),
    uv: join(root, 'uv', 'uv'),
    uvTarball: join(root, 'download', 'uv-aarch64-apple-darwin.tar.gz'),
    pythonDir: join(root, 'python'),
    toolDir,
    binDir: join(root, 'bin'),
    uvCache: join(root, 'cache', 'uv'),
    mfluxCache: join(root, 'cache', 'mflux'),
    mplCache: join(root, 'cache', 'matplotlib'),
    hfHome: join(root, 'hf'),
    modelsDir,
    model: join(modelsDir, MODEL_PIN.dir),
    modelPart: join(modelsDir, `${MODEL_PIN.dir}.part`),
    python: join(venvBin, 'python'),
    generate: join(venvBin, 'mflux-generate-flux2-edit'),
    save: join(venvBin, 'mflux-save'),
    state: join(root, 'state.json'),
    errorLog: join(root, 'last-error.log'),
  };
}

/** 사용자 셸에서 넘어오면 안 되는 값: 다른 파이썬, 가상환경, uv 설정, Hugging Face 설정 */
const LEAKY = /^(UV_|PYTHON|VIRTUAL_ENV$|CONDA|PIP_|HF_|HUGGING_FACE|MFLUX_|MPLCONFIGDIR$|__PYVENV)/;

/**
 * 자식 프로세스 환경. 사용자 것은 PATH, HOME, 말, 임시 폴더 정도만 넘기고 uv, 파이썬, Hugging Face 가 쓰는
 * 자리는 모두 local-draw/ 안으로. UV_NO_CONFIG 로 사용자의 uv.toml 도 읽지 않는다.
 * 그리기(offline)는 받기를 막는다: 모델은 이미 줄여 둔 폴더에서만 읽는다
 */
export function toolEnv(
  base: Record<string, string | undefined>,
  l: Layout,
  o: { offline?: boolean } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !LEAKY.test(k)) env[k] = v;
  // Finder 에서 켠 앱은 PATH 가 짧다. pmset(배터리 확인), tar 가 있는 시스템 폴더는 늘 넣는다
  const path = (env.PATH ?? '').split(':').filter(Boolean);
  for (const p of ['/usr/bin', '/bin', '/usr/sbin', '/sbin']) if (!path.includes(p)) path.push(p);
  env.PATH = path.join(':');
  Object.assign(env, {
    UV_NO_CONFIG: '1',
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_PYTHON_DOWNLOADS: 'automatic',
    UV_PYTHON_INSTALL_DIR: l.pythonDir,
    UV_PYTHON_BIN_DIR: l.binDir,
    UV_TOOL_DIR: l.toolDir,
    UV_TOOL_BIN_DIR: l.binDir,
    UV_CACHE_DIR: l.uvCache,
    UV_NO_PROGRESS: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONUNBUFFERED: '1',
    HF_HOME: l.hfHome,
    HF_HUB_DISABLE_TELEMETRY: '1',
    MFLUX_CACHE_DIR: l.mfluxCache,
    MPLCONFIGDIR: l.mplCache,
    TOKENIZERS_PARALLELISM: 'false',
  });
  if (o.offline) {
    env.HF_HUB_OFFLINE = '1';
    env.TRANSFORMERS_OFFLINE = '1';
  }
  return env;
}

/** uv 풀기: 묶음 안 첫 폴더(uv-aarch64-apple-darwin/)를 벗겨 uv/ 에 uv, uvx 만 */
export const untarArgs = (l: Layout) => ['-xzf', l.uvTarball, '-C', l.uvDir, '--strip-components', '1'];

/** mflux 설치. --force 는 반쯤 깔린 것을 덮어쓴다 (멈춘 뒤 다시 할 때) */
export const installArgs = () => [
  'tool',
  'install',
  '--force',
  '--python',
  MFLUX_PIN.python,
  '--exclude-newer',
  MFLUX_PIN.excludeNewer,
  `mflux==${MFLUX_PIN.version}`,
];

/** 원본을 받아 4비트로 줄여 저장. .part 에 쓰고 다 되면 제자리로 옮긴다 (반쯤 쓴 모델을 쓰지 않게) */
export const saveArgs = (l: Layout) => [
  l.save,
  '--model',
  MODEL_PIN.id,
  '--quantize',
  String(MODEL_PIN.quantize),
  '--path',
  l.modelPart,
];

/**
 * 한 번 그리기. 4단계, guidance 1.0 (증류판은 1.0 만 된다), low-ram (M2 Pro 에서 4.6GB 쯤).
 * 진입 글을 venv 파이썬으로 직접 돌린다: 사용자 데이터 경로에 빈칸이 있어(Application Support) 진입 글의 #! 줄을 믿지 않는다.
 * output 은 mflux 가 str.format 을 하므로 중괄호가 없는 임시 폴더여야 한다
 */
export function drawArgs(
  l: Layout,
  o: { input: string; output: string; prompt: string; width: number; height: number; seed: number },
): string[] {
  return [
    l.generate,
    '--model',
    l.model,
    '--base-model',
    MODEL_PIN.id,
    '--image-paths',
    o.input,
    '--prompt',
    o.prompt,
    '--steps',
    '4',
    '--guidance',
    '1.0',
    '--width',
    String(o.width),
    '--height',
    String(o.height),
    '--seed',
    String(o.seed),
    '--low-ram',
    '--output',
    o.output,
  ];
}

/** 그릴 크기: 사진 비율 그대로 긴 변 1024, 16 의 배수 (서버 klein 과 같은 규칙). 모르면 세로 3:4 */
export function drawSize(photo: Uint8Array): { width: number; height: number } {
  const s = imageSize(photo);
  const out = kleinSize(s?.w ?? 768, s?.h ?? 1024);
  return { width: out.w, height: out.h };
}

/**
 * 진행 글에서 마지막 "n/m" (tqdm: " 50%|█████     | 2/4 [00:10<00:10, 5.0s/it]"). tqdm 은 \r 로 줄을 덮어써서
 * \r 과 \n 둘 다로 나눈다. 없으면 undefined
 */
export function lastFraction(text: string, desc?: RegExp): { n: number; total: number } | undefined {
  const lines = text.split(/[\r\n]+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (desc && !desc.test(line)) continue;
    const m = /\|\s*(\d+)\/(\d+)\s*\[/.exec(line) ?? /(?:^|\s)(\d+)\/(\d+)(?:\s|$)/.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    const total = Number(m[2]);
    if (total > 0 && n <= total) return { n, total };
  }
  return undefined;
}

/** uv 설치 진행: "Downloading torch (120.0MiB)" 와 "Downloaded torch" 를 센다. 아직 모르면 0 */
export function installRatio(text: string): number {
  const started = (text.match(/^\s*Downloading\s/gm) ?? []).length;
  const done = (text.match(/^\s*Downloaded\s/gm) ?? []).length;
  if (started === 0) return 0;
  // 끝(설치)을 위해 조금 남긴다
  return Math.min(0.9, (done / started) * 0.9);
}

/**
 * 그리기 + 털 다듬기 전체 진행률. pass 0 은 그리기, 1 은 털 다듬기 (반씩). 한 번 안에서는 모델 읽기 15%,
 * 4단계 80%, 저장 5%. step 을 모르면(아직 읽는 중) 읽기 몫의 절반
 */
export function drawRatio(pass: 0 | 1, step?: { n: number; total: number }): number {
  const within = step ? 0.15 + 0.8 * Math.min(1, step.n / Math.max(1, step.total)) : 0.07;
  return Math.min(0.99, (pass + within) / 2);
}

export type LocalDrawErrorKind =
  | 'unsupported'
  | 'notReady'
  | 'busy'
  | 'disk'
  | 'offline'
  | 'memory'
  | 'battery'
  | 'timeout'
  | 'cancelled'
  | 'bad'
  | 'failed';

export class LocalDrawError extends Error {
  readonly kind: LocalDrawErrorKind;
  constructor(kind: LocalDrawErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * 자식 프로세스 실패를 종류로. 멈추기, 시간 초과가 먼저, 그다음 남긴 글(stderr 끝)로 고른다.
 * 그만두지 않았는데 SIGKILL 로 죽었으면 macOS 가 메모리가 모자라 끈 것으로 본다(jetsam)
 */
export function classifyFailure(
  log: string,
  o: {
    aborted?: boolean;
    timedOut?: boolean;
    signal?: string | null;
    spawnCode?: string;
    phase: 'setup' | 'draw';
  },
): LocalDrawErrorKind {
  if (o.aborted) return 'cancelled';
  if (o.timedOut) return 'timeout';
  if (o.spawnCode === 'ENOENT' || o.spawnCode === 'EACCES') return o.phase === 'draw' ? 'notReady' : 'failed';
  if (o.spawnCode === 'ENOSPC') return 'disk';
  if (/no space left on device|ENOSPC|errno 28\b|not enough free disk space/i.test(log)) return 'disk';
  if (/battery below/i.test(log)) return 'battery';
  if (
    /insufficient memory|out of memory|outofmemory|memoryerror|failed to allocate|kIOGPUCommandBufferCallbackErrorOutOfMemory/i.test(
      log,
    )
  )
    return 'memory';
  if (o.signal === 'SIGKILL') return 'memory';
  if (
    o.phase === 'setup' &&
    /failed to fetch|could not connect|connecterror|connectionerror|connection (refused|reset)|dns error|failed to lookup address|nodename nor servname|temporary failure in name resolution|network is unreachable|timed out|maxretryerror|error sending request|tcp connect error|offline mode/i.test(
      log,
    )
  )
    return 'offline';
  // 그리기 중 "모델 파일이 없다" 는 준비가 깨진 것 (줄인 모델 폴더가 지워졌거나 덜 썼다)
  if (
    o.phase === 'draw' &&
    /localentrynotfound|incomplete saved model|no such file or directory.*models/i.test(log)
  )
    return 'notReady';
  return 'failed';
}

/** 기록에 남길 끝부분 (프롬프트는 인자로만 가서 stderr 에 잘 안 나오지만 길게 남기지 않는다) */
export function tail(text: string, max = 400): string {
  const s = text
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return s.length > max ? `...${s.slice(-max)}` : s;
}

/** 준비 기록 (state.json): 단계마다 다 된 판을 적는다. 고정한 판이 바뀌면 그 단계부터 다시 */
export interface SetupState {
  uv?: string;
  mflux?: string;
  model?: string;
}

export const modelTag = () => `${MODEL_PIN.id}-q${MODEL_PIN.quantize}`;
export const mfluxTag = () => `${MFLUX_PIN.version}@${MFLUX_PIN.excludeNewer}`;

/** state.json 글을 읽는다. 깨졌거나 모르는 모양이면 빈 기록 (처음부터, 있는 파일은 단계마다 다시 쓴다) */
export function parseSetupState(raw: string | undefined | null): SetupState {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const r = v as Record<string, unknown>;
    const out: SetupState = {};
    for (const k of ['uv', 'mflux', 'model'] as const) {
      const x = r[k];
      if (typeof x === 'string' && x.length > 0 && x.length < 200) out[k] = x;
    }
    return out;
  } catch {
    return {};
  }
}

/** 아직 할 단계. 앞 단계를 다시 하면 뒤 단계도 다시 (uv 가 바뀌면 mflux 를 다시 깐다). 모델은 따로 둔다 */
export function stepsToRun(s: SetupState): { uv: boolean; mflux: boolean; model: boolean } {
  const uv = s.uv !== UV_PIN.version;
  const mflux = uv || s.mflux !== mfluxTag();
  const model = s.model !== modelTag();
  return { uv, mflux, model };
}

export const isSetupDone = (s: SetupState) => {
  const r = stepsToRun(s);
  return !r.uv && !r.mflux && !r.model;
};

/** 준비에 필요한 빈 공간. 이미 받아 둔 만큼(이어 받기)은 덜 필요하다. 그래도 2GB 는 남긴다 */
export function setupSpaceNeeded(existingBytes: number): number {
  return Math.max(2e9, SETUP_FREE_BYTES - Math.max(0, existingBytes));
}

/**
 * `ps -A -o pid=,ppid=` 결과에서 root 의 자손 pid 들 (자식부터 깊이 순). 그만두면 uv, 파이썬이 띄운 것까지 끈다.
 * 같은 프로세스 묶음(detached:false)이라 묶음째 죽이면 앱도 죽어서 하나씩 찾는다
 */
export function descendants(psOutput: string, root: number): number[] {
  const kids = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const list = kids.get(ppid) ?? [];
    list.push(pid);
    kids.set(ppid, list);
  }
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const walk = (p: number) => {
    for (const c of kids.get(p) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/**
 * 그린 그림 확인: 그림 형식이고, 부탁한 크기이며, 너무 작지 않다(거의 한 색인 판은 PNG 가 몇 KB).
 * 사진과 거의 같은지는 창이 본다(sameAsPhoto)
 */
export function checkDrawn(
  bytes: Uint8Array,
  want: { width: number; height: number },
): { ok: true; kind: ImageKind } | { ok: false; why: string } {
  const kind = imageKind(bytes);
  if (!kind) return { ok: false, why: 'not an image' };
  if (bytes.length < MIN_DRAWN_BYTES) return { ok: false, why: `too small ${bytes.length}` };
  const s = imageSize(bytes);
  if (s && (Math.abs(s.w - want.width) > 16 || Math.abs(s.h - want.height) > 16))
    return { ok: false, why: `size ${s.w}x${s.h}` };
  return { ok: true, kind };
}
