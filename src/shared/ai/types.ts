// 로컬 AI CLI 연동에서 메인, 화면이 같이 쓰는 타입.
import type { AiUsage } from './usage.ts';

/** AI 를 가리키는 id. 기본 제공('claude', 'codex', 'cursor', 'gemini')이거나 사용자가 추가한 'custom-...' */
export type AiProvider = string;

export interface ImageAttachment {
  /** 'image/png' 등 */
  mediaType: string;
  /** base64 (data: 접두사 없이) */
  data: string;
}

/**
 * 짝꿍 MCP 서버를 띄우는 명령 (짝꿍 실행 파일을 Node 로 돌려 out/main/mcp-server.js).
 * 채팅 AI 가 펫 할 일, 메모, 일정만 만질 수 있게 넘긴다. 파일, 명령 도구는 여전히 끈다
 */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * 페어리 MCP 서버 이름. 도구 이름이 mcp__fairy__add_todo 처럼 된다. 채팅이 부를 때마다 설정을 새로 만들어 넘기니
 * 예전 이름(jjakkung)에서 옮길 것이 없다. 사용자가 다른 AI 에 직접 등록한 이름은 사용자 것이라 그대로 돈다 (docs/integrations.md)
 */
export const JJ_MCP_NAME = 'fairy';

/** 어댑터가 내보내는 사건. 화면은 이것만 안다. */
export type AiEvent =
  | { type: 'session'; id: string }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'delta'; text: string }
  /** tools: 도구를 불렀다 (글 없이 끝나도 도구만 쓴 정상 경우, empty-answer.ts) */
  | { type: 'done'; text: string; tools?: boolean }
  | { type: 'error'; error: AiError };

export type AiErrorKind =
  | 'not-installed'
  | 'not-logged-in'
  | 'rate-limit'
  | 'timeout'
  | 'cancelled'
  | 'failed'
  /** 무료 AI 모델을 아직 안 받음 (v2). 화면이 받기 단추를 보여 준다 */
  | 'needs-model'
  /** 대화권을 다 썼다 (#100). 화면이 내 컴퓨터 AI 로 다시 묻기 단추를 보여 준다 */
  | 'no-tickets';

export interface AiError {
  kind: AiErrorKind;
  /** 사용자에게 보여 줄 한국어 문장. */
  message: string;
  /** 한도 초과일 때 다시 쓸 수 있는 시각 (원문 그대로). */
  retryAt?: string;
}

export interface AiStatus {
  provider: AiProvider;
  installed: boolean;
  /** 로그인 여부. 확인할 방법이 없는 AI 는 undefined */
  loggedIn?: boolean;
  version?: string;
  path?: string;
  /** 무료 AI: 고른 모델을 아직 받지 않았다 (받기 전이라 답을 못 한다) */
  needsModel?: boolean;
}
