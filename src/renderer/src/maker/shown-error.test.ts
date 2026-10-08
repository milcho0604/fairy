import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShownError, shownErrorText } from './shown-error.ts';

test('사람 말로 만든 오류만 그대로, 원문 오류는 안내 글로 바꾸고 콘솔에만 남긴다', () => {
  const logged: unknown[] = [];
  const log = (...a: unknown[]) => logged.push(a[1]);
  assert.equal(shownErrorText(new ShownError('모델 파일을 못 읽었어'), '대신', log), '모델 파일을 못 읽었어');
  assert.equal(logged.length, 0);
  const raw = new Error('no available backend found. ERR: [wasm] RuntimeError: Aborted()');
  assert.equal(shownErrorText(raw, '배경을 지우지 못했어', log), '배경을 지우지 못했어');
  assert.equal(shownErrorText(new TypeError('Failed to fetch'), '대신', log), '대신');
  assert.equal(shownErrorText('문자열', '대신', log), '대신');
  assert.deepEqual(logged, [raw, logged[1], '문자열']);
  assert.ok(logged[1] instanceof TypeError);
});
