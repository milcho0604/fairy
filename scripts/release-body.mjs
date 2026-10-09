// 릴리스 본문 머리(최소 버전 줄)를 만든다. release.yml 이 태그마다 부른다.
//   node scripts/release-body.mjs v0.2.0 > notes.md
// 태그와 package.json 버전이 다르거나 release/min-version 이 잘못되었으면 이유를 남기고 1 로 끝난다.
import { readFileSync } from 'node:fs';
import { releaseBodyHead } from '../src/shared/release-meta.ts';

const tag = process.argv[2] ?? '';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
let minFile = '';
try {
  minFile = readFileSync(new URL('release/min-version', root), 'utf8');
} catch {}
const r = releaseBodyHead(tag, pkg.version, minFile);
if (!r.ok) {
  console.error(`release-body: ${r.error}`);
  process.exit(1);
}
process.stdout.write(r.value);
