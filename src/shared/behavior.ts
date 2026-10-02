// 펫 기본 행동(P1-06). 가만히 있다가 가끔 움직인다(L10: 계속 움직이면 fps 와 상관없이 CPU 를 먹는다).
import type { Rect } from './geometry.ts';

export type Activity =
  | { type: 'walk'; dx: number; ms: number }
  | { type: 'sit'; ms: number }
  | { type: 'look'; dir: -1 | 1; ms: number };

/** 다음 행동까지 기다리는 시간 (ms) */
export const NEXT_MIN_MS = 25_000;
export const NEXT_MAX_MS = 70_000;
/** 걷는 속도 (px/초). 느긋하게. */
export const WALK_SPEED = 40;
const WALK_MIN = 40;
const WALK_MAX = 160;

/** 0~1 난수. 시험에서 바꿔 끼운다. */
export type Random = () => number;

export function nextDelay(rand: Random): number {
  return Math.round(NEXT_MIN_MS + (NEXT_MAX_MS - NEXT_MIN_MS) * rand());
}

/**
 * 다음 행동을 고른다. 걷기 45%, 앉기 30%, 두리번 25%.
 * 걷기는 지금 모니터 작업 영역 안에서만. 한쪽 끝에 붙어 있으면 반대쪽으로 간다.
 */
export function pickActivity(pet: Rect, area: Rect, rand: Random): Activity {
  const r = rand();
  if (r < 0.45) {
    const room = { left: pet.x - area.x, right: area.x + area.width - (pet.x + pet.width) };
    let dir: -1 | 1 = rand() < 0.5 ? -1 : 1;
    if ((dir < 0 ? room.left : room.right) < WALK_MIN) dir = dir < 0 ? 1 : -1;
    const room2 = dir < 0 ? room.left : room.right;
    const want = WALK_MIN + (WALK_MAX - WALK_MIN) * rand();
    const dist = Math.floor(Math.min(want, room2));
    if (dist >= WALK_MIN / 2)
      return { type: 'walk', dx: dir * dist, ms: Math.round((dist / WALK_SPEED) * 1000) };
  }
  if (r < 0.75) return { type: 'sit', ms: Math.round(10_000 + 15_000 * rand()) };
  return { type: 'look', dir: rand() < 0.5 ? -1 : 1, ms: 1800 };
}

/** 걷는 중 t(0~1) 일 때 이동량. 시작과 끝을 부드럽게. */
export function walkOffset(dx: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return Math.round(dx * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
}
