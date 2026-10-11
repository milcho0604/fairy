import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  LLAMA_BINS,
  LLAMA_PACKAGES,
  llamaEntryTarget,
  llamaPackageFor,
  llamaTarballUrls,
} from './llama-bins.ts';

test('받는 엔진 판이 node-llama-cpp 와 같다 (다르면 엔진이 받은 패키지를 쓰지 않는다)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const lib = JSON.parse(
    readFileSync(new URL('../../node_modules/node-llama-cpp/package.json', import.meta.url), 'utf8'),
  );
  assert.equal(LLAMA_BINS.version, lib.version, 'node-llama-cpp 를 올렸으면 node scripts/llama-bins-pin.mjs');
  assert.equal(pkg.dependencies['node-llama-cpp'], LLAMA_BINS.version);
  for (const name of Object.values(LLAMA_PACKAGES)) {
    const pin = LLAMA_BINS.packages[name];
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, name);
    assert.ok(pin.bytes > 1_000_000, name);
    // node-llama-cpp 가 찾는 패키지 이름이어야 한다
    assert.ok(lib.optionalDependencies[`@node-llama-cpp/${name}`], name);
  }
});

test('운영체제-칩으로 엔진 패키지를 고른다', () => {
  assert.equal(llamaPackageFor('darwin', 'arm64'), 'mac-arm64-metal');
  assert.equal(llamaPackageFor('darwin', 'x64'), 'mac-x64');
  assert.equal(llamaPackageFor('linux', 'x64'), 'linux-x64');
  assert.equal(llamaPackageFor('win32', 'x64'), 'win-x64');
  assert.equal(llamaPackageFor('linux', 'arm64'), undefined);
});

test('주소는 판을 박은 npm 묶음이다', () => {
  for (const url of llamaTarballUrls('linux-x64')) {
    assert.ok(url.startsWith('https://'), url);
    assert.ok(url.endsWith(`/@node-llama-cpp/linux-x64/-/linux-x64-${LLAMA_BINS.version}.tgz`), url);
  }
});

test('묶음에서 엔진이 쓰는 것만 안전한 자리로 푼다', () => {
  const t = (n: string) => llamaEntryTarget(n, 'linux-x64');
  assert.equal(t('package/package.json'), 'package.json');
  assert.equal(t('package/dist/index.js'), 'dist/index.js');
  assert.equal(t('package/LICENSE'), 'LICENSE');
  assert.equal(t('package/bins/linux-x64/llama-addon.node'), 'bins/linux-x64/llama-addon.node');
  assert.equal(t('package/bins/linux-x64/_nlcBuildMetadata.json'), 'bins/linux-x64/_nlcBuildMetadata.json');
  assert.equal(t('package/bins/linux-x64/libggml-cpu-haswell.so'), 'bins/linux-x64/libggml-cpu-haswell.so');
  // 설치판에서 빼던 CPU 판, 설명서, 다른 폴더, 경로 넘기
  assert.equal(t('package/bins/linux-x64/libggml-cpu-ivybridge.so'), undefined);
  assert.equal(t('package/README.md'), undefined);
  assert.equal(t('package/bins/linux-arm64/llama-addon.node'), undefined);
  assert.equal(t('package/bins/linux-x64/../../../x.node'), undefined);
  assert.equal(t('package/bins/linux-x64/.hidden'), undefined);
  assert.equal(t('package/../evil'), undefined);
  assert.equal(t('other/package.json'), undefined);
  assert.equal(llamaEntryTarget('package/bins/win-x64/llama-addon.lib', 'win-x64'), undefined);
  assert.equal(
    llamaEntryTarget('package/bins/win-x64/ggml-cpu-zen4.dll', 'win-x64'),
    'bins/win-x64/ggml-cpu-zen4.dll',
  );
});
