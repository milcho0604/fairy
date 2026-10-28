// 긴 목록 나눠 그리기 (버그잡이 4). 메모 5천 개, 할 일 천 개를 한 번에 그리면 패널이 몇 초 멈췄다.
// 앞에서부터 LIST_PAGE 개씩 그리고 끝에 "더 보기" 단추를 둔다. 찾기는 메인이 전체에서 하므로 그대로 된다.

/** 한 번에 더 그리는 수 */
export const LIST_PAGE = 100;

/** 0부터 세는 줄을 포함하려면 몇 쪽이 필요한지. 찾지 못했으면 첫 쪽. */
export function pagesForIndex(index: number): number {
  return Math.max(1, Math.ceil((index + 1) / LIST_PAGE));
}

/** pages 쪽까지 보일 것과 남은 수 */
export function pageOf<T>(list: readonly T[], pages: number): { shown: T[]; rest: number } {
  const n = Math.max(1, Math.floor(pages)) * LIST_PAGE;
  return { shown: list.slice(0, n), rest: Math.max(0, list.length - n) };
}

/** 날짜 칸으로 묶은 목록(일정)을 앞에서부터 pages 쪽만큼 자른다. 줄이 하나도 안 남는 칸은 뺀다 */
export function pageGroups<G, T>(
  groups: readonly (readonly [G, readonly T[]])[],
  pages: number,
): { shown: [G, T[]][]; rest: number } {
  let left = Math.max(1, Math.floor(pages)) * LIST_PAGE;
  const shown: [G, T[]][] = [];
  let rest = 0;
  for (const [g, list] of groups) {
    const take = Math.min(left, list.length);
    if (take > 0) shown.push([g, list.slice(0, take)]);
    left -= take;
    rest += list.length - take;
  }
  return { shown, rest };
}

/** 칸으로 묶은 목록을 이어 붙였을 때 pick 이 처음 맞는 줄의 자리(0부터). 없으면 -1 */
export function indexInGroups<G, T>(
  groups: readonly (readonly [G, readonly T[]])[],
  pick: (item: T) => boolean,
): number {
  let at = 0;
  for (const [, list] of groups) {
    const i = list.findIndex(pick);
    if (i >= 0) return at + i;
    at += list.length;
  }
  return -1;
}
