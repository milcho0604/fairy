import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NEXT_MAX_MS,
  NEXT_MIN_MS,
  nextDelay,
  pickActivity,
  WALK_SPEED,
  walkOffset,
  walkSpan,
} from './behavior.ts';

const area = { x: -1512, y: 33, width: 1512, height: 949 };
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

test('다음 행동까지 25~70초', () => {
  assert.equal(
    nextDelay(() => 0),
    NEXT_MIN_MS,
  );
  assert.equal(
    nextDelay(() => 1),
    NEXT_MAX_MS,
  );
});

test('걷기: 거리에 맞춰 시간, 초당 40px', () => {
  const a = pickActivity({ x: -800, y: 800, width: 160, height: 160 }, area, seq(0.1, 0.9, 1));
  assert.equal(a.type, 'walk');
  if (a.type !== 'walk') return;
  assert.equal(a.dx, 160);
  assert.equal(a.ms, (160 / WALK_SPEED) * 1000);
});

test('오른쪽 끝에 붙어 있으면 왼쪽으로 걷는다', () => {
  const pet = { x: -165, y: 800, width: 160, height: 160 }; // 오른쪽 여유 5px
  const a = pickActivity(pet, area, seq(0.1, 0.9, 0.5));
  assert.equal(a.type, 'walk');
  if (a.type === 'walk') assert.ok(a.dx < 0);
});

test('걸을 자리가 없으면(모니터가 펫만 하면) 앉는다', () => {
  const tiny = { x: 0, y: 0, width: 180, height: 400 };
  const a = pickActivity({ x: 10, y: 100, width: 160, height: 160 }, tiny, seq(0.1, 0.9, 1, 0.5));
  assert.equal(a.type, 'sit');
});

test('앉기, 두리번, 하품, 기지개', () => {
  const pet = { x: -800, y: 800, width: 160, height: 160 };
  assert.equal(pickActivity(pet, area, seq(0.6, 0.5)).type, 'sit');
  assert.equal(pickActivity(pet, area, seq(0.8, 0.2)).type, 'look');
  assert.equal(pickActivity(pet, area, seq(0.9)).type, 'yawn');
  assert.equal(pickActivity(pet, area, seq(0.97)).type, 'stretch');
});

test('맞붙은 옆 모니터로 걸어 넘어간다. 높이가 안 맞으면 못 넘는다', () => {
  const right = { x: 0, y: 0, width: 1920, height: 1080 };
  const pet = { x: -170, y: 800, width: 160, height: 160 }; // 왼쪽 모니터 오른쪽 끝
  assert.deepEqual(walkSpan(pet, area, [area, right]), { left: -1512, right: 1920 });
  const a = pickActivity(pet, area, seq(0.1, 0.9, 1), [area, right]);
  assert.equal(a.type, 'walk');
  if (a.type === 'walk') assert.equal(a.dx, 160);
  const short = { x: 0, y: 0, width: 1920, height: 700 }; // 펫이 들어갈 높이가 아님
  assert.deepEqual(walkSpan(pet, area, [area, short]), { left: -1512, right: 0 });
});

test('걸음은 처음과 끝이 느리고 끝에서 정확히 도착', () => {
  assert.equal(walkOffset(100, 0), 0);
  assert.equal(walkOffset(100, 1), 100);
  assert.equal(walkOffset(-100, 0.5), -50);
  assert.ok(walkOffset(100, 0.1) < 10);
  assert.equal(walkOffset(100, 2), 100);
});
