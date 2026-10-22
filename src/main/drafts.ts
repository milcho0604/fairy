import { createDraftBox } from '../shared/draft-store.ts';
import type { OutgoingImage } from '../shared/ipc.ts';
import { createNoteKeep } from '../shared/note-keep.ts';
import { type KeptToast, liveToasts, parseToasts } from '../shared/toast-keep.ts';
import { emptyViewKeep, freshViewKeep, parseViewKeep, type ViewKeep } from '../shared/view-keep.ts';

// 쓰던 글과 보던 위치의 메모리 보관소 (이슈 #145). 패널, 빠른 입력, 채팅 창이 같이 쓴다.
// 디스크에는 쓰지 않는다: 앱을 끄면 사라지고, 창을 닫았다 열면 돌려받는다.
// 글 상한과 모양 확인은 shared/draft-store.ts, shared/view-keep.ts.

export const drafts = createDraftBox<OutgoingImage>();

/** 메모 편집의 보관 글 (#160). 메모 id 마다 (shared/note-keep.ts) */
export const noteKeep = createNoteKeep();

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

let toasts: KeptToast[] = [];

/** 되돌리기 알림 (패널을 벗어나도 남은 시간 동안). 사라질 때가 지난 것은 뺀다 */
export function getToasts(now = Date.now()): KeptToast[] {
  toasts = liveToasts(toasts, now);
  return toasts;
}

/** 패널이 보낸 알림 목록을 다시 읽어 보관한다 */
export function setToasts(raw: unknown, now = Date.now()): void {
  toasts = parseToasts(raw, now);
}

/** 시험용: 모두 비운다 */
export function clearKept(): void {
  drafts.clearAll();
  noteKeep.clearAll();
  view = emptyViewKeep();
  toasts = [];
}
