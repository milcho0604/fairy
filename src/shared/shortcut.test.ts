import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceleratorLabel,
  isAccelerator,
  type KeyPress,
  SHORTCUT_DEFAULTS,
  toAccelerator,
} from './shortcut.ts';

const k = (code: string, mods: Partial<KeyPress> = {}, key = 'x'): KeyPress => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('맥: Cmd+Option+Shift+J, Option 으로 바뀐 글자도 code 로 읽는다', () => {
  assert.deepEqual(toAccelerator(k('KeyJ', { metaKey: true, altKey: true, shiftKey: true }, '∆'), true), {
    accelerator: 'CommandOrControl+Alt+Shift+J',
  });
  assert.deepEqual(toAccelerator(k('Digit1', { ctrlKey: true }), true), { accelerator: 'Control+1' });
});

test('윈도우: Ctrl+Alt+K, Win 키는 Super', () => {
  assert.deepEqual(toAccelerator(k('KeyK', { ctrlKey: true, altKey: true }), false), {
    accelerator: 'CommandOrControl+Alt+K',
  });
  assert.deepEqual(toAccelerator(k('KeyK', { metaKey: true, altKey: true }), false), {
    accelerator: 'Super+Alt+K',
  });
});

test('수식키 없이 글자만, 수식키만, 못 쓰는 키', () => {
  assert.ok('error' in (toAccelerator(k('KeyA', { shiftKey: true }), true) ?? {}));
  assert.equal(toAccelerator(k('ShiftLeft', { shiftKey: true }, 'Shift'), true), undefined);
  assert.ok('error' in (toAccelerator(k('IntlRo', { metaKey: true }), true) ?? {}));
  assert.deepEqual(toAccelerator(k('F9'), true), { accelerator: 'F9' }); // F 키는 혼자 써도 된다
});

test('표시와 검사', () => {
  assert.deepEqual(acceleratorLabel(SHORTCUT_DEFAULTS.hide, true), ['Cmd', 'Option', 'Shift', 'H']);
  assert.deepEqual(acceleratorLabel(SHORTCUT_DEFAULTS.hide, false), ['Ctrl', 'Alt', 'Shift', 'H']);
  assert.equal(isAccelerator(SHORTCUT_DEFAULTS.quickAdd), true);
  assert.equal(isAccelerator('CommandOrControl+Alt+='), true);
  assert.equal(isAccelerator('rm -rf'), false);
  assert.equal(isAccelerator('CommandOrControl+Alt+Shift+HH'), false);
});
