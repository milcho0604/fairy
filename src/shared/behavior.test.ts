import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NEXT_MAX_MS,
  NEXT_MIN_MS,
  nextDelay,
  pickActivity,
  settleDist,
  WALK_SPEED,
  walkOffset,
  walkSpan,
} from './behavior.ts';
import { MOVE_SPECS, MOVES, PLAIN_ASK } from './moves.ts';

const area = { x: -1512, y: 33, width: 1512, height: 949 };
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

test('다음 행동까지 20~55초', () => {
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

test('앉기는 8~18초, 나머지는 제자리 몸짓', () => {
  const pet = { x: -800, y: 800, width: 160, height: 160 };
  const sit = pickActivity(pet, area, seq(0.4, 0.5));
  assert.deepEqual(sit, { type: 'sit', ms: 13_000 });
  // 첫 난수가 걷기, 앉기 몫을 넘으면 몸짓. 몸짓 고르기 난수 0 이면 맨 앞(하품)
  const yawn = pickActivity(pet, area, seq(0.6, 0, 0.9));
  assert.deepEqual(yawn, { type: 'yawn', ms: MOVE_SPECS.yawn.ms });
  // 좌우가 있는 몸짓은 방향을 붙인다 (마지막 난수 0.2 → 왼쪽)
  const recent = { last: 'yawn' as const, at: {} };
  const scan = pickActivity(pet, area, seq(0.6, 0.2, 0.2), [], { recent });
  assert.equal(scan.type, 'scan');
  if (scan.type === 'scan') assert.equal(scan.dir, -1);
});

test('할 몸짓이 없으면(모두 쉬는 중) 두리번', () => {
  const pet = { x: -800, y: 800, width: 160, height: 160 };
  const at = Object.fromEntries(MOVES.map((m) => [m, 1000]));
  const a = pickActivity(pet, area, seq(0.6, 0.5, 0.9), [], { recent: { at }, now: 2000 });
  assert.equal(a.type, 'look');
});

test('몸짓은 펫 몸과 최근 기록을 넘겨받아 고른다 (꼬리 있는 펫만 꼬리 흔들기)', () => {
  const pet = { x: -800, y: 800, width: 160, height: 160 };
  const tail = { ...PLAIN_ASK, tail: true };
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const r = (i + 0.5) / 200;
    seen.add(pickActivity(pet, area, seq(0.9, r, 0.5), [], { ask: tail }).type);
  }
  assert.ok(seen.has('wag'));
  assert.ok(!seen.has('ears'));
  const plain = new Set<string>();
  for (let i = 0; i < 200; i++) plain.add(pickActivity(pet, area, seq(0.9, (i + 0.5) / 200, 0.5)).type);
  assert.ok(!plain.has('wag'));
});

test('맞붙은 옆 모니터로 걸어 넘어간다. 높이가 안 맞으면 못 넘는다', () => {
  const right = { x: 0, y: 0, width: 1920, height: 1080 };
  const pet = { x: -170, y: 800, width: 160, height: 160 }; // 왼쪽 모니터 오른쪽 끝
  assert.deepEqual(walkSpan(pet, area, [area, right]), { left: -1512, right: 1920 });
  const a = pickActivity(pet, area, seq(0.1, 0.9, 1), [area, right]);
  assert.equal(a.type, 'walk');
  // 160 만 걸으면 두 모니터에 걸쳐 서서 끝에 한 모니터 안으로 튀었다. 경계를 다 넘어간다
  if (a.type === 'walk') assert.equal(a.dx, 170);
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

test('기운대로 걷는다: 활발하면 자주 빨리, 졸리면 드물게 천천히. 보통은 예전 그대로', () => {
  const pet = { x: -800, y: 800, width: 160, height: 160 };
  // 첫 난수 0.25: 지침(28%)까지는 걷고 졸림(20%)은 걷지 않고 앉는다
  const walkFor = (energy: 'lively' | 'normal' | 'tired' | 'sleepy' | undefined) =>
    pickActivity(pet, area, seq(0.25, 0.9, 1), [], energy ? { ask: { ...PLAIN_ASK, energy } } : {});
  const plain = walkFor(undefined);
  const normal = walkFor('normal');
  assert.deepEqual(normal, plain);
  assert.equal(walkFor('sleepy').type, 'sit');
  const lively = walkFor('lively');
  const tired = walkFor('tired');
  assert.equal(lively.type, 'walk');
  assert.equal(tired.type, 'walk');
  if (plain.type !== 'walk' || lively.type !== 'walk' || tired.type !== 'walk') return;
  assert.equal(lively.dx, plain.dx);
  assert.equal(lively.ms, Math.round((Math.abs(plain.dx) / (WALK_SPEED * 1.25)) * 1000));
  assert.equal(tired.ms, Math.round((Math.abs(plain.dx) / (WALK_SPEED * 0.75)) * 1000));
});

test('옆 모니터로 넘어가는 걷기는 두 모니터에 걸쳐 멈추지 않는다', () => {
  const left = { x: -1512, y: 0, width: 1512, height: 982 };
  const right = { x: 0, y: 0, width: 1920, height: 1080 };
  const areas = [left, right];
  const pet = { x: -300, y: 800, width: 160, height: 160 };
  // 걸치지 않으면 그대로
  assert.equal(settleDist(pet, 1, 100, 2000, areas), 100);
  // 걸치면 다 넘어간다 (펫 왼끝이 경계 0 에)
  assert.equal(settleDist(pet, 1, 200, 2000, areas), 300);
  // 넘어갈 자리가 없으면 경계 앞에서 선다 (펫 오른끝이 경계 0 에)
  assert.equal(settleDist(pet, 1, 200, 250, areas), 140);
  // 왼쪽으로도
  const p2 = { x: 50, y: 800, width: 160, height: 160 };
  assert.equal(settleDist(p2, -1, 100, 2000, areas), 210);
  assert.equal(settleDist(p2, -1, 100, 150, areas), 50);
  // 모니터가 하나면 그대로
  assert.equal(settleDist(pet, 1, 200, 2000, [right]), 200);
});
