// 서버 설정은 환경 변수에서만 읽는다. 비밀값(.env.prod)은 레포에 두지 않는다 (기획서 14절).

export type Config = {
  port: number;
  databaseUrl: string;
  /** 밖에서 보이는 서버 주소. 구글 로그인의 돌아오는 주소(<publicUrl>/auth/google/callback)가 된다 */
  publicUrl: string;
  /** 구글 로그인용 OAuth 클라이언트 (scope openid 만). 둘 중 하나라도 비면 로그인 경로는 503 으로 꺼진다 */
  googleClientId: string;
  googleClientSecret: string;
  /** AI 대화권 (3단계, 8절). 없으면 AI 경로가 503 ai_off */
  ai?: AiConfig;
};

/** AI 대화권 설정. 키가 비면 대화는 503 ai_off (남은 수 보기는 된다) */
export interface AiConfig {
  apiKey: string;
  /** Anthropic API 주소. 운영은 공식 주소, 시험은 이 컴퓨터의 가짜 서버 */
  baseUrl: string;
  /** 모델 ID. 기획서의 "Haiku 5.5" 는 없는 이름이라 지금 가장 싼 Haiku 를 기본으로 둔다 (#100) */
  model: string;
  /** 서버 전체 한 달(UTC 달력) 추정 비용 상한, 백만분의 1달러 */
  monthlyBudgetMicros: number;
  /** 사람(계정)마다 하루(한국 날짜) 질문 수 상한 */
  dailyLimit: number;
  /**
   * 첫 로그인 선물과 하루 수를 세는 HMAC 비밀 (GIFT_HMAC_KEY). 탈퇴해도 남는 표(ai_gift_seen, ai_daily)의 키를
   * 이것으로 만들어 sub 원문을 두지 않는다. 비면 선물만 끈다
   */
  giftKey: string;
  /** 시험용: 첫 글자를 기다리는 시간과 답 전체 시간 (ms). 없으면 ai.ts 의 기본값 */
  firstTextMs?: number;
  totalMs?: number;
}

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_AI_MONTHLY_USD = 80;
export const DEFAULT_AI_DAILY_LIMIT = 20;
const MODEL_ID = /^[a-z0-9][a-z0-9.@_-]{1,79}$/;

/** http 주소는 이 컴퓨터(시험, 로컬)만 허락한다 */
function checkUrl(name: string, raw: string): string {
  const v = raw.replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error(`${name} 이 주소가 아니다: ${raw}`);
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(`${name} 은 https 여야 한다: ${v}`);
  return v;
}

function nonNegative(name: string, raw: string | undefined, fallback: number, integer: boolean): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n)))
    throw new Error(`${name} 가 이상하다: ${raw}`);
  return n;
}

export function readAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const model = (env.ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL;
  if (!MODEL_ID.test(model)) throw new Error(`ANTHROPIC_MODEL 이 모델 이름이 아니다: ${model}`);
  const usd = nonNegative('AI_MONTHLY_BUDGET_USD', env.AI_MONTHLY_BUDGET_USD, DEFAULT_AI_MONTHLY_USD, false);
  return {
    apiKey: (env.ANTHROPIC_API_KEY ?? '').trim(),
    baseUrl: checkUrl(
      'ANTHROPIC_BASE_URL',
      (env.ANTHROPIC_BASE_URL ?? '').trim() || DEFAULT_ANTHROPIC_BASE_URL,
    ),
    model,
    monthlyBudgetMicros: Math.round(usd * 1_000_000),
    dailyLimit: nonNegative('AI_DAILY_LIMIT', env.AI_DAILY_LIMIT, DEFAULT_AI_DAILY_LIMIT, true),
    giftKey: (env.GIFT_HMAC_KEY ?? '').trim(),
  };
}

export const DEFAULT_PUBLIC_URL = 'https://fairy-api.moilga.com';

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL 이 비어 있다');
  const port = Number(env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT 가 이상하다: ${env.PORT}`);
  const publicUrl = (env.PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`PUBLIC_URL 이 주소가 아니다: ${env.PUBLIC_URL}`);
  }
  // 운영 주소는 https 만. 시험과 로컬은 127.0.0.1 http 를 허락한다
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(`PUBLIC_URL 은 https 여야 한다: ${publicUrl}`);
  return {
    port,
    databaseUrl,
    publicUrl,
    googleClientId: (env.GOOGLE_CLIENT_ID ?? '').trim(),
    googleClientSecret: (env.GOOGLE_CLIENT_SECRET ?? '').trim(),
    ai: readAiConfig(env),
  };
}

/** 구글 로그인을 켤 수 있는지 (클라이언트 번호와 비밀이 둘 다 있다) */
export const googleEnabled = (c: Config): boolean => c.googleClientId !== '' && c.googleClientSecret !== '';
