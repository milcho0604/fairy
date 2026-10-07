// Cursor Agent CLI(cursor-agent). 2026-10-02 이 맥에는 깔려 있지만 로그인이 안 돼 실제 출력은 확인 전이다.
// 도움말 기준: -p --output-format stream-json --stream-partial-output, --mode ask(읽기 전용 질문 답변), --resume <chatId>.
// 출력 형식을 확인하지 못했으므로 claude 식(stream_event)과 assistant 메시지 둘 다 읽는다.

import { t } from '../i18n/index.ts';
import { parseClaudeLine } from './claude.ts';
import { classifyError } from './errors.ts';
import { argText } from './text.ts';
import type { AiEvent } from './types.ts';

export interface CursorTurn {
  text: string;
  sessionId?: string;
  persona: string;
}

export function cursorArgs(turn: CursorTurn): string[] {
  // 성격 지시를 따로 받는 옵션이 없어 첫 질문 앞에 붙인다. 이어서 물을 때는 이미 대화에 있다.
  const prompt = turn.sessionId ? turn.text : `${turn.persona}\n\n${turn.text}`;
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--mode',
    'ask',
    ...(turn.sessionId ? ['--resume', turn.sessionId] : []),
    argText(prompt),
  ];
}

const LABEL = {
  label: 'Cursor',
  get loginHint() {
    return t('ai.login.cursor');
  },
};

/**
 * 한 번 실행 동안의 상태를 갖는 해석기. assistant 메시지가 지금까지의 전체 글로 오든 조각으로 오든
 * 앞에 보낸 글과 겹치는 부분을 빼고 새 글만 보낸다.
 */
export function cursorParser(): (line: string) => AiEvent[] {
  let sent = '';
  return (line) => {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      return [];
    }
    if (e.type === 'system' && typeof e.session_id === 'string')
      return [{ type: 'session', id: e.session_id }];
    if (e.type === 'assistant') {
      const content =
        (e.message as { content?: { type?: string; text?: string }[] } | undefined)?.content ?? [];
      const text = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      if (!text) return [];
      const delta = text.startsWith(sent) ? text.slice(sent.length) : text;
      sent = text.startsWith(sent) ? text : sent + text;
      return delta ? [{ type: 'delta', text: delta }] : [];
    }
    if (e.type === 'result') {
      const text = typeof e.result === 'string' ? e.result : sent;
      if (e.is_error || (e.subtype && e.subtype !== 'success')) {
        return [{ type: 'error', error: classifyError(LABEL, text || String(e.subtype ?? '')) }];
      }
      return [{ type: 'done', text: text || sent }];
    }
    // claude 와 같은 stream_event 형식으로 올 때
    const same = parseClaudeLine(line).filter((ev) => ev.type === 'delta');
    for (const ev of same) if (ev.type === 'delta') sent += ev.text;
    return same;
  };
}
