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

/**
 * 무료 AI 엔진(llama.cpp)의 CPU 판 중 뺄 것. 엔진은 켤 때 폴더의 libggml-cpu-*.so (윈도우 ggml-cpu-*.dll) 를 다 열어
 * 이 CPU 에서 돌 수 있는 것 중 점수가 가장 높은 것을 고른다. 하나가 없으면 그다음 것을 고를 뿐이라 기능은 그대로고,
 * 기본판(x64)은 늘 남긴다. 아래는 이웃 판과 거의 같은 것: piledriver(2012 AMD, sandybridge 로),
 * ivybridge(sandybridge 로), cannonlake(거의 안 팔린 노트북 칩, skylakex 로), cascadelake, cooperlake(서버 Xeon,
 * skylakex 로). 판마다 1.2~1.4MB 라 합쳐 6.5MB 쯤 준다 (2026-10-11)
 */
export const UNUSED_CPU_VARIANTS = [
  'piledriver',
  'ivybridge',
  'cannonlake',
  'cascadelake',
  'cooperlake',
] as const;

/** 이 파일(이름만)이 뺄 CPU 판인지 */
export function unusedCpuVariant(file: string): boolean {
  const m = /^(?:lib)?ggml-cpu-([a-z0-9]+)\.(?:so|dll)$/.exec(file);
  return !!m && (UNUSED_CPU_VARIANTS as readonly string[]).includes(m[1] ?? '');
}

/**
 * SwiftShader(그래픽 칩 없이 CPU 로 그리는 Vulkan) 파일의 앱 폴더 안 자리. scripts/prune-native.mjs 가 뺀다.
 * Electron 44(Chromium)는 그래픽 칩이 없거나 막혔을 때 SwiftShader 로 WebGL, WebGPU 를 열지 않는다
 * (--enable-unsafe-swiftshader 를 줄 때만 쓰고, 페어리는 주지 않는다). 실행에 쓰이지 않는 짐이다.
 * 2026-10-11 리눅스 설치판 측정 (Xvfb, 그래픽 칩 없음): SwiftShader 가 있어도 없어도 WebGL, WebGPU 둘 다 열리지 않고
 * 페어리는 2D 그림으로 돈다 (--disable-gpu 도 같다). 입체 페어리와 사진 AI 의 GPU 길은 진짜 그래픽 칩에서만 쓴다.
 * 개발 실행의 화면 찍기(scripts/dev/screens.mjs)는 node_modules 의 Electron 이라 그대로 SwiftShader 로 입체를 찍는다.
 * 맥은 프레임워크 안이라 서명 전에 빼야 하고, afterPack 은 서명보다 먼저 돈다
 */
export function swiftShaderFiles(platform: string, appName: string): string[] {
  if (platform === 'linux') return ['libvk_swiftshader.so', 'vk_swiftshader_icd.json'];
  if (platform === 'win32') return ['vk_swiftshader.dll', 'vk_swiftshader_icd.json'];
  if (platform === 'darwin') {
    const lib = `${appName}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries`;
    return [`${lib}/libvk_swiftshader.dylib`, `${lib}/vk_swiftshader_icd.json`];
  }
  return [];
}
