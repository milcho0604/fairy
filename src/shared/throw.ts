// 던지기 (v1): 펫을 휙 놓으면 날아가다 떨어져 튕긴다. 작업 영역(메뉴 막대, 작업 표시줄 뺀 곳) 바닥이 땅이다.
import type { Rect } from './geometry.ts';

/** 이보다 빠르게 놓아야 던진 것으로 본다 (px/초) */
export const THROW_MIN_SPEED = 900;
export const THROW_MAX_SPEED = 4000;
export const GRAVITY = 2600;
/** 아무리 튕겨도 이 시간이 지나면 멈춘다 */
export const FLIGHT_MAX_MS = 6000;
const FLOOR_BOUNCE = 0.45;
const WALL_BOUNCE = 0.55;
const FLOOR_FRICTION = 0.85;
const STOP_VY = 140;
const STOP_VX = 20;

/** 놓기 직전 100ms 의 커서 움직임으로 속도를 낸다. 표본이 모자라거나 멈췄다 놓았으면 undefined */
export function releaseVelocity(
  samples: readonly { t: number; x: number; y: number }[],
  now: number,
): { vx: number; vy: number } | undefined {
  const recent = samples.filter((s) => now - s.t <= 100);
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.t - first.t < 16) return undefined;
  // 마지막 표본이 오래전이면(멈췄다 놓음) 던진 게 아니다
  if (now - last.t > 50) return undefined;
  const dt = (last.t - first.t) / 1000;
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 한 걸음 뒤 벽, 바닥, 천장에 부딪히면 튕긴다. 옆에 맞붙은 모니터가 있고 펫 높이가 들어가면 벽이 아니다.
 * rest 는 바닥에 멈춰 섰는지.
 */
export function bounce(
  b: Body,
  w: number,
  h: number,
  area: Rect,
  areas: readonly Rect[],
): Body & { rest: boolean } {
  let { x, y, vx, vy } = b;
  const floor = area.y + area.height - h;
  let onFloor = false;
  if (y >= floor) {
    y = floor;
    vy = Math.abs(vy) < STOP_VY ? 0 : -Math.abs(vy) * FLOOR_BOUNCE;
    vx *= FLOOR_FRICTION;
    onFloor = vy === 0;
  }
  if (y < area.y) {
    y = area.y;
    vy = Math.abs(vy) * 0.3;
  }
  const fits = (o: Rect) => y >= o.y && y + h <= o.y + o.height;
  const near = (a: number, c: number) => Math.abs(a - c) <= 2;
  const left = area.x;
  const right = area.x + area.width - w;
  if (x < left && !areas.some((o) => o !== area && near(o.x + o.width, area.x) && fits(o))) {
    x = left;
    vx = Math.abs(vx) * WALL_BOUNCE;
  }
  if (x > right && !areas.some((o) => o !== area && near(o.x, area.x + area.width) && fits(o))) {
    x = right;
    vx = -Math.abs(vx) * WALL_BOUNCE;
  }
  const rest = onFloor && Math.abs(vx) < STOP_VX;
  return { x, y, vx: rest ? 0 : vx, vy, rest };
}

/**
 * 한 걸음 튕기기 전후 속도로 바닥, 벽에 부딪혔는지 (펫 화면이 그쪽으로 잠깐 눌렸다 돌아온다, renderer photo-motion.ts).
 * 바닥은 아래로 빨리 가다 튀어 오르거나 멈춘 것, 벽은 옆으로 빨리 가다 거꾸로 간 것. 세기 k 는 0~1
 */
export function bounceHit(
  before: { vx: number; vy: number },
  after: { vx: number; vy: number },
): { axis: 'x' | 'y'; k: number } | undefined {
  if (before.vy > 250 && after.vy <= 0) return { axis: 'y', k: Math.min(1, before.vy / 1800) };
  if (Math.abs(before.vx) > 250 && Math.sign(after.vx) === -Math.sign(before.vx))
    return { axis: 'x', k: Math.min(1, Math.abs(before.vx) / 2200) };
  return undefined;
}
