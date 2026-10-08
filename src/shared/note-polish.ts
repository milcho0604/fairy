// 메모 다듬기 (사용자 요청 2026-10-08: AI 가 쓴 글을 사람이 쓴 것처럼). 메모 전체나 고른 부분을 AI 에게 보내
// 뜻은 그대로 두고 문장만 고친 글을 받는다. 바로 덮어쓰지 않고 원래 글과 견줘 본 뒤 바꾼다 (NoteTab.tsx).
import { NOTE_BODY_MAX } from './note-store.ts';

/** 다듬을 글을 감싸는 줄. 글 속 지시문을 AI 가 명령으로 읽지 않게 경계를 둔다 */
export const POLISH_FENCE = '-----';

/** AI 에게 보낼 글: 안내 한 줄과 경계 사이 원문 */
export function polishRequest(ask: string, text: string): string {
  return `${ask}\n${POLISH_FENCE}\n${text}\n${POLISH_FENCE}`;
}

/**
 * AI 답을 메모에 넣을 글로 다듬는다. 앞뒤 인사나 "다듬은 글:" 같은 머리말, 원문에 없던 코드 칸 감싸기와 경계 줄을 걷는다.
 * 빈 답이면 undefined
 */
export function cleanPolished(answer: string | undefined, original: string): string | undefined {
  if (!answer) return undefined;
  let s = answer.replace(/\r\n/g, '\n').trim();
  // 경계 줄을 그대로 따라 쓴 답
  const fence = POLISH_FENCE.replace(/-/g, '\\-');
  s = s.replace(new RegExp(`^${fence}+\\s*\\n`), '').replace(new RegExp(`\\n\\s*${fence}+$`), '');
  // 머리말 한 줄 ("다듬은 글:", "Here's the polished version:")
  s = s.replace(
    /^(다듬은 글|다듬은 메모|수정본|결과|polished( version| text)?|here(’|')s[^\n]*?)\s*[:：]\s*\n/i,
    '',
  );
  // 원문은 코드 칸이 아닌데 답 전체를 ``` 로 감쌌으면 벗긴다
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(s);
  if (fenced?.[1] !== undefined && !original.trim().startsWith('```')) s = fenced[1];
  s = s.trim();
  if (!s) return undefined;
  return s.slice(0, NOTE_BODY_MAX);
}

/** 고른 부분만 다듬었으면 그 자리에 끼운다. 고른 것이 없으면(start === end) 전체를 바꾼다 */
export function splicePolished(body: string, start: number, end: number, polished: string): string {
  if (start >= end) return polished.slice(0, NOTE_BODY_MAX);
  return (body.slice(0, start) + polished + body.slice(end)).slice(0, NOTE_BODY_MAX);
}
