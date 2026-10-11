// 무료 AI 엔진을 처음 쓸 때 받는다. 무엇을 어디서 받는지는 src/shared/llama-bins.ts.
// userData/engines/llama-<패키지>-<판>/ 에 npm 묶음을 풀어 두고, 일꾼은 llama-hook.ts 로 그 폴더를 쓴다.
// 개발 실행(npx electron .)처럼 앱 안 node_modules 에 패키지가 있으면 받지 않고 그것을 쓴다.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { app } from 'electron';
import { DownloadError, failReason } from '../shared/download-error.ts';
import {
  LLAMA_BINS,
  type LlamaPackage,
  llamaEntryTarget,
  llamaPackageFor,
  llamaRequiredFiles,
  llamaTarballUrls,
} from '../shared/llama-bins.ts';
import { ensureVerified, forgetVerified } from './download.ts';
import { LLAMA_ENV } from './llama-hook.ts';
import { tarEntries } from './untar.ts';

/** 다 풀었다는 표시 (안에 묶음 해시). 이게 있어야 쓴다: 풀다 멈춘 폴더를 쓰지 않게 */
const MARK = '.jj-ok';

const target = (): { pkg: LlamaPackage; sha256: string; bytes: number } | undefined => {
  const pkg = llamaPackageFor(process.platform, process.arch);
  return pkg ? { pkg, ...LLAMA_BINS.packages[pkg] } : undefined;
};

const enginesDir = () => join(app.getPath('userData'), 'engines');
export const llamaBinsDir = (pkg: LlamaPackage) => join(enginesDir(), `llama-${pkg}-${LLAMA_BINS.version}`);

/** 앱 안에 엔진 패키지가 있다 (개발 실행, 또는 이 칩용 목록이 없는 빌드) */
function bundled(pkg: string): boolean {
  return existsSync(join(app.getAppPath(), 'node_modules', '@node-llama-cpp', pkg, 'package.json'));
}

/** 엔진을 쓸 수 있는지. 받을 목록이 없는 운영체제-칩이면 true (엔진이 스스로 찾고, 없으면 답할 때 실패한다) */
export function llamaBinsReady(): boolean {
  const t = target();
  if (!t || bundled(t.pkg)) return true;
  try {
    return readFileSync(join(llamaBinsDir(t.pkg), MARK), 'utf8') === t.sha256;
  } catch {
    return false;
  }
}

/** 아직 받아야 할 엔진 크기 (받기 안내의 MB 에 더한다) */
export const llamaBinsMissingBytes = (): number => (llamaBinsReady() ? 0 : (target()?.bytes ?? 0));

/** 일꾼(utilityProcess)에 더할 환경. 받아 둔 엔진을 쓸 때만 채운다 */
export function llamaWorkerEnv(): Record<string, string> {
  const t = target();
  if (!t || bundled(t.pkg)) return {};
  return { [LLAMA_ENV.dir]: llamaBinsDir(t.pkg), [LLAMA_ENV.pkg]: t.pkg };
}

/** 다음 주소로 넘어가도 소용없는 실패 (멈춤, 저장 공간, 권한, 이미 받는 중) */
const STOP = new Set(['cancelled', 'disk-full', 'no-permission', 'busy']);

let installing: Promise<void> | undefined;

/**
 * 엔진이 없으면 받아서 푼다(진행률 0~1). 시험용 JJ_LLAMA_BINS_URL 이 있으면 그 주소를 먼저 쓴다
 * (해시는 똑같이 맞추니 다른 묶음은 못 들어온다)
 */
export function ensureLlamaBins(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<void> {
  if (llamaBinsReady()) {
    onProgress(1);
    return Promise.resolve();
  }
  installing ??= install(onProgress, signal).finally(() => {
    installing = undefined;
  });
  return installing;
}

async function install(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<void> {
  const t = target();
  if (!t) return;
  const dir = llamaBinsDir(t.pkg);
  const tgz = `${dir}.tgz`;
  const urls = [process.env.JJ_LLAMA_BINS_URL, ...llamaTarballUrls(t.pkg)].filter((u): u is string => !!u);
  let got = false;
  let last: unknown = new DownloadError('failed');
  for (const url of urls) {
    try {
      // 푸는 데 드는 잠깐을 남겨 받기는 0.95 까지
      await ensureVerified(
        { path: tgz, url, sha256: t.sha256, bytes: t.bytes },
        (r) => onProgress(r * 0.95),
        signal,
      );
      got = true;
      break;
    } catch (err) {
      if (STOP.has(failReason(err, signal?.aborted))) throw err;
      last = err;
    }
  }
  if (!got) throw last;
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    const tar = await promisify(gunzip)(readFileSync(tgz));
    for (const e of tarEntries(tar)) {
      if (e.type !== '0') continue;
      const rel = llamaEntryTarget(e.name, t.pkg);
      if (!rel) continue;
      const out = join(tmp, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, e.data);
    }
    for (const f of llamaRequiredFiles(t.pkg))
      if (!existsSync(join(tmp, f))) throw new Error(`llama-bins: ${f} 가 묶음에 없다`);
    writeFileSync(join(tmp, MARK), t.sha256);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  rmSync(tgz, { force: true });
  forgetVerified(tgz);
  // 판을 올려 새로 받았으면 옛 판 폴더는 치운다
  for (const name of readdirSync(enginesDir()))
    if (name.startsWith(`llama-${t.pkg}-`) && join(enginesDir(), name) !== dir)
      rmSync(join(enginesDir(), name), { recursive: true, force: true });
  onProgress(1);
}
