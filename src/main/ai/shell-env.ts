import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { cmdShimScript } from '../../shared/ai/cmd-shim.ts';
import { readJson, writeJson } from '../store.ts';

// Finder 로 연 앱은 PATH 가 /usr/bin:/bin:/usr/sbin:/sbin 뿐이다(L1). claude 는 ~/.local/bin 에 있고,
// codex 는 `#!/usr/bin/env node` 스크립트라 node 도 찾아야 한다(L14).
// 그래서 로그인 셸의 PATH 와 CODEX_HOME 을 한 번 읽어(약 2초) 저장해 두고 CLI 를 부를 때 쓴다.
// 실행 파일은 부를 때마다 이 PATH 에서 찾는다 (파일 몇 개 확인이라 빠르다). 새로 깔았으면 "다시 확인"이 PATH 를 다시 읽는다.

const CACHE_FILE = 'ai-env';

export interface ShellEnv {
  path: string;
  codexHome?: string;
}

let cached: ShellEnv | undefined;

function isExecutable(file: string | undefined): file is string {
  if (!file) return false;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 로그인 셸에서 PATH 와 CODEX_HOME 을 읽는다. 윈도우는 앱 PATH 가 이미 사용자 PATH 라 그대로 쓴다. */
function readLoginShell(): Promise<{ path: string; codexHome?: string }> {
  if (process.platform === 'win32') {
    return Promise.resolve({ path: process.env.PATH ?? '', codexHome: process.env.CODEX_HOME });
  }
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__JJAKKUNG__';
  // 셸 시작 파일이 무엇을 찍든 표시 뒤의 두 줄만 읽는다.
  const script = `printf '\\n${marker}\\n%s\\n%s\\n' "$PATH" "$CODEX_HOME"`;
  return new Promise((resolve) => {
    execFile(shell, ['-lic', script], { timeout: 10_000, encoding: 'utf8' }, (_err, stdout) => {
      const lines = (stdout ?? '').split('\n');
      const at = lines.lastIndexOf(marker);
      if (at < 0) {
        resolve({ path: process.env.PATH ?? '', codexHome: process.env.CODEX_HOME });
        return;
      }
      resolve({ path: lines[at + 1] || process.env.PATH || '', codexHome: lines[at + 2] || undefined });
    });
  });
}

/** PATH 에서 실행 파일을 찾는다. */
export function findOnPath(name: string, path: string): string | undefined {
  // 윈도우는 진짜 실행 파일(.exe)을 먼저 본다. .cmd 는 launchOf 가 node 로 바꿔 띄운다
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = join(dir, name + ext);
      if (isExecutable(file)) return file;
    }
  }
  return undefined;
}

/**
 * CLI 를 부를 환경. 저장된 값이 아직 유효하면(파일이 있으면) 그대로 쓰고, 아니면 다시 찾는다.
 * refresh 면 저장값을 무시한다 (설정의 "다시 찾기").
 */
export async function getShellEnv(refresh = false): Promise<ShellEnv> {
  if (cached && !refresh) return cached;
  const saved = readJson(CACHE_FILE) as ShellEnv | undefined;
  if (!refresh && saved?.path) {
    cached = { path: saved.path, codexHome: saved.codexHome };
    return cached;
  }
  const login = await readLoginShell();
  const path = [login.path, process.env.PATH].filter(Boolean).join(delimiter);
  cached = { path, codexHome: login.codexHome };
  writeJson(CACHE_FILE, cached);
  return cached;
}

/** AI 실행 파일 위치. 절대 경로면 그대로, 아니면 PATH 에서 찾는다. 못 찾으면 undefined. */
export function resolveBin(bin: string, env: ShellEnv): string | undefined {
  if (isAbsolute(bin)) return isExecutable(bin) ? bin : undefined;
  return findOnPath(bin, env.path);
}

/** 띄울 방법: 실행 파일, 앞에 붙일 인자, 더할 환경 */
export interface Launch {
  file: string;
  pre: string[];
  env: Record<string, string>;
}

/**
 * CLI 를 shell 없이 띄우는 방법. 윈도우의 .cmd, .bat 는 shell 없이 못 띄우고(Node 24 EINVAL), shell 을 켜면
 * 질문 글이 명령 줄에 섞인다. npm 이 만든 배치 파일이면 안의 JS 를 node 로 직접 띄운다. 모르는 배치 파일은 undefined.
 */
export function launchOf(cli: string, env: ShellEnv): Launch | undefined {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(cli)) return { file: cli, pre: [], env: {} };
  let rel: string | undefined;
  try {
    rel = cmdShimScript(readFileSync(cli, 'utf8'));
  } catch {
    return undefined;
  }
  if (!rel) return undefined;
  const script = join(dirname(cli), rel);
  // 배치 파일 옆 node.exe, PATH 의 node, 없으면 Electron 을 node 로
  const beside = join(dirname(cli), 'node.exe');
  const node = isExecutable(beside) ? beside : findOnPath('node', env.path);
  if (node) return { file: node, pre: [script], env: {} };
  return { file: process.execPath, pre: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
