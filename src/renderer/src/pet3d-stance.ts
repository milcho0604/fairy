// 네 발로 선 입체 펫 (설계도 stance: 'stand', 밀크와 초코). 진짜 네 발 동물처럼 몸통을 눕혀 네 다리로 서고,
// 걸을 때는 옆으로 돌아 네 발을 차례로 딛고, 쉴 때는 앉고, 잘 때는 엎드린다 (pet3d.ts poseStance).
// three 없이 숫자만 다뤄 WebGL 없이 시험한다 (pet3d-stance.test.ts).
//
// 좌표: 몸 옆에서 본 평면 (z 앞, y 위). 다리 마디 각 φ 는 곧장 아래(-y)에서 앞(+z)으로 기운 각 (라디안).
// three 의 x 축 돌림(rotation.x)이 +일 때 아래를 향한 다리는 뒤로 간다: 세상 각 φ = 쉬는 각 - 조상 돌림의 합

import type { LegId } from './pet3d-gait.ts';

export interface Pt {
  y: number;
  z: number;
}

/** 다리 하나를 두 마디로 푼 답. a1 윗마디(엉덩이→무릎) 각, a2 아랫마디(무릎→발) 각, knee 무릎 자리 */
export interface LegSolve {
  a1: number;
  a2: number;
  knee: Pt;
  /** 닿을 수 있었는지 (멀면 쭉 뻗은 채 그쪽을 향한다) */
  reach: boolean;
}

/**
 * 두 마디 다리 풀기 (역운동학). hip 에서 foot 까지 닿게 윗마디 l1, 아랫마디 l2 를 굽힌다.
 * bend 가 +1 이면 무릎이 앞으로(뒷다리의 무릎), -1 이면 뒤로(앞다리의 팔꿈치) 굽는다
 */
export function solveLeg(hip: Pt, foot: Pt, l1: number, l2: number, bend: 1 | -1): LegSolve {
  const dz = foot.z - hip.z;
  const dy = foot.y - hip.y;
  const raw = Math.hypot(dz, dy);
  const lo = Math.abs(l1 - l2) + 1e-4;
  const hi = (l1 + l2) * 0.9999;
  const dist = Math.min(hi, Math.max(lo, raw));
  // 곧장 아래에서 앞으로 기운 각 (거리가 0 이면 아래)
  const toward = raw > 1e-9 ? Math.atan2(dz, -dy) : 0;
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const a1 = toward + bend * alpha;
  const knee = { z: hip.z + l1 * Math.sin(a1), y: hip.y - l1 * Math.cos(a1) };
  // 닿지 못하면 같은 쪽으로 dist 만큼만 간 자리를 발로 본다
  const fz = hip.z + Math.sin(toward) * dist;
  const fy = hip.y - Math.cos(toward) * dist;
  const a2 = Math.atan2(fz - knee.z, -(fy - knee.y));
  return { a1, a2, knee, reach: raw <= l1 + l2 };
}

/** 두 점을 잇는 마디의 각 (곧장 아래에서 앞으로) */
export function segAngle(from: Pt, to: Pt): number {
  return Math.atan2(to.z - from.z, -(to.y - from.y));
}

/** 각에서 다리 끝 자리 (앞으로 푼 셈, 시험용) */
export function legTip(hip: Pt, a1: number, a2: number, l1: number, l2: number): Pt {
  const kz = hip.z + l1 * Math.sin(a1);
  const ky = hip.y - l1 * Math.cos(a1);
  return { z: kz + l2 * Math.sin(a2), y: ky - l2 * Math.cos(a2) };
}

// ---- 걸음 ----

export type GaitKind = 'walk' | 'trot';

/**
 * 발마다 걸음 안에서 내딛는 때 (0~1). 걷기(walk)는 옆 차례 걸음: 왼뒷발, 왼앞발, 오른뒷발, 오른앞발이 1/4 씩.
 * 빠른 걸음(trot)은 대각선 쌍 (왼앞발과 오른뒷발이 같이)
 */
export const FOOTFALL: Record<GaitKind, Record<LegId, number>> = {
  walk: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
  trot: { fl: 0, hr: 0, fr: 0.5, hl: 0.5 },
};

