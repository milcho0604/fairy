import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampIntoAreas, fitSavedBounds, nearestArea, snapRect } from './geometry.ts';

// 개발 맥의 실제 작업 영역(2026-10-02 screen.getAllDisplays): 내장 화면이 왼쪽 음수 좌표, 외장 둘.
const builtIn = { x: -1512, y: 33, width: 1512, height: 949 };
const main = { x: 0, y: 30, width: 1920, height: 1050 };
const right = { x: 1920, y: 30, width: 1920, height: 1050 };
const areas = [builtIn, main, right];
const pet = (x: number, y: number) => ({ x, y, width: 160, height: 160 });

test('가운데가 들어 있는 모니터를 고른다', () => {
  assert.equal(nearestArea(pet(-800, 600), areas), builtIn);
  assert.equal(nearestArea(pet(100, 100), areas), main);
  assert.equal(nearestArea(pet(3000, 500), areas), right);
});

test('음수 좌표 모니터 안의 펫은 그대로 둔다', () => {
  assert.deepEqual(clampIntoAreas(pet(-800, 600), areas), pet(-800, 600));
});

test('모니터 경계에 걸치면 가운데가 있는 모니터 안으로 넣는다', () => {
  // 가운데 x = -1530, 내장 화면 왼쪽 밖이라 가장 가까운 내장 화면으로.
  assert.deepEqual(clampIntoAreas(pet(-1610, 600), areas), pet(-1512, 600));
  // 아래로 넘친 경우.
  assert.deepEqual(clampIntoAreas(pet(100, 1000), areas), pet(100, 30 + 1050 - 160));
});

test('모니터를 뽑아 아무 데도 없으면 가장 가까운 모니터로 옮긴다', () => {
  const unplugged = pet(3000, 500); // 오른쪽 모니터가 있던 자리
  assert.deepEqual(clampIntoAreas(unplugged, [builtIn, main]), pet(1920 - 160, 500));
});

test('모니터가 없으면 그대로 둔다', () => {
  assert.deepEqual(clampIntoAreas(pet(10, 10), []), pet(10, 10));
});

test('저장한 창 모습: 화면 안이면 그대로, 뺀 모니터에 있었으면 남은 화면 안으로', () => {
  const min = { width: 320, height: 360 };
  assert.deepEqual(fitSavedBounds({ x: 100, y: 100, width: 500, height: 700 }, [main], min), {
    x: 100,
    y: 100,
    width: 500,
    height: 700,
  });
  // 외장 모니터(오른쪽 4000)에 두고 닫았는데 지금은 내장 화면만
  const moved = fitSavedBounds({ x: 4000, y: 200, width: 500, height: 700 }, [builtIn], min);
  assert.ok(moved && moved.x !== undefined && moved.y !== undefined);
  assert.ok(moved.x >= builtIn.x && moved.x + moved.width <= builtIn.x + builtIn.width);
  assert.ok(moved.y >= builtIn.y && moved.y + moved.height <= builtIn.y + builtIn.height);
});

test('저장한 창 모습: 화면보다 크면 줄이고, 최소보다 작으면 늘린다. 모양이 틀리면 버린다', () => {
  const min = { width: 320, height: 360 };
  const big = fitSavedBounds({ x: 0, y: 0, width: 5000, height: 5000 }, [builtIn], min);
  assert.equal(big?.width, builtIn.width);
  assert.equal(big?.height, builtIn.height);
  assert.deepEqual(fitSavedBounds({ width: 100, height: 100 }, [main], min), { width: 320, height: 360 });
  assert.equal(fitSavedBounds(undefined, [main], min), undefined);
  assert.equal(fitSavedBounds({ width: '500', height: 600 }, [main], min), undefined);
  assert.equal(fitSavedBounds({ width: -1, height: 600 }, [main], min), undefined);
});

test('레이저 쫓기 뒤 소수 좌표는 정수로 맞춘다 (산책 setPosition 이 던지던 것)', () => {
  const r = snapRect({ x: 512.37, y: 880.5, width: 160, height: 159.6 });
  assert.deepEqual(r, { x: 512, y: 881, width: 160, height: 160 });
  for (const v of Object.values(r)) assert.ok(Number.isInteger(v));
});
