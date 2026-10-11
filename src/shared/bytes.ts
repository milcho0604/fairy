/**
 * 파일 크기를 사람이 읽는 글로: 1GB 넘으면 소수 둘째 자리 GB, 1MB 넘으면 MB, 그 아래는 KB (적어도 1KB).
 * 안전 복사본, 깨진 설정 파일처럼 작은 것도 저장 공간에 보여서 1MB 로 부풀리지 않는다
 */
export const formatBytes = (n: number): string =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}GB`
    : n >= 1e6
      ? `${Math.round(n / 1e6)}MB`
      : `${Math.max(1, Math.round(n / 1e3))}KB`;
