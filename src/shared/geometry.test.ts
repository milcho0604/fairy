import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampIntoAreas, nearestArea } from './geometry.ts';

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
