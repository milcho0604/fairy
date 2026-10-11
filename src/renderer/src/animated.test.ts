import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_BUDGET, frameSide, planFrames } from './animated.ts';

const bytes = (p: { width: number; height: number }, count: number, step: number) =>
  Math.ceil(count / step) * p.width * p.height * 4;

test('풀 크기: 펫 크기 × 화면 배율 (사진은 160 중 140), 작아도 256 까지는', () => {
  assert.equal(frameSide(160, 1), 256);
  assert.equal(frameSide(480, 1), 420);
  assert.equal(frameSide(480, 2), 840);
});

test('작은 그림은 다 푼다', () => {
  assert.deepEqual(planFrames({ count: 20, width: 200, height: 150, frameMs: 100, side: 420 }), {
    step: 1,
    width: 200,
    height: 150,
  });
});

test('보이지 않는 촘촘한 프레임(초당 12장 넘게)은 덜어 낸다', () => {
  assert.equal(planFrames({ count: 60, width: 100, height: 100, frameMs: 33, side: 256 }).step, 2);
  assert.equal(planFrames({ count: 60, width: 100, height: 100, frameMs: 16, side: 256 }).step, 5);
});

test('90 프레임 큰 gif: 예산 안에 들고, 적어도 24 장은 남긴다', () => {
  for (const side of [256, 420, 840]) {
    const p = planFrames({ count: 90, width: 1000, height: 800, frameMs: 100, side });
    assert.ok(bytes(p, 90, p.step) <= FRAME_BUDGET, `side ${side}: ${bytes(p, 90, p.step)}`);
    assert.ok(Math.ceil(90 / p.step) >= 24, `side ${side}: step ${p.step}`);
    assert.ok(Math.max(p.width, p.height) <= side);
    // 가로세로 비율은 그대로
    assert.ok(Math.abs(p.width / p.height - 1.25) < 0.02);
  }
  // 예전(480px 로 90장 = 83MB) 보다 작다
  const old = planFrames({ count: 90, width: 600, height: 600, frameMs: 100, side: 480 });
  assert.ok(bytes(old, 90, old.step) <= FRAME_BUDGET);
});
