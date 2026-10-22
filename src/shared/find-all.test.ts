import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIND_PER_KIND, findAll } from './find-all.ts';

const NOW = Date.UTC(2026, 9, 23, 3, 0);
const DAY = 86_400_000;

const src = {
  todos: [
    { id: 3, title: '병원 서류 내기', due: null, doneAt: NOW - 1000 },
    { id: 1, title: '병원 예약 전화', due: null, doneAt: null },
    { id: 2, title: '보고서 쓰기', due: '2026-10-25', doneAt: null, steps: [{ title: '병원 자료 모으기' }] },
    { id: 4, title: '장보기', due: null, doneAt: null },
  ],
  notes: [
    { id: 10, title: '와이파이', body: '비번 abc 병원 대기실' },
    { id: 11, title: '', body: '병원 가는 길\n지하철 2호선' },
    { id: 12, title: '레시피', body: '된장찌개' },
  ],
  events: [
    { id: 20, title: '병원 진료', startAt: NOW - 3 * DAY, allDay: false },
    { id: 21, title: '병원 검진', startAt: NOW + 2 * DAY, allDay: true },
    { id: 22, title: '병원 재진', startAt: NOW + 1 * DAY, allDay: false },
    { id: 23, title: '회의', startAt: NOW + DAY, allDay: false },
    { id: 24, title: '병원 옛 진료', startAt: NOW - 5 * DAY, allDay: false },
  ],
};

test('한 번에 찾기: 할 일, 메모, 일정에서 같은 규칙으로', () => {
  const r = findAll('병원', src, NOW);
  // 할 일: 제목과 단계 제목, 안 끝낸 것이 먼저
  assert.deepEqual(
    r.todos.map((x) => [x.id, x.done]),
    [
      [1, false],
      [2, false],
      [3, true],
    ],
  );
  // 메모: 제목이 없으면 첫 줄이 제목, 본문에서만 찾으면 둘레 글
  assert.deepEqual(
    r.notes.map((x) => x.id),
    [10, 11],
  );
  assert.ok(r.notes[0]?.snippet?.includes('병원'));
  assert.equal(r.notes[1]?.title, '병원 가는 길');
  // 일정: 앞으로 올 것(가까운 것부터) 다음 지난 것(최근 것부터)
  assert.deepEqual(
    r.events.map((x) => x.id),
    [22, 21, 20, 24],
  );
  assert.deepEqual(r.more, { todos: 0, notes: 0, events: 0 });
});

test('한 번에 찾기: 대소문자 무시, 빈칸 아무거나, 빈 말이면 빈 결과, 없으면 빈 결과', () => {
  const en = findAll('wifi  PASS', { ...src, notes: [{ id: 1, title: 'x', body: 'Wifi\npassword' }] }, NOW);
  assert.equal(en.notes.length, 1);
  assert.deepEqual(findAll('   ', src, NOW).todos, []);
  const none = findAll('없는말', src, NOW);
  assert.equal(none.todos.length + none.notes.length + none.events.length, 0);
});

test('한 번에 찾기: 종류마다 FIND_PER_KIND 개까지, 나머지는 more', () => {
  const many = {
    ...src,
    todos: Array.from({ length: FIND_PER_KIND + 3 }, (_, i) => ({
      id: 100 + i,
      title: `병원 ${i}`,
      due: null,
      doneAt: null,
    })),
  };
  const r = findAll('병원', many, NOW);
  assert.equal(r.todos.length, FIND_PER_KIND);
  assert.equal(r.more.todos, 3);
});
