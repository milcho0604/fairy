// claude CLI 의 stream-json 입력을 만들고 출력을 읽는다. 0단계 검증 C1~C6, L5, L13.
import { classifyError } from './errors.ts';
import type { AiEvent, ImageAttachment } from './types.ts';
import { claudeUsage } from './usage.ts';

const LABEL = { label: 'Claude', loginHint: '터미널에서 claude 로 로그인해 줘.' };

export interface ClaudeTurn {
  text: string;
  images: readonly ImageAttachment[];
  /** 이 대화의 세션 id. 첫 질문이면 새로 만든 uuid. */
  sessionId: string;
  /** 이어서 묻는 질문인지. 아니면 --session-id 로 새 세션을 연다. */
  resume: boolean;
  persona: string;
  /** 사용자 설정(훅, MCP, 스킬) 없이 부를지. 기본 true. 설정에서 "내 AI 설정 그대로"를 고르면 false */
  isolate?: boolean;
}

/**
 * 사용자 설정(훅, MCP, 스킬)을 타지 않게 격리한다(L5).
 * claude.ai 커넥터의 MCP 도구는 실행마다 실릴 때도 안 실릴 때도 있어서(10K 대 104K 토큰, L13)
 * 빈 MCP 설정을 엄격하게 지정해 늘 빼 둔다.
 */
export function claudeArgs(turn: ClaudeTurn): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // 도구는 격리 여부와 상관없이 끈다 (기획서 AI 연동 규칙 2: 펫 채팅의 AI 는 파일을 고치거나 명령을 실행하지 않는다)
    '--tools',
    '',
    ...(turn.isolate === false
      ? []
      : [
          '--setting-sources',
          '',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--disable-slash-commands',
        ]),
    '--append-system-prompt',
    turn.persona,
    ...(turn.resume ? ['--resume', turn.sessionId] : ['--session-id', turn.sessionId]),
  ];
}

/** 표준 입력으로 보낼 한 줄. 이미지가 먼저, 글이 나중. */
export function claudeInput(turn: Pick<ClaudeTurn, 'text' | 'images'>): string {
  const content = [
    ...turn.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })),
    { type: 'text', text: turn.text },
  ];
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

/** 출력 한 줄을 사건으로 바꾼다. JSON 이 아니거나 관심 없는 줄은 빈 배열. */
export function parseClaudeLine(line: string): AiEvent[] {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return [];
  }
  if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') {
    return [{ type: 'session', id: e.session_id }];
  }
  if (e.type === 'stream_event') {
    const ev = e.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      return [{ type: 'delta', text: ev.delta.text }];
    }
    return [];
  }
  if (e.type === 'rate_limit_event') {
    const usage = claudeUsage(e.rate_limit_info, Date.now());
    return usage ? [{ type: 'usage', usage }] : [];
  }
  if (e.type === 'result') {
    const text = typeof e.result === 'string' ? e.result : '';
    if (e.is_error || e.subtype !== 'success') {
      return [{ type: 'error', error: classifyError(LABEL, text || String(e.subtype ?? '')) }];
    }
    return [{ type: 'done', text }];
  }
  return [];
}
