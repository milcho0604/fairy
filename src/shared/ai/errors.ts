// CLI 오류 문구를 사용자에게 보여 줄 오류로 바꾼다.
import { withParticle } from '../josa.ts';
import type { AiError } from './types.ts';

/** 오류 문장에 필요한 AI 정보. */
export interface ErrorSubject {
  label: string;
  installHint?: string;
  loginHint?: string;
}

const RATE_LIMIT = /(usage limit|rate limit|limit reached|hit your limit|too many requests|quota|429)/i;
const NOT_LOGGED_IN =
  /(not logged in|log ?in required|please (run )?.*login|unauthori[sz]ed|invalid api key|401|authentication)/i;
// codex: "try again at 7:48 PM", claude: "resets 3pm", "resets at 15:00"
const RETRY_AT = /(?:try again at|resets(?: at)?)\s+([^.\n|]+?)(?:[.\n|]|$)/i;

export function classifyError(ai: ErrorSubject, raw: string): AiError {
  const text = raw.trim();
  if (RATE_LIMIT.test(text)) {
    const retryAt = RETRY_AT.exec(text)?.[1]?.trim();
    return {
      kind: 'rate-limit',
      message: retryAt
        ? `${ai.label} 사용 한도에 걸렸어. ${retryAt} 이후에 다시 물어봐 줘.`
        : `${ai.label} 사용 한도에 걸렸어. 조금 뒤에 다시 물어봐 줘.`,
      retryAt,
    };
  }
  if (NOT_LOGGED_IN.test(text)) {
    return {
      kind: 'not-logged-in',
      message: `${ai.label}에 로그인이 안 돼 있어. ${ai.loginHint ?? '터미널에서 로그인해 줘.'}`,
    };
  }
  const short = text.split('\n').find((l) => l.trim()) ?? '';
  return {
    kind: 'failed',
    message: `${withParticle(ai.label, '이')} 답하다 멈췄어.${short ? ` (${short.slice(0, 160)})` : ''}`,
  };
}

export function notInstalled(ai: ErrorSubject): AiError {
  return {
    kind: 'not-installed',
    message: `${withParticle(ai.label, '을')} 이 컴퓨터에서 못 찾았어. ${ai.installHint ?? ''}`.trim(),
  };
}

export function timedOut(ai: ErrorSubject, seconds: number): AiError {
  return {
    kind: 'timeout',
    message: `${withParticle(ai.label, '이')} ${seconds}초 동안 답이 없어서 멈췄어. 다시 물어봐 줘.`,
  };
}
