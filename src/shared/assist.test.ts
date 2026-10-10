// 비서 기능 (2026-10-10): 할 일 단계(9판), 지난 마감 옮기기, 찾기와 태그, 일정 겹침, 이번 주
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { clashIds, overlapping } from './event-overlap.ts';
import { allTags, filterTodos, titleParts, todoTags } from './todo-filter.ts';
import { STEP_MAX, stepProgress, TodoStore } from './todo-store.ts';
import { weekDays, weekStart, weekSummary } from './week.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 2, 9, 0); // 2026-10-02 (금) 09:00

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, store: new TodoStore(db, utcDay) };
}

test('9판 올리기: 8판 저장 파일에 단계 표가 생기고 예전 할 일은 단계가 없다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  for (let v = 0; v < 8; v++) db.exec(MIGRATIONS[v] ?? '');
  db.exec('pragma user_version = 8');
  db.prepare('insert into todo (title, created_at) values (?, ?)').run('예전 할 일', T0);
  assert.deepEqual(migrate(db), { from: 8, to: SCHEMA_VERSION });
  const todo = new TodoStore(db, utcDay).get(1);
  assert.deepEqual(todo?.steps, []);
});

test('단계: 더하고, 체크하고, 고치고, 지운다. 순서는 넣은 대로', () => {
  const { store } = fresh();
  const todo = store.add({ title: '발표 준비' }, T0);
  const a = store.addStep(todo.id, '  자료 찾기 ', T0);
  const b = store.addStep(todo.id, '초안', T0);
  assert.equal(store.addStep(todo.id, '   ', T0), undefined);
  assert.equal(store.addStep(999, '없는 할 일', T0), undefined);
  assert.deepEqual(
    store.get(todo.id)?.steps.map((s) => s.title),
    ['자료 찾기', '초안'],
  );
  store.toggleStep(a?.id ?? 0);
  assert.deepEqual(stepProgress(store.get(todo.id)?.steps ?? []), { done: 1, total: 2 });
  store.toggleStep(a?.id ?? 0, true); // 이미 함: 그대로
  assert.equal(store.get(todo.id)?.steps[0]?.done, true);
  store.renameStep(b?.id ?? 0, '초안 쓰기');
  store.renameStep(b?.id ?? 0, ' ');
  assert.equal(store.get(todo.id)?.steps[1]?.title, '초안 쓰기');
  assert.equal(store.stepOwner(b?.id ?? 0), todo.id);
  store.removeStep(a?.id ?? 0);
  assert.deepEqual(
    store.get(todo.id)?.steps.map((s) => s.title),
    ['초안 쓰기'],
  );
  assert.equal(stepProgress([]), undefined);
});

test('단계는 할 일마다 STEP_MAX 개까지, 끝낸 할 일에는 더하지 않는다', () => {
  const { store } = fresh();
  const todo = store.add({ title: '큰 일' }, T0);
  const titles = Array.from({ length: STEP_MAX + 5 }, (_, i) => `단계 ${i + 1}`);
  assert.equal(store.addSteps(todo.id, titles, T0), STEP_MAX);
  assert.equal(store.get(todo.id)?.steps.length, STEP_MAX);
  const other = store.add({ title: '작은 일' }, T0);
  store.complete(other.id, T0);
  assert.equal(store.addStep(other.id, '늦은 단계', T0), undefined);
});

test('반복 할 일을 끝내면 다음 회차에 단계를 안 한 채로 옮겨 적는다. 단계에는 코인이 없다', () => {
  const { store } = fresh();
  const todo = store.add({ title: '아침 루틴', repeat: 'daily', due: '2026-10-02' }, T0);
  const st = store.addStep(todo.id, '물 마시기', T0);
  store.addStep(todo.id, '스트레칭', T0);
  store.toggleStep(st?.id ?? 0, true);
  assert.equal(store.balance(), 0);
  store.complete(todo.id, T0);
  const next = store.list(T0).open.find((t) => t.title === '아침 루틴');
  assert.equal(next?.due, '2026-10-03');
  assert.deepEqual(
    next?.steps.map((s) => [s.title, s.done]),
    [
      ['물 마시기', false],
      ['스트레칭', false],
    ],
  );
  // 오늘 끝낸 목록에도 단계가 붙어 있다
  assert.equal(store.list(T0).doneToday[0]?.steps.length, 2);
});

test('지난 마감을 오늘로: 지난 것만 옮기고 원래 마감을 돌려준다', () => {
  const { store } = fresh();
  const late = store.add({ title: '지난 일', due: '2026-09-28' }, T0);
  const today = store.add({ title: '오늘 일', due: '2026-10-02' }, T0);
  const none = store.add({ title: '마감 없음' }, T0);
  const moved = store.moveOverdue('2026-10-02', T0);
  assert.deepEqual(moved, [{ id: late.id, due: '2026-09-28' }]);
  assert.equal(store.get(late.id)?.due, '2026-10-02');
  assert.equal(store.get(today.id)?.due, '2026-10-02');
  assert.equal(store.get(none.id)?.due, null);
  assert.deepEqual(store.moveOverdue('2026-10-02', T0), []);
});

