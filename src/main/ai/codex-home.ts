import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { codexMcpNames } from '../../shared/ai/codex-config.ts';
import { returnCodexAuth } from './codex-auth.ts';
import { codexUserAuth, prepareIsolatedHome } from './codex-isolate.ts';

export { codexUserAuth };

/** 짝꿍 전용 CODEX_HOME */
export const codexHomeDir = () => join(app.getPath('userData'), 'codex-home');

/** 실행이 끝난 뒤: codex 가 짝꿍 쪽 auth.json 에 새 토큰을 썼으면 사용자 쪽에 되돌려 쓴다 */
export function finishCodexHome(userCodexHome: string | undefined): void {
  const auth = codexUserAuth(userCodexHome);
  if (auth) returnCodexAuth(codexHomeDir(), auth);
}

/**
 * codex 를 사용자 설정(스킬, MCP, AGENTS.md) 없이 부르려고 짝꿍 전용 CODEX_HOME 을 쓴다(L5, X6). 항상 폴더를 돌려준다 (codex-isolate.ts)
 */
export function prepareCodexHome(userCodexHome: string | undefined): string {
  return prepareIsolatedHome(codexHomeDir(), userCodexHome);
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
