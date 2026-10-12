// 긴 목록 나눠 그리기 (버그잡이 4). 메모 5천 개, 할 일 천 개를 한 번에 그리면 패널이 몇 초 멈췄다.
// 앞에서부터 LIST_PAGE 개씩 그리고 끝에 "더 보기" 단추를 둔다. 찾기는 메인이 전체에서 하므로 그대로 된다.

/** 한 번에 더 그리는 수 */
export const LIST_PAGE = 100;

/** pages 쪽까지 보일 것과 남은 수 */
export function pageOf<T>(list: readonly T[], pages: number): { shown: T[]; rest: number } {
  const n = Math.max(1, Math.floor(pages)) * LIST_PAGE;
  return { shown: list.slice(0, n), rest: Math.max(0, list.length - n) };
}
