import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  COIN,
  EARN_RULES,
  earnAllowed,
  focusCoins,
  HOUSE_COSTS,
  isDay,
  JOURNEY_STEP_COUNT,
  mondayOf,
  ownedItemOk,
  spendRule,
} from './coin-rules.ts';
import { HOUSE_STYLES } from './house-art.ts';
import { JOURNEY_STEPS } from './journey.ts';
import { TOYS } from './shop.ts';

test('서버가 이 파일만 복사해 쓰므로 아무것도 가져오지 않는다', () => {
  const src = readFileSync(new URL('./coin-rules.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /require\(/);
});

test('하루 상한은 앱 규칙에서 나온다', () => {
  assert.equal(EARN_RULES.todo?.perDay, COIN.todo * COIN.dailyTodoLimit);
  assert.equal(EARN_RULES.focus?.perDay, 100);
  assert.equal(EARN_RULES.focus?.perEntry, focusCoins(50));
  assert.equal(EARN_RULES.meet?.perEntry, 60);
  assert.equal(EARN_RULES.weekly?.perWeek, 50);
  assert.equal(JOURNEY_STEP_COUNT, JOURNEY_STEPS.length);
});

test('earnAllowed: 상한까지만, 한 기록 최대를 넘으면 0', () => {
  const rule = { perEntry: 25, perDay: 100 };
  assert.equal(earnAllowed(rule, 25, 0, 0), 25);
  assert.equal(earnAllowed(rule, 25, 90, 0), 10);
  assert.equal(earnAllowed(rule, 25, 100, 0), 0);
  assert.equal(earnAllowed(rule, 26, 0, 0), 0);
  assert.equal(earnAllowed(rule, 1.5, 0, 0), 0);
  assert.equal(earnAllowed({ perEntry: 50, perWeek: 50 }, 50, 0, 50), 0);
});

test('spendRule: 상점 물건은 값과 이름표, 모르는 까닭은 없음', () => {
  assert.deepEqual(spendRule('toy:ball'), { kind: 'buy', price: 30, item: 'toy:ball' });
  assert.deepEqual(spendRule('house:1'), { kind: 'buy', price: HOUSE_COSTS[0], item: 'house', level: 1 });
  assert.equal(spendRule('house:6'), undefined);
  assert.equal(spendRule('house-style:wood'), undefined);
  assert.deepEqual(spendRule('custom-food'), { kind: 'spend', price: 50 });
  assert.deepEqual(spendRule('food'), { kind: 'spend' });
  assert.deepEqual(spendRule('undo'), { kind: 'takeBack' });
  assert.equal(spendRule('toy:constructor'), undefined);
  assert.equal(spendRule('nope'), undefined);
  // 상점의 모든 물건을 서버가 안다
  for (const t of TOYS) assert.equal(spendRule(`toy:${t.key}`)?.kind, 'buy');
  for (const s of HOUSE_STYLES) if (s !== 'wood') assert.equal(spendRule(`house-style:${s}`)?.kind, 'buy');
});

test('ownedItemOk 와 날짜', () => {
  assert.ok(ownedItemOk('house', 5));
  assert.ok(!ownedItemOk('house', 6));
  assert.ok(ownedItemOk('toy:yarn', 1));
  assert.ok(!ownedItemOk('toy:yarn', 2));
  assert.ok(!ownedItemOk('custom-food', 1));
  assert.ok(isDay('2026-02-28'));
  assert.ok(!isDay('2026-02-30'));
  assert.equal(mondayOf('2026-10-15'), '2026-10-12');
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
  assert.equal(mondayOf('2026-10-18'), '2026-10-12');
});
