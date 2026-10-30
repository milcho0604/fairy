import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTable, splitRow } from './md-table.ts';

test('splitRow: 바깥 파이프와 \\| 처리', () => {
  assert.deepEqual(splitRow('| a | b |'), ['a', 'b']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('parseTable: 머리, 정렬, 행', () => {
  const t = parseTable(['| 이름 | 값 |', '|:--|--:|', '| a | 1 |', '| b |', '', '뒤'], 0);
  assert.ok(t);
  assert.deepEqual(t.head, ['이름', '값']);
  assert.deepEqual(t.align, ['left', 'right']);
  assert.deepEqual(t.rows, [
    ['a', '1'],
    ['b', ''],
  ]);
  assert.equal(t.length, 4);
});

test('parseTable: 표가 아닌 것', () => {
  assert.equal(parseTable(['a | b', '그냥 글'], 0), undefined);
  assert.equal(parseTable(['| a |', '|---|'], 0), undefined);
  assert.equal(parseTable(['| a | b |', '| 1 | 2 |'], 0), undefined);
});

test('parseTable: 태그는 글자 그대로 남는다(그리는 쪽이 글자 칸으로만 넣는다)', () => {
  const t = parseTable(
    [
      '| <script>x</script> | <img src=x onerror=alert(1)> |',
      '|--|--|',
      '| <b>a</b> | [x](javascript:alert(1)) |',
    ],
    0,
  );
  assert.ok(t);
  assert.equal(t.head[0], '<script>x</script>');
  assert.equal(t.rows[0]?.[0], '<b>a</b>');
});
