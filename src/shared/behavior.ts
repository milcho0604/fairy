// 펫 기본 행동(P1-06). 가만히 있다가 가끔 움직인다(L10: 계속 움직이면 fps 와 상관없이 CPU 를 먹는다).
import type { Rect } from './geometry.ts';

export type Activity =
  | { type: 'walk'; dx: number; ms: number }
  | { type: 'sit'; ms: number }
  | { type: 'look'; dir: -1 | 1; ms: number }
  // v1 추가 행동
  | { type: 'yawn'; ms: number }
  | { type: 'stretch'; ms: number };

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
 * 걸어갈 수 있는 가로 범위. 지금 모니터에 옆 모니터가 맞붙어 있고 펫 높이가 들어가면 그쪽까지 (v1 멀티 모니터 걷기).
 * 한 번에 한 모니터만 넘는다.
 */
export function walkSpan(
  pet: Rect,
  area: Rect,
  areas: readonly Rect[] = [],
): { left: number; right: number } {
  const fits = (o: Rect) => pet.y >= o.y && pet.y + pet.height <= o.y + o.height;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const leftN = areas.find((o) => o !== area && near(o.x + o.width, area.x) && fits(o));
  const rightN = areas.find((o) => o !== area && near(o.x, area.x + area.width) && fits(o));
  return { left: leftN ? leftN.x : area.x, right: rightN ? rightN.x + rightN.width : area.x + area.width };
}

/**
 * 다음 행동을 고른다. 걷기 45%, 앉기 25%, 두리번 15%, 하품 8%, 기지개 7%.
 * 걷기는 지금 모니터(맞붙은 옆 모니터까지) 안에서만. 한쪽 끝에 붙어 있으면 반대쪽으로 간다.
 */
export function pickActivity(pet: Rect, area: Rect, rand: Random, areas: readonly Rect[] = []): Activity {
  const r = rand();
  if (r < 0.45) {
    const span = walkSpan(pet, area, areas);
    const room = { left: pet.x - span.left, right: span.right - (pet.x + pet.width) };
    let dir: -1 | 1 = rand() < 0.5 ? -1 : 1;
    if ((dir < 0 ? room.left : room.right) < WALK_MIN) dir = dir < 0 ? 1 : -1;
    const room2 = dir < 0 ? room.left : room.right;
    const want = WALK_MIN + (WALK_MAX - WALK_MIN) * rand();
    const dist = Math.floor(Math.min(want, room2));
    if (dist >= WALK_MIN / 2)
      return { type: 'walk', dx: dir * dist, ms: Math.round((dist / WALK_SPEED) * 1000) };
  }
  if (r < 0.7) return { type: 'sit', ms: Math.round(10_000 + 15_000 * rand()) };
  if (r < 0.85) return { type: 'look', dir: rand() < 0.5 ? -1 : 1, ms: 1800 };
  if (r < 0.93) return { type: 'yawn', ms: 2200 };
  return { type: 'stretch', ms: 2600 };
}

/** 걷는 중 t(0~1) 일 때 이동량. 시작과 끝을 부드럽게. */
export function walkOffset(dx: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return Math.round(dx * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
}
