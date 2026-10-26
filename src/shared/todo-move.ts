// 할 일 줄 순서 바꾸기 (#146): 화면에 보이는 목록에서 어디에 놓을지 정한다. 저장은 TodoStore.place (id, 기준 줄, 뒤인가).
// 고정한 할 일은 늘 맨 위라 순서 바꾸기에서 빠진다 (고정을 풀어야 한다)

export type MoveDir = 'top' | 'up' | 'down' | 'bottom';

interface Row {
  id: number;
  pinnedAt: number | null;
}

export interface Place {
  /** 이 줄의 */
  target: number;
  /** 뒤(true)나 앞(false)에 놓는다 */
  after: boolean;
}

/** 보이는 목록(고정한 것이 맨 위)에서 id 를 dir 쪽으로 옮길 자리. 고정한 줄이거나 이미 그 끝이면 undefined */
export function moveTarget(list: readonly Row[], id: number, dir: MoveDir): Place | undefined {
  const free = list.filter((x) => x.pinnedAt === null);
  const i = free.findIndex((x) => x.id === id);
  const first = free[0];
  const last = free.at(-1);
  if (i < 0 || !first || !last) return undefined;
  if (dir === 'top') return i === 0 ? undefined : { target: first.id, after: false };
  if (dir === 'bottom') return i === free.length - 1 ? undefined : { target: last.id, after: true };
  const near = free[dir === 'up' ? i - 1 : i + 1];
  return near ? { target: near.id, after: dir === 'down' } : undefined;
}

/** 줄을 끌어 다른 줄 위에 놓았다: 위에서 끌어 내렸으면 그 줄 뒤에, 아래에서 끌어 올렸으면 그 줄 앞에. 고정한 줄이 끼면 undefined */
export function dropPlace(list: readonly Row[], dragId: number, overId: number): Place | undefined {
  const free = list.filter((x) => x.pinnedAt === null);
  const from = free.findIndex((x) => x.id === dragId);
  const to = free.findIndex((x) => x.id === overId);
  if (from < 0 || to < 0 || from === to) return undefined;
  return { target: overId, after: from < to };
}
