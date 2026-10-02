// CLI 오류 문구를 사용자에게 보여 줄 오류로 바꾼다.
import { type AiError, type AiProvider, PROVIDER_LABEL } from './types.ts';

const RATE_LIMIT = /(usage limit|rate limit|limit reached|hit your limit|too many requests|429)/i;
const NOT_LOGGED_IN =
  /(not logged in|log ?in required|please (run )?.*login|unauthori[sz]ed|invalid api key|401|authentication)/i;
// codex: "try again at 7:48 PM", claude: "resets 3pm", "resets at 15:00"
const RETRY_AT = /(?:try again at|resets(?: at)?)\s+([^.\n|]+?)(?:[.\n|]|$)/i;

export function classifyError(provider: AiProvider, raw: string): AiError {
  const name = PROVIDER_LABEL[provider];
  const text = raw.trim();
  if (RATE_LIMIT.test(text)) {
    const retryAt = RETRY_AT.exec(text)?.[1]?.trim();
    return {
      kind: 'rate-limit',
      message: retryAt
        ? `${name} 사용 한도에 걸렸어. ${retryAt} 이후에 다시 물어봐 줘.`
        : `${name} 사용 한도에 걸렸어. 조금 뒤에 다시 물어봐 줘.`,
      retryAt,
    };
  }
  if (NOT_LOGGED_IN.test(text)) {
    const command = provider === 'claude' ? 'claude' : 'codex login';
    return {
      kind: 'not-logged-in',
      message: `${name}에 로그인이 안 돼 있어. 터미널에서 \`${command}\` 로 로그인해 줘.`,
    };
  }
  const short = text.split('\n').find((l) => l.trim()) ?? '';
  return { kind: 'failed', message: `${name}가 답하다 멈췄어.${short ? ` (${short.slice(0, 160)})` : ''}` };
}

export function notInstalled(provider: AiProvider): AiError {
  const how =
    provider === 'claude'
      ? 'Claude Code 를 설치하고 `claude` 로 한 번 로그인해 줘.'
      : 'Codex CLI 를 설치하고 `codex login` 으로 로그인해 줘.';
  return { kind: 'not-installed', message: `${PROVIDER_LABEL[provider]}를 이 컴퓨터에서 못 찾았어. ${how}` };
}

export function timedOut(provider: AiProvider, seconds: number): AiError {
  return {
    kind: 'timeout',
    message: `${PROVIDER_LABEL[provider]}가 ${seconds}초 동안 답이 없어서 멈췄어. 다시 물어봐 줘.`,
  };
}
