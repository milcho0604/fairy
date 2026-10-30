import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHoverGuard, HOVER_SLACK, stillNearPet } from './pet-hover.ts';

const pet = { x: 100, y: 100, width: 120, height: 120 };

test('커서가 펫 안이나 둘레 여유 안이면 가깝다, 밖이면 아니다', () => {
  assert.equal(stillNearPet({ x: 150, y: 150 }, pet), true);
  assert.equal(stillNearPet({ x: 100 - HOVER_SLACK, y: 150 }, pet), true);
  assert.equal(stillNearPet({ x: 100 - HOVER_SLACK - 1, y: 150 }, pet), false);
  assert.equal(stillNearPet({ x: 400, y: 150 }, pet), false);
});

test('말풍선 근처도 가깝다', () => {
  const bubble = { x: 100, y: 10, width: 200, height: 70 };
  assert.equal(stillNearPet({ x: 280, y: 40 }, pet, bubble), true);
  assert.equal(stillNearPet({ x: 280, y: 40 }, pet), false);
});

/** 가짜 창: 통과 설정만 기록한다 */
function rig(over = true) {
  const state = {
    over,
    busy: false,
    cursor: { x: 150, y: 150 },
    pet: { ...pet },
    bubble: undefined as typeof pet | undefined,
    ignore: undefined as boolean | undefined,
    resets: 0,
    cursorReads: 0,
  };
  const recheck = createHoverGuard({
    isOver: () => state.over,
    busy: () => state.busy,
    cursor: () => {
      state.cursorReads++;
      return state.cursor;
    },
    pet: () => state.pet,
    bubble: () => state.bubble,
    release: () => {
      state.over = false;
      state.ignore = true;
      state.resets++;
    },
  });
  return { state, recheck };
}

test('펫이 걸어 비켜 가면 마우스를 안 움직여도 통과로 돌아온다', () => {
  const { state, recheck } = rig();
  assert.equal(recheck(), false, '아직 커서 아래');
  assert.equal(state.ignore, undefined);
  state.pet = { ...pet, x: 100 + 300 };
  assert.equal(recheck(), true);
  assert.equal(state.ignore, true);
  assert.equal(state.over, false);
  assert.equal(state.resets, 1);
});

test('말풍선이 닫혀 커서가 빈 자리가 되면 통과로 돌아온다', () => {
  const { state, recheck } = rig();
  state.cursor = { x: 280, y: 40 };
  state.pet = { ...pet, x: 100, y: 200 };
  state.bubble = { x: 100, y: 10, width: 200, height: 70 };
  assert.equal(recheck(), false, '말풍선 위');
  state.bubble = undefined;
  assert.equal(recheck(), true);
});

test('끌기, 보기, 휠 통과 중이면 건드리지 않는다', () => {
  const { state, recheck } = rig();
  state.pet = { ...pet, x: 900 };
  state.busy = true;
  assert.equal(recheck(), false);
  assert.equal(state.resets, 0);
});

test('펫 위 표시가 없으면 커서를 읽지도 않는다 (걷기 틱마다 불러도 비용이 없다)', () => {
  const { state, recheck } = rig(false);
  state.pet = { ...pet, x: 900 };
  for (let i = 0; i < 50; i++) recheck();
  assert.equal(state.cursorReads, 0);
});
