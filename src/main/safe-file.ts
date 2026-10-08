// 사용자 데이터 폴더 안 파일을 읽을 때 쓰는 확인 (버그잡이 7차). Electron 없이 돌아 시험에서 그대로 부른다.
// 백업 가져오기로 pets/ 에 심볼릭 링크가 들어오면 링크를 따라 폴더 밖 파일(~/.ssh 등)을 읽어
// 펫 그림처럼 화면이나 공유 파일로 내보낼 수 있었다.
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';

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

/**
 * 같은 폴더의 임시 파일에 다 쓴 다음 이름을 바꾼다. 쓰다가 꺼지거나 디스크가 차도 원래 파일(또는 없음)이 남고
 * 반쯤 쓴 그림, 설계도가 남지 않는다 (rename 은 같은 디스크 안에서 한 번에 바뀐다). 실패하면 임시 파일을 지우고 오류를 던진다.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
