// 사용자 데이터 폴더 안 파일을 읽을 때 쓰는 확인 (버그잡이 7차). Electron 없이 돌아 시험에서 그대로 부른다.
// 백업 가져오기로 pets/ 에 심볼릭 링크가 들어오면 링크를 따라 폴더 밖 파일(~/.ssh 등)을 읽어
// 펫 그림처럼 화면이나 공유 파일로 내보낼 수 있었다.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

/**
 * dir 바로 안의 일반 파일이면 그 경로, 아니면 undefined. 파일 이름만 받고(경로 금지),
 * 링크나 폴더는 거르고, 실제 위치(realpath)가 dir 안인지 한 번 더 본다.
 */
export function safeFileIn(dir: string, file: string | undefined): string | undefined {
  if (!file || basename(file) !== file || file === '.' || file === '..') return undefined;
  const path = join(dir, file);
  try {
    if (!lstatSync(path).isFile()) return undefined; // lstat 는 링크를 따라가지 않는다
    const root = realpathSync(dir);
    return realpathSync(path).startsWith(root + sep) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** safeFileIn 을 통과한 파일만 읽는다. 아니면 undefined. maxBytes 를 주면 그보다 큰 파일은 읽지 않고 undefined */
export function readFileIn(dir: string, file: string | undefined, maxBytes?: number): Buffer | undefined {
  const path = safeFileIn(dir, file);
  if (!path) return undefined;
  try {
    if (maxBytes !== undefined && statSync(path).size > maxBytes) return undefined;
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** 폴더를 통째로 복사할 때 쓰는 거르개: 일반 파일과 (링크 아닌) 폴더만. cpSync 의 filter 로 준다 */
export function plainEntry(src: string): boolean {
  try {
    const st = lstatSync(src);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 아직 없는 경로: base 가 있으면 base-2, base-3 ... 백업 내보내기와 가져오기 전 복사 폴더가 같은 분에 두 번 생겨도
 * 겹치지 않게 (VACUUM INTO 는 있는 파일에 못 쓴다. 2026-10-07 실제 앱 점검: 같은 분에 두 번 가져오면 실패했다)
 */
export function freePath(base: string): string {
  let out = base;
  for (let i = 2; existsSync(out); i++) out = `${base}-${i}`;
  return out;
}

/** 윈도우에서 백신, 색인기가 대상 파일을 잠깐 잡고 있으면 이름 바꾸기가 이 오류로 실패한다 */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** 다시 해 볼 때마다 기다리는 ms (모두 합쳐 0.2초쯤) */
const RETRY_WAITS = [10, 30, 60, 100];

/** 메인 스레드에서 짧게 기다린다 (동기로 쓰는 저장이라 await 할 수 없다) */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * renameSync 와 같은데, 윈도우에서 EPERM, EBUSY, EACCES 로 실패하면 조금씩 기다리며 몇 번 더 해 본다.
 * 다른 운영체제에서는 이 오류가 잠깐 잡힌 게 아니라 진짜 권한 문제라 바로 던진다.
 */
export function renameRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  platform: NodeJS.Platform = process.platform,
  sleep: (ms: number) => void = sleepSync,
): void {
  for (let i = 0; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      const wait = RETRY_WAITS[i];
      if (platform !== 'win32' || !code || !BUSY_CODES.has(code) || wait === undefined) throw err;
      sleep(wait);
    }
  }
}

/** 폴더 자체를 fsync 해 이름 바꾸기를 디스크에 남긴다. 윈도우는 폴더를 열 수 없어 넘어간다 */
function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return;
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // 폴더 fsync 를 못 하는 파일 시스템도 있다. 파일은 이미 fsync 했다
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * 같은 폴더의 임시 파일에 다 쓰고 fsync 한 다음 이름을 바꾸고 폴더를 fsync 한다. 쓰다가 꺼지거나 디스크가 차도
 * 원래 파일(또는 없음)이 남고 반쯤 쓴 그림, 설계도, 설정이 남지 않는다 (rename 은 같은 디스크 안에서 한 번에 바뀐다.
 * fsync 없이 이름만 바꾸면 전원이 나갈 때 일부 파일 시스템은 빈 파일을 남긴다).
 * mode 를 주면 그 권한으로 (토큰은 0600). 실패하면 임시 파일을 지우고 오류를 던진다.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, opts: { mode?: number } = {}): void {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'w', opts.mode ?? 0o666);
    try {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // umask 가 mode 를 깎거나 이미 있던 파일이 넓은 권한이어도 정확히 그 권한으로
    if (opts.mode !== undefined) chmodSync(tmp, opts.mode);
    renameRetry(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  fsyncDir(dir);
}