/** 한 걸음 가운데 발이 바닥을 딛고 있는 몫. 걷기는 늘 셋 이상이 바닥에, 빠른 걸음은 반 */
export const DUTY: Record<GaitKind, number> = { walk: 0.64, trot: 0.5 };

/**
 * 한 발의 자리 (몸 기준). u 는 그 발의 걸음 진행 0~1 (0 이 내딛는 순간), stride 는 디딘 발이 몸에 대해 뒤로 밀리는 길이,
 * lift 는 든 발 높이. 딛는 동안(u < duty) 발은 몸이 가는 빠르기 그대로 뒤로 밀려 바닥에서 미끄러지지 않고,
 * 드는 동안 처음과 끝이 느린 곡선으로 앞으로 나간다. dz 는 쉬는 자리에서 앞(+), dy 는 위(+)
 */
export function footCycle(
  u0: number,
  duty: number,
  stride: number,
  lift: number,
): { dz: number; dy: number } {
  const u = ((u0 % 1) + 1) % 1;
  if (u < duty) {
    const s = u / duty;
    return { dz: stride * (0.5 - s), dy: 0 };
  }
  const v = (u - duty) / (1 - duty);
  const ease = (1 - Math.cos(Math.PI * v)) / 2;
  // 발을 들 때 조금 빨리 들고 늦게 내린다 (발끝이 바닥을 긁지 않게)
  const up = Math.sin(Math.PI * v ** 0.8);
  return { dz: stride * (-0.5 + ease), dy: lift * up };
}

/** 발 하나의 걸음 진행 (그 발이 내딛는 때를 0 으로) */
export function footPhase(leg: LegId, phase: number, gait: GaitKind): number {
  return (((phase - FOOTFALL[gait][leg]) % 1) + 1) % 1;
}

/**
 * 몸이 간 거리(펫 몸 단위)로 걸음 진행을 센다. cycle 은 한 걸음(네 발이 한 번씩)에 몸이 가는 거리.
 * 디딘 발이 몸에 대해 밀리는 길이는 duty × cycle 이라 몸이 간 만큼 정확히 뒤로 간다 (미끄러짐 없음)
 */
export function gaitPhase(travel: number, cycle: number): number {
  if (!(cycle > 0) || !Number.isFinite(travel)) return 0;
  return (((travel / cycle) % 1) + 1) % 1;
}

/** 빠르기 배율(보통 걸음 1)에 따른 걸음새와 한 걸음 거리 배율. 빨리 가면 속보로, 보폭도 조금 넓게 */
export function gaitFor(speedK: number): { kind: GaitKind; cycleK: number } {
  const k = Number.isFinite(speedK) && speedK > 0 ? speedK : 1;
  return k > 1.3 ? { kind: 'trot', cycleK: Math.min(1.6, 0.9 + 0.35 * k) } : { kind: 'walk', cycleK: 1 };
}

// ---- 자세 ----

/** 몸 자세: pitch 는 몸통 앞이 들린 각(라디안, 앉으면 +), hip 은 엉덩이 관절 자리 (몸 옆 평면) */
export interface BodyPose {
  pitch: number;
  hip: Pt;
}

