// 실험: 앱의 sd.cpp 엔진 순서를 윈도우 러너에서 그대로 (sdcpp-core 의 핀, 풀기, 인자, 진행 해석, 결과 확인).
// 사용자 폴더 이름에 한글과 빈칸이 있을 때(짝꿍 시험)도 되는지 본다. CPU 판으로 (러너에 GPU 가 없다)
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  SD_MODELS,
  SD_WIN_ASSETS,
  sdAssetUrl,
  sdBinary,
  sdDrawArgs,
  sdDrawSize,
  sdLayout,
  sdModelPath,
  sdProgress,
  sdWinDir,
  sdZipPath,
  hasVulkanDevice,
  sdUnzipRel,
  unzipArgs,
  winTar,
} from '../app/src/main/sdcpp-core.ts';
import { checkDrawn } from '../app/src/main/local-draw-core.ts';
import { FUR_PROMPT } from '../app/src/main/hf-illust.ts';
import { illustratePrompt } from '../app/src/shared/illustrate.ts';

const out = 'lab/out-sdapp';
mkdirSync(out, { recursive: true });
const root = join(process.env.APPDATA ?? 'C:\\tmp', '짝꿍 시험', 'local-draw-sd');
const l = sdLayout(root);
for (const d of [l.downloadDir, l.modelsDir, l.tmp]) mkdirSync(d, { recursive: true });
const report: Record<string, unknown> = { root };
const sha = async (f: string) => {
  const h = createHash('sha256');
  await pipeline(createReadStream(f), h);
  return h.digest('hex');
};
async function get(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}
const t0 = Date.now();
const z = SD_WIN_ASSETS.cpu;
await get(sdAssetUrl(z.name), sdZipPath(l, 'cpu'));
report.zipSha = (await sha(sdZipPath(l, 'cpu'))) === z.sha256;
mkdirSync(sdWinDir(l, 'cpu'), { recursive: true });
const rel = sdUnzipRel('cpu');
const ux = spawnSync(winTar(process.env.SystemRoot), unzipArgs(rel.zip, rel.dir), { encoding: 'utf8', cwd: l.root });
report.untar = { status: ux.status, err: ux.stderr?.slice(-300) };
for (const m of SD_MODELS) {
  await get(m.url, sdModelPath(l, m));
  report[`sha_${m.key}`] = (await sha(sdModelPath(l, m))) === m.sha256;
}
report.downloadS = Math.round((Date.now() - t0) / 1000);
const bin = sdBinary({ platform: 'win32', arch: 'x64', l, backend: 'cpu', resourcesPath: '', appPath: '', packaged: true });
report.bin = { path: bin, exists: existsSync(bin) };
const ld = spawnSync(bin, ['--list-devices'], { encoding: 'utf8', windowsHide: true });
report.listDevices = { status: ld.status, out: (ld.stdout ?? '').slice(0, 600), vulkan: hasVulkanDevice(ld.stdout ?? '') };
console.log(JSON.stringify(report, null, 2));
const run = (name: string, input: string, prompt: string) =>
  new Promise<void>((resolve) => {
    const size = sdDrawSize(readFileSync(input), 'cpu');
    const o = join(l.tmp, `jj-${name}.png`);
    const args = sdDrawArgs(l, { input, output: o, prompt, ...size, seed: 7, backend: 'cpu' });
    const t = Date.now();
    let log = '';
    const seen: string[] = [];
    const child = spawn(bin, args, { windowsHide: true });
    child.on('error', (e) => { report[name] = { spawnError: String(e) }; resolve(); });
    const onData = (b: Buffer) => {
      log += b.toString();
      const p = sdProgress(log.slice(-4000));
      const key = p ? `${p.phase}:${p.n}/${p.total}` : '';
      if (key && seen.at(-1) !== key) seen.push(key);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      writeFileSync(`${out}/${name}.log`, log.slice(-30000));
      const r: Record<string, unknown> = { code, s: Math.round((Date.now() - t) / 1000), size, progress: seen.slice(0, 40) };
      if (existsSync(o)) {
        const b = readFileSync(o);
        r.check = checkDrawn(b, size);
        writeFileSync(`${out}/${name}.png`, b);
      }
      report[name] = r;
      console.log(name, JSON.stringify(r));
      resolve();
    });
  });
await run('draw', 'lab/in_cat.png', illustratePrompt('adult'));
await run('fur', 'lab/out-fur3/v0/cat-adult.webp', FUR_PROMPT);
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
