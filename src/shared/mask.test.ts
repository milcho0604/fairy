import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  brush,
  clampToAlpha,
  contentBox,
  defringe,
  dropFaint,
  edgeTouch,
  FAINT_ALPHA,
  HOLLOW_GAIN,
  HOLLOW_GAIN_DRAWING,
  halfKeptShare,
  halfPatch,
  hollowGain,
  keepSure,
  keptMass,
  keptRatio,
  letterbox,
  maskHints,
  outputToMask,
  petOnly,
  pickPet,
  refineBox,
  SOLID_FROM,
  solidify,
  stroke,
  trimHalo,
} from './mask.ts';

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

test('dropFaint: 바탕에 남은 옅은 값만 0, 그 위는 그대로 (몸이 더 비치지 않게)', () => {
  const m = dropFaint(Uint8ClampedArray.from([0, 1, 29, FAINT_ALPHA, FAINT_ALPHA + 1, 128, 255]));
  assert.deepEqual([...m], [0, 0, 0, 0, FAINT_ALPHA + 1, 128, 255]);
});

test('dropFaint 뒤의 contentBox 는 옅은 바탕 얼룩을 둘러싸지 않는다', () => {
  const w = 100;
  const m = new Uint8ClampedArray(w * w).fill(28); // 사진 전체에 옅은 얼룩
  for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) m[y * w + x] = 255;
  assert.deepEqual(contentBox(m, w, w, 16, 0), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(contentBox(dropFaint(m), w, w, 16, 0), { x: 40, y: 40, width: 20, height: 20 });
});

test('letterbox: 늘이지 않고 정사각 가운데에', () => {
  assert.deepEqual(letterbox(4000, 400, 1024), { x: 0, y: 461, width: 1024, height: 102 });
  assert.deepEqual(letterbox(680, 800, 1024), { x: 77, y: 0, width: 870, height: 1024 });
  assert.deepEqual(letterbox(64, 64, 1024), { x: 0, y: 0, width: 1024, height: 1024 });
});

test('halfKeptShare: 남긴 곳 가운데 반투명 비율 (지운 곳은 세지 않는다)', () => {
  assert.equal(halfKeptShare(Uint8ClampedArray.from([0, 0, 255, 255, 128, 100])), 0.5);
  assert.equal(halfKeptShare(new Uint8ClampedArray(4)), 0);
});

test('refineBox: 작은 펫만 둘레를 여유 있게 다시 오린다', () => {
  assert.equal(refineBox(undefined, 100, 100), undefined);
  assert.equal(refineBox({ x: 10, y: 10, width: 80, height: 60 }, 100, 100), undefined);
  assert.deepEqual(refineBox({ x: 40, y: 40, width: 20, height: 10 }, 100, 100), {
    x: 36,
    y: 36,
    width: 28,
    height: 18,
  });
  // 가장자리에서는 사진 밖으로 나가지 않는다
  assert.deepEqual(refineBox({ x: 0, y: 95, width: 10, height: 5 }, 100, 100), {
    x: 0,
    y: 93,
    width: 12,
    height: 7,
  });
});

/** w x h 마스크에 네모 칠하기 */
function rect(m: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = v;
}

test('refineBox: minSide 만큼은 둘레 사진째 잡는다 (작은 칸을 모델 입력까지 7배로 키우지 않게), 사진 거의 전체면 없음', () => {
  assert.deepEqual(refineBox({ x: 480, y: 480, width: 60, height: 60 }, 1024, 1024, 0.5, 0.2, 512), {
    x: 254,
    y: 254,
    width: 512,
    height: 512,
  });
  // 가장자리에 붙으면 안쪽으로 민다
  assert.deepEqual(refineBox({ x: 0, y: 980, width: 40, height: 40 }, 1024, 1024, 0.5, 0.2, 512), {
    x: 0,
    y: 512,
    width: 512,
    height: 512,
  });
  // 사진이 작아서 넓히면 거의 전체: 다시 오려도 처음과 같다
  assert.equal(refineBox({ x: 40, y: 40, width: 30, height: 30 }, 100, 100, 0.5, 0.2, 512), undefined);
});

