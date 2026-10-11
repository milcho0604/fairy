import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reliefFlatten } from './pet3d.ts';

test('2.5D 판 누르기: 그림 테두리는 납작하게 (꽉 차게 오린 그림의 아래 끝이 턱처럼 튀어나오지 않게), 안쪽은 그대로', () => {
  const cols = 50;
  const rows = 40;
  const f = reliefFlatten(cols, rows);
  const at = (x: number, y: number) => f[y * cols + x] ?? -1;
  for (const [x, y] of [
    [0, 20],
    [49, 20],
    [25, 0],
    [25, 39],
  ] as const)
    assert.equal(at(x, y), 0, `${x},${y}`);
  assert.equal(at(25, 20), 1);
  assert.equal(at(10, 10), 1);
  // 테두리에서 안으로 갈수록 커진다
  assert.ok(at(25, 38) < at(25, 37) && at(25, 37) < 1);
});
