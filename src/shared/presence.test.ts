import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HideReasons, windowsStateMeansHide } from './presence.ts';

test('윈도우: 전체 화면 앱, 전체 화면 게임, 발표 모드에서만 숨는다', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(windowsStateMeansHide), [
    false,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
});

test('까닭이 하나라도 남아 있으면 숨은 채로', () => {
  const r = new HideReasons();
  assert.equal(r.set('presentation', true), true); // 숨음
  assert.equal(r.set('user', true), false); // 이미 숨어 있음
  assert.equal(r.set('presentation', false), false); // 사용자가 숨긴 건 그대로
  assert.equal(r.hidden, true);
  assert.equal(r.set('user', false), true); // 다시 보임
  assert.equal(r.hidden, false);
});
