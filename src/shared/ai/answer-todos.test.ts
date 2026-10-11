import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTodos } from './answer-todos.ts';

const today = '2026-10-06'; // 화요일

test('마감 낱말은 마감으로, 안 끝낸 할 일이나 같은 줄은 뺀다, "!"는 중요가 아니다', () => {
  const planned = planTodos(
    ['내일 보고서 쓰기', '메일 정리', '메일  정리', 'Slides 만들기!', '매일 운동', '오늘의 메모 정리'],
    [{ title: '메일 정리' }, { title: 'slides 만들기' }],
    today,
  );
  assert.deepEqual(planned, [
    { title: '보고서 쓰기', due: '2026-10-07', repeat: null },
    { title: '운동', due: '2026-10-06', repeat: 'daily' },
    { title: '오늘의 메모 정리', due: null, repeat: null },
  ]);
});

test('영어 마감 낱말과 빈 목록', () => {
  assert.deepEqual(planTodos(['buy milk tomorrow'], [], today), [
    { title: 'buy milk', due: '2026-10-07', repeat: null },
  ]);
  assert.deepEqual(planTodos([], [], today), []);
});
