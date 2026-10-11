import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STARTER_IDS } from '../../shared/starter-pets.ts';
import {
  type Affine,
  apply,
  boneMatrices,
  buildMesh,
  invert,
  isRestPose,
  legStep,
  moveMatrix,
  mul,
  type RigDef,
  rigPose,
  skin,
  triangleAffine,
  weightsAt,
} from './photo-rig.ts';
import { STARTER_RIGS } from './photo-rig-data.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 작은 시험 뼈대: 몸, 머리(귀 하나), 앞발 하나 */
const TOY: RigDef = {
  w: 100,
  h: 100,
  cell: 10,
  ground: 100,
  bones: [
    { id: 'body', pivot: [50, 100] },
    { id: 'head', parent: 'body', pivot: [50, 40], grip: [{ a: [50, 20], b: [38, 4], r: 15, soft: 5 }] },
    { id: 'earL', parent: 'head', pivot: [40, 10], grip: [{ a: [40, 10], b: [35, 0], r: 4, soft: 2 }] },
    {
      id: 'legL',
      parent: 'body',
      pivot: [30, 95],
      grip: [{ a: [30, 60], b: [30, 100], r: 6, soft: 2 }],
      ramp: [0.1, 0.7],
    },
  ],
  motion: { paw: 10, hind: 4, rise: 8, bob: 2, settle: 3, tail: 0.2, ear: 0.1 },
};

/** 뼈 이름으로 그림 기준 변환 */
const matOf = (def: RigDef, mats: Affine[], id: string) =>
  mats[def.bones.findIndex((b) => b.id === id)] as Affine;

test('변환: 가운데 둘레로 돌리고 키워도 가운데는 그대로, 거꾸로 하면 제자리', () => {
  const m = moveMatrix([30, 40], { rot: 0.7, sx: 1.3, sy: 0.8, dx: 0, dy: 0 });
  const [x, y] = apply(m, 30, 40);
  close(x, 30);
  close(y, 40);
  const back = mul(invert(m), m);
  for (const [i, v] of [1, 0, 0, 1, 0, 0].entries()) close(back[i] as number, v);
  // 옮기기는 돌린 뒤에 더한다
  const t = moveMatrix([0, 0], { rot: Math.PI / 2, dx: 5 });
  const [px, py] = apply(t, 1, 0);
  close(px, 5);
  close(py, 1);
});

test('세모 아핀: 세 꼭짓점을 정확히 옮기고, 납작한 세모는 버린다', () => {
  const u = [0, 0, 10, 0, 0, 10] as const;
  const d = [5, 5, 12, 8, 3, 20] as const;
  const a = triangleAffine(u, d) as Affine;
  for (let i = 0; i < 3; i++) {
    const [x, y] = apply(a, u[i * 2] as number, u[i * 2 + 1] as number);
    close(x, d[i * 2] as number);
    close(y, d[i * 2 + 1] as number);
  }
  assert.equal(triangleAffine([0, 0, 1, 1, 2, 2], d), undefined);
});

test('무게: 어디서나 합이 1, 자식은 부모 무게 안에서만, 다리는 어깨 0 에서 발 1 로', () => {
  for (const [x, y] of [
    [50, 20],
    [40, 8],
    [30, 98],
    [30, 62],
    [90, 90],
    [0, 0],
  ] as const) {
    const w = weightsAt(TOY, x, y);
    close(
      w.reduce((a, b) => a + b, 0),
      1,
    );
    assert.ok(w.every((v) => v >= 0));
  }
  // 귀 끝은 귀가 거의 다, 머리 가운데는 머리가 다
  assert.ok((weightsAt(TOY, 38, 5)[2] as number) > 0.9);
  close(weightsAt(TOY, 50, 20)[1] as number, 1);
  // 다리: 어깨(진행 0)는 몸에 붙고 발(진행 1)은 다리만
  close(weightsAt(TOY, 30, 60)[3] as number, 0);
  close(weightsAt(TOY, 30, 99)[3] as number, 1);
  // 귀 자리라도 머리가 쥐지 않는 곳이면 귀도 못 가져간다 (부모 무게 안에서만)
  const far: RigDef = {
    ...TOY,
    bones: TOY.bones.map((b) =>
      b.id === 'earL' ? { ...b, grip: [{ a: [90, 90], b: [90, 90], r: 5, soft: 1 }] } : b,
    ),
  };
  close(weightsAt(far, 90, 90)[2] as number, 0);
});

