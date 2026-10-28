// 사진 모델로 지운 뒤 남은 조각이 많을 때 그림용 모델(isnet-anime)로 한 번 더 지워 볼지, 더 나은 쪽을 고르는 규칙.
// 화면 없이 마스크 배열만 다뤄 시험한다 (cut-retry.test.ts). 기준 값은 사진 10장, 그림 6장 측정에서 정했다 (docs/tests/bg-removal.md).
// 그림용 모델은 사진에 쓰면 통째로 비는 일이 흔해서(사진 10장 중 6장) 늘 쓰지 않고, 조각이 많이 남아 사진 모델이 힘들어 보일 때만 건다.
import { maskBlobs } from './mask.ts';

export interface CutStats {
  /** 남긴 넓이 (사진 넓이 대비 0~1, 알파 128 넘는 칸) */
  kept: number;
  /** 가장 큰 덩어리의 넓이 (사진 대비 0~1) */
  main: number;
  /** 둘째로 큰 덩어리의 넓이 (사진 대비 0~1). 펫 둘이 찍힌 사진에서 한쪽을 지웠는지 본다 */
  second: number;
  /** 눈에 띄는 덩어리 수 (사진 넓이의 0.02% 이상) */
  blobs: number;
  /** 가장 큰 덩어리가 아닌 쪽이 남긴 넓이에서 차지하는 비율 (0~1) */
  stray: number;
  /** 가장 큰 덩어리가 닿은 사진 가장자리 수 (0~4) */
  edges: number;
}

/** 덩어리로 셀 최소 크기 (사진 넓이 대비). 이보다 작은 먼지는 세지 않는다 */
const MIN_BLOB = 0.0002;

export function cutStats(mask: ArrayLike<number>, w: number, h: number): CutStats {
  const n = w * h;
  const { list } = maskBlobs(mask, w, h, 128);
  const total = list.reduce((a, b) => a + b.area, 0);
  let big = list[0];
  for (const b of list) if (!big || b.area > big.area) big = b;
  const main = big?.area ?? 0;
  const bits = big?.edges ?? 0;
  const second = list.reduce((a, b) => (b !== big && b.area > a ? b.area : a), 0);
  return {
    kept: n ? total / n : 0,
    main: n ? main / n : 0,
    second: n ? second / n : 0,
    blobs: list.filter((b) => b.area >= n * MIN_BLOB).length,
    stray: total ? (total - main) / total : 0,
    edges: (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1),
  };
}

/** 이만큼 덩어리가 남았거나, 조각이 남긴 넓이의 이만큼을 차지하면 사진 모델이 바탕을 못 지운 것으로 본다 */
export const RETRY_BLOBS = 6;
export const RETRY_STRAY = 0.3;

export function needsIllustRetry(s: CutStats): boolean {
  return s.blobs >= RETRY_BLOBS || s.stray >= RETRY_STRAY;
}

/**
 * 그림용으로 다시 지운 결과를 쓸지. 아래 하나라도 걸리면 처음 결과를 지킨다:
 * - 거의 비었다 (사진 넓이의 4% 미만): 그림용 모델이 모르는 그림이면 통째로 빈다 (옅은 수채 고서 그림)
 * - 가장 큰 덩어리가 처음의 절반도 안 된다: 몸을 깎았다
 * - 큰 두 덩어리를 합친 넓이가 처음의 60% 도 안 된다: 둘째 펫을 지웠거나 몸을 깎았다 (펫 둘이 찍힌 사진)
 * - 남긴 넓이가 처음의 1.4배를 넘는다: 종이, 카드, 틀을 같이 남긴 것이다
 * - 사진 가장자리 셋 이상에 닿은 덩어리가 새로 생겼다: 틀이나 종이 전체다
 * - 처음보다 조각도 덜하지 않다 (덩어리 수도 비율도 안 줄었다)
 */
export function retryIsBetter(first: CutStats, retry: CutStats): boolean {
  if (retry.kept < 0.04) return false;
  if (retry.main < first.main * 0.5) return false;
  if (retry.main + retry.second < (first.main + first.second) * 0.6) return false;
  if (retry.kept > first.kept * 1.4) return false;
  if (retry.edges >= 3 && first.edges < 3) return false;
  return retry.blobs < first.blobs || retry.stray < first.stray - 0.05;
}
