// GFM 표를 줄에서 읽어 낸다. 글자만 돌려주고 HTML 은 만들지 않는다(그리는 쪽이 React 글자 칸으로만 넣는다)

export type MdTable = {
  head: string[];
  align: ('left' | 'center' | 'right' | undefined)[];
  rows: string[][];
  /** 표가 차지한 줄 수 */
  length: number;
};

/** `| a | b |` 한 줄을 칸으로. 바깥 파이프는 빼고 `\|` 는 글자 파이프로 */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** lines[at] 에서 표가 시작하면 읽어 돌려주고 아니면 undefined */
export function parseTable(lines: string[], at: number): MdTable | undefined {
  const first = lines[at] ?? '';
  const delim = lines[at + 1] ?? '';
  if (!first.includes('|') || !delim.includes('-') || !DELIM.test(delim)) return undefined;
  const head = splitRow(first);
  const marks = splitRow(delim);
  if (head.length < 2 || marks.length !== head.length) return undefined;
  const align = marks.map((m) => {
    const l = m.startsWith(':');
    const r = m.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : undefined;
  });
  const rows: string[][] = [];
  let n = at + 2;
  while (n < lines.length && (lines[n] ?? '').trim() !== '' && (lines[n] ?? '').includes('|')) {
    const cells = splitRow(lines[n] ?? '');
    // 칸 수는 머리에 맞춘다(모자라면 빈 칸, 남으면 버림)
    rows.push(head.map((_, j) => cells[j] ?? ''));
    n++;
  }
  return { head, align, rows, length: n - at };
}
