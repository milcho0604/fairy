// 2.5D 그림 펫 휘기 (pet3d.ts setRelief). 화면 없는 셈만 둔다.

/**
 * 목 줄 짐작: 그림의 불투명도 격자(rows 줄, 0 이 맨 위)에서 위 25%~70% 사이 몸 너비가 가장 잘록한 줄.
 * 머리와 몸이 붙어 잘록한 데가 뚜렷하지 않으면(가장 넓은 줄의 85% 넘게 넓으면) 위에서 45% 줄
 */
export function neckRow(alpha: ArrayLike<number>, cols: number, rows: number): number {
  const width = (r: number) => {
    let n = 0;
    for (let c = 0; c < cols; c++) if ((alpha[r * cols + c] ?? 0) > 0.5) n++;
    return n;
  };
  const from = Math.round(rows * 0.25);
  const to = Math.round(rows * 0.7);
  let best = -1;
  let bestW = Number.POSITIVE_INFINITY;
  let widest = 0;
  for (let r = 0; r < rows; r++) widest = Math.max(widest, width(r));
  for (let r = from; r <= to; r++) {
    const w = width(r);
    if (w > 0 && w < bestW) {
      bestW = w;
      best = r;
    }
  }
  if (best < 0 || bestW > widest * 0.85) return Math.round(rows * 0.45);
  return best;
}