test('형제 뼈가 겹치면 나눠 가져 합이 1 을 넘지 않는다', () => {
  const twin: RigDef = {
    ...TOY,
    bones: [
      { id: 'body', pivot: [50, 100] },
      { id: 'legL', parent: 'body', pivot: [50, 50], grip: [{ a: [50, 50], b: [50, 50], r: 10, soft: 1 }] },
      { id: 'legR', parent: 'body', pivot: [50, 50], grip: [{ a: [50, 50], b: [50, 50], r: 10, soft: 1 }] },
    ],
  };
  const w = weightsAt(twin, 50, 50);
  close(w[0] as number, 0);
  close(w[1] as number, 0.5);
  close(w[2] as number, 0.5);
});

test('뼈 변환: 자식은 부모를 따라가고, 바닥 기준(ground) 뼈는 몸이 움직여도 그대로', () => {
  const mats = boneMatrices(TOY, { body: { dy: -10 }, head: { rot: 0 }, legL: { ground: true } });
  const [, hy] = apply(matOf(TOY, mats, 'head'), 50, 20);
  close(hy, 10);
  const [, ey] = apply(matOf(TOY, mats, 'earL'), 40, 10);
  close(ey, 0);
  const [, ly] = apply(matOf(TOY, mats, 'legL'), 30, 95);
  close(ly, 95);
});

test('그물: 투명한 칸은 빼고, 쉬는 자세면 꼭짓점이 제자리', () => {
  // 왼쪽 절반만 그림이 있다
  const mesh = buildMesh(TOY, (x) => (x < 50 ? 255 : 0));
  assert.ok(mesh.tris.length / 3 > 0);
  for (let i = 0; i < mesh.rest.length; i += 2) assert.ok((mesh.rest[i] as number) <= 60);
  const full = buildMesh(TOY, () => 255);
  assert.equal(full.tris.length / 3, 10 * 10 * 2);
  assert.ok(mesh.tris.length < full.tris.length);
  const pos = skin(full, boneMatrices(TOY, {}));
  for (let i = 0; i < pos.length; i++) close(pos[i] as number, full.rest[i] as number, 1e-4);
  // 무게는 꼭짓점마다 합 1
  for (let i = 0; i < full.rest.length / 2; i++) {
    let sum = 0;
    for (let j = 0; j < full.bones; j++) sum += full.weights[i * full.bones + j] as number;
    close(sum, 1, 1e-5);
  }
});

test('쉬는 자세: 아무것도 안 하면 뼈가 움직이지 않는다 (그물 없이 그림 그대로)', () => {
  for (const id of STARTER_IDS) {
    assert.ok(isRestPose(rigPose(STARTER_RIGS[id], {})));
    assert.ok(isRestPose(rigPose(STARTER_RIGS[id], { head: {}, legs: [0, 0], sit: 0 })));
    assert.ok(!isRestPose(rigPose(STARTER_RIGS[id], { tail: 0.3 })));
  }
});

test('네 발 걸음: 대각선 쌍이 같이 들고 반 걸음 뒤 반대 쌍이 든다', () => {
  for (const phase of [0, 0.1, 0.2]) {
    const fl = legStep('fl', phase);
    close(fl.lift, legStep('hr', phase).lift);
    close(legStep('fr', phase).lift, 0);
    close(legStep('fr', phase + 0.5).lift, fl.lift);
  }
  assert.ok(legStep('fl', 0).lift > 0.99);
  // 든 발은 앞으로 나가는 중(가운데), 디딘 발은 뒤로 밀리는 중
  close(legStep('fl', 0).slide, 0);
  assert.ok(legStep('fr', 0.1).slide > legStep('fr', 0.2).slide);
});

test('디딘 발은 몸이 간 만큼 뒤로 밀려 바닥에서 미끄러지지 않는다', () => {
  // 딛는 반 걸음 동안 발은 보폭의 절반을 뒤로 (몸이 반 보폭을 가니까)
  const stride = 80;
  const at = (phase: number) => {
    const pose = rigPose(STARTER_RIGS.milk, { walk: { phase, dir: 1, stride, k: 1, rise: 1 } });
    return pose.legR?.dx ?? 0;
  };
  // 오른앞발은 0.25 ~ 0.75 가 들기 (가운데 0.5), 0.75 ~ 1.25 가 딛기
  close(at(0.76) - at(0.24), 0.48 * stride, 1e-3);
  assert.ok(at(0.8) > at(0.9) && at(0.9) > at(0.99));
});

