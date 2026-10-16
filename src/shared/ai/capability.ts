// AI 능력표와 자동 감지 결과 해석 (이슈 #126). 시작 안내, 설정의 AI 탭, README 가 같은 표를 쓴다.
// 감지는 실행 파일이 있는지(--version)와 로그인 확인 명령(auth status 등)만 본다. 진짜 질문은 하지 않는다 (main/ai/runner.ts checkStatus).
import type { AiStatus } from './types.ts';

/** 능력표에 오르는 AI (기본 제공). 대화권(fairy-ticket)과 직접 추가한 AI 는 표에 넣지 않는다 */
export const CAPABILITY_IDS = ['claude', 'codex', 'cursor', 'gemini', 'local'] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const isCapabilityId = (v: unknown): v is CapabilityId =>
  typeof v === 'string' && (CAPABILITY_IDS as readonly string[]).includes(v);

/**
 * 감지 결과
 * - found: 찾았고 로그인도 됐다
 * - found-unchecked: 찾았지만 로그인을 확인할 방법이 없다 (Gemini CLI). 써 보면 안다
 * - login: 찾았는데 로그인이 필요하다
 * - missing: 없다 (내 컴퓨터 AI 는 모델을 아직 안 받은 것)
 */
export type DetectState = 'found' | 'found-unchecked' | 'login' | 'missing';

export interface DetectRow {
  id: CapabilityId;
  state: DetectState;
  /** CLI 가 알려 준 판 (첫 줄) */
  version?: string;
}

/** 감지 한 건을 표시 상태로 */
export function detectState(id: CapabilityId, status: AiStatus | undefined): DetectState {
  if (!status) return 'missing';
  if (id === 'local') return status.needsModel ? 'missing' : 'found';
  if (!status.installed) return 'missing';
  if (status.loggedIn === false) return 'login';
  if (status.loggedIn === undefined) return 'found-unchecked';
  return 'found';
}

/** 지금 바로 쓸 수 있다 (찾았다) */
export const isUsable = (s: DetectState): boolean => s === 'found' || s === 'found-unchecked';

/** AI 마다 되는 일. 코드가 실제로 하는 일에서 정한다 (chat.ts 가 jjServer 를 claude, codex 에만 싣고 그림은 spec.images 인 곳만 보낸다) */
export interface Capability {
  /** 대화 */
  chat: boolean;
  /** 할 일 정리: 내 할 일과 일정을 알고 답하기, 메모 다듬기, 답을 할 일로 */
  todos: boolean;
  /** 화면 보기: 고른 화면 그림을 보여 주며 묻기 */
  vision: boolean;
  /** 페어리 MCP: 대화 중에 AI 가 페어리 할 일, 메모, 일정을 직접 넣는다 */
  mcp: boolean;
  /** 비용: 내 구독 사용량으로 쓰는지, 무료인지 */
  cost: 'subscription' | 'free';
  /** 읽기 전용으로 묶는 방식 (shared/ai/guard.ts). none 은 도구가 아예 없다 */
  readOnly: 'enforced' | 'none';
  /** 실제 출력으로 확인했는지. 아니면 화면에 "확인 전" 표시 (providers.ts verified) */
  verified: boolean;
}

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  claude: {
    chat: true,
    todos: true,
    vision: true,
    mcp: true,
    cost: 'subscription',
    readOnly: 'enforced',
    verified: true,
  },
  codex: {
    chat: true,
    todos: true,
    vision: true,
    mcp: true,
    cost: 'subscription',
    readOnly: 'enforced',
    verified: true,
  },
  cursor: {
    chat: true,
    todos: true,
    vision: false,
    mcp: false,
    cost: 'subscription',
    readOnly: 'enforced',
    verified: false,
  },
  gemini: {
    chat: true,
    todos: true,
    vision: false,
    mcp: false,
    cost: 'subscription',
    readOnly: 'enforced',
    verified: false,
  },
  local: {
    chat: true,
    todos: true,
    vision: false,
    mcp: false,
    cost: 'free',
    readOnly: 'none',
    verified: true,
  },
};
