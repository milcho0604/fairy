// 실험: 앱의 실제 Hugging Face 클라이언트(src/main/hf-illust.ts)와 실제 요청문(src/shared/illustrate.ts)을
// Electron 없이 Node 로 그대로 불러 진짜 Space 에 보낸다. 앱 코드는 wip-illustrate 브랜치를 app/ 에 받아 쓴다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { illustrateFluffy } from '../app/src/main/hf-illust.ts';
import { illustratePrompt } from '../app/src/shared/illustrate.ts';

const jobs = [
  { name: 'cat-adult', file: 'lab/in_cat.png', age: 'adult' as const },
  { name: 'poodle-teen', file: 'lab/in_poodle.png', age: 'teen' as const },
  { name: 'cat-baby', file: 'lab/in_cat.png', age: 'baby' as const },
];
mkdirSync('lab/out-app', { recursive: true });
const report: unknown[] = [];
for (const j of jobs) {
  const started = Date.now();
  try {
    const r = await illustrateFluffy(readFileSync(j.file), 'image/png', illustratePrompt(j.age), {
      fetch: globalThis.fetch,
      log: (tag, ...rest) => console.log(`[${tag}]`, ...rest.map((x) => String(x).slice(0, 300))),
    });
    writeFileSync(`lab/out-app/${j.name}.${r.kind}`, r.bytes);
    report.push({ job: j.name, ok: true, fur: r.fur, space: r.space, kind: r.kind, bytes: r.bytes.length, ms: Date.now() - started });
  } catch (e) {
    const err = e as { kind?: string; message?: string };
    report.push({ job: j.name, ok: false, kind: err.kind, message: String(err.message).slice(0, 500), ms: Date.now() - started });
  }
}
writeFileSync('lab/out-app/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