test('태그: 제목 속 #낱말, 숫자만은 번호, 겹치면 하나', () => {
  assert.deepEqual(todoTags('보고서 쓰기 #회사 #급함!'), ['회사', '급함']);
  assert.deepEqual(todoTags('#회사 메일 #회사'), ['회사']);
  assert.deepEqual(todoTags('이슈 #12 고치기'), []);
  assert.deepEqual(todoTags('C#공부'), []);
  assert.deepEqual(todoTags('gym #Health'), ['Health']);
  assert.deepEqual(titleParts('메일 #회사 보내기'), [
    { text: '메일 ' },
    { text: '#회사', tag: '회사' },
    { text: ' 보내기' },
  ]);
  assert.deepEqual(titleParts('그냥 제목'), [{ text: '그냥 제목' }]);
  assert.deepEqual(
    allTags([
      { title: 'a #집' },
      { title: 'b #회사' },
      { title: 'c #회사' },
      { title: 'd #Home' },
      { title: 'e #home' },
    ]),
    [
      { tag: 'Home', n: 2 },
      { tag: '회사', n: 2 },
      { tag: '집', n: 1 },
    ],
  );
});

test('할 일 찾기: 제목과 단계, 대소문자 무시, 조합 중 한글, 태그와 같이', () => {
  const todos = [
    { title: '보고서 쓰기 #회사', steps: [{ title: '자료 모으기' }] },
    { title: 'Buy milk #집', steps: [] },
    { title: '운동 #집' },
  ];
  assert.equal(filterTodos(todos, {}).length, 3);
  assert.deepEqual(
    filterTodos(todos, { query: 'MILK' }).map((t) => t.title),
    ['Buy milk #집'],
  );
  assert.deepEqual(
    filterTodos(todos, { query: '자료' }).map((t) => t.title),
    ['보고서 쓰기 #회사'],
  );
  // "보곳" 을 치는 중(마지막 글자 "고" 조합 중)이면 "보고" 를 찾는다
  assert.equal(filterTodos(todos, { query: '보고', composing: true }).length, 1);
  assert.deepEqual(
    filterTodos(todos, { tag: '집' }).map((t) => t.title),
    ['Buy milk #집', '운동 #집'],
  );
  assert.deepEqual(
    filterTodos(todos, { tag: '집', query: '운' }).map((t) => t.title),
    ['운동 #집'],
  );
});

test('일정 겹침: 시각 일정끼리, 끝 시각이 없으면 30분, 종일과 자기 자신은 빼고', () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 9, 2, h, m);
  const list = [
    { id: 1, title: '회의', startAt: at(10), endAt: at(11), allDay: false },
    { id: 2, title: '점심', startAt: at(12), endAt: null, allDay: false },
    { id: 3, title: '여행', startAt: at(0), endAt: null, allDay: true },
  ];
  const hit = (h: number, m: number, end: number | null) =>
    overlapping(list, { title: '새', startAt: at(h, m), endAt: end, allDay: false }).map((e) => e.id);
  assert.deepEqual(hit(10, 30, null), [1]);
  assert.deepEqual(hit(11, 0, null), []); // 회의 끝나는 때에 시작: 안 겹침
  assert.deepEqual(hit(12, 20, null), [2]); // 점심은 12:00~12:30 으로 본다
  assert.deepEqual(hit(9, 0, at(13)), [1, 2]);
  assert.deepEqual(overlapping(list, { ...list[0], id: 1 } as (typeof list)[0]), []);
  assert.deepEqual(overlapping(list, { title: '종일', startAt: at(10), endAt: null, allDay: true }), []);
  assert.deepEqual(
    [
      ...clashIds([...list, { id: 4, title: '통화', startAt: at(10, 45), endAt: null, allDay: false }]),
    ].sort(),
    [1, 4],
  );
  assert.equal(clashIds(list).size, 0);
});

test('이번 주: 월요일부터, 지난주 같은 요일까지와 견주고, 다음 7일 마감을 센다', () => {
  assert.equal(weekStart('2026-10-02'), '2026-09-28'); // 금 → 월
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); // 일 → 그 주 월
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  const { thisWeek, lastWeek } = weekDays('2026-09-30'); // 수
  assert.equal(thisWeek.length, 7);
  assert.deepEqual(lastWeek, ['2026-09-21', '2026-09-22', '2026-09-23']);
  const facts: Record<string, { done: number; focusMin: number }> = {
    '2026-09-28': { done: 2, focusMin: 25 },
    '2026-09-30': { done: 1, focusMin: 50 },
    '2026-09-21': { done: 1, focusMin: 0 },
    '2026-09-24': { done: 9, focusMin: 0 }, // 지난주 목요일: 견주지 않는다
  };
  let asked: readonly string[] = [];
  const w = weekSummary(
    '2026-09-30',
    (days) => {
      asked = days;
      return days.map((day) => ({ day, ...(facts[day] ?? { done: 0, focusMin: 0 }) }));
    },
    [
      { due: '2026-10-01' },
      { due: '2026-10-07' },
      { due: '2026-10-08' },
      { due: '2026-09-29' },
      { due: null },
    ],
  );
  assert.ok(!asked.includes('2026-10-01'), '아직 안 온 날은 읽지 않는다');
  assert.equal(w.done, 3);
  assert.equal(w.focusMin, 75);
  assert.equal(w.lastDone, 1);
  assert.equal(w.dueSoon, 2);
  assert.deepEqual(
    w.days.map((d) => d.future),
    [false, false, false, true, true, true, true],
  );
});
