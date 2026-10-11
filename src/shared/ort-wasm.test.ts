import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { ORT_WASM } from './ort-wasm.ts';

const pkg = new URL('../../node_modules/onnxruntime-web/', import.meta.url);

test('받는 엔진 wasm 이 묶음 안 onnxruntime-web 과 같은 판이다', () => {
  const version = JSON.parse(readFileSync(new URL('package.json', pkg), 'utf8')).version;
  assert.equal(ORT_WASM.version, version, 'onnxruntime-web 판을 올렸으면 src/shared/ort-wasm.ts 도 같이');
  const file = new URL(`dist/${ORT_WASM.name}`, pkg);
  assert.equal(statSync(file).size, ORT_WASM.bytes);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), ORT_WASM.sha256);
  for (const url of ORT_WASM.urls) {
    assert.ok(url.includes(`@${version}/`), url);
    assert.ok(url.endsWith(`/${ORT_WASM.name}`), url);
  }
  assert.ok(ORT_WASM.file.includes(version));
});
