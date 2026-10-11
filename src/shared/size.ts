// 펫 크기(배율). 사용자 요청: 설정, Ctrl(Cmd) + 휠, 단축키로 50%~300%.
import type { Rect } from './geometry.ts';

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;
/** 휠 한 칸(또는 단축키 한 번)에 커지는 비율. */
export const SCALE_STEP = 1.1;
/** 마우스 휠 한 칸의 deltaY. 트랙패드는 이보다 잘게 온다. */
const WHEEL_NOTCH = 100;

/** 저장하고 보일 배율: 범위 안, 0.01 단위 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
}

/** 범위만 맞추고 반올림하지 않은 작업 배율. 휠은 이 값을 이어 받아 굴린다 */
export function limitScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 휠을 위로(deltaY 음수) 굴리면 커진다. 트랙패드의 작은 값은 그만큼만 바꾼다.
 * 반올림하지 않는다: 트랙패드는 deltaY 가 1~4 씩 잘게 와서 매번 0.01 로 반올림하면 제자리로 돌아가 크기가 안 바뀐다
 */
export function scaleByWheel(scale: number, deltaY: number): number {
  return limitScale(scale * SCALE_STEP ** (-deltaY / WHEEL_NOTCH));
}

export function scaleByStep(scale: number, steps: number): number {
  return clampScale(scale * SCALE_STEP ** steps);
}

/** 크기를 바꿀 때 펫 발(아래 가운데)이 제자리에 있도록 새 창 위치를 낸다. */
export function resizeFromBottomCenter(bounds: Rect, size: number): Rect {
  const s = Math.round(size);
  return {
    x: Math.round(bounds.x + bounds.width / 2 - s / 2),
    y: bounds.y + bounds.height - s,
    width: s,
    height: s,
  };
}
