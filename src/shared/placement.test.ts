import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPetBounds,
  friendSpot,
  parseSavedPosition,
  parseSavedScale,
  restorePetBounds,
} from './placement.ts';

// 개발 맥의 실제 배치(2026-10-02). 주 모니터는 외장, 내장 화면은 왼쪽 음수 좌표.
const builtIn = { workArea: { x: -1512, y: 33, width: 1512, height: 949 }, internal: true, primary: false };
const main = { workArea: { x: 0, y: 30, width: 1920, height: 1050 }, internal: false, primary: true };
const right = { workArea: { x: 1920, y: 30, width: 1920, height: 1050 }, internal: false, primary: false };
const displays = [main, builtIn, right];
const SIZE = 160;

test('처음 켜면 주 모니터가 아니라 노트북 내장 화면 오른쪽 아래', () => {
  assert.deepEqual(defaultPetBounds(displays, SIZE), {
    x: -1512 + 1512 - 160 - 40,
    y: 33 + 949 - 160,
    width: SIZE,
    height: SIZE,
  });
});

test('내장 화면이 없으면(데스크톱) 주 모니터', () => {
  assert.deepEqual(defaultPetBounds([right, main], SIZE), {
    x: 1920 - 200,
    y: 920,
    width: SIZE,
    height: SIZE,
  });
});

test('모니터 정보가 없어도 죽지 않는다', () => {
  assert.deepEqual(defaultPetBounds([], SIZE), { x: -40, y: 0, width: SIZE, height: SIZE });
});

test('저장된 자리로 돌아간다 (다른 모니터 포함)', () => {
  assert.deepEqual(restorePetBounds({ x: -240, y: 754 }, displays, SIZE), {
    x: -240,
    y: 754,
    width: SIZE,
    height: SIZE,
  });
  assert.deepEqual(restorePetBounds({ x: 2328, y: 735 }, displays, SIZE), {
    x: 2328,
    y: 735,
    width: SIZE,
    height: SIZE,
  });
});

test('저장된 모니터가 빠졌으면 가까운 화면 안으로', () => {
  assert.deepEqual(restorePetBounds({ x: 2328, y: 735 }, [main, builtIn], SIZE), {
    x: 1920 - 160,
    y: 735,
    width: SIZE,
    height: SIZE,
  });
});

test('저장 파일이 깨졌으면 기본 자리', () => {
  for (const broken of [undefined, null, 'x', {}, { x: '1', y: 2 }, { x: Number.NaN, y: 0 }, { x: 1 }]) {
    assert.equal(parseSavedPosition(broken), undefined);
    assert.deepEqual(restorePetBounds(broken, displays, SIZE), defaultPetBounds(displays, SIZE));
  }
});

test('소수 좌표는 반올림한다', () => {
  assert.deepEqual(parseSavedPosition({ x: 10.6, y: -3.2 }), { x: 11, y: -3 });
});

test('저장된 크기: 없거나 깨졌으면 100%, 범위 밖이면 안으로', () => {
  assert.equal(parseSavedScale({ x: 1, y: 2 }), 1);
  assert.equal(parseSavedScale({ scale: 'big' }), 1);
  assert.equal(parseSavedScale(undefined), 1);
  assert.equal(parseSavedScale({ scale: 2 }), 2);
  assert.equal(parseSavedScale({ scale: 10 }), 3);
});

// 맥북 내장 화면 하나 (시험 인스턴스에서 잰 값)
const mac = { x: 0, y: 33, width: 1512, height: 949 };
const floorY = 33 + 949;

test('친구는 기본 펫 왼쪽에 같은 바닥으로 줄을 선다 (예전 140px 간격 그대로)', () => {
  const main = { x: 900, y: floorY - 160, width: 160, height: 160 };
  assert.deepEqual(friendSpot(main, 0, 160, mac), { x: 760, y: floorY - 160 });
  assert.deepEqual(friendSpot(main, 1, 160, mac), { x: 620, y: floorY - 160 });
});

test('기본 펫이 커도 친구는 공중에 뜨지 않고 바닥에 서며 기본 펫에 묻히지 않는다', () => {
  // 300% 펫(480px). 예전에는 친구 y 가 기본 펫 윗변(502)이라 바닥에서 320px 떠 있었다
  const main = { x: 900, y: floorY - 480, width: 480, height: 480 };
  const a = friendSpot(main, 0, 160, mac);
  assert.equal(a.y + 160, floorY);
  assert.ok(a.x + 160 <= main.x + 20, '기본 펫과 20px 넘게 겹치지 않는다');
});

test('왼쪽 끝 기본 펫: 친구들이 한 자리에 겹치지 않고 오른쪽에 선다', () => {
  // 예전에는 셋 다 x=0 으로 밀려 기본 펫과 한 덩어리였다
  const main = { x: 0, y: floorY - 160, width: 160, height: 160 };
  const spots = [0, 1, 2].map((i) => friendSpot(main, i, 160, mac));
  assert.deepEqual(
    spots.map((p) => p.x),
    [140, 280, 420],
  );
  for (const p of spots) assert.equal(p.y, floorY - 160);
});

test('왼쪽에 한 자리만 있으면 하나는 왼쪽, 나머지는 오른쪽', () => {
  const main = { x: 200, y: floorY - 160, width: 160, height: 160 };
  assert.deepEqual(
    [0, 1, 2].map((i) => friendSpot(main, i, 160, mac).x),
    [60, 340, 480],
  );
});

test('오른쪽도 모자라면 화면 안으로 당긴다 (작은 화면)', () => {
  const small = { x: 0, y: 25, width: 400, height: 300 };
  const main = { x: 120, y: 165, width: 160, height: 160 };
  for (const i of [0, 1, 2]) {
    const p = friendSpot(main, i, 160, small);
    assert.ok(p.x >= 0 && p.x + 160 <= 400 && p.y + 160 <= 325, `${i}: ${JSON.stringify(p)}`);
  }
});
