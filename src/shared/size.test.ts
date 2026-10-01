import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampScale, resizeFromBottomCenter, scaleByStep, scaleByWheel } from './size.ts';

test('배율은 50%~300% 안, 깨진 값은 100%', () => {
  assert.equal(clampScale(0.1), 0.5);
  assert.equal(clampScale(9), 3);
  assert.equal(clampScale(Number.NaN), 1);
  assert.equal(clampScale(1.234), 1.23);
});

test('휠을 위로 한 칸 굴리면 10% 커지고 아래로 굴리면 작아진다', () => {
  assert.equal(scaleByWheel(1, -100), 1.1);
  assert.equal(scaleByWheel(1, 100), 0.91);
  assert.equal(scaleByWheel(3, -100), 3);
});

test('트랙패드처럼 잘게 오면 조금만 바뀐다', () => {
  const s = scaleByWheel(1, -10);
  assert.ok(s > 1 && s < 1.02, String(s));
});

test('단축키 한 번은 한 칸', () => {
  assert.equal(scaleByStep(1, 1), 1.1);
  assert.equal(scaleByStep(1, -1), 0.91);
});

test('커지거나 작아져도 발(아래 가운데)은 제자리', () => {
  const before = { x: -176, y: 783, width: 160, height: 160 };
  const after = resizeFromBottomCenter(before, 320);
  assert.deepEqual(after, { x: -256, y: 623, width: 320, height: 320 });
  assert.equal(after.x + after.width / 2, before.x + before.width / 2);
  assert.equal(after.y + after.height, before.y + before.height);
});
