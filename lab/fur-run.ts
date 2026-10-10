// 실험: 털 풍성함 요청문 비교. 앱의 실제 클라이언트(illustrate)로, 요청문과 guidance 만 바꿔 본다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { illustrate, SPACES } from '../app/src/main/hf-illust.ts';

const v = Number(process.env.VARIANT ?? 0);
const FUR =
  'Make its natural coat about 50% fluffier: plush, cloud-like fur that puffs out on the legs too ' +
  '(fluffy feathering on the front legs, fluffy britches on the hind legs, little tufts between the toes), ' +
  'a puffy chest ruff, cheek fluff and a bushy tail, with visible individual strands and soft wispy edges everywhere. ' +
  'The legs must look as furry as the body, never smooth, sleek, shaved or thin.';
const AGE = {
  baby: 'a tiny baby (a few weeks old): very small and round, oversized head, big eyes, short stubby legs',
  teen: 'a playful adolescent (about five months old): slightly lanky, big paws',
  adult: 'a fully grown adult in its prime: full size, confident',
};
// 자세를 맨 앞에: 뒤에 두면 다리 이야기에 끌려 두 발로 섰다
const POSE = {
  sit: 'sitting like a real pet, both front paws on the ground, hind legs folded beside the body',
  stand: 'standing on all four paws like a real four-legged animal, side-on three-quarter view',
};
const FUR2 =
  'Fur: make its natural coat much fluffier and longer everywhere, like a freshly blow-dried show pet: ' +
  'long fluffy feathering on all four legs, fluffy britches, tufts between the toes, a big chest ruff, cheek fluff and a bushy tail, ' +
  'visible individual strands and soft wispy edges along the whole silhouette. No smooth, sleek, short-haired or shaved areas.';
const promptOf = (age: 'baby' | 'teen' | 'adult', pose: 'sit' | 'stand') =>
  [
    `A cute, polished, realistic 3D illustration of this exact pet as ${AGE[age]}, ${POSE[pose]}, facing the viewer, whole body visible, alone, centered.`,
    "Keep the pet's identity: same breed, fur color and pattern, markings and eye color.",
    FUR2,
    'It is an animal: never standing upright on its hind legs, never human-like.',
    'Plain light solid background, soft studio light. No text, no watermark, no other animals or objects.',
  ].join(' ');
const variants = [
  { note: 'pose-first sit, g3.5', pose: 'sit' as const, guidance: 3.5 },
  { note: 'pose-first stand, g3.5', pose: 'stand' as const, guidance: 3.5 },
  { note: 'pose-first sit, g2.5', pose: 'sit' as const, guidance: 2.5 },
];
const cfg = variants[v] ?? variants[0];
const kontext = SPACES[0];
const space = { ...kontext, inputs: (image: unknown, prompt: string) => [image, prompt, 0, true, cfg.guidance, 28] };
const jobs = [
  { name: 'cat-adult', file: 'lab/in_cat.png', age: 'adult' as const },
  { name: 'cat-teen', file: 'lab/in_cat.png', age: 'teen' as const },
  { name: 'poodle-teen', file: 'lab/in_poodle.png', age: 'teen' as const },
];
const out = `lab/out-fur2/v${v}`;
mkdirSync(out, { recursive: true });
const report: unknown[] = [];
for (const j of jobs) {
  const started = Date.now();
  const prompt = promptOf(j.age, cfg.pose);
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
writeFileSync(`${out}/report.json`, JSON.stringify({ prompt: cfg, sample: promptOf('adult', cfg.pose), report }, null, 2));
console.log(JSON.stringify(report, null, 2));
