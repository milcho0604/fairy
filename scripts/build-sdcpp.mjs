// 맥 앱에 넣을 sd.cpp sd-cli 를 빌드한다 (내 컴퓨터에서 그리기의 sd.cpp 엔진, src/main/sdcpp-core.ts).
//
// 왜 직접: 공식 릴리스의 맥 묶음은 macOS 26 용으로 빌드돼 macOS 14 에서도 켜지지 않았다 (2026-10-10 확인).
// 같은 커밋을 macOS 12 대상, Metal 셰이더를 안에 넣고(GGML_METAL_EMBED_LIBRARY), 공유 라이브러리 없이 빌드하면
// 시스템 프레임워크만 쓰는 42MB 쯤의 실행 파일 하나가 나온다.
//
// 쓰는 법: node scripts/build-sdcpp.mjs [--arch arm64|x64|all] (기본 all, 맥에서만)
// 결과: resources-bin/sd/<arm64|x64>/sd-cli. electron-builder 가 mac.extraResources 로 앱 안 sd/sd-cli 에 넣는다.
// 소스는 캐시 폴더(JJ_SDCPP_CACHE, 기본 .cache/sdcpp)에 받아 두고, 같은 커밋이면 다시 받지 않는다.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** src/main/sdcpp-core.ts SD_RELEASE.commit 과 같아야 한다 (윈도우 묶음과 같은 판) */
const COMMIT = 'f89d9b13d730eabeede7314ce49dacd18d3c90c2';
const REPO = 'https://github.com/leejet/stable-diffusion.cpp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(process.env.JJ_SDCPP_CACHE || join(root, '.cache', 'sdcpp'));
const src = join(cache, 'src');

const archArg = (() => {
  const i = process.argv.indexOf('--arch');
  return i >= 0 ? process.argv[i + 1] : 'all';
})();
if (!['arm64', 'x64', 'all'].includes(archArg)) {
  console.error(`build-sdcpp: --arch 는 arm64, x64, all 중 하나 (${archArg})`);
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('build-sdcpp: 맥에서만 빌드한다 (윈도우는 앱이 공식 묶음을 받는다)');
  process.exit(1);
}

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const out = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

/** 고정한 커밋을 얕게 받는다. 이미 그 커밋이면 그대로 */
function checkout() {
  mkdirSync(src, { recursive: true });
  if (!existsSync(join(src, '.git'))) {
    sh('git', ['init', '-q'], src);
    sh('git', ['remote', 'add', 'origin', REPO], src);
  }
  let head = '';
  try {
    head = out('git', ['rev-parse', 'HEAD'], src);
  } catch {
    // 아직 없음
  }
  if (head !== COMMIT) {
    sh('git', ['fetch', '-q', '--depth', '1', 'origin', COMMIT], src);
    sh('git', ['checkout', '-q', '--force', COMMIT], src);
  }
  // 빌드에 필요한 것만 (다른 서브모듈은 수백 MB)
  sh('git', ['submodule', 'update', '--init', '--depth', '1', 'ggml', 'thirdparty/libwebp'], src);
}

/** electron-builder 의 arch 이름(arm64, x64) → CMake 의 arch 이름 */
const cmakeArch = (arch) => (arch === 'x64' ? 'x86_64' : 'arm64');

function build(arch) {
  const dir = join(cache, `build-${arch}`);
  const flags = [
    '-S',
    src,
    '-B',
    dir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_OSX_ARCHITECTURES=${cmakeArch(arch)}`,
    '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
    '-DSD_METAL=ON',
    '-DGGML_METAL_EMBED_LIBRARY=ON',
    '-DSD_WEBM=OFF',
    '-DSD_BUILD_SHARED_LIBS=OFF',
    '-DGGML_NATIVE=OFF',
    // 인텔 Mac 은 CPU 로 그린다. AVX2, FMA 는 Haswell(2013 년 중반) 뒤 칩부터라 그 앞 칩(Mac Pro Late 2013 의
    // Ivy Bridge Xeon 포함)에는 없다 → 앱이 sysctl hw.optional.avx2_0, fma 로 보고 없으면 그리기를 감춘다 (sdcpp-core.ts)
    ...(arch === 'x64' ? ['-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON'] : []),
  ];
  sh('cmake', flags, root);
  sh('cmake', ['--build', dir, '--config', 'Release', '--target', 'sd-cli', '-j', String(cpus().length)], root);
  const bin = join(dir, 'bin', 'sd-cli');
  const dest = join(root, 'resources-bin', 'sd', arch, 'sd-cli');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(bin, dest);
  chmodSync(dest, 0o755);
  // 다른 arch 를 만들었으면 여기서 멈춘다 (lipo 가 아키텍처를 알려 준다)
  const archs = out('/usr/bin/lipo', ['-archs', dest]);
  if (archs !== cmakeArch(arch)) throw new Error(`build-sdcpp: ${dest} 가 ${archs} 다 (${cmakeArch(arch)} 이어야 한다)`);
  // 시스템 프레임워크 말고 다른 라이브러리에 기대면 사용자 맥에서 안 켜진다
  const libs = out('/usr/bin/otool', ['-L', dest])
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(' ')[0])
    .filter((l) => l && !l.startsWith('/System/') && !l.startsWith('/usr/lib/'));
  if (libs.length > 0) throw new Error(`build-sdcpp: 시스템 밖 라이브러리를 쓴다: ${libs.join(', ')}`);
  // 켜지는지까지 본다. 같은 arch 맥이면 그대로, Apple 칩 맥(CI)에서 만든 인텔용은 로제타로
  if (process.arch === arch) execFileSync(dest, ['--help'], { stdio: 'ignore' });
  else if (arch === 'x64' && process.arch === 'arm64') smokeUnderRosetta(dest);
  console.log(`  • build-sdcpp: ${dest} (${Math.round(statSync(dest).size / 1e6)}MB, ${archs})`);
}

/**
 * 인텔용 sd-cli 를 로제타로 켜 본다 (CI 는 Apple 칩 맥이라 이것이 인텔용을 켜 보는 유일한 자리).
 * 로제타는 macOS 15 부터 AVX2 를 흉내 낸다. 그 앞 macOS 에서 실패하면 빌드 탓이 아닐 수 있어 경고만 한다
 */
function smokeUnderRosetta(dest) {
  try {
    execFileSync('/usr/bin/arch', ['-x86_64', dest, '--help'], { stdio: 'ignore' });
  } catch (err) {
    const major = Number.parseInt(out('/usr/bin/sw_vers', ['-productVersion']), 10);
    if (major >= 15) throw new Error(`build-sdcpp: 인텔용 ${dest} 가 로제타에서 켜지지 않는다 (${err.message})`);
    console.warn(`  • build-sdcpp: macOS ${major} 로제타는 AVX2 가 없어 인텔용 켜 보기를 건너뛴다`);
  }
}

checkout();
for (const arch of archArg === 'all' ? ['arm64', 'x64'] : [archArg]) build(arch);
