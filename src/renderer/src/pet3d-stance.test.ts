import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandParts, type Part, parseBlueprint } from '../../shared/pet3d/blueprint.ts';
import { STARTER_BLUEPRINTS, STARTER_LOOKS, starterModelOf } from '../../shared/pet3d/starters.ts';
import { legCut, legGap } from './pet3d-gait.ts';
import {
  blendPose,
  CAT_EXCITE_MS,
  DOG_EXCITE_MS,
  DUTY,
  excitement,
  FOOTFALL,
  footCycle,
  footPhase,
  gaitFor,
  gaitPhase,
  legTip,
  liePose,
  pitchAbout,
  STAND_AFTER_WALK_MS,
  type StanceDims,
  segAngle,
  sitPose,
  solveLeg,
  stanceGoal,
} from './pet3d-stance.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('다리 풀기: 닿는 자리면 발끝이 정확히 그 자리에 온다 (앞으로 풀어 확인)', () => {
  const hip = { y: 0.36, z: 0.19 };
  for (const foot of [
    { y: 0.04, z: 0.22 },
    { y: 0.04, z: 0.05 },
    { y: 0.12, z: 0.32 },
    { y: 0.2, z: 0.1 },
  ])
    for (const bend of [1, -1] as const) {
      const r = solveLeg(hip, foot, 0.17, 0.18, bend);
      assert.ok(r.reach);
      const tip = legTip(hip, r.a1, r.a2, 0.17, 0.18);
      close(tip.y, foot.y);
      close(tip.z, foot.z);
    }
});

test('다리 풀기: 뒷다리 무릎은 앞으로, 앞다리 팔꿈치는 뒤로 굽는다', () => {
  const hip = { y: 0.4, z: 0 };
  const foot = { y: 0.05, z: 0 };
  // 곧장 아래 발: 무릎이 엉덩이와 발을 잇는 선(z=0)의 어느 쪽인지
  assert.ok(solveLeg(hip, foot, 0.2, 0.2, 1).knee.z > 0.01);
  assert.ok(solveLeg(hip, foot, 0.2, 0.2, -1).knee.z < -0.01);
});

test('다리 풀기: 멀면 쭉 뻗은 채 그쪽을 향하고, 숫자가 깨지지 않는다', () => {
  const r = solveLeg({ y: 0.4, z: 0 }, { y: -1, z: 0.3 }, 0.2, 0.2, 1);
  assert.equal(r.reach, false);
  // 거의 곧게 (두 마디 각이 같다)
  close(r.a1, r.a2, 0.05);
  for (const v of [r.a1, r.a2, r.knee.y, r.knee.z]) assert.ok(Number.isFinite(v));
  // 엉덩이와 같은 자리에 둔 발도 깨지지 않는다
  const same = solveLeg({ y: 0.3, z: 0 }, { y: 0.3, z: 0 }, 0.2, 0.15, -1);
  for (const v of [same.a1, same.a2]) assert.ok(Number.isFinite(v));
});

test('마디 각: 곧장 아래가 0, 앞이 +', () => {
  close(segAngle({ y: 1, z: 0 }, { y: 0, z: 0 }), 0);
  close(segAngle({ y: 1, z: 0 }, { y: 1, z: 1 }), Math.PI / 2);
  close(segAngle({ y: 1, z: 0 }, { y: 1, z: -1 }), -Math.PI / 2);
});

test('발 한 걸음: 딛는 동안 바닥에 있고 일정한 빠르기로 뒤로, 드는 동안 앞으로 나가며 이어진다', () => {
  const duty = 0.64;
  const stride = 0.3;
  const lift = 0.07;
  const start = footCycle(0, duty, stride, lift);
  close(start.dz, stride / 2);
  close(start.dy, 0);
  close(footCycle(duty - 1e-9, duty, stride, lift).dz, -stride / 2, 1e-6);
  // 딛는 동안: 높이 0, 같은 간격으로 뒤로
  let prev = start.dz;
  for (let u = 0.05; u < duty; u += 0.05) {
    const f = footCycle(u, duty, stride, lift);
    close(f.dy, 0);
    close(prev - f.dz, (stride * 0.05) / duty, 1e-6);
    prev = f.dz;
  }
  // 드는 동안: 위로 들리고 끝에서 처음 자리로 이어진다
  for (let u = duty + 0.02; u < 1; u += 0.05) assert.ok(footCycle(u, duty, stride, lift).dy > 0);
  close(footCycle(1 - 1e-9, duty, stride, lift).dz, stride / 2, 1e-6);
  close(footCycle(1 - 1e-9, duty, stride, lift).dy, 0, 1e-4);
});

