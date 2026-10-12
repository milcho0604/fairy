import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitTilt,
  IMPACT_MS,
  impactSquash,
  photoStep,
  STEP_LIFT,
  TURN_SQUASH_MS,
  TurnWatch,
  turnSquash,
  WALK_LEAN,
} from './photo-motion.ts';

const walk = (phase: number, since: number, left: number, dir: -1 | 1 = 1) => ({
  phase,
  dir,
  since,
  left,
  segMs: 3000,
});

test('출발과 멈춤에서는 쉬는 몸 그대로 (멈추는 틀에 툭 서지 않는다)', () => {
  for (const phase of [0, 0.13, 0.25, 0.4, 0.77]) {
    for (const [since, left] of [
      [0, 3000],
      [3000, 0],
    ] as const) {
      const st = photoStep(walk(phase, since, left));
      assert.equal(st.lift, 0);
      assert.equal(st.sx, 1);
      assert.equal(st.sy, 1);
      assert.equal(st.rock, 0);
      assert.equal(st.lean, 0);
    }
  }
});

test('한창 걸을 때: 발이 닿는 순간 가장 낮고 눌리며, 걸음 사이에 떠서 조금 늘어난다', () => {
  const contact = photoStep(walk(0, 1500, 1500));
  const air = photoStep(walk(0.25, 1500, 1500));
  assert.equal(contact.lift, 0);
  assert.ok(contact.sy < 1 && contact.sx > 1, '닿을 때 눌린다');
  assert.ok(Math.abs(air.lift - STEP_LIFT) < 1e-9);
  assert.ok(air.sy > 1 && air.sx < 1, '떠 있을 때 늘어난다');
  // 은은하게: 4% 넘게 찌그러지지 않는다 (고무처럼 보이지 않게)
  for (let p = 0; p < 1; p += 0.01) {
    const st = photoStep(walk(p, 1500, 1500));
    assert.ok(Math.abs(st.sy - 1) <= 0.04 && Math.abs(st.sx - 1) <= 0.03, `${p}`);
  }
});

test('부피를 대략 지킨다: 세로로 눌리면 가로로 퍼진다', () => {
  for (let p = 0; p < 1; p += 0.05) {
    const st = photoStep(walk(p, 1500, 1500));
    if (st.sy < 1) assert.ok(st.sx >= 1);
    if (st.sy > 1) assert.ok(st.sx <= 1);
  }
});

test('걸음마다 좌우로 번갈아 까딱이고, 가는 쪽으로 숙인다', () => {
  const a = photoStep(walk(0.25, 1500, 1500));
  const b = photoStep(walk(0.75, 1500, 1500));
  assert.ok(a.rock > 0 && b.rock < 0);
  assert.ok(Math.abs(a.lean - WALK_LEAN) < 1e-9);
  assert.ok(Math.abs(photoStep(walk(0.25, 1500, 1500, -1)).lean + WALK_LEAN) < 1e-9);
});

test('틀 사이가 매끈하다: 걸음 곡선에 툭 튀는 곳이 없다', () => {
  let prev = photoStep(walk(0, 1500, 1500));
  for (let i = 1; i <= 400; i++) {
    const st = photoStep(walk(i / 400, 1500, 1500));
    assert.ok(Math.abs(st.lift - prev.lift) < 0.1, `lift ${i}`);
    assert.ok(Math.abs(st.sy - prev.sy) < 0.003, `sy ${i}`);
    assert.ok(Math.abs(st.rock - prev.rock) < 0.002, `rock ${i}`);
    prev = st;
  }
});

test('움직임 줄이기면 찌그러짐과 까딱 없이 조금 들썩이기만', () => {
  for (let p = 0; p < 1; p += 0.05) {
    const st = photoStep(walk(p, 1500, 1500), true);
    assert.equal(st.sx, 1);
    assert.equal(st.sy, 1);
    assert.equal(st.rock, 0);
    assert.ok(st.lift <= 1);
  }
});

