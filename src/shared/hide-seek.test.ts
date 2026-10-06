import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIDE_SEEK, pickHideSpot } from './hide-seek.ts';

const area = { x: -1512, y: 33, width: 1512, height: 949 };
const pet = { x: -700, y: 822, width: 160, height: 160 };
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length] ?? 0;
};

test('가장자리에서 빼꼼: 40% 만 보이고 나머지는 화면 밖', () => {
  const left = pickHideSpot(pet, [area], seq(0, 0, 0.5));
  assert.equal(left?.side, 'left');
  assert.equal(left?.x, area.x - Math.round(160 * HIDE_SEEK.hiddenRatio));
  const right = pickHideSpot(pet, [area], seq(0, 0.5, 0.5));
  assert.equal(right?.side, 'right');
  assert.equal((right?.x ?? 0) + 160 - (area.x + area.width), Math.round(160 * HIDE_SEEK.hiddenRatio));
  const bottom = pickHideSpot(pet, [area], seq(0, 0.9, 0.5));
  assert.equal(bottom?.side, 'bottom');
  assert.equal(bottom?.y, area.y + area.height - 160 + Math.round(160 * HIDE_SEEK.hiddenRatio));
});

test('보이는 부분은 늘 화면 안 (가장자리 따라 위치도 안쪽)', () => {
  for (let i = 0; i < 50; i++) {
    const r = Math.random;
    const s = pickHideSpot(pet, [area], r);
    assert.ok(s);
    if (!s) continue;
    const visible = { x: Math.max(s.x, area.x), right: Math.min(s.x + 160, area.x + area.width) };
    assert.ok(visible.right - visible.x >= 60);
    if (s.side !== 'bottom') assert.ok(s.y >= area.y && s.y + 160 <= area.y + area.height);
  }
  assert.equal(pickHideSpot(pet, [], Math.random), undefined);
});
