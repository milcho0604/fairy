import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestRun, memorySecrets, testKeychainSwitches } from './test-keychain.ts';

test('시험 실행은 가짜 열쇠고리, 설치판은 절대 아니다', () => {
  const env = { JJ_NO_FOCUS: '1', JJ_USER_DATA: '/tmp/x', JJ_TEST_SECRETS: 'memory' };
  assert.deepEqual(testKeychainSwitches(false, env, 'darwin'), [['use-mock-keychain']]);
  assert.deepEqual(testKeychainSwitches(false, { JJ_USER_DATA: '/tmp/x' }, 'linux'), [
    ['password-store', 'basic'],
  ]);
  assert.deepEqual(testKeychainSwitches(true, env, 'darwin'), []);
  assert.deepEqual(testKeychainSwitches(false, {}, 'darwin'), []);
  assert.equal(isTestRun(true, env), false);
  assert.equal(memorySecrets(true, env), false);
  assert.equal(memorySecrets(false, env), true);
  assert.equal(memorySecrets(false, { JJ_NO_FOCUS: '1' }), false);
});
