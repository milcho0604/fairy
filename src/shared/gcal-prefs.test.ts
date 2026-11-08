import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTodoPrefs, parseGcalPrefs } from './gcal-prefs.ts';

test('할 일의 마지막으로 올린 때는 저장했다 읽어도 남고, 이상한 값은 버린다', () => {
  const saved = JSON.parse(
    JSON.stringify(
      parseGcalPrefs({ todos: { on: true, target: 'pick', calendarId: 'primary', lastSentAt: 1234 } }),
    ),
  );
  assert.equal(parseGcalPrefs(saved).todos.lastSentAt, 1234);
  assert.equal(cleanTodoPrefs({ lastSentAt: -1 }).lastSentAt, null);
  assert.equal(cleanTodoPrefs({ lastSentAt: 'x' }).lastSentAt, null);
  assert.equal(cleanTodoPrefs(undefined).lastSentAt, null);
});
