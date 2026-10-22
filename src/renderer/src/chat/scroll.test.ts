import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  answerTopScroll,
  arrivedWhole,
  contentKey,
  conversationChanged,
  gapBelow,
  isLongAnswer,
  isNearBottom,
  jumpBehavior,
  scrollDecision,
} from './scroll.ts';

test('맨 아래 가까움: 48px 안이면 아래를 보는 중', () => {
  assert.equal(gapBelow({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), 0);
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }), false);
  // 내용이 창보다 짧으면 늘 아래
  assert.equal(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }), true);
});

test('아래를 보고 있으면 새 메시지, 답 조각, 생각 중, 크기 바뀜을 따라간다', () => {
  assert.equal(scrollDecision({ following: true, grew: true }), 'follow');
  assert.equal(scrollDecision({ following: true, grew: false, resized: true }), 'follow');
  assert.equal(scrollDecision({ following: true, grew: false }), 'stay');
});

test('위를 읽는 중이면 끌어내리지 않고 알린다. 크기만 바뀌면 그대로', () => {
  assert.equal(scrollDecision({ following: false, grew: true }), 'notify');
  assert.equal(scrollDecision({ following: false, grew: false, resized: true }), 'stay');
  assert.equal(scrollDecision({ following: false, grew: false }), 'stay');
});

test('내가 보냈거나 대화, AI 가 바뀌면 읽던 자리와 상관없이 맨 아래로', () => {
  assert.equal(scrollDecision({ following: false, grew: true, sent: true }), 'follow');
  assert.equal(scrollDecision({ following: false, grew: false, switched: true }), 'follow');
});

test('내용 지문: 새 메시지, 상태, 조각 길이, 기다림이 바뀌면 바뀐다', () => {
  const base = [{ id: 'a', status: 'done', text: 'hi' }];
  const k = contentKey(base, undefined);
  assert.equal(contentKey(base, undefined), k, '같은 내용이면 같다 (입력칸만 바뀐 다시 그리기)');
  assert.notEqual(contentKey([...base, { id: 'w', status: 'waiting', text: '' }], 'w'), k);
  assert.notEqual(contentKey([{ id: 'a', status: 'streaming', text: 'hi there' }], 'a'), k);
  assert.notEqual(contentKey([{ id: 'a', status: 'done', text: 'hi' }], 'x'), k);
  assert.notEqual(contentKey([], undefined), k);
});

test('대화 바뀜: 처음, 첫 메시지가 다름, 줄어듦(새 대화). 뒤에 붙기만 하면 같은 대화', () => {
  const a = [{ id: '1' }, { id: '2' }];
  assert.equal(conversationChanged(undefined, a), true);
  assert.equal(conversationChanged(a, [...a, { id: '3' }]), false);
  assert.equal(conversationChanged(a, []), true);
  assert.equal(conversationChanged(a, [{ id: '9' }, { id: '2' }]), true);
});

test('움직임 줄이기면 바로 내려간다', () => {
  assert.equal(jumpBehavior(true), 'auto');
  assert.equal(jumpBehavior(false), 'smooth');
});

test('긴 답이 한 번에 오면 맨 아래로 따라가지 않고 답 위쪽에 맞춘다', () => {
  assert.equal(scrollDecision({ following: true, grew: true, longAnswer: true }), 'top');
  // 짧은 답, 조각으로 오는 답(longAnswer 가 꺼짐)은 그대로 따라간다
  assert.equal(scrollDecision({ following: true, grew: true, longAnswer: false }), 'follow');
  assert.equal(scrollDecision({ following: true, grew: true }), 'follow');
  // 크기만 바뀐 때는 위쪽 맞춤을 되풀이하지 않는다
  assert.equal(scrollDecision({ following: true, grew: false, resized: true, longAnswer: true }), 'follow');
  // 내가 보냈거나 대화가 바뀌면 늘 아래, 위를 읽는 중이면 끌어내리지 않고 알림
  assert.equal(scrollDecision({ following: true, grew: true, sent: true, longAnswer: true }), 'follow');
  assert.equal(scrollDecision({ following: true, grew: true, switched: true, longAnswer: true }), 'follow');
  assert.equal(scrollDecision({ following: false, grew: true, longAnswer: true }), 'notify');
});

test('한 번에 온 답: 기다리다 바로 끝났거나 새로 끝난 답. 오는 중이던 답이 끝난 것은 아니다', () => {
  const done = { id: 'p', role: 'pet', status: 'done', text: '긴 답' };
  assert.equal(arrivedWhole({ id: 'p', status: 'waiting' }, done), true);
  assert.equal(arrivedWhole(undefined, done), true);
  assert.equal(arrivedWhole({ id: 'u', status: undefined }, done), true);
  assert.equal(arrivedWhole({ id: 'p', status: 'streaming' }, done), false);
  assert.equal(arrivedWhole({ id: 'p', status: 'waiting' }, { ...done, status: 'streaming' }), false);
  assert.equal(arrivedWhole({ id: 'p', status: 'waiting' }, { ...done, text: '' }), false);
  assert.equal(arrivedWhole({ id: 'p' }, { ...done, role: 'user' }), false);
  assert.equal(arrivedWhole({ id: 'p' }, undefined), false);
});

test('긴 답 기준: 창 한 면(여백 24px 뺀)보다 길 때만', () => {
  assert.equal(isLongAnswer(300, 400), false);
  assert.equal(isLongAnswer(376, 400), false);
  assert.equal(isLongAnswer(377, 400), true);
  assert.equal(isLongAnswer(5000, 400), true);
});

test('답 위쪽 맞춤 위치: 위에 여백 8px, 끝을 넘지 않고 0 아래로 가지 않는다', () => {
  const box = { scrollHeight: 3000, scrollTop: 0, clientHeight: 400 };
  assert.equal(answerTopScroll(box, 900), 892);
  assert.equal(answerTopScroll(box, 4), 0);
  assert.equal(answerTopScroll(box, 2900), 2600);
  assert.equal(answerTopScroll({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }, 100), 0);
});
