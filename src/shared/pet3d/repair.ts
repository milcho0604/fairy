// AI 가 만든 설계도 손보기 (v2). 값 범위는 parseBlueprint 가 자르고, 여기서는 모양이 말이 되게 고친다:
// 발을 바닥에 붙이고, 한쪽만 있는 팔다리와 귀는 거울로 짝을 채우고, 허공에 뜬 부품은 가까운 부품에 붙인다.
// three 없이 숫자만 다뤄 메인과 시험에서 쓴다. 고친 것은 fixes 로 돌려준다 (기록용)
import { type Blueprint, expandParts, type Part, rotateVec, type Slot, type Vec3 } from './blueprint.ts';

/** 부품이 차지하는 상자 (세상 기준). 돌린 부품은 모서리 여덟 개를 돌려 잰다. 관은 길 점들 ± 반지름 */
export function partBox(p: Part): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const take = (v: Vec3) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, v[i] as number);
      max[i] = Math.max(max[i] as number, v[i] as number);
    }
  };
  if (p.shape === 'tube' && p.path) {
    const r = p.size[0];
    for (const pt of p.path) {
      take([pt[0] - r, pt[1] - r, pt[2] - r]);
      take([pt[0] + r, pt[1] + r, pt[2] + r]);
    }
    return { min, max };
  }
  const [sx, sy, sz] = p.size;
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  for (const a of [-1, 1])
    for (const b of [-1, 1])
      for (const c of [-1, 1]) {
        const v: Vec3 = p.rot ? rotateVec([a * sx, b * sy, c * sz], rx, ry, rz) : [a * sx, b * sy, c * sz];
        take([p.at[0] + v[0], p.at[1] + v[1], p.at[2] + v[2]]);
      }
  return { min, max };
}

/** 부품 가운데 (관은 길의 가운데 점) */
function centerOf(p: Part): Vec3 {
  if (p.shape === 'tube' && p.path?.length) {
    const b = partBox(p);
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  }
  return p.at;
}

/** 부품 반지름 어림 (상자 반 대각선의 0.8: 타원체는 상자보다 작다) */
function radiusOf(p: Part): number {
  const b = partBox(p);
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 0.4;
}

const PAIRS: readonly [Slot, Slot][] = [
  ['legL', 'legR'],
  ['armL', 'armR'],
  ['earL', 'earR'],
  ['wingL', 'wingR'],
];

/** 설계도 전체를 y 로 옮긴다 (부품, 얼굴 높이, 관의 길, 코와 눈썹) */
export function shiftY(bp: Blueprint, dy: number): Blueprint {
  const parts = bp.parts.map((p) => ({
    ...p,
    at: [p.at[0], p.at[1] + dy, p.at[2]] as Vec3,
    ...(p.path ? { path: p.path.map(([x, y, z]) => [x, y + dy, z] as Vec3) } : {}),
  }));
  const face = { ...bp.face, eyeY: bp.face.eyeY + dy, mouthY: bp.face.mouthY + dy };
  if (face.nose?.y !== undefined) face.nose = { ...face.nose, y: face.nose.y + dy };
  if (face.brows?.y !== undefined) face.brows = { ...face.brows, y: face.brows.y + dy };
  return { ...bp, parts, face };
}

/**
 * 설계도를 손본다. 돌려주는 설계도는 새 객체 (원본은 그대로).
 * 1. 발(가장 낮은 부품)이 바닥 y=0 에 닿게 전체를 옮긴다 (3% 넘게 떠 있거나 묻혀 있을 때)
 * 2. 왼쪽만 있는 다리, 팔, 귀, 날개는 거울로 오른쪽을 채운다 (오른쪽만 있어도 같다)
 * 3. 다른 어떤 부품과도 닿지 않는 부품은 가장 가까운 부품 쪽으로 당겨 겹치게 한다 (허공에 뜬 조각)
 */
