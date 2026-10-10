// 실험: 털 풍성함. 앱의 실제 클라이언트(illustrate)로 Kontext 와 FLUX.2 klein 4B 를 같은 요청문으로 견준다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { illustrate, SPACES } from '../app/src/main/hf-illust.ts';

const v = Number(process.env.VARIANT ?? 0);
const AGE = {
  baby: 'a tiny baby (a few weeks old): very small and round, oversized head, big eyes, short stubby legs',
  teen: 'a playful adolescent (about five months old): slightly lanky, big paws',
  adult: 'a fully grown adult in its prime: full size, confident',
};
const FUR =
  'Fur: a very long, thick, fluffy coat on every part of the body, like a freshly blow-dried long-haired show pet: ' +
  'the legs are thick fluffy columns of long fur all the way down to the paws (long feathering on the front legs, fluffy britches on the hind legs, ' +
  'long tufts between the toes), a big chest ruff, cheek fluff and a bushy tail, visible individual strands and soft wispy edges along the whole silhouette. ' +
  'No smooth, sleek, short-haired or shaved areas anywhere, especially not on the legs.';
const promptOf = (age: keyof typeof AGE) =>
  [
    `A cute, polished, realistic 3D illustration of this exact pet as ${AGE[age]}, sitting like a real pet, both front paws on the ground, hind legs folded beside the body, facing the viewer, whole body visible, alone, centered.`,
    "Keep the pet's identity: same breed, fur color and pattern, markings and eye color.",
    FUR,
    'It is an animal: never standing upright on its hind legs, never human-like.',
    'Plain light solid background, soft studio light. No text, no watermark, no other animals or objects.',
  ].join(' ');
const variants = [
  { note: 'kontext g3.5 long fur', engine: 'kontext' },
  { note: 'klein-4b distilled', engine: 'klein' },
  { note: 'klein-4b distilled (seed 2)', engine: 'klein' },
];
const cfg = variants[v] ?? variants[0];
const kontext = SPACES[0];
const space =
  cfg.engine === 'klein'
    ? {
        id: 'black-forest-labs/FLUX.2-klein-4B',
        endpoint: 'infer',
        inputs: (image: unknown, prompt: string) => [
          prompt,
          [{ image, caption: null }],
          'Distilled (4 steps)',
          v === 2 ? 2 : 0,
          v !== 2,
          784,
          1328,
          4,
          1.0,
          false,
        ],
      }
    : { ...kontext, inputs: (image: unknown, prompt: string) => [image, prompt, 0, true, 3.5, 28] };
const jobs = [
  { name: 'cat-adult', file: 'lab/in_cat.png', age: 'adult' as const },
  { name: 'cat-teen', file: 'lab/in_cat.png', age: 'teen' as const },
  { name: 'poodle-teen', file: 'lab/in_poodle.png', age: 'teen' as const },
];
const out = `lab/out-fur3/v${v}`;
mkdirSync(out, { recursive: true });
const report: unknown[] = [];
for (const j of jobs) {
  const started = Date.now();
  try {
    const r = await illustrate(readFileSync(j.file), 'image/png', promptOf(j.age), {
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
writeFileSync(`${out}/report.json`, JSON.stringify({ cfg, sample: promptOf('adult'), report }, null, 2));
console.log(JSON.stringify(report, null, 2));
