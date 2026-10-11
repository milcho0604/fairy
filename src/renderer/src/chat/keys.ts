// 채팅 창 단축키. 키 이벤트를 할 일 이름으로만 바꾼다 (화면 값은 App 이 본다).
import type { ChatMessage } from '../../../shared/chat-state.ts';

/** 단축키가 보는 키 이벤트의 일부 (DOM KeyboardEvent 와 맞는다) */
export interface KeyLike {
  key: string;
  code?: string;
  keyCode?: number;
  isComposing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type ChatKey = 'escape' | 'new-chat' | 'recall';

/**
 * Esc: 답 멈추기, Cmd/Ctrl+N: 새 대화, ↑: 마지막 질문 다시 불러오기.
 * 한글 조합 중에는 아무것도 하지 않는다 (Esc, ↑ 는 조합을 끝내는 키라 그쪽이 먼저다)
 */
export function chatKey(e: KeyLike, platform: string): ChatKey | undefined {
  if (e.isComposing || e.keyCode === 229) return undefined;
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return 'escape';
  const mod = platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  // 한글 자판이면 key 가 'ㅜ' 라서 자리(code)로도 본다
  if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n'))
    return 'new-chat';
  if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return 'recall';
  return undefined;
}

/** 다시 불러올 마지막 질문 (글이 있는 것). 그림만 보낸 질문은 건너뛴다 */
export function lastQuestion(messages: readonly ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && m.text.trim()) return m.text;
  }
  return undefined;
}
