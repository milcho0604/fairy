// 무료 AI 엔진(node-llama-cpp)의 운영체제별 패키지 해시를 뽑는다. node-llama-cpp 판을 올리면 이걸 돌려
// 나온 값을 src/shared/llama-bins.ts 의 LLAMA_BINS 에 붙인다 (llama-bins.test.ts 가 판이 맞는지 본다).
//   node scripts/llama-bins-pin.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLAMA_PACKAGES } from '../src/shared/llama-bins.ts';

const version = JSON.parse(
  readFileSync(new URL('../node_modules/node-llama-cpp/package.json', import.meta.url), 'utf8'),
).version;
const dir = mkdtempSync(join(tmpdir(), 'llama-pin-'));
try {
  console.log(`  version: '${version}',`);
  console.log('  packages: {');
  for (const pkg of Object.values(LLAMA_PACKAGES)) {
    const out = execFileSync('npm', ['pack', `@node-llama-cpp/${pkg}@${version}`, '--silent'], {
      cwd: dir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .pop();
    const buf = readFileSync(join(dir, out));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    console.log(`    '${pkg}': { sha256: '${sha256}', bytes: ${buf.length} },`);
  }
  console.log('  },');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
