/** 파일 크기를 사람이 읽는 글로: 1GB 넘으면 소수 둘째 자리 GB, 아니면 MB (적어도 1MB) */
export const formatBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}GB` : `${Math.max(1, Math.round(n / 1e6))}MB`;
