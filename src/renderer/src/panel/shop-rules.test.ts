import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coinsShort, feedHint, needsConfirm } from './shop-rules.ts';

test('100 코인 이상은 한 번 더 확인', () => {
  assert.equal(needsConfirm(99), false);
  assert.equal(needsConfirm(100), true);
  assert.equal(needsConfirm(200), true);
  assert.equal(needsConfirm(500), true);
});

test('모자란 코인', () => {
  assert.equal(coinsShort(5, 12), 7);
  assert.equal(coinsShort(12, 12), 0);
  assert.equal(coinsShort(50, 12), 0);
});

test('배부름 안내', () => {
  assert.equal(feedHint(10, 20), undefined);
  assert.deepEqual(feedHint(80, 35), { kind: 'part', room: 20 });
  assert.deepEqual(feedHint(80, 100), { kind: 'part', room: 20 });
  assert.equal(feedHint(80, 20), undefined);
  assert.deepEqual(feedHint(99.6, 20), { kind: 'full' });
  assert.deepEqual(feedHint(99, 20), { kind: 'part', room: 1 });
});
