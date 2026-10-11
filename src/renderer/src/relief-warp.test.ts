import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neckRow } from './relief-warp.ts';

/** 너비 목록으로 가운데 정렬한 불투명도 격자 */
const grid = (widths: number[], cols = 20) =>
  widths.flatMap((w) =>
    Array.from({ length: cols }, (_, c) => (Math.abs(c - cols / 2 + 0.5) < w / 2 ? 1 : 0)),
  );

test('머리와 몸 사이 잘록한 줄을 목으로', () => {
  // 위 머리(넓음) 0~7, 목(좁음) 9, 몸 10~19
  const w = [10, 14, 16, 16, 16, 14, 12, 10, 8, 6, 12, 16, 18, 18, 18, 18, 18, 16, 14, 12];
  assert.equal(neckRow(grid(w), 20, w.length), 9);
});

test('잘록한 데가 없으면 위에서 45%', () => {
  const w = Array.from({ length: 20 }, () => 16);
  assert.equal(neckRow(grid(w), 20, 20), 9);
});