test('미끄러짐 없음: 몸이 간 거리로 걸음을 세면 디딘 발은 바닥(세상)에서 제자리다', () => {
  const cycle = 0.4;
  for (const kind of ['walk', 'trot'] as const) {
    const duty = DUTY[kind];
    for (const leg of ['fl', 'fr', 'hl', 'hr'] as const) {
      let planted: number | undefined;
      for (let travel = 0; travel < 2; travel += 0.005) {
        const u = footPhase(leg, gaitPhase(travel, cycle), kind);
        const f = footCycle(u, duty, duty * cycle, 0.05);
        // 세상 자리 = 몸이 간 거리 + 몸 기준 발 자리
        const world = travel + f.dz;
        if (u < duty - 0.02 && u > 0.02) {
          if (planted === undefined) planted = world;
          else close(world, planted, 1e-6);
        } else planted = undefined;
      }
    }
  }
});

test('걸음새: 걷기는 늘 두 발 이상 바닥에, 속보는 대각선 쌍이 같이 움직인다', () => {
  for (let p = 0; p < 1; p += 0.01) {
    const down = (['fl', 'fr', 'hl', 'hr'] as const).filter((l) => footPhase(l, p, 'walk') < DUTY.walk);
    assert.ok(down.length >= 2, `phase ${p}`);
    close(footPhase('fl', p, 'trot'), footPhase('hr', p, 'trot'));
    close(footPhase('fr', p, 'trot'), footPhase('hl', p, 'trot'));
  }
  // 옆 차례 걸음: 왼뒷발, 왼앞발, 오른뒷발, 오른앞발
  assert.deepEqual(
    Object.entries(FOOTFALL.walk)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k),
    ['hl', 'fl', 'hr', 'fr'],
  );
});

test('걸음 진행: 한 걸음 거리마다 한 바퀴, 깨진 값은 0', () => {
  close(gaitPhase(0.1, 0.4), 0.25);
  close(gaitPhase(0.5, 0.4), 0.25);
  close(gaitPhase(-0.1, 0.4), 0.75);
  assert.equal(gaitPhase(Number.NaN, 0.4), 0);
  assert.equal(gaitPhase(1, 0), 0);
});

test('빠르기: 보통 걸음은 걷기, 빠르면 속보에 보폭이 넓다', () => {
  assert.deepEqual(gaitFor(1), { kind: 'walk', cycleK: 1 });
  assert.equal(gaitFor(0).kind, 'walk');
  assert.equal(gaitFor(Number.NaN).kind, 'walk');
  const fast = gaitFor(3);
  assert.equal(fast.kind, 'trot');
  assert.ok(fast.cycleK > 1 && fast.cycleK <= 1.6);
});

const DIMS: StanceDims = {
  hip: { y: 0.39, z: -0.21 },
  shoulder: { y: 0.36, z: 0.19 },
  rump: 0.16,
  chest: 0.13,
  pawY: 0.04,
  frontFootZ: 0.215,
  frontReach: 0.33,
};

test('앉은 자세: 엉덩이는 바닥 가까이, 어깨는 앞발 위 거의 다리 길이 높이에 온다', () => {
  const sit = sitPose(DIMS);
  assert.ok(sit.pitch > 0.25 && sit.pitch < 1.05, `pitch ${sit.pitch}`);
  assert.ok(sit.hip.y < DIMS.hip.y * 0.5);
  // 몸통을 돌려 놓은 어깨 자리
  const pivot = DIMS.hip;
  const shoulder = pitchAbout(DIMS.shoulder, pivot, sit.pitch);
  const sy = sit.hip.y + (shoulder.y - pivot.y);
  const sz = sit.hip.z + (shoulder.z - pivot.z);
  close(sy, DIMS.pawY + DIMS.frontReach * 0.97, 1e-6);
  close(sz, DIMS.frontFootZ - 0.02, 1e-6);
});

