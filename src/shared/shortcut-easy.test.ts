import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  easyShortcutsPatch,
  isEasyShortcuts,
  SHORTCUT_DEFAULTS,
  SHORTCUT_EASY,
  shortcutClash,
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

test('쉬운 키 묶음 켜고 끄기: 켜기 직전의 사용자 키로 돌아가고 큰 창 열기 키는 그대로', () => {
  const mine = {
    ...SHORTCUT_DEFAULTS,
    chat: 'CommandOrControl+Alt+Shift+X',
    home: 'CommandOrControl+Alt+Shift+O',
  };
  const on = easyShortcutsPatch(true, mine, null);
  assert.equal(isEasyShortcuts(on.shortcuts), true);
  assert.equal(on.shortcuts.home, mine.home);
  assert.equal(shortcutClash(on.shortcuts), undefined);
  assert.deepEqual(on.shortcutsKept, mine);
  const off = easyShortcutsPatch(false, on.shortcuts, on.shortcutsKept);
  assert.deepEqual(off.shortcuts, mine, '직접 바꾼 키가 되돌아온다');
  assert.equal(off.shortcutsKept, null);
});

test('쉬운 키 묶음: 적어 둔 키가 없으면 끌 때 기본 키', () => {
  const off = easyShortcutsPatch(false, { ...SHORTCUT_EASY, home: 'CommandOrControl+Alt+Shift+O' }, null);
  assert.deepEqual(off.shortcuts, { ...SHORTCUT_DEFAULTS, home: 'CommandOrControl+Alt+Shift+O' });
});

test('쉬운 키 묶음: 켠 채 키 하나를 바꾸면 꺼짐으로 보이고, 다시 켜도 처음 적어 둔 키는 그대로', () => {
  const mine = { ...SHORTCUT_DEFAULTS, chat: 'CommandOrControl+Alt+Shift+X' };
  const on = easyShortcutsPatch(true, mine, null);
  const edited = { ...on.shortcuts, hide: 'CommandOrControl+Alt+Shift+Y' };
  assert.equal(isEasyShortcuts(edited), false);
  const again = easyShortcutsPatch(true, edited, on.shortcutsKept);
  assert.equal(isEasyShortcuts(again.shortcuts), true);
  assert.deepEqual(again.shortcutsKept, edited);
});
