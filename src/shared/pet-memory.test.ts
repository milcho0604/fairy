import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMemory,
  approvePending,
  cleanMemory,
  cleanMemoryItem,
  cleanPending,
  MEMORY_ITEM_MAX,
  MEMORY_MAX,
  MEMORY_PENDING_MAX,
  mergePending,
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
});

test('AI 도구가 기억하자고 한 것은 기다리는 목록으로: 이미 있는 것은 빼고, 넘치면 기다리는 것만 밀린다', () => {
  const approved = ['커피 좋아함'];
  assert.deepEqual(mergePending([], approved, ['커피  좋아함', '차', 7, '차']), ['차']);
  const many = Array.from({ length: MEMORY_PENDING_MAX + 3 }, (_, i) => `기억 ${i}`);
  const pending = mergePending([], approved, many);
  assert.equal(pending.length, MEMORY_PENDING_MAX);
  assert.equal(pending.at(-1), `기억 ${MEMORY_PENDING_MAX + 2}`);
  // 사용자가 적은 기억은 그대로
  assert.deepEqual(approved, ['커피 좋아함']);
  assert.deepEqual(mergePending(['차'], approved, 'broken'), ['차']);
  assert.equal(cleanPending(many).length, MEMORY_PENDING_MAX);
});

test('허락하기: 넣고 기다리는 데서 뺀다, 꽉 차면 사용자 기억을 밀어내지 않고 그대로', () => {
  const r = approvePending(['커피'], ['차', '물'], '차');
  assert.deepEqual(r, { list: ['커피', '차'], pending: ['물'], result: 'added' });
  assert.deepEqual(approvePending(['커피'], ['커피 '], '커피 '), {
    list: ['커피'],
    pending: [],
    result: 'dupe',
  });
  const full = Array.from({ length: MEMORY_MAX }, (_, i) => `내 기억 ${i}`);
  const f = approvePending(full, ['차'], '차');
  assert.equal(f.result, 'full');
  assert.deepEqual(f.list, full);
  assert.deepEqual(f.pending, ['차']);
});
