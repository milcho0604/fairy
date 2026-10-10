import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMemory,
  cleanMemory,
  cleanMemoryItem,
  MEMORY_ITEM_MAX,
  MEMORY_MAX,
  mergeMemory,
} from './pet-memory.ts';

test('기억 하나: 한 줄로 다듬고 100자까지, 글이 아니면 빈 글', () => {
  assert.equal(cleanMemoryItem('  아침엔\n 회의가   많아 '), '아침엔 회의가 많아');
  assert.equal(cleanMemoryItem('가'.repeat(150)).length, MEMORY_ITEM_MAX);
  assert.equal(cleanMemoryItem(3), '');
  assert.equal(cleanMemoryItem(null), '');
});

test('목록: 글만, 같은 것(대소문자, 띄어쓰기) 하나, 넘치면 오래된 것부터 뺀다', () => {
  assert.deepEqual(cleanMemory(['TS 좋아함', 'ts  좋아함', '', 3, ' 커피 ']), ['TS 좋아함', '커피']);
  assert.deepEqual(cleanMemory('x'), []);
  const many = Array.from({ length: 40 }, (_, i) => `기억 ${i}`);
  const kept = cleanMemory(many);
  assert.equal(kept.length, MEMORY_MAX);
  assert.equal(kept[0], '기억 10');
  assert.equal(kept.at(-1), '기억 39');
});

test('더하기와 합치기: 이미 있으면 그대로, 꽉 차면 가장 오래된 것이 빠진다', () => {
  assert.deepEqual(addMemory(['커피'], ' 커피 '), { list: ['커피'], added: false });
  assert.deepEqual(addMemory(['커피'], ''), { list: ['커피'], added: false });
  assert.deepEqual(addMemory(['커피'], '차'), { list: ['커피', '차'], added: true });
  const full = Array.from({ length: MEMORY_MAX }, (_, i) => `m${i}`);
  const r = addMemory(full, '새것');
  assert.equal(r.list.length, MEMORY_MAX);
  assert.equal(r.list[0], 'm1');
  assert.equal(r.list.at(-1), '새것');
  assert.deepEqual(mergeMemory(['커피'], ['차', '커피', 7, '물']), ['커피', '차', '물']);
  assert.deepEqual(mergeMemory(['커피'], 'broken'), ['커피']);
});
