import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GestureTracker, isGesture, RubTracker } from './gesture.ts';

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

test('쓰다듬기: 1.2초 안에 좌우로 네 번 문지르면 한 번, 2초 쉬고 다시', () => {
  const rub = new RubTracker();
  const strokes = (start: number, n: number, gap = 100) => {
    let hit = false;
    for (let i = 0; i <= n; i++) {
      const x = i % 2 === 0 ? 0 : 20;
      if (rub.move(x, start + i * gap)) hit = true;
    }
    return hit;
  };
  assert.equal(strokes(0, 5), true);
  assert.equal(strokes(600, 5), false); // 쉬는 중
  assert.equal(strokes(3000, 5), true);
});

test('쓰다듬기: 너무 느리거나 너무 작게 움직이면 아니다', () => {
  const slow = new RubTracker();
  let hit = false;
  for (let i = 0; i <= 8; i++) hit ||= slow.move(i % 2 ? 20 : 0, i * 500);
  assert.equal(hit, false);
  const tiny = new RubTracker();
  hit = false;
  for (let i = 0; i <= 8; i++) hit ||= tiny.move(i % 2 ? 3 : 0, i * 50);
  assert.equal(hit, false);
  const away = new RubTracker();
  for (let i = 0; i <= 3; i++) away.move(i % 2 ? 20 : 0, i * 100);
  away.reset();
  hit = false;
  for (let i = 0; i <= 2; i++) hit ||= away.move(i % 2 ? 20 : 0, 400 + i * 100);
  assert.equal(hit, false);
});

test('isGesture: 모양이 맞는 알림만 받는다', () => {
  assert.equal(isGesture({ type: 'click' }), true);
  assert.equal(isGesture({ type: 'drag-start', offset: { x: 1, y: 2 } }), true);
  for (const bad of [
    undefined,
    null,
    1,
    'click',
    {},
    { type: 'nope' },
    { type: 'drag-start' },
    { type: 'drag-start', offset: null },
    { type: 'drag-start', offset: { x: 'a', y: 1 } },
    { type: 'drag-start', offset: { x: Number.NaN, y: 1 } },
  ])
    assert.equal(isGesture(bad), false);
});
