// 펫 갤러리 목록을 만든다: gallery/pets/*.jjpet 를 검사하고 gallery/thumbs/<id>.png, gallery/index.json 을 쓴다.
//   node scripts/gallery-index.mjs          만들기 (레포 주인이 공식 펫을 더하거나 고친 뒤 돌리고 같이 커밋한다)
//   node scripts/gallery-index.mjs --check  쓰지 않고 지금 파일과 같은지만 본다
// 문제가 있으면 이유를 남기고 1 로 끝난다. 형식: docs/pet-format.md
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildGallery } from '../src/shared/gallery-build.ts';

const root = new URL('../gallery/', import.meta.url);
const check = process.argv.includes('--check');

/** pets/ 를 읽어 목록을 만든다. 다른 스크립트(gallery-validate.mjs)도 쓴다 */
export function readGallery(dir = root) {
  const petsDir = new URL('pets/', dir);
  const names = existsSync(petsDir) ? readdirSync(petsDir).filter((n) => !n.startsWith('.')).sort() : [];
  return buildGallery(names.map((name) => ({ name, bytes: readFileSync(new URL(name, petsDir)) })));
}

/** 만든 목록과 지금 파일이 다른 곳 (빈 배열이면 같다) */
export function diffGallery(built, dir = root) {
  const out = [];
  const indexFile = new URL('index.json', dir);
  const now = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : '';
  if (now !== built.index) out.push('gallery/index.json is out of date (run node scripts/gallery-index.mjs)');
  const thumbsDir = new URL('thumbs/', dir);
  const have = existsSync(thumbsDir) ? readdirSync(thumbsDir).filter((n) => !n.startsWith('.')) : [];
  for (const [id, png] of built.thumbs) {
    const f = new URL(`${id}.png`, thumbsDir);
    if (!existsSync(f) || !readFileSync(f).equals(png)) out.push(`gallery/thumbs/${id}.png is out of date`);
  }
  for (const n of have) if (!built.thumbs.has(n.replace(/\.png$/, ''))) out.push(`gallery/thumbs/${n} is not used`);
  return out;
}

function writeGallery(built, dir = root) {
  const thumbsDir = new URL('thumbs/', dir);
  mkdirSync(thumbsDir, { recursive: true });
  for (const n of readdirSync(thumbsDir))
    if (!built.thumbs.has(n.replace(/\.png$/, ''))) rmSync(new URL(n, thumbsDir));
  for (const [id, png] of built.thumbs) writeFileSync(new URL(`${id}.png`, thumbsDir), png);
  writeFileSync(new URL('index.json', dir), built.index);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = readGallery();
  for (const p of built.problems) console.error(`gallery: ${p}`);
  if (built.problems.length) process.exit(1);
  if (check) {
    const diff = diffGallery(built);
    for (const d of diff) console.error(`gallery: ${d}`);
    if (diff.length) process.exit(1);
    console.log(`gallery: ${built.entries.length} pets, index is up to date`);
  } else {
    writeGallery(built);
    console.log(`gallery: wrote index.json with ${built.entries.length} pets`);
  }
}
