import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDraftBox, DRAFT_TEXT_MAX, isDraftTextKind, isPanelDraftKind } from './draft-store.ts';

test('종류별로 쓰던 글을 읽고 쓴다. 없으면 빈 글', () => {
  const box = createDraftBox<string>();
  assert.equal(box.text('event'), '');
  box.setText('event', '금요일 3시 회의');
  box.setText('quick', '우유 사기');
  assert.equal(box.text('event'), '금요일 3시 회의');
  assert.equal(box.text('quick'), '우유 사기');
  assert.equal(box.text('chat'), '');
});

test('공백뿐이거나 빈 글은 비우는 것과 같다', () => {
  const box = createDraftBox<string>();
  box.setText('todo', '보고서');
  box.setText('todo', '   \n');
  assert.equal(box.text('todo'), '');
});

test('문자열이 아니거나 모르는 종류는 무시한다', () => {
  const box = createDraftBox<string>();
  box.setText('todo', '남는다');
  box.setText('todo', 5);
  box.setText('nope', '글');
  box.setText(undefined, '글');
  assert.equal(box.text('todo'), '남는다');
  assert.equal(isDraftTextKind('nope'), false);
  assert.equal(isDraftTextKind('chat'), true);
});

test('아주 긴 글은 상한에서 자른다', () => {
  const box = createDraftBox<string>();
  box.setText('chat', 'ㄱ'.repeat(DRAFT_TEXT_MAX + 500));
  assert.equal(box.text('chat').length, DRAFT_TEXT_MAX);
});

test('한 종류만 비우거나 전부 비운다', () => {
  const box = createDraftBox<string>();
  box.setText('chat', '질문');
  box.setText('quick', '메모');
  box.setImages(['a', 'b']);
  box.clear('chat');
  assert.equal(box.text('chat'), '');
  assert.equal(box.text('quick'), '메모');
  assert.deepEqual(box.images(), ['a', 'b']);
  box.clear('images');
  assert.deepEqual(box.images(), []);
  box.clearAll();
  assert.equal(box.text('quick'), '');
});

test('패널 창이 쓸 수 있는 칸은 채팅을 뺀 셋', () => {
  for (const k of ['todo', 'event', 'quick']) assert.equal(isPanelDraftKind(k), true, k);
  assert.equal(isPanelDraftKind('chat'), false);
  assert.equal(isPanelDraftKind('images'), false);
  assert.equal(isPanelDraftKind('__proto__'), false);
  assert.equal(isPanelDraftKind(undefined), false);
});
