// 설정 찾기 (사용자 편의 점검 2026-10-10). 설정 창이 길어서(칸 열몇 개) 찾는 말로 칸과 줄을 걸러 보인다.
// 비교는 메모 찾기와 같다: 대소문자 무시, 풀린 한글 합치기, 조합 중인 마지막 글자는 넓게.
import { noteQuery } from './note-store.ts';

/** 칸 하나: 제목과 그 안의 줄들(이름, 풀이 글 전부) */
export interface SearchSection {
  title: string;
  rows: readonly string[];
}

/** 칸마다 보일지, 그 안의 줄마다 보일지 */
export interface SearchResult {
  show: boolean;
  rows: boolean[];
}

/**
 * 찾는 말이 비었으면 모두 보인다. 칸 제목에 맞으면 그 칸 전부, 아니면 맞는 줄만 (맞는 줄이 없으면 칸을 숨긴다).
 * 띄어 쓴 말은 낱말마다 따로 찾아 모두 있어야 맞는다 ("펫 크기" → "크기" 줄이 "펫" 칸에 있으면 맞음).
 */
export function searchSettings(
  sections: readonly SearchSection[],
  query: string,
  composing = false,
): SearchResult[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections.map((s) => ({ show: true, rows: s.rows.map(() => true) }));
  // 마지막 낱말만 조합 중일 수 있다
  const res = words.map((w, i) => noteQuery(w, composing && i === words.length - 1) as RegExp);
  const fold = (s: string) => s.normalize('NFC').toLowerCase();
  return sections.map((s) => {
    const title = fold(s.title);
    const rowTexts = s.rows.map(fold);
    // 낱말마다: 제목이나 그 줄에 있으면 된다
    const rowHit = rowTexts.map((row) => res.every((re) => re.test(title) || re.test(row)));
    const titleHit = res.every((re) => re.test(title));
    if (titleHit) return { show: true, rows: s.rows.map(() => true) };
    return { show: rowHit.some(Boolean), rows: rowHit };
  });
}

/** 칸 안 한 줄의 모양: 풀이 글(small), 단추 줄(action), 그 밖 */
export type RowKind = 'small' | 'action' | 'other';

/**
 * 줄을 묶는다 (같이 보이고 같이 숨는다). 풀이 글은 앞 줄에 붙고(맨 앞이면 혼자 시작),
 * 풀이 글 바로 뒤 단추 줄은 그 글에 붙는다 (백업 칸: 풀이, 단추, 풀이, 단추). 돌려주는 값은 줄마다 묶음 번호
 */
export function groupRows(kinds: readonly RowKind[]): number[] {
  const out: number[] = [];
  let group = -1;
  kinds.forEach((kind, i) => {
    const prev = kinds[i - 1];
    const join = group >= 0 && (kind === 'small' || (kind === 'action' && prev === 'small'));
    if (!join) group++;
    out.push(group);
  });
  return out;
}
