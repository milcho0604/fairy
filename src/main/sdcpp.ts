// 내 컴퓨터에서 그리기의 sd.cpp 엔진 (2026-10-10): Windows x64, 인텔 Mac, macOS 12~13 의 Apple 칩 Mac.
// 순수 계산은 sdcpp-core.ts, 자식 프로세스와 한 번에 하나는 local-proc.ts (mflux 와 같이 쓴다).
// 윈도우는 sd-cli 묶음(Vulkan 판, CPU 판)을 받아 풀고, 맥은 앱 안에 넣은 sd-cli 를 쓴다. 모델 셋(5.2GB)은
// 사용자 데이터 local-draw-sd/ 에 받는다 (이어 받기, 해시 확인). 사진은 이 컴퓨터 밖으로 나가지 않는다
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { type LocalDrawInfo, SD_DRAW_GB, SD_SETUP_STAGES, setupRatio } from '../shared/local-draw.ts';
import { ensureVerified, forgetVerified } from './download.ts';
import { FUR_PROMPT, type ImageKind } from './hf-illust.ts';
import { checkDrawn, DRAW_FREE_BYTES, LocalDrawError, tail } from './local-draw-core.ts';
import {
  dirBytesAsync,
  downloadKind,
  exclusive,
  FolderSize,
  freeBytes,
  GB,
  jobBusyFor,
  keepErrorLog,
  killOrphan,
  type Log,
  moveToTrash,
  run,
  stopJobFor,
  sweepDone,
  sweepTrash,
} from './local-proc.ts';
import { writeFileAtomic } from './safe-file.ts';
import {
  classifySdFailure,
  gpuLooksUsable,
  hasVulkanDevice,
  isSdSetupDone,
  type LocalPick,
  modelsRatio,
  parseSdState,
  pictureMinutes,
  SD_MODELS,
  SD_RELEASE,
  SD_TIMEOUT_MS,
  SD_WIN_ASSETS,
  type SdBackend,
  type SdLayout,
  type SdState,
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
  sdWinDir,
  sdZipPath,
  shouldFallbackToCpu,
  tierOf,
  unzipArgs,
  winTar,
} from './sdcpp-core.ts';

type SdPick = Extract<LocalPick, { engine: 'sdcpp' }>;

const FOLDER = 'local-draw-sd';
const rootDir = () => join(app.getPath('userData'), FOLDER);
const L = () => sdLayout(rootDir());
const runPidOf = (l: SdLayout) => ({ path: l.runPid, root: l.root });

