import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewer, parseVersion, readRelease } from './version.ts';

test('버전 읽기와 비교', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('0.10.0-beta.1'), [0, 10, 0]);
  assert.equal(parseVersion('최신'), undefined);
  assert.equal(isNewer('0.2.0', '0.1.9'), true);
  assert.equal(isNewer('v0.10.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
  assert.equal(isNewer('이상함', '0.1.0'), false);
});

test('릴리스 응답: 초안, 미리보기, 다른 주소는 버린다', () => {
  const ok = { tag_name: 'v0.2.0', html_url: 'https://github.com/a/b/releases/tag/v0.2.0' };
  assert.deepEqual(readRelease(ok), { version: '0.2.0', url: ok.html_url });
  assert.equal(readRelease({ ...ok, draft: true }), undefined);
  assert.equal(readRelease({ ...ok, prerelease: true }), undefined);
  assert.equal(readRelease({ ...ok, html_url: 'https://evil.example/x' }), undefined);
  assert.equal(readRelease({ message: 'Not Found' }), undefined);
  assert.equal(readRelease(null), undefined);
});
