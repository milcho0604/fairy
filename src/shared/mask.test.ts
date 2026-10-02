import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brush, contentBox, keptRatio, outputToMask, stroke } from './mask.ts';

test('모델 출력을 0~255 로 편다, 시그모이드 선택', () => {
  assert.deepEqual([...outputToMask([0.2, 0.6, 1.0])], [0, 128, 255]);
  const s = outputToMask([-10, 0, 10], true);
  assert.equal(s[0], 0);
  assert.equal(s[2], 255);
  assert.ok((s[1] ?? 0) > 120 && (s[1] ?? 0) < 135);
  assert.deepEqual([...outputToMask([5, 5])], [0, 0]); // 다 같으면 0 으로 나누지 않는다
});

test('지우개: 가운데는 완전히, 가장자리는 부드럽게, 밖은 그대로', () => {
  const w = 21;
  const m = new Uint8ClampedArray(w * w).fill(255);
  brush(m, w, w, 10, 10, 8, 0);
  assert.equal(m[10 * w + 10], 0);
  const edge = m[10 * w + 17] ?? 0; // 가운데에서 7 떨어짐 (반지름 8, 부드러운 폭 2)
  assert.ok(edge > 0 && edge < 255, String(edge));
  assert.equal(m[0], 255);
});

test('복원 붓은 지운 곳을 되살린다', () => {
  const w = 10;
  const m = new Uint8ClampedArray(w * w);
  brush(m, w, w, 5, 5, 3, 255);
  assert.equal(m[5 * w + 5], 255);
  assert.equal(m[0], 0);
});

test('붓을 빨리 움직여도 선이 끊기지 않는다', () => {
  const w = 100;
  const m = new Uint8ClampedArray(w * 10).fill(255);
  stroke(m, w, 10, { x: 5, y: 5 }, { x: 95, y: 5 }, 3, 0);
  for (let x = 5; x <= 95; x++) assert.equal(m[5 * w + x], 0, `x=${x}`);
});

test('남긴 부분 사각형과 여유, 비었으면 없음', () => {
  const w = 100;
  const m = new Uint8ClampedArray(w * w);
  for (let y = 40; y < 60; y++) for (let x = 20; x < 80; x++) m[y * w + x] = 255;
  assert.deepEqual(contentBox(m, w, w, 16, 0), { x: 20, y: 40, width: 60, height: 20 });
  assert.deepEqual(contentBox(m, w, w, 16, 0.1), { x: 14, y: 34, width: 72, height: 32 });
  assert.equal(contentBox(new Uint8ClampedArray(16), 4, 4), undefined);
});

test('남긴 넓이 비율', () => {
  const m = new Uint8ClampedArray(4);
  m[0] = 255;
  m[1] = 200;
  assert.equal(keptRatio(m), 0.5);
});
