// codex CLI 의 exec --json 명령을 만들고 출력을 읽는다. 0단계 검증 X1~X8, L4, L5.
import { t } from '../i18n/index.ts';
import { classifyError } from './errors.ts';
import type { AiEvent } from './types.ts';

const LABEL = {
  label: 'Codex',
  get loginHint() {
    return t('ai.login.codex');
  },
};

export interface CodexTurn {
  text: string;
  /** 이미지 파일 경로. codex 는 파일로만 받는다. */
  imagePaths: readonly string[];
  /** 이어서 물을 때 앞 대화의 thread_id. */
  threadId?: string;
  persona: string;
  /** 기록 남기지 않기 (v1): 대화 기록 파일(rollout)을 남기지 않는다. 이어가기와 사용량 읽기를 못 한다 */
  ephemeral?: boolean;
}

/**
 * 질문은 반드시 -i 앞에 둔다. -i 는 파일을 여러 개 받아서 뒤에 오는 질문까지 파일로 먹는다.
 * resume 에는 -s 가 없어 샌드박스를 -c 로 준다.
 */
export function codexArgs(turn: CodexTurn): string[] {
  const common = [
    '--json',
    '--skip-git-repo-check',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    `developer_instructions=${JSON.stringify(turn.persona)}`,
    ...turn.imagePaths.flatMap((p) => ['-i', p]),
  ];
  if (turn.ephemeral) return ['exec', turn.text, '--ephemeral', ...common];
  return turn.threadId
    ? ['exec', 'resume', turn.threadId, turn.text, ...common]
    : ['exec', turn.text, ...common];
}

/** 출력 한 줄을 사건으로 바꾼다. codex 는 답을 조각 없이 한 번에 준다(L4). 로그 줄이 섞이면 버린다. */
export function parseCodexLine(line: string): AiEvent[] {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return [];
  }
  if (e.type === 'thread.started' && typeof e.thread_id === 'string')
    return [{ type: 'session', id: e.thread_id }];
  if (e.type === 'item.completed') {
    const item = e.item as { type?: string; text?: string } | undefined;
    // 경고도 item.completed 의 error 항목으로 온다. 오류 판정은 turn.failed 로만 한다.
    if (item?.type === 'agent_message' && item.text) return [{ type: 'delta', text: item.text }];
    return [];
  }
  if (e.type === 'turn.completed') return [{ type: 'done', text: '' }];
  if (e.type === 'turn.failed' || e.type === 'error') {
    const err =
      (e.error as { message?: string } | undefined)?.message ?? (e.message as string | undefined) ?? '';
    return [{ type: 'error', error: classifyError(LABEL, err) }];
  }
  return [];
}
