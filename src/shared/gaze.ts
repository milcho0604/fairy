// 커서 바라보기. 한가할 때 커서가 가까이 오면 펫이 그쪽을 본다.
// 방향은 몇 칸으로만 나눈다 (가로 5칸, 세로 3칸). 칸이 바뀔 때만 화면에 알리고 다시 그린다 (L10: 계속 그리면 CPU 를 먹는다).
import type { Rect } from './geometry.ts';

export interface Gaze {
  /** -1(왼쪽) ~ 1(오른쪽), 0.5 단위 */
  x: number;
  /** -1(위) ~ 1(아래), 1 단위 */
  y: number;
}

/** 메인이 커서를 보는 간격 */
export const GAZE_POLL_MS = 250;

/**
 * 커서 쪽 방향 칸. 멀리 있거나(펫 크기의 3배, 적어도 320px) 펫 위에 있으면 null (앞을 본다).
 * 머리는 펫 사각형 위쪽 45% 높이로 본다.
 */
export function gazeAt(pet: Rect, cursor: { x: number; y: number }): Gaze | null {
  if (cursor.x >= pet.x && cursor.x < pet.x + pet.width && cursor.y >= pet.y && cursor.y < pet.y + pet.height)
    return null;
  const cx = pet.x + pet.width / 2;
  const cy = pet.y + pet.height * 0.45;
  const dx = cursor.x - cx;
  const dy = cursor.y - cy;
  const radius = Math.max(320, pet.width * 3);
  if (Math.hypot(dx, dy) > radius) return null;
  const clamp = (v: number, n: number) => Math.max(-n, Math.min(n, Math.round(v)));
  // 0 을 -0 으로 남기지 않게 + 0
  return {
    x: clamp(dx / (pet.width * 0.5), 2) / 2 + 0,
    y: clamp(dy / (pet.height * 0.6), 1) + 0,
  };
}

/** 칸이 같은지 (같으면 보내지 않는다) */
export function sameGaze(a: Gaze | null, b: Gaze | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}
