// codex 로그인 파일(auth.json) 되돌려 놓기 (2026-10-11 점검). Electron 없이 시험한다.
// 짝꿍 전용 CODEX_HOME 의 auth.json 은 사용자 쪽 파일을 가리키는 링크인데, 윈도우처럼 링크를 못 만들면 복사본이다.
// codex 가 토큰을 새로 받아 쓰면(이름 바꾸기로 쓰면 링크도 일반 파일로 바뀐다) 새 토큰은 짝꿍 쪽에만 남고
// 사용자 쪽은 옛 토큰이 되어, 다음 복사가 새 토큰을 옛것으로 덮거나 사용자의 codex 가 로그아웃된다.
// 실행이 끝나면 짝꿍 쪽이 바뀌었고 더 새것이면 사용자 쪽에 되돌려 쓴다.
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../safe-file.ts';

/** 되돌려 썼으면 true */
export function returnCodexAuth(home: string, userAuth: string): boolean {
  const mine = join(home, 'auth.json');
  try {
    const st = lstatSync(mine);
    if (st.isSymbolicLink() || !st.isFile()) return false; // 링크면 codex 가 사용자 파일에 바로 썼다
    const ours = readFileSync(mine);
    let theirs: Buffer | undefined;
    let theirsAt = 0;
    try {
      theirs = readFileSync(userAuth);
      theirsAt = statSync(userAuth).mtimeMs;
    } catch {
      // 사용자 쪽이 없어졌으면(로그아웃) 되살리지 않는다
      return false;
    }
    if (ours.equals(theirs) || st.mtimeMs <= theirsAt) return false;
    // 내용 검사: JSON 이 아니면(쓰다 만 것) 사용자 파일을 덮지 않는다
    JSON.parse(ours.toString('utf8'));
    writeFileAtomic(userAuth, ours, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
