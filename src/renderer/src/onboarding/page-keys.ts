// 첫 안내를 키보드로 넘기기: ← 이전, → 다음. 이름 칸이나 시간 칸에서는 커서를 옮기는 키라 쓰지 않는다.

interface PageKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

/** 옮겨 갈 쪽 번호. 안 옮기면 undefined */
export function pageByKey(e: PageKey, page: number, total: number, inField: boolean): number | undefined {
  if (inField || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return undefined;
  if (e.key === 'ArrowRight' && page < total - 1) return page + 1;
  if (e.key === 'ArrowLeft' && page > 0) return page - 1;
  return undefined;
}
