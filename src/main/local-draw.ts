// 내 컴퓨터에서 그리기 (AI 일러스트 로컬 엔진, 2026-10-10): 엔진 고르기와 mflux 엔진의 설치, 그리기, 지우기.
// 엔진은 pickLocalEngine 이 고른다: Apple 칩 Mac(macOS 14+)은 여기 mflux, 나머지는 sd.cpp (sdcpp.ts).
// 사진은 이 컴퓨터 밖으로 나가지 않는다. 인터넷은 처음 준비할 때 도구와 모델을 받을 때만 쓴다.
// 자식 프로세스, 한 번에 하나, 남은 자식 정리는 local-proc.ts 를 두 엔진이 같이 쓴다
import type { ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { app, session } from 'electron';
import { LOCAL_DRAW_GB, type LocalDrawInfo, setupRatio } from '../shared/local-draw.ts';
import { ensureVerified, forgetVerified } from './download.ts';
import { FUR_PROMPT, type ImageKind } from './hf-illust.ts';
import {
  checkDrawn,
  classifyFailure,
  DRAW_FREE_BYTES,
  DRAW_TIMEOUT_MS,
  drawArgs,
  drawRatio,
  drawSize,
  drawTmpBase,
  installArgs,
  installRatio,
  isSetupDone,
  type Layout,
  LocalDrawError,
  lastFraction,
  layout,
  MODEL_DOWNLOAD_BYTES,
  mfluxTag,
  modelTag,
  parseProxy,
  parseSetupState,
  type SetupState,
  saveArgs,
  setupSpaceNeeded,
  stepsToRun,
  tail,
  toolEnv,
  UV_PIN,
  untarArgs,
} from './local-draw-core.ts';
import {
  dirBytesAsync,
  downloadKind,
  exclusive,
  FolderSize,
  freeBytes,
  GB,
  jobBusy,
  keepErrorLog,
  killOrphan,
  type Log,
  moveToTrash,
  run as runProc,
  stopJob,
  stopJobNow,
  sweepBusy,
  sweepDone,
  sweepTrash,
  trackSweep,
} from './local-proc.ts';
import { writeFileAtomic } from './safe-file.ts';
import { illustrateSd, sdBinaryReady, sdInfo, sdOrphanSweep, setupSd } from './sdcpp.ts';
import { type LocalPick, pickLocalEngine, pictureMinutes } from './sdcpp-core.ts';

const rootDir = () => join(app.getPath('userData'), 'local-draw');
const L = () => layout(rootDir());
const runPidOf = (l: Layout) => ({ path: l.runPid, root: l.root });

/** 이 컴퓨터에서 쓸 엔진 (메모리, 운영체제, 칩으로 고른다. sdcpp-core.ts pickLocalEngine) */
export function localDrawPick(): LocalPick {
  return pickLocalEngine({
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? '',
    totalMem: os.totalmem(),
    osRelease: os.release(),
  });
}

/** 이 컴퓨터에서 그릴 수 있는지. sd.cpp 맥은 앱 안 sd-cli 가 있어야 (개발 중 빌드 전에는 없다) */
export function localDrawSupport(): LocalPick {
  const pick = localDrawPick();
  if (pick.ok && pick.engine === 'sdcpp' && !sdBinaryReady(pick)) return { ok: false, reason: 'os' };
  return pick;
}

function readState(l: Layout): SetupState {
  try {
    return parseSetupState(readFileSync(l.state, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(l: Layout, s: SetupState) {
  writeFileAtomic(l.state, JSON.stringify(s));
}

/** mflux 준비가 다 됐는지: 기록이 지금 고정한 판과 같고 실제 파일도 있다 (누가 폴더 안을 지웠을 수 있다) */
function mfluxReady(): boolean {
  const l = L();
  return isSetupDone(readState(l)) && existsSync(l.python) && existsSync(l.generate) && existsSync(l.model);
}

export function localDrawInfo(): LocalDrawInfo {
  const pick = localDrawSupport();
  if (!pick.ok) return { supported: false, ready: false };
  if (pick.engine === 'sdcpp') return sdInfo(pick);
  return {
    supported: true,
    ready: mfluxReady(),
    engine: 'mflux',
    tier: 'mflux',
    need: { ...LOCAL_DRAW_GB },
    minutes: pictureMinutes('mflux'),
  };
}

/** mflux 명령 하나 (자식 정리는 local-proc.ts) */
function run(
  cmd: string,
  args: string[],
  o: {
    env: Record<string, string>;
    signal: AbortSignal;
    phase: 'setup' | 'draw';
    timeoutMs?: number;
    onText?: (text: string) => void;
    children: Set<ChildProcess>;
    l: Layout;
  },
): Promise<string> {
  const { l, ...rest } = o;
  return runProc(cmd, args, { ...rest, runPid: runPidOf(l) });
}

const size = new FolderSize(rootDir, () => readState(L()).bytes ?? 0);
const refreshBytes = () => size.refresh();

/** mflux 의 한 번에 하나 (두 엔진을 합쳐 하나, local-proc.ts) */
function exclusiveMflux<T>(
  signal: AbortSignal,
  work: (ac: AbortController, kids: Set<ChildProcess>) => Promise<T>,
  log?: Log,
) {
  const l = L();
  return exclusive(signal, { runPid: runPidOf(l), tmp: l.tmp, after: refreshBytes }, work, log);
}

/** 하는 일을 멈추고 자식이 다 끝날 때까지 기다린다 (지우기 전에). 두 엔진 모두 */
export const stopLocalDraw = stopJob;
/** 앱을 끌 때: 기다리지 않고 끈다 */
export const stopLocalDrawNow = stopJobNow;
export const localDrawBusy = jobBusy;

/**
 * 저장 공간에 보일 mflux 폴더 크기. 폴더를 세지 않고 마지막으로 센 값 (없으면 준비 끝에 state.json 에 적은 크기)
 */
export function localDrawBytes(): number {
  return size.bytes(existsSync(rootDir()));
}

/**
 * 저장 공간에서 mflux 폴더 지우기. 하는 일이 있으면 먼저 멈추고(자식이 끝날 때까지) 폴더를 옆 이름으로 옮긴 뒤
 * 뒤에서 지운다 (파일이 수만 개라 지우는 동안 창이 멈추지 않게)
 */
export async function removeLocalDraw(log?: Log): Promise<boolean> {
  await sweepDone();
  await stopJob();
  if (jobBusy()) return false;
  const root = rootDir();
  if (!existsSync(root)) return true;
  if (!moveToTrash(root, log)) return false;
  forgetVerified(L().uvTarball);
  size.reset();
  sweepTrash('local-draw');
  log?.('local-draw', 'removed');
  return true;
}

/**
 * 앱을 켤 때 (ready 뒤, 기다리지 않는다): 두 엔진 모두 앞서 앱이 갑자기 꺼져 남은 자식을 끄고, 남은 임시 그림과
 * 지우다 만 폴더(*.trash-*)를 치우고, 저장 공간에 보일 크기를 뒤에서 센다
 */
export function sweepLocalDraw(log?: Log): void {
  if (sweepBusy() || jobBusy()) return;
  sweepTrash('local-draw');
  const l = L();
  const mflux = existsSync(l.root);
  trackSweep(
    (async () => {
      if (mflux) {
        await killOrphan(runPidOf(l), log);
        await rm(l.tmp, { recursive: true, force: true });
      }
      await sdOrphanSweep(log);
    })(),
    log,
  );
  if (mflux) refreshBytes();
}

// ----- 준비 (mflux) -----

/**
 * 처음 한 번 준비: uv 받기(해시 확인) → mflux 설치 → 모델 받아 4비트로 저장. 단계마다 state.json 에 적어
 * 멈추거나 꺼져도 다음에 다 된 단계는 건너뛴다 (원본 받기도 Hugging Face 가 이어 받는다). 진행률은 0~1
 */
export function setupLocalDraw(
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
  log: Log,
): Promise<void> {
  const pick = localDrawSupport();
  if (!pick.ok) return Promise.reject(new LocalDrawError('unsupported'));
  if (pick.engine === 'sdcpp') return setupSd(pick, onProgress, signal, log);
  return exclusiveMflux(
    signal,
    async (ac, children) => {
      const l = L();
      mkdirSync(l.root, { recursive: true });
      sweepTrash('local-draw');
      const state = readState(l);
      const todo = stepsToRun(state);
      const started = Date.now();
      log('local-draw', 'setup', JSON.stringify(todo));
      // 모델을 다 줄여 저장한 뒤 원본(hf/)을 지우기 전에 꺼졌으면 남은 원본을 치운다
      if (!todo.model) await rm(l.hfHome, { recursive: true, force: true }).catch(() => {});
      // 실제로 할 단계만큼만 요구한다. statfs 는 어림(APFS 의 지울 수 있는 공간은 빠진다)이라 진짜 막는 것은 ENOSPC → disk
      const need = setupSpaceNeeded(todo, todo.model ? await dirBytesAsync(l.hfHome) : 0);
      try {
        const free = freeBytes(l.root);
        if (need > 0 && free < need)
          throw new LocalDrawError('disk', `free ${GB(free)}GB < ${GB(need)}GB`, GB(need));
        // 시스템 설정의 프록시 (Finder 에서 켠 앱은 셸 값이 없다). 모르면 없이
        const proxy = parseProxy(
          await session.defaultSession.resolveProxy('https://huggingface.co').catch(() => ''),
        );
        if (proxy) log('local-draw', 'setup via proxy');
        const env = toolEnv(process.env, l, { proxy });
        const common = { env, signal: ac.signal, phase: 'setup' as const, children, l };

        if (todo.uv) {
          onProgress(setupRatio('uv', 0));
          try {
            await ensureVerified(
              { path: l.uvTarball, url: UV_PIN.url, sha256: UV_PIN.sha256, bytes: UV_PIN.bytes },
              (r) => onProgress(setupRatio('uv', r)),
              ac.signal,
            );
          } catch (err) {
            throw downloadKind(err, ac.signal.aborted);
          }
          rmSync(l.uvDir, { recursive: true, force: true });
          mkdirSync(l.uvDir, { recursive: true });
          await run('/usr/bin/tar', untarArgs(l), common);
          chmodSync(l.uv, 0o755);
          // 받은 실행 파일에 격리 표시가 붙었으면 뗀다 (없으면 그냥 실패, 상관없다)
          await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', l.uvDir], common).catch(() => '');
          rmSync(l.uvTarball, { force: true });
          forgetVerified(l.uvTarball);
          state.uv = UV_PIN.version;
          delete state.mflux;
          writeState(l, state);
        }

        if (todo.mflux) {
          onProgress(setupRatio('tools', 0));
          await run(l.uv, installArgs(), {
            ...common,
            onText: (text) => onProgress(setupRatio('tools', installRatio(text))),
          });
          if (!existsSync(l.python) || !existsSync(l.generate) || !existsSync(l.save))
            throw new LocalDrawError('failed', 'mflux entry points missing');
          // 받은 휠 묶음은 설치에 복사돼 있어 지워도 된다 (1GB 안팎)
          await rm(l.uvCache, { recursive: true, force: true }).catch(() => {});
          state.mflux = mfluxTag();
          writeState(l, state);
        }

        if (todo.model) {
          onProgress(setupRatio('model', 0));
          rmSync(l.modelPart, { recursive: true, force: true });
          mkdirSync(l.modelsDir, { recursive: true });
          // 원본 받기 진행은 받은 폴더 크기로 잰다 (Hugging Face 는 받는 중인 파일도 .incomplete 로 그 안에 둔다)
          let packing = false;
          const poll = setInterval(() => {
            if (packing) return;
            void dirBytesAsync(l.hfHome).then((b) => {
              if (!packing) onProgress(setupRatio('model', Math.min(0.99, b / MODEL_DOWNLOAD_BYTES)));
            });
          }, 2000);
          try {
            await run(l.python, saveArgs(l), {
              ...common,
              onText: (text) => {
                const f = lastFraction(text, /Saving components/);
                if (!f) return;
                packing = true;
                onProgress(setupRatio('pack', f.n / f.total));
              },
            });
          } finally {
            clearInterval(poll);
          }
          if ((await dirBytesAsync(l.modelPart)) < 1e9)
            throw new LocalDrawError('failed', 'saved model too small');
          rmSync(l.model, { recursive: true, force: true });
          renameSync(l.modelPart, l.model);
          // 다 됐다고 먼저 적고 원본(15GB 쯤)을 지운다. 그사이 꺼져도 다음에 원본을 다시 받지 않고 남은 것만 치운다
          state.model = modelTag();
          writeState(l, state);
          await rm(l.hfHome, { recursive: true, force: true }).catch(() => {});
        }
        // 저장 공간 창이 처음 열릴 때 폴더를 다 세기 전에 보일 크기
        state.bytes = await dirBytesAsync(l.root);
        writeState(l, state);
        onProgress(1);
        log('local-draw', 'setup done', `${Math.round((Date.now() - started) / 1000)}s`);
      } catch (err) {
        const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
        // 쓰다 ENOSPC 로 멈췄어도 화면에는 이번에 필요한 만큼을 알린다
        if (e.kind === 'disk' && e.gb === undefined && need > 0) e.gb = GB(need);
        log('local-draw', 'setup', e.kind, e.message.slice(0, 300));
        if (e.kind !== 'cancelled') keepErrorLog(l.root, l.errorLog, 'setup', e);
        throw e;
      }
    },
    log,
  );
}

// ----- 그리기 -----

/** 한 장 그리기. 임시 폴더(local-draw/tmp 안)에 넣을 그림을 쓰고 결과를 읽은 뒤 폴더를 지운다 */
async function drawOnce(
  l: Layout,
  input: Uint8Array,
  inputKind: ImageKind,
  prompt: string,
  pass: 0 | 1,
  o: { signal: AbortSignal; children: Set<ChildProcess>; onProgress: (r: number) => void },
): Promise<{ bytes: Uint8Array; kind: ImageKind }> {
  // 사진 사본을 local-draw 안에 둔다: 앱이 꺼져 남아도 다음 일을 시작할 때 비우고, 지우기 한 번에 사라진다.
  // 경로에 중괄호가 있으면 mflux 의 output.format 이 깨져 시스템 임시 폴더로 (drawTmpBase)
  const base = drawTmpBase(l, os.tmpdir());
  mkdirSync(base, { recursive: true });
  const tmp = mkdtempSync(join(base, 'jj-draw-'));
  try {
    const ext = inputKind === 'jpeg' ? 'jpg' : inputKind;
    const inPath = join(tmp, `in.${ext}`);
    const outPath = join(tmp, 'out.png');
    writeFileSync(inPath, input);
    const size = drawSize(input);
    const seed = Math.floor(Math.random() * 2 ** 31);
    o.onProgress(drawRatio(pass));
    const text = await run(l.python, drawArgs(l, { input: inPath, output: outPath, prompt, ...size, seed }), {
      env: toolEnv(process.env, l, { offline: true }),
      signal: o.signal,
      phase: 'draw',
      timeoutMs: DRAW_TIMEOUT_MS,
      children: o.children,
      l,
      onText: (t) => {
        const f = lastFraction(t);
        if (f && f.total === 4) o.onProgress(drawRatio(pass, f));
      },
    });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(outPath));
    } catch {
      // 0 으로 끝났는데 그림이 없으면 mflux 가 멈춘 것 (배터리 부족 등은 글만 찍고 0 으로 끝난다)
      const kind = classifyFailure(text, { phase: 'draw' });
      throw new LocalDrawError(kind === 'failed' ? 'bad' : kind, `no output: ${tail(text, 300)}`);
    }
    const checked = checkDrawn(bytes, size);
    if (!checked.ok) throw new LocalDrawError('bad', checked.why);
    return { bytes, kind: checked.kind };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 이 컴퓨터에서 그리기 + 털 다듬기. mflux 는 아래, sd.cpp 는 sdcpp.ts illustrateSd.
 * mflux: 이 Mac 에서 그리기 + 털 다듬기 (서버와 같은 순서, hf-illust.ts illustrateFluffy). 털 다듬기가 실패하면 첫 그림.
 * 그만두기와 준비 깨짐만 그대로 실패. 요청문은 기록에 남기지 않는다
 */
export function illustrateLocal(
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
  const pick = localDrawSupport();
  if (!pick.ok) return Promise.reject(new LocalDrawError('unsupported'));
  if (pick.engine === 'sdcpp') return illustrateSd(pick, photo, kind, prompt, o);
  if (!mfluxReady()) return Promise.reject(new LocalDrawError('notReady'));
  return exclusiveMflux(
    o.signal,
    async (ac, children) => {
      const l = L();
      const free = Math.min(freeBytes(drawTmpBase(l, os.tmpdir())), freeBytes(l.root));
      if (free < DRAW_FREE_BYTES) throw new LocalDrawError('disk', `free ${GB(free)}GB`);
      const opt = { signal: ac.signal, children, onProgress: o.onProgress };
      const started = Date.now();
      try {
        const drawn = await drawOnce(l, photo, kind, prompt, 0, opt);
        o.log('local-draw', 'drawn', `${Math.round((Date.now() - started) / 1000)}s`);
        try {
          const fur = await drawOnce(l, drawn.bytes, drawn.kind, FUR_PROMPT, 1, opt);
          o.log('local-draw', 'fur', `${Math.round((Date.now() - started) / 1000)}s`);
          return { ...fur, fur: true, before: drawn };
        } catch (err) {
          if (err instanceof LocalDrawError && (err.kind === 'cancelled' || err.kind === 'notReady'))
            throw err;
          o.log('local-draw', 'fur skipped', err instanceof LocalDrawError ? err.kind : String(err));
          return { ...drawn, fur: false };
        }
      } catch (err) {
        const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
        o.log('local-draw', 'draw', e.kind, e.message.slice(0, 300));
        if (e.kind !== 'cancelled') keepErrorLog(l.root, l.errorLog, 'draw', e);
        throw e;
      }
    },
    o.log,
  );
}
