// 달력 칸처럼 줄지은 단추의 화살표 이동 (roving tabindex). 탭 정지는 한 칸이고 나머지는 화살표로 간다.

/** 7칸 한 줄로 놓인 칸에서 key 가 가는 칸의 번호. 갈 수 없으면(끝, 빈 칸 너머) 제자리. ok[i] 는 그 칸에 설 수 있는지 */
export function moveCell(ok: readonly boolean[], from: number, key: string, cols = 7): number {
  const step = (delta: number): number => {
    for (let i = from + delta; i >= 0 && i < ok.length; i += delta) if (ok[i]) return i;
    return from;
  };
  const rowStart = from - (from % cols);
  const edge = (cells: number[]): number => cells.find((i) => ok[i]) ?? from;
  const row = Array.from({ length: cols }, (_, k) => rowStart + k).filter((i) => i < ok.length);
  switch (key) {
    case 'ArrowLeft':
      return step(-1);
    case 'ArrowRight':
      return step(1);
    case 'ArrowUp': {
      const i = from - cols;
      return i >= 0 && ok[i] ? i : from;
    }
    case 'ArrowDown': {
      const i = from + cols;
      return i < ok.length && ok[i] ? i : from;
    }
    case 'Home':
      return edge(row);
    case 'End':
      return edge([...row].reverse());
    default:
      return from;
  }
}

/** 탭 정지가 될 칸: 고른 칸, 아니면 오늘, 아니면 서 있을 수 있는 마지막 칸(가장 최근 날), 없으면 -1 */
export function stopCell(ok: readonly boolean[], preferred: readonly number[]): number {
  for (const i of preferred) if (i >= 0 && ok[i]) return i;
  return ok.lastIndexOf(true);
}
