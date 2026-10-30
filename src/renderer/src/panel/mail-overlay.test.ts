import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailOverlayAfterTabRequest as f } from './mail-overlay.ts';

test('작은 패널: 쪽지함 요청은 덮개를 연다', () => {
  assert.equal(f('panel', 'mail', false), true);
  assert.equal(f('panel', 'mail', true), true);
});

test('작은 패널: 다른 탭 요청이 오면 열린 덮개를 닫는다', () => {
  for (const tab of ['today', 'todo', 'note', 'event', 'shop']) {
    assert.equal(f('panel', tab, true), false, tab);
    assert.equal(f('panel', tab, false), false, tab);
  }
});

test('큰 창: 덮개가 없으니 그대로 둔다', () => {
  assert.equal(f('home', 'today', false), false);
  assert.equal(f('home', 'mail', false), false);
});