test('엎드린 자세: 서 있을 때보다 낮고 거의 수평', () => {
  const lie = liePose(DIMS);
  assert.ok(lie.hip.y < DIMS.hip.y - 0.1);
  assert.ok(Math.abs(lie.pitch) < 0.1);
});

test('자세 섞기: 무게대로, 합이 1 을 넘으면 나눈다', () => {
  const a = { pitch: 0, hip: { y: 1, z: 0 } };
  const b = { pitch: 1, hip: { y: 0, z: 1 } };
  const c = { pitch: -1, hip: { y: 0.5, z: -1 } };
  assert.deepEqual(blendPose(a, b, c, { sit: 0, lie: 0 }), a);
  assert.deepEqual(blendPose(a, b, c, { sit: 1, lie: 0 }), b);
  const half = blendPose(a, b, c, { sit: 1, lie: 1 });
  close(half.pitch, 0);
  close(half.hip.y, 0.25);
});

test('몸통 돌리기: 앞을 들면 앞쪽 점이 올라간다', () => {
  const p = pitchAbout({ y: 0, z: 1 }, { y: 0, z: 0 }, Math.PI / 2);
  close(p.y, 1);
  close(p.z, 0);
});

test('바라는 자세: 걷기는 서고, 걷고 나서 잠깐 서 있다가 앉고, 잠은 엎드린다', () => {
  assert.equal(stanceGoal({ mood: 'idle', act: 'walk' }), 'stand');
  assert.equal(stanceGoal({ mood: 'idle', sinceWalk: 1000 }), 'stand');
  assert.equal(stanceGoal({ mood: 'idle', sinceWalk: STAND_AFTER_WALK_MS + 1 }), 'sit');
  assert.equal(stanceGoal({ mood: 'idle' }), 'sit');
  assert.equal(stanceGoal({ mood: 'sleeping' }), 'lie');
  assert.equal(stanceGoal({ mood: 'dozing' }), 'sit');
  assert.equal(stanceGoal({ mood: 'idle', act: 'sit' }), 'lie');
  assert.equal(stanceGoal({ mood: 'idle', act: 'roll' }), 'lie');
  assert.equal(stanceGoal({ mood: 'idle', act: 'stretch', sinceWalk: 1e9 }), 'stand');
  assert.equal(stanceGoal({ mood: 'idle', act: 'yawn', sinceWalk: 10 }), 'sit');
  assert.equal(stanceGoal({ mood: 'excited' }), 'stand');
  assert.equal(stanceGoal({ mood: 'grabbed' }), 'stand');
  assert.equal(stanceGoal({ mood: 'idle', trick: 'wave', sinceWalk: 10 }), 'sit');
  assert.equal(stanceGoal({ mood: 'idle', trick: 'dance' }), 'stand');
  assert.equal(stanceGoal({ mood: 'idle', hands: true, sinceWalk: 10 }), 'sit');
  // 매운맛 토라짐 3단계는 앉기 몸짓으로 오지만 등 돌리고 앉는다 (엎드리지 않는다)
  assert.equal(stanceGoal({ mood: 'sulky', act: 'sit' }), 'sit');
  assert.equal(stanceGoal({ mood: 'thinking' }), 'sit');
});

