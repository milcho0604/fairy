// 친구 펫끼리 놀기. 기본 펫과 친구 펫이 같은 모니터 바닥 가까이에 있으면 가끔 친구가 다가가 마주 보고 하트를 띄운다.
// 메인은 정해진 때(MEET_EVERY_MS)에 한 번 보고, 조건이 맞으면 친구 하나만 걷게 한다 (단순하게).
import type { Rect } from './geometry.ts';

/** 만나 볼지 보는 간격 */
export const MEET_EVERY_MS = 45_000;
/** 볼 때마다 만날 확률 */
export const MEET_CHANCE = 0.35;
/** 한 번 만나면 이만큼은 쉰다 */
export const MEET_COOLDOWN_MS = 4 * 60_000;
/** 이보다 멀면 (가운데 사이 가로 거리) 만나러 가지 않는다 */
export const MEET_RANGE = 520;
/** 바닥 높이가 이만큼 넘게 다르면(한쪽이 창 위에 앉음) 안 만난다 */
const SAME_FLOOR = 40;

export interface MeetPlan {
  /** 친구가 걸어갈 x (펫 사각형 왼쪽) */
  x: number;
  /** 다 오면 기본 펫이 볼 방향 */
  mainDir: -1 | 1;
  /** 친구가 볼 방향 */
  friendDir: -1 | 1;
}

/**
 * 기본 펫(main) 옆으로 친구(friend)가 갈 자리. 만날 수 없으면 null.
 * 친구가 있던 쪽 옆으로 가되, 그쪽이 화면(area) 밖이면 반대쪽으로
 */
export function meetPlan(main: Rect, friend: Rect, sameDisplay: boolean, area?: Rect): MeetPlan | null {
  if (!sameDisplay) return null;
  if (Math.abs(main.y + main.height - (friend.y + friend.height)) > SAME_FLOOR) return null;
  const mc = main.x + main.width / 2;
  const fc = friend.x + friend.width / 2;
  if (Math.abs(mc - fc) > MEET_RANGE) return null;
  // 두 펫이 살짝 겹칠 만큼 붙어 선다 (펫 그림은 창보다 작다)
  const gap = (main.width + friend.width) * 0.38;
  const at = (left: boolean) => Math.round(left ? mc - gap - friend.width / 2 : mc + gap - friend.width / 2);
  const fits = (x: number) => !area || (x >= area.x && x + friend.width <= area.x + area.width);
  let left = fc <= mc;
  if (!fits(at(left))) left = !left;
  if (!fits(at(left))) return null;
  return { x: at(left), mainDir: left ? -1 : 1, friendDir: left ? 1 : -1 };
}
