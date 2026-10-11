// 무료 AI 엔진(llama.cpp, node-llama-cpp 의 운영체제별 패키지 @node-llama-cpp/<이름>)을 설치 파일에 넣지 않고
// 처음 무료 AI 모델을 받을 때 같이 받는다 (설치 파일을 줄이려고, 2026-10-11). 받는 것은 npm 에 올라간 원본 묶음(.tgz)
// 그대로라 해시를 박아 둔다. 판은 node-llama-cpp 와 꼭 같아야 한다(다르면 엔진이 그 패키지를 쓰지 않는다):
// node-llama-cpp 판을 올리면 `node scripts/llama-bins-pin.mjs` 를 돌려 아래 값을 바꾼다 (llama-bins.test.ts 가 판을 맞춘다).
// 받는 곳과 푸는 곳은 src/main/llama-bins.ts, 일꾼이 그 폴더를 쓰게 하는 건 src/main/llama-hook.ts
import { unusedCpuVariant } from './native-prune.ts';

/** 운영체제-칩 → 패키지 이름. 릴리스로 내는 넷만 (GPU 판 cuda, vulkan 은 원래부터 넣지 않았다) */
export const LLAMA_PACKAGES = {
  'darwin-arm64': 'mac-arm64-metal',
  'darwin-x64': 'mac-x64',
  'linux-x64': 'linux-x64',
  'win32-x64': 'win-x64',
} as const;

export type LlamaPackage = (typeof LLAMA_PACKAGES)[keyof typeof LLAMA_PACKAGES];

/** npm 묶음(.tgz)의 해시와 크기 (scripts/llama-bins-pin.mjs 가 뽑는다) */
export const LLAMA_BINS: {
  version: string;
  packages: Record<LlamaPackage, { sha256: string; bytes: number }>;
} = {
  version: '3.22.1',
  packages: {
    'mac-arm64-metal': {
      sha256: '6315f36a1af49e83a7535cdccffe2e633b70119e3ab96871853849efc9be9a93',
      bytes: 4_943_227,
    },
    'mac-x64': {
      sha256: '9c605b9af56ac12dbd339f678c763083cd255780381cbbb65b94c233a9c25b2f',
      bytes: 10_972_557,
    },
    'linux-x64': {
      sha256: '0d953e1503d5ab4608d8ed5b739132308c81ac05ffeb760d2a7f30e08a9f90e0',
      bytes: 10_824_547,
    },
    'win-x64': {
      sha256: '5bfd40b2088b5df8a2954a44480e257fde580d3f5fe6ea910a1e205bf8ca2715',
      bytes: 10_740_573,
    },
  },
};

export function llamaPackageFor(platform: string, arch: string): LlamaPackage | undefined {
  return (LLAMA_PACKAGES as Record<string, LlamaPackage>)[`${platform}-${arch}`];
}

/** 받을 주소. npm 저장소가 먼저, 막히면 같은 묶음을 그대로 옮겨 둔 npmmirror (해시를 맞추니 다른 파일은 못 들어온다) */
export function llamaTarballUrls(pkg: LlamaPackage, version = LLAMA_BINS.version): string[] {
  return [
    `https://registry.npmjs.org/@node-llama-cpp/${pkg}/-/${pkg}-${version}.tgz`,
    `https://registry.npmmirror.com/@node-llama-cpp/${pkg}/-/${pkg}-${version}.tgz`,
  ];
}

/** 파일 이름으로 쓸 수 있는 것만 (경로 조각, 숨김 파일, 이상한 글자 없이) */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * 묶음 안 이름(package/...) → 풀 자리(패키지 폴더 기준). 엔진이 쓰는 것만 푼다: package.json(판 확인),
 * dist/index.js(폴더 알려 주기), LICENSE, bins/<패키지>/ 의 라이브러리. 설치판에서 빼던 CPU 판
 * (native-prune.ts UNUSED_CPU_VARIANTS)과 윈도우 링크용 .lib 는 뺀다. 그 밖과 수상한 이름은 undefined
 */
export function llamaEntryTarget(name: string, pkg: LlamaPackage): string | undefined {
  if (!name.startsWith('package/')) return undefined;
  const rel = name.slice('package/'.length);
  if (rel === 'package.json' || rel === 'dist/index.js' || rel === 'LICENSE') return rel;
  const m = /^bins\/([^/]+)\/([^/]+)$/.exec(rel);
  if (!m || m[1] !== pkg) return undefined;
  const file = m[2] ?? '';
  if (!SAFE_NAME.test(file) || unusedCpuVariant(file) || file.endsWith('.lib')) return undefined;
  return rel;
}

/** 푼 뒤 꼭 있어야 하는 것 (없으면 엔진이 이 폴더를 쓰지 않는다) */
export function llamaRequiredFiles(pkg: LlamaPackage): string[] {
  return [
    'package.json',
    'dist/index.js',
    `bins/${pkg}/llama-addon.node`,
    `bins/${pkg}/_nlcBuildMetadata.json`,
  ];
}
