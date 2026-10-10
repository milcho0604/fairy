import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepNativePackage } from './native-prune.ts';

test('네이티브 패키지 고르기: 이 운영체제와 칩 것만 둔다', () => {
  // Apple 칩 맥 앱
  assert.equal(keepNativePackage('mac-arm64-metal', 'darwin', 'arm64'), true);
  assert.equal(keepNativePackage('mac-x64', 'darwin', 'arm64'), false);
  assert.equal(keepNativePackage('koffi-darwin-arm64', 'darwin', 'arm64'), true);
  assert.equal(keepNativePackage('koffi-darwin-x64', 'darwin', 'arm64'), false);
  // 인텔 맥 앱
  assert.equal(keepNativePackage('mac-x64', 'darwin', 'x64'), true);
  assert.equal(keepNativePackage('mac-arm64-metal', 'darwin', 'x64'), false);
  // 윈도우 x64
  assert.equal(keepNativePackage('win-x64', 'win32', 'x64'), true);
  assert.equal(keepNativePackage('win-arm64', 'win32', 'x64'), false);
  assert.equal(keepNativePackage('koffi-win32-x64', 'win32', 'x64'), true);
  assert.equal(keepNativePackage('linux-x64', 'win32', 'x64'), false);
  // 리눅스
  assert.equal(keepNativePackage('linux-x64', 'linux', 'x64'), true);
  assert.equal(keepNativePackage('linux-armv7l', 'linux', 'x64'), false);
  assert.equal(keepNativePackage('linux-arm64', 'linux', 'x64'), false);
  assert.equal(keepNativePackage('reflink-linux-x64-gnu', 'linux', 'x64'), true);
  assert.equal(keepNativePackage('reflink-linux-x64-musl', 'darwin', 'arm64'), false);
  // 운영체제, 칩이 없는 본 패키지는 둔다
  assert.equal(keepNativePackage('reflink', 'darwin', 'arm64'), true);
});
