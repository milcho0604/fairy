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
