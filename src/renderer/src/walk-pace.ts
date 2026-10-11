// 걸음 박자 (pet.ts). 다리는 시간이 아니라 실제로 간 거리만큼 딛는다: 창이 천천히 출발하고 멈출 때(walkOffset)
// 발도 천천히, 빨리 달리면 보폭과 박자가 같이 커진다. 그리기 없이 숫자만 다뤄 시험한다 (walk-pace.test.ts).
import { WALK_SPEED } from '../../shared/behavior.ts';

/** 보통 걸음(WALK_SPEED)의 한 걸음(발 한 번씩) 시간. 예전 박자 그대로 */
export const STEP_MS = 520;
/** 보통 걸음의 한 걸음 길이 (창 px) */
const BASE_STRIDE = (WALK_SPEED * STEP_MS) / 1000;

/**
 * 빠르기(px/초)에 맞는 한 걸음 길이 (창 px). 빠를수록 보폭도 박자도 같이 커진다 (보폭과 박자가 빠르기의 제곱근씩).
 * 빠르기가 바뀌어도 단계 없이 이어진다
 */
export function strideLen(speed: number): number {
  return BASE_STRIDE * Math.sqrt(Math.max(4, speed) / WALK_SPEED);
}

/** 한 토막 걷기 (메인이 보낸 walk 하나). 이어 받은 걷기는 앞 토막이 간 거리와 걸음 수에서 이어 간다 */
export interface WalkSeg {
  start: number;
  dx: number;
  ms: number;
  /** 같은 빠르기로 가는 걷기 (따라 달리기). 아니면 처음과 끝이 느린 곡선 (behavior.ts walkOffset) */
  linear?: boolean;
  /** 이 토막 전에 걸은 걸음 수 */
  steps0: number;
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** 토막 시작부터 now 까지 간 거리 (창 px, 0 이상) */
export function segDist(seg: Pick<WalkSeg, 'start' | 'dx' | 'ms' | 'linear'>, now: number): number {
  const k = seg.ms > 0 ? Math.min(1, Math.max(0, (now - seg.start) / seg.ms)) : 1;
  return Math.abs(seg.dx) * (seg.linear ? k : ease(k));
}

/** 토막의 평균 빠르기 (px/초) */
export function segSpeed(seg: Pick<WalkSeg, 'dx' | 'ms'>): number {
  return seg.ms > 0 ? (Math.abs(seg.dx) / seg.ms) * 1000 : WALK_SPEED;
}

/** now 까지 걸은 걸음 수 (소수. 소수 부분이 걸음 진행 phase) */
export function stepsAt(seg: WalkSeg, now: number): number {
  return seg.steps0 + segDist(seg, now) / strideLen(segSpeed(seg));
}

/**
 * 같은 쪽으로 이어 받은 걷기: 걸음 수는 이어 가고 거리는 새 토막부터 잰다.
 * 쪽이 바뀌었거나 앞 토막이 없으면 undefined (새로 출발해 돌아선다)
 */
export function continueSeg(prev: WalkSeg | undefined, next: Omit<WalkSeg, 'steps0'>): WalkSeg | undefined {
  if (!prev || Math.sign(prev.dx) !== Math.sign(next.dx) || next.dx === 0) return undefined;
  return { ...next, steps0: stepsAt(prev, next.start) };
}

/**
 * 2D 발 하나가 몸에서 앞뒤로 놓인 자리 (보폭 단위, 앞 +0.25 ~ 뒤 -0.25). 한 걸음(phase 0~1) 동안 발은 반은 들려
 * 앞으로 나가고(swingAt 부터 반 걸음) 반은 바닥을 딛고 뒤로 밀린다. 딛는 동안 몸이 반 보폭을 가니 디딘 발도 몸에 대해
 * 반 보폭을 뒤로 가야 바닥에서 미끄러지지 않는다 (예전 2D 는 두 발이 몸에 붙어 같이 미끄러졌다)
 */
export function footSlide(phase: number, swingAt: number): number {
  const p = (((phase - swingAt) % 1) + 1) % 1;
  if (p < 0.5) return -0.25 + (0.5 * (1 - Math.cos(Math.PI * (p / 0.5)))) / 2;
  return 0.25 - 0.5 * ((p - 0.5) / 0.5);
}
