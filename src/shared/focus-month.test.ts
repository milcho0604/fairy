import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { StatStore } from './beta-stats.ts';
import { type Db, migrate } from './db-schema.ts';
import { focusedMinutes, skipGap, startFocus, tickFocus } from './focus.ts';
import { FOCUS_STEPS, focusLevel, isMonth, monthCells, monthTotals, shiftMonth } from './focus-month.ts';

// 시험은 시간대와 상관없게 날짜를 UTC 로 자른다.
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MIN = 60_000;

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new StatStore(db, utcDay);
}

test('단계: 0분은 0, 1분부터 1, 25분 2, 60분 3, 120분 4', () => {
  assert.deepEqual(FOCUS_STEPS, [1, 25, 60, 120]);
  assert.deepEqual([0, 1, 24, 25, 59, 60, 119, 120, 600].map(focusLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('달 넘기기: 해를 넘기고, 모양이 틀린 달은 거른다', () => {
  assert.equal(shiftMonth('2026-10', 1), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-03', -15), '2024-12');
  assert.equal(isMonth('2026-10'), true);
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('2026-1'), false);
  assert.equal(isMonth('2026-10-01'), false);
  assert.equal(isMonth(undefined), false);
});

test('달력 칸: 월요일 시작, 앞뒤는 빈 칸, 윤년 2월, 아직 안 온 날', () => {
  // 2026-10-01 은 목요일 -> 앞 3칸이 빈 칸, 31일, 뒤 빈 칸으로 7의 배수
  const weeks = monthCells('2026-10', [{ day: '2026-10-05', min: 75, longest: 40 }], '2026-10-16');
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(
    weeks[0]?.map((c) => c.day),
    [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
  );
  const five = weeks.flat().find((c) => c.day === '2026-10-05');
  assert.deepEqual(
    { min: five?.min, longest: five?.longest, level: five?.level, future: five?.future },
    { min: 75, longest: 40, level: 3, future: false },
  );
  assert.equal(weeks.flat().find((c) => c.day === '2026-10-17')?.future, true);
  assert.equal(weeks.flat().filter((c) => c.day).length, 31);
  // 2028 년 2월(윤년)은 29일, 2026 년 2월은 28일
  assert.equal(
    monthCells('2028-02', [], '2030-01-01')
      .flat()
      .filter((c) => c.day).length,
    29,
  );
  assert.equal(
    monthCells('2026-02', [], '2030-01-01')
      .flat()
      .filter((c) => c.day).length,
    28,
  );
});

test('가장 길게 이어 간 집중은 총 분을 넘지 않게 맞춘다', () => {
  const c = monthCells('2026-10', [{ day: '2026-10-02', min: 20, longest: 50 }], '2026-10-16')
    .flat()
    .find((x) => x.day === '2026-10-02');
  assert.equal(c?.longest, 20);
});

test('한 달 합계와 집중한 날 수', () => {
  assert.deepEqual(
    monthTotals([
      { day: '2026-10-01', min: 25, longest: 25 },
      { day: '2026-10-02', min: 0, longest: 0 },
      { day: '2026-10-03', min: 80, longest: 50 },
    ]),
    { min: 105, days: 2 },
  );
});

test('집중을 끝낼 때마다 한 줄: 날 합계와 가장 길게 이어 간 집중', () => {
  const stats = fresh();
  const day = Date.UTC(2026, 9, 5, 9, 0);
  stats.addFocus(day, 25);
  stats.addFocus(day + 40 * MIN, 50);
  stats.addFocus(day + 120 * MIN, 25);
  stats.addFocus(day + 130 * MIN, 0);
  stats.addFocus(day + 131 * MIN, Number.NaN);
  assert.deepEqual(stats.focusMonth('2026-10'), [{ day: '2026-10-05', min: 100, longest: 50 }]);
  assert.deepEqual(stats.focusMonth('2026-09'), []);
  assert.equal(stats.firstFocusDay(), '2026-10-05');
});

test('자정을 넘긴 집중은 끝난 날에 한 번만 센다', () => {
  const stats = fresh();
  // 23시 50분에 시작해 0시 20분에 끝난 30분
  stats.addFocus(Date.UTC(2026, 9, 6, 0, 20), 30);
  assert.deepEqual(stats.focusMonth('2026-10'), [{ day: '2026-10-06', min: 30, longest: 30 }]);
  // 달이 바뀌는 자정도 끝난 날의 달로
  stats.addFocus(Date.UTC(2026, 10, 1, 0, 10), 25);
  assert.deepEqual(stats.focusMonth('2026-10'), [{ day: '2026-10-06', min: 30, longest: 30 }]);
  assert.deepEqual(stats.focusMonth('2026-11'), [{ day: '2026-11-01', min: 25, longest: 25 }]);
});

test('중간에 그만두면 그만큼만, 잠자기로 건너뛴 시간은 집중에 들지 않는다', () => {
  const stats = fresh();
  const start = Date.UTC(2026, 9, 7, 14, 0);
  // 25분 집중 중 10분째에 컴퓨터가 3시간 잠들었다 깬다: 건너뛴 시간은 집중이 아니다
  let s = startFocus(start, 25);
  const lastTick = start + 10 * MIN;
  const wake = lastTick + 180 * MIN;
  s = skipGap(s, lastTick, wake, 15_000);
  const end = s.endsAt;
  const r = tickFocus(s, end);
  assert.equal(r.event, 'focus-done');
  const minutes = focusedMinutes(s, end);
  assert.equal(minutes, 25);
  stats.addFocus(end, minutes);
  // 이어서 10분 하다 그만둔 집중
  const second = startFocus(end + 5 * MIN, 25);
  const stopAt = second.startedAt + 10 * MIN + 30_000;
  stats.addFocus(stopAt, focusedMinutes(second, stopAt));
  const day = stats.focusMonth('2026-10')[0];
  assert.equal(day?.min, 35);
  assert.equal(day?.longest, 25);
});

test('옛 판 기록(집중 합계만 있고 한 번 기록이 없는 날)은 가장 길게 0', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  db.prepare("insert into daily_stat (day, focus_min) values ('2026-09-30', 90)").run();
  const stats = new StatStore(db, utcDay);
  assert.deepEqual(stats.focusMonth('2026-09'), [{ day: '2026-09-30', min: 90, longest: 0 }]);
});
