import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALK_SPEED } from '../../shared/behavior.ts';
import { continueSeg, STEP_MS, segDist, stepsAt, strideLen, type WalkSeg } from './walk-pace.ts';

test('보통 빠르기의 걸음 박자는 예전 그대로 (520ms)', () => {
  const seg: WalkSeg = { start: 0, dx: WALK_SPEED * 10, ms: 10_000, linear: true, steps0: 0 };
  assert.ok(Math.abs(stepsAt(seg, STEP_MS) - 1) < 1e-9);
});

test('보폭은 빠르기를 따라 단계 없이 커진다', () => {
  let prev = 0;
  for (let v = 10; v <= 400; v += 1) {
    const s = strideLen(v);
    assert.ok(s > prev);
    // 이웃 빠르기에서 툭 튀지 않는다 (예전엔 60px/초에서 박자가 확 바뀌었다)
    if (prev > 0) assert.ok(s - prev < 0.6, `${v}`);
    prev = s;
  }
  // 빠를수록 한 걸음 시간은 짧다
  assert.ok(strideLen(160) / 160 < strideLen(40) / 40);
});

test('걸음은 간 거리만큼: 천천히 출발하고 멈추는 걷기는 처음과 끝에 발도 천천히', () => {
  const seg: WalkSeg = { start: 0, dx: 100, ms: 2000, steps0: 0 };
  const early = stepsAt(seg, 200) - stepsAt(seg, 0);
  const mid = stepsAt(seg, 1100) - stepsAt(seg, 900);
  const late = stepsAt(seg, 2000) - stepsAt(seg, 1800);
  assert.ok(early < mid / 3 && late < mid / 3);
  assert.equal(segDist(seg, 2000), 100);
  assert.equal(segDist(seg, 5000), 100);
  // 같은 빠르기 걷기는 고르게
  const lin: WalkSeg = { ...seg, linear: true };
  assert.ok(Math.abs(stepsAt(lin, 200) - stepsAt(lin, 0) - (stepsAt(lin, 1100) - stepsAt(lin, 900))) < 1e-9);
});

test('같은 쪽으로 이어 받은 걷기는 걸음이 끊기지 않는다, 쪽이 바뀌면 새로', () => {
  const a: WalkSeg = { start: 0, dx: 224, ms: 1400, linear: true, steps0: 0 };
  const b = continueSeg(a, { start: 1040, dx: 224, ms: 1400, linear: true });
  assert.ok(b);
  if (b) assert.ok(Math.abs(stepsAt(b, 1040) - stepsAt(a, 1040)) < 1e-9);
  assert.equal(continueSeg(a, { start: 1040, dx: -224, ms: 1400, linear: true }), undefined);
  assert.equal(continueSeg(undefined, { start: 1040, dx: 224, ms: 1400 }), undefined);
});
