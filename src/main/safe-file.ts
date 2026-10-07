// 사용자 데이터 폴더 안 파일을 읽을 때 쓰는 확인 (버그잡이 7차). Electron 없이 돌아 시험에서 그대로 부른다.
// 백업 가져오기로 pets/ 에 심볼릭 링크가 들어오면 링크를 따라 폴더 밖 파일(~/.ssh 등)을 읽어
// 펫 그림처럼 화면이나 공유 파일로 내보낼 수 있었다.
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
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

/** safeFileIn 을 통과한 파일만 읽는다. 아니면 undefined */
export function readFileIn(dir: string, file: string | undefined): Buffer | undefined {
  const path = safeFileIn(dir, file);
  if (!path) return undefined;
  try {
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
