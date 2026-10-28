import assert from 'node:assert/strict';
import test from 'node:test';
import { type CutStats, cutStats, needsIllustRetry, retryIsBetter } from './cut-retry.ts';

/** w x h 마스크에 네모 몇 개를 255 로 칠한다 */
function boxes(w: number, h: number, list: [number, number, number, number][]) {
  const m = new Uint8ClampedArray(w * h);
  for (const [x0, y0, x1, y1] of list)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255;
  return m;
}
const stats = (over: Partial<CutStats> = {}): CutStats => ({
  // 만화 햄스터를 사진 모델로 지운 값 (카드와 글자가 남음)
  kept: 0.38,
  main: 0.14,
  blobs: 19,
  stray: 0.63,
  edges: 0,
  ...over,
});

test('cutStats: 덩어리 하나는 조각이 없다', () => {
  const s = cutStats(boxes(100, 100, [[20, 20, 80, 80]]), 100, 100);
  assert.equal(s.blobs, 1);
  assert.equal(s.stray, 0);
  assert.equal(s.edges, 0);
  assert.ok(Math.abs(s.kept - 0.36) < 1e-9);
  assert.ok(Math.abs(s.main - 0.36) < 1e-9);
});

test('cutStats: 큰 덩어리 하나와 작은 덩어리 여럿이면 조각 비율을 잰다', () => {
  const small: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) small.push([2 + i * 12, 2, 8 + i * 12, 8]);
  const s = cutStats(boxes(100, 100, [[20, 30, 80, 90], ...small]), 100, 100);
  assert.equal(s.blobs, 6);
  assert.ok(s.stray > 0.04 && s.stray < 0.06);
});

test('cutStats: 가장자리에 닿은 변을 센다', () => {
  const s = cutStats(boxes(50, 50, [[0, 0, 50, 10]]), 50, 50);
  assert.equal(s.edges, 3);
});

test('cutStats: 먼지(0.02% 미만)는 덩어리로 세지 않는다', () => {
  const s = cutStats(
    boxes(200, 200, [
      [50, 50, 150, 150],
      [1, 1, 3, 3],
    ]),
    200,
    200,
  );
  assert.equal(s.blobs, 1);
});

test('needsIllustRetry: 덩어리 6개 이상 또는 조각 30% 이상일 때만', () => {
  assert.equal(needsIllustRetry(stats({ blobs: 3, stray: 0.1 })), false);
  assert.equal(needsIllustRetry(stats({ blobs: 6, stray: 0.1 })), true);
  assert.equal(needsIllustRetry(stats({ blobs: 2, stray: 0.3 })), true);
});

test('retryIsBetter: 만화 햄스터처럼 조각이 줄고 몸이 남으면 쓴다', () => {
  assert.equal(retryIsBetter(stats(), stats({ kept: 0.22, main: 0.12, blobs: 2, stray: 0.47 })), true);
});

test('retryIsBetter: 빈 결과는 막는다 (옅은 수채 그림)', () => {
  assert.equal(retryIsBetter(stats(), stats({ kept: 0, main: 0, blobs: 0, stray: 0 })), false);
});

test('retryIsBetter: 몸을 깎은 결과는 막는다', () => {
  assert.equal(retryIsBetter(stats(), stats({ kept: 0.1, main: 0.05, blobs: 1, stray: 0 })), false);
});

test('retryIsBetter: 종이나 카드를 더 남긴 결과는 막는다 (줄 공책, 틀)', () => {
  assert.equal(retryIsBetter(stats(), stats({ kept: 0.7, main: 0.65, blobs: 1, stray: 0 })), false);
  assert.equal(
    retryIsBetter(
      stats({ kept: 0.2, main: 0.2 }),
      stats({ kept: 0.25, main: 0.25, blobs: 1, stray: 0, edges: 4 }),
    ),
    false,
  );
});

test('retryIsBetter: 조각이 줄지 않았으면 처음 것을 지킨다', () => {
  assert.equal(
    retryIsBetter(stats({ blobs: 8, stray: 0.4 }), stats({ blobs: 8, stray: 0.4, main: 0.3 })),
    false,
  );
});
