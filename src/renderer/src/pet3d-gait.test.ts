import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Blueprint, Part } from '../../shared/pet3d/blueprint.ts';
import { expandMirrors } from '../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../shared/pet3d/defaults.ts';
import {
  bodyDepthOf,
  gaitMismatch,
  gaitOf,
  hindFrom,
  hipRise,
  isQuadKind,
  type LegId,
  legCut,
  legGap,
  quadKind,
  shapeOf,
  trotLeg,
  walkEnvelope,
  withGait,
} from './pet3d-gait.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('다리 나누기: 가장 크게 벌어진 틈이 기준 이상일 때만 앞뒤로 나눈다', () => {
  assert.equal(legCut([0.17], 0.12), undefined);
  // 발 하나에 발바닥 무늬가 붙은 것(0.17, 0.2)은 한 무리
  assert.equal(legCut([0.17, 0.2], 0.12), undefined);
  close(legCut([0.2, -0.15, 0.17, -0.18], 0.12) as number, (0.17 - 0.15) / 2);
  assert.equal(legCut([], 0.12), undefined);
  // 기준은 몸 두께의 30%, 적어도 0.12
  close(legGap(0.2), 0.12);
  close(legGap(1), 0.3);
});

const leg = (slot: Part['slot'], z: number, x = -0.15): Part => ({
  slot,
  shape: 'sphere',
  at: [x, 0.06, z],
  size: [0.08, 0.07, 0.09],
  color: '#cccccc',
});

test('걸음새: 적혀 있으면 그대로, 없으면 다리가 앞뒤 넷일 때만 네 발', () => {
  const four = expandMirrors([
    { ...leg('legL', 0.2), mirror: true },
    { ...leg('legL', -0.2), mirror: true },
  ]);
  const two = expandMirrors([{ ...leg('legL', 0.17), mirror: true }]);
  assert.equal(gaitOf({}, four, 0.6), 'quadruped');
  assert.equal(gaitOf({}, two, 0.6), 'biped');
  assert.equal(gaitOf({ gait: 'biped' }, four, 0.6), 'biped');
  assert.equal(gaitOf({ gait: 'quadruped' }, two, 0.6), 'quadruped');
  // 한쪽만 나뉘면(왼쪽 다리만 넷) 두 발로 본다
  assert.equal(gaitOf({}, [leg('legL', 0.2), leg('legL', -0.2), leg('legR', 0.2, 0.15)], 0.6), 'biped');
  // 기본 펫은 설계도에 적힌 대로
  for (const [k, bp] of Object.entries(DEFAULT_BLUEPRINTS)) {
    // 냥이, 멍멍이는 팔이 있어 두 발 (2026-10-11: 모든 펫은 손이 있어야 한다)
    const want = k === 'bunny' ? 'quadruped' : 'biped';
    assert.equal(gaitOf(bp, expandMirrors(bp.parts), 0.6), want, k);
    assert.equal(isQuadKind(k as keyof typeof DEFAULT_BLUEPRINTS), want === 'quadruped', k);
  }
  assert.equal(isQuadKind(undefined), false);
});

test('걸음새 짐작: gait 칸 없는 앉은 피규어(앞발만, 귀와 꼬리)는 몸 모양대로 두 발', () => {
  const part = (slot: Part['slot'], z = 0): Part => ({ ...leg(slot, z), mirror: true });
  const sitting = expandMirrors([part('legL', 0.06), part('earL'), part('tail')]);
  // 2026-10-08: 귀와 꼬리로 네 발을 짐작했더니 두 발로 만든 "밀크"가 네 발로 걸어 어색했다
  assert.equal(gaitOf({}, sitting, 0.6), 'biped');
  assert.equal(
    gaitOf({}, expandMirrors([part('legL'), part('earL'), part('tail'), part('wingL')]), 0.6),
    'biped',
  );
  // 기본 토순이는 설계도에 적힌 gait 로 네 발 (짐작과 상관없다). 냥이, 멍멍이는 팔이 있어 두 발로 적었다
  assert.equal(shapeOf(DEFAULT_BLUEPRINTS.bunny), 'quadruped');
  for (const k of ['kong', 'chick', 'cat', 'dog'] as const)
    assert.equal(shapeOf(DEFAULT_BLUEPRINTS[k]), 'biped', k);
});