test('걸으면 일어서도 디딘 앞발은 바닥에, 든 앞발만 올라간다', () => {
  for (const id of STARTER_IDS) {
    const def = STARTER_RIGS[id];
    const pose = rigPose(def, { walk: { phase: 0, dir: -1, stride: 60, k: 1, rise: 1 } });
    const mats = boneMatrices(def, pose);
    const paw = (leg: 'legL' | 'legR') => {
      const b = def.bones.find((x) => x.id === leg);
      assert.ok(b);
      return apply(matOf(def, mats, leg), b.pivot[0], b.pivot[1])[1] - b.pivot[1];
    };
    // phase 0: 왼앞발이 가장 높이 들고 오른앞발은 딛는다
    close(paw('legL'), -def.motion.paw);
    close(paw('legR'), 0);
    // 몸은 일어서 있다 (머리가 올라갔다)
    const head = def.bones.find((x) => x.id === 'head');
    assert.ok(head);
    assert.ok(
      apply(matOf(def, mats, 'head'), head.pivot[0], head.pivot[1])[1] < head.pivot[1] - def.motion.rise / 2,
    );
  }
});

test('출발과 멈춤(보폭 0)에는 발을 들지 않는다', () => {
  const pose = rigPose(STARTER_RIGS.choco, { walk: { phase: 0, dir: 1, stride: 60, k: 0, rise: 0 } });
  assert.ok(isRestPose(pose));
});

test('몸짓 값이 뼈로 간다: 발 구르기는 앞발, 꼬리 흔들기는 꼬리, 귀는 바깥으로', () => {
  const def = STARTER_RIGS.milk;
  const p = rigPose(def, { legs: [1, 0], tail: 0.4, ears: [0.5, 0.5] });
  close(p.legL?.dy ?? 0, -def.motion.paw);
  close(p.legR?.dy ?? 0, 0);
  close(p.tail?.rot ?? 0, 0.4);
  // 왼귀는 바깥이 시계 반대 (음수), 오른귀는 시계 방향 (양수)
  assert.ok((p.earL?.rot ?? 0) < 0 && (p.earR?.rot ?? 0) > 0);
  // 손 흔들기: 오른 앞발만 높이 든다
  const wave = rigPose(def, { wave: { k: 1, swing: 0.5 } });
  assert.ok((wave.legR?.dy ?? 0) < -def.motion.paw);
  close(wave.legL?.dy ?? 0, 0);
});

test('앉으면 몸이 내려앉고 발은 바닥에 그대로', () => {
  const def = STARTER_RIGS.choco;
  const pose = rigPose(def, { sit: 1 });
  close(pose.body?.dy ?? 0, def.motion.settle);
  const mats = boneMatrices(def, pose);
  const leg = def.bones.find((b) => b.id === 'legL');
  assert.ok(leg);
  close(apply(matOf(def, mats, 'legL'), leg.pivot[0], leg.pivot[1])[1], leg.pivot[1]);
});

test('기본 그림 뼈대: 그림 크기와 같고, 뿌리가 맨 앞, 부모가 자식보다 앞, 자리가 그림 안', () => {
  for (const id of STARTER_IDS) {
    const def = STARTER_RIGS[id];
    // PNG 머리의 가로세로 (16~24 바이트)
    const png = readFileSync(new URL(`../../../resources/pets/${id}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), def.w, `${id} 가로`);
    assert.equal(png.readUInt32BE(20), def.h, `${id} 세로`);
    assert.equal(def.bones[0]?.parent, undefined);
    const seen = new Set<string>();
    for (const b of def.bones) {
      if (b.parent) assert.ok(seen.has(b.parent), `${id} ${b.id} 의 부모 ${b.parent} 가 앞에 없다`);
      assert.ok(!seen.has(b.id), `${id} ${b.id} 가 둘`);
      seen.add(b.id);
      assert.ok(b.pivot[0] >= 0 && b.pivot[0] <= def.w && b.pivot[1] >= 0 && b.pivot[1] <= def.h);
    }
    for (const need of ['head', 'legL', 'legR', 'tail', 'earL', 'earR'])
      assert.ok(seen.has(need), `${id} ${need}`);
    // 그물이 너무 촘촘하면 걸을 때 그리는 값이 커진다 (그림이 꽉 차도 세모 700 개 안, 실제로는 빈 칸을 빼서 300 개 안팎)
    const mesh = buildMesh(def, () => 255);
    assert.ok(mesh.tris.length / 3 <= 700, `${id} 세모 ${mesh.tris.length / 3}`);
  }
});
