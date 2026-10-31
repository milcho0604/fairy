import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftHasText, mayGrabFocus } from './note-draft.ts';
import { onNoteFocus, requestNoteFocus, takeNoteFocus } from './open-target.ts';

test('draftHasText: 한 글자라도 있어야 메모가 된다', () => {
  assert.equal(draftHasText({ title: '', body: '' }), false);
  assert.equal(draftHasText({ title: '  ', body: '\n ' }), false);
  assert.equal(draftHasText({ title: 'a', body: '' }), true);
  assert.equal(draftHasText({ title: '', body: '가' }), true);
});

test('mayGrabFocus: 창이 앞에 있고 다른 입력칸에 커서가 없을 때만', () => {
  assert.equal(mayGrabFocus({ windowFocused: true, activeEditable: false }), true);
  assert.equal(mayGrabFocus({ windowFocused: false, activeEditable: false }), false);
  assert.equal(mayGrabFocus({ windowFocused: true, activeEditable: true }), false);
});

test('takeNoteFocus: 신호는 한 번만, 묵으면 버린다', () => {
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  const target = new EventTarget();
  g.window = target;
  try {
    let heard = 0;
    const off = onNoteFocus(() => heard++);
    assert.equal(takeNoteFocus(), false);
    requestNoteFocus();
    assert.equal(heard, 1);
    assert.equal(takeNoteFocus(), true);
    assert.equal(takeNoteFocus(), false);
    requestNoteFocus();
    assert.equal(takeNoteFocus(Date.now() + 5000), false);
    off();
  } finally {
    g.window = prev;
  }
});
