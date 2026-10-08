import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escClosesWindow, isEsc } from './keys.ts';

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
