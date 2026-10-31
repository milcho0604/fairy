import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_SECTIONS, homeKeyAction, sectionForKey, sectionShortcut, visibleSections } from './sections.ts';

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

test('구역 순서: 오늘, 할 일, 메모, 일정, 채팅, 상점, 기록, 쪽지함, 페어리, 비서, 친구', () => {
  assert.deepEqual(
    HOME_SECTIONS.map((s) => s.id),
    ['today', 'todo', 'note', 'event', 'chat', 'shop', 'records', 'mail', 'pet', 'assist', 'friends'],
  );
});

test('친구는 기능이 켜졌을 때만 보인다', () => {
  assert.equal(visibleSections(false).length, 10);
  assert.equal(visibleSections(true).length, 11);
  assert.equal(
    visibleSections(false).some((s) => s.id === 'friends'),
    false,
  );
});

test('따로 창을 여는 구역은 친구뿐, 채팅은 창 안에 품는다', () => {
  assert.deepEqual(
    HOME_SECTIONS.filter((s) => s.kind === 'window').map((s) => s.id),
    ['friends'],
  );
  assert.deepEqual(
    HOME_SECTIONS.filter((s) => s.kind === 'chat').map((s) => s.id),
    ['chat'],
  );
});

test('Cmd+1~7 (친구 꺼짐), Cmd+8 은 친구가 켜졌을 때만', () => {
  assert.equal(sectionForKey(key('Digit1', '1', { metaKey: true }), true, false)?.id, 'today');
  assert.equal(sectionForKey(key('Digit3', '3', { metaKey: true }), true, false)?.id, 'note');
  assert.equal(sectionForKey(key('Digit5', '5', { metaKey: true }), true, false)?.id, 'chat');
  assert.equal(sectionForKey(key('Digit6', '6', { metaKey: true }), true, false)?.id, 'shop');
  assert.equal(sectionForKey(key('Digit7', '7', { metaKey: true }), true, false)?.id, 'records');
  assert.equal(sectionForKey(key('Digit8', '8', { metaKey: true }), true, false), undefined);
  assert.equal(sectionForKey(key('Digit8', '8', { metaKey: true }), true, true)?.id, 'friends');
});

test('윈도우는 Ctrl, 맥에서 Ctrl 이나 Shift, Option 이 섞이면 아니다', () => {
  assert.equal(sectionForKey(key('Digit2', '2', { ctrlKey: true }), false, false)?.id, 'todo');
  assert.equal(sectionForKey(key('Digit2', '2', { ctrlKey: true }), true, false), undefined);
  assert.equal(sectionForKey(key('Digit2', '2', { metaKey: true, shiftKey: true }), true, false), undefined);
  assert.equal(sectionForKey(key('Digit2', '2'), true, false), undefined);
});

test('한글 입력 중에도 code 로 읽는다', () => {
  assert.equal(sectionForKey(key('Digit4', 'ㅋ', { metaKey: true }), true, false)?.id, 'event');
});

test('구역 풀이 단축키는 보이는 순서를 따른다', () => {
  assert.equal(sectionShortcut('shop', false, 'Cmd'), 'Cmd+6');
  assert.equal(sectionShortcut('friends', false, 'Cmd'), undefined);
  assert.equal(sectionShortcut('records', false, 'Cmd'), 'Cmd+7');
  assert.equal(sectionShortcut('friends', true, 'Ctrl'), 'Ctrl+8');
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
  assert.equal(sectionShortcut('mail', false, 'Cmd'), undefined);
  assert.equal(sectionShortcut('mail', true, 'Cmd'), undefined);
  assert.equal(sectionForKey(key('Digit8', '8', { metaKey: true }), true, true)?.id, 'friends');
  assert.equal(sectionForKey(key('Digit9', '9', { metaKey: true }), true, true), undefined);
  assert.equal(HOME_SECTIONS.find((s) => s.id === 'mail')?.kind, 'tab');
});

test('페어리와 비서 구역은 번호 단축키가 없고 친구 8번도 그대로다', () => {
  for (const id of ['pet', 'assist'] as const) {
    assert.equal(HOME_SECTIONS.find((s) => s.id === id)?.kind, 'tab');
    assert.equal(sectionShortcut(id, true, 'Cmd'), undefined);
  }
  assert.equal(sectionShortcut('friends', true, 'Cmd'), 'Cmd+8');
});
