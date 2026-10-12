// 글을 길이 상한(UTF-16 단위, 저장 칸과 입력 칸 maxLength 가 세는 단위)으로 자른다.
// 그냥 slice 하면 상한이 이모지(두 단위) 가운데에 걸릴 때 반쪽이 남고, 저장 파일(SQLite)이 그것을 "�" 로 바꿔
// 할 일, 메모, 일정 제목 끝에 깨진 글자가 보였다 (버그잡이 b, 2026-10-12). 반쪽이면 그 앞에서 자른다.

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** s 를 max 단위까지. 끝이 짝 잃은 앞쪽 반(high surrogate)이면 그것까지 뗀다 */
export function cutText(s: string, max: number): string {
  if (s.length <= max) return s;
  const end = Math.max(0, max);
  return isHigh(s.charCodeAt(end - 1)) ? s.slice(0, end - 1) : s.slice(0, end);
}

/** 자를 자리 at 이 글자 가운데(뒤쪽 반 앞)면 한 칸 앞으로 당긴다. 앞뒤로 잘라 보여 줄 때 (찾기 둘레 글) */
export function textBoundary(s: string, at: number): number {
  if (at <= 0 || at >= s.length) return at;
  return isHigh(s.charCodeAt(at - 1)) ? at - 1 : at;
}
