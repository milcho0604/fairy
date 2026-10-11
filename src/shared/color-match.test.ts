import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorShift, MAX_FUR_SHIFT, matchColors, type Rgba } from './color-match.ts';

/** 흰 바탕 가운데 네모 펫 (색 fur, 위아래로 밝기 줄무늬) */
function pet(fur: [number, number, number], stripe = 20): Rgba {
  const w = 40;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= 10 && x < 30 && y >= 10 && y < 30;
      const s = y % 2 ? stripe : -stripe;
      for (let k = 0; k < 3; k++) data[i + k] = inside ? (fur[k] ?? 0) + s : 250;
      data[i + 3] = 255;
    }
  return { w, h, data };
}

const meanIn = (img: Rgba, k: number) => {
  let s = 0;
  let n = 0;
  for (let y = 10; y < 30; y++)
    for (let x = 10; x < 30; x++) {
      s += img.data[(y * img.w + x) * 4 + k] ?? 0;
      n++;
    }
  return s / n;
};

test('색 되돌리기: 회색빛으로 바뀐 털을 앞 그림 털색으로, 바탕은 그대로', () => {
  const ref = pet([200, 140, 90]);
  const target = pet([150, 130, 140]);
  assert.equal(matchColors(target, ref), true);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(meanIn(target, k) - meanIn(ref, k)) < 6, `채널 ${k}`);
  // 바탕(귀퉁이)은 그대로
  assert.deepEqual([...target.data.subarray(0, 3)], [250, 250, 250]);
});

test('색 되돌리기: 펫이 거의 없으면(바탕뿐) 손대지 않는다', () => {
  const blank = { w: 20, h: 20, data: new Uint8ClampedArray(20 * 20 * 4).fill(250) };
  const copy = blank.data.slice();
  assert.equal(matchColors(blank, pet([100, 100, 100])), false);
  assert.deepEqual(blank.data, copy);
});

test('색 거리: 조금 바랜 건 작고, 갈색이 흰색이 되면 커서 버린다', () => {
  assert.ok(colorShift(pet([200, 140, 90]), pet([190, 135, 95])) < 30);
  assert.ok(colorShift(pet([120, 70, 40]), pet([235, 235, 235])) > MAX_FUR_SHIFT);
});

test('이미지 검토: 밝은 바탕 위 흰 고양이가 회색, 분홍빛이 되면 거리를 제대로 재고 흰색으로 되돌린다', () => {
  const W = 40;
  const make = (fur: [number, number, number]) => {
    const data = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inside = (x - 20) ** 2 + (y - 20) ** 2 < 14 ** 2;
        const eye = inside && y === 17 && (x === 15 || x === 25);
        const c = eye ? [10, 10, 10] : inside ? fur : [246, 246, 246];
        data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], i);
      }
    return { w: W, h: W, data };
  };
  const before = make([252, 252, 252]);
  const after = make([240, 232, 235]);
  assert.ok(colorShift(after, before) > 25, String(colorShift(after, before)));
  assert.ok(matchColors(after, before));
  const i = (20 * W + 20) * 4;
  assert.ok(
    (after.data[i] ?? 0) > 248 && (after.data[i + 1] ?? 0) > 248,
    String([...after.data.subarray(i, i + 3)]),
  );
});

test('이미지 검토 2차: 털로 펫이 커져도, 바탕 밝기만 바뀌어도 거리 0. 갈색이 하얘지면 바탕이 바뀌어도 크게', () => {
  const W = 120;
  type C = [number, number, number];
  const make = (bg: C, body: C, grow = 0) => {
    const data = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const inside = (x - 60) ** 2 + (y - 60) ** 2 < (30 + grow) ** 2;
        const c = inside ? body : bg;
        data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
      }
    return { w: W, h: W, data };
  };
  const brown: C = [140, 90, 50];
  assert.equal(colorShift(make([250, 250, 250], brown, 6), make([250, 250, 250], brown)), 0);
  assert.equal(colorShift(make([238, 238, 238], brown), make([250, 250, 250], brown)), 0);
  assert.ok(colorShift(make([242, 242, 242], [245, 245, 245]), make([250, 250, 250], brown)) > MAX_FUR_SHIFT);
  // 맞추기가 바탕을 다시 칠하지 않는다
  const t = make([238, 238, 238], brown, 3);
  matchColors(t, make([250, 250, 250], brown));
  assert.deepEqual([...t.data.subarray(0, 3)], [238, 238, 238]);
});
