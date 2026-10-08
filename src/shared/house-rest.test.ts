import assert from 'node:assert/strict';
import { test } from 'node:test';
import { houseLayout } from './house-art.ts';
import {
  DOOR_MIN,
  doorFrame,
  doorPoint,
  nextRest,
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

test('문 드나들기: 처음은 문간 그대로, 끝은 문턱에 작게, 늘 정사각형', () => {
  const from = { x: 200, y: 600, width: 160, height: 160 };
  const door = { x: 150, y: 750 };
  assert.deepEqual(doorFrame(from, door, 0), from);
  const end = doorFrame(from, door, 1);
  assert.equal(end.width, Math.round(160 * DOOR_MIN));
  assert.equal(end.height, end.width);
  assert.ok(Math.abs(end.x + end.width / 2 - door.x) <= 1, '가운데가 문');
  assert.equal(end.y + end.height, door.y, '아래가 문턱');
  let last = Infinity;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const f = doorFrame(from, door, u);
    assert.equal(f.width, f.height);
    assert.ok(f.width <= last, '작아지기만 한다');
    last = f.width;
  }
  // 범위 밖 u 는 끝으로 자른다 (타이머가 조금 늦게 와도)
  assert.deepEqual(doorFrame(from, door, 1.4), end);
  assert.deepEqual(doorFrame(from, door, -0.2), from);
});

test('나왔을 때 한마디: 2분 안, 30분 안, 그 뒤', () => {
  assert.equal(restBackKey(30_000), 'pet.home.backShort');
  assert.equal(restBackKey(5 * 60_000), 'pet.home.backOk');
  assert.equal(restBackKey(3 * 3_600_000), 'pet.home.backLong');
});
