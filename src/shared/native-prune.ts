// 설치 파일에 다른 운영체제, 다른 칩의 네이티브 패키지를 넣지 않는다 (scripts/prune-native.mjs, electron-builder afterPack).
// 맥 릴리스는 한 node_modules 로 Apple 칩과 인텔 앱을 다 만들어서(release.yml 이 인텔 것을 더 받는다) 두 앱 모두
// 두 칩 것을 다 가졌다. 무료 AI 엔진(node-llama-cpp)은 칩마다 수십 MB 라 반은 쓰지 않는 짐이었다.

/** 패키지 이름 조각 중 운영체제를 뜻하는 것. 이름이 이것을 가지면 그 운영체제 전용이다 */
const OS_TOKENS: Record<string, string> = {
  mac: 'darwin',
  darwin: 'darwin',
  macos: 'darwin',
  win: 'win32',
  win32: 'win32',
  windows: 'win32',
  linux: 'linux',
  linuxmusl: 'linux',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  android: 'android',
};

/** 칩을 뜻하는 조각 (electron-builder 칩 이름으로) */
const ARCH_TOKENS: Record<string, string> = {
  x64: 'x64',
  amd64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
  armv7l: 'armv7l',
  arm: 'armv7l',
  arm32: 'armv7l',
  ia32: 'ia32',
  x86: 'ia32',
  riscv64: 'riscv64',
  loong64: 'loong64',
  ppc64: 'ppc64',
  s390x: 's390x',
};

/**
 * 이 패키지(@scope/name 의 name)를 이 앱에 둘지. 이름에 다른 운영체제나 다른 칩이 들어 있으면 뺀다.
 * 운영체제, 칩 조각이 없는 이름(node-llama-cpp 같은 본 패키지)은 둔다
 */
export function keepNativePackage(name: string, platform: string, arch: string): boolean {
  for (const part of name.toLowerCase().split('-')) {
    const os = OS_TOKENS[part];
    if (os && os !== platform) return false;
    const a = ARCH_TOKENS[part];
    if (a && a !== arch) return false;
  }
  return true;
}

/** 칩마다 나뉜 패키지가 있는 scope. 이 안에서만 고른다 (다른 패키지 이름에 우연히 linux 가 들어가도 건드리지 않게) */
export const NATIVE_SCOPES = ['@node-llama-cpp', '@koromix', '@reflink'] as const;
