// 내 컴퓨터에서 그리기 엔진(mflux, sd.cpp)이 같이 쓰는 자식 프로세스와 폴더 도우미.
// 자식은 셸 없이 인자 배열로 띄운다 (요청문, 빈칸 있는 경로를 그대로). 맥은 자식마다 제 프로세스 묶음을 주고
// 그만두면 묶음째 끈다. 윈도우는 묶음이 없어 taskkill /T 로 자손까지 끈다. 앱이 갑자기 꺼져 남은 자식은
// run.pid 로 다음에 찾아 끈다. 한 번에 일 하나만 (두 엔진을 합쳐서도: 메모리와 디스크가 모자라다)
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { failReason } from '../shared/download-error.ts';
import {
  classifyFailure,
  LocalDrawError,
  type LocalDrawErrorKind,
  orphanGroupAlive,
  parseRunPid,
  tail,
} from './local-draw-core.ts';
import { writeFileAtomic } from './safe-file.ts';
import { killTreeArgs, tasklistArgs, tasklistHas, winTaskkill, winTasklist } from './sdcpp-core.ts';

export type Log = (tag: string, ...rest: unknown[]) => void;

/** run.pid 자리와 그 엔진 폴더 (명령 줄에 이 폴더 경로가 있어야 우리 자식으로 본다) */
export interface RunPidRef {
  path: string;
  root: string;
}

const isWin = process.platform === 'win32';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 묶음(pgid)에 신호. 묶음이 없으면 false (맥) */
function signalGroup(pgid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, sig);
    return true;
  } catch {
    return false;
  }
}

/** 윈도우: 프로세스와 자손을 끝까지 끈다. 이미 끝났으면 taskkill 이 실패하고 그만 */
function taskkill(pid: number, wait = false) {
  const cmd = winTaskkill(process.env.SystemRoot);
  if (wait) {
    try {
      execFileSync(cmd, killTreeArgs(pid), { windowsHide: true, timeout: 3000, stdio: 'ignore' });
    } catch {
      // 이미 끝남
    }
    return;
  }
  execFile(cmd, killTreeArgs(pid), { windowsHide: true, timeout: 5000 }, () => {});
}

/**
 * 자식(과 자손)을 끈다. 맥: 묶음에 TERM, 3초 뒤에도 남았으면 KILL. pid 하나씩이 아니라 묶음이라 그새 다른
 * 프로그램이 받은 pid 를 죽이지 않는다. 윈도우: taskkill /T /F
 */
export function killTree(pid: number | undefined) {
  if (!pid) return;
  if (isWin) {
    taskkill(pid);
    return;
  }
  if (!signalGroup(pid, 'SIGTERM')) return;
  setTimeout(() => {
    if (signalGroup(pid, 0)) signalGroup(pid, 'SIGKILL');
  }, 3000).unref();
}

/** 앱을 끌 때: 기다리지 않고 바로 (끄는 앱은 3초 뒤 KILL 을 보낼 수 없다) */
function killTreeNow(pid: number | undefined) {
  if (!pid) return;
  if (isWin) {
    taskkill(pid, true);
    return;
  }
  signalGroup(pid, 'SIGTERM');
  signalGroup(pid, 'SIGKILL');
}

/** 지금 도는 자식을 run.pid 에 적는다. 적기가 실패해도 일은 한다 (다음 정리만 못 할 뿐) */
function writeRunPid(ref: RunPidRef, pid: number) {
  try {
    writeFileAtomic(ref.path, JSON.stringify({ pid, root: ref.root, startedAt: Date.now() }));
  } catch {
    // 그만
  }
}

function clearRunPid(ref: RunPidRef) {
  try {
    rmSync(ref.path, { force: true });
  } catch {
    // 그만
  }
}

/** 남은 자식이 우리 것인지: 맥은 묶음에 엔진 폴더 경로가 든 명령이 남았는지, 윈도우는 그 pid 가 sd-cli.exe 인지 */
function orphanAlive(pid: number, root: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (isWin)
      execFile(
        winTasklist(process.env.SystemRoot),
        tasklistArgs(pid),
        { timeout: 5000, windowsHide: true },
        (err, out) => resolve(!err && tasklistHas(String(out), pid)),
      );
    else
      execFile(
        '/bin/ps',
        ['-A', '-o', 'pgid=,command='],
        { timeout: 3000, maxBuffer: 16 * 1024 * 1024 },
        (err, out) => resolve(!err && orphanGroupAlive(String(out), pid, root)),
      );
  });
}

/**
 * 앞서 앱이 갑자기 꺼져 남은 자식을 끈다 (둘이 같이 같은 파일에 쓰지 않게). run.pid 의 자식이 우리 것으로
 * 보일 때만 (pid 가 다른 프로그램에 다시 쓰였으면 건드리지 않는다)
 */
