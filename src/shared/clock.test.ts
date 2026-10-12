import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh } from './clock.ts';

test('기다림 재기: 지난 시각만 센다. 미래 시각(시계가 뒤로 감)은 이미 지난 것으로 본다 (버그잡이 4)', () => {
  const now = 1_000_000_000;
  assert.equal(fresh(now - 10, now, 100), true);
  assert.equal(fresh(now - 100, now, 100), false);
  assert.equal(fresh(now, now, 100), true);
  // 기록한 뒤 시계가 하루 뒤로 가면 예전에는 하루 넘게 "아직"이었다
  assert.equal(fresh(now + 86_400_000, now, 3_600_000), false);
  assert.equal(fresh(Number.NaN, now, 100), false);
});
