import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPetBounds, parseSavedPosition, parseSavedScale, restorePetBounds } from './placement.ts';

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
