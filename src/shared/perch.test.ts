import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hopAt, PERCH_SINK, perchHolds, pickPerch } from './perch.ts';

const area = { x: 0, y: 25, width: 1440, height: 875 };
const pet = { x: 600, y: 740, width: 160, height: 160 };

test('가까운 창 윗변에 앉는다. 펫 가운데를 창 안쪽으로 맞춘다', () => {
  const win = { x: 400, y: 300, width: 800, height: 500 };
  const p = pickPerch(pet, [win], area);
  assert.deepEqual(p, { x: 600, y: 300 - 160 + PERCH_SINK, win });
  const narrowLeft = { x: 650, y: 300, width: 300, height: 500 };
  assert.equal(pickPerch(pet, [narrowLeft], area)?.x, 650 + 24);
});

test('앞 창에 윗변이 가려졌거나 위에 자리가 없거나 너무 작으면 안 앉는다', () => {
  const back = { x: 400, y: 300, width: 800, height: 500 };
  const front = { x: 300, y: 200, width: 1000, height: 400 }; // 윗변을 덮는다
  assert.equal(pickPerch(pet, [front, back], area)?.win, front);
  assert.equal(pickPerch(pet, [{ x: 100, y: 60, width: 900, height: 600 }], area), undefined); // 위에 자리 없음
  assert.equal(pickPerch(pet, [{ x: 500, y: 400, width: 150, height: 300 }], area), undefined); // 좁다
  assert.equal(pickPerch(pet, [{ x: 2000, y: 400, width: 900, height: 300 }], area), undefined); // 다른 모니터
});

test('펫이 앉을 자리를 다른 창이 덮으면 다른 창을 고른다', () => {
  const low = { x: 400, y: 500, width: 800, height: 300 };
  const blocker = { x: 500, y: 380, width: 300, height: 100 }; // low 위 빈자리를 덮는다
  const high = { x: 900, y: 250, width: 500, height: 200 };
  assert.equal(pickPerch(pet, [blocker, low, high], area)?.win, high);
  assert.equal(pickPerch(pet, [low, high], area)?.win, low); // 막는 창이 없으면 가까운 low
});

test('앉은 창이 그대로인지: 옮기거나 닫으면 아니다', () => {
  const win = { x: 400, y: 300, width: 800, height: 500 };
  assert.equal(perchHolds(win, [win]), true);
  assert.equal(perchHolds(win, [{ ...win, x: 401 }]), true);
  assert.equal(perchHolds(win, [{ ...win, y: 340 }]), false);
  assert.equal(perchHolds(win, []), false);
});

test('깡충 뛰기: 처음과 끝은 정확히, 가운데는 높이', () => {
  const a = { x: 0, y: 500 };
  const b = { x: 100, y: 300 };
  assert.deepEqual(hopAt(a, b, 0), a);
  assert.deepEqual(hopAt(a, b, 1), b);
  assert.ok(hopAt(a, b, 0.5).y < 400);
});
