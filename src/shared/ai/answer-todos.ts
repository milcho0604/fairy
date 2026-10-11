// 답을 할 일로 넣기 전에 다듬는다. 같은 답에서 "할 일로"를 두 번 누르면 같은 할 일이 두 개씩 쌓였고,
// "내일 보고서 쓰기" 같은 줄은 마감 없이 "내일"이 제목에 남았다. 빠른 입력과 같은 규칙으로 마감을 읽는다.
import { parseQuickTodo } from '../quick-add.ts';
import type { Repeat } from '../todo-store.ts';

export interface PlannedTodo {
  title: string;
  due: string | null;
  repeat: Repeat | null;
}

/** 같은 할 일인지 (대소문자, 띄어쓰기 무시) */
const norm = (title: string) => title.toLowerCase().replace(/\s+/g, '');

/**
 * 넣을 할 일: 마감 낱말은 마감으로, 안 끝낸 할 일이나 앞 줄과 같은 제목은 뺀다.
 * 답 끝의 "!"는 중요 표시로 보지 않는다 (AI 말투일 뿐)
 */
export function planTodos(
  titles: readonly string[],
  open: readonly { title: string }[],
  today: string,
): PlannedTodo[] {
  const seen = new Set(open.map((o) => norm(o.title)));
  const out: PlannedTodo[] = [];
  for (const raw of titles) {
    const q = parseQuickTodo(raw, today);
    const title = q.title.trim() || raw.trim();
    if (!title || seen.has(norm(title))) continue;
    seen.add(norm(title));
    out.push({ title, due: q.due, repeat: q.repeat });
  }
  return out;
}
