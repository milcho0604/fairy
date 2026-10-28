import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch, DEFAULT_SETTINGS } from './settings.ts';
import {
  easyShortcutsPatch,
  isEasyShortcuts,
  NO_SHORTCUT,
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

test('끄기는 늘 성공: 켠 동안 큰 창 키를 복원할 키와 같게 바꿨으면 겹친 복원 키만 기본 키로', () => {
  const custom = { ...SHORTCUT_DEFAULTS, chat: 'CommandOrControl+Shift+J' };
  let s = applyPatch(DEFAULT_SETTINGS, easyShortcutsPatch(true, custom, null));
  assert.equal(isEasyShortcuts(s.shortcuts), true);
  s = applyPatch(s, { shortcuts: { ...s.shortcuts, home: 'CommandOrControl+Shift+J' } });
  const { changed, ...patch } = easyShortcutsPatch(false, s.shortcuts, s.shortcutsKept);
  assert.deepEqual(changed, ['chat']);
  s = applyPatch(s, patch);
  assert.equal(isEasyShortcuts(s.shortcuts), false, '끄기가 먹었다');
  assert.equal(s.shortcuts.home, 'CommandOrControl+Shift+J');
  assert.equal(s.shortcuts.chat, SHORTCUT_DEFAULTS.chat);
  assert.equal(s.shortcuts.quickAdd, SHORTCUT_DEFAULTS.quickAdd);
  assert.equal(shortcutClash(s.shortcuts), undefined);
});

test('끄기: 기본 키마저 겹치면 키 없음, 겹치지 않으면 알릴 것 없음', () => {
  const custom = { ...SHORTCUT_DEFAULTS, chat: 'CommandOrControl+Shift+J' };
  const clash = { ...SHORTCUT_EASY, home: 'CommandOrControl+Shift+J' };
  const dflt = easyShortcutsPatch(false, { ...clash, home: SHORTCUT_DEFAULTS.chat }, custom);
  assert.equal(dflt.shortcuts.chat, 'CommandOrControl+Shift+J');
  assert.deepEqual(dflt.changed, []);
  // 복원 키도 기본 키도 큰 창 키와 같다
  const both = easyShortcutsPatch(
    false,
    { ...clash, home: 'CommandOrControl+Shift+J' },
    {
      ...custom,
      chat: 'CommandOrControl+Shift+J',
    },
  );
  assert.equal(both.shortcuts.chat, SHORTCUT_DEFAULTS.chat);
  const none = easyShortcutsPatch(
    false,
    { ...clash, home: SHORTCUT_DEFAULTS.chat },
    {
      ...custom,
      chat: SHORTCUT_DEFAULTS.chat,
    },
  );
  assert.equal(none.shortcuts.chat, NO_SHORTCUT);
  assert.deepEqual(none.changed, ['chat']);
});
