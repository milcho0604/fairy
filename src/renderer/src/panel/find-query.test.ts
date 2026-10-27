import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentQueryResult } from './find-query.ts';

test('통합 검색 결과는 같은 검색어와 입력 조합 상태에서만 고를 수 있다', () => {
  const result = { todos: ['todo'] };
  const snapshot = { query: 'report', composing: false, result };
  assert.equal(currentQueryResult(snapshot, 'report', false), result);
  assert.equal(currentQueryResult(snapshot, 'reports', false), undefined);
  assert.equal(currentQueryResult(snapshot, 'report', true), undefined);
  assert.equal(currentQueryResult(undefined, 'report', false), undefined);
});
