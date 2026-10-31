import assert from 'node:assert/strict';
import test from 'node:test';
import { DUE_SOON_MS, dueUrgency } from './due-soon.ts';
import { atLocal } from './remind.ts';

const now = atLocal('2026-11-02', 14 * 60);

test('날짜만 있는 마감은 어제까지가 지남, 오늘은 아님', () => {
  assert.equal(dueUrgency({ due: '2026-11-01', dueMin: null }, now), 'overdue');
  assert.equal(dueUrgency({ due: '2026-11-02', dueMin: null }, now), null);
  assert.equal(dueUrgency({ due: null, dueMin: null }, now), null);
});

test('시각이 있으면 1시간 안은 임박, 지난 시각은 지남', () => {
  assert.equal(dueUrgency({ due: '2026-11-02', dueMin: 14 * 60 + 30 }, now), 'soon');
  assert.equal(dueUrgency({ due: '2026-11-02', dueMin: 15 * 60 }, now), 'soon');
  assert.equal(dueUrgency({ due: '2026-11-02', dueMin: 15 * 60 + 1 }, now), null);
  assert.equal(dueUrgency({ due: '2026-11-02', dueMin: 13 * 60 + 59 }, now), 'overdue');
  assert.equal(dueUrgency({ due: '2026-11-03', dueMin: 60 }, now), null);
  assert.equal(DUE_SOON_MS, 3_600_000);
});
