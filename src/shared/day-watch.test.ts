import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWatch } from './day-watch.ts';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test('자정을 넘기면 한 번만 다시 보낸다', () => {
  let now = Date.UTC(2026, 9, 12, 23, 59);
  let turns = 0;
  const w = dayWatch({ now: () => now, day, onTurn: () => turns++ });
  assert.equal(w.check(), false);
  now = Date.UTC(2026, 9, 13, 0, 1);
  assert.equal(w.check(), true);
  assert.equal(w.check(), false);
  assert.equal(turns, 1);
});

test('그사이 다른 일로 새 날을 그렸으면 또 보내지 않는다', () => {
  let now = Date.UTC(2026, 9, 31, 23, 59);
  let turns = 0;
  const w = dayWatch({ now: () => now, day, onTurn: () => turns++ });
  now = Date.UTC(2026, 10, 1, 0, 0);
  w.seen(day(now));
  assert.equal(w.check(), false);
  // 잠자다 며칠 뒤 깨어나도 한 번
  now = Date.UTC(2026, 10, 4, 9, 0);
  assert.equal(w.check(), true);
  assert.equal(turns, 1);
});