test('몸 두께 어림: 몸 부품 z 범위, 몸이 없으면 0', () => {
  const body = (z: number, rz: number): Part => ({
    slot: 'body',
    shape: 'sphere',
    at: [0, 0.3, z],
    size: [0.3, 0.3, rz],
    color: '#cccccc',
  });
  close(bodyDepthOf([body(0, 0.25), body(-0.2, 0.2)]), 0.65);
  close(bodyDepthOf([leg('legL', 0.2)]), 0);
  // 네 다리로 선 몸은 어림 두께로도 네 발로 짐작한다
  const standing = {
    parts: [body(0, 0.3), { ...leg('legL', 0.2), mirror: true }, { ...leg('legL', -0.2), mirror: true }],
  };
  assert.equal(shapeOf(standing), 'quadruped');
});

test('고른 걸음새가 설계도보다 먼저: 덮기, 다른지 보기, 2D', () => {
  const cat = DEFAULT_BLUEPRINTS.bunny;
  // 안 골랐거나(자동) 같은 값이면 같은 설계도 그대로 (다시 조립하지 않는다)
  assert.equal(withGait(cat, undefined), cat);
  assert.equal(withGait(cat, 'quadruped'), cat);
  const two = withGait(cat, 'biped');
  assert.notEqual(two, cat);
  assert.equal(two.gait, 'biped');
  assert.equal(cat.gait, 'quadruped');
  assert.equal(gaitOf(two, expandMirrors(two.parts), 0.6), 'biped');
  // 냥이는 두 발 설계도: 네 발을 고르면 덮는다
  assert.equal(withGait(DEFAULT_BLUEPRINTS.cat, 'quadruped').gait, 'quadruped');
  // gait 칸 없는 설계도에도 덮는다
  const old: Pick<Blueprint, 'gait' | 'parts'> = { parts: [] };
  assert.equal(withGait(old, 'quadruped').gait, 'quadruped');
  // 자동은 몸과 늘 같다. 고른 값이 몸과 다를 때만 다시 만들기를 권한다
  assert.equal(gaitMismatch(undefined, 'biped'), false);
  assert.equal(gaitMismatch('biped', 'biped'), false);
  assert.equal(gaitMismatch('quadruped', 'biped'), true);
  assert.equal(gaitMismatch('biped', 'quadruped'), true);
  // 2D: 고른 값이 먼저, 없으면 기본 설계도대로
  assert.equal(quadKind('bunny', undefined), true);
  assert.equal(quadKind('bunny', 'biped'), false);
  assert.equal(quadKind('cat', undefined), false);
  assert.equal(quadKind('cat', 'quadruped'), true);
  assert.equal(quadKind('kong', undefined), false);
  assert.equal(quadKind('kong', 'quadruped'), true);
  assert.equal(quadKind(undefined, undefined), false);
});

test('본뜬 뒷발: 몸 가운데 너머 뒤로, 조금 바깥으로', () => {
  const h = hindFrom(-0.14, 0.17, 0);
  close(h.x, -0.154);
  close(h.z, -0.1445);
  // 몸 가운데가 앞에 있으면 그 기준으로 뒤집는다
  close(hindFrom(0.1, 0.3, 0.1).z, 0.1 - 0.2 * 0.85);
});

test('대각선 쌍: 왼앞발과 오른뒷발이 같이, 다른 쌍은 반대로 움직이고 든 발은 앞으로 나간다', () => {
  const ids: LegId[] = ['fl', 'fr', 'hl', 'hr'];
  for (const p of [0, 0.1, 0.25, 0.4, 0.6, 0.9]) {
    const s = Object.fromEntries(ids.map((id) => [id, trotLeg(id, p)])) as Record<
      LegId,
      { dz: number; lift: number }
    >;
    assert.deepEqual(s.fl, s.hr);
    assert.deepEqual(s.fr, s.hl);
    close(s.fl.dz, -s.fr.dz);
    // 한 쌍이 들려 있으면 다른 쌍은 디디고 있다 (네 발이 한꺼번에 뜨지 않는다)
    assert.ok(s.fl.lift === 0 || s.fr.lift === 0);
  }
  // 발이 들린 동안 앞으로 나간다: 들림이 가장 높을 때 dz 가 커지는 중
  const a = trotLeg('fl', 0);
  const b = trotLeg('fl', 0.01);
  assert.equal(a.lift, 1);
  assert.ok(b.dz > a.dz);
});

