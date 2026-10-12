import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUICK_MAX_HEIGHT, QUICK_MIN_HEIGHT, quickHeight } from './quick-fit.ts';

test('빠른 입력 창 높이: 보통은 64, 확대하면 그만큼, 상한과 하한', () => {
  assert.equal(quickHeight(64, 1), 64);
  assert.equal(quickHeight(40, 1), QUICK_MIN_HEIGHT);
  assert.equal(quickHeight(64, 1.5), 96);
  assert.equal(quickHeight(64, 2), 128);
  assert.equal(quickHeight(90, 1.25), 113);
  assert.equal(quickHeight(64, 5), QUICK_MAX_HEIGHT);
  assert.equal(quickHeight(64, 0.5), QUICK_MIN_HEIGHT);
  for (const bad of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY])
    assert.equal(quickHeight(bad, 1), QUICK_MIN_HEIGHT);
  assert.equal(quickHeight(64, Number.NaN), QUICK_MIN_HEIGHT);
});
