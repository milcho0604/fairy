import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAZE_BOOST_POLL_MS, GAZE_FAR_POLL_MS, GAZE_POLL_MS, gazeAt, gazePollMs, sameGaze } from './gaze.ts';

const pet = { x: 1000, y: 700, width: 160, height: 160 };
// 머리 자리 (1080, 772)
const head = { x: 1080, y: 772 };

test('커서 쪽을 본다: 오른쪽, 왼쪽 위, 바로 아래', () => {
  assert.deepEqual(gazeAt(pet, { x: head.x + 200, y: head.y }), { x: 1, y: 0 });
  assert.deepEqual(gazeAt(pet, { x: head.x + 100, y: head.y - 10 }), { x: 0.5, y: 0 });
  assert.deepEqual(gazeAt(pet, { x: head.x - 200, y: head.y - 150 }), { x: -1, y: -1 });
  assert.deepEqual(gazeAt(pet, { x: head.x, y: head.y + 120 }), { x: 0, y: 1 });
});

test('멀거나 펫 위면 앞을 본다', () => {
  assert.equal(gazeAt(pet, { x: head.x + 500, y: head.y }), null);
  assert.equal(gazeAt(pet, { x: head.x + 5, y: head.y }), null);
  // 큰 펫은 더 멀리서도 본다 (크기의 3배)
  const big = { ...pet, width: 300, height: 300 };
  assert.notEqual(gazeAt(big, { x: big.x + 150 + 600, y: big.y + 135 }), null);
});

test('칸이 같으면 같다고 본다 (보내지 않는다)', () => {
  // 커서가 조금 움직여도 같은 칸이면 그대로
  assert.ok(
    sameGaze(gazeAt(pet, { x: head.x + 190, y: head.y }), gazeAt(pet, { x: head.x + 230, y: head.y + 5 })),
  );
  assert.ok(sameGaze(null, null));
  assert.ok(!sameGaze(null, { x: 0, y: 0 }));
  assert.ok(!sameGaze({ x: 1, y: 0 }, { x: 0.5, y: 0 }));
  // -0 이 남지 않는다
  assert.ok(Object.is(gazeAt(pet, { x: head.x, y: head.y - 120 })?.x, 0));
});

test('커서가 어느 펫이든 반경 두 배 안이면 촘촘히, 다 멀면 느슨히 본다', () => {
  // 160px 펫의 반경은 480(크기의 3배), 두 배는 960
  assert.equal(gazePollMs([pet], { x: head.x + 900, y: head.y }), GAZE_POLL_MS);
  assert.equal(gazePollMs([pet], { x: head.x + 1000, y: head.y }), GAZE_FAR_POLL_MS);
  const friend = { x: 2000, y: 700, width: 160, height: 160 };
  assert.equal(gazePollMs([pet, friend], { x: 2080 + 100, y: 772 }), GAZE_POLL_MS);
  assert.equal(gazePollMs([], { x: 0, y: 0 }), GAZE_FAR_POLL_MS);
});

test('부스트 모드: 가까우면 더 자주 보고, 칸을 잘게 나눈다', () => {
  assert.equal(gazePollMs([pet], { x: head.x + 100, y: head.y }, true), GAZE_BOOST_POLL_MS);
  assert.equal(gazePollMs([pet], { x: head.x + 1000, y: head.y }, true), GAZE_FAR_POLL_MS);
  // 보통은 0.5 칸 (100 / 80 = 1.25 -> 1 -> 0.5), 잘게는 0.25 칸 (2.5 -> 3 -> 0.75)
  assert.deepEqual(gazeAt(pet, { x: head.x + 100, y: head.y }), { x: 0.5, y: 0 });
  assert.deepEqual(gazeAt(pet, { x: head.x + 100, y: head.y }, true), { x: 0.75, y: 0 });
  assert.deepEqual(gazeAt(pet, { x: head.x + 200, y: head.y + 60 }, true), { x: 1, y: 0.5 });
  assert.deepEqual(gazeAt(pet, { x: head.x - 300, y: head.y - 300 }, true), { x: -1, y: -1 });
});
