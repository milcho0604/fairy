// 빠른 입력 창 높이 (2026-10-12). 창은 64 고정이라 큰 글씨(확대, 운영체제 글자 크기)에서 입력칸 위아래가 잘렸다.
// 화면이 잰 내용 높이(CSS px)와 확대 배율로 창 높이(화면 점)를 정한다. 너무 작거나 커지지 않게 묶는다.

/** 보통 크기 창 높이. 이보다 작게 줄이지 않는다 */
export const QUICK_MIN_HEIGHT = 64;
/** 아무리 커도 이 높이까지 (화면 가운데 위쪽에 뜨는 한 줄 창이다) */
export const QUICK_MAX_HEIGHT = 240;

/** 내용 높이(CSS px, 창 여백 포함)와 확대 배율 → 창 높이. 틀린 값이면 보통 크기 */
export function quickHeight(contentCss: number, zoom: number): number {
  if (!Number.isFinite(contentCss) || !Number.isFinite(zoom) || contentCss <= 0 || zoom <= 0)
    return QUICK_MIN_HEIGHT;
  const want = Math.ceil(Math.max(QUICK_MIN_HEIGHT, contentCss) * zoom);
  return Math.min(QUICK_MAX_HEIGHT, Math.max(QUICK_MIN_HEIGHT, want));
}
