// 메모를 쓰다 패널이 닫히면(다른 곳을 눌러서) 다음에 열 때 그 메모, 그 자리로 돌아간다.
// 보관 글은 메인 메모리에 메모 id 마다 둔다 (shared/note-keep.ts). 여기에는 옛 판이 localStorage 에 남긴 한 칸을 읽는 길만 둔다.
import { type NoteKept, parseNoteKept } from '../../../shared/note-keep.ts';

export type NoteResume = NoteKept;
export { DRAFT_MS, RESUME_MS } from '../../../shared/note-keep.ts';

/** 옛 판의 localStorage 칸 (한 번 읽어 메인으로 옮기고 지운다) */
export const RESUME_KEY = 'jj.panel.noteResume';

/** 옛 칸의 글(JSON)을 읽는다. 모양이 틀렸거나 오래됐으면 없다 */
export function parseResume(raw: string | null, now: number): NoteResume | undefined {
  if (!raw) return undefined;
  try {
    return parseNoteKept(JSON.parse(raw), now);
  } catch {
    return undefined;
  }
}