test('pickPet: 사진 너비를 덮는 바탕 띠(여러 조각)보다 가운데 펫을 고르고, 따로 남은 덩어리를 센다', () => {
  const w = 200;
  const h = 120;
  const m = new Uint8ClampedArray(w * h);
  // 위쪽 나무 줄: 끊긴 두 조각, 펫보다 크다
  rect(m, w, 5, 20, 95, 35, 255);
  rect(m, w, 100, 20, 199, 35, 255);
  // 펫
  rect(m, w, 110, 60, 140, 100, 255);
  const pick = pickPet(m, w, h);
  assert.ok(pick);
  assert.equal(pick.main.x0, 110);
  assert.equal(pick.pets.length, 1);
  assert.equal(pick.others, 2);
  assert.ok(pick.box.x <= 110 && pick.box.x + pick.box.width >= 140);
  // 펫 덩어리만 남긴 마스크
  const only = petOnly(m, pick);
  assert.equal(only[25 * w + 50], 0);
  assert.equal(only[80 * w + 120], 255);
});

test('pickPet: 비슷한 크기의 펫 둘은 같이 둔다', () => {
  const w = 200;
  const m = new Uint8ClampedArray(w * w);
  rect(m, w, 40, 80, 80, 120, 255);
  rect(m, w, 120, 80, 165, 125, 255);
  const pick = pickPet(m, w, w);
  assert.equal(pick?.pets.length, 2);
  assert.equal(pick?.others, 0);
  assert.deepEqual(pick && [pick.box.x < 40, pick.box.x + pick.box.width > 165], [true, true]);
});

test('keptMass, keepSure: 다시 오린 것이 확실한 몸을 지켰는지 알파 합으로 재고, 뭉텅이로 빠진 몸만 되살린다', () => {
  const w = 40;
  const first = new Uint8ClampedArray(w * w);
  rect(first, w, 10, 10, 30, 30, 255);
  const box = { x: 0, y: 0, width: w, height: w };
  // 그대로
  assert.equal(keptMass(first, w, box, first, w, w), 1);
  // 아랫몸 절반이 빠짐 (넓이로는 윤곽이 남아도 알파 합으로 잡는다)
  const second = new Uint8ClampedArray(first);
  rect(second, w, 10, 20, 30, 30, 4);
  assert.ok(keptMass(first, w, box, second, w, w) < 0.6);
  const back = keepSure(first, w, box, second, w, w);
  assert.equal(back[25 * w + 20], 255);
  // 두 배 크기로 다시 오린 것도 칸을 맞춰 잰다
  const big = new Uint8ClampedArray(80 * 80);
  rect(big, 80, 20, 20, 60, 60, 255);
  assert.ok(Math.abs(keptMass(first, w, box, big, 80, 80) - 1) < 0.02);
  // 작은 조각(안개의 진한 조각)은 되살리지 않는다
  const halo = new Uint8ClampedArray(first);
  halo[5 * w + 5] = 240;
  const fixed = keepSure(halo, w, box, first, w, w);
  assert.equal(fixed[5 * w + 5], 0);
});

test('trimHalo: 몸 둘레를 감싼 반투명 안개는 걷고, 털 끝과 한쪽에만 붙은 흐린 몸은 둔다', () => {
  const w = 120;
  const ring = new Uint8ClampedArray(w * w);
  rect(ring, w, 32, 32, 98, 98, 110); // 펫 둘레 네모 안개
  rect(ring, w, 40, 40, 90, 90, 255); // 몸
  const out = trimHalo(ring, w, w);
  assert.equal(out[33 * w + 65], 0); // 몸에서 먼 안개
  assert.equal(out[39 * w + 65], 110); // 몸 바로 옆 (털 끝)
  assert.equal(out[65 * w + 65], 255);
  const ghost = new Uint8ClampedArray(w * w);
  rect(ghost, w, 40, 20, 80, 60, 255); // 머리
  rect(ghost, w, 40, 60, 80, 100, 120); // 흐린 아랫몸 (아래쪽에만)
  assert.deepEqual([...trimHalo(ghost, w, w)], [...ghost]);
});

test('halfPatch: 가장자리의 얇은 반투명 띠는 빼고, 반쯤 비친 뭉치(팔 하나)는 잰다', () => {
  const w = 100;
  const m = new Uint8ClampedArray(w * w);
  rect(m, w, 20, 20, 80, 80, 120); // 2칸 띠가 될 둘레
  rect(m, w, 22, 22, 78, 78, 255);
  assert.equal(halfPatch(m, w, w), 0);
  rect(m, w, 30, 30, 50, 50, 120); // 비친 팔
  assert.ok(halfPatch(m, w, w) >= 15 * 15);
});

