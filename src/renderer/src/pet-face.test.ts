import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fadeBelow, headCut, neckOf, opaqueRect, solidRect, squareAround } from './pet-face.ts';

/** w×h 투명 그림에 불투명 사각형들을 칠한 RGBA */
function paint(
  w: number,
  h: number,
  boxes: [number, number, number, number][],
  alpha = 255,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (const [x0, y0, x1, y1] of boxes)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[(y * w + x) * 4 + 3] = alpha;
  return px;
}

test('불투명한 부분 상자: 옅은 그림자(알파 0.16)는 빼고, 다 비면 undefined', () => {
  const px = paint(20, 20, [[5, 4, 9, 12]]);
  // 바닥 그림자
  for (let x = 2; x < 18; x++) px[(18 * 20 + x) * 4 + 3] = 41;
  assert.deepEqual(solidRect(px, 20, 20), { x0: 5, y0: 4, x1: 9, y1: 12 });
  assert.equal(solidRect(paint(10, 10, []), 10, 10), undefined);
  // 띠만 보기
  assert.deepEqual(
    solidRect(
      paint(20, 20, [
        [2, 2, 4, 4],
        [10, 10, 16, 16],
      ]),
      20,
      20,
      8,
    ),
    {
      x0: 10,
      y0: 10,
      x1: 16,
      y1: 16,
    },
  );
});

test('목 짐작: 동그란 몸은 목이 없고, 머리 아래 좁아졌다 넓어지면 거기가 목 (몸이 머리보다 넓어도)', () => {
  const round = paint(40, 40, [[5, 8, 35, 36]]);
  const body = solidRect(round, 40, 40);
  assert.ok(body);
  assert.equal(neckOf(round, 40, body), undefined);

  // 귀 (4~8줄), 머리 (8~24), 좁은 목 (24~26), 머리보다 넓은 몸 (26~80)
  const tall = paint(60, 90, [
    [18, 4, 22, 8],
    [38, 4, 42, 8],
    [16, 8, 44, 24],
    [24, 24, 36, 26],
    [10, 26, 50, 80],
  ]);
  const b = solidRect(tall, 60, 90);
  assert.ok(b);
  const neck = neckOf(tall, 60, b);
  assert.ok(neck !== undefined && neck >= 24 && neck < 26, `목 줄 ${neck}`);
});

test('자를 줄: 늘어진 귀 끝은 목이 아니다, 머리 너비만큼은 남긴다 (초코 얼굴이 코 밑에서 잘림)', () => {
  // 곱슬 머리 꼭대기 (2~10), 머리와 양옆으로 늘어진 귀 (10~40, 너비 56), 귀 아래 입과 혀 (40~56, 너비 24),
  // 그 아래 넓어지는 가슴과 몸 (56~100)
  const poodle = paint(70, 104, [
    [25, 2, 45, 10],
    [7, 10, 63, 40],
    [23, 40, 47, 56],
    [15, 56, 55, 100],
  ]);
  const b = solidRect(poodle, 70, 104);
  assert.ok(b);
  const neck = neckOf(poodle, 70, b);
  assert.ok(neck !== undefined && neck < 56, `목 짐작은 입 언저리 ${neck}`);
  const cut = headCut(poodle, 70, b);
  // 맨 위(2)에서 머리 너비(56)까지: 혀 끝(56)이 남는다
  assert.equal(cut, 58);

  // 귀가 선 고양이: 목이 머리 너비보다 깊으면 목 그대로
  const cat = paint(60, 120, [
    [16, 4, 22, 14],
    [38, 4, 44, 14],
    [14, 14, 46, 50],
    [24, 50, 36, 54],
    [8, 54, 52, 118],
  ]);
  const c = solidRect(cat, 60, 120);
  assert.ok(c);
  assert.equal(headCut(cat, 60, c), neckOf(cat, 60, c));

  // 넓적한 얼굴 (머리 너비 90 이 머리 키보다 크다): 목 아래 넓은 몸통까지 내려가지 않는다
  const wide = paint(130, 210, [
    [25, 10, 35, 22],
    [95, 10, 105, 22],
    [20, 22, 110, 70],
    [45, 70, 85, 76],
    [10, 76, 120, 200],
  ]);
  const wb = solidRect(wide, 130, 210);
  assert.ok(wb);
  const wn = neckOf(wide, 130, wb);
  const wc = headCut(wide, 130, wb);
  assert.ok(wn !== undefined && wc !== undefined && wc <= 76, `넓적한 얼굴 자를 줄 ${wc}, 목 ${wn}`);

  // 귀가 옆으로 퍼진 그림: 바닥까지 가 버려도 자르지 않는 게 아니라 목에서 자른다
  const ears = paint(140, 130, [
    [10, 10, 130, 20],
    [40, 20, 100, 60],
    [55, 60, 85, 64],
    [30, 64, 110, 120],
  ]);
  const eb = solidRect(ears, 140, 130);
  assert.ok(eb);
  assert.equal(headCut(ears, 140, eb), neckOf(ears, 140, eb));

  // 동그란 몸은 자르지 않는다
  const round = paint(40, 40, [[5, 8, 35, 36]]);
  const r = solidRect(round, 40, 40);
  assert.ok(r);
  assert.equal(headCut(round, 40, r), undefined);
});

