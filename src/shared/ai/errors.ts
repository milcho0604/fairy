// CLI 오류 문구를 사용자에게 보여 줄 오류로 바꾼다.
import { t } from '../i18n/index.ts';
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
        ? t('ai.error.rateLimitAt', { label: ai.label, at: retryAt })
        : t('ai.error.rateLimit', { label: ai.label }),
      retryAt,
    };
  }
  if (NOT_LOGGED_IN.test(text)) {
    return {
      kind: 'not-logged-in',
      message: t('ai.error.notLoggedIn', { label: ai.label, hint: ai.loginHint ?? t('ai.error.loginHint') }),
    };
  }
  const short = text.split('\n').find((l) => l.trim()) ?? '';
  return {
    kind: 'failed',
    message: t('ai.error.failed', { label: ai.label, detail: short ? ` (${short.slice(0, 160)})` : '' }),
  };
}

export function notInstalled(ai: ErrorSubject): AiError {
  return {
    kind: 'not-installed',
    message: t('ai.error.notInstalled', { label: ai.label, hint: ai.installHint ?? '' }).trim(),
  };
}

export function timedOut(ai: ErrorSubject, seconds: number): AiError {
  return {
    kind: 'timeout',
    message: t('ai.error.timeout', { label: ai.label, seconds }),
  };
}
