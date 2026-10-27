import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onboardingBounds, onboardingHeight } from './onboarding-layout.ts';

test('시작 안내 높이는 언어에 맞고 작업 영역을 넘지 않는다', () => {
  assert.equal(onboardingHeight(900, 'ko'), 580);
  assert.equal(onboardingHeight(900, 'en'), 664);
  assert.equal(onboardingHeight(500, 'ko'), 500);
  assert.equal(onboardingHeight(500, 'en'), 500);
});

test('언어 변경으로 높이가 바뀌면 가운데를 유지한다', () => {
  assert.deepEqual(
    onboardingBounds(
      { x: 200, y: 200, width: 480, height: 580 },
      { x: 0, y: 0, width: 1280, height: 900 },
      'en',
    ),
    { x: 200, y: 158, width: 480, height: 664 },
  );
});

test('작업 영역이 작거나 창이 가장자리 근처여도 안쪽에 배치한다', () => {
  assert.deepEqual(
    onboardingBounds(
      { x: 340, y: 450, width: 480, height: 580 },
      { x: 0, y: 0, width: 800, height: 500 },
      'en',
    ),
    { x: 320, y: 0, width: 480, height: 500 },
  );
});
