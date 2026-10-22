import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropPlace, moveTarget } from './todo-move.ts';

const row = (id: number, pinned = false) => ({ id, pinnedAt: pinned ? 1000 + id : null });
const list = [row(9, true), row(1), row(2), row(3), row(4)];

test('위아래, 맨 위, 맨 아래로 옮길 자리', () => {
  assert.deepEqual(moveTarget(list, 3, 'up'), { target: 2, after: false });
  assert.deepEqual(moveTarget(list, 3, 'down'), { target: 4, after: true });
  assert.deepEqual(moveTarget(list, 3, 'top'), { target: 1, after: false });
  assert.deepEqual(moveTarget(list, 2, 'bottom'), { target: 4, after: true });
});

test('이미 그 끝이면 옮길 데가 없다, 고정한 줄은 옮기지 않는다', () => {
  assert.equal(moveTarget(list, 1, 'up'), undefined);
  assert.equal(moveTarget(list, 1, 'top'), undefined);
  assert.equal(moveTarget(list, 4, 'down'), undefined);
  assert.equal(moveTarget(list, 4, 'bottom'), undefined);
  assert.equal(moveTarget(list, 9, 'down'), undefined);
  assert.equal(moveTarget(list, 99, 'up'), undefined);
  assert.equal(moveTarget([row(1)], 1, 'top'), undefined);
});

test('고정한 줄 아래 첫 줄은 맨 위로 갈 데가 없다 (고정한 줄 앞에는 놓지 않는다)', () => {
  assert.equal(moveTarget(list, 1, 'up'), undefined);
  assert.deepEqual(moveTarget(list, 2, 'up'), { target: 1, after: false });
});

test('끌어 놓기: 아래로 끌면 뒤, 위로 끌면 앞, 같은 줄이나 고정한 줄이면 없음', () => {
  assert.deepEqual(dropPlace(list, 1, 3), { target: 3, after: true });
  assert.deepEqual(dropPlace(list, 4, 2), { target: 2, after: false });
  assert.equal(dropPlace(list, 2, 2), undefined);
  assert.equal(dropPlace(list, 2, 9), undefined);
  assert.equal(dropPlace(list, 9, 2), undefined);
});
