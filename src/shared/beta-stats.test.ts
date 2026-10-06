import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { addDays, daysBetween, median, reportText, StatStore } from './beta-stats.ts';
import { type Db, migrate } from './db-schema.ts';
import { TodoStore } from './todo-store.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 6, 9, 0); // 2026-10-06 09:00

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { stats: new StatStore(db, utcDay), todos: new TodoStore(db, utcDay) };
}

test('중앙값: 홀수, 짝수, 빈 목록', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test('날짜 더하기와 사이 날 수는 달과 해를 넘어도 맞다', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-09-28', '2026-10-06'), 8);
});

test('기록이 없으면 0 과 빈 날', () => {
  const { stats } = fresh();
  const r = stats.report(T0);
  assert.equal(r.firstDay, null);
  assert.equal(r.dayNumber, 0);
  assert.equal(r.daysUsed, 0);
  assert.equal(r.hiddenRatio, 0);
  assert.equal(r.days.length, 14);
  assert.equal(r.days.at(-1)?.day, '2026-10-06');
  assert.match(reportText(r, { version: '0.1.0', os: 'mac' }), /아직 기록 없음/);
});

test('켠 분, 숨긴 분, 같이 보기, 비정상 종료를 날짜별로 센다', () => {
  const { stats } = fresh();
  for (let i = 0; i < 90; i++) stats.tick(T0 + i * 60_000, i < 30);
  stats.tick(T0 + DAY, false);
  stats.countLook(T0);
  stats.countLook(T0 + DAY);
  stats.countCrash(T0 + DAY);
  const r = stats.report(T0 + DAY);
  assert.equal(r.firstDay, '2026-10-06');
  assert.equal(r.dayNumber, 2);
  assert.equal(r.daysUsed, 2);
  assert.equal(r.hiddenRatio, 30 / 91);
  assert.equal(r.look7, 2);
  assert.equal(r.crash7, 1);
  const today = r.days.at(-1);
  assert.deepEqual(today, {
    day: '2026-10-07',
    onMin: 1,
    hiddenMin: 0,
    lookCount: 1,
    crashCount: 1,
    focusMin: 0,
    done: 0,
  });
});

test('완료 할 일 중앙값은 켠 날만 본다. 지운 할 일과 되돌린 할 일은 빼고', () => {
  const { stats, todos } = fresh();
  // 첫날 4개, 둘째 날 1개, 셋째 날은 안 켬
  for (let d = 0; d < 2; d++) stats.tick(T0 + d * DAY, false);
  const done = (n: number, at: number) => {
    for (let i = 0; i < n; i++) todos.complete(todos.add({ title: `일 ${i}` }, at).id, at);
  };
  done(4, T0);
  done(1, T0 + DAY);
  const removed = todos.add({ title: '지울 일' }, T0);
  todos.complete(removed.id, T0);
  todos.remove(removed.id, T0);
  const undone = todos.add({ title: '되돌린 일' }, T0);
  todos.complete(undone.id, T0);
  todos.undo(undone.id, T0);
  const r = stats.report(T0 + 2 * DAY);
  assert.equal(r.doneMedian, 2.5);
  assert.equal(r.dayNumber, 3);
  assert.equal(r.daysUsed, 2);
});

test('집중 분은 날짜별로 더한다', () => {
  const { stats } = fresh();
  stats.addFocus(T0, 25);
  stats.addFocus(T0, 10);
  stats.addFocus(T0, 0);
  assert.equal(stats.report(T0).days.at(-1)?.focusMin, 35);
});

test('최근 7일 합계는 8일 전 기록을 넣지 않는다', () => {
  const { stats } = fresh();
  stats.countLook(T0 - 7 * DAY);
  stats.countCrash(T0 - 7 * DAY);
  stats.countLook(T0 - 6 * DAY);
  const r = stats.report(T0);
  assert.equal(r.look7, 1);
  assert.equal(r.crash7, 0);
});

test('복사 글에는 숫자와 날짜만, 할 일 제목은 없다', () => {
  const { stats, todos } = fresh();
  stats.tick(T0, false);
  todos.complete(todos.add({ title: '비밀 프로젝트 보고서' }, T0).id, T0);
  const text = reportText(stats.report(T0), { version: '0.1.0', os: 'mac' });
  assert.doesNotMatch(text, /비밀/);
  assert.match(text, /2026-10-06, 1분, 0분, 1, 0, 0, 0분/);
  assert.match(text, /중앙값 1개/);
});
