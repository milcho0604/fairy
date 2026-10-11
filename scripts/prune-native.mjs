// 설치 파일에서 다른 운영체제, 다른 칩의 네이티브 패키지를 지운다 (electron-builder afterPack 훅, 서명 전).
// 쓰이지 않는 SwiftShader(CPU 로 그리는 Vulkan)도 뺀다. 고르는 규칙과 까닭은 src/shared/native-prune.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { keepNativePackage, NATIVE_SCOPES, swiftShaderFiles } from '../src/shared/native-prune.ts';

/** electron-builder 의 Arch 숫자 → 이름 */
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function dirBytes(p) {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const f of readdirSync(p)) n += dirBytes(join(p, f));
  return n;
}

/** 리눅스 공유 라이브러리와 Node 애드온 (앱 폴더 바로 아래와 app.asar.unpacked 안) */
function sharedObjects(dir, deep) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const unpacked = e.name === 'app.asar.unpacked';
      if (deep || unpacked || e.name === 'resources') out.push(...sharedObjects(p, deep || unpacked));
    } else if (e.isFile() && /\.(so(\.\d+)*|node)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 리눅스: 디버그 정보만 지운다 (strip --strip-debug, 내보낸 심볼과 동적 심볼은 그대로라 읽기와 실행은 같다).
 * Electron 이 넣는 libvulkan.so.1 이 디버그 정보를 지닌 채 와서 2.5MB 중 1.7MB 가 그것이다. strip 이 없으면 넘어간다
 */
function stripDebug(appOutDir) {
  let freed = 0;
  for (const f of sharedObjects(appOutDir, false)) {
    const before = statSync(f).size;
    try {
      execFileSync('strip', ['--strip-debug', f], { stdio: 'ignore' });
    } catch {
      continue;
    }
    const gone = before - statSync(f).size;
    if (gone > 0) {
      freed += gone;
      console.log(`  • prune-native: strip ${f.slice(appOutDir.length + 1)} (${(gone / 1e6).toFixed(1)}MB)`);
    }
  }
  return freed;
}

export default async function pruneNative(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH[context.arch] ?? String(context.arch);
  // 두 칩을 합친 앱은 두 칩 것이 다 필요하다
  if (arch === 'universal') return;
  const resources =
    platform === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');
  const modules = join(resources, 'app.asar.unpacked', 'node_modules');
  let freed = 0;
  for (const scope of NATIVE_SCOPES) {
    const dir = join(modules, scope);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (keepNativePackage(name, platform, arch)) continue;
      const p = join(dir, name);
      freed += dirBytes(p);
      rmSync(p, { recursive: true, force: true });
      console.log(`  • prune-native: ${scope}/${name} (${platform}-${arch} 에 필요 없음)`);
    }
  }
  for (const rel of swiftShaderFiles(platform, context.packager.appInfo.productFilename)) {
    const p = join(context.appOutDir, rel);
    if (!existsSync(p)) continue;
    freed += statSync(p).size;
    rmSync(p, { force: true });
    console.log(`  • prune-native: ${rel.replace(/^.*\//, '')} (SwiftShader, 쓰지 않음)`);
  }
  if (platform === 'linux') {
    // koffi 의 musl 판(Alpine 같은 musl 리눅스용)은 쓰지 않는다. Electron 은 glibc 에서만 돌고, koffi 는 실행 파일의
    // libc 를 보고 glibc 판을 고른다
    const koffi = join(modules, '@koromix', `koffi-linux-${arch}`, `musl_${arch}`);
    if (existsSync(koffi)) {
      freed += dirBytes(koffi);
      rmSync(koffi, { recursive: true, force: true });
      console.log(`  • prune-native: @koromix/koffi-linux-${arch}/musl_${arch} (Electron 은 glibc 만)`);
    }
    freed += stripDebug(context.appOutDir);
  }
  console.log(`  • prune-native: ${(freed / 1e6).toFixed(1)}MB 뺌`);
}
