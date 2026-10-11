// 무료 AI 일꾼(llm-worker.ts)이 받아 둔 엔진 폴더를 쓰게 한다. node-llama-cpp 는 엔진을
// import("@node-llama-cpp/<이름>") 으로 찾는데, 설치판에는 그 패키지가 없다(처음 쓸 때 userData 에 받는다,
// llama-bins.ts). 그 이름만 받아 둔 폴더의 dist/index.js 로 돌린다. 판 확인과 라이브러리 읽기는 엔진이 그대로 한다.
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 일꾼에 넘기는 환경 변수 이름 (local.ts 가 채운다) */
export const LLAMA_ENV = { dir: 'JJ_LLAMA_BINS', pkg: 'JJ_LLAMA_PKG' } as const;

type Resolve = Parameters<typeof registerHooks>[0]['resolve'];

/** 이 패키지 이름 하나만 dir 로 돌리는 resolve 걸이. 나머지(cuda 판 등)는 원래대로 찾다 없으면 엔진이 넘어간다 */
export function llamaResolve(dir: string, pkg: string): NonNullable<Resolve> {
  const url = pathToFileURL(join(dir, 'dist', 'index.js')).href;
  return (specifier, context, next) =>
    specifier === `@node-llama-cpp/${pkg}`
      ? { url, format: 'module', shortCircuit: true }
      : next(specifier, context);
}

/** 환경 변수가 있으면 걸이를 건다. 걸었으면 true */
export function pointToDownloadedLlama(env: NodeJS.ProcessEnv = process.env): boolean {
  const dir = env[LLAMA_ENV.dir];
  const pkg = env[LLAMA_ENV.pkg];
  if (!dir || !pkg) return false;
  registerHooks({ resolve: llamaResolve(dir, pkg) });
  return true;
}
