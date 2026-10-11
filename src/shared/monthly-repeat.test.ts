// 매달 반복 할 일 (2026-10-11): 다음 회차 셈(달 끝, 윤년), 빠른 입력(한국어, 영어), 끝내기와 되돌리기, 지난 마감 옮기기
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { habitStreak } from './achieve.ts';
import { type Db, migrate } from './db-schema.ts';
import { parseQuickTodo } from './quick-add.ts';
import { parseTodoLine } from './remind-parse.ts';
import { dayInMonth, isRepeat, monthAnchor, nextDue, nextMonthly, TodoStore } from './todo-store.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (day: string, h = 9) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`);

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}

test('달에 없는 날은 그달 끝 (2월, 윤년, 30일 달)', () => {
  assert.equal(dayInMonth(2026, 2, 31), '2026-02-28');
  assert.equal(dayInMonth(2028, 2, 30), '2028-02-29');
  assert.equal(dayInMonth(2026, 4, 31), '2026-04-30');
  assert.equal(dayInMonth(2026, 12, 25), '2026-12-25');
});

test('다음 회차: 31일은 2월에 28일, 3월에 다시 31일. 윤년은 29일', () => {
  assert.equal(nextMonthly('2026-01-31', 31, '2026-01-31'), '2026-02-28');
  assert.equal(nextMonthly('2026-02-28', 31, '2026-02-28'), '2026-03-31');
  assert.equal(nextMonthly('2028-01-31', 31, '2028-01-31'), '2028-02-29');
  assert.equal(nextMonthly('2028-02-29', 29, '2028-02-29'), '2028-03-29');
  assert.equal(nextMonthly('2027-01-29', 29, '2027-01-29'), '2027-02-28');
  assert.equal(nextMonthly('2027-02-28', 29, '2027-02-28'), '2027-03-29');
  // 해를 넘긴다
  assert.equal(nextMonthly('2026-12-15', 15, '2026-12-15'), '2027-01-15');
  // 일찍 끝내도 다음 달 (이번 회차를 건너뛰지 않는다)
  assert.equal(nextMonthly('2026-10-25', 25, '2026-10-20'), '2026-11-25');
  // 밀린 회차를 한꺼번에 만들지 않는다: 오늘 뒤 가장 가까운 그날
  assert.equal(nextMonthly('2026-07-25', 25, '2026-10-11'), '2026-10-25');
  assert.equal(nextMonthly('2026-07-25', 25, '2026-10-26'), '2026-11-25');
  // 오늘로 옮긴 회차(원래 9월 30일)를 끝내면 이번 달 30일
  assert.equal(nextMonthly('2026-10-11', 30, '2026-10-11'), '2026-10-30');
  assert.equal(nextDue('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
  assert.equal(nextDue('2026-02-28', 'monthly', '2026-02-28', 31), '2026-03-31');
});

test('매달 날 기억: "31" 이 있으면 그것, 없으면 마감일의 날, 매주 기억(날짜)은 날로 읽지 않는다', () => {
  assert.equal(monthAnchor('31', '2026-02-28'), 31);
  assert.equal(monthAnchor(null, '2026-02-28'), 28);
  assert.equal(monthAnchor('2026-09-30', '2026-10-11'), 11);
  assert.equal(monthAnchor(null, null), undefined);
  assert.equal(isRepeat('monthly'), true);
});

test('빠른 입력: 매달, 매월, N일마다, every month, monthly, of every month', () => {
  const today = '2026-10-11';
  const p = (s: string) => {
    const r = parseQuickTodo(s, today);
    return [r.title, r.due, r.repeat, r.repeatDay];
  };
  assert.deepEqual(p('매달 25일 월세'), ['월세', '2026-10-25', 'monthly', 25]);
  assert.deepEqual(p('매월 1일 카드값'), ['카드값', '2026-11-01', 'monthly', 1]);
  assert.deepEqual(p('관리비 매달 10일'), ['관리비', '2026-11-10', 'monthly', 10]);
  assert.deepEqual(p('25일마다 적금'), ['적금', '2026-10-25', 'monthly', 25]);
  assert.deepEqual(p('매달 31일 정산'), ['정산', '2026-10-31', 'monthly', 31]);
  assert.deepEqual(p('매달 11일 정산!'), ['정산', today, 'monthly', 11]);
  assert.deepEqual(p('pay rent every month on the 15th'), ['pay rent', '2026-10-15', 'monthly', 15]);
  assert.deepEqual(p('monthly on the 31st rent'), ['rent', '2026-10-31', 'monthly', 31]);
  assert.deepEqual(p('rent on the 1st of every month'), ['rent', '2026-11-01', 'monthly', 1]);
  assert.deepEqual(p('every month the 3rd backup'), ['backup', '2026-11-03', 'monthly', 3]);
  // 11월에 넣은 "매달 31일": 첫 마감은 30일, 날은 31로 기억
  const nov = parseQuickTodo('매달 31일 정산', '2026-11-05');
  assert.deepEqual([nov.due, nov.repeatDay], ['2026-11-30', 31]);
  // 날이 없으면 반복이 아니다 (제목 낱말)
  assert.deepEqual(p('monthly report'), ['monthly report', null, null, undefined]);
  assert.deepEqual(p('매달 정산'), ['매달 정산', null, null, undefined]);
  assert.deepEqual(p('매달 32일 정산')[2], null);
  // 시각이 있으면 마감 시각
  const timed = parseTodoLine('매달 25일 오전 9시 월세', today, 10 * 60);
  assert.deepEqual(
    [timed.title, timed.due, timed.repeat, timed.dueMin],
    ['월세', '2026-10-25', 'monthly', 540],
  );
});

test('끝내면 다음 달 회차, 31일 반복은 2월 끝을 지나 3월 31일로, 되돌리면 다음 회차를 걷는다', () => {
  const { store } = fresh();
  const a = store.add(
    { title: '정산', due: '2026-01-31', repeat: 'monthly', repeatDay: 31 },
    at('2026-01-10'),
  );
  store.complete(a.id, at('2026-01-31'));
  const feb = store.list(at('2026-02-01')).open[0];
  assert.deepEqual([feb?.title, feb?.due, feb?.repeat], ['정산', '2026-02-28', 'monthly']);
  store.complete(feb?.id ?? 0, at('2026-02-28'));
  const mar = store.list(at('2026-03-01')).open[0];
  assert.equal(mar?.due, '2026-03-31');
  // 되돌리기: 3월 회차가 사라지고 2월 회차가 다시 열린다
  store.undo(feb?.id ?? 0, at('2026-02-28', 10));
  const open = store.list(at('2026-02-28', 11)).open;
  assert.deepEqual(
    open.map((x) => x.due),
    ['2026-02-28'],
  );
  // 다시 끝내도 3월 31일 (날 기억이 그대로)
  store.complete(open[0]?.id ?? 0, at('2026-02-28', 12));
  assert.equal(store.list(at('2026-03-01')).open[0]?.due, '2026-03-31');
});

test('11월에 넣은 매달 31일은 30일 마감, 끝내면 12월 31일', () => {
  const { store } = fresh();
  const r = parseQuickTodo('매달 31일 정산', '2026-11-05');
  const a = store.add(r, at('2026-11-05'));
  assert.equal(a.due, '2026-11-30');
  store.complete(a.id, at('2026-11-30'));
  assert.equal(store.list(at('2026-12-01')).open[0]?.due, '2026-12-31');
});

test('지난 마감 옮기기: 오늘로 옮겨도 날을 기억해 끝내면 원래 날로', () => {
  const { store } = fresh();
  const a = store.add({ title: '월세', due: '2026-09-30', repeat: 'monthly' }, at('2026-09-01'));
  const moved = store.moveOverdue('2026-10-11', at('2026-10-11'));
  assert.deepEqual(moved, [{ id: a.id, due: '2026-09-30' }]);
  assert.equal(store.get(a.id)?.due, '2026-10-11');
  store.complete(a.id, at('2026-10-11'));
  assert.equal(store.list(at('2026-10-11', 10)).open[0]?.due, '2026-10-30');
  // 31일 반복을 옮겨도 31일
  const b = store.add(
    { title: '정산', due: '2026-09-30', repeat: 'monthly', repeatDay: 31 },
    at('2026-09-01'),
  );
  store.moveOverdue('2026-10-11', at('2026-10-11', 11));
  store.complete(b.id, at('2026-10-11', 12));
  assert.ok(store.list(at('2026-10-11', 13)).open.some((x) => x.title === '정산' && x.due === '2026-10-31'));
});

test('마감을 고치면 고친 날이 새 날이다, 반복 메뉴로 매달을 고를 수 있다', () => {
  const { store } = fresh();
  const a = store.add(
    { title: '정산', due: '2026-11-30', repeat: 'monthly', repeatDay: 31 },
    at('2026-11-01'),
  );
  store.update(a.id, { due: '2026-11-15' });
  store.complete(a.id, at('2026-11-15'));
  assert.equal(store.list(at('2026-11-16')).open[0]?.due, '2026-12-15');
  const b = store.add({ title: '카드값', due: '2026-11-20' }, at('2026-11-01'));
  assert.equal(store.update(b.id, { repeat: 'monthly' })?.repeat, 'monthly');
});

test('매달 습관 연속은 달마다 센다. 이번 달을 아직 안 했으면 지난달까지', () => {
  const done = new Set(['2026-08-25', '2026-09-26', '2026-10-01']);
  assert.equal(habitStreak(done, '2026-10-11', 'monthly', []), 3);
  assert.equal(habitStreak(new Set(['2026-08-25', '2026-09-26']), '2026-10-11', 'monthly', []), 2);
  assert.equal(habitStreak(new Set(['2026-07-25', '2026-09-26']), '2026-10-11', 'monthly', []), 1);
  assert.equal(habitStreak(new Set(['2025-12-31', '2026-01-02']), '2026-01-15', 'monthly', []), 2);
  assert.equal(habitStreak(new Set(), '2026-01-15', 'monthly', []), 0);
});
