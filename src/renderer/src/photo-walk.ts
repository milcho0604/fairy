// 사진 모습 걷기 그림 넘기기 (이슈 #24). 밀크, 초코의 옆모습 걷기 그림 한 주기(shared/starter-pets.ts)를
// 걸은 걸음 수에 맞춰 고른다. 시간이 아니라 걸음으로 세야 출발, 멈춤, 빨리 걷기에서 발이 미끄러지지 않는다

/** 한 주기(그림 n 장)에 걷는 걸음 수. 네 발 걸음 한 주기는 좌우 두 걸음이다 */
export const WALK_CYCLE_STEPS = 2;

/** 걸은 걸음 수(소수)로 보일 그림 번호 0..n-1. 이상한 값이면 0 */
export function walkFrameIndex(steps: number, n: number): number {
  if (!Number.isFinite(steps) || !Number.isFinite(n) || n < 1) return 0;
  const t = (steps / WALK_CYCLE_STEPS) % 1;
  const k = Math.floor((t < 0 ? t + 1 : t) * n);
  return Math.min(n - 1, Math.max(0, k));
}
