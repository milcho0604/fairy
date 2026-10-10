// 내 Mac에서 그리기 (AI 일러스트 로컬 엔진, 2026-10-10): 설치, 그리기, 멈추기, 지우기. 순수 계산은 local-draw-core.ts.
// 사진은 이 Mac 밖으로 나가지 않는다. 인터넷은 처음 준비할 때 도구(uv, 파이썬, mflux)와 모델을 받을 때만 쓴다.
// 자식 프로세스는 셸 없이 인자 배열로 띄운다 (요청문, 빈칸 있는 경로를 그대로). 그만두면 자손까지 끈다
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { failReason } from '../shared/download-error.ts';
import { type LocalDrawInfo, setupRatio } from '../shared/local-draw.ts';
import { ensureVerified, forgetVerified } from './download.ts';
import { FUR_PROMPT, type ImageKind } from './hf-illust.ts';
import {
  checkDrawn,
  classifyFailure,
  DRAW_FREE_BYTES,
  DRAW_TIMEOUT_MS,
  descendants,
  drawArgs,
  drawRatio,
  drawSize,
  installArgs,
  installRatio,
  isSetupDone,
  type Layout,
  LocalDrawError,
  lastFraction,
  layout,
  localDrawEligibility,
  MODEL_DOWNLOAD_BYTES,
  mfluxTag,
  modelTag,
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
import { writeFileAtomic } from './safe-file.ts';

type Log = (tag: string, ...rest: unknown[]) => void;

const rootDir = () => join(app.getPath('userData'), 'local-draw');
const L = () => layout(rootDir());

/** 이 컴퓨터에서 돌릴 수 있는지 (macOS, Apple 칩, macOS 14+, 메모리 8GB+) */
export function localDrawSupport() {
  return localDrawEligibility({
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? '',
    totalMem: os.totalmem(),
    osRelease: os.release(),
  });
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

/** 준비가 다 됐는지: 기록이 지금 고정한 판과 같고 실제 파일도 있다 (누가 폴더 안을 지웠을 수 있다) */
export function localDrawReady(): boolean {
  const l = L();
  return isSetupDone(readState(l)) && existsSync(l.python) && existsSync(l.generate) && existsSync(l.model);
}

export function localDrawInfo(): LocalDrawInfo {
  const supported = localDrawSupport().ok;
  return { supported, ready: supported && localDrawReady() };
}

// ----- 자식 프로세스 -----

/** 지금 하는 일 하나 (준비 또는 그리기). 둘이 같이 돌면 메모리와 디스크가 모자라 하나만 */
let job: { ac: AbortController; children: Set<ChildProcess>; done: Promise<void> } | undefined;

/** 자식과 그 자손을 끈다. 먼저 TERM, 3초 뒤에도 살아 있으면 KILL */
function killTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  const send = (pids: number[], sig: NodeJS.Signals) => {
    for (const p of pids) {
      try {
        process.kill(p, sig);
      } catch {
        // 이미 끝남
      }
    }
  };
  execFile('/bin/ps', ['-A', '-o', 'pid=,ppid='], { timeout: 3000 }, (err, out) => {
    const all = [...(err ? [] : descendants(String(out), pid)).reverse(), pid];
    send(all, 'SIGTERM');
    setTimeout(() => send(all, 'SIGKILL'), 3000).unref();
  });
}

/**
 * 명령 하나를 돌린다. 나온 글(stdout+stderr 끝 64KB)을 onText 로 알리고, 실패하면 종류를 고른 LocalDrawError.
 * 끝나면 그 글을 돌려준다
 */
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
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (o.signal.aborted) {
      reject(new LocalDrawError('cancelled'));
      return;
    }
    let text = '';
    let timedOut = false;
    let spawnCode: string | undefined;
    // detached 를 쓰지 않는다: 앱이 갑자기 꺼지면 같은 묶음이라 같이 정리되기 쉽고, 멈출 때는 자손을 찾아 끈다
    const child = spawn(cmd, args, { env: o.env, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    o.children.add(child);
    const onAbort = () => killTree(child);
    o.signal.addEventListener('abort', onAbort, { once: true });
    const timer = o.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, o.timeoutMs)
      : undefined;
    const take = (chunk: Buffer) => {
      text = (text + chunk.toString('utf8')).slice(-64 * 1024);
      o.onText?.(text);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      o.children.delete(child);
      if (timer) clearTimeout(timer);
      o.signal.removeEventListener('abort', onAbort);
      if (code === 0 && !o.signal.aborted && !timedOut) {
        resolve(text);
        return;
      }
      const kind = classifyFailure(text, {
        aborted: o.signal.aborted,
        timedOut,
        signal,
        spawnCode,
        phase: o.phase,
      });
      reject(new LocalDrawError(kind, `${cmd.split('/').pop()} exit ${code ?? signal}: ${tail(text, 300)}`));
    };
    let settled = false;
    const once = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      finish(code, signal);
    };
    child.on('error', (err) => {
      spawnCode = (err as NodeJS.ErrnoException).code ?? 'spawn';
      text += `\n${err.message}`;
      // 띄우지도 못했으면(ENOENT 등) close 가 안 올 수 있어 여기서 끝낸다
      if (child.pid === undefined) once(null, null);
    });
    child.on('close', once);
  });
}

