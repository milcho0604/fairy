import assert from 'node:assert/strict';
import test from 'node:test';
import { furRefine, paperCut } from './mask-refine.ts';

const W = 120;
const H = 100;

/** 종이색 바탕 위에 그리는 작은 도구 */
function paper(color: [number, number, number]) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 255;
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
      }
  };
  return { rgba, rect };
}
const maskOf = (x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8ClampedArray(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 255;
  return m;
};
const at = (m: ArrayLike<number>, x: number, y: number) => m[y * W + x] ?? 0;

test('paperCut: 옅은 칠과 선을 살리고 속 구멍을 메운다', () => {
  const { rgba, rect } = paper([238, 232, 216]);
  // 옅은 갈색 몸 (종이와 거리 약 50), 가운데에 종이색 구멍(흰 눈자리), 몸에서 뻗은 가는 선
  rect(35, 25, 85, 75, [200, 170, 140]);
  rect(55, 45, 62, 52, [238, 232, 216]);
  rect(85, 49, 105, 50, [180, 150, 120]);
  const out = paperCut(rgba, maskOf(30, 20, 90, 80), W, H);
  assert.ok(out);
  assert.equal(at(out, 45, 35), 255, '몸');
  assert.equal(at(out, 58, 48), 255, '속 구멍은 메운다');
  assert.ok(at(out, 92, 49) > 128, '가는 선도 살린다');
  assert.equal(at(out, 102, 49), 0, '지금 마스크 둘레 밖은 쓰지 않는다');
  assert.equal(at(out, 5, 5), 0, '종이');
});

test('paperCut: 지금 마스크에서 먼 곳은 쓰지 않는다 (종이째 남는 것 방지)', () => {
  const { rgba, rect } = paper([238, 232, 216]);
  rect(35, 25, 85, 75, [200, 170, 140]);
  rect(5, 5, 14, 14, [90, 90, 90]); // 먼 얼룩
  const out = paperCut(rgba, maskOf(35, 25, 85, 75), W, H);
  assert.ok(out);
  assert.equal(at(out, 9, 9), 0);
  assert.equal(at(out, 50, 40), 255);
});

test('paperCut: 가장자리 색이 제각각이면(사진 배경) 하지 않는다', () => {
  const { rgba } = paper([238, 232, 216]);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < 6; y++)
      for (let c = 0; c < 3; c++) rgba[(y * W + x) * 4 + c] = (x * 7 + c * 90) % 256;
  for (let x = 0; x < W; x++)
    for (let y = H - 6; y < H; y++)
      for (let c = 0; c < 3; c++) rgba[(y * W + x) * 4 + c] = (x * 11 + c * 50) % 256;
  assert.equal(paperCut(rgba, maskOf(30, 20, 90, 80), W, H), undefined);
});

test('paperCut: 종이와 같은 색뿐이면 빈 마스크', () => {
  const { rgba } = paper([238, 232, 216]);
  const out = paperCut(rgba, maskOf(30, 20, 90, 80), W, H);
  assert.ok(out);
  assert.equal(
    out.reduce((a, b) => a + b, 0),
    0,
  );
});

test('furRefine: 몸 속과 먼 바탕은 그대로, 가장자리 둘레만 바뀐다', () => {
  const { rgba, rect } = paper([20, 20, 20]);
  // 밝은 몸, 가장자리가 두 칸 흐린 마스크
  rect(40, 30, 80, 70, [220, 200, 180]);
  const m = maskOf(40, 30, 80, 70);
  for (const [x, y] of [
    [39, 50],
    [80, 50],
    [60, 29],
    [60, 70],
  ] as const)
    m[y * W + x] = 128;
  const out = furRefine(rgba, m, W, H);
  assert.equal(at(out, 60, 50), 255, '속');
  assert.equal(at(out, 3, 3), 0, '먼 바탕');
  assert.equal(out.length, m.length);
  let changed = 0;
  for (let i = 0; i < m.length; i++) if (out[i] !== m[i]) changed++;
  assert.ok(changed > 0, '가장자리는 바뀐다');
  // 사진 가장자리(밝은 몸 쪽)에 붙어 흐린 한 칸이 또렷해진다
  assert.ok(Math.abs(at(out, 80, 50) - 128) > 20, String(at(out, 80, 50)));
});

test('furRefine: 입력 마스크를 바꾸지 않는다', () => {
  const { rgba, rect } = paper([20, 20, 20]);
  rect(40, 30, 80, 70, [220, 200, 180]);
  const m = maskOf(40, 30, 80, 70);
  const copy = Uint8ClampedArray.from(m);
  furRefine(rgba, m, W, H);
  assert.deepEqual(m, copy);
});

test('paperCut: 몸이 사진 가장자리까지 닿아도(다시 오린 사진) 종이 색은 마스크 바깥에서 잰다', () => {
  const { rgba, rect } = paper([238, 232, 216]);
  // 왼쪽 아래 모서리부터 사진 가장자리 띠를 몸이 덮는다
  rect(0, 10, 70, 100, [200, 170, 140]);
  const out = paperCut(rgba, maskOf(0, 10, 70, 100), W, H);
  assert.ok(out);
  assert.equal(at(out, 30, 50), 255);
  assert.equal(at(out, 100, 50), 0, '종이');
});
