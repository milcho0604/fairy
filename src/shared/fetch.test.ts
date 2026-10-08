import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPick, dropVelocity, fromBox, heldAt, pickPose, toBox } from './fetch.ts';
import { bounce, GRAVITY } from './throw.ts';

test('물기 자세: 처음과 끝은 고개를 들고 있고, 가장 숙였을 때 공을 문다', () => {
  assert.deepEqual(pickPose(0), { dip: 0, grab: 0 });
  assert.equal(pickPose(1).dip, 0);
  assert.equal(pickPose(1).grab, 1);
  assert.equal(pickPose(0.45).dip, 1);
  // 숙이는 동안은 공이 바닥에 그대로
  assert.equal(pickPose(0.3).grab, 0);
  // 다 문 뒤 고개를 드는 동안 공은 입에 붙어 있다
  assert.equal(pickPose(0.7).grab, 1);
  assert.ok(pickPose(0.7).dip > 0 && pickPose(0.7).dip < 1);
  // 범위 밖은 끝 값
  assert.deepEqual(pickPose(-1), pickPose(0));
  assert.deepEqual(pickPose(3), pickPose(1));
});

test('물기 자세는 이어진다 (틀 사이에 튀지 않는다)', () => {
  let prev = pickPose(0);
  for (let i = 1; i <= 200; i++) {
    const p = pickPose(i / 200);
    assert.ok(Math.abs(p.dip - prev.dip) < 0.05, `dip ${i}`);
    assert.ok(Math.abs(p.grab - prev.grab) < 0.05, `grab ${i}`);
    assert.ok(p.grab >= prev.grab, '공은 입에서 다시 떨어지지 않는다');
    prev = p;
  }
});

test('문 공은 입 바로 아래 (윗부분을 문다)', () => {
  assert.deepEqual(heldAt({ x: 90, y: 100 }, 20), { x: 90, y: 107 });
});

test('화면 좌표와 펫 사각형 비율은 서로 되돌아간다', () => {
  const box = { x: 400, y: 640, width: 192, height: 192 };
  const p = { x: 496, y: 817 };
  const k = toBox(p, box);
  assert.deepEqual(k, { x: 0.5, y: 177 / 192 });
  assert.deepEqual(fromBox(k, box), p);
});

test('공이 펫 그림 안(바닥 근처)에 있어야 입으로 문다. 창 위에 앉은 펫 아래 바닥 공은 못 문다', () => {
  const pet = { x: 400, y: 640, width: 160, height: 160 };
  assert.equal(canPick({ x: 480, y: 785 }, pet), true);
  assert.equal(canPick({ x: 395, y: 785 }, pet), true);
  const perched = { ...pet, y: 300 };
  assert.equal(canPick({ x: 480, y: 785 }, perched), false);
  assert.equal(canPick({ x: 900, y: 785 }, pet), false);
});

test('입에서 떨어뜨린 공은 통 한두 번 튀고 바닥에 멈춘다', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const v = dropVelocity(1);
  let b = { x: 480, y: 720, ...v };
  let hits = 0;
  let rest = false;
  for (let i = 0; i < 300 && !rest; i++) {
    const dt = 0.016;
    const r = bounce(
      { x: b.x + b.vx * dt, y: b.y + (b.vy + GRAVITY * dt) * dt, vx: b.vx, vy: b.vy + GRAVITY * dt },
      30,
      30,
      area,
      [area],
    );
    if (r.y === 770 && b.y < 770) hits++;
    rest = r.rest;
    b = r;
  }
  assert.ok(rest, '멈춘다');
  assert.ok(hits >= 2 && hits <= 3, `튄 횟수 ${hits}`);
  assert.ok(b.x > 480 && b.x < 560, '걸어온 쪽으로 조금만 굴러간다');
  assert.ok(dropVelocity(-1).vx < 0);
});
