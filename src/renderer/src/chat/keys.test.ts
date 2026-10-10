import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../../../shared/chat-state.ts';
import { chatKey, lastQuestion } from './keys.ts';

test('Esc 는 멈추기, ↑ 는 다시 불러오기, 조합 중에는 아무것도 아니다', () => {
  assert.equal(chatKey({ key: 'Escape' }, 'darwin'), 'escape');
  assert.equal(chatKey({ key: 'ArrowUp' }, 'win32'), 'recall');
  assert.equal(chatKey({ key: 'ArrowUp', shiftKey: true }, 'win32'), undefined);
  assert.equal(chatKey({ key: 'Escape', isComposing: true }, 'darwin'), undefined);
  assert.equal(chatKey({ key: 'Process', keyCode: 229 }, 'darwin'), undefined);
  assert.equal(chatKey({ key: 'ArrowUp', isComposing: true }, 'darwin'), undefined);
  assert.equal(chatKey({ key: 'a' }, 'darwin'), undefined);
});

test('새 대화는 맥 Cmd+N, 그 밖은 Ctrl+N. 한글 자판(ㅜ)도 자리로 알아본다', () => {
  assert.equal(chatKey({ key: 'n', code: 'KeyN', metaKey: true }, 'darwin'), 'new-chat');
  assert.equal(chatKey({ key: 'ㅜ', code: 'KeyN', metaKey: true }, 'darwin'), 'new-chat');
  assert.equal(chatKey({ key: 'n', code: 'KeyN', ctrlKey: true }, 'darwin'), undefined);
  assert.equal(chatKey({ key: 'n', code: 'KeyN', ctrlKey: true }, 'win32'), 'new-chat');
  assert.equal(chatKey({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true }, 'win32'), undefined);
  assert.equal(chatKey({ key: 'n', code: 'KeyN' }, 'linux'), undefined);
});

test('마지막 질문은 글이 있는 사용자 메시지', () => {
  const msgs: ChatMessage[] = [
    { id: '1', role: 'user', text: '첫 질문' },
    { id: '2', role: 'pet', text: '답', status: 'done' },
    { id: '3', role: 'user', text: '', images: [{ thumb: 'data:' }] },
    { id: '4', role: 'pet', text: '그림 답', status: 'done' },
  ];
  assert.equal(lastQuestion(msgs), '첫 질문');
  assert.equal(lastQuestion([]), undefined);
});
