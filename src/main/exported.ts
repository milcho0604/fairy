// 방금 내보낸 파일과 폴더 (설정 > 데이터). "폴더 열기" 는 여기 있는 경로만 연다: 화면이 보낸 아무 경로나 열지 않게
const recent: string[] = [];
const KEEP = 20;

export function rememberExport(path: string): void {
  if (!path) return;
  recent.unshift(path);
  recent.length = Math.min(recent.length, KEEP);
}

export const wasExported = (path: unknown): path is string =>
  typeof path === 'string' && recent.includes(path);
