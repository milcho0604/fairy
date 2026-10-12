import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownsLoginItem } from './login-item.ts';

test('설치판만 로그인 항목을 읽고 쓴다', () => {
  assert.equal(ownsLoginItem(true, undefined), true);
  assert.equal(ownsLoginItem(true, ''), true);
  assert.equal(ownsLoginItem(false, undefined), false);
});

test('시험 실행(JJ_USER_DATA)은 사용자 페어리의 로그인 항목을 읽지도 쓰지도 않는다', () => {
  assert.equal(ownsLoginItem(true, '/tmp/jj-test'), false);
  assert.equal(ownsLoginItem(false, '/tmp/jj-test'), false);
});
