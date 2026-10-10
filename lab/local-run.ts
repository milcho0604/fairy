// 실험: 앱의 "내 Mac에서 그리기" 순서를 Electron 없이 그대로 (local-draw-core 의 인자, 환경). 맥 러너에서 돈다.
// 러너 GPU 는 가상이라 그림은 깨질 수 있다. 여기서는 받기, 설치, 저장, 오프라인 그리기 명령이 끝까지 도는지를 본다
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkDrawn,
  drawArgs,
  drawSize,
  FUR_PROMPT_NOTE,
  installArgs,
  layout,
  saveArgs,
  toolEnv,
  UV_PIN,
  untarArgs,
} from './core-proxy.ts';
import { FUR_PROMPT } from '../app/src/main/hf-illust.ts';
import { illustratePrompt } from '../app/src/shared/illustrate.ts';

void FUR_PROMPT_NOTE;
const root = join(process.env.HOME ?? '/tmp', 'Library', 'Application Support', 'jj-lab', 'local-draw');
const out = 'lab/out-local';
mkdirSync(out, { recursive: true });
const l = layout(root);
const report: Record<string, unknown> = { root };
const step = (name: string, cmd: string, args: string[], env: Record<string, string>) => {
  const t = Date.now();
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  writeFileSync(`${out}/${name}.log`, text.slice(-20000));
  report[name] = { status: r.status, signal: r.signal, error: r.error?.message, s: Math.round((Date.now() - t) / 1000) };
  console.log(name, report[name]);
  return r.status === 0;
};
const env = toolEnv(process.env, l);
for (const d of [l.uvDir, join(root, 'download'), l.modelsDir]) mkdirSync(d, { recursive: true });
// 1. uv 받기 + sha256
const tb = spawnSync('curl', ['-fsSL', '-o', l.uvTarball, UV_PIN.url]);
const sha = createHash('sha256').update(readFileSync(l.uvTarball)).digest('hex');
report.uvSha = { ok: sha === UV_PIN.sha256, bytes: statSync(l.uvTarball).size, curl: tb.status };
console.log('uvSha', report.uvSha);
let ok = step('untar', '/usr/bin/tar', untarArgs(l), env);
if (ok) chmodSync(l.uv, 0o755);
ok = ok && step('install', l.uv, installArgs(), env);
report.entries = { python: existsSync(l.python), generate: existsSync(l.generate), save: existsSync(l.save) };
ok = ok && step('save', l.python, saveArgs(l), env);
if (ok) {
  renameSync(l.modelPart, l.model);
  rmSync(l.hfHome, { recursive: true, force: true });
  const du = spawnSync('du', ['-sh', root, l.model], { encoding: 'utf8' });
  report.du = du.stdout;
}
const offline = toolEnv(process.env, l, { offline: true });
for (const [name, file, prompt] of [
  ['draw', 'lab/in_cat.png', illustratePrompt('adult')],
  ['fur', 'lab/out-fur3/v0/cat-adult.webp', FUR_PROMPT],
] as const) {
  if (!ok) break;
  const bytes = readFileSync(file);
  const size = drawSize(bytes);
  const o = join('/tmp', `jj-${name}.png`);
  const good = step(name, l.python, drawArgs(l, { input: file, output: o, prompt, ...size, seed: 7 }), offline);
  if (good && existsSync(o)) {
    const b = readFileSync(o);
    report[`${name}Check`] = checkDrawn(b, size);
    writeFileSync(`${out}/${name}.png`, b);
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
