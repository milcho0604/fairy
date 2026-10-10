// 설치 파일에서 다른 운영체제, 다른 칩의 네이티브 패키지를 지운다 (electron-builder afterPack 훅, 서명 전).
// 고르는 규칙과 까닭은 src/shared/native-prune.ts.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { keepNativePackage, NATIVE_SCOPES } from '../src/shared/native-prune.ts';

/** electron-builder 의 Arch 숫자 → 이름 */
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function dirBytes(p) {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const f of readdirSync(p)) n += dirBytes(join(p, f));
  return n;
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
  console.log(`  • prune-native: ${(freed / 1e6).toFixed(1)}MB 뺌`);
}
