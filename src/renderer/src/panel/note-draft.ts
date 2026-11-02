// 큰 창 메모 구역의 빈 새 메모 칸 (NoteDraft.tsx). 글이 생기기 전에는 메모를 만들지 않는다.

/** 글이 한 글자라도 있다 (공백뿐이면 아직 없다) */
export function draftHasText(d: { title: string; body: string }): boolean {
  return d.title.trim() !== '' || d.body.trim() !== '';
}

/**
 * 빈 칸이 커서를 가져가도 되는가. 창이 앞에 있고 다른 입력칸에 커서가 없을 때만
 * (찾기 칸에 쓰던 중이거나 시험 창처럼 앞에 없으면 뺏지 않는다)
 */
export function mayGrabFocus(w: { windowFocused: boolean; activeEditable: boolean }): boolean {
  return w.windowFocused && !w.activeEditable;
}
