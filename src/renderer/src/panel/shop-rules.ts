// 상점 화면 규칙 (순수 함수): 한 번 더 누르기 확인, 모자란 코인, 배부름 안내.

/** 이 값 이상이면 되돌릴 수 없는 큰 구매라 한 번 더 눌러야 산다 */
export const CONFIRM_FROM = 100;

export const needsConfirm = (cost: number): boolean => cost >= CONFIRM_FROM;

/** 모자란 코인 수. 살 수 있으면 0 */
export const coinsShort = (balance: number, cost: number): number => Math.max(0, Math.ceil(cost - balance));

/** 배가 이 값 이상이면 먹이를 받지 않는다 (todo-store feed 와 같은 선) */
const FULL_AT = 99.5;

export type FeedHint = { kind: 'full' } | { kind: 'part'; room: number } | undefined;

/** 먹이를 주기 전 안내: 꽉 참, 일부만 참(room 만큼), 아무 문제 없음 */
export function feedHint(fullness: number, gain: number): FeedHint {
  if (fullness >= FULL_AT) return { kind: 'full' };
  const room = Math.max(1, Math.round(100 - fullness));
  return gain > room ? { kind: 'part', room } : undefined;
}
