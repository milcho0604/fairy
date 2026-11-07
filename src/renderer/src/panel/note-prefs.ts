// 메모 편집기의 마지막 고른 것 두 가지를 브라우저 저장소에 둔다 (일정 탭의 목록/달력 고르기와 같은 방식).
// - 새 메모의 형식: 마지막으로 고른 형식 (txt 또는 md)
// - 마크다운 메모를 열 때 편집인지 미리보기인지: 마지막으로 본 쪽
// 저장소를 못 쓰는 때(막힌 창, 가득 참)는 기본값으로 읽고 조용히 넘어간다.

import { type NoteFormat, noteFormatOf } from '../../../shared/note-store.ts';

export type NoteMode = 'edit' | 'preview';

export const FORMAT_KEY = 'jj.panel.noteFormat';
export const MODE_KEY = 'jj.panel.noteMode';

/** localStorage 중 쓰는 만큼만 (시험에서 같은 모양의 것을 넣는다) */
export type PrefStore = Pick<Storage, 'getItem' | 'setItem'>;

const browserStore = (): PrefStore | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};

/** 새 메모의 형식. 고른 적이 없거나 깨진 값이면 txt */
export function savedFormat(store: PrefStore | undefined = browserStore()): NoteFormat {
  try {
    return noteFormatOf(store?.getItem(FORMAT_KEY));
  } catch {
    return 'txt';
  }
}

export function saveFormat(format: NoteFormat, store: PrefStore | undefined = browserStore()): void {
  try {
    store?.setItem(FORMAT_KEY, noteFormatOf(format));
  } catch {
    // 못 적어도 이번 메모에는 바뀐다
  }
}

/** 마크다운 메모를 여는 방식. 고른 적이 없으면 편집 */
export function savedMode(store: PrefStore | undefined = browserStore()): NoteMode {
  try {
    return store?.getItem(MODE_KEY) === 'preview' ? 'preview' : 'edit';
  } catch {
    return 'edit';
  }
}

export function saveMode(mode: NoteMode, store: PrefStore | undefined = browserStore()): void {
  try {
    store?.setItem(MODE_KEY, mode === 'preview' ? 'preview' : 'edit');
  } catch {
    // 못 적어도 이번에는 바뀐다
  }
}
