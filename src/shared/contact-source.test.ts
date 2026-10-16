import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// 문의 이메일은 site/config.js 의 contactEmail 한 곳에만 둔다 (바꿀 때 한 줄만 고치게). 다른 곳에 적어 두면 여기서 실패한다.
test('문의 이메일이 site/config.js 밖에 적혀 있지 않다', () => {
  const r = spawnSync(process.execPath, ['site/tools/contact-check.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
