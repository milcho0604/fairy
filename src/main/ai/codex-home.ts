import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { codexMcpNames } from '../../shared/ai/codex-config.ts';
import { returnCodexAuth } from './codex-auth.ts';

/** 사용자 쪽 codex 로그인 파일. 추측하지 않고 CODEX_HOME, ~/.codex 순서로 찾는다 */
export function codexUserAuth(userCodexHome: string | undefined): string | undefined {
  const candidates = [userCodexHome, join(homedir(), '.codex')].filter((d): d is string => !!d);
  return candidates.map((d) => join(d, 'auth.json')).find((f) => existsSync(f));
}

/** 짝꿍 전용 CODEX_HOME */
export const codexHomeDir = () => join(app.getPath('userData'), 'codex-home');

/** 실행이 끝난 뒤: codex 가 짝꿍 쪽 auth.json 에 새 토큰을 썼으면 사용자 쪽에 되돌려 쓴다 */
export function finishCodexHome(userCodexHome: string | undefined): void {
  const auth = codexUserAuth(userCodexHome);
  if (auth) returnCodexAuth(codexHomeDir(), auth);
}

/**
 * codex 를 사용자 설정(스킬, MCP, AGENTS.md) 없이 부르려고 짝꿍 전용 CODEX_HOME 을 쓴다(L5, X6).
 * 로그인 파일 auth.json 만 사용자 쪽을 가리키게 한다. 대화 이어가기 기록은 이 폴더에 남는다.
 * 사용자 쪽 위치는 추측하지 않고 CODEX_HOME, ~/.codex 순서로 찾는다 (이 맥은 Orca 가 CODEX_HOME 을 바꿔 둠).
 */
export function prepareCodexHome(userCodexHome: string | undefined): string | undefined {
  const auth = codexUserAuth(userCodexHome);
  if (!auth) return undefined;

  const home = codexHomeDir();
  mkdirSync(home, { recursive: true });
  const link = join(home, 'auth.json');
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

/**
 * 격리를 껐을 때 codex 가 읽을 사용자 설정(config.toml)에 든 MCP 서버 이름들. 읽기 전용 강제(이슈 #126)가 이번 실행에서 끈다.
 * 설정 파일이 없으면 빈 목록(끌 것이 없다). 파일은 있는데 읽거나 해석하지 못하면 undefined: 부르는 쪽이 사용자 설정을 싣지 않는다
 */
export function readCodexMcpNames(userCodexHome: string | undefined): string[] | undefined {
  const home = userCodexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  let text: string;
  try {
    text = readFileSync(join(home, 'config.toml'), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? [] : undefined;
  }
  return codexMcpNames(text);
}
