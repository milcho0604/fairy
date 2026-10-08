// 패널과 빠른 입력의 Esc 순서: 입력칸이 먼저(비우기, 뒤로), 그다음 창 닫기. 한글 조합 중 Esc 는 조합만 끝낸다.

interface KeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
}

/** Esc 를 눌렀고 한글 조합 중이 아니다 (조합 중 Esc 는 글자를 마무리하는 키라 아무것도 하지 않는다) */
export function isEsc(e: KeyLike | { key: string; nativeEvent: KeyLike }): boolean {
  if (e.key !== 'Escape') return false;
  const n: KeyLike = 'nativeEvent' in e ? e.nativeEvent : e;
  return !n.isComposing && n.keyCode !== 229;
}

/** 창 전체에 건 Esc: 입력칸이 이미 처리했으면(preventDefault) 닫지 않는다 */
export function escClosesWindow(e: KeyLike): boolean {
  return isEsc(e) && !e.defaultPrevented;
}

/** 입력칸이 Esc 를 먹었다: 창 닫기까지 가지 않게 */
export function takeEsc(e: { preventDefault(): void; stopPropagation(): void }): void {
  e.preventDefault();
  e.stopPropagation();
}
