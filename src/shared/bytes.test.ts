import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes } from './bytes.ts';

test('KB, MB, GB', () => {
  assert.equal(formatBytes(939_539_008), '940MB');
  assert.equal(formatBytes(396_705_472), '397MB');
  assert.equal(formatBytes(1_500_000_000), '1.50GB');
  assert.equal(formatBytes(1), '1KB');
  assert.equal(formatBytes(12_345), '12KB');
  assert.equal(formatBytes(999_499), '999KB');
  assert.equal(formatBytes(1_000_000), '1MB');
});
