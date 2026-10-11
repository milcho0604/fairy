import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Eased, follow } from './motion-ease.ts';

test('follow 는 틀 간격과 상관없이 같은 빠르기로 따라간다', () => {
  // 30ms 한 번과 10ms 세 번이 같은 자리
  const once = follow(0, 1, 30, 90);
  let many = 0;
  for (let i = 0; i < 3; i++) many = follow(many, 1, 10, 90);
  assert.ok(Math.abs(once - many) < 1e-9);
  assert.ok(once > 0 && once < 1);
  assert.equal(follow(0.3, 1, 0, 90), 0.3);
});

test('이어 그리면 짧게 따라가 닿고, 닿으면 busy 가 풀린다', () => {
  const e = new Eased();
  let now = 0;
  e.frame(now);
  assert.equal(e.to('yaw', 0, 90), 0);
  now += 33;
  e.frame(now);
  const first = e.to('yaw', 1, 90);
  assert.ok(first > 0.2 && first < 0.4, `${first}`);
  assert.ok(e.busy);
  let frames = 1;
  while (e.busy && frames < 100) {
    now += 33;
    e.frame(now);
    e.to('yaw', 1, 90);
    frames++;
  }
  // 1/3 초 안팎에 다 돈다 (한 틀에 돌지도, 오래 끌지도 않는다)
  assert.ok(frames >= 5 && frames <= 20, `${frames}`);
  assert.equal(e.peek('yaw'), 1);
});

test('오래 멈췄다 다시 그려도 한 틀에 건너뛰지 않는다', () => {
  const e = new Eased();
  e.frame(0);
  e.to('yaw', 0, 90);
  e.frame(10_000);
  assert.ok(e.to('yaw', 1, 90) < 0.5);
});

test('한 장만 그릴 때(now 없음)는 목표값 그대로, 기억도 안 바꾼다', () => {
  const e = new Eased();
  e.frame(0);
  e.to('yaw', 0, 90);
  e.frame(undefined);
  assert.equal(e.to('yaw', 1, 90), 1);
  assert.equal(e.busy, false);
  assert.equal(e.peek('yaw'), 0);
});