test('edgeTouch, maskHints: 사진 끝에 닿은 펫, 사진 속 작은 펫은 "거의 다 지워짐"이 아니다', () => {
  const w = 400;
  const small = new Uint8ClampedArray(w * w);
  rect(small, w, 190, 190, 212, 215, 255); // 남긴 넓이 0.3%
  const hints = maskHints(small, w, w);
  assert.equal(hints.empty, false);
  assert.equal(hints.cut, false);
  assert.equal(edgeTouch(small, w, w), 0);
  const cut = new Uint8ClampedArray(w * w);
  rect(cut, w, 100, 200, 300, 400, 255);
  assert.equal(edgeTouch(cut, w, w), 0.5);
  assert.equal(maskHints(cut, w, w).cut, true);
  assert.equal(maskHints(new Uint8ClampedArray(w * w), w, w).empty, true);
  // 바탕 띠는 따로 남은 것으로 세고, 반투명 안내는 펫 둘레만 본다
  const band = new Uint8ClampedArray(w * w);
  rect(band, w, 0, 40, 400, 80, 150);
  rect(band, w, 0, 50, 400, 70, 255);
  rect(band, w, 180, 200, 230, 260, 255);
  const hb = maskHints(band, w, w);
  assert.equal(hb.others, 1);
  assert.equal(hb.half, false);
});

test('defringe: 밝은 벽 앞 어두운 펫의 바탕색 반투명 칸은 알파를 낮추고, 붉은 바탕이 번진 가장자리는 몸색으로', () => {
  const w = 16;
  const h = 9;
  const wall = [235, 235, 230];
  const dark = [60, 40, 30];
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // 0~5 벽(지움), 6 은 벽색인데 마스크 80 (테두리), 7~ 몸
      const c = x <= 6 ? wall : dark;
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = c[k] ?? 0;
      rgba[i * 4 + 3] = 255;
      mask[i] = x <= 5 ? 0 : x === 6 ? 80 : 255;
    }
  const alpha = defringe(rgba, mask, w, h, 4);
  assert.ok((alpha[4 * w + 6] ?? 0) < 30, String(alpha[4 * w + 6]));
  assert.equal(alpha[4 * w + 10], 255);

  // 붉은 바탕 앞 흰 인형: 꽉 남긴 경계 칸에도 붉은빛이 번져 있다
  const red = [200, 60, 60];
  const white = [230, 230, 230];
  const pink = [215, 180, 180];
  const rgba2 = new Uint8ClampedArray(w * h * 4);
  const mask2 = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = x <= 5 ? red : x === 6 ? pink : white;
      for (let k = 0; k < 3; k++) rgba2[i * 4 + k] = c[k] ?? 0;
      rgba2[i * 4 + 3] = 255;
      mask2[i] = x <= 5 ? 0 : 255;
    }
  defringe(rgba2, mask2, w, h, 4);
  const g = rgba2[(4 * w + 6) * 4 + 1] ?? 0;
  assert.ok(g > 215, `경계 칸 초록 ${g}`);
  assert.equal(rgba2[(4 * w + 12) * 4 + 1], 230);
});

test('hollowGain: 테두리 선만 남고 몸 안쪽이 지워진 그림을 잡는다 (끊긴 테두리여도), 꽉 찬 몸과 다리 사이는 아니다', () => {
  const w = 200;
  const disc = new Uint8ClampedArray(w * w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) if (Math.hypot(x - 100, y - 100) < 70) disc[y * w + x] = 255;
  assert.ok(hollowGain(disc, w, w, 6) < 0.02);
  // 아래 반은 테두리 선(3칸)만, 그것도 군데군데 끊김
  const hollow = new Uint8ClampedArray(disc);
  for (let y = 100; y < w; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 100, y - 100);
      const onLine = d >= 67 && d < 70 && Math.floor(Math.atan2(y - 100, x - 100) * 40) % 4 !== 0;
      if (d < 70) hollow[y * w + x] = onLine ? 255 : 0;
    }
  assert.ok(hollowGain(hollow, w, w, 6) > 0.08, String(hollowGain(hollow, w, w, 6)));
  assert.equal(maskHints(hollow, w, w).hollow, true);
  assert.equal(maskHints(disc, w, w).hollow, false);
  // 바닥에 닿은 두 다리 사이 틈은 메우지 않는다 (사진 밖은 빈 곳)
  const legs = new Uint8ClampedArray(w * w);
  rect(legs, w, 40, 40, 160, 120, 255);
  rect(legs, w, 40, 120, 70, 200, 255);
  rect(legs, w, 130, 120, 160, 200, 255);
  assert.ok(hollowGain(legs, w, w, 6) < 0.02, String(hollowGain(legs, w, w, 6)));
});