/** 한 번에 하나만. 하는 동안 job 에 두고 끝나면 비운다 */
async function exclusive<T>(
  signal: AbortSignal,
  work: (ac: AbortController, kids: Set<ChildProcess>) => Promise<T>,
) {
  // 앞 일을 막 멈췄으면(다시 그리기, 창 다시 열기) 자식이 끝날 때까지 기다린다. 아직 도는 일이면 busy
  const prev = job;
  if (prev?.ac.signal.aborted) await Promise.race([prev.done, new Promise((r) => setTimeout(r, 8000))]);
  if (job) throw new LocalDrawError('busy');
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal.aborted) ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const children = new Set<ChildProcess>();
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => {
    finish = r;
  });
  job = { ac, children, done };
  try {
    return await work(ac, children);
  } finally {
    signal.removeEventListener('abort', onAbort);
    job = undefined;
    sizeCache = undefined;
    finish();
  }
}

/** 하는 일을 멈추고 자식이 다 끝날 때까지 기다린다 (지우기 전에) */
export async function stopLocalDraw(): Promise<void> {
  const j = job;
  if (!j) return;
  j.ac.abort();
  for (const c of j.children) killTree(c);
  // 자식이 TERM 을 무시해도 3초 뒤 KILL 이 간다. 그래도 안 끝나면 더 기다리지 않는다
  await Promise.race([j.done, new Promise((r) => setTimeout(r, 8000))]);
}

/** 앱을 끌 때: 기다리지 않고 끈다 */
export function stopLocalDrawNow() {
  const j = job;
  if (!j) return;
  j.ac.abort();
  for (const c of j.children) {
    try {
      c.kill('SIGTERM');
    } catch {
      // 이미 끝남
    }
  }
}

export const localDrawBusy = () => !!job;

// ----- 크기와 빈 공간 -----

/** 폴더 크기 (링크는 따라가지 않는다). 파일이 수만 개라 비동기로 */
async function dirBytesAsync(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirBytesAsync(p);
    else
      try {
        total += (await lstat(p)).size;
      } catch {
        // 그새 지워짐
      }
  }
  return total;
}

function dirBytesSync(dir: string): number {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirBytesSync(p);
    else
      try {
        total += lstatSync(p).size;
      } catch {
        // 그새 지워짐
      }
  }
  return total;
}

let sizeCache: { at: number; bytes: number } | undefined;

/**
 * 저장 공간에 보일 크기. 파이썬과 torch 로 파일이 수만 개라 30초 동안 기억한다 (설정 창을 열 때마다 다 세지 않게).
 * 준비, 지우기가 끝나면 다시 센다
 */
export function localDrawBytes(): number {
  const root = rootDir();
  if (!existsSync(root)) return 0;
  if (sizeCache && Date.now() - sizeCache.at < 30_000) return sizeCache.bytes;
  const bytes = dirBytesSync(root);
  sizeCache = { at: Date.now(), bytes };
  return bytes;
}

