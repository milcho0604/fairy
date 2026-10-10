// 실험: 털 풍성함 요청문 비교. 앱의 실제 클라이언트(illustrate)로, 요청문과 guidance 만 바꿔 본다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { illustrate, SPACES } from '../app/src/main/hf-illust.ts';
import { illustratePrompt } from '../app/src/shared/illustrate.ts';

const v = Number(process.env.VARIANT ?? 0);
const FUR =
  'Make its natural coat about 50% fluffier: plush, cloud-like fur that puffs out on the legs too ' +
  '(fluffy feathering on the front legs, fluffy britches on the hind legs, little tufts between the toes), ' +
  'a puffy chest ruff, cheek fluff and a bushy tail, with visible individual strands and soft wispy edges everywhere. ' +
  'The legs must look as furry as the body, never smooth, sleek, shaved or thin.';
const variants = [
  { note: 'current', extra: '', guidance: 2.5 },
  { note: 'fur text', extra: FUR, guidance: 2.5 },
  { note: 'fur text + guidance 3.5', extra: FUR, guidance: 3.5 },
];
const cfg = variants[v] ?? variants[0];
const kontext = SPACES[0];
const space = { ...kontext, inputs: (image: unknown, prompt: string) => [image, prompt, 0, true, cfg.guidance, 28] };
const jobs = [
  { name: 'cat-adult', file: 'lab/in_cat.png', age: 'adult' as const },
  { name: 'cat-teen', file: 'lab/in_cat.png', age: 'teen' as const },
  { name: 'poodle-adult', file: 'lab/in_poodle.png', age: 'adult' as const },
];
const out = `lab/out-fur/v${v}`;
mkdirSync(out, { recursive: true });
const report: unknown[] = [];
for (const j of jobs) {
  const started = Date.now();
  const base = illustratePrompt(j.age);
  // 털 문장은 생김새 문장 바로 뒤, 자세 문장 앞에 넣는다
  const prompt = cfg.extra ? base.replace(/(Show the whole body)/, `${cfg.extra} $1`) : base;
  try {
    const r = await illustrate(readFileSync(j.file), 'image/png', prompt, {
      fetch: globalThis.fetch,
      spaces: [space as typeof kontext],
      log: (tag, ...rest) => console.log(`[${tag}]`, ...rest.map((x) => String(x).slice(0, 300))),
    });
    writeFileSync(`${out}/${j.name}.${r.kind}`, r.bytes);
    report.push({ v, note: cfg.note, job: j.name, ok: true, ms: Date.now() - started });
  } catch (e) {
    const err = e as { kind?: string; message?: string };
    report.push({ v, note: cfg.note, job: j.name, ok: false, kind: err.kind, message: String(err.message).slice(0, 300) });
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ prompt: cfg, report }, null, 2));
console.log(JSON.stringify(report, null, 2));
