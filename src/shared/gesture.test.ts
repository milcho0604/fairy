import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GestureTracker } from './gesture.ts';

const LEFT = 0;
const RIGHT = 2;

test('제자리에서 누르고 떼면 클릭', () => {
  const g = new GestureTracker();
  g.down(LEFT, 50, 50);
  assert.equal(g.move(52, 51), undefined); // 손떨림
  assert.deepEqual(g.up(LEFT), { type: 'click' });
});

test('4px 이상 움직이면 드래그, 시작 오프셋은 누른 자리', () => {
  const g = new GestureTracker();
  g.down(LEFT, 30, 40);
  assert.deepEqual(g.move(30, 44), { type: 'drag-start', offset: { x: 30, y: 40 } });
  assert.equal(g.move(100, 100), undefined); // 시작은 한 번만
  assert.equal(g.dragging, true);
  assert.deepEqual(g.up(LEFT), { type: 'drag-end' });
  assert.equal(g.dragging, false);
});

test('우클릭은 클릭이 아니다 (L3: 우클릭 뒤 클릭이 한 번 더 들어오던 버그)', () => {
  const g = new GestureTracker();
  g.down(RIGHT, 50, 50);
  assert.equal(g.move(80, 80), undefined);
  assert.equal(g.up(RIGHT), undefined);
  // 우클릭 다음 왼쪽 버튼을 떼기만 해도 클릭이 생기면 안 된다.
  assert.equal(g.up(LEFT), undefined);
});

test('누르지 않고 움직이면 아무 일 없다', () => {
  const g = new GestureTracker();
  assert.equal(g.move(10, 10), undefined);
  assert.equal(g.up(LEFT), undefined);
});

test('드래그 중 포인터를 놓치면 드래그를 끝낸다', () => {
  const g = new GestureTracker();
  g.down(LEFT, 0, 0);
  g.move(10, 0);
  assert.deepEqual(g.cancel(), { type: 'drag-end' });
  assert.equal(g.up(LEFT), undefined);
});
