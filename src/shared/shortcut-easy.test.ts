import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isEasyShortcuts,
  SHORTCUT_DEFAULTS,
  SHORTCUT_EASY,
  shortcutClash,
  withEasyShortcuts,
} from './shortcut.ts';

test('쉬운 키 묶음 스위치: 켜짐은 지금 키가 묶음과 같을 때만', () => {
  assert.equal(isEasyShortcuts(SHORTCUT_DEFAULTS), false);
  assert.equal(isEasyShortcuts(SHORTCUT_EASY), true);
  // 큰 창 열기 키는 묶음에 들지 않는다
  assert.equal(isEasyShortcuts({ ...SHORTCUT_EASY, home: 'CommandOrControl+Shift+H' }), true);
  // 하나라도 다르면 꺼짐
  assert.equal(isEasyShortcuts({ ...SHORTCUT_EASY, chat: SHORTCUT_DEFAULTS.chat }), false);
  assert.equal(isEasyShortcuts({ ...SHORTCUT_EASY, hide: '' }), false);
  // 대소문자는 같은 키
  assert.equal(isEasyShortcuts({ ...SHORTCUT_EASY, quickAdd: 'commandorcontrol+shift+k' }), true);
});

test('쉬운 키 묶음 켜고 끄기: 큰 창 열기 키는 그대로, 끄면 기본 키', () => {
  const mine = { ...SHORTCUT_DEFAULTS, home: 'CommandOrControl+Alt+Shift+O' };
  const on = withEasyShortcuts(true, mine);
  assert.equal(isEasyShortcuts(on), true);
  assert.equal(on.home, mine.home);
  assert.equal(shortcutClash(on), undefined);
  const off = withEasyShortcuts(false, on);
  assert.deepEqual(off, { ...SHORTCUT_DEFAULTS, home: mine.home });
  assert.equal(isEasyShortcuts(off), false);
});
