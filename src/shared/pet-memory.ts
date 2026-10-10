// 짝꿍이 기억하는 것 (오래 가는 기억). 사용자가 설정에서 적거나 MCP remember 로 넣은 짧은 글.
// 질문마다 성격 뒤에 같이 보내니 짧고 적게 둔다. 기본은 비어 있다 (사용자가 넣어야만 보낸다).
// 이 컴퓨터 설정 파일에만 둔다.

export const MEMORY_MAX = 30;
export const MEMORY_ITEM_MAX = 100;

/** 한 줄로 다듬고 100자까지. 비면 빈 글 */
export function cleanMemoryItem(v: unknown): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/\s+/g, ' ').trim()].slice(0, MEMORY_ITEM_MAX).join('').trim();
}

/** 같은 기억인지 (대소문자, 띄어쓰기 무시) */
const key = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 저장 파일이나 화면에서 온 목록을 다듬는다: 글만, 같은 것 하나, 넘치면 오래된 것부터 뺀다 */
export function cleanMemory(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const item = cleanMemoryItem(v);
    if (!item || seen.has(key(item))) continue;
    seen.add(key(item));
    out.push(item);
  }
  return out.slice(-MEMORY_MAX);
}

/** 기억 더하기. 이미 있으면 그대로 (added false), 꽉 찼으면 가장 오래된 것을 뺀다 */
export function addMemory(list: readonly string[], item: unknown): { list: string[]; added: boolean } {
  const clean = cleanMemoryItem(item);
  if (!clean || list.some((m) => key(m) === key(clean))) return { list: [...list], added: false };
  return { list: cleanMemory([...list, clean]), added: true };
}

/**
 * MCP remember 가 기억을 두고 가는 파일 (userData/memory-inbox.json, 글 목록). 설정 파일은 켜져 있는 짝꿍이
 * 들고 있다가 통째로 다시 쓰므로 MCP 가 직접 고치면 사라진다. 짝꿍이 이 파일을 읽어 설정에 합치고 지운다
 */
export const MEMORY_INBOX = 'memory-inbox';

/** 받은 편지함(MCP remember)을 지금 기억 뒤에 합친다. 같은 것은 한 번, 넘치면 오래된 것부터 뺀다 */
export function mergeMemory(list: readonly string[], incoming: unknown): string[] {
  let out = [...list];
  for (const item of cleanMemory(incoming)) out = addMemory(out, item).list;
  return out;
}
