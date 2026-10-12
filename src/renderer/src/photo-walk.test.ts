import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALK_CYCLE_STEPS, walkFrameIndex } from './photo-walk.ts';

test('걸음 수로 그림을 차례로 고르고 한 주기마다 처음으로 돈다', () => {
  const n = 8;
  const got = Array.from({ length: n * 2 }, (_, i) => walkFrameIndex((i * WALK_CYCLE_STEPS) / n, n));
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]);
});

test('주기 끝 바로 앞은 마지막 그림, 음수와 이상한 값은 범위 안', () => {
  assert.equal(walkFrameIndex(WALK_CYCLE_STEPS - 1e-9, 8), 7);
  assert.equal(walkFrameIndex(-0.25, 8), 7);
  assert.equal(walkFrameIndex(Number.NaN, 8), 0);
  assert.equal(walkFrameIndex(1, 0), 0);
  assert.equal(walkFrameIndex(Number.POSITIVE_INFINITY, 8), 0);
});
