import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTodosKey, refreshedPicks } from './plan-refresh.ts';

test('아침 계획 다시 받기 열쇠: 할 일이 더해지거나 바뀌면 달라진다', () => {
  const a = { id: 1, title: '보고서', due: null, important: false };
  assert.equal(planTodosKey([]), '');
  assert.notEqual(planTodosKey([a]), planTodosKey([]));
  assert.notEqual(planTodosKey([a]), planTodosKey([{ ...a, important: true }]));
  assert.equal(planTodosKey([a]), planTodosKey([{ ...a }]));
});

test('다시 받은 고를 거리: 손대지 않았으면 새로 골라 둔 것, 손댔으면 남은 것만', () => {
  // 할 일이 없을 때 떴다가 할 일을 넣음: 새로 골라 둔 것을 쓴다
  assert.deepEqual(refreshedPicks([], { suggested: [] }, { suggested: [5], candidates: [{ id: 5 }] }), [5]);
  // 사용자가 고른 것은 그대로, 지운 할 일은 뺀다
  assert.deepEqual(
    refreshedPicks(
      [1, 3],
      { suggested: [1, 2] },
      { suggested: [1, 2, 4], candidates: [{ id: 1 }, { id: 2 }, { id: 4 }] },
    ),
    [1],
  );
});
