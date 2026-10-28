import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexInGroups, LIST_PAGE, pageGroups, pageOf, pagesForIndex } from './paging.ts';

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

test('새로 추가한 줄을 포함하는 쪽 수의 경계', () => {
  assert.equal(pagesForIndex(-1), 1);
  assert.equal(pagesForIndex(0), 1);
  assert.equal(pagesForIndex(LIST_PAGE - 1), 1);
  assert.equal(pagesForIndex(LIST_PAGE), 2);
  assert.equal(pagesForIndex(2 * LIST_PAGE - 1), 2);
  assert.equal(pagesForIndex(2 * LIST_PAGE), 3);
  const items = Array.from({ length: 250 }, (_, i) => i);
  assert.equal(pageOf(items, pagesForIndex(249)).shown.at(-1), 249);
});

test('날짜 칸으로 묶은 목록도 앞에서부터 한 쪽씩, 줄이 안 남은 칸은 뺀다', () => {
  const groups: [string, number[]][] = [
    ['a', Array.from({ length: 60 }, (_, i) => i)],
    ['b', Array.from({ length: 60 }, (_, i) => 100 + i)],
    ['c', [999]],
  ];
  const one = pageGroups(groups, 1);
  assert.deepEqual(
    one.shown.map(([g, l]) => [g, l.length]),
    [
      ['a', 60],
      ['b', 40],
    ],
  );
  assert.equal(one.rest, 21);
  const two = pageGroups(groups, 2);
  assert.equal(two.shown.length, 3);
  assert.equal(two.rest, 0);
  assert.deepEqual(pageGroups([], 1), { shown: [], rest: 0 });
  // 칸 하나가 쪽 경계에 딱 맞으면 다음 칸은 다음 쪽
  const exact = pageGroups(
    [
      ['a', Array.from({ length: LIST_PAGE }, (_, i) => i)],
      ['b', [1]],
    ],
    1,
  );
  assert.deepEqual(
    exact.shown.map(([g]) => g),
    ['a'],
  );
  assert.equal(exact.rest, 1);
});

test('칸으로 묶은 목록에서 줄의 자리', () => {
  const groups: [string, number[]][] = [
    ['a', [1, 2]],
    ['b', [3, 4, 5]],
  ];
  assert.equal(
    indexInGroups(groups, (x) => x === 1),
    0,
  );
  assert.equal(
    indexInGroups(groups, (x) => x === 4),
    3,
  );
  assert.equal(
    indexInGroups(groups, (x) => x === 9),
    -1,
  );
});