export async function killOrphan(ref: RunPidRef, log?: Log): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(ref.path, 'utf8');
  } catch {
    return;
  }
  const rec = parseRunPid(raw);
  if (rec && rec.root === ref.root && (await orphanAlive(rec.pid, ref.root))) {
    log?.('local-draw', 'orphan', rec.pid);
    if (isWin) taskkill(rec.pid, true);
    else {
      const pgid = rec.pid;
      signalGroup(pgid, 'SIGTERM');
      // TERM 을 받고 끝날 틈을 3초 준다. 그래도 남으면 KILL
      for (let i = 0; i < 6 && signalGroup(pgid, 0); i++) await sleep(500);
      if (signalGroup(pgid, 0)) {
        signalGroup(pgid, 'SIGKILL');
        await sleep(300);
      }
    }
  }
  clearRunPid(ref);
}

export type Classify = (
  log: string,
  o: {
    aborted: boolean;
    timedOut: boolean;
    signal: string | null;
    spawnCode?: string;
    exitCode: number | null;
    phase: 'setup' | 'draw';
  },
) => LocalDrawErrorKind;

/**
 * 명령 하나를 돌린다. 나온 글(stdout+stderr 끝 64KB)을 onText 로 알리고, 실패하면 종류를 고른 LocalDrawError.
 * 끝나면 그 글을 돌려준다
 */
