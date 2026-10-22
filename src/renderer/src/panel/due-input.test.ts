import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueToSend, minuteToSend } from './due-input.ts';

test('마감일: 덜 찬 값, 연도 1000 미만, 없는 날은 보내지 않는다', () => {
  assert.equal(dueToSend(''), undefined);
  assert.equal(dueToSend('0002-10-22'), undefined);
  assert.equal(dueToSend('0202-10-22'), undefined);
  assert.equal(dueToSend('2026-02-30'), undefined);
  assert.equal(dueToSend('2026-13-01'), undefined);
  assert.equal(dueToSend('2026-10-22'), '2026-10-22');
  assert.equal(dueToSend('2028-02-29'), '2028-02-29');
});

test('마감 시각: 칸이 비었거나 덜 찼으면 보내지 않는다 (시각이 지워지지 않는다)', () => {
  assert.equal(minuteToSend(''), undefined);
  assert.equal(minuteToSend('15:'), undefined);
  assert.equal(minuteToSend('25:00'), undefined);
  assert.equal(minuteToSend('15:30'), 930);
  assert.equal(minuteToSend('00:00'), 0);
});
