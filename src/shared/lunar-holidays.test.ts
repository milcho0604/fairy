import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LUNAR_FIRST_YEAR, LUNAR_LAST_YEAR, lunarHolidays } from './lunar-holidays.ts';
import { outfitFor } from './wear.ts';

test('설날과 추석: 천문연 발표와 같은 날', () => {
  const known: [number, string, string][] = [
    [2025, '2025-01-29', '2025-10-06'],
    [2026, '2026-02-17', '2026-09-25'],
    [2027, '2027-02-07', '2027-09-15'],
    [2028, '2028-01-27', '2028-10-03'],
    [2030, '2030-02-03', '2030-09-12'],
    [2031, '2031-01-23', '2031-10-01'],
    [2035, '2035-02-08', '2035-09-16'],
    [2040, '2040-02-12', '2040-09-21'],
    [2050, '2050-01-23', '2050-09-30'],
  ];
  for (const [y, seollal, chuseok] of known)
    assert.deepEqual(lunarHolidays(y), { seollal, chuseok }, String(y));
});

test('설날과 추석 표: 2025~2100 모두 있고 말이 되는 날', () => {
  assert.equal(LUNAR_FIRST_YEAR, 2025);
  assert.equal(LUNAR_LAST_YEAR, 2100);
  assert.equal(lunarHolidays(2024), undefined);
  assert.equal(lunarHolidays(2101), undefined);
  for (let y = LUNAR_FIRST_YEAR; y <= LUNAR_LAST_YEAR; y++) {
    const h = lunarHolidays(y);
    assert.ok(h, String(y));
    // 설날은 1월 21일~2월 20일, 추석은 9월 7일~10월 8일 사이
    assert.ok(h.seollal >= `${y}-01-21` && h.seollal <= `${y}-02-20`, h.seollal);
    assert.ok(h.chuseok >= `${y}-09-07` && h.chuseok <= `${y}-10-08`, h.chuseok);
    // 설날에서 추석까지는 음력 일곱 달 반 (윤달이 끼면 한 달 더)
    const days = (Date.parse(h.chuseok) - Date.parse(h.seollal)) / 86_400_000;
    assert.ok((days >= 218 && days <= 223) || (days >= 248 && days <= 253), `${y} ${days}`);
  }
});

test('2030 년 뒤에도 명절 리본', () => {
  assert.equal(outfitFor('2031-01-23'), 'ribbon');
  assert.equal(outfitFor('2050-10-02'), 'ribbon');
  assert.equal(outfitFor('2050-10-03'), 'scarf');
  assert.equal(outfitFor('2100-02-09'), 'ribbon');
  assert.equal(outfitFor('2101-02-01'), 'beanie');
});
