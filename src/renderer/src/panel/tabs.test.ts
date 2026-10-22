import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTab, TABS, tabForKey, tabShortcut } from './tabs.ts';

const press = (code: string, mods: Record<string, boolean> = {}) => ({
  key: code.replace(/^Digit/, ''),
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('탭 표: 다섯 개, 순서는 오늘, 할 일, 메모, 일정, 상점, 겹침 없음', () => {
  assert.deepEqual(
    TABS.map((tb) => tb.id),
    ['today', 'todo', 'note', 'event', 'shop'],
  );
  assert.equal(new Set(TABS.map((tb) => tb.label)).size, TABS.length);
});

test('값이 탭 이름인지 거른다 (주소 해시, 저장소 값)', () => {
  assert.equal(isTab('note'), true);
  assert.equal(isTab(''), false);
  assert.equal(isTab(null), false);
  assert.equal(isTab('home'), false);
});

test('Cmd/Ctrl + 숫자는 표의 순서대로 탭을 고른다', () => {
  assert.equal(tabForKey(press('Digit1', { metaKey: true }), true), 'today');
  assert.equal(tabForKey(press('Digit3', { metaKey: true }), true), 'note');
  assert.equal(tabForKey(press('Digit5', { ctrlKey: true }), false), 'shop');
  assert.equal(tabForKey(press('Digit6', { metaKey: true }), true), undefined);
  assert.equal(tabForKey(press('Digit1', { ctrlKey: true }), true), undefined);
  assert.equal(tabForKey(press('Digit1'), true), undefined);
});

test('탭 풀이의 단축키 글은 눌러 고르는 키와 같은 번호다', () => {
  for (const [i, tb] of TABS.entries()) {
    assert.equal(tabShortcut(tb.id, 'Cmd'), `Cmd+${i + 1}`);
    assert.equal(tabForKey(press(`Digit${i + 1}`, { metaKey: true }), true), tb.id);
  }
});