export function run(
  cmd: string,
  args: string[],
  o: {
    env: Record<string, string>;
    signal: AbortSignal;
    phase: 'setup' | 'draw';
    timeoutMs?: number;
    onText?: (text: string) => void;
    children: Set<ChildProcess>;
    /** 띄운 자식을 적을 run.pid 자리 */
    runPid: RunPidRef;
    classify?: Classify;
    cwd?: string;
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
    // 맥 detached: 자식이 제 프로세스 묶음의 대장이 된다. 멈출 때 묶음째 끄고(자손까지), 앱 묶음은 건드리지 않는다.
    // 윈도우 detached 는 새 콘솔 창이 떠서 쓰지 않고 창도 숨긴다
    const child = spawn(cmd, args, {
      env: o.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWin,
      windowsHide: true,
      ...(o.cwd ? { cwd: o.cwd } : {}),
    });
    o.children.add(child);
    if (child.pid) writeRunPid(o.runPid, child.pid);
    const onAbort = () => killTree(child.pid);
    o.signal.addEventListener('abort', onAbort, { once: true });
    const timer = o.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
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
      if (child.pid) clearRunPid(o.runPid);
      if (timer) clearTimeout(timer);
      o.signal.removeEventListener('abort', onAbort);
      if (code === 0 && !o.signal.aborted && !timedOut) {
        resolve(text);
        return;
      }
      const kind = (o.classify ?? classifyFailure)(text, {
        aborted: o.signal.aborted,
        timedOut,
        signal,
        spawnCode,
        exitCode: code,
        phase: o.phase,
      });
      // 끝 코드도 붙인다 (윈도우가 죽였다는 0xC0000005 같은 값으로 그래픽 드라이버 탓인지 본다, sdcpp.ts)
      reject(
        Object.assign(
          new LocalDrawError(kind, `${cmd.split(/[\\/]/).pop()} exit ${code ?? signal}: ${tail(text, 300)}`),
          { exitCode: code },
        ),
      );
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

// ----- 한 번에 하나 -----

/** 지금 하는 일 하나 (준비 또는 그리기, 두 엔진을 합쳐서) */
let job:
  | { ac: AbortController; children: Set<ChildProcess>; done: Promise<void>; runPid: RunPidRef }
  | undefined;

/** 앱을 켤 때 하는 정리. 도는 동안 새 일은 기다린다 (정리가 새 일의 run.pid, 임시 그림을 지우지 않게) */
let sweeping: Promise<void> | undefined;

export const jobBusy = () => !!job;
export const sweepBusy = () => !!sweeping;
export async function sweepDone(): Promise<void> {
  if (sweeping) await sweeping;
}

/** 앱을 켤 때 정리를 하나로 돌린다 (끝나면 비운다) */
export function trackSweep(work: Promise<void>, log?: Log) {
  sweeping = work
    .catch((err) => log?.('local-draw', 'sweep', err instanceof Error ? err.message : String(err)))
    .finally(() => {
      sweeping = undefined;
    });
}

/**
 * 한 번에 하나만. 하는 동안 job 에 두고 끝나면 비운다. 시작할 때 앞서 앱이 꺼져 남은 자식을 끄고
 * 남은 임시 그림을 비운다 (o.tmp), 끝나면 o.after (폴더 크기 다시 세기)
 */
export async function exclusive<T>(
  signal: AbortSignal,
  o: { runPid: RunPidRef; tmp: string; after?: () => void },
  work: (ac: AbortController, kids: Set<ChildProcess>) => Promise<T>,
  log?: Log,
) {
  await sweepDone();
  // 앞 일을 막 멈췄으면(다시 그리기, 창 다시 열기) 자식이 끝날 때까지 기다린다. 아직 도는 일이면 busy
  const prev = job;
  if (prev?.ac.signal.aborted) await Promise.race([prev.done, sleep(8000)]);
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
  job = { ac, children, done, runPid: o.runPid };
  try {
    await killOrphan(o.runPid, log);
    rmSync(o.tmp, { recursive: true, force: true });
    return await work(ac, children);
  } finally {
    signal.removeEventListener('abort', onAbort);
    clearRunPid(o.runPid);
    job = undefined;
    o.after?.();
    finish();
  }
}

/** 하는 일을 멈추고 자식이 다 끝날 때까지 기다린다 (지우기 전에) */
export async function stopJob(): Promise<void> {
  const j = job;
  if (!j) return;
  j.ac.abort();
  for (const c of j.children) killTree(c.pid);
  // 자식이 TERM 을 무시해도 3초 뒤 KILL 이 간다. 그래도 안 끝나면 더 기다리지 않는다
  await Promise.race([j.done, sleep(8000)]);
}

/**
 * 이 엔진 폴더(root)의 일일 때만 멈추고 기다린다 (지우기 전에). 다른 엔진의 일은 건드리지 않는다:
 * sd.cpp 폴더를 지운다고 mflux 로 그리던 것이 멈추면 안 된다 (Apple 칩 Mac 은 둘 다 있을 수 있다)
 */
export async function stopJobFor(root: string): Promise<void> {
  if (job?.runPid.root === root) await stopJob();
}

/** 이 엔진 폴더(root)를 쓰는 일이 아직 도는지 */
export const jobBusyFor = (root: string) => job?.runPid.root === root;

/** 앱을 끌 때: 기다리지 않고 자식을 끈다 */
export function stopJobNow() {
  const j = job;
  if (!j) return;
  j.ac.abort();
  for (const c of j.children) killTreeNow(c.pid);
  clearRunPid(j.runPid);
}

// ----- 크기와 빈 공간 -----

/** 폴더 크기 (링크는 따라가지 않는다). 파일이 수만 개라 비동기로 */
export async function dirBytesAsync(dir: string): Promise<number> {
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

/**
 * 저장 공간에 보일 폴더 크기. 폴더를 세지 않고 마지막으로 센 값을 돌려준다 (없으면 fallback: 준비 끝에
 * state.json 에 적은 크기). 30초가 지났으면 뒤에서 다시 센다 (파일이 수만 개라 메인을 막지 않게)
 */
export class FolderSize {
  private cache: { at: number; bytes: number } | undefined;
  /** 센 결과가 이 번호일 때만 기억한다 (세는 사이 지우기, 준비가 끝났으면 앞 결과는 버린다) */
  private gen = 0;
  private counting = false;
  private readonly dir: () => string;
  private readonly fallback: () => number;
  constructor(dir: () => string, fallback: () => number) {
    this.dir = dir;
    this.fallback = fallback;
  }

  refresh() {
    const gen = ++this.gen;
    this.counting = true;
    void dirBytesAsync(this.dir()).then((bytes) => {
      if (gen !== this.gen) return;
      this.cache = { at: Date.now(), bytes };
      this.counting = false;
    });
  }

  bytes(exists: boolean): number {
    if (!exists) return 0;
    if ((!this.cache || Date.now() - this.cache.at > 30_000) && !this.counting) this.refresh();
    return this.cache?.bytes ?? this.fallback();
  }

  /** 지운 뒤: 세던 것은 버린다 (폴더가 없으니 크기는 0) */
  reset() {
    this.gen++;
    this.counting = false;
    this.cache = undefined;
  }
}

/** 비어 있는 공간 (모르면 Infinity: 막지 않고 쓰다 실패하면 disk 로 알린다) */
export function freeBytes(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export const GB = (n: number) => Math.ceil(n / 1e9);

/** 지운 폴더(옮겨 둔 것, <name>.trash-<시각>)를 치운다. 지우는 데 몇 초 걸려 뒤에서 */
export function sweepTrash(name: string) {
  const parent = app.getPath('userData');
  let names: string[] = [];
  const re = new RegExp(`^${name.replace(/[-.]/g, '\\$&')}\\.trash-\\d+$`);
  try {
    names = readdirSync(parent).filter((n) => re.test(n));
  } catch {
    return;
  }
  for (const n of names) void rm(join(parent, n), { recursive: true, force: true }).catch(() => {});
}

/** 폴더를 옆 이름으로 옮긴다 (지우기 전에, 창이 멈추지 않게). 실패하면 false */
export function moveToTrash(root: string, log?: Log): boolean {
  try {
    renameSync(root, `${root}.trash-${Date.now()}`);
    return true;
  } catch (err) {
    log?.('local-draw', 'remove failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** 실패 글을 폴더에 남긴다 (사용자가 보내 줄 수 있게). 남기기가 실패해도 그만 */
export function keepErrorLog(root: string, errorLog: string, what: string, err: unknown) {
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      errorLog,
      `${new Date().toISOString()} ${what}\n${err instanceof Error ? err.message : String(err)}\n`,
    );
  } catch {
    // 그만
  }
}

/** 받기 실패(Electron net)를 종류로 */
export function downloadKind(err: unknown, aborted: boolean): LocalDrawError {
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
