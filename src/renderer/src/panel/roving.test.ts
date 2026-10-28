import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveCell, stopCell } from './roving.ts';

// 한 달: 앞 3칸 빈 칸, 날짜 10개, 마지막 몇 칸은 미래(못 섬)
const ok = [
  false,
  false,
  false,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  false,
  false,
  false,
];

test('좌우는 다음 칸, 끝에서는 제자리', () => {
  assert.equal(moveCell(ok, 4, 'ArrowRight'), 5);
  assert.equal(moveCell(ok, 4, 'ArrowLeft'), 3);
  assert.equal(moveCell(ok, 3, 'ArrowLeft'), 3);
  assert.equal(moveCell(ok, 12, 'ArrowRight'), 12);
});

test('위아래는 한 주', () => {
  assert.equal(moveCell(ok, 10, 'ArrowUp'), 3);
  assert.equal(moveCell(ok, 5, 'ArrowUp'), 5);
  assert.equal(moveCell(ok, 5, 'ArrowDown'), 12);
  assert.equal(moveCell(ok, 6, 'ArrowDown'), 6);
});

test('Home, End 는 그 줄의 처음과 끝 칸', () => {
  assert.equal(moveCell(ok, 5, 'Home'), 3);
  assert.equal(moveCell(ok, 5, 'End'), 6);
  assert.equal(moveCell(ok, 9, 'End'), 12);
});

test('다른 키는 제자리', () => {
  assert.equal(moveCell(ok, 5, 'a'), 5);
});

test('탭 정지 칸', () => {
  assert.equal(stopCell(ok, [-1, 7]), 7);
  assert.equal(stopCell(ok, [14]), 12);
  assert.equal(stopCell([false, false], [0]), -1);
});
