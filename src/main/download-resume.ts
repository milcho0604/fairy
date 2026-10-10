// 큰 파일(몇 GB) 이어 받기의 순수 계산 (download.ts 가 쓴다, download-resume.test.ts).
// 멈추거나 끊겨도 .part 를 남겨 다음에 Range 로 그 뒤부터 받는다. 서버가 이어 받기를 안 받아 주면 처음부터

/** 이어 받을 시작 바이트. 받다 만 .part 가 있고 전체보다 작을 때만, 아니면 0 (처음부터) */
export function rangeFrom(partSize: number, total: number): number {
  return Number.isFinite(partSize) && partSize > 0 && partSize < total ? Math.floor(partSize) : 0;
}

/**
 * 서버 답이 이어 받기를 받아 줬는지: 206 이고 Content-Range 시작이 우리가 부탁한 자리와 같을 때만.
 * 200 이면 처음부터 다 보내는 것이라 .part 를 새로 쓴다
 */
export function resumeAccepted(
  status: number,
  contentRange: string | null | undefined,
  from: number,
): boolean {
  if (from <= 0 || status !== 206) return false;
  const m = /^bytes\s+(\d+)-\d*\/(\d+|\*)$/i.exec((contentRange ?? '').trim());
  return !!m && Number(m[1]) === from;
}
