// 반복 낱말과 시각이 같이 있는 한 줄 (감사 2차). 기준: 2026-10-14 수요일, 지금 오전 10시.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTodoLine } from './remind-parse.ts';

const today = '2026-10-14';
const ten = 10 * 60;
const at = (h: number, m = 0) => h * 60 + m;
const line = (s: string, now = ten, day = today) => {
  const r = parseTodoLine(s, day, now);
  return { title: r.title, due: r.due, dueMin: r.dueMin, repeat: r.repeat };
};

test('반복 낱말이 가운데나 끝에 있고 시각이 있으면 시각이 있는 반복 할 일', () => {
  const table: [string, unknown][] = [
    ['standup every weekday 9am', { title: 'standup', due: '2026-10-15', dueMin: at(9), repeat: 'weekdays' }],
    ['gym daily 7am', { title: 'gym', due: '2026-10-15', dueMin: at(7), repeat: 'daily' }],
    ['gym daily 6pm', { title: 'gym', due: today, dueMin: at(18), repeat: 'daily' }],
    ['weekly review fri 4pm', { title: 'review', due: '2026-10-16', dueMin: at(16), repeat: 'weekly' }],
    [
      'every monday 10am team sync',
      { title: 'team sync', due: '2026-10-19', dueMin: at(10), repeat: 'weekly' },
    ],
    ['매일 아침 7시 운동', { title: '운동', due: '2026-10-15', dueMin: at(7), repeat: 'daily' }],
    ['매주 수요일 오후 3시 회의', { title: '회의', due: today, dueMin: at(15), repeat: 'weekly' }],
    ['평일 오후 6시 퇴근 정리', { title: '퇴근 정리', due: today, dueMin: at(18), repeat: 'weekdays' }],
  ];
  for (const [s, want] of table) assert.deepEqual(line(s), want, s);
});

test('그 요일 시각이 지났으면 다음 주, 평일은 주말을 건너뛴다', () => {
  // 수요일 오후 4시에 "매주 수요일 오후 3시" → 다음 주 수요일
  assert.equal(line('매주 수요일 오후 3시 회의', at(16)).due, '2026-10-21');
  // 금요일 오전 10시에 "standup every weekday 9am" → 다음 월요일
  assert.equal(line('standup every weekday 9am', ten, '2026-10-16').due, '2026-10-19');
});

test('시각이 없으면 예전대로, 반복 없는 시각 줄은 반복이 아니다', () => {
  assert.deepEqual(line('매일 운동'), { title: '운동', due: today, dueMin: null, repeat: 'daily' });
  assert.equal(line('보고서 3시까지').repeat, null);
  assert.equal(line('매일경제 읽기 9am').repeat, null);
  assert.equal(parseTodoLine('매주 월요일 10시 회의!', today, ten).important, true);
});

test('날짜 낱말에 까지가 붙고 시각이 뒤에 오면 그 날짜 그 시각 ("내일까지 3시 보고서")', () => {
  assert.deepEqual(line('내일까지 3시 보고서'), {
    title: '보고서',
    due: '2026-10-15',
    dueMin: at(15),
    repeat: null,
  });
  assert.deepEqual(line('모레까지 오후 5시 정리'), {
    title: '정리',
    due: '2026-10-16',
    dueMin: at(17),
    repeat: null,
  });
  assert.deepEqual(line('내일 3시까지 보고서'), {
    title: '보고서',
    due: '2026-10-15',
    dueMin: at(15),
    repeat: null,
  });
});