export function repairBlueprint(bp: Blueprint): { bp: Blueprint; fixes: string[] } {
  const fixes: string[] = [];
  let out: Blueprint = { ...bp, parts: bp.parts.map((p) => ({ ...p })) };

  // 2. 짝 채우기
  for (const [l, r] of PAIRS) {
    const left = out.parts.filter((p) => p.slot === l);
    const right = out.parts.filter((p) => p.slot === r);
    const mirroredAlready = [...left, ...right].some((p) => p.mirror);
    if (mirroredAlready || left.length > 0 === right.length > 0) continue;
    const only = left.length ? left : right;
    for (const p of only) p.mirror = true;
    fixes.push(`mirror ${only[0]?.slot}`);
  }

  // 3. 뜬 부품 붙이기 (거울, 안쪽 색을 펼친 목록으로 닿는지 보고, 원본 부품을 옮긴다)
  const all = expandParts(out.parts);
  const touching = (a: Part, b: Part) => {
    const ca = centerOf(a);
    const cb = centerOf(b);
    return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) <= radiusOf(a) + radiusOf(b);
  };
  out.parts = out.parts.map((p) => {
    if (p.shape === 'tube' || p.slot === 'body') return p;
    // 펼친 목록에서 자기 자신(과 자기 거울)은 뺀다
    const self = (o: Part) =>
      o.color === p.color &&
      o.shape === p.shape &&
      o.at[1] === p.at[1] &&
      o.at[2] === p.at[2] &&
      Math.abs(o.at[0]) === Math.abs(p.at[0]);
    const others = all.filter((o) => !self(o));
    if (others.some((o) => touching(p, o))) return p;
    // 가장 가까운 부품(몸이나 머리를 먼저)으로 당긴다
    const anchors = all.filter((o) => o.slot === 'body' || o.slot === 'head');
    const pool = anchors.length ? anchors : others;
    let best: Part | undefined;
    let bestD = Infinity;
    for (const o of pool) {
      const c = centerOf(o);
      const d = Math.hypot(c[0] - p.at[0], c[1] - p.at[1], c[2] - p.at[2]);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best || bestD <= 0) return p;
    const c = centerOf(best);
    const want = Math.max(0.01, radiusOf(p) + radiusOf(best) - Math.min(radiusOf(p), 0.03));
    if (bestD <= want) return p;
    const k = want / bestD;
    const at: Vec3 = [c[0] + (p.at[0] - c[0]) * k, c[1] + (p.at[1] - c[1]) * k, c[2] + (p.at[2] - c[2]) * k];
    fixes.push(`attach ${p.slot}`);
    return { ...p, at: at.map((v) => Math.round(v * 1000) / 1000) as Vec3 };
  });

  // 1. 바닥
  let low = Infinity;
  for (const p of expandParts(out.parts)) low = Math.min(low, partBox(p).min[1]);
  if (Number.isFinite(low) && Math.abs(low) > 0.03) {
    out = shiftY(out, -low);
    out.parts = out.parts.map((p) => ({
      ...p,
      at: p.at.map((v) => Math.round(v * 1000) / 1000) as Vec3,
    }));
    out.face = {
      ...out.face,
      eyeY: Math.round(out.face.eyeY * 1000) / 1000,
      mouthY: Math.round(out.face.mouthY * 1000) / 1000,
    };
    fixes.push(`ground ${low > 0 ? '-' : '+'}${Math.abs(low).toFixed(2)}`);
  }
  return { bp: out, fixes };
}

/** 머리와 몸 크기 비율 (머리가 없으면 undefined). 요청문의 귀여운 비율(1~1.2)을 지켰는지 볼 때 */
export function headRatio(bp: Pick<Blueprint, 'parts'>): number | undefined {
  const widest = (slot: Slot) =>
    bp.parts.filter((p) => p.slot === slot).reduce((m, p) => Math.max(m, p.size[0]), 0);
  const head = widest('head');
  const body = widest('body');
  return head > 0 && body > 0 ? head / body : undefined;
}
