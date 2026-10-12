import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Part } from '../../shared/pet3d/blueprint.ts';
import { filletK, filletSphere, neckPair, sameColor, smin } from './pet3d-neck.ts';

// 찹쌀떡 모양: 몸보다 넓은 공 머리를 작은 공 몸 위에 깊이 겹친 설계도 (말로 만들기가 낸 모양)
const head: Part = {
  slot: 'head',
  shape: 'sphere',
  at: [0, 0.72, 0.02],
  size: [0.5, 0.4, 0.42],
  color: '#f8f4ee',
  finish: 'soft',
};
const body: Part = {
  slot: 'body',
  shape: 'sphere',
  at: [0, 0.34, 0],
  size: [0.34, 0.32, 0.3],
  color: '#f6f1ea',
  finish: 'soft',
};

/** 단위 공 정점 (위도, 경도 격자) */
function unitSphere(rows = 48, cols = 64) {
  const pos: number[] = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const th = (r / rows) * Math.PI;
      const ph = (c / cols) * Math.PI * 2;
      pos.push(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
    }
  return { pos: new Float32Array(pos), nrm: new Float32Array(pos) };
}

const world = (p: Part, pos: Float32Array, i: number): [number, number, number] => [
  p.at[0] + (pos[i] ?? 0) * p.size[0],
  p.at[1] + (pos[i + 1] ?? 0) * p.size[1],
  p.at[2] + (pos[i + 2] ?? 0) * p.size[2],
];

test('머리와 몸 잇기: 같은 색 공 머리가 공 몸 위에 겹쳐 있을 때만', () => {
  assert.deepEqual(neckPair([body, head]), { head, body });
  // 맞닿는 색이 다르면 (옷, 다른 색 몸) 갈라진 것이 맞다
  assert.equal(neckPair([body, { ...head, color: '#7a5230' }]), undefined);
  // 머리 아래를 다른 색으로 나눴으면 그 색으로 견준다
  assert.equal(
    neckPair([body, { ...head, pattern: { type: 'split', color: '#334455', side: 'bottom', amount: 0.4 } }]),
    undefined,
  );
  assert.deepEqual(
    neckPair([body, { ...head, pattern: { type: 'split', color: '#a9cde6', side: 'top', amount: 0.5 } }])
      ?.body,
    body,
  );
  // 무늬 있는 몸, 앞으로 내민 머리(네 발 동물), 떨어진 머리, 돌린 공, 공이 아닌 몸은 그대로
  assert.equal(neckPair([{ ...body, pattern: { type: 'spots', color: '#222222' } }, head]), undefined);
  assert.equal(neckPair([body, { ...head, at: [0, 0.6, 0.3] }]), undefined);
  assert.equal(neckPair([body, { ...head, at: [0, 1.2, 0.02] }]), undefined);
  assert.equal(neckPair([body, { ...head, rot: [0, 0, 20] }]), undefined);
  assert.equal(neckPair([{ ...body, shape: 'capsule' }, head]), undefined);
  assert.equal(neckPair([body]), undefined);
  assert.ok(sameColor('#f6f1ea', '#f8f4ee'));
  assert.ok(!sameColor('#f6f1ea', '#a9cde6'));
});

test('머리와 몸 잇기: 골 가까이 정점만 둥근 이음 겉면으로 밀고, 나머지는 그대로', () => {
  const k = filletK(body);
  for (const [self, other] of [
    [head, body],
    [body, head],
  ] as const) {
    const { pos, nrm } = unitSphere();
    const before = pos.slice();
    const moved = filletSphere(self, other, pos, nrm);
    assert.ok(moved > 20, `${self.slot} 정점 ${moved}`);
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = world(self, pos, i);
      const changed = pos[i] !== before[i] || pos[i + 1] !== before[i + 1] || pos[i + 2] !== before[i + 2];
      if (!changed) continue;
      // 옮긴 정점은 두 공을 부드럽게 합친 겉면 위에, 밖으로만 (안으로 파이지 않는다)
      const [bx, by, bz] = world(self, before, i);
      const ell = (p: Part, px: number, py: number, pz: number) =>
        Math.hypot((px - p.at[0]) / p.size[0], (py - p.at[1]) / p.size[1], (pz - p.at[2]) / p.size[2]);
      assert.ok(ell(self, x, y, z) >= ell(self, bx, by, bz) - 1e-4);
      assert.ok(Math.hypot(x - bx, y - by, z - bz) <= k + 1e-6);
      // 법선은 길이 1
      assert.ok(Math.abs(Math.hypot(nrm[i] ?? 0, nrm[i + 1] ?? 0, nrm[i + 2] ?? 0) - 1) < 1e-5);
      // 골 높이 근처만 (머리 꼭대기, 몸 바닥은 그대로)
      assert.ok(y > 0.3 && y < 0.6, `y ${y}`);
    }
  }
});

test('머리와 몸 잇기: 골이 메워져 옆선 단면이 골에서 오목하게 꺾이지 않는다', () => {
  // 옆선(z=0, x>0)에서 높이마다 가장 바깥 반지름. 두 공 겉면이 만나는 골 높이에서 이음 전보다 커진다
  const outline = (fillet: boolean) => {
    const out = new Map<number, number>();
    for (const [self, other] of [
      [head, body],
      [body, head],
    ] as const) {
      const { pos, nrm } = unitSphere(96, 128);
      if (fillet) filletSphere(self, other, pos, nrm);
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = world(self, pos, i);
        if (Math.abs(z - self.at[2]) > 0.01 || x <= 0) continue;
        const key = Math.round(y * 100);
        out.set(key, Math.max(out.get(key) ?? 0, x));
      }
    }
    return out;
  };
  const plain = outline(false);
  const smooth = outline(true);
  // 골: 이음 전 옆선에서 가장 오목한 높이 (0.35~0.5 사이)
  let crease = 0;
  let worst = Number.POSITIVE_INFINITY;
  for (let key = 36; key <= 50; key++) {
    const a = plain.get(key - 2) ?? 0;
    const b = plain.get(key) ?? 0;
    const c = plain.get(key + 2) ?? 0;
    const bend = a + c - 2 * b;
    if (-bend < worst) {
      worst = -bend;
      crease = key;
    }
  }
  assert.ok((smooth.get(crease) ?? 0) > (plain.get(crease) ?? 0) + 0.005);
  assert.ok(smin(0, 0, 0.1) < 0);
});
