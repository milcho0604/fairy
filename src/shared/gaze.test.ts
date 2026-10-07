import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gazeAt, sameGaze } from './gaze.ts';

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
