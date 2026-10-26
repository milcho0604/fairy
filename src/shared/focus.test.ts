import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  focusDoneAction,
  focusDoneButtons,
  focusedMinutes,
  focusTodoToAsk,
  IDLE,
  isFocusLength,
  skipGap,
  startFocus,
  tickFocus,
} from './focus.ts';

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

test('할 일을 걸고 집중: id 를 들고 가다 끝나면 아직 열린 그 할 일을 묻는다. 쉬기에는 없다', () => {
  const T = 1_000_000;
  const s = startFocus(T, 25, 7);
  assert.equal(s.todoId, 7);
  assert.equal(startFocus(T, 25).todoId, undefined);
  assert.equal(startFocus(T, 25, -1).todoId, undefined);
  assert.equal(startFocus(T, 25, 1.5).todoId, undefined);
  // 잠자기로 밀어도 할 일은 그대로
  assert.equal(skipGap(s, T, T + 40 * 60_000, 15_000).todoId, 7);
  const r = tickFocus(s, s.endsAt);
  assert.equal(r.event, 'focus-done');
  assert.equal(r.state.todoId, undefined);
  // 끝난 순간의 집중 상태로 묻는다
  assert.equal(focusTodoToAsk(s, [{ id: 3 }, { id: 7, doneAt: null }]), 7);
  // 그사이 끝냈거나 지웠으면 묻지 않는다
  assert.equal(focusTodoToAsk(s, [{ id: 7, doneAt: T }]), undefined);
  assert.equal(focusTodoToAsk(s, [{ id: 3 }]), undefined);
  assert.equal(focusTodoToAsk(startFocus(T), [{ id: 7 }]), undefined);
});

test('집중 끝 단추: 할 일이 있어도 쉬는 시간 끝내기가 있고, 조금 더는 같은 할 일로 다시 집중', () => {
  assert.deepEqual(focusDoneButtons(true), ['finished', 'more', 'stop']);
  assert.deepEqual(focusDoneButtons(false), ['stop']);
  assert.equal(focusDoneAction('more', true), 'again');
  assert.equal(focusDoneAction('finished', true), 'finish');
  assert.equal(focusDoneAction('stop', true), 'stop');
  assert.equal(focusDoneAction('stop', false), 'stop');
  // 닫거나 시간이 끝나면 그대로 쉰다
  for (const a of [undefined, 'dismiss', 'timeout']) assert.equal(focusDoneAction(a, true), undefined);
  // 할 일이 없으면 끝냈어, 조금 더는 없다
  assert.equal(focusDoneAction('more', false), undefined);
  assert.equal(focusDoneAction('finished', false), undefined);
});

test('직접 집중 시간: 5~120분 정수만 허용하고 입력한 길이로 끝난다', () => {
  for (const n of [5, 17, 40, 120]) {
    assert.equal(isFocusLength(n), true);
    const state = startFocus(1000, n);
    assert.equal(state.endsAt - state.startedAt, n * 60_000);
  }
  for (const n of [4, 121, 5.5, NaN, Infinity, '25', undefined, null]) assert.equal(isFocusLength(n), false);
});