function readState(l: SdLayout): SdState {
  try {
    return parseSdState(readFileSync(l.state, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(l: SdLayout, s: SdState) {
  mkdirSync(l.root, { recursive: true });
  writeFileAtomic(l.state, JSON.stringify(s));
}

/** 지금 쓸 백엔드: 고른 것, 그래픽 칩이 안 돼 CPU 로 되돌렸으면 cpu */
const backendOf = (pick: SdPick, s: SdState): SdBackend => (s.backend === 'cpu' ? 'cpu' : pick.backend);

function binaryPath(l: SdLayout, backend: SdBackend): string {
  return sdBinary({
    platform: process.platform,
    arch: process.arch,
    l,
    backend,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
  });
}

/**
 * 도구가 있을 수 있는지. 맥은 앱 안 sd-cli 가 있어야 한다 (개발 중 scripts/build-sdcpp.mjs 전에는 없다:
 * 그때는 고르기를 감춘다). 윈도우는 준비할 때 받는다
 */
export function sdBinaryReady(pick: SdPick): boolean {
  if (process.platform === 'win32') return true;
  return existsSync(binaryPath(L(), pick.backend));
}

/**
 * 윈도우 도구가 디스크에 있는지: 지금 백엔드의 sd-cli.exe 와 되돌릴 자리인 CPU 판. 맥은 앱 안 것이라 늘 true
 * (없으면 sdBinaryReady 가 고르기를 감춘다)
 */
function toolsOnDisk(pick: SdPick, l: SdLayout, s: SdState): boolean {
  if (process.platform !== 'win32') return true;
  return existsSync(binaryPath(l, backendOf(pick, s))) && existsSync(binaryPath(l, 'cpu'));
}

/** 준비가 다 됐는지: 기록이 지금 고정한 판과 같고 실제 파일도 있다 */
function sdReady(pick: SdPick): boolean {
  const l = L();
  const s = readState(l);
  return (
    isSdSetupDone(s, process.platform) &&
    SD_MODELS.every((m) => existsSync(sdModelPath(l, m))) &&
    existsSync(binaryPath(l, backendOf(pick, s)))
  );
}

export function sdInfo(pick: SdPick): LocalDrawInfo {
  const tier = tierOf(backendOf(pick, readState(L())));
  return {
    supported: true,
    ready: sdReady(pick),
    engine: 'sdcpp',
    tier,
    need: { ...SD_DRAW_GB },
    minutes: pictureMinutes(tier),
  };
}

const size = new FolderSize(rootDir, () => readState(L()).bytes ?? 0);

function exclusiveSd<T>(
  signal: AbortSignal,
  work: (ac: AbortController, kids: Set<ChildProcess>) => Promise<T>,
  log?: Log,
) {
  const l = L();
  return exclusive(signal, { runPid: runPidOf(l), tmp: l.tmp, after: () => size.refresh() }, work, log);
}

/** 저장 공간에 보일 sd.cpp 폴더 크기 */
export function sdDrawBytes(): number {
  return size.bytes(existsSync(rootDir()));
}

/** 저장 공간에서 sd.cpp 폴더 지우기 (하던 일을 먼저 멈춘다) */
export async function removeSdDraw(log?: Log): Promise<boolean> {
  await sweepDone();
  const l = L();
  // 이 폴더의 일만 멈춘다 (mflux 로 그리는 중이면 그대로 두고 지운다)
  await stopJobFor(l.root);
  if (jobBusyFor(l.root)) return false;
  if (!existsSync(l.root)) return true;
  if (!moveToTrash(l.root, log)) return false;
  for (const m of SD_MODELS) forgetVerified(sdModelPath(l, m));
  for (const w of ['vulkan', 'cpu'] as const) forgetVerified(sdZipPath(l, w));
  size.reset();
  sweepTrash(FOLDER);
  log?.('local-draw', 'sd removed');
  return true;
}

/** 앱을 켤 때 (sweepLocalDraw 안에서): 남은 sd-cli 를 끄고 임시 그림, 지우다 만 폴더를 치운다 */
export async function sdOrphanSweep(log?: Log): Promise<void> {
  sweepTrash(FOLDER);
  const l = L();
  if (!existsSync(l.root)) return;
  await killOrphan(runPidOf(l), log);
  await rm(l.tmp, { recursive: true, force: true });
  size.refresh();
}

/** 윈도우 그래픽 칩 (Electron 이 아는 것). 모르면 쓸 만하다고 보고 Vulkan 을 해 본다 */
async function gpuUsable(): Promise<boolean> {
  try {
    const info = (await Promise.race([
      app.getGPUInfo('basic'),
      new Promise((r) => setTimeout(() => r(undefined), 5000)),
    ])) as { gpuDevice?: { vendorId?: number }[] } | undefined;
    if (!info?.gpuDevice) return true;
    return gpuLooksUsable(info.gpuDevice);
  } catch {
    return true;
  }
}

const sizeOf = (p: string) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

/** 자식 환경: 사용자 것을 그대로 (sd-cli 는 받기를 하지 않는다) */
const sdEnv = () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
};

/**
 * 처음 한 번 준비: (윈도우) sd-cli 묶음 둘 받아 풀기 → 모델 셋 받기 (이어 받기, 해시 확인). 단계마다 state.json 에
 * 적어 멈추거나 꺼져도 다음에 다 된 것은 건너뛰고, 받다 만 모델은 그 뒤부터 받는다. 진행률은 0~1
 */
export function setupSd(
  pick: SdPick,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
  log: Log,
): Promise<void> {
  return exclusiveSd(
    signal,
    async (ac, children) => {
      const l = L();
      mkdirSync(l.root, { recursive: true });
      sweepTrash(FOLDER);
      // 기록만 믿지 않는다: 누가 폴더 안 파일을 지웠으면 그 단계부터 다시
      const saved = readState(l);
      const state = sdStateOnDisk(saved, {
        model: (m) => existsSync(sdModelPath(l, m)),
        tools: toolsOnDisk(pick, l, saved),
      });
      const todo = sdStepsToRun(state, process.platform);
      const started = Date.now();
      log('local-draw', 'sd setup', JSON.stringify({ tools: todo.tools, models: todo.models.length }));
      const parts = todo.models.reduce((n, m) => n + sizeOf(sdPartPath(l, m)), 0);
      const need = sdSpaceNeeded(todo, parts);
      const stages = SD_SETUP_STAGES;
      try {
        const free = freeBytes(l.root);
        if (need > 0 && free < need)
          throw new LocalDrawError('disk', `free ${GB(free)}GB < ${GB(need)}GB`, GB(need));
        const common = {
          env: sdEnv(),
          signal: ac.signal,
          phase: 'setup' as const,
          children,
          runPid: runPidOf(l),
        };

        // 그래픽 칩이 없으면(기본 렌더러뿐) 처음부터 CPU 판으로
        if (
          process.platform === 'win32' &&
          pick.backend === 'vulkan' &&
          state.backend !== 'cpu' &&
          !(await gpuUsable())
        ) {
          state.backend = 'cpu';
          writeState(l, state);
          log('local-draw', 'sd no gpu, cpu');
        }

        if (todo.tools) {
          onProgress(setupRatio('uv', 0, stages));
          const total = SD_WIN_ASSETS.vulkan.bytes + SD_WIN_ASSETS.cpu.bytes;
          let done = 0;
          for (const which of ['vulkan', 'cpu'] as const) {
            const a = SD_WIN_ASSETS[which];
            const zip = sdZipPath(l, which);
            try {
              await ensureVerified(
                { path: zip, url: sdAssetUrl(a.name), sha256: a.sha256, bytes: a.bytes },
                (r) => onProgress(setupRatio('uv', (done + r * a.bytes) / total, stages)),
                ac.signal,
              );
            } catch (err) {
              throw downloadKind(err, ac.signal.aborted);
            }
            const dir = sdWinDir(l, which);
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
            // 한글 사용자 이름의 %APPDATA% 를 tar 가 못 열어서 root 안 상대 경로로 (sdUnzipRel)
            const rel = sdUnzipRel(which);
            await run(winTar(process.env.SystemRoot), unzipArgs(rel.zip, rel.dir), {
              ...common,
              cwd: l.root,
            });
            if (!existsSync(join(dir, 'sd-cli.exe')))
              throw new LocalDrawError('failed', `sd-cli.exe missing in ${which}`);
            rmSync(zip, { force: true });
            forgetVerified(zip);
            done += a.bytes;
          }
          state.tools = SD_RELEASE.tag;
          writeState(l, state);
        }

        // Vulkan 판이 그래픽 칩을 하나도 못 보면 그리는 동안 말없이 CPU 로 돈다 (느린데 화면은 GPU 시간을 안내).
        // 한 번 물어보고 없으면 CPU 판으로. 물어보기가 죽어도(vulkan-1.dll 없음 등) Vulkan 은 안 되는 것이다
        if (process.platform === 'win32' && pick.backend === 'vulkan' && state.backend !== 'cpu') {
          let devices = '';
          try {
            devices = await run(binaryPath(l, 'vulkan'), ['--list-devices'], {
              ...common,
              timeoutMs: 60_000,
              cwd: sdWinDir(l, 'vulkan'),
            });
          } catch (err) {
            if (err instanceof LocalDrawError && err.kind === 'cancelled') throw err;
            log(
              'local-draw',
              'sd list devices',
              err instanceof Error ? err.message.slice(0, 200) : String(err),
            );
          }
          if (!hasVulkanDevice(devices)) {
            state.backend = 'cpu';
            writeState(l, state);
            log('local-draw', 'sd no vulkan device, cpu');
          }
        }

        // 모델: 이미 받은 것도 진행 막대에 넣어 둔다 (멈췄다 이어 하면 그 자리부터 보이게)
        onProgress(setupRatio('model', 0, stages));
        let done = SD_MODELS.filter((m) => !todo.models.includes(m)).reduce((n, m) => n + m.bytes, 0);
        mkdirSync(l.modelsDir, { recursive: true });
        for (const m of todo.models) {
          try {
            await ensureVerified(
              { path: sdModelPath(l, m), url: m.url, sha256: m.sha256, bytes: m.bytes, resume: true },
              (r) => onProgress(setupRatio('model', modelsRatio(done, r * m.bytes), stages)),
              ac.signal,
            );
          } catch (err) {
            throw downloadKind(err, ac.signal.aborted);
          }
          state.models = { ...state.models, [m.file]: m.sha256 };
          writeState(l, state);
          done += m.bytes;
        }
        if (!existsSync(binaryPath(l, backendOf(pick, state))))
          throw new LocalDrawError('unsupported', 'sd-cli missing');
        state.bytes = await dirBytesAsync(l.root);
        writeState(l, state);
        onProgress(1);
        log('local-draw', 'sd setup done', `${Math.round((Date.now() - started) / 1000)}s`);
      } catch (err) {
        const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
        if (e.kind === 'disk' && e.gb === undefined && need > 0) e.gb = GB(need);
        log('local-draw', 'sd setup', e.kind, e.message.slice(0, 300));
        if (e.kind !== 'cancelled') keepErrorLog(l.root, l.errorLog, 'setup', e);
        throw e;
      }
    },
    log,
  );
}

/** 한 장 그리기. 임시 폴더(local-draw-sd/tmp 안)에 넣을 그림을 쓰고 결과를 읽은 뒤 폴더를 지운다 */
async function drawOnce(
  l: SdLayout,
  backend: SdBackend,
  input: Uint8Array,
  inputKind: ImageKind,
  prompt: string,
  pass: 0 | 1,
  o: { signal: AbortSignal; children: Set<ChildProcess>; onProgress: (r: number) => void },
): Promise<{ bytes: Uint8Array; kind: ImageKind; ranOnCpu: boolean }> {
  mkdirSync(l.tmp, { recursive: true });
  const tmp = mkdtempSync(join(l.tmp, 'jj-draw-'));
  let seen = '';
  // 끝 64KB 에서 밀려날 수 있는 처음 경고를 흐르는 대로 기억한다
  const watch = sdLogWatch();
  try {
    const ext = inputKind === 'jpeg' ? 'jpg' : inputKind;
    const inPath = join(tmp, `in.${ext}`);
    const outPath = join(tmp, 'out.png');
    writeFileSync(inPath, input);
    const tier = tierOf(backend);
    const want = sdDrawSize(input, tier);
    const seed = Math.floor(Math.random() * 2 ** 31);
    o.onProgress(sdDrawRatio(pass));
    const bin = binaryPath(l, backend);
    const text = await run(
      bin,
      sdDrawArgs(l, { input: inPath, output: outPath, prompt, ...want, seed, backend }),
      {
        env: sdEnv(),
        signal: o.signal,
        phase: 'draw',
        timeoutMs: SD_TIMEOUT_MS[tier === 'cpu' ? 'cpu' : 'gpu'],
        children: o.children,
        runPid: runPidOf(l),
        classify: classifySdFailure,
        cwd: tmp,
        onText: (t) => {
          seen = t;
          watch.feed(t);
          const p = sdProgress(t);
          if (p) o.onProgress(sdDrawRatio(pass, p));
        },
      },
    );
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(outPath));
    } catch {
      throw new LocalDrawError('bad', `no output: ${tail(text, 300)}`);
    }
    const checked = checkDrawn(bytes, want);
    if (!checked.ok) throw new LocalDrawError('bad', checked.why);
    return { bytes, kind: checked.kind, ranOnCpu: watch.cpu };
  } catch (err) {
    // 그래픽 칩 실패인지 보려고 남긴 글을 붙인다 (메시지에는 끝 300자만 있다). 밀려난 흔적 줄도 앞에
    if (err instanceof LocalDrawError) Object.assign(err, { log: `${watch.gpu ?? ''}\n${seen}` });
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * sd.cpp 로 그리기 + 털 다듬기 (서버, mflux 와 같은 순서). 털 다듬기가 실패하면 첫 그림. 그래픽 칩으로 그리다
 * 죽거나 그래픽 메모리가 모자라면 CPU 로 한 번 다시 하고 기억한다 (다음부터 CPU, 화면의 걸리는 시간도 바뀐다)
 */
export function illustrateSd(
  pick: SdPick,
  photo: Uint8Array,
  kind: 'jpeg' | 'png',
  prompt: string,
  o: { signal: AbortSignal; onProgress: (r: number) => void; log: Log },
): Promise<{
  bytes: Uint8Array;
  kind: ImageKind;
  fur: boolean;
  before?: { bytes: Uint8Array; kind: ImageKind };
}> {
  if (!sdReady(pick)) return Promise.reject(new LocalDrawError('notReady'));
  return exclusiveSd(
    o.signal,
    async (ac, children) => {
      const l = L();
      const free = freeBytes(l.root);
      if (free < DRAW_FREE_BYTES) throw new LocalDrawError('disk', `free ${GB(free)}GB`);
      const state = readState(l);
      let backend = backendOf(pick, state);
      const opt = { signal: ac.signal, children, onProgress: o.onProgress };
      /** 다음부터 CPU 로 (state.json). CPU 로 실제로 그려진 뒤에만 부른다 */
      const toCpu = () => {
        backend = 'cpu';
        state.backend = 'cpu';
        writeState(l, state);
      };
      const pass = async (input: Uint8Array, inputKind: ImageKind, text: string, n: 0 | 1) => {
        try {
          const r = await drawOnce(l, backend, input, inputKind, text, n, opt);
          // Vulkan 판이 그래픽 칩을 못 찾아 스스로 CPU 로 그렸으면 기억한다 (다음부터 768 로, 시간 안내도 CPU)
          if (backend !== 'cpu' && r.ranOnCpu) {
            o.log('local-draw', 'sd ran on cpu');
            toCpu();
          }
          return r;
        } catch (err) {
          const log = (err as { log?: string }).log ?? (err instanceof Error ? err.message : '');
          const exitCode = (err as { exitCode?: number | null }).exitCode;
          if (
            err instanceof LocalDrawError &&
            shouldFallbackToCpu(backend, err.kind, log, exitCode) &&
            existsSync(binaryPath(l, 'cpu'))
          ) {
            o.log('local-draw', 'sd gpu failed, cpu', err.kind, err.message.slice(0, 200));
            // CPU 로 다시 해 보고 되면 그때 기억한다 (CPU 로도 안 되면 그래픽 칩 탓이 아니었다: 다음에도 GPU 로)
            const r = await drawOnce(l, 'cpu', input, inputKind, text, n, opt);
            toCpu();
            return r;
          }
          throw err;
        }
      };
      const started = Date.now();
      try {
        const drawn = await pass(photo, kind, prompt, 0);
        o.log('local-draw', 'sd drawn', backend, `${Math.round((Date.now() - started) / 1000)}s`);
        try {
          const fur = await pass(drawn.bytes, drawn.kind, FUR_PROMPT, 1);
          o.log('local-draw', 'sd fur', `${Math.round((Date.now() - started) / 1000)}s`);
          return {
            bytes: fur.bytes,
            kind: fur.kind,
            fur: true,
            before: { bytes: drawn.bytes, kind: drawn.kind },
          };
        } catch (err) {
          if (err instanceof LocalDrawError && (err.kind === 'cancelled' || err.kind === 'notReady'))
            throw err;
          o.log('local-draw', 'sd fur skipped', err instanceof LocalDrawError ? err.kind : String(err));
          return { bytes: drawn.bytes, kind: drawn.kind, fur: false };
        }
      } catch (err) {
        const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
        o.log('local-draw', 'sd draw', e.kind, e.message.slice(0, 300));
        if (e.kind !== 'cancelled') keepErrorLog(l.root, l.errorLog, 'draw', e);
        throw e;
      }
    },
    o.log,
  );
}
