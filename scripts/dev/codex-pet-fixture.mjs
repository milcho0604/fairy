// 시험용 Codex 펫 파일(.codex-pet.zip)을 만든다 (이슈 #88). 단순한 도형으로 1536x1872 그림을 그려 pet.json 과 묶는다.
// 남의 펫은 쓰지 않는다. 그리기와 zip 쓰기는 src/main/codex-pet-fixture.ts (단위 시험과 같은 것)
//
//   node scripts/dev/codex-pet-fixture.mjs <나갈.codex-pet.zip> [--webp] [--rows 0,1,3] [--name 이름]
//
// --webp: 그림을 WebP 로 (이 컴퓨터에 cwebp 가 있을 때만, 무손실). 없으면 PNG (Codex 형식은 둘 다 받는다)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawSheet, encodePng, makeZip, petJson } from '../../src/main/codex-pet-fixture.ts';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--') && !/^[\d,]+$/.test(a) && args[args.indexOf(a) - 1] !== '--name');
if (!out) {
  console.error('나갈 파일 이름을 줘: node scripts/dev/codex-pet-fixture.mjs dot.codex-pet.zip');
  process.exit(1);
}
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const rows = opt('--rows')?.split(',').map(Number);
const png = encodePng(drawSheet(rows ? { rows } : {}));
let sheet = { name: 'spritesheet.png', data: png };
if (args.includes('--webp')) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-fixture-'));
  try {
    writeFileSync(join(dir, 'sheet.png'), png);
    execFileSync('cwebp', ['-quiet', '-lossless', join(dir, 'sheet.png'), '-o', join(dir, 'sheet.webp')]);
    sheet = { name: 'spritesheet.webp', data: readFileSync(join(dir, 'sheet.webp')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const name = opt('--name') ?? '도트';
const zip = makeZip([
  { name: 'dot/pet.json', data: petJson({ displayName: name, sheet: sheet.name }) },
  { name: `dot/${sheet.name}`, data: sheet.data, store: true },
]);
writeFileSync(out, zip);
console.log(`${out}: ${zip.length} 바이트, 그림 ${sheet.name} ${sheet.data.length} 바이트`);
