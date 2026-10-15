// 숨바꼭질 (v2 미니 게임): 펫이 화면 가장자리에 몸을 반쯤 숨긴다. 30초 안에 눌러서 찾으면 코인.
import { HIDE_SEEK_COIN } from './coin-rules.ts';
import type { Rect } from './geometry.ts';

export const HIDE_SEEK = {
  seconds: 30,
  coins: HIDE_SEEK_COIN.coins,
  /** 하루에 코인을 받는 판 수 */
  dailyLimit: HIDE_SEEK_COIN.dailyLimit,
  /** 화면 밖으로 숨기는 몸 비율 (나머지가 빼꼼 보인다) */
  hiddenRatio: 0.6,
} as const;

export type Side = 'left' | 'right' | 'bottom';

/** 숨을 자리: 아무 모니터의 왼쪽, 오른쪽, 아래 가장자리에서 빼꼼. 지금 자리와 멀수록 좋다 */
export function pickHideSpot(
  pet: Rect,
  areas: readonly Rect[],
  rand: () => number,
): { x: number; y: number; side: Side } | undefined {
  if (areas.length === 0) return undefined;
  const area = areas[Math.floor(rand() * areas.length)] ?? areas[0];
  if (!area) return undefined;
  const sides: Side[] = ['left', 'right', 'bottom'];
  const side = sides[Math.floor(rand() * sides.length)] ?? 'bottom';
  const hide = Math.round(pet.width * HIDE_SEEK.hiddenRatio);
  const along = (len: number, size: number) =>
    Math.round(size * 0.2 + rand() * Math.max(0, len - size * 1.4));
  if (side === 'left') return { side, x: area.x - hide, y: area.y + along(area.height, pet.height) };
  if (side === 'right')
    return { side, x: area.x + area.width - pet.width + hide, y: area.y + along(area.height, pet.height) };
  return { side, x: area.x + along(area.width, pet.width), y: area.y + area.height - pet.height + hide };
}