/** 가운데 둥근 몸: 안은 inner, 바깥 edge 칸 띠는 0 에서 오르는 털 끝 */
function disc(w: number, r: number, inner: number, edge = 3): Uint8ClampedArray {
  const m = new Uint8ClampedArray(w * w);
  const c = w / 2;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d < r - edge) m[y * w + x] = inner;
      else if (d < r) m[y * w + x] = Math.min(inner, Math.round(((r - d) / edge) * 255));
    }
  return m;
}

test('solidify: 반쯤 비친 몸 속(190~245)은 꽉 채우고, 가장자리 털 끝과 더 옅은 속은 둔다', () => {
  const w = 200;
  const c = 100 * w + 100;
  // 흰 바탕 흰 고양이처럼 몸 속이 200 쯤
  const m = disc(w, 80, 200);
  const out = solidify(m, w, w);
  assert.equal(out[c], 255);
  // 가장자리 2%(160*0.02 = 3칸) 안쪽 띠는 그대로: 털 끝이 딱딱해지지 않는다
  const rim = 100 * w + 100 + 78;
  assert.equal(out[rim], m[rim]);
  // 띠에서 안으로 조금씩 오른다 (꽉 찬 곳과 둘레 사이에 선이 없다)
  const row = [...out.slice(100 * w + 100 + 70, 100 * w + 100 + 80)];
  for (let i = 1; i < row.length; i++) assert.ok((row[i] ?? 0) <= (row[i - 1] ?? 0), row.join(','));
  // 원본은 그대로
  assert.equal(m[c], 200);
  // 흰 벽 앞 흰 고양이의 흐린 아랫몸(90~130)은 몸인지 몰라 둔다
  const faint = disc(w, 80, 120);
  assert.deepEqual([...solidify(faint, w, w)], [...faint]);
  // 경계(SOLID_FROM) 바로 위는 조금만
  const near = solidify(disc(w, 80, SOLID_FROM + 5), w, w);
  assert.ok((near[c] ?? 0) > SOLID_FROM + 5 && (near[c] ?? 0) < 255);
  // 이미 꽉 찬 몸(털 끝만 반투명), 빈 마스크는 그대로
  const full = disc(w, 80, 255);
  assert.deepEqual([...solidify(full, w, w)], [...full]);
  const none = new Uint8ClampedArray(w * w);
  assert.equal(solidify(none, w, w), none);
});

test('solidify: 다리 사이 빈 틈 둘레는 가장자리로 보고 둔다', () => {
  const w = 200;
  const m = disc(w, 80, 210);
  // 몸 가운데 세로로 빈 틈 (다리 사이)
  for (let y = 60; y < 200; y++) for (let x = 98; x < 102; x++) m[y * w + x] = 0;
  const out = solidify(m, w, w);
  // 틈 바로 옆은 그대로, 틈에서 멀리 떨어진 속은 꽉
  assert.equal(out[120 * w + 103], 210);
  assert.equal(out[120 * w + 140], 255);
  assert.equal(out[120 * w + 100], 0);
});

test('maskHints hollowAt: 그림용 기준은 오목한 몸의 0.1 쯤은 넘기고, 속을 지운 그림(0.4 이상)은 여전히 잡는다', () => {
  const w = 240;
  const h = 120;
  // 좁게 깊이 파인 틈이 둘 있는 몸 (두 캐릭터 사이 틈, 다리 사이): 닫으면 파인 곳이 메워져 0.08 을 넘지만 속이 빈 것은 아니다
  const cShape = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 110; y++)
    for (let x = 20; x < 220; x++) {
      const notch = ((x > 80 && x < 96) || (x > 140 && x < 156)) && y > 40 && y < 110;
      if (!notch) cShape[y * w + x] = 255;
    }
  const gain = hollowGain(cShape, w, h, 220 * 0.04);
  assert.ok(gain > HOLLOW_GAIN && gain < HOLLOW_GAIN_DRAWING, String(gain));
  assert.equal(maskHints(cShape, w, h).hollow, true);
  assert.equal(maskHints(cShape, w, h, { hollowAt: HOLLOW_GAIN_DRAWING }).hollow, false);
  // 아래 반이 테두리 선만 남은 몸은 그림용 기준으로도 잡힌다
  const ring = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 120, y - 60);
      if (d < 55 && (y < 60 || d >= 51)) ring[y * w + x] = 255;
    }
  assert.ok(hollowGain(ring, w, h, 110 * 0.04) > HOLLOW_GAIN_DRAWING);
  assert.equal(maskHints(ring, w, h, { hollowAt: HOLLOW_GAIN_DRAWING }).hollow, true);
});
