import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALK_SPEED } from '../../shared/behavior.ts';
import { continueSeg, footSlide, STEP_MS, segDist, stepsAt, strideLen, type WalkSeg } from './walk-pace.ts';

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

test('2D 디딘 발은 몸이 간 만큼 뒤로 밀려 바닥에서 미끄러지지 않는다', () => {
  // 딛는 반 걸음 동안 몸은 반 보폭을 간다: 발은 몸에 대해 반 보폭 뒤로 (바닥 자리 = 몸 + 발 = 그대로)
  for (let p = 0.5; p <= 1; p += 0.05) {
    const ground = p * 1 + footSlide(p, 0);
    assert.ok(Math.abs(ground - (0.5 + footSlide(0.5, 0))) < 1e-9, `${p}`);
  }
  // 든 발은 뒤에서 앞으로 이어진다 (끊김 없이)
  for (const at of [0, 0.5]) {
    let prev = footSlide(at, at);
    for (let p = 0.01; p <= 1.001; p += 0.01) {
      const v = footSlide(at + p, at);
      assert.ok(Math.abs(v - prev) < 0.03, `${at} ${p}`);
      prev = v;
    }
  }
});
