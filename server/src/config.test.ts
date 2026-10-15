import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from './config';

test('DATABASE_URL 이 없으면 뜨지 않는다', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
});

test('PORT 는 기본 3002, 숫자가 아니면 거절', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).port, 3002);
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x', PORT: '4000' }).port, 4000);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' }), /PORT/);
});
