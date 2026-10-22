import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announceStep, ELAPSED_ANNOUNCE_SEC, ELAPSED_SHOW_AFTER_SEC, elapsedOf } from './wait.ts';

test('경과 시간: 분과 초로 나눈다', () => {
  assert.deepEqual(elapsedOf(0), { min: 0, sec: 0 });
  assert.deepEqual(elapsedOf(8999), { min: 0, sec: 8 });
  assert.deepEqual(elapsedOf(60_000), { min: 1, sec: 0 });
  assert.deepEqual(elapsedOf(125_400), { min: 2, sec: 5 });
  assert.deepEqual(elapsedOf(-5), { min: 0, sec: 0 });
});

test('화면 읽기 프로그램에는 30초 단위로만 알린다', () => {
  assert.equal(announceStep(0), 0);
  assert.equal(announceStep(29_999), 0);
  assert.equal(announceStep(30_000), 30);
  assert.equal(announceStep(61_000), 60);
  assert.ok(ELAPSED_ANNOUNCE_SEC > ELAPSED_SHOW_AFTER_SEC);
});
