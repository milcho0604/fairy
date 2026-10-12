import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIST_PAGE, pageOf } from './paging.ts';

test('긴 목록은 앞에서부터 한 쪽씩: 보이는 것과 남은 수 (버그잡이 4: 메모 5천 개를 다 그리던 것)', () => {
  const list = Array.from({ length: 5000 }, (_, i) => i);
  const first = pageOf(list, 1);
  assert.equal(first.shown.length, LIST_PAGE);
  assert.equal(first.rest, 5000 - LIST_PAGE);
  assert.equal(first.shown[0], 0);
  const two = pageOf(list, 2);
  assert.equal(two.shown.length, LIST_PAGE * 2);
  // 짧은 목록은 그대로
  assert.deepEqual(pageOf([1, 2, 3], 1), { shown: [1, 2, 3], rest: 0 });
  // 넘친 쪽 수, 0 쪽도 안전하게
  assert.equal(pageOf(list, 999).rest, 0);
  assert.equal(pageOf(list, 0).shown.length, LIST_PAGE);
});
