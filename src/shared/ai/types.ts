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

/** 어댑터가 내보내는 사건. 화면은 이것만 안다. */
export type AiEvent =
  | { type: 'session'; id: string }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: AiError };

export type AiErrorKind =
  | 'not-installed'
  | 'not-logged-in'
  | 'rate-limit'
  | 'timeout'
  | 'cancelled'
  | 'failed';

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
}