/** 쉬는 자세의 몸 치수 (조립할 때 잰다) */
export interface StanceDims {
  /** 뒷다리 엉덩이 관절, 앞다리 어깨 관절 가운데 (선 자세) */
  hip: Pt;
  shoulder: Pt;
  /** 엉덩이 관절에서 몸 아래 끝(엉덩이 바닥)까지 높이 */
  rump: number;
  /** 어깨 관절에서 가슴 아래 끝까지 높이 */
  chest: number;
  /** 앞발이 바닥을 디딜 때 발 가운데 높이와 앞발 자리 */
  pawY: number;
  frontFootZ: number;
  /** 앞다리 길이 (어깨에서 발 가운데까지, 쉬는 자세) */
  frontReach: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 앉은 자세: 엉덩이를 바닥 가까이 내리고 몸통 앞을 들어, 앞다리가 거의 곧게 바닥을 디딜 만큼 어깨가 올라간다.
 * 어깨는 앞발 바로 위 조금 뒤에 온다
 */
export function sitPose(d: StanceDims): BodyPose {
  const vz = d.shoulder.z - d.hip.z;
  const vy = d.shoulder.y - d.hip.y;
  const len = Math.hypot(vz, vy);
  // 엉덩이 바닥이 바닥에 살짝 눌릴 높이
  const hipY = Math.max(d.pawY, d.rump * 0.92);
  // 어깨 높이: 앞다리를 거의 쭉 편 높이
  const shoulderY = d.pawY + d.frontReach * 0.97;
  const rise = clamp((shoulderY - hipY) / Math.max(1e-6, len), -1, 1);
  const base = Math.atan2(vy, vz);
  const pitch = clamp(Math.asin(rise) - base, 0.25, 1.05);
  const rz = vz * Math.cos(pitch) - vy * Math.sin(pitch);
  return { pitch, hip: { y: hipY, z: d.frontFootZ - 0.02 - rz } };
}

/** 엎드린 자세: 몸을 바닥까지 내리고(배와 가슴이 바닥에 닿게) 거의 수평 */
export function liePose(d: StanceDims): BodyPose {
  const down = Math.min(d.hip.y - d.rump * 0.95, d.shoulder.y - d.chest * 0.95);
  return { pitch: 0.04, hip: { y: d.hip.y - Math.max(0, down), z: d.hip.z + 0.01 } };
}

/** 자세 무게 (선 자세는 나머지). sit, lie 는 0~1 이고 합이 1 을 넘으면 나눈다 */
export interface Posture {
  sit: number;
  lie: number;
}

/** 세 자세를 무게대로 섞는다 */
export function blendPose(stand: BodyPose, sit: BodyPose, lie: BodyPose, w: Posture): BodyPose {
  let s = clamp(w.sit, 0, 1);
  let l = clamp(w.lie, 0, 1);
  if (s + l > 1) {
    const k = 1 / (s + l);
    s *= k;
    l *= k;
  }
  const st = 1 - s - l;
  return {
    pitch: stand.pitch * st + sit.pitch * s + lie.pitch * l,
    hip: {
      y: stand.hip.y * st + sit.hip.y * s + lie.hip.y * l,
      z: stand.hip.z * st + sit.hip.z * s + lie.hip.z * l,
    },
  };
}

/** 몸 옆 평면의 점 p 를 몸통 관절(pivot) 둘레로 pitch 만큼 앞을 들어 돌린 자리 */
export function pitchAbout(p: Pt, pivot: Pt, pitch: number): Pt {
  const z = p.z - pivot.z;
  const y = p.y - pivot.y;
  return {
    z: pivot.z + z * Math.cos(pitch) - y * Math.sin(pitch),
    y: pivot.y + z * Math.sin(pitch) + y * Math.cos(pitch),
  };
}

// ---- 무슨 자세를 할지 ----

export type StanceGoal = 'stand' | 'sit' | 'lie';

/** 걷고 나서 서 있는 시간 (그 뒤 앉는다) */
export const STAND_AFTER_WALK_MS = 9000;

/**
 * 지금 바라는 자세. 걷기, 신남, 기지개, 점프, 몸 털기, 빙글 춤, 들림은 선다. 잠과 앉기 몸짓은 엎드린다.
 * 기본 상태는 걷고 나서 잠깐 서 있다가 앉는다 (sinceWalk 는 걷기가 끝나고 지난 시간, 모르면 오래 전)
 */
export function stanceGoal(o: {
  mood: string;
  act?: string;
  trick?: string;
  sinceWalk?: number;
  /** 같이 타자 치기, 쪽지 들기, 같이 일하기 (앉아서 앞발을 쓴다) */
  hands?: boolean;
}): StanceGoal {
  if (o.act === 'walk') return 'stand';
  if (o.mood === 'sleeping') return 'lie';
  if (o.mood === 'grabbed' || o.mood === 'excited') return 'stand';
  if (o.trick === 'dance') return 'stand';
  if (o.trick === 'wave' || o.hands) return 'sit';
  if (o.mood === 'sulky') return 'sit';
  if (o.mood !== 'idle' && o.mood !== 'talking') return 'sit';
  if (o.act === 'sit' || o.act === 'roll') return 'lie';
  if (o.act === 'stretch' || o.act === 'hop' || o.act === 'shake' || o.act === 'stomp') return 'stand';
  if (o.act === 'yawn' || o.act === 'nod') return 'sit';
  const since = o.sinceWalk ?? Number.POSITIVE_INFINITY;
  return since < STAND_AFTER_WALK_MS ? 'stand' : 'sit';
}
