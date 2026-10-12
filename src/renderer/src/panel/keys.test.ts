import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escClosesWindow, isEsc, type ModKeyLike, tabByKey, tabStepByKey, undoByKey } from './keys.ts';

test('한글 조합 중 Esc 는 아무것도 하지 않는다 (isComposing, keyCode 229 둘 다)', () => {
  assert.equal(isEsc({ key: 'Escape', isComposing: true, keyCode: 27 }), false);
  assert.equal(isEsc({ key: 'Escape', isComposing: false, keyCode: 229 }), false);
  assert.equal(isEsc({ key: 'Escape', nativeEvent: { key: 'Escape', isComposing: true } }), false);
  assert.equal(isEsc({ key: 'Escape', isComposing: false, keyCode: 27 }), true);
  assert.equal(isEsc({ key: 'Enter' }), false);
});

test('입력칸이 먼저 Esc 를 먹으면 창은 닫히지 않는다', () => {
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 27, defaultPrevented: true }), false);
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 27, defaultPrevented: false }), true);
  assert.equal(escClosesWindow({ key: 'Escape', keyCode: 229 }), false);
});

const press = (
  code: string,
  mods: Partial<ModKeyLike> = {},
  key = code.replace(/^(Digit|Key)/, '').toLowerCase(),
) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('Cmd(맥)/Ctrl(윈도우) + 숫자로 탭을 고른다. 다른 수식키가 섞이거나 탭 수를 넘으면 아니다', () => {
  assert.equal(tabByKey(press('Digit1', { metaKey: true }), true, 5), 0);
  assert.equal(tabByKey(press('Digit5', { ctrlKey: true }), false, 5), 4);
  assert.equal(tabByKey(press('Digit6', { metaKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit1', { ctrlKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit1', { metaKey: true, shiftKey: true }), true, 5), undefined);
  assert.equal(tabByKey(press('Digit2'), true, 5), undefined);
  // 한글 입력기에서도 code 로 읽는다
  assert.equal(tabByKey(press('Digit3', { ctrlKey: true }, 'Process'), false, 5), 2);
});

test('Cmd/Ctrl+Z 는 쓰던 글이 없을 때만 알림 되돌리기', () => {
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, undefined), true);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, ''), true);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true }), true, '메일'), false);
  assert.equal(undoByKey(press('KeyZ', { metaKey: true, shiftKey: true }), true, undefined), false);
  assert.equal(undoByKey(press('KeyZ', { ctrlKey: true }), false, undefined), true);
  assert.equal(undoByKey(press('KeyY', { ctrlKey: true }), false, undefined), false);
});

test('패널 탭 줄 ← → Home End: 끝에서 돌아 들어가고, 다른 키는 아니다', () => {
  assert.equal(tabStepByKey('ArrowRight', 0, 5), 1);
  assert.equal(tabStepByKey('ArrowRight', 4, 5), 0);
  assert.equal(tabStepByKey('ArrowLeft', 0, 5), 4);
  assert.equal(tabStepByKey('ArrowLeft', 3, 5), 2);
  assert.equal(tabStepByKey('Home', 3, 5), 0);
  assert.equal(tabStepByKey('End', 1, 5), 4);
  assert.equal(tabStepByKey('ArrowDown', 1, 5), undefined);
  assert.equal(tabStepByKey('Enter', 1, 5), undefined);
  assert.equal(tabStepByKey('ArrowRight', 0, 0), undefined);
});
