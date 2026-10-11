// 할 일 찾기와 태그 (2026-10-10). 할 일이 많아지면 한 줄 찾기와 #태그 칩으로 좁혀 본다.
// 태그는 따로 적지 않고 제목 속 "#낱말" 을 읽는다: "보고서 쓰기 #회사" 의 태그는 "회사". 저장 파일을 바꾸지 않아
// 빠른 입력, 여러 줄 붙여 넣기, MCP 로 넣은 할 일에도 그대로 붙는다.
import { noteQuery } from './note-store.ts';

/** 태그 낱말: 글자, 숫자, _ - (20자까지). "#1" 처럼 숫자만은 번호라 태그로 보지 않는다 */
const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{1,20})(?=\s|$|[!?.,])/gu;

const fold = (s: string) => s.normalize('NFC').toLowerCase();

/** 제목 속 태그 (# 없이, 처음 적은 모양 그대로, 겹치면 하나) */
export function todoTags(title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of title.normalize('NFC').matchAll(TAG_RE)) {
    const tag = m[2] ?? '';
    if (/^\d+$/.test(tag)) continue;
    const key = fold(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** 제목을 글과 태그 조각으로 (화면에서 태그만 칩 모양으로 그린다) */
export function titleParts(title: string): { text: string; tag?: string }[] {
  const parts: { text: string; tag?: string }[] = [];
  let at = 0;
  for (const m of title.matchAll(TAG_RE)) {
    const tag = m[2] ?? '';
    if (/^\d+$/.test(tag)) continue;
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    if (start > at) parts.push({ text: title.slice(at, start) });
    parts.push({ text: `#${tag}`, tag });
    at = start + tag.length + 1;
  }
  if (at < title.length) parts.push({ text: title.slice(at) });
  return parts;
}

/** 할 일들에 붙은 태그, 많이 쓴 것부터 (같으면 가나다순). 대소문자는 하나로 센다 */
export function allTags(todos: readonly { title: string }[]): { tag: string; n: number }[] {
  const count = new Map<string, { tag: string; n: number }>();
  for (const todo of todos)
    for (const tag of todoTags(todo.title)) {
      const key = fold(tag);
      const c = count.get(key);
      if (c) c.n++;
      else count.set(key, { tag, n: 1 });
    }
  return [...count.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/**
 * 할 일 좁히기: 태그(고른 칩)와 찾는 말. 찾는 말은 메모 찾기와 같은 규칙이다 (대소문자 무시, 띄어쓰기는 아무 빈칸,
 * 조합 중인 한글 마지막 글자는 넓게). 제목과 단계 제목에서 찾는다. 둘 다 없으면 그대로
 */
export function filterTodos<T extends { title: string; steps?: readonly { title: string }[] }>(
  todos: readonly T[],
  f: { query?: string; tag?: string | null; composing?: boolean },
): T[] {
  const re = f.query ? noteQuery(f.query, f.composing ?? false) : null;
  const tag = f.tag ? fold(f.tag) : null;
  if (!re && !tag) return [...todos];
  return todos.filter((todo) => {
    if (tag && !todoTags(todo.title).some((x) => fold(x) === tag)) return false;
    if (!re) return true;
    if (re.test(fold(todo.title))) return true;
    return (todo.steps ?? []).some((s) => re.test(fold(s.title)));
  });
}
