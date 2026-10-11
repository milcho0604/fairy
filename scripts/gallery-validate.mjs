// 펫 갤러리 올리기 검사 (CI, .github/workflows/gallery.yml). 앱 가져오기보다 엄격하다.
//   node scripts/gallery-validate.mjs
// - gallery/ 에는 정해진 파일만 (index.json, README.md, CONTRIBUTING.md, pets/*.jjpet, thumbs/*.png)
// - 펫 파일마다 판 2 형식, 크기 상한, 만든 사람, 사용 허락, 본 그림, 작은 그림 (src/shared/gallery.ts validateSubmission)
// - index.json 과 작은 그림이 펫 파일에서 다시 만든 것과 같다 (sha256, 크기 포함)
// 남의 캐릭터가 아닌지는 사람이 본다 (gallery/CONTRIBUTING.md 의 약속). 문제가 있으면 1 로 끝난다
import { existsSync, readdirSync, statSync } from 'node:fs';
import { GALLERY_MAX_PETS, INDEX_MAX_BYTES, parseGalleryIndex } from '../src/shared/gallery.ts';
import { diffGallery, readGallery } from './gallery-index.mjs';

const root = new URL('../gallery/', import.meta.url);
const problems = [];
const TOP = new Set(['index.json', 'README.md', 'CONTRIBUTING.md', 'pets', 'thumbs']);

for (const n of existsSync(root) ? readdirSync(root) : []) {
  if (!TOP.has(n)) problems.push(`gallery/${n} is not allowed here`);
}
for (const [sub, ext] of [
  ['pets', '.jjpet'],
  ['thumbs', '.png'],
]) {
  const dir = new URL(`${sub}/`, root);
  if (!existsSync(dir)) continue;
  for (const n of readdirSync(dir)) {
    const st = statSync(new URL(n, dir), { throwIfNoEntry: false });
    if (!st?.isFile() || !n.endsWith(ext)) problems.push(`gallery/${sub}/${n} is not allowed here`);
  }
}

const built = readGallery(root);
problems.push(...built.problems, ...diffGallery(built, root));
if (built.entries.length > GALLERY_MAX_PETS) problems.push(`more than ${GALLERY_MAX_PETS} pets`);
if (Buffer.byteLength(built.index) > INDEX_MAX_BYTES) problems.push(`index.json is over ${INDEX_MAX_BYTES} bytes`);
// 앱이 읽는 길로 다시 읽어 모든 항목이 살아남는지 본다
const read = parseGalleryIndex(built.index);
if (!read || read.length !== built.entries.length) problems.push('the app would drop some index entries');

for (const p of problems) console.error(`gallery: ${p}`);
if (problems.length) process.exit(1);
console.log(`gallery: ${built.entries.length} pets OK`);
