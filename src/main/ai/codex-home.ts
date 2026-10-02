import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * codex 를 사용자 설정(스킬, MCP, AGENTS.md) 없이 부르려고 짝꿍 전용 CODEX_HOME 을 쓴다(L5, X6).
 * 로그인 파일 auth.json 만 사용자 쪽을 가리키게 한다. 대화 이어가기 기록은 이 폴더에 남는다.
 * 사용자 쪽 위치는 추측하지 않고 CODEX_HOME, ~/.codex 순서로 찾는다 (이 맥은 Orca 가 CODEX_HOME 을 바꿔 둠).
 */
export function prepareCodexHome(userCodexHome: string | undefined): string | undefined {
  const candidates = [userCodexHome, join(homedir(), '.codex')].filter((d): d is string => !!d);
  const auth = candidates.map((d) => join(d, 'auth.json')).find((f) => existsSync(f));
  if (!auth) return undefined;

  const home = join(app.getPath('userData'), 'codex-home');
  mkdirSync(home, { recursive: true });
  const link = join(home, 'auth.json');
  try {
    if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) rmSync(link, { force: true });
    symlinkSync(auth, link);
  } catch {
    // 윈도우는 심볼릭 링크에 관리자 권한이 필요할 수 있다. 그때는 복사한다(토큰 갱신은 다음 실행 때 다시 복사).
    copyFileSync(auth, link);
  }
  return home;
}
