import { createDraftBox } from '../shared/draft-store.ts';
import type { OutgoingImage } from '../shared/ipc.ts';
import { emptyViewKeep, freshViewKeep, parseViewKeep, type ViewKeep } from '../shared/view-keep.ts';

// 쓰던 글과 보던 위치의 메모리 보관소 (이슈 #145). 패널, 빠른 입력, 채팅 창이 같이 쓴다.
// 디스크에는 쓰지 않는다: 앱을 끄면 사라지고, 창을 닫았다 열면 돌려받는다.
// 글 상한과 모양 확인은 shared/draft-store.ts, shared/view-keep.ts.

export const drafts = createDraftBox<OutgoingImage>();

let view: ViewKeep = emptyViewKeep();

/** 보던 위치. 한 시간 넘게 손대지 않았으면 비어 있다 */
export function getView(now = Date.now()): ViewKeep {
  view = freshViewKeep(view, now);
  return view;
}

/** 창이 보낸 보던 위치를 다시 읽어 보관한다 */
export function setView(raw: unknown, now = Date.now()): void {
  view = parseViewKeep(raw, now);
}

/** 시험용: 모두 비운다 */
export function clearKept(): void {
  drafts.clearAll();
  view = emptyViewKeep();
}
