import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutText, textBoundary } from './cut-text.ts';

test('상한이 이모지 가운데에 걸리면 반쪽을 남기지 않는다', () => {
  const s = `${'a'.repeat(79)}😀끝`;
  const cut = cutText(s, 80);
  assert.equal(cut, 'a'.repeat(79));
  assert.equal(/[\uD800-\uDBFF]$/.test(cut), false);
});

test('상한 안이거나 이모지가 통째로 들어가면 그대로 자른다', () => {
  assert.equal(cutText('짧다', 80), '짧다');
  assert.equal(cutText(`${'a'.repeat(78)}😀끝`, 80), `${'a'.repeat(78)}😀`);
  assert.equal(cutText('abc', 0), '');
});

test('둘레 글 자리도 글자 가운데를 피한다', () => {
  const s = 'a😀b';
  assert.equal(textBoundary(s, 2), 1);
  assert.equal(textBoundary(s, 3), 3);
  assert.equal(textBoundary(s, 0), 0);
});
