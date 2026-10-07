import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEET_RANGE, meetPlan } from './meet.ts';

const main = { x: 1000, y: 800, width: 160, height: 160 };

test('왼쪽 친구는 기본 펫 왼쪽 옆으로 와서 서로 마주 본다', () => {
  const friend = { x: 700, y: 800, width: 160, height: 160 };
  const p = meetPlan(main, friend, true);
  assert.ok(p);
  assert.equal(p.friendDir, 1);
  assert.equal(p.mainDir, -1);
  // 친구 가운데가 기본 펫 가운데보다 왼쪽, 너무 멀지도 겹치지도 않게
  const fc = p.x + 80;
  assert.ok(fc < 1080 && 1080 - fc > 80 && 1080 - fc < 160, `${fc}`);
});

test('오른쪽 친구는 오른쪽 옆으로', () => {
  const p = meetPlan(main, { x: 1400, y: 800, width: 120, height: 120 + 40 }, true);
  assert.ok(p);
  assert.equal(p.friendDir, -1);
  assert.equal(p.mainDir, 1);
  assert.ok(p.x > main.x);
});

test('다른 모니터, 다른 높이(창 위에 앉음), 너무 멀면 안 만난다', () => {
  const friend = { x: 700, y: 800, width: 160, height: 160 };
  assert.equal(meetPlan(main, friend, false), null);
  assert.equal(meetPlan(main, { ...friend, y: 500 }, true), null);
  assert.equal(meetPlan(main, { ...friend, x: 1000 - MEET_RANGE - 10 }, true), null);
  // 바닥이 조금 다른 것(크기 차이)은 괜찮다
  assert.ok(meetPlan(main, { x: 700, y: 820, width: 140, height: 140 }, true));
});

test('그쪽 옆이 화면 밖이면 반대쪽 옆으로, 양쪽 다 안 되면 안 만난다', () => {
  const area = { x: 0, y: 0, width: 1512, height: 982 };
  const edge = { x: 0, y: 800, width: 160, height: 160 };
  // 같은 자리에 겹쳐 있음: 왼쪽은 화면 밖이라 오른쪽으로
  const p = meetPlan(edge, { ...edge }, true, area);
  assert.ok(p);
  assert.ok(p.x >= 0);
  assert.equal(p.mainDir, 1);
  assert.equal(p.friendDir, -1);
  const tiny = { x: 0, y: 0, width: 200, height: 982 };
  assert.equal(meetPlan(edge, { ...edge }, true, tiny), null);
});
