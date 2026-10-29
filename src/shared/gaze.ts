// 커서 바라보기. 한가할 때 커서가 가까이 오면 펫이 그쪽을 본다.
// 방향은 몇 칸으로만 나눈다 (가로 5칸, 세로 3칸). 칸이 바뀔 때만 화면에 알리고 다시 그린다 (L10: 계속 그리면 CPU 를 먹는다).
import type { Rect } from './geometry.ts';

export interface Gaze {
  /** -1(왼쪽) ~ 1(오른쪽), 0.5 단위 */
  x: number;
  /** -1(위) ~ 1(아래), 1 단위 */
  y: number;
}

/** 메인이 커서를 보는 간격 (커서가 어느 펫 가까이 있을 때) */
export const GAZE_POLL_MS = 250;
/** 부스트 모드에서 커서가 가까울 때 보는 간격 (칸도 잘게 나눠 부드럽게 따라간다) */
export const GAZE_BOOST_POLL_MS = 100;
/** 커서가 모든 펫에서 멀 때(보는 반경의 두 배 밖) 보는 간격. 다가오는 동안 늦어도 이만큼만 늦게 본다 */
export const GAZE_FAR_POLL_MS = 1500;

/** 커서를 보는 반경: 펫 크기의 3배, 적어도 320px */
const gazeRadius = (pet: Rect) => Math.max(320, pet.width * 3);

/**
 * 커서 쪽 방향 칸. 멀리 있거나(펫 크기의 3배, 적어도 320px) 펫 위에 있으면 null (앞을 본다).
 * 머리는 펫 사각형 위쪽 45% 높이로 본다.
 */
export function gazeAt(pet: Rect, cursor: { x: number; y: number }, fine = false): Gaze | null {
  if (cursor.x >= pet.x && cursor.x < pet.x + pet.width && cursor.y >= pet.y && cursor.y < pet.y + pet.height)
    return null;
  const cx = pet.x + pet.width / 2;
  const cy = pet.y + pet.height * 0.45;
  const dx = cursor.x - cx;
  const dy = cursor.y - cy;
  const radius = gazeRadius(pet);
  if (Math.hypot(dx, dy) > radius) return null;
  const clamp = (v: number, n: number) => Math.max(-n, Math.min(n, Math.round(v)));
  // 부스트 모드(fine)면 칸을 두 배로 잘게: 가로 0.25, 세로 0.5 단위. 커서를 더 부드럽게 따라간다
  const k = fine ? 2 : 1;
  // 0 을 -0 으로 남기지 않게 + 0
  return {
    x: clamp((dx / (pet.width * 0.5)) * k, 2 * k) / (2 * k) + 0,
    y: clamp((dy / (pet.height * 0.6)) * k, k) / k + 0,
  };
}

/** 칸이 같은지 (같으면 보내지 않는다) */
export function sameGaze(a: Gaze | null, b: Gaze | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}

/**
 * 다음에 커서를 볼 때까지 (ms). 어느 펫이든 보는 반경의 두 배 안에 커서가 있으면 촘촘히, 다 멀면 느슨히.
 * 커서 보기는 펫 창마다 4번/초 깨어나 친구 셋이면 쉬는 CPU 의 0.26% 였다 (2026-10-07 측정)
 */
export function gazePollMs(pets: Rect[], cursor: { x: number; y: number }, boost = false): number {
  const near = pets.some((pet) => {
    const dx = cursor.x - (pet.x + pet.width / 2);
    const dy = cursor.y - (pet.y + pet.height * 0.45);
    return Math.hypot(dx, dy) <= gazeRadius(pet) * 2;
  });
  return near ? (boost ? GAZE_BOOST_POLL_MS : GAZE_POLL_MS) : GAZE_FAR_POLL_MS;
}
