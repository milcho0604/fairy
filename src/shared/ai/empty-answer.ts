// AI 가 아무 글 없이 잘 끝났을 때 (이슈 #65). 예전에는 빈 말풍선이 남고 펫은 "답 왔어:" 뒤가 비었다.
// 도구(짝꿍 할 일, 메모, 웹 검색)만 부르고 말없이 끝난 것은 정상이라 따로 알린다
import { t } from '../i18n/index.ts';

/** 도구 부르기로 보는 codex 항목 */
const CODEX_TOOL_ITEMS = new Set(['mcp_tool_call', 'command_execution', 'web_search', 'file_change']);

/**
 * CLI 출력 한 줄(JSON)이 도구를 불렀다는 줄인지. claude 와 cursor 는 assistant 메시지의 tool_use 와 stream_event 의
 * tool_use 블록 시작, cursor 는 tool_call 줄, codex 는 도구 항목(item.started, item.completed). JSON 이 아니면 거짓
 */
export function lineUsedTool(line: string): boolean {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return false;
  }
  if (!e || typeof e !== 'object') return false;
  if (e.type === 'tool_call') return true;
  if (e.type === 'assistant') {
    const content = (e.message as { content?: unknown } | undefined)?.content;
    return (
      Array.isArray(content) &&
      content.some((c) => /tool_use$/.test(String((c as { type?: unknown } | null)?.type ?? '')))
    );
  }
  if (e.type === 'stream_event') {
    const ev = e.event as { type?: string; content_block?: { type?: string } } | undefined;
    return ev?.type === 'content_block_start' && /tool_use$/.test(ev.content_block?.type ?? '');
  }
  if (e.type === 'item.started' || e.type === 'item.completed') {
    const item = e.item as { type?: string } | undefined;
    return CODEX_TOOL_ITEMS.has(item?.type ?? '');
  }
  return false;
}

/**
 * 끝난 답 글. text 는 끝 사건의 글, streamed 는 조각으로 모은 글. 둘 다 비었으면 도구만 썼는지에 따라 안내 말로
 */
export function finalAnswer(text: string, streamed: string, usedTool: boolean): string {
  if (text.trim()) return text;
  if (streamed.trim()) return streamed.trim();
  return usedTool ? t('ai.toolsOnly') : t('ai.emptyAnswer');
}
