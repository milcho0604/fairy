import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fadeBelow, neckOf, opaqueRect, solidRect, squareAround } from './pet-face.ts';

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
