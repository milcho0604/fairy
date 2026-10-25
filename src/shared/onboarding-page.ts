/** 첫 안내의 쪽 수. 저장 값 검사와 화면의 쪽 넘기기가 같은 범위를 쓴다. */
export const ONBOARD_PAGES = 4;

export function isOnboardPage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < ONBOARD_PAGES;
}
