import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { EARN_RULES, focusCoins, focusReward } from './coin-rules.ts';
import { type Db, migrate } from './db-schema.ts';
import { FOCUS_CUSTOM, isFocusMinutes } from './focus.ts';
import { TodoStore } from './todo-store.ts';

// 직접 고른 집중 길이 (#146): 5~120분, 코인은 50분 값까지만 (서버가 집중 기록 하나를 focusCoins(50) 으로 거른다)

test('직접 집중 길이: 5에서 120 사이 정수만', () => {
  assert.deepEqual([FOCUS_CUSTOM.min, FOCUS_CUSTOM.max], [5, 120]);
  for (const ok of [5, 15, 25, 40, 50, 90, 120]) assert.equal(isFocusMinutes(ok), true, String(ok));
  for (const bad of [4, 0, -5, 121, 25.5, Number.NaN, '40', null, undefined])
    assert.equal(isFocusMinutes(bad), false, String(bad));
});

test('집중 코인: 50분을 넘는 길이도 50분 값 이하, 서버 한 기록 상한을 넘지 않는다', () => {
  assert.equal(focusReward(15), focusCoins(15));
  assert.equal(focusReward(25), focusCoins(25));
  assert.equal(focusReward(50), focusCoins(50));
  assert.equal(focusReward(120), focusCoins(50));
  assert.ok(focusCoins(120) > focusCoins(50), '직접 120분을 그대로 주면 서버 상한을 넘는다');
  for (let m = 5; m <= 120; m++) assert.ok(focusReward(m) <= (EARN_RULES.focus?.perEntry ?? 0), String(m));
});

test('집중이 끝나면 받는 코인도 50분 값까지', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const store = new TodoStore(db);
  const now = Date.UTC(2026, 9, 23, 3);
  assert.equal(store.rewardFocus(now, 120), focusCoins(50));
  assert.equal(store.rewardFocus(now + 1, 5), focusCoins(5));
});
