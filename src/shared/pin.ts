// 고정(핀): 메모, 할 일, 일정을 그 목록 맨 위에 둔다 (13판 칸 pinned_at, 2026-10-12).
// 고정한 것은 고정한 순서대로(먼저 고정한 것이 위), 나머지는 받은 순서(목록의 원래 정렬) 그대로.
// 고정은 화면 순서만 바꾼다: 고친 시각, 알림, 구글 캘린더 보내기, 내보내기에는 들어가지 않는다.

/** 고정할 수 있는 것 */
export type PinKind = 'todo' | 'note' | 'event';
export const PIN_KINDS: readonly PinKind[] = ['todo', 'note', 'event'];
export const isPinKind = (v: unknown): v is PinKind => v === 'todo' || v === 'note' || v === 'event';

/** 저장 파일의 pinned_at 값을 읽는다. 양의 유한한 수(고정한 시각 ms)만 고정이고, 없거나 깨진 값(글, 0, 음수, NaN)은 고정 안 됨 */
export function pinAt(v: unknown): number | null {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** 고정한 것을 맨 위로 (고정한 순서, 같은 시각이면 받은 순서). 나머지는 받은 순서 그대로. 새 배열을 돌려준다 */
export function pinFirst<T extends { pinnedAt: number | null }>(list: readonly T[]): T[] {
  const pinned: { item: T; i: number; at: number }[] = [];
  const rest: T[] = [];
  list.forEach((item, i) => {
    const at = pinAt(item.pinnedAt);
    if (at === null) rest.push(item);
    else pinned.push({ item, i, at });
  });
  pinned.sort((a, b) => a.at - b.at || a.i - b.i);
  return [...pinned.map((p) => p.item), ...rest];
}