test('목 아래 지우기: 위는 그대로, 경계는 부드럽게, 아래는 투명', () => {
  const px = paint(4, 20, [[0, 0, 4, 20]]);
  fadeBelow(px, 4, 20, 10, 2);
  const a = (y: number) => px[(y * 4 + 1) * 4 + 3];
  assert.equal(a(5), 255);
  assert.equal(a(19), 0);
  assert.equal(a(13), 0);
  const mid = a(10) ?? 0;
  assert.ok(mid > 0 && mid < 255, `경계 ${mid}`);
});

test('정사각형: 긴 변에 여백을 붙이고 가운데를 맞춘다', () => {
  const sq = squareAround({ x0: 10, y0: 0, x1: 30, y1: 40 }, 0.05);
  assert.equal(sq.side, 44);
  assert.equal(sq.x + sq.side / 2, 20);
  assert.equal(sq.y + sq.side / 2, 20);
});

/** w×h 불투명 바탕(bg)에 다른 색 사각형들 */
function opaque(w: number, h: number, bg: number[], boxes: [number, number, number, number, number[]][]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4);
  for (const [x0, y0, x1, y1, c] of boxes)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([...c, 255], (y * w + x) * 4);
  return px;
}

test('불투명 바탕 그림: 바탕색과 다른 곳을 감싸고, 투명한 그림은 손대지 않는다', () => {
  // 흰 바탕 가운데 작은 검은 고양이 (검은 털도 펫이다)
  const cat = opaque(100, 80, [250, 250, 250], [[40, 30, 60, 55, [20, 20, 20]]]);
  assert.deepEqual(opaqueRect(cat, 100, 80), { x0: 40, y0: 30, x1: 60, y1: 55 });
  // 한 점짜리 티끌은 펫이 아니다
  const speck = opaque(
    100,
    80,
    [250, 250, 250],
    [
      [40, 30, 60, 55, [20, 20, 20]],
      [5, 5, 6, 6, [200, 60, 60]],
      // 세로로 긴 티끌 (진행 막대 끝)
      [8, 10, 9, 20, [200, 60, 60]],
    ],
  );
  assert.deepEqual(opaqueRect(speck, 100, 80), { x0: 40, y0: 30, x1: 60, y1: 55 });
  // 귀퉁이가 투명하면 알파로 찾는다
  assert.equal(opaqueRect(paint(20, 20, [[5, 5, 15, 15]]), 20, 20), undefined);
  // 귀퉁이 색이 제각각(사진 바탕)이면 가운데 정사각형
  const photo = opaque(100, 60, [200, 200, 200], [[0, 0, 10, 10, [10, 90, 30]]]);
  assert.deepEqual(opaqueRect(photo, 100, 60), { x0: 20, y0: 0, x1: 80, y1: 60 });
  // 바탕만 있으면 가운데 정사각형
  assert.deepEqual(opaqueRect(opaque(40, 40, [0, 0, 0], []), 40, 40), { x0: 0, y0: 0, x1: 40, y1: 40 });
});

test('정사각형: 납작한 머리여도 위를 띄워 귀 끝이 가장자리에 붙지 않는다', () => {
  const sq = squareAround({ x0: 0, y0: 10, x1: 100, y1: 60 }, 0.02, 0.07);
  assert.ok(sq.y <= 10 - sq.side * 0.07 + 1e-9);
  assert.ok(sq.y + sq.side >= 60 - 30, '아래는 덜 잘라도 턱까지는 대부분');
});
