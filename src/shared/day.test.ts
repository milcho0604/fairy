import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plusDays, weekdayOf } from './day.ts';

test('날짜 더하기: 달, 해, 윤년 넘기기와 빼기', () => {
  assert.equal(plusDays('2026-10-07', 1), '2026-10-08');
  assert.equal(plusDays('2026-10-31', 1), '2026-11-01');
  assert.equal(plusDays('2026-12-31', 1), '2027-01-01');
  assert.equal(plusDays('2028-02-28', 1), '2028-02-29');
  assert.equal(plusDays('2026-02-28', 1), '2026-03-01');
  assert.equal(plusDays('2026-01-01', -1), '2025-12-31');
  assert.equal(plusDays('2026-10-07', 0), '2026-10-07');
  assert.equal(plusDays('2026-10-07', 365), '2027-10-07');
});

test('서머타임이 바뀌는 날에도 하루씩 (시간대와 무관)', () => {
  const before = process.env.TZ;
  try {
    for (const tz of ['America/New_York', 'Europe/Berlin', 'Australia/Sydney', 'Asia/Seoul']) {
      process.env.TZ = tz;
      // 미국 2026-03-08, 11-01 / 유럽 03-29, 10-25 / 호주 04-05, 10-04
      for (const day of [
        '2026-03-08',
        '2026-11-01',
        '2026-03-29',
        '2026-10-25',
        '2026-04-05',
        '2026-10-04',
      ]) {
        const next = plusDays(day, 1);
        assert.equal(plusDays(next, -1), day, `${tz} ${day}`);
        assert.equal((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000, 1);
      }
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('요일', () => {
  assert.equal(weekdayOf('2026-10-07'), 3); // 수
  assert.equal(weekdayOf('2026-10-11'), 0); // 일
  assert.equal(weekdayOf('2026-10-10'), 6); // 토
});
