import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brush, clampToAlpha, contentBox, defringe, keptRatio, outputToMask, stroke } from './mask.ts';

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

test('가장자리 바탕색 빼기: 흰 바탕이 섞인 반투명 털 끝을 털색으로, 속과 바탕은 그대로', () => {
  // 가로 9칸: 왼쪽 3칸 흰 바탕(지움), 가운데 3칸 반투명 가장자리(갈색 50% + 흰색 50%), 오른쪽 3칸 갈색 몸
  const w = 9;
  const h = 3;
  const brown = [110, 60, 30];
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = x < 3 ? 0 : x < 6 ? 0.5 : 1;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(a * (brown[k] ?? 0) + (1 - a) * 255);
      rgba[i * 4 + 3] = 255;
      mask[i] = Math.round(a * 255);
    }
  defringe(rgba, mask, w, h, 4);
  const at = (x: number, k: number) => rgba[(1 * w + x) * 4 + k] ?? 0;
  for (let k = 0; k < 3; k++) {
    // 가장자리는 털색으로 (반올림 몇 칸 오차)
    assert.ok(Math.abs(at(4, k) - (brown[k] ?? 0)) <= 3, `가장자리 ${k}: ${at(4, k)}`);
    // 몸과 바탕은 손대지 않는다
    assert.equal(at(7, k), brown[k]);
    assert.equal(at(1, k), 255);
  }
});

test('가장자리 바탕색 빼기: 이미 털색인 흐린 경계(붓 가장자리, 모델의 흐림)는 검게 만들지 않는다', () => {
  // 바탕(흰색, 마스크 0) 옆에 마스크만 흐리고 색은 순수 갈색인 칸들: 풀이대로면 검게 됐다
  const w = 12;
  const h = 3;
  const brown = [110, 60, 30];
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8ClampedArray(w * h);
  const ms = [0, 0, 0, 40, 128, 200, 255, 255, 255, 255, 255, 255];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const white = (ms[x] ?? 0) === 0;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = white ? 255 : (brown[k] ?? 0);
      rgba[i * 4 + 3] = 255;
      mask[i] = ms[x] ?? 0;
    }
  defringe(rgba, mask, w, h, 4);
  for (const x of [3, 4, 5])
    for (let k = 0; k < 3; k++) {
      const v = rgba[(1 * w + x) * 4 + k] ?? 0;
      assert.ok(Math.abs(v - (brown[k] ?? 0)) <= 24, `x=${x} k=${k}: ${v}`);
    }
});

test('이미지 검토: 모델이 거의 못 찾은 사진(흰 벽)은 빈 마스크, 이미 투명한 곳은 마스크에서도 지운다', () => {
  assert.deepEqual([...outputToMask([0.001, 0.01, 0.018])], [0, 0, 0]);
  assert.deepEqual([...outputToMask([0, 0.5, 0.9])], [0, 142, 255]);
  const rgba = new Uint8ClampedArray([0, 0, 0, 0, 9, 9, 9, 128, 9, 9, 9, 255]);
  assert.deepEqual([...clampToAlpha(new Uint8ClampedArray([200, 200, 200]), rgba)], [0, 128, 200]);
});
