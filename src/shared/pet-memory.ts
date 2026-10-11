// 짝꿍이 기억하는 것 (오래 가는 기억). 사용자가 설정에서 적거나, MCP remember 로 온 것을 사용자가 허락한 짧은 글.
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

/**
 * AI 도구(MCP remember)가 기억하자고 한 것을 바로 기억에 넣지 않고 기다리게 두는 수.
 * 다른 글(웹 페이지, 메일)에 숨은 지시로 AI 가 remember 를 부르면 그 글이 질문마다 성격에 붙어 버린다 (리뷰 MED, 프롬프트 주입).
 * 그래서 사용자가 설정에서 허락한 것만 기억이 된다
 */
export const MEMORY_PENDING_MAX = 10;

/** 기다리는 목록 다듬기: cleanMemory 와 같고 MEMORY_PENDING_MAX 개까지 (새것을 남긴다) */
export function cleanPending(list: unknown): string[] {
  return cleanMemory(list).slice(-MEMORY_PENDING_MAX);
}

/**
 * 받은 편지함(MCP remember)을 기다리는 목록 뒤에 붙인다. 이미 기억하거나 기다리는 것은 빼고,
 * 넘치면 기다리는 것 중 오래된 것부터 뺀다. 사용자가 적은 기억(approved)은 건드리지 않는다
 */
export function mergePending(
  pending: readonly string[],
  approved: readonly string[],
  incoming: unknown,
): string[] {
  const known = new Set([...pending, ...approved].map(key));
  const out = [...pending];
  for (const item of cleanMemory(incoming)) {
    if (known.has(key(item))) continue;
    known.add(key(item));
    out.push(item);
  }
  return out.slice(-MEMORY_PENDING_MAX);
}

/**
 * 기다리는 것 하나를 허락해 기억에 넣는다. 꽉 찼으면 넣지 않는다 (허락했다고 사용자가 적은 기억을 밀어내지 않게).
 * added 면 넣었고, dupe 면 이미 기억하고 있어 기다리는 데서만 뺐고, full 이면 아무것도 안 바꿨다
 */
export function approvePending(
  list: readonly string[],
  pending: readonly string[],
  item: string,
): { list: string[]; pending: string[]; result: 'added' | 'dupe' | 'full' } {
  const rest = pending.filter((p) => key(p) !== key(item));
  if (list.some((m) => key(m) === key(item))) return { list: [...list], pending: rest, result: 'dupe' };
  if (list.length >= MEMORY_MAX) return { list: [...list], pending: [...pending], result: 'full' };
  return { list: [...list, cleanMemoryItem(item)], pending: rest, result: 'added' };
}
