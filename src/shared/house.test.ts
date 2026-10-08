import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultHouseRect,
  doorStandX,
  houseHit,
  houseSize,
  parseHouseSpot,
  rectAtSpot,
  settleHouse,
  spotOf,
} from './house.ts';

// 개발 맥의 실제 작업 영역(geometry.test.ts 와 같다): 내장 화면이 왼쪽 음수 좌표, 외장 둘.
const builtIn = { x: -1512, y: 33, width: 1512, height: 949 };
const main = { x: 0, y: 30, width: 1920, height: 1050 };
const right = { x: 1920, y: 30, width: 1920, height: 1050 };
const areas = [builtIn, main, right];

test('단계가 오르면 집이 조금씩 커지고, 이상한 단계는 끝 값으로', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(houseSize), [104, 120, 136, 148, 160]);
  assert.equal(houseSize(0), 104);
  assert.equal(houseSize(9), 160);
});

test('저장 파일이 깨졌으면 처음 자리로', () => {
  assert.deepEqual(parseHouseSpot({ cx: 10.5, bottom: -3 }), { cx: 10.5, bottom: -3 });
  for (const bad of [
    undefined,
    null,
    3,
    'x',
    {},
    { cx: 1 },
    { cx: '1', bottom: 2 },
    { cx: Number.NaN, bottom: 2 },
  ])
    assert.equal(parseHouseSpot(bad), undefined);
});

test('업그레이드로 커져도 아래 가운데는 그대로', () => {
  const small = settleHouse({ x: 500, y: 200, width: houseSize(1), height: houseSize(1) }, areas);
  const spot = spotOf(small);
  for (const level of [2, 3, 4, 5]) {
    const big = rectAtSpot(spot, houseSize(level));
    assert.equal(big.x + big.width / 2, small.x + small.width / 2);
    assert.equal(big.y + big.height, small.y + small.height);
  }
});

test('놓으면 그 모니터 바닥에 붙는다 (음수 좌표 모니터 포함)', () => {
  assert.deepEqual(settleHouse({ x: 700, y: 300, width: 120, height: 120 }, areas), {
    x: 700,
    y: 30 + 1050 - 120,
    width: 120,
    height: 120,
  });
  assert.deepEqual(settleHouse({ x: -900, y: 100, width: 120, height: 120 }, areas), {
    x: -900,
    y: 33 + 949 - 120,
    width: 120,
    height: 120,
  });
});

test('모니터 끝에 걸치면 가로를 안으로 넣는다', () => {
  // 가운데가 내장 화면 왼쪽 밖
  assert.equal(settleHouse({ x: -1600, y: 500, width: 120, height: 120 }, areas).x, -1512);
  // 메인 화면 오른쪽 끝에 반쯤 걸침: 가운데(1910)가 메인 안이라 메인 오른쪽 끝으로
  assert.equal(settleHouse({ x: 1850, y: 500, width: 120, height: 120 }, areas).x, 1920 - 120);
});

test('모니터를 뽑으면 가장 가까운 모니터 바닥으로, 다시 꽂으면 저장한 자리 그대로', () => {
  const saved = { cx: 3000, bottom: 1080 }; // 오른쪽 모니터 바닥
  const rect = rectAtSpot(saved, 120);
  assert.deepEqual(settleHouse(rect, [builtIn, main]), {
    x: 1920 - 120,
    y: 1080 - 120,
    width: 120,
    height: 120,
  });
  assert.deepEqual(settleHouse(rect, areas), rect);
});

test('모니터가 없으면 그대로 둔다', () => {
  const r = { x: 5, y: 5, width: 120, height: 120 };
  assert.deepEqual(settleHouse(r, []), r);
});

test('처음 자리는 왼쪽 아래 구석', () => {
  assert.deepEqual(defaultHouseRect(builtIn, 104), { x: -1500, y: 33 + 949 - 104, width: 104, height: 104 });
});

test('집 그림 위만 잡히고 투명한 하늘은 통과한다', () => {
  const s = 120;
  assert.ok(houseHit('wood', 1, s, { x: 60, y: 80 }), '벽');
  assert.ok(houseHit('wood', 1, s, { x: 60, y: 22 }), '지붕 꼭대기');
  assert.ok(houseHit('wood', 1, s, { x: 15, y: 55 }), '처마 끝');
  assert.ok(!houseHit('wood', 1, s, { x: 10, y: 10 }), '왼쪽 위 하늘');
  assert.ok(!houseHit('wood', 1, s, { x: 110, y: 25 }), '오른쪽 위 하늘');
  assert.ok(!houseHit('wood', 1, s, { x: 8, y: 90 }), '벽 왼쪽 옆');
  assert.ok(!houseHit('wood', 1, s, { x: 60, y: 117 }), '1단계는 마당이 없다');
  assert.ok(houseHit('wood', 3, s, { x: 60, y: 117 }), '3단계 잔디');
  assert.ok(houseHit('wood', 3, s, { x: 104, y: 104 }), '3단계 덤불');
});

test('모양마다 자기 그림을 본다: 버섯 갓 끝, 성 탑, 눈집 옆 하늘', () => {
  assert.ok(houseHit('mushroom', 1, 120, { x: 16, y: 62 }), '버섯 갓 왼쪽 끝');
  assert.ok(!houseHit('wood', 1, 120, { x: 16, y: 62 }), '나무집은 벽 옆 하늘');
  assert.ok(houseHit('castle', 5, 120, { x: 10, y: 80 }), '성 왼쪽 탑');
  assert.ok(houseHit('wood', 5, 120, { x: 10, y: 80 }), '저택 왼쪽 탑');
  assert.ok(!houseHit('igloo', 1, 120, { x: 60, y: 40 }), '작은 눈집 위 하늘');
  assert.ok(houseHit('igloo', 4, 120, { x: 60, y: 45 }), '이층 눈집 위 둥근 지붕');
});

test('집 크기가 달라도 같은 그림 자리를 본다', () => {
  // 136 px 집에서 벽 가운데는 (68, 91), 왼쪽 위 하늘은 (11, 11)
  assert.ok(houseHit('wood', 3, 136, { x: 68, y: 91 }));
  assert.ok(!houseHit('wood', 3, 136, { x: 11, y: 11 }));
  assert.ok(!houseHit('wood', 1, 104, { x: 100, y: 10 }));
});

test('펫은 집 오른쪽 문간에, 오른쪽 끝이면 왼쪽에 선다', () => {
  const house = { x: 100, y: 960, width: 120, height: 120 };
  assert.equal(doorStandX(house, main, 160), 200);
  const atEdge = { x: 1800, y: 960, width: 120, height: 120 };
  assert.equal(doorStandX(atEdge, main, 160), 1820);
  // 아주 좁은 화면이면 왼쪽 끝 안으로
  const narrow = { x: 0, y: 0, width: 150, height: 600 };
  assert.equal(doorStandX({ x: 20, y: 480, width: 120, height: 120 }, narrow, 160), 80);
});
