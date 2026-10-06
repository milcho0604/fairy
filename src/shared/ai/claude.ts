// claude CLI 의 stream-json 입력을 만들고 출력을 읽는다. 0단계 검증 C1~C6, L5, L13.
import { t } from '../i18n/index.ts';
import { classifyError } from './errors.ts';
import type { AiEvent, ImageAttachment } from './types.ts';
import { claudeUsage } from './usage.ts';

const LABEL = {
  label: 'Claude',
  get loginHint() {
    return t('ai.login.claude');
  },
};

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
  /** 기록 남기지 않기 (v1): claude 가 세션을 디스크에 저장하지 않는다. 이어가기를 못 한다 */
  ephemeral?: boolean;
  /** 내 MCP 도구 쓰기 (v2): 허락할 MCP 서버 이름들. 격리를 껐을 때만 쓴다. 기본 도구(파일, 명령)는 여전히 끈다 */
  mcpServers?: readonly string[];
  /** 고른 모델 (v2). 별칭(sonnet 등)이면 그 계열의 최신. 없으면 CLI 기본 */
  model?: string;
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
    ...(turn.isolate === false && turn.mcpServers?.length
      ? ['--allowedTools', turn.mcpServers.map(mcpToolPrefix).join(',')]
      : []),
    ...(turn.model ? ['--model', turn.model] : []),
    '--append-system-prompt',
    turn.persona,
    ...(turn.ephemeral
      ? ['--no-session-persistence']
      : turn.resume
        ? ['--resume', turn.sessionId]
        : ['--session-id', turn.sessionId]),
  ];
}

/** `claude mcp list` 의 서버 이름 → 도구 이름 앞부분. "claude.ai Notion" → mcp__claude_ai_Notion (서버의 모든 도구) */
export function mcpToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** `claude mcp list` 출력에서 연결된 서버 이름만 */
export function parseMcpList(out: string): string[] {
  return out
    .split('\n')
    .map((l) => /^(.+?): .+ - (?:✔|✓) Connected/.exec(l.trim())?.[1])
    .filter((n): n is string => !!n);
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
