import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_VEL, FIGURE_LIMITS, MAX_VEL, RAD_PER_PX, RELIEF_LIMITS, Spinner, wrap } from './spin.ts';

const DEG = Math.PI / 180;
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** 다 멈출 때까지 30fps 로 돌린다. 걸린 걸음 수 */
const run = (s: Spinner, max = 600) => {
  let n = 0;
  while (s.step(33) && n < max) n++;
  return n;
};

test('끌면 끈 만큼 돌고, 오른쪽으로 끌면 각이 커진다', () => {
  const s = new Spinner(FIGURE_LIMITS, true);
  s.grab(100, 100, 0);
  assert.equal(s.auto, false, '끌면 자동 회전은 멈춘다');
  s.move(140, 100, 400);
  near(s.yaw, 40 * RAD_PER_PX);
  s.move(100, 100, 800);
  near(s.yaw, 0);
});

test('빨리 끌고 놓으면 관성으로 조금 더 돌다 멈추고, 멈춰서 놓으면 그 자리', () => {
  const s = new Spinner(FIGURE_LIMITS, false);
  s.grab(0, 0, 0);
  for (let i = 1; i <= 5; i++) s.move(i * 20, 0, i * 16);
  const at = s.yaw;
  s.release(5 * 16 + 10);
  assert.ok(s.vel > 0 && s.vel <= MAX_VEL);
  // 멈추면 각을 접어 두니 접기 전 걸음마다 더한다
  let turned = 0;
  let steps = 0;
  for (let prev = s.yaw; s.step(33) && steps < 600; steps++) {
    turned += wrap(s.yaw - prev);
    prev = s.yaw;
  }
  assert.ok(turned > 0.1, `놓은 뒤 더 돈다 (${turned})`);
  assert.ok(turned < 70 * DEG, `그래도 조금만, 세게 던져도 70도 안 (${turned})`);
  assert.ok(steps < 75, `2.5초 안에 멈춘다 (${steps})`);
  near(wrap(at + turned), s.yaw, 1e-6);
  assert.equal(s.step(33), false, '멈추면 움직임이 없다고 알린다');

  const h = new Spinner(FIGURE_LIMITS, false);
  h.grab(0, 0, 0);
  h.move(50, 0, 16);
  h.release(400);
  assert.equal(h.vel, 0);
});

test('아무리 세게 던져도 빠르기 상한을 넘지 않는다', () => {
  const s = new Spinner(FIGURE_LIMITS, false);
  s.grab(0, 0, 0);
  s.move(5000, 0, 1);
  s.release(2);
  near(s.vel, MAX_VEL);
});

test('위아래 기울기는 범위 안에서 멈춘다', () => {
  const s = new Spinner(FIGURE_LIMITS, false);
  s.grab(0, 0, 0);
  s.move(0, 10_000, 16);
  near(s.pitch, FIGURE_LIMITS.pitch[1]);
  s.move(0, -10_000, 32);
  near(s.pitch, FIGURE_LIMITS.pitch[0]);
  s.release(500);
  for (let i = 0; i < 20; i++) s.nudge('pitch', 1);
  run(s);
  near(s.pitch, FIGURE_LIMITS.pitch[1]);
});

test('자동 회전은 14초에 한 바퀴, 각은 (-π, π] 안에 머문다', () => {
  const s = new Spinner(FIGURE_LIMITS, true);
  let total = 0;
  for (let i = 0; i < 210; i++) {
    s.step(33);
    total += AUTO_VEL * 33;
    assert.ok(s.yaw > -Math.PI - 1e-9 && s.yaw <= Math.PI + 1e-9);
  }
  near(wrap(total), s.yaw, 1e-9);
  assert.ok(total > Math.PI / 2, '7초면 반 바퀴쯤');
});

test('화살표는 30도씩, 한 바퀴 넘게도 돌고, 정면은 가까운 쪽으로 돌아온다', () => {
  const s = new Spinner(FIGURE_LIMITS, true);
  s.nudge('yaw', 1);
  assert.equal(s.auto, false);
  run(s);
  assert.equal(s.degrees(), 30);
  for (let i = 0; i < 11; i++) s.nudge('yaw', 1);
  run(s);
  assert.equal(s.degrees(), 0, '12번이면 한 바퀴');
  s.nudge('yaw', -1);
  run(s);
  assert.equal(s.degrees(), 330);
  // 330도에서 정면은 30도만 되돌아간다 (330도를 거꾸로 감지 않는다)
  s.front();
  const first = s.yaw;
  s.step(33);
  assert.ok(Math.abs(s.yaw) < Math.abs(first), '0 쪽으로');
  assert.ok(Math.abs(first) < 31 * DEG);
  run(s);
  assert.equal(s.degrees(), 0);
  assert.equal(s.pitch, 0);
});

test('보이는 쪽: 정면, 옆, 뒤', () => {
  const s = new Spinner(FIGURE_LIMITS, false);
  assert.equal(s.side(), 'front');
  s.yaw = 90 * DEG;
  assert.equal(s.side(), 'side');
  s.yaw = 180 * DEG;
  assert.equal(s.side(), 'back');
  s.yaw = -100 * DEG;
  assert.equal(s.degrees(), 260);
  assert.equal(s.side(), 'side');
});

test('2.5D 는 좌우 25도까지만 돌고 관성도 끝에서 멈춘다', () => {
  const s = new Spinner(RELIEF_LIMITS, false);
  s.grab(0, 0, 0);
  s.move(10_000, 0, 16);
  near(s.yaw, 1.1);
  assert.equal(s.degrees(), 25);
  s.move(9000, 0, 32);
  s.release(40);
  assert.ok(s.vel < 0);
  run(s);
  assert.ok(s.yaw >= -1.1 && s.yaw <= 1.1);
  for (let i = 0; i < 10; i++) s.nudge('yaw', -1);
  run(s);
  assert.equal(s.degrees(), -25);
});

test('2.5D 자동은 지금 자리에서 이어 좌우로 흔든다', () => {
  const s = new Spinner(RELIEF_LIMITS, false);
  s.yaw = 0.5;
  s.setAuto(true);
  s.step(1);
  near(s.yaw, 0.5, 0.01);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 600; i++) {
    s.step(33);
    lo = Math.min(lo, s.yaw);
    hi = Math.max(hi, s.yaw);
  }
  assert.ok(hi <= 1.1 + 1e-9 && lo >= -1.1 - 1e-9);
  assert.ok(hi > 1 && lo < -1, '양끝까지 간다');
});

test('창이 오래 멈췄다 돌아와도 한 번에 휙 돌지 않는다', () => {
  const s = new Spinner(FIGURE_LIMITS, true);
  s.step(60_000);
  assert.ok(Math.abs(s.yaw) <= AUTO_VEL * 100 + 1e-9);
});