test('밀크, 초코 설계도: 네 발로 선 몸이고 다리마다 앞뒤가 나뉘며 무릎 아래 마디가 있다', () => {
  for (const [id, bp] of [...Object.entries(STARTER_BLUEPRINTS), ...Object.entries(STARTER_LOOKS)]) {
    assert.equal(bp.stance, 'stand', id);
    assert.equal(bp.gait, 'quadruped', id);
    const parts = expandParts(bp.parts);
    // 몸 앞뒤 두께 0.5 남짓 (옆으로 누운 몸통)
    const depth = 0.55;
    for (const slot of ['legL', 'legR'] as const) {
      const legs = parts.filter((p) => p.slot === slot);
      const cut = legCut(
        legs.map((p) => p.at[2]),
        legGap(depth),
      );
      assert.ok(cut !== undefined, `${id} ${slot}`);
      const cutZ = cut ?? 0;
      for (const front of [true, false]) {
        const mine: Part[] = legs.filter((p) => p.at[2] > cutZ === front);
        assert.ok(mine.some((p) => p.knee) && mine.some((p) => !p.knee), `${id} ${slot} ${front}`);
        // 발(가장 낮은 무릎 아래 부품)은 바닥에 닿는다
        const paw = mine.filter((p) => p.knee).sort((a, b) => a.at[1] - b.at[1])[0];
        assert.ok(paw && Math.abs(paw.at[1] - paw.size[1]) < 0.01, `${id} paw on ground`);
      }
    }
    // 저장했다 다시 읽어도 그대로 (설계도 검사가 새 칸을 지운다면 걷는 몸이 깨진다)
    const back = parseBlueprint(JSON.parse(JSON.stringify(bp)));
    assert.equal(back?.stance, 'stand');
    assert.equal(back?.parts.filter((p) => p.knee).length, bp.parts.filter((p) => p.knee).length);
  }
});

test('밀크, 초코 그림 파일이면 입체 설계도를 준다. 다른 사진 펫은 없다', () => {
  assert.equal(starterModelOf('pet-milk-123.png'), STARTER_LOOKS.milk);
  assert.equal(starterModelOf('pet-choco-9.png'), STARTER_LOOKS.choco);
  // 닮게 하는 덧붙임(갈기, 혀)은 앱이 그리는 밀크, 초코에만 (사진 동물을 세우는 뼈대에는 없다)
  assert.ok(STARTER_LOOKS.milk.parts.length > STARTER_BLUEPRINTS.milk.parts.length);
  assert.equal(STARTER_LOOKS.choco.face.tongue, true);
  assert.equal(STARTER_BLUEPRINTS.choco.face.tongue, undefined);
  assert.equal(starterModelOf('pet-123.png'), null);
  assert.equal(starterModelOf(null), null);
  assert.equal(starterModelOf('pet-milk-1.png.png'), null);
});

test('신남: 고양이는 꼬리를 세우고 꾹꾹 누르다 작게 폴짝, 강아지는 놀자 인사와 통통', () => {
  let catHop = 0;
  let catPaw = 0;
  let dogHop = 0;
  let dogBow = 0;
  for (let t = 0; t < 3000; t += 10) {
    const c = excitement(true, t);
    catHop = Math.max(catHop, c.hop);
    catPaw = Math.max(catPaw, c.paws[0], c.paws[1]);
    assert.equal(c.bow, 0);
    const d = excitement(false, t);
    dogHop = Math.max(dogHop, d.hop);
    dogBow = Math.max(dogBow, d.bow);
  }
  // 예전엔 둘 다 18px 씩 계속 뛰었다. 고양이는 낮게, 강아지는 조금 더
  assert.ok(catHop > 3 && catHop <= 6, `cat hop ${catHop}`);
  assert.ok(dogHop > catHop && dogHop <= 10, `dog hop ${dogHop}`);
  assert.ok(catPaw > 0.05, 'cat kneads');
  assert.ok(dogBow > 0.9, 'dog bows');
  assert.equal(excitement(true, 1000).tailUp, 1);
  // 꾹꾹은 왼발 오른발 번갈아 (같이 들지 않는다)
  for (let t = 0; t < CAT_EXCITE_MS; t += 7) {
    const c = excitement(true, t);
    assert.ok(c.paws[0] === 0 || c.paws[1] === 0);
  }
  // 한 바퀴 돌면 처음으로 이어진다
  assert.ok(Math.abs(excitement(false, DOG_EXCITE_MS + 5).bow - excitement(false, 5).bow) < 1e-9);
});

test('신남: 움직임 줄이기면 뛰지 않는다', () => {
  for (let t = 0; t < 3000; t += 25) {
    assert.equal(excitement(true, t, true).hop, 0);
    assert.equal(excitement(false, t, true).hop, 0);
    assert.ok(excitement(false, t, true).bow <= 0.5);
  }
});
