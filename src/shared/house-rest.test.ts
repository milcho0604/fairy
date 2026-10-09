import assert from 'node:assert/strict';
import { test } from 'node:test';
import { houseLayout } from './house-art.ts';
import {
  doorFrame,
  doorPoint,
  nextRest,
  OUT_MS,
  type RestEvent,
  type RestPhase,
  restBackKey,
  restBlock,
  restWake,
} from './house-rest.ts';

const PHASES: RestPhase[] = ['out', 'going', 'inside', 'leaving'];
const EVENTS: RestEvent[] = ['go', 'enter', 'call', 'exit', 'cancel'];

test('한 바퀴: 밖 → 가는 중 → 안 → 나오는 중 → 밖', () => {
  let p: RestPhase = 'out';
  for (const [e, want] of [
    ['go', 'going'],
    ['enter', 'inside'],
    ['call', 'leaving'],
    ['exit', 'out'],
  ] as const) {
    const next = nextRest(p, e);
    assert.equal(next, want, `${p} + ${e}`);
    p = next as RestPhase;
  }
});

test('전이표 전부: 받지 않는 일은 undefined', () => {
  const table: Record<RestPhase, Partial<Record<RestEvent, RestPhase>>> = {
    out: { go: 'going' },
    going: { enter: 'inside', cancel: 'out', call: 'out' },
    inside: { call: 'leaving' },
    leaving: { exit: 'out' },
  };
  for (const p of PHASES) for (const e of EVENTS) assert.equal(nextRest(p, e), table[p][e], `${p} + ${e}`);
});

test('두 번 누르기: 안에 있을 때 또 go, 나오는 중에 또 call 은 무시', () => {
  assert.equal(nextRest('inside', 'go'), undefined);
  assert.equal(nextRest('leaving', 'call'), undefined);
  assert.equal(nextRest('going', 'go'), undefined);
  assert.equal(nextRest('out', 'call'), undefined);
});

test('쉬게 할 수 없는 까닭: 집 없음이 먼저, 숨김, 진행 중, 노는 중', () => {
  const ok = { hasHouse: true, hidden: false, playing: false, phase: 'out' as const };
  assert.equal(restBlock(ok), undefined);
  assert.equal(restBlock({ ...ok, hasHouse: false, hidden: true }), 'noHouse');
  assert.equal(restBlock({ ...ok, hidden: true }), 'hidden');
  assert.equal(restBlock({ ...ok, phase: 'inside' }), 'busy');
  assert.equal(restBlock({ ...ok, phase: 'going', playing: true }), 'busy');
  assert.equal(restBlock({ ...ok, playing: true }), 'playing');
});

test('쉬는 중 알림: 일정만 나와서, 놓치면 안 되는 말은 편지, 나머지는 기다림', () => {
  assert.equal(restWake('schedule', true), 'come-out');
  assert.equal(restWake('schedule', false), 'come-out');
  assert.equal(restWake('system', true), 'mail');
  assert.equal(restWake('answer', true), 'mail');
  assert.equal(restWake('answer', false), 'wait');
  assert.equal(restWake('idle-talk', false), 'wait');
});

test('문 자리: 집 그림 문 가운데, 문턱. 크기가 바뀌어도 같은 비율', () => {
  const door = houseLayout('wood', 1).door;
  assert.deepEqual(doorPoint({ x: 0, y: 0, width: 120, height: 120 }, door), { x: 52, y: 110 });
  assert.deepEqual(doorPoint({ x: -1000, y: 500, width: 136, height: 136 }, door), { x: -941, y: 625 });
  // 저택은 문이 가운데쯤
  assert.deepEqual(doorPoint({ x: 0, y: 0, width: 160, height: 160 }, houseLayout('wood', 5).door), {
    x: 88,
    y: 147,
  });
});

test('문 드나들기: 처음은 문간 그대로, 끝은 문 안 그림 자리, 늘 정사각형, 바닥을 따라 걷는다', () => {
  const from = { x: 200, y: 600, width: 160, height: 160 };
  const end = { x: 130, y: 714, width: 40, height: 40 };
  assert.deepEqual(doorFrame(from, end, 0), from);
  assert.deepEqual(doorFrame(from, end, 1), end);
  let last = Infinity;
  let lastX = Infinity;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const f = doorFrame(from, end, u);
    assert.equal(f.width, f.height);
    assert.ok(f.width <= last, '작아지기만 한다');
    assert.ok(f.x + f.width / 2 <= lastX + 0.5, '문 쪽으로만 간다');
    // 아래 끝은 문간 바닥(760)에서 문 안 그림 아래(754)로 곧게 (뛰지 않는다)
    const bottom = f.y + f.height;
    assert.ok(bottom <= 761 && bottom >= 753, `바닥 ${bottom}`);
    last = f.width;
    lastX = f.x + f.width / 2;
  }
  // 범위 밖 u 는 끝으로 자른다 (타이머가 조금 늦게 와도)
  assert.deepEqual(doorFrame(from, end, 1.4), end);
  assert.deepEqual(doorFrame(from, end, -0.2), from);
});

test('나온 뒤 모아 둔 말(600ms)보다 걸어 나오기가 먼저 끝난다', () => {
  assert.ok(OUT_MS < 600);
});

test('나왔을 때 한마디: 2분 안, 30분 안, 그 뒤', () => {
  assert.equal(restBackKey(30_000), 'pet.home.backShort');
  assert.equal(restBackKey(5 * 60_000), 'pet.home.backOk');
  assert.equal(restBackKey(3 * 3_600_000), 'pet.home.backLong');
});
