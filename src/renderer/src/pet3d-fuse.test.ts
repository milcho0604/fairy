import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FusePart, fieldAt, fuseParts, shapeDistance, smin } from './pet3d-fuse.ts';

/** 자리 (tx,ty,tz) 에 반지름 r 공 (관절 → 모양 공간: 옮기고 1/r 배) */
const ball = (
  tx: number,
  ty: number,
  tz: number,
  r: number,
  color: [number, number, number] = [1, 0, 0],
): FusePart => ({
  shape: 'sphere',
  inv: [1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, 1 / r, 0, -tx / r, -ty / r, -tz / r, 1],
  scale: r,
  color,
  fur: 1,
});

const box = (r: number) => ({
  min: [-r, -r, -r] as [number, number, number],
  max: [r, r, r] as [number, number, number],
});

test('모양 거리: 안은 음수, 겉은 0, 밖은 양수', () => {
  for (const s of ['sphere', 'cylinder', 'cone', 'box'] as const) {
    assert.ok(shapeDistance(s, 0, 0, 0) < 0, `${s} 가운데`);
    assert.ok(shapeDistance(s, 3, 0, 0) > 0, `${s} 밖`);
  }
  assert.ok(Math.abs(shapeDistance('sphere', 1, 0, 0)) < 1e-9);
  assert.ok(Math.abs(shapeDistance('capsule', 0, 1.5, 0, { r: 0.5, half: 1 })) < 1e-9);
  assert.ok(Math.abs(shapeDistance('cylinder', 0, 1, 0)) < 1e-9);
});

test('부드러운 합은 둘보다 작거나 같고, 멀면 그냥 작은 쪽', () => {
  assert.ok(smin(0.1, 0.1, 0.05) < 0.1);
  assert.equal(smin(0, 1, 0.05), 0);
});

test('공 하나: 닫힌 겉면이 바깥을 보고 반지름이 맞다', () => {
  const m = fuseParts([ball(0, 0, 0, 0.3)], box(0.3), 0.02, 0.03);
  assert.ok(m);
  const p = m.positions;
  let outward = 0;
  const at = (i: number): [number, number, number] => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [ax, ay, az] = at(m.indices[t] ?? 0);
    const [bx, by, bz] = at(m.indices[t + 1] ?? 0);
    const [cx, cy, cz] = at(m.indices[t + 2] ?? 0);
    const [ux, uy, uz] = [bx - ax, by - ay, bz - az];
    const [vx, vy, vz] = [cx - ax, cy - ay, cz - az];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
    const mid = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3] as const;
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0) outward++;
  }
  assert.equal(outward, m.indices.length / 3, '안쪽을 보는 면이 있다');
  // 모든 정점이 겉면 가까이 (격자 반 칸 안)
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
    assert.ok(Math.abs(r - 0.3) < 0.012, `반지름 ${r}`);
  }
  // 바깥 방향 법선
  for (let i = 0; i < p.length; i += 3) {
    const dot: number = (p[i] ?? 0) * (m.normals[i] ?? 0) + (p[i + 1] ?? 0) * (m.normals[i + 1] ?? 0);
    assert.ok(dot + (p[i + 2] ?? 0) * (m.normals[i + 2] ?? 0) > 0);
  }
  // 닫혀 있다: 모든 모서리를 면 둘이 나눠 쓴다
  const edges = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e] ?? 0;
      const b = m.indices[t + ((e + 1) % 3)] ?? 0;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  assert.ok(
    [...edges.values()].every((n) => n === 2),
    '구멍이 있다',
  );
});

test('붙은 두 공은 이음새가 메워지고, 색은 가까운 부품을 따른다', () => {
  const red = ball(-0.2, 0, 0, 0.25, [1, 0, 0]);
  const blue = ball(0.2, 0, 0, 0.25, [0, 0, 1]);
  const k = 0.06;
  // 가운데 잘록한 자리가 합(min)보다 더 차 있다
  const plain = Math.hypot(0.2, 0.2) - 0.25;
  assert.ok(fieldAt([red, blue], k, 0, 0.2, 0) < plain - 0.01);
  const m = fuseParts([red, blue], { min: [-0.45, -0.25, -0.25], max: [0.45, 0.25, 0.25] }, 0.02, k);
  assert.ok(m);
  const leftmost = [...Array(m.positions.length / 3).keys()].reduce((a, i) =>
    (m.positions[i * 3] ?? 0) < (m.positions[a * 3] ?? 0) ? i : a,
  );
  assert.ok((m.colors[leftmost * 3] ?? 0) > 0.9 && (m.colors[leftmost * 3 + 2] ?? 1) < 0.1);
});
