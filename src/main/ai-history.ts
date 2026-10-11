// "AI 기록 지우기" (2026-10-11 개인정보 점검). AI CLI 가 짝꿍 대화를 저장한 짝꿍 전용 폴더만 지운다.
// - claude: 짝꿍은 빈 전용 작업 폴더(<데이터 폴더>/ai-workdir)에서 claude 를 부른다. claude 는 작업 폴더마다
//   <설정 폴더>/projects/<작업 폴더 경로의 글자 아닌 것을 - 로>/ 에 세션을 남긴다. 그 한 폴더만 지운다.
//   사용자의 ~/.claude 의 다른 프로젝트, 설정, 로그인은 건드리지 않는다.
// - codex: 격리 모드에서 쓰는 짝꿍 전용 CODEX_HOME(<데이터 폴더>/codex-home) 안의 기록(sessions 등)을 지운다.
//   로그인 파일 auth.json 은 남긴다. 사용자의 ~/.codex 는 건드리지 않는다 (격리를 끈 대화는 거기 남는다).
// Electron 없이 시험하려고 폴더를 받는다.
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface AiHistoryDirs {
  /** 짝꿍 데이터 폴더 (app.getPath('userData')) */
  userData: string;
  /** 홈 폴더 */
  home: string;
  /** CLAUDE_CONFIG_DIR 을 바꿔 쓰는 사람 */
  claudeConfigDir?: string;
}

/** claude 가 작업 폴더를 프로젝트 폴더 이름으로 바꾸는 규칙: 영문자와 숫자 말고는 모두 - */
export function claudeProjectName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** 짝꿍 AI 작업 폴더 (runner.ts workDir 과 같아야 한다) */
export const aiWorkDir = (userData: string) => join(userData, 'ai-workdir');

/** 지울 곳들. 모두 짝꿍만 쓰는 폴더나 파일이다 */
export function aiHistoryPaths(d: AiHistoryDirs): string[] {
  const out: string[] = [];
  const project = claudeProjectName(aiWorkDir(d.userData));
  const configDirs = [
    ...new Set([d.claudeConfigDir, join(d.home, '.claude')].filter((x): x is string => !!x)),
  ];
  for (const c of configDirs) out.push(join(c, 'projects', project));
  const codexHome = join(d.userData, 'codex-home');
  let names: string[] = [];
  try {
    names = readdirSync(codexHome);
  } catch {
    // 없으면 지울 것도 없다
  }
  for (const n of names) if (n !== 'auth.json') out.push(join(codexHome, n));
  return out;
}

/** 지울 곳이 정말 짝꿍 것인지 한 번 더 본다: claude 는 projects 바로 아래 짝꿍 이름, codex 는 짝꿍 데이터 폴더 안 */
function ours(path: string, d: AiHistoryDirs): boolean {
  if (basename(dirname(path)) === 'projects')
    return basename(path) === claudeProjectName(aiWorkDir(d.userData));
  return dirname(path) === join(d.userData, 'codex-home') && basename(path) !== 'auth.json';
}

function bytesOf(p: string): number {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) return st.isFile() ? st.size : 0;
    let n = 0;
    for (const f of readdirSync(p)) n += bytesOf(join(p, f));
    return n;
  } catch {
    return 0;
  }
}

/** 지금 쌓인 크기 (없으면 0) */
export function aiHistoryBytes(d: AiHistoryDirs): number {
  return aiHistoryPaths(d).reduce((a, p) => a + bytesOf(p), 0);
}

/** 지운다. 지운 곳 수. 링크는 따라가지 않는다 (rmSync 는 링크 자체만 지운다) */
export function clearAiHistory(d: AiHistoryDirs): number {
  let n = 0;
  for (const p of aiHistoryPaths(d)) {
    if (!ours(p, d) || !existsSync(p)) continue;
    try {
      statSync(p);
      rmSync(p, { recursive: true, force: true });
      n++;
    } catch {
      // 잡혀 있으면 다음에
    }
  }
  return n;
}
