import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, parseQuickTodo } from './quick-add.ts';

const today = '2026-10-31';

test('날짜 낱말과 느낌표', () => {
  assert.deepEqual(parseQuickTodo('내일 보고서 쓰기!', today), {
    title: '보고서 쓰기',
    due: '2026-11-01',
    important: true,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('보고서 쓰기 모레까지', today), {
    title: '보고서 쓰기',
    due: '2026-11-02',
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('!! 오늘까지 메일 답장', today), {
    title: '메일 답장',
    due: today,
    important: true,
    repeat: null,
  });
});

test('날짜 낱말이 제목 가운데나 붙어 있으면 제목 그대로', () => {
  assert.deepEqual(parseQuickTodo('오늘의 메모 정리', today), {
    title: '오늘의 메모 정리',
    due: null,
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('내일배움카드 신청', today), {
    title: '내일배움카드 신청',
    due: null,
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('  여러   칸  띄움  ', today), {
    title: '여러 칸 띄움',
    due: null,
    important: false,
    repeat: null,
  });
});

test('반복 낱말: 매일, 평일, 매주. 마감은 오늘(평일은 다음 평일)', () => {
  // 2026-10-31 은 토요일
  assert.deepEqual(parseQuickTodo('매일 운동', today), {
    title: '운동',
    due: today,
    important: false,
    repeat: 'daily',
  });
  assert.deepEqual(parseQuickTodo('평일 스탠드업!', today), {
    title: '스탠드업',
    due: '2026-11-02',
    important: true,
    repeat: 'weekdays',
  });
  assert.deepEqual(parseQuickTodo('매주 내일 주간 보고', today), {
    title: '주간 보고',
    due: '2026-11-01',
    important: false,
    repeat: 'weekly',
  });
  assert.equal(parseQuickTodo('매일매일 일기', today).repeat, null);
});

test('마감 표시', () => {
  assert.deepEqual(dueLabel(today, today), { text: '오늘', overdue: false });
  assert.deepEqual(dueLabel('2026-11-01', today), { text: '내일', overdue: false });
  assert.deepEqual(dueLabel('2026-10-29', today), { text: '10월 29일 지남', overdue: true });
  assert.deepEqual(dueLabel('2026-12-05', today), { text: '12월 5일', overdue: false });
});

test('영어 날짜 낱말은 대소문자를 가리지 않는다', () => {
  assert.equal(parseQuickTodo('Tomorrow buy milk', today).due, '2026-11-01');
  assert.equal(parseQuickTodo('buy milk TODAY', today).title, 'buy milk');
});
