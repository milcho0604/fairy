import assert from 'node:assert/strict';
import test from 'node:test';
import { type ModelFile, pickModelFile } from './model-pick.ts';

const now: ModelFile = { file: 'new-fp16.onnx', url: 'u1', sha256: 'a', bytes: 1 };
const old: ModelFile = { file: 'old-fp32.onnx', url: 'u2', sha256: 'b', bytes: 2 };

test('옛 판이 있으면 옛 판을 그대로 쓴다 (다시 받지 않는다)', () => {
  assert.equal(
    pickModelFile(now, old, (f) => f === 'old-fp32.onnx'),
    old,
  );
});

test('옛 판이 없으면 새 판', () => {
  assert.equal(
    pickModelFile(now, old, () => false),
    now,
  );
});

test('둘 다 있으면 옛 판 (저장 공간에서 지우면 새 판으로 넘어간다)', () => {
  assert.equal(
    pickModelFile(now, old, () => true),
    old,
  );
});

test('옛 판 정의가 없으면 새 판', () => {
  assert.equal(
    pickModelFile(now, undefined, () => true),
    now,
  );
});
