import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusedMinutes, IDLE, skipGap, startFocus, tickFocus } from './focus.ts';

test('잠자기나 시계 앞당김: 튄 시간은 집중으로 치지 않고, 짧은 지연은 그대로', () => {
  const T = 1_000_000;
  const s = startFocus(T, 25);
  // 15초 틱이 조금 늦은 것은 그대로
  assert.deepEqual(skipGap(s, T, T + 20_000, 15_000), s);
  // 26분 잠들었다 깨면 그만큼 밀려 아직 안 끝난다
  const woke = T + 26 * 60_000;
  const moved = skipGap(s, T, woke, 15_000);
  assert.equal(tickFocus(moved, woke).event, undefined);
  assert.equal(focusedMinutes(moved, woke), 0);
  // 시계를 되돌리면 되돌린 만큼 당긴다
  assert.equal(skipGap(s, T, T - 60_000, 15_000).endsAt, s.endsAt - 60_000);
  assert.deepEqual(skipGap(IDLE, T, woke, 15_000), IDLE);
});