test('출발과 멈춤: 보폭, 돌기, 숙이기는 처음과 끝에 0, 가운데서 1', () => {
  // 비율 t 의 한 토막 걷기 (ms)
  const at = (t: number, ms: number) => walkEnvelope(t * ms, (1 - t) * ms, ms);
  assert.deepEqual(walkEnvelope(undefined, undefined, undefined), { stride: 1, turn: 1, lean: 1 });
  assert.deepEqual(walkEnvelope(250, 250, 0), { stride: 1, turn: 1, lean: 1 });
  for (const t of [0, 1]) assert.deepEqual(at(t, 4000), { stride: 0, turn: 0, lean: 0 });
  assert.deepEqual(at(0.5, 4000), { stride: 1, turn: 1, lean: 1 });
  // 범위를 넘은 진행(타이머가 조금 늦게 끝냄)도 0 으로 묶는다
  assert.deepEqual(at(1.05, 4000), { stride: 0, turn: 0, lean: 0 });
  // 긴 걷기는 돌기와 숙이기가 시간(320ms, 420ms)으로 끝난다: 1초 뒤엔 다 돌고 숙였다
  const e = at(0.1, 10_000);
  assert.equal(e.turn, 1);
  assert.equal(e.lean, 1);
  assert.ok(e.stride > 0 && e.stride < 1);
  // 짧은 걷기(0.5초)도 가운데서는 다 돈다
  assert.equal(at(0.5, 500).turn, 1);
  // 처음과 끝은 대칭
  const a = at(0.08, 3000);
  const b = at(0.92, 3000);
  close(a.stride, b.stride);
  close(a.turn, b.turn);
  close(a.lean, b.lean);
});

test('몸을 숙이면 앞 다리 관절은 내려가고 뒷다리 관절은 올라간다', () => {
  assert.equal(hipRise(0.13, 0.17, 0), 0);
  assert.ok(hipRise(0.13, 0.17, 0.32) < 0);
  assert.ok(hipRise(0.13, -0.14, 0.32) > 0);
  // 몸 관절 바로 위는 거의 그대로
  assert.ok(Math.abs(hipRise(0.13, 0, 0.1)) < 0.001);
});

test('따라 달리기: 1.04초마다 이어 받는 1.4초 걷기는 10초 동안 보폭이 줄지 않는다', () => {
  // pet.ts 가 이어 받은 걷기를 합치는 것과 같게: 시작은 그대로, 끝은 받은 때 + 1400
  const SEG = 1400;
  const EVERY = 1040;
  const start = 0;
  let end = start + SEG;
  let lastSend = 0;
  let mid = 1;
  for (let now = 0; now <= 10_000; now += 10) {
    if (now - lastSend >= EVERY) {
      lastSend = now;
      end = now + SEG;
    }
    const e = walkEnvelope(now - start, end - now, SEG);
    // 출발(보폭 350ms, 숙이기 420ms)이 지난 뒤는 내내 다 딛고 다 돌고 숙였다.
    // 숙이기만 다음 토막을 받기 직전(남은 360ms 안팎)에 몇 % 풀리기 시작한다
    if (now >= SEG / 4) mid = Math.min(mid, e.stride);
    if (now >= 420) {
      assert.equal(e.turn, 1);
      assert.ok(e.lean > 0.95, `lean ${e.lean} at ${now}`);
    }
  }
  assert.ok(mid > 0.99, `stride ${mid}`);
  // 마지막 토막이 끝날 때는 0 으로 내려앉는다
  assert.deepEqual(walkEnvelope(end - start, 0, SEG), { stride: 0, turn: 0, lean: 0 });
  assert.ok(walkEnvelope(end - start - 100, 100, SEG).stride < 0.5);
});
