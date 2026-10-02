import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, parseQuickTodo } from './quick-add.ts';

const today = '2026-10-31';

test('날짜 낱말과 느낌표', () => {
  assert.deepEqual(parseQuickTodo('내일 보고서 쓰기!', today), {
    title: '보고서 쓰기',
    due: '2026-11-01',
    important: true,
  });
  assert.deepEqual(parseQuickTodo('보고서 쓰기 모레까지', today), {
    title: '보고서 쓰기',
    due: '2026-11-02',
    important: false,
  });
  assert.deepEqual(parseQuickTodo('!! 오늘까지 메일 답장', today), {
    title: '메일 답장',
    due: today,
    important: true,
  });
});

test('날짜 낱말이 제목 가운데나 붙어 있으면 제목 그대로', () => {
  assert.deepEqual(parseQuickTodo('오늘의 메모 정리', today), {
    title: '오늘의 메모 정리',
    due: null,
    important: false,
  });
  assert.deepEqual(parseQuickTodo('내일배움카드 신청', today), {
    title: '내일배움카드 신청',
    due: null,
    important: false,
  });
  assert.deepEqual(parseQuickTodo('  여러   칸  띄움  ', today), {
    title: '여러 칸 띄움',
    due: null,
    important: false,
  });
});

test('마감 표시', () => {
  assert.deepEqual(dueLabel(today, today), { text: '오늘', overdue: false });
  assert.deepEqual(dueLabel('2026-11-01', today), { text: '내일', overdue: false });
  assert.deepEqual(dueLabel('2026-10-29', today), { text: '10월 29일 지남', overdue: true });
  assert.deepEqual(dueLabel('2026-12-05', today), { text: '12월 5일', overdue: false });
});
