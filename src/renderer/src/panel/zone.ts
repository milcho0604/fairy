// 본문 칸 폭의 구간. 작은 패널은 "좁음", 560 까지 넓혀도 "보통", 큰 창은 "넓음"까지 간다 (큰 창 설계 #159).
// CSS 는 같은 값을 컨테이너 쿼리로 쓴다 (panel.css 의 .panel-tabpanel container-type). 값을 바꾸면 둘을 같이 바꾼다.

export type Zone = 'narrow' | 'medium' | 'wide';

/** 이 폭(CSS px) 아래가 좁음 */
export const MEDIUM_MIN = 520;
/** 이 폭 이상이 넓음 */
export const WIDE_MIN = 860;

/** 본문 칸 폭으로 구간을 가른다. 숫자가 아니거나 0 이하면 좁음 */
export function zoneOf(width: number): Zone {
  if (!(width > 0)) return 'narrow';
  if (width >= WIDE_MIN) return 'wide';
  if (width >= MEDIUM_MIN) return 'medium';
  return 'narrow';
}
