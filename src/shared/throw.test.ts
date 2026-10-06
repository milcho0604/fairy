import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bounce, FLIGHT_MAX_MS, GRAVITY, releaseVelocity } from './throw.ts';

const area = { x: 0, y: 25, width: 1000, height: 775 }; // 바닥 y = 800
const W = 160;

test('놓는 속도: 마지막 100ms 움직임. 멈췄다 놓거나 표본이 모자라면 없음', () => {
  const s = [
    { t: 0, x: 0, y: 0 },
    { t: 50, x: 50, y: -25 },
    { t: 100, x: 100, y: -50 },
  ];
  assert.deepEqual(releaseVelocity(s, 110), { vx: 1000, vy: -500 });
  assert.equal(releaseVelocity(s, 200), undefined);
  assert.equal(releaseVelocity([{ t: 100, x: 0, y: 0 }], 105), undefined);
});

test('바닥에 닿으면 튕기고, 약해지면 멈춰 선다', () => {
  const hit = bounce({ x: 400, y: 700, vx: 300, vy: 1000 }, W, W, area, [area]);
  assert.equal(hit.y, 640);
  assert.ok(hit.vy < 0 && hit.vy > -1000);
  assert.equal(hit.rest, false);
  const soft = bounce({ x: 400, y: 650, vx: 10, vy: 100 }, W, W, area, [area]);
  assert.equal(soft.rest, true);
  assert.equal(soft.vx, 0);
});

test('벽에 닿으면 반대로 튕긴다. 옆 모니터가 맞붙어 있으면 넘어간다', () => {
  const wall = bounce({ x: 900, y: 300, vx: 800, vy: 0 }, W, W, area, [area]);
  assert.equal(wall.x, 840);
  assert.ok(wall.vx < 0);
  const next = { x: 1000, y: 0, width: 1920, height: 1080 };
  const pass = bounce({ x: 900, y: 300, vx: 800, vy: 0 }, W, W, area, [area, next]);
  assert.equal(pass.x, 900);
  assert.equal(pass.vx, 800);
});

test('던지면 결국 바닥에 선다 (흉내)', () => {
  let b = { x: 300, y: 300, vx: 1500, vy: -1200 };
  let t = 0;
  let rest = false;
  while (!rest && t < FLIGHT_MAX_MS) {
    b.vy += GRAVITY * 0.016;
    b.x += b.vx * 0.016;
    b.y += b.vy * 0.016;
    const r = bounce(b, W, W, area, [area]);
    b = r;
    rest = r.rest;
    t += 16;
  }
  assert.equal(rest, true);
  assert.equal(b.y, 640);
  assert.ok(b.x >= 0 && b.x <= 840);
});
