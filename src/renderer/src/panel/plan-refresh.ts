// 아침 계획 시트가 떠 있는 동안 할 일이 바뀌면(빠른 입력, 다른 탭, MCP) 고를 거리를 다시 받는다.
// 예전에는 띄울 때 받은 것 그대로라, 할 일이 없을 때 뜬 시트는 할 일을 넣어도 "아직 할 일이 없어" 였다.

/** 시트를 다시 받을지 가르는 열쇠: 안 끝낸 할 일의 id, 제목, 마감, 중요 */
export function planTodosKey(
  open: readonly { id: number; title: string; due: string | null; important: boolean }[],
): string {
  return open.map((x) => `${x.id}:${x.due ?? ''}:${x.important ? 1 : 0}:${x.title}`).join('\n');
}

/**
 * 다시 받은 고를 거리에 맞춘 고른 것. 사용자가 손대지 않았으면(먼저 골라 둔 그대로) 새로 먼저 골라 둔 것,
 * 손댔으면 고른 것 중 아직 있는 것만 (사라진 할 일은 뺀다)
 */
export function refreshedPicks(
  picks: readonly number[],
  before: { suggested: readonly number[] },
  next: { suggested: readonly number[]; candidates: readonly { id: number }[] },
): number[] {
  const untouched =
    picks.length === before.suggested.length && picks.every((id, i) => before.suggested[i] === id);
  if (untouched) return [...next.suggested];
  const ids = new Set(next.candidates.map((c) => c.id));
  return picks.filter((id) => ids.has(id));
}
