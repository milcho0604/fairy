import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueChoices, nextMonday } from './due-choices.ts';

test('다음 주 월요일: 요일마다 (2026-10-19 월요일부터 한 주)', () => {
  const table: [string, string][] = [
    ['2026-10-19', '2026-10-26'], // 월 -> 다음 월
    ['2026-10-20', '2026-10-26'], // 화
    ['2026-10-21', '2026-10-26'],
    ['2026-10-22', '2026-10-26'],
    ['2026-10-23', '2026-10-26'], // 금
    ['2026-10-24', '2026-10-26'], // 토
    ['2026-10-25', '2026-10-26'], // 일 -> 내일
    ['2026-12-31', '2027-01-04'], // 해 넘김
    ['2028-02-26', '2028-02-28'], // 윤년 토요일
  ];
  for (const [today, want] of table) assert.equal(nextMonday(today), want, today);
});

test('마감 고르기 메뉴: 오늘, 내일, 다음 주 월요일. 일요일은 겹치는 월요일을 뺀다', () => {
  assert.deepEqual(dueChoices('2026-10-21'), [
    { key: 'today', day: '2026-10-21' },
    { key: 'tomorrow', day: '2026-10-22' },
    { key: 'nextMon', day: '2026-10-26' },
  ]);
  assert.deepEqual(
    dueChoices('2026-10-25').map((c) => c.key),
    ['today', 'tomorrow'],
  );
});
