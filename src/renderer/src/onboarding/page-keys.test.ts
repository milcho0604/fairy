import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageByKey } from './page-keys.ts';

test('← → 로 쪽을 옮기고 끝에서는 멈춘다', () => {
  assert.equal(pageByKey({ key: 'ArrowRight' }, 0, 4, false), 1);
  assert.equal(pageByKey({ key: 'ArrowLeft' }, 2, 4, false), 1);
  assert.equal(pageByKey({ key: 'ArrowRight' }, 3, 4, false), undefined);
  assert.equal(pageByKey({ key: 'ArrowLeft' }, 0, 4, false), undefined);
});

test('입력칸 안, 수식키, 한글 조합 중에는 옮기지 않는다', () => {
  assert.equal(pageByKey({ key: 'ArrowRight' }, 0, 4, true), undefined);
  assert.equal(pageByKey({ key: 'ArrowRight', metaKey: true }, 0, 4, false), undefined);
  assert.equal(pageByKey({ key: 'ArrowRight', isComposing: true }, 0, 4, false), undefined);
  assert.equal(pageByKey({ key: 'Enter' }, 0, 4, false), undefined);
});
