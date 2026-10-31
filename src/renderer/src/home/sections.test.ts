import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_SECTIONS, homeKeyAction, sectionForKey, sectionShortcut } from './sections.ts';

const key = (
  code: string,
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('구역 순서: 오늘, 할 일, 메모, 일정, 채팅, 상점, 기록, 쪽지함, 친구', () => {
  assert.deepEqual(
    HOME_SECTIONS.map((s) => s.id),
    ['today', 'todo', 'note', 'event', 'chat', 'shop', 'records', 'mail', 'friends'],
  );
});

test('친구는 늘 보이고 본문 칸의 구역이다 (따로 창이 아니다)', () => {
  const f = HOME_SECTIONS.find((s) => s.id === 'friends');
  assert.equal(f?.kind, 'tab');
  assert.equal(
    HOME_SECTIONS.some((s) => (s.kind as string) === 'window'),
    false,
  );
  assert.deepEqual(
    HOME_SECTIONS.filter((s) => s.kind === 'chat').map((s) => s.id),
    ['chat'],
  );
});

test('Cmd+1~8: 친구는 늘 8번, 그 위로 더 없다', () => {
  assert.equal(sectionForKey(key('Digit1', '1', { metaKey: true }), true)?.id, 'today');
  assert.equal(sectionForKey(key('Digit3', '3', { metaKey: true }), true)?.id, 'note');
  assert.equal(sectionForKey(key('Digit5', '5', { metaKey: true }), true)?.id, 'chat');
  assert.equal(sectionForKey(key('Digit6', '6', { metaKey: true }), true)?.id, 'shop');
  assert.equal(sectionForKey(key('Digit7', '7', { metaKey: true }), true)?.id, 'records');
  assert.equal(sectionForKey(key('Digit8', '8', { metaKey: true }), true)?.id, 'friends');
  assert.equal(sectionForKey(key('Digit9', '9', { metaKey: true }), true), undefined);
});

test('윈도우는 Ctrl, 맥에서 Ctrl 이나 Shift, Option 이 섞이면 아니다', () => {
  assert.equal(sectionForKey(key('Digit2', '2', { ctrlKey: true }), false)?.id, 'todo');
  assert.equal(sectionForKey(key('Digit2', '2', { ctrlKey: true }), true), undefined);
  assert.equal(sectionForKey(key('Digit2', '2', { metaKey: true, shiftKey: true }), true), undefined);
  assert.equal(sectionForKey(key('Digit2', '2'), true), undefined);
});

test('한글 입력 중에도 code 로 읽는다', () => {
  assert.equal(sectionForKey(key('Digit4', 'ㅋ', { metaKey: true }), true)?.id, 'event');
});

test('구역 풀이 단축키는 구역 순서를 따른다', () => {
  assert.equal(sectionShortcut('shop', 'Cmd'), 'Cmd+6');
  assert.equal(sectionShortcut('records', 'Cmd'), 'Cmd+7');
  assert.equal(sectionShortcut('friends', 'Ctrl'), 'Ctrl+8');
});

test('Cmd+, 설정, Cmd+W 닫기, Cmd+F 찾기', () => {
  assert.equal(homeKeyAction(key('Comma', ',', { metaKey: true }), true), 'settings');
  assert.equal(homeKeyAction(key('KeyW', 'w', { ctrlKey: true }), false), 'close');
  assert.equal(homeKeyAction(key('KeyF', 'ㄹ', { metaKey: true }), true), 'find');
  assert.equal(homeKeyAction(key('KeyF', 'f', { metaKey: true, shiftKey: true }), true), undefined);
  assert.equal(homeKeyAction(key('KeyF', 'f'), true), undefined);
  assert.equal(homeKeyAction(key('KeyQ', 'q', { metaKey: true }), true), undefined);
});

test('쪽지함은 번호 단축키가 없어서 기존 번호(친구 8번 포함)가 그대로다', () => {
  assert.equal(sectionShortcut('mail', 'Cmd'), undefined);
  assert.equal(sectionForKey(key('Digit8', '8', { metaKey: true }), true)?.id, 'friends');
  assert.equal(HOME_SECTIONS.find((s) => s.id === 'mail')?.kind, 'tab');
});