/** 비어 있는 공간 (모르면 Infinity: 막지 않고 쓰다 실패하면 disk 로 알린다) */
function freeBytes(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const GB = (n: number) => Math.ceil(n / 1e9);

/** 지운 폴더(옮겨 둔 것)를 치운다. 지우는 데 몇 초 걸려 뒤에서 */
function sweepTrash() {
  const parent = app.getPath('userData');
  let names: string[] = [];
  try {
    names = readdirSync(parent).filter((n) => /^local-draw\.trash-\d+$/.test(n));
  } catch {
    return;
  }
  for (const n of names) void rm(join(parent, n), { recursive: true, force: true }).catch(() => {});
}

/**
 * 저장 공간에서 지우기. 하는 일이 있으면 먼저 멈추고(자식이 끝날 때까지) 폴더를 옆 이름으로 옮긴 뒤 뒤에서 지운다
 * (파일이 수만 개라 지우는 동안 창이 멈추지 않게)
 */
export async function removeLocalDraw(log?: Log): Promise<boolean> {
  await stopLocalDraw();
  if (job) return false;
  const root = rootDir();
  if (!existsSync(root)) return true;
  try {
    renameSync(root, `${root}.trash-${Date.now()}`);
  } catch (err) {
    log?.('local-draw', 'remove failed', err instanceof Error ? err.message : String(err));
    return false;
  }
  forgetVerified(L().uvTarball);
  sizeCache = undefined;
  sweepTrash();
  log?.('local-draw', 'removed');
  return true;
}

// ----- 준비 -----

/** 실패 글을 폴더에 남긴다 (사용자가 보내 줄 수 있게). 남기기가 실패해도 그만 */
function keepErrorLog(l: Layout, what: string, err: unknown) {
  try {
    mkdirSync(l.root, { recursive: true });
    writeFileSync(
      l.errorLog,
      `${new Date().toISOString()} ${what}\n${err instanceof Error ? err.message : String(err)}\n`,
    );
  } catch {
    // 그만
  }
}

/** uv 받기 실패(Electron net)를 종류로 */
function downloadKind(err: unknown, aborted: boolean): LocalDrawError {
  const r = failReason(err, aborted);
  const kind =
    r === 'cancelled'
      ? 'cancelled'
      : r === 'disk-full'
        ? 'disk'
        : r === 'offline' || r === 'network' || r === 'server'
          ? 'offline'
          : 'failed';
  return new LocalDrawError(kind, err instanceof Error ? err.message : String(err));
}

/**
 * 처음 한 번 준비: uv 받기(해시 확인) → mflux 설치 → 모델 받아 4비트로 저장. 단계마다 state.json 에 적어
 * 멈추거나 꺼져도 다음에 다 된 단계는 건너뛴다 (원본 받기도 Hugging Face 가 이어 받는다). 진행률은 0~1
 */
export function setupLocalDraw(
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
  log: Log,
): Promise<void> {
  if (!localDrawSupport().ok) return Promise.reject(new LocalDrawError('unsupported'));
  return exclusive(signal, async (ac, children) => {
    const l = L();
    mkdirSync(l.root, { recursive: true });
    sweepTrash();
    const state = readState(l);
    const todo = stepsToRun(state);
    const started = Date.now();
    log('local-draw', 'setup', JSON.stringify(todo));
    try {
      if (todo.uv || todo.mflux || todo.model) {
        const need = setupSpaceNeeded(await dirBytesAsync(l.root));
        const free = freeBytes(l.root);
        if (free < need) throw new LocalDrawError('disk', `free ${GB(free)}GB < ${GB(need)}GB`);
      }
      const env = toolEnv(process.env, l);
      const common = { env, signal: ac.signal, phase: 'setup' as const, children };

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
        // 원본(15GB 쯤)은 줄인 모델을 저장했으니 지운다
        await rm(l.hfHome, { recursive: true, force: true }).catch(() => {});
        state.model = modelTag();
        writeState(l, state);
      }
      onProgress(1);
      log('local-draw', 'setup done', `${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
      log('local-draw', 'setup', e.kind, e.message.slice(0, 300));
      if (e.kind !== 'cancelled') keepErrorLog(l, 'setup', e);
      throw e;
    }
  });
}

// ----- 그리기 -----

/** 한 장 그리기. 임시 폴더에 넣을 그림을 쓰고 결과를 읽은 뒤 폴더를 지운다 */
async function drawOnce(
  l: Layout,
  input: Uint8Array,
  inputKind: ImageKind,
  prompt: string,
  pass: 0 | 1,
  o: { signal: AbortSignal; children: Set<ChildProcess>; onProgress: (r: number) => void },
): Promise<{ bytes: Uint8Array; kind: ImageKind }> {
  // os.tmpdir() 는 /var/folders/.../T: 중괄호가 없어 mflux 의 output.format 이 깨지지 않는다
  const tmp = mkdtempSync(join(os.tmpdir(), 'jj-draw-'));
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
 * 이 Mac 에서 그리기 + 털 다듬기 (서버와 같은 순서, hf-illust.ts illustrateFluffy). 털 다듬기가 실패하면 첫 그림.
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
  if (!localDrawSupport().ok) return Promise.reject(new LocalDrawError('unsupported'));
  if (!localDrawReady()) return Promise.reject(new LocalDrawError('notReady'));
  return exclusive(o.signal, async (ac, children) => {
    const l = L();
    const free = Math.min(freeBytes(os.tmpdir()), freeBytes(l.root));
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
        if (err instanceof LocalDrawError && (err.kind === 'cancelled' || err.kind === 'notReady')) throw err;
        o.log('local-draw', 'fur skipped', err instanceof LocalDrawError ? err.kind : String(err));
        return { ...drawn, fur: false };
      }
    } catch (err) {
      const e = err instanceof LocalDrawError ? err : new LocalDrawError('failed', String(err));
      o.log('local-draw', 'draw', e.kind, e.message.slice(0, 300));
      if (e.kind !== 'cancelled') keepErrorLog(l, 'draw', e);
      throw e;
    }
  });
}