test('돌아서기: 처음과 끝은 쉬는 몸, 가운데서 가장 좁다', () => {
  assert.deepEqual(turnSquash(-1), { sx: 1, sy: 1, lift: 0 });
  assert.deepEqual(turnSquash(0), { sx: 1, sy: 1, lift: 0 });
  assert.deepEqual(turnSquash(1), { sx: 1, sy: 1, lift: 0 });
  const mid = turnSquash(0.5);
  assert.ok(mid.sx < 0.9 && mid.sx > 0.85);
  assert.ok(turnSquash(0.25).sx > mid.sx);
  assert.ok(turnSquash(0.5, true).sx > mid.sx, '움직임 줄이기면 덜');
  assert.equal(turnSquash(0.5, true).lift, 0);
});

test('걷는 쪽이 바뀐 순간만 돌아선다 (처음 출발, 오래 쉬고 반대로 출발은 아니다)', () => {
  const w = new TurnWatch();
  assert.equal(w.update(0, 1), -1, '처음 출발');
  assert.equal(w.update(500, 1), -1);
  assert.equal(w.update(600, -1), 0, '거꾸로');
  assert.ok(w.update(600 + TURN_SQUASH_MS / 2, -1) > 0.49);
  assert.equal(w.update(600 + TURN_SQUASH_MS, -1), -1, '다 돌았다');
  // 멈춰서 한참 쉬다가 반대로 걸으면 그냥 출발
  assert.equal(w.update(2000, undefined), -1);
  assert.equal(w.update(5000, 1), -1);
  // 한 장만 그리면(시각 없음) 늘 쉬는 몸
  assert.equal(new TurnWatch().update(undefined, 1), -1);
});

test('던져서 부딪히면: 처음과 끝은 쉬는 몸, 바닥은 세로로 벽은 가로로 눌린다', () => {
  assert.deepEqual(impactSquash(0, 'y', 1), { sx: 1, sy: 1 });
  assert.deepEqual(impactSquash(IMPACT_MS, 'y', 1), { sx: 1, sy: 1 });
  const floor = impactSquash(IMPACT_MS * 0.15, 'y', 1);
  assert.ok(floor.sy < 0.92 && floor.sx > 1.05);
  const wall = impactSquash(IMPACT_MS * 0.15, 'x', 1);
  assert.ok(wall.sx < 0.93 && wall.sy > 1.03);
  // 약하게 부딪히면 덜, 움직임 줄이기면 없다
  assert.ok(impactSquash(IMPACT_MS * 0.15, 'y', 0.3).sy > floor.sy);
  assert.deepEqual(impactSquash(IMPACT_MS * 0.15, 'y', 1, true), { sx: 1, sy: 1 });
  // 은은하게: 18% 넘게 찌그러지지 않는다
  for (let ms = 0; ms < IMPACT_MS; ms += 5) assert.ok(Math.abs(impactSquash(ms, 'y', 1).sy - 1) <= 0.17);
});

test('넓은 사진이 걸으며 기울어도 위 모서리가 캔버스 밖으로 나가지 않는다 (이슈 #65)', () => {
  // 가장 넓은 사진(140x124)을 디딜 때 가로로 조금 퍼진 채, 까딱과 숙이기가 같은 쪽으로 겹친 때
  const halfW = 70 * 1.025;
  const h = 124;
  const room = 79;
  const reach = (t: number) => halfW * Math.cos(Math.abs(t)) + h * Math.sin(Math.abs(t));
  const worst = -(0.045 + WALK_LEAN);
  assert.ok(reach(worst) > room, '고치기 전에는 넘었다');
  const fit = fitTilt(worst, halfW, h, room);
  assert.ok(reach(fit) <= room + 1e-9, `넘침 ${reach(fit)}`);
  assert.ok(fit < 0 && fit > worst, '방향은 그대로, 조금만 덜 기운다');
  // 좁은 사진은 그대로 기운다
  assert.equal(fitTilt(worst, 40, 124, room), worst);
  assert.equal(fitTilt(0.05, 40, 124, room), 0.05);
  // 기울이지 않아도 넘치면 세운다
  assert.equal(fitTilt(0.05, 90, 124, room), 0);
});
