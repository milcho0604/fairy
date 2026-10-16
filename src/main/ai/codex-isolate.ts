// codex 를 짝꿍 전용 CODEX_HOME 으로 격리해 부르는 준비 (Electron 없이 돌아 시험에서 그대로 부른다)
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { returnCodexAuth } from './codex-auth.ts';

/** 사용자 쪽 codex 로그인 파일. 추측하지 않고 CODEX_HOME, ~/.codex 순서로 찾는다 */
export function codexUserAuth(
  userCodexHome: string | undefined,
  fallbackHome = join(homedir(), '.codex'),
): string | undefined {
  const candidates = [userCodexHome, fallbackHome].filter((d): d is string => !!d);
  return candidates.map((d) => join(d, 'auth.json')).find((f) => existsSync(f));
}

/**
 * 로그인 파일 auth.json 만 사용자 쪽을 가리키게 한 격리 폴더 home 을 만들어 돌려준다. 대화 이어가기 기록은 이 폴더에 남는다.
 * 사용자 쪽 위치는 추측하지 않고 CODEX_HOME, ~/.codex 순서로 찾는다 (이 맥은 Orca 가 CODEX_HOME 을 바꿔 둠).
 *
 * 로그인 파일이 없어도(API 키 환경 변수, 키체인 로그인) 빈 격리 폴더를 쓴다. 폴더를 못 만들어 사용자 폴더 그대로 부르면
 * 사용자 MCP 서버가 켜진 채 승인 없이 돈다 (읽기 전용 강제, 이슈 #126). 환경 변수 키는 그대로 통하고, 키체인 로그인은
 * 폴더가 달라 못 찾아 "로그인이 필요해"로 끝난다 (열린 채 실패하는 것보다 낫다). 폴더를 못 만들면 던져서 질문을 보내지 않는다
 */
export function prepareIsolatedHome(
  home: string,
  userCodexHome: string | undefined,
  fallbackHome?: string,
): string {
  const auth = codexUserAuth(userCodexHome, fallbackHome);
  mkdirSync(home, { recursive: true });
  const link = join(home, 'auth.json');
  if (!auth) {
    rmSync(link, { force: true });
    return home;
  }
  // 지난 실행에서 codex 가 짝꿍 쪽에 새 토큰을 썼으면 덮기 전에 사용자 쪽으로 돌려 둔다 (codex-auth.ts)
  returnCodexAuth(home, auth);
  try {
    if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) rmSync(link, { force: true });
    symlinkSync(auth, link);
  } catch {
    // 윈도우는 심볼릭 링크에 관리자 권한이 필요할 수 있다. 그때는 복사한다. codex 가 복사본에서 토큰을 새로 받으면
    // 실행이 끝날 때(finishCodexHome)와 다음 실행 전에 사용자 쪽으로 되돌려 쓴다
    copyFileSync(auth, link);
  }
  return home;
}
